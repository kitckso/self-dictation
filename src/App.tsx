import { useCallback, useEffect, useRef, useState } from "react";
import { toChunks } from "./domain/chunking";
import { chunksToPractise, hasAnswers } from "./domain/progress";
import { decodeSetup, payloadFromHash, type SharedSetup } from "./domain/share";
import type { Outcome, Run as RunRecord, SetupFill, StartInput } from "./domain/types";
import { deleteRun, getVoiceProfile, saveRun } from "./storage/db";
import { newId } from "./lib/id";
import { isSupported, onVoicesChanged, webSpeech } from "./tts";
import type { VoiceOption } from "./tts";
import { canTryVoiceCommands, commandPhrasesOf, voiceCommands } from "./voice";
import type { VoiceProfile } from "./voice/profile";
import { Setup } from "./screens/Setup";
import { Results } from "./screens/Results";
import { History } from "./screens/History";
import { Run, type RunState } from "./screens/Run";

type Screen =
  | { name: "setup" }
  | { name: "history" }
  | { name: "run"; run: RunState }
  | { name: "results"; run: RunState; record: RunRecord };

/**
 * What the URL brought with it.
 *
 * `waiting` only ever applies to a visitor who arrived with a payload, so an
 * ordinary visit still draws Setup on the first frame.
 */
type Arrival =
  | { kind: "none" }
  | { kind: "waiting" }
  | { kind: "broken" }
  | { kind: "shared"; payload: string; setup: SharedSetup };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "setup" });
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [canEnumerate, setCanEnumerate] = useState<boolean | null>(null);
  const [arrival, setArrival] = useState<Arrival>(() =>
    payloadFromHash(window.location.hash) ? { kind: "waiting" } : { kind: "none" },
  );
  /** Bumped per read, so a stale decode cannot answer for a newer link. */
  const readGen = useRef(0);
  /**
   * Latched the first time anything fails to read or write IndexedDB.
   *
   * Private browsing, a blocked upgrade in another tab, and a full store all
   * make persistence impossible. None of them should stop a dictation, but
   * swallowing them silently would mean a Run that looks saved and is not.
   */
  const [storageBroken, setStorageBroken] = useState(false);
  /**
   * Material the Setup screen starts with, other than from a Shared Link.
   *
   * A drill from the past runs, or the same Passage again, arrives here rather
   * than going straight to a Run: every Run begins at Setup, so the material
   * and the Voice are both checked before anything is spoken.
   */
  const [fill, setFill] = useState<SetupFill | null>(null);
  /**
   * Bumped whenever the material on the Setup screen changes, so the form
   * starts again from it rather than keeping the old answers.
   */
  const [setupGen, setSetupGen] = useState(0);
  /**
   * What the person calls the voice commands, if they have trained their own.
   *
   * Only the summary is read — the trained head is fetched when the
   * microphone is actually used — so opening the app does not pull in the
   * model.
   */
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);
  /**
   * Whether the words for the voice commands are known.
   *
   * Reading the profile can fail while the recognizer — which reads the store
   * itself — still uses the person's own commands. Naming the built-in words
   * in that case would describe the wrong ones, so the Run says only that the
   * words could not be read.
   */
  const [voiceWords, setVoiceWords] = useState<"pending" | "known" | "unknown">("pending");
  const commandPhrases = commandPhrasesOf(voiceProfile);

  /**
   * The same function every time, so the screens that read the store on
   * mount do not read it again on every render.
   */
  const storageFail = useCallback(() => setStorageBroken(true), []);

  /**
   * Read what the voice commands are called, so a Run can say so.
   *
   * The profile is only a hint; the recognizer reads the store itself when the
   * microphone starts. A failed read therefore has to leave the words unsaid
   * rather than claim the built-in ones are in use.
   */
  const readVoiceProfile = useCallback(() => {
    void getVoiceProfile()
      .then((profile) => {
        setVoiceProfile(profile);
        setVoiceWords("known");
      })
      .catch(() => setVoiceWords("unknown"));
  }, []);

  useEffect(readVoiceProfile, [readVoiceProfile]);

  useEffect(() => {
    if (!isSupported()) {
      setCanEnumerate(false);
      return;
    }
    function readVoices() {
      // Either promise rejecting means the same thing to the person: the device
      // cannot tell us what it has, so availability is genuinely unknown.
      void webSpeech
        .listVoices()
        .then(setVoices)
        .catch(() => setCanEnumerate(false));
      void webSpeech
        .canEnumerateVoices()
        .then(setCanEnumerate)
        .catch(() => setCanEnumerate(false));
    }
    readVoices();
    // A language pack can be installed after setup. The provider notices, and
    // this screen holds its own copy of the list, so it has to read again.
    return onVoicesChanged(readVoices);
  }, []);

  useEffect(() => {
    /**
     * A link can also arrive without a page load: pasting one into the tab you
     * are already in is a fragment change, and nothing else would notice it.
     */
    function readHash() {
      const payload = payloadFromHash(window.location.hash);
      // A fragment that is not ours is not news. Leave the screen alone.
      if (!payload) return;
      const gen = ++readGen.current;
      setArrival({ kind: "waiting" });
      void decodeSetup(payload)
        .then((setup) => {
          if (gen !== readGen.current) return;
          // A link we cannot read is worth saying out loud: silence would look
          // like an empty Setup, and the recipient would not know to ask for the
          // text instead.
          setArrival(setup ? { kind: "shared", payload, setup } : { kind: "broken" });
          // A different link is a different Setup: the form starts again from
          // it rather than keeping the old answers.
          setSetupGen((g) => g + 1);
        })
        .catch(() => {
          // `decodeSetup` is written not to throw, but a link the browser
          // cannot even hand over is still just an unreadable link.
          if (gen !== readGen.current) return;
          setArrival({ kind: "broken" });
          setSetupGen((g) => g + 1);
        });
    }

    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  /**
   * Go to Setup with some material already chosen.
   *
   * A Shared Link that has already been read is cleared, because the newest
   * thing the person asked for is the material they are being sent here with.
   */
  function goSetup(next: SetupFill | null = null) {
    setFill(next);
    setArrival((a) => (a.kind === "shared" || a.kind === "broken" ? { kind: "none" } : a));
    setSetupGen((g) => g + 1);
    setScreen({ name: "setup" });
  }

  function start(input: StartInput) {
    const chunks = toChunks(input.text, input.mode);
    if (chunks.length === 0) return;
    setScreen({
      name: "run",
      run: {
        title: input.title,
        language: input.language,
        mode: input.mode,
        chunks,
        collectionId: input.collectionId,
        startedAt: Date.now(),
      },
    });
  }

  function finish(run: RunState, transcripts: string[]) {
    const record: RunRecord = {
      id: newId(),
      collectionId: run.collectionId,
      title: run.title,
      language: run.language,
      mode: run.mode,
      chunks: run.chunks,
      results: run.chunks.map((_, i) => ({
        index: i,
        transcript: transcripts[i] ?? "",
        outcome: null,
      })),
      // Taken from the Run screen rather than from here: stamping both at the
      // end would record every Run as having taken no time at all.
      startedAt: run.startedAt,
      finishedAt: Date.now(),
    };
    // A Run that was never answered is not kept. Ending a dictation without
    // marking any of it says the record is not wanted, so the Run is saved
    // only once something in it has been answered.
    if (hasAnswers(record)) {
      void saveRun(record).catch(() => setStorageBroken(true));
    }
    setScreen({ name: "results", run, record });
  }

  /**
   * Self-marking happens after the Run, on the Results screen, so the saved
   * record is rewritten as marks are made rather than queued for the end.
   *
   * The first mark is also what saves a Run that was never answered. Taking
   * the last mark back gives the Run up again.
   */
  function mark(index: number, outcome: Outcome | null) {
    if (screen.name !== "results") return;
    const previous = screen.record;
    const record: RunRecord = {
      ...previous,
      results: previous.results.map((r, i) => (i === index ? { ...r, outcome } : r)),
    };
    setScreen({ name: "results", run: screen.run, record });
    if (hasAnswers(record)) {
      void saveRun(record).catch(() => setStorageBroken(true));
    } else if (hasAnswers(previous)) {
      // The last mark was taken back, so the Run is not wanted after all.
      void deleteRun(record.id).catch(() => setStorageBroken(true));
    }
  }

  return (
    <div className="app">
      {storageBroken && (
        <p className="note bad pad">
          This browser cannot save your work — private browsing or a full store is probably blocking
          it. The dictation itself still works, it just will not be here next time.
        </p>
      )}
      {screen.name === "setup" &&
        (arrival.kind === "waiting" ? (
          <p className="note pad">Opening the shared dictation…</p>
        ) : (
          <Setup
            // A different link or a different drill is a different Setup:
            // keying on the generation makes the form start again from it
            // rather than keep the old answers.
            key={setupGen}
            onStart={start}
            onHistory={() => setScreen({ name: "history" })}
            voices={voices}
            canEnumerate={canEnumerate}
            initial={arrival.kind === "shared" ? arrival.setup : fill}
            fromLink={arrival.kind === "shared"}
            shareBroken={arrival.kind === "broken"}
            onStorageFail={storageFail}
            onVoiceCommandsChanged={readVoiceProfile}
            voiceProfile={voiceProfile}
          />
        ))}
      {screen.name === "history" && (
        <History
          onBack={() => goSetup(null)}
          onDrill={(next) => goSetup(next)}
          onStorageFail={storageFail}
        />
      )}
      {screen.name === "run" && (
        <Run
          run={screen.run}
          onFinish={(transcripts) => finish(screen.run, transcripts)}
          commands={canTryVoiceCommands() ? voiceCommands : undefined}
          commandPhrases={commandPhrases ?? undefined}
          commandWords={voiceWords}
          autoStart
        />
      )}
      {screen.name === "results" && (
        <Results
          title={screen.record.title}
          language={screen.record.language}
          mode={screen.record.mode}
          chunks={screen.record.chunks}
          results={screen.record.results}
          onMark={mark}
          onAgain={() =>
            // A second pass is a new Run, so it gets a new start time.
            setScreen({ name: "run", run: { ...screen.run, startedAt: Date.now() } })
          }
          onDrillMistakes={() =>
            // The mistakes are a new Run of their own, like a second pass.
            // Only the Chunks that were not answered right come along; the
            // rest of the Passage has already been dealt with.
            setScreen({
              name: "run",
              run: {
                ...screen.run,
                chunks: chunksToPractise(screen.record),
                startedAt: Date.now(),
              },
            })
          }
          onSetup={() => goSetup(null)}
          onHistory={() => setScreen({ name: "history" })}
        />
      )}
    </div>
  );
}
