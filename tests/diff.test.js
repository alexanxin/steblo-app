// Task 2.5: what step 3 sends (reference R5 What each step sends).
import test from "node:test";
import assert from "node:assert/strict";
import { applyPayload, buildDiff, buildPayload, bucketHashes, differingBuckets, makeHello, parseHello, payloadRecords } from "../public/src/sync.js";
import { makeTree, copyRecords, pid, T0 } from "./fixtures/helpers.js";
import { generateTree } from "./fixtures/tree.js";

const D1 = pid("d", 1);
const D2 = pid("d", 2);

async function helloOf(h) {
  return parseHello(makeHello({ device: h.device, app: "t", now: h.wall.now, publicKey: new Uint8Array(65), nonce: new Uint8Array(16), hashes: await bucketHashes(h.tree.records()) }));
}

/** Steps 2 and 3 of a sync, without the encryption: a shows first, b answers with its data. */
async function sync(a, b) {
  const helloA = await helloOf(a);
  const helloB = await helloOf(b);
  const forB = differingBuckets(helloB.h, helloA); // b sends the buckets that differ from a's hello
  const step2 = buildPayload(b.tree.records(), forB);
  const applied = applyPayload(a.tree, step2, { now: a.wall.now, helloW: b.wall.now, allowErase: true });
  a.run(applied.change);
  const step3 = buildDiff(a.tree.records(), step2, step2.b);
  const back = applyPayload(b.tree, step3, { now: b.wall.now, helloW: a.wall.now, allowErase: true });
  b.run(back.change);
  return { step2, step3, applied, back };
}

test("buildDiff sends only fields that differ from what was received", async () => {
  const a = makeTree({ device: D1, prefix: "a" });
  const x = a.add({ g: "Ема", s: "Новаков", bp: "Бокупа" });
  const y = a.add({ g: "Адам" });
  const b = makeTree({ device: D2, prefix: "b", records: copyRecords(a.tree.records()), start: T0 + 1000 });
  a.advance(10_000);
  a.run(a.tree.edit(x, { s: "Чарин" })); // newer on a
  b.advance(20_000);
  b.run(b.tree.edit(x, { g: "Лея" })); // newer on b
  const z = b.add({ g: "Миро" }); // only on b
  const w = a.add({ g: "Теодора" }); // only on a
  const { step2, step3 } = await sync(a, b);
  const sent = payloadRecords(step3);
  // x: a applied b's g, so only a's newer s goes back. y: equal, not sent. z: b has it. w: new to b, whole.
  assert.deepEqual([...sent.keys()].sort(), [x, w].sort());
  assert.deepEqual(Object.keys(sent.get(x).f), ["s"]);
  assert.equal(sent.get(x).f.s[0], "Чарин");
  assert.deepEqual(sent.get(w), a.get(w));
  assert.ok(!sent.has(y) && !sent.has(z));
  assert.deepEqual(step3.b, step2.b);
  // b's fields that a already holds equal are never repeated back
  assert.equal(sent.get(x).f.g, undefined);
});

test("buildDiff leaves out what is older than what was received, and what an erase makes pointless", () => {
  const a = makeTree({ device: D1, prefix: "a" });
  const x = a.add({ g: "Ема", s: "Чарин" });
  const b = makeTree({ device: D2, prefix: "b", records: copyRecords(a.tree.records()), start: T0 + 1000 });
  b.advance(10_000);
  b.run(b.tree.edit(x, { g: "Лея" }));
  // a does not accept b's change (say it was refused): a holds the older g and must not send it back
  const received = buildPayload(b.tree.records(), [...Array(256).keys()]);
  assert.equal(payloadRecords(buildDiff(a.tree.records(), received, [...Array(256).keys()])).size, 0);
  // b erased x; a did not apply it: nothing about x goes back, since an erased record wins anyway
  b.run(b.tree.erase(x));
  const erased = buildPayload(b.tree.records(), [...Array(256).keys()]);
  assert.equal(payloadRecords(buildDiff(a.tree.records(), erased, [...Array(256).keys()])).has(x), false);
  // a record only a has, in a bucket b has no records in, goes whole
  const c = a.add({ g: "Адам" });
  assert.deepEqual(payloadRecords(buildDiff(a.tree.records(), erased, [...Array(256).keys()])).get(c), a.get(c));
  // buckets that were not asked about are left alone
  assert.equal(payloadRecords(buildDiff(a.tree.records(), erased, [])).size, 0);
});

test("after step 3 both devices hold identical records", async () => {
  const base = generateTree({ people: 120, seed: 5, clocks: "hand" });
  const a = makeTree({ device: D1, prefix: "a", records: copyRecords(base.records), start: T0 });
  const b = makeTree({ device: D2, prefix: "b", records: copyRecords(base.records), start: T0 + 1000 });
  // each phone edits, adds and removes a little
  for (const [h, from] of [[a, 0], [b, 40]]) {
    for (let n = 0; n < 12; n++) {
      h.advance(7000);
      const id = base.ids[from + n * 3];
      h.run(h.tree.edit(id, n % 2 ? { bp: `Место ${n}` } : { g: `Име${n}` }));
      if (n % 5 === 0) h.run(h.tree.removePerson(base.ids[from + n * 3 + 1]));
    }
    const fresh = h.add({ g: "Нов", s: "Новаков" });
    h.addRel(fresh, "child", { g: "Дете" });
  }
  // some of the same fields too, so there are real conflicts
  a.advance(1000);
  a.run(a.tree.edit(base.ids[60], { g: "Адам" }));
  b.advance(5000);
  b.run(b.tree.edit(base.ids[60], { g: "Лея" }));
  await sync(a, b);
  assert.deepEqual([...b.tree.records()].sort(), [...a.tree.records()].sort());
  assert.deepEqual(b.tree.view(), a.tree.view());
  assert.equal(b.get(base.ids[60]).f.g[0], "Лея");
  // and now there is nothing left to say
  const after = differingBuckets(await bucketHashes(a.tree.records()), await helloOf(b));
  assert.deepEqual(after, []);
});
