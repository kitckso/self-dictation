// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { webSpeech } from "../tts";
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

beforeEach(() => {
  vi.clearAllMocks();
});

/** Open the popover that holds the playback settings. */
function openSettings() {
  fireEvent.click(screen.getByTitle(/repeats/i));
}

function slowDown() {
  fireEvent.click(screen.getByRole("button", { name: "Slower" }));
}

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

  it("asks the voice for the speed chosen in the popover", () => {
    render(<Run run={vocabRun()} onFinish={() => {}} />);

    openSettings();
    slowDown();
    fireEvent.click(screen.getAllByRole("button", { name: "▶ speak" })[0]!);

    expect(webSpeech.speak).toHaveBeenCalledWith("圖書館", expect.objectContaining({ rate: 0.75 }));
  });

  it("asks for the chosen speed on the first play of auto-play too", () => {
    render(<Run run={vocabRun()} onFinish={() => {}} />);

    openSettings();
    slowDown();
    fireEvent.click(screen.getByRole("button", { name: "auto" }));

    expect(webSpeech.speak).toHaveBeenCalledWith("圖書館", expect.objectContaining({ rate: 0.75 }));
  });

  it("shows a non-default speed on the rail, not only inside the popover", () => {
    render(<Run run={vocabRun()} onFinish={() => {}} />);

    expect(screen.queryByRole("button", { name: /75%/ })).toBeNull();

    openSettings();
    slowDown();

    expect(screen.getByRole("button", { name: /75%/ })).toBeTruthy();
  });
});
