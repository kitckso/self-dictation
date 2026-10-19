import { describe, expect, it } from "vitest";

/** The byte that makes a file binary. Spelled out rather than written in. */
const NUL = String.fromCharCode(0);

/**
 * The sources have to stay readable as text.
 *
 * A raw NUL byte inside a string literal made progress.ts a binary file: git
 * reported it as one, `git diff` showed nothing at all, and the whole module
 * was invisible to review. Nothing the app needs requires a byte that is not
 * text, so it is worth guarding rather than trusting.
 */
describe("the sources", () => {
  it("contain no NUL bytes", () => {
    // Read as text, which is the whole point: a file with a NUL in it comes
    // back from `?raw` as a string with the byte in it, and the file is
    // still reviewable either way.
    const sources: Record<string, string> = {
      ...import.meta.glob("./**/*.{ts,tsx,css}", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
      ...import.meta.glob("../*.md", { query: "?raw", import: "default", eager: true }),
      ...import.meta.glob("../docs/**/*.md", { query: "?raw", import: "default", eager: true }),
    };

    const offenders = Object.entries(sources)
      .filter(([, text]) => text.includes(NUL))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
    // A guard that looked at nothing would pass for ever.
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });
});
