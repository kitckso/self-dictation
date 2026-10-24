/**
 * The words a person can say to steer a Run, and what they mean.
 *
 * Recognition lives behind `CommandListener`, so this mapping is the part
 * worth testing: a model that is guessing should not move a Run on.
 */

export type DictationCommand = "next" | "repeat" | "stop";

/** Below this the model is guessing at a word rather than hearing one. */
export const COMMAND_CONFIDENCE = 0.75;

const NEXT_WORDS = new Set(["go", "yes"]);
const REPEAT_WORDS = new Set(["no"]);

export function commandFor(label: string, score: number): DictationCommand | null {
  if (!Number.isFinite(score) || score < COMMAND_CONFIDENCE) return null;
  const word = label.trim().toLowerCase();
  if (NEXT_WORDS.has(word)) return "next";
  if (REPEAT_WORDS.has(word)) return "repeat";
  if (word === "stop") return "stop";
  return null;
}
