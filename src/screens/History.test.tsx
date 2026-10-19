// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Run } from "../domain/types";
import { clearRuns, deleteRun, listAllRuns } from "../storage/db";
import { History } from "./History";

vi.mock("../storage/db", () => ({
  listAllRuns: vi.fn().mockResolvedValue([]),
  deleteRun: vi.fn().mockResolvedValue(undefined),
  clearRuns: vi.fn().mockResolvedValue(undefined),
}));

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

function renderHistory(props: Partial<Parameters<typeof History>[0]> = {}) {
  return render(
    <History onBack={() => {}} onDrill={() => {}} onStorageFail={() => {}} {...props} />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // clearAllMocks empties the calls but leaves the implementation a test set,
  // so each test has to put the empty list back or it inherits the last one.
  vi.mocked(listAllRuns).mockResolvedValue([]);
});

describe("History", () => {
  it("says so when there is nothing to show yet", async () => {
    renderHistory();

    expect(await screen.findByText(/nothing yet/i)).toBeTruthy();
  });

  it("lists a past Run with the score it got", async () => {
    vi.mocked(listAllRuns).mockResolvedValue([
      makeRun({
        results: [
          { index: 0, transcript: "圖書館", outcome: null },
          { index: 1, transcript: "醫院", outcome: null },
        ],
      }),
    ]);

    renderHistory();

    expect(await screen.findByText(/Lesson 1/)).toBeTruthy();
    expect(screen.getByText(/100% · 2\/2/)).toBeTruthy();
  });

  it("shows the material that went wrong, so it can be practised again", async () => {
    vi.mocked(listAllRuns).mockResolvedValue([
      makeRun({
        results: [
          { index: 0, transcript: "", outcome: "wrong" },
          { index: 1, transcript: "", outcome: "correct" },
        ],
      }),
    ]);

    renderHistory();

    expect(await screen.findByText("圖書館")).toBeTruthy();
    // The one that went right is not worth offering back.
    expect(screen.queryByText("醫院")).toBeNull();
  });

  it("shows how often the material went right, half-right and wrong", async () => {
    // A partial answer is still a Weakness, so its count has to be visible
    // rather than showing "0 times" beside it.
    vi.mocked(listAllRuns).mockResolvedValue([
      makeRun({
        chunks: ["圖書館", "醫院", "機場"],
        results: [
          { index: 0, transcript: "", outcome: "wrong" },
          { index: 1, transcript: "", outcome: "correct" },
          { index: 2, transcript: "", outcome: "partial" },
        ],
      }),
    ]);
    renderHistory();

    expect(await screen.findByText(/0 right · 1 wrong/)).toBeTruthy();
    expect(screen.getByText(/0 right · 0 wrong · 1 half/)).toBeTruthy();
  });

  it("offers a random draw of a long Weakness list", async () => {
    const chunks = ["一", "二", "三", "四", "五", "六", "七"];
    vi.mocked(listAllRuns).mockResolvedValue([
      makeRun({
        chunks,
        results: chunks.map((_, i) => ({ index: i, transcript: "", outcome: "wrong" })),
      }),
    ]);
    const onDrill = vi.fn();
    renderHistory({ onDrill });

    fireEvent.click(await screen.findByRole("button", { name: /Random 5/ }));

    const text = vi.mocked(onDrill).mock.calls[0]?.[0]?.text as string;
    const picked = text.split("\n");
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
    expect(picked.every((item) => chunks.includes(item))).toBe(true);
  });

  it("drills the material that needs practice, in the language it is written in", async () => {
    vi.mocked(listAllRuns).mockResolvedValue([
      makeRun({
        language: "yue",
        results: [
          { index: 0, transcript: "", outcome: "wrong" },
          { index: 1, transcript: "", outcome: "correct" },
        ],
      }),
    ]);
    const onDrill = vi.fn();
    renderHistory({ onDrill });

    fireEvent.click(await screen.findByRole("button", { name: /Drill these 1/ }));

    expect(onDrill).toHaveBeenCalledWith(
      expect.objectContaining({ language: "yue", text: "圖書館", mode: "vocab" }),
    );
  });

  it("keeps each language's material in its own drill", async () => {
    // A Run speaks one Language, so Cantonese and Mandarin cannot be drilled
    // together.
    vi.mocked(listAllRuns).mockResolvedValue([
      makeRun({
        id: "r1",
        language: "yue",
        chunks: ["圖書館"],
        results: [{ index: 0, transcript: "", outcome: "wrong" }],
      }),
      makeRun({
        id: "r2",
        language: "zh",
        chunks: ["醫院"],
        results: [{ index: 0, transcript: "", outcome: "wrong" }],
      }),
    ]);
    const onDrill = vi.fn();
    renderHistory({ onDrill });

    const drills = await screen.findAllByRole("button", { name: /Drill these 1/ });
    expect(drills).toHaveLength(2);

    fireEvent.click(drills[0]!);
    expect(onDrill).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("圖書館") }),
    );
  });

  it("offers the material of a past Run to be practised again", async () => {
    vi.mocked(listAllRuns).mockResolvedValue([makeRun()]);
    const onDrill = vi.fn();
    renderHistory({ onDrill });

    fireEvent.click(await screen.findByRole("button", { name: /Practise Lesson 1 again/ }));

    expect(onDrill).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Lesson 1", language: "zh", text: "圖書館\n醫院" }),
    );
  });

  it("forgets a single Run", async () => {
    vi.mocked(listAllRuns).mockResolvedValue([makeRun()]);
    renderHistory();

    fireEvent.click(await screen.findByRole("button", { name: /Forget the run of Lesson 1/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^forget$/i }));

    expect(deleteRun).toHaveBeenCalledWith("r1");
    expect(await screen.findByText(/nothing yet/i)).toBeTruthy();
  });

  it("asks before forgetting a single Run", async () => {
    // Forgetting a Run throws away the record of how they did, so the ✕ asks
    // first rather than taking it away on a stray click.
    vi.mocked(listAllRuns).mockResolvedValue([makeRun()]);
    renderHistory();

    fireEvent.click(await screen.findByRole("button", { name: /Forget the run of Lesson 1/ }));

    expect(screen.getByText(/forget this run/i)).toBeTruthy();
    expect(deleteRun).not.toHaveBeenCalled();
    // The ✕ has gone; focus moved to the answer rather than falling to body.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^forget$/i }));

    fireEvent.click(screen.getByRole("button", { name: /^keep$/i }));
    expect(screen.queryByText(/forget this run/i)).toBeNull();
    expect(deleteRun).not.toHaveBeenCalled();
  });

  it("forgets every Run at once", async () => {
    vi.mocked(listAllRuns).mockResolvedValue([makeRun()]);
    renderHistory();

    fireEvent.click(await screen.findByRole("button", { name: /Forget every run/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, forget every run/ }));

    expect(clearRuns).toHaveBeenCalled();
    expect(await screen.findByText(/nothing yet/i)).toBeTruthy();
  });

  it("asks before forgetting every Run", async () => {
    vi.mocked(listAllRuns).mockResolvedValue([makeRun()]);
    renderHistory();

    fireEvent.click(await screen.findByRole("button", { name: /Forget every run/i }));

    expect(screen.getByText(/Yes, forget every run/)).toBeTruthy();
    expect(clearRuns).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Keep them$/i }));
    expect(screen.queryByText(/Yes, forget every run/)).toBeNull();
    expect(clearRuns).not.toHaveBeenCalled();
  });

  it("sees every Run, not just the newest few", async () => {
    // Progress is worked out from every Run there is, so a Weakness from an
    // old Run does not quietly disappear once there are more than twenty.
    const many: Run[] = [];
    for (let i = 0; i < 25; i++) {
      many.push(
        makeRun({
          id: `r${i}`,
          startedAt: 1_000 + i,
          chunks: ["routine"],
          results: [{ index: 0, transcript: "", outcome: "correct" }],
        }),
      );
    }
    // The oldest Run of all is the one that went wrong.
    many.unshift(
      makeRun({
        id: "oldest",
        startedAt: 0,
        chunks: ["old-weakness"],
        results: [{ index: 0, transcript: "", outcome: "wrong" }],
      }),
    );
    vi.mocked(listAllRuns).mockResolvedValue(many);
    renderHistory();

    expect(await screen.findByText("old-weakness")).toBeTruthy();
  });

  it("lists the newest Runs and says how many older ones it is leaving out", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeRun({ id: `r${i}`, title: `Lesson ${i}`, startedAt: 25 - i }),
    );
    vi.mocked(listAllRuns).mockResolvedValue(many);
    renderHistory();

    expect(await screen.findByText(/5 older runs are not listed/i)).toBeTruthy();
    expect(screen.queryByText(/Lesson 24/)).toBeNull();
  });

  it("goes back to a new dictation", async () => {
    const onBack = vi.fn();
    renderHistory({ onBack });

    fireEvent.click(await screen.findByRole("button", { name: /New dictation/i }));

    expect(onBack).toHaveBeenCalled();
  });

  describe("when the store cannot be read", () => {
    it("says so rather than waiting for ever", async () => {
      vi.mocked(listAllRuns).mockRejectedValue(new Error("blocked"));
      renderHistory();

      expect(await screen.findByText(/could not be read/i)).toBeTruthy();
      // The store is unreadable, not empty; "Nothing yet" would claim otherwise.
      expect(screen.queryByText(/nothing yet/i)).toBeNull();
    });

    it("still offers a way out", async () => {
      // A blocked store will not fix itself, so a screen that only waits for
      // it leaves the person stuck until they reload.
      vi.mocked(listAllRuns).mockRejectedValue(new Error("blocked"));
      const onBack = vi.fn();
      renderHistory({ onBack });

      fireEvent.click(await screen.findByRole("button", { name: /New dictation/i }));

      expect(onBack).toHaveBeenCalled();
    });

    it("tells the app that the store is broken", async () => {
      vi.mocked(listAllRuns).mockRejectedValue(new Error("blocked"));
      const onStorageFail = vi.fn();
      renderHistory({ onStorageFail });

      await screen.findByText(/could not be read/i);

      expect(onStorageFail).toHaveBeenCalled();
    });
  });
});
