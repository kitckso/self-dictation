// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { canTryVoiceCommands } from "./microphone";

function secureContext(value: boolean | undefined) {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value });
}

afterEach(() => secureContext(undefined));

describe("canTryVoiceCommands", () => {
  it("offers an explanation on a plain-HTTP page, where mediaDevices is hidden", () => {
    secureContext(false);

    expect(canTryVoiceCommands()).toBe(true);
  });

  it("stays quiet on a secure browser with no microphone API", () => {
    secureContext(true);

    expect(canTryVoiceCommands()).toBe(false);
  });

  it("does not mistake an unknown context for an insecure one", () => {
    secureContext(undefined);

    expect(canTryVoiceCommands()).toBe(false);
  });
});
