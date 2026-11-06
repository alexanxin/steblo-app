// Task 2.9: two trees sync through encrypted QR images (design: Testing 2; reference R5–R8).
// Every stream (hello, step 2, step 3) is cut into LT frames, each frame is drawn as a real QR code, read back
// by the vendored jsQR from RGBA pixels, 20% of the frames are dropped and the rest shuffled.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Collector, ltFrames } from "../public/src/frames.js";
import { readRgba, toMatrix, toRgba } from "../public/src/qrcodec.js";
import { generateTree } from "./fixtures/tree.js";
import { copyRecords, pid, T0 } from "./fixtures/helpers.js";
import { commit, difference, makePhone, plainRecords, syncPair } from "./fixtures/simulate.js";

const jsQR = createRequire(import.meta.url)("../public/vendor/jsQR.js");
const BLOCK = 600; // R8: senders use S = 600

test("two trees sync through encrypted QR images with 20% of frames lost", async t => {
  let state = 20261106;
  const rand = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const stats = [];

  /** Show a stream as QR codes until the other phone has all of it. */
  const carry = async (stream, step) => {
    const frames = ltFrames(stream, { streamId: (rand() * 2 ** 32) >>> 0, blockSize: BLOCK });
    const collector = new Collector();
    const k = Math.ceil(stream.length / BLOCK);
    const stat = { step, bytes: stream.length, blocks: k, shown: 0, lost: 0, read: 0 };
    while (!collector.progress().done) {
      assert.ok(stat.shown < k * 6 + 40, `step ${step}: still not decoded after ${stat.shown} frames`);
      const batch = Array.from({ length: Math.max(8, Math.ceil(k / 2)) }, () => frames.next().value);
      stat.shown += batch.length;
      const kept = batch.filter(() => (rand() >= 0.2) || (stat.lost++, false));
      for (let i = kept.length - 1; i > 0; i--) { // shuffle
        const j = Math.floor(rand() * (i + 1));
        [kept[i], kept[j]] = [kept[j], kept[i]];
      }
      for (const frame of kept) {
        const bytes = readRgba(toRgba(toMatrix(frame)), jsQR);
        assert.ok(bytes, `step ${step}: a QR image did not decode`);
        stat.read += 1;
        collector.add(bytes);
        if (collector.progress().done) break;
      }
    }
    stats.push(stat);
    const received = collector.bytes();
    assert.deepEqual(Buffer.from(received), Buffer.from(stream), `step ${step}: the bytes that came out are the bytes that went in`);
    return received;
  };

  // 50 invented people on each side; ten of A's are also on B, with later edits there
  const left = generateTree({ people: 50, seed: 31, clocks: "hand" });
  const right = generateTree({ people: 50, seed: 32, clocks: "hand" });
  const a = makePhone({ device: pid("d", 1), prefix: "a", start: T0, records: copyRecords(left.records) });
  const b = makePhone({ device: pid("d", 2), prefix: "b", start: T0 + 30_000, records: copyRecords(right.records) });
  for (const id of left.ids.slice(0, 10)) b.tree.records().set(id, structuredClone(left.records.get(id)));
  for (const [n, id] of left.ids.slice(0, 10).entries()) {
    b.h.advance(1000);
    commit(b, b.tree.edit(id, { bp: `Место ${n}` }));
  }
  a.h.advance(5000);
  commit(a, a.tree.edit(left.ids[0], { g: "Данило", s: "Новаков" }));
  assert.notEqual(difference(a, b), null);
  assert.ok(a.tree.records().size >= 50 && b.tree.records().size >= 60);

  const result = await syncPair(a, b, { carry });
  assert.equal(result.stage, 3);

  // identical records, identical views, and everyone from both trees is there
  assert.equal(difference(a, b), null);
  assert.equal(plainRecords(a.tree.records()), plainRecords(b.tree.records()));
  assert.ok(a.tree.view().people.size >= 90);
  assert.equal(a.tree.view().people.get(left.ids[0]).f.g, "Данило");
  assert.equal(b.tree.view().people.get(left.ids[3]).f.bp, "Место 3");
  // all three streams really crossed, with frames lost on the way
  assert.deepEqual(stats.map(s => s.step), [1, 2, 3]);
  for (const s of stats) t.diagnostic(`step ${s.step}: ${s.bytes} bytes, ${s.blocks} blocks, ${s.shown} shown, ${s.lost} lost, ${s.read} read`);
  assert.ok(stats.reduce((n, s) => n + s.lost, 0) > 5, "frames were really dropped");
  assert.ok(stats[1].blocks > stats[0].blocks, "step 2 carries the data");
  // and another sync has nothing left to move
  const again = await syncPair(a, b);
  assert.equal(again.applied.summary.changedFields + again.applied.summary.newPeople, 0);
  assert.equal(again.back.change.puts.size, 0);
});
