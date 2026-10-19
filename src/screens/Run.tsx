import { useEffect, useRef, useState } from "react";
import { significantLength } from "../domain/chunking";
import { grade, scoreChunk, scoreRun } from "../domain/grading";
import { languageById, type LanguageId, type Mode, type Outcome } from "../domain/types";
import { webSpeech } from "../tts";

export interface RunState {
  title: string;
  language: LanguageId;
  mode: Mode;
  chunks: string[];
  collectionId: string | null;
}

interface Props {
  run: RunState;
  onFinish: (results: { transcript: string; outcome: Outcome | null }[]) => void;
  onCancel: () => void;
}

type Mark = Record<number, { transcript: string; outcome: Outcome | null; revealed: boolean }>;

type AnswerOn = "paper" | "typed";

/** The BCP-47 tag we ask the device for. */
function speakTag(lang: LanguageId): string {
  return languageById(lang).tags[0] ?? "en";
}

/**
 * Typing is a valid answer in Latin script and a misleading one in Chinese,
 * so it is the default only for English. See GLOSSARY.md, "Transcript".
 */
function defaultAnswerOn(lang: LanguageId): AnswerOn {
  return lang === "en" ? "typed" : "paper";
}

/**
 * Layout B from the prototype: every Chunk visible as a numbered slot so you
 * can see how much is left without seeing a word of it.
 *
 * The textarea is optional. Most people write Chinese on paper, so the primary
 * path is speak → write → reveal → mark yourself; the diff is there for anyone
 * who did type.
 */
export function Run({ run, onFinish, onCancel }: Props) {
  const [mark, setMark] = useState<Mark>(() =>
    Object.fromEntries(
      run.chunks.map((_, i) => [i, { transcript: "", outcome: null, revealed: false }]),
    ),
  );
  const [cursor, setCursor] = useState(0);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [answerOn, setAnswerOn] = useState<AnswerOn>(() => defaultAnswerOn(run.language));
  const typingAllowed = answerOn === "typed";
  const listRef = useRef<HTMLDivElement>(null);
  const tag = speakTag(run.language);

  useEffect(() => () => webSpeech.cancel(), []);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-slot="${cursor}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [cursor]);

  function patch(i: number, next: Partial<Mark[number]>) {
    setMark((prev) => ({
      ...prev,
      [i]: { ...(prev[i] ?? { transcript: "", outcome: null, revealed: false }), ...next },
    }));
  }

  async function speak(i: number) {
    if (speaking !== null) {
      webSpeech.cancel();
      setSpeaking(null);
      return;
    }
    setSpeaking(i);
    setSpeechError(null);
    try {
      await webSpeech.speak(run.chunks[i] ?? "", {
        lang: tag,
        onError: (reason) => setSpeechError(reason),
      });
    } finally {
      setSpeaking(null);
    }
  }

  function next() {
    setCursor((c) => Math.min(c + 1, run.chunks.length - 1));
  }
  function back() {
    setCursor((c) => Math.max(c - 1, 0));
  }

  const scores = run.chunks.map((ref, i) =>
    scoreChunk(ref, mark[i]?.transcript ?? "", mark[i]?.outcome ?? null),
  );
  const overall = scoreRun(scores);
  const attempted = scores.filter((s) => s !== null).length;

  return (
    <>
      <div className="run-scroll" ref={listRef}>
        <div className="run-head">
          <span className="nm">{run.title}</span>
          <span className="note">
            {cursor + 1}/{run.chunks.length} · {attempted} answered
            {overall !== null && ` · ${Math.round(overall * 100)}%`}
          </span>
        </div>

        {speechError && (
          <p className="note bad">
            Speech failed ({speechError}). Your device may not have a {tag} voice installed — write
            the Passage from what you can hear, or go back and add the language in system settings.
          </p>
        )}

        <div className="answer-on">
          <div className="seg">
            <button aria-pressed={answerOn === "paper"} onClick={() => setAnswerOn("paper")}>
              On paper
            </button>
            <button aria-pressed={answerOn === "typed"} onClick={() => setAnswerOn("typed")}>
              Type it
            </button>
          </div>
          <p className="note">
            {run.language === "en"
              ? "Typing English tests spelling directly, so either works."
              : "Writing Chinese by hand is the skill being practised. Typing through an input method (pinyin, Cangjie) produces the right characters without you knowing how to form them, so a typed score measures the input method, not you."}
          </p>
        </div>

        {run.chunks.map((chunk, i) => {
          const m = mark[i] ?? { transcript: "", outcome: null, revealed: false };
          const g = m.transcript.trim() ? grade(chunk, m.transcript) : null;
          const shownScore = g?.accuracy ?? outcomeScore(m.outcome);
          return (
            <article
              className={`slot${i === cursor ? " now" : ""}${m.revealed ? " done" : ""}`}
              data-slot={i}
              key={i}
              onClick={() => setCursor(i)}
            >
              <header>
                <span className="num">{i + 1}</span>
                {m.revealed ? (
                  <span
                    className={`score ${shownScore !== null && shownScore < 0.8 ? "poor" : "good"}`}
                  >
                    {pctText(shownScore)}
                  </span>
                ) : (
                  <span className="chip">{significantLength(chunk)} chars</span>
                )}
                <div className="spacer" />
                <button
                  className="mini"
                  onClick={(e) => {
                    e.stopPropagation();
                    void speak(i);
                  }}
                >
                  {speaking === i ? "■ stop" : "▶ speak"}
                </button>
              </header>

              <div className="slot-body">
                {m.revealed ? (
                  <>
                    <div className="ref">{diffHtml(chunk, m.transcript)}</div>
                    {g && (
                      <p className="note">
                        {g.missing === 0 && g.extra === 0
                          ? "exact"
                          : `${g.missing} missing${g.extra ? `, ${g.extra} extra` : ""}`}
                      </p>
                    )}
                    <div className="mark-row">
                      <span className="note">self-mark:</span>
                      {(["correct", "partial", "wrong"] as const).map((o) => (
                        <button
                          key={o}
                          className={`mark ${m.outcome === o ? "on" : ""}`}
                          onClick={() => patch(i, { outcome: m.outcome === o ? null : o })}
                        >
                          {o === "correct" ? "✓ all" : o === "partial" ? "~ some" : "✗ wrong"}
                        </button>
                      ))}
                      <button
                        className="mark"
                        onClick={() => patch(i, { transcript: "", outcome: null, revealed: false })}
                      >
                        redo
                      </button>
                    </div>
                  </>
                ) : typingAllowed ? (
                  <textarea
                    className="answer"
                    rows={1}
                    placeholder="type what you hear"
                    value={m.transcript}
                    onChange={(e) => patch(i, { transcript: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <p className="note paper">write it on paper, then show the answer</p>
                )}
              </div>

              {!m.revealed && (
                <button className="reveal" onClick={() => patch(i, { revealed: true })}>
                  show answer
                </button>
              )}
            </article>
          );
        })}
      </div>

      <div className="run-rail">
        <button className="k" onClick={() => void speak(cursor)}>
          {speaking === cursor ? "■ stop" : `▶ speak ${cursor + 1}`}
        </button>
        <button className="rail-btn" onClick={back} disabled={cursor === 0}>
          ↑
        </button>
        <button className="rail-btn" onClick={next} disabled={cursor === run.chunks.length - 1}>
          ↓
        </button>
        <button className="rail-btn go" onClick={onCancel}>
          end
        </button>
        <button
          className="rail-btn"
          disabled={attempted === 0}
          onClick={() =>
            onFinish(
              run.chunks.map((_, i) => ({
                transcript: mark[i]?.transcript ?? "",
                outcome: mark[i]?.outcome ?? null,
              })),
            )
          }
        >
          results
        </button>
      </div>
    </>
  );
}

function outcomeScore(o: Outcome | null): number | null {
  if (o === "correct") return 1;
  if (o === "partial") return 0.5;
  if (o === "wrong") return 0;
  return null;
}

function pctText(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

function diffHtml(reference: string, transcript: string): string {
  if (!transcript.trim()) return escapeHtml(reference);
  return grade(reference, transcript)
    .parts.map((p) => `<span class="tok ${p.kind}">${escapeHtml(p.char)}</span>`)
    .join("");
}
