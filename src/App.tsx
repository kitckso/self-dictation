import { useEffect, useState } from "react";
import { toChunks } from "./domain/chunking";
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

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "setup" });
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [canEnumerate, setCanEnumerate] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isSupported()) {
      setCanEnumerate(false);
      return;
    }
    void webSpeech.listVoices().then(setVoices);
    void webSpeech.canEnumerateVoices().then(setCanEnumerate);
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
      {screen.name === "setup" && (
        <Setup onStart={start} voices={voices} canEnumerate={canEnumerate} />
      )}
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
