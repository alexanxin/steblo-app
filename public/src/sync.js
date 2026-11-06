// Sync: bucket hashes, the hello, the compact payload, applying, re-stamp (reference R5, R2).
// Pure: WebCrypto digests and streams only. No storage, no DOM, no clock of its own (callers pass `now`).
// Convergence is the point of this file. Whatever order data arrives in, two phones that have
// exchanged everything hold the same records, because every step is "keep the later triple per
// field" (applyTriple), plus an order-independent bound on unknown fields.
import { canonicalJson, compareTimes, compareTriples, createClock } from "./clock.js";
import { FIELDS, MAX_RECORDS, applyTriple, bucketOf, isErased, kindOf, validateRecord } from "./records.js";
import { createTree } from "./tree.js";
import { makeGroup } from "./history.js";

const DAY = 86_400_000;
const MAX_HELLO = 65536;
const MAX_UNPACKED = 16 * 1024 * 1024;
const HEX16 = /^[0-9a-f]{16}$/;
const B64URL = /^[A-Za-z0-9_-]*$/;
const MAX_UNKNOWN = 4;
const MAX_UNKNOWN_BYTES = 4096;

const fail = (message, code) => Object.assign(new Error(message), { code });
const isPlain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isIndex = (n, length) => Number.isInteger(n) && n >= 0 && n < length;

// ---------------------------------------------------------------- bucket hashes (R5)

/**
 * 4 bytes per bucket, 256 buckets → Uint8Array(1024). A bucket's hash is the first 4 bytes of
 * SHA-256 over the canonical JSON of [[id, fields], …] sorted by ID; an empty bucket hashes [].
 */
export async function bucketHashes(records) {
  const buckets = Array.from({ length: 256 }, () => []);
  for (const [id, record] of records) {
    const bucket = bucketOf(id);
    if (bucket !== null && Object.keys(record.f).length) buckets[bucket].push(id);
  }
  const encoder = new TextEncoder();
  const digests = await Promise.all(buckets.map(ids => {
    ids.sort();
    const json = canonicalJson(ids.map(id => [id, records.get(id).f]));
    return globalThis.crypto.subtle.digest("SHA-256", encoder.encode(json));
  }));
  const out = new Uint8Array(1024);
  digests.forEach((digest, bucket) => out.set(new Uint8Array(digest, 0, 4), bucket * 4));
  return out;
}

// ---------------------------------------------------------------- hello (R5)

const toBase64Url = bytes => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x2000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

/** The bytes of a base64url string of exactly this length, or null. Only the canonical spelling counts. */
function fromBase64Url(text, length) {
  if (typeof text !== "string" || !B64URL.test(text) || text.length % 4 === 1) return null;
  let binary;
  try {
    binary = atob(text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (text.length % 4)) % 4));
  } catch {
    return null;
  }
  if (binary.length !== length) return null;
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return toBase64Url(bytes) === text ? bytes : null;
}

/** → the hello's UTF-8 JSON bytes: {"f":1,"app","d","w","k","n","h"}, in that order. */
export function makeHello({ device, app, now, publicKey, nonce, hashes }) {
  if (!HEX16.test(device) || typeof app !== "string" || !Number.isSafeInteger(now)) throw fail("bad hello fields", "hello");
  if (publicKey.length !== 65 || nonce.length !== 16 || hashes.length !== 1024) throw fail("bad hello sizes", "hello");
  return new TextEncoder().encode(JSON.stringify({ f: 1, app, d: device, w: now, k: toBase64Url(publicKey), n: toBase64Url(nonce), h: toBase64Url(hashes) }));
}

/** → { bytes, f, app, d, w, k, n, h } with k, n and h as Uint8Arrays, or null if anything is malformed. Extra keys are ignored. */
export function parseHello(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_HELLO) return null;
  let json;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!isPlain(json) || json.f !== 1) return null;
  if (typeof json.app !== "string" || json.app.length < 1 || json.app.length > 64) return null;
  if (typeof json.d !== "string" || !HEX16.test(json.d)) return null;
  if (!Number.isSafeInteger(json.w) || json.w < 0) return null;
  const k = fromBase64Url(json.k, 65);
  const n = fromBase64Url(json.n, 16);
  const h = fromBase64Url(json.h, 1024);
  if (!k || !n || !h) return null;
  return { bytes, f: 1, app: json.app, d: json.d, w: json.w, k, n, h };
}

/** True unless the two phones' clocks differ by more than 24 hours. */
export const clocksAgree = (a, b) => Math.abs(a.w - b.w) <= DAY;

/** The buckets whose hash in `hashes` (mine) differs from the hello's (theirs). */
export function differingBuckets(hashes, hello) {
  const out = [];
  for (let bucket = 0; bucket < 256; bucket++) {
    for (let i = bucket * 4; i < bucket * 4 + 4; i++) {
      if (hashes[i] !== hello.h[i]) { out.push(bucket); break; }
    }
  }
  return out;
}

/** Step 2: u32 length ‖ hello, then the sealed message unless the clocks disagree. */
export function makeStep2(helloBytes, message) {
  const tail = message ?? new Uint8Array(0);
  const out = new Uint8Array(4 + helloBytes.length + tail.length);
  new DataView(out.buffer).setUint32(0, helloBytes.length);
  out.set(helloBytes, 4);
  out.set(tail, 4 + helloBytes.length);
  return out;
}

/** → { helloBytes, message | null }, or null if the length is over 64 KB or runs past the end. */
export function readStep2(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return null;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (length > MAX_HELLO || 4 + length > bytes.length) return null;
  const rest = bytes.subarray(4 + length);
  return { helloBytes: bytes.subarray(4, 4 + length), message: rest.length ? rest : null };
}

// ---------------------------------------------------------------- compact payload (R5)

const LINK_SECTION = { parent: ["l", "p"], partner: ["l", "u"], merge: ["x", "m"], notsame: ["x", "n"] };
const SECTION_KIND = { l: { p: "parent", u: "partner" }, x: { m: "merge", n: "notsame" } };

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const stampKey = t => `${t[1]}.${t[2]}.${t[3]}`;

/** Build the compact object for the records in these buckets. Records without fields are left out. */
export function buildPayload(records, buckets) {
  const wanted = new Set(buckets);
  const chosen = [];
  for (const [id, record] of records) {
    if (wanted.has(bucketOf(id)) && Object.keys(record.f).length) chosen.push(id);
  }
  chosen.sort();
  return encodeRecords(records, chosen, [...wanted].sort((a, b) => a - b));
}

/** Compact object for given records (id → record), in ID order, claiming the given buckets. */
function encodeRecords(source, ids, buckets) {
  // every distinct (time, setter) once, sorted
  const stamps = new Map();
  const people = new Set();
  for (const id of ids) {
    for (const t of Object.values(source.get(id).f)) stamps.set(stampKey(t), t);
    const kind = kindOf(id);
    if (kind === "person") people.add(id);
    else if (LINK_SECTION[kind]) { const [, a, b] = id.split(":"); people.add(a); people.add(b); }
  }
  const sorted = [...stamps.values()].sort((a, b) => a[1] - b[1] || a[2] - b[2] || compareText(a[3], b[3]));
  const dv = [...new Set(sorted.map(t => t[3]))].sort();
  const clockIndex = new Map();
  let previous = 0;
  const c = sorted.map((t, n) => {
    clockIndex.set(stampKey(t), n);
    const row = [t[1] - previous, t[2], dv.indexOf(t[3])];
    previous = t[1];
    return row;
  });
  const i = [...people].sort();
  const personIndex = new Map(i.map((id, n) => [id, n]));

  /** → [clock, plain fields, overrides?]: the most common time is the record's clock. */
  const fieldsOf = f => {
    const groups = new Map();
    for (const [key, t] of Object.entries(f)) {
      const n = clockIndex.get(stampKey(t));
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push([key, t[0]]);
    }
    let best = null;
    for (const [n, list] of groups) if (best === null || list.length > groups.get(best).length || (list.length === groups.get(best).length && n < best)) best = n;
    const plain = {};
    const overrides = {};
    for (const [n, list] of groups) for (const [key, value] of list) (n === best ? plain : overrides)[key] = n === best ? value : [value, n];
    return Object.keys(overrides).length ? [best, plain, overrides] : [best, plain];
  };

  const out = { f: 1, b: buckets, dv, c, i, p: [], l: [], x: [], d: [] };
  for (const id of ids) {
    const record = source.get(id);
    const [clock, ...fields] = fieldsOf(record.f);
    const kind = kindOf(id);
    if (kind === "person") out.p.push([personIndex.get(id), clock, ...fields]);
    else if (kind === "device") out.d.push([id.slice(2), clock, ...fields]);
    else {
      const [section, letter] = LINK_SECTION[kind];
      const [, a, b] = id.split(":");
      out[section].push([letter, personIndex.get(a), personIndex.get(b), clock, ...fields]);
    }
  }
  return out;
}

/**
 * Read a compact object into { records, invalid }: records are { kind, f } with whole triples,
 * not yet validated; `invalid` counts entries and fields too broken to read. Throws (code
 * "payload") when the object as a whole is unusable.
 */
function decode(payload) {
  if (!isPlain(payload) || payload.f !== 1) throw fail("unsupported payload", "payload");
  const lists = {};
  let total = 0;
  for (const name of ["p", "l", "x", "d"]) {
    const list = payload[name] ?? [];
    if (!Array.isArray(list)) throw fail(`payload.${name} is not a list`, "payload");
    total += list.length;
    lists[name] = list;
  }
  if (total > MAX_RECORDS) throw fail("too many records", "payload");
  for (const name of ["b", "dv", "c", "i"]) if (payload[name] !== undefined && !Array.isArray(payload[name])) throw fail(`payload.${name} is not a list`, "payload");
  const buckets = payload.b ?? [];
  if (buckets.length > 256 || !buckets.every(n => isIndex(n, 256))) throw fail("bad bucket list", "payload");

  const setters = payload.dv ?? [];
  const ids = payload.i ?? [];
  // the clock table: differences in ms, so one bad entry spoils the ones after it
  const clocks = [];
  let ms = 0;
  let broken = false;
  for (const row of payload.c ?? []) {
    const ok = Array.isArray(row) && row.length === 3 && Number.isSafeInteger(row[0]) && row[0] >= 0 && Number.isInteger(row[1]) && isIndex(row[2], setters.length) && typeof setters[row[2]] === "string";
    if (!ok) broken = true;
    if (!broken) ms += row[0];
    if (!Number.isSafeInteger(ms)) broken = true;
    clocks.push(broken ? null : [ms, row[1], setters[row[2]]]);
  }

  const records = new Map();
  let invalid = 0;
  const put = (id, kind, f) => {
    if (!Object.keys(f).length) return;
    const have = records.get(id);
    if (!have) { records.set(id, { kind, f }); return; }
    for (const [key, t] of Object.entries(f)) if (!Object.hasOwn(have.f, key) || compareTriples(t, have.f[key]) > 0) have.f[key] = t;
  };
  /** Fields of one entry → { key: triple } (own, plain object); bad keys and clocks are counted. */
  const readFields = (row, at) => {
    const [clock, plain, overrides] = [row[at], row[at + 1], row[at + 2]];
    const f = {};
    if (!isPlain(plain) || (overrides !== undefined && !isPlain(overrides)) || row.length > at + 3) { invalid += 1; return f; }
    const stamp = isIndex(clock, clocks.length) ? clocks[clock] : null;
    for (const key of Object.keys(plain)) {
      if (key === "__proto__" || !stamp) { invalid += 1; continue; }
      f[key] = [plain[key], stamp[0], stamp[1], stamp[2]];
    }
    for (const key of Object.keys(overrides ?? {})) {
      const item = overrides[key];
      const other = Array.isArray(item) && item.length === 2 && isIndex(item[1], clocks.length) ? clocks[item[1]] : null;
      if (key === "__proto__" || !other) { invalid += 1; continue; }
      f[key] = [item[0], other[0], other[1], other[2]];
    }
    return f;
  };
  const personId = n => (isIndex(n, ids.length) && typeof ids[n] === "string" ? ids[n] : null);

  for (const row of lists.p) {
    const id = Array.isArray(row) ? personId(row[0]) : null;
    if (id === null) { invalid += 1; continue; }
    put(id, "person", readFields(row, 1));
  }
  for (const section of ["l", "x"]) {
    for (const row of lists[section]) {
      const kind = Array.isArray(row) && typeof row[0] === "string" && Object.hasOwn(SECTION_KIND[section], row[0]) ? SECTION_KIND[section][row[0]] : null;
      const a = kind && personId(row[1]);
      const b = kind && personId(row[2]);
      if (!kind || a === null || b === null) { invalid += 1; continue; }
      put(`${row[0]}:${a}:${b}`, kind, readFields(row, 3));
    }
  }
  for (const row of lists.d) {
    if (!Array.isArray(row) || typeof row[0] !== "string") { invalid += 1; continue; }
    put(`d:${row[0]}`, "device", readFields(row, 1));
  }
  const sortedIds = [...records.keys()].sort();
  return { records: new Map(sortedIds.map(id => [id, records.get(id)])), invalid, buckets };
}

/** The records a compact payload holds, as read (not validated). Entries too broken to read are left out. */
export const payloadRecords = payload => decode(payload).records;

/** JSON → deflate-raw. */
export async function packPayload(payload) {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

/** Inflate and parse. Stops reading as soon as the output passes 16 MiB. Rejects with code "payload". */
export async function unpackPayload(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_UNPACKED) throw fail("payload is over 16 MiB", "payload");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error.code === "payload" ? error : fail("payload is not deflate data", "payload");
  }
  const whole = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { whole.set(chunk, at); at += chunk.length; }
  let json;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(whole));
  } catch {
    throw fail("payload is not JSON", "payload");
  }
  if (!isPlain(json)) throw fail("payload is not an object", "payload");
  return json;
}

// ---------------------------------------------------------------- applying (R5)

/**
 * The unknown fields of a record are bounded after merging, not only on the way in: the 4 smallest
 * keys (and at most 4 KB), so the result is the same whatever order the data arrived in and a peer
 * can't add 4 new unknown keys at every sync. Erased records hold only `er`, so they pass untouched.
 */
function boundUnknown(record) {
  const known = FIELDS[record.kind];
  const keys = Object.keys(record.f).filter(key => !Object.hasOwn(known, key)).sort();
  if (keys.length === 0) return record;
  const encoder = new TextEncoder();
  const keep = new Set();
  let bytes = 0;
  for (const key of keys) {
    const size = encoder.encode(canonicalJson([key, record.f[key]])).length;
    if (keep.size >= MAX_UNKNOWN || bytes + size > MAX_UNKNOWN_BYTES) continue;
    keep.add(key);
    bytes += size;
  }
  if (keep.size === keys.length) return record;
  const f = {};
  for (const [key, triple] of Object.entries(record.f)) if (Object.hasOwn(known, key) || keep.has(key)) f[key] = triple;
  return { kind: record.kind, f };
}

/** Same keys, and the very same triples (stored triples are shared, never copied). */
const sameFields = (a, b) => {
  const keys = Object.keys(a.f);
  return keys.length === Object.keys(b.f).length && keys.every(key => b.f[key] === a.f[key]);
};

const sameValue = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

/**
 * Apply a received compact payload to a tree, without adopting anything: validate every record,
 * keep the later triple per field, and describe the result.
 * → { change: { puts, group, meta }, summary, incoming, newGroups, gainedRelatives, erases }
 *
 * - `allowErase` false: erase marks for people this phone holds are listed in `erases` and not applied
 *   (the screen asks, then calls again with true). Erase marks for people it doesn't hold are stored.
 * - Rejected items are counted per reason and not stored; their bucket keeps differing.
 * - `incoming` holds the IDs of the records this phone didn't have. `newGroups` are connected groups of
 *   two or more incoming people with no link to anyone else; `gainedRelatives` are existing people
 *   (canonical IDs) joined by a new link to an incoming person (the join's start points, R9).
 * Throws (code "payload") if the payload as a whole is unusable.
 */
export function applyPayload(tree, payload, { now, helloW, allowErase = false, session } = {}) {
  const { records: received, invalid } = decode(payload);
  const stored = tree.records();
  const rejected = { clock: 0, invalid };
  const puts = new Map();
  const changes = [];
  const lost = [];
  const incoming = new Set();
  const erases = [];
  const people = new Set();
  let newPeople = 0;
  let changedFields = 0;

  for (const [id, raw] of received) {
    const checked = validateRecord(id, raw, { now, helloW });
    for (const { reason } of checked.rejected) rejected[reason] += 1;
    if (!checked.record) continue;
    const have = stored.get(id);
    let current = have ?? { kind: checked.record.kind, f: {} };
    const touched = [];
    const lostHere = [];
    let erasedNow = false;

    for (const [key, triple] of Object.entries(checked.record.f)) {
      if (key === "er") {
        if (isErased(current)) {
          // already erased: a later erase mark still replaces the earlier one, so every phone ends with the same triple
          const next = applyTriple(current, key, triple);
          if (next !== current) { current = next; erasedNow = true; }
          continue;
        }
        if (have) erases.push(id);
        if (have && !allowErase) continue;
        const next = applyTriple(current, key, triple);
        if (next !== current) { current = next; erasedNow = true; }
        continue;
      }
      const before = current.f[key];
      const next = applyTriple(current, key, triple);
      if (next === current) continue;
      current = next;
      touched.push({ key, before, after: triple });
      if (before && !sameValue(before[0], triple[0])) lostHere.push({ r: id, f: key, loser: before, winner: triple });
    }
    // An erase keeps only `er`: whatever else was applied before it is gone.
    if (erasedNow) { touched.length = 0; lostHere.length = 0; }
    else current = boundUnknown(current);
    // Fields the bound dropped were not accepted: count the incoming ones, forget their log entries.
    const kept = touched.filter(t => Object.hasOwn(current.f, t.key));
    rejected.invalid += touched.length - kept.length;
    if (have && sameFields(have, current)) continue; // everything received was older, equal or refused
    if (!have && Object.keys(current.f).length === 0) continue;

    puts.set(id, current);
    if (!have) {
      incoming.add(id);
      if (erasedNow) changes.push({ r: id, erased: true });
      else {
        changes.push({ r: id, created: true });
        if (current.kind === "person") { newPeople += 1; people.add(id); }
      }
    } else if (erasedNow) {
      changes.push({ r: id, erased: true });
    } else {
      for (const t of kept) changes.push(t.before ? { r: id, f: t.key, before: t.before, after: t.after } : { r: id, f: t.key, after: t.after });
      changedFields += kept.length;
      if (current.kind === "person") people.add(id);
      for (const entry of lostHere) if (Object.hasOwn(current.f, entry.f)) lost.push(entry);
    }
  }

  const group = puts.size ? makeGroup({ action: "sync", device: tree.device, at: now, session, people: [...people], changes, lost }) : null;
  const change = { puts, group, meta: {} };
  const { newGroups, gainedRelatives } = puts.size ? startPoints(tree, puts, incoming) : { newGroups: [], gainedRelatives: [] };
  return {
    change,
    summary: { newPeople, changedFields, lost: lost.length, rejected },
    incoming, newGroups, gainedRelatives, erases,
  };
}

/** The join's start points (R9), read from the view the tree would have after adopting `puts`. */
function startPoints(tree, puts, incoming) {
  const after = new Map(tree.records());
  for (const [id, record] of puts) after.set(id, record);
  const view = createTree({ device: tree.device, records: after, clock: createClock({ now: () => 0 }) }).view();

  const fresh = id => view.people.get(id).members.every(member => incoming.has(member));
  const incomingPeople = new Set([...view.people.keys()].filter(fresh));
  const links = [...view.parentLinks.map(l => ({ a: l.parent, b: l.child, ids: l.ids })), ...view.partnerLinks.map(l => ({ a: l.a, b: l.b, ids: l.ids }))];

  const root = new Map([...incomingPeople].map(id => [id, id]));
  const find = id => { let r = id; while (root.get(r) !== r) r = root.get(r); return r; };
  const attached = new Set(); // incoming people with a link to someone who was here before
  const gained = new Set();
  for (const link of links) {
    const aNew = incomingPeople.has(link.a);
    const bNew = incomingPeople.has(link.b);
    if (aNew && bNew) {
      const x = find(link.a);
      const y = find(link.b);
      if (x !== y) root.set(x < y ? y : x, x < y ? x : y);
    } else if (aNew !== bNew) {
      attached.add(aNew ? link.a : link.b);
      if (link.ids.some(id => incoming.has(id))) gained.add(aNew ? link.b : link.a);
    }
  }
  const groups = new Map();
  for (const id of incomingPeople) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(id);
  }
  const newGroups = [...groups.values()]
    .filter(ids => ids.length >= 2 && !ids.some(id => attached.has(id)))
    .map(ids => ({ ids: ids.sort(), size: ids.length }))
    .sort((x, y) => y.size - x.size || (x.ids[0] < y.ids[0] ? -1 : 1));
  return { newGroups, gainedRelatives: [...gained].sort() };
}

// ---------------------------------------------------------------- step 3 (R5)

/**
 * What to send back in step 3: for the given buckets, every record this phone holds, cut down to the
 * fields where its triple is later than (or missing from) what the other phone sent in `received`.
 * Fields the other phone already has equal, or holds later, are left out; so is everything about a
 * person the other phone has erased.
 */
export function buildDiff(records, received, buckets) {
  const theirs = payloadRecords(received);
  const wanted = new Set(buckets);
  const partial = new Map();
  for (const [id, record] of records) {
    if (!wanted.has(bucketOf(id))) continue;
    const there = theirs.get(id);
    if (there && isErased(there)) continue;
    const f = {};
    for (const [key, triple] of Object.entries(record.f)) {
      if (!there || !Object.hasOwn(there.f, key) || compareTriples(triple, there.f[key]) > 0) f[key] = triple;
    }
    if (Object.keys(f).length) partial.set(id, { kind: record.kind, f });
  }
  return encodeRecords(partial, [...partial.keys()].sort(), [...wanted].sort((a, b) => a - b));
}

// ---------------------------------------------------------------- re-stamp (R5)



/**
 * Rewrite this device's own triples dated more than 24 hours after `now` (they come from a period when
 * its clock was ahead). Each distinct original time gets its own new time, in the original order, taken
 * from `last` reset to the latest stored time within the bound. → a pending change (one "restamp"
 * History group; meta.resetLast tells adopt to move the clock back), or null when nothing is ahead.
 */
export function restamp(tree, now) {
  const limit = now + DAY;
  const records = tree.records();
  const device = tree.device;
  const ahead = new Map();
  let base = [0, 0]; // the latest stored time within the bound
  let rest = [0, 0]; // the latest time that stays as it is, ahead or not
  for (const record of records.values()) {
    for (const t of Object.values(record.f)) {
      if (t[3] === device && t[1] > limit) { ahead.set(`${t[1]}.${t[2]}`, [t[1], t[2]]); continue; }
      const time = [t[1], t[2]];
      if (compareTimes(time, rest) > 0) rest = time;
      if (t[1] <= limit && compareTimes(time, base) > 0) base = time;
    }
  }
  if (!ahead.size) return null;

  const clock = createClock({ now: () => now, last: base });
  const fresh = new Map();
  for (const time of [...ahead.values()].sort(compareTimes)) fresh.set(`${time[0]}.${time[1]}`, clock.tick());

  const puts = new Map();
  const changes = [];
  const people = [];
  for (const [id, record] of records) {
    let f = null;
    for (const [key, t] of Object.entries(record.f)) {
      if (t[3] !== device || t[1] <= limit) continue;
      const [ms, counter] = fresh.get(`${t[1]}.${t[2]}`);
      const after = [t[0], ms, counter, device];
      f ??= { ...record.f };
      f[key] = after;
      changes.push({ r: id, f: key, before: t, after });
    }
    if (f) {
      puts.set(id, { kind: record.kind, f });
      if (record.kind === "person") people.push(id);
    }
  }
  const last = compareTimes(clock.last(), rest) > 0 ? clock.last() : rest;
  const group = makeGroup({ action: "restamp", device, at: now, people, changes, lost: [] });
  return { puts, group, meta: { last, resetLast: true } };
}
