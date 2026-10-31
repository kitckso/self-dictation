/**
 * The two things a Run can be told to do.
 *
 * These are also the classes the model is trained on, and they never change:
 * the words a person types are only labels (see ADR 0002), so a head trained
 * for "下一個" is the same head as one trained for "go".
 */
export type VoiceCommandKey = "next" | "repeat";

/**
 * The commands, in the order they are offered.
 *
 * The order is alphabetical, which is what puts the head's columns in the
 * order the transfer library expects.
 */
export const COMMAND_KEYS: readonly VoiceCommandKey[] = ["next", "repeat"];

/**
 * The class the room is recorded under.
 *
 * It is the model's own name for silence, and it is what the head learns
 * "nothing was said" from.
 */
export const NOISE_LABEL = "_background_noise_";

/**
 * The classes the trained head scores, in the order its columns are in.
 *
 * The transfer library sorts a dataset's vocabulary alphabetically, and `_`
 * sorts before a letter, so the room comes first and the commands follow in
 * the order they are named in `COMMAND_KEYS`.
 */
export const MODEL_CLASSES = [NOISE_LABEL, ...COMMAND_KEYS] as const;

/** Anything that can be recorded: a command, or the room. */
export type RecordingTarget = VoiceCommandKey | typeof NOISE_LABEL;

/** The name a person calls each command. Display only. */
export interface VoicePhrases {
  next: string;
  repeat: string;
}

/** How many samples were recorded for each command. */
export type VoiceCounts = Record<VoiceCommandKey, number>;

/**
 * Everything the app keeps about a person's own commands.
 *
 * One profile serves every language: a person who dictates Cantonese and
 * English does not want two sets of words to learn.
 */
export interface VoiceProfile {
  id: string;
  phrases: VoicePhrases;
  counts: VoiceCounts;
  /** How many samples of the room the head was trained from. */
  noise?: number;
  /** Whether the Run should use the custom head at all. */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  /** When the head behind it was trained. */
  trainedAt: number;
}

/** The minimum for a head to be worth training. */
export const MIN_SAMPLES = 4;
/** The minimum for the room to be heard as silence rather than as a command. */
export const MIN_NOISE_SAMPLES = 3;
/** More than the minimum gives a steadier head. */
export const RECOMMENDED_SAMPLES = 6;
export const RECOMMENDED_NOISE_SAMPLES = 4;
/** How many times the head is trained over the samples. */
export const TRAIN_EPOCHS = 20;

/**
 * The names to start from.
 *
 * The model's own words for the two things: "next" and "repeat". They are
 * English because they are the class names the head is trained on, and they
 * are only a starting point — the person is expected to type whatever they
 * actually say.
 */
export function defaultPhrases(): VoicePhrases {
  return { next: "next", repeat: "repeat" };
}

/** No samples of anything yet. */
export function emptyCounts(): VoiceCounts {
  return { next: 0, repeat: 0 };
}

/**
 * What is wrong with a set of names, or null when they are fine.
 *
 * One word cannot mean two things: a head trained on "go" for both next and
 * repeat could never tell them apart.
 */
export function phraseProblem(phrases: VoicePhrases): string | null {
  const trimmed = COMMAND_KEYS.map((key) => phrases[key].trim());
  if (trimmed.some((name) => name === "")) {
    return "Give every command a name.";
  }
  const lower = trimmed.map((name) => name.toLowerCase());
  if (new Set(lower).size !== lower.length) {
    return "Each command needs a different name.";
  }
  return null;
}

/** Which commands still need samples, and how many each is short by. */
export function shortSamples(counts: VoiceCounts): { key: VoiceCommandKey; missing: number }[] {
  return COMMAND_KEYS.flatMap((key) => {
    const missing = Math.max(0, MIN_SAMPLES - (counts[key] ?? 0));
    return missing > 0 ? [{ key, missing }] : [];
  });
}

/** Whether there is enough recorded to train a head. */
export function readyToTrain(counts: VoiceCounts, noise: number): boolean {
  return shortSamples(counts).length === 0 && noise >= MIN_NOISE_SAMPLES;
}

/**
 * How many samples there are altogether.
 *
 * The room's noise is counted too: it was recorded, and it was part of what
 * the head was trained from.
 */
export function totalSamples(counts: VoiceCounts, noise: number): number {
  return COMMAND_KEYS.reduce((sum, key) => sum + (counts[key] ?? 0), 0) + noise;
}

/**
 * What to record next when the recording carries on by itself.
 *
 * The commands are taken in turn — the one with the fewest samples first — so
 * that the person says each word once before saying it again, rather than
 * one word over and over. The room is recorded last of all. Nothing is
 * returned once everything has been recorded as often as it should be, so a
 * chain of recordings knows when to stop.
 */
export function nextToRecord(
  counts: VoiceCounts,
  noise: number,
  preferred?: RecordingTarget,
): RecordingTarget | null {
  if (preferred === NOISE_LABEL) {
    if (noise < RECOMMENDED_NOISE_SAMPLES) return NOISE_LABEL;
  } else if (preferred && (counts[preferred] ?? 0) < RECOMMENDED_SAMPLES) {
    return preferred;
  }
  const fewest = Math.min(...COMMAND_KEYS.map((key) => counts[key] ?? 0));
  if (fewest < RECOMMENDED_SAMPLES) {
    const key = COMMAND_KEYS.find((name) => (counts[name] ?? 0) === fewest);
    if (key) return key;
  }
  if (noise < RECOMMENDED_NOISE_SAMPLES) return NOISE_LABEL;
  return null;
}

/**
 * The names a Run should use, or null when the built-in English ones should.
 *
 * A missing profile and a switched-off profile are the same thing to a Run:
 * neither has anything to say beyond "go" and "no".
 */
export function commandPhrasesOf(profile: VoiceProfile | null): VoicePhrases | null {
  if (!profile || !profile.enabled) return null;
  return profile.phrases;
}
