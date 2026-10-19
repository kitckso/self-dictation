import { describe, expect, it } from "vitest";
import { DEFAULT_RATE, formatRate, RATES, stepRate } from "./rate";

describe("stepRate", () => {
  it("steps down the ladder", () => {
    expect(stepRate(1, -1)).toBe(0.75);
  });

  it("steps up the ladder", () => {
    expect(stepRate(1, 1)).toBe(1.25);
  });

  it("stops at the slowest the voice manages", () => {
    expect(stepRate(0.5, -1)).toBe(0.5);
  });

  it("stops at the fastest", () => {
    expect(stepRate(1.5, 1)).toBe(1.5);
  });

  it("snaps a value that is not on the ladder before moving", () => {
    expect(stepRate(0.9, -1)).toBe(0.75);
    expect(stepRate(0.9, 1)).toBe(1.25);
  });

  it("falls back to the default speed when handed rubbish", () => {
    expect(stepRate(Number.NaN, 0)).toBe(DEFAULT_RATE);
  });

  it("walks every rung of the ladder one at a time", () => {
    const walked: number[] = [];
    let rate = RATES[0] ?? DEFAULT_RATE;
    for (let i = 0; i < RATES.length; i++) {
      walked.push(rate);
      rate = stepRate(rate, 1);
    }
    expect(walked).toEqual(RATES);
  });
});

describe("formatRate", () => {
  it("reads the natural pace as every last drop of it", () => {
    expect(formatRate(1)).toBe("100%");
  });

  it("reads a slowed voice as a share of its natural pace", () => {
    expect(formatRate(0.75)).toBe("75%");
    expect(formatRate(0.5)).toBe("50%");
  });

  it("reads a pushed voice as more than its natural pace", () => {
    expect(formatRate(1.25)).toBe("125%");
    expect(formatRate(1.5)).toBe("150%");
  });
});
