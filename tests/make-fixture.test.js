// Task 4.7: scripts/make-fixture.mjs writes an invented backup that validateBackup accepts.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateBackup, restoreBackup } from "../public/src/backup.js";
import { createTree } from "../public/src/tree.js";
import { createClock } from "../public/src/clock.js";

const script = new URL("../scripts/make-fixture.mjs", import.meta.url).pathname;
const run = (...args) => execFileSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("make-fixture writes an invented backup that validateBackup accepts", () => {
  const dir = mkdtempSync(join(tmpdir(), "steblo-fixture-"));
  try {
    const out = join(dir, "a.json");
    const said = run("--people", "400", "--seed", "1", "--out", out);
    assert.match(said, /400 people/);
    const text = readFileSync(out, "utf8");
    const checked = validateBackup(text);
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    const people = [...checked.valid.records.values()].filter(r => r.kind === "person");
    assert.equal(people.length, 400);

    // the same seed gives the same people; another seed gives others
    const again = join(dir, "b.json");
    run("--people", "400", "--seed", "1", "--out", again);
    const strip = t => ({ ...JSON.parse(t), createdAt: 0 });
    assert.deepEqual(strip(readFileSync(again, "utf8")), strip(text));
    const other = join(dir, "c.json");
    run("--people", "400", "--seed", "2", "--out", other);
    assert.notDeepEqual(strip(readFileSync(other, "utf8")).records, strip(text).records);

    // it restores into a tree that shows all 400 people
    const device = "7000000000000001";
    const restored = restoreBackup(checked.valid, { device, now: Date.now() });
    const tree = createTree({ device, name: restored.meta.name, records: restored.records, clock: createClock({ last: restored.meta.last }) });
    assert.ok(tree.view().people.size >= 380, `people showing: ${tree.view().people.size}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("make-fixture refuses bad arguments", () => {
  for (const args of [[], ["--people", "0", "--out", "/tmp/x"], ["--people", "abc", "--out", "/tmp/x"], ["--wrong", "1", "--out", "/tmp/x"], ["--out"]]) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.notEqual(r.status, 0, args.join(" "));
    assert.match(r.stderr, /usage|--out|--people|number/);
  }
});
