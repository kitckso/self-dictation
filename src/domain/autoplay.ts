/**
 * Auto-play: the Run is spoken hands-free, Chunk after Chunk.
 *
 * Only the ordering lives here — no timers, no speech. The Run screen walks
 * this sequence and does the actual speaking, which keeps the part worth
 * testing free of browser APIs.
 */

export const MIN_REPEATS = 1;
export const MAX_REPEATS = 9;
export const MAX_DELAY_SEC = 60;

export interface PlayStep {
  /** Index of the Chunk to speak. */
  index: number;
  /** Which time round this is for that Chunk, 1-based. */
  repeat: number;
  /** Silence to leave before speaking, in milliseconds. */
  waitMs: number;
}

export function clampRepeats(n: number): number {
  if (!Number.isFinite(n)) return MIN_REPEATS;
  return Math.min(MAX_REPEATS, Math.max(MIN_REPEATS, Math.round(n)));
}

export function clampDelay(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_DELAY_SEC, Math.max(0, Math.round(n)));
}

/**
 * Every play of a Run, in order: each Chunk from `from` to the end, spoken
 * `repeats` times, with `delayMs` of silence between one play and the next —
 * whether that next play is a repeat or the following Chunk.
 *
 * The first play has no delay, so pressing play is never a silent pause.
 */
export function playSequence(
  from: number,
  chunkCount: number,
  repeats: number,
  delayMs: number,
): PlayStep[] {
  const times = clampRepeats(repeats);
  const wait = Math.max(0, delayMs);
  const steps: PlayStep[] = [];
  for (let index = Math.max(0, from); index < chunkCount; index++) {
    for (let repeat = 1; repeat <= times; repeat++) {
      steps.push({ index, repeat, waitMs: steps.length === 0 ? 0 : wait });
    }
  }
  return steps;
}
