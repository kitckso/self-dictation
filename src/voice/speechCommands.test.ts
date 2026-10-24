import { describe, expect, it, vi } from "vitest";
import { HeadMismatchError } from "./errors";

/**
 * The browser is a stand-in: what matters here is what the listener does
 * with a failure, not whether a microphone can be opened.
 */
vi.mock("./microphone", () => ({
  ensureMicrophone: vi.fn(async () => {}),
  MIC_RELEASE_MS: 0,
  RAW_MICROPHONE: {},
}));

/**
 * The speech model is a stand-in too: this is about the failure, not about
 * the model.
 */
vi.mock("./recognizer", () => ({
  recognizerForListening: vi.fn(async () => {
    throw new HeadMismatchError();
  }),
}));

import { speechCommandsListener } from "./speechCommands";

describe("the speech-command listener", () => {
  it("passes on a head that has to be trained again, as it is", async () => {
    // The name is what tells the app this apart from a failure that another
    // try might fix, so it has to survive.
    const failure = await speechCommandsListener.start(() => {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HeadMismatchError);
    expect((failure as Error).name).toBe("HeadMismatchError");
  });
});
