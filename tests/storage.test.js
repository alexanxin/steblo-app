// Storage on fake-indexeddb, with failure injection (reference R14).
import { test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBDatabase } from "fake-indexeddb";
import { openStorage } from "../public/ui/storage.js";
import { makeGroup } from "../public/src/history.js";
import { pid, T0 } from "./fixtures/helpers.js";

const DEVICE = pid("d", 1);
const rec = (given, ms = T0, counter = 0) => ({ kind: "person", f: { g: [given, ms, counter, DEVICE], del: [false, ms, counter, DEVICE] } });
const group = (action = "add", people = []) => makeGroup({ action, device: DEVICE, at: T0, people, changes: [] });

/** A Web Locks stand-in: one holder per name, `ifAvailable` gives null when taken. */
function fakeLocks() {
  const held = new Set();
  return {
    async request(name, options, callback) {
      if (held.has(name)) {
        if (options.ifAvailable) return callback(null);
        throw new Error("the test locks only support ifAvailable");
      }
      held.add(name);
      try { return await callback({ name }); } finally { held.delete(name); }
    },
  };
}

async function ready(indexedDB = new IDBFactory(), options) {
  const storage = await openStorage(indexedDB, fakeLocks(), options);
  assert.equal(storage.state, "ready");
  return { storage, indexedDB };
}

const change = (puts, meta = {}, g = group()) => ({ puts: new Map(puts), group: g, meta });

test("commit writes records, history and meta in one transaction", async () => {
  const { storage, indexedDB } = await ready();
  let transactions = 0;
  const original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) { transactions += 1; return original.apply(this, args); };
  try {
    await storage.commit(change([[pid("a", 1), rec("Danilo")]], { device: DEVICE, name: "Teodora", last: [T0, 0] }));
  } finally {
    IDBDatabase.prototype.transaction = original;
  }
  assert.equal(transactions, 1);
  const state = await storage.load();
  assert.equal(state.records.get(pid("a", 1)).f.g[0], "Danilo");
  assert.equal(state.history.length, 1);
  assert.equal(state.meta.name, "Teodora");
  assert.equal(state.meta.device, DEVICE);
  storage.close();
  assert.ok(indexedDB);
});

test("an aborted transaction leaves nothing and reports the failure", async () => {
  const { storage } = await ready();
  await storage.commit(change([[pid("a", 1), rec("Miro")]], { device: DEVICE }));
  // a function can't be stored: the second put throws inside the transaction, which then aborts
  const bad = { kind: "person", f: { g: () => 1 } };
  await assert.rejects(
    storage.commit(change([[pid("a", 2), rec("Ema")], [pid("a", 3), bad]], { name: "Changed" })),
    err => err.code === "failed",
  );
  const state = await storage.load();
  assert.deepEqual([...state.records.keys()], [pid("a", 1)]);
  assert.equal(state.history.length, 1);
  assert.notEqual(state.meta.name, "Changed");
});

test("a quota error is reported and locks editing", async () => {
  const { storage } = await ready();
  const full = { kind: "person", get f() { throw new DOMException("full", "QuotaExceededError"); } };
  await assert.rejects(storage.commit(change([[pid("a", 1), full]])), err => err.code === "quota");
  assert.equal(storage.editingLocked, true);
  // even a good change is refused now, without touching the database
  await assert.rejects(storage.commit(change([[pid("a", 2), rec("Adam")]])), err => err.code === "locked");
  assert.equal((await storage.load()).records.size, 0);
});

test("load recomputes last from stored times", async () => {
  const { storage } = await ready();
  await storage.commit(change([[pid("a", 1), rec("Lea", T0 + 5000, 3)], [pid("a", 2), rec("Adam", T0 + 9000, 7)]], { device: DEVICE, last: [1, 0] }));
  const state = await storage.load();
  assert.deepEqual(state.meta.last, [T0 + 9000, 7]);
});

test("a re-stamp change resets the stored clock", async () => {
  const { storage } = await ready();
  const far = T0 + 10 * 86_400_000;
  await storage.commit(change([[pid("a", 1), rec("Lea", far, 0)]], { device: DEVICE, last: [far, 0] }));
  assert.deepEqual(await storage.rawMeta("last"), [far, 0]);
  await storage.commit(change([[pid("a", 1), rec("Lea", T0, 1)]], { last: [T0, 1], resetLast: true }, group("restamp")));
  assert.deepEqual(await storage.rawMeta("last"), [T0, 1]);
  assert.deepEqual((await storage.load()).meta.last, [T0, 1]);
});

test("committing a change scrubs erased records from history in the same transaction", async () => {
  const { storage } = await ready();
  const id = pid("a", 1);
  const g = makeGroup({ action: "edit", device: DEVICE, at: T0, people: [id], changes: [{ r: id, f: "g", before: ["Old", 1, 0, DEVICE], after: ["Ema", T0, 0, DEVICE] }] });
  await storage.commit(change([[id, rec("Ema")]], {}, g));
  const erased = { kind: "person", f: { er: [true, T0 + 10, 0, DEVICE] } };
  await storage.commit({ puts: new Map([[id, erased]]), group: makeGroup({ action: "erase", device: DEVICE, at: T0 + 10 }), meta: {} });
  const state = await storage.load();
  assert.equal(JSON.stringify(state.history).includes("Ema"), false);
  assert.equal(JSON.stringify(state.history).includes("Old"), false);
  assert.deepEqual(state.records.get(id), erased);
  assert.equal(state.history.length, 2);
});

test("restore swaps everything in one transaction", async () => {
  const { storage } = await ready();
  await storage.commit(change([[pid("a", 1), rec("Miro")]], { device: DEVICE, name: "Before" }));
  const next = {
    records: new Map([[pid("b", 1), rec("Teodora")], [pid("b", 2), rec("Danilo")]]),
    meta: { device: pid("d", 2), name: "After", last: [T0, 0], thisIsMe: null, settings: { lang: "mk", latin: false }, lastBackup: T0 },
    history: [group("import")],
  };
  let transactions = 0;
  const original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) { transactions += 1; return original.apply(this, args); };
  try { await storage.restore(next); } finally { IDBDatabase.prototype.transaction = original; }
  assert.equal(transactions, 1);
  const state = await storage.load();
  assert.deepEqual([...state.records.keys()].sort(), [pid("b", 1), pid("b", 2)]);
  assert.equal(state.meta.name, "After");
  assert.equal(state.meta.device, pid("d", 2));
  assert.equal(state.history.length, 1);

  // a restore that fails half way keeps what was there
  const broken = { ...next, records: new Map([[pid("c", 1), rec("Ema")], [pid("c", 2), { kind: "person", f: { g: () => 1 } }]]) };
  await assert.rejects(storage.restore(broken), err => err.code === "failed");
  assert.deepEqual([...(await storage.load()).records.keys()].sort(), [pid("b", 1), pid("b", 2)]);
});

test("a migration copies the stores to a snapshot first", async () => {
  const indexedDB = new IDBFactory();
  const { storage } = await ready(indexedDB);
  await storage.commit(change([[pid("a", 1), rec("Miro")]], { device: DEVICE, name: "Old name" }));
  storage.close();
  const seen = [];
  const migrations = { 2: (db, tx, snapshot) => { seen.push(snapshot.version); tx.objectStore("records").delete(pid("a", 1)); } };
  const second = await openStorage(indexedDB, fakeLocks(), { version: 2, migrations });
  assert.equal(second.state, "ready");
  assert.deepEqual(seen, [1]);
  const snap = await second.rawSnapshot();
  assert.equal(snap.version, 1);
  assert.equal(snap.records.length, 1);
  assert.equal(snap.records[0][0], pid("a", 1));
  assert.equal(snap.meta.find(([k]) => k === "name")[1], "Old name");
  assert.equal((await second.load()).records.size, 0); // the migration did run
  second.close();
});

test("the snapshot is removed after the next good start", async () => {
  const indexedDB = new IDBFactory();
  const first = await ready(indexedDB);
  first.storage.close();
  const migrations = { 2: () => {} };
  const upgraded = await openStorage(indexedDB, fakeLocks(), { version: 2, migrations });
  assert.ok(await upgraded.rawSnapshot());
  upgraded.close();
  const again = await openStorage(indexedDB, fakeLocks(), { version: 2, migrations });
  assert.equal(await again.rawSnapshot(), null);
  again.close();
});

test("VersionError gives state newer", async () => {
  const indexedDB = new IDBFactory();
  const future = await openStorage(indexedDB, fakeLocks(), { version: 3, migrations: { 2: () => {}, 3: () => {} } });
  await future.commit(change([[pid("a", 1), rec("Ema")]], { device: DEVICE }));
  future.close();
  const old = await openStorage(indexedDB, fakeLocks()); // this app only knows version 1
  assert.equal(old.state, "newer");
  await assert.rejects(old.commit(change([[pid("a", 2), rec("Adam")]])), err => err.code === "newer");
  old.close();
});

test("a second opener gets state locked", async () => {
  const indexedDB = new IDBFactory();
  const locks = fakeLocks();
  const first = await openStorage(indexedDB, locks);
  const second = await openStorage(indexedDB, locks);
  assert.equal(first.state, "ready");
  assert.equal(second.state, "locked");
  first.close();
  await new Promise(resolve => setTimeout(resolve, 0)); // the lock is released asynchronously
  const third = await openStorage(indexedDB, locks);
  assert.equal(third.state, "ready"); // closing the first released the lock
  third.close();
});

test("exportRaw works in state newer", async () => {
  const indexedDB = new IDBFactory();
  const future = await openStorage(indexedDB, fakeLocks(), { version: 3, migrations: { 2: () => {}, 3: () => {} } });
  await future.commit(change([[pid("a", 1), rec("Ema")]], { device: DEVICE, name: "Newer phone" }));
  future.close();
  const old = await openStorage(indexedDB, fakeLocks());
  assert.equal(old.state, "newer");
  const raw = await old.exportRaw();
  assert.equal(raw.records.length, 1);
  assert.equal(raw.records[0][1].f.g[0], "Ema");
  assert.equal(raw.meta.name, "Newer phone");
  assert.equal(raw.history.length, 1);
  old.close();
});
