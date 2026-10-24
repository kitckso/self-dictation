import { describe, expect, it } from "vitest";
import { describeCommandError, UnavailableCommandError } from "./errors";

describe("describeCommandError", () => {
  it("says when the microphone is blocked rather than merely unavailable", () => {
    expect(describeCommandError(new DOMException("denied", "NotAllowedError"))).toEqual({
      message: expect.stringMatching(/permission is blocked/i),
      retryable: true,
    });
  });

  it("says that a plain-HTTP page cannot use a microphone", () => {
    expect(describeCommandError(new DOMException("insecure", "SecurityError"))).toEqual({
      message: expect.stringMatching(/https or localhost/i),
      retryable: false,
    });
  });

  it("does not offer a retry for a browser with no microphone API", () => {
    expect(
      describeCommandError(
        new UnavailableCommandError("this browser cannot use a microphone"),
      ),
    ).toEqual({
      message: "this browser cannot use a microphone",
      retryable: false,
    });
  });

  it("keeps a reason it was given, and allows another try", () => {
    expect(describeCommandError(new Error("the voice-command model could not be loaded"))).toEqual({
      message: "the voice-command model could not be loaded",
      retryable: true,
    });
  });

  it("says something when the failure is not an Error", () => {
    expect(describeCommandError("nonsense")).toEqual({
      message: "the microphone could not be opened",
      retryable: true,
    });
  });
});
