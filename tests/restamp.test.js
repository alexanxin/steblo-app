// Task 2.6: fixing times written while the clock was ahead (reference R5 Re-stamp, R2, R10).
import test from "node:test";
import assert from "node:assert/strict";
import { restamp } from "../public/src/sync.js";
import { compareTimes } from "../public/src/clock.js";
import { makeTree, pid, T0 } from "./fixtures/helpers.js";

const DAY = 86_400_000;
const D1 = pid("d", 1);
const D2 = pid("d", 2);

/** A phone whose clock ran ten days ahead while it made these edits, then was set right. */
function wasAhead() {
  const h = makeTree({ device: D1, start: T0 + 10 * DAY });
  const x = h.add({ g: "Ема" }); // time F1
  h.advance(60_000);
  h.run(h.tree.edit(x, { g: "Лея" })); // F2
  h.advance(60_000);
  const y = h.add({ g: "Адам", s: "Чарин" }); // F3, two fields at one time
  h.wall.now = T0; // the clock is fixed
  return { h, x, y };
}
const times = (h, ids) => ids.flatMap(id => Object.values(h.get(id).f)).map(t => [t[1], t[2]]);

test("own future triples get new times in their original order", () => {
  const { h, x, y } = wasAhead();
  const originalOrder = [h.get(x).f.g, h.get(y).f.g].map(t => [t[1], t[2]]);
  const change = restamp(h.tree, h.wall.now);
  assert.ok(change);
  h.run(change);
  // nothing of the device's is more than 24 hours ahead any more
  for (const [ms] of times(h, [x, y])) assert.ok(ms <= T0 + DAY, `${ms}`);
  // the order is kept, and a single action's fields still share one time
  const after = [h.get(x).f.g, h.get(y).f.g].map(t => [t[1], t[2]]);
  assert.equal(compareTimes(originalOrder[0], originalOrder[1]) < 0, true);
  assert.equal(compareTimes(after[0], after[1]) < 0, true);
  assert.deepEqual([h.get(y).f.g[1], h.get(y).f.g[2]], [h.get(y).f.s[1], h.get(y).f.s[2]]);
  // x's creation (del, g) and its later edit (g) keep their order: creation first
  assert.equal(compareTimes([h.get(x).f.del[1], h.get(x).f.del[2]], [h.get(x).f.g[1], h.get(x).f.g[2]]) < 0, true);
  // values and setters are untouched
  assert.equal(h.get(x).f.g[0], "Лея");
  assert.equal(h.get(x).f.g[3], D1);
  // and the clock is back in the present: the next edit is not stamped in the future
  h.advance(1000);
  const next = h.tree.edit(x, { g: "Миро" });
  assert.ok(next.puts.get(x).f.g[1] <= T0 + DAY);
  assert.equal(compareTimes([next.puts.get(x).f.g[1], next.puts.get(x).f.g[2]], after[0]) > 0, true);
});

test("an edit made after a delete still revives after re-stamping", () => {
  const h = makeTree({ device: D1, start: T0 + 10 * DAY });
  const x = h.add({ g: "Ема" });
  h.advance(1000);
  h.run(h.tree.removePerson(x)); // the delete
  h.advance(1000);
  h.run(h.tree.edit(x, { g: "Лея" })); // an edit after it: shows again
  assert.equal(h.tree.view().people.has(x), true);
  h.wall.now = T0;
  h.run(restamp(h.tree, h.wall.now));
  assert.equal(h.tree.view().people.has(x), true);
  assert.equal(h.tree.view().people.get(x).f.g, "Лея");
  // and a delete after the last edit still deletes
  h.run(h.tree.removePerson(x));
  assert.equal(h.tree.view().people.has(x), false);
  const { h: g, x: gx } = (() => { const k = makeTree({ device: D1, start: T0 + 10 * DAY }); const id = k.add({ g: "Адам" }); k.advance(10); k.run(k.tree.edit(id, { g: "Миро" })); k.advance(10); k.run(k.tree.removePerson(id)); k.wall.now = T0; return { h: k, x: id }; })();
  g.run(restamp(g.tree, g.wall.now));
  assert.equal(g.tree.view().people.has(gx), false);
});

test("other devices' triples are left alone", () => {
  const h = makeTree({ device: D1, start: T0 });
  const x = h.add({ g: "Ема" });
  // another phone's triples, one in the present and one far ahead (accepted when that phone's clock was believed)
  const y = pid("e", 5); // a person only the other phone wrote, with a triple far ahead
  const records = h.tree.records();
  const other = { ...records.get(x), f: { ...records.get(x).f, bp: ["Бокупа", T0 + 5, 0, D2], sx: ["F", T0 + 5, 1, D2] } };
  records.set(x, other);
  records.set(y, { kind: "person", f: { g: ["Адам", T0 + 20 * DAY, 3, D2], del: [false, T0 + 20 * DAY, 3, D2] } });
  const own = h.tree.edit(x, { s: "Чарин" });
  h.run(own);
  h.wall.now = T0 - 12 * DAY; // this phone's clock was far ahead and is now fixed: its own triples are now > 24 h ahead
  const before = { ...h.get(x).f };
  const change = restamp(h.tree, h.wall.now);
  h.run(change);
  assert.deepEqual(h.get(x).f.bp, before.bp);
  assert.deepEqual(h.get(x).f.sx, before.sx);
  assert.notDeepEqual(h.get(x).f.s, before.s); // its own were rewritten
  assert.equal(h.get(x).f.s[3], D1);
  assert.equal(change.group.changes.every(c => h.get(c.r).f[c.f][3] === D1), true);
  assert.equal(change.puts.has(y), false);
  assert.equal(h.get(y).f.g[1], T0 + 20 * DAY);
  // the clock stays past the other phone's future triple that remains in the records
  const next = h.tree.edit(x, { g: "Лея" });
  assert.equal(compareTimes([next.puts.get(x).f.g[1], next.puts.get(x).f.g[2]], [T0 + 20 * DAY, 3]) > 0, true);
});

test("nothing happens when no triple is ahead", () => {
  const h = makeTree({ device: D1, start: T0 });
  const x = h.add({ g: "Ема" });
  assert.equal(restamp(h.tree, h.wall.now), null);
  // exactly 24 hours ahead is not "more than"
  h.wall.now = T0 - DAY;
  assert.equal(restamp(h.tree, h.wall.now), null);
  h.wall.now = T0 - DAY - 1;
  assert.ok(restamp(h.tree, h.wall.now));
  assert.equal(restamp(makeTree({ device: D1 }).tree, T0), null);
  assert.ok(x);
});

test("the re-stamp is one history group", () => {
  const { h, x, y } = wasAhead();
  const before = { x: { ...h.get(x).f }, y: { ...h.get(y).f } };
  const change = restamp(h.tree, h.wall.now);
  const group = change.group;
  assert.equal(group.action, "restamp");
  assert.equal(group.device, D1);
  assert.equal(group.at, h.wall.now);
  assert.deepEqual(group.lost, []);
  assert.deepEqual([...group.people].sort(), [x, y].sort());
  // it lists every field it rewrote, with the triple before and after
  const rewrites = Object.keys(before.x).length + Object.keys(before.y).length;
  assert.equal(group.changes.length, rewrites);
  for (const c of group.changes) {
    const old = (c.r === x ? before.x : before.y)[c.f];
    assert.deepEqual(c.before, old);
    assert.deepEqual(c.after.slice(0, 1), old.slice(0, 1));
    assert.ok(c.after[1] < c.before[1]);
  }
  // one group, and the puts are only the records it touched
  assert.deepEqual([...change.puts.keys()].sort(), [x, y].sort());
  assert.equal(h.tree.records().get(x), h.get(x)); // not adopted until the caller does
  assert.equal(h.get(x).f.g[1] > T0 + DAY, true);
});
