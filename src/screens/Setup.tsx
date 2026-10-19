import { useEffect, useMemo, useState } from "react";
import { draftTitle, findCollectionByTitle, planCollectionSave } from "../domain/collections";
import { formatVocabText, toChunks } from "../domain/chunking";
import {
  LANGUAGES,
  languageById,
  type LanguageId,
  type Mode,
  type SetupFill,
  type StartInput,
} from "../domain/types";
import { isSupported, webSpeech } from "../tts";
import type { VoiceOption } from "../tts";
import { deleteCollection, listCollections, saveCollection } from "../storage/db";
import { newId } from "../lib/id";
import type { Collection } from "../domain/types";
import { Share } from "./Share";

interface Props {
  onStart: (input: StartInput) => void;
  /** Open the list of past Runs and what still needs practice. */
  onHistory: () => void;
  voices: VoiceOption[];
  /** null = still loading. */
  canEnumerate: boolean | null;
  /** The material the screen starts with, from a Shared Link or a drill. */
  initial: SetupFill | null;
  /** The material arrived in a Shared Link, which is worth saying so. */
  fromLink: boolean;
  /** A dictation arrived in the link but could not be read. */
  shareBroken: boolean;
  /** A read or write failed, so the browser cannot keep anything. */
  onStorageFail: () => void;
}

const SAMPLES: Record<Mode, Record<LanguageId, string>> = {
  paragraph: {
    yue: "今日天氣唔錯。我打算去公園散步。不過好似會落雨。不如返屋企啦。",
    zh: "今天天气不错。我打算去公园散步。不过好像要下雨了。不如回家吧。",
    en: "The weather is unusually pleasant this morning.\nI had planned to walk along the harbour after lunch.",
  },
  vocab: {
    yue: "圖書館\n醫院\n機場\n銀行",
    zh: "图书馆\n医院\n机场\n银行",
    en: "library\nhospital\nairport",
  },
};

/**
 * Whether the device reports any Voice for a Language.
 *
 * Android Chrome reports language codes rather than installed voices, so a
 * positive result there is optimistic — it means the browser *might* be able
 * to speak it, not that it can.
 */
function hasVoiceFor(voices: VoiceOption[], id: LanguageId): boolean {
  const tags = languageById(id).tags.map((t) => t.toLowerCase());
  return voices.some((v) => {
    const lang = v.lang.toLowerCase().replace(/_/g, "-");
    return tags.some((tag) => lang.startsWith(tag) || lang.split("-")[0] === tag);
  });
}

export function Setup({
  onStart,
  onHistory,
  voices,
  canEnumerate,
  initial,
  fromLink,
  shareBroken,
  onStorageFail,
}: Props) {
  const [language, setLanguage] = useState<LanguageId>(initial?.language ?? "yue");
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "paragraph");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [testState, setTestState] = useState<"idle" | "speaking" | "ok" | "cut" | "failed">("idle");
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    // An unreadable store is worth saying out loud rather than showing an empty
    // list that looks like "you have not saved anything yet".
    void listCollections().then(setCollections).catch(onStorageFail);
  }, [onStorageFail]);

  function testVoice() {
    if (testState === "speaking") return;
    setTestState("speaking");
    const sample =
      language === "en"
        ? "Testing one, two, three."
        : language === "zh"
          ? "今天天气不错。"
          : "今日天氣唔錯。";
    void webSpeech
      .speak(sample, {
        lang: languageById(language).tags[0] ?? "en",
        onError: () => setTestState("failed"),
      })
      .then((result) =>
        // The browser can stop speaking without saying so — Chrome does it
        // silently at around fifteen seconds. "Finished playing." for a voice
        // that never got going would be a lie.
        setTestState((s) => (s === "speaking" ? (result === "finished" ? "ok" : "cut") : s)),
      );
  }

  const hasVoice = useMemo(() => hasVoiceFor(voices, language), [language, voices]);

  const chunks = useMemo(() => toChunks(text, mode), [text, mode]);
  const canStart = chunks.length > 0;
  /** Stable identity, so the Share panel does not re-encode on every keystroke. */
  const shareable = useMemo(() => ({ language, mode, title, text }), [language, mode, title, text]);

  const saved = useMemo(
    () => findCollectionByTitle(collections, draftTitle(title, mode)),
    [collections, title, mode],
  );

  async function save() {
    if (!canStart) return;
    // Same title means same Collection: drilling a sample again refreshes the
    // saved material instead of piling up identical rows.
    const c = planCollectionSave(collections, { title, language, mode, text }, Date.now(), newId);
    // Persistence is a convenience, never a precondition — a failed write
    // (private mode, quota, insecure context) must not stop the dictation.
    let stored = true;
    try {
      await saveCollection(c);
      setCollections(await listCollections());
    } catch {
      stored = false;
      onStorageFail();
    }
    onStart({ title: c.title, language, mode, text, collectionId: stored ? c.id : null });
  }

  return (
    <div className="pad stack">
      <header className="su-head">
        <h1>Self dictation</h1>
        <button className="rowbtn" onClick={onHistory}>
          Your progress
        </button>
      </header>

      {fromLink && (
        <p className="note good">
          Opened from a shared link. Check that this device has the voice for it, then start.
        </p>
      )}
      {shareBroken && (
        <p className="note bad">
          A dictation arrived in this link, but it could not be read — this browser may be too old
          to unpack it. Ask whoever sent it for the text instead.
        </p>
      )}

      <section>
        <p className="lbl">1 · Language</p>
        <div className="seg col">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              aria-pressed={language === l.id}
              onClick={() => {
                setLanguage(l.id);
                setTestState("idle");
              }}
            >
              <span>
                <b>{l.label}</b>
                <i>
                  {canEnumerate === false
                    ? "cannot tell — try it"
                    : hasVoiceFor(voices, l.id)
                      ? "voice found"
                      : "no voice found"}
                </i>
              </span>
            </button>
          ))}
        </div>

        <div className="voice-test">
          <button className="btn" onClick={testVoice} disabled={testState === "speaking"}>
            {testState === "speaking" ? "Playing…" : "Test this voice"}
          </button>
          {testState === "ok" && <span className="note good">Finished playing.</span>}
          {testState === "cut" && (
            <span className="note bad">
              The browser stopped before it had finished. That usually means the voice is listed but
              not really installed — check the language pack, and try again.
            </span>
          )}
          {testState === "failed" && (
            <span className="note bad">
              The browser refused to speak. On Android, install the language pack in Settings →
              System → Languages, or set Google Speech Services → Text-to-speech output.
            </span>
          )}
        </div>

        {!isSupported() && <p className="note bad">This browser has no speech support at all.</p>}

        {canEnumerate === false && isSupported() && (
          <p className="note">
            This browser does not expose its voice list, so availability cannot be checked up front
            — Android usually behaves this way. Try the voice above; the app will still work if your
            device has the language installed.
          </p>
        )}

        {canEnumerate === true && !hasVoice && (
          <p className="note bad">
            No {languageById(language).label} voice is installed on this device — speech will fall
            back to another language. You may need to add{" "}
            {languageById(language).requires ?? "a matching voice"}.
          </p>
        )}
      </section>

      <section>
        <p className="lbl">2 · Mode</p>
        <div className="seg">
          <button aria-pressed={mode === "paragraph"} onClick={() => setMode("paragraph")}>
            Paragraph
          </button>
          <button aria-pressed={mode === "vocab"} onClick={() => setMode("vocab")}>
            Vocabulary
          </button>
        </div>
        <p className="note" style={{ marginTop: 8 }}>
          {mode === "paragraph"
            ? "Split into sentences and spoken one at a time."
            : "One item per line. Each is spoken on its own."}
        </p>
      </section>

      <section>
        <p className="lbl">3 · Content</p>
        <textarea
          className="box"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "vocab" ? "圖書館\n醫院\n機場" : "Paste a passage…"}
        />
        <div className="row-inline">
          <input
            className="box"
            placeholder="title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {mode === "vocab" && (
            <button
              className="rowbtn"
              disabled={!text.trim()}
              onClick={() => setText(formatVocabText(text))}
              title="Trim spaces, drop blank lines"
            >
              format
            </button>
          )}
          <button className="rowbtn" onClick={() => setText(SAMPLES[mode][language])}>
            load sample
          </button>
        </div>
        <p className="note" style={{ marginTop: 8 }}>
          {canStart
            ? `${chunks.length} chunk${chunks.length === 1 ? "" : "s"} ready.`
            : "Add content above, or tap “load sample”."}
        </p>
      </section>

      {collections.length > 0 && (
        <section>
          <p className="lbl">Saved in this browser</p>
          <div className="saved">
            {collections.map((c) => (
              <div className="saved-row" key={c.id}>
                <span className="chip">{languageById(c.language).label}</span>
                <span className="nm">{c.title}</span>
                <button
                  className="rowbtn"
                  onClick={() => {
                    setLanguage(c.language);
                    setMode(c.mode);
                    setTitle(c.title);
                    setText(c.text);
                  }}
                >
                  load
                </button>
                <button
                  className="rowbtn"
                  aria-label={`Delete ${c.title}`}
                  onClick={() =>
                    void deleteCollection(c.id)
                      .then(() => listCollections().then(setCollections))
                      .catch(onStorageFail)
                  }
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {canStart && (
        <button className="btn" onClick={() => setSharing((open) => !open)}>
          {sharing ? "Hide the link" : "Share a link"}
        </button>
      )}
      {canStart && sharing && <Share setup={shareable} onClose={() => setSharing(false)} />}

      <button className="btn primary" disabled={!canStart} onClick={() => void save()}>
        Start dictation
      </button>
      {canStart && (
        <p className="note" style={{ textAlign: "center" }}>
          {saved
            ? `Updates the saved collection “${saved.title}”.`
            : "Saves to this browser so you can drill it again."}
        </p>
      )}
    </div>
  );
}
