import type { DictationCommand } from "./commands";

/**
 * The seam between a Run and whatever hears the person speaking.
 *
 * Recognition is deliberately not part of `Run`: a microphone and a model are
 * browser concerns, and keeping them behind this interface lets the Run be
 * tested by saying commands rather than by making noise.
 */
export interface CommandListener {
  /**
   * Begin listening. Resolves once the microphone is live, rejects when it
   * cannot be opened (no permission, no microphone, no secure context).
   *
   * A listener speaks through `onCommand` until `stop` is called.
   */
  start(onCommand: (command: DictationCommand) => void): Promise<void>;
  /** Stop listening and let the microphone go. */
  stop(): void;
}
