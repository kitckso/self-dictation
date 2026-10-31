/**
 * The words a person can say to steer a Run, and what they mean.
 *
 * Recognition lives behind `CommandListener`, so this mapping is the part
 * worth testing: a model that is guessing should not move a Run on.
 *
 * A trained head speaks in class names — `next`, `repeat` — whatever the
 * person calls those commands, so both the class names and the built-in
 * English words map to the same two things. See ADR 0002.
 *
 * A Run ends by saying the next command on the last Chunk, so there is no
 * command for ending it. The bundled model still knows the word "stop"; it is
 * simply not one of the words this app listens for.
 */

export type DictationCommand = "next" | "repeat";

/** Below this the model is guessing at a word rather than hearing one. */
export const COMMAND_CONFIDENCE = 0.75;

const NEXT_WORDS = new Set(["go", "yes", "next"]);
const REPEAT_WORDS = new Set(["no", "repeat"]);

export function commandFor(label: string, score: number): DictationCommand | null {
  if (!Number.isFinite(score) || score < COMMAND_CONFIDENCE) return null;
  const word = label.trim().toLowerCase();
  if (NEXT_WORDS.has(word)) return "next";
  if (REPEAT_WORDS.has(word)) return "repeat";
  return null;
}

/**
 * The command the model is most sure of, or null when it is not sure of one.
 *
 * The scores come back in the order of the model's labels, so the labels have
 * to be read alongside them: a trained head labels its classes rather than
 * words.
 */
export function bestCommand(
  labels: readonly string[],
  scores: Float32Array | ArrayLike<number>,
): DictationCommand | null {
  return bestLabel(labels, scores).command;
}

/**
 * What the model heard, and what it means.
 *
 * The label is kept as well as the command, because the two are not the same
 * thing: a trained head labels its classes (`next`, `repeat`) while the
 * built-in model labels English words (`go`, `no`), and a person who says "go"
 * deserves to be told that the app heard "go" rather than being shown the name
 * they gave to the next command.
 */
export function bestLabel(
  labels: readonly string[],
  scores: Float32Array | ArrayLike<number>,
): { label: string; command: DictationCommand | null } {
  let best = 0;
  for (let i = 1; i < scores.length; i += 1) {
    if ((scores[i] ?? 0) > (scores[best] ?? 0)) best = i;
  }
  const label = labels[best] ?? "";
  return { label, command: commandFor(label, scores[best] ?? 0) };
}
