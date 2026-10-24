import type { CommandListener } from "./CommandListener";
import { UnavailableCommandError } from "./errors";

export { commandFor, COMMAND_CONFIDENCE } from "./commands";
export type { DictationCommand } from "./commands";
export type { CommandListener } from "./CommandListener";
export { canTryVoiceCommands, microphoneAvailable } from "./microphone";

/**
 * A listener that is only fetched when the microphone is actually used.
 *
 * TensorFlow.js and the model are a lot of JavaScript for a feature that may
 * never start, so `Run` receives this small stand-in and the real adapter is
 * loaded on the first `start`.
 */

let listener: CommandListener | null = null;
let loading: Promise<CommandListener> | null = null;
let generation = 0;

export const voiceCommands: CommandListener = {
  async start(onCommand) {
    // Plain HTTP hides `navigator.mediaDevices`, so `microphoneAvailable()`
    // says no. Fail with the reason before pulling in TensorFlow.js.
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      throw new UnavailableCommandError("microphones need HTTPS or localhost");
    }
    const mine = ++generation;
    loading ??= import("./speechCommands").then((module) => {
      listener = module.speechCommandsListener;
      return module.speechCommandsListener;
    });
    const ready = await loading.catch((error: unknown) => {
      // A load that failed can be tried again on the next play.
      loading = null;
      throw error;
    });
    // A stop arrived while the adapter was loading: never start a microphone
    // that nobody is waiting for.
    if (mine !== generation) return;
    await ready.start((command) => {
      if (mine === generation) onCommand(command);
    });
  },

  stop() {
    generation += 1;
    listener?.stop();
  },
};
