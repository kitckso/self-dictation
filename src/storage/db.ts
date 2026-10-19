import type { Collection, Run } from "../domain/types";

/**
 * Everything lives in the browser. There is no server and no account, so
 * IndexedDB is the only place a Collection or a Run can exist.
 */

const DB_NAME = "self-dictation";
const DB_VERSION = 1;
const COLLECTIONS = "collections";
const RUNS = "runs";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(COLLECTIONS)) {
        const store = db.createObjectStore(COLLECTIONS, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(RUNS)) {
        const store = db.createObjectStore(RUNS, { keyPath: "id" });
        store.createIndex("startedAt", "startedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise = pending;
  // A failure must not be cached for the life of the page. A store blocked in
  // one tab, or a private window that has just been allowed, may well work on
  // the next attempt, and a cached rejection would make the failure permanent
  // for everyone still in this tab.
  void pending.catch(() => {
    if (dbPromise === pending) dbPromise = null;
  });
  return pending;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listCollections(): Promise<Collection[]> {
  const all = await tx<Collection[]>(COLLECTIONS, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveCollection(c: Collection): Promise<void> {
  await tx(COLLECTIONS, "readwrite", (s) => s.put(c));
}

export async function deleteCollection(id: string): Promise<void> {
  await tx(COLLECTIONS, "readwrite", (s) => s.delete(id));
}

export async function listRuns(limit = 20): Promise<Run[]> {
  const all = await tx<Run[]>(RUNS, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
}

export async function saveRun(r: Run): Promise<void> {
  await tx(RUNS, "readwrite", (s) => s.put(r));
}

export async function deleteRun(id: string): Promise<void> {
  await tx(RUNS, "readwrite", (s) => s.delete(id));
}

/** Forget every Run, for a person who wants the record gone. */
export async function clearRuns(): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(RUNS, "readwrite");
    const store = t.objectStore(RUNS);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const key of req.result) store.delete(key);
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
