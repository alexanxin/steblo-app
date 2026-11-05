import test from "node:test";
import assert from "node:assert/strict";
import { applyTriple, isErased } from "../public/src/records.js";
import { commitToHistory, undoWrites } from "../public/src/history.js";
import { makeTree, pid, copyRecords, T0 } from "./fixtures/helpers.js";

const sorted = list => [...list].sort();

/** A stand-in for one direction of sync: every triple of `from` is applied to `to` with the later-wins rule. */
function receive(to, from) {
  const puts = new Map();
  for (const [id, record] of from.tree.records()) {
    let current = puts.get(id) ?? to.tree.records().get(id) ?? { kind: record.kind, f: {} };
    for (const [key, triple] of Object.entries(record.f)) current = applyTriple(current, key, triple);
    if (current !== to.tree.records().get(id)) puts.set(id, current);
  }
  to.tree.adopt({ puts, group: null, meta: {} });
}
const exchange = (x, y) => { receive(x, y); receive(y, x); };

test("erase keeps only the er triple on the erasing device", () => {
  const h = makeTree();
  const a = h.add({ g: "Данило", s: "Новаков", bd: { y: 1931 }, nt: "Белешка" });
  h.advance(1000);
  const change = h.tree.erase(a);
  assert.deepEqual([...change.puts.keys()], [a]);
  assert.deepEqual(change.puts.get(a), { kind: "person", f: { er: [true, T0 + 1000, 0, h.device] } });
  assert.deepEqual(change.meta.last, [T0 + 1000, 0]);
  // History keeps that it happened, with who and when, and no details
  assert.equal(change.group.action, "erase");
  assert.equal(change.group.device, h.device);
  assert.equal(change.group.at, T0 + 1000);
  assert.deepEqual(change.group.people, []);
  assert.deepEqual(change.group.changes, []);
  assert.deepEqual(change.group.lost, []);
  // not adopted yet
  assert.equal(h.get(a).f.g[0], "Данило");

  h.tree.adopt(change);
  assert.deepEqual(Object.keys(h.get(a).f), ["er"]);
  assert.equal(isErased(h.get(a)), true);
  const view = h.tree.view();
  assert.equal(view.people.has(a), false);
  assert.equal(view.deleted.has(a), false);
  assert.equal(JSON.stringify(view.attention).includes(a), false);
  assert.equal(JSON.stringify([...h.tree.records()]).includes("Данило"), false);

  // a merged set: every record of it gets the same er, at one time
  const x = h.add({ g: "Миро" });
  const y = h.add({ g: "Adam" });
  h.run(h.tree.merge(x, y, {}));
  h.advance(1000);
  const both = h.tree.erase(y); // by the non-canonical ID
  assert.deepEqual(sorted(both.puts.keys()), sorted([x, y]));
  assert.deepEqual(both.puts.get(x).f, both.puts.get(y).f);
  assert.deepEqual(Object.keys(both.puts.get(x).f), ["er"]);
  h.tree.adopt(both);
  assert.equal(h.tree.view().people.size, 0);

  // erase is for someone who is there and not erased already
  assert.throws(() => h.tree.erase(a), /erased/i);
  assert.throws(() => h.tree.erase(pid("f", 9)), /person/i);
  // a deleted person can be erased
  const z = h.add({ g: "Теодора" });
  h.run(h.tree.removePerson(z));
  const gone = h.tree.erase(z);
  assert.equal(isErased(gone.puts.get(z)), true);
});

test("erase deletes links touching the set", () => {
  const h = makeTree();
  const a = h.add({ g: "Данило" });
  const parent = h.addRel(a, "parent", { g: "Миро" });
  const child = h.addRel(a, "child", { g: "Ема" });
  const spouse = h.addRel(a, "partner", { g: "Теодора" });
  h.run(h.tree.editPartnership(parent, spouse, { md: { y: 1950 } })); // a link between two others: stays
  const dup = h.add({ g: "Danilo" });
  const dupChild = h.addRel(dup, "child", { g: "Лиа" });
  h.run(h.tree.merge(a, dup, {}));
  h.advance(1000);

  const change = h.tree.erase(a);
  const touching = [`p:${parent}:${a}`, `p:${a}:${child}`, `u:${[a, spouse].sort().join(":")}`, `p:${dup}:${dupChild}`];
  assert.deepEqual(sorted(change.puts.keys()), sorted([a, dup, ...touching]));
  for (const id of touching) {
    assert.equal(change.puts.get(id).f.del[0], true, id);
    assert.deepEqual(change.puts.get(id).f.del.slice(1), [T0 + 1000, 0, h.device], id);
  }
  // everything at the time of the er
  assert.deepEqual(change.puts.get(a).f.er.slice(1), [T0 + 1000, 0, h.device]);
  // the link between two other people is not touched, and neither are their records
  assert.equal(change.puts.has(`u:${[parent, spouse].sort().join(":")}`), false);
  assert.equal(change.puts.has(parent), false);
  // the merge record stays: the set is still one set
  assert.equal(change.puts.has(`m:${a}:${dup}`), false);

  h.tree.adopt(change);
  const view = h.tree.view();
  assert.deepEqual([...view.people.keys()].sort(), sorted([parent, child, spouse, dupChild]));
  assert.equal(view.parentLinks.length, 0);
  assert.equal(view.partnerLinks.length, 1);
  assert.deepEqual([view.partnerLinks[0].a, view.partnerLinks[0].b].sort(), sorted([parent, spouse]));
  // the people who were left alone are listed as separate groups, as any unlinked person would be
  assert.equal(view.attention.separate.length >= 1, true);
});

test("erase scrubs the record from history in the same change", () => {
  const h = makeTree();
  const log = [];
  const run = change => { h.run(change); if (change.group) log.push(change.group); return change; };
  const a = [...run(h.tree.addPerson({ g: "Данило", nt: "Белешка" })).puts.keys()][0];
  const b = [...run(h.tree.addPerson({ g: "Миро" })).puts.keys()][0];
  h.advance(1000);
  run(h.tree.edit(a, { g: "Теодора", bp: "Заречје" }));
  run(h.tree.edit(b, { g: "Адам" }));
  run(h.tree.merge(a, b, { g: "Теодора" }));
  const joined = JSON.stringify(log);
  assert.ok(["Теодора", "Белешка", "Заречје"].every(word => joined.includes(word) || word === "Белешка"));

  h.advance(1000);
  const erase = h.tree.erase(a);
  const after = commitToHistory(log, erase);
  // the group is appended last ...
  assert.equal(after.length, log.length + 1);
  assert.equal(after.at(-1), erase.group);
  // ... and the earlier groups no longer hold any value of either record
  const text = JSON.stringify(after);
  for (const word of ["Данило", "Теодора", "Миро", "Адам", "Заречје"]) assert.equal(text.includes(word), false, word);
  assert.ok(after.slice(0, -1).some(g => g.changes.some(c => c.erased === true && (c.r === a || c.r === b))));
  // the log that was passed in is untouched, so a failed commit loses nothing
  assert.equal(JSON.stringify(log).includes("Данило") || JSON.stringify(log).includes("Теодора"), true);

  // a change that erases nobody only appends
  const plain = h.tree.addPerson({ g: "Лиова" });
  const appended = commitToHistory(after, plain);
  assert.equal(appended.length, after.length + 1);
  assert.equal(appended[0], after[0]);
  // and a change with no group (a device rename) changes nothing
  assert.equal(commitToHistory(after, h.tree.setDeviceName("Телефон")), after);
});

test("a later edit to an erased record is discarded", () => {
  const first = makeTree({ device: pid("d", 1), prefix: "a" });
  const a = first.add({ g: "Данило", s: "Новаков" });
  const second = makeTree({ device: pid("d", 2), prefix: "b", records: copyRecords(first.tree.records()) });

  // the first phone erases; the second, a minute later, edits and deletes the same person
  first.advance(1000);
  first.run(first.tree.erase(a));
  second.advance(60_000);
  second.run(second.tree.edit(a, { g: "Теодора", nt: "Подоцнежна белешка" }));
  second.advance(1000);
  second.run(second.tree.removePerson(a));
  assert.equal(second.value(a, "g"), "Теодора");

  exchange(first, second);
  // both ended with exactly the erase, though the edit has the later time
  for (const h of [first, second]) {
    assert.deepEqual(h.get(a), { kind: "person", f: { er: [true, T0 + 1000, 0, pid("d", 1)] } });
    assert.equal(h.tree.view().people.size, 0);
    assert.equal(h.tree.view().deleted.size, 0);
  }
  assert.deepEqual(first.get(a), second.get(a));

  // an erased record refuses everything, locally
  assert.throws(() => first.tree.edit(a, { g: "Ема" }), /erased/i);
  assert.throws(() => first.tree.removePerson(a), /erased/i);
  assert.throws(() => first.tree.restorePerson(a), /erased/i);
  assert.throws(() => first.tree.addRelative(a, "child", {}), /erased/i);
  assert.throws(() => first.tree.merge(a, first.add({ g: "Миро" }), {}), /erased/i);
  assert.throws(() => first.tree.editPartnership(a, first.add({ g: "Лиа" }), {}), /erased/i);

  // and by applying: nothing sticks to it, whatever its time
  let record = first.get(a);
  for (const key of ["g", "s", "nt", "del", "bd", "zz"]) record = applyTriple(record, key, ["x", T0 + 10 ** 9, 0, pid("d", 2)]);
  assert.equal(record, first.get(a));

  // two phones that erase the same person at different times end up with the later erase
  const third = makeTree({ device: pid("d", 3), prefix: "c", records: copyRecords(second.tree.records()) });
  const fourth = makeTree({ device: pid("d", 4), prefix: "e", records: new Map([[a, { kind: "person", f: { g: ["Данило", 1, 0, pid("d", 1)] } }]]), start: T0 + 90_000 });
  fourth.run(fourth.tree.erase(a));
  exchange(third, fourth);
  assert.deepEqual(third.get(a), fourth.get(a));
  assert.deepEqual(third.get(a).f.er.slice(1), [T0 + 90_000, 0, pid("d", 4)]);
});

test("a partly erased set is hidden and listed", () => {
  const phone1 = makeTree({ device: pid("d", 1), prefix: "a" });
  const a = phone1.add({ g: "Данило" });
  const b = phone1.add({ g: "Теодора", bp: "Заречје" });
  const child = phone1.addRel(b, "child", { g: "Ема" });
  const phone2 = makeTree({ device: pid("d", 2), prefix: "b", records: copyRecords(phone1.tree.records()) });

  // meanwhile: phone 1 erases a, and phone 2 merges a into b
  phone1.advance(1000);
  phone1.run(phone1.tree.erase(a));
  phone2.advance(2000);
  phone2.run(phone2.tree.merge(a, b, {}));
  exchange(phone1, phone2);

  for (const h of [phone1, phone2]) {
    const view = h.tree.view();
    assert.equal(isErased(h.get(a)), true);
    assert.equal(isErased(h.get(b)), false);
    // hidden: neither the person nor the people linked only to them show as theirs
    assert.equal(view.people.has(a), false);
    assert.equal(view.people.has(b), false);
    assert.equal(view.deleted.size, 0);
    assert.deepEqual(view.attention.partlyErased, [{ id: a, members: [a, b], f: { g: "Теодора", bp: "Заречје" } }]);
    assert.deepEqual([...view.people.keys()], [child]);
    assert.equal(view.parentLinks.length, 0); // the link to the hidden set is hidden
  }
  assert.deepEqual(phone1.tree.view(), phone2.tree.view());
  // edits and the other operations refuse a hidden person
  assert.throws(() => phone1.tree.edit(b, { g: "Лиа" }), /partly erased/i);
  assert.throws(() => phone1.tree.removePerson(b), /partly erased/i);
  assert.throws(() => phone1.tree.erase(pid("f", 9)), /person/i);
});

test("eraseRest erases the remaining records of a partly erased set", () => {
  const phone1 = makeTree({ device: pid("d", 1), prefix: "a" });
  const a = phone1.add({ g: "Данило" });
  const b = phone1.add({ g: "Теодора", nt: "Белешка" });
  const child = phone1.addRel(b, "child", { g: "Ема" });
  const phone2 = makeTree({ device: pid("d", 2), prefix: "b", records: copyRecords(phone1.tree.records()) });
  phone1.advance(1000);
  phone1.run(phone1.tree.erase(a));
  phone2.advance(2000);
  phone2.run(phone2.tree.merge(a, b, {}));
  exchange(phone1, phone2);

  phone1.advance(5000);
  const change = phone1.tree.eraseRest(a); // any member will do
  assert.deepEqual(sorted(change.puts.keys()), sorted([b, `p:${b}:${child}`]));
  assert.deepEqual(change.puts.get(b), { kind: "person", f: { er: [true, T0 + 6000, 0, pid("d", 1)] } });
  assert.equal(change.puts.get(`p:${b}:${child}`).f.del[0], true);
  assert.equal(change.group.action, "erase");
  assert.deepEqual(change.group.changes, []);
  // the one already erased is left alone
  assert.equal(change.puts.has(a), false);

  phone1.run(change);
  const view = phone1.tree.view();
  assert.deepEqual(view.attention.partlyErased, []);
  assert.deepEqual([...view.people.keys()], [child]);
  assert.equal(JSON.stringify([...phone1.tree.records()]).includes("Теодора"), false);
  // history is scrubbed for the record that was erased now
  const log = [{ id: "g1", at: 1, action: "edit", device: pid("d", 1), people: [b], changes: [{ r: b, f: "g", after: ["Теодора", 1, 0, pid("d", 1)] }], lost: [] }];
  assert.equal(JSON.stringify(commitToHistory(log, change)).includes("Теодора"), false);

  // the other phone gets the same end state after the next sync
  exchange(phone1, phone2);
  assert.deepEqual(phone2.get(b), phone1.get(b));
  assert.deepEqual(phone1.tree.view(), phone2.tree.view());

  // eraseRest is only for a set that is partly erased
  assert.throws(() => phone1.tree.eraseRest(a), /partly/i);
  const plain = phone1.add({ g: "Миро" });
  assert.throws(() => phone1.tree.eraseRest(plain), /partly/i);
  assert.throws(() => phone1.tree.eraseRest(pid("f", 9)), /person/i);
});

test("erase groups can't be undone", () => {
  const h = makeTree();
  const log = [];
  const run = change => { h.run(change); if (change.group) log.push(change.group); return change; };
  const a = [...run(h.tree.addPerson({ g: "Данило" })).puts.keys()][0];
  h.advance(1000);
  run(h.tree.edit(a, { g: "Теодора" }));
  h.advance(1000);
  const erase = run(h.tree.erase(a));

  assert.throws(() => h.tree.undo(erase.group), /erase/i);
  assert.deepEqual(undoWrites(erase.group, h.tree.records()), { writes: [], skipped: 0 });
  // nor can the groups before it: the record is gone, so they are skipped and counted
  const stale = h.tree.undo(log[1]);
  assert.equal(stale.puts.size, 0);
  assert.equal(stale.skipped, 1);
  assert.equal(stale.group, null);
  // and the same once the history has been scrubbed
  const scrubbed = commitToHistory(log.slice(0, 2), erase);
  const afterScrub = h.tree.undo(scrubbed[1]);
  assert.equal(afterScrub.skipped, 1);
  assert.equal(afterScrub.puts.size, 0);
  // undoing the creation of an erased person writes nothing, either
  const creation = h.tree.undo(scrubbed[0]);
  assert.equal(creation.skipped, 1);
  assert.equal(creation.puts.size, 0);
  assert.equal(isErased(h.get(a)), true);
});
