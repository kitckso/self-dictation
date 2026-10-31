import * as tf from "@tensorflow/tfjs";
import { HeadMismatchError } from "./errors";
import { MODEL_CLASSES } from "./profile";

/**
 * Saving only the part of the model that was trained.
 *
 * A custom head is the softmax layer the transfer library puts on top of the
 * bundled 18-word model: three outputs over a 2,000-wide embedding, so a few
 * thousand weights rather than the millions in the base model. That head is
 * what gets kept; the base model is downloaded again from this app when it is
 * needed. See ADR 0002.
 */

/** The version of the stored head's own layout. */
export const HEAD_FORMAT_VERSION = 1;

/** Which base model the head was trained against. */
export const BASE_MODEL_ID = "18w-v1";

/** The head, as it is kept. */
export interface VoiceHead {
  id: string;
  formatVersion: number;
  baseModelId: string;
  /** The classes the head scores, in the order its columns are in. */
  labels: string[];
  kernel: Float32Array;
  kernelShape: [number, number];
  bias: Float32Array;
}

/** The parts of a dense layer this module reads and writes. */
export interface HeadWeight {
  shape: number[];
  data(): Promise<ArrayLike<number>>;
}

export interface HeadLayer {
  name?: string;
  getWeights(): HeadWeight[];
  setWeights(weights: tf.Tensor[]): void;
}

/**
 * The parts of the library's transfer recognizer this module reaches into.
 *
 * The library keeps the trained head, the word list and the model private,
 * and offers no way to put a head back, so those fields are used from here
 * rather than from the screens. See `applyHead`.
 */
export interface TransferLike {
  /** The word list the library sorts its training data by. */
  words?: string[] | null;
  /** The head the library builds. */
  transferHead?: { layers: HeadLayer[] } | null;
  /** The model that is actually run. */
  model?: unknown;
  wordLabels(): string[];
  /** The library's own way of rebuilding the head. */
  createTransferModelFromBaseModel?: () => void;
}

/** The parts of a layer in the base model this module reaches into. */
export interface BaseLayer {
  getClassName(): string;
  output: tf.SymbolicTensor | tf.SymbolicTensor[];
}

/** The parts of the base recognizer this module reaches into. */
export interface BaseLike {
  model: {
    inputs: tf.SymbolicTensor[];
    layers: BaseLayer[];
  };
}

/**
 * The parts of the library's base recognizer this module reaches into.
 *
 * The library keeps its model private, and a head has to be built on it, so
 * the field is read here. This is the one place in the app that reaches
 * inside a dependency.
 */
export interface LibraryBase {
  model?: {
    inputs: tf.SymbolicTensor[];
    layers: BaseLayer[];
  };
}

/**
 * The base model, as this module needs it.
 *
 * The library keeps the model private, so it is read here rather than by
 * whoever holds the recognizer. This is the one place in the app that
 * reaches inside a dependency.
 */
export function baseModel(base: unknown): BaseLike {
  const model = (base as LibraryBase).model;
  if (!model) throw new HeadMismatchError();
  return { model };
}

/**
 * Check a stored head against the model this app has.
 *
 * Everything that could make the weights meaningless is checked: the format
 * it was written in, the base model it was trained against, the classes it
 * scores and their order, and the shape of the weights themselves.
 */
export function validateHead(head: VoiceHead): void {
  if (head.formatVersion !== HEAD_FORMAT_VERSION) throw new HeadMismatchError();
  if (head.baseModelId !== BASE_MODEL_ID) throw new HeadMismatchError();
  if (!sameClasses(head.labels)) throw new HeadMismatchError();
  const [rows, columns] = head.kernelShape;
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows <= 0 || columns <= 0) {
    throw new HeadMismatchError();
  }
  if (head.kernel.length !== rows * columns) throw new HeadMismatchError();
  if (head.bias.length !== columns) throw new HeadMismatchError();
}

/** Whether the labels are the classes the model was trained on, in order. */
function sameClasses(labels: readonly string[]): boolean {
  return (
    labels.length === MODEL_CLASSES.length && labels.every((label, i) => label === MODEL_CLASSES[i])
  );
}

/**
 * Take the trained head off a recognizer.
 *
 * The library builds the head as a layer named `NewHeadDense`; the last layer
 * is taken if it has been renamed, so a head is still found if the library
 * changes what it calls things.
 */
export async function readHead(transfer: TransferLike, id: string): Promise<VoiceHead> {
  const layer = headLayer(transfer);
  if (!layer) throw new HeadMismatchError();
  const [kernel, bias] = layer.getWeights();
  const [rows, columns] = kernel.shape;
  const head: VoiceHead = {
    id,
    formatVersion: HEAD_FORMAT_VERSION,
    baseModelId: BASE_MODEL_ID,
    labels: [...transfer.wordLabels()],
    kernel: new Float32Array(await kernel.data()),
    kernelShape: [rows, columns],
    bias: new Float32Array(await bias.data()),
  };
  validateHead(head);
  return head;
}

/** The layer holding the trained head. */
function headLayer(transfer: TransferLike): HeadLayer | null {
  const layers = transfer.transferHead?.layers ?? [];
  if (layers.length === 0) return null;
  return layers.find((layer) => layer.name === "NewHeadDense") ?? layers[layers.length - 1]!;
}

/**
 * Put a stored head back onto a recognizer.
 *
 * Two private fields of the library's transfer recognizer are used here, and
 * this is the only place that does it:
 *
 * - `words` — the library has no public setter, and it needs the word list
 *   before it will build a head at all.
 * - `model` — the head has to become the model that is actually run, which
 *   the library only does as part of training.
 *
 * The library's own `createTransferModelFromBaseModel` is used where it
 * exists, because it is the same code that built the head in the first place.
 * The fallback rebuilds the same shape with the public layers API, for the
 * case where the library stops offering it.
 */
export async function applyHead(
  base: BaseLike,
  transfer: TransferLike,
  head: VoiceHead,
): Promise<void> {
  validateHead(head);
  transfer.words = [...head.labels];
  rebuildModel(base, transfer, head.labels);
  const layer = headLayer(transfer);
  if (!layer) throw new HeadMismatchError();

  const kernel = tf.tensor2d(head.kernel, head.kernelShape);
  const bias = tf.tensor1d(head.bias);
  try {
    layer.setWeights([kernel, bias]);
  } catch {
    // The head does not fit the layer it is being put on, which means it was
    // trained against a different model. That is the same problem as a
    // mismatched base model, and it is said in the same words.
    throw new HeadMismatchError();
  } finally {
    // The layer keeps its own copies; these are only for the hand-over.
    kernel.dispose();
    bias.dispose();
  }
}

/**
 * Put a head on top of the base model and make it the model that runs.
 */
function rebuildModel(base: BaseLike, transfer: TransferLike, labels: readonly string[]): void {
  try {
    transfer.createTransferModelFromBaseModel?.();
    if (transfer.transferHead) return;
  } catch (error) {
    console.warn("Falling back to rebuilding the voice head by hand", error);
  }
  const layers = base.model.layers;
  let index = layers.length - 2;
  while (index >= 0 && layers[index]!.getClassName().toLowerCase() !== "dense") index--;
  const dense = layers[index];
  if (!dense) throw new HeadMismatchError();
  const truncated = dense.output as tf.SymbolicTensor;
  const head = tf.sequential();
  head.add(
    tf.layers.dense({
      units: labels.length,
      activation: "softmax",
      inputShape: truncated.shape.slice(1),
      name: "NewHeadDense",
    }),
  );
  const output = head.apply(truncated) as unknown as tf.SymbolicTensor;
  transfer.transferHead = head as unknown as { layers: HeadLayer[] };
  transfer.model = tf.model({ inputs: base.model.inputs, outputs: output });
}
