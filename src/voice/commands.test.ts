import { describe, expect, it } from "vitest";
import { commandFor } from "./commands";

describe("commandFor", () => {
  it("hears go and yes as next, no as repeat, and stop as stop", () => {
    expect(commandFor("go", 0.9)).toBe("next");
    expect(commandFor("yes", 0.9)).toBe("next");
    expect(commandFor("no", 0.9)).toBe("repeat");
    expect(commandFor("stop", 0.9)).toBe("stop");
  });

  it("ignores a word it does not know", () => {
    expect(commandFor("up", 0.99)).toBeNull();
    expect(commandFor("one", 0.99)).toBeNull();
  });

  it("ignores a guess the model is not sure of", () => {
    expect(commandFor("go", 0.3)).toBeNull();
  });
});
