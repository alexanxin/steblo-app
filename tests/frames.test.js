import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Collector, HEADER, crc32, cyclicFrames, ltFrames, makeFrame, parseFrame } from "../public/src/frames.js";

const frame = () => makeFrame({ streamId: 7, length: 400, blockSize: 300, n: 0 }, new Uint8Array(300));

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new TextEncoder().encode("1234"), new TextEncoder().encode("56789")), 0xcbf43926);
});

test("a frame survives a round trip", () => {
  const f = parseFrame(frame());
  assert.deepEqual([f.streamId, f.length, f.blockSize, f.coding, f.n], [7, 400, 300, 0, 0]);
});

test("corrupt frames are rejected", () => {
  const bad = frame(); bad[HEADER + 10] ^= 1;
  assert.equal(parseFrame(bad), null);
});

test("headers over the caps are rejected before any block is read", () => {
  const set = (offset, value, size) => {
    const f = frame(), v = new DataView(f.buffer);
    size === 4 ? v.setUint32(offset, value) : v.setUint16(offset, value);
    return f;
  };
  assert.equal(parseFrame(set(5, 5 * 1024 * 1024, 4)), null, "stream too long");
  assert.equal(parseFrame(set(9, 100, 2)), null, "block too small");
  assert.equal(parseFrame(set(9, 2000, 2)), null, "block too big");
  assert.equal(parseFrame(new Uint8Array(5)), null, "too short");
});

test("the collector rebuilds a stream with frames lost and shuffled", () => {
  const stream = randomBytes(5000), gen = cyclicFrames(stream, { streamId: 1, blockSize: 300 });
  const c = new Collector();
  const frames = Array.from({ length: 300 }, () => gen.next().value).sort(() => Math.random() - 0.5);
  for (const f of frames) { if (Math.random() < 0.2) continue; if (c.add(f).done) break; }
  assert.ok(c.progress().done);
  assert.deepEqual(Buffer.from(c.bytes()), stream);
});

test("the collector rebuilds an LT stream with frames lost", () => {
  const stream = randomBytes(5000), gen = ltFrames(stream, { streamId: 5, blockSize: 300 });
  const c = new Collector();
  for (let i = 0; i < 600 && !c.progress().done; i++) {
    const f = gen.next().value;
    if (Math.random() > 0.2) c.add(f);
  }
  assert.ok(c.progress().done);
  assert.deepEqual(Buffer.from(c.bytes()), stream);
});

test("the collector ignores another stream, then moves to it after a stall", () => {
  let t = 0;
  const c = new Collector({ now: () => t });
  const a = cyclicFrames(randomBytes(900), { streamId: 1, blockSize: 300 });
  const b = cyclicFrames(randomBytes(600), { streamId: 2, blockSize: 300 });
  c.add(a.next().value);
  c.add(b.next().value);
  assert.deepEqual(c.progress(), { received: 1, total: 3, done: false });
  t = 3000;
  c.add(b.next().value);
  assert.deepEqual(c.progress(), { received: 1, total: 2, done: false });
});
