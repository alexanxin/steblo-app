// Tasks 3.1 to 3.4: comparing two people, start points, the walk, review lists (reference R9).
// Every person here is invented.
import test from "node:test";
import assert from "node:assert/strict";
import { applyPayload, buildPayload } from "../public/src/sync.js";
import { linkId } from "../public/src/records.js";
import { areNotSameIn, resolveIn } from "../public/src/tree.js";
import {
  blockReasons, compareCandidates, createWalk, duplicatesAround, rankMatches, startPoints,
} from "../public/src/join.js";
import { makeTree, copyRecords, pid, T0 } from "./fixtures/helpers.js";

const D1 = pid("d", 1);
const D2 = pid("d", 2);
const ALL = Array.from({ length: 256 }, (_, n) => n);

/** One tree with an anchor person M. add(relation, fields) puts a relative around M. */
function around(fields = { g: "Адам", s: "Новаков" }) {
  const h = makeTree();
  const m = h.add(fields);
  const rel = (relation, f, opts) => h.addRel(m, relation, f, opts);
  return { h, m, rel, view: () => h.tree.view() };
}

// ================================================================ Task 3.1

test("blocker: different known sexes", () => {
  const w = around();
  const x = w.rel("child", { g: "Миро", s: "Новаков", sx: "M" });
  const y = w.rel("child", { g: "Миро", s: "Новаков", sx: "F" });
  assert.equal(compareCandidates(w.view(), x, y, "child"), "blocked");
  assert.deepEqual(blockReasons(w.view(), x, y), ["sex"]);
  // an unknown sex blocks nothing
  const z = w.rel("child", { g: "Миро", s: "Новаков" });
  assert.notEqual(compareCandidates(w.view(), x, z, "child"), "blocked");
});

test("blocker: exact birth years more than 5 apart", () => {
  const w = around();
  const x = w.rel("child", { g: "Ема", s: "Новакова", bd: { y: 1950 } });
  const far = w.rel("child", { g: "Ема", s: "Новакова", bd: { y: 1956 } });
  const edge = w.rel("child", { g: "Ема", s: "Новакова", bd: { y: 1955 } });
  assert.equal(compareCandidates(w.view(), x, far, "child"), "blocked");
  assert.deepEqual(blockReasons(w.view(), x, far), ["years"]);
  assert.notEqual(compareCandidates(w.view(), x, edge, "child"), "blocked"); // exactly 5 is allowed
});

test("blocker: already one set", () => {
  const w = around();
  const x = w.rel("child", { g: "Миро", s: "Новаков" });
  const y = w.rel("child", { g: "Миро", s: "Новаков" });
  w.h.run(w.h.tree.merge(x, y));
  assert.equal(compareCandidates(w.view(), x, y, "child"), "blocked");
  assert.deepEqual(blockReasons(w.view(), x, y), ["same"]);
});

test("blocker: related (ancestor, descendant or partner)", () => {
  const w = around();
  const x = w.rel("child", { g: "Миро", s: "Новаков" });
  const grandchild = w.h.addRel(x, "child", { g: "Миро", s: "Новаков" });
  assert.deepEqual(blockReasons(w.view(), x, grandchild), ["related"]);
  assert.deepEqual(blockReasons(w.view(), grandchild, w.m), ["related"]); // a grandparent
  const partner = w.h.addRel(x, "partner", { g: "Миро", s: "Новаков" });
  assert.deepEqual(blockReasons(w.view(), x, partner), ["related"]);
  assert.equal(compareCandidates(w.view(), x, partner, "partner"), "blocked");
});

test("blocker: not-same", () => {
  const w = around();
  const x = w.rel("child", { g: "Миро", s: "Новаков" });
  const y = w.rel("child", { g: "Миро", s: "Новаков" });
  assert.equal(compareCandidates(w.view(), x, y, "child"), "certain");
  w.h.run(w.h.tree.notSame(x, y));
  assert.equal(compareCandidates(w.view(), x, y, "child"), "blocked");
  assert.deepEqual(blockReasons(w.view(), x, y), ["notsame"]);
});

test("inexact dates count as unknown", () => {
  // two parents of M named Danilo; only the birth dates differ
  const compare = (bx, by) => {
    const w = around();
    const x = w.rel("parent", { g: "Данило", s: "Новаков", bd: bx });
    const y = w.rel("parent", { g: "Данило", s: "Новаков", bd: by });
    return compareCandidates(w.view(), x, y, "parent");
  };
  assert.equal(compare({ y: 1960 }, { y: 1950 }), "blocked"); // both exact, 10 apart
  assert.equal(compare({ y: 1950, q: "abt" }, { y: 1960 }), "certain"); // about 1950 is unknown
  assert.equal(compare({ y: 1950 }, { y: 1960, q: "bef" }), "certain");
  assert.equal(compare({ t: "spring 1980" }, { y: 1960 }), "certain"); // text dates are unknown too
  assert.equal(compare({ y: 1960, m: 3 }, { y: 1960 }), "certain"); // a month does not make it less exact
});

test("a certain parent, partner and child", () => {
  const w = around();
  // parents of M: Danilo twice
  const px = w.rel("parent", { g: "Данило", s: "Новаков", bd: { y: 1920 } });
  const py = w.rel("parent", { g: "Danilo", s: "Novakov" }); // no year: unknown
  assert.equal(compareCandidates(w.view(), px, py, "parent"), "certain");
  // partners of M: Teodora twice, same exact birth year, surname in the other alphabet and form
  const tx = w.rel("partner", { g: "Теодора", s: "Новакова", bd: { y: 1923 } });
  const ty = w.rel("partner", { g: "Teodora", s: "Novakova", bd: { y: 1923 } });
  assert.equal(compareCandidates(w.view(), tx, ty, "partner"), "certain");
  // children of M: Ema twice
  const cx = w.rel("child", { g: "Ема", s: "Новакова", bd: { y: 1951 } });
  const cy = w.rel("child", { g: "Ema", s: "Novakova", bd: { y: 1951 } });
  assert.equal(compareCandidates(w.view(), cx, cy, "child"), "certain");
  // a different given name is nothing
  const cz = w.rel("child", { g: "Лея", s: "Новакова", bd: { y: 1953 } });
  assert.equal(compareCandidates(w.view(), cx, cz, "child"), "none");
});

test("remarriage: a partner with the same name but no year agreement is only possible", () => {
  const w = around();
  const x = w.rel("partner", { g: "Теодора", s: "Новакова" });
  const y = w.rel("partner", { g: "Теодора", s: "Новакова" });
  assert.equal(compareCandidates(w.view(), x, y, "partner"), "possible");
  // different exact years, 3 apart: near, still only possible
  const u = w.rel("partner", { g: "Теодора", s: "Новакова", bd: { y: 1923 } });
  const v = w.rel("partner", { g: "Теодора", s: "Новакова", bd: { y: 1926 } });
  assert.equal(compareCandidates(w.view(), u, v, "partner"), "possible");
  // both marriage dates exact and in the same year make it certain (needs the anchor)
  w.h.run(w.h.tree.editPartnership(w.m, x, { md: { y: 1946 } }));
  w.h.run(w.h.tree.editPartnership(w.m, y, { md: { y: 1946, m: 5 } }));
  assert.equal(compareCandidates(w.view(), x, y, "partner", { anchor: w.m }), "certain");
  w.h.run(w.h.tree.editPartnership(w.m, y, { md: { y: 1947 } }));
  assert.equal(compareCandidates(w.view(), x, y, "partner", { anchor: w.m }), "possible");
});

test("a sibling with the same name and unknown year is only possible", () => {
  const w = around();
  const x = w.rel("child", { g: "Миро", s: "Новаков" });
  const y1 = w.rel("child", { g: "Миро", s: "Новаков", bd: { y: 1950 } });
  assert.equal(compareCandidates(w.view(), x, y1, "child"), "certain"); // y has no same-name sibling yet
  const y2 = w.rel("child", { g: "Миро", s: "Новаков", bd: { y: 1953 } });
  assert.equal(compareCandidates(w.view(), x, y1, "child"), "possible");
  assert.equal(compareCandidates(w.view(), x, y2, "child"), "possible");
});

test("one child under two names is possible", () => {
  const w = around();
  const x = w.rel("child", { g: "Ема", s: "Новакова", bd: { y: 1950 } });
  const y = w.rel("child", { g: "Лея", s: "Новакова", bd: { y: 1950 } });
  assert.equal(compareCandidates(w.view(), x, y, "child"), "possible");
  const other = w.rel("child", { g: "Лея", s: "Чарин", bd: { y: 1950 } }); // no surname match
  assert.equal(compareCandidates(w.view(), x, other, "child"), "none");
  const noYear = w.rel("child", { g: "Лея", s: "Новакова" });
  assert.equal(compareCandidates(w.view(), x, noYear, "child"), "none");
});

test("a placeholder parent is possible only when each side has one parent of that sex", () => {
  const w = around();
  const y = w.rel("parent", { g: "Теодора", s: "Новакова", sx: "F" });
  const x = w.rel("parent", {}); // a nameless parent (added second: a first one would be filled by the next parent)
  const incoming = new Set([linkId("parent", x, w.m)]);
  assert.equal(compareCandidates(w.view(), x, y, "parent", { anchor: w.m, incoming }), "possible");
  // without the anchor the side rule can't be checked
  assert.equal(compareCandidates(w.view(), x, y, "parent"), "none");
  // both links on one side: the other side has no parent of that sex
  const both = new Set([linkId("parent", x, w.m), linkId("parent", y, w.m)]);
  assert.equal(compareCandidates(w.view(), x, y, "parent", { anchor: w.m, incoming: both }), "none");
});

test("uniqueness downgrades two certain candidates to possible", () => {
  const w = around();
  const x1 = w.rel("child", { g: "Ема", s: "Новакова", bd: { y: 1951 } });
  const y = w.rel("child", { g: "Ема", s: "Новакова", bd: { y: 1951 } });
  const alone = rankMatches(w.view(), [x1], [y], "child");
  assert.deepEqual(alone.map(r => [r.x, r.y, r.level]), [[x1, y, "certain"]]);
  const x2 = w.rel("child", { g: "Ема", s: "Новакова", bd: { y: 1951 } });
  const two = rankMatches(w.view(), [x1, x2], [y], "child");
  assert.deepEqual(two.map(r => r.level), ["possible", "possible"]);
  const y2 = w.rel("child", { g: "Ема", s: "Новакова", bd: { y: 1951 } });
  const grid = rankMatches(w.view(), [x1, x2], [y, y2], "child");
  assert.equal(grid.length, 4);
  assert.ok(grid.every(r => r.level === "possible"));
});

test("empty keys never match: two Japanese names are never certain", () => {
  const w = around({ g: "Taro", s: "Yamada" });
  for (const relation of ["parent", "partner", "child"]) {
    const a = w.rel(relation === "parent" ? "parent" : relation, { g: "太郎", s: "山田", bd: { y: 1950 } });
    const b = w.rel(relation === "parent" ? "parent" : relation, { g: "太郎", s: "山田", bd: { y: 1950 } });
    assert.notEqual(compareCandidates(w.view(), a, b, relation), "certain", relation);
  }
  const a = w.rel("child", { g: "太郎", s: "山田", bd: { y: 1950 } });
  const b = w.rel("child", { g: "太郎", s: "山田", bd: { y: 1950 } });
  assert.equal(compareCandidates(w.view(), a, b, "child"), "none");
});


// ================================================================ Task 3.2

/** Adam's phone `a` and another relative's phone `b`; bring(a, b) applies b's records on a. */
function phones() {
  return {
    a: makeTree({ device: D1, prefix: "a" }),
    b: makeTree({ device: D2, prefix: "b", start: T0 + 5000 }),
  };
}
function bring(a, b) {
  const result = applyPayload(a.tree, buildPayload(b.tree.records(), ALL), { now: a.wall.now, helloW: b.wall.now, allowErase: true });
  a.run(result.change);
  return result;
}
/** Danilo and Teodora with Miro and Ema, and Adam under Miro. Returns the IDs. */
function houseOf(h, { adam = true, d: dFields = {} } = {}) {
  const d = h.add({ g: "Данило", s: "Новаков", sx: "M", bd: { y: 1920 }, ...dFields });
  const t = h.addRel(d, "partner", { g: "Теодора", s: "Новакова", sx: "F", bd: { y: 1923 } });
  const m = h.addRel(d, "child", { g: "Миро", s: "Новаков", sx: "M", bd: { y: 1948 } }, { otherParent: t });
  const e = h.addRel(d, "child", { g: "Ема", s: "Новакова", sx: "F", bd: { y: 1951 } }, { otherParent: t });
  const out = { d, t, m, e };
  if (adam) out.adam = h.addRel(m, "child", { g: "Адам", s: "Новаков", sx: "M", bd: { y: 1975 } });
  return out;
}

test("a new group is incoming people linked to nobody existing", () => {
  const { a, b } = phones();
  houseOf(a, { adam: false });
  const theirs = houseOf(b);
  const r = bring(a, b);
  const sp = startPoints(a.tree.view(), r.incoming);
  assert.equal(sp.newGroups.length, 1);
  assert.equal(sp.newGroups[0].size, 5);
  assert.deepEqual(sp.newGroups[0].ids, Object.values(theirs).sort());
  assert.deepEqual(sp.newGroups, r.newGroups);
  assert.deepEqual(sp.gainedRelatives, []);
  assert.deepEqual(sp.singles, []);
});

test("single-person groups aren't prompted", () => {
  const { a, b } = phones();
  houseOf(a, { adam: false });
  houseOf(b);
  const lone = b.add({ g: "Лея" });
  const r = bring(a, b);
  const sp = startPoints(a.tree.view(), r.incoming);
  assert.equal(sp.newGroups.length, 1);
  assert.ok(!sp.newGroups[0].ids.includes(lone));
  assert.deepEqual(sp.singles, [lone]); // goes to Needs attention
});

test("groups come largest first", () => {
  const { a, b } = phones();
  houseOf(a, { adam: false });
  const lea = b.add({ g: "Лея" });
  const pair = [lea, b.addRel(lea, "partner", { g: "Адам" })].sort();
  const house = houseOf(b);
  const r = bring(a, b);
  const sp = startPoints(a.tree.view(), r.incoming);
  assert.deepEqual(sp.newGroups.map(g => g.size), [5, 2]);
  assert.deepEqual(sp.newGroups[1].ids, pair);
  assert.deepEqual(sp.newGroups[0].ids, Object.values(house).sort());
});

test("an existing person who gains an incoming relative is a start point", () => {
  const a = makeTree({ device: D1, prefix: "a" });
  const base = a.add({ g: "Данило", s: "Новаков" });
  const b = makeTree({ device: D2, prefix: "b", start: T0 + 5000, records: copyRecords(a.tree.records()) });
  b.addRel(base, "child", { g: "Миро", s: "Новаков" });
  const r = bring(a, b);
  const sp = startPoints(a.tree.view(), r.incoming);
  assert.deepEqual(sp.gainedRelatives, [base]);
  assert.deepEqual(sp.gainedRelatives, r.gainedRelatives);
  assert.deepEqual(sp.newGroups, []);
  assert.deepEqual(sp.singles, []); // the new child is attached, so not a lone person
});

test("an empty device has no start points", () => {
  const { a, b } = phones();
  houseOf(b);
  b.add({ g: "Лея" });
  const r = bring(a, b);
  assert.ok(r.newGroups.length > 0); // sync reports it; the join does not run
  assert.deepEqual(startPoints(a.tree.view(), r.incoming), { newGroups: [], singles: [], gainedRelatives: [] });
});

// ================================================================ Task 3.3

/** Adam's tree and Lea's tree, built apart. Both have Danilo's house with Adam; Lea is only in hers. */
function overlap() {
  const { a, b } = phones();
  const mine = houseOf(a);
  const theirs = houseOf(b);
  theirs.lea = b.addRel(theirs.e, "child", { g: "Лея", s: "Чарин", sx: "F", bd: { y: 1980 } });
  const r = bring(a, b);
  return { a, b, mine, theirs, r };
}
function walkOf(a, r, pairs, { commits, selfPairs = [], session = "sess-1" } = {}) {
  const commit = commits ? change => { commits.push(change); a.tree.adopt(change); } : undefined;
  return createWalk(a.tree, { pairs, selfPairs, incoming: r.incoming, session, commit });
}
/** Ask until done, answering each question with `answer(question)`. */
function drain(walk, answer = () => "unsure") {
  const asked = [];
  for (let q = walk.next(); q; q = walk.next()) { asked.push(q); walk.answer(q, answer(q)); }
  return asked;
}
const namesOf = view => [...view.people.values()].map(p => p.f.g).sort();

test("the overlap scenario: the Danilo, Teodora, Miro, Ema example ends with no duplicates", () => {
  const { a, mine, theirs, r } = overlap();
  assert.equal(a.tree.view().people.size, 11);
  const walk = walkOf(a, r, [[mine.d, theirs.d]]);
  const asked = drain(walk);
  assert.equal(asked.length, 0);
  const view = a.tree.view();
  assert.deepEqual(namesOf(view), ["Адам", "Данило", "Ема", "Лея", "Миро", "Теодора"]);
  // Lea hangs under the one Ema, Adam under the one Miro
  assert.equal(view.parentLinks.filter(l => l.parent === resolveIn(view, mine.e)).length, 1);
  assert.equal(resolveIn(view, theirs.adam), resolveIn(view, mine.adam));
});

test("certain matches merge with no question, and queue their pair", () => {
  const { a, mine, theirs, r } = overlap();
  const walk = walkOf(a, r, [[mine.d, theirs.d]]);
  assert.equal(walk.next(), null);
  const entries = walk.automatic();
  // Teodora, Miro and Ema from Danilo; Adam only because Miro's pair was queued
  assert.deepEqual(entries.map(e => e.relation).sort(), ["child", "child", "child", "partner"]);
  const adam = entries.find(e => e.x === theirs.adam);
  assert.equal(adam.y, mine.adam);
  assert.equal(adam.of, resolveIn(a.tree.view(), mine.m));
});

test("a question offers up to three candidates, best first", () => {
  const w = questionWorld();
  const q = w.walk.next();
  assert.equal(q.relation, "child");
  assert.equal(q.x.id, w.x);
  assert.equal(q.of, w.d);
  assert.deepEqual(q.candidates.map(c => c.id), [w.y4, w.y1, w.y2]); // unknown year, then near; the close name last and cut
  assert.equal(w.walk.next(), q); // asking again hands back the same open question
});

/** Danilo with four children in `a`; one child Miro in `b`. */
function questionWorld(opts) {
  const { a, b } = phones();
  const d = a.add({ g: "Данило", s: "Новаков", sx: "M", bd: { y: 1920 } });
  const y1 = a.addRel(d, "child", { g: "Миро", s: "Новаков", bd: { y: 1950 } });
  const y2 = a.addRel(d, "child", { g: "Миро", s: "Новаков", bd: { y: 1955 } });
  const y3 = a.addRel(d, "child", { g: "Мироо", s: "Новакова" });
  const y4 = a.addRel(d, "child", { g: "Миро", s: "Новаков", bd: { y: 1951, q: "abt" } });
  const bd = b.add({ g: "Данило", s: "Новаков", sx: "M", bd: { y: 1920 } });
  const x = b.addRel(bd, "child", { g: "Миро", s: "Новаков", bd: { y: 1951 } });
  const r = bring(a, b);
  const commits = [];
  const walk = walkOf(a, r, [[d, bd]], { commits, ...opts });
  return { a, b, r, d, bd, x, y1, y2, y3, y4, walk, commits };
}

test("a different person writes not-same for every candidate shown", () => {
  const w = questionWorld();
  const q = w.walk.next();
  const change = w.walk.answer(q, "different");
  const view = w.a.tree.view();
  for (const id of [w.y4, w.y1, w.y2]) assert.ok(areNotSameIn(view, w.x, id), id);
  assert.ok(!areNotSameIn(view, w.x, w.y3)); // not shown, not written
  assert.equal(change.group.action, "notsame");
  assert.equal(change.group.session, "sess-1");
  assert.notEqual(resolveIn(view, w.x), resolveIn(view, w.y4));
  assert.equal(w.walk.next(), null);
});

test("not sure writes nothing", () => {
  const w = questionWorld();
  const q = w.walk.next();
  const before = w.a.tree.records().size;
  const commitsBefore = w.commits.length;
  const change = w.walk.answer(q, "unsure");
  assert.equal(change.puts.size, 0);
  assert.equal(change.group, null);
  assert.equal(w.a.tree.records().size, before);
  assert.equal(w.commits.length, commitsBefore);
  assert.equal(w.walk.next(), null); // not asked again in this join
});

test("the same baby on both sides is merged from the parents", () => {
  const { a, b } = phones();
  const build = h => {
    const d = h.add({ g: "Данило", s: "Новаков", sx: "M", bd: { y: 1990 } });
    const t = h.addRel(d, "partner", { g: "Теодора", s: "Новакова", sx: "F", bd: { y: 1992 } });
    const baby = h.addRel(d, "child", { g: "Ема", s: "Новакова", sx: "F", bd: { y: 2024, m: 3, d: 9 } }, { otherParent: t });
    return { d, t, baby };
  };
  const mine = build(a);
  const theirs = build(b);
  const r = bring(a, b);
  const walk = walkOf(a, r, [[mine.d, theirs.d]]);
  assert.equal(drain(walk).length, 0);
  const view = a.tree.view();
  assert.equal(view.people.size, 3);
  assert.equal(resolveIn(view, theirs.baby), resolveIn(view, mine.baby));
  assert.equal(walk.automatic().filter(e => e.relation === "child").length, 1); // once, not once per parent
});

test("each answer is its own change, tagged with the session", () => {
  const w = questionWorld({ session: "sess-9" });
  const q = w.walk.next();
  const before = w.commits.length; // the start pair
  assert.equal(before, 1);
  assert.equal(w.commits[0].group.session, "sess-9");
  const change = w.walk.answer(q, { same: w.y4 });
  assert.equal(w.commits.length, before + 1);
  assert.equal(w.commits.at(-1), change);
  assert.equal(change.group.action, "merge");
  assert.equal(change.group.session, "sess-9");
  assert.equal(resolveIn(w.a.tree.view(), w.x), resolveIn(w.a.tree.view(), w.y4));
  // a batch of automatic merges is one change, too
  const o = overlap();
  const commits = [];
  const walk = walkOf(o.a, o.r, [[o.mine.d, o.theirs.d]], { commits, session: "sess-9" });
  drain(walk);
  assert.equal(commits.length, 3); // the start pair, Danilo's three, Miro's one
  assert.deepEqual(commits.map(c => c.group.changes.length), [1, 3, 1]);
  assert.ok(commits.every(c => c.group.session === "sess-9" && c.group.action === "merge"));
});

test("undoing the session undoes the whole join", () => {
  const { a, mine, theirs, r } = overlap();
  const commits = [];
  const walk = walkOf(a, r, [[mine.d, theirs.d]], { commits });
  drain(walk);
  assert.equal(a.tree.view().people.size, 6);
  for (const change of [...commits].reverse()) a.tree.adopt(a.tree.undo(change.group));
  const view = a.tree.view();
  assert.equal(view.people.size, 11);
  assert.equal(view.merged.size, 0);
});

test("continue joining skips answered pairs", () => {
  const w = questionWorld();
  w.walk.answer(w.walk.next(), "different");
  const again = walkOf(w.a, w.r, [[w.d, w.bd]], { commits: (w.second = []) });
  // the three shown candidates are blocked by their not-same records; only the one never shown is asked about
  const q = again.next();
  assert.deepEqual(q.candidates.map(c => c.id), [w.y3]);
  assert.equal(w.second.length, 0); // the start pair is already one person: nothing written
  again.answer(q, "different");
  assert.equal(again.next(), null);

  const v = questionWorld();
  v.walk.answer(v.walk.next(), { same: v.y4 });
  const second = [];
  const resumed = walkOf(v.a, v.r, [[v.d, v.bd]], { commits: second });
  assert.equal(resumed.next(), null);
  assert.equal(second.length, 0);

  // "not sure" was never written, so a new join asks again
  const u = questionWorld();
  u.walk.answer(u.walk.next(), "unsure");
  const third = walkOf(u.a, u.r, [[u.d, u.bd]]);
  assert.equal(third.next().x.id, u.x);
});

// ================================================================ Task 3.4

test("automatic() lists every automatic merge", () => {
  const { a, mine, theirs, r } = overlap();
  const walk = walkOf(a, r, [[mine.d, theirs.d]]);
  drain(walk);
  const entries = walk.automatic();
  assert.equal(entries.length, 4);
  const mineIds = new Set(Object.values(mine));
  const theirIds = new Set(Object.values(theirs));
  for (const e of entries) {
    assert.ok(theirIds.has(e.x) && mineIds.has(e.y), JSON.stringify(e));
    assert.ok(["partner", "child"].includes(e.relation));
  }
  assert.deepEqual(entries.map(e => e.x).sort(), [theirs.t, theirs.m, theirs.e, theirs.adam].sort());
});

test("not the same undoes one merge and writes not-same", () => {
  const { a, mine, theirs, r } = overlap();
  const commits = [];
  const walk = walkOf(a, r, [[mine.d, theirs.d]], { commits });
  drain(walk);
  const entry = walk.automatic().find(e => e.x === theirs.e);
  walk.unmerge(entry);
  const view = a.tree.view();
  assert.notEqual(resolveIn(view, theirs.e), resolveIn(view, mine.e));
  assert.ok(areNotSameIn(view, theirs.e, mine.e));
  assert.equal(view.people.size, 7);
  // the other merges stay
  assert.equal(resolveIn(view, theirs.m), resolveIn(view, mine.m));
  assert.equal(resolveIn(view, theirs.t), resolveIn(view, mine.t));
  assert.equal(walk.automatic().length, 3);
  assert.ok(commits.slice(-2).every(c => c.group.session === "sess-1"));
});

/** Danilo in both trees, differing in a few fields. `b` is later, so its values win. */
function differingWorld() {
  const { a, b } = phones();
  const d = a.add({ g: "Данило", s: "Новаков", sx: "M", bd: { y: 1920 }, bp: "Скопје", dd: { y: 1990 }, nt: "Дедо" });
  const bd = b.add({ g: "Danilo", s: "Novakov", sx: "M", bd: { y: 1920 }, bp: "Охрид", dd: { y: 1990, q: "abt" }, nt: "Дедо " });
  const r = bring(a, b);
  const commits = [];
  const walk = walkOf(a, r, [[d, bd]], { commits });
  drain(walk);
  return { a, b, d, bd, r, walk, commits };
}

test("differences() skips names equal by key", () => {
  const w = differingWorld();
  const list = w.walk.differences();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, resolveIn(w.a.tree.view(), w.d));
  // g and s are equal by key, bd equal by structure, nt equal trimmed: only bp and dd differ
  assert.deepEqual(list[0].fields.map(f => f.f), ["bp", "dd"]);
  const bp = list[0].fields[0];
  assert.equal(bp.ours, "Скопје");
  assert.equal(bp.theirs, "Охрид");
  assert.equal(bp.current, "Охрид"); // the later edit shows until someone chooses
});

test("confirming differences writes new edits", () => {
  const w = differingWorld();
  const [diff] = w.walk.differences();
  const before = w.a.tree.records().get(diff.id).f.bp;
  const change = w.walk.applyDifferences([{ id: diff.id, f: "bp", value: "Скопје" }]);
  assert.equal(w.a.tree.view().people.get(diff.id).f.bp, "Скопје");
  const after = w.a.tree.records().get(diff.id).f.bp;
  assert.ok(after[1] > before[1] || (after[1] === before[1] && after[2] > before[2]));
  assert.equal(change.group.action, "edit");
  assert.equal(change.group.session, "sess-1");
  assert.deepEqual(w.walk.differences()[0].fields.map(f => f.f), ["dd"]); // the settled one is not offered again
});

test("duplicatesAround finds two children with the same name and year", () => {
  const w = around();
  const c1 = w.rel("child", { g: "Ема", s: "Новакова", bd: { y: 1951 } });
  const c2 = w.rel("child", { g: "Ema", s: "Novakova", bd: { y: 1951 } });
  w.rel("child", { g: "Миро", s: "Новаков", bd: { y: 1948 } });
  const found = duplicatesAround(w.h.tree, w.m);
  assert.deepEqual(found.map(f => [f.relation, f.a, f.b, f.level]), [["child", ...[c1, c2].sort(), "certain"]]);
});

test("duplicatesAround blocks two partners of one person, and same-name siblings with different years", () => {
  const w = around();
  w.rel("partner", { g: "Теодора", s: "Новакова", bd: { y: 1923 } });
  w.rel("partner", { g: "Теодора", s: "Новакова", bd: { y: 1923 } });
  w.rel("child", { g: "Миро", s: "Новаков", bd: { y: 1950 } });
  w.rel("child", { g: "Миро", s: "Новаков", bd: { y: 1953 } });
  assert.deepEqual(duplicatesAround(w.h.tree, w.m), []);
  // the same two Miros, listed with no years, are only possible
  const v = around();
  v.rel("child", { g: "Миро", s: "Новаков" });
  v.rel("child", { g: "Миро", s: "Новаков" });
  assert.deepEqual(duplicatesAround(v.h.tree, v.m).map(f => f.level), ["possible"]);
});
