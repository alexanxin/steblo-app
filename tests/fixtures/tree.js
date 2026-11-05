// An invented family tree for tests and for phones (task 1.10, design §10).
// Every name is two or three random consonant-vowel syllables, so no real person is in it.
// Everything comes from a seeded linear congruential generator: the same options always
// give the same records, on any machine. If you change the order of the draws below,
// tests/numbers.test.js (the pinned digest) will tell you; update the pin on purpose.
//
//   generateTree({ people, seed, clocks, noteShare }) → { records, ids, devices }
//
//   clocks: "import" gives every value the import time (0, 0) and the setter 0000000000000000.
//           "hand" gives each person, and the links that go with them, one new time, from 5 devices,
//           a minute to an hour after the person before.
//   noteShare: the share of people with a 300-character note.

const CONSONANTS = [..."бвгдзклмнпрстф"];
const VOWELS = [..."аеиоу"];
const ENDINGS = ["ов", "ски", "ев"];
const HAND_START = 1_600_000_000_000;
const IMPORT_STAMP = [0, 0, "0000000000000000"];

export function generateTree({ people = 1000, seed = 1, clocks = "import", noteShare = 0 } = {}) {
  if (clocks !== "import" && clocks !== "hand") throw new Error(`clocks must be "import" or "hand", not ${clocks}`);

  // ---- seeded random numbers (32-bit linear congruential generator)
  let state = (Math.imul((seed >>> 0) || 1, 2654435761) ^ 0x9e3779b9) >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  const rand = () => next() / 4294967296;
  const int = n => Math.floor(rand() * n);
  const chance = p => rand() < p;
  const pick = list => list[int(list.length)];
  const hex8 = () => next().toString(16).padStart(8, "0");

  // ---- names: pools of 400 given names, 300 surnames and 150 places
  const syllables = count => {
    let out = "";
    for (let i = 0; i < count; i++) out += pick(CONSONANTS) + pick(VOWELS);
    return out;
  };
  const capital = s => s[0].toUpperCase() + s.slice(1);
  const pool = (size, make) => {
    const names = new Set();
    while (names.size < size) names.add(make());
    return [...names];
  };
  const givenNames = pool(400, () => capital(syllables(2 + int(2))));
  const surnames = pool(300, () => capital(syllables(1 + int(2)) + pick(ENDINGS)));
  const places = pool(150, () => capital(syllables(2 + int(2))));

  const devices = Array.from({ length: 5 }, () => hex8() + hex8());
  const note = () => {
    let text = "";
    while (text.length < 300) text += syllables(2 + int(3)) + " ";
    return text.slice(0, 300);
  };
  const date = (from, to) => {
    const y = from + int(to - from + 1);
    const kind = rand();
    if (kind < 0.5) return { y };
    const m = 1 + int(12);
    return kind < 0.8 ? { y, m } : { y, m, d: 1 + int(28) };
  };

  // ---- people and links
  const records = new Map();
  const ids = [];
  const taken = new Set();
  let handTime = HAND_START;
  for (let i = 0; i < people; i++) {
    let id;
    do id = hex8() + hex8(); while (taken.has(id));
    taken.add(id);

    let stamp = IMPORT_STAMP;
    if (clocks === "hand") {
      handTime += (1 + int(60)) * 60_000;
      stamp = [handTime, 0, pick(devices)];
    }
    const triple = value => [value, stamp[0], stamp[1], stamp[2]];

    const f = { g: triple(pick(givenNames)), s: triple(pick(surnames)) };
    let birthYear = null;
    if (chance(0.7)) { const born = date(1850, 1999); birthYear = born.y; f.bd = triple(born); }
    if (chance(0.3)) f.bp = triple(pick(places));
    if (chance(0.4)) {
      const from = birthYear === null ? 1900 : birthYear + 20;
      f.dd = triple(date(from, Math.max(from, birthYear === null ? 2020 : Math.min(birthYear + 90, 2020))));
    }
    if (chance(0.2)) f.dc = triple(true);
    if (chance(0.15)) f.bs = triple(pick(surnames));
    if (noteShare > 0 && chance(noteShare)) f.nt = triple(note());
    f.del = triple(false);
    records.set(id, { kind: "person", f });

    if (i >= 40) {
      if (chance(0.85)) {
        const first = ids[int(i)];
        records.set(`p:${first}:${id}`, { kind: "parent", f: { del: triple(false) } });
        if (chance(0.6)) {
          let second = ids[int(i)];
          for (let tries = 0; second === first && tries < 10; tries++) second = ids[int(i)];
          if (second !== first) records.set(`p:${second}:${id}`, { kind: "parent", f: { del: triple(false) } });
        }
      }
      if (chance(0.35)) {
        const partner = ids[int(i)];
        const [low, high] = partner < id ? [partner, id] : [id, partner];
        if (!records.has(`u:${low}:${high}`)) records.set(`u:${low}:${high}`, { kind: "partner", f: { del: triple(false) } });
      }
    }
    ids.push(id);
  }
  return { records, ids, devices };
}
