// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { encodeSetup, shareUrl, type SharedSetup } from "./domain/share";

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

  it("does not hold up an ordinary visit", () => {
    render(<App />);

    // Nothing was shared, so there is nothing to wait for.
    expect(document.querySelector("textarea")).toBeTruthy();
    expect(screen.queryByText(/shared link/i)).toBeNull();
  });
});
