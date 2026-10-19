// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Run } from "../domain/types";

/**
 * A small in-memory IndexedDB.
 *
 * Only what the app uses: two object stores, getAll, put, delete and
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
}

class FakeStore {
  private rows: Map<string, unknown>;
  private onSettled: () => void;

  constructor(rows: Map<string, unknown>, onSettled: () => void) {
    this.rows = rows;
    this.onSettled = onSettled;
  }

  /** Answer on a later turn of the loop, the way the real thing does. */
  private answer<T>(req: FakeRequest<T>, value: T): FakeRequest<T> {
    queueMicrotask(() => {
      req.result = value;
      req.onsuccess?.();
      this.onSettled();
    });
    return req;
  }

  getAll(): FakeRequest<unknown[]> {
    return this.answer(new FakeRequest(), [...this.rows.values()]);
  }

  getAllKeys(): FakeRequest<string[]> {
    return this.answer(new FakeRequest(), [...this.rows.keys()]);
  }

  put(value: { id: string }): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    queueMicrotask(() => {
      this.rows.set(value.id, value);
      req.result = value;
      req.onsuccess?.();
      this.onSettled();
    });
    return req;
  }

  delete(key: string): FakeRequest<unknown> {
    const req = new FakeRequest<unknown>();
    queueMicrotask(() => {
      this.rows.delete(key);
      req.result = undefined;
      req.onsuccess?.();
      this.onSettled();
    });
    return req;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: unknown = null;
  private settled = false;
  private db: FakeDatabase;
  private name: string;

  constructor(db: FakeDatabase, name: string) {
    this.db = db;
    this.name = name;
  }

  objectStore(): FakeStore {
    return new FakeStore(this.db.rows(this.name), () => this.settle());
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    queueMicrotask(() => this.oncomplete?.());
  }
}

class FakeDatabase {
  stores = new Map<string, Map<string, unknown>>();

  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  createObjectStore(name: string): { createIndex: () => void } {
    this.stores.set(name, new Map());
    return { createIndex: () => {} };
  }

  rows(name: string): Map<string, unknown> {
    let rows = this.stores.get(name);
    if (!rows) {
      rows = new Map();
      this.stores.set(name, rows);
    }
    return rows;
  }

  transaction(name: string): FakeTransaction {
    return new FakeTransaction(this, name);
  }
}

/** Whether the next open should fail, and how many opens were asked for. */
let openFails = false;
let openCalls = 0;

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
          const db = new FakeDatabase();
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

beforeEach(() => {
  openFails = false;
  openCalls = 0;
  installIndexedDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runs", () => {
  it("keeps a Run and gives it back", async () => {
    const db = await store();

    await db.saveRun(makeRun());

    expect(await db.listRuns()).toHaveLength(1);
  });

  it("gives the newest Run first", async () => {
    const db = await store();

    await db.saveRun(makeRun({ id: "old", startedAt: 1_000 }));
    await db.saveRun(makeRun({ id: "new", startedAt: 5_000 }));

    expect((await db.listRuns()).map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("forgets one Run without touching the others", async () => {
    const db = await store();
    await db.saveRun(makeRun({ id: "r1" }));
    await db.saveRun(makeRun({ id: "r2" }));

    await db.deleteRun("r1");

    expect((await db.listRuns()).map((r) => r.id)).toEqual(["r2"]);
  });

  it("forgets every Run at once", async () => {
    const db = await store();
    await db.saveRun(makeRun({ id: "r1" }));
    await db.saveRun(makeRun({ id: "r2" }));

    await db.clearRuns();

    expect(await db.listRuns()).toEqual([]);
  });
});

describe("a store that cannot be opened", () => {
  it("says so rather than pretending there is nothing there", async () => {
    const db = await store();
    openFails = true;

    await expect(db.listRuns()).rejects.toThrow("blocked");
  });

  it("is not remembered for the life of the page", async () => {
    const db = await store();
    openFails = true;
    await expect(db.listRuns()).rejects.toThrow("blocked");

    // A store blocked in one tab, or a private window that has just been
    // allowed, may well work on the next attempt. Caching the failure would
    // make it permanent for everyone still in this tab.
    openFails = false;

    expect(await db.listRuns()).toEqual([]);
    expect(openCalls).toBe(2);
  });
});
