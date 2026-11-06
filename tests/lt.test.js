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

test("the tables are what their generator writes", async () => {
  const { render } = await import("../scripts/lt-tables.mjs");
  const { readFileSync } = await import("node:fs");
  assert.equal(readFileSync(new URL("../public/src/lt-tables.js", import.meta.url), "utf8"), render());
});

test("every table rises to the top threshold", async () => {
  const { TABLES } = await import("../public/src/lt-tables.js");
  for (const t of TABLES) {
    assert.equal(t.cdf.at(-1), 4294967295, `class ${t.k}`);
    assert.ok(t.cdf.every((x, i) => i === 0 || x >= t.cdf[i - 1]), `class ${t.k} rises`);
  }
});

test("large transfers send coded frames from the start", () => {
  const b = blocks(150), got = encodeBlock(b, 9, 3), want = new Uint8Array(64);
  for (const i of picks(9, 3, 150)) for (let j = 0; j < 64; j++) want[j] ^= b[i][j];
  assert.deepEqual(got, want);
});
