#!/usr/bin/env node
// Write an invented backup file to load onto a phone with "Restore a backup" (task 4.7).
//   node scripts/make-fixture.mjs --people 3420 --seed 1 --out /tmp/steblo-fixture.json
// The people come from the seeded generator in tests/fixtures/tree.js: random syllables, no real names.
// This script reads no other file. The file is checked with validateBackup before it is written.
import { writeFileSync } from "node:fs";
import { generateTree } from "../tests/fixtures/tree.js";
import { validateBackup, writeBackup } from "../public/src/backup.js";

function args(list) {
  const options = { people: 3420, seed: 1, out: null, notes: 0.03 };
  for (let i = 0; i < list.length; i += 2) {
    const key = list[i];
    const value = list[i + 1];
    if (!["--people", "--seed", "--out", "--notes"].includes(key) || value === undefined) {
      throw new Error(`usage: make-fixture.mjs --people N --seed N --out FILE [--notes SHARE]  (got ${key ?? ""})`);
    }
    if (key === "--out") options.out = value;
    else if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`${key} needs a number`);
    else options[key.slice(2)] = Number(value);
  }
  if (!options.out) throw new Error("--out FILE is required");
  if (!Number.isInteger(options.people) || options.people < 1) throw new Error("--people must be a whole number of 1 or more");
  return options;
}

try {
  const options = args(process.argv.slice(2));
  const { records, devices } = generateTree({ people: options.people, seed: options.seed, clocks: "hand", noteShare: options.notes });
  const device = devices[0];
  if (!records.has(`d:${device}`)) {
    // one device record, so the phone shows a device name after the restore
    const first = [...records.values()].flatMap(r => Object.values(r.f)).reduce((a, t) => (t[1] > a ? t[1] : a), 0);
    records.set(`d:${device}`, { kind: "device", f: { nm: [`Fixture ${options.seed}`, first, 0, device] } });
  }
  const text = writeBackup({
    records,
    meta: { name: `Fixture ${options.seed}`, thisIsMe: null, settings: { lang: "en", latin: false } },
    history: [],
    createdAt: Date.now(),
  });
  const checked = validateBackup(text);
  if (!checked.ok) {
    console.error("The fixture did not validate:", JSON.stringify(checked.errors.slice(0, 5)));
    process.exit(1);
  }
  writeFileSync(options.out, text);
  const people = [...records.values()].filter(r => r.kind === "person").length;
  console.log(`wrote ${options.out}: ${people} people, ${records.size} records, ${(text.length / 1024 / 1024).toFixed(2)} MB`);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
