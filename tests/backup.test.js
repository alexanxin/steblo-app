// Task 4.5: backup file, validation in full, restore with a new device ID (reference R13). All people are invented.
import test from "node:test";
import assert from "node:assert/strict";
import { writeBackup, validateBackup, restoreBackup, MAX_BACKUP_BYTES } from "../public/src/backup.js";
import { simulate, plainRecords } from "./fixtures/simulate.js";
import { pid, T0 } from "./fixtures/helpers.js";
import { isErased } from "../public/src/records.js";

const NEW_DEVICE = pid("e", 77);

/** A phone with real history: people, merges, an erase and a sync, from the simulator. */
async function busyPhone() {
  const { phones } = await simulate({ seed: 31, devices: 2, rounds: 120 });
  const phone = phones[0];
  const ids = [...phone.tree.view().people.keys()];
  const meta = {
    device: phone.device, name: "Телефон на Ема", last: [T0 + 5000, 3],
    thisIsMe: ids[0], settings: { lang: "mk", latin: true }, lastBackup: null,
  };
  return { phone, meta, createdAt: T0 + 86_400_000 };
}
const parse = text => JSON.parse(text);
const NOW = T0 + 10 * 86_400_000;
const firstIdOf = (backup, prefix) => backup.records.find(([id]) => id.startsWith(prefix));

test("backup round trips records, meta and history", async () => {
  const { phone, meta, createdAt } = await busyPhone();
  assert.ok(phone.history.length > 5, "the simulated phone has history");
  assert.ok([...phone.tree.records().values()].some(isErased), "and an erased person");
  assert.ok(phone.history.some(g => g.lost.length || g.changes.some(c => c.erased)), "and merged or scrubbed entries");

  const text = writeBackup({ records: phone.tree.records(), meta, history: phone.history, createdAt });
  assert.equal(typeof text, "string");
  const file = parse(text);
  assert.equal(file.format, "steblo-backup");
  assert.equal(file.version, 1);
  assert.equal(file.createdAt, createdAt);
  assert.deepEqual(file.meta, { name: "Телефон на Ема", thisIsMe: meta.thisIsMe, settings: { lang: "mk", latin: true } });
  assert.equal(file.records.length, phone.tree.records().size);
  for (const entry of file.records) assert.equal(entry.length, 3);
  // the same inputs give the same bytes
  assert.equal(writeBackup({ records: phone.tree.records(), meta, history: phone.history, createdAt }), text);

  const checked = validateBackup(text, { now: NOW });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.valid.records.size, phone.tree.records().size);

  const restored = restoreBackup(checked.valid, { device: NEW_DEVICE, name: "Телефон на Ема", now: NOW });
  // every record is back, byte for byte; the one extra record is the new device
  const back = new Map(restored.records);
  back.delete(`d:${NEW_DEVICE}`);
  assert.equal(plainRecords(back), plainRecords(phone.tree.records()));
  assert.deepEqual(restored.history, phone.history);
  assert.equal(restored.meta.name, "Телефон на Ема");
  assert.equal(restored.meta.thisIsMe, meta.thisIsMe);
  assert.deepEqual(restored.meta.settings, { lang: "mk", latin: true });
  assert.equal(restored.meta.lastBackup, createdAt);
});

test("restore gets a new device ID and writes a new device record", async () => {
  const { phone, meta, createdAt } = await busyPhone();
  const text = writeBackup({ records: phone.tree.records(), meta, history: phone.history, createdAt });
  const { valid } = validateBackup(text, { now: NOW });
  const stored = valid.records;
  let latest = [0, 0];
  for (const record of stored.values()) for (const t of Object.values(record.f)) if (t[1] > latest[0] || (t[1] === latest[0] && t[2] > latest[1])) latest = [t[1], t[2]];

  // the user's current name wins
  const r = restoreBackup(valid, { device: NEW_DEVICE, name: "Нов телефон", now: T0 });
  assert.equal(r.meta.device, NEW_DEVICE);
  assert.notEqual(r.meta.device, meta.device);
  const own = r.records.get(`d:${NEW_DEVICE}`);
  assert.equal(own.kind, "device");
  assert.deepEqual(Object.keys(own.f), ["nm"]);
  assert.equal(own.f.nm[0], "Нов телефон");
  assert.equal(own.f.nm[3], NEW_DEVICE);
  // its time is later than everything stored, even though this phone's clock (now = T0) is behind
  assert.ok(own.f.nm[1] > latest[0] || (own.f.nm[1] === latest[0] && own.f.nm[2] > latest[1]));
  assert.deepEqual(r.meta.last, [own.f.nm[1], own.f.nm[2]]);
  assert.equal(r.meta.name, "Нов телефон");
  // the old phone's device record is still there, as one more device that existed
  if (stored.has(`d:${meta.device}`)) assert.deepEqual(r.records.get(`d:${meta.device}`), stored.get(`d:${meta.device}`));
  assert.equal(r.records.size, stored.size + 1 - (stored.has(`d:${NEW_DEVICE}`) ? 1 : 0));
  // the stored records are not changed
  assert.equal(valid.records.has(`d:${NEW_DEVICE}`), false);

  // no name set on this phone: the backup's name
  assert.equal(restoreBackup(valid, { device: NEW_DEVICE, name: "", now: NOW }).records.get(`d:${NEW_DEVICE}`).f.nm[0], "Телефон на Ема");
  assert.equal(restoreBackup(valid, { device: NEW_DEVICE, now: NOW }).meta.name, "Телефон на Ема");
  // a clock ahead of the file starts from now
  const ahead = restoreBackup(valid, { device: NEW_DEVICE, name: "Х", now: latest[0] + 5000 });
  assert.deepEqual([ahead.records.get(`d:${NEW_DEVICE}`).f.nm[1], ahead.records.get(`d:${NEW_DEVICE}`).f.nm[2]], [latest[0] + 5000, 0]);

  // an invalid device ID is refused
  assert.throws(() => restoreBackup(valid, { device: "nope", name: "x" }), e => e.code === "setup");
});

test("restore keeps an erased person erased and holds no details of them", () => {
  const dev = pid("d", 1);
  const erasedId = pid("a", 1);
  const records = new Map([
    [erasedId, { kind: "person", f: { er: [true, T0, 1, dev], g: ["Ема", T0 - 1, 0, dev] } }],
    [pid("a", 2), { kind: "person", f: { g: ["Миро", T0, 0, dev], del: [false, T0, 0, dev] } }],
  ]);
  const meta = { device: dev, name: "", last: [T0, 1], thisIsMe: null, settings: { lang: "en", latin: false }, lastBackup: null };
  const text = writeBackup({ records, meta, history: [], createdAt: T0 });
  const checked = validateBackup(text, { now: NOW });
  assert.equal(checked.ok, true);
  assert.deepEqual(Object.keys(checked.valid.records.get(erasedId).f), ["er"]);
  assert.equal(restoreBackup(checked.valid, { device: NEW_DEVICE, now: NOW }).records.has(`d:${NEW_DEVICE}`), false); // no name anywhere
});

/** A good backup text, then one thing broken at a time. */
function goodFile() {
  const dev = pid("d", 1);
  const records = new Map([
    [pid("a", 1), { kind: "person", f: { g: ["Ема", T0, 0, dev], s: ["Новакова", T0, 0, dev], bd: [{ y: 1969 }, T0, 0, dev], del: [false, T0, 0, dev] } }],
    [pid("a", 2), { kind: "person", f: { g: ["Миро", T0, 1, dev], del: [false, T0, 1, dev] } }],
    [`p:${pid("a", 1)}:${pid("a", 2)}`, { kind: "parent", f: { del: [false, T0, 2, dev] } }],
    [`d:${dev}`, { kind: "device", f: { nm: ["Телефон", T0, 3, dev] } }],
  ]);
  const history = [{
    id: pid("b", 1), at: T0, action: "edit", device: dev, people: [pid("a", 1)],
    changes: [{ r: pid("a", 1), f: "g", before: ["Ема", T0 - 5, 0, dev], after: ["Ема", T0, 0, dev] }, { r: pid("a", 2), created: true }],
    lost: [],
  }];
  const meta = { device: dev, name: "Телефон", last: [T0, 3], thisIsMe: pid("a", 1), settings: { lang: "en", latin: false }, lastBackup: null };
  return parse(writeBackup({ records, meta, history, createdAt: T0 }));
}
const refused = (file, now = NOW) => validateBackup(typeof file === "string" ? file : JSON.stringify(file), { now });

test("an invalid item refuses the whole file, with a report", () => {
  assert.equal(refused(goodFile()).ok, true);
  const bad = {
    "not JSON": "{ nope",
    "not an object": "[1,2]",
    "wrong format": f => { f.format = "other"; },
    "wrong version": f => { f.version = 2; },
    "no createdAt": f => { delete f.createdAt; },
    "records not a list": f => { f.records = {}; },
    "record that is not a triple": f => { f.records.push(["x"]); },
    "bad record ID": f => { f.records[0][0] = "not-an-id"; },
    "kind that doesn't fit the ID": f => { f.records[0][1] = "parent"; },
    "duplicate record": f => { f.records.push(f.records[0]); },
    "bad field value": f => { f.records[0][2].g[0] = 42; },
    "unknown sex": f => { f.records[0][2].sx = ["Z", 1, 0, pid("d", 1)]; },
    "bad date": f => { f.records[0][2].bd[0] = { y: 1969, m: 2, d: 30 }; },
    "triple time a week ahead": f => { f.records[0][2].g[1] = NOW + 7 * 86_400_000; },
    "counter over 65535": f => { f.records[0][2].g[2] = 65536; },
    "bad setter": f => { f.records[0][2].g[3] = "xyz"; },
    "erase mark that is not true": f => { f.records[0][2].er = [false, T0, 0, pid("d", 1)]; },
    "a field of another kind": f => { f.records[2][2].g = ["x", T0, 0, pid("d", 1)]; },
    "meta missing": f => { delete f.meta; },
    "name too long": f => { f.meta.name = "x".repeat(61); },
    "thisIsMe not an ID": f => { f.meta.thisIsMe = "me"; },
    "settings.latin not a boolean": f => { f.meta.settings.latin = "yes"; },
    "settings.lang not a language": f => { f.meta.settings.lang = "<script>"; },
    "history not a list": f => { f.history = "x"; },
    "history entry with a bad action": f => { f.history[0].action = "explode"; },
    "history entry with a bad device": f => { f.history[0].device = "d"; },
    "history entry with an unknown key": f => { f.history[0].extra = 1; },
    "history change with a bad record ID": f => { f.history[0].changes[0].r = "zz"; },
    "history change with a bad value": f => { f.history[0].changes[0].after[0] = { y: 99999 }; },
    "history change with a bad triple": f => { f.history[0].changes[0].before = ["x"]; },
    "history people not IDs": f => { f.history[0].people = ["a"]; },
  };
  for (const [name, change] of Object.entries(bad)) {
    let result;
    if (typeof change === "string") result = refused(change);
    else {
      const file = goodFile();
      change(file);
      result = refused(file);
    }
    assert.equal(result.ok, false, name);
    assert.equal(result.valid, undefined, name);
    assert.ok(result.errors.length >= 1, name);
    for (const e of result.errors) assert.ok(typeof e.where === "string" && typeof e.reason === "string", name);
  }

  // one bad item among many good ones refuses all of it, and the report says which
  const file = goodFile();
  for (let n = 0; n < 200; n++) file.records.push([pid("c", n + 1), "person", { g: ["Адам", T0, 0, pid("d", 1)] }]);
  file.records[150][2].g[0] = "";
  const result = refused(file);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].where, /records\[150\]/);
  assert.match(result.errors[0].where, new RegExp(file.records[150][0]));

  // the report is capped but counts everything
  const many = goodFile();
  for (let n = 0; n < 500; n++) many.records.push([pid("c", n + 1), "person", { g: [7, T0, 0, pid("d", 1)] }]);
  const capped = refused(many);
  assert.equal(capped.ok, false);
  assert.ok(capped.errors.length <= 50);
  assert.equal(capped.errorCount, 500);
});

test("files over 50 MB are refused", () => {
  assert.equal(MAX_BACKUP_BYTES, 50 * 1024 * 1024);
  const big = "x".repeat(MAX_BACKUP_BYTES + 1);
  const result = validateBackup(big, { now: NOW });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [{ where: "file", reason: "size" }]);
  // bytes count, not characters: 17 million Cyrillic letters are 34 MB, 26 million are 52 MB
  const cyrillic = "ж".repeat(26 * 1024 * 1024);
  assert.equal(validateBackup(cyrillic, { now: NOW }).errors[0].reason, "size");
  const justUnder = validateBackup('{"format":"steblo-backup"}' + " ".repeat(1024), { now: NOW });
  assert.notEqual(justUnder.errors[0]?.reason, "size");
});
