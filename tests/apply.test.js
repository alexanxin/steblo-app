// Task 2.4: applying a payload (reference R5 Applying, Losing values; R3; R11).
import test from "node:test";
import assert from "node:assert/strict";
import { applyPayload, buildPayload, bucketHashes, differingBuckets, parseHello, makeHello } from "../public/src/sync.js";
import { bucketOf, validateRecord } from "../public/src/records.js";
import { commitToHistory } from "../public/src/history.js";
import { makeTree, copyRecords, pid, T0 } from "./fixtures/helpers.js";

const ALL = Array.from({ length: 256 }, (_, n) => n);
const D1 = pid("d", 1);
const D2 = pid("d", 2);

/** Two phones. `b` starts from a copy of what `a` has when `shared` is true. */
function twoPhones({ shared = true, setup } = {}) {
  const a = makeTree({ device: D1, prefix: "a" });
  const ids = setup ? setup(a) : {};
  const b = makeTree({ device: D2, prefix: "b", records: shared ? copyRecords(a.tree.records()) : new Map(), start: T0 + 5000 });
  return { a, b, ids };
}
const send = (from, to, opts = {}) => applyPayload(to.tree, buildPayload(from.tree.records(), ALL), { now: to.wall.now, helloW: from.wall.now, allowErase: true, ...opts });
const take = (from, to, opts) => { const result = send(from, to, opts); to.run(result.change); return result; };
const plain = records => JSON.parse(JSON.stringify([...records].sort(([x], [y]) => (x < y ? -1 : 1))));

test("applying is idempotent", () => {
  const { a, b } = twoPhones({ shared: false, setup: h => {
    const p = h.add({ g: "Данило", s: "Новаков" });
    h.addRel(p, "child", { g: "Ема" });
    h.addRel(p, "partner", { g: "Теодора" });
    return { p };
  } });
  const first = take(a, b);
  assert.equal(first.summary.newPeople, 3);
  const afterOne = plain(b.tree.records());
  assert.deepEqual(afterOne, plain(a.tree.records()));
  const second = send(a, b);
  assert.equal(second.change.puts.size, 0);
  assert.equal(second.change.group, null);
  assert.deepEqual(second.summary, { newPeople: 0, changedFields: 0, lost: 0, rejected: { clock: 0, invalid: 0 } });
  assert.equal(second.incoming.size, 0);
  b.run(second.change);
  assert.deepEqual(plain(b.tree.records()), afterOne);
  // the applied records are shared, not rebuilt: a record that came in is the same object a later no-op leaves
  assert.equal(second.erases.length, 0);
});

test("later triples win, per field", () => {
  const { a, b, ids } = twoPhones({ setup: h => ({ x: h.add({ g: "Ема", s: "Новаков" }) }) });
  a.advance(10_000);
  a.run(a.tree.edit(ids.x, { g: "Лея", bp: "Скопје" }));
  b.advance(20_000);
  b.run(b.tree.edit(ids.x, { g: "Адам", s: "Чарин" }));
  // a's g came first, b's g later: b's wins. a's bp and b's s are on different fields: both stay.
  const intoA = take(b, a);
  const intoB = take(a, b);
  for (const h of [a, b]) {
    const f = h.get(ids.x).f;
    assert.equal(f.g[0], "Адам");
    assert.equal(f.s[0], "Чарин");
    assert.equal(f.bp[0], "Скопје");
  }
  assert.deepEqual(plain(a.tree.records()), plain(b.tree.records()));
  assert.equal(intoA.summary.changedFields, 2); // g and s changed on a
  assert.equal(intoB.summary.changedFields, 1); // only bp is new on b; g from a lost
});

test("a replaced value is logged by the phone that held it", () => {
  const { a, b, ids } = twoPhones({ setup: h => ({ x: h.add({ g: "Ема" }) }) });
  a.advance(10_000);
  a.run(a.tree.edit(ids.x, { g: "Лея" }));
  b.advance(20_000);
  b.run(b.tree.edit(ids.x, { g: "Адам" }));
  const loserTriple = a.get(ids.x).f.g;
  const winnerTriple = b.get(ids.x).f.g;
  // a receives b's later value: a held the loser, so a logs it
  const intoA = send(b, a);
  assert.equal(intoA.summary.lost, 1);
  assert.deepEqual(intoA.change.group.lost, [{ r: ids.x, f: "g", loser: loserTriple, winner: winnerTriple }]);
  assert.equal(intoA.change.group.action, "sync");
  assert.equal(intoA.change.group.device, D1);
  assert.deepEqual(intoA.change.group.changes, [{ r: ids.x, f: "g", before: loserTriple, after: winnerTriple }]);
  // b receives a's older value: it keeps its own, changes nothing and has nothing to log
  const intoB = send(a, b);
  assert.equal(intoB.change.puts.size, 0);
  assert.equal(intoB.summary.lost, 0);
  assert.equal(intoB.change.group, null);
  // the log is part of History and survives as data the phone keeps
  const history = commitToHistory([], intoA.change);
  assert.equal(history[0].lost[0].loser[0], "Лея");
});

test("equal values aren't logged as lost", () => {
  const { a, b, ids } = twoPhones({ setup: h => ({ x: h.add({ g: "Ема" }) }) });
  a.advance(10_000);
  a.run(a.tree.edit(ids.x, { g: "Лея" }));
  b.advance(20_000);
  b.run(b.tree.edit(ids.x, { g: "Лея" })); // the same value, a later time
  const intoA = send(b, a);
  assert.equal(intoA.summary.lost, 0);
  assert.deepEqual(intoA.change.group.lost, []);
  assert.equal(intoA.summary.changedFields, 1); // the later time still replaces the older one
  a.run(intoA.change);
  assert.deepEqual(a.get(ids.x).f.g, b.get(ids.x).f.g);
});

/** A payload for phone `b` holding records that a validating phone must refuse in part. */
function badRecords(now) {
  const t = (v, ms = now, by = D2) => [v, ms, 0, by];
  const ok = pid("e", 1);
  const badSex = pid("e", 2);
  const future = pid("e", 3);
  return {
    ok, badSex, future,
    records: new Map([
      [ok, { kind: "person", f: { g: t("Данило"), del: t(false) } }],
      [badSex, { kind: "person", f: { g: t("Теодора"), sx: t("Q"), bp: t("") } }], // 2 bad fields, 1 good
      [future, { kind: "person", f: { g: t("Миро", now + 10 * 86_400_000), s: t("Новаков") } }], // 1 field too far ahead
      [`p:${ok}:${badSex}`, { kind: "parent", f: { del: t(false), er: t(true) } }], // er is not a link field
    ]),
  };
}

test("rejected items aren't stored and are counted per reason", () => {
  const { a } = twoPhones({ shared: false });
  const bad = badRecords(a.wall.now);
  const result = applyPayload(a.tree, buildPayload(bad.records, ALL), { now: a.wall.now, helloW: a.wall.now });
  // clock: the far-future name. invalid: sex "Q", the empty place, and an erase mark on a link.
  assert.deepEqual(result.summary.rejected, { clock: 1, invalid: 3 });
  const puts = result.change.puts;
  assert.deepEqual(Object.keys(puts.get(bad.badSex).f).sort(), ["g"]);
  assert.deepEqual(Object.keys(puts.get(bad.future).f), ["s"]);
  assert.deepEqual(Object.keys(puts.get(`p:${bad.ok}:${bad.badSex}`).f), ["del"]);
  // nothing in the change fails the validator
  for (const [id, record] of puts) assert.deepEqual(validateRecord(id, record, { now: a.wall.now }), { record, rejected: [] });
  // adopting stores only what was accepted
  a.run(result.change);
  assert.equal(a.get(bad.badSex).f.sx, undefined);
  assert.equal(a.get(bad.future).f.g, undefined);
});

test("a rejected item's bucket keeps differing", async () => {
  const { a } = twoPhones({ shared: false });
  const bad = badRecords(a.wall.now);
  const result = applyPayload(a.tree, buildPayload(bad.records, ALL), { now: a.wall.now, helloW: a.wall.now });
  a.run(result.change);
  const theirs = await bucketHashes(bad.records);
  const mine = await bucketHashes(a.tree.records());
  const hello = parseHello(makeHello({ device: D2, app: "t", now: a.wall.now, publicKey: new Uint8Array(65), nonce: new Uint8Array(16), hashes: theirs }));
  const differing = differingBuckets(mine, hello);
  assert.ok(differing.includes(bucketOf(bad.badSex)));
  // everything else is in sync: the only differing bucket is the one holding the refused fields
  assert.deepEqual(differing, [bucketOf(bad.badSex)]);
});

test("erases aren't applied unless allowed, and are listed", () => {
  const { a, b, ids } = twoPhones({ setup: h => ({ x: h.add({ g: "Ема", s: "Чарин", nt: "тајна" }), y: h.add({ g: "Адам" }) }) });
  a.advance(10_000);
  a.run(a.tree.erase(ids.x));
  assert.deepEqual(Object.keys(a.get(ids.x).f), ["er"]);
  // not allowed: listed, not applied
  const asked = send(a, b, { allowErase: false });
  assert.deepEqual(asked.erases, [ids.x]);
  assert.equal(asked.change.puts.has(ids.x), false);
  b.run(asked.change);
  assert.equal(b.get(ids.x).f.g[0], "Ема");
  // allowed: the record keeps only its erase mark, and History says so without details
  const done = send(a, b, { allowErase: true });
  assert.deepEqual(done.erases, [ids.x]);
  b.run(done.change);
  assert.deepEqual(Object.keys(b.get(ids.x).f), ["er"]);
  assert.deepEqual(b.get(ids.x), a.get(ids.x));
  assert.ok(done.change.group.changes.some(c => c.r === ids.x && c.erased === true));
  assert.equal(JSON.stringify(done.change.group).includes("Чарин"), false);
  // an erase of someone this phone doesn't hold is stored without asking, and isn't listed
  const c = makeTree({ device: pid("d", 3), prefix: "c" });
  const unheld = send(a, c, { allowErase: false });
  assert.deepEqual(unheld.erases, []);
  assert.deepEqual(Object.keys(unheld.change.puts.get(ids.x).f), ["er"]);
  // applying the same erase again asks nothing
  assert.deepEqual(send(a, b, { allowErase: false }).erases, []);
});

test("applying returns incoming IDs, new groups and gained relatives", () => {
  const { a, b, ids } = twoPhones({ setup: h => {
    const p = h.add({ g: "Данило" });
    const p2 = h.add({ g: "Новаков" });
    return { p, p2 };
  } });
  // a gets a child for the shared person, a family of three nobody on b knows, and one loner
  const child = a.addRel(ids.p, "child", { g: "Ема" });
  const q1 = a.add({ g: "Адам" });
  const q2 = a.addRel(q1, "child", { g: "Лея" });
  const q3 = a.addRel(q2, "child", { g: "Миро" });
  const lone = a.add({ g: "Теодора" });
  // a family of two that hangs off the shared person is not a new group: it is linked to someone here
  const grandchild = a.addRel(child, "child", { g: "Лея" });
  // a link b already holds, to a person it didn't hold: the person arrives, but the link isn't new
  const late = a.addRel(ids.p2, "parent", { g: "Миро" });
  const lateLink = `p:${late}:${ids.p2}`;
  b.tree.records().set(lateLink, structuredClone(a.get(lateLink)));
  const result = send(a, b);
  const want = [...a.tree.records().keys()].filter(id => !b.tree.records().has(id));
  assert.deepEqual([...result.incoming].sort(), want.sort());
  assert.equal(result.incoming.has(ids.p), false);
  assert.deepEqual(result.newGroups, [{ ids: [q1, q2, q3].sort(), size: 3 }]);
  assert.deepEqual(result.gainedRelatives, [ids.p]); // the child's link is new; the parent's link was already there
  assert.equal(result.incoming.has(lateLink), false);
  assert.equal(result.incoming.has(late), true);
  assert.equal(result.summary.newPeople, 7);
  assert.ok(![...result.newGroups.flatMap(g => g.ids)].includes(grandchild), "a group linked to someone here isn't new");
  assert.ok(![...result.newGroups.flatMap(g => g.ids)].includes(lone), "a single person isn't a group");
  assert.ok(![...result.newGroups.flatMap(g => g.ids)].includes(child), "a person linked to someone here isn't a new group");
  // a bigger group comes first
  const q4 = a.addRel(q3, "child", { g: "Ема" });
  a.addRel(q4, "child", { g: "Лея" });
  const other = a.add({ g: "Данило" });
  a.addRel(other, "partner", { g: "Адам" });
  const second = send(a, b);
  assert.deepEqual(second.newGroups.map(g => g.size), [5, 2]);
});

test("a hostile payload is rejected", () => {
  const { a } = twoPhones({ shared: false });
  const now = a.wall.now;
  const run = payload => applyPayload(a.tree, payload, { now, helloW: now });
  const base = { f: 1, b: [], dv: [D2], c: [[now, 0, 0]], i: [pid("e", 1), pid("e", 2)], p: [], l: [], x: [], d: [] };

  // the payload as a whole
  for (const payload of [null, [], "x", 5, { f: 2 }, { ...base, p: {} }, { ...base, l: "no" }, { ...base, b: [256] }, { ...base, b: [1.5] }]) {
    assert.throws(() => run(payload), error => error.code === "payload", JSON.stringify(payload));
  }
  // over 200,000 records
  const crowd = Array.from({ length: 200_001 }, () => [0, 0, { g: "x" }]);
  assert.throws(() => run({ ...base, p: crowd }), error => error.code === "payload");
  assert.equal(run({ ...base, p: crowd.slice(0, 5) }) !== null, true);

  // single items: counted as rejected, never stored
  const reject = (payload, expected) => {
    const result = run(payload);
    assert.equal(result.change.puts.size, 0, JSON.stringify(payload).slice(0, 120));
    assert.equal(result.summary.rejected.invalid, expected, JSON.stringify(payload).slice(0, 120));
  };
  reject({ ...base, i: ["zz", "yy"], p: [[0, 0, { g: "x" }]] }, 1); // a bad person ID
  reject({ ...base, p: [[7, 0, { g: "x" }]] }, 1); // index out of range
  reject({ ...base, p: [[0, 5, { g: "x" }]] }, 1); // clock out of range
  reject({ ...base, p: [[0, 0, [1, 2]]] }, 1); // fields not an object
  reject({ ...base, p: ["no"] }, 1);
  reject({ ...base, l: [["p", 0, 9, 0, { del: false }]] }, 1); // link to nothing
  reject({ ...base, l: [["z", 0, 1, 0, { del: false }]] }, 1); // not a link kind
  reject({ ...base, l: [["u", 1, 0, 0, { del: false }]] }, 1); // a partner pair out of order
  reject({ ...base, x: [["p", 0, 1, 0, { del: false }]] }, 1); // a parent link in the wrong list
  reject({ ...base, p: [[0, 0, { g: 5 }]] }, 1); // wrong type
  reject({ ...base, p: [[0, 0, { zzzzz: 1 }]] }, 1); // a field name that is not [a-z]{1,4}
  reject({ ...base, p: [[0, 0, { Ab: 1 }]] }, 1);
  reject({ ...base, p: [[0, 0, { er: false }]] }, 1);
  reject({ ...base, c: [[-1, 0, 0]], p: [[0, 0, { g: "x" }]] }, 1); // a negative difference breaks the table
  reject({ ...base, dv: ["X"], c: [[now, 0, 0]], p: [[0, 0, { g: "x" }]] }, 1); // a bad setter
  // extra fields: more than 4 unknown on one record
  const five = { aa: 1, bb: 1, cc: 1, cd: 1, ee: 1 };
  const result = run({ ...base, p: [[0, 0, five]] });
  assert.deepEqual(Object.keys(result.change.puts.get(base.i[0]).f), ["aa", "bb", "cc", "cd"]);
  assert.equal(result.summary.rejected.invalid, 1);
  // deep nesting
  reject({ ...base, p: [[0, 0, { aa: [[[[[1]]]]] }]] }, 1);
  const deep = JSON.parse(`{"aa":${"[".repeat(5000)}1${"]".repeat(5000)}}`);
  reject({ ...base, p: [[0, 0, deep]] }, 1);
  assert.equal(run({ ...base, p: [[0, 0, { aa: [[[1]]] }]] }).change.puts.size, 1); // 4 deep is fine
  // __proto__ keys, in fields, in overrides, and in the payload itself
  const proto = JSON.parse('{"f":1,"b":[],"dv":["' + D2 + '"],"c":[[1,0,0]],"i":["' + pid("e", 1) + '"],"p":[[0,0,{"__proto__":{"polluted":true},"g":"x"}]],"__proto__":{"polluted":true}}');
  const hit = run(proto);
  assert.equal(hit.summary.rejected.invalid, 1);
  assert.deepEqual(Object.keys(hit.change.puts.get(pid("e", 1)).f), ["g"]);
  assert.equal(Object.getPrototypeOf(hit.change.puts.get(pid("e", 1)).f), Object.prototype);
  assert.equal({}.polluted, undefined);
  const overrideProto = JSON.parse('{"f":1,"dv":["' + D2 + '"],"c":[[1,0,0]],"i":["' + pid("e", 1) + '"],"p":[[0,0,{"g":"x"},{"__proto__":["y",0]}]]}');
  assert.equal(run(overrideProto).summary.rejected.invalid, 1);
  assert.equal({}.polluted, undefined);
  // nothing was ever adopted by the rejected runs
  assert.equal(a.tree.records().size, 0);
});

test("unknown fields on a stored record stay bounded across syncs", () => {
  const { a } = twoPhones({ shared: false });
  const x = pid("e", 1);
  const t = (v, ms = 100) => [v, ms, 0, D2];
  const record = fields => new Map([[x, { kind: "person", f: { g: t("Ема"), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, t(v)])) } }]]);
  const feed = (h, fields) => { const r = applyPayload(h.tree, buildPayload(record(fields), ALL), { now: h.wall.now, helloW: h.wall.now }); h.run(r.change); return r; };
  const unknown = h => Object.keys(h.get(x).f).filter(k => k !== "g").sort();

  feed(a, { bb: 1, cd: 2, ff: 3, hh: 4 });
  assert.deepEqual(unknown(a), ["bb", "cd", "ff", "hh"]);
  // a key that sorts after the four is dropped, and counted, and changes nothing
  const late = applyPayload(a.tree, buildPayload(record({ zz: 9 }), ALL), { now: a.wall.now, helloW: a.wall.now });
  assert.equal(late.change.puts.size, 0);
  assert.equal(late.summary.rejected.invalid, 1);
  // a key that sorts before pushes the largest one out
  feed(a, { aa: 1 });
  assert.deepEqual(unknown(a), ["aa", "bb", "cd", "ff"]);
  // repeating changes nothing
  assert.equal(applyPayload(a.tree, buildPayload(record({ aa: 1, bb: 1 }), ALL), { now: a.wall.now, helloW: a.wall.now }).change.puts.size, 0);

  // any order of arrival gives the same four
  const order = [{ cd: 1, ee: 1 }, { aa: 1, ff: 1 }, { bb: 1, cc: 1, zz: 1 }, { ab: 1, yy: 1 }];
  const results = new Set();
  for (const perm of [[0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]) {
    const h = makeTree({ device: pid("d", 9), prefix: "z" });
    for (const n of perm) feed(h, order[n]);
    results.add(JSON.stringify(unknown(h)));
  }
  assert.deepEqual([...results], [JSON.stringify(["aa", "ab", "bb", "cc"])]);
  // a record is also bounded by size: unknown fields over 4 KB don't stack up
  const h = makeTree({ device: pid("d", 9), prefix: "z" });
  const big = "x".repeat(2500);
  feed(h, { aa: big, bb: big, cc: "small" });
  assert.deepEqual(unknown(h), ["aa", "cc"]);
});

test("applyPayload validates before building the change", () => {
  const { a } = twoPhones({ shared: false });
  const bad = badRecords(a.wall.now);
  let adopted = 0;
  const watched = new Proxy(a.tree, { get: (target, key) => (key === "adopt" ? (...args) => { adopted += 1; return target.adopt(...args); } : target[key]) });
  const before = plain(a.tree.records());
  const result = applyPayload(watched, buildPayload(bad.records, ALL), { now: a.wall.now, helloW: a.wall.now });
  // applying is a pure function: it builds the change and leaves adopting to the caller
  assert.equal(adopted, 0);
  assert.deepEqual(plain(a.tree.records()), before);
  // every put, and every triple in History, already passes the validator
  for (const [id, record] of result.change.puts) {
    assert.deepEqual(validateRecord(id, record, { now: a.wall.now }), { record, rejected: [] }, id);
  }
  for (const change of result.change.group.changes) if (change.after) assert.notEqual(change.after[0], "Q");
  // so adopting it is safe: a second pass over the stored records rejects nothing
  a.run(result.change);
  for (const [id, record] of a.tree.records()) assert.deepEqual(validateRecord(id, record, { now: a.wall.now }).rejected, []);
});

test("a time is allowed up to 24 hours past the later of now and the sender's hello", () => {
  const { a } = twoPhones({ shared: false });
  const x = pid("e", 1);
  const at = ms => new Map([[x, { kind: "person", f: { g: ["Ема", ms, 0, D2] } }]]);
  const run = (ms, helloW) => applyPayload(a.tree, buildPayload(at(ms), ALL), { now: a.wall.now, helloW });
  const day = 86_400_000;
  assert.equal(run(a.wall.now + day, a.wall.now).change.puts.size, 1);
  assert.equal(run(a.wall.now + day + 1, a.wall.now).summary.rejected.clock, 1);
  // the sender's clock may be a day ahead of ours: its times are fine up to its hello plus a day
  assert.equal(run(a.wall.now + 2 * day, a.wall.now + day).change.puts.size, 1);
  assert.equal(run(a.wall.now + 2 * day + 1, a.wall.now + day).summary.rejected.clock, 1);
});
