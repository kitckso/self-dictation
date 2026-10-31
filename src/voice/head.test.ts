import { describe, expect, it } from "vitest";
import type { SymbolicTensor } from "@tensorflow/tfjs";
import { HeadMismatchError } from "./errors";
import {
  BASE_MODEL_ID,
  HEAD_FORMAT_VERSION,
  applyHead,
  readHead,
  validateHead,
  type HeadLayer,
  type VoiceHead,
} from "./head";

/** A head of the right shape, for the checks that are about something else. */
function head(over: Partial<VoiceHead> = {}): VoiceHead {
  return {
    id: "p1",
    formatVersion: HEAD_FORMAT_VERSION,
    baseModelId: BASE_MODEL_ID,
    labels: ["_background_noise_", "next", "repeat"],
    kernel: new Float32Array(6),
    kernelShape: [2, 3],
    bias: new Float32Array(3),
    ...over,
  };
}

/** A recognizer with one dense head, as the library builds it. */
function trainedTransfer(over: Record<string, unknown> = {}) {
  const weights = [
    { shape: [2, 3], data: async () => new Float32Array([1, 2, 3, 4, 5, 6]) },
    { shape: [3], data: async () => new Float32Array([9, 10, 11]) },
  ];
  const layer = {
    name: "NewHeadDense",
    getWeights: () => weights,
    setWeights: () => {},
  };
  return {
    wordLabels: () => ["_background_noise_", "next", "repeat"],
    transferHead: { layers: [layer] },
    ...over,
  };
}

describe("a stored head", () => {
  it("is accepted when it matches the base model it was trained against", () => {
    expect(() => validateHead(head())).not.toThrow();
  });

  it("is refused when it was trained against another base model", () => {
    expect(() => validateHead(head({ baseModelId: "18w-v2" }))).toThrow(HeadMismatchError);
  });

  it("is refused when it was written in a format this app does not know", () => {
    expect(() => validateHead(head({ formatVersion: HEAD_FORMAT_VERSION + 1 }))).toThrow(
      HeadMismatchError,
    );
  });

  it("is refused when its classes are not the ones the model was trained on", () => {
    expect(() =>
      validateHead(head({ labels: ["next", "repeat", "_background_noise_"] })),
    ).toThrow(HeadMismatchError);
  });

  it("is refused when the kernel does not fill its shape", () => {
    expect(() => validateHead(head({ kernel: new Float32Array(5) }))).toThrow(HeadMismatchError);
  });

  it("is refused when the bias does not match the number of classes", () => {
    expect(() => validateHead(head({ bias: new Float32Array(2) }))).toThrow(HeadMismatchError);
  });

  it("says the custom commands have to be retrained", () => {
    expect(() => validateHead(head({ baseModelId: "18w-v2" }))).toThrow(
      /your custom commands need to be retrained/i,
    );
  });
});

describe("reading the head off a trained recognizer", () => {
  it("takes the weights of the head the library built", async () => {
    const read = await readHead(trainedTransfer(), "p1");

    expect(read.id).toBe("p1");
    expect(read.labels).toEqual(["_background_noise_", "next", "repeat"]);
    expect(Array.from(read.kernel)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(read.kernelShape).toEqual([2, 3]);
    expect(Array.from(read.bias)).toEqual([9, 10, 11]);
  });

  it("remembers which base model the head belongs to", async () => {
    const read = await readHead(trainedTransfer(), "p1");

    expect(read.baseModelId).toBe(BASE_MODEL_ID);
    expect(read.formatVersion).toBe(HEAD_FORMAT_VERSION);
  });

  it("takes the last layer when the head is not the one the library named", async () => {
    const layer = {
      name: "something else",
      getWeights: () => [
        { shape: [2, 3], data: async () => new Float32Array(6) },
        { shape: [3], data: async () => new Float32Array(3) },
      ],
      setWeights: () => {},
    };
    const read = await readHead(
      {
        ...trainedTransfer(),
        transferHead: {
          layers: [{ name: "other", getWeights: () => [], setWeights: () => {} }, layer],
        },
      },
      "p1",
    );

    expect(Array.from(read.kernel)).toEqual(Array.from({ length: 6 }, () => 0));
  });
});

describe("putting a stored head back onto the model", () => {
  it("sets the weights on the head the library builds", async () => {
    const tf = await import("@tensorflow/tfjs");
    const input = tf.input({ shape: [2] });
    const layer = tf.layers.dense({ units: 3, name: "NewHeadDense" });
    const model = tf.model({ inputs: input, outputs: layer.apply(input) as SymbolicTensor });
    const transfer = {
      wordLabels: () => ["_background_noise_", "next", "repeat"],
      words: null as string[] | null,
      transferHead: null as { layers: HeadLayer[] } | null,
      model: null as unknown,
      createTransferModelFromBaseModel: () => {
        transfer.transferHead = { layers: [layer as unknown as HeadLayer] };
      },
    };
    const base = { model: { inputs: [], layers: [] } };

    await applyHead(base, transfer, head({ kernel: new Float32Array([1, 2, 3, 4, 5, 6]) }));

    const weights = layer.getWeights();
    expect(Array.from(weights[0].dataSync())).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(weights[1].dataSync())).toEqual([0, 0, 0]);
    weights.forEach((w) => w.dispose());
    expect(model).toBeTruthy();
  });

  it("refuses a head that does not belong to the base model", async () => {
    const transfer = { wordLabels: () => [], words: null, transferHead: null, model: null };
    const base = { model: { inputs: [], layers: [] } };

    await expect(applyHead(base, transfer, head({ baseModelId: "18w-v2" }))).rejects.toThrow(
      /your custom commands need to be retrained/i,
    );
  });
});
