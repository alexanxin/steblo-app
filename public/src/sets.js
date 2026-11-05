// Merged sets of people and of links (reference R4). Pure.
// analyse(records) reads the stored records once and answers every question about sets:
// who is who, which fields win, what is deleted or erased, which links collapse.
// It is a pure function of the records, so any insertion order gives the same answer.
import { compareTriples } from "./clock.js";
import { isErased } from "./records.js";

/**
 * A set is deleted when its latest `del` is true and no other field of the set has a
 * later time (R4). A tie counts as deleted. `f` is the set's latest triple per key.
 */
export function isDeletedFields(f) {
  const del = f.del;
  if (!del || del[0] !== true) return false;
  for (const key of Object.keys(f)) {
    if (key === "del") continue;
    const t = f[key];
    if (t[1] > del[1] || (t[1] === del[1] && t[2] > del[2])) return false;
  }
  return true;
}

function mergeInto(into, from) {
  for (const key of Object.keys(from)) {
    if (key === "__proto__") continue;
    const t = from[key];
    const have = into[key];
    if (have === undefined || compareTriples(t, have) > 0) into[key] = t;
  }
}

/** Latest triple per key over several records' fields. A single record's fields are shared, not copied. */
function latestFields(fieldLists) {
  let f = null;
  let shared = false;
  for (const next of fieldLists) {
    if (f === null) { f = next; shared = true; continue; }
    if (shared) { f = { ...f }; shared = false; }
    mergeInto(f, next);
  }
  return f ?? {};
}

const pairKey = (a, b) => (a <= b ? `${a}|${b}` : `${b}|${a}`);

/** The key of a link set: the kind letter and the canonical ends (a partner pair is sorted, a parent link is not). */
const linkKey = (kind, a, b) => (kind === "partner" && b < a ? `u:${b}:${a}` : `${kind === "parent" ? "p" : "u"}:${a}:${b}`);

export function analyse(records) {
  // ---- who is merged with whom: active merge records between people who are both here
  const isPerson = id => records.get(id)?.kind === "person";
  const parent = new Map();
  const find = id => {
    let root = id;
    for (let next = parent.get(root); next !== undefined && next !== root; next = parent.get(root)) root = next;
    for (let step = id; step !== root;) { const next = parent.get(step); parent.set(step, root); step = next; }
    return root;
  };
  const merges = [];
  const notSames = [];
  for (const [id, record] of records) {
    if (record.kind !== "merge" && record.kind !== "notsame") continue;
    if (record.f.del?.[0] === true) continue;
    const [, a, b] = id.split(":");
    if (!isPerson(a) || !isPerson(b)) continue;
    (record.kind === "merge" ? merges : notSames).push([a, b]);
  }
  // The smaller ID always becomes the root, so the root of a set is its canonical ID.
  for (const [a, b] of merges) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }

  // ---- person sets
  const grouped = new Map();
  for (const [id, record] of records) {
    if (record.kind !== "person") continue;
    const root = find(id);
    let g = grouped.get(root);
    if (!g) grouped.set(root, (g = { members: [], live: [], erased: [], lists: [] }));
    g.members.push(id);
    if (isErased(record)) g.erased.push(id);
    else { g.live.push(id); g.lists.push(record.f); }
  }
  const persons = new Map();
  for (const [root, g] of grouped) {
    if (g.members.length > 1) { g.members.sort(); g.live.sort(); g.erased.sort(); }
    const f = latestFields(g.lists);
    const state = g.erased.length === g.members.length ? "erased" : g.erased.length > 0 ? "partial" : isDeletedFields(f) ? "deleted" : "visible";
    persons.set(root, { id: root, members: g.members, live: g.live, erased: g.erased, f, state });
  }

  // ---- link sets: links of one kind whose ends resolve to the same pair
  const linkGroups = new Map();
  for (const [id, record] of records) {
    if (record.kind !== "parent" && record.kind !== "partner") continue;
    const [, x, y] = id.split(":");
    const a = find(x);
    const b = find(y);
    const [first, second] = record.kind === "partner" && b < a ? [b, a] : [a, b];
    const key = linkKey(record.kind, a, b);
    let g = linkGroups.get(key);
    if (!g) linkGroups.set(key, (g = { kind: record.kind, a: first, b: second, ids: [], lists: [] }));
    g.ids.push(id);
    g.lists.push(record.f);
  }
  const links = new Map();
  for (const [key, g] of linkGroups) {
    if (g.ids.length > 1) g.ids.sort();
    const f = latestFields(g.lists);
    links.set(key, {
      key, kind: g.kind, a: g.a, b: g.b, ids: g.ids, f,
      deleted: isDeletedFields(f),
      missing: !persons.has(g.a) || !persons.has(g.b),
      self: g.a === g.b,
    });
  }

  // ---- not-same pairs, by set
  const notSame = new Set();
  for (const [a, b] of notSames) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) notSame.add(pairKey(ra, rb)); // an active merge always wins over a not-same record
  }

  /** The link set a parent or partner record belongs to. */
  const linkSetOf = id => {
    const record = records.get(id);
    if (record?.kind !== "parent" && record?.kind !== "partner") return undefined;
    const [, x, y] = id.split(":");
    return links.get(linkKey(record.kind, find(x), find(y)));
  };

  const analysis = {
    persons, links,
    linkSetOf,
    /** The triple showing for a field of a record: for a record in a set, the latest across the set. */
    triple(id, key) {
      const record = records.get(id);
      if (!record) return undefined;
      if (record.kind === "person") return persons.get(find(id))?.f[key];
      if (record.kind === "parent" || record.kind === "partner") return linkSetOf(id)?.f[key];
      return record.f[key];
    },
    /** True if the record is the only one in its set (a person with no merge, a link with no twin). */
    solo(id) {
      const record = records.get(id);
      if (record?.kind === "person") return persons.get(find(id)).members.length === 1;
      if (record?.kind === "parent" || record?.kind === "partner") return linkSetOf(id).ids.length === 1;
      return true;
    },
    /** True if the record's set is deleted (a person set, a link set, or a merge or not-same record). */
    isDeleted(id) {
      const record = records.get(id);
      if (record?.kind === "person") return persons.get(find(id)).state === "deleted";
      if (record?.kind === "parent" || record?.kind === "partner") return linkSetOf(id).deleted;
      return record?.f.del?.[0] === true;
    },
    /** The canonical ID of whoever this ID is merged into; the ID itself if it is nobody's. */
    find,
    /** The set a person ID belongs to, or undefined. */
    setOf: id => persons.get(find(id)),
    /** True if a not-same record separates the sets of these two people. */
    areNotSame: (x, y) => notSame.has(pairKey(find(x), find(y))),
    notSamePairs: notSame,
    live: null,
  };
  analysis.liveLinks = () => (analysis.live ??= liveLinks(analysis));
  return analysis;
}

/**
 * The links that show: not deleted, not a person's link to themselves, and between
 * people who are both visible. Sorted, so everything built from them is stable.
 */
function liveLinks({ persons, links }) {
  const shows = id => persons.get(id)?.state === "visible";
  const parent = [];
  const partner = [];
  for (const link of links.values()) {
    if (link.deleted || link.self || link.missing || !shows(link.a) || !shows(link.b)) continue;
    (link.kind === "parent" ? parent : partner).push(link);
  }
  const byKey = (x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
  parent.sort(byKey);
  partner.sort(byKey);
  const parentsOf = new Map();
  const childrenOf = new Map();
  const partnersOf = new Map();
  const push = (map, key, value) => { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]); };
  for (const link of parent) { push(parentsOf, link.b, link.a); push(childrenOf, link.a, link.b); }
  for (const link of partner) { push(partnersOf, link.a, link.b); push(partnersOf, link.b, link.a); }
  // parent links sorted by key `p:parent:child` are not sorted by parent within one child; do it explicitly
  for (const list of parentsOf.values()) list.sort();
  for (const list of childrenOf.values()) list.sort();
  for (const list of partnersOf.values()) list.sort();
  return { parent, partner, parentsOf, childrenOf, partnersOf };
}
