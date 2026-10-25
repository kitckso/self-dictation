import { describe, expect, it, vi } from "vitest";
import type { ListeningRecognizer } from "./recognizer";
import type { SampleCollector } from "./trainer";
import { VoiceTrainer } from "./VoiceTrainer";

/**
 * A set of samples that only remembers what it was asked to record.
 *
 * The real one opens a microphone and loads a speech model, which is nothing
 * to do with how the recording is carried on.
 */
function fakeCollector() {
  const recorded: string[] = [];
  const collector: SampleCollector = {
    record: vi.fn(async (label: string) => {
      recorded.push(label);
    }),
    undo: vi.fn(),
    counts: () => ({ next: 0, repeat: 0, stop: 0 }),
    noiseCount: () => 0,
    train: vi.fn(async () => {}),
    test: vi.fn(async () => ({ correct: 0, total: 0 })),
    head: vi.fn(async () => {
      throw new Error("not needed here");
    }),
    recognizer: vi.fn(() => {
      throw new Error("not needed here");
    }),
    dispose: vi.fn(),
  };
  return { collector, recorded };
}

/** A trainer with a stand-in set of samples, and no pause between them. */
function trainerWith(collector: SampleCollector) {
  return new VoiceTrainer({
    openSession: async () => collector,
    askMicrophone: async () => {},
    gapMs: 0,
  });
}

/** Wait until something is true, or give up. */
async function waitFor(what: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    if (what()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the recording did not finish in time");
}

describe("a recording that carries on by itself", () => {
  it("records only the sample that was asked for when it is switched off", async () => {
    const { collector, recorded } = fakeCollector();
    const trainer = trainerWith(collector);
    trainer.setAuto(false);
    await trainer.beginTraining();

    await trainer.recordNext();

    expect(recorded).toEqual(["next"]);
    expect(trainer.getState().busy).toBe(false);
  });

  it("goes on with the next sample once one has been taken", async () => {
    const { collector, recorded } = fakeCollector();
    const trainer = trainerWith(collector);
    await trainer.beginTraining();

    await trainer.recordNext();
    await waitFor(() => recorded.length > 1);

    expect(recorded[0]).toBe("next");
    expect(recorded[1]).toBe("next");
  });

  it("goes through every command and the room without being asked again", async () => {
    const { collector, recorded } = fakeCollector();
    const trainer = trainerWith(collector);
    await trainer.beginTraining();

    await trainer.recordNext();
    await waitFor(() => trainer.getState().busy === false);

    // Six of each command, then four of the room.
    expect(recorded).toHaveLength(6 * 3 + 4);
    expect(recorded.slice(0, 6)).toEqual(Array<string>(6).fill("next"));
    expect(recorded.slice(6, 12)).toEqual(Array<string>(6).fill("repeat"));
    expect(recorded.slice(12, 18)).toEqual(Array<string>(6).fill("stop"));
    expect(recorded.slice(18)).toEqual(Array<string>(4).fill("_background_noise_"));
  });

  it("stops when it is told to", async () => {
    const { collector, recorded } = fakeCollector();
    const trainer = trainerWith(collector);
    await trainer.beginTraining();

    await trainer.recordNext();
    trainer.stopRecording();
    const stopped = recorded.length;
    await waitFor(() => trainer.getState().busy === false);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(recorded.length).toBe(stopped);
    expect(trainer.getState().busy).toBe(false);
  });

  it("says what it is recording, and what is coming next", async () => {
    const { collector } = fakeCollector();
    const trainer = trainerWith(collector);
    await trainer.beginTraining();

    const recording = trainer.recordNext();
    await recording;

    expect(trainer.getState().recording).toBeNull();
    expect(trainer.getState().upcoming).toBe("next");
  });

  it("keeps the samples it has taken when it is stopped", async () => {
    const { collector, recorded } = fakeCollector();
    const trainer = trainerWith(collector);
    await trainer.beginTraining();

    await trainer.recordNext();
    trainer.stopRecording();
    await waitFor(() => trainer.getState().busy === false);

    expect(recorded.length).toBeGreaterThan(0);
    expect(trainer.getState().counts.next).toBeGreaterThan(0);
  });
});

/** A recognizer that hears nothing; training only needs one to hand over. */
const idleRecognizer: ListeningRecognizer = {
  wordLabels: () => [],
  listen: async () => {},
  stopListening: async () => {},
  isListening: () => false,
};

describe("training", () => {
  it("shows the progress step before it starts reading the samples", async () => {
    const { collector } = fakeCollector();
    collector.recognizer = vi.fn(() => idleRecognizer);
    const trainer = trainerWith(collector);
    await trainer.beginTraining();

    const training = trainer.train();

    // Reading the samples and building their tensors holds the main thread.
    // The step has to be given a frame to reach the screen first, or the
    // dialog freezes on the recording screen and looks like nothing happened.
    expect(trainer.getState().stage).toBe("train");
    expect(collector.train).not.toHaveBeenCalled();

    await training;

    expect(collector.train).toHaveBeenCalledTimes(1);
    expect(trainer.getState().stage).toBe("test");
  });
});

describe("the microphone", () => {
  it("is asked for before the speech model is fetched", async () => {
    const { collector } = fakeCollector();
    const order: string[] = [];
    const trainer = new VoiceTrainer({
      openSession: async () => {
        order.push("model");
        return collector;
      },
      askMicrophone: async () => {
        order.push("microphone");
      },
      gapMs: 0,
    });

    await trainer.beginTraining();

    // The prompt must not arrive with the first word already being asked for,
    // and the model is not fetched for somebody who will say no.
    expect(order).toEqual(["microphone", "model"]);
  });

  it("says so when it is refused, and does not fetch the model", async () => {
    const { collector } = fakeCollector();
    const opened = vi.fn(async () => collector);
    const trainer = new VoiceTrainer({
      openSession: opened,
      askMicrophone: async () => {
        throw new Error("microphone permission is blocked");
      },
      gapMs: 0,
    });

    await trainer.beginTraining();

    expect(opened).not.toHaveBeenCalled();
    expect(trainer.getState().error).toBe("microphone permission is blocked");
    expect(trainer.getState().stage).toBe("names");
  });

  it("says so when the speech model will not load", async () => {
    const trainer = new VoiceTrainer({
      openSession: async () => {
        throw new Error("the model would not load");
      },
      askMicrophone: async () => {},
      gapMs: 0,
    });

    await trainer.beginTraining();

    expect(trainer.getState().error).toBe("the model would not load");
    expect(trainer.getState().stage).toBe("names");
  });
});
