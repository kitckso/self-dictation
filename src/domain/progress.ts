import { grade, scoreChunk, scoreRun, WRONG_BELOW } from "./grading";
import type { LanguageId, Mode, Outcome, Run } from "./types";

/**
 * What is known about how a person has done on a piece of material, across
 * every Run so far.
 *
 * A Weakness is a property of the material rather than of a Run, so it outlives
 * the Run that revealed it. That is what makes it worth coming back to.
 */

/** How one Chunk was answered. */
export type Answer = "right" | "wrong" | "partial" | "none";

/** One piece of material, and how it has gone. */
export interface ItemProgress {
  /** The Reference for the material. */
  text: string;
  language: LanguageId;
  mode: Mode;
  /** How many times it has been answered. */
  answered: number;
  /** How many of those went wrong. */
  wrong: number;
  /**
   * Whether the most recent answer went wrong.
   *
   * Only a correct answer clears this. A partial one is half a right answer,
   * and skipping says nothing at all: either way the material is still hard.
   */
  lastWrong: boolean;
  /** When it was last practised. */
  lastSeen: number;
}

/** The material that went wrong, grouped by the Language it is written in. */
export interface WeaknessGroup {
  language: LanguageId;
  items: ItemProgress[];
}

/** How a Run went, without having to work it out again on screen. */
export interface RunSummary {
  run: Run;
  /** The mean score over the Chunks that were answered, or null if none was. */
  score: number | null;
  /** How many Chunks were answered. */
  answered: number;
}

/**
 * Material is identified by its Language and its text.
 *
 * The Language is part of the identity because the same characters mean
 * different things in Cantonese and Mandarin, and a Weakness in one is not a
 * Weakness in the other.
 *
 * The key is written as JSON rather than joined with a separator, so that no
 * choice of separator can be got wrong. A raw NUL byte would have done the
 * same job, but it made this file unreadable to git and to every tool that
 * assumes text.
 */
function keyOf(language: LanguageId, text: string): string {
  return JSON.stringify([language, text]);
}

/**
 * How one Chunk was answered.
 *
 * A Transcript is graded; a Paper Answer is marked by the person. Both end up
 * as the same kind of answer, which is what lets a Weakness be worked out
 * across Runs made in either mode.
 */
export function classify(reference: string, transcript: string, outcome: Outcome | null): Answer {
  if (transcript.trim()) {
    return grade(reference, transcript).accuracy >= WRONG_BELOW ? "right" : "wrong";
  }
  if (outcome === "correct") return "right";
  if (outcome === "wrong") return "wrong";
  if (outcome === "partial") return "partial";
  return "none";
}

/**
 * What every piece of material that has been practised has amounted to.
 *
 * The Runs are read oldest first, so the most recent answer is the one left at
 * the end of each record.
 */
export function itemProgress(runs: Run[]): ItemProgress[] {
  const byKey = new Map<string, ItemProgress>();

  for (const run of [...runs].sort((a, b) => a.startedAt - b.startedAt)) {
    for (let i = 0; i < run.chunks.length; i++) {
      const text = run.chunks[i];
      if (text === undefined) continue;

      const result = run.results[i];
      const answer = classify(text, result?.transcript ?? "", result?.outcome ?? null);
      const key = keyOf(run.language, text);

      const seen =
        byKey.get(key) ??
        ({
          text,
          language: run.language,
          mode: run.mode,
          answered: 0,
          wrong: 0,
          lastWrong: false,
          lastSeen: run.startedAt,
        } satisfies ItemProgress);

      if (answer !== "none") {
        seen.answered++;
        if (answer === "wrong") seen.wrong++;
        // Only a correct answer clears a Weakness. A partial one is half a
        // right answer: it says the material is still hard, which is what a
        // Weakness is for. Skipping leaves it exactly as it was.
        seen.lastWrong = answer !== "right";
      }
      seen.lastSeen = Math.max(seen.lastSeen, run.startedAt);

      byKey.set(key, seen);
    }
  }

  return [...byKey.values()];
}

/**
 * The material worth practising again: the ones whose most recent answer went
 * wrong, worst first.
 */
export function weaknesses(progress: ItemProgress[]): ItemProgress[] {
  return progress
    .filter((p) => p.lastWrong)
    .sort((a, b) => b.wrong - a.wrong || b.lastSeen - a.lastSeen);
}

/**
 * Weaknesses grouped by Language.
 *
 * A Run speaks one Language, so material in two Languages cannot be drilled in
 * the same Run and has to be offered separately.
 */
export function groupByLanguage(items: ItemProgress[]): WeaknessGroup[] {
  const groups = new Map<LanguageId, ItemProgress[]>();
  for (const item of items) {
    const list = groups.get(item.language) ?? [];
    list.push(item);
    groups.set(item.language, list);
  }
  return [...groups].map(([language, items]) => ({ language, items }));
}

/**
 * The material for a Run made of the given items, one per line.
 *
 * A Run speaks one Language, so the caller is expected to pass items that all
 * share one.
 */
export function drillText(items: ItemProgress[]): string {
  return items.map((i) => i.text).join("\n");
}

/** How a Run went. */
export function summarise(run: Run): RunSummary {
  const scores = run.chunks.map((chunk, i) =>
    scoreChunk(chunk, run.results[i]?.transcript ?? "", run.results[i]?.outcome ?? null),
  );
  return {
    run,
    score: scoreRun(scores),
    answered: scores.filter((s) => s !== null).length,
  };
}

/**
 * The material of a Run, as text that would be dictated the same way again.
 *
 * The Chunks are joined with newlines, which is what puts a Vocabulary Item
 * back on its own line and keeps a Passage's sentences apart.
 */
export function runText(run: Run): string {
  return run.chunks.join("\n");
}
