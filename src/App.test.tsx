// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App from "./App";
import { encodeSetup, shareUrl, type SharedSetup } from "./domain/share";
import type { Run } from "./domain/types";
import { listCollections, listAllRuns, saveRun, deleteRun, getVoiceProfile } from "./storage/db";
import { onVoicesChanged, webSpeech } from "./tts";
import type { VoiceProfile } from "./voice/profile";

vi.mock("./tts", () => ({
  isSupported: () => true,
  isAndroidLike: () => false,
  onVoicesChanged: vi.fn(() => () => {}),
  webSpeech: {
    listVoices: vi.fn().mockResolvedValue([]),
    canEnumerateVoices: vi.fn().mockResolvedValue(false),
    speak: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
  },
}));

/**
 * The voice listener is a stand-in: the real one opens a microphone and loads
 * a model, which is nothing to do with what the app does with a Run.
 */
vi.mock("./voice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./voice")>()),
  voiceCommands: {
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
  },
}));

/**
 * A store that behaves like IndexedDB, so a Run saved on one screen is the
 * same Run the next screen reads back.
 */
const { store, saveRunImpl } = vi.hoisted(() => {
  const store: { runs: Run[] } = { runs: [] };
  return {
    store,
    saveRunImpl: async (r: Run) => {
      const at = store.runs.findIndex((x) => x.id === r.id);
      // The same Run is rewritten as it is marked, so it is replaced rather
      // than added twice.
      if (at >= 0) store.runs[at] = r;
      else store.runs.push(r);
    },
  };
});
vi.mock("./storage/db", () => ({
  listCollections: vi.fn().mockResolvedValue([]),
  saveCollection: vi.fn().mockResolvedValue(undefined),
  deleteCollection: vi.fn().mockResolvedValue(undefined),
  saveRun: vi.fn(saveRunImpl),
  listAllRuns: vi.fn(async () => store.runs),
  deleteRun: vi.fn().mockResolvedValue(undefined),
  clearRuns: vi.fn().mockResolvedValue(undefined),
  getVoiceProfile: vi.fn().mockResolvedValue(null),
  getVoiceHead: vi.fn().mockResolvedValue(null),
  saveVoiceProfile: vi.fn().mockResolvedValue(undefined),
  renameVoiceProfile: vi.fn().mockResolvedValue(undefined),
  deleteVoiceProfile: vi.fn().mockResolvedValue(undefined),
}));

const shared: SharedSetup = {
  language: "yue",
  mode: "paragraph",
  title: "晨早新聞",
  text: "今日天氣唔錯。我打算去公園散步。",
};

/** Arrive from a link somebody sent. */
async function arriveFrom(setup: SharedSetup) {
  window.location.hash = new URL(shareUrl(await encodeSetup(setup))).hash;
}

afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.clearAllMocks();
  store.runs.length = 0;
  // clearAllMocks empties the calls but leaves whatever implementation a test
  // set, so a test that made a write fail would otherwise make every test
  // after it fail to save.
  vi.mocked(saveRun).mockImplementation(saveRunImpl);
  vi.mocked(listAllRuns).mockImplementation(async () => store.runs);
  vi.mocked(listCollections).mockResolvedValue([]);
  vi.mocked(getVoiceProfile).mockResolvedValue(null);
});

// jsdom has no layout, so element scrolling is a no-op rather than an error.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // A Run only offers voice commands when the browser could use a microphone,
  // and jsdom has none.
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  });
  Object.defineProperty(window, "AudioContext", { configurable: true, value: class {} });
});

/** A profile of the person's own commands. */
function voiceProfile(over: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: "p1",
    phrases: { next: "下一個", repeat: "再嚟一次", stop: "停" },
    counts: { next: 6, repeat: 6, stop: 6 },
    enabled: true,
    createdAt: 1_000,
    updatedAt: 2_000,
    trainedAt: 2_000,
    ...over,
  };
}

describe("App", () => {
  it("opens a dictation that arrived in a link", async () => {
    await arriveFrom(shared);
    render(<App />);

    expect(await screen.findByText(/opened from a shared link/i)).toBeTruthy();
    expect(document.querySelector("textarea")?.value).toBe(shared.text);
    // Setup, not a Run: the recipient can check the language and the voice first.
    expect(screen.getByRole("button", { name: /start dictation/i })).toBeTruthy();
  });

  it("says so when a link cannot be read", async () => {
    window.location.hash = "#d=1znotapayload";
    render(<App />);

    expect(await screen.findByText(/could not be read/i)).toBeTruthy();
  });

  it("opens a second link pasted into the same tab", async () => {
    const second: SharedSetup = {
      language: "en",
      mode: "vocab",
      title: "Lesson 2",
      text: "library\nhospital",
    };
    await arriveFrom(shared);
    render(<App />);
    expect(await screen.findByText(/opened from a shared link/i)).toBeTruthy();

    await arriveFrom(second);

    expect(await screen.findByDisplayValue("Lesson 2")).toBeTruthy();
    expect(document.querySelector("textarea")?.value).toBe(second.text);
  });

  it("does not hold up an ordinary visit", () => {
    render(<App />);

    // Nothing was shared, so there is nothing to wait for.
    expect(document.querySelector("textarea")).toBeTruthy();
    expect(screen.queryByText(/shared link/i)).toBeNull();
  });

  it("reads the voices again when the platform's list changes", async () => {
    render(<App />);
    await waitFor(() => expect(webSpeech.listVoices).toHaveBeenCalledTimes(1));

    // The provider cannot refresh React state; App has to be told and re-read.
    const listener = vi.mocked(onVoicesChanged).mock.calls[0]?.[0];
    expect(listener).toBeTypeOf("function");

    act(() => listener?.());

    await waitFor(() => expect(webSpeech.listVoices).toHaveBeenCalledTimes(2));
  });

  it("records when a Run began, not only when it ended", async () => {
    // Every stored value Date.now() is asked for moves on by a second, so a Run
    // that started and finished together would still be caught.
    let tick = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => 1_000 + tick++ * 1_000);

    try {
      await arriveFrom(shared);
      render(<App />);
      await screen.findByText(/opened from a shared link/i);

      fireEvent.click(screen.getByRole("button", { name: /start dictation/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^end$/i }));
      // A mark is what saves the Run, so the save happens after it.
      fireEvent.click(screen.getAllByRole("button", { name: /✗ wrong/ })[0]!);

      await waitFor(() => expect(saveRun).toHaveBeenCalled());
      const record = vi.mocked(saveRun).mock.calls[0]![0];
      expect(record.startedAt).toBeLessThan(record.finishedAt ?? 0);
    } finally {
      now.mockRestore();
    }
  });

  it("starts a second pass with a new time rather than reusing the first", async () => {
    let tick = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => 1_000 + tick++ * 1_000);

    try {
      await arriveFrom(shared);
      render(<App />);
      await screen.findByText(/opened from a shared link/i);

      fireEvent.click(screen.getByRole("button", { name: /start dictation/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^end$/i }));
      fireEvent.click(screen.getAllByRole("button", { name: /✗ wrong/ })[0]!);
      await screen.findByRole("button", { name: /run it again/i });

      const first = vi.mocked(saveRun).mock.calls[0]![0].startedAt;

      fireEvent.click(screen.getByRole("button", { name: /run it again/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^end$/i }));
      fireEvent.click(screen.getAllByRole("button", { name: /✗ wrong/ })[0]!);

      await waitFor(() => expect(saveRun).toHaveBeenCalledTimes(2));
      expect(vi.mocked(saveRun).mock.calls[1]![0].startedAt).toBeGreaterThan(first);
    } finally {
      now.mockRestore();
    }
  });

  it("says so when the browser cannot save, instead of losing the Run quietly", async () => {
    vi.mocked(listCollections).mockRejectedValueOnce(new Error("storage is blocked"));
    render(<App />);

    expect(await screen.findByText(/cannot save your work/i)).toBeTruthy();
  });

  it("still reaches Results when the Run could not be saved", async () => {
    vi.mocked(saveRun).mockRejectedValue(new Error("quota exceeded"));
    await arriveFrom(shared);
    render(<App />);
    await screen.findByText(/opened from a shared link/i);

    fireEvent.click(screen.getByRole("button", { name: /start dictation/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^end$/i }));

    // Persistence is a convenience, never a precondition: the reveal still happens.
    expect(await screen.findByRole("button", { name: /run it again/i })).toBeTruthy();

    // The mark is what saves the Run, and the failure is said out loud.
    fireEvent.click(screen.getAllByRole("button", { name: /✗ wrong/ })[0]!);
    expect(await screen.findByText(/cannot save your work/i)).toBeTruthy();
  });

  it("does not keep a Run that nothing in it was answered", async () => {
    await arriveFrom(shared);
    render(<App />);
    await screen.findByText(/opened from a shared link/i);

    fireEvent.click(screen.getByRole("button", { name: /start dictation/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^end$/i }));

    // The Run is over, but nothing in it was answered, so there is nothing to
    // keep and nothing to save.
    expect(await screen.findByRole("button", { name: /run it again/i })).toBeTruthy();
    expect(saveRun).not.toHaveBeenCalled();
  });

  it("keeps a Run once something in it is answered", async () => {
    await arriveFrom(shared);
    render(<App />);
    await screen.findByText(/opened from a shared link/i);

    fireEvent.click(screen.getByRole("button", { name: /start dictation/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^end$/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /✗ wrong/ })[0]!);

    await waitFor(() => expect(saveRun).toHaveBeenCalledTimes(1));
  });

  it("gives a Run up again when the last mark is taken back", async () => {
    await arriveFrom(shared);
    render(<App />);
    await screen.findByText(/opened from a shared link/i);

    fireEvent.click(screen.getByRole("button", { name: /start dictation/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^end$/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /✗ wrong/ })[0]!);
    await waitFor(() => expect(saveRun).toHaveBeenCalledTimes(1));

    // The same button again takes the mark back, and the Run with it.
    fireEvent.click(screen.getAllByRole("button", { name: /✗ wrong/ })[0]!);

    await waitFor(() => expect(deleteRun).toHaveBeenCalledTimes(1));
    expect(vi.mocked(deleteRun).mock.calls[0]![0]).toBe(vi.mocked(saveRun).mock.calls[0]![0].id);
  });

  it("keeps a Run where something was typed, because that is an answer too", async () => {
    render(<App />);

    // English is typed by default, so the answer goes into a box.
    fireEvent.click(screen.getByRole("button", { name: /English/ }));
    fireEvent.click(screen.getByRole("button", { name: "Vocabulary" }));
    fireEvent.change(screen.getByPlaceholderText(/圖書館/), { target: { value: "library" } });
    fireEvent.click(screen.getByRole("button", { name: /start dictation/i }));

    fireEvent.change(await screen.findByRole("textbox", { name: /answer for chunk 1/i }), {
      target: { value: "library" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^end$/i }));

    await waitFor(() => expect(saveRun).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveRun).mock.calls[0]![0].results[0]?.transcript).toBe("library");
  });

  it("shows a finished Run in Your progress, and offers back what went wrong", async () => {
    render(<App />);

    // Set up one Vocabulary Item and dictate it.
    fireEvent.click(screen.getByRole("button", { name: "Vocabulary" }));
    fireEvent.change(screen.getByPlaceholderText(/圖書館/), { target: { value: "圖書館" } });
    fireEvent.click(screen.getByRole("button", { name: /start dictation/i }));

    // Cantonese is written on paper, so it is marked rather than typed.
    fireEvent.click(await screen.findByRole("button", { name: /^end$/i }));
    fireEvent.click(screen.getByRole("button", { name: /✗ wrong/ }));

    fireEvent.click(screen.getByRole("button", { name: /your progress/i }));

    // The Run is listed, and the item that went wrong is offered back.
    expect(await screen.findByText(/Untitled vocab/)).toBeTruthy();
    expect(screen.getByText("圖書館")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Drill these 1/ })).toBeTruthy();
  });

  it("opens the past runs from Setup, and comes back to a new dictation", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /your progress/i }));
    expect(await screen.findByText(/your progress/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /new dictation/i }));
    expect(await screen.findByRole("button", { name: /start dictation/i })).toBeTruthy();
  });

  it("starts a drill from the past runs at Setup, with the material filled in", async () => {
    vi.mocked(listAllRuns).mockResolvedValue([
      {
        id: "r1",
        collectionId: null,
        title: "Lesson 1",
        language: "zh",
        mode: "vocab",
        chunks: ["圖書館", "醫院"],
        results: [
          { index: 0, transcript: "", outcome: "wrong" },
          { index: 1, transcript: "", outcome: "correct" },
        ],
        startedAt: 1_000,
        finishedAt: 2_000,
      },
    ]);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /your progress/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Drill these 1/ }));

    // A drill goes to Setup rather than straight to a Run: the material and the
    // Voice are both checked before anything is spoken.
    const box = await screen.findByPlaceholderText(/圖書館/);
    expect((box as HTMLTextAreaElement).value).toBe("圖書館");
    expect(screen.getByDisplayValue(/Needs practice/)).toBeTruthy();
  });
});

describe("voice commands", () => {
  /** Get to a Run with one Vocabulary Item. */
  async function startRun() {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Vocabulary" }));
    fireEvent.change(screen.getByPlaceholderText(/圖書館/), { target: { value: "圖書館" } });
    fireEvent.click(screen.getByRole("button", { name: /start dictation/i }));
  }

  it("names the built-in English words when there is no profile", async () => {
    await startRun();

    expect(await screen.findByText(/say .go. or .yes. to play the next chunk/i)).toBeTruthy();
  });

  it("names the person's own commands when they have trained some", async () => {
    vi.mocked(getVoiceProfile).mockResolvedValue(voiceProfile());

    await startRun();

    expect(await screen.findByText(/say .下一個. to play the next chunk/i)).toBeTruthy();
    expect(screen.queryByText(/say .go. or .yes./i)).toBeNull();
  });

  it("falls back to the built-in words when the profile is switched off", async () => {
    vi.mocked(getVoiceProfile).mockResolvedValue(voiceProfile({ enabled: false }));

    await startRun();

    expect(await screen.findByText(/say .go. or .yes. to play the next chunk/i)).toBeTruthy();
  });
});
