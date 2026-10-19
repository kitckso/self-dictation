import { stripInsignificant } from "./chunking";
import { OUTCOME_WEIGHT, type Outcome } from "./types";

export type DiffKind = "hit" | "miss" | "extra";

export interface DiffPart {
  char: string;
  kind: DiffKind;
}

export interface Grade {
  parts: DiffPart[];
  /** matched reference characters / total reference characters */
  accuracy: number;
  missing: number;
  extra: number;
}

/**
 * Character-level comparison of a Transcript against a Reference.
 *
 * Only meaningful when the person actually typed an answer — see Outcome for
 * the paper path. Punctuation, whitespace and (for Latin script) case are
 * ignored: nobody types full-width punctuation deliberately, and it would make
 * the score feel broken.
 */
export function grade(reference: string, transcript: string): Grade {
  const a = [...stripInsignificant(reference)];
  const b = [...stripInsignificant(transcript)];
  const n = a.length;
  const m = b.length;

  // Longest common subsequence, walked backwards.
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? (dp[i + 1][j + 1] ?? 0) + 1
          : Math.max(dp[i + 1][j] ?? 0, dp[i][j + 1] ?? 0);
    }
  }

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  let hits = 0;
  while (i < n) {
    if (j < m && a[i] === b[j]) {
      parts.push({ char: a[i] ?? "", kind: "hit" });
      hits++;
      i++;
      j++;
    } else if (j < m && (dp[i]?.[j + 1] ?? 0) >= (dp[i + 1]?.[j] ?? 0)) {
      parts.push({ char: b[j] ?? "", kind: "extra" });
      j++;
    } else {
      parts.push({ char: a[i] ?? "", kind: "miss" });
      i++;
    }
  }
  while (j < m) {
    parts.push({ char: b[j] ?? "", kind: "extra" });
    j++;
  }

  return {
    parts,
    accuracy: n === 0 ? 0 : hits / n,
    missing: parts.filter((p) => p.kind === "miss").length,
    extra: parts.filter((p) => p.kind === "extra").length,
  };
}

/**
 * The score for one Chunk: an automatic figure when the person typed a
 * Transcript, a self-marked weight when they wrote on paper, or null when the
 * Chunk has not been attempted yet.
 */
export function scoreChunk(
  reference: string,
  transcript: string,
  outcome: Outcome | null,
): number | null {
  if (transcript.trim()) return grade(reference, transcript).accuracy;
  if (outcome) return OUTCOME_WEIGHT[outcome];
  return null;
}

/** Mean of the attempted Chunks, or null if nothing has been attempted. */
export function scoreRun(scores: (number | null)[]): number | null {
  const attempted = scores.filter((s): s is number => s !== null);
  if (attempted.length === 0) return null;
  return attempted.reduce((a, b) => a + b, 0) / attempted.length;
}
