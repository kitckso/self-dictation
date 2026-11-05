import { describe, expect, it } from "vitest";
import { CHUNK_CHAR_CAP, formatText, toChunks } from "./chunking";

describe("formatText", () => {
  it("trims a line and drops the space around it", () => {
    expect(formatText("  圖書館  ", "yue", "vocab")).toBe("圖書館");
  });

  it("drops blank and whitespace-only lines", () => {
    expect(formatText("one\n\n   \n\ntwo", "en", "vocab")).toBe("one\ntwo");
  });

  it("collapses runs of spaces and tabs inside a line", () => {
    expect(formatText("library    card\t\tdesk", "en", "vocab")).toBe("library card desk");
  });

  it("collapses the ideographic space Chinese text is often pasted with", () => {
    expect(formatText("圖書館\u3000\u3000醫院", "yue", "vocab")).toBe("圖書館 醫院");
  });

  it("normalises Windows and old-Mac line endings", () => {
    expect(formatText("one\r\ntwo\rthree", "en", "vocab")).toBe("one\ntwo\nthree");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(formatText("  \n\t\n ", "en", "vocab")).toBe("");
  });

  describe("Chinese", () => {
    it("drops pinyin and the English gloss from a line", () => {
      expect(formatText("圖書館 tú shū guǎn library", "yue", "vocab")).toBe("圖書館");
    });

    it("drops an annotated gloss even when it is bracketed", () => {
      expect(formatText("医院 (yī yuàn) hospital", "zh", "vocab")).toBe("医院");
      expect(formatText("医院（yī yuàn）hospital", "zh", "vocab")).toBe("医院");
    });

    it("keeps Chinese punctuation", () => {
      expect(formatText("你好，世界！", "zh", "vocab")).toBe("你好，世界！");
    });

    it("keeps ASCII sentence punctuation typed inside Chinese", () => {
      expect(formatText("你好,世界.", "zh", "vocab")).toBe("你好,世界.");
    });

    it("drops a mark left behind by a removed English gloss", () => {
      expect(formatText("圖書館 library.", "yue", "vocab")).toBe("圖書館");
    });

    it("closes the gap the removed pinyin left before punctuation", () => {
      expect(formatText("今天天气不错 tian qi bu cuo 。", "zh", "vocab")).toBe(
        "今天天气不错。",
      );
    });

    it("drops a line that held only pinyin or English", () => {
      expect(formatText("醫院\nyī yuàn\nhospital.", "yue", "vocab")).toBe("醫院");
    });

    it("leaves English alone for English", () => {
      expect(formatText("library card", "en", "vocab")).toBe("library card");
    });
  });

  describe("paragraph mode", () => {
    it("puts every chunk on its own line", () => {
      expect(formatText("今天天气不错。我打算去公园散步。", "zh", "paragraph")).toBe(
        "今天天气不错。\n我打算去公园散步。",
      );
    });

    it("keeps a line break the person typed as a chunk boundary", () => {
      expect(formatText("今天天气\n不错。", "zh", "paragraph")).toBe("今天天气\n不错。");
    });
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

    it("treats a line break as a chunk boundary", () => {
      expect(toChunks("今天天氣\n唔錯。", "paragraph")).toEqual(["今天天氣", "唔錯。"]);
    });

    it("still splits sentences inside a line", () => {
      expect(toChunks("第一句。第二句。\n第三句。", "paragraph")).toEqual([
        "第一句。",
        "第二句。",
        "第三句。",
      ]);
    });

    it("splits a long sentence at clause punctuation", () => {
      const clause = "字".repeat(CHUNK_CHAR_CAP - 1);
      const chunks = toChunks(`${clause}，${clause}`, "paragraph");
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toBe(`${clause}，`);
      expect(chunks[1]).toBe(clause);
    });

    /**
     * A Chunk is spoken on its own, so a full stop that is not a sentence end
     * would have the voice read "Mr." by itself, or "m." for "a.m.".
     */
    it("keeps a title and its name in one Chunk", () => {
      expect(toChunks("Mr. Smith went home.", "paragraph")).toEqual(["Mr. Smith went home."]);
    });

    it("keeps a decimal point inside its number", () => {
      expect(toChunks("The price is 3.5 dollars.", "paragraph")).toEqual([
        "The price is 3.5 dollars.",
      ]);
    });

    it("keeps a dotted abbreviation in one Chunk", () => {
      expect(toChunks("Dr. Chen called at 9 a.m. today.", "paragraph")).toEqual([
        "Dr. Chen called at 9 a.m. today.",
      ]);
    });

    it("still splits on a real sentence end", () => {
      expect(toChunks("One. Two. Three.", "paragraph")).toEqual(["One.", "Two.", "Three."]);
    });

    it("returns nothing for an empty passage", () => {
      expect(toChunks("\n\n", "paragraph")).toEqual([]);
    });
  });
});
