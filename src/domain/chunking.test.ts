import { describe, expect, it } from "vitest";
import { CHUNK_CHAR_CAP, formatVocabText, toChunks } from "./chunking";

describe("formatVocabText", () => {
  it("trims a line and drops the space around it", () => {
    expect(formatVocabText("  圖書館  ")).toBe("圖書館");
  });

  it("drops blank and whitespace-only lines", () => {
    expect(formatVocabText("one\n\n   \n\ntwo")).toBe("one\ntwo");
  });

  it("collapses runs of spaces and tabs inside a line", () => {
    expect(formatVocabText("library    card\t\tdesk")).toBe("library card desk");
  });

  it("collapses the ideographic space Chinese text is often pasted with", () => {
    expect(formatVocabText("圖書館\u3000\u3000醫院")).toBe("圖書館 醫院");
  });

  it("normalises Windows and old-Mac line endings", () => {
    expect(formatVocabText("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(formatVocabText("  \n\t\n ")).toBe("");
  });
});

describe("toChunks", () => {
  describe("vocabulary mode", () => {
    it("is one item per line", () => {
      expect(toChunks("圖書館\n醫院\n機場", "vocab")).toEqual(["圖書館", "醫院", "機場"]);
    });

    it("ignores surrounding space and blank lines", () => {
      expect(toChunks("  one  \n\n  two \n", "vocab")).toEqual(["one", "two"]);
    });

    it("splits Windows line endings", () => {
      expect(toChunks("one\r\ntwo", "vocab")).toEqual(["one", "two"]);
    });

    it("returns nothing for an empty box", () => {
      expect(toChunks("   \n\n", "vocab")).toEqual([]);
    });

    /**
     * A Vocabulary Item is meant to be short. One that is not — a whole
     * sentence pasted into the wrong column — still has to stay within the
     * cap, because every downstream cost is measured in Chunk length: the
     * Grading table is quadratic in it, and Results renders one node per
     * character.
     */
    it("splits an item longer than the cap", () => {
      const item = "a".repeat(CHUNK_CHAR_CAP * 2 + 5);

      const chunks = toChunks(item, "vocab");

      expect(chunks).toHaveLength(3);
      for (const chunk of chunks) {
        expect([...chunk].length).toBeLessThanOrEqual(CHUNK_CHAR_CAP);
      }
    });

    it("joins the pieces back into the item that was pasted", () => {
      const item = "圖".repeat(CHUNK_CHAR_CAP + 30);

      const chunks = toChunks(item, "vocab");

      expect(chunks.join("")).toBe(item);
    });

    it("breaks a long item on a space rather than inside a word", () => {
      const item = Array.from({ length: 40 }, () => "library").join(" ");

      const chunks = toChunks(item, "vocab");

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        // Trimmed at both ends, and made only of whole words.
        expect(chunk).toBe(chunk.trim());
        expect(chunk.split(" ")).toContain("library");
        for (const word of chunk.split(" ")) expect(word).toBe("library");
      }
      expect(chunks.join(" ")).toBe(item);
    });

    it("leaves an item at the cap exactly as it was", () => {
      const item = "a".repeat(CHUNK_CHAR_CAP);

      expect(toChunks(item, "vocab")).toEqual([item]);
    });
  });

  describe("paragraph mode", () => {
    it("splits Chinese at sentence enders, keeping the punctuation", () => {
      expect(toChunks("今天天气不错。我打算去公园散步。", "paragraph")).toEqual([
        "今天天气不错。",
        "我打算去公园散步。",
      ]);
    });

    it("splits English at sentence enders", () => {
      expect(toChunks("Hello there. How are you?", "paragraph")).toEqual([
        "Hello there.",
        "How are you?",
      ]);
    });

    it("splits a long sentence at clause punctuation", () => {
      const clause = "字".repeat(CHUNK_CHAR_CAP - 1);
      const chunks = toChunks(`${clause}，${clause}`, "paragraph");
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toBe(`${clause}，`);
      expect(chunks[1]).toBe(clause);
    });

    it("returns nothing for an empty passage", () => {
      expect(toChunks("\n\n", "paragraph")).toEqual([]);
    });
  });
});
