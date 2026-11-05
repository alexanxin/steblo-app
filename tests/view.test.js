import test from "node:test";
import assert from "node:assert/strict";
import { createTree, resolveIn, areNotSameIn } from "../public/src/tree.js";
import { createClock } from "../public/src/clock.js";
import { makeTree, pid, T0, copyRecords } from "./fixtures/helpers.js";

const D1 = pid("d", 1);
const D2 = pid("d", 2);
const tri = (v, ms, c = 0, by = D1) => [v, ms, c, by];
const person = f => ({ kind: "person", f });
const sorted = list => [...list].sort();

/** A tree over hand-written records, with a wall clock far ahead of them. */
function treeOf(entries) {
  const records = new Map(entries);
  const clock = createClock({ now: () => T0 + 10 * 86_400_000 });
  return createTree({ device: D1, name: "x", records, clock, now: () => T0 });
}

/** What undo of a merge does: the merge record gets a later deleted = true. */
function unmerge(h, a, b) {
  const t = h.clock.tick();
  const id = `m:${a < b ? a : b}:${a < b ? b : a}`;
  const rec = { kind: "merge", f: { ...h.get(id).f, del: [true, t[0], t[1], h.device] } };
  h.tree.adopt({ puts: new Map([[id, rec]]), group: null, meta: { last: t } });
}

test("a merged set shows the latest value of each field", () => {
  const h = makeTree();
  const a = h.add({ g: "Данило", s: "Новаков", sx: "M" });
  h.advance(1000);
  const b = h.add({ g: "Danilo", bp: "Заречје" });
  h.run(h.tree.merge(a, b, {}));

  const view = h.tree.view();
  assert.equal(view.people.size, 1);
  assert.equal(view.people.has(b), false);
  const merged = view.people.get(a);
  assert.equal(merged.id, a);
  assert.deepEqual(merged.f, { g: "Danilo", s: "Новаков", sx: "M", bp: "Заречје" }); // g from the later record
  assert.deepEqual(merged.members, [a, b]);

  // a later edit wins, whichever record of the set it is made through
  h.advance(1000);
  h.run(h.tree.edit(b, { g: "Данило" }));
  assert.equal(h.tree.view().people.get(a).f.g, "Данило");

  // cleared fields are not shown, and neither are fields the app doesn't know
  h.advance(1000);
  h.run(h.tree.edit(a, { s: null }));
  const zz = { kind: "person", f: { ...h.get(a).f, zz: tri(5, T0 + 99_999) } };
  h.tree.adopt({ puts: new Map([[a, zz]]), group: null, meta: {} });
  const later = h.tree.view().people.get(a);
  assert.equal("s" in later.f, false);
  assert.equal("zz" in later.f, false);
  assert.equal("del" in later.f, false);
  assert.deepEqual(Object.keys(later.f), ["g", "sx", "bp"]);

  // merge choices are written as edits on the canonical record
  const c = h.add({ g: "Teodora", s: "Чарин" });
  const d = h.add({ g: "Теодора" });
  h.advance(1000);
  const choice = h.tree.merge(d, c, { g: "Teodora" }); // d's value is later; the user picks c's
  assert.deepEqual(sorted(choice.puts.keys()), sorted([c, `m:${c}:${d}`]));
  h.run(choice);
  assert.equal(h.tree.view().people.get(c).f.g, "Teodora");
  assert.equal(h.get(c).f.g[1], choice.meta.last[0]);
  // the entry's before is the triple that was showing for the set
  assert.equal(choice.group.changes.find(x => x.f === "g").before[0], "Теодора");
});

test("the canonical ID is the smallest, and chained merges join sets", () => {
  const h = makeTree();
  const [p1, p2, p3, p4, p5] = [1, 2, 3, 4, 5].map(() => h.add({}));
  h.run(h.tree.merge(p3, p2, {}));
  assert.equal(h.tree.resolve(p3), p2);
  assert.equal(h.tree.resolve(p2), p2);
  h.run(h.tree.merge(p4, p3, {})); // joins through a member that is not the canonical one
  assert.equal(h.tree.resolve(p4), p2);
  h.run(h.tree.merge(p1, p4, {})); // an even smaller ID takes over the whole set
  for (const p of [p1, p2, p3, p4]) assert.equal(h.tree.resolve(p), p1, p);
  assert.equal(h.tree.resolve(p5), p5);
  const view = h.tree.view();
  assert.deepEqual([...view.people.keys()], [p1, p5]);
  assert.deepEqual(view.people.get(p1).members, [p1, p2, p3, p4]);
  assert.equal(resolveIn(view, p4), p1);
  assert.equal(resolveIn(view, p5), p5);
  assert.equal(resolveIn(view, pid("f", 9)), pid("f", 9));

  // two merges made in the other order give the same sets
  const records = h.tree.records();
  const reversed = new Map([...records].reverse());
  const other = treeOf(reversed);
  for (const p of [p1, p2, p3, p4, p5]) assert.equal(other.resolve(p), h.tree.resolve(p));

  // a deleted merge record no longer joins
  unmerge(h, p1, p2); // the last merge joined p1 with the set whose canonical ID was p2
  assert.equal(h.tree.resolve(p4), p2); // p4 is still joined to p3 and p2
  assert.equal(h.tree.resolve(p1), p1);
});

test("a merge record joins only people who are both there", () => {
  const a = pid("a", 1);
  const m = pid("a", 2);
  const tree = treeOf([
    [a, person({ g: tri("Данило", 10), del: tri(false, 10) })],
    [`m:${a}:${m}`, { kind: "merge", f: { del: tri(false, 20) } }],
  ]);
  assert.equal(tree.resolve(m), m);
  assert.equal(tree.resolve(a), a);
  assert.deepEqual([...tree.view().people.keys()], [a]);
  // when m arrives, they join
  tree.adopt({ puts: new Map([[m, person({ g: tri("Danilo", 30), del: tri(false, 30) })]]), group: null, meta: {} });
  assert.equal(tree.resolve(m), a);
  assert.deepEqual([...tree.view().people.keys()], [a]);
});

test("edits write the canonical record; delete and restore write every record", () => {
  const h = makeTree();
  const a = h.add({ g: "Данило" });
  const b = h.add({ g: "Danilo" });
  h.run(h.tree.merge(b, a, {}));

  // an edit through the non-canonical ID lands on the canonical record
  const edit = h.tree.edit(b, { g: "Теодора" });
  assert.deepEqual([...edit.puts.keys()], [a]);
  assert.deepEqual(edit.group.changes.map(c => c.r), [a]);
  assert.deepEqual(edit.group.people, [a]);

  // delete and restore write both
  const removed = h.tree.removePerson(b);
  assert.deepEqual(sorted(removed.puts.keys()), sorted([a, b]));
  assert.deepEqual(sorted(removed.group.changes.map(c => c.r)), sorted([a, b]));
  assert.ok(removed.puts.get(a).f.del[0] === true && removed.puts.get(b).f.del[0] === true);
  h.run(removed);
  assert.equal(h.tree.view().people.size, 0);
  assert.deepEqual([...h.tree.view().deleted.keys()], [a]);

  h.advance(1000);
  const restored = h.tree.restorePerson(a);
  assert.deepEqual(sorted(restored.puts.keys()), sorted([a, b]));
  h.run(restored);
  assert.deepEqual([...h.tree.view().people.keys()], [a]);
  assert.equal(h.tree.view().deleted.size, 0);
});

test("a delete made after an edit wins, and an edit made after a delete revives", () => {
  const h = makeTree();
  const a = h.add({ g: "Данило" });
  const b = h.add({ g: "Миро" }); // older than everything that happens to a below
  h.advance(1000);
  h.run(h.tree.edit(a, { g: "Теодора" }));
  assert.equal(h.tree.view().people.has(a), true);

  h.advance(1000);
  h.run(h.tree.removePerson(a));
  assert.equal(h.tree.view().people.has(a), false);
  assert.equal(h.tree.view().deleted.has(a), true);
  assert.equal(h.tree.view().deleted.get(a).f.g, "Теодора"); // deleted people keep their details

  // an edit made after the delete brings them back, with no restore
  h.advance(1000);
  h.run(h.tree.edit(a, { g: "Ема" }));
  assert.equal(h.tree.view().people.has(a), true);
  assert.equal(h.tree.view().deleted.has(a), false);
  assert.equal(h.value(a, "del"), true); // the old delete is still there; it just no longer counts

  // and a delete after that wins again
  h.advance(1000);
  h.run(h.tree.removePerson(a));
  assert.equal(h.tree.view().people.has(a), false);

  // the same on a merged set: an edit through either record revives both
  h.run(h.tree.merge(a, b, {}));
  assert.equal(h.tree.view().people.size, 0); // merged with a deleted person who was deleted after b's last change: the set is deleted
  h.advance(1000);
  h.run(h.tree.edit(b, { g: "Миро Новаков" }));
  assert.equal(h.tree.view().people.has(a), true);

  // two phones: one deleted at 50, the other edited at 40 -> deleted; edited at 60 -> visible
  const x = pid("a", 7);
  const base = { g: tri("Данило", 10), del: tri(false, 10) };
  const deletedFirst = treeOf([[x, person({ ...base, del: tri(true, 50, 0, D2), s: tri("Новаков", 40) })]]);
  assert.equal(deletedFirst.view().people.has(x), false);
  const editedLast = treeOf([[x, person({ ...base, del: tri(true, 50, 0, D2), s: tri("Новаков", 60) })]]);
  assert.equal(editedLast.view().people.has(x), true);
  // restoring (del = false) is simply a later del
  const restoredLater = treeOf([[x, person({ ...base, del: tri(false, 70, 0, D2) })]]);
  assert.equal(restoredLater.view().people.has(x), true);
});

test("a tie between deleted and another field counts as deleted", () => {
  const x = pid("a", 1);
  const make = f => treeOf([[x, person(f)]]);
  // same ms and counter
  assert.equal(make({ g: tri("Данило", 100, 0), del: tri(true, 100, 0) }).view().people.has(x), false);
  assert.equal(make({ g: tri("Данило", 100, 3, D2), del: tri(true, 100, 3) }).view().people.has(x), false);
  // one counter later on the field: revived; one counter later on the delete: deleted
  assert.equal(make({ g: tri("Данило", 100, 1), del: tri(true, 100, 0) }).view().people.has(x), true);
  assert.equal(make({ g: tri("Данило", 100, 0), del: tri(true, 100, 1) }).view().people.has(x), false);
  // no del at all, or del = false: visible
  assert.equal(make({ g: tri("Данило", 100) }).view().people.has(x), true);
  assert.equal(make({ g: tri("Данило", 100), del: tri(false, 100) }).view().people.has(x), true);
  // the tie rule holds across a set
  const y = pid("a", 2);
  const set = treeOf([
    [x, person({ g: tri("Данило", 100), del: tri(false, 1) })],
    [y, person({ s: tri("Новаков", 100), del: tri(true, 100) })],
    [`m:${x}:${y}`, { kind: "merge", f: { del: tri(false, 5) } }],
  ]);
  assert.equal(set.view().people.size, 0);
  assert.equal(set.view().deleted.size, 1);
});

test("links that resolve to one pair collapse, and delete hides them", () => {
  const h = makeTree();
  const child = h.add({ g: "Ема" });
  const p1 = h.addRel(child, "parent", { g: "Данило" });
  const p2 = h.addRel(child, "parent", { g: "Danilo" });
  const x = h.add({ g: "Теодора" });
  const [low] = [p1, p2].sort();
  // each of the two is the partner of x on their own record, and the later one has more details
  h.run(h.tree.editPartnership(p1, x, { md: { y: 1950 } }));
  h.advance(1000);
  h.run(h.tree.editPartnership(p2, x, { md: { y: 1960 }, mp: "Заречје" }));
  assert.equal(h.tree.view().parentLinks.length, 2);
  assert.equal(h.tree.view().partnerLinks.length, 2);

  h.run(h.tree.merge(p1, p2, {}));
  const view = h.tree.view();
  assert.equal(view.parentLinks.length, 1);
  assert.deepEqual(view.parentLinks[0], { parent: low, child, ids: sorted([`p:${p1}:${child}`, `p:${p2}:${child}`]) });
  assert.equal(view.partnerLinks.length, 1);
  const [pair] = view.partnerLinks;
  assert.deepEqual([pair.a, pair.b], [low, x].sort());
  assert.deepEqual(pair.f, { md: { y: 1960 }, mp: "Заречје" }); // the latest of each field
  assert.equal(pair.ids.length, 2);

  // unlink through either person hides the pair: both records are written
  const hide = h.tree.unlink("parent", p2, child);
  assert.deepEqual(sorted(hide.puts.keys()), sorted([`p:${p1}:${child}`, `p:${p2}:${child}`]));
  h.run(hide);
  assert.equal(h.tree.view().parentLinks.length, 0);
  assert.equal(h.tree.view().people.size, 3); // child, the merged parent, x: the people stay

  // a link between two people who became one is a link to themselves: not shown
  const y = h.add({ g: "Лиова" });
  const z = h.add({ g: "Liova" });
  h.run(h.tree.editPartnership(y, z, {}));
  assert.equal(h.tree.view().partnerLinks.length, 2);
  h.run(h.tree.merge(y, z, {}));
  assert.equal(h.tree.view().partnerLinks.length, 1);

  // links to a deleted person are hidden until they come back
  h.advance(1000);
  h.run(h.tree.removePerson(x));
  assert.equal(h.tree.view().partnerLinks.length, 0);
  h.advance(1000);
  h.run(h.tree.restorePerson(x));
  assert.equal(h.tree.view().partnerLinks.length, 1);

  // an edit to a hidden link brings it back
  h.advance(1000);
  h.run(h.tree.unlink("partner", low, x));
  assert.equal(h.tree.view().partnerLinks.length, 0);
  h.advance(1000);
  h.run(h.tree.editPartnership(low, x, { ed: { y: 1970 } }));
  assert.equal(h.tree.view().partnerLinks.length, 1);
  assert.deepEqual(h.tree.view().partnerLinks[0].f.ed, { y: 1970 });
});

test("a link to a missing person stays hidden until it arrives", () => {
  const a = pid("a", 1);
  const m = pid("a", 2);
  const tree = treeOf([
    [a, person({ g: tri("Данило", 10), del: tri(false, 10) })],
    [`p:${a}:${m}`, { kind: "parent", f: { del: tri(false, 20) } }],
    [`u:${a}:${m}`, { kind: "partner", f: { del: tri(false, 20) } }],
  ]);
  assert.equal(tree.view().parentLinks.length, 0);
  assert.equal(tree.view().partnerLinks.length, 0);
  assert.equal(tree.view().people.size, 1);
  tree.adopt({ puts: new Map([[m, person({ g: tri("Ема", 30), del: tri(false, 30) })]]), group: null, meta: {} });
  assert.equal(tree.view().parentLinks.length, 1);
  assert.equal(tree.view().partnerLinks.length, 1);
  assert.deepEqual(tree.view().parentLinks[0], { parent: a, child: m, ids: [`p:${a}:${m}`] });
});

test("a not-same record applies across sets, and an active merge beats it", () => {
  const h = makeTree();
  const a = h.add({ g: "Данило" });
  const b = h.add({ g: "Дануло" });
  const c = h.add({ g: "Danilo" });
  h.run(h.tree.merge(a, b, {}));
  assert.equal(areNotSameIn(h.tree.view(), a, c), false);

  // the record is between b and c, and it applies to the whole set a+b
  const change = h.tree.notSame(b, c);
  assert.deepEqual([...change.puts.keys()].filter(k => k.startsWith("n:")), [`n:${a}:${c}`]); // written between the canonical IDs
  h.run(change);
  const view = h.tree.view();
  assert.equal(areNotSameIn(view, a, c), true);
  assert.equal(areNotSameIn(view, b, c), true);
  assert.equal(areNotSameIn(view, c, a), true);
  assert.equal(areNotSameIn(view, a, b), false);
  assert.equal(areNotSameIn(view, a, pid("f", 9)), false);

  // a manual merge is allowed anyway, and it beats the not-same
  h.run(h.tree.merge(a, c, {}));
  assert.equal(h.tree.resolve(c), a);
  assert.equal(areNotSameIn(h.tree.view(), a, c), false);

  // a not-same record that is deleted does not apply
  const x = pid("a", 7);
  const y = pid("a", 8);
  const tree = treeOf([
    [x, person({ del: tri(false, 1) })], [y, person({ del: tri(false, 1) })],
    [`n:${x}:${y}`, { kind: "notsame", f: { del: tri(true, 5) } }],
  ]);
  assert.equal(areNotSameIn(tree.view(), x, y), false);
  tree.adopt({ puts: new Map([[`n:${x}:${y}`, { kind: "notsame", f: { del: tri(false, 9) } }]]), group: null, meta: {} });
  assert.equal(areNotSameIn(tree.view(), x, y), true);

  // saying it again changes nothing; one person can't be not-same with themselves
  const again = tree.notSame(x, y);
  assert.equal(again.puts.size, 0);
  assert.equal(again.group, null);
  assert.throws(() => h.tree.notSame(a, c), /one person/i);
});

test("undoing a merge keeps edits on the canonical record", () => {
  const h = makeTree();
  const a = h.add({ g: "Данило", bp: "Заречје" });
  const b = h.add({ g: "Danilo" });
  h.advance(1000);
  h.run(h.tree.edit(b, { s: "Новаков" })); // before the merge, on b
  h.advance(1000);
  h.run(h.tree.merge(a, b, {}));
  h.advance(1000);
  h.run(h.tree.edit(b, { g: "Данило II", nt: "Додадено додека беа еден" })); // while merged: written to a
  assert.equal(h.value(a, "g"), "Данило II");
  assert.equal(h.value(b, "g"), "Danilo");

  h.advance(1000);
  unmerge(h, a, b);
  const view = h.tree.view();
  assert.deepEqual([...view.people.keys()], [a, b]);
  // the canonical record keeps what was written to it while merged
  assert.equal(view.people.get(a).f.g, "Данило II");
  assert.equal(view.people.get(a).f.nt, "Додадено додека беа еден");
  assert.equal(view.people.get(a).f.bp, "Заречје");
  // the other record shows what it held
  assert.equal(view.people.get(b).f.g, "Danilo");
  assert.equal(view.people.get(b).f.s, "Новаков");
  assert.equal("nt" in view.people.get(b).f, false);
  assert.equal(h.tree.resolve(b), b);
});

test("view is cached until a change is adopted, and the records are not touched by it", () => {
  const h = makeTree();
  const a = h.add({ g: "Данило" });
  const first = h.tree.view();
  assert.equal(h.tree.view(), first);
  const before = structuredClone([...h.tree.records()]);
  h.run(h.tree.edit(a, { g: "Ема" }));
  const second = h.tree.view();
  assert.notEqual(second, first);
  assert.equal(first.people.get(a).f.g, "Данило"); // the old view is a snapshot
  assert.equal(second.people.get(a).f.g, "Ема");
  assert.notDeepEqual([...h.tree.records()], before);
  // building a view doesn't change the records
  const frozen = structuredClone([...h.tree.records()]);
  h.tree.view();
  assert.deepEqual([...h.tree.records()], frozen);
  assert.deepEqual(copyRecords(h.tree.records()), h.tree.records());
});

// ---------------------------------------------------------------- families and Needs attention (task 1.7)

const P = n => pid("a", n);

/** Records written by hand: people by ID with plain values, parent links [parent, child], partner links [a, b]. */
function world({ people = {}, parents = [], partners = [], extra = [] }) {
  const entries = [];
  for (const [id, fields] of Object.entries(people)) {
    entries.push([id, person({ del: tri(false, 1), ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, tri(v, 1)])) })]);
  }
  for (const [p, c] of parents) entries.push([`p:${p}:${c}`, { kind: "parent", f: { del: tri(false, 1) } }]);
  for (const [a, b] of partners) entries.push([`u:${a < b ? a : b}:${a < b ? b : a}`, { kind: "partner", f: { del: tri(false, 1) } }]);
  return treeOf([...entries, ...extra]);
}
const everyone = (...ns) => Object.fromEntries(ns.map(n => [P(n), {}]));

test("children group by own family, using the two parent links with the smallest IDs", () => {
  const tree = world({
    people: { [P(1)]: { g: "Данило", sx: "M" }, [P(2)]: { g: "Теодора", sx: "F" }, [P(3)]: { g: "Миро" }, ...everyone(11, 12, 13, 14) },
    parents: [
      [P(1), P(11)], [P(2), P(11)],                 // C1: F and M
      [P(3), P(12)], [P(1), P(12)], [P(2), P(12)],  // C2: three parents, added in a scrambled order
      [P(2), P(13)], [P(3), P(13)],                 // C3: M and X
      [P(3), P(14)],                                // C4: X alone
    ],
  });
  const { families, attention } = tree.view();
  assert.deepEqual(families.map(f => ({ partners: f.partners, children: f.children, partnership: f.partnership })), [
    { partners: [P(1), P(2)], children: [P(11), P(12)], partnership: null },  // C2's family: its two smallest parents
    { partners: [P(3), P(2)], children: [P(13)], partnership: null },          // no sex counts as U, which comes before F
    { partners: [P(3)], children: [P(14)], partnership: null },
  ]);
  // the child with three parents is on the Needs attention list
  assert.deepEqual(attention.manyParents, [P(12)]);
});

test("a partner link with no children still makes a family", () => {
  const tree = world({
    people: { ...everyone(1, 2, 3, 4, 5, 6) },
    partners: [[P(1), P(2)], [P(3), P(4)]],
    parents: [[P(3), P(5)], [P(4), P(5)], [P(1), P(6)]],
  });
  const { families, partnerLinks } = tree.view();
  assert.equal(families.length, 3);
  const childless = families.find(f => f.partners.includes(P(2)));
  assert.deepEqual(childless.children, []);
  assert.equal(childless.partnership.a, P(1));
  assert.equal(childless.partnership, partnerLinks.find(l => l.a === P(1)));
  // a couple with a child and a partner link is one family, not two
  const withChild = families.find(f => f.partners.includes(P(4)));
  assert.deepEqual(withChild.children, [P(5)]);
  assert.deepEqual(withChild.partnership.ids, [`u:${P(3)}:${P(4)}`]);
  // a parent without a partner link is a family of one
  const alone = families.find(f => f.partners.length === 1);
  assert.deepEqual(alone, { partners: [P(1)], children: [P(6)], partnership: null });
  // the details of the partnership travel with it
  const detailed = treeOf([
    ...world({ people: everyone(1, 2) }).records(),
    [`u:${P(1)}:${P(2)}`, { kind: "partner", f: { del: tri(false, 1), md: tri({ y: 1955 }, 1), en: tri(true, 1) } }],
  ]);
  assert.deepEqual(detailed.view().families[0].partnership.f, { md: { y: 1955 }, en: true });
  // a hidden partner link makes no family; the child's parents still do
  const hidden = treeOf([
    ...world({ people: everyone(1, 2, 5), parents: [[P(1), P(5)], [P(2), P(5)]] }).records(),
    [`u:${P(1)}:${P(2)}`, { kind: "partner", f: { del: tri(true, 9) } }],
  ]);
  assert.equal(hidden.view().families.length, 1);
  assert.equal(hidden.view().families[0].partnership, null);
});

test("partners are ordered M, then X or U by ID, then F", () => {
  const tree = world({
    people: {
      [P(1)]: { sx: "F" }, [P(2)]: { sx: "M" },
      [P(3)]: { sx: "U" }, [P(4)]: { sx: "M" },
      [P(5)]: { sx: "X" }, [P(6)]: { sx: "F" },
      [P(7)]: { sx: "F" }, [P(8)]: { sx: "F" },
      [P(9)]: {}, [P(10)]: { sx: "X" },
      [P(11)]: { sx: "M" }, [P(12)]: { sx: "M" },
      [P(13)]: { sx: "U" }, [P(14)]: { sx: "X" },
    },
    partners: [[P(1), P(2)], [P(3), P(4)], [P(5), P(6)], [P(7), P(8)], [P(9), P(10)], [P(11), P(12)], [P(13), P(14)]],
  });
  const order = tree.view().families.map(f => f.partners);
  assert.deepEqual(order, [
    [P(2), P(1)],   // M before F, though F has the smaller ID
    [P(4), P(3)],   // M before U
    [P(5), P(6)],   // X before F
    [P(7), P(8)],   // F and F: by ID
    [P(9), P(10)],  // no sex counts as U; U and X: by ID (the text "…09" sorts before "…10")
    [P(11), P(12)], // M and M: by ID
    [P(13), P(14)], // U and X: by ID
  ]);
});

test("children are ordered by sort year, unknown last", () => {
  const tree = world({
    people: {
      [P(1)]: { sx: "M" },
      [P(10)]: { bd: { y: 1950 } },
      [P(11)]: { bd: { y: 1940, m: 3 } },
      [P(12)]: { bd: { t: "BET 1920 AND 1930" } },  // sort year 1920
      [P(13)]: {},
      [P(14)]: { bd: { y: 1940 } },                 // same year as P(11): by ID
      [P(15)]: { bd: { y: 1935, q: "abt" } },       // "about" still sorts by its year
      [P(16)]: { bd: { t: "unknown date" } },       // no year in it: unknown
    },
    parents: [10, 11, 12, 13, 14, 15, 16].map(n => [P(1), P(n)]),
  });
  assert.deepEqual(tree.view().families[0].children, [P(12), P(15), P(11), P(14), P(10), P(13), P(16)]);
});

test("attention lists more than two parents, ancestor loops and partly erased people", () => {
  const tree = world({
    people: {
      ...everyone(1, 2, 3, 4),                 // child 4 has three parents
      ...everyone(21, 22, 23),                 // a loop of three
      ...everyone(31, 32),                     // a loop of two
      ...everyone(51),                         // a person who is their own parent: ignored
    },
    parents: [[P(1), P(4)], [P(2), P(4)], [P(3), P(4)], [P(21), P(22)], [P(22), P(23)], [P(23), P(21)], [P(31), P(32)], [P(32), P(31)], [P(51), P(51)]],
    extra: [
      // partly erased: 41 is erased, 42 merged into it is not
      [P(41), person({ er: tri(true, 50) })],
      [P(42), person({ g: tri("Теодора", 40), del: tri(false, 40) })],
      [`m:${P(41)}:${P(42)}`, { kind: "merge", f: { del: tri(false, 45) } }],
      // and a person who is erased on their own
      [P(60), person({ er: tri(true, 50) })],
    ],
  });
  const { attention, people } = tree.view();
  assert.deepEqual(attention.manyParents, [P(4)]);
  // the walk up from the smallest ID repeats first at that person
  assert.deepEqual(attention.loops, [P(21), P(31)]);
  // a partly erased set is hidden, and listed with whatever is left of it
  assert.deepEqual(attention.partlyErased, [{ id: P(41), members: [P(41), P(42)], f: { g: "Теодора" } }]);
  assert.equal(people.has(P(41)), false);
  assert.equal(people.has(P(42)), false);
  // a fully erased person is nowhere
  assert.equal(people.has(P(60)), false);
  assert.equal(tree.view().deleted.has(P(60)), false);
  assert.equal(JSON.stringify(attention).includes(P(60)), false);
  // and a clean tree has nothing to attend to
  const clean = world({ people: everyone(1, 2, 3), parents: [[P(1), P(3)], [P(2), P(3)]] }).view();
  assert.deepEqual(clean.attention, { manyParents: [], loops: [], partlyErased: [], separate: [] });
});

test("separate groups exclude the largest; ties go to the smaller lowest ID", () => {
  // sizes 4, 2, 2, 1: the group of four is the main tree
  const tree = world({
    people: everyone(1, 2, 3, 4, 11, 12, 21, 22, 31),
    parents: [[P(1), P(2)], [P(2), P(3)]],
    partners: [[P(3), P(4)], [P(11), P(12)], [P(21), P(22)]],
  });
  assert.deepEqual(tree.view().attention.separate, [
    { ids: [P(11), P(12)], size: 2 },
    { ids: [P(21), P(22)], size: 2 },
    { ids: [P(31)], size: 1 },
  ]);

  // two groups of three: the one with the smaller lowest ID counts as the largest
  const tie = world({
    people: everyone(1, 2, 3, 5, 6, 7),
    partners: [[P(1), P(2)], [P(2), P(3)], [P(5), P(6)], [P(6), P(7)]],
  });
  assert.deepEqual(tie.view().attention.separate, [{ ids: [P(5), P(6), P(7)], size: 3 }]);

  // a deleted person connects nobody, and merged people count as one
  const split = world({
    people: everyone(1, 2, 3, 4, 5),
    partners: [[P(1), P(2)], [P(2), P(3)], [P(4), P(5)]],
    extra: [[P(2), person({ del: tri(true, 5) })]],
  });
  assert.deepEqual(split.view().attention.separate, [{ ids: [P(1)], size: 1 }, { ids: [P(3)], size: 1 }]); // 4 and 5 are the largest group
  const joined = world({
    people: everyone(1, 2, 3, 4),
    partners: [[P(1), P(2)], [P(3), P(4)]],
    extra: [[`m:${P(2)}:${P(3)}`, { kind: "merge", f: { del: tri(false, 5) } }]],
  });
  assert.deepEqual(joined.view().attention.separate, []);
  assert.deepEqual(joined.view().families.map(f => f.partners), [[P(1), P(2)], [P(2), P(4)]]); // the second link now reads 2 and 4
});

test("view is identical for the same records in any insertion order", () => {
  const base = world({
    people: { [P(1)]: { g: "Данило", sx: "M", bd: { y: 1931 } }, [P(2)]: { g: "Теодора", sx: "F" }, [P(3)]: { g: "Ема", bd: { y: 1960 } }, [P(4)]: { g: "Adam", bd: { y: 1960 } }, ...everyone(5, 6, 7, 8, 9, 21, 22, 31) },
    parents: [[P(1), P(3)], [P(2), P(3)], [P(1), P(4)], [P(2), P(4)], [P(5), P(3)], [P(21), P(22)], [P(22), P(21)]],
    partners: [[P(1), P(2)], [P(6), P(7)]],
    extra: [
      [`m:${P(3)}:${P(4)}`, { kind: "merge", f: { del: tri(false, 5) } }],
      [`n:${P(6)}:${P(8)}`, { kind: "notsame", f: { del: tri(false, 5) } }],
      [P(9), person({ del: tri(true, 5), g: tri("Миро", 1) })],
      [P(41), person({ er: tri(true, 50) })], [P(42), person({ g: tri("Лиова", 40) })],
      [`m:${P(41)}:${P(42)}`, { kind: "merge", f: { del: tri(false, 45) } }],
    ],
  }).records();
  const entries = [...base];
  const reference = treeOf(entries).view();
  let seed = 12345;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 25; round++) {
    const shuffled = [...entries].sort(() => next() - 0.5);
    const view = treeOf(shuffled).view();
    assert.deepStrictEqual(view, reference);
    assert.deepEqual([...view.people.keys()], [...reference.people.keys()]);
    assert.deepEqual(view.families, reference.families);
  }
  // and the reference isn't trivially empty
  assert.ok(reference.people.size >= 6 && reference.families.length >= 3 && reference.attention.loops.length === 1);
});
