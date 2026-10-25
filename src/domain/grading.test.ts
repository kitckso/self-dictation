import { describe, expect, it } from "vitest";
import { CHUNK_CHAR_CAP } from "./chunking";
import {
  grade,
  isMistake,
  MAX_GRADE_CHARS,
  scoreChunk,
  scoreRun,
  WRONG_BELOW,
  type DiffPart,
} from "./grading";

/** The parts as "chars:kind" so a diff can be asserted in one line. */
function shape(parts: DiffPart[]): string {
  return parts.map((p) => `${p.char}:${p.kind}`).join(" ");
}

function kinds(parts: DiffPart[], kind: DiffPart["kind"]): string {
  return parts
    .filter((p) => p.kind === kind)
    .map((p) => p.char)
    .join("");
}

describe("grade", () => {
  it("reports every character as a hit when the Transcript matches", () => {
    const g = grade("圖書館", "圖書館");

    expect(g.accuracy).toBe(1);
    expect(g.missing).toBe(0);
    expect(g.extra).toBe(0);
    expect(kinds(g.parts, "hit")).toBe("圖書館");
  });

  it("counts a character as one hit even when it is written twice", () => {
    // Accuracy is measured against the Reference, so a repeated character adds
    // no credit — otherwise "aabb" would beat "ab".
    const g = grade("ab", "aabb");

    expect(g.accuracy).toBe(1);
    expect(g.extra).toBe(2);
  });

  it("finds a shared run the Reference did not write in order", () => {
    // A naive left-to-right walk would match only "c"; the longest common
    // subsequence is "bc", so both count even though an "x" sits between them.
    const g = grade("abc", "bxc");

    expect(g.accuracy).toBeCloseTo(2 / 3);
    expect(kinds(g.parts, "hit")).toBe("bc");
    expect(kinds(g.parts, "extra")).toBe("x");
  });

  it("marks what was left out and what was invented", () => {
    const g = grade("圖書館", "圖校");

    expect(kinds(g.parts, "hit")).toBe("圖");
    expect(kinds(g.parts, "miss")).toBe("書館");
    expect(kinds(g.parts, "extra")).toBe("校");
    expect(g.accuracy).toBeCloseTo(1 / 3);
  });

  it("ignores punctuation and whitespace nobody types deliberately", () => {
    const g = grade("Hello, there!", "hello there");

    expect(g.accuracy).toBe(1);
    expect(kinds(g.parts, "hit")).toBe("Hellothere");
  });

  it("ignores case, and still shows the Reference's own spelling", () => {
    // The voice cannot signal capitalisation, so typing it lowercase is right.
    // The diff must still show the capital as written in the Passage.
    const g = grade("The Library", "the library");

    expect(g.accuracy).toBe(1);
    expect(g.parts.map((p) => p.char).join("")).toBe("TheLibrary");
  });

  it("ignores the punctuation Chinese dictation is full of", () => {
    const g = grade("今天天氣唔錯。", "今天天氣唔錯");

    expect(g.accuracy).toBe(1);
    expect(g.parts.some((p) => p.char === "，")).toBe(false);
  });

  it("scores nothing against nothing rather than dividing by zero", () => {
    const g = grade("", "");

    expect(g.accuracy).toBe(0);
    expect(g.parts).toEqual([]);
  });

  it("calls an empty Transcript all missing", () => {
    const g = grade("圖書館", "");

    expect(g.accuracy).toBe(0);
    expect(g.missing).toBe(3);
    expect(g.extra).toBe(0);
  });

  it("calls an empty Reference all extra, with no accuracy to divide", () => {
    const g = grade("", "abc");

    expect(g.accuracy).toBe(0);
    expect(g.extra).toBe(3);
  });

  it("counts characters, not UTF-16 units", () => {
    // An emoji outside the BMP is two code units; treating it as two characters
    // would invent a miss that cannot be written.
    const g = grade("a🙂b", "a🙂b");

    expect(g.accuracy).toBe(1);
    expect(g.parts).toHaveLength(3);
  });

  it("reports nothing matched rather than building an unbounded table", () => {
    const reference = "a".repeat(MAX_GRADE_CHARS + 1);

    // Past the cap nothing is compared, and the honest report is that every
    // Reference character is unmatched — rather than a frozen tab.
    const g = grade(reference, "a");

    expect(g.accuracy).toBe(0);
    expect(g.missing).toBe(MAX_GRADE_CHARS + 1);
    expect(g.extra).toBe(1);
  });

  it("keeps grading at the largest size a Chunk can actually reach", () => {
    const reference = "a".repeat(CHUNK_CHAR_CAP);

    const g = grade(reference, reference);

    expect(g.accuracy).toBe(1);
    expect(g.parts.every((p) => p.kind === "hit")).toBe(true);
  });
});

describe("scoreChunk", () => {
  it("uses the typed Transcript when there is one", () => {
    expect(scoreChunk("abcd", "abce", null)).toBeCloseTo(0.75);
  });

  it("prefers what was typed when there is no mark", () => {
    expect(scoreChunk("abcd", "abcd", null)).toBe(1);
  });

  it("lets a mark correct an automatic grade", () => {
    // A typed Chunk is marked only from Results, as a correction to the
    // character comparison — a rendering the grader cannot know about, or a
    // transcription that is right despite looking different. Without this,
    // an unfair figure would also become a lasting Weakness.
    expect(scoreChunk("abcd", "abce", "correct")).toBe(1);
    expect(scoreChunk("abcd", "abce", "partial")).toBe(0.5);
    expect(scoreChunk("abcd", "abce", "wrong")).toBe(0);
  });

  it("falls back to the self-mark when nothing was typed", () => {
    expect(scoreChunk("abcd", "", "correct")).toBe(1);
    expect(scoreChunk("abcd", "   ", "partial")).toBe(0.5);
    expect(scoreChunk("abcd", "", "wrong")).toBe(0);
  });

  it("has no score for a Chunk nobody attempted", () => {
    expect(scoreChunk("abcd", "", null)).toBeNull();
    expect(scoreChunk("abcd", "  ", null)).toBeNull();
  });
});

describe("isMistake", () => {
  it("counts anything answered below the line Results colours red", () => {
    expect(isMistake(0)).toBe(true);
    expect(isMistake(0.5)).toBe(true);
    expect(isMistake(WRONG_BELOW - 0.01)).toBe(true);
  });

  it("leaves a right answer out, including one exactly at the line", () => {
    expect(isMistake(WRONG_BELOW)).toBe(false);
    expect(isMistake(1)).toBe(false);
  });

  it("leaves an unattempted Chunk out, because a blank line is not a mistake", () => {
    expect(isMistake(null)).toBe(false);
  });
});

describe("scoreRun", () => {
  it("averages the Chunks that were attempted", () => {
    expect(scoreRun([1, 0, null])).toBeCloseTo(0.5);
  });

  it("ignores unattempted Chunks rather than counting them as zero", () => {
    // Two perfect Chunks and ten untouched ones is a perfect Run so far.
    expect(scoreRun([1, 1, null, null, null])).toBe(1);
  });

  it("has no score for a Run where nothing was attempted", () => {
    expect(scoreRun([null, null])).toBeNull();
    expect(scoreRun([])).toBeNull();
  });
});

describe("grade diff shape", () => {
  it("accounts for every character on both sides exactly once", () => {
    const g = grade("今天天氣唔錯", "今天天急錯");

    const hits = g.parts.filter((p) => p.kind === "hit").length;
    // Every Reference character is either a hit or a miss, and every Transcript
    // character is either a hit or an extra — so nothing is dropped on either
    // side. The parts themselves are a merge, not a concatenation, so they
    // total hits + missing + extra rather than both sides.
    expect(hits + g.missing).toBe(6);
    expect(hits + g.extra).toBe(5);
    // The counts must agree with the parts they claim to summarise.
    expect(g.missing).toBe(g.parts.filter((p) => p.kind === "miss").length);
    expect(g.extra).toBe(g.parts.filter((p) => p.kind === "extra").length);
  });

  it("keeps hits in order in both the Reference and the Transcript", () => {
    const g = grade("abcdef", "xbcdy");

    expect(kinds(g.parts, "hit")).toBe("bcd");
    // The Reference stays in order, and an invented character is shown where
    // it was written rather than ahead of the character it displaced.
    expect(shape(g.parts)).toBe("a:miss x:extra b:hit c:hit d:hit e:miss f:miss y:extra");
  });
});
