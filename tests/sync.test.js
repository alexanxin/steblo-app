// Tasks 2.1 and 2.2: bucket hashes, the hello, clock agreement (reference R1, R5).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bucketHashes, makeHello, parseHello, clocksAgree, differingBuckets, makeStep2, readStep2 } from "../public/src/sync.js";
import { bucketOf } from "../public/src/records.js";
import { generateTree } from "./fixtures/tree.js";
import { makeTree } from "./fixtures/helpers.js";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const bytes = (n, fill) => Uint8Array.from({ length: n }, (_, i) => (fill + i) & 255);
const slice4 = (hashes, bucket) => Array.from(hashes.subarray(bucket * 4, bucket * 4 + 4));

function hello(overrides = {}) {
  return makeHello({
    device: "d000000000000001", app: "0.2.0", now: NOW,
    publicKey: bytes(65, 1), nonce: bytes(16, 7), hashes: bytes(1024, 3), ...overrides,
  });
}
const text = u8 => new TextDecoder().decode(u8);
const encode = value => new TextEncoder().encode(JSON.stringify(value));

test("identical records give identical hashes in any order", async () => {
  const { records } = generateTree({ people: 200, seed: 3, clocks: "hand" });
  const reversed = new Map([...records].reverse());
  const a = await bucketHashes(records);
  const b = await bucketHashes(reversed);
  assert.equal(a.length, 1024);
  assert.deepEqual(a, b);
  // and the fields of one record may come in any order, too
  const [id, record] = [...records][0];
  const shuffled = new Map(records);
  shuffled.set(id, { kind: record.kind, f: Object.fromEntries(Object.entries(record.f).reverse()) });
  assert.deepEqual(await bucketHashes(shuffled), a);
});

test("an edit changes exactly one bucket's hash", async () => {
  const h = makeTree();
  const ids = [h.add({ g: "Данило" }), h.add({ g: "Теодора" }), h.add({ g: "Миро" })];
  h.addRel(ids[0], "child", { g: "Ема" });
  const before = await bucketHashes(h.tree.records());
  h.advance();
  h.run(h.tree.edit(ids[1], { g: "Адам" }));
  const after = await bucketHashes(h.tree.records());
  const changed = differingBuckets(before, { h: after });
  assert.deepEqual(changed, [bucketOf(ids[1])]);
});

test("an empty bucket hashes []", async () => {
  const expected = Array.from(createHash("sha256").update("[]").digest().subarray(0, 4));
  const empty = await bucketHashes(new Map());
  for (let bucket = 0; bucket < 256; bucket++) assert.deepEqual(slice4(empty, bucket), expected, `bucket ${bucket}`);
  // a bucket that has a record no longer hashes []
  const h = makeTree();
  const id = h.add({ g: "Лея" });
  const hashes = await bucketHashes(h.tree.records());
  assert.notDeepEqual(slice4(hashes, bucketOf(id)), expected);
  assert.deepEqual(slice4(hashes, (bucketOf(id) + 1) % 256), expected);
});

test("a bucket hash is the first 4 bytes of SHA-256 over the sorted records as canonical JSON", async () => {
  const id = "00000000000000aa";
  const records = new Map([[id, { kind: "person", f: { g: ["Ема", 5, 1, "d000000000000001"], del: [false, 5, 1, "d000000000000001"] } }]]);
  const json = `[["${id}",{"del":[false,5,1,"d000000000000001"],"g":["Ема",5,1,"d000000000000001"]}]]`;
  const expected = Array.from(createHash("sha256").update(json).digest().subarray(0, 4));
  assert.deepEqual(slice4(await bucketHashes(records), 0), expected);
});

test("hello round trips and carries 1024 bytes of hashes", () => {
  const bytesOut = hello();
  const parsed = parseHello(bytesOut);
  assert.ok(parsed);
  assert.equal(parsed.f, 1);
  assert.equal(parsed.app, "0.2.0");
  assert.equal(parsed.d, "d000000000000001");
  assert.equal(parsed.w, NOW);
  assert.deepEqual(parsed.k, bytes(65, 1));
  assert.deepEqual(parsed.n, bytes(16, 7));
  assert.equal(parsed.h.length, 1024);
  assert.deepEqual(parsed.h, bytes(1024, 3));
  assert.deepEqual(parsed.bytes, bytesOut);
  // the wire shape of R5: UTF-8 JSON with these keys in this order
  assert.deepEqual(Object.keys(JSON.parse(text(bytesOut))), ["f", "app", "d", "w", "k", "n", "h"]);
  assert.ok(bytesOut.length < 2000, `hello is ${bytesOut.length} bytes`);
});

test("differingBuckets lists the buckets that differ", () => {
  const mine = bytes(1024, 0);
  const other = Uint8Array.from(mine);
  other[4 * 9 + 3] ^= 1; // bucket 9, last byte of the hash
  other[4 * 200] ^= 255; // bucket 200
  assert.deepEqual(differingBuckets(mine, parseHello(hello({ hashes: other }))), [9, 200]);
  assert.deepEqual(differingBuckets(mine, parseHello(hello({ hashes: mine }))), []);
});

test("makeStep2 and readStep2 round trip, with and without a message", () => {
  const h = hello();
  const message = bytes(500, 9);
  const withMessage = readStep2(makeStep2(h, message));
  assert.deepEqual(withMessage.helloBytes, h);
  assert.deepEqual(withMessage.message, message);
  const without = readStep2(makeStep2(h, null));
  assert.deepEqual(without.helloBytes, h);
  assert.equal(without.message, null);
  // u32 big-endian length, then the hello, then the message
  const raw = makeStep2(h, message);
  assert.equal(new DataView(raw.buffer, raw.byteOffset).getUint32(0), h.length);
  assert.equal(raw.length, 4 + h.length + message.length);
});

test("a hello length over 64 KB is rejected", () => {
  const big = new Uint8Array(65537);
  assert.equal(readStep2(makeStep2(big, null)), null);
  // the largest allowed still reads
  assert.equal(readStep2(makeStep2(new Uint8Array(65536), null)).helloBytes.length, 65536);
  // a length that runs past the end of the stream
  const lying = new Uint8Array(10);
  new DataView(lying.buffer).setUint32(0, 100);
  assert.equal(readStep2(lying), null);
  assert.equal(readStep2(new Uint8Array(3)), null);
  // parseHello refuses the same size
  assert.equal(parseHello(new Uint8Array(65537).fill(32)), null);
});

test("clocksAgree is false beyond 24 hours", () => {
  const a = parseHello(hello({ now: NOW }));
  assert.equal(clocksAgree(a, parseHello(hello({ now: NOW + DAY }))), true);
  assert.equal(clocksAgree(a, parseHello(hello({ now: NOW - DAY }))), true);
  assert.equal(clocksAgree(a, parseHello(hello({ now: NOW + DAY + 1 }))), false);
  assert.equal(clocksAgree(parseHello(hello({ now: NOW + DAY + 1 })), a), false);
});

test("a hostile hello with bad shapes is rejected", () => {
  const good = JSON.parse(text(hello()));
  assert.ok(parseHello(encode(good)));
  const b64 = n => Buffer.alloc(n, 1).toString("base64url");
  const bad = [
    "not json", "null", "[]", "42", '"x"',
    { ...good, f: 2 }, { ...good, f: "1" }, { ...good, f: undefined },
    { ...good, app: 5 }, { ...good, app: "x".repeat(65) }, { ...good, app: "" },
    { ...good, d: "D000000000000001" }, { ...good, d: "d00000000000001" }, { ...good, d: 7 },
    { ...good, w: "1800000000000" }, { ...good, w: 1.5 }, { ...good, w: -1 }, { ...good, w: Infinity },
    { ...good, k: b64(64) }, { ...good, k: b64(66) }, { ...good, k: "!!!" }, { ...good, k: 5 },
    { ...good, n: b64(15) }, { ...good, n: b64(17) },
    { ...good, h: b64(1023) }, { ...good, h: b64(1025) }, { ...good, h: [1, 2, 3] },
    { ...good, k: good.k + "=" }, // padding isn't base64url
  ];
  for (const item of bad) {
    const input = typeof item === "string" ? new TextEncoder().encode(item) : encode(item);
    assert.equal(parseHello(input), null, JSON.stringify(item)?.slice(0, 80) ?? String(item));
  }
  assert.equal(parseHello(new Uint8Array([0xff, 0xfe, 0x00])), null);
  assert.equal(parseHello(new Uint8Array(0)), null);
  // keys a later version adds are ignored, not an error
  assert.ok(parseHello(encode({ ...good, z: [1] })));
});
