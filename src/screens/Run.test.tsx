// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { webSpeech } from "../tts";
import type { SpeakResult } from "../tts";
import type { DictationCommand } from "../voice/commands";
import { HeadMismatchError, UnavailableCommandError } from "../voice/errors";
import { Run, type RunState } from "./Run";

vi.mock("../tts", () => ({
  webSpeech: { speak: vi.fn(), cancel: vi.fn() },
  isAndroidLike: () => false,
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
 * A stand-in for the microphone. `hear` is the person saying something; the
 * listener is replaced every time listening restarts, so only the latest one
 * counts.
 */
function voiceCommands() {
  let handler: ((command: DictationCommand) => void) | null = null;
  return {
    start: vi.fn((onCommand: (command: DictationCommand) => void) => {
      handler = onCommand;
      return Promise.resolve();
    }),
    stop: vi.fn(() => {
      handler = null;
      return Promise.resolve();
    }),
    hear: async (command: DictationCommand) => {
      await act(async () => {
        handler?.(command);
      });
    },
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

/**
 * Let the microphone-release chain settle before checking that speech began.
 * Play now waits for `stop()` so the speaker cannot start while capture is
 * still winding down; that is one more promise than the old synchronous path.
 */
async function releaseMicrophone() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
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

  it("says so when the browser refuses to speak", async () => {
    vi.mocked(webSpeech.speak).mockResolvedValue("failed");
    render(<Run run={vocabRun()} onFinish={() => {}} />);

    fireEvent.click(screen.getAllByRole("button", { name: "▶ speak" })[0]!);

    expect(await screen.findByText(/speech failed.*refused to speak/i)).toBeTruthy();
  });

  it("says so when the voice stops half-way", async () => {
    vi.mocked(webSpeech.speak).mockResolvedValue("cut-off");
    render(<Run run={vocabRun()} onFinish={() => {}} />);

    fireEvent.click(screen.getAllByRole("button", { name: "▶ speak" })[0]!);

    expect(await screen.findByText(/speech failed.*stopped before it finished/i)).toBeTruthy();
  });

  it("stops auto-play rather than walking through the Passage in silence", async () => {
    vi.mocked(webSpeech.speak).mockResolvedValue("failed");
    render(<Run run={vocabRun()} onFinish={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "auto" }));

    expect(await screen.findByText(/refused to speak/i)).toBeTruthy();
    // The loop stopped at the first Chunk instead of racing to the end.
    expect(webSpeech.speak).toHaveBeenCalledTimes(1);
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

  it("does not open the microphone behind the first play", async () => {
    vi.useFakeTimers();
    const commands = voiceCommands();
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} autoStart />);
    await releaseMicrophone();

    expect(webSpeech.speak).toHaveBeenCalledTimes(1);
    expect(commands.start).not.toHaveBeenCalled();

    await act(async () => {
      finishPlay?.();
      finishPlay = null;
      await Promise.resolve();
    });

    // Only after the Voice is quiet may the listener take the microphone.
    expect(commands.start).toHaveBeenCalledTimes(1);
  });

  it("waits for the microphone to be released before it speaks", async () => {
    vi.useFakeTimers();
    let releaseStop!: () => void;
    const stop = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const commands = {
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => stop),
    };
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} autoStart />);

    expect(webSpeech.speak).not.toHaveBeenCalled();

    await act(async () => {
      releaseStop();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(webSpeech.speak).toHaveBeenCalledWith("圖書館", expect.anything());
  });

  it("plays the first Chunk once when the Run opens, without turning on auto-play", async () => {
    vi.useFakeTimers();
    render(<Run run={vocabRun()} onFinish={() => {}} autoStart />);

    expect(webSpeech.speak).toHaveBeenCalledTimes(1);
    expect(webSpeech.speak).toHaveBeenCalledWith("圖書館", expect.anything());
    expect(screen.getByRole("button", { name: "auto" }).getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      finishPlay?.();
      finishPlay = null;
      await Promise.resolve();
    });
    await advance(10_000);

    // One play, then it waits: auto-play was not switched on.
    expect(webSpeech.speak).toHaveBeenCalledTimes(1);
  });

  it("plays the next Chunk once when go arrives, without turning on auto-play", async () => {
    vi.useFakeTimers();
    const commands = voiceCommands();
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} autoStart />);
    await releaseMicrophone();

    expect(webSpeech.speak).toHaveBeenNthCalledWith(1, "圖書館", expect.anything());

    await act(async () => {
      finishPlay?.();
      finishPlay = null;
      await Promise.resolve();
    });

    await commands.hear("next");

    expect(screen.getByText("2/2")).toBeTruthy();
    expect(webSpeech.speak).toHaveBeenNthCalledWith(2, "醫院", expect.anything());
    expect(screen.getByRole("button", { name: "auto" }).getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      finishPlay?.();
      finishPlay = null;
      await Promise.resolve();
    });
    await advance(10_000);

    // The spoken "go" did not leave auto-play running afterwards.
    expect(webSpeech.speak).toHaveBeenCalledTimes(2);
  });

  it("keeps auto-play on when go arrives during an auto-play pause", async () => {
    vi.useFakeTimers();
    const commands = voiceCommands();
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} />);

    fireEvent.click(screen.getByRole("button", { name: "auto" }));
    await releaseMicrophone();
    expect(webSpeech.speak).toHaveBeenNthCalledWith(1, "圖書館", expect.anything());

    await act(async () => {
      finishPlay?.();
      finishPlay = null;
      await Promise.resolve();
    });

    await commands.hear("next");

    expect(screen.getByText("2/2")).toBeTruthy();
    expect(webSpeech.speak).toHaveBeenNthCalledWith(2, "醫院", expect.anything());
    expect(screen.getByRole("button", { name: "auto" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("plays the current Chunk once when no is heard, without turning on auto-play", async () => {
    vi.useFakeTimers();
    const commands = voiceCommands();
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} autoStart />);
    await releaseMicrophone();

    expect(webSpeech.speak).toHaveBeenNthCalledWith(1, "圖書館", expect.anything());

    await act(async () => {
      finishPlay?.();
      finishPlay = null;
      await Promise.resolve();
    });

    await commands.hear("repeat");

    expect(screen.getByText("1/2")).toBeTruthy();
    expect(webSpeech.speak).toHaveBeenNthCalledWith(2, "圖書館", expect.anything());
    expect(screen.getByRole("button", { name: "auto" }).getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      finishPlay?.();
      finishPlay = null;
      await Promise.resolve();
    });
    await advance(10_000);

    // A replay, then it waits again.
    expect(webSpeech.speak).toHaveBeenCalledTimes(2);
  });

  it("keeps auto-play on and replays the current Chunk when no is heard", async () => {
    vi.useFakeTimers();
    const commands = voiceCommands();
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} />);

    fireEvent.click(screen.getByRole("button", { name: "auto" }));
    await releaseMicrophone();
    expect(webSpeech.speak).toHaveBeenNthCalledWith(1, "圖書館", expect.anything());

    await act(async () => {
      finishPlay?.();
      finishPlay = null;
      await Promise.resolve();
    });

    await commands.hear("repeat");

    expect(screen.getByText("1/2")).toBeTruthy();
    expect(webSpeech.speak).toHaveBeenNthCalledWith(2, "圖書館", expect.anything());
    expect(screen.getByRole("button", { name: "auto" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("moves to the next Chunk and plays it when the voice hears go or yes", async () => {
    const commands = voiceCommands();
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} />);

    expect(commands.start).toHaveBeenCalledTimes(1);
    expect(webSpeech.speak).not.toHaveBeenCalled();
    expect(screen.getByText("1/2")).toBeTruthy();

    await commands.hear("next");

    expect(screen.getByText("2/2")).toBeTruthy();
    await waitFor(() => expect(webSpeech.speak).toHaveBeenCalledWith("醫院", expect.anything()));
  });

  it("stops listening while the voice speaks, so it cannot hear itself", async () => {
    const commands = voiceCommands();
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} />);

    fireEvent.click(screen.getAllByRole("button", { name: "▶ speak" })[0]!);

    expect(commands.stop).toHaveBeenCalled();
    // Nothing heard while the device is talking counts as a command.
    await commands.hear("next");
    expect(screen.getByText("1/2")).toBeTruthy();

    await act(async () => {
      finishPlay?.();
      finishPlay = null;
      await Promise.resolve();
    });

    expect(commands.start).toHaveBeenCalledTimes(2);
  });

  it("says voice commands are starting until the listener is ready", async () => {
    let ready!: () => void;
    const commands = {
      start: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            ready = resolve;
          }),
      ),
      stop: vi.fn(() => Promise.resolve()),
    };
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} />);

    expect(screen.getByText(/starting voice commands/i)).toBeTruthy();

    await act(async () => {
      ready();
      await Promise.resolve();
    });

    expect(screen.getByText(/voice commands: say/i)).toBeTruthy();
  });

  it("names the built-in English words when there are no custom commands", async () => {
    render(<Run run={vocabRun()} onFinish={() => {}} commands={voiceCommands()} />);

    expect(await screen.findByText(/say .go. or .yes. to play the next chunk/i)).toBeTruthy();
  });

  it("names the person's own commands when they have trained some", async () => {
    render(
      <Run
        run={vocabRun()}
        onFinish={() => {}}
        commands={voiceCommands()}
        commandPhrases={{ next: "下一個", repeat: "再嚟一次", stop: "停" }}
      />,
    );

    expect(await screen.findByText(/say .下一個. to play the next chunk/i)).toBeTruthy();
    expect(screen.getByText(/再嚟一次. to hear this one again/i)).toBeTruthy();
    expect(screen.getByText(/.停. to stop, then again to end/i)).toBeTruthy();
    // The built-in words are not what this person says.
    expect(screen.queryByText(/say .go. or .yes./i)).toBeNull();
  });

  it("asks for the person's own stop word again to end the Run", async () => {
    const commands = voiceCommands();
    render(
      <Run
        run={vocabRun()}
        onFinish={() => {}}
        commands={commands}
        commandPhrases={{ next: "下一個", repeat: "再嚟一次", stop: "停" }}
      />,
    );

    await commands.hear("stop");

    expect(screen.getByText(/say .停. again after a second/i)).toBeTruthy();
  });

  it("asks for a second stop before ending the Run with nothing playing", async () => {
    const commands = voiceCommands();
    const onFinish = vi.fn();
    render(<Run run={vocabRun()} onFinish={onFinish} commands={commands} />);

    await commands.hear("stop");

    expect(onFinish).not.toHaveBeenCalled();
    expect(screen.getByText(/say .stop. again after a second/i)).toBeTruthy();

    await commands.hear("stop");

    expect(onFinish).toHaveBeenCalledWith(["", ""]);
  });

  it("keeps what was typed when the voice ends the Run", async () => {
    const commands = voiceCommands();
    const onFinish = vi.fn();
    render(<Run run={vocabRun()} onFinish={onFinish} commands={commands} />);

    fireEvent.click(screen.getByRole("button", { name: /type it/i }));
    fireEvent.change(screen.getAllByPlaceholderText("type what you hear")[0]!, {
      target: { value: "圖書館" },
    });
    await commands.hear("stop");
    await commands.hear("stop");

    expect(onFinish).toHaveBeenCalledWith(["圖書館", ""]);
  });

  it("lets a half-heard stop expire rather than ending later", async () => {
    vi.useFakeTimers();
    const commands = voiceCommands();
    const onFinish = vi.fn();
    render(<Run run={vocabRun()} onFinish={onFinish} commands={commands} />);

    await commands.hear("stop");
    await advance(7_000);
    await commands.hear("stop");

    expect(onFinish).not.toHaveBeenCalled();
  });

  it("can try the microphone again after it was refused", async () => {
    const commands = {
      start: vi
        .fn()
        .mockRejectedValueOnce(new Error("microphone permission is blocked"))
        .mockResolvedValue(undefined),
      stop: vi.fn(() => Promise.resolve()),
    };
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} />);

    expect(
      await screen.findByText(
        /voice commands are unavailable \(microphone permission is blocked\)/i,
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(commands.start).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/voice commands are unavailable/i)).toBeNull();
  });

  it("does not offer a retry when the page itself cannot use a microphone", async () => {
    const commands = {
      start: vi
        .fn()
        .mockRejectedValue(new UnavailableCommandError("microphones need HTTPS or localhost")),
      stop: vi.fn(() => Promise.resolve()),
    };
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} />);

    expect(await screen.findByText(/microphones need HTTPS or localhost/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("does not offer a retry when the commands have to be trained again", async () => {
    const commands = {
      start: vi.fn().mockRejectedValue(new HeadMismatchError()),
      stop: vi.fn(() => Promise.resolve()),
    };
    render(<Run run={vocabRun()} onFinish={() => {}} commands={commands} />);

    // Only training again can put this right, so a "Try again" button would
    // be a promise the app cannot keep.
    expect(await screen.findByText(/need to be retrained/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("silences auto-play on stop between plays, and only then ends the Run", async () => {
    vi.useFakeTimers();
    const commands = voiceCommands();
    const onFinish = vi.fn();
    render(<Run run={vocabRun()} onFinish={onFinish} commands={commands} />);

    fireEvent.click(screen.getByRole("button", { name: "auto" }));
    await releaseMicrophone();
    await act(async () => {
      finishPlay?.();
      finishPlay = null;
      await Promise.resolve();
    });

    // Between two plays nothing is coming out of the speaker, so the
    // microphone is listening again even though auto-play is still on.
    await commands.hear("stop");

    expect(webSpeech.cancel).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "auto" }).getAttribute("aria-pressed")).toBe("false");
    expect(onFinish).not.toHaveBeenCalled();

    await commands.hear("stop");

    expect(onFinish).toHaveBeenCalled();
  });
});
