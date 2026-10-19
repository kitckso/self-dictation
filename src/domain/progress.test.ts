import { describe, expect, it } from "vitest";
import { WRONG_BELOW } from "./grading";
import {
  classify,
  drillText,
  groupByLanguage,
  itemProgress,
  pickRandom,
  runText,
  summarise,
  weaknesses,
} from "./progress";
import type { ChunkResult, LanguageId, Mode, Run } from "./types";

function makeRun(over: Partial<Run> = {}): Run {
  const chunks = over.chunks ?? ["圖書館", "醫院"];
  return {
    id: "r1",
    collectionId: null,
    title: "Lesson 1",
    language: "zh",
    mode: "vocab",
    chunks,
    results: chunks.map((_, i) => ({ index: i, transcript: "", outcome: null })),
    startedAt: 1_000,
    finishedAt: 2_000,
    ...over,
  };
}

function results(...entries: (Partial<ChunkResult> & { index: number })[]): ChunkResult[] {
  return entries.map((e) => ({ transcript: "", outcome: null, ...e }));
}

describe("classify", () => {
  it("calls a graded Transcript right when it is accurate enough", () => {
    expect(classify("abcd", "abcd", null)).toBe("right");
  });

  it("calls a graded Transcript wrong when it falls short", () => {
    expect(classify("abcd", "ab", null)).toBe("wrong");
  });

  it("uses the same threshold Results turns the score red at", () => {
    const at = "a".repeat(80) + "b".repeat(20);
    const typed = "a".repeat(80);

    // Exactly at the threshold is still right, not wrong.
    expect(classify(at, typed, null)).toBe("right");
    expect(WRONG_BELOW).toBe(0.8);
  });

  it("reads a self-mark as the answer it is", () => {
    expect(classify("abcd", "", "correct")).toBe("right");
    expect(classify("abcd", "", "wrong")).toBe("wrong");
    expect(classify("abcd", "", "partial")).toBe("partial");
  });

  it("has no answer for a Chunk nobody got to", () => {
    expect(classify("abcd", "", null)).toBe("none");
    expect(classify("abcd", "   ", null)).toBe("none");
  });

  it("prefers a Transcript to a mark left over from paper", () => {
    expect(classify("abcd", "abcd", "wrong")).toBe("right");
  });
});

describe("itemProgress", () => {
  it("records nothing for a Run that answered nothing", () => {
    const progress = itemProgress([makeRun()]);

    expect(progress).toHaveLength(2);
    expect(progress.every((p) => p.answered === 0)).toBe(true);
    expect(progress.every((p) => p.lastWrong)).toBe(false);
  });

  it("counts an answer and remembers that it went wrong", () => {
    const run = makeRun({
      results: results({ index: 0, transcript: "圖書館" }, { index: 1, outcome: "wrong" }),
    });

    const progress = itemProgress([run]);

    const library = progress.find((p) => p.text === "圖書館")!;
    expect(library.answered).toBe(1);
    expect(library.correct).toBe(1);
    expect(library.partial).toBe(0);
    expect(library.wrong).toBe(0);
    expect(library.lastWrong).toBe(false);

    const hospital = progress.find((p) => p.text === "醫院")!;
    expect(hospital.answered).toBe(1);
    expect(hospital.correct).toBe(0);
    expect(hospital.partial).toBe(0);
    expect(hospital.wrong).toBe(1);
    expect(hospital.lastWrong).toBe(true);
  });

  it("carries a piece of material across Runs", () => {
    const older = makeRun({
      startedAt: 1_000,
      results: results({ index: 0, outcome: "wrong" }, { index: 1, outcome: "correct" }),
    });
    const newer = makeRun({
      id: "r2",
      startedAt: 5_000,
      results: results({ index: 0, outcome: "correct" }, { index: 1, outcome: "correct" }),
    });

    const progress = itemProgress([older, newer]);
    const library = progress.find((p) => p.text === "圖書館")!;

    expect(library.answered).toBe(2);
    expect(library.wrong).toBe(1);
    // The later answer was right, so it is no longer a Weakness.
    expect(library.lastWrong).toBe(false);
    expect(library.lastSeen).toBe(5_000);
  });

  it("keeps a piece of material a Weakness when it is only skipped afterwards", () => {
    const older = makeRun({
      startedAt: 1_000,
      results: results({ index: 0, outcome: "wrong" }, { index: 1, outcome: "correct" }),
    });
    const newer = makeRun({ id: "r2", startedAt: 5_000 });

    const progress = itemProgress([older, newer]);
    const library = progress.find((p) => p.text === "圖書館")!;

    // Not doing it says nothing about whether it can be done.
    expect(library.lastWrong).toBe(true);
    expect(library.answered).toBe(1);
  });

  it("keeps a piece of material a Weakness when the latest answer is only partial", () => {
    // A partial answer is not yet a right one: it says the material is still
    // hard, which is what a Weakness is for.
    const older = makeRun({
      startedAt: 1_000,
      results: results({ index: 0, outcome: "wrong" }, { index: 1, outcome: "correct" }),
    });
    const newer = makeRun({
      id: "r2",
      startedAt: 5_000,
      results: results({ index: 0, outcome: "partial" }, { index: 1, outcome: "correct" }),
    });

    const progress = itemProgress([older, newer]);
    const library = progress.find((p) => p.text === "圖書館")!;

    expect(library.answered).toBe(2);
    expect(library.correct).toBe(0);
    expect(library.partial).toBe(1);
    expect(library.wrong).toBe(1);
    expect(library.lastWrong).toBe(true);
  });

  it("reads the Runs oldest first however they are given", () => {
    const older = makeRun({ startedAt: 1_000, results: results({ index: 0, outcome: "wrong" }) });
    const newer = makeRun({
      id: "r2",
      startedAt: 5_000,
      results: results({ index: 0, outcome: "correct" }),
    });

    const progress = itemProgress([newer, older]);

    expect(progress[0]?.lastWrong).toBe(false);
  });

  it("keeps the same text apart in different Languages", () => {
    const cantonese = makeRun({
      language: "yue",
      chunks: ["圖書館"],
      results: results({ index: 0, outcome: "wrong" }),
    });
    const mandarin = makeRun({
      id: "r2",
      language: "zh",
      chunks: ["圖書館"],
      results: results({ index: 0, outcome: "correct" }),
    });

    const progress = itemProgress([cantonese, mandarin]);

    expect(progress).toHaveLength(2);
    expect(progress.find((p) => p.language === "yue")?.lastWrong).toBe(true);
    expect(progress.find((p) => p.language === "zh")?.lastWrong).toBe(false);
  });
});

describe("weaknesses", () => {
  it("keeps only the material whose most recent answer went wrong", () => {
    const progress = itemProgress([
      makeRun({
        results: results({ index: 0, outcome: "wrong" }, { index: 1, outcome: "correct" }),
      }),
    ]);

    const weak = weaknesses(progress);

    expect(weak).toHaveLength(1);
    expect(weak[0]?.text).toBe("圖書館");
  });

  it("puts the worst first", () => {
    const older = makeRun({
      startedAt: 1_000,
      chunks: ["a", "b"],
      results: results({ index: 0, outcome: "wrong" }, { index: 1, outcome: "wrong" }),
    });
    const newer = makeRun({
      id: "r2",
      startedAt: 5_000,
      chunks: ["a"],
      results: results({ index: 0, outcome: "wrong" }),
    });

    const weak = weaknesses(itemProgress([older, newer]));

    // "a" went wrong twice, "b" once, and both are still wrong.
    expect(weak.map((w) => w.text)).toEqual(["a", "b"]);
    expect(weak[0]?.wrong).toBe(2);
    expect(weak[1]?.wrong).toBe(1);
  });

  it("has nothing to offer when everything was answered right", () => {
    const progress = itemProgress([
      makeRun({ results: results({ index: 0, outcome: "correct" }) }),
    ]);

    expect(weaknesses(progress)).toEqual([]);
  });
});

describe("groupByLanguage", () => {
  it("keeps each Language's material together", () => {
    const runs: Run[] = [
      makeRun({ language: "yue", results: results({ index: 0, outcome: "wrong" }) }),
      makeRun({ id: "r2", language: "zh", results: results({ index: 0, outcome: "wrong" }) }),
    ];

    const groups = groupByLanguage(weaknesses(itemProgress(runs)));

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.language).sort()).toEqual(["yue", "zh"]);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
  });

  it("puts two items of one Language in the same group", () => {
    const run = makeRun({
      results: results({ index: 0, outcome: "wrong" }, { index: 1, outcome: "wrong" }),
    });

    const groups = groupByLanguage(weaknesses(itemProgress([run])));

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(2);
  });
});

describe("drillText", () => {
  it("puts each item on its own line", () => {
    const text = drillText([
      {
        text: "圖書館",
        language: "zh",
        mode: "vocab",
        answered: 1,
        correct: 0,
        partial: 0,
        wrong: 1,
        lastWrong: true,
        lastSeen: 0,
      },
      {
        text: "醫院",
        language: "zh",
        mode: "vocab",
        answered: 1,
        correct: 0,
        partial: 0,
        wrong: 1,
        lastWrong: true,
        lastSeen: 0,
      },
    ]);

    expect(text).toBe("圖書館\n醫院");
  });
});

describe("pickRandom", () => {
  it("takes the asked-for number of items without repeats", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"];

    const picked = pickRandom(items, 5);

    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
    expect(picked.every((item) => items.includes(item))).toBe(true);
  });

  it("takes everything when there is no more to take", () => {
    expect(pickRandom(["a", "b"], 5)).toHaveLength(2);
    expect(pickRandom([], 5)).toEqual([]);
  });

  it("draws from the whole list, not only its front", () => {
    // A fixed "random" of almost 1 always swaps in the last item, so the draw
    // must be able to reach past the first few.
    const items = ["a", "b", "c", "d", "e", "f", "g"];

    const picked = pickRandom(items, 5, () => 0.99);

    expect(picked).toContain("g");
  });
});

describe("summarise", () => {
  it("scores a Run from what was typed and what was marked", () => {
    const run = makeRun({
      results: results({ index: 0, transcript: "圖書館" }, { index: 1, outcome: "correct" }),
    });

    const summary = summarise(run);

    expect(summary.score).toBe(1);
    expect(summary.answered).toBe(2);
  });

  it("has no score for a Run where nothing was answered", () => {
    const summary = summarise(makeRun());

    expect(summary.score).toBeNull();
    expect(summary.answered).toBe(0);
  });

  it("counts only the Chunks that were answered", () => {
    const run = makeRun({
      results: results({ index: 0, transcript: "圖書館" }, { index: 1 }),
    });

    expect(summarise(run).answered).toBe(1);
  });
});

describe("runText", () => {
  it("puts the material back on separate lines", () => {
    const run = makeRun({ chunks: ["圖書館", "醫院"] });

    expect(runText(run)).toBe("圖書館\n醫院");
  });

  it("keeps a Passage's sentences apart", () => {
    const run = makeRun({ mode: "paragraph", chunks: ["Hello there.", "How are you?"] });

    expect(runText(run)).toBe("Hello there.\nHow are you?");
  });
});

describe("the language of a Weakness", () => {
  it("is the Language the material is written in", () => {
    const run = makeRun({ language: "yue" as LanguageId, mode: "vocab" as Mode });

    const progress = itemProgress([run]);

    expect(progress[0]?.language).toBe("yue");
    expect(progress[0]?.mode).toBe("vocab");
  });
});
