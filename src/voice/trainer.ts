import * as tf from "@tensorflow/tfjs";
import * as speechCommands from "@tensorflow-models/speech-commands";
import type {
  Example,
  SpeechCommandRecognizer,
  StreamingRecognitionConfig,
  TransferLearnConfig,
  TransferSpeechCommandRecognizer,
} from "@tensorflow-models/speech-commands";
import { applyHead, baseModel, readHead, type VoiceHead } from "./head";
import { speechCommandUrls } from "./modelUrls";
import {
  COMMAND_KEYS,
  MODEL_CLASSES,
  NOISE_LABEL,
  TRAIN_EPOCHS,
  type VoiceCounts,
} from "./profile";
import type { ListeningRecognizer } from "./recognizer";

/**
 * Teaching the app a person's own commands.
 *
 * The bundled 18-word model is the starting point: it knows English words and
 * nothing else. A small head is put on top of it and trained on a handful of
 * the person's own recordings, so that the app can score three classes of their
 * own speech — the two commands and the room around them. The recordings
 * live in memory while the head is trained and are thrown away afterwards;
 * what is kept is the head, which is a few thousand weights rather than the
 * millions in the base model. See ADR 0002.
 *
 * This module is loaded lazily: it pulls in TensorFlow.js, which is a lot of
 * JavaScript for a feature that most people never open.
 */

/** How far through the training the head is. */
export interface TrainProgress {
  epoch: number;
  epochs: number;
}

/** What the head made of the samples it was trained on. */
export interface TrainResult {
  /** How many samples the head heard correctly. */
  correct: number;
  /** How many samples there were to hear. */
  total: number;
}

/** The samples being collected on this device, and the head trained from them. */
export interface SampleCollector {
  /** Record one sample of a command word. */
  record(label: string): Promise<void>;
  /** Take back the last sample of a label. */
  undo(label: string): void;
  /** How many samples each label has. */
  counts(): VoiceCounts;
  /** How many room samples there are. */
  noiseCount(): number;
  /** Train the head, reporting progress as it goes. */
  train(onProgress: (progress: TrainProgress) => void): Promise<void>;
  /** Measure the head against the samples it was trained on. */
  test(): Promise<TrainResult>;
  /** The trained head, ready to be kept. */
  head(id: string): Promise<VoiceHead>;
  /** The recognizer to listen with from now on. */
  recognizer(): ListeningRecognizer;
  /**
   * Throw the samples away.
   *
   * A recognizer taken from here must not outlive this: the library forgets
   * the word labels along with the samples, and its streaming recognition
   * then fails on every frame.
   */
  dispose(): void;
}

/**
 * The base recognizer, with the bundled English 18-word model.
 *
 * The model is fetched once and then kept, because it is several megabytes
 * and every set of samples needs it.
 */
export async function baseRecognizer(): Promise<ListeningRecognizer> {
  return toListeningRecognizer(await loadBase());
}

/**
 * Open a set of samples, loading the base model if it is not loaded yet.
 *
 * The samples are kept in memory by the library until the head is trained;
 * nothing is written anywhere.
 */
export async function openSampleCollector(options?: {
  audioTrackConstraints?: MediaTrackConstraints;
}): Promise<SampleCollector> {
  const base = await loadBase();
  const transfer = base.createTransfer(nextTransferName());
  return new SampleCollectorImpl(transfer, options?.audioTrackConstraints);
}

/**
 * Build a recognizer that uses a head kept from an earlier day.
 *
 * A head that does not belong to the base model this app has is an error, not
 * a reason to fall back to English: a Run that quietly heard "go" when the
 * person said their own word would look like their commands had stopped
 * working. The `HeadMismatchError` is therefore left to reach the caller.
 */
export async function recognizerFromHead(head: VoiceHead): Promise<ListeningRecognizer> {
  const base = await loadBase();
  const transfer = base.createTransfer(nextTransferName());
  await applyHead(baseModel(base), transfer, head);
  return toListeningRecognizer(transfer);
}

let loading: Promise<SpeechCommandRecognizer> | null = null;

/** Fetch and keep the bundled model, once. */
function loadBase(): Promise<SpeechCommandRecognizer> {
  loading ??= (async () => {
    const urls = speechCommandUrls(import.meta.env.BASE_URL, document.baseURI);
    const recognizer = speechCommands.create("BROWSER_FFT", undefined, urls.model, urls.metadata);
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
 * The library will not make two transfer models with the same name, so every
 * one gets a name of its own.
 */
let transfersMade = 0;

function nextTransferName(): string {
  transfersMade += 1;
  return `self-dictation-${transfersMade}`;
}

/**
 * The shape the app listens with.
 *
 * The library's own recognizer is wider than this: it can hand back a whole
 * batch of scores and wants a typed configuration. The app only ever reads
 * one row of scores at a time.
 */
function toListeningRecognizer(recognizer: SpeechCommandRecognizer): ListeningRecognizer {
  return {
    wordLabels: () => recognizer.wordLabels(),
    listen: (callback, config) =>
      recognizer.listen(
        (result) => callback({ scores: result.scores as Float32Array }),
        // The configuration is the library's own, with every field optional;
        // the app passes it straight through.
        config as unknown as StreamingRecognitionConfig | undefined,
      ),
    stopListening: () => recognizer.stopListening(),
    isListening: () => recognizer.isListening(),
  };
}

/**
 * The samples being collected on this device.
 *
 * The library keeps the samples in a dataset of its own and the head is
 * trained from it; both are gone once the samples are thrown away.
 */
class SampleCollectorImpl implements SampleCollector {
  private transfer: TransferSpeechCommandRecognizer | null;
  private readonly constraints: MediaTrackConstraints | undefined;
  private trained = false;

  constructor(transfer: TransferSpeechCommandRecognizer, constraints?: MediaTrackConstraints) {
    this.transfer = transfer;
    this.constraints = constraints;
  }

  /**
   * Record one sample of a command word.
   *
   * The room is recorded under its own class name, which is why that name is
   * accepted here as well.
   *
   * The library's documentation says a word may not be one the base model
   * knows, but its code does not check that: the transfer model replaces the
   * base model's output layer with a head of its own, so "repeat" is a class
   * name here and nothing more.
   */
  async record(label: string): Promise<void> {
    const transfer = this.live();
    if (!isClassLabel(label)) {
      throw new Error(`"${label}" is not a class this model can learn`);
    }
    await transfer.collectExample(label, { audioTrackConstraints: this.constraints });
  }

  /** Take back the last sample of a label. */
  undo(label: string): void {
    const transfer = this.live();
    if ((this.countsOf(transfer)[label] ?? 0) === 0) return;
    const examples = transfer.getExamples(label);
    const last = examples[examples.length - 1];
    if (!last) return;
    transfer.removeExample(last.uid);
  }

  /** How many samples each label has. */
  counts(): VoiceCounts {
    const counts = this.countsOf(this.live());
    return {
      next: counts.next ?? 0,
      repeat: counts.repeat ?? 0,
    };
  }

  /** How many room samples there are. */
  noiseCount(): number {
    return this.countsOf(this.live())[NOISE_LABEL] ?? 0;
  }

  /** Train the head, reporting progress as it goes. */
  async train(onProgress: (progress: TrainProgress) => void): Promise<void> {
    const transfer = this.live();
    const counts = this.countsOf(transfer);
    const missing = MODEL_CLASSES.filter((label) => (counts[label] ?? 0) === 0);
    if (missing.length > 0) {
      throw new Error("every command and the room need a sample before the head can be trained");
    }
    const config: TransferLearnConfig = {
      epochs: TRAIN_EPOCHS,
      // A handful of samples will not move with the library's default batch,
      // and plain SGD needs far more epochs than twenty to settle.
      batchSize: 32,
      optimizer: "adam",
      callback: {
        onEpochEnd: (epoch, logs) => {
          if (logs) onProgress({ epoch: epoch + 1, epochs: TRAIN_EPOCHS });
        },
      },
    };
    await transfer.train(config);
    this.trained = true;
  }

  /**
   * Measure the head against the samples it was trained on.
   *
   * Every sample is heard once and the best of the three classes is compared
   * with the class it was recorded under. The room samples are left out of
   * the count: the room is not a command, and a head that hears the room as
   * one of the commands is a head that would move a Run on by itself.
   */
  async test(): Promise<TrainResult> {
    const transfer = this.live();
    if (!this.trained) throw new Error("the commands have not been trained yet");
    const labels = transfer.wordLabels();
    let correct = 0;
    let total = 0;
    for (const label of COMMAND_KEYS) {
      for (const { example } of this.examplesOf(transfer, label)) {
        const scores = await scoreExample(transfer, example);
        total += 1;
        if (labels[bestScore(scores)] === label) correct += 1;
      }
    }
    return { correct, total };
  }

  /** The trained head, ready to be kept. */
  async head(id: string): Promise<VoiceHead> {
    const transfer = this.live();
    if (!this.trained) throw new Error("the commands have not been trained yet");
    return readHead(transfer, id);
  }

  /** The recognizer to listen with from now on. */
  recognizer(): ListeningRecognizer {
    return toListeningRecognizer(this.live());
  }

  /**
   * Throw the samples away.
   *
   * `clearExamples()` also sets the library's word list to null, so anything
   * still holding this recognizer for streaming is left deaf: it fails on
   * every frame it hears. Nothing may keep one past this point.
   */
  dispose(): void {
    const transfer = this.transfer;
    this.transfer = null;
    if (!transfer) return;
    // The library refuses to clear a dataset it does not have, and the
    // samples are held in memory until they are cleared.
    if (!transfer.isDatasetEmpty()) transfer.clearExamples();
  }

  /** The recognizer, unless the samples have been thrown away. */
  private live(): TransferSpeechCommandRecognizer {
    if (!this.transfer) throw new Error("these samples have been thrown away");
    return this.transfer;
  }

  /**
   * How many samples there are of each label.
   *
   * The library throws when it is asked about a dataset it does not have, so
   * no samples at all counts as an empty set.
   */
  private countsOf(transfer: TransferSpeechCommandRecognizer): Record<string, number> {
    if (transfer.isDatasetEmpty()) return {};
    return transfer.countExamples();
  }

  /** The samples of one label, in the order they were recorded. */
  private examplesOf(
    transfer: TransferSpeechCommandRecognizer,
    label: string,
  ): { uid: string; example: Example }[] {
    if ((this.countsOf(transfer)[label] ?? 0) === 0) return [];
    return transfer.getExamples(label);
  }
}

/** Whether a label is one of the classes the head scores. */
function isClassLabel(label: string): boolean {
  return MODEL_CLASSES.some((known) => known === label);
}

/**
 * Hear one recorded sample and say what the head makes of it.
 *
 * The library's transfer recognizer never works out for itself how many
 * numbers make up one example, so its own shortcut for a plain array of
 * numbers cannot be used; a tensor is the other way in, and the library
 * checks that it has the shape the model expects.
 */
async function scoreExample(
  transfer: TransferSpeechCommandRecognizer,
  example: Example,
): Promise<Float32Array> {
  const { data, frameSize } = example.spectrogram;
  const frames = data.length / frameSize;
  const input = tf.tensor4d(data, [1, frames, frameSize, 1]);
  try {
    const result = await transfer.recognize(input);
    const scores = result.scores;
    if (scores instanceof Float32Array) return scores;
    return scores[0] ?? new Float32Array();
  } finally {
    // The library disposes of what it makes, but not of what it was given.
    input.dispose();
  }
}

/** Which class the head believes it heard most. */
function bestScore(scores: Float32Array): number {
  let best = 0;
  for (let i = 1; i < scores.length; i++) {
    if ((scores[i] ?? 0) > (scores[best] ?? 0)) best = i;
  }
  return best;
}
