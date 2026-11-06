// IndexedDB storage: one transaction per change, migrations with a snapshot, one writer (reference R14).
// Browser module, but it takes `indexedDB` and `locks` as arguments so Node tests can pass fakes.
import { capHistory, scrubErased } from "../src/history.js";
import { isErased } from "../src/records.js";

export const DB_NAME = "steblo";
export const SCHEMA_VERSION = 1;
export const LOCK_NAME = "steblo-writer";
export const MAX_HISTORY_BYTES = 20 * 1024 * 1024;

const STORES = ["records", "history", "meta"];
const META_KEYS = ["device", "name", "last", "thisIsMe", "settings", "lastBackup"];

export class StorageError extends Error {
  /** code: "quota" | "failed" | "locked" (editing locked after a failure) | "tab" (another tab) | "newer" */
  constructor(code, message, cause) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

const isQuota = err => !!err && (err.name === "QuotaExceededError" || err.code === 22);
const later = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]);

const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** Run `work(tx)` in one transaction. Resolves when it commits; rejects (and aborts) on any error. */
function inTransaction(db, names, mode, work) {
  return new Promise((resolve, reject) => {
    let failure = null;
    let tx;
    try {
      tx = db.transaction(names, mode);
    } catch (err) {
      reject(err);
      return;
    }
    const fail = err => {
      if (!failure) failure = err;
      try { tx.abort(); } catch { /* already finished */ }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure || tx.error || new Error("transaction aborted"));
    tx.onerror = () => { if (!failure) failure = tx.error; };
    try {
      work(tx, fail);
    } catch (err) {
      fail(err);
    }
  });
}

/** Read every store into plain arrays (used by the snapshot, load and exportRaw). */
function readAll(tx, names, done) {
  const out = {};
  let pending = names.length;
  if (pending === 0) { done(out); return; }
  for (const name of names) {
    const store = tx.objectStore(name);
    const keyed = name !== "history";
    let keys = keyed ? null : [];
    let values = null;
    const combine = () => {
      if (values === null || keys === null) return;
      out[name] = keyed ? values.map((v, i) => [keys[i], v]) : values;
      if (--pending === 0) done(out);
    };
    store.getAll().onsuccess = e => { values = e.target.result; combine(); };
    if (keyed) store.getAllKeys().onsuccess = e => { keys = e.target.result; combine(); };
  }
}

function upgrade(db, event, migrations, version) {
  const tx = event.target.transaction;
  const old = event.oldVersion;
  if (old === 0) {
    db.createObjectStore("records");
    db.createObjectStore("history", { autoIncrement: true });
    db.createObjectStore("meta");
    db.createObjectStore("snapshot");
    for (let v = 2; v <= version; v++) migrations[v]?.(db, tx, null);
    return true;
  }
  // Copy the stores first (R14); the snapshot stays until the next good start.
  readAll(tx, STORES, copy => {
    const snapshot = { version: old, records: copy.records || [], history: copy.history || [], meta: copy.meta || [] };
    tx.objectStore("snapshot").put(snapshot, "snapshot");
    for (let v = old + 1; v <= version; v++) migrations[v]?.(db, tx, snapshot);
  });
  return true;
}

export async function openStorage(indexedDB, locks, { version = SCHEMA_VERSION, migrations = {} } = {}) {
  let release = null;
  if (locks) {
    const granted = await new Promise(resolve => {
      locks.request(LOCK_NAME, { ifAvailable: true }, lock => {
        if (!lock) { resolve(false); return undefined; }
        resolve(true);
        return new Promise(done => { release = done; });
      });
    });
    if (!granted) return makeStorage({ state: "locked", indexedDB });
  }

  let db;
  let upgraded = false;
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, version);
      request.onupgradeneeded = event => { upgraded = upgrade(request.result, event, migrations, version); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new StorageError("failed", "the database is open in an older tab"));
    });
  } catch (err) {
    if (err?.name === "VersionError") return makeStorage({ state: "newer", indexedDB, release });
    release?.();
    throw err instanceof StorageError ? err : new StorageError("failed", "could not open the database", err);
  }
  db.onversionchange = () => db.close();

  // A good start on the new version: the snapshot has done its job.
  if (!upgraded && db.objectStoreNames.contains("snapshot")) {
    await inTransaction(db, ["snapshot"], "readwrite", tx => { tx.objectStore("snapshot").clear(); });
  }
  return makeStorage({ state: "ready", indexedDB, db, release });
}

function makeStorage({ state, indexedDB, db = null, release = null }) {
  let editingLocked = false;

  const requireDb = () => { if (!db) throw new StorageError(state === "newer" ? "newer" : "tab", `storage is ${state}`); };

  /** The only door for writes: one transaction; any failure discards the change and locks editing. */
  async function write(names, work) {
    requireDb();
    if (editingLocked) throw new StorageError("locked", "editing is locked after a failed save");
    try {
      await inTransaction(db, names, "readwrite", work);
    } catch (err) {
      editingLocked = true;
      throw new StorageError(isQuota(err) ? "quota" : "failed", isQuota(err) ? "the phone is out of space" : "the change was not saved", err);
    }
  }

  const api = {
    get state() { return state; },
    get editingLocked() { return editingLocked; },

    /** { records: Map, meta, history, historyDropped } with `meta.last` recomputed from the stored times. */
    async load() {
      requireDb();
      const raw = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORES, "readonly");
        tx.onerror = () => reject(tx.error);
        readAll(tx, STORES, resolve);
      });
      const records = new Map(raw.records);
      let last = [0, 0];
      for (const record of records.values()) {
        for (const t of Object.values(record.f)) if (later([t[1], t[2]], last)) last = [t[1], t[2]];
      }
      const stored = Object.fromEntries(raw.meta);
      const meta = {
        device: stored.device ?? null,
        name: stored.name ?? "",
        last,
        thisIsMe: stored.thisIsMe ?? null,
        settings: stored.settings ?? { lang: null, latin: false },
        lastBackup: stored.lastBackup ?? null,
      };
      const capped = capHistory(raw.history, MAX_HISTORY_BYTES);
      if (capped.dropped > 0) {
        await write(["history"], (tx, fail) => {
          const store = tx.objectStore("history");
          store.getAllKeys().onsuccess = e => {
            try { for (const key of e.target.result.slice(0, capped.dropped)) store.delete(key); } catch (err) { fail(err); }
          };
        });
      }
      return { records, meta, history: capped.groups, historyDropped: capped.dropped > 0 };
    },

    /** Store a pending change: records, history group and meta in one transaction. */
    async commit(change) {
      await write(STORES, (tx, fail) => {
        const erased = [];
        for (const [id, record] of change.puts) if (isErased(record)) erased.push(id);
        const records = tx.objectStore("records");
        const history = tx.objectStore("history");
        const meta = tx.objectStore("meta");
        for (const [id, record] of change.puts) records.put(record, id);
        if (erased.length > 0) {
          // erased values leave History in the same transaction as the erase (R11)
          history.getAll().onsuccess = e => {
            try {
              const kept = scrubErased(e.target.result, erased);
              history.clear();
              for (const group of kept) history.add(group);
              if (change.group) history.add(change.group);
            } catch (err) { fail(err); }
          };
        } else if (change.group) {
          history.add(change.group);
        }
        const m = change.meta || {};
        for (const key of META_KEYS) {
          if (m[key] === undefined || key === "last") continue;
          meta.put(m[key], key);
        }
        if (m.last) {
          if (m.resetLast) meta.put(m.last, "last");
          else {
            meta.get("last").onsuccess = e => {
              try { if (!e.target.result || later(m.last, e.target.result)) meta.put(m.last, "last"); } catch (err) { fail(err); }
            };
          }
        }
      });
    },

    /** Replace everything (restore) in one transaction. `state` is { records, meta, history }. */
    async restore(next) {
      await write(STORES, tx => {
        for (const name of STORES) tx.objectStore(name).clear();
        for (const [id, record] of next.records) tx.objectStore("records").put(record, id);
        for (const group of next.history) tx.objectStore("history").add(group);
        for (const key of META_KEYS) if (next.meta[key] !== undefined) tx.objectStore("meta").put(next.meta[key], key);
      });
    },

    /** Every stored record, group and meta value as stored, with no checks. Works in state "newer". */
    async exportRaw() {
      if (state === "locked") throw new StorageError("tab", "storage is locked");
      let handle = db;
      if (!handle) {
        handle = await new Promise((resolve, reject) => {
          const request = indexedDB.open(DB_NAME); // no version: whatever is there
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      try {
        const names = STORES.filter(name => handle.objectStoreNames.contains(name));
        const raw = await new Promise((resolve, reject) => {
          if (names.length === 0) { resolve({}); return; }
          const tx = handle.transaction(names, "readonly");
          tx.onerror = () => reject(tx.error);
          readAll(tx, names, resolve);
        });
        return { records: raw.records || [], history: raw.history || [], meta: Object.fromEntries(raw.meta || []) };
      } finally {
        if (handle !== db) handle.close();
      }
    },

    /** One stored meta value (tests and debugging). */
    async rawMeta(key) {
      requireDb();
      return requestResult(db.transaction(["meta"], "readonly").objectStore("meta").get(key));
    },

    /** The migration snapshot, or null once it has been removed. */
    async rawSnapshot() {
      requireDb();
      const value = await requestResult(db.transaction(["snapshot"], "readonly").objectStore("snapshot").get("snapshot"));
      return value ?? null;
    },

    close() {
      if (db) { db.close(); db = null; }
      if (release) { release(); release = null; }
    },
  };
  return api;
}
