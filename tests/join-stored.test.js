// Task 6.3: the app stores every answer of the join as its own change, in order. A killed app, or Cancel, leaves a
// prefix of those changes. Any prefix must be a sound tree (no false merge), and a new walk from the same start
// must keep it sound (R9 Commits).
import test from "node:test";
import assert from "node:assert/strict";
import { applyPayload, buildPayload } from "../public/src/sync.js";
import { createWalk } from "../public/src/join.js";
import { copyRecords, makeTree, T0 } from "./fixtures/helpers.js";
import { buildOverlap } from "./fixtures/overlap.js";

const ALL = Array.from({ length: 256 }, (_, n) => n);

function setup() {
  const fx = buildOverlap({ seed: 11 });
  const a = makeTree({ device: fx.a.device, prefix: "c", records: fx.a.records, start: T0 });
  const b = makeTree({ device: fx.b.device, prefix: "d", records: fx.b.records, start: T0 + 5000 });
  const result = applyPayload(a.tree, buildPayload(b.tree.records(), ALL), { now: T0, helloW: T0 + 5000, allowErase: true });
  a.run(result.change);
  return { fx, a, incoming: result.incoming, base: copyRecords(a.tree.records()) };
}

/** Answer from the truth table until the walk has no more questions. */
function finish(fx, h, walk) {
  const truthOf = id => fx.truth.get(h.tree.view().people.get(id).members[0]);
  for (let q = walk.next(); q; q = walk.next()) {
    const same = q.candidates.find(c => truthOf(c.id) === truthOf(q.x.id));
    walk.answer(q, same ? { same: same.id } : "different");
  }
}

function assertSound(fx, h, people) {
  const view = h.tree.view();
  for (const person of view.people.values()) assert.equal(new Set(person.members.map(m => fx.truth.get(m))).size, 1, `false merge around ${person.id}`);
  if (people) assert.equal(view.people.size, people);
}

test("a join stopped after any number of stored changes is a sound tree, and a new walk never makes it unsound", () => {
  const { fx, a, incoming, base } = setup();
  const log = [];
  const walk = createWalk(a.tree, { pairs: [fx.startPair], selfPairs: [], incoming, session: "stored", commit: change => { log.push(change); a.run(change); } });
  finish(fx, a, walk);
  assertSound(fx, a, 450);
  assert.ok(log.length > 10, `${log.length} stored changes`);
  assert.ok(log.every(c => c.group && c.group.session === "stored"), "every stored change carries the join session");

  for (const k of [0, 1, 2, Math.floor(log.length / 2), log.length - 1]) {
    const replica = makeTree({ device: fx.a.device, prefix: "e", records: copyRecords(base), start: T0 + 60_000 });
    for (const change of log.slice(0, k)) replica.tree.adopt(change);
    assertSound(fx, replica); // the prefix alone is a sound tree
    const again = createWalk(replica.tree, { pairs: [fx.startPair], selfPairs: [], incoming, session: "again" });
    finish(fx, replica, again);
    // The second walk is sound whenever it was started. It finishes the whole join only if nothing past the first pair
    // was stored: people already merged are not new any more, so their relatives are not visited again. What is left
    // then is found with "Look for duplicates around…" (see the notes for Milestone 6).
    assertSound(fx, replica);
    const size = replica.tree.view().people.size;
    assert.ok(size >= 450 && size <= 750, `${size} people`);
    if (k <= 1) assert.equal(size, 450);
  }
});

test("each answer is one change with one History group", () => {
  const { fx, a, incoming } = setup();
  const changes = [];
  const walk = createWalk(a.tree, { pairs: [fx.startPair], selfPairs: [], incoming, session: "groups", commit: change => { changes.push(change); a.run(change); } });
  const truthOf = id => fx.truth.get(a.tree.view().people.get(id).members[0]);
  let answers = 0;
  for (let q = walk.next(); q && answers < 3; q = walk.next()) {
    const before = changes.length;
    const same = q.candidates.find(c => truthOf(c.id) === truthOf(q.x.id));
    walk.answer(q, same ? { same: same.id } : "different");
    answers += 1;
    assert.equal(changes.length, before + 1, "one answer, one stored change");
  }
  assert.equal(answers, 3);
});
