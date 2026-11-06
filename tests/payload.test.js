// Task 2.3: the compact payload (reference R5 Payload).
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { buildPayload, packPayload, unpackPayload, payloadRecords } from "../public/src/sync.js";
import { bucketOf, kindOf } from "../public/src/records.js";
import { generateTree } from "./fixtures/tree.js";

const ALL = Array.from({ length: 256 }, (_, n) => n);
const A = "a000000000000001";
const B = "b000000000000002";
const C = "c000000000000003";
const DEV1 = "d000000000000001";
const DEV2 = "d000000000000002";

/** One record of every kind, with different times and setters, an unknown field, a date and an erased person. */
function everyKind() {
  const t = (v, ms, counter = 0, by = DEV1) => [v, ms, counter, by];
  return new Map([
    [A, { kind: "person", f: { g: t("Данило", 1000), s: t("Новаков", 1000), bd: t({ y: 1950, m: 3, q: "abt" }, 1000), sx: t("M", 1000), del: t(false, 1000), xy: t([1, { a: null }], 1000) } }],
    [B, { kind: "person", f: { g: t("Теодора", 2000, 4, DEV2), dc: t(true, 2500, 1, DEV2), bp: t(null, 2500, 1, DEV2), del: t(false, 2000, 4, DEV2) } }],
    [C, { kind: "person", f: { er: t(true, 3000, 0, DEV2) } }],
    [`p:${A}:${B}`, { kind: "parent", f: { del: t(false, 1000) } }],
    [`u:${A}:${B}`, { kind: "partner", f: { md: t({ y: 1975 }, 1100), mp: t("Бокупа", 1100), en: t(false, 1200, 2), del: t(false, 1100) } }],
    [`m:${A}:${C}`, { kind: "merge", f: { del: t(false, 3500) } }],
    [`n:${A}:${B}`, { kind: "notsame", f: { del: t(true, 3600, 7, DEV2) } }],
    [`d:${DEV1}`, { kind: "device", f: { nm: t("Телефон на Данило", 900) } }],
    [`d:${DEV2}`, { kind: "device", f: { nm: t("Ema's phone", 950, 0, DEV2), qq: t(5, 960, 0, DEV2) } }],
  ]);
}

test("payload round trips every kind of record", async () => {
  const records = everyKind();
  const payload = buildPayload(records, ALL);
  assert.equal(payload.f, 1);
  const again = await unpackPayload(await packPayload(payload));
  assert.deepEqual(again, payload);
  assert.deepEqual(payloadRecords(again), records);
  // with only some buckets, only their records
  const some = buildPayload(records, [bucketOf(A)]);
  assert.deepEqual(some.b, [bucketOf(A)]);
  for (const id of payloadRecords(some).keys()) assert.equal(bucketOf(id), bucketOf(A));
  assert.ok(payloadRecords(some).has(A));
  // an empty selection is an empty payload
  assert.equal(payloadRecords(buildPayload(records, [])).size, 0);
});

test("fields set at a different time go in the override object", () => {
  const records = everyKind();
  const payload = buildPayload(records, ALL);
  // B has g and del at (2000,4), dc and bp at (2500,1): two of each. Whichever time is the record's clock,
  // the other two travel with their own clock in the second object.
  const row = payload.p.find(entry => payload.i[entry[0]] === B);
  assert.equal(row.length, 4);
  const [, , plain, overrides] = row;
  assert.deepEqual(Object.keys(plain).sort().concat(Object.keys(overrides).sort()).sort(), ["bp", "dc", "del", "g"]);
  assert.equal(Object.keys(plain).length, 2);
  for (const [value, clock] of Object.values(overrides)) {
    assert.ok(Number.isInteger(clock) && clock >= 0 && clock < payload.c.length);
    assert.ok(value === null || value === true);
  }
  // a record whose fields share one time has no second object
  const single = payload.p.find(entry => payload.i[entry[0]] === A);
  assert.equal(single.length, 3);
  // links: ["p"|"u", a, b, clock, fields, overrides?]
  const partner = payload.l.find(entry => entry[0] === "u");
  assert.equal(partner.length, 6);
  assert.equal(payload.i[partner[1]], A);
  assert.equal(payload.i[partner[2]], B);
  assert.deepEqual(Object.keys(partner[5]), ["en"]);
  // merge and not-same go in x, devices in d
  assert.deepEqual(payload.x.map(entry => entry[0]).sort(), ["m", "n"]);
  assert.deepEqual(payload.d.map(entry => entry[0]).sort(), [DEV1, DEV2]);
});

test("the clock table is sorted and stores differences", () => {
  const payload = buildPayload(everyKind(), ALL);
  // every distinct (time, setter) once; sorted by time then setter
  assert.deepEqual(payload.dv, [...new Set(payload.dv)].sort());
  let ms = 0;
  let previous = null;
  const absolute = payload.c.map(([delta, counter, setter]) => {
    assert.ok(Number.isInteger(delta) && delta >= 0, "differences are not negative");
    assert.ok(Number.isInteger(counter) && counter >= 0 && counter <= 65535);
    assert.ok(Number.isInteger(setter) && setter >= 0 && setter < payload.dv.length);
    ms += delta;
    const entry = [ms, counter, payload.dv[setter]];
    if (previous) assert.ok(previous[0] < ms || (previous[0] === ms && (previous[1] < counter || (previous[1] === counter && previous[2] < entry[2]))), "sorted and distinct");
    previous = entry;
    return entry;
  });
  // the first is stored whole, the rest as differences from the one before
  assert.equal(payload.c[0][0], absolute[0][0]);
  assert.ok(payload.c[1][0] < absolute[1][0]);
  assert.deepEqual(absolute.map(([m, c, by]) => `${m}.${c}.${by}`).slice(0, 3), [`900.0.${DEV1}`, `950.0.${DEV2}`, `960.0.${DEV2}`]);
  // person IDs are listed once, sorted
  assert.deepEqual(payload.i, [...new Set(payload.i)].sort());
});

test("unpackPayload rejects over 16 MiB, stopping as it decompresses", async () => {
  const MiB = 1024 * 1024;
  const spaces = size => Buffer.concat([Buffer.from('{"f":1}'), Buffer.alloc(size - 7, 32)]); // valid JSON, then padding
  const bomb = deflateRawSync(spaces(200 * MiB)); // 200 MiB in about 200 KB
  assert.ok(bomb.length < 1 * MiB);
  await assert.rejects(unpackPayload(bomb), error => error.code === "payload");
  // a zero-padded size just over the limit is refused, too
  await assert.rejects(unpackPayload(deflateRawSync(spaces(16 * MiB + 1))), error => error.code === "payload");
  // 16 MiB of valid JSON (a long run of padding after it) still reads
  assert.deepEqual(await unpackPayload(deflateRawSync(spaces(16 * MiB))), { f: 1 });
  // not deflate, and not JSON
  await assert.rejects(unpackPayload(Uint8Array.from([1, 2, 3, 4, 5])), error => error.code === "payload");
  await assert.rejects(unpackPayload(deflateRawSync(Buffer.from("not json"))), error => error.code === "payload");
  await assert.rejects(unpackPayload(deflateRawSync(Buffer.from("[1,2]"))), error => error.code === "payload");
});

test("payload for a hand-typed 3,420-person tree is at most 175 KB", async t => {
  // KB means 1024 bytes here, as in "hello ≤ 64 KB". The size moves by about ±2% with the seed, so several are tried.
  for (const seed of [1, 2, 3, 11, 19]) {
    const { records } = generateTree({ people: 3420, seed, clocks: "hand", noteShare: 0.03 });
    const packed = await packPayload(buildPayload(records, ALL));
    t.diagnostic(`seed ${seed}: 3,420 people, ${records.size} records: ${packed.length} bytes`);
    assert.ok(packed.length <= 175 * 1024, `seed ${seed}: ${packed.length} bytes`);
    // and it reads back as the same records
    if (seed === 11) assert.deepEqual(payloadRecords(await unpackPayload(packed)), records);
  }
});

test("a repeat sync of 10 changed buckets is at most 15 KB", async t => {
  const { records } = generateTree({ people: 3420, seed: 11, clocks: "hand", noteShare: 0.03 });
  // ten buckets spread over the range, as ten edits would touch
  const buckets = [3, 30, 55, 80, 105, 130, 155, 180, 205, 230];
  const packed = await packPayload(buildPayload(records, buckets));
  t.diagnostic(`10 buckets: ${payloadRecords(await unpackPayload(packed)).size} records, ${packed.length} bytes`);
  assert.ok(packed.length <= 15 * 1024, `${packed.length} bytes`);
  for (const id of payloadRecords(await unpackPayload(packed)).keys()) assert.ok(buckets.includes(bucketOf(id)) && kindOf(id));
});
