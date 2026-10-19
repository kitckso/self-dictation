import { scoreChunk, scoreRun } from "../domain/grading";
import { languageById, type LanguageId, type Mode, type Outcome } from "../domain/types";
import { diffHtml } from "../lib/diffHtml";

interface Props {
  title: string;
  language: LanguageId;
  mode: Mode;
  chunks: string[];
  results: { transcript: string; outcome: Outcome | null }[];
  onMark: (index: number, outcome: Outcome | null) => void;
  onAgain: () => void;
  onSetup: () => void;
}

const OUTCOMES: { id: Outcome; label: string }[] = [
  { id: "correct", label: "✓ all" },
  { id: "partial", label: "~ some" },
  { id: "wrong", label: "✗ wrong" },
];

/**
 * The end of a Run: every Reference appears at once, alongside what was typed
 * and a self-mark for what was written on paper. The score is the mean of the
 * two, so it keeps changing while marking is still in progress.
 */
export function Results({
  title,
  language,
  mode,
  chunks,
  results,
  onMark,
  onAgain,
  onSetup,
}: Props) {
  const scores = chunks.map((c, i) =>
    scoreChunk(c, results[i]?.transcript ?? "", results[i]?.outcome ?? null),
  );
  const overall = scoreRun(scores);
  const marked = results.filter((r) => r.transcript.trim() || r.outcome).length;

  return (
    <div className="pad stack res">
      <header>
        <div className="big" style={{ color: (overall ?? 0) < 0.8 ? "var(--bad)" : "var(--ok)" }}>
          {overall === null ? "—" : `${Math.round(overall * 100)}%`}
        </div>
        <h2 style={{ marginTop: 10 }}>Run complete</h2>
        <p className="note">
          {title} · {languageById(language).label} · {mode} · {marked}/{chunks.length} marked
        </p>
      </header>

      <div>
        {chunks.map((chunk, i) => {
          const r = results[i] ?? { transcript: "", outcome: null };
          const typed = r.transcript.trim().length > 0;
          return (
            <div className="res-item" key={i}>
              <p className="note" style={{ marginBottom: 6 }}>
                {i + 1} · {typed ? `${Math.round((scores[i] ?? 0) * 100)}% typed` : "on paper"}
              </p>
              <p className="ref">{diffHtml(chunk, r.transcript)}</p>
              {!typed && (
                <div className="mark-row">
                  {OUTCOMES.map((o) => (
                    <button
                      key={o.id}
                      className={`mark ${r.outcome === o.id ? "on" : ""}`}
                      onClick={() => onMark(i, r.outcome === o.id ? null : o.id)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
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
