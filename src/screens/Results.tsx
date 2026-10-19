import { useMemo } from "react";
import { grade, scoreChunk, scoreRun, WRONG_BELOW } from "../domain/grading";
import {
  languageById,
  type ChunkResult,
  type LanguageId,
  type Mode,
  type Outcome,
} from "../domain/types";

interface Props {
  title: string;
  language: LanguageId;
  mode: Mode;
  chunks: string[];
  results: ChunkResult[];
  onMark: (index: number, outcome: Outcome | null) => void;
  onAgain: () => void;
  onSetup: () => void;
  /** Open the list of past Runs and what still needs practice. */
  onHistory: () => void;
}

const OUTCOMES: { id: Outcome; label: string }[] = [
  { id: "correct", label: "✓ all" },
  { id: "partial", label: "~ some" },
  { id: "wrong", label: "✗ wrong" },
];

/**
 * The end of a Run: every Reference appears at once, beside what was typed and
 * a self-mark for what was written on paper. The score is the mean of the two,
 * so it keeps changing while marking is still in progress.
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
  onHistory,
}: Props) {
  /**
   * Graded once per change, not once per score and once per diff.
   *
   * The diff and the score both come out of the same character walk, and every
   * mark rewrites the whole list — so computing them separately walked each Chunk
   * twice for every button press.
   */
  const graded = useMemo(
    () =>
      chunks.map((chunk, i) => {
        const r = results[i];
        const transcript = r?.transcript ?? "";
        if (!transcript.trim()) {
          // Nothing typed: the score is the self-mark, and there is no diff.
          return { typed: false, score: scoreChunk(chunk, "", r?.outcome ?? null), parts: null };
        }
        const g = grade(chunk, transcript);
        return { typed: true, score: g.accuracy, parts: g.parts };
      }),
    [chunks, results],
  );

  const overall = scoreRun(graded.map((g) => g.score));
  const marked = graded.filter((g) => g.typed || g.score !== null).length;

  return (
    <div className="pad stack res">
      <header>
        <div
          className="big"
          style={{ color: (overall ?? 0) < WRONG_BELOW ? "var(--bad)" : "var(--ok)" }}
        >
          {overall === null ? "—" : `${Math.round(overall * 100)}%`}
        </div>
        <h2 style={{ marginTop: 10 }}>Run complete</h2>
        <p className="note">
          {title} · {languageById(language).label} · {mode} · {marked}/{chunks.length} marked
        </p>
      </header>

      <div>
        {chunks.map((chunk, i) => {
          const g = graded[i] ?? { typed: false, score: null, parts: null };
          const r = results[i];
          return (
            <div className="res-item" key={i}>
              <p className="note" style={{ marginBottom: 6 }}>
                {i + 1} · {g.typed ? `${Math.round((g.score ?? 0) * 100)}% typed` : "on paper"}
              </p>
              <p className="ref">
                {g.parts
                  ? g.parts.map((part, k) => (
                      <span key={k} className={`tok ${part.kind}`}>
                        {part.char}
                      </span>
                    ))
                  : chunk}
              </p>
              {!g.typed && (
                <div className="mark-row">
                  {OUTCOMES.map((o) => (
                    <button
                      key={o.id}
                      // The mark is the answer, so its state has to be readable
                      // without seeing which button is lit.
                      aria-pressed={r?.outcome === o.id}
                      className={`mark ${r?.outcome === o.id ? "on" : ""}`}
                      onClick={() => onMark(i, r?.outcome === o.id ? null : o.id)}
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
      <button className="btn" onClick={onHistory}>
        Your progress
      </button>
      <button className="btn primary" onClick={onSetup}>
        New dictation
      </button>
    </div>
  );
}
