import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateTree } from "./fixtures/tree.js";
import { createTree } from "../public/src/tree.js";
import { createClock } from "../public/src/clock.js";
import { kindOf, validateRecord } from "../public/src/records.js";
import { matchKey } from "../public/src/names.js";

const DEVICE = "d000000000000001";
const NOW = 1_800_000_000_000;
const digest = records => createHash("sha256").update(JSON.stringify([...records])).digest("hex");
const ratio = (records, test) => {
  let n = 0;
  let hit = 0;
  for (const [id, record] of records) if (kindOf(id) === "person") { n += 1; if (test(record, id)) hit += 1; }
  return hit / n;
};

test("the generator is stable for a seed", () => {
  const a = generateTree({ people: 300, seed: 7, clocks: "hand", noteShare: 0.1 });
  const b = generateTree({ people: 300, seed: 7, clocks: "hand", noteShare: 0.1 });
  assert.equal(digest(a.records), digest(b.records));
  assert.deepEqual([...a.records.keys()], [...b.records.keys()]);
  assert.deepEqual(a.ids, b.ids);
  // another seed, another tree
  assert.notEqual(digest(generateTree({ people: 300, seed: 8, clocks: "hand", noteShare: 0.1 }).records), digest(a.records));
  // the other options change the tree, too
  assert.notEqual(digest(generateTree({ people: 300, seed: 7, clocks: "import", noteShare: 0.1 }).records), digest(a.records));
  assert.notEqual(digest(generateTree({ people: 300, seed: 7, clocks: "hand", noteShare: 0 }).records), digest(a.records));
  // pinned, so a change to the generator can't slip by unseen: these are what seed 7 gives
  assert.equal(a.ids.length, 300);
  assert.match(a.ids[0], /^[0-9a-f]{16}$/);
  assert.equal(a.ids[0], PINNED.firstId);
  assert.equal(digest(a.records), PINNED.digest);
});
// What the first run of the generator gave for seed 7 (see the note at the top of tests/fixtures/tree.js).
const PINNED = { firstId: "21b6128d4dd71288", digest: "b4b830b3de61e463bf57f87f3a850dc11ab8047aeda45a494e0d5b03a9a54737" };

test("every generated record passes the validator", () => {
  for (const clocks of ["import", "hand"]) {
    const { records } = generateTree({ people: 400, seed: 3, clocks, noteShare: 0.2 });
    for (const [id, record] of records) {
      const { record: cleaned, rejected } = validateRecord(id, record, { now: NOW });
      assert.deepEqual(rejected, [], `${clocks} ${id}`);
      assert.deepEqual(cleaned, record, `${clocks} ${id}`); // already clean: the validator changes nothing
    }
  }
});

test("the generator follows its rules", () => {
  const people = 3000;
  const { records, ids } = generateTree({ people, seed: 11, clocks: "hand", noteShare: 0.05 });
  assert.equal(ids.length, people);
  assert.equal(new Set(ids).size, people);
  const persons = [...records].filter(([id]) => kindOf(id) === "person");
  assert.equal(persons.length, people);

  const parentLinks = [...records.keys()].filter(id => kindOf(id) === "parent");
  const partnerLinks = [...records.keys()].filter(id => kindOf(id) === "partner");
  const position = new Map(ids.map((id, i) => [id, i]));
  const parentsOf = new Map();
  for (const id of parentLinks) {
    const [, parent, child] = id.split(":");
    assert.ok(position.get(parent) < position.get(child), "a parent comes before the child");
    parentsOf.set(child, (parentsOf.get(child) ?? 0) + 1);
  }
  // the first 40 have no parents or partners of their own; a parent link goes to someone earlier
  for (const id of ids.slice(0, 40)) assert.equal(parentsOf.has(id), false);
  const later = ids.slice(40);
  const withParent = later.filter(id => parentsOf.has(id)).length / later.length;
  const withTwo = later.filter(id => parentsOf.get(id) === 2).length / later.length;
  assert.ok(withParent > 0.8 && withParent < 0.9, `with a parent: ${withParent}`);
  assert.ok(withTwo > 0.4 && withTwo < 0.62, `with two parents: ${withTwo}`);
  assert.ok([...parentsOf.values()].every(n => n <= 2));
  assert.ok(partnerLinks.length / later.length > 0.3 && partnerLinks.length / later.length < 0.4, `partners: ${partnerLinks.length / later.length}`);
  assert.ok(partnerLinks.every(id => id.split(":")[1] < id.split(":")[2]));

  // fields
  const within = (share, target, label) => assert.ok(Math.abs(share - target) < 0.04, `${label}: ${share}`);
  within(ratio(records, r => "bd" in r.f), 0.7, "birth date");
  within(ratio(records, r => "bp" in r.f), 0.3, "birth place");
  within(ratio(records, r => "dd" in r.f), 0.4, "death date");
  within(ratio(records, r => "dc" in r.f), 0.2, "deceased");
  within(ratio(records, r => "bs" in r.f), 0.15, "birth surname");
  within(ratio(records, r => "nt" in r.f), 0.05, "note");
  assert.ok(persons.every(([, r]) => "g" in r.f && "s" in r.f && r.f.del[0] === false));
  assert.ok(persons.filter(([, r]) => "nt" in r.f).every(([, r]) => [...r.f.nt[0]].length === 300));
  assert.ok(persons.filter(([, r]) => "dd" in r.f && "bd" in r.f && r.f.bd[0].y).every(([, r]) => (r.f.dd[0].y ?? 9999) >= r.f.bd[0].y));

  // names come from pools of at most 400 given names, 300 surnames and 150 places
  const given = new Set(persons.map(([, r]) => r.f.g[0]));
  const surnames = new Set(persons.flatMap(([, r]) => [r.f.s[0], r.f.bs?.[0]].filter(Boolean)));
  const places = new Set(persons.map(([, r]) => r.f.bp?.[0]).filter(Boolean));
  assert.ok(given.size > 300 && given.size <= 400, `given names: ${given.size}`);
  assert.ok(surnames.size > 250 && surnames.size <= 300, `surnames: ${surnames.size}`);
  assert.ok(places.size > 120 && places.size <= 150, `places: ${places.size}`);
  assert.ok([...surnames].every(s => /(ов|ски|ев)$/.test(s)));
  assert.ok([...given, ...surnames, ...places].every(name => /^[А-Я][а-я]+$/.test(name) && matchKey(name) !== ""));
  // 2 or 3 consonant-vowel syllables for a given name
  assert.ok([...given].every(name => [...name].length === 4 || [...name].length === 6));
});

test("import clocks carry the lowest time, hand clocks one time per person", () => {
  const imported = generateTree({ people: 200, seed: 5, clocks: "import", noteShare: 0.5 }).records;
  for (const record of imported.values()) {
    for (const triple of Object.values(record.f)) assert.deepEqual(triple.slice(1), [0, 0, "0000000000000000"]);
  }

  const { records, ids } = generateTree({ people: 400, seed: 5, clocks: "hand", noteShare: 0.1 });
  const bys = new Set();
  let previous = 0;
  for (const id of ids) {
    const record = records.get(id);
    const stamps = new Set(Object.values(record.f).map(t => t.slice(1).join(".")));
    assert.equal(stamps.size, 1, "one clock for the whole person");
    const [, ms, counter, by] = record.f.del;
    bys.add(by);
    assert.equal(counter, 0);
    const gap = ms - previous;
    if (previous) assert.ok(gap >= 60_000 && gap <= 3_600_000, `gap ${gap}`); // minutes to an hour apart
    previous = ms;
    // their links carry the same clock
    for (const [linkId, link] of records) {
      if (kindOf(linkId) === "parent" && linkId.endsWith(`:${id}`)) assert.deepEqual(link.f.del.slice(1), record.f.del.slice(1));
    }
  }
  assert.equal(bys.size, 5);
  assert.ok([...bys].every(by => /^[0-9a-f]{16}$/.test(by)));
});

test("view of 5,000 people takes under 200 ms", t => {
  const { records } = generateTree({ people: 5000, seed: 1, clocks: "hand", noteShare: 0.03 });
  const tree = createTree({ device: DEVICE, name: "x", records, clock: createClock({ now: () => NOW }), now: () => NOW });
  const started = performance.now();
  const view = tree.view();
  const took = performance.now() - started;
  t.diagnostic(`view of 5,000 people: ${took.toFixed(1)} ms (${view.families.length} families, ${view.attention.separate.length} separate groups)`);
  assert.equal(view.people.size, 5000);
  assert.ok(view.families.length > 1000);
  assert.ok(took < 200, `took ${took.toFixed(1)} ms`);

  // a second view with nothing adopted in between is the cached one
  const again = performance.now();
  assert.equal(tree.view(), view);
  assert.ok(performance.now() - again < 5);

  // an edit on a big tree: the operation and the view after it
  const someone = [...view.people.keys()][2500];
  const edit = tree.edit(someone, { g: "Ема" });
  tree.adopt(edit);
  const afterEdit = performance.now();
  tree.view();
  assert.ok(performance.now() - afterEdit < 200);
});
