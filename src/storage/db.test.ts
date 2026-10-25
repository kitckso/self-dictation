// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Run } from "../domain/types";
import type { VoiceHead } from "../voice/head";
import type { VoiceProfile } from "../voice/profile";

/**
 * A small in-memory IndexedDB.
 *
 * Only what the app uses: object stores, getAll, get, put, delete and
 * getAllKeys. Enough to check that the store reads and writes what it says
 * it does, and — the reason it exists — that a failure to open it is not
 * remembered for the life of the page.
 */

class FakeRequest<T> {
  result: T | undefined = undefined;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

class FakeStore {
  private rows: Map<string, unknown>;
  private tx: FakeTransaction;
  private name: string;

  constructor(rows: Map<string, unknown>, tx: FakeTransaction, name: string) {
    this.rows = rows;
    this.tx = tx;
    this.name = name;
  }

  /** Answer on a later turn of the loop, the way the real thing does. */
  private answer<T>(req: FakeRequest<T>, value: T): FakeRequest<T> {
    this.tx.begin();
    queueMicrotask(() => {
      req.result = value;
      req.onsuccess?.();
      this.tx.settle();
    });
    return req;
  }

  getAll(): FakeRequest<unknown[]> {
    return this.answer(new FakeRequest(), [...this.rows.values()]);
  }

  getAllKeys(): FakeRequest<string[]> {
    return this.answer(new FakeRequest(), [...this.rows.keys()]);
  }

  get(key: string): FakeRequest<unknown> {
    return this.answer(new FakeRequest(), this.rows.get(key));
  }

  put(value: { id: string }): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    this.tx.begin();
    queueMicrotask(() => {
      if (this.tx.failsWrite(this.name)) {
        const error = new Error("the store is full");
        req.error = error;
        this.tx.fail(error);
        req.onerror?.();
        return;
      }
      this.rows.set(value.id, value);
      req.result = value;
      req.onsuccess?.();
      this.tx.settle();
    });
    return req;
  }

  delete(key: string): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    this.tx.begin();
    queueMicrotask(() => {
      this.rows.delete(key);
      req.result = undefined;
      req.onsuccess?.();
      this.tx.settle();
    });
    return req;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: unknown = null;
  private pending = 0;
  private settled = false;
  private db: FakeDatabase;
  private names: string[];
  private mode: IDBTransactionMode;
  /** What each store held when the transaction began, to undo it. */
  private snapshot: Map<string, Map<string, unknown>>;

  constructor(db: FakeDatabase, names: string[], mode: IDBTransactionMode) {
    this.db = db;
    this.names = names;
    this.mode = mode;
    this.snapshot = new Map(names.map((name) => [name, new Map(db.rows(name))]));
  }

  objectStore(name?: string): FakeStore {
    const store = name ?? this.names[0];
    if (!store) throw new Error("no store named");
    return new FakeStore(this.db.rows(store), this, store);
  }

  /** Whether a write to this store should be refused. */
  failsWrite(name: string): boolean {
    return this.db.failWritesIn.has(name);
  }

  begin(): void {
    this.pending++;
  }

  settle(): void {
    this.pending--;
    if (this.pending > 0 || this.settled) return;
    // A write can fail at commit even though every request succeeded: the
    // store runs out of room once the whole transaction has to be made
    // durable. That is the failure the caller must hear about, because the
    // request-level success was not the last word.
    if (this.db.failCommit && this.mode !== "readonly") {
      this.fail(new Error("the store is full"));
      return;
    }
    this.settled = true;
    queueMicrotask(() => this.oncomplete?.());
  }

  /** Undo everything this transaction did, the way a real one rolls back. */
  abort(): void {
    if (this.settled) return;
    this.settled = true;
    for (const [name, rows] of this.snapshot) {
      const live = this.db.rows(name);
      live.clear();
      for (const [key, value] of rows) live.set(key, value);
    }
    queueMicrotask(() => this.onabort?.());
  }

  /** A write was refused, so the whole transaction is undone. */
  fail(error: unknown): void {
    this.error = error;
    this.abort();
  }
}

class FakeDatabase {
  stores = new Map<string, Map<string, unknown>>();
  /** Store names whose writes should fail. */
  failWritesIn = new Set<string>();
  /** Whether a write should be refused once it is time to commit. */
  failCommit = false;
  closed = false;
  onversionchange: (() => void) | null = null;

  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  createObjectStore(name: string): { createIndex: () => void } {
    this.stores.set(name, new Map());
    return { createIndex: () => {} };
  }

  close(): void {
    this.closed = true;
  }

  rows(name: string): Map<string, unknown> {
    let rows = this.stores.get(name);
    if (!rows) {
      rows = new Map();
      this.stores.set(name, rows);
    }
    return rows;
  }

  transaction(names: string | string[], mode: IDBTransactionMode = "readonly"): FakeTransaction {
    const list = Array.isArray(names) ? names : [names];
    return new FakeTransaction(this, list, mode);
  }
}

/** Whether the next open should fail, and how many opens were asked for. */
let openFails = false;
/** Whether the next open should be blocked by another tab's connection. */
let openBlocks = false;
let openCalls = 0;
/** The database the fake handed out last, so a test can make a store fail. */
let lastDb: FakeDatabase | null = null;

function installIndexedDb(): void {
  Object.defineProperty(globalThis, "indexedDB", {
    value: {
      open(): FakeRequest<FakeDatabase> {
        openCalls++;
        const req = new FakeRequest<FakeDatabase>();
        queueMicrotask(() => {
          if (openFails) {
            req.error = new Error("blocked");
            req.onerror?.();
            return;
          }
          if (openBlocks) {
            // The upgrade is waiting for another tab to let go. The request
            // stays unfinished, exactly as a real blocked open does.
            req.onblocked?.();
            return;
          }
          const db = new FakeDatabase();
          lastDb = db;
          req.result = db;
          req.onupgradeneeded?.();
          req.onsuccess?.();
        });
        return req;
      },
    },
    configurable: true,
  });
}

/** A fresh module each time, because the open promise is module state. */
async function store() {
  vi.resetModules();
  return await import("./db");
}

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: "r1",
    collectionId: null,
    title: "Lesson 1",
    language: "zh",
    mode: "vocab",
    chunks: ["圖書館"],
    results: [{ index: 0, transcript: "", outcome: null }],
    startedAt: 1_000,
    finishedAt: 2_000,
    ...over,
  };
}

function makeProfile(over: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: "p1",
    phrases: { next: "下一個", repeat: "再嚟一次", stop: "停" },
    counts: { next: 6, repeat: 6, stop: 6 },
    enabled: true,
    createdAt: 1_000,
    updatedAt: 2_000,
    trainedAt: 2_000,
    ...over,
  };
}

function makeHead(over: Partial<VoiceHead> = {}): VoiceHead {
  return {
    id: "p1",
    formatVersion: 1,
    baseModelId: "18w-v1",
    labels: ["_background_noise_", "next", "repeat", "stop"],
    kernel: new Float32Array(8),
    kernelShape: [2, 4],
    bias: new Float32Array(4),
    ...over,
  };
}

beforeEach(() => {
  openFails = false;
  openBlocks = false;
  openCalls = 0;
  lastDb = null;
  installIndexedDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runs", () => {
  it("keeps a Run and gives it back", async () => {
    const db = await store();

    await db.saveRun(makeRun());

    expect(await db.listAllRuns()).toHaveLength(1);
  });

  it("gives the newest Run first", async () => {
    const db = await store();

    await db.saveRun(makeRun({ id: "old", startedAt: 1_000 }));
    await db.saveRun(makeRun({ id: "new", startedAt: 5_000 }));

    expect((await db.listAllRuns()).map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("gives back every Run, not just the newest twenty", async () => {
    const db = await store();
    for (let i = 0; i < 25; i++) {
      await db.saveRun(makeRun({ id: `r${i}`, startedAt: 1_000 + i }));
    }

    expect(await db.listAllRuns()).toHaveLength(25);
  });

  it("forgets one Run without touching the others", async () => {
    const db = await store();
    await db.saveRun(makeRun({ id: "r1" }));
    await db.saveRun(makeRun({ id: "r2" }));

    await db.deleteRun("r1");

    expect((await db.listAllRuns()).map((r) => r.id)).toEqual(["r2"]);
  });

  it("forgets every Run at once", async () => {
    const db = await store();
    await db.saveRun(makeRun({ id: "r1" }));

    await db.clearRuns();

    expect(await db.listAllRuns()).toEqual([]);
  });
});

describe("voice commands", () => {
  it("keeps a profile and gives it back", async () => {
    const db = await store();

    await db.saveVoiceProfile(makeProfile(), makeHead());

    const profile = await db.getVoiceProfile();
    expect(profile).not.toBeNull();
    expect(profile?.phrases.next).toBe("下一個");
  });

  it("keeps the head with the profile", async () => {
    const db = await store();

    await db.saveVoiceProfile(makeProfile(), makeHead());

    const head = await db.getVoiceHead("p1");
    expect(head?.labels).toEqual(["_background_noise_", "next", "repeat", "stop"]);
    expect(Array.from(head?.kernel ?? [])).toEqual(Array.from({ length: 8 }, () => 0));
  });

  it("has no profile to begin with", async () => {
    const db = await store();

    expect(await db.getVoiceProfile()).toBeNull();
  });

  it("replaces the profile and the head when the same one is saved again", async () => {
    const db = await store();
    await db.saveVoiceProfile(makeProfile(), makeHead());

    await db.saveVoiceProfile(
      makeProfile({ phrases: { next: "go", repeat: "again", stop: "stop" } }),
      makeHead({ kernel: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]) }),
    );

    expect((await db.getVoiceProfile())?.phrases.next).toBe("go");
    expect(Array.from((await db.getVoiceHead("p1"))?.kernel ?? [])).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("forgets the head along with the profile", async () => {
    const db = await store();
    await db.saveVoiceProfile(makeProfile(), makeHead());

    await db.deleteVoiceProfile("p1");

    expect(await db.getVoiceProfile()).toBeNull();
    expect(await db.getVoiceHead("p1")).toBeNull();
  });

  it("keeps neither the profile nor the head when the head cannot be written", async () => {
    const db = await store();
    await db.saveVoiceProfile(makeProfile(), makeHead());
    lastDb!.failWritesIn.add("voiceHeads");

    await expect(
      db.saveVoiceProfile(makeProfile({ id: "p2" }), makeHead({ id: "p2" })),
    ).rejects.toThrow();

    // The profile is not left behind without a head to go with it.
    expect((await db.getVoiceProfile())?.id).toBe("p1");
    expect(await db.getVoiceHead("p2")).toBeNull();
  });

  it("changes the names without touching the head", async () => {
    const db = await store();
    await db.saveVoiceProfile(makeProfile(), makeHead());

    await db.renameVoiceProfile("p1", { next: "go", repeat: "again", stop: "halt" }, 3_000);

    const profile = await db.getVoiceProfile();
    expect(profile?.phrases).toEqual({ next: "go", repeat: "again", stop: "halt" });
    expect(profile?.updatedAt).toBe(3_000);
    // The head is the same one: renaming is a change of labels.
    expect((await db.getVoiceHead("p1"))?.labels).toEqual([
      "_background_noise_",
      "next",
      "repeat",
      "stop",
    ]);
  });

  it("will not rename commands that are not there", async () => {
    const db = await store();

    await expect(
      db.renameVoiceProfile("p1", { next: "go", repeat: "again", stop: "halt" }, 3_000),
    ).rejects.toThrow();
  });

  it("keeps the old names when the store will not take the new ones", async () => {
    const db = await store();
    await db.saveVoiceProfile(makeProfile(), makeHead());
    lastDb!.failWritesIn.add("voiceProfiles");

    await expect(
      db.renameVoiceProfile("p1", { next: "go", repeat: "again", stop: "halt" }, 3_000),
    ).rejects.toThrow();

    // A rename that half-happened would be worse than one that did not.
    expect((await db.getVoiceProfile())?.phrases.next).toBe("下一個");
  });
});

describe("a write the store refuses", () => {
  it("is reported, even though every request in it succeeded", async () => {
    const db = await store();
    await db.listAllRuns();
    // The request is answered, but the transaction cannot be committed: the
    // store is full, or it is aborted on the way out.
    lastDb!.failCommit = true;

    await expect(db.saveRun(makeRun())).rejects.toThrow("the store is full");

    // And nothing was left behind that a later read would find.
    expect(await db.listAllRuns()).toEqual([]);
  });
});

describe("a store that cannot be opened", () => {
  it("says so rather than pretending there is nothing there", async () => {
    const db = await store();
    openFails = true;

    await expect(db.listAllRuns()).rejects.toThrow("blocked");
  });

  it("stops waiting when another tab is holding the store open", async () => {
    const db = await store();
    openBlocks = true;

    // A blocked upgrade never finishes on its own. Waiting on it would look
    // like a screen that has frozen, and the failure has to be one the app
    // can retry from.
    await expect(db.listAllRuns()).rejects.toThrow(/upgraded in another tab/);
  });

  it("lets go when another tab asks for a newer version", async () => {
    const db = await store();
    await db.listAllRuns();
    const opened = lastDb!;

    opened.onversionchange?.();

    expect(opened.closed).toBe(true);
    // The next read opens a new connection rather than using the closed one.
    expect(await db.listAllRuns()).toEqual([]);
    expect(openCalls).toBe(2);
  });

  it("is not remembered for the life of the page", async () => {
    const db = await store();
    openFails = true;
    await expect(db.listAllRuns()).rejects.toThrow("blocked");

    // A store blocked in one tab, or a private window that has just been
    // allowed, may well work on the next attempt. Caching the failure would
    // make it permanent for everyone still in this tab.
    openFails = false;

    expect(await db.listAllRuns()).toEqual([]);
    expect(openCalls).toBe(2);
  });
});
