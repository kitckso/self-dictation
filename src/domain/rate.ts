/**
 * The speed a Run is spoken at, as a share of the Voice's natural pace.
 *
 * A ladder rather than a continuous range: every rung is a speed somebody would
 * actually choose, and the label stays short enough to sit on the rail. The
 * device may clamp or ignore the figure — some voices cannot be retuned — so a
 * rung is a request, not a promise.
 */

export const RATES = [0.5, 0.75, 1, 1.25, 1.5];
export const MIN_RATE = RATES[0] ?? 1;
export const MAX_RATE = RATES[RATES.length - 1] ?? 1;
export const DEFAULT_RATE = 1;

/** The nearest rung, so a value from anywhere else has somewhere to land. */
function nearest(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_RATE;
  return RATES.reduce(
    (best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best),
    DEFAULT_RATE,
  );
}

/** Move one rung, stopping at each end rather than wrapping around. */
export function stepRate(rate: number, delta: number): number {
  const index = RATES.indexOf(nearest(rate));
  const next = Math.min(RATES.length - 1, Math.max(0, index + Math.trunc(delta)));
  return RATES[next] ?? DEFAULT_RATE;
}

/** The rung as a label: the natural pace reads as all of it. */
export function formatRate(rate: number): string {
  return `${nearest(rate) * 100}%`;
}
