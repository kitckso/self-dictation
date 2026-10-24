import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceHead } from "./head";
import type { VoiceProfile } from "./profile";
import type { SampleCollector } from "./trainer";
import { VoiceTrainer } from "./VoiceTrainer";

/**
 * The store is a stand-in: what matters here is what the trainer asks it to
 * keep, not how IndexedDB works.
 */
vi.mock("../storage/db", () => ({
  getVoiceProfile: vi.fn(async () => null),
  getVoiceHead: vi.fn(async () => null),
  saveVoiceProfile: vi.fn(async () => {}),
  renameVoiceProfile: vi.fn(async () => {}),
  deleteVoiceProfile: vi.fn(async () => {}),
}));

/**
 * The recognizers are stand-ins too: the real ones load a speech model and
 * open a microphone, which is nothing to do with what the trainer asks of
 * them.
 */
const h = vi.hoisted(() => {
  /** The built-in English model's labels, as the library gives them. */
  const builtInLabels = ["go", "no", "stop", "_background_noise_", "_silence_", "_unknown_"];
  /** The labels a trained head has: its classes, not words. */
  const trainedLabels = ["_background_noise_", "next", "repeat", "stop"];

  /** A recognizer that hears one word and says so. */
  function recognizer(labels: string[], heard: number) {
    return {
      wordLabels: () => labels,
      listen: async (callback: (result: { scores: Float32Array }) => Promise<void>) => {
        const scores = new Float32Array(labels.length);
        scores[heard] = 0.9;
        await callback({ scores });
      },
      stopListening: async () => {},
      isListening: () => false,
    };
  }

  return {
    builtInLabels,
    trainedLabels,
    /** The built-in English model: it hears "go". */
    builtIn: recognizer(builtInLabels, 0),
    /** A trained head: it hears the class "stop". */
    trained: recognizer(trainedLabels, 3),
    setRecognizer: vi.fn(),
  };
});

vi.mock("./recognizer", () => ({
  recognizerForListening: vi.fn(async () => h.builtIn),
  setRecognizer: h.setRecognizer,
  resetRecognizers: vi.fn(),
}));

import { getVoiceProfile, renameVoiceProfile, saveVoiceProfile } from "../storage/db";

/** A profile that has already been trained and saved. */
function profile(over: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: "p1",
    phrases: { next: "下一個", repeat: "再嚟一次", stop: "停" },
    counts: { next: 6, repeat: 6, stop: 6 },
    noise: 4,
    enabled: true,
    createdAt: 1_000,
    updatedAt: 2_000,
    trainedAt: 2_000,
    ...over,
  };
}

/** A head, as the trainer would keep it. */
function head(): VoiceHead {
  return {
    id: "p1",
    formatVersion: 1,
    baseModelId: "18w-v1",
    labels: ["_background_noise_", "next", "repeat", "stop"],
    kernel: new Float32Array(8),
    kernelShape: [2, 4],
    bias: new Float32Array(4),
  };
}

/** A set of samples that has been trained, and so has a head to give. */
function trainedCollector(): SampleCollector {
  return {
    record: vi.fn(async () => {}),
    undo: vi.fn(),
    counts: () => ({ next: 6, repeat: 6, stop: 6 }),
    noiseCount: () => 4,
    train: vi.fn(async () => {}),
    test: vi.fn(async () => ({ correct: 18, total: 18 })),
    head: vi.fn(async () => head()),
    recognizer: vi.fn(() => h.trained),
    dispose: vi.fn(),
  };
}

/** A trainer that asks for nothing of the browser. */
function trainerWith(collector: SampleCollector) {
  return new VoiceTrainer({
    openSession: async () => collector,
    askMicrophone: async () => {},
    gapMs: 0,
    liveTestMs: 1,
  });
}

/** Wait until something is true, or give up. */
async function waitFor(what: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    if (what()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("it did not finish in time");
}

/** Record everything and train it, the way the dialog does. */
async function trainAll(trainer: VoiceTrainer): Promise<void> {
  await trainer.beginTraining();
  await trainer.recordNext();
  await waitFor(() => trainer.getState().busy === false);
  await trainer.train();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVoiceProfile).mockResolvedValue(null);
  vi.mocked(renameVoiceProfile).mockImplementation(async (id, phrases, updatedAt) => ({
    ...profile(),
    id,
    phrases,
    updatedAt,
  }));
});

describe("renaming the commands", () => {
  it("keeps the new names on their own, without training again", async () => {
    vi.mocked(getVoiceProfile).mockResolvedValue(profile());
    const trainer = trainerWith(trainedCollector());
    await trainer.load();
    trainer.setPhrases({ next: "go", repeat: "again", stop: "halt" });

    await trainer.rename();

    expect(renameVoiceProfile).toHaveBeenCalledWith(
      "p1",
      { next: "go", repeat: "again", stop: "halt" },
      expect.any(Number),
    );
    // The head is not written again: only the labels have changed.
    expect(saveVoiceProfile).not.toHaveBeenCalled();
    expect(trainer.getState().profile?.phrases.next).toBe("go");
    expect(trainer.getState().busy).toBe(false);
  });

  it("will not keep names that mean the same thing twice", async () => {
    vi.mocked(getVoiceProfile).mockResolvedValue(profile());
    const trainer = trainerWith(trainedCollector());
    await trainer.load();
    trainer.setPhrases({ next: "go", repeat: "go", stop: "halt" });

    await trainer.rename();

    expect(renameVoiceProfile).not.toHaveBeenCalled();
    expect(trainer.getState().phraseError).toBe("Each command needs a different name.");
  });
});

describe("saving the commands", () => {
  it("does not put a head into use that was not saved", async () => {
    vi.mocked(saveVoiceProfile).mockRejectedValueOnce(new Error("the store is full"));
    const trainer = trainerWith(trainedCollector());
    await trainAll(trainer);

    await trainer.save();

    // A Run listening for commands the app has not kept would say the wrong
    // words about them, so the head stays out of use.
    expect(h.setRecognizer).not.toHaveBeenCalled();
    expect(trainer.getState().stage).toBe("test");
    expect(trainer.getState().error).toMatch(/could not be saved/i);
  });

  it("keeps the samples, so that saving can be tried again", async () => {
    vi.mocked(saveVoiceProfile).mockRejectedValueOnce(new Error("the store is full"));
    const collector = trainedCollector();
    const trainer = trainerWith(collector);
    await trainAll(trainer);

    await trainer.save();

    expect(collector.dispose).not.toHaveBeenCalled();
  });

  it("keeps the head's own counts, the room's noise included", async () => {
    const trainer = trainerWith(trainedCollector());
    await trainAll(trainer);

    await trainer.save();

    const saved = vi.mocked(saveVoiceProfile).mock.calls[0]?.[0];
    expect(saved?.counts).toEqual({ next: 6, repeat: 6, stop: 6 });
    expect(saved?.noise).toBe(4);
  });

  it("keeps the commands switched off if they were switched off", async () => {
    vi.mocked(getVoiceProfile).mockResolvedValue(profile({ enabled: false }));
    const trainer = trainerWith(trainedCollector());
    await trainer.load();
    await trainAll(trainer);

    await trainer.save();

    // Training new commands does not undo a choice the person made: the
    // built-in words stay what a dictation listens for.
    const saved = vi.mocked(saveVoiceProfile).mock.calls[0]?.[0];
    expect(saved?.enabled).toBe(false);
    expect(trainer.getState().enabled).toBe(false);
    expect(h.setRecognizer).not.toHaveBeenCalled();
  });

  it("puts the commands into use when they are switched on", async () => {
    const trainer = trainerWith(trainedCollector());
    await trainAll(trainer);

    await trainer.save();

    expect(h.setRecognizer).toHaveBeenCalled();
  });
});

describe("the live test", () => {
  it("hears the person's own name when the head that was just trained is listening", async () => {
    vi.mocked(getVoiceProfile).mockResolvedValue(profile());
    const trainer = trainerWith(trainedCollector());
    await trainer.load();
    await trainAll(trainer);

    await trainer.liveTest();

    expect(trainer.getState().heard).toBe("停");
  });

  it("says the English word when the built-in model is listening", async () => {
    vi.mocked(getVoiceProfile).mockResolvedValue(profile({ enabled: false }));
    const trainer = trainerWith(trainedCollector());
    await trainer.load();

    await trainer.liveTest();

    // The built-in model heard "go"; showing the person's own name for it
    // would be saying the app heard something it did not.
    expect(trainer.getState().heard).toBe("go");
  });
});
