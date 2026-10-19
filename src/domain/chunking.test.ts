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
      expect(toChunks("圖書館\n醫院\n機場", "vocab", "yue")).toEqual(["圖書館", "醫院", "機場"]);
    });

    it("ignores surrounding space and blank lines", () => {
      expect(toChunks("  one  \n\n  two \n", "vocab", "en")).toEqual(["one", "two"]);
    });

    it("splits Windows line endings", () => {
      expect(toChunks("one\r\ntwo", "vocab", "en")).toEqual(["one", "two"]);
    });

    it("returns nothing for an empty box", () => {
      expect(toChunks("   \n\n", "vocab", "en")).toEqual([]);
    });
  });

  describe("paragraph mode", () => {
    it("splits Chinese at sentence enders, keeping the punctuation", () => {
      expect(toChunks("今天天气不错。我打算去公园散步。", "paragraph", "zh")).toEqual([
        "今天天气不错。",
        "我打算去公园散步。",
      ]);
    });

    it("splits English at sentence enders", () => {
      expect(toChunks("Hello there. How are you?", "paragraph", "en")).toEqual([
        "Hello there.",
        "How are you?",
      ]);
    });

    it("splits a long sentence at clause punctuation", () => {
      const clause = "字".repeat(CHUNK_CHAR_CAP - 1);
      const chunks = toChunks(`${clause}，${clause}`, "paragraph", "zh");
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toBe(`${clause}，`);
      expect(chunks[1]).toBe(clause);
    });

    it("returns nothing for an empty passage", () => {
      expect(toChunks("\n\n", "paragraph", "en")).toEqual([]);
    });
  });
});
