// Record kinds, IDs, the one validator, and the later-wins rule (reference R1, R3). Pure.
// A record is { kind, f: { key: [value, ms, counter, by] } }. Keys are the short
// keys of R3/R5 everywhere, so one name means one field on disk, on the wire and in code.
import { compareTriples, canonicalJson } from "./clock.js";

export const MAX_RECORDS = 200000;
const DAY = 86_400_000;
const MAX_COUNTER = 65535;
const MAX_UNKNOWN = 4;
const MAX_UNKNOWN_BYTES = 4096;
const MAX_DEPTH = 4;

export const FIELDS = deepFreeze({
  person: { g: "given", s: "surname", bs: "birthSurname", sx: "sex", bd: "birthDate", bp: "birthPlace", dd: "deathDate", dp: "deathPlace", dc: "deceased", nt: "note", del: "deleted", er: "erased" },
  parent: { del: "deleted" },
  partner: { md: "marriageDate", mp: "marriagePlace", en: "ended", ed: "endDate", del: "deleted" },
  merge: { del: "deleted" },
  notsame: { del: "deleted" },
  device: { nm: "name" },
});

// A key known to any kind is never an "unknown field" on another kind.
// Otherwise a forged `er` on a link would freeze it (see applyTriple).
const KNOWN_ANYWHERE = new Set(Object.values(FIELDS).flatMap(names => Object.keys(names)));
const UNKNOWN_KEY = /^[a-z]{1,4}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const LINK_ID = /^([pumn]):([0-9a-f]{16}):([0-9a-f]{16})$/;
const LINK_KIND = { p: "parent", u: "partner", m: "merge", n: "notsame" };

function deepFreeze(obj) {
  for (const value of Object.values(obj)) if (value && typeof value === "object") deepFreeze(value);
  return Object.freeze(obj);
}

// ---------------------------------------------------------------- IDs

/** The kind an ID's shape says, or null. Sorted pairs (u, m, n) must be in order. */
export function kindOf(id) {
  if (typeof id !== "string") return null;
  if (HEX16.test(id)) return "person";
  const link = LINK_ID.exec(id);
  if (link) return link[1] !== "p" && link[2] > link[3] ? null : LINK_KIND[link[1]];
  return /^d:[0-9a-f]{16}$/.test(id) ? "device" : null;
}

/** 0 to 255: the first two hex characters of the record's bucket key (R1). */
export function bucketOf(id) {
  const kind = kindOf(id);
  if (!kind) return null;
  const key = kind === "person" ? id : kind === "device" ? id.slice(2) : kind === "parent" ? id.slice(19) : id.slice(2);
  return parseInt(key.slice(0, 2), 16);
}

/** Parent links keep their direction (parent, child); the other pairs are sorted. */
export function linkId(kind, a, b) {
  if (kind === "parent") return `p:${a}:${b}`;
  const letter = { partner: "u", merge: "m", notsame: "n" }[kind];
  if (!letter) throw new Error(`unknown link kind: ${kind}`);
  return a <= b ? `${letter}:${a}:${b}` : `${letter}:${b}:${a}`;
}

// ---------------------------------------------------------------- text

const chars = s => [...s].length;
const cleanLine = s => s.replace(/\p{Cc}/gu, "").replace(/\s+/gu, " ").trim();
const cleanNote = s => s.replace(/(?![\n\t])\p{Cc}/gu, "");
const LIMIT = { g: 80, s: 80, bs: 80, bp: 120, dp: 120, mp: 120, nm: 60, t: 60, nt: 5000 };

const ok = value => ({ ok: true, value });
const bad = () => ({ ok: false, reason: "invalid" });

function line(max, value) {
  if (typeof value !== "string") return bad();
  const text = cleanLine(value);
  const n = chars(text);
  return n >= 1 && n <= max ? ok(text) : bad();
}

// ---------------------------------------------------------------- dates

const daysIn = (y, m) => (m === 2 ? (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);
const whole = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

function date(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return bad();
  const out = {};
  for (const key of Object.keys(value)) {
    if (!["y", "m", "d", "q", "t"].includes(key)) return bad();
  }
  const { y, m, d, q, t } = value;
  if (y !== undefined) { if (!whole(y, 1, 2200)) return bad(); out.y = y; }
  if (m !== undefined) { if (y === undefined || !whole(m, 1, 12)) return bad(); out.m = m; }
  if (d !== undefined) { if (m === undefined || !whole(d, 1, daysIn(y, m))) return bad(); out.d = d; }
  if (q !== undefined) { if (!["abt", "bef", "aft", "est"].includes(q)) return bad(); out.q = q; }
  if (t !== undefined) {
    const text = line(LIMIT.t, t);
    if (!text.ok) return bad();
    out.t = text.value;
  }
  return out.y === undefined && out.t === undefined ? bad() : ok(out);
}

// ---------------------------------------------------------------- fields

const bool = value => (typeof value === "boolean" ? ok(value) : bad());
const RULES = {
  g: v => line(80, v), s: v => line(80, v), bs: v => line(80, v),
  bp: v => line(120, v), dp: v => line(120, v), mp: v => line(120, v),
  nm: v => line(60, v),
  nt: v => {
    if (typeof v !== "string") return bad();
    const text = cleanNote(v);
    return chars(text) >= 1 && chars(text) <= LIMIT.nt ? ok(text) : bad();
  },
  sx: v => (["M", "F", "X", "U"].includes(v) ? ok(v) : bad()),
  bd: date, dd: date, md: date, ed: date,
  dc: bool, en: bool, del: bool,
  er: v => (v === true ? ok(true) : bad()),
};
const NEVER_NULL = new Set(["del", "er", "nm"]);

/** Depth of plain JSON, or Infinity if it isn't plain JSON or goes deeper than `limit`. */
function jsonDepth(value, limit) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? 0 : Infinity;
  if (limit <= 0 || typeof value !== "object") return Infinity;
  let deepest = 0;
  if (Array.isArray(value)) {
    for (const item of value) deepest = Math.max(deepest, jsonDepth(item, limit - 1));
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return Infinity;
    for (const key of Object.keys(value)) deepest = Math.max(deepest, jsonDepth(value[key], limit - 1));
  }
  return deepest + 1;
}

/**
 * Check one value for one field. → { ok: true, value } with the cleaned value,
 * or { ok: false, reason: "invalid" }. Unknown fields (1 to 4 lowercase letters,
 * known to no kind) pass if the value is plain JSON at most 4 deep; the count
 * and size limits are per record and are checked by validateRecord.
 */
export function validateField(kind, key, value) {
  const names = FIELDS[kind];
  if (!names || typeof key !== "string") return bad();
  if (Object.hasOwn(names, key)) {
    if (value === null) return NEVER_NULL.has(key) ? bad() : ok(null);
    return RULES[key](value);
  }
  if (!UNKNOWN_KEY.test(key) || KNOWN_ANYWHERE.has(key)) return bad();
  return jsonDepth(value, MAX_DEPTH) <= MAX_DEPTH ? ok(JSON.parse(JSON.stringify(value))) : bad();
}

// ---------------------------------------------------------------- times

/** null if fine, "clock" if only too far ahead, else "invalid". */
function timeProblem(ms, counter, limit) {
  if (!Number.isSafeInteger(ms) || ms < 0 || !whole(counter, 0, MAX_COUNTER)) return "invalid";
  return ms > limit ? "clock" : null;
}
// A missing or non-numeric helloW counts as 0, never as NaN (NaN would let every time through).
const limitFor = ({ now, helloW } = {}) => Math.max(Number.isFinite(now) ? now : Date.now(), Number.isFinite(helloW) ? helloW : 0) + DAY;

/** ms from 0 to the later of now and the sender's hello w, plus 24 hours; counter 0 to 65535. */
export function validateTime(ms, counter, opts) {
  return timeProblem(ms, counter, limitFor(opts)) === null;
}

// ---------------------------------------------------------------- records

/**
 * Validate a whole received or restored record. → { record, rejected }.
 * `record` holds only the accepted fields, cleaned (null if the record itself
 * is bad); `rejected` lists { key, reason } with reason "clock" (a time too far
 * ahead) or "invalid". Inputs are not changed.
 */
export function validateRecord(id, record, opts) {
  const kind = kindOf(id);
  const fail = { record: null, rejected: [{ key: null, reason: "invalid" }] };
  if (!kind || record === null || typeof record !== "object" || record.kind !== kind) return fail;
  const f = record.f;
  if (f === null || typeof f !== "object" || Array.isArray(f)) return fail;

  const limit = limitFor(opts);
  const accepted = {};
  const rejected = [];
  let unknownCount = 0;
  let unknownBytes = 0;
  const encoder = new TextEncoder();

  for (const key of Object.keys(f).sort()) {
    const t = f[key];
    const shaped = Array.isArray(t) && t.length === 4 && typeof t[3] === "string" && HEX16.test(t[3]);
    const result = shaped ? validateField(kind, key, t[0]) : bad();
    const problem = shaped && result.ok ? timeProblem(t[1], t[2], limit) : "invalid";
    if (!result.ok || problem) {
      rejected.push({ key, reason: problem ?? "invalid" });
      continue;
    }
    if (!Object.hasOwn(FIELDS[kind], key)) {
      const size = encoder.encode(canonicalJson([key, [result.value, t[1], t[2], t[3]]])).length;
      if (unknownCount >= MAX_UNKNOWN || unknownBytes + size > MAX_UNKNOWN_BYTES) {
        rejected.push({ key, reason: "invalid" });
        continue;
      }
      unknownCount += 1;
      unknownBytes += size;
    }
    accepted[key] = [result.value, t[1], t[2], t[3]];
  }
  return { record: { kind, f: accepted }, rejected };
}

/**
 * For GEDCOM import only (R12): clean text the way the validator would, then cut
 * it to the field's limit with an ellipsis instead of rejecting it. Notes also lose
 * their tags first (<br> and <p> become newlines). `key` may be "t" for date text.
 * Anything that isn't a text field or a string comes back as it was.
 */
export function sanitiseText(key, value) {
  const max = LIMIT[key];
  if (!max || typeof value !== "string") return { value, cut: false };
  let text = value;
  if (key === "nt") {
    const stripped = text
      .replace(/<(?:br|p)(?:\s[^>]*)?\/?>/gi, "\n")
      .replace(/<\/?[a-z][^>]*>/gi, "");
    if (stripped !== text) text = stripped.trim();
    text = cleanNote(text);
  } else {
    text = cleanLine(text);
  }
  const letters = [...text];
  if (letters.length <= max) return { value: text, cut: false };
  return { value: letters.slice(0, max - 1).join("") + "…", cut: true };
}

/** Only people can be erased; an `er` on any other kind is not an erase mark. */
export const isErased = record => record.kind === "person" && Object.hasOwn(record.f, "er") && record.f.er[0] === true;

/**
 * Keep the later of the stored and the given triple for one field (R2, ADR 0004).
 * An erased record keeps only its `er` triple and ignores every other field,
 * later or not (ADR 0007). Returns the same record object when nothing changes;
 * never changes its input. Triples are treated as immutable and shared.
 */
export function applyTriple(record, key, triple) {
  if (isErased(record)) {
    if (key !== "er") return record;
    return compareTriples(triple, record.f.er) > 0 ? { kind: record.kind, f: { er: triple } } : record;
  }
  if (key === "er" && record.kind === "person") {
    return triple[0] === true ? { kind: record.kind, f: { er: triple } } : record;
  }
  if (Object.hasOwn(record.f, key) && compareTriples(triple, record.f[key]) <= 0) return record;
  return { kind: record.kind, f: { ...record.f, [key]: triple } };
}
