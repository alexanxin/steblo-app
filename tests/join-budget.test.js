// Task 3.5: the budget fixture (reference R9 Budget fixture).
import test from "node:test";
import assert from "node:assert/strict";
import { applyPayload, buildPayload } from "../public/src/sync.js";
import { createWalk } from "../public/src/join.js";
import { makeTree, T0 } from "./fixtures/helpers.js";
import { buildOverlap } from "./fixtures/overlap.js";

const ALL = Array.from({ length: 256 }, (_, n) => n);

// Seeds where the generator's single founder couple has enough descendants to fill the quotas.
for (const seed of [11, 1, 3, 9, 10, 15]) {
test(`the 300-person overlap needs at most 40 questions, with no false merge and nobody missed${seed === 11 ? "" : ` (seed ${seed})`}`, () => {
  const fx = buildOverlap({ seed });
  assert.deepEqual([fx.counts.a, fx.counts.b, fx.counts.shared], [400, 350, 300]);

  const a = makeTree({ device: fx.a.device, prefix: "c", records: fx.a.records, start: T0 });
  const b = makeTree({ device: fx.b.device, prefix: "d", records: fx.b.records, start: T0 + 5000 });
  const result = applyPayload(a.tree, buildPayload(b.tree.records(), ALL), { now: T0, helloW: T0 + 5000, allowErase: true });
  a.run(result.change);
  assert.equal(a.tree.view().people.size, 750); // nothing is merged yet

  const walk = createWalk(a.tree, { pairs: [fx.startPair], selfPairs: [], incoming: result.incoming, session: "budget" });
  const truthOf = id => fx.truth.get(a.tree.view().people.get(id).members[0]);
  let questions = 0;
  for (let q = walk.next(); q; q = walk.next()) {
    questions += 1;
    const same = q.candidates.find(c => truthOf(c.id) === truthOf(q.x.id));
    walk.answer(q, same ? { same: same.id } : "different");
  }

  // no false merge: everyone in one set is the same human
  const view = a.tree.view();
  for (const person of view.people.values()) {
    assert.equal(new Set(person.members.map(m => fx.truth.get(m))).size, 1, `false merge around ${person.id}`);
  }
  // nobody missed: each shared human is one person
  const byTruth = new Map();
  for (const person of view.people.values()) for (const m of person.members) byTruth.set(fx.truth.get(m), (byTruth.get(fx.truth.get(m)) ?? new Set()).add(person.id));
  const split = [...byTruth.values()].filter(set => set.size > 1);
  assert.equal(split.length, 0, `${split.length} shared people left in two`);
  assert.equal(view.people.size, 450);
  assert.ok(questions <= 40, `${questions} questions`);
  assert.ok(questions >= fx.counts.closeNames, "the close names were asked"); // sanity: the fixture really exercises questions
});
}
