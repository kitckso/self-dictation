import { describe, expect, it } from "vitest";
import { chunkSteps, clampDelay, clampRepeats, MAX_DELAY_SEC, MAX_REPEATS } from "./autoplay";

describe("clampRepeats", () => {
  it("keeps a sane number of repeats", () => {
    expect(clampRepeats(3)).toBe(3);
  });

  it("never drops below one play", () => {
    expect(clampRepeats(0)).toBe(1);
    expect(clampRepeats(-4)).toBe(1);
  });

  it("caps a runaway number", () => {
    expect(clampRepeats(1000)).toBe(MAX_REPEATS);
  });

  it("falls back to one play when the field is empty or garbage", () => {
    expect(clampRepeats(Number.NaN)).toBe(1);
  });
});

describe("clampDelay", () => {
  it("accepts a pause in seconds", () => {
    expect(clampDelay(4)).toBe(4);
  });

  it("allows no pause at all", () => {
    expect(clampDelay(-1)).toBe(0);
  });

  it("caps a runaway pause", () => {
    expect(clampDelay(1000)).toBe(MAX_DELAY_SEC);
  });

  it("falls back to no pause when the field is empty or garbage", () => {
    expect(clampDelay(Number.NaN)).toBe(0);
  });
});

describe("chunkSteps", () => {
  it("speaks one Chunk the chosen number of times", () => {
    expect(chunkSteps(1, 3, 2000, false)).toEqual([
      { index: 1, repeat: 1, waitMs: 2000 },
      { index: 1, repeat: 2, waitMs: 2000 },
      { index: 1, repeat: 3, waitMs: 2000 },
    ]);
  });

  it("does not wait before the very first play of the Run", () => {
    expect(chunkSteps(0, 2, 5000, true)[0]?.waitMs).toBe(0);
    expect(chunkSteps(0, 2, 5000, false)[0]?.waitMs).toBe(5000);
  });
});
