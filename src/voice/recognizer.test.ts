import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceProfile } from "./profile";

vi.mock("../storage/db", () => ({
  getVoiceProfile: vi.fn(async () => null),
  getVoiceHead: vi.fn(async () => null),
}));

/**
 * The speech model is a stand-in: what matters here is what happens before
 * any model is needed.
 */
vi.mock("./trainer", () => ({
  baseRecognizer: vi.fn(async () => ({
    wordLabels: () => ["go", "no", "stop"],
    listen: vi.fn(),
    stopListening: vi.fn(),
    isListening: () => false,
  })),
  recognizerFromHead: vi.fn(),
}));

import { getVoiceHead, getVoiceProfile } from "../storage/db";
import { recognizerForListening } from "./recognizer";

/** A profile that has been trained and saved, and is in use. */
function profile(over: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: "p1",
    phrases: { next: "下一個", repeat: "再嚟一次" },
    counts: { next: 6, repeat: 6 },
    enabled: true,
    createdAt: 1_000,
    updatedAt: 2_000,
    trainedAt: 2_000,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVoiceProfile).mockResolvedValue(null);
  vi.mocked(getVoiceHead).mockResolvedValue(null);
});

describe("the recognizer to listen with", () => {
  it("says the commands need training again when the head has gone missing", async () => {
    // A profile whose head is not there: a half-finished write, a cleared
    // store, or a head deleted by hand.
    vi.mocked(getVoiceProfile).mockResolvedValue(profile());
    vi.mocked(getVoiceHead).mockResolvedValue(null);

    await expect(recognizerForListening()).rejects.toThrow(
      "your custom commands need to be retrained",
    );
  });

  it("uses the built-in words when the custom ones are switched off", async () => {
    vi.mocked(getVoiceProfile).mockResolvedValue(profile({ enabled: false }));

    const recognizer = await recognizerForListening();

    expect(recognizer.wordLabels()).toEqual(["go", "no", "stop"]);
  });

  it("uses the built-in words when there are no custom ones at all", async () => {
    const recognizer = await recognizerForListening();

    expect(recognizer.wordLabels()).toEqual(["go", "no", "stop"]);
  });
});

describe("a base model that failed to load", () => {
  it("is tried again rather than cached for the life of the page", async () => {
    // A fresh copy of the module, because the cache under test is module
    // state and an earlier test has already filled it.
    vi.resetModules();
    const trainer = await import("./trainer");
    vi.mocked(trainer.baseRecognizer).mockRejectedValueOnce(new Error("offline"));
    const { recognizerForListening: fresh } = await import("./recognizer");

    // The Run offers "Try again" for this failure. It has to have somewhere
    // to go, or the button can never work without a reload.
    await expect(fresh()).rejects.toThrow("offline");
    await expect(fresh()).resolves.toBeTruthy();
  });
});
