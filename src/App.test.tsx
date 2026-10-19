// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App from "./App";
import { encodeSetup, shareUrl, type SharedSetup } from "./domain/share";
import { listCollections, saveRun } from "./storage/db";

vi.mock("./tts", () => ({
  isSupported: () => true,
  webSpeech: {
    listVoices: vi.fn().mockResolvedValue([]),
    canEnumerateVoices: vi.fn().mockResolvedValue(false),
    speak: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
  },
}));

vi.mock("./storage/db", () => ({
  listCollections: vi.fn().mockResolvedValue([]),
  saveCollection: vi.fn().mockResolvedValue(undefined),
  deleteCollection: vi.fn().mockResolvedValue(undefined),
  saveRun: vi.fn().mockResolvedValue(undefined),
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
});

// jsdom has no layout, so element scrolling is a no-op rather than an error.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

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
      await screen.findByRole("button", { name: /run it again/i });

      const first = vi.mocked(saveRun).mock.calls[0]![0].startedAt;

      fireEvent.click(screen.getByRole("button", { name: /run it again/i }));
      fireEvent.click(await screen.findByRole("button", { name: /^end$/i }));

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
    expect(screen.getByText(/cannot save your work/i)).toBeTruthy();
  });
});
