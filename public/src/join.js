// The join: how two people are compared, where the walk starts, and the walk itself (reference R9). Pure.
//
// Everything reads a view (tree.view()), where people are canonical sets and links connect canonical IDs.
// The walk never touches the tree except through tree operations; each change it makes goes to
// `commit(change)`, which the app uses to store the change and then adopt it. The default just adopts.
import { compareTimes, compareTriples, canonicalJson } from "./clock.js";
import { isExact } from "./dates.js";
import { makeGroup, randomHex } from "./history.js";
import { linkId } from "./records.js";
import { baseSurname, givenRelation, matchKey } from "./names.js";
import { areNotSameIn, resolveIn } from "./tree.js";

const RELATIONS = { parent: "parent", parents: "parent", child: "child", children: "child", partner: "partner", partners: "partner" };
const KNOWN_SEX = new Set(["M", "F", "X"]); // "U" and no sex are unknown
const COMPARED_FIELDS = ["g", "s", "bs", "sx", "bd", "bp", "dd", "dp", "dc", "nt"];
const GIVEN_RANK = { same: 0, close: 1 };
const YEARS_RANK = { equal: 0, unknown: 1, near: 2 };
const MAX_CANDIDATES = 3;

const relationOf = relation => {
  const found = RELATIONS[relation];
  if (!found) throw Object.assign(new Error(`unknown relation: ${relation}`), { code: "invalid" });
  return found;
};
const nothing = () => ({ puts: new Map(), group: null, meta: {} });

// ---------------------------------------------------------------- the graph of a view

const graphs = new WeakMap();

/** Who is whose parent, child and partner in a view, with the link record IDs behind each edge. */
function graphOf(view) {
  let g = graphs.get(view);
  if (g) return g;
  const parentsOf = new Map();
  const childrenOf = new Map();
  const partnersOf = new Map();
  const push = (map, key, value) => { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]); };
  for (const l of view.parentLinks) { push(parentsOf, l.child, { id: l.parent, ids: l.ids }); push(childrenOf, l.parent, { id: l.child, ids: l.ids }); }
  for (const l of view.partnerLinks) { push(partnersOf, l.a, { id: l.b, ids: l.ids, f: l.f }); push(partnersOf, l.b, { id: l.a, ids: l.ids, f: l.f }); }
  g = { parentsOf, childrenOf, partnersOf, up: new Map() };
  graphs.set(view, g);
  return g;
}

function ancestors(g, id) {
  let set = g.up.get(id);
  if (set) return set;
  set = new Set();
  const stack = [id];
  while (stack.length) for (const p of g.parentsOf.get(stack.pop()) ?? []) if (!set.has(p.id)) { set.add(p.id); stack.push(p.id); }
  g.up.set(id, set);
  return set;
}

const edges = (g, id, relation) => (relation === "parent" ? g.parentsOf : relation === "child" ? g.childrenOf : g.partnersOf).get(id) ?? [];

// ---------------------------------------------------------------- comparing two people

const yearOf = date => (isExact(date) ? date.y : null);

/** "equal" (both exact, same year), "near" (both exact, 1 to 5 apart), "far" (more than 5) or "unknown". */
function yearsRelation(a, b) {
  const x = yearOf(a);
  const y = yearOf(b);
  if (x === null || y === null) return "unknown";
  const gap = Math.abs(x - y);
  return gap === 0 ? "equal" : gap <= 5 ? "near" : "far";
}

const surnameKeys = f => new Set([f.s, f.bs].map(s => matchKey(baseSurname(s))).filter(Boolean));
const surnameMatch = (a, b) => { const keys = surnameKeys(b); return [...surnameKeys(a)].some(k => keys.has(k)); };
const knownSex = f => (KNOWN_SEX.has(f.sx) ? f.sx : undefined);

/**
 * Why two people should not be suggested as one human: a list of "same" (already one set), "sex", "years",
 * "related", "notsame", and, for Look for duplicates around X (`ctx.around`, `ctx.anchor`), "partners" and "siblings".
 * An empty list means nothing blocks them. Manual merge shows these as a warning.
 */
export function blockReasons(view, x, y, ctx = {}) {
  const X = resolveIn(view, x);
  const Y = resolveIn(view, y);
  if (X === Y) return ["same"];
  const px = view.people.get(X);
  const py = view.people.get(Y);
  if (!px || !py) return ["missing"];
  const g = graphOf(view);
  const reasons = [];
  const sx = knownSex(px.f);
  const sy = knownSex(py.f);
  if (sx && sy && sx !== sy) reasons.push("sex");
  if (yearsRelation(px.f.bd, py.f.bd) === "far") reasons.push("years");
  if (ancestors(g, X).has(Y) || ancestors(g, Y).has(X) || (g.partnersOf.get(X) ?? []).some(e => e.id === Y)) reasons.push("related");
  if (areNotSameIn(view, X, Y)) reasons.push("notsame");
  if (ctx.around) {
    const A = resolveIn(view, ctx.anchor);
    const partners = new Set((g.partnersOf.get(A) ?? []).map(e => e.id));
    if (partners.has(X) && partners.has(Y)) reasons.push("partners");
    const shareParent = (g.parentsOf.get(X) ?? []).some(e => (g.parentsOf.get(Y) ?? []).some(o => o.id === e.id));
    const key = matchKey(px.f.g);
    if (shareParent && key && key === matchKey(py.f.g) && yearsRelation(px.f.bd, py.f.bd) === "near") reasons.push("siblings");
  }
  return reasons;
}

/** Each side has exactly one parent of x's sex (sides come from `ctx.incoming`, the new link records). */
function oneParentEachSide(view, X, Y, ctx) {
  if (!ctx.anchor || !ctx.incoming) return false;
  const fits = sex => e => { const s = knownSex(view.people.get(e.id)?.f ?? {}); return sex === undefined || s === undefined || s === sex; };
  const sex = knownSex(view.people.get(X).f) ?? knownSex(view.people.get(Y).f);
  const parents = (graphOf(view).parentsOf.get(resolveIn(view, ctx.anchor)) ?? []).filter(fits(sex));
  const isNew = e => e.ids.every(id => ctx.incoming.has(id));
  return parents.filter(isNew).length === 1 && parents.filter(e => !isNew(e)).length === 1;
}

/** Both marriage dates (the partnership of the anchor with each) are exact and in the same year. */
function marriagesAgree(view, X, Y, ctx) {
  if (!ctx.anchor) return false;
  const links = graphOf(view).partnersOf.get(resolveIn(view, ctx.anchor)) ?? [];
  const mx = links.find(e => e.id === X)?.f.md;
  const my = links.find(e => e.id === Y)?.f.md;
  return isExact(mx) && isExact(my) && mx.y === my.y;
}

/** Another child of y's parents has the same given key. In the around mode x counts too, being one of them. */
function sameNamedSibling(view, X, Y, ctx) {
  const g = graphOf(view);
  const key = matchKey(view.people.get(Y).f.g);
  for (const parent of g.parentsOf.get(Y) ?? []) {
    for (const child of g.childrenOf.get(parent.id) ?? []) {
      if (child.id === Y || (child.id === X && !ctx.around)) continue;
      if (matchKey(view.people.get(child.id)?.f.g) === key) return true;
    }
  }
  return false;
}

/** The table of R9 for one pair: { level: "certain"|"possible"|"none"|"blocked", score }. Uniqueness is applied by rankMatches. */
function evaluate(view, x, y, relation, ctx) {
  const X = resolveIn(view, x);
  const Y = resolveIn(view, y);
  if (blockReasons(view, X, Y, ctx).length) return { level: "blocked" };
  const rel = relationOf(relation);
  const px = view.people.get(X).f;
  const py = view.people.get(Y).f;
  const given = givenRelation(px.g, py.g);
  const surname = surnameMatch(px, py);
  const years = yearsRelation(px.bd, py.bd); // equal, near or unknown: "far" is blocked
  const named = given === "same" || given === "close";
  let certain;
  let possible;
  if (rel === "parent") {
    certain = given === "same" && surname && years !== "near";
    possible = named || (given === "placeholder" && oneParentEachSide(view, X, Y, ctx));
  } else if (rel === "partner") {
    certain = given === "same" && surname && (years === "equal" || marriagesAgree(view, X, Y, ctx));
    possible = named;
  } else {
    certain = given === "same" && surname && (years === "equal" || (years === "unknown" && !sameNamedSibling(view, X, Y, ctx)));
    possible = named || (years === "equal" && surname);
  }
  const level = certain ? "certain" : possible ? "possible" : "none";
  return { level, score: [GIVEN_RANK[given] ?? 2, surname ? 0 : 1, YEARS_RANK[years]] };
}

/**
 * How two people compare as relatives in the same relation ("parent", "partner" or "child") of one merged person:
 * "certain", "possible", "blocked" or "none". `ctx` is optional: `anchor` (that merged person) enables the
 * marriage-date and placeholder rules, with `incoming` (Set of new record IDs) for the placeholder rule; `around`
 * switches on the extra blockers of Look for duplicates around X. Uniqueness is not applied here (see rankMatches).
 */
export function compareCandidates(view, x, y, relation, ctx = {}) {
  return evaluate(view, x, y, relation, ctx).level;
}

/**
 * Compare every x with every y and apply uniqueness: a certain pair counts only if x has exactly one certain y and
 * y exactly one certain x; otherwise all such pairs become possible. → [{ x, y, level, score }] for certain and
 * possible pairs only, x and y as canonical IDs.
 */
export function rankMatches(view, xs, ys, relation, ctx = {}) {
  const pairs = [];
  for (const x of new Set(xs.map(id => resolveIn(view, id)))) {
    for (const y of new Set(ys.map(id => resolveIn(view, id)))) {
      if (x === y) continue;
      const r = evaluate(view, x, y, relation, ctx);
      if (r.level === "certain" || r.level === "possible") pairs.push({ x, y, level: r.level, score: r.score });
    }
  }
  const countX = new Map();
  const countY = new Map();
  for (const p of pairs) if (p.level === "certain") { countX.set(p.x, (countX.get(p.x) ?? 0) + 1); countY.set(p.y, (countY.get(p.y) ?? 0) + 1); }
  for (const p of pairs) if (p.level === "certain" && (countX.get(p.x) !== 1 || countY.get(p.y) !== 1)) p.level = "possible";
  return pairs;
}

const byScore = (a, b) => {
  for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
  return a.y < b.y ? -1 : a.y > b.y ? 1 : 0;
};

// ---------------------------------------------------------------- start points

/**
 * Where the join starts, read from the view after the incoming records were adopted (R9 Start points).
 * → { newGroups: [{ ids, size }] largest first (size 2 or more, linked to nobody existing),
 *     singles: [id] (incoming people with no link at all; they go to Needs attention),
 *     gainedRelatives: [id] (existing people with a new link to an incoming person) }.
 * A device with no people before the incoming ones has none.
 */
export function startPoints(view, incoming) {
  const fresh = id => view.people.get(id).members.every(m => incoming.has(m));
  const freshIds = [...view.people.keys()].filter(fresh);
  const empty = { newGroups: [], singles: [], gainedRelatives: [] };
  if (freshIds.length === 0 || freshIds.length === view.people.size) return empty;

  const root = new Map(freshIds.map(id => [id, id]));
  const find = id => { let r = id; while (root.get(r) !== r) r = root.get(r); return r; };
  const attached = new Set();
  const gained = new Set();
  const links = [...view.parentLinks.map(l => [l.parent, l.child, l.ids]), ...view.partnerLinks.map(l => [l.a, l.b, l.ids])];
  for (const [a, b, ids] of links) {
    const aNew = root.has(a);
    const bNew = root.has(b);
    if (aNew && bNew) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) root.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    } else if (aNew !== bNew) {
      attached.add(aNew ? a : b);
      if (ids.some(id => incoming.has(id))) gained.add(aNew ? b : a);
    }
  }
  const groups = new Map();
  for (const id of freshIds) { const r = find(id); if (groups.has(r)) groups.get(r).push(id); else groups.set(r, [id]); }
  const free = [...groups.values()].filter(ids => !ids.some(id => attached.has(id)));
  return {
    newGroups: free.filter(ids => ids.length >= 2)
      .map(ids => ({ ids: ids.sort(), size: ids.length }))
      .sort((x, y) => y.size - x.size || (x.ids[0] < y.ids[0] ? -1 : 1)),
    singles: free.filter(ids => ids.length === 1).map(ids => ids[0]).sort(),
    gainedRelatives: [...gained].sort(),
  };
}

// ---------------------------------------------------------------- comparing values for the differences list

const trimmed = v => (typeof v === "string" ? v.trim() : v);
function sameValue(key, a, b) {
  if (key === "g" || key === "s" || key === "bs") {
    const [x, y] = key === "g" ? [a, b] : [baseSurname(a), baseSurname(b)];
    const kx = matchKey(x);
    return kx === matchKey(y) && (kx !== "" || trimmed(a) === trimmed(b));
  }
  if (key === "bd" || key === "dd") return canonicalJson(a) === canonicalJson(b);
  return trimmed(a) === trimmed(b);
}

// ---------------------------------------------------------------- the walk

/**
 * The walk (R9). `pairs` are [existing person, person of a new group] the relatives picked: the walk merges them
 * first. `selfPairs` are existing people who gained an incoming relative (from gainedRelatives): paired with themselves.
 * `incoming` is the Set of new record IDs. `session` tags every change. `commit(change)` stores and adopts a change;
 * by default it only adopts.
 *
 * → { next() → question | null, answer(question, answer) → change, automatic(), unmerge(entry),
 *     differences(), applyDifferences(picks), session }
 * question: { id, x, of, relation, candidates } where x and the candidates are people of the view.
 */
export function createWalk(tree, { pairs = [], selfPairs = [], incoming, session = randomHex(), commit = change => tree.adopt(change) } = {}) {
  const inc = incoming instanceof Set ? incoming : new Set(incoming ?? []);
  const isNew = edge => edge.ids.every(id => inc.has(id));
  const isFresh = (view, id) => !!view.people.get(id)?.members.every(m => inc.has(m));

  const queue = [];
  const questions = [];
  const declined = []; // [x, y] pairs answered "not sure" in this join
  const joined = []; // every merge the walk made, for differences()
  const merges = []; // the automatic ones, for the review list
  const settled = new Set(); // "id|field" differences the user already settled
  let started = false;
  let current = null;
  let counter = 0;

  /** Several changes computed together (on disjoint records) as one change with one history group. */
  function combine(changes, action) {
    const real = changes.filter(c => c && (c.puts.size || c.group));
    if (!real.length) return null;
    const puts = new Map();
    const groups = [];
    let last = null;
    for (const c of real) {
      for (const [id, record] of c.puts) puts.set(id, record);
      if (c.group) groups.push(c.group);
      if (c.meta?.last && (!last || compareTimes(c.meta.last, last) > 0)) last = c.meta.last;
    }
    const group = makeGroup({
      action, device: tree.device, at: groups[0].at, session,
      people: [...new Set(groups.flatMap(g => g.people))],
      changes: groups.flatMap(g => g.changes),
      lost: groups.flatMap(g => g.lost),
    });
    return { puts, group, meta: last ? { last } : {} };
  }

  const resolve = id => resolveIn(tree.view(), id);
  const isDeclined = (view, x, y) => declined.some(([a, b]) => resolveIn(view, a) === x && resolveIn(view, b) === y);

  function start() {
    for (const [existing, fresh] of pairs) {
      if (resolve(existing) !== resolve(fresh)) {
        const change = tree.merge(existing, fresh, {}, { session });
        commit(change);
        joined.push([existing, fresh]);
      }
      queue.push(resolve(existing));
    }
    for (const id of selfPairs) queue.push(resolve(id));
  }

  /** Compare the new relatives of a merged person with the old ones; merge the certain, keep the possible as questions. */
  function visit(person) {
    const view = tree.view();
    const M = resolveIn(view, person);
    if (!view.people.has(M)) return;
    const g = graphOf(view);
    const ctx = { anchor: M, incoming: inc };
    const certain = [];
    const asks = [];
    for (const relation of ["parent", "partner", "child"]) {
      const around = edges(g, M, relation);
      const xs = around.filter(e => isNew(e) && isFresh(view, e.id)).map(e => e.id);
      const ys = around.filter(e => !isNew(e) && !isFresh(view, e.id)).map(e => e.id);
      if (!xs.length || !ys.length) continue;
      const ranked = rankMatches(view, xs, ys, relation, ctx);
      const taken = new Set();
      for (const r of ranked) if (r.level === "certain") { certain.push({ ...r, relation }); taken.add(r.x); taken.add(r.y); }
      for (const x of xs) {
        if (taken.has(x)) continue;
        const options = ranked.filter(r => r.x === x && r.level === "possible" && !taken.has(r.y) && !isDeclined(view, r.x, r.y)).sort(byScore);
        if (options.length) asks.push({ x, of: M, relation, cands: options.slice(0, MAX_CANDIDATES).map(r => r.y) });
      }
    }
    questions.push(...asks);

    // one transaction for the batch; pairs that touch a set already in the batch wait for the next visit
    const used = new Set();
    const batch = [];
    let deferred = false;
    for (const c of certain) {
      if (used.has(c.x) || used.has(c.y)) { deferred = true; continue; }
      used.add(c.x);
      used.add(c.y);
      batch.push(c);
    }
    if (batch.length) {
      const combined = combine(batch.map(c => tree.merge(c.x, c.y, {}, { session })), "merge");
      commit(combined);
      for (const c of batch) {
        const [low, high] = c.x < c.y ? [c.x, c.y] : [c.y, c.x];
        const record = linkId("merge", low, high);
        merges.push({
          n: ++counter, x: c.x, y: c.y, relation: c.relation, of: M, record,
          group: { ...combined.group, changes: combined.group.changes.filter(ch => ch.r === record) },
        });
        joined.push([c.x, c.y]);
        queue.push(resolve(c.x));
      }
    }
    if (deferred) queue.unshift(M);
  }

  /** A stored question, checked against the tree as it is now. */
  function prepare(raw) {
    const view = tree.view();
    const X = resolveIn(view, raw.x);
    const px = view.people.get(X);
    if (!px) return null;
    const ids = [...new Set(raw.cands.map(id => resolveIn(view, id)))]
      .filter(id => view.people.has(id) && !blockReasons(view, X, id).length && !isDeclined(view, X, id));
    if (!ids.length) return null;
    return { id: `${X}:${raw.relation}:${raw.of}`, x: px, of: raw.of, relation: raw.relation, candidates: ids.map(id => view.people.get(id)) };
  }

  return {
    session,

    /** The next question, or null when the walk is done. The same question is returned until it is answered. */
    next() {
      if (!started) { started = true; start(); }
      if (current) return current;
      for (;;) {
        while (questions.length) {
          const q = prepare(questions.shift());
          if (q) return (current = q);
        }
        if (!queue.length) return null;
        visit(queue.shift());
      }
    },

    /** Answer the open question: { same: id }, "different" or "unsure". Returns the change that was committed. */
    answer(question, answer) {
      if (!current || question.id !== current.id) throw Object.assign(new Error("that question is not open"), { code: "state" });
      if (answer === "unsure") {
        current = null;
        for (const c of question.candidates) declined.push([question.x.id, c.id]);
        return nothing();
      }
      if (answer === "different") {
        current = null;
        const combined = combine(question.candidates.map(c => tree.notSame(question.x.id, c.id, { session })), "notsame");
        if (!combined) return nothing();
        commit(combined);
        return combined;
      }
      if (answer && typeof answer === "object" && question.candidates.some(c => c.id === answer.same)) {
        current = null;
        const change = tree.merge(question.x.id, answer.same, {}, { session });
        commit(change);
        joined.push([question.x.id, answer.same]);
        queue.push(resolve(question.x.id));
        return change;
      }
      throw Object.assign(new Error("answer must be { same: id of a candidate }, \"different\" or \"unsure\""), { code: "invalid" });
    },

    /** Every automatic merge so far: [{ n, x, y, relation, of, record }] with x the incoming person. */
    automatic() {
      return merges.map(({ n, x, y, relation, of, record }) => ({ n, x, y, relation, of, record }));
    },

    /** "Not the same" on one automatic merge: undoes it and writes a not-same record. Two changes are committed. */
    unmerge(entry) {
      const found = merges.find(m => m.n === entry.n);
      if (!found) throw Object.assign(new Error("not an automatic merge of this join"), { code: "missing" });
      const undo = tree.undo(found.group);
      if (undo.puts.size === 0) throw Object.assign(new Error("that merge can't be undone any more"), { code: "state" });
      undo.group.session = session;
      commit(undo);
      merges.splice(merges.indexOf(found), 1);
      const apart = tree.notSame(found.x, found.y, { session });
      if (apart.puts.size) commit(apart);
      return apart;
    },

    /**
     * Merged people whose fields differ between our side and theirs: [{ id, fields: [{ f, ours, theirs, current, choice }] }].
     * Names compare by key, dates by structure, other text trimmed. "ours" is preselected.
     */
    differences() {
      const view = tree.view();
      const records = tree.records();
      const out = [];
      const seen = new Set();
      for (const [a] of joined) {
        const id = resolveIn(view, a);
        const person = view.people.get(id);
        if (!person || person.members.length < 2 || seen.has(id)) continue;
        seen.add(id);
        const fields = [];
        for (const key of COMPARED_FIELDS) {
          if (settled.has(`${id}|${key}`)) continue;
          let ours = null;
          let theirs = null;
          for (const member of person.members) {
            const t = records.get(member)?.f[key];
            if (!t || t[0] === null) continue;
            if (inc.has(member)) { if (!theirs || compareTriples(t, theirs) > 0) theirs = t; }
            else if (!ours || compareTriples(t, ours) > 0) ours = t;
          }
          if (ours && theirs && !sameValue(key, ours[0], theirs[0])) {
            fields.push({ f: key, ours: ours[0], theirs: theirs[0], current: person.f[key], choice: "ours" });
          }
        }
        if (fields.length) out.push({ id, fields });
      }
      return out;
    },

    /** Write the user's choices as new edits: picks are [{ id, f, value }]. One change, tagged with the session. */
    applyDifferences(picks) {
      const byPerson = new Map();
      for (const { id, f, value } of picks) {
        const canonical = resolve(id);
        byPerson.set(canonical, { ...byPerson.get(canonical), [f]: value });
        settled.add(`${canonical}|${f}`);
      }
      const combined = combine([...byPerson].map(([id, fields]) => tree.edit(id, fields)), "edit");
      if (!combined) return nothing();
      commit(combined);
      return combined;
    },
  };
}

// ---------------------------------------------------------------- later duplicates

/**
 * Look for duplicates around X (R9): for each relation of X, its relatives compared with each other, pairwise, by the
 * same table with the extra blockers. → [{ relation, a, b, level }] with level "certain" or "possible", a < b.
 */
export function duplicatesAround(tree, id) {
  const view = tree.view();
  const anchor = resolveIn(view, id);
  const g = graphOf(view);
  const ctx = { around: true, anchor };
  const found = [];
  for (const relation of ["parent", "partner", "child"]) {
    const ids = [...new Set(edges(g, anchor, relation).map(e => e.id))].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const level = compareCandidates(view, ids[i], ids[j], relation, ctx);
        if (level === "certain" || level === "possible") found.push({ relation, a: ids[i], b: ids[j], level });
      }
    }
  }
  return found;
}
