import { describe, expect, it } from "vitest";
import {
  COMMAND_KEYS,
  MIN_NOISE_SAMPLES,
  MIN_SAMPLES,
  MODEL_CLASSES,
  NOISE_LABEL,
  RECOMMENDED_NOISE_SAMPLES,
  RECOMMENDED_SAMPLES,
  commandPhrasesOf,
  defaultPhrases,
  emptyCounts,
  nextToRecord,
  phraseProblem,
  readyToTrain,
  shortSamples,
  totalSamples,
  type VoiceCounts,
  type VoiceProfile,
} from "./profile";

function counts(over: Partial<VoiceCounts> = {}): VoiceCounts {
  return { ...emptyCounts(), ...over };
}

function profile(over: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: "p1",
    phrases: { next: "go", repeat: "again", stop: "stop" },
    counts: counts({ next: 6, repeat: 6, stop: 6 }),
    enabled: true,
    createdAt: 1_000,
    updatedAt: 2_000,
    trainedAt: 2_000,
    ...over,
  };
}

describe("the default names", () => {
  it("starts from the model's own words for the three commands", () => {
    expect(defaultPhrases()).toEqual({ next: "next", repeat: "repeat", stop: "stop" });
  });

  it("never starts two commands off with the same name", () => {
    const phrases = defaultPhrases();
    const names = COMMAND_KEYS.map((key) => phrases[key].trim().toLowerCase());
    expect(new Set(names).size).toBe(COMMAND_KEYS.length);
  });
});

describe("the names a person types", () => {
  it("accepts three different names", () => {
    expect(phraseProblem({ next: "下一個", repeat: "再嚟一次", stop: "停" })).toBeNull();
  });

  it("refuses a name that is empty", () => {
    expect(phraseProblem({ next: "  ", repeat: "again", stop: "stop" })).toMatch(/name/i);
  });

  it("refuses two commands with the same name, because one word cannot mean two things", () => {
    expect(phraseProblem({ next: "go", repeat: "go", stop: "stop" })).toMatch(/different/i);
  });

  it("refuses two names that differ only in case", () => {
    expect(phraseProblem({ next: "Go", repeat: "go", stop: "stop" })).toMatch(/different/i);
  });
});

describe("how many samples are needed", () => {
  it("asks for four of every command and three of room noise", () => {
    expect(MIN_SAMPLES).toBe(4);
    expect(MIN_NOISE_SAMPLES).toBe(3);
  });

  it("recommends six of every command and four of room noise", () => {
    expect(RECOMMENDED_SAMPLES).toBe(6);
    expect(RECOMMENDED_NOISE_SAMPLES).toBe(4);
  });

  it("says which command is still short of samples", () => {
    const short = shortSamples(counts({ next: 4, repeat: 2, stop: 6 }));

    expect(short).toEqual([{ key: "repeat", missing: 2 }]);
  });

  it("will not train until every command and the room noise are there", () => {
    expect(readyToTrain(counts({ next: 4, repeat: 4, stop: 4 }), MIN_NOISE_SAMPLES)).toBe(true);
    expect(readyToTrain(counts({ next: 4, repeat: 4, stop: 3 }), MIN_NOISE_SAMPLES)).toBe(false);
    expect(readyToTrain(counts({ next: 4, repeat: 4, stop: 4 }), MIN_NOISE_SAMPLES - 1)).toBe(
      false,
    );
  });
});

describe("what to record next", () => {
  it("goes on with the command that was being recorded", () => {
    expect(nextToRecord(counts({ next: 1 }), 0, "next")).toBe("next");
  });

  it("moves on to the next command once that one has enough", () => {
    expect(nextToRecord(counts({ next: RECOMMENDED_SAMPLES }), 0, "next")).toBe("repeat");
  });

  it("records the room last of all", () => {
    const all = counts({
      next: RECOMMENDED_SAMPLES,
      repeat: RECOMMENDED_SAMPLES,
      stop: RECOMMENDED_SAMPLES,
    });

    expect(nextToRecord(all, 0)).toBe(NOISE_LABEL);
  });

  it("stops once everything has been recorded as often as it should be", () => {
    const all = counts({
      next: RECOMMENDED_SAMPLES,
      repeat: RECOMMENDED_SAMPLES,
      stop: RECOMMENDED_SAMPLES,
    });

    expect(nextToRecord(all, RECOMMENDED_NOISE_SAMPLES)).toBeNull();
  });

  it("keeps recording the room while the room is short", () => {
    const all = counts({
      next: RECOMMENDED_SAMPLES,
      repeat: RECOMMENDED_SAMPLES,
      stop: RECOMMENDED_SAMPLES,
    });

    expect(nextToRecord(all, 1, NOISE_LABEL)).toBe(NOISE_LABEL);
  });
});

describe("the model classes", () => {
  it("stay the same whatever the person calls the commands", () => {
    // The head is trained on these, and a stored head is checked against them,
    // so they cannot change with the display names.
    expect(MODEL_CLASSES).toEqual(["_background_noise_", "next", "repeat", "stop"]);
  });

  it("are the commands, in the order the commands are named in", () => {
    expect(MODEL_CLASSES).toEqual([NOISE_LABEL, ...COMMAND_KEYS]);
  });
});

describe("how many samples there were", () => {
  it("counts the room's noise as well as the commands", () => {
    // The room was recorded, and it was part of what the head was trained
    // from; leaving it out would understate what was asked of the person.
    expect(totalSamples(counts({ next: 6, repeat: 6, stop: 6 }), 4)).toBe(22);
  });

  it("is nothing when nothing was recorded", () => {
    expect(totalSamples(emptyCounts(), 0)).toBe(0);
  });
});

describe("the names a Run should use", () => {
  it("are the person's own names when the profile is on", () => {
    expect(commandPhrasesOf(profile())).toEqual({
      next: "go",
      repeat: "again",
      stop: "stop",
    });
  });

  it("are the built-in ones when there is no profile", () => {
    expect(commandPhrasesOf(null)).toBeNull();
  });

  it("are the built-in ones when the profile is switched off", () => {
    expect(commandPhrasesOf(profile({ enabled: false }))).toBeNull();
  });
});
