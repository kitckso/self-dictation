import "@tensorflow/tfjs";
import * as speechCommands from "@tensorflow-models/speech-commands";
import { COMMAND_CONFIDENCE, commandFor, type DictationCommand } from "./commands";
import type { CommandListener } from "./CommandListener";
import { UnavailableCommandError } from "./errors";
import { microphoneAvailable } from "./microphone";
import { speechCommandUrls } from "./modelUrls";

/**
 * Speech commands, on the device.
 *
 * The 18-word model is served from this app rather than from Google's CDN, so
 * the feature works offline and no audio — or anything else — leaves the
 * device. Only three of its words are commands; the rest are ignored.
 */

const { model: MODEL_URL, metadata: METADATA_URL } = speechCommandUrls(
  import.meta.env.BASE_URL,
  document.baseURI,
);

type Recognizer = ReturnType<typeof speechCommands.create>;

let loading: Promise<Recognizer> | null = null;
/** True once the browser has granted the microphone at least once this page. */
let microphoneReady = false;

function loadRecognizer(): Promise<Recognizer> {
  loading ??= (async () => {
    const recognizer = speechCommands.create("BROWSER_FFT", undefined, MODEL_URL, METADATA_URL);
    await recognizer.ensureModelLoaded();
    return recognizer;
  })().catch((error: unknown) => {
    // A failed load is worth retrying next time rather than remembering.
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * Ask for the microphone before doing anything expensive.
 *
 * `getUserMedia` is what makes the browser prompt. Asking first means a
 * refusal is reported as a refusal instead of being hidden behind a model
 * download, and the model is not fetched for someone who will not allow the
 * microphone. The stream is closed again immediately; listening opens it for
 * real once the model is ready.
 */
async function ensureMicrophone(): Promise<void> {
  if (microphoneReady) return;
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    throw new UnavailableCommandError("microphones need HTTPS or localhost");
  }
  if (!microphoneAvailable()) {
    throw new UnavailableCommandError("this browser cannot use a microphone");
  }
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphoneReady = true;
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
  }
}

class SpeechCommandListener implements CommandListener {
  private recognizer: Recognizer | null = null;
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
    const next = this.starting
      .catch(() => {})
      .then(() => this.begin(generation, onCommand));
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

    let recognizer: Recognizer;
    try {
      recognizer = await loadRecognizer();
    } catch (error) {
      console.error("Voice-command model failed to load", error);
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
        let best = 0;
        for (let i = 1; i < scores.length; i++) {
          if ((scores[i] ?? 0) > (scores[best] ?? 0)) best = i;
        }
        const command = commandFor(labels[best] ?? "", scores[best] ?? 0);
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
      },
    );

    // stop() may have arrived while listen() was starting.
    if (generation !== this.generation) await recognizer.stopListening().catch(() => {});
  }

  stop(): void {
    this.generation += 1;
    const recognizer = this.recognizer;
    if (!recognizer || !recognizer.isListening()) return;
    this.stopping = recognizer.stopListening().catch(() => {});
  }
}

export const speechCommandsListener = new SpeechCommandListener();
