import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Peeler, encodeBlock, picks } from "../public/src/lt.js";

const blocks = k => Array.from({ length: k }, () => Uint8Array.from(randomBytes(64)));

test("picks are fixed for a stream and frame, distinct and in range", () => {
  const a = picks(99, 500, 300);
  assert.deepEqual(picks(99, 500, 300), a);
  assert.equal(new Set(a).size, a.length);
  assert.ok(a.every(i => i >= 0 && i < 300));
});

test("the first K frames carry the blocks themselves", () => {
  const b = blocks(10);
  assert.equal(encodeBlock(b, 1, 3), b[3]);
});

for (const lost of [0.05, 0.2, 0.35]) {
  test(`every block is recovered with ${lost * 100}% of frames lost`, () => {
    const k = 150, b = blocks(k), p = new Peeler(k, 77);
    for (let n = 0; p.got < k; n++) {
      assert.ok(n < k * 12, "gave up");
      if (Math.random() > lost) p.add(n, encodeBlock(b, 77, n));
    }
    b.forEach((block, i) => assert.deepEqual(p.known[i], block));
  });
}
