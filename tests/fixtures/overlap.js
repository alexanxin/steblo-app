// The join's budget fixture (task 3.5, reference R9 Budget fixture): two invented trees of 400 and 350
// people that share 300. Every name comes from the invented set (Danilo, Teodora, Miro, Ema, Adam, Lea,
// Gjeko; surnames Novakov, Čarin, Gjeko), each in Cyrillic or Latin spelling.
//
// Shapes follow the cases in uds2gedcom's merge tests, with invented people:
//   - repeated names across branches (7 given names for 450 people),
//   - brothers and sisters never share a given name inside one tree,
//   - 20% of birth dates are "about" (not exact), drawn separately for each tree,
//   - 30 shared people have a close-but-not-same given name on the B side (one letter doubled),
//   - 4 remarriages: a shared man has his shared first wife and a second wife of the same given name who is
//     only in A; the first marriage has no date in B and her birth dates are "about" in both trees.
// Everything comes from a seeded generator: the same seed gives the same trees.
//
//   buildOverlap({ seed }) → { a, b, truth, startPair, counts }
//   a, b: { device, records: Map }       truth: Map<recordId, number>, the same number for the same human
import { pid, T0 } from "./helpers.js";
import { linkId } from "../../public/src/records.js";

const GIVEN = {
  M: [["Danilo", "Данило"], ["Miro", "Миро"], ["Adam", "Адам"], ["Gjeko", "Ѓеко"]],
  F: [["Teodora", "Теодора"], ["Ema", "Ема"], ["Lea", "Леа"]],
};
// male Latin, female Latin, male Cyrillic, female Cyrillic
const SURNAMES = [["Novakov", "Novakova", "Новаков", "Новакова"], ["Čarin", "Čarin", "Чарин", "Чарин"], ["Gjeko", "Gjeko", "Ѓеко", "Ѓеко"]];
const CLOSE = { Danilo: "Daniloo", Miro: "Miroo", Adam: "Adaam", Gjeko: "Gjekoo", Teodora: "Teodoora" }; // Ema and Lea are too short to be close
const DEVICE = { a: pid("d", 1), b: pid("d", 2) };

function generator(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildOverlap({ seed = 11 } = {}) {
  const rand = generator(seed);
  const int = n => Math.floor(rand() * n);
  const chance = p => rand() < p;

  const SHARED = 300;
  const A_ONLY = 100;
  const B_ONLY = 50;
  const REMARRIAGES = 4;
  const CLOSE_NAMES = 30;

  const people = []; // { sx, gi (given index), si (surname index), female (bool of the surname form), by, bs, father, mother, in: "ab"|"a"|"b" }
  const couples = []; // { h, w, md, ring?: true }
  let aOnly = 0;
  let bOnly = 0;
  let shared = 0;
  const aQuota = A_ONLY - REMARRIAGES;

  const add = person => {
    people.push(person);
    if (person.in === "ab") shared += 1; else if (person.in === "a") aOnly += 1; else bOnly += 1;
    return people.length - 1;
  };
  /** Which tree(s) a new person goes into, given the trees both of their closest relatives are in. */
  const place = allowed => {
    if (shared < SHARED) return allowed === "ab" ? "ab" : allowed; // the shared phase fills the shared set first
    const choices = [];
    if (allowed.includes("a") && aOnly < aQuota) choices.push("a");
    if (allowed.includes("b") && bOnly < B_ONLY) choices.push("b");
    if (choices.length === 0) return null;
    return choices.length === 2 ? (chance(0.67) ? "a" : "b") : choices[0];
  };
  const full = () => shared >= SHARED && aOnly >= aQuota && bOnly >= B_ONLY;
  const meet = (x, y) => (people[x].in === "ab" ? people[y].in : people[y].in === "ab" ? people[x].in : people[x].in === people[y].in ? people[x].in : "");

  // ---- the founders: one couple born in the 1840s, so that the shared people are one connected tree
  const queue = [];
  const marry = (hIndex, wIndex, md) => { const c = { h: hIndex, w: wIndex, md }; couples.push(c); queue.push(c); return c; };
  for (let i = 0; i < 1; i++) {
    const si = i % 3;
    const h = add({ sx: "M", gi: int(4), si, by: 1840 + int(10), in: "ab" });
    const w = add({ sx: "F", gi: int(3), si, female: true, bs: (si + 1 + int(2)) % 3, by: 1842 + int(10), in: "ab" });
    marry(h, w, Math.max(people[h].by, people[w].by) + 18 + int(6));
  }
  people[0].gi = 0; // the start person is always Danilo

  // ---- everyone else, couple by couple, oldest first
  while (!full()) {
    const couple = queue.shift();
    if (!couple) throw new Error("the fixture ran out of couples before the quotas were met");
    const { h, w } = couple;
    const allowed = meet(h, w);
    const used = new Set();
    const kids = 2 + int(3);
    for (let k = 0; k < kids && !full(); k++) {
      const sx = chance(0.5) ? "M" : "F";
      const free = GIVEN[sx].map((_, i) => i).filter(i => !used.has(`${sx}${i}`));
      if (!free.length) continue;
      const gi = free[int(free.length)];
      const by = people[w].by + 21 + int(16) + k * 2;
      if (by > 2012) continue;
      const where = place(allowed);
      if (!where) continue;
      used.add(`${sx}${gi}`);
      const child = add({ sx, gi, si: people[h].si, female: sx === "F", by, father: h, mother: w, in: where });
      if (by < 1992 && chance(0.85) && !full()) {
        const spouseWhere = place(where);
        if (!spouseWhere) continue;
        const spouse = add({
          sx: sx === "M" ? "F" : "M", gi: int(sx === "M" ? 3 : 4), si: int(3), by: by - 3 + int(7), in: spouseWhere,
        });
        // a wife takes her husband's surname and keeps her own as the birth surname
        const [man, woman] = sx === "M" ? [child, spouse] : [spouse, child];
        people[woman].bs = people[woman].bs ?? people[woman].si;
        if (sx === "M") people[spouse].female = true;
        people[woman].si = people[man].si;
        people[woman].female = true;
        marry(man, woman, Math.max(people[man].by, people[woman].by) + 18 + int(6));
      }
    }
  }

  // ---- remarriages: a shared man, his shared wife, and a second wife only in A with the same given name
  const trapped = [];
  const candidates = couples.filter((c, i) => i > 30 && people[c.h].in === "ab" && people[c.w].in === "ab" && people[c.w].gi !== undefined);
  for (const couple of candidates) {
    if (trapped.length === REMARRIAGES) break;
    if (trapped.some(t => t.h === couple.h)) continue;
    const second = add({
      sx: "F", gi: people[couple.w].gi, si: people[couple.h].si, female: true,
      bs: (people[couple.h].si + 1) % 3, by: people[couple.w].by + 1 + int(4), in: "a",
    });
    const c2 = { h: couple.h, w: second, md: couple.md + 9 };
    couples.push(c2);
    trapped.push({ h: couple.h, w1: couple.w, w2: second, couple });
  }
  if (trapped.length !== REMARRIAGES) throw new Error("not enough couples for the remarriages");
  const inexact = new Set(trapped.flatMap(t => [t.w1, t.w2]));
  const undated = new Set(trapped.map(t => t.couple)); // the first marriage has no date in B

  // ---- close names on the B side
  const eligible = people.map((p, i) => i).filter(i => people[i].in === "ab" && people[i].sx !== undefined && CLOSE[GIVEN[people[i].sx][people[i].gi][0]]);
  for (let i = eligible.length - 1; i > 0; i--) { const j = int(i + 1); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
  const closeNames = new Set(eligible.slice(0, CLOSE_NAMES));
  if (closeNames.size !== CLOSE_NAMES) throw new Error("not enough people with a name that can have a close spelling");

  // ---- the two trees
  const out = {};
  const truth = new Map();
  const counts = { a: 0, b: 0, shared: 0, closeNames: closeNames.size, remarriages: trapped.length };
  for (const side of ["a", "b"]) {
    const device = DEVICE[side];
    const records = new Map();
    const ids = new Map();
    let counter = 0;
    const ms = side === "a" ? T0 : T0 + 5000;
    const triple = value => [value, ms, ++counter, device];
    const put = (id, kind, fields) => {
      const f = {};
      for (const [key, value] of Object.entries(fields)) if (value !== undefined) f[key] = triple(value);
      records.set(id, { kind, f });
    };
    let n = 0;
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (!p.in.includes(side)) continue;
      const id = pid(side, ++n);
      ids.set(i, id);
      truth.set(id, i);
      const cyrillic = chance(0.5);
      let given = GIVEN[p.sx][p.gi][cyrillic ? 1 : 0];
      if (side === "b" && closeNames.has(i)) given = CLOSE[GIVEN[p.sx][p.gi][0]];
      const surname = (si, female) => SURNAMES[si][(cyrillic ? 2 : 0) + (female ? 1 : 0)];
      const approx = inexact.has(i) || chance(0.2);
      put(id, "person", {
        g: given,
        s: surname(p.si, p.female),
        bs: p.bs === undefined ? undefined : surname(p.bs, true),
        sx: p.sx,
        bd: approx ? { y: p.by, q: "abt" } : { y: p.by },
        del: false,
      });
    }
    for (const [i, id] of ids) {
      const p = people[i];
      if (p.father !== undefined && ids.has(p.father) && ids.has(p.mother)) {
        put(linkId("parent", ids.get(p.father), id), "parent", { del: false });
        put(linkId("parent", ids.get(p.mother), id), "parent", { del: false });
      }
    }
    for (const c of couples) {
      if (!ids.has(c.h) || !ids.has(c.w)) continue;
      const noDate = side === "b" && undated.has(c);
      put(linkId("partner", ids.get(c.h), ids.get(c.w)), "partner", { md: noDate ? undefined : { y: c.md }, del: false });
    }
    out[side] = { device, records, ids };
    counts[side] = ids.size;
  }
  counts.shared = people.filter(p => p.in === "ab").length;

  return { a: out.a, b: out.b, truth, startPair: [out.a.ids.get(0), out.b.ids.get(0)], counts };
}
