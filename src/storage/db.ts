import type { Collection, Run } from "../domain/types";
import type { VoiceHead } from "../voice/head";
import type { VoicePhrases, VoiceProfile } from "../voice/profile";

/**
 * Everything lives in the browser. There is no server and no account, so
 * IndexedDB is the only place a Collection or a Run can exist.
 */

const DB_NAME = "self-dictation";
const DB_VERSION = 2;
const COLLECTIONS = "collections";
const RUNS = "runs";
/** What a person's own commands are called, and whether they are in use. */
const VOICE_PROFILES = "voiceProfiles";
/** The trained head behind those names. */
const VOICE_HEADS = "voiceHeads";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  /** An upgrade this tab cannot start, because another tab has the store open. */
  let blocked = false;
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
      if (!db.objectStoreNames.contains(VOICE_PROFILES)) {
        db.createObjectStore(VOICE_PROFILES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(VOICE_HEADS)) {
        db.createObjectStore(VOICE_HEADS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // The upgrade went through after all, but the caller was already told
      // it could not. Holding the connection open would now block the tab
      // that caused the wait, so let it go.
      if (blocked) {
        db.close();
        return;
      }
      // Another tab wants a newer version. It cannot have one while this
      // connection is open, so close it and let the next read open a fresh
      // one rather than making the other tab wait for this one to be closed.
      db.onversionchange = () => {
        db.close();
        if (dbPromise === pending) dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // Without this the promise simply never settles, and a screen that is
    // waiting on the store looks like it has frozen.
    req.onblocked = () => {
      blocked = true;
      reject(new Error("the store is being upgraded in another tab"));
    };
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
        // A request succeeding only means it was queued. A quota failure or
        // an abort arrives when the transaction commits, so waiting for
        // `success` would report a Run as saved that is not there.
        let result!: T;
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error("the store would not take the write"));
        const req = fn(t.objectStore(store));
        req.onsuccess = () => {
          result = req.result;
        };
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

/**
 * Every Run, newest first.
 *
 * Progress is a property of the material rather than of a Run, so it has to be
 * worked out from every Run there is. A limit here would quietly drop the
 * oldest Weaknesses, which are often the ones that still need the work.
 */
export async function listAllRuns(): Promise<Run[]> {
  const all = await tx<Run[]>(RUNS, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.startedAt - a.startedAt);
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
    t.onabort = () => reject(t.error ?? new Error("the Runs could not be cleared"));
  });
}

/** Every set of custom voice commands in this browser, newest first. */
async function listVoiceProfiles(): Promise<VoiceProfile[]> {
  const all = await tx<VoiceProfile[]>(VOICE_PROFILES, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The one set of custom voice commands, if there is one.
 *
 * There is one profile for every language: a person who dictates Cantonese
 * and English does not want two sets of words to remember.
 */
export async function getVoiceProfile(): Promise<VoiceProfile | null> {
  const all = await listVoiceProfiles();
  return all[0] ?? null;
}

/**
 * Change the names of a profile, and nothing else.
 *
 * The names are labels: the head behind them is the head that keeps being
 * used, so a rename does not need the head and does not touch it. Only the
 * profile is written, and it is read and written in one transaction, so that
 * a rename cannot half-happen.
 */
export async function renameVoiceProfile(
  id: string,
  phrases: VoicePhrases,
  updatedAt: number,
): Promise<VoiceProfile> {
  const db = await open();
  return new Promise<VoiceProfile>((resolve, reject) => {
    const t = db.transaction(VOICE_PROFILES, "readwrite");
    const store = t.objectStore(VOICE_PROFILES);
    let renamed: VoiceProfile | null = null;
    t.oncomplete = () => {
      if (renamed) resolve(renamed);
      else reject(new Error("the voice commands could not be renamed"));
    };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("the voice commands could not be renamed"));
    const req = store.get(id);
    req.onsuccess = () => {
      const profile = req.result as VoiceProfile | undefined;
      if (!profile) {
        reject(new Error("there are no voice commands to rename"));
        return;
      }
      renamed = { ...profile, phrases, updatedAt };
      store.put(renamed);
    };
    req.onerror = () => reject(req.error);
  });
}

/** The trained head behind a profile, if it is still here. */
export async function getVoiceHead(id: string): Promise<VoiceHead | null> {
  const head = await tx<VoiceHead | undefined>(VOICE_HEADS, "readonly", (s) => s.get(id));
  return head ?? null;
}

/**
 * Keep a profile and its head together.
 *
 * They are written in one transaction, so a store that runs out of room
 * halfway through cannot leave a profile behind that has no head: the pair
 * is either both there or neither is.
 */
export async function saveVoiceProfile(profile: VoiceProfile, head: VoiceHead): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([VOICE_PROFILES, VOICE_HEADS], "readwrite");
    t.objectStore(VOICE_PROFILES).put(profile);
    t.objectStore(VOICE_HEADS).put(head);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("the voice commands could not be saved"));
  });
}

/** Forget a profile and its head together, for the same reason. */
export async function deleteVoiceProfile(id: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([VOICE_PROFILES, VOICE_HEADS], "readwrite");
    t.objectStore(VOICE_PROFILES).delete(id);
    t.objectStore(VOICE_HEADS).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("the voice commands could not be removed"));
  });
}
