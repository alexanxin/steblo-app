// The tree: operations that return pending changes, and adopting them (reference R1, R3, R4, R14).
// Pure: no storage, no DOM. Every operation reads the adopted records, ticks the clock once,
// and returns { puts, group, meta }. Nothing changes until adopt(change), which the caller
// does only after storage has committed the change (R14 write contract).
import { canonicalJson, compareTriples } from "./clock.js";
import { kindOf, linkId, validateField, applyTriple } from "./records.js";
import { analyse } from "./sets.js";
import { makeGroup, randomHex, undoWrites } from "./history.js";
import { sortYear } from "./dates.js";

const HEX16 = /^[0-9a-f]{16}$/;
const PERSON_FIELDS = ["g", "s", "bs", "sx", "bd", "bp", "dd", "dp", "dc", "nt"];
const PARTNER_FIELDS = ["md", "mp", "en", "ed"];
const RELATIONS = ["parent", "child", "sibling", "partner"];

const fail = (message, code = "refused", field) => Object.assign(new Error(message), { code, field });
const invalid = (key, why) => fail(`invalid ${key}${why ? `: ${why}` : ""}`, "invalid", key);

/** Validate and clean the fields of an operation. Anything not in `allowed`, or invalid, refuses the whole operation. */
function checked(kind, fields, allowed) {
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) throw invalid("fields", "expected an object");
  const out = {};
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) throw invalid(key, "not a field you can set here");
    const result = validateField(kind, key, fields[key]);
    if (!result.ok) throw invalid(key);
    out[key] = result.value;
  }
  return out;
}

/** Fields that show, in display order, without cleared ones. */
function shown(f, keys) {
  const out = {};
  for (const key of keys) if (f[key] !== undefined && f[key][0] !== null) out[key] = f[key][0];
  return out;
}

/** The canonical ID of a person in a view (the ID itself if they are not merged). */
export const resolveIn = (view, id) => view.merged.get(id) ?? id;

/** True if a not-same record separates the sets of these two people in a view. */
export function areNotSameIn(view, x, y) {
  const a = resolveIn(view, x);
  const b = resolveIn(view, y);
  return a !== b && view.notSame.has(a < b ? `${a}|${b}` : `${b}|${a}`);
}

const SEX_RANK = { M: 0, F: 2 }; // anything else (X, U, none) sits between

function buildView(a) {
  const people = new Map();
  const deleted = new Map();
  const merged = new Map();
  const partlyErased = [];
  const ids = [...a.persons.keys()].sort();
  for (const id of ids) {
    const set = a.persons.get(id);
    for (const member of set.members) if (member !== id) merged.set(member, id);
    if (set.state === "visible") people.set(id, { id, f: shown(set.f, PERSON_FIELDS), members: set.members });
    else if (set.state === "deleted") deleted.set(id, { id, f: shown(set.f, PERSON_FIELDS), members: set.members });
    else if (set.state === "partial") partlyErased.push({ id, members: set.members, f: shown(set.f, PERSON_FIELDS) });
  }
  const live = a.liveLinks();
  const parentLinks = live.parent.map(link => ({ parent: link.a, child: link.b, ids: link.ids }));
  const partnerLinks = live.partner.map(link => ({ a: link.a, b: link.b, f: shown(link.f, PARTNER_FIELDS), ids: link.ids }));

  // ---- families: a child's own family is its two parents with the smallest IDs; partner links add the rest
  const sex = id => a.persons.get(id).f.sx?.[0];
  const year = id => sortYear(a.persons.get(id).f.bd?.[0]) ?? Infinity;
  const byFamily = new Map();
  const family = pair => {
    const key = pair.join("|");
    let f = byFamily.get(key);
    if (!f) byFamily.set(key, (f = { key, pair, children: [], partnership: null }));
    return f;
  };
  for (const [child, parents] of live.parentsOf) family(parents.slice(0, 2)).children.push(child);
  for (const link of partnerLinks) family([link.a, link.b]).partnership = link;
  const families = [...byFamily.values()]
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
    .map(({ pair, children, partnership }) => ({
      partners: [...pair].sort((x, y) => (SEX_RANK[sex(x)] ?? 1) - (SEX_RANK[sex(y)] ?? 1) || (x < y ? -1 : x > y ? 1 : 0)),
      children: children.sort((x, y) => year(x) - year(y) || (x < y ? -1 : x > y ? 1 : 0)),
      partnership,
    }));

  // ---- Needs attention
  const manyParents = [];
  for (const id of people.keys()) if ((live.parentsOf.get(id)?.length ?? 0) > 2) manyParents.push(id);

  // Walking up through parents, the first person reached twice on one path closes a loop.
  const loops = [];
  const seen = new Map(); // 1 = on the current path, 2 = finished
  for (const start of people.keys()) {
    if (seen.has(start)) continue;
    seen.set(start, 1);
    const path = [[start, 0]];
    while (path.length) {
      const top = path[path.length - 1];
      const above = live.parentsOf.get(top[0]) ?? [];
      if (top[1] >= above.length) { seen.set(top[0], 2); path.pop(); continue; }
      const next = above[top[1]++];
      const state = seen.get(next);
      if (state === 1) { if (!loops.includes(next)) loops.push(next); }
      else if (state === undefined) { seen.set(next, 1); path.push([next, 0]); }
    }
  }
  loops.sort();

  // Groups of people joined by any parent or partner link. The largest is the main tree; ties go to the lowest ID.
  const root = new Map(ids.filter(id => people.has(id)).map(id => [id, id]));
  const find = id => { let r = id; while (root.get(r) !== r) r = root.get(r); for (let s = id; s !== r;) { const n = root.get(s); root.set(s, r); s = n; } return r; };
  const join = (x, y) => { const rx = find(x); const ry = find(y); if (rx !== ry) root.set(rx < ry ? ry : rx, rx < ry ? rx : ry); };
  for (const link of parentLinks) join(link.parent, link.child);
  for (const link of partnerLinks) join(link.a, link.b);
  const groups = new Map();
  for (const id of root.keys()) { const r = find(id); const g = groups.get(r); if (g) g.push(id); else groups.set(r, [id]); }
  const separate = [...groups.values()]
    .map(list => ({ ids: list.sort(), size: list.length }))
    .sort((x, y) => y.size - x.size || (x.ids[0] < y.ids[0] ? -1 : 1))
    .slice(1);

  return { people, deleted, merged, parentLinks, partnerLinks, families, notSame: a.notSamePairs, attention: { manyParents, loops, partlyErased, separate } };
}

const nonNull = fields => Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));
const sameValue = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const unique = list => [...new Set(list)];

export function createTree({ device, name = "", records = new Map(), clock, now = Date.now, newId = () => randomHex(8) } = {}) {
  if (typeof device !== "string" || !HEX16.test(device)) throw fail("device must be 16 lowercase hex characters", "setup");
  if (!clock || typeof clock.tick !== "function" || typeof clock.observe !== "function") throw fail("a tree needs a clock", "setup");

  // The clock has to be past every time already stored, or a new edit could lose to old data.
  for (const record of records.values()) for (const t of Object.values(record.f)) clock.observe([t[1], t[2]]);

  let deviceName = name;
  let version = 0;
  let cached = null;
  let cachedVersion = -1;
  let viewCache = null;
  let viewVersion = -1;

  function analysis() {
    if (cachedVersion !== version) { cached = analyse(records); cachedVersion = version; }
    return cached;
  }

  function freshId(taken = new Set()) {
    for (let tries = 0; tries < 100; tries++) {
      const id = newId();
      if (HEX16.test(id) && !records.has(id) && !taken.has(id)) return id;
    }
    throw fail("could not make a new ID", "setup");
  }

  /** A person set that must be there (and, by default, showing). */
  function requirePerson(a, id, states = ["visible"], label = "person") {
    const set = typeof id === "string" ? a.setOf(id) : undefined;
    if (!set) throw fail(`${label}: no such person (${id})`, "missing");
    if (!states.includes(set.state)) {
      const why = { deleted: "is deleted", erased: "is erased", partial: "is partly erased", visible: "is already showing" }[set.state];
      throw fail(`${label}: that person ${why}`, "state");
    }
    return set;
  }

  /** The working state of one operation: one time, the records it writes, the history it logs. */
  function draft(action, session) {
    const time = clock.tick();
    const puts = new Map();
    const changes = [];
    const triple = value => [value, time[0], time[1], device];
    const base = id => puts.get(id) ?? records.get(id) ?? { kind: kindOf(id), f: {} };
    const d = {
      puts, changes, time,
      /** A new record with all its fields at this one time. */
      create(id, fields) {
        const f = {};
        for (const [key, value] of Object.entries(fields)) f[key] = triple(value);
        puts.set(id, { kind: kindOf(id), f });
        changes.push({ r: id, created: true });
      },
      /** One field written at this time, not logged. */
      write(id, key, value) {
        const t = triple(value);
        puts.set(id, applyTriple(base(id), key, t));
        return t;
      },
      /** One field written at this time and logged; `before` is the set's visible triple, if it had one. */
      edit(id, key, value, before) {
        const after = d.write(id, key, value);
        changes.push(before ? { r: id, f: key, before, after } : { r: id, f: key, after });
      },
      finish(people) {
        const group = makeGroup({ action, device, at: now(), session, people: unique(people), changes, lost: [] });
        return { puts, group, meta: { last: [time[0], time[1]] } };
      },
    };
    return d;
  }

  const nothing = () => ({ puts: new Map(), group: null, meta: {} });

  /**
   * Erase every live record of a set, in one change at one time (R11, ADR 0007): `er` on each
   * record, and `del` on every link touching the set. Merge and not-same records stay, so the set
   * stays one set. The group says that it happened and nothing else.
   */
  function eraseSet(a, set) {
    const d = draft("erase");
    for (const member of set.live) d.write(member, "er", true);
    for (const link of a.links.values()) {
      if (link.deleted || (link.a !== set.id && link.b !== set.id)) continue;
      for (const rid of link.ids) d.write(rid, "del", true);
    }
    return d.finish([]);
  }

  const tree = {
    get device() { return device; },
    get name() { return deviceName; },
    records: () => records,
    resolve: id => analysis().find(id),

    /** What the screens draw: plain data, a pure function of the adopted records. Cached until the next adopt. */
    view() {
      if (viewVersion !== version) { viewCache = buildView(analysis()); viewVersion = version; }
      return viewCache;
    },

    /** Make the change part of the tree. Called after storage has committed it. */
    adopt(change) {
      for (const [id, record] of change.puts) {
        records.set(id, record);
        for (const t of Object.values(record.f)) clock.observe([t[1], t[2]]);
      }
      if (change.meta?.last) clock.observe(change.meta.last);
      if (change.meta?.name !== undefined) deviceName = change.meta.name;
      version += 1;
    },

    addPerson(fields) {
      const f = checked("person", fields, PERSON_FIELDS);
      const d = draft("add");
      const id = freshId();
      d.create(id, { ...nonNull(f), del: false });
      return d.finish([id]);
    },

    addRelative(id, relation, fields, { otherParent } = {}) {
      if (!RELATIONS.includes(relation)) throw fail(`unknown relation: ${relation}`, "invalid", "relation");
      const f = checked("person", fields, PERSON_FIELDS);
      const a = analysis();
      const target = requirePerson(a, id);
      const parents = a.liveLinks().parentsOf.get(target.id) ?? [];
      let other = null;
      if (otherParent !== undefined) {
        if (relation !== "child") throw fail("otherParent only goes with a child", "invalid", "otherParent");
        other = requirePerson(a, otherParent, ["visible"], "otherParent");
        if (other.id === target.id) throw fail("otherParent must be someone else", "invalid", "otherParent");
      }
      if (relation === "parent" && parents.length >= 2) throw fail("that person already has two parents", "state");

      const d = draft("add");
      const taken = new Set();
      const newOne = freshId(taken);
      taken.add(newOne);
      d.create(newOne, { ...nonNull(f), del: false });
      const people = [newOne, target.id];
      const link = (kind, x, y) => d.create(linkId(kind, x, y), { del: false });

      if (relation === "parent") link("parent", newOne, target.id);
      else if (relation === "child") {
        link("parent", target.id, newOne);
        if (other) { link("parent", other.id, newOne); people.push(other.id); }
      } else if (relation === "partner") link("partner", target.id, newOne);
      else if (parents.length === 0) {
        // Brothers and sisters share a parent. With none on record, one nameless parent stands in for both.
        const placeholder = freshId(taken);
        d.create(placeholder, { del: false });
        link("parent", placeholder, target.id);
        link("parent", placeholder, newOne);
        people.push(placeholder);
      } else {
        for (const parent of parents.slice(0, 2)) { link("parent", parent, newOne); people.push(parent); }
      }
      return d.finish(people);
    },

    edit(id, fields) {
      const f = checked("person", fields, PERSON_FIELDS);
      const set = requirePerson(analysis(), id, ["visible", "deleted"]);
      const keys = Object.keys(f).filter(key => !sameValue(set.f[key]?.[0], f[key]));
      if (keys.length === 0) return nothing();
      const d = draft("edit");
      for (const key of keys) d.edit(set.id, key, f[key], set.f[key]);
      return d.finish([set.id]);
    },

    editPartnership(x, y, fields) {
      const f = checked("partner", fields, PARTNER_FIELDS);
      const a = analysis();
      const first = requirePerson(a, x);
      const second = requirePerson(a, y);
      if (first.id === second.id) throw fail("a partnership needs two different people", "invalid");
      const id = linkId("partner", first.id, second.id);
      const set = a.links.get(id); // a link set's key is the ID of its canonical record
      const people = [first.id, second.id];
      if (!set) {
        const d = draft("add");
        d.create(id, { ...nonNull(f), del: false });
        return d.finish(people);
      }
      const keys = Object.keys(f).filter(key => !sameValue(set.f[key]?.[0], f[key]));
      if (keys.length === 0 && !set.deleted) return nothing();
      const d = draft("edit");
      // A hidden link that is edited comes back (an edit after a delete revives, R4); say so in History.
      if (set.deleted) for (const rid of set.ids) d.edit(rid, "del", false, set.f.del);
      for (const key of keys) d.edit(set.ids[0], key, f[key], set.f[key]);
      return d.finish(people);
    },

    setDeviceName(text) {
      const result = validateField("device", "nm", text);
      if (!result.ok) throw invalid("name");
      const d = draft("edit");
      d.edit(`d:${device}`, "nm", result.value, records.get(`d:${device}`)?.f.nm);
      return { puts: d.puts, group: null, meta: { last: [d.time[0], d.time[1]], name: result.value } };
    },

    removePerson(id) {
      const set = requirePerson(analysis(), id, ["visible"]);
      const d = draft("delete");
      for (const rid of set.members) d.edit(rid, "del", true, set.f.del);
      return d.finish([set.id]);
    },

    restorePerson(id) {
      const a = analysis();
      const set = a.setOf(id);
      if (set?.state === "visible") throw fail("that person is not deleted", "state");
      requirePerson(a, id, ["deleted"]);
      const d = draft("restore");
      for (const rid of set.members) d.edit(rid, "del", false, set.f.del);
      return d.finish([set.id]);
    },

    /** Hide a parent or partner link. The people stay. */
    unlink(kind, x, y) {
      if (kind !== "parent" && kind !== "partner") throw fail(`no such link kind: ${kind}`, "invalid", "kind");
      const a = analysis();
      const cx = a.find(x);
      const cy = a.find(y);
      const [first, second] = kind === "partner" && cy < cx ? [cy, cx] : [cx, cy];
      const set = a.links.get(`${kind === "parent" ? "p" : "u"}:${first}:${second}`);
      if (!set || set.deleted) throw fail("no such link", "missing");
      const d = draft("delete");
      for (const rid of set.ids) d.edit(rid, "del", true, set.f.del);
      return d.finish([cx, cy]);
    },

    /** Say two person records are one human. The merge record carries a pair of canonical IDs. */
    merge(x, y, choices = {}, { session } = {}) {
      const f = checked("person", choices, PERSON_FIELDS);
      const a = analysis();
      const first = requirePerson(a, x, ["visible", "deleted"]);
      const second = requirePerson(a, y, ["visible", "deleted"]);
      if (first.id === second.id) throw fail("those are already one person", "state");
      const [low, high] = first.id < second.id ? [first, second] : [second, first];
      const id = linkId("merge", low.id, high.id);
      const d = draft("merge", session);
      const existing = records.get(id);
      if (!existing) d.create(id, { del: false });
      else d.edit(id, "del", false, existing.f.del);
      for (const key of Object.keys(f)) {
        const [p, q] = [low.f[key], high.f[key]];
        const before = p && q ? (compareTriples(p, q) >= 0 ? p : q) : p ?? q;
        d.edit(low.id, key, f[key], before);
      }
      return d.finish([low.id]);
    },

    /** Erase a person, and everyone merged with them, on every phone that syncs after this. It can't be undone. */
    erase(id) {
      const a = analysis();
      const set = requirePerson(a, id, ["visible", "deleted", "partial"]);
      return eraseSet(a, set);
    },

    /** Erase the records of a partly erased set that are not erased yet. */
    eraseRest(id) {
      const a = analysis();
      const set = typeof id === "string" ? a.setOf(id) : undefined;
      if (!set) throw fail(`person: no such person (${id})`, "missing");
      if (set.state !== "partial") throw fail("that person is not partly erased", "state");
      return eraseSet(a, set);
    },

    /**
     * Undo a group as new edits (R10). The change has `skipped`: how many changes were left
     * alone because the field changed since, or the record can't take it. Erase can't be undone.
     */
    undo(group) {
      if (group.action === "erase") throw fail("an erase can't be undone", "refused");
      const { writes, skipped } = undoWrites(group, records);
      if (writes.length === 0) return { puts: new Map(), group: null, meta: {}, skipped };
      const a = analysis();
      const d = draft("undo");
      for (const write of writes) d.edit(write.r, write.f, write.v, a.triple(write.r, write.f));
      return { ...d.finish(group.people), skipped };
    },

    /** Say two people are not the same human, so they are not suggested as a pair again. */
    notSame(x, y, { session } = {}) {
      const a = analysis();
      const first = requirePerson(a, x, ["visible", "deleted"]);
      const second = requirePerson(a, y, ["visible", "deleted"]);
      if (first.id === second.id) throw fail("that is one person", "state");
      const id = linkId("notsame", first.id, second.id);
      const existing = records.get(id);
      if (existing && existing.f.del?.[0] === false) return nothing();
      const d = draft("notsame", session);
      if (!existing) d.create(id, { del: false });
      else d.edit(id, "del", false, existing.f.del);
      return d.finish([first.id, second.id]);
    },
  };
  return tree;
}
