// A few simulated phones that run seeded random operations and sync the way the app does (task 2.8).
// A sync here is the real three steps with the real hello, hashes, payload, envelope and re-stamp:
//   1. A shows its hello.  2. B answers with its hello and every record of the buckets that differ,
//   sealed.  3. A applies that, and sends back only what differs, sealed.  B applies it.
// Only the QR frames are missing (tests/e2e-sync.test.js does those). Task 4.6 adds more `ops`.
import {
  applyPayload, bucketHashes, buildDiff, buildPayload, clocksAgree, differingBuckets, makeHello, makeStep2,
  packPayload, parseHello, readStep2, restamp, unpackPayload,
} from "../../public/src/sync.js";
import { deriveKey, newSession, open, seal } from "../../public/src/envelope.js";
import { commitToHistory } from "../../public/src/history.js";
import assert from "node:assert/strict";
import { canonicalJson } from "../../public/src/clock.js";
import { makeTree, pid, T0 } from "./helpers.js";
import { readFileSync } from "node:fs";
import { importGedcom } from "../../public/src/gedcom.js";
import { restoreBackup, validateBackup, writeBackup } from "../../public/src/backup.js";

const EXPECTED = new Set(["refused", "missing", "state", "invalid"]); // operations that rightly say no
const NAMES = ["Данило", "Теодора", "Миро", "Ема", "Адам", "Лея", "Новаков", "Чарин"];
const DAY = 86_400_000;

/** A phone: a tree on its own manual clock, plus the History it keeps. */
export function makePhone({ device, prefix, start = T0, records } = {}) {
  const h = makeTree({ device, prefix, start, records });
  // `h` is replaced when the phone restores a backup (task 4.6), so the getters look it up each time
  return { h, device, get tree() { return this.h.tree; }, get wall() { return this.h.wall; }, history: [], reports: [] };
}

/** Adopt a change and record it in History, as storage would in one transaction. */
export function commit(phone, change) {
  if (!change || (change.puts.size === 0 && !change.group)) return false;
  phone.h.run(change);
  phone.history = commitToHistory(phone.history, change);
  return true;
}

export const plainRecords = records => canonicalJson([...records].sort(([x], [y]) => (x < y ? -1 : 1)));

/** Records and view must be identical. Returns a short reason when they aren't, else null. */
export function difference(a, b) {
  if (plainRecords(a.tree.records()) !== plainRecords(b.tree.records())) return "records";
  try {
    assert.deepStrictEqual(a.tree.view(), b.tree.view());
  } catch {
    return "view";
  }
  return null;
}

/**
 * One sync of phone `a` (shows first) with phone `b` (answers), step by step.
 * `stopAfter`: "step1" (b read the hello and re-stamped, then the codes stopped), "step2" (a applied b's data,
 * step 3 never arrived), or null for the whole thing. `carry(bytes, step)` moves a stream from one phone to
 * the other (the end-to-end test sends it through QR images). → { refused?, stage, applied?, back? }
 */
export async function syncPair(a, b, { stopAfter = null, allowErase = true, carry = async bytes => bytes } = {}) {
  const A = a.h;
  const B = b.h;
  const sa = await newSession();
  const sb = await newSession();

  // ---- step 1: a shows its hello
  const helloA = makeHello({ device: a.device, app: "sim", now: A.wall.now, publicKey: sa.publicKey, nonce: sa.nonce, hashes: await bucketHashes(A.tree.records()) });
  const heardA = parseHello(await carry(helloA, 1));

  // ---- b reads it. If the clocks disagree, b shows a hello-only stream and nobody sends data.
  if (!clocksAgree({ w: B.wall.now }, heardA)) {
    const helloB = makeHello({ device: b.device, app: "sim", now: B.wall.now, publicKey: sb.publicKey, nonce: sb.nonce, hashes: await bucketHashes(B.tree.records()) });
    const stream = readStep2(makeStep2(helloB, null));
    const heardB = parseHello(stream.helloBytes);
    return { refused: "clocks", stage: 1, agree: clocksAgree(heardA, heardB) };
  }
  commit(b, restamp(B.tree, B.wall.now));
  const hashesB = await bucketHashes(B.tree.records());
  const helloB = makeHello({ device: b.device, app: "sim", now: B.wall.now, publicKey: sb.publicKey, nonce: sb.nonce, hashes: hashesB });
  const buckets = differingBuckets(hashesB, heardA);
  const keyB = await deriveKey(sb, heardA.k, heardA.n, sb.nonce);
  const sealed2 = await seal(keyB, 2, helloA, helloB, await packPayload(buildPayload(B.tree.records(), buckets)));
  const step2 = makeStep2(helloB, sealed2);
  if (stopAfter === "step1") return { stage: 1 };

  // ---- step 2: a reads b's hello and data
  const read = readStep2(await carry(step2, 2));
  const heardB = parseHello(read.helloBytes);
  if (!clocksAgree(heardA, heardB)) return { refused: "clocks", stage: 2 };
  commit(a, restamp(A.tree, A.wall.now));
  const keyA = await deriveKey(sa, heardB.k, sa.nonce, heardB.n);
  const payload2 = await unpackPayload(await open(keyA, 2, helloA, read.helloBytes, read.message));
  const applied = applyPayload(A.tree, payload2, { now: A.wall.now, helloW: heardB.w, allowErase });
  commit(a, applied.change);
  a.reports.push(applied.summary);
  if (stopAfter === "step2") return { stage: 2, applied };

  // ---- step 3: a sends back only what differs; b applies it
  const sealed3 = await seal(keyA, 3, helloA, read.helloBytes, await packPayload(buildDiff(A.tree.records(), payload2, payload2.b)));
  const payload3 = await unpackPayload(await open(keyB, 3, helloA, helloB, await carry(sealed3, 3)));
  const back = applyPayload(B.tree, payload3, { now: B.wall.now, helloW: heardA.w, allowErase });
  commit(b, back.change);
  b.reports.push(back.summary);
  return { stage: 3, applied, back };
}

/** Everyone with everyone, both ways, twice. Enough for any number of phones. */
export async function syncAll(phones, { rounds = 2 } = {}) {
  for (let round = 0; round < rounds; round++) {
    for (const a of phones) for (const b of phones) if (a !== b) await syncPair(a, b);
  }
}

// ---------------------------------------------------------------- random operations

/** Each op gets (sim, phone) and may throw an expected "no". Add more with `extra` in simulate(). */
export const OPS = {
  add: (sim, p) => commit(p, p.tree.addPerson({ g: sim.pick(NAMES) })),
  addRelative: (sim, p) => commit(p, p.tree.addRelative(sim.somebody(p), sim.pick(["parent", "child", "sibling", "partner"]), { g: sim.pick(NAMES) }, sim.rand() < 0.2 ? { otherParent: sim.somebody(p) } : {})),
  edit: (sim, p) => commit(p, p.tree.edit(sim.somebody(p), { [sim.pick(["g", "s", "bp", "nt"])]: sim.rand() < 0.15 ? null : sim.pick(NAMES) })),
  editPartnership: (sim, p) => commit(p, p.tree.editPartnership(sim.somebody(p), sim.somebody(p), sim.rand() < 0.5 ? { en: true } : { md: { y: 1900 + sim.int(100) } })),
  delete: (sim, p) => commit(p, p.tree.removePerson(sim.somebody(p))),
  restore: (sim, p) => commit(p, p.tree.restorePerson(sim.somebodyDeleted(p))),
  merge: (sim, p) => commit(p, p.tree.merge(sim.somebody(p), sim.somebody(p), sim.rand() < 0.3 ? { g: sim.pick(NAMES) } : {}, { session: "s" })),
  notSame: (sim, p) => commit(p, p.tree.notSame(sim.somebody(p), sim.somebody(p))),
  unlink: (sim, p) => {
    const v = p.tree.view();
    const links = [...v.parentLinks.map(l => ["parent", l.parent, l.child]), ...v.partnerLinks.map(l => ["partner", l.a, l.b])];
    if (!links.length) return false;
    return commit(p, p.tree.unlink(...sim.pick(links)));
  },
  erase: (sim, p) => commit(p, p.tree.erase(sim.somebody(p))),
  eraseRest: (sim, p) => {
    const partly = p.tree.view().attention.partlyErased;
    if (!partly.length) return false;
    return commit(p, p.tree.eraseRest(sim.pick(partly).id));
  },
  undo: (sim, p) => (p.history.length ? commit(p, p.tree.undo(sim.pick(p.history))) : false),
  deviceName: (sim, p) => commit(p, p.tree.setDeviceName(sim.pick(NAMES) + " телефон")),
  sync: (sim, p) => sim.syncWith(p, {}),
  interrupted: (sim, p) => sim.syncWith(p, { stopAfter: sim.pick(["step1", "step2", "step2"]) }),
};

// ---------------------------------------------------------------- file operations (task 4.6)
// Pass FILE_OPS as `extra` to simulate(): a phone imports one of three invented GEDCOM files, or restores a backup
// under a new device ID. They overlap on purpose: MyHeritage and Gramps share _UIDs, so imports match people.
const GED_FILES = ["myheritage", "gramps", "uds2gedcom"].map(name => new Uint8Array(readFileSync(new URL(`./${name}.ged`, import.meta.url))));
const SETTINGS = { lang: "en", latin: false };

export const FILE_OPS = {
  import: async (sim, p) => {
    const result = await importGedcom(p.tree, sim.pick(GED_FILES), { now: p.wall.now, newId: sim.freshId });
    return commit(p, result.change);
  },
  /** Back up, then restore: the phone's own current state, or (half the time) the backup it took last time, which is stale. */
  restore: async (sim, p) => {
    const fresh = writeBackup({ records: p.tree.records(), meta: { name: p.tree.name, thisIsMe: null, settings: SETTINGS }, history: p.history, createdAt: p.wall.now });
    const source = p.snapshot && sim.rand() < 0.5 ? p.snapshot : fresh;
    p.snapshot = fresh;
    const checked = validateBackup(source, { now: p.wall.now });
    assert.equal(checked.ok, true, JSON.stringify(checked.errors.slice(0, 3)));
    const device = pid("7", ++sim.restores);
    const restored = restoreBackup(checked.valid, { device, name: p.tree.name, now: p.wall.now });
    p.h = makeTree({ device, name: restored.meta.name, records: restored.records, prefix: "9", start: p.wall.now, from: sim.restores * 1_000_000 });
    p.device = device;
    p.history = restored.history;
    return true;
  },
};

// Weights: how often each op comes up in a run.
const WEIGHTS = { add: 4, addRelative: 8, edit: 12, editPartnership: 4, delete: 4, restore: 3, merge: 6, notSame: 3, unlink: 3, erase: 2, eraseRest: 1, undo: 6, deviceName: 2, sync: 14, interrupted: 5 };

/**
 * simulate({ seed, devices, rounds, ops, extra }) → { phones, tally, sim }
 * `ops` limits which ops run (names); `extra` adds ops: { name: (sim, phone) => … } with weight 4.
 * Phones start with clocks up to an hour apart and drift as they act; none gets a day apart.
 */
export async function simulate({ seed, devices = 3, rounds = 60, ops, extra = {}, setup } = {}) {
  let state = (seed >>> 0) || 1;
  const sim = {
    rand: () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296,
    int: n => Math.floor(sim.rand() * n),
    pick: list => list[sim.int(list.length)],
    tally: {},
    phones: [],
    restores: 0,
    ids: 0,
    freshId: () => pid("8", ++sim.ids),
    somebody: p => {
      const ids = [...p.tree.view().people.keys()];
      return ids.length ? sim.pick(ids) : pid("f", 9);
    },
    somebodyDeleted: p => {
      const ids = [...p.tree.view().deleted.keys()];
      return ids.length ? sim.pick(ids) : sim.somebody(p);
    },
    async syncWith(p, options) {
      const other = sim.pick(sim.phones.filter(x => x !== p));
      const [a, b] = sim.rand() < 0.5 ? [p, other] : [other, p];
      const result = await syncPair(a, b, options);
      sim.tally[options.stopAfter ? "interrupted" : "sync"] = (sim.tally[options.stopAfter ? "interrupted" : "sync"] ?? 0) + 1;
      return result;
    },
  };
  sim.phones = Array.from({ length: devices }, (_, i) => makePhone({ device: pid("d", i + 1), prefix: "abcdef"[i], start: T0 + (i - 1) * 3_600_000 }));
  if (setup) setup(sim);

  const all = { ...OPS, ...extra };
  const names = (ops ?? Object.keys(all)).filter(name => all[name]);
  const bag = names.flatMap(name => Array(WEIGHTS[name] ?? 4).fill(name));
  for (let round = 0; round < rounds; round++) {
    const phone = sim.pick(sim.phones);
    phone.h.advance(sim.int(120_000));
    // the first few steps always make people, so there is something to do
    const name = sim.phones.every(p => p.tree.view().people.size < 3) ? "add" : sim.pick(bag);
    try {
      const before = sim.tally[name] ?? 0;
      const result = await all[name](sim, phone);
      if (result !== false && name !== "sync" && name !== "interrupted") sim.tally[name] = before + 1;
    } catch (error) {
      if (!EXPECTED.has(error.code)) throw error;
    }
  }
  return { phones: sim.phones, tally: sim.tally, sim };
}

export { DAY };
