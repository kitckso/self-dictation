import { scoreChunk, scoreRun } from "../domain/grading";
import { languageById, type LanguageId, type Mode, type Outcome } from "../domain/types";

interface Props {
  title: string;
  language: LanguageId;
  mode: Mode;
  chunks: string[];
  results: { transcript: string; outcome: Outcome | null }[];
  onAgain: () => void;
  onSetup: () => void;
}

export function Results({ title, language, mode, chunks, results, onAgain, onSetup }: Props) {
  const scores = chunks.map((c, i) =>
    scoreChunk(c, results[i]?.transcript ?? "", results[i]?.outcome ?? null),
  );
  const overall = scoreRun(scores);
  const typed = results.filter((r) => r.transcript.trim()).length;

  return (
    <div className="pad stack res">
      <header>
        <div className="big" style={{ color: (overall ?? 0) < 0.8 ? "var(--bad)" : "var(--ok)" }}>
          {overall === null ? "—" : `${Math.round(overall * 100)}%`}
        </div>
        <h2 style={{ marginTop: 10 }}>Run complete</h2>
        <p className="note">
          {title} · {languageById(language).label} · {mode}
          {typed > 0 && ` · ${typed}/${chunks.length} typed, rest self-marked`}
        </p>
      </header>

      <div>
        {chunks.map((chunk, i) => {
          const r = results[i];
          const s = scores[i];
          if (s === null) return null;
          return (
            <div className="res-item" key={i}>
              <p className="note" style={{ marginBottom: 6 }}>
                {i + 1} ·{" "}
                {r?.transcript.trim()
                  ? `${Math.round(s * 100)}% typed`
                  : (r?.outcome ?? "unmarked")}
              </p>
              <p className="ref">{chunk}</p>
            </div>
          );
        })}
      </div>

      <button className="btn" onClick={onAgain}>
        Run it again
      </button>
      <button className="btn primary" onClick={onSetup}>
        New dictation
      </button>
    </div>
  );
}
