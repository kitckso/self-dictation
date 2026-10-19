import { useEffect, useRef, useState } from "react";
import { toChunks } from "./domain/chunking";
import { decodeSetup, payloadFromHash, type SharedSetup } from "./domain/share";
import type { LanguageId, Mode, Outcome, Run as RunRecord } from "./domain/types";
import { saveRun } from "./storage/db";
import { newId } from "./lib/id";
import { isSupported, webSpeech } from "./tts";
import type { VoiceOption } from "./tts";
import { Setup } from "./screens/Setup";
import { Results } from "./screens/Results";
import { Run, type RunState } from "./screens/Run";

type Screen =
  | { name: "setup" }
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

  useEffect(() => {
    if (!isSupported()) {
      setCanEnumerate(false);
      return;
    }
    void webSpeech.listVoices().then(setVoices);
    void webSpeech.canEnumerateVoices().then(setCanEnumerate);
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
      void decodeSetup(payload).then((setup) => {
        if (gen !== readGen.current) return;
        // A link we cannot read is worth saying out loud: silence would look
        // like an empty Setup, and the recipient would not know to ask for the
        // text instead.
        setArrival(setup ? { kind: "shared", payload, setup } : { kind: "broken" });
      });
    }

    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  function start(input: {
    title: string;
    language: LanguageId;
    mode: Mode;
    text: string;
    collectionId: string | null;
  }) {
    const chunks = toChunks(input.text, input.mode, input.language);
    if (chunks.length === 0) return;
    setScreen({
      name: "run",
      run: {
        title: input.title,
        language: input.language,
        mode: input.mode,
        chunks,
        collectionId: input.collectionId,
      },
    });
  }

  function finish(run: RunState, transcripts: string[]) {
    const now = Date.now();
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
      startedAt: now,
      finishedAt: now,
    };
    void saveRun(record);
    setScreen({ name: "results", run, record });
  }

  /**
   * Self-marking happens after the Run, on the Results screen, so the saved
   * record is rewritten as marks are made rather than queued for the end.
   */
  function mark(index: number, outcome: Outcome | null) {
    if (screen.name !== "results") return;
    const record: RunRecord = {
      ...screen.record,
      results: screen.record.results.map((r, i) => (i === index ? { ...r, outcome } : r)),
    };
    setScreen({ name: "results", run: screen.run, record });
    void saveRun(record);
  }

  return (
    <div className="app">
      {screen.name === "setup" &&
        (arrival.kind === "waiting" ? (
          <p className="note pad">Opening the shared dictation…</p>
        ) : (
          <Setup
            // A different link is a different Setup: keying on the payload makes
            // the form start again from it rather than keep the old answers.
            key={arrival.kind === "shared" ? arrival.payload : "blank"}
            onStart={start}
            voices={voices}
            canEnumerate={canEnumerate}
            shared={arrival.kind === "shared" ? arrival.setup : null}
            shareBroken={arrival.kind === "broken"}
          />
        ))}
      {screen.name === "run" && (
        <Run run={screen.run} onFinish={(transcripts) => finish(screen.run, transcripts)} />
      )}
      {screen.name === "results" && (
        <Results
          title={screen.record.title}
          language={screen.record.language}
          mode={screen.record.mode}
          chunks={screen.record.chunks}
          results={screen.record.results}
          onMark={mark}
          onAgain={() => setScreen({ name: "run", run: screen.run })}
          onSetup={() => setScreen({ name: "setup" })}
        />
      )}
    </div>
  );
}
