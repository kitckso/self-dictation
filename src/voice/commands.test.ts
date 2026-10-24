import { describe, expect, it } from "vitest";
import { bestCommand, commandFor } from "./commands";

describe("commandFor", () => {
  it("hears go and yes as next, no as repeat, and stop as stop", () => {
    expect(commandFor("go", 0.9)).toBe("next");
    expect(commandFor("yes", 0.9)).toBe("next");
    expect(commandFor("no", 0.9)).toBe("repeat");
    expect(commandFor("stop", 0.9)).toBe("stop");
  });

  it("hears a trained class as the command it stands for", () => {
    // A custom head is trained on the class names, whatever the person calls
    // them, so the classes have to mean the same thing as the English words.
    expect(commandFor("next", 0.9)).toBe("next");
    expect(commandFor("repeat", 0.9)).toBe("repeat");
    expect(commandFor("stop", 0.9)).toBe("stop");
  });

  it("ignores a word it does not know", () => {
    expect(commandFor("up", 0.99)).toBeNull();
    expect(commandFor("one", 0.99)).toBeNull();
  });

  it("ignores the background noise class", () => {
    expect(commandFor("_background_noise_", 0.99)).toBeNull();
  });

  it("ignores a guess the model is not sure of", () => {
    expect(commandFor("go", 0.3)).toBeNull();
  });
});

describe("bestCommand", () => {
  const builtIn = ["_background_noise_", "go", "no", "stop", "up"];
  const trained = ["_background_noise_", "next", "repeat", "stop"];

  it("takes the word the model is most sure of", () => {
    // "no" is the loudest of the built-in words, so it is the one heard.
    expect(bestCommand(builtIn, [0.05, 0.2, 0.9, 0.1, 0.05])).toBe("repeat");
  });

  it("takes a trained class the same way", () => {
    expect(bestCommand(trained, [0.05, 0.2, 0.9, 0.1])).toBe("repeat");
  });

  it("says nothing when the loudest word is only background noise", () => {
    expect(bestCommand(trained, [0.9, 0.05, 0.03, 0.02])).toBeNull();
  });

  it("says nothing when the loudest word is not a command at all", () => {
    expect(bestCommand(builtIn, [0.05, 0.1, 0.1, 0.05, 0.7])).toBeNull();
  });

  it("says nothing when the model is only guessing", () => {
    expect(bestCommand(trained, [0.2, 0.3, 0.25, 0.25])).toBeNull();
  });

  it("copes with a score for every label the model has", () => {
    expect(bestCommand(trained, [0.1, 0.2, 0.3, 0.9])).toBe("stop");
  });
});
