// GEDCOM 5.5.1 reading, import and export (reference R12, ADR 0006). Pure: no DOM, no network.
// Import turns a file into a pending change; it never adopts anything. Every imported value has the time
// (0, 0) and the setter 0000000000000000, so a real edit on any phone beats it, and the same file gives
// the same records on every phone.
import { applyTriple, linkId, sanitiseText, validateRecord } from "./records.js";
import { isExact, parseGedcomDate, toGedcomDate } from "./dates.js";
import { baseSurname, matchKey } from "./names.js";
import { createClock } from "./clock.js";
import { createTree } from "./tree.js";
import { startPoints } from "./join.js";
import { makeGroup, randomHex } from "./history.js";

export const MAX_GEDCOM_BYTES = 20 * 1024 * 1024;
export const RESAVE_MESSAGE = "Open the file in your genealogy program and save it as UTF-8.";
const STAMP_SETTER = "0000000000000000";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WIDTH = 200; // export: longer lines continue with CONC

const fail = (code, message) => Object.assign(new Error(message), { code });

// ================================================================ reading (4.1)

const utf8 = new TextDecoder("utf-8", { fatal: true });
const decoder = label => new TextDecoder(label, { fatal: true });

/**
 * The text of a GEDCOM file. The encoding comes from the byte order mark, else from `1 CHAR`:
 * UTF-8 (or no CHAR line) or UNICODE (UTF-16 without a mark, seen by its zero bytes). Anything else
 * throws code "encoding" with the re-save message; a file over 20 MB throws code "size".
 */
export function decodeGedcom(bytes) {
  if (bytes.length > MAX_GEDCOM_BYTES) throw fail("size", "That file is too big (over 20 MB).");
  const [a, b, c] = bytes;
  try {
    if (a === 0xef && b === 0xbb && c === 0xbf) return utf8.decode(bytes.subarray(3));
    if (a === 0xff && b === 0xfe) return decoder("utf-16le").decode(bytes.subarray(2));
    if (a === 0xfe && b === 0xff) return decoder("utf-16be").decode(bytes.subarray(2));
    if (bytes.length >= 2 && a !== 0 && b === 0) return decoder("utf-16le").decode(bytes);
    if (bytes.length >= 2 && a === 0 && b !== 0) return decoder("utf-16be").decode(bytes);
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8192));
    const declared = /^[ \t]*1[ \t]+CHAR[ \t]+(.*?)[ \t]*$/im.exec(head);
    if (declared && !/^UTF-?8$/i.test(declared[1])) throw fail("encoding", RESAVE_MESSAGE);
    return utf8.decode(bytes);
  } catch (error) {
    if (error.code === "encoding" || error.code === "size") throw error;
    throw fail("encoding", RESAVE_MESSAGE); // bytes that are not what the file says they are
  }
}

const LINE = /^(\d{1,2})[ \t]+(?:(@[^@\s]+@)[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)(?:[ \t](.*))?$/;

/**
 * Lines `level [@xref@] TAG [value]` as a tree: → { records: [{ xref, tag, value, children }], bad }.
 * CONT (new line) and CONC (same line) are joined into their parent's value; `@@` is one `@`.
 * Lines that are not GEDCOM lines, or that have no parent, are counted in `bad` and skipped.
 */
export function parseGedcom(text) {
  const records = [];
  const stack = [];
  let bad = 0;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/^[ \t﻿]+/, "");
    if (!line) continue;
    const m = LINE.exec(line);
    if (!m) { bad += 1; continue; }
    const level = Number(m[1]);
    const tag = m[3].toUpperCase();
    const rest = m[4] ?? "";
    if (level > 0 && (tag === "CONT" || tag === "CONC")) {
      const parent = stack[level - 1];
      if (!parent) { bad += 1; continue; }
      parent.value += (tag === "CONT" ? "\n" : "") + rest.replaceAll("@@", "@");
      continue;
    }
    const node = { xref: m[2] ?? null, tag, value: rest.trim().replaceAll("@@", "@"), children: [] };
    if (level === 0) {
      records.push(node);
      stack.length = 0;
    } else {
      const parent = stack[level - 1];
      if (!parent) { bad += 1; continue; }
      parent.children.push(node);
    }
    stack.length = level;
    stack[level] = node;
  }
  return { records, bad };
}

// ================================================================ IDs (4.3)

const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
async function sha256(bytes) {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}
const hex16Of = async bytes => toHex((await sha256(bytes)).subarray(0, 8));
const encoder = new TextEncoder();

const UID_SHAPES = [/^[0-9a-f]{16}$/i, /^[0-9a-f]{32}$/i, /^[0-9a-f]{36}$/i, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i];
const acceptedUid = text => UID_SHAPES.some(shape => shape.test(text));

// ================================================================ import mapping (4.2)

const TYPE_BIRTH = /^(birth|maiden)$/i;
const first = (node, tag) => node.children.find(c => c.tag === tag);
const POINTER = /^@[^@\s]+@$/;

/** One INDI's fields, in short keys, and the nodes it read (so the rest can be counted). */
function readPerson(node, ctx) {
  const { clean, date, used } = ctx;
  const use = n => { used.add(n); return n; };
  const fields = {};

  // ---- names: the first NAME that is not a birth name is the main one; a birth name gives birthSurname
  const names = node.children.filter(c => c.tag === "NAME");
  const isBirth = n => TYPE_BIRTH.test(first(n, "TYPE")?.value ?? "");
  const main = names.find(n => !isBirth(n));
  const split = value => {
    const m = /^([^/]*)(?:\/([^/]*)\/?.*)?$/.exec(value);
    return { given: m[1].trim(), surname: (m[2] ?? "").trim() };
  };
  const read = n => {
    use(n);
    for (const k of n.children) if (["TYPE", "GIVN", "SURN"].includes(k.tag)) use(k);
    const parts = split(n.value);
    return { given: parts.given || first(n, "GIVN")?.value || "", surname: first(n, "SURN")?.value || parts.surname };
  };
  const mainName = main ? read(main) : null;
  const birthNode = names.find(n => isBirth(n) && (split(n.value).surname || first(n, "SURN")?.value));
  const birthName = birthNode ? read(birthNode) : null;
  const given = clean("g", mainName?.given || birthName?.given);
  const surname = clean("s", mainName?.surname);
  const birthSurname = clean("bs", birthName?.surname);
  if (given) fields.g = given;
  if (surname) fields.s = surname;
  if (birthSurname) fields.bs = birthSurname;

  // ---- sex
  const sex = first(node, "SEX");
  if (sex) use(sex);
  fields.sx = ["M", "F"].includes(sex?.value.trim().toUpperCase()) ? sex.value.trim().toUpperCase() : "U";

  // ---- events
  const event = (tag, dateKey, placeKey) => {
    const e = first(node, tag);
    if (!e) return null;
    use(e);
    const d = first(e, "DATE");
    const p = first(e, "PLAC");
    if (d) use(d);
    if (p) use(p);
    const when = d ? date(d.value) : null;
    const where = p ? clean(placeKey, p.value) : null;
    if (when) fields[dateKey] = when;
    if (where) fields[placeKey] = where;
    return { node: e, hasDate: !!d, hasPlace: !!p };
  };
  event("BIRT", "bd", "bp");
  const death = event("DEAT", "dd", "dp");
  if (death && (/^y$/i.test(death.node.value.trim()) || death.hasDate || death.hasPlace)) fields.dc = true;

  // ---- notes: several are joined with blank lines; a pointer reads the NOTE record it names
  const parts = [];
  for (const n of node.children) {
    if (n.tag !== "NOTE") continue;
    use(n);
    const target = POINTER.test(n.value) ? ctx.notes.get(n.value) : null;
    if (target) { ctx.usedNotes.add(target); parts.push(target.value); } else if (!POINTER.test(n.value)) parts.push(n.value);
  }
  const note = clean("nt", parts.filter(p => p.trim() !== "").join("\n\n"));
  if (note) fields.nt = note;

  // ---- structure the rest of the code reads
  for (const tag of ["FAMC", "FAMS"]) for (const n of node.children) if (n.tag === tag) use(n);
  const uid = first(node, "_UID");
  if (uid) use(uid);
  return { fields, uid: uid ? uid.value.trim() : null };
}

/** Count the nodes of `node` that were not read, by tag. A node that was read still has its children checked. */
function countUnused(node, used, notKept) {
  for (const child of node.children) {
    if (used.has(child)) countUnused(child, used, notKept);
    else notKept[child.tag] = (notKept[child.tag] ?? 0) + 1;
  }
}

function sameHuman(shown, fields) {
  const key = (value, surname) => matchKey(surname ? baseSurname(value) : value);
  const g1 = key(shown.g ?? "");
  const g2 = key(fields.g ?? "");
  if (g1 && g2 && g1 !== g2) return false;
  const names = f => [f.s, f.bs].map(v => key(v ?? "", true)).filter(Boolean);
  const [n1, n2] = [names(shown), names(fields)];
  if (n1.length && n2.length && !n1.some(k => n2.includes(k))) return false;
  if (isExact(shown.bd) && isExact(fields.bd) && shown.bd.y !== fields.bd.y) return false;
  return true;
}

/**
 * Read a GEDCOM file into `tree` as a pending change (nothing is adopted). → async
 * { change, summary, incoming, newGroups, singles, gainedRelatives }.
 *
 * Options: `now` (for the history entry), `newId` (a source of fresh person IDs, for tests), `session`.
 * summary: { newPeople, newLinks, matched, filled, skipped, newIds, cut, htmlRemoved, controlRemoved,
 *            notKept: { TAG: n }, rejected, badLines }.
 * Throws code "size" or "encoding" (see decodeGedcom).
 */
export async function importGedcom(tree, bytes, { now = Date.now(), newId = () => randomHex(8), session } = {}) {
  const text = decodeGedcom(bytes);
  const { records: top, bad } = parseGedcom(text);
  const fileHash = await sha256(bytes);
  const records = tree.records();
  const view = tree.view();

  const summary = {
    newPeople: 0, newLinks: 0, matched: 0, filled: 0, skipped: 0, newIds: 0,
    cut: 0, htmlRemoved: 0, controlRemoved: 0, notKept: {}, rejected: 0, badLines: bad,
  };

  // ---- cleaning: the validator's rules, but cutting instead of refusing, and counting what changed
  const clean = (key, raw) => {
    if (typeof raw !== "string") return null;
    if (key === "nt" && /<\/?[a-z][^>]*>/i.test(raw)) summary.htmlRemoved += 1;
    if ((key === "nt" ? /(?![\n\t])\p{Cc}/u : /\p{Cc}/u).test(raw)) summary.controlRemoved += 1;
    const out = sanitiseText(key, raw);
    if (out.cut) summary.cut += 1;
    return out.value === "" ? null : out.value;
  };
  const date = raw => {
    const d = parseGedcomDate(raw);
    if (d && d.t !== undefined) {
      const t = clean("t", d.t);
      return t === null ? null : { ...d, t };
    }
    return d;
  };
  const used = new Set();
  const usedNotes = new Set();
  const notes = new Map(top.filter(r => r.tag === "NOTE" && r.xref).map(r => [r.xref, r]));
  const ctx = { clean, date, used, notes, usedNotes };

  // ---- people: IDs first (R12 IDs), then what to do with each
  const indis = top.filter(r => r.tag === "INDI");
  const seen = new Map();
  const idOf = new Map(); // xref → person ID, or null when skipped
  const puts = new Map();
  const changes = [];
  const incoming = new Set();
  const people = [];
  const taken = new Set();
  const fresh = () => {
    for (let tries = 0; tries < 100; tries++) {
      const id = newId();
      if (/^[0-9a-f]{16}$/.test(id) && !records.has(id) && !taken.has(id)) return id;
    }
    throw fail("setup", "could not make a new ID");
  };

  /** Write fields (key → value) to a record at the import time; for an existing record only keys with no triple. */
  const write = (id, kind, values, { create }) => {
    const have = records.get(id);
    const f = {};
    for (const [key, value] of Object.entries(values)) {
      if (!create && Object.hasOwn(have.f, key)) continue;
      f[key] = [value, 0, 0, STAMP_SETTER];
    }
    if (Object.keys(f).length === 0) return 0;
    const checked = validateRecord(id, { kind, f }, { now });
    summary.rejected += checked.rejected.length;
    if (!checked.record) return 0;
    let current = puts.get(id) ?? have ?? { kind, f: {} };
    let written = 0;
    for (const [key, triple] of Object.entries(checked.record.f)) {
      const next = applyTriple(current, key, triple);
      if (next === current) continue;
      current = next;
      written += 1;
      if (!create) changes.push({ r: id, f: key, after: triple });
    }
    if (written) puts.set(id, current);
    return written;
  };

  for (const node of indis) {
    const { fields, uid } = readPerson(node, ctx);
    countUnused(node, used, summary.notKept);

    // the ID
    let derived;
    if (uid && acceptedUid(uid)) {
      const key = uid.toLowerCase();
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      derived = n === 1 && key.length === 16 ? key : await hex16Of(encoder.encode(n === 1 ? key : `${key}#${n}`));
    } else {
      const key = `xref:${node.xref}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      derived = await hex16Of(new Uint8Array([...fileHash, ...encoder.encode(node.xref ?? "") , ...encoder.encode(n === 1 ? "" : `#${n}`)]));
    }

    let id = derived;
    if (records.has(derived)) {
      const shown = view.people.get(tree.resolve(derived));
      if (!shown) { // a deleted, erased or partly erased person: the file never touches them
        summary.skipped += 1;
        if (node.xref) idOf.set(node.xref, null);
        continue;
      }
      if (sameHuman(shown.f, fields)) {
        summary.matched += 1;
        // fill only what has no triple anywhere in the person's set
        const missing = {};
        for (const [key, value] of Object.entries(fields)) {
          if (!shown.members.some(member => Object.hasOwn(records.get(member).f, key))) missing[key] = value;
        }
        const before = changes.length;
        const written = write(derived, "person", missing, { create: false });
        summary.filled += written;
        if (written && changes.length > before) people.push(derived);
        if (node.xref) idOf.set(node.xref, derived);
        taken.add(derived);
        continue;
      }
      id = fresh();
      summary.newIds += 1;
    }
    if (taken.has(id)) id = fresh(); // two INDIs of one file cannot share an ID
    taken.add(id);
    if (node.xref) idOf.set(node.xref, id);
    const created = write(id, "person", { ...fields, del: false }, { create: true });
    if (created) {
      summary.newPeople += 1;
      incoming.add(id);
      changes.push({ r: id, created: true });
      people.push(id);
    }
  }

  // ---- families: HUSB and WIFE are partners; each CHIL has a parent link from each listed partner
  for (const node of top.filter(r => r.tag === "FAM")) {
    const used2 = new Set();
    const mark = n => { if (n) used2.add(n); return n; };
    const pointer = tag => { const n = first(node, tag); mark(n); return n && idOf.has(n.value) ? idOf.get(n.value) : undefined; };
    const husb = pointer("HUSB");
    const wife = pointer("WIFE");
    const kids = node.children.filter(c => c.tag === "CHIL").map(c => { mark(c); return idOf.get(c.value); });
    const married = mark(first(node, "MARR"));
    const divorced = mark(first(node, "DIV"));
    const child = (n, tag) => { const k = n && first(n, tag); mark(k); return k; };
    const partner = {};
    if (married) {
      const d = child(married, "DATE");
      const p = child(married, "PLAC");
      const md = d ? date(d.value) : null;
      const mp = p ? clean("mp", p.value) : null;
      if (md) partner.md = md;
      if (mp) partner.mp = mp;
    }
    if (divorced) {
      partner.en = true;
      const d = child(divorced, "DATE");
      const ed = d ? date(d.value) : null;
      if (ed) partner.ed = ed;
    }
    // the node's own children that were read, then count the rest
    const walk = (n, bag) => {
      for (const c of n.children) {
        if (used2.has(c)) walk(c, bag);
        else bag[c.tag] = (bag[c.tag] ?? 0) + 1;
      }
    };
    walk(node, summary.notKept);

    const parents = [husb, wife].filter(id => typeof id === "string");
    if (typeof husb === "string" && typeof wife === "string" && husb !== wife) {
      const id = linkId("partner", husb, wife);
      linkWrite(id, "partner", partner);
    }
    for (const kid of kids) {
      if (typeof kid !== "string") continue;
      for (const parent of parents) if (parent !== kid) linkWrite(linkId("parent", parent, kid), "parent", {});
    }
  }

  function linkWrite(id, kind, values) {
    if (records.has(id) || puts.has(id)) {
      if (!records.has(id)) return; // already made from an earlier FAM of this file
      const before = changes.length;
      const written = write(id, kind, values, { create: false });
      summary.filled += written;
      if (written && changes.length === before) return;
      return;
    }
    const created = write(id, kind, { ...values, del: false }, { create: true });
    if (created) {
      summary.newLinks += 1;
      incoming.add(id);
      changes.push({ r: id, created: true });
    }
  }

  // ---- other level-0 records are counted too (not HEAD, TRLR, INDI, FAM, or a NOTE that was read)
  for (const node of top) {
    if (["HEAD", "TRLR", "INDI", "FAM"].includes(node.tag) || usedNotes.has(node)) continue;
    summary.notKept[node.tag] = (summary.notKept[node.tag] ?? 0) + 1;
  }

  const group = puts.size ? makeGroup({ action: "import", device: tree.device, at: now, session, people: [...new Set(people)], changes, lost: [] }) : null;
  const change = { puts, group, meta: {} };

  let points = { newGroups: [], singles: [], gainedRelatives: [] };
  if (puts.size) {
    const after = new Map(records);
    for (const [id, record] of puts) after.set(id, record);
    const scratch = createTree({ device: tree.device, records: after, clock: createClock({ now: () => 0 }) });
    points = startPoints(scratch.view(), incoming);
  }
  return { change, summary, incoming, newGroups: points.newGroups, singles: points.singles, gainedRelatives: points.gainedRelatives };
}

// ================================================================ export (4.4)

/** One GEDCOM field as lines: `@` doubled, newlines as CONT, long lines continued with CONC. */
function lines(level, tag, value) {
  if (value === undefined || value === null || value === "") return [`${level} ${tag}`];
  const out = [];
  String(value).replaceAll("@", "@@").split("\n").forEach((part, n) => {
    const start = n === 0 ? `${level} ${tag}` : `${level + 1} CONT`;
    const [firstChunk, ...rest] = chunks(part);
    out.push(firstChunk ? `${start} ${firstChunk}` : start);
    for (const chunk of rest) out.push(`${level + 1} CONC ${chunk}`);
  });
  return out;
}

/** Cut at 200 characters, never in the middle of a character, a doubled @, or next to a space (readers trim those). */
function chunks(text) {
  const letters = [...text];
  const out = [];
  let from = 0;
  while (letters.length - from > WIDTH) {
    let cut = WIDTH;
    while (cut > 1 && (letters[from + cut - 1] === " " || letters[from + cut - 1] === "@" || letters[from + cut] === " ")) cut -= 1;
    out.push(letters.slice(from, from + cut).join(""));
    from += cut;
  }
  out.push(letters.slice(from).join(""));
  return out;
}

const slashless = s => String(s ?? "").replaceAll("/", "");
const dateText = date => (date ? toGedcomDate(date) : "");

/**
 * The tree as GEDCOM 5.5.1 text (UTF-8, `\n` line ends, no byte order mark): people showing in `view`,
 * with `_UID` = person ID, and one FAM per `view.families`. `today` is a Date (local day) or milliseconds.
 */
export function exportGedcom(view, today = new Date()) {
  const day = today instanceof Date ? today : new Date(today);
  const out = [
    "0 HEAD", "1 SOUR STEBLO", `1 DATE ${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`,
    "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8",
  ];
  const ids = [...view.people.keys()].sort();
  const xref = new Map(ids.map((id, n) => [id, `@I${n + 1}@`]));
  const famXref = view.families.map((_, n) => `@F${n + 1}@`);
  const famc = new Map();
  const fams = new Map();
  view.families.forEach((family, n) => {
    for (const p of family.partners) (fams.get(p) ?? fams.set(p, []).get(p)).push(famXref[n]);
    for (const c of family.children) (famc.get(c) ?? famc.set(c, []).get(c)).push(famXref[n]);
  });

  for (const id of ids) {
    const f = view.people.get(id).f;
    out.push(`0 ${xref.get(id)} INDI`, `1 _UID ${id}`);
    out.push(...lines(1, "NAME", `${slashless(f.g)} /${slashless(f.s)}/`.trim()));
    if (f.bs) out.push(...lines(1, "NAME", `${slashless(f.g)} /${slashless(f.bs)}/`.trim()), "2 TYPE birth");
    if (f.sx) out.push(`1 SEX ${f.sx === "M" || f.sx === "F" ? f.sx : "U"}`);
    if (f.bd || f.bp) {
      out.push("1 BIRT");
      if (dateText(f.bd)) out.push(...lines(2, "DATE", dateText(f.bd)));
      if (f.bp) out.push(...lines(2, "PLAC", f.bp));
    }
    if (f.dd || f.dp) {
      out.push("1 DEAT");
      if (dateText(f.dd)) out.push(...lines(2, "DATE", dateText(f.dd)));
      if (f.dp) out.push(...lines(2, "PLAC", f.dp));
    } else if (f.dc === true) out.push("1 DEAT Y");
    if (f.nt) out.push(...lines(1, "NOTE", f.nt));
    for (const x of famc.get(id) ?? []) out.push(`1 FAMC ${x}`);
    for (const x of fams.get(id) ?? []) out.push(`1 FAMS ${x}`);
  }

  view.families.forEach((family, n) => {
    out.push(`0 ${famXref[n]} FAM`);
    const [p, q] = family.partners;
    // the partners come ordered M first, F last: the first is HUSB and the second WIFE; a lone F is WIFE
    if (q === undefined) out.push(`1 ${view.people.get(p).f.sx === "F" ? "WIFE" : "HUSB"} ${xref.get(p)}`);
    else out.push(`1 HUSB ${xref.get(p)}`, `1 WIFE ${xref.get(q)}`);
    for (const c of family.children) out.push(`1 CHIL ${xref.get(c)}`);
    const pf = family.partnership?.f ?? {};
    if (pf.md || pf.mp) {
      out.push("1 MARR");
      if (dateText(pf.md)) out.push(...lines(2, "DATE", dateText(pf.md)));
      if (pf.mp) out.push(...lines(2, "PLAC", pf.mp));
    }
    if (pf.ed) out.push("1 DIV", ...lines(2, "DATE", dateText(pf.ed)));
    else if (pf.en === true) out.push("1 DIV Y");
  });
  out.push("0 TRLR");
  return out.join("\n") + "\n";
}
