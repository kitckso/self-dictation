import "@tensorflow/tfjs";
import { bestCommand, COMMAND_CONFIDENCE, type DictationCommand } from "./commands";
import type { CommandListener } from "./CommandListener";
import { ensureMicrophone, MIC_RELEASE_MS, RAW_MICROPHONE } from "./microphone";
import { recognizerForListening, type ListeningRecognizer } from "./recognizer";

/**
 * Speech commands, on the device.
 *
 * The 18-word model is served from this app rather than from Google's CDN, so
 * the feature works offline and no audio — or anything else — leaves the
 * device. Only three of its words are commands; the rest are ignored.
 *
 * A person can replace those three words with their own, trained on this
 * device. The recognizer that is used is then the trained one rather than
 * this file's model — see `recognizer.ts`.
 */

class SpeechCommandListener implements CommandListener {
  private recognizer: ListeningRecognizer | null = null;
  private generation = 0;
  /** A stop under way, which the next start has to wait for. */
  private stopping: Promise<void> = Promise.resolve();
  /**
   * Starts are serialised: `listen()` does not report itself as listening
   * until its audio extractor has started, so two overlapping starts could
   * both get through and the second would orphan the first microphone stream.
   */
  private starting: Promise<void> = Promise.resolve();

  start(onCommand: (command: DictationCommand) => void): Promise<void> {
    const generation = ++this.generation;
    const next = this.starting.catch(() => {}).then(() => this.begin(generation, onCommand));
    // Keep the queue alive after a failed start; the caller still sees `next`.
    this.starting = next.catch(() => {});
    return next;
  }

  private async begin(
    generation: number,
    onCommand: (command: DictationCommand) => void,
  ): Promise<void> {
    if (generation !== this.generation) return;
    await ensureMicrophone();
    if (generation !== this.generation) return;

    let recognizer: ListeningRecognizer;
    try {
      recognizer = await recognizerForListening();
    } catch (error) {
      console.error("Voice-command model failed to load", error);
      // A head that does not fit the model is worth saying out loud: it means
      // the person's own commands need training again, and falling back to
      // the built-in English words without saying so would look like their
      // commands had simply stopped working.
      //
      // It is passed on as it is, so that the app can tell it apart from a
      // failure that another try might fix: this one needs training again,
      // not a retry.
      if (error instanceof Error && error.name === "HeadMismatchError") {
        throw error;
      }
      throw new Error("the voice-command model could not be loaded", { cause: error });
    }
    if (generation !== this.generation) return;
    this.recognizer = recognizer;

    await this.stopping.catch(() => {});
    if (generation !== this.generation) return;
    if (recognizer.isListening()) await recognizer.stopListening().catch(() => {});
    if (generation !== this.generation) return;

    const labels = recognizer.wordLabels();
    await recognizer.listen(
      (result) => {
        if (generation !== this.generation) return Promise.resolve();
        const scores = result.scores;
        // Streaming recognition yields one row of scores; batched recognition
        // would not, and there is nothing to read if it did.
        if (!(scores instanceof Float32Array)) return Promise.resolve();
        const command = bestCommand(labels, scores);
        if (command) onCommand(command);
        return Promise.resolve();
      },
      {
        includeSpectrogram: false,
        probabilityThreshold: COMMAND_CONFIDENCE,
        invokeCallbackOnNoiseAndUnknown: false,
        overlapFactor: 0.5,
        // Windows overlap by 0.5s, so 1s stops one spoken word being heard
        // twice while still letting a deliberate second command through.
        suppressionTimeMillis: 1000,
        audioTrackConstraints: RAW_MICROPHONE,
      },
    );

    // stop() may have arrived while listen() was starting.
    if (generation !== this.generation) await recognizer.stopListening().catch(() => {});
  }

  stop(): Promise<void> {
    this.generation += 1;
    const recognizer = this.recognizer;
    if (!recognizer || !recognizer.isListening()) return this.stopping;
    this.stopping = recognizer
      .stopListening()
      .catch(() => {})
      .then(() => wait(MIC_RELEASE_MS));
    return this.stopping;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const speechCommandsListener = new SpeechCommandListener();
