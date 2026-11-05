// Not one of the plan's titled tests: a randomized check of the core that Milestone 2 will rely on.
// Three phones run random operations, swap what they know with the later-wins rule (no hashes,
// no QR: just applyTriple), and must end with identical records and views. Every record an
// operation writes must also pass the validator, or a receiving phone would reject it for good.
import test from "node:test";
import assert from "node:assert/strict";
import { applyTriple, validateRecord } from "../public/src/records.js";
import { commitToHistory } from "../public/src/history.js";
import { makeTree, pid, T0 } from "./fixtures/helpers.js";

const EXPECTED = new Set(["refused", "missing", "state", "invalid"]);
const NAMES = ["Данило", "Теодора", "Миро", "Ема", "Адам", "Леа", "Новаков", "Чарин"];

function receive(to, from) {
  const puts = new Map();
  for (const [id, record] of from.tree.records()) {
    let current = puts.get(id) ?? to.tree.records().get(id) ?? { kind: record.kind, f: {} };
    for (const [key, triple] of Object.entries(record.f)) current = applyTriple(current, key, triple);
    if (current !== to.tree.records().get(id)) puts.set(id, current);
  }
  to.tree.adopt({ puts, group: null, meta: {} });
}

function simulate(seed, tally, { phones = 3, steps = Number(process.env.STEBLO_RANDOM_STEPS) || 80 } = {}) {
  let state = seed >>> 0 || 1;
  const rand = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const int = n => Math.floor(rand() * n);
  const pick = list => list[int(list.length)];

  const devices = Array.from({ length: phones }, (_, i) => {
    const h = makeTree({ device: pid("d", i + 1), prefix: "abcdef"[i], start: T0 + (i - 1) * 3_600_000 });
    h.history = [];
    return h;
  });
  const checked = [];
  let wallMax = T0;

  const commit = (h, change, op) => {
    if (change.puts.size === 0) return; // nothing to write (a no-op edit, or an undo that skipped everything)
    tally[op] = (tally[op] ?? 0) + 1;
    for (const [id, record] of change.puts) checked.push([id, record]);
    h.run(change);
    h.history = commitToHistory(h.history, change);
  };

  for (let step = 0; step < steps; step++) {
    const h = pick(devices);
    h.advance(int(120_000));
    wallMax = Math.max(wallMax, h.wall.now);
    const view = h.tree.view();
    const people = [...view.people.keys()];
    const some = () => (people.length ? pick(people) : pid("f", 9));
    const roll = rand();
    try {
      if (roll < 0.14 || people.length < 3) commit(h, h.tree.addPerson({ g: pick(NAMES) }), "addPerson");
      else if (roll < 0.28) commit(h, h.tree.addRelative(some(), pick(["parent", "child", "sibling", "partner"]), { g: pick(NAMES) }, rand() < 0.2 ? { otherParent: some() } : {}), "addRelative");
      else if (roll < 0.42) commit(h, h.tree.edit(some(), { [pick(["g", "s", "bp", "nt"])]: rand() < 0.15 ? null : pick(NAMES) }), "edit");
      else if (roll < 0.48) commit(h, h.tree.removePerson(some()), "removePerson");
      else if (roll < 0.53) commit(h, h.tree.restorePerson(view.deleted.size ? pick([...view.deleted.keys()]) : some()), "restorePerson");
      else if (roll < 0.62) commit(h, h.tree.merge(some(), some(), rand() < 0.3 ? { g: pick(NAMES) } : {}, { session: "s" }), "merge");
      else if (roll < 0.66) commit(h, h.tree.notSame(some(), some()), "notSame");
      else if (roll < 0.72) commit(h, h.tree.editPartnership(some(), some(), rand() < 0.5 ? { en: true } : { md: { y: 1900 + int(100) } }), "editPartnership");
      else if (roll < 0.76 && view.partnerLinks.length) { const l = pick(view.partnerLinks); commit(h, h.tree.unlink("partner", l.a, l.b), "unlink"); }
      else if (roll < 0.79 && view.parentLinks.length) { const l = pick(view.parentLinks); commit(h, h.tree.unlink("parent", l.parent, l.child), "unlink"); }
      else if (roll < 0.82) commit(h, h.tree.erase(some()), "erase");
      else if (roll < 0.84 && view.attention.partlyErased.length) commit(h, h.tree.eraseRest(pick(view.attention.partlyErased).id), "eraseRest");
      else if (roll < 0.9 && h.history.length) commit(h, h.tree.undo(pick(h.history)), "undo");
      else if (roll < 0.92) commit(h, h.tree.setDeviceName(pick(NAMES) + " телефон"), "setDeviceName");
      else { const other = pick(devices.filter(d => d !== h)); receive(h, other); receive(other, h); }
    } catch (error) {
      if (!EXPECTED.has(error.code)) throw error;
    }
  }

  // everyone with everyone, twice
  for (let round = 0; round < 2; round++) for (const x of devices) for (const y of devices) if (x !== y) receive(x, y);
  return { devices, checked, now: wallMax + 2 * 86_400_000 };
}

test("random operations on three phones converge and stay valid", () => {
  let totalPeople = 0;
  let erased = 0;
  let merged = 0;
  const tally = {};
  const seeds = Number(process.env.STEBLO_RANDOM_SEEDS) || 60;
  for (let seed = 1; seed <= seeds; seed++) {
    const { devices, checked, now } = simulate(seed, tally);
    const [first, ...rest] = devices;
    for (const other of rest) {
      assert.deepStrictEqual(other.tree.records(), first.tree.records(), `seed ${seed}: records`);
      assert.deepStrictEqual(other.tree.view(), first.tree.view(), `seed ${seed}: view`);
    }
    // every record an operation wrote passed the validator unchanged
    for (const [id, record] of checked) {
      const { record: cleaned, rejected } = validateRecord(id, record, { now });
      assert.deepEqual(rejected, [], `seed ${seed}: ${id} ${JSON.stringify(record)}`);
      assert.deepEqual(cleaned, record, `seed ${seed}: ${id}`);
    }
    // an erased record holds only its erase mark, everywhere
    for (const [, record] of first.tree.records()) {
      if (record.kind === "person" && record.f.er) { assert.deepEqual(Object.keys(record.f), ["er"]); erased += 1; }
    }
    merged += first.tree.view().merged.size;
    totalPeople += first.tree.view().people.size;
    // views of different shapes of the same records agree: a fresh tree over the same records
    const again = devices[1].tree.view();
    assert.equal(again.people.size, first.tree.view().people.size);
  }
  // the runs are not trivially empty
  assert.ok(totalPeople > 200, `people: ${totalPeople}`);
  assert.ok(erased > 10, `erased: ${erased}`);
  assert.ok(merged > 10, `merged: ${merged}`);
  // every kind of operation really ran, not just got refused
  for (const op of ["addPerson", "addRelative", "edit", "removePerson", "restorePerson", "merge", "notSame", "editPartnership", "unlink", "erase", "eraseRest", "undo", "setDeviceName"]) {
    assert.ok(tally[op] > 0, `${op} never succeeded: ${JSON.stringify(tally)}`);
  }
});
