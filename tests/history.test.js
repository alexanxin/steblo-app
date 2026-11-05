import test from "node:test";
import assert from "node:assert/strict";
import { makeGroup, undoWrites, scrubErased, capHistory } from "../public/src/history.js";
import { makeTree, pid, T0 } from "./fixtures/helpers.js";

const D2 = pid("d", 2);
const sorted = list => [...list].sort();

/** A tree that remembers the groups its changes produce, in order. */
function logged(options) {
  const h = makeTree(options);
  const log = [];
  h.do = change => {
    h.run(change);
    if (change.group) log.push(change.group);
    return change.group;
  };
  return Object.assign(h, { log });
}

test("makeGroup builds a group with an ID, who and when", () => {
  const group = makeGroup({ action: "edit", device: pid("d", 1), at: 12345, people: [pid("a", 1)], changes: [{ r: pid("a", 1), created: true }] });
  assert.match(group.id, /^[0-9a-f]{16}$/);
  assert.equal(group.at, 12345);
  assert.equal(group.action, "edit");
  assert.equal(group.device, pid("d", 1));
  assert.deepEqual(group.people, [pid("a", 1)]);
  assert.deepEqual(group.lost, []);
  assert.equal("session" in group, false);
  assert.equal(makeGroup({ action: "merge", device: pid("d", 1), at: 1, session: "s1" }).session, "s1");
  assert.notEqual(makeGroup({ action: "edit", device: pid("d", 1), at: 1 }).id, makeGroup({ action: "edit", device: pid("d", 1), at: 1 }).id);
});

test("each operation produces one change group with who and when", () => {
  const h = logged({ device: pid("d", 3) });
  const check = (change, action) => {
    assert.ok(change.group, action);
    assert.equal(change.group.action, action);
    assert.equal(change.group.device, pid("d", 3));
    assert.equal(change.group.at, h.wall.now); // this phone's wall clock
    assert.match(change.group.id, /^[0-9a-f]{16}$/);
    assert.ok(Array.isArray(change.group.people) && Array.isArray(change.group.changes) && Array.isArray(change.group.lost));
    assert.deepEqual(change.group.lost, []);
    return change;
  };
  check(h.tree.addPerson({ g: "Миро" }), "add");
  const a = h.add({ g: "Данило" });
  h.advance(5000);
  check(h.tree.addRelative(a, "child", {}), "add");
  check(h.tree.edit(a, { g: "Теодора" }), "edit");
  h.advance(5000);
  const b = h.add({ g: "Danilo" });
  check(h.tree.editPartnership(a, b, { en: true }), "add");
  h.run(h.tree.editPartnership(a, b, {}));
  check(h.tree.editPartnership(a, b, { en: true }), "edit");
  check(h.tree.unlink("partner", a, b), "delete");
  check(h.tree.removePerson(b), "delete");
  h.run(h.tree.removePerson(b));
  check(h.tree.restorePerson(b), "restore");
  h.run(h.tree.restorePerson(b));
  const merge = check(h.tree.merge(a, b, {}, { session: "join-1" }), "merge");
  assert.equal(merge.group.session, "join-1");
  h.run(merge);
  const c = h.add({});
  assert.equal(check(h.tree.notSame(a, c), "notsame").group.session, undefined);
  assert.equal(h.tree.notSame(a, c, { session: "join-1" }).group.session, "join-1");
  // the group's time is this phone's wall clock, not the tree clock
  h.advance(60_000);
  assert.equal(h.tree.edit(a, { g: "Ема" }).group.at, T0 + 70_000);
  // a device rename isn't part of the tree's history
  assert.equal(h.tree.setDeviceName("Телефон").group, null);
  // an edit that changes nothing has no group
  assert.equal(h.tree.edit(a, { g: h.tree.view().people.get(a).f.g }).group, null);
});

test("creations are logged by ID only", () => {
  const h = logged();
  const added = h.tree.addPerson({ g: "Данило", s: "Новаков", bd: { y: 1931 } });
  const [id] = added.puts.keys();
  assert.deepEqual(added.group.changes, [{ r: id, created: true }]);
  h.do(added);

  const child = h.tree.addRelative(id, "child", { g: "Ема", nt: "Белешка" });
  for (const entry of child.group.changes) assert.deepEqual(Object.keys(entry).sort(), ["created", "r"]);
  assert.equal(child.group.changes.length, 2);
  assert.ok(JSON.stringify(child.group).includes("Белешка") === false);

  const link = h.tree.editPartnership(id, h.add({ g: "Теодора" }), { mp: "Заречје" });
  assert.ok(link.group.changes.every(x => Object.keys(x).sort().join() === "created,r"));
  assert.equal(JSON.stringify(link.group).includes("Заречје"), false);
});

test("undo restores the old value as a new edit", () => {
  const h = logged();
  const id = h.add({ g: "Данило", s: "Новаков" });
  h.advance(1000);
  const edit = h.do(h.tree.edit(id, { g: "Теодора", s: "Новакова" }));
  const editedTriple = h.get(id).f.g;
  const frozen = structuredClone(edit);

  h.advance(1000);
  const undo = h.tree.undo(edit);
  assert.equal(undo.group.action, "undo");
  assert.deepEqual(undo.group.people, [id]);
  const record = undo.puts.get(id);
  assert.deepEqual(record.f.g.slice(0, 1), ["Данило"]);
  assert.deepEqual(record.f.s.slice(0, 1), ["Новаков"]);
  // a new edit at a later time, not a rewind
  assert.equal(record.f.g[1], T0 + 2000);
  assert.deepEqual(record.f.g.slice(3), [h.device]);
  assert.equal(new Set([record.f.g, record.f.s].map(t => `${t[1]}.${t[2]}`)).size, 1);
  assert.equal(undo.skipped, 0);
  // and the undo logs what it did, with the triples it replaced
  assert.deepEqual(undo.group.changes.map(c => [c.r, c.f]).sort(), [[id, "g"], [id, "s"]]);
  const entry = undo.group.changes.find(c => c.f === "g");
  assert.deepEqual(entry.before, editedTriple);
  assert.deepEqual(entry.after, record.f.g);
  // the group that was undone is not changed
  assert.deepEqual(edit, frozen);

  h.do(undo);
  assert.equal(h.value(id, "g"), "Данило");
  assert.equal(h.value(id, "s"), "Новаков");
  assert.equal(h.tree.view().people.get(id).f.g, "Данило");
});

test("undo of a first value writes null", () => {
  const h = logged();
  const id = h.add({ g: "Данило" });
  h.advance(1000);
  const edit = h.do(h.tree.edit(id, { bp: "Заречје", sx: "M" }));
  assert.equal(edit.changes.every(c => c.before === undefined), true);
  h.advance(1000);
  const undo = h.tree.undo(edit);
  assert.equal(undo.puts.get(id).f.bp[0], null);
  assert.equal(undo.puts.get(id).f.sx[0], null);
  h.do(undo);
  assert.deepEqual(Object.keys(h.tree.view().people.get(id).f), ["g"]);

  // a delete has no null: undoing the first delete writes false
  const records = new Map([[pid("a", 7), { kind: "person", f: { g: ["Миро", 5, 0, D2] } }]]);
  const bare = logged({ records, start: T0 });
  const removed = bare.do(bare.tree.removePerson(pid("a", 7)));
  assert.equal(removed.changes[0].before, undefined);
  const restore = bare.tree.undo(removed);
  assert.deepEqual(restore.puts.get(pid("a", 7)).f.del.slice(0, 1), [false]);
  bare.do(restore);
  assert.equal(bare.tree.view().people.has(pid("a", 7)), true);
});

test("undo of a creation deletes what was created", () => {
  const h = logged();
  const parent = h.add({ g: "Данило" });
  h.advance(1000);
  const added = h.do(h.tree.addRelative(parent, "child", { g: "Ема" }));
  const [child] = added.changes.filter(c => /^[0-9a-f]{16}$/.test(c.r)).map(c => c.r);
  assert.equal(h.tree.view().people.size, 2);
  assert.equal(h.tree.view().parentLinks.length, 1);

  h.advance(1000);
  const undo = h.tree.undo(added);
  // the person and the link both get deleted = true
  assert.deepEqual(sorted(undo.puts.keys()), sorted([child, `p:${parent}:${child}`]));
  assert.ok([...undo.puts.values()].every(r => r.f.del[0] === true));
  h.do(undo);
  assert.deepEqual([...h.tree.view().people.keys()], [parent]);
  assert.equal(h.tree.view().parentLinks.length, 0);
  assert.equal(h.tree.view().deleted.has(child), true);
  assert.equal(h.value(child, "g"), "Ема"); // delete, not erase: the details are still there

  // a plain person
  const person = h.do(h.tree.addPerson({ g: "Миро" }));
  const id = person.people[0];
  h.do(h.tree.undo(person));
  assert.equal(h.tree.view().people.has(id), false);

  // a record that other records now share isn't deleted from under them
  const x = h.do(h.tree.addPerson({ g: "Лиова" }));
  const [xid] = x.people;
  const y = h.add({ g: "Liova" });
  const merged = h.do(h.tree.merge(y, xid, {}));
  const refused = h.tree.undo(x);
  assert.equal(refused.puts.size, 0);
  assert.equal(refused.skipped, 1);
  // undo the merge first and the creation can follow
  h.do(h.tree.undo(merged));
  h.advance(1000);
  const second = h.tree.undo(x);
  assert.equal(second.skipped, 0);
  assert.equal(second.puts.get(xid).f.del[0], true);
});

test("undo skips fields changed since, and counts them", () => {
  const h = logged();
  const id = h.add({ g: "Данило", s: "Новаков" });
  h.advance(1000);
  const first = h.do(h.tree.edit(id, { g: "Теодора", s: "Новакова" }));
  h.advance(1000);
  h.do(h.tree.edit(id, { g: "Ема" })); // g changed again after the first edit

  h.advance(1000);
  const undo = h.tree.undo(first);
  assert.equal(undo.skipped, 1);
  assert.deepEqual(Object.keys(undo.puts.get(id).f).filter(k => undo.puts.get(id).f[k][1] === undo.meta.last[0]), ["s"]);
  h.do(undo);
  assert.equal(h.value(id, "g"), "Ема"); // left as it is
  assert.equal(h.value(id, "s"), "Новаков");

  // when every field was changed since, nothing is written
  h.advance(1000);
  h.do(h.tree.edit(id, { s: "Чарин" }));
  const again = h.tree.undo(first);
  assert.equal(again.skipped, 2);
  assert.equal(again.puts.size, 0);
  assert.equal(again.group, null);

  // a change that arrived from another phone counts as changed since
  const edit = h.do(h.tree.edit(id, { bp: "Заречје" }));
  const theirs = { kind: "person", f: { ...h.get(id).f, bp: ["Селце", T0 + 99_000, 0, D2] } };
  h.tree.adopt({ puts: new Map([[id, theirs]]), group: null, meta: {} });
  h.advance(200_000);
  const blocked = h.tree.undo(edit);
  assert.equal(blocked.skipped, 1);
  assert.equal(blocked.puts.size, 0);

  // a bad value in a group is dropped and counted, never written
  const hostile = { ...edit, id: "x", changes: [{ r: id, f: "bp", before: ["б".repeat(500), 1, 0, D2], after: theirs.f.bp }] };
  const refusedWrite = undoWrites(hostile, h.tree.records());
  assert.deepEqual(refusedWrite, { writes: [], skipped: 1 });
});

test("undoWrites lists what to write, in reverse order, without touching anything", () => {
  const h = logged();
  const id = h.add({ g: "Данило" });
  h.advance(1000);
  const edit = h.do(h.tree.edit(id, { g: "Теодора", bp: "Заречје" }));
  const before = structuredClone([...h.tree.records()]);
  const { writes, skipped } = undoWrites(edit, h.tree.records());
  assert.equal(skipped, 0);
  assert.deepEqual(writes.map(w => [w.r, w.f]), [[id, "bp"], [id, "g"]]); // reverse of the order logged
  assert.deepEqual(writes.map(w => w.v), [null, "Данило"]);
  assert.deepEqual([...h.tree.records()], before);
});

test("undo of an undo restores the edit", () => {
  const h = logged();
  const id = h.add({ g: "Данило" });
  h.advance(1000);
  const edit = h.do(h.tree.edit(id, { g: "Теодора" }));
  h.advance(1000);
  const undo = h.do(h.tree.undo(edit));
  assert.equal(h.value(id, "g"), "Данило");
  h.advance(1000);
  const redo = h.tree.undo(undo);
  assert.equal(redo.group.action, "undo");
  h.do(redo);
  assert.equal(h.value(id, "g"), "Теодора");
  // and again, back and forth
  h.advance(1000);
  const third = h.do(h.tree.undo(h.log.at(-1)));
  assert.equal(h.value(id, "g"), "Данило");
  assert.equal(third.action, "undo");

  // undoing a delete restores; undoing the restore deletes again
  h.advance(1000);
  const removed = h.do(h.tree.removePerson(id));
  assert.equal(h.tree.view().people.has(id), false);
  h.advance(1000);
  h.do(h.tree.undo(removed));
  assert.equal(h.tree.view().people.has(id), true);
});

test("undo of a merge removes the merge and leaves the details alone", () => {
  const h = logged();
  const a = h.add({ g: "Данило", bp: "Заречје" });
  const b = h.add({ g: "Danilo" });
  h.advance(1000);
  const merged = h.do(h.tree.merge(a, b, { g: "Данило" }));
  assert.equal(h.tree.resolve(b), a);
  assert.equal(merged.changes.some(c => c.f === "g"), true); // the choice is logged ...
  h.advance(1000);
  h.do(h.tree.undo(merged));
  assert.equal(h.tree.resolve(b), b); // ... but undoing the merge does not revert it
  assert.equal(h.value(a, "g"), "Данило");
  assert.equal(h.tree.view().people.size, 2);
  // merging again after an undo revives the same record
  h.advance(1000);
  const again = h.tree.merge(a, b, {});
  assert.deepEqual([...again.puts.keys()], [`m:${a}:${b}`]);
  h.do(again);
  assert.equal(h.tree.resolve(b), a);
  // a not-same can be undone too
  const c = h.add({ g: "Лиова" });
  const said = h.do(h.tree.notSame(a, c));
  assert.equal(h.tree.view().notSame.size, 1);
  h.advance(1000);
  h.do(h.tree.undo(said));
  assert.equal(h.tree.view().notSame.size, 0);
});

test("scrubErased replaces a record's values in history with erased marks", () => {
  const h = logged();
  const id = h.do(h.tree.addPerson({ g: "Данило" })).people[0];
  const other = h.do(h.tree.addPerson({ g: "Миро" })).people[0];
  h.advance(1000);
  h.do(h.tree.edit(id, { g: "Теодора", nt: "Белешка" }));
  h.do(h.tree.edit(other, { g: "Адам" }));
  const groups = h.log;
  assert.equal(groups.length, 4);
  const scrubbed = scrubErased(groups, id);
  assert.equal(scrubbed.length, 4);
  for (const word of ["Теодора", "Белешка", "Данило"]) assert.equal(JSON.stringify(scrubbed).includes(word), false, word);
  assert.deepEqual(scrubbed[0].changes, [{ r: id, erased: true }]);
  assert.deepEqual(scrubbed[2].changes, [{ r: id, erased: true }, { r: id, erased: true }]);
  // groups with nothing of the record in them are the very same objects
  assert.equal(scrubbed[1], groups[1]);
  assert.equal(scrubbed[3], groups[3]);
  assert.equal(groups[0].changes[0].created, true); // the input is not changed
  assert.equal(groups[2].changes[0].after[0], "Теодора");
  // losing values go too
  const lost = { ...groups[3], lost: [{ r: id, f: "g", loser: ["Данило", 1, 0, D2], winner: ["Теодора", 2, 0, D2] }, { r: other, f: "g", loser: ["x", 1, 0, D2], winner: ["y", 2, 0, D2] }] };
  const [cleaned] = scrubErased([lost], id);
  assert.deepEqual(cleaned.lost, [{ r: id, erased: true }, lost.lost[1]]);
  // several records at once
  const both = JSON.stringify(scrubErased(groups, new Set([id, other])));
  assert.equal(both.includes("Миро"), false);
  assert.equal(both.includes("Адам"), false);
  // an erased mark can't be undone, and is counted as skipped
  const undone = undoWrites(scrubbed[2], h.tree.records());
  assert.deepEqual(undone, { writes: [], skipped: 2 });
});

test("capHistory drops the oldest groups above the limit, and says so", () => {
  const groups = Array.from({ length: 10 }, (_, i) => makeGroup({ action: "edit", device: pid("d", 1), at: 1000 + i, people: [pid("a", i + 1)], changes: [{ r: pid("a", i + 1), f: "g", after: ["Име " + i, 1000 + i, 0, pid("d", 1)] }] }));
  const size = g => new TextEncoder().encode(JSON.stringify(g)).length;
  const total = groups.reduce((n, g) => n + size(g), 0);

  // everything fits: nothing changes, and nothing is said
  const all = capHistory(groups, total);
  assert.equal(all.groups.length, 10);
  assert.equal(all.dropped, 0);
  assert.deepEqual(all.groups, groups);

  // room for the newest four
  const four = groups.slice(-4).reduce((n, g) => n + size(g), 0);
  const capped = capHistory(groups, four);
  assert.equal(capped.dropped, 6);
  assert.deepEqual(capped.groups.map(g => g.id), groups.slice(6).map(g => g.id));
  // one byte less and the next oldest goes too
  const less = capHistory(groups, four - 1);
  assert.equal(less.dropped, 7);
  assert.equal(less.groups.length, 3);
  // nothing fits
  assert.deepEqual(capHistory(groups, 10), { groups: [], dropped: 10 });
  assert.deepEqual(capHistory([], 100), { groups: [], dropped: 0 });
  // the input is not changed
  assert.equal(groups.length, 10);
});
