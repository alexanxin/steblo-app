// Task 2.8: devices that sync end up identical (design: Testing 1; reference R5).
import test from "node:test";
import assert from "node:assert/strict";
import { simulate, syncAll, syncPair, makePhone, commit, difference, plainRecords, DAY } from "./fixtures/simulate.js";
import { generateTree } from "./fixtures/tree.js";
import { validateRecord } from "../public/src/records.js";
import { copyRecords, pid, T0 } from "./fixtures/helpers.js";

const SEEDS = Number(process.env.STEBLO_CONVERGENCE_SEEDS) || 50;
const ROUNDS = Number(process.env.STEBLO_CONVERGENCE_ROUNDS) || 70;

test("devices converge after everyone syncs with everyone", async () => {
  const total = {};
  let people = 0;
  let merged = 0;
  let erased = 0;
  let lost = 0;
  for (const devices of [3, 4]) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { phones, tally } = await simulate({ seed: seed * 10 + devices, devices, rounds: ROUNDS });
      await syncAll(phones);
      const [first, ...rest] = phones;
      for (const other of rest) assert.equal(difference(first, other), null, `seed ${seed}, ${devices} devices: ${first.device} vs ${other.device}`);
      for (const [name, n] of Object.entries(tally)) total[name] = (total[name] ?? 0) + n;
      const view = first.tree.view();
      people += view.people.size;
      merged += view.merged.size;
      for (const [, record] of first.tree.records()) if (record.kind === "person" && record.f.er) erased += 1;
      for (const phone of phones) for (const group of phone.history) lost += group.lost.length;
      // nothing is left to say: one more round changes nothing
      const before = plainRecords(first.tree.records());
      await syncAll(phones, { rounds: 1 });
      assert.equal(plainRecords(first.tree.records()), before, `seed ${seed}: a further sync changed records`);
    }
  }
  // the runs are not trivially empty, and every kind of thing happened
  for (const name of ["add", "addRelative", "edit", "delete", "restore", "merge", "notSame", "erase", "undo", "sync", "interrupted"]) {
    assert.ok(total[name] > 20, `${name} ran ${total[name]} times: ${JSON.stringify(total)}`);
  }
  assert.ok(people > 500, `people: ${people}`);
  assert.ok(merged > 20, `merged: ${merged}`);
  assert.ok(erased > 20, `erased: ${erased}`);
  assert.ok(lost > 20, `lost values logged: ${lost}`);
});

test("a sync interrupted after step 2 heals at the next sync", async () => {
  const a = makePhone({ device: pid("d", 1), prefix: "a" });
  const b = makePhone({ device: pid("d", 2), prefix: "b", start: T0 + 60_000 });
  const x = a.h.add({ g: "Ема" });
  b.h.add({ g: "Адам" });
  const half = await syncPair(a, b, { stopAfter: "step2" });
  assert.equal(half.stage, 2);
  // a holds b's person now; b has not heard from a
  assert.equal(a.tree.view().people.size, 2);
  assert.equal(b.tree.view().people.size, 1);
  assert.equal(b.tree.view().people.has(x), false);
  assert.notEqual(difference(a, b), null);
  // the same sync again: a has nothing new to take, and sends what b is missing
  const again = await syncPair(a, b);
  assert.equal(again.applied.summary.newPeople, 0);
  assert.equal(again.back.summary.newPeople, 1);
  assert.equal(difference(a, b), null);
  // and an interruption right after the hello changes nothing at all
  const before = plainRecords(a.tree.records());
  await syncPair(a, b, { stopAfter: "step1" });
  assert.equal(plainRecords(a.tree.records()), before);
});

test("a clock that was ahead converges after it is fixed", async () => {
  const e = makePhone({ device: pid("d", 1), prefix: "e", start: T0 });
  const d = makePhone({ device: pid("d", 2), prefix: "f", start: T0 });
  const shared = e.h.add({ g: "Ема", s: "Новаков" });
  await syncPair(e, d);
  assert.equal(difference(e, d), null);

  // d's clock jumps ten days ahead; it edits, deletes and adds
  d.wall.now = T0 + 10 * DAY;
  commit(d, d.tree.edit(shared, { g: "Лея" }));
  d.h.advance(1000);
  const fresh = d.h.add({ g: "Адам" });
  d.h.advance(1000);
  commit(d, d.tree.removePerson(fresh));
  d.h.advance(1000);
  commit(d, d.tree.restorePerson(fresh)); // delete then restore: the restore must stay later
  // meanwhile e makes a later edit in real time
  e.h.advance(60_000);
  commit(e, e.tree.edit(shared, { s: "Чарин" }));

  // the phones refuse to sync with clocks ten days apart, in either direction, and nothing moves
  const before = [plainRecords(e.tree.records()), plainRecords(d.tree.records())];
  assert.equal((await syncPair(e, d)).refused, "clocks");
  assert.equal((await syncPair(d, e)).refused, "clocks");
  assert.deepEqual([plainRecords(e.tree.records()), plainRecords(d.tree.records())], before);

  // d fixes its clock. The next sync re-stamps its own future times first, then converges.
  d.wall.now = T0 + 2 * 60_000;
  await syncPair(e, d);
  assert.equal(difference(e, d), null);
  const f = e.tree.records().get(shared).f;
  assert.equal(f.g[0], "Лея"); // d's edit survived (the re-stamp gave it a time in the present)
  assert.equal(f.s[0], "Чарин"); // e's edit to the other field too
  for (const [, record] of d.tree.records()) for (const t of Object.values(record.f)) assert.ok(t[1] <= T0 + DAY + 60_000);
  assert.equal(e.tree.view().people.has(fresh), true, "the restore still follows the delete");
  assert.equal(d.history.some(group => group.action === "restamp"), true);
});

test("a newer app with an extra field stays identical", async () => {
  const phones = [0, 1, 2].map(n => makePhone({ device: pid("d", n + 1), prefix: "abc"[n], start: T0 + n * 1000 }));
  const [newer, older, third] = phones;
  const x = newer.h.add({ g: "Ема" });
  const y = newer.h.add({ g: "Адам" });
  newer.h.addRel(x, "child", { g: "Лея" });
  // the newer app writes fields this version doesn't know: on a person, a link and a device record
  const link = [...newer.tree.records().keys()].find(id => id.startsWith("p:"));
  const records = newer.tree.records();
  records.set(x, { kind: "person", f: { ...records.get(x).f, xq: [{ deep: [1, 2] }, T0 + 5, 0, newer.device], zz: ["hi", T0 + 6, 0, newer.device] } });
  records.set(link, { kind: "parent", f: { ...records.get(link).f, ab: [3, T0 + 7, 0, newer.device] } });
  newer.h.advance(5000);
  commit(newer, newer.tree.setDeviceName("Нов телефон"));
  const dev = `d:${newer.device}`;
  records.set(dev, { kind: "device", f: { ...records.get(dev).f, qq: [true, T0 + 8, 0, newer.device] } });
  await syncAll(phones);
  for (const other of [older, third]) {
    assert.equal(difference(newer, other), null);
    assert.deepEqual(other.tree.records().get(x).f.xq, [{ deep: [1, 2] }, T0 + 5, 0, newer.device]);
    assert.deepEqual(other.tree.records().get(link).f.ab, [3, T0 + 7, 0, newer.device]);
    assert.deepEqual(other.tree.records().get(dev).f.qq, [true, T0 + 8, 0, newer.device]);
    // never shown
    assert.equal(JSON.stringify(other.tree.view()).includes("xq"), false);
  }
  // the older app edits that person, and the unknown fields ride along
  older.h.advance(20_000);
  commit(older, older.tree.edit(x, { g: "Миро" }));
  await syncAll(phones);
  for (const other of [newer, third]) assert.equal(difference(older, other), null);
  assert.equal(newer.tree.records().get(x).f.g[0], "Миро");
  assert.deepEqual(newer.tree.records().get(x).f.zz[0], "hi");
  assert.ok(y);
});

test("two devices with the same ID converge", async () => {
  // a restored backup, or a cloned phone: two devices that both write as d…01
  const one = makePhone({ device: pid("d", 1), prefix: "a", start: T0 });
  const two = makePhone({ device: pid("d", 1), prefix: "b", start: T0 });
  const other = makePhone({ device: pid("d", 2), prefix: "c", start: T0 });
  const x = one.h.add({ g: "Ема" });
  await syncAll([one, two, other]);
  assert.equal(difference(one, two), null);
  // the same instant, the same setter, different values: the tie is broken by the value, the same on every phone
  one.wall.now = two.wall.now = T0 + 60_000;
  commit(one, one.tree.edit(x, { g: "Лея", bp: "Скопје" }));
  commit(two, two.tree.edit(x, { g: "Адам", bp: "Бокупа" }));
  assert.deepEqual(one.tree.records().get(x).f.g.slice(1), two.tree.records().get(x).f.g.slice(1)); // really the same time and setter
  const nobody = two.h.add({ g: "Миро" }); // and each makes people with their own IDs
  one.h.add({ g: "Данило" });
  await syncAll([one, two, other]);
  assert.equal(difference(one, two), null);
  assert.equal(difference(one, other), null);
  assert.equal(one.tree.records().get(x).f.g[0], "Лея"); // "Лея" > "Адам" as JSON text
  assert.equal(one.tree.records().get(x).f.bp[0], "Скопје");
  assert.ok(one.tree.view().people.has(nobody));
});

test("a device that drops malformed items equals the others minus exactly those items", async () => {
  const phones = [0, 1, 2].map(n => makePhone({ device: pid("d", n + 1), prefix: "abc"[n], start: T0 + n * 1000 }));
  const [newer, ...others] = phones;
  const { records, ids } = generateTree({ people: 80, seed: 9, clocks: "hand" });
  for (const phone of phones) for (const [id, record] of copyRecords(records)) phone.tree.records().set(id, record);
  for (const phone of phones) phone.h.advance(100);
  const all = Array.from({ length: 256 }, (_, n) => n);

  // the newer app holds things this version refuses, on fields the others have no value for yet: a sex it
  // doesn't know, an empty note, a field of another kind, an erase mark on a link, a person ID of the wrong
  // shape, and a triple with a setter that is not a device
  const bad = [];
  const poke = (id, key, value) => {
    const record = newer.tree.records().get(id);
    newer.tree.records().set(id, { kind: record.kind, f: { ...record.f, [key]: [value, T0 + 1_000_000, 0, newer.device] } });
    bad.push([id, key]);
  };
  poke(ids[0], "sx", "Q");
  poke(ids[1], "nt", "");
  poke(ids[2], "md", { y: 1950 });
  const linkId = [...records.keys()].find(id => id.startsWith("p:"));
  poke(linkId, "er", true);
  newer.tree.records().set("zz", { kind: "person", f: { g: ["x", 1, 0, newer.device] } });
  newer.tree.records().set(ids[3], { kind: "person", f: { ...newer.tree.records().get(ids[3]).f, dp: ["Лея", T0 + 1_000_000, 0, "NOT-A-DEVICE"] } });
  bad.push([ids[3], "dp"]);
  // ordinary edits on the other phones too
  others[0].h.advance(60_000);
  commit(others[0], others[0].tree.edit(ids[10], { g: "Адам" }));
  commit(others[1], others[1].tree.edit(ids[11], { g: "Миро" }));

  await syncAll(phones);
  const [one, two] = others;
  assert.equal(difference(one, two), null);
  // the others equal the newer phone's records with exactly the malformed items cut out
  const expected = new Map();
  for (const [id, record] of newer.tree.records()) {
    const cleaned = validateRecord(id, record, { now: T0 + 10 * DAY }).record;
    if (cleaned && Object.keys(cleaned.f).length) expected.set(id, cleaned);
  }
  assert.deepEqual([...one.tree.records()].sort(([x], [y]) => (x < y ? -1 : 1)), [...expected].sort(([x], [y]) => (x < y ? -1 : 1)));
  // and they said so: the rejected items were counted at every sync that met them
  const rejected = [one, two].flatMap(p => p.reports).reduce((n, r) => n + r.rejected.invalid, 0);
  assert.ok(rejected >= 6, `rejected ${rejected}`);
  assert.equal(bad.length, 5);
  // the malformed items did not spread: not one reached the others
  assert.equal(one.tree.records().get(ids[0]).f.sx?.[0] === "Q", false);
  assert.equal(one.tree.records().has("zz"), false);
});
