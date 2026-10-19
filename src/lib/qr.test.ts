import { describe, expect, it } from "vitest";
import { qrCode, qrPath } from "./qr";

const LINK = `https://self-dictation.netlify.app/#d=1z${"A".repeat(60)}`;

/** Where the three finder patterns sit, as (row, col) of their top-left corner. */
function finders(count: number): [number, number][] {
  return [
    [0, 0],
    [0, count - 7],
    [count - 7, 0],
  ];
}

describe("qrCode", () => {
  it("comes out at a size the QR standard allows", () => {
    const { count } = qrCode(LINK);
    expect(count).toBeGreaterThanOrEqual(21);
    expect((count - 21) % 4).toBe(0);
  });

  it("carries the three finder patterns a camera looks for", () => {
    const { count, isDark } = qrCode(LINK);

    for (const [top, left] of finders(count)) {
      // A dark ring around a light ring around a dark core.
      for (let i = 0; i < 7; i++) {
        expect(isDark(top, left + i)).toBe(true);
        expect(isDark(top + 6, left + i)).toBe(true);
        expect(isDark(top + i, left)).toBe(true);
        expect(isDark(top + i, left + 6)).toBe(true);
      }
      for (let r = 1; r <= 5; r++) {
        expect(isDark(top + r, left + 1)).toBe(false);
        expect(isDark(top + r, left + 5)).toBe(false);
      }
      for (let r = 2; r <= 4; r++) {
        for (let c = 2; c <= 4; c++) expect(isDark(top + r, left + c)).toBe(true);
      }
    }
  });

  it("grows when the link does", () => {
    expect(qrCode(`${LINK}${"A".repeat(900)}`).count).toBeGreaterThan(qrCode(LINK).count);
  });
});

describe("qrPath", () => {
  it("leaves a quiet zone around the code", () => {
    const code = qrCode(LINK);
    expect(qrPath(code).size).toBe(code.count + 8);
  });

  it("draws exactly the dark modules, offset by the quiet zone", () => {
    const code = qrCode(LINK);
    const { d } = qrPath(code, 4);

    const drawn = [...d.matchAll(/M(\d+) (\d+)/g)].map((m) => `${m[1]},${m[2]}`).sort();
    const expected: string[] = [];
    for (let row = 0; row < code.count; row++) {
      for (let col = 0; col < code.count; col++) {
        if (code.isDark(row, col)) expected.push(`${col + 4},${row + 4}`);
      }
    }
    expect(drawn).toEqual(expected.sort());
  });
});
