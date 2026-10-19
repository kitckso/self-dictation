// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { webSpeech } from "../tts";
import type { SpeakResult } from "../tts";
import { Run, type RunState } from "./Run";

vi.mock("../tts", () => ({
  webSpeech: { speak: vi.fn(), cancel: vi.fn() },
}));

function vocabRun(over: Partial<RunState> = {}): RunState {
  return {
    title: "Lesson 1",
    language: "zh",
    mode: "vocab",
    chunks: ["圖書館", "醫院"],
    collectionId: null,
    startedAt: 0,
    ...over,
  };
}

/**
 * Ends the play currently under way, so a test can walk auto-play forward one
 * play at a time rather than waiting on real speech.
 */
let finishPlay: (() => void) | null = null;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  finishPlay = null;
  // Speech that does not end until the test says so: "something is still
  // speaking" is a state worth being able to look at, an auto-play loop parked
  // mid-Chunk is the only way a restart shows up as a second play, and ending a
  // play by hand is what makes the pacing between plays observable.
  vi.mocked(webSpeech.speak).mockImplementation(
    () =>
      new Promise<SpeakResult>((resolve) => {
        finishPlay = () => resolve("finished");
      }),
  );
});

/** Open the popover that holds the playback settings. */
function openSettings() {
  fireEvent.click(screen.getByTitle(/repeats/i));
}

function slowDown() {
  fireEvent.click(screen.getByRole("button", { name: "Slower" }));
}

/** Let auto-play's next pause run out. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** End the play under way, then let the pause that follows it run out. */
async function nextPlay(ms: number) {
  await act(async () => {
    finishPlay?.();
    finishPlay = null;
    await Promise.resolve();
  });
  await advance(ms);
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
    fireEvent.click(screen.getByRole("button", { name: /^end$/i }));

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

  it("shrinks the rail's play button to a glyph without losing which Chunk it plays", () => {
    render(<Run run={vocabRun()} onFinish={() => {}} />);

    const play = screen.getByRole("button", { name: "Speak chunk 1" });

    expect(play.textContent).toBe("▶");
  });

  it("shows a non-default speed on the rail, not only inside the popover", () => {
    render(<Run run={vocabRun()} onFinish={() => {}} />);

    expect(screen.queryByRole("button", { name: /75%/ })).toBeNull();

    openSettings();
    slowDown();

    expect(screen.getByRole("button", { name: /75%/ })).toBeTruthy();
  });

  it("says stop whenever anything is speaking, not only the Chunk under the cursor", () => {
    render(<Run run={vocabRun()} onFinish={() => {}} />);

    // Play a Chunk that is not the cursor's: pressing the rail now stops it.
    fireEvent.click(screen.getAllByRole("button", { name: "▶ speak" })[1]!);

    expect(screen.getByRole("button", { name: "Stop" }).textContent).toBe("■");
  });

  it("names the rail arrows, which are glyphs and mean nothing aloud", () => {
    render(<Run run={vocabRun()} onFinish={() => {}} />);

    // Without a label these announce as "upwards arrow" / "downwards arrow".
    expect(screen.getByRole("button", { name: "Previous chunk" }).textContent).toBe("↑");
    expect(screen.getByRole("button", { name: "Next chunk" }).textContent).toBe("↓");
  });

  it("cannot walk past either end of the Passage", () => {
    render(<Run run={vocabRun()} onFinish={() => {}} />);

    const back = screen.getByRole("button", { name: "Previous chunk" });
    const next = screen.getByRole("button", { name: "Next chunk" });

    expect((back as HTMLButtonElement).disabled).toBe(true);
    expect((next as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(next);
    expect((next as HTMLButtonElement).disabled).toBe(true);
  });

  it("tells the answer fields apart, since every one of them looks the same", () => {
    render(<Run run={vocabRun()} onFinish={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /type it/i }));

    // A screen reader would otherwise hear N identical "type what you hear".
    expect(screen.getByLabelText("Answer for chunk 1")).toBeTruthy();
    expect(screen.getByLabelText("Answer for chunk 2")).toBeTruthy();
    expect(screen.getAllByPlaceholderText("type what you hear")).toHaveLength(2);
  });

  it.each([["More repeats"], ["Longer pause"], ["Slower"]])(
    "does not start the Chunk over when %s is tapped mid-play",
    (button) => {
      vi.useFakeTimers();
      render(<Run run={vocabRun()} onFinish={() => {}} />);
      openSettings();

      fireEvent.click(screen.getByRole("button", { name: "auto" }));
      expect(webSpeech.speak).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: button }));

      // A change never interrupts the play under way, and only a restart could
      // speak the same Chunk again — so the play count must not move.
      expect(webSpeech.speak).toHaveBeenCalledTimes(1);
    },
  );

  it("lands a Speed change on the next play and a pause change on the next Chunk", async () => {
    vi.useFakeTimers();
    render(<Run run={vocabRun()} onFinish={() => {}} />);
    openSettings();

    fireEvent.click(screen.getByRole("button", { name: "auto" }));
    expect(webSpeech.speak).toHaveBeenCalledTimes(1);

    slowDown();
    fireEvent.click(screen.getByRole("button", { name: "Longer pause" }));

    // The repeat Chunk 1 had already planned still waits the old 5s, but it is
    // spoken at the Speed just chosen: Speed is read per play.
    await nextPlay(5000);
    expect(webSpeech.speak).toHaveBeenNthCalledWith(
      2,
      "圖書館",
      expect.objectContaining({ rate: 0.75 }),
    );

    // The next Chunk starts afresh, so it pauses the new 6s rather than 5s.
    await nextPlay(5000);
    expect(webSpeech.speak).toHaveBeenCalledTimes(2);
    await advance(1000);
    expect(webSpeech.speak).toHaveBeenNthCalledWith(
      3,
      "醫院",
      expect.objectContaining({ rate: 0.75 }),
    );
  });
});
