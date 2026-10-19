// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Run } from "../domain/types";
import { clearRuns, deleteRun, listRuns } from "../storage/db";
import { History } from "./History";

vi.mock("../storage/db", () => ({
  listRuns: vi.fn().mockResolvedValue([]),
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
  vi.mocked(listRuns).mockResolvedValue([]);
});

describe("History", () => {
  it("says so when there is nothing to show yet", async () => {
    renderHistory();

    expect(await screen.findByText(/nothing yet/i)).toBeTruthy();
  });

  it("lists a past Run with the score it got", async () => {
    vi.mocked(listRuns).mockResolvedValue([
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
    vi.mocked(listRuns).mockResolvedValue([
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

  it("drills the material that needs practice, in the language it is written in", async () => {
    vi.mocked(listRuns).mockResolvedValue([
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
    vi.mocked(listRuns).mockResolvedValue([
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
    vi.mocked(listRuns).mockResolvedValue([makeRun()]);
    const onDrill = vi.fn();
    renderHistory({ onDrill });

    fireEvent.click(await screen.findByRole("button", { name: /Practise Lesson 1 again/ }));

    expect(onDrill).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Lesson 1", language: "zh", text: "圖書館\n醫院" }),
    );
  });

  it("forgets a single Run", async () => {
    vi.mocked(listRuns).mockResolvedValue([makeRun()]);
    renderHistory();

    fireEvent.click(await screen.findByRole("button", { name: /Forget the run of Lesson 1/ }));

    expect(deleteRun).toHaveBeenCalledWith("r1");
    expect(await screen.findByText(/nothing yet/i)).toBeTruthy();
  });

  it("forgets every Run at once", async () => {
    vi.mocked(listRuns).mockResolvedValue([makeRun()]);
    renderHistory();

    fireEvent.click(await screen.findByRole("button", { name: /Forget every run/i }));

    expect(clearRuns).toHaveBeenCalled();
    expect(await screen.findByText(/nothing yet/i)).toBeTruthy();
  });

  it("goes back to a new dictation", async () => {
    const onBack = vi.fn();
    renderHistory({ onBack });

    fireEvent.click(await screen.findByRole("button", { name: /New dictation/i }));

    expect(onBack).toHaveBeenCalled();
  });
});
