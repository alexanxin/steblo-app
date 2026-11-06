import test from "node:test";
import assert from "node:assert/strict";
import { createTree } from "../public/src/tree.js";
import { createClock, compareTimes } from "../public/src/clock.js";
import { makeTree, pid, copyRecords, T0 } from "./fixtures/helpers.js";

const stamp = ([, ms, counter, by]) => `${ms}.${counter}.${by}`;
const sorted = list => [...list].sort();
// IDs of the people a change creates (16 hex characters, not in the tree yet), in the order put
const newPeople = (h, change) => [...change.puts.keys()].filter(k => /^[0-9a-f]{16}$/.test(k) && !h.tree.records().has(k));

test("an operation returns a pending change and changes nothing until adopted", () => {
  const h = makeTree();
  const change = h.tree.addPerson({ g: "Данило", s: "Новаков" });
  assert.ok(change.puts instanceof Map);
  assert.equal(change.puts.size, 1);
  assert.equal(h.tree.records().size, 0);
  assert.equal(h.tree.resolve(pid("a", 1)), pid("a", 1));

  h.tree.adopt(change);
  assert.equal(h.tree.records().size, 1);
  const id = pid("a", 1);
  assert.equal(h.value(id, "g"), "Данило");

  // an edit leaves the stored record alone until it is adopted, and then replaces it
  const stored = h.get(id);
  const snapshot = structuredClone(stored);
  const edit = h.tree.edit(id, { g: "Ема" });
  assert.deepEqual(h.get(id), snapshot);
  assert.equal(h.get(id), stored);
  assert.notEqual(edit.puts.get(id), stored);
  h.tree.adopt(edit);
  assert.equal(h.value(id, "g"), "Ема");
  assert.equal(stored.f.g[0], "Данило");

  // the change says what the clock reached
  assert.deepEqual(edit.meta.last, h.clock.last());
  assert.ok(edit.group);
});

test("addPerson writes all its fields and deleted at one time", () => {
  const h = makeTree();
  const change = h.tree.addPerson({ g: "  Данило ", s: "Новаков", sx: "M", bd: { y: 1931, m: 3, d: 12 }, bp: "Заречје", nt: "Прв ред\nВтор ред", dc: false, bs: null });
  assert.equal(change.puts.size, 1);
  const [id, record] = [...change.puts][0];
  assert.equal(id, pid("a", 1));
  assert.equal(record.kind, "person");
  // a null field is simply not written for a new person
  assert.deepEqual(Object.keys(record.f).sort(), ["bd", "bp", "dc", "del", "g", "nt", "s", "sx"]);
  assert.equal(record.f.g[0], "Данило");
  assert.deepEqual(record.f.bd[0], { y: 1931, m: 3, d: 12 });
  assert.deepEqual(record.f.del, [false, T0, 0, h.device]);
  // one time for every field
  assert.equal(new Set(Object.values(record.f).map(stamp)).size, 1);
  assert.deepEqual(change.meta.last, [T0, 0]);
  assert.equal(change.group.action, "add");
  assert.deepEqual(change.group.people, [id]);

  // a second person gets a later time
  h.tree.adopt(change);
  const second = h.tree.addPerson({});
  assert.deepEqual(second.puts.get(pid("a", 2)).f, { del: [false, T0, 1, h.device] });
  assert.equal(compareTimes(second.meta.last, change.meta.last), 1);

  // bad input throws, and a field that isn't ours to set is refused
  assert.throws(() => h.tree.addPerson({ sx: "male" }), /invalid/i);
  assert.throws(() => h.tree.addPerson({ g: "а".repeat(81) }), /invalid/i);
  assert.throws(() => h.tree.addPerson({ bd: { y: 2023, m: 2, d: 29 } }), /invalid/i);
  assert.throws(() => h.tree.addPerson({ del: true }), /invalid/i);
  assert.throws(() => h.tree.addPerson({ er: true }), /invalid/i);
  assert.throws(() => h.tree.addPerson({ zz: 1 }), /invalid/i);
  assert.throws(() => h.tree.addPerson({ md: { y: 1950 } }), /invalid/i);
  assert.equal(h.tree.records().size, 1);
});

test("addRelative writes the person and links in one change", () => {
  const h = makeTree();
  const p = h.add({ g: "Данило", s: "Новаков" });

  // child
  const child = h.tree.addRelative(p, "child", { g: "Ема", s: "Новакова", sx: "F" });
  const [c] = newPeople(h, child);
  assert.equal(newPeople(h, child).length, 1);
  assert.deepEqual(sorted(child.puts.keys()), sorted([c, `p:${p}:${c}`]));
  assert.equal(child.puts.get(c).f.g[0], "Ема");
  assert.equal(child.puts.get(`p:${p}:${c}`).kind, "parent");
  assert.equal(child.puts.get(`p:${p}:${c}`).f.del[0], false);
  // everything in the change shares one time
  assert.equal(new Set([...child.puts.values()].flatMap(r => Object.values(r.f).map(stamp))).size, 1);
  assert.deepEqual(sorted(child.group.changes.map(x => x.r)), sorted([c, `p:${p}:${c}`]));
  assert.ok(child.group.changes.every(x => x.created === true));
  assert.equal(child.group.action, "add");
  assert.equal(h.tree.records().size, 1); // not adopted yet

  // parent
  const parent = h.tree.addRelative(p, "parent", { g: "Миро" });
  const [q] = newPeople(h, parent);
  assert.deepEqual(sorted(parent.puts.keys()), sorted([q, `p:${q}:${p}`]));
  assert.equal(parent.puts.get(`p:${q}:${p}`).kind, "parent");

  // partner: one sorted link
  const partner = h.tree.addRelative(p, "partner", { g: "Теодора" });
  const [m] = newPeople(h, partner);
  const [low, high] = [p, m].sort();
  assert.deepEqual(sorted(partner.puts.keys()), sorted([m, `u:${low}:${high}`]));
  assert.equal(partner.puts.get(`u:${low}:${high}`).kind, "partner");

  // the link ID is sorted when the new ID sorts first, too
  const known = pid("f", 1);
  const h2 = makeTree({ prefix: "a", records: new Map([[known, { kind: "person", f: { del: [false, T0 - 10, 0, pid("d", 9)] } }]]) });
  const other = h2.tree.addRelative(known, "partner", {});
  const [fresh] = newPeople(h2, other);
  assert.ok(fresh < known);
  assert.ok(other.puts.has(`u:${fresh}:${known}`));

  // sibling of someone who has a parent: linked to that parent, no placeholder
  const q2 = h.addRel(p, "parent", { g: "Миро" });
  const sibling = h.tree.addRelative(p, "sibling", { g: "Адам" });
  const [sib] = newPeople(h, sibling);
  assert.deepEqual(sorted(sibling.puts.keys()), sorted([sib, `p:${q2}:${sib}`]));

  // fields are validated, the relation must be one we know, the person must be there
  assert.throws(() => h.tree.addRelative(p, "child", { sx: "male" }), /invalid/i);
  assert.throws(() => h.tree.addRelative(p, "cousin", {}), /relation/i);
  assert.throws(() => h.tree.addRelative(pid("f", 9), "child", {}), /person/i);
});

test("a sibling of someone with no parents creates one placeholder parent linked to both", () => {
  const h = makeTree();
  const p = h.add({ g: "Данило" });
  const change = h.tree.addRelative(p, "sibling", { g: "Миро" });
  const people = newPeople(h, change);
  assert.equal(people.length, 2);
  const placeholder = people.find(id => Object.keys(change.puts.get(id).f).join() === "del");
  const sib = people.find(id => id !== placeholder);
  assert.ok(placeholder && sib);
  assert.equal(change.puts.get(sib).f.g[0], "Миро");
  assert.deepEqual(sorted(change.puts.keys()), sorted([sib, placeholder, `p:${placeholder}:${p}`, `p:${placeholder}:${sib}`]));
  assert.deepEqual(sorted(change.group.changes.map(c => c.r)), sorted([sib, placeholder, `p:${placeholder}:${p}`, `p:${placeholder}:${sib}`]));
  assert.ok(change.group.changes.every(c => c.created === true));
  h.tree.adopt(change);

  // a second sibling reuses that parent instead of adding another
  const again = h.tree.addRelative(p, "sibling", { g: "Леа" });
  const [sib2] = newPeople(h, again);
  assert.deepEqual(sorted(again.puts.keys()), sorted([sib2, `p:${placeholder}:${sib2}`]));
  // so does a sibling of the sibling
  const third = h.tree.addRelative(sib, "sibling", {});
  const [sib3] = newPeople(h, third);
  assert.deepEqual(sorted(third.puts.keys()), sorted([sib3, `p:${placeholder}:${sib3}`]));
});

test("otherParent also gets a parent link to the new child", () => {
  const h = makeTree();
  const p = h.add({ g: "Данило" });
  const q = h.add({ g: "Теодора" });
  const change = h.tree.addRelative(p, "child", { g: "Ема" }, { otherParent: q });
  const [child] = newPeople(h, change);
  assert.deepEqual(sorted(change.puts.keys()), sorted([child, `p:${p}:${child}`, `p:${q}:${child}`]));
  assert.deepEqual(sorted(change.group.changes.map(c => c.r)), sorted([child, `p:${p}:${child}`, `p:${q}:${child}`]));
  // the other parent has to be someone else who is there
  assert.throws(() => h.tree.addRelative(p, "child", {}, { otherParent: p }), /otherParent/);
  assert.throws(() => h.tree.addRelative(p, "child", {}, { otherParent: pid("f", 9) }), /otherParent/);
  // only for a child
  assert.throws(() => h.tree.addRelative(p, "partner", {}, { otherParent: q }), /otherParent/);
  // a merged other parent is the same person as the one they are merged into
  const dup = h.add({ g: "Teodora" });
  h.run(h.tree.merge(q, dup, {}));
  assert.throws(() => h.tree.addRelative(q, "child", {}, { otherParent: dup }), /otherParent/);
});

test("unlink hides a link and restores on undo", () => {
  const h = makeTree();
  const p = h.add({ g: "Данило" });
  const c = h.addRel(p, "child", { g: "Ема" });
  const spouse = h.addRel(p, "partner", { g: "Теодора" });
  const parentLink = `p:${p}:${c}`;
  const partnerLink = `u:${p}:${spouse}`;

  const change = h.tree.unlink("parent", p, c);
  assert.deepEqual([...change.puts.keys()], [parentLink]);
  assert.equal(change.puts.get(parentLink).f.del[0], true);
  assert.equal(h.get(parentLink).f.del[0], false); // not adopted yet
  assert.equal(change.group.action, "delete");
  assert.deepEqual(change.group.changes.map(x => ({ r: x.r, f: x.f, before: x.before?.[0], after: x.after[0] })), [{ r: parentLink, f: "del", before: false, after: true }]);
  h.tree.adopt(change);
  assert.equal(h.get(parentLink).f.del[0], true);

  // a partner link is found whichever way round the people are given
  const partnerChange = h.tree.unlink("partner", spouse, p);
  assert.deepEqual([...partnerChange.puts.keys()], [partnerLink]);

  // nothing to hide: already hidden, never there, or not a kind of link
  assert.throws(() => h.tree.unlink("parent", p, c), /link/i);
  assert.throws(() => h.tree.unlink("parent", c, p), /link/i);
  assert.throws(() => h.tree.unlink("sibling", p, c), /link/i);

  // undo shows it again, as a new edit
  const undo = h.tree.undo(change.group);
  assert.equal(undo.puts.get(parentLink).f.del[0], false);
  assert.equal(undo.puts.get(parentLink).f.del[1] > change.puts.get(parentLink).f.del[1] || undo.puts.get(parentLink).f.del[2] > change.puts.get(parentLink).f.del[2], true);
  h.tree.adopt(undo);
  assert.equal(h.tree.view().parentLinks.some(l => l.parent === p && l.child === c), true);
  h.tree.adopt(h.tree.unlink("parent", p, c)); // and it can be hidden again
  assert.equal(h.tree.view().parentLinks.some(l => l.parent === p && l.child === c), false);
});

test("editPartnership writes marriage and end fields", () => {
  const h = makeTree();
  const a = h.add({ g: "Данило" });
  const b = h.add({ g: "Теодора" });
  const link = `u:${a}:${b}`;

  // no link yet: it is created with the fields
  const first = h.tree.editPartnership(b, a, { md: { y: 1955, m: 6 }, mp: "Заречје" });
  assert.deepEqual([...first.puts.keys()], [link]);
  const record = first.puts.get(link);
  assert.equal(record.kind, "partner");
  assert.deepEqual(Object.keys(record.f).sort(), ["del", "md", "mp"]);
  assert.deepEqual(record.f.md[0], { y: 1955, m: 6 });
  assert.equal(record.f.del[0], false);
  assert.equal(new Set(Object.values(record.f).map(stamp)).size, 1);
  assert.deepEqual(first.group.changes, [{ r: link, created: true }]);
  assert.equal(first.group.action, "add");
  h.tree.adopt(first);

  // end fields on the existing link: only the new fields are written
  const second = h.tree.editPartnership(a, b, { en: true, ed: { y: 1970 } });
  const edited = second.puts.get(link);
  assert.deepEqual(Object.keys(edited.f).sort(), ["del", "ed", "en", "md", "mp"]);
  assert.equal(edited.f.en[0], true);
  assert.deepEqual(edited.f.ed[0], { y: 1970 });
  assert.equal(edited.f.md, h.get(link).f.md); // untouched
  assert.equal(second.group.action, "edit");
  assert.deepEqual(second.group.changes.map(c => [c.r, c.f]).sort(), [[link, "ed"], [link, "en"]]);
  assert.equal(second.group.changes[0].before, undefined);
  h.tree.adopt(second);

  // changing a value records the old triple, and clearing writes null
  const third = h.tree.editPartnership(a, b, { mp: null, md: { y: 1956 } });
  assert.equal(third.puts.get(link).f.mp[0], null);
  const change = third.group.changes.find(c => c.f === "md");
  assert.deepEqual(change.before[0], { y: 1955, m: 6 });
  assert.deepEqual(change.after[0], { y: 1956 });

  // only partnership fields, valid values, two different people who are there
  assert.throws(() => h.tree.editPartnership(a, b, { g: "Ема" }), /invalid/i);
  assert.throws(() => h.tree.editPartnership(a, b, { del: true }), /invalid/i);
  assert.throws(() => h.tree.editPartnership(a, b, { md: { y: 2023, m: 2, d: 29 } }), /invalid/i);
  assert.throws(() => h.tree.editPartnership(a, a, { en: true }), /two/i);
  assert.throws(() => h.tree.editPartnership(a, pid("f", 9), { en: true }), /person/i);
});

test("resolve returns the canonical ID of a merged person", () => {
  const h = makeTree();
  const a = h.add({ g: "Данило" });
  const b = h.add({ g: "Danilo" });
  assert.equal(h.tree.resolve(b), b);
  h.run(h.tree.merge(b, a, {}));
  assert.equal(h.tree.resolve(b), a);
  assert.equal(h.tree.resolve(a), a);
  // an ID the tree has never seen is its own answer
  assert.equal(h.tree.resolve(pid("f", 9)), pid("f", 9));
});

test("setDeviceName writes the device record", () => {
  const h = makeTree();
  const change = h.tree.setDeviceName("  Теодорин   телефон ");
  const id = `d:${h.device}`;
  assert.deepEqual([...change.puts.keys()], [id]);
  assert.equal(change.puts.get(id).kind, "device");
  assert.deepEqual(change.puts.get(id).f.nm, ["Теодорин телефон", T0, 0, h.device]);
  assert.equal(change.group, null);
  assert.equal(change.meta.name, "Теодорин телефон");
  assert.deepEqual(change.meta.last, [T0, 0]);
  assert.equal(h.tree.name, "Test phone");
  h.tree.adopt(change);
  assert.equal(h.tree.name, "Теодорин телефон");
  assert.equal(h.value(id, "nm"), "Теодорин телефон");
  assert.throws(() => h.tree.setDeviceName(""), /invalid/i);
  assert.throws(() => h.tree.setDeviceName("т".repeat(61)), /invalid/i);
  assert.throws(() => h.tree.setDeviceName(null), /invalid/i);
});

test("two devices adding the same link create the same record", () => {
  const first = makeTree({ device: pid("d", 1), prefix: "a" });
  const a = first.add({ g: "Данило" });
  const b = first.add({ g: "Теодора" });
  const second = makeTree({ device: pid("d", 2), prefix: "b", records: copyRecords(first.tree.records()) });

  // a partner link, given in opposite order on the two phones
  const x = first.tree.editPartnership(a, b, { en: true });
  const y = second.tree.editPartnership(b, a, { md: { y: 1950 } });
  assert.deepEqual([...x.puts.keys()], [`u:${a}:${b}`]);
  assert.deepEqual([...y.puts.keys()], [`u:${a}:${b}`]);

  // a merge and a not-same record
  assert.deepEqual([...first.tree.merge(a, b, {}).puts.keys()].filter(k => k.startsWith("m:")), [`m:${a}:${b}`]);
  assert.deepEqual([...second.tree.merge(b, a, {}).puts.keys()].filter(k => k.startsWith("m:")), [`m:${a}:${b}`]);
  assert.deepEqual([...first.tree.notSame(a, b).puts.keys()], [`n:${a}:${b}`]);
  assert.deepEqual([...second.tree.notSame(b, a).puts.keys()], [`n:${a}:${b}`]);
});

test("adding a third parent throws", () => {
  const h = makeTree();
  const child = h.add({ g: "Ема" });
  const mother = h.addRel(child, "parent", { g: "Теодора" });
  h.addRel(child, "parent", { g: "Данило" });
  assert.throws(() => h.tree.addRelative(child, "parent", { g: "Миро" }), /two parents/i);
  // nothing was changed by the failed attempt
  assert.equal(h.tree.records().size, 5);
  // children, siblings and partners are not parents
  h.run(h.tree.addRelative(child, "child", {}));
  h.run(h.tree.addRelative(child, "partner", {}));
  // a parent who has been removed doesn't count
  h.run(h.tree.removePerson(mother));
  h.run(h.tree.addRelative(child, "parent", { g: "Миро" }));
  assert.throws(() => h.tree.addRelative(child, "parent", { g: "Адам" }), /two parents/i);
});

test("edit stores one new time and rejects invalid input", () => {
  const h = makeTree();
  const id = h.add({ g: "Данило", s: "Новаков", sx: "M" });
  h.advance(5000);
  const change = h.tree.edit(id, { g: "Теодора", s: "Новакова", sx: "F", bd: { y: 1931 } });
  const record = change.puts.get(id);
  assert.deepEqual(record.f.g, ["Теодора", T0 + 5000, 0, h.device]);
  assert.equal(new Set(["g", "s", "sx", "bd"].map(k => stamp(record.f[k]))).size, 1);
  // fields not named are left as they were, same triples
  assert.equal(record.f.del, h.get(id).f.del);
  assert.deepEqual(change.meta.last, [T0 + 5000, 0]);
  assert.equal(change.group.action, "edit");
  assert.deepEqual(change.group.people, [id]);

  // values are cleaned; null clears
  h.tree.adopt(change);
  const cleaned = h.tree.edit(id, { g: "  Ема   Лиова ", s: null });
  assert.equal(cleaned.puts.get(id).f.g[0], "Ема Лиова");
  assert.deepEqual(cleaned.puts.get(id).f.s.slice(0, 1), [null]);

  // invalid input: the whole edit is refused
  for (const bad of [{ g: "а".repeat(81) }, { sx: "male" }, { bd: { y: 2023, m: 2, d: 29 } }, { del: true }, { er: true }, { zz: 1 }, { md: { y: 1950 } }, { g: 5 }]) {
    assert.throws(() => h.tree.edit(id, { s: "Чарин", ...bad }), /invalid/i, JSON.stringify(bad));
  }
  assert.equal(h.value(id, "s"), "Новакова");
  assert.throws(() => h.tree.edit(pid("f", 9), { g: "Ема" }), /person/i);

  // a value that is already there is not written again
  const same = h.tree.edit(id, { g: "Теодора", sx: "F" });
  assert.equal(same.puts.size, 0);
  assert.equal(same.group, null);
  const some = h.tree.edit(id, { g: "Теодора", sx: "M" });
  assert.deepEqual(Object.keys(some.puts.get(id).f).sort(), ["bd", "del", "g", "s", "sx"]);
  assert.deepEqual(some.group.changes.map(c => c.f), ["sx"]);
});

test("removePerson and restorePerson round trip", () => {
  const h = makeTree();
  const id = h.add({ g: "Данило" });
  h.advance(1000);

  const removed = h.tree.removePerson(id);
  assert.equal(removed.group.action, "delete");
  assert.deepEqual(removed.puts.get(id).f.del, [true, T0 + 1000, 0, h.device]);
  assert.equal(removed.puts.get(id).f.g, h.get(id).f.g); // other fields untouched
  assert.deepEqual(removed.group.changes.map(c => ({ r: c.r, f: c.f, before: c.before?.[0], after: c.after[0] })), [{ r: id, f: "del", before: false, after: true }]);
  assert.deepEqual(removed.group.people, [id]);
  assert.equal(h.value(id, "del"), false);
  h.tree.adopt(removed);
  assert.equal(h.value(id, "del"), true);
  assert.throws(() => h.tree.removePerson(id), /deleted/i);

  h.advance(1000);
  const restored = h.tree.restorePerson(id);
  assert.equal(restored.group.action, "restore");
  assert.deepEqual(restored.puts.get(id).f.del, [false, T0 + 2000, 0, h.device]);
  h.tree.adopt(restored);
  assert.equal(h.value(id, "del"), false);
  assert.equal(h.value(id, "g"), "Данило");
  assert.throws(() => h.tree.restorePerson(id), /not deleted/i);
  assert.throws(() => h.tree.removePerson(pid("f", 9)), /person/i);
  assert.throws(() => h.tree.restorePerson(pid("f", 9)), /person/i);
});

test("a tree starts its clock after every time it already holds", () => {
  const records = new Map([[pid("a", 1), { kind: "person", f: { g: ["Данило", T0 + 9_000_000, 7, pid("d", 2)], del: [false, T0, 0, pid("d", 2)] } }]]);
  const h = makeTree({ records });
  const change = h.tree.edit(pid("a", 1), { g: "Ема" });
  assert.deepEqual(change.puts.get(pid("a", 1)).f.g.slice(1, 3), [T0 + 9_000_000, 8]);
  // adopting something from elsewhere moves the clock past it too
  h.tree.adopt({ puts: new Map([[pid("b", 1), { kind: "person", f: { g: ["Миро", T0 + 20_000_000, 3, pid("d", 3)] } }]]), group: null, meta: {} });
  assert.deepEqual(h.tree.addPerson({}).meta.last, [T0 + 20_000_000, 4]);
});

test("createTree wants a device ID and a clock", () => {
  const clock = createClock({ now: () => T0 });
  assert.throws(() => createTree({ device: "not-hex", name: "x", records: new Map(), clock }), /device/i);
  assert.throws(() => createTree({ device: pid("d", 1), name: "x", records: new Map() }), /clock/i);
  // IDs are 16 lowercase hex characters by default, and different each time
  const tree = createTree({ device: pid("d", 1), name: "x", records: new Map(), clock });
  const ids = new Set();
  for (let i = 0; i < 50; i++) {
    const change = tree.addPerson({});
    const id = [...change.puts.keys()][0];
    assert.match(id, /^[0-9a-f]{16}$/);
    ids.add(id);
    tree.adopt(change);
  }
  assert.equal(ids.size, 50);
});

// ---- link: connect two people who are already in the tree (story 76)

test("link makes an existing person a parent", () => {
  const h = makeTree();
  const ema = h.add({ g: "Ема" });
  const danilo = h.add({ g: "Данило" });
  const change = h.run(h.tree.link("parent", danilo, ema));
  assert.deepEqual([...change.puts.keys()], [`p:${danilo}:${ema}`]);
  assert.equal(change.group.action, "add");
  assert.deepEqual(change.group.changes, [{ r: `p:${danilo}:${ema}`, created: true }]);
  const view = h.tree.view();
  assert.deepEqual(view.parentLinks.map(l => [l.parent, l.child]), [[danilo, ema]]);
  assert.deepEqual(view.families.map(f => f.children), [[ema]]);
  // a deleted link comes back instead of a second record being made
  h.run(h.tree.unlink("parent", danilo, ema));
  assert.equal(h.tree.view().parentLinks.length, 0);
  const again = h.run(h.tree.link("parent", danilo, ema));
  assert.equal(again.puts.size, 1);
  assert.equal(h.tree.view().parentLinks.length, 1);
});

test("link makes two existing people partners", () => {
  const h = makeTree();
  const miro = h.add({ g: "Миро" });
  const lea = h.add({ g: "Леа" });
  const change = h.run(h.tree.link("partner", lea, miro));
  assert.deepEqual([...change.puts.keys()], [`u:${[miro, lea].sort().join(":")}`]);
  const view = h.tree.view();
  assert.equal(view.partnerLinks.length, 1);
  assert.deepEqual([...view.families[0].partners].sort(), [miro, lea].sort());
});

test("linking a third parent throws", () => {
  const h = makeTree();
  const child = h.add({ g: "Адам" });
  const a = h.addRel(child, "parent", { g: "Данило" });
  const b = h.addRel(child, "parent", { g: "Теодора" });
  const c = h.add({ g: "Леа" });
  assert.ok(a && b);
  assert.throws(() => h.tree.link("parent", c, child), err => err.code === "state" && /parent/i.test(err.message));
});

test("a link that would make someone their own ancestor throws", () => {
  const h = makeTree();
  const grand = h.add({ g: "Ѓеко" });
  const mid = h.addRel(grand, "child", { g: "Данило" });
  const kid = h.addRel(mid, "child", { g: "Миро" });
  assert.throws(() => h.tree.link("parent", kid, grand), err => err.code === "state");
  assert.throws(() => h.tree.link("parent", grand, grand), err => err.code === "invalid" || err.code === "state");
  assert.throws(() => h.tree.link("parent", kid, mid), err => err.code === "state");
  assert.throws(() => h.tree.link("friend", kid, mid), err => err.code === "invalid");
  // the other direction is fine: a grandparent can be linked to a grandchild
  assert.doesNotThrow(() => h.tree.link("parent", grand, kid));
});

test("linking an existing link changes nothing", () => {
  const h = makeTree();
  const a = h.add({ g: "Данило" });
  const b = h.addRel(a, "child", { g: "Ема" });
  const before = h.tree.records().size;
  const same = h.tree.link("parent", a, b);
  assert.equal(same.puts.size, 0);
  assert.equal(same.group, null);
  const p = h.addRel(a, "partner", { g: "Теодора" });
  const partner = h.tree.link("partner", p, a);
  assert.equal(partner.puts.size, 0);
  assert.equal(h.tree.records().size, before + 2);
});
