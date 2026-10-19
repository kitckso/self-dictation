// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Run, type RunState } from "./Run";

vi.mock("../tts", () => ({
  webSpeech: { speak: vi.fn().mockResolvedValue(undefined), cancel: vi.fn() },
}));

function vocabRun(over: Partial<RunState> = {}): RunState {
  return {
    title: "Lesson 1",
    language: "zh",
    mode: "vocab",
    chunks: ["圖書館", "醫院"],
    collectionId: null,
    ...over,
  };
}

afterEach(cleanup);

// jsdom has no layout, so element scrolling is a no-op rather than an error.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("Run", () => {
  it("reveals nothing, and hands over the Transcripts when it ends", () => {
    const onFinish = vi.fn();
    render(<Run run={vocabRun()} onFinish={onFinish} />);

    expect(screen.queryAllByRole("button", { name: /show answer/i })).toEqual([]);
    expect(screen.queryByText("圖書館")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /type it/i }));
    fireEvent.change(screen.getAllByPlaceholderText("type what you hear")[0], {
      target: { value: "圖書館" },
    });
    fireEvent.click(screen.getByRole("button", { name: /results/i }));

    expect(onFinish).toHaveBeenCalledWith(["圖書館", ""]);
  });
});
