/**
 * Auto-play: the Run is spoken hands-free, Chunk after Chunk.
 *
 * Only the ordering lives here — no timers, no speech. The Run screen walks
 * these steps and does the actual speaking, which keeps the part worth testing
 * free of browser APIs.
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
 * The plays for a single Chunk: `repeats` of it, each preceded by `delayMs` of
 * silence. `firstPlay` is true only for the first play of the Run, which never
 * waits — pressing play should not be a silent pause.
 *
 * Auto-play plans a Run one Chunk at a time through this. That is what lets a
 * change to repeats or pause take effect on the next Chunk instead of
 * restarting the one already under way.
 */
export function chunkSteps(
  index: number,
  repeats: number,
  delayMs: number,
  firstPlay: boolean,
): PlayStep[] {
  const times = clampRepeats(repeats);
  const wait = Math.max(0, delayMs);
  const steps: PlayStep[] = [];
  for (let repeat = 1; repeat <= times; repeat++) {
    steps.push({ index, repeat, waitMs: firstPlay && repeat === 1 ? 0 : wait });
  }
  return steps;
}
