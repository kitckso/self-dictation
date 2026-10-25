import { getVoiceHead, getVoiceProfile } from "../storage/db";
import { HeadMismatchError } from "./errors";
import type { VoiceHead } from "./head";

/**
 * Which model a Run listens with.
 *
 * There is one of each at a time: the bundled English 18-word model, or a head
 * the person trained for themselves. Both are the same kind of thing to the
 * Run — something that turns sound into scores — so the Run does not have to
 * know which it has.
 */
export interface ListeningRecognizer {
  wordLabels(): string[];
  listen(
    callback: (result: { scores: Float32Array }) => Promise<void>,
    config?: Record<string, unknown>,
  ): Promise<void>;
  stopListening(): Promise<void>;
  isListening(): boolean;
}

let base: Promise<ListeningRecognizer> | null = null;
let custom: ListeningRecognizer | null = null;

/**
 * The recognizer to listen with right now.
 *
 * A person who has trained their own commands gets them without being asked;
 * everyone else gets the built-in English words. A head that cannot be used
 * is an error, not a reason to quietly fall back: a Run that quietly heard
 * "go" when the person said "下一個" would look like their own commands had
 * stopped working.
 */
export async function recognizerForListening(): Promise<ListeningRecognizer> {
  if (custom) return custom;
  const head = await storedHead();
  if (head) {
    const { recognizerFromHead } = await import("./trainer");
    custom = await recognizerFromHead(head);
    return custom;
  }
  if (!base) {
    const pending = import("./trainer").then((module) => module.baseRecognizer());
    base = pending;
    // A load that failed is not a load that will always fail: the model may
    // have been fetched while the device was briefly offline, or a first
    // compile may have run out of memory. Keeping the rejected promise would
    // make Run's "Try again" unable to do anything until the page reloaded,
    // which is exactly the state it is offered for.
    void pending.catch(() => {
      if (base === pending) base = null;
    });
  }
  return base;
}

/**
 * Listen with this recognizer from now on.
 *
 * Used for a head that has just been trained, so that the next Run picks it
 * up without waiting for the page to be reloaded.
 *
 * It is not a React hook, and it is not named as one: this module has nothing
 * to do with React, and a `use` prefix here would only invite a reader — or a
 * linter — to treat it as one.
 */
export function setRecognizer(recognizer: ListeningRecognizer | null): void {
  custom = recognizer;
}

/**
 * Forget the custom recognizer.
 *
 * Called when the commands are switched off or removed: the next listen goes
 * back to reading the store and finds there is nothing to use.
 */
export function resetRecognizers(): void {
  custom = null;
}

/**
 * The head behind the saved commands, if they are switched on.
 *
 * A profile whose head is missing is a profile that cannot be used, and it
 * says so: falling back to the built-in English words would leave the person
 * saying their own commands into an app that is listening for "go", which
 * looks exactly like their commands having stopped working. The error says
 * the commands need training again.
 */
async function storedHead(): Promise<VoiceHead | null> {
  const profile = await getVoiceProfile();
  if (!profile || !profile.enabled) return null;
  const head = await getVoiceHead(profile.id);
  if (!head) throw new HeadMismatchError();
  return head;
}
