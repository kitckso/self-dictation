import { describe, expect, it } from "vitest";
import { clampDelay, clampRepeats, MAX_DELAY_SEC, MAX_REPEATS, playSequence } from "./autoplay";

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

describe("playSequence", () => {
  it("speaks every Chunk once when repeats is 1", () => {
    expect(playSequence(0, 3, 1, 2000)).toEqual([
      { index: 0, repeat: 1, waitMs: 0 },
      { index: 1, repeat: 1, waitMs: 2000 },
      { index: 2, repeat: 1, waitMs: 2000 },
    ]);
  });

  it("repeats each Chunk before moving on", () => {
    expect(playSequence(0, 2, 2, 1000)).toEqual([
      { index: 0, repeat: 1, waitMs: 0 },
      { index: 0, repeat: 2, waitMs: 1000 },
      { index: 1, repeat: 1, waitMs: 1000 },
      { index: 1, repeat: 2, waitMs: 1000 },
    ]);
  });

  it("starts from the Chunk the cursor is on", () => {
    expect(playSequence(2, 4, 1, 0).map((s) => s.index)).toEqual([2, 3]);
  });

  it("does not wait before the very first play", () => {
    expect(playSequence(1, 3, 1, 5000)[0]?.waitMs).toBe(0);
  });

  it("has nothing to play at the end of the Run", () => {
    expect(playSequence(3, 3, 2, 1000)).toEqual([]);
  });

  it("treats a zero delay as playing straight through", () => {
    expect(playSequence(0, 2, 2, 0).every((s) => s.waitMs === 0)).toBe(true);
  });
});
