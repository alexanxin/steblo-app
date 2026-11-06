// Hourglass and whole-tree layout (reference R4 layout contract). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutHourglass, layoutForest, CARD_W, spousesOf } from "../public/src/layout.js";
import { createClock } from "../public/src/clock.js";
import { createTree } from "../public/src/tree.js";
import { generateTree } from "./fixtures/tree.js";
import { makeTree } from "./fixtures/helpers.js";

/** Danilo and Teodora (partners) have Miro and Ema; Miro has Adam with Lea; Danilo's parents are Gjeko and Čarin. */
function family() {
  const h = makeTree();
  const danilo = h.add({ g: "Данило", s: "Новаков", sx: "M" });
  const teodora = h.addRel(danilo, "partner", { g: "Теодора", s: "Новакова", sx: "F" });
  const miro = h.addRel(danilo, "child", { g: "Миро", s: "Новаков", sx: "M" }, { otherParent: teodora });
  const ema = h.addRel(danilo, "child", { g: "Ема", s: "Новакова", sx: "F" }, { otherParent: teodora });
  const lea = h.addRel(miro, "partner", { g: "Леа", sx: "F" });
  const adam = h.addRel(miro, "child", { g: "Адам", s: "Новаков", sx: "M" }, { otherParent: lea });
  const gjeko = h.addRel(danilo, "parent", { g: "Ѓеко", s: "Новаков", sx: "M" });
  const carin = h.addRel(danilo, "parent", { g: "Чарин", s: "Чарин", sx: "F" });
  return { h, view: h.tree.view(), ids: { danilo, teodora, miro, ema, lea, adam, gjeko, carin } };
}

const byId = layout => new Map(layout.nodes.map(n => [n.id, n]));

test("the hourglass places ancestors above and descendants below", () => {
  const { view, ids } = family();
  const layout = layoutHourglass(view, ids.danilo);
  const at = byId(layout);
  assert.equal(at.get(ids.danilo).y, 0);
  assert.ok(at.get(ids.gjeko).y < 0 && at.get(ids.carin).y < 0, "parents are above");
  assert.ok(at.get(ids.miro).y > 0 && at.get(ids.ema).y > 0, "children are below");
  assert.ok(at.get(ids.adam).y > at.get(ids.miro).y, "grandchildren are further below");
  assert.equal(at.get(ids.teodora).y, 0, "a partner sits beside the person");
  assert.ok(at.get(ids.teodora).x > 0);
  assert.ok(layout.bounds.minY < 0 && layout.bounds.maxY > 0 && layout.bounds.minX < layout.bounds.maxX);
  assert.ok(layout.edges.length > 0);
  // depth limits
  const down = layoutHourglass(view, ids.danilo, { up: 0, down: 1 });
  assert.equal(down.nodes.some(n => n.y < 0), false);
  assert.equal(byId(down).has(ids.adam), false);
});

test("an anchor is partners[0], and a child appears once in the forest", () => {
  const { view, ids } = family();
  const f = view.families.find(x => x.children.includes(ids.miro));
  assert.equal(f.partners[0], ids.danilo); // sex M first
  const layout = layoutForest(view);
  const counts = new Map();
  for (const n of layout.nodes) counts.set(n.id, (counts.get(n.id) || 0) + 1);
  assert.equal(counts.get(ids.miro), 1);
  assert.equal(counts.get(ids.ema), 1);
  // the partner has no card of her own in the whole tree: she is a line on the anchor's card
  assert.equal(counts.has(ids.teodora), false);
  assert.deepEqual(spousesOf(view, ids.danilo), [ids.teodora]);
  assert.equal(layout.host.get(ids.teodora), ids.danilo);
  // everyone with a card is somebody in the tree, and each person is drawn at most once
  assert.ok([...counts.values()].every(c => c === 1));
  // a child with two sets of parents is drawn once, under the family its own parent links pick
  const h = makeTree();
  const a = h.add({ g: "Адам", sx: "M" });
  const b = h.addRel(a, "partner", { g: "Леа", sx: "F" });
  const c = h.addRel(a, "child", { g: "Миро" }, { otherParent: b });
  const d = h.add({ g: "Данило", sx: "M" });
  h.run(h.tree.editPartnership(d, b, {}));
  const kids = layoutForest(h.tree.view()).nodes.filter(n => n.id === c);
  assert.equal(kids.length, 1);
});

test("an ancestor loop stops at the repeat", () => {
  // Miro is Ema's parent and Ema is Miro's parent: records a person can reach through sync, not through the UI
  const h = makeTree();
  const miro = h.add({ g: "Миро" });
  const ema = h.addRel(miro, "child", { g: "Ема" });
  h.run({ puts: new Map([[`p:${ema}:${miro}`, { kind: "parent", f: { del: [false, 1, 0, h.device] } }]]), group: null, meta: {} });
  const view = h.tree.view();
  assert.deepEqual(view.attention.loops.length > 0, true);
  const layout = layoutHourglass(view, miro, { up: 8, down: 8 });
  const ids = layout.nodes.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length, "nobody is drawn twice");
  assert.ok(layout.nodes.length <= 2);
  assert.ok(layoutForest(view).nodes.length >= 0);
});

test("layout of 3,420 invented people takes under 300 ms on Node", () => {
  const { records } = generateTree({ people: 3420, seed: 1 });
  const tree = createTree({ device: "d000000000000001", records, clock: createClock() });
  const view = tree.view(); // not part of the measurement: view() has its own budget
  const started = performance.now();
  const forest = layoutForest(view);
  const forestMs = performance.now() - started;
  const some = [...view.people.keys()][1500];
  const t2 = performance.now();
  const hourglass = layoutHourglass(view, some, { up: 8, down: 8 });
  const hourglassMs = performance.now() - t2;
  assert.ok(forestMs < 300, `forest took ${forestMs.toFixed(0)} ms`);
  assert.ok(hourglassMs < 300, `hourglass took ${hourglassMs.toFixed(0)} ms`);
  // every visible person is drawn in the forest, on a card or on a partner's card
  const drawn = new Set([...forest.nodes.map(n => n.id), ...forest.host.keys()]);
  const missing = [...view.people.keys()].filter(id => !drawn.has(id));
  assert.equal(missing.length, 0, `${missing.length} people are not drawn`);
  assert.ok(hourglass.nodes.length >= 1);
});

test("no two cards in a row overlap", () => {
  const { records } = generateTree({ people: 800, seed: 5 });
  const tree = createTree({ device: "d000000000000001", records, clock: createClock() });
  const view = tree.view();
  const check = layout => {
    const rows = new Map();
    for (const n of layout.nodes) (rows.get(n.y) || rows.set(n.y, []).get(n.y)).push(n.x);
    for (const xs of rows.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= CARD_W - 0.5, "cards overlap");
    }
  };
  check(layoutForest(view));
  for (const id of [...view.people.keys()].slice(100, 130)) check(layoutHourglass(view, id, { up: 4, down: 3 }));
});
