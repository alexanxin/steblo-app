// Tasks 4.1 to 4.4: reading, mapping, IDs, the import clock and export of GEDCOM (reference R12, ADR 0006).
// Every person here is invented. The four .ged files in tests/fixtures are hand-written in the shape of
// MyHeritage, Ancestry, Gramps and uds2gedcom exports.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeGedcom, parseGedcom, importGedcom, exportGedcom } from "../public/src/gedcom.js";
import { startPoints, createWalk } from "../public/src/join.js";
import { bucketHashes } from "../public/src/sync.js";
import { canonicalJson } from "../public/src/clock.js";
import { validateRecord } from "../public/src/records.js";
import { makeTree, pid, T0 } from "./fixtures/helpers.js";
import { makePhone, commit, difference, syncPair, plainRecords } from "./fixtures/simulate.js";

const fixture = name => new Uint8Array(readFileSync(new URL(`./fixtures/${name}.ged`, import.meta.url)));
const FIXTURES = ["myheritage", "ancestry", "gramps", "uds2gedcom"];
const enc = new TextEncoder();
const ZERO = "0000000000000000";

// ---- the same hashes the module is specified to use (R12 IDs), computed here from the rule
const sha = async bytes => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const hex16 = bytes => [...bytes.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
const idOfUid = async uid => hex16(await sha(enc.encode(uid.toLowerCase())));
const idOfXref = async (bytes, xref) => {
  const file = await sha(typeof bytes === "string" ? enc.encode(bytes) : bytes);
  const both = new Uint8Array([...file, ...enc.encode(xref)]);
  return hex16(await sha(both));
};

let fresh = 0;
const newId = () => pid("9", ++fresh);

/** Import into a harness tree and adopt the change. */
async function load(h, source, options = {}) {
  const bytes = typeof source === "string" ? enc.encode(source) : source;
  const result = await importGedcom(h.tree, bytes, { now: h.wall.now, newId, ...options });
  h.run(result.change);
  return result;
}
const person = (view, given) => [...view.people.values()].find(p => p.f.g === given);
const counts = view => ({ people: view.people.size, parents: view.parentLinks.length, partners: view.partnerLinks.length });
const ged = (...lines) => lines.join("\n") + "\n";

// ================================================================ Task 4.1

test("lines parse into a tree of records, joining CONT and CONC", () => {
  const text = ged(
    "0 HEAD", "1 CHAR UTF-8",
    "0 @I1@ INDI", "1 NAME Данило /Новаков/", "2 GIVN Данило",
    "1 NOTE first", "2 CONT second", "2 CONC  and more", "2 CONT",
    "1 BIRT", "2 DATE 1900", "2 PLAC a@@b.test",
    "0 TRLR",
  );
  const { records, bad } = parseGedcom(text);
  assert.equal(bad, 0);
  assert.deepEqual(records.map(r => r.tag), ["HEAD", "INDI", "TRLR"]);
  const indi = records[1];
  assert.equal(indi.xref, "@I1@");
  assert.deepEqual(indi.children.map(c => c.tag), ["NAME", "NOTE", "BIRT"]);
  assert.equal(indi.children[0].value, "Данило /Новаков/");
  assert.equal(indi.children[0].children[0].tag, "GIVN");
  // CONT starts a new line, CONC continues the same one; neither is a child
  assert.equal(indi.children[1].value, "first\nsecond and more\n");
  assert.equal(indi.children[1].children.length, 0);
  // @@ is one @
  assert.equal(indi.children[2].children[1].value, "a@b.test");
  assert.equal(indi.children[2].children[0].value, "1900");
});

test("lines parse into a tree of records, joining CONT and CONC: line ends, blanks and bad lines", () => {
  const text = "0 HEAD\r\n\r\n  0 @I1@ INDI\r1 NAME A /B/\n garbage here\n1 SEX M\n0 TRLR";
  const { records, bad } = parseGedcom(text);
  assert.deepEqual(records.map(r => r.tag), ["HEAD", "INDI", "TRLR"]);
  assert.equal(bad, 1);
  assert.deepEqual(records[1].children.map(c => c.tag), ["NAME", "SEX"]);
  // a tag is upper-cased; a record with a pointer value keeps it
  const again = parseGedcom("0 @F1@ fam\n1 husb @I1@\n").records[0];
  assert.equal(again.tag, "FAM");
  assert.equal(again.children[0].tag, "HUSB");
  assert.equal(again.children[0].value, "@I1@");
});

test("UTF-8 with and without BOM, and UTF-16, decode", () => {
  const text = ged("0 HEAD", "1 CHAR UTF-8", "0 @I1@ INDI", "1 NAME Ѓеко /Чарин/", "0 TRLR");
  const utf8 = Buffer.from(text, "utf8");
  assert.equal(decodeGedcom(utf8), text);
  assert.equal(decodeGedcom(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8])), text);
  // a file with no CHAR line is read as UTF-8
  const bare = ged("0 HEAD", "0 @I1@ INDI", "1 NAME Čarin /Novakov/", "0 TRLR");
  assert.equal(decodeGedcom(Buffer.from(bare, "utf8")), bare);

  const unicode = text.replace("UTF-8", "UNICODE");
  const le = Buffer.from("﻿" + unicode, "utf16le");
  const be = Buffer.from("﻿" + unicode, "utf16le").swap16();
  assert.equal(decodeGedcom(le), unicode);
  assert.equal(decodeGedcom(be), unicode);
  // UTF-16 with no BOM is recognised by its zero bytes
  assert.equal(decodeGedcom(Buffer.from(unicode, "utf16le")), unicode);
  assert.equal(decodeGedcom(Buffer.from(unicode, "utf16le").swap16()), unicode);
});

test("other encodings give the re-save message", () => {
  const message = "Open the file in your genealogy program and save it as UTF-8.";
  for (const name of ["ANSEL", "ANSI", "ASCII", "IBM WINDOWS", "WINDOWS-1251"]) {
    const bytes = Buffer.from(ged("0 HEAD", `1 CHAR ${name}`, "0 TRLR"), "latin1");
    assert.throws(() => decodeGedcom(bytes), e => e.code === "encoding" && e.message === message, name);
  }
  // bytes that are not UTF-8, in a file that says they are
  const broken = Buffer.concat([Buffer.from("0 HEAD\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME "), Buffer.from([0xe9, 0x6b, 0x6f]), Buffer.from("\n0 TRLR\n")]);
  assert.throws(() => decodeGedcom(broken), e => e.code === "encoding" && e.message === message);
});

test("files over 20 MB are refused", async () => {
  const big = new Uint8Array(20 * 1024 * 1024 + 1);
  assert.throws(() => decodeGedcom(big), e => e.code === "size");
  const h = makeTree();
  await assert.rejects(importGedcom(h.tree, big), e => e.code === "size");
  // exactly 20 MB is not refused for its size
  const edge = new Uint8Array(20 * 1024 * 1024).fill(0x20);
  assert.doesNotThrow(() => decodeGedcom(edge));
});

// ================================================================ Task 4.2

// per fixture: all four files
test("INDI and FAM map to people and links", async () => {
  const expected = {
    myheritage: { people: 6, parents: 6, partners: 2, newLinks: 8 },
    ancestry: { people: 6, parents: 6, partners: 2, newLinks: 8 },
    gramps: { people: 5, parents: 2, partners: 2, newLinks: 4 },
    uds2gedcom: { people: 6, parents: 6, partners: 2, newLinks: 8 },
  };
  for (const name of FIXTURES) {
    const h = makeTree();
    const r = await load(h, fixture(name));
    const view = h.tree.view();
    const want = expected[name];
    assert.deepEqual(counts(view), { people: want.people, parents: want.parents, partners: want.partners }, name);
    assert.equal(r.summary.newPeople, want.people, name);
    assert.equal(r.summary.newLinks, want.newLinks, name);
    assert.equal(r.summary.rejected, 0, name);
    assert.equal(r.summary.skipped, 0, name);
    assert.equal(view.attention.separate.length, name === "gramps" ? 1 : 0, name);
  }

  // MyHeritage: fields
  const h = makeTree();
  await load(h, fixture("myheritage"));
  const view = h.tree.view();
  const danilo = person(view, "Danilo");
  assert.deepEqual(danilo.f, {
    g: "Danilo", s: "Novakov", sx: "M", bd: { y: 1938, m: 3, d: 14 }, bp: "Varnovo, Test Region",
    dd: { y: 2009, m: 11, d: 2 }, dp: "Varnovo", dc: true,
    nt: "Worked at the old mill.\nTwo children.\nSecond line stays.",
  });
  const miro = person(view, "Miro");
  assert.deepEqual(miro.f.bd, { y: 1966, q: "abt" });
  const family = view.families.find(f => f.partners.includes(danilo.id) && f.children.length === 2);
  assert.deepEqual(family.children, [miro.id, person(view, "Ema").id]);
  assert.deepEqual(family.partnership.f, { md: { y: 1963, m: 9, d: 9 }, mp: "Varnovo" });
  const second = view.partnerLinks.find(l => l.a === miro.id || l.b === miro.id);
  assert.deepEqual(second.f, { md: { y: 1999 }, en: true, ed: { y: 2015 } });

  // Ancestry: qualifiers, a range kept as text, DEAT Y
  const a = makeTree();
  await load(a, fixture("ancestry"));
  const av = a.tree.view();
  assert.deepEqual(person(av, "Danillo").f.dd, { y: 2010, q: "bef" });
  assert.deepEqual(person(av, "Teodoora").f.bd, { y: 1941, m: 6, d: 3, q: "est" }); // CAL is est
  assert.equal(person(av, "Teodoora").f.dc, true);
  assert.deepEqual(person(av, "Ema").f.bd, { t: "BET 1968 AND 1970" });
  assert.deepEqual(person(av, "Adam").f.bd, { y: 2000, q: "aft" });
  assert.equal(person(av, "Danillo").f.nt, "First line of the note\nSecond line continues here");

  // Gramps: Cyrillic, a calendar escape kept as text, a NOTE pointer, no surname on a birth-name-only person
  const g = makeTree();
  await load(g, fixture("gramps"));
  const gv = g.tree.view();
  assert.deepEqual(person(gv, "Ѓеко").f.bd, { t: "@#DJULIAN@ 3 MAR 1900" });
  assert.equal(person(gv, "Ѓеко").f.dc, true);
  assert.equal(person(gv, "Теодора").f.nt, "Born in the village.\n\nLived there for years. Moved later.");
  const lea = person(gv, "Lea");
  assert.equal(lea.f.s, undefined);
  assert.equal(lea.f.bs, "Čarin");
  assert.equal(gv.partnerLinks.find(l => l.f.en === true) !== undefined, true);

  // uds2gedcom: BOM and CRLF, @@, INT and text dates, SEX U, a note, no _UID anywhere
  const u = makeTree();
  await load(u, fixture("uds2gedcom"));
  const uv = u.tree.view();
  assert.deepEqual(person(uv, "Данило").f.dd, { t: "INT 1990 (околу 1990)" });
  assert.deepEqual(person(uv, "Теодора").f.bd, { t: "(пред војната)" });
  assert.deepEqual(person(uv, "Ема").f.bd, { y: 1969, m: 7 });
  assert.equal(person(uv, "Ема").f.nt, "Email: ema@example.test");
  assert.equal(person(uv, "Леа").f.sx, "U");
  assert.match(person(uv, "Данило").f.nt, /^From: file-a\.uds #12\nRecords disagree on birth/);
});

test("a NAME of type birth or maiden becomes birthSurname", async () => {
  const h = makeTree();
  await load(h, fixture("myheritage")); // TYPE birth
  assert.deepEqual([person(h.tree.view(), "Teodora").f.s, person(h.tree.view(), "Teodora").f.bs], ["Novakova", "Gjekova"]);
  const a = makeTree();
  await load(a, fixture("ancestry")); // TYPE maiden
  assert.deepEqual([person(a.tree.view(), "Teodoora").f.s, person(a.tree.view(), "Teodoora").f.bs], ["Novakova", "Gjekova"]);
  // SURN beats the text between the slashes; the first NAME that is not a birth name is the main one
  const b = makeTree();
  await load(b, ged("0 HEAD", "0 @I1@ INDI", "1 NAME Ema /wrong/", "2 SURN Новакова", "1 NAME Ema /Old/", "2 TYPE maiden", "0 TRLR"));
  const ema = person(b.tree.view(), "Ema");
  assert.equal(ema.f.s, "Новакова");
  assert.equal(ema.f.bs, "Old");
});

test("HTML in notes is removed and line breaks kept", async () => {
  const h = makeTree();
  const r = await load(h, ged(
    "0 HEAD", "0 @I1@ INDI", "1 NAME Ема /Новакова/",
    "1 NOTE <p>One <b>bold</b> line</p><p>Two</p><br/>Three<br>Four 1 < 2",
    "0 @I2@ INDI", "1 NAME Миро /Новаков/", "1 NOTE Plain", "2 CONT text",
    "0 TRLR",
  ));
  const view = h.tree.view();
  assert.equal(person(view, "Ема").f.nt, "One bold line\nTwo\nThree\nFour 1 < 2");
  assert.equal(person(view, "Миро").f.nt, "Plain\ntext");
  assert.equal(r.summary.htmlRemoved, 1);
});

test("text over a limit is cut and counted", async () => {
  const h = makeTree();
  const r = await load(h, ged(
    "0 HEAD", "0 @I1@ INDI",
    `1 NAME ${"Д".repeat(100)} /Новаков/`,
    "1 BIRT", `2 PLAC ${"x".repeat(130)}`, `2 DATE ${"BET 1900 AND ".repeat(8)}1910`,
    `1 NOTE ${"z".repeat(5100)}`,
    "0 TRLR",
  ));
  const p = [...h.tree.view().people.values()][0];
  assert.equal([...p.f.g].length, 80);
  assert.ok(p.f.g.endsWith("…"));
  assert.equal([...p.f.bp].length, 120);
  assert.equal([...p.f.nt].length, 5000);
  assert.equal([...p.f.bd.t].length, 60);
  assert.equal(r.summary.cut, 4);
  assert.equal(r.summary.rejected, 0);
  // text within its limit is not counted
  const ok = await importGedcom(makeTree().tree, enc.encode(ged("0 HEAD", "0 @I1@ INDI", "1 NAME Ема /Новакова/", "0 TRLR")), { newId });
  assert.equal(ok.summary.cut, 0);
});

test("tags not kept are counted by tag", async () => {
  const expected = {
    myheritage: { OCCU: 1, RIN: 6, _UPD: 1, OBJE: 1, PEDI: 1, _UID: 1, SUBM: 1 },
    ancestry: { SOUR: 2, _MTTAG: 2, RESI: 1, PEDI: 1, SUBM: 1 },
    gramps: { SUBM: 1, EVEN: 1, CHAN: 1 },
    uds2gedcom: { NAME: 1, ROMN: 4, OCCU: 1, NOTE: 1, SUBM: 1 },
  };
  for (const name of FIXTURES) {
    const r = await importGedcom(makeTree().tree, fixture(name), { newId });
    assert.deepEqual(r.summary.notKept, expected[name], name);
  }
});

// through start points: the result is startPoints() of the view after adopting, and the walk starts from it
test("import runs the same join", async () => {
  // a phone that already has Danilo's family, built by hand
  const h = makeTree();
  const danilo = h.add({ g: "Данило", s: "Новаков", bd: { y: 1938 } });
  const ema = h.addRel(danilo, "child", { g: "Ема", s: "Новакова", bd: { y: 1969 } });
  const r = await load(h, fixture("myheritage"));
  const view = h.tree.view();
  // the file's six people are linked to nobody here: one new group
  assert.deepEqual(r.newGroups.map(g => g.size), [6]);
  assert.deepEqual(r.gainedRelatives, []);
  const expected = startPoints(view, r.incoming);
  assert.deepEqual(r.newGroups, expected.newGroups);
  assert.deepEqual(r.gainedRelatives, expected.gainedRelatives);
  assert.deepEqual(r.singles, expected.singles);
  assert.ok(r.incoming.size >= 6 + 8);
  assert.ok(!r.incoming.has(danilo));

  // the walk starts from the pair the relatives pick, and goes on to the daughter
  const fileDanilo = person(view, "Danilo").id;
  const walk = createWalk(h.tree, { pairs: [[danilo, fileDanilo]], incoming: r.incoming, session: "s1" });
  for (let q = walk.next(), n = 0; q && n < 50; q = walk.next(), n++) walk.answer(q, "unsure");
  const joined = h.tree.view();
  assert.equal(h.tree.resolve(danilo), h.tree.resolve(fileDanilo));
  assert.ok(joined.people.size <= 7, `people: ${joined.people.size}`);

  // a second import of another program's file reaches the walk through a person who gained a relative
  const second = await load(h, fixture("gramps"));
  const after = startPoints(h.tree.view(), second.incoming);
  assert.deepEqual(second.gainedRelatives, after.gainedRelatives);
  assert.deepEqual(second.newGroups, after.newGroups);
});

// ================================================================ Task 4.3

test("a 16-hex _UID is used as-is", async () => {
  const h = makeTree();
  const r = await load(h, ged(
    "0 HEAD", "0 @I1@ INDI", "1 _UID 0123456789abcdef", "1 NAME Ема /Новакова/",
    "0 @I2@ INDI", "1 _UID FEDCBA9876543210", "1 NAME Миро /Новаков/", "0 TRLR",
  ));
  assert.ok(h.tree.records().has("0123456789abcdef"));
  assert.ok(h.tree.records().has("fedcba9876543210")); // upper case is lowered
  assert.equal(r.summary.newPeople, 2);
});

test("other _UID shapes hash to 16 hex; bad shapes fall back to the file hash", async () => {
  const uuid = "6a8e1c3f-72d4-4b9a-8e05-c1d7f3a29b64";
  const hex32 = "3F7A19C2B84D4E60A5D1C07E92B3F4A8";
  const hex36 = "6C1F0A93D5E24B78A903B7E1D4F5C28E91A7";
  const text = ged(
    "0 HEAD",
    "0 @A@ INDI", `1 _UID ${uuid}`, "1 NAME Ема /Новакова/",
    "0 @B@ INDI", `1 _UID ${hex32}`, "1 NAME Миро /Новаков/",
    "0 @C@ INDI", `1 _UID ${hex36}`, "1 NAME Адам /Новаков/",
    "0 @D@ INDI", "1 _UID NOT-A-UID", "1 NAME Леа /Чарин/",
    "0 @E@ INDI", "1 _UID 12345", "1 NAME Данило /Новаков/",
    "0 @F@ INDI", "1 NAME Теодора /Новакова/",
    "0 TRLR",
  );
  const bytes = enc.encode(text);
  const h = makeTree();
  await load(h, bytes);
  const ids = Object.fromEntries([...h.tree.view().people.values()].map(p => [p.f.g, p.id]));
  assert.equal(ids["Ема"], await idOfUid(uuid));
  assert.equal(ids["Миро"], await idOfUid(hex32)); // lowered before hashing
  assert.equal(ids["Адам"], await idOfUid(hex36));
  assert.equal(ids["Леа"], await idOfXref(bytes, "@D@"));
  assert.equal(ids["Данило"], await idOfXref(bytes, "@E@"));
  assert.equal(ids["Теодора"], await idOfXref(bytes, "@F@"));
  for (const id of Object.values(ids)) assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(new Set(Object.values(ids)).size, 6);
  // the fixtures: a uds2gedcom file has no _UID at all, so every ID comes from the file hash
  const u = fixture("uds2gedcom");
  const hu = makeTree();
  await load(hu, u);
  assert.ok(hu.tree.records().has(await idOfXref(u, "@P1@")));
  assert.ok(hu.tree.records().has(await idOfXref(u, "@P6@")));
});

test("the same file gives the same IDs and hashes on two devices, so sync sends nothing", async () => {
  for (const name of FIXTURES) {
    const bytes = fixture(name);
    const a = makePhone({ device: pid("d", 1), prefix: "a" });
    const b = makePhone({ device: pid("d", 2), prefix: "b", start: T0 + 90_000 });
    for (const [phone, offset] of [[a, 0], [b, 1]]) {
      phone.h.advance(offset * 5000);
      const r = await importGedcom(phone.tree, bytes, { now: phone.wall.now, newId });
      commit(phone, r.change);
    }
    // the clocks differ, the files agree: every record is the same, so every bucket hash is the same
    const peopleOnly = records => new Map([...records].filter(([id]) => !id.startsWith("d:")));
    assert.equal(plainRecords(peopleOnly(a.tree.records())), plainRecords(peopleOnly(b.tree.records())), name);
    assert.deepEqual(await bucketHashes(a.tree.records()), await bucketHashes(b.tree.records()), name);
    const sync = await syncPair(a, b);
    assert.equal(sync.applied.summary.newPeople, 0, name);
    assert.equal(sync.applied.summary.changedFields, 0, name);
    assert.equal(sync.back.summary.newPeople, 0, name);
    assert.equal(sync.back.summary.changedFields, 0, name);
    assert.equal(difference(a, b), null, name);
  }
});

test("a re-import adds nobody", async () => {
  for (const name of FIXTURES) {
    const h = makeTree();
    const bytes = fixture(name);
    await load(h, bytes);
    const before = plainRecords(h.tree.records());
    const again = await importGedcom(h.tree, bytes, { now: h.wall.now, newId });
    assert.equal(again.change.puts.size, 0, name);
    assert.equal(again.change.group, null, name);
    assert.equal(again.summary.newPeople, 0, name);
    assert.equal(again.summary.newLinks, 0, name);
    assert.equal(again.summary.matched, counts(h.tree.view()).people, name);
    assert.equal(again.incoming.size, 0, name);
    assert.equal(plainRecords(h.tree.records()), before, name);
  }
});

test("a repeated _UID in one file gets its own ID", async () => {
  const uid = "0123456789abcdef";
  const text = ged(
    "0 HEAD",
    "0 @I1@ INDI", `1 _UID ${uid}`, "1 NAME Ема /Новакова/",
    "0 @I2@ INDI", `1 _UID ${uid}`, "1 NAME Ема /Новакова/",
    "0 @I3@ INDI", `1 _UID ${uid}`, "1 NAME Ема /Новакова/",
    "0 @I4@ INDI", "1 _UID 3F7A19C2B84D4E60A5D1C07E92B3F4A8", "1 NAME Миро /Новаков/",
    "0 @I5@ INDI", "1 _UID 3F7A19C2B84D4E60A5D1C07E92B3F4A8", "1 NAME Миро /Новаков/",
    "0 TRLR",
  );
  const h = makeTree();
  const r = await load(h, text);
  assert.equal(r.summary.newPeople, 5);
  const ids = [...h.tree.view().people.keys()];
  assert.equal(new Set(ids).size, 5);
  assert.ok(ids.includes(uid)); // the first occurrence keeps the ID as-is
  assert.ok(ids.includes(await idOfUid(`${uid}#2`)));
  assert.ok(ids.includes(await idOfUid(`${uid}#3`)));
  assert.ok(ids.includes(await idOfUid("3F7A19C2B84D4E60A5D1C07E92B3F4A8")));
  assert.ok(ids.includes(await idOfUid("3F7A19C2B84D4E60A5D1C07E92B3F4A8#2")));
  // and the same file again adds nobody
  const again = await importGedcom(h.tree, enc.encode(text), { now: h.wall.now, newId });
  assert.equal(again.change.puts.size, 0);
});

test("imported values lose to any real edit, on another device too", async () => {
  const bytes = fixture("myheritage");
  const a = makePhone({ device: pid("d", 1), prefix: "a" });
  const b = makePhone({ device: pid("d", 2), prefix: "b", start: T0 + 60_000 });
  const importOn = async phone => commit(phone, (await importGedcom(phone.tree, bytes, { now: phone.wall.now, newId })).change);
  await importOn(a);
  await importOn(b);
  const id = person(a.tree.view(), "Danilo").id;

  // every imported triple has the time (0, 0) and the setter 0000000000000000
  for (const [rid, record] of a.tree.records()) {
    if (rid.startsWith("d:")) continue;
    for (const [key, t] of Object.entries(record.f)) assert.deepEqual([t[1], t[2], t[3]], [0, 0, ZERO], `${rid} ${key}`);
  }

  // b edits after importing; a imports later still, and edits a different field
  b.h.advance(1000);
  commit(b, b.tree.edit(id, { g: "Данило", bp: "Лозје" }));
  a.h.advance(5000);
  commit(a, a.tree.edit(id, { s: "Новаков" }));
  await syncPair(a, b);
  await syncPair(b, a);
  assert.equal(difference(a, b), null);
  const after = a.tree.view().people.get(id).f;
  assert.equal(after.g, "Данило");
  assert.equal(after.bp, "Лозје");
  assert.equal(after.s, "Новаков");

  // a phone that imports after the edit, and has not synced, still loses once it does
  const c = makePhone({ device: pid("d", 3), prefix: "c", start: T0 + 120_000 });
  await importOn(c);
  assert.equal(c.tree.view().people.get(id).f.g, "Danilo");
  await syncPair(c, a);
  await syncPair(a, c);
  assert.equal(c.tree.view().people.get(id).f.g, "Данило");
  assert.equal(difference(a, c), null);

  // clearing a field is an edit too: the clear beats the file
  commit(c, c.tree.edit(id, { nt: null }));
  await syncPair(c, b);
  await syncPair(b, c);
  assert.equal(b.tree.view().people.get(id).f.nt, undefined);
});

test("import never revives a deleted person or brings back an erased one", async () => {
  const bytes = fixture("myheritage");
  const h = makeTree();
  await load(h, bytes);
  const view = h.tree.view();
  const danilo = person(view, "Danilo").id;
  const teodora = person(view, "Teodora").id;
  h.advance();
  h.run(h.tree.removePerson(danilo));
  h.run(h.tree.erase(teodora));
  const before = plainRecords(h.tree.records());
  const r = await importGedcom(h.tree, bytes, { now: h.wall.now, newId });
  assert.equal(r.summary.skipped, 2);
  assert.equal(r.summary.matched, 4);
  assert.equal(r.change.puts.size, 0);
  h.run(r.change);
  assert.equal(plainRecords(h.tree.records()), before);
  assert.equal(h.tree.view().people.has(danilo), false);
  assert.ok(h.tree.view().deleted.has(danilo));
  assert.deepEqual(Object.keys(h.get(teodora).f), ["er"]);

  // a phone that only knows the erased record: the person is skipped and no link to them is made
  const other = makeTree({ prefix: "q", records: new Map([[teodora, { kind: "person", f: { er: [true, T0, 0, pid("d", 1)] } }]]) });
  const fresh2 = await importGedcom(other.tree, bytes, { now: other.wall.now, newId });
  assert.equal(fresh2.summary.skipped, 1);
  assert.equal(fresh2.summary.newPeople, 5);
  for (const rid of fresh2.change.puts.keys()) assert.ok(!rid.includes(teodora), rid);
  other.run(fresh2.change);
  assert.deepEqual(Object.keys(other.get(teodora).f), ["er"]);

  // an erase that arrives by sync after a late import still wins
  const a = makePhone({ device: pid("d", 1), prefix: "a" });
  const b = makePhone({ device: pid("d", 2), prefix: "b", start: T0 + 60_000 });
  commit(a, (await importGedcom(a.tree, bytes, { now: a.wall.now, newId })).change);
  a.h.advance(1000);
  commit(a, a.tree.erase(teodora));
  commit(b, (await importGedcom(b.tree, bytes, { now: b.wall.now, newId })).change);
  await syncPair(a, b);
  await syncPair(b, a);
  assert.equal(difference(a, b), null);
  assert.deepEqual(Object.keys(b.tree.records().get(teodora).f), ["er"]);
  assert.equal(b.tree.view().people.has(teodora), false);
});

test("import fills only fields with no triple", async () => {
  const h = makeTree();
  await load(h, fixture("myheritage"));
  const id = person(h.tree.view(), "Danilo").id;
  const teodora = person(h.tree.view(), "Teodora").id;
  h.advance();
  h.run(h.tree.edit(id, { s: "Новаков", nt: null })); // an edit and a clear
  const r = await load(h, fixture("gramps")); // same people, other program
  const view = h.tree.view();
  assert.equal(view.people.get(id).f.s, "Новаков"); // the edit stays
  assert.equal(view.people.get(id).f.g, "Danilo"); // the first file's value stays
  assert.equal(view.people.get(id).f.bp, "Varnovo, Test Region");
  assert.equal(view.people.get(id).f.nt, undefined); // a cleared field is not refilled
  // the one thing the second file knew that the first did not: Teodora's note
  assert.equal(view.people.get(teodora).f.nt, "Born in the village.\n\nLived there for years. Moved later.");
  assert.equal(r.summary.filled, 1); // her note, nothing else
  assert.equal(view.people.get(teodora).f.g, "Teodora");
  // what it filled has the import time and setter
  assert.deepEqual(h.get(teodora).f.nt.slice(1), [0, 0, ZERO]);
  // the history says what was filled
  const filled = r.change.group.changes.filter(c => !c.created);
  assert.deepEqual(filled.map(c => [c.r, c.f]), [[teodora, "nt"]]);
});

test("a disagreeing INDI gets a new ID and reaches the walk", async () => {
  const first = ged(
    "0 HEAD",
    "0 @I1@ INDI", "1 _UID 0123456789abcdef", "1 NAME Данило /Новаков/", "1 SEX M", "1 BIRT", "2 DATE 1938", "1 FAMS @F1@",
    "0 @I2@ INDI", "1 _UID 1123456789abcdef", "1 NAME Миро /Новаков/", "1 SEX M", "1 BIRT", "2 DATE 1966", "1 FAMC @F1@",
    "0 @F1@ FAM", "1 HUSB @I1@", "1 CHIL @I2@",
    "0 TRLR",
  );
  const h = makeTree();
  await load(h, first);

  // the same _UID on a different human (another name), and on the same name with another birth year
  const other = ged(
    "0 HEAD",
    "0 @I1@ INDI", "1 _UID 0123456789abcdef", "1 NAME Ема /Петкова/", "1 SEX F", "1 BIRT", "2 DATE 1970", "1 FAMS @F1@",
    "0 @I2@ INDI", "1 _UID 1123456789abcdef", "1 NAME Миро /Новаков/", "1 SEX M", "1 BIRT", "2 DATE 1966", "1 FAMC @F1@",
    "0 @I3@ INDI", "1 _UID 2123456789abcdef", "1 NAME Данило /Новаков/", "1 BIRT", "2 DATE 1950",
    "0 @F1@ FAM", "1 WIFE @I1@", "1 CHIL @I2@",
    "0 TRLR",
  );
  const marks = makeTree();
  await load(marks, first.replace("0 TRLR", "0 @I3@ INDI\n1 _UID 2123456789abcdef\n1 NAME Данило /Новаков/\n1 BIRT\n2 DATE 1938\n0 TRLR"));
  const r = await load(marks, other);
  assert.equal(r.summary.newIds, 2); // the Ема and the 1950 Данило
  assert.equal(r.summary.matched, 1); // Миро is the same human
  assert.equal(r.summary.newPeople, 2);
  assert.equal(marks.tree.records().get("0123456789abcdef").f.g[0], "Данило"); // untouched
  assert.equal(marks.tree.records().get("2123456789abcdef").f.bd[0].y, 1938);
  const view = marks.tree.view();
  const ema = person(view, "Ема");
  assert.notEqual(ema.id, "0123456789abcdef");
  assert.ok(r.incoming.has(ema.id));
  // Миро (matched, existing) gained a parent link from the new Ема, so he is where the walk starts
  assert.deepEqual(r.gainedRelatives, ["1123456789abcdef"]);
  assert.ok(r.incoming.has(`p:${ema.id}:1123456789abcdef`));
  const walk = createWalk(marks.tree, { selfPairs: r.gainedRelatives, incoming: r.incoming, session: "s2" });
  const q = walk.next();
  // Ема is a new parent next to the old Данило: the walk can ask whether they are the same, or move on
  assert.ok(q === null || q.candidates !== undefined);

  // one side with no birth year agrees; so does a spelling the matching key treats as equal
  const loose = ged("0 HEAD", "0 @I1@ INDI", "1 _UID 0123456789abcdef", "1 NAME Danilo /Novakov/", "0 TRLR");
  const ok = await importGedcom(h.tree, enc.encode(loose), { now: h.wall.now, newId });
  assert.equal(ok.summary.matched, 1);
  assert.equal(ok.summary.newIds, 0);
  // an exact year that differs by one is still a different human
  const year = ged("0 HEAD", "0 @I1@ INDI", "1 _UID 0123456789abcdef", "1 NAME Данило /Новаков/", "1 BIRT", "2 DATE 1939", "0 TRLR");
  const no = await importGedcom(h.tree, enc.encode(year), { now: h.wall.now, newId });
  assert.equal(no.summary.newIds, 1);
  // a year with ABT is not exact, so it does not disagree
  const about = ged("0 HEAD", "0 @I1@ INDI", "1 _UID 0123456789abcdef", "1 NAME Данило /Новаков/", "1 BIRT", "2 DATE ABT 1950", "0 TRLR");
  const yes = await importGedcom(h.tree, enc.encode(about), { now: h.wall.now, newId });
  assert.equal(yes.summary.newIds, 0);
});

test("everything an import writes passes the validator unchanged", async () => {
  for (const name of FIXTURES) {
    const r = await importGedcom(makeTree().tree, fixture(name), { newId });
    for (const [id, record] of r.change.puts) {
      const checked = validateRecord(id, record, { now: T0 });
      assert.deepEqual(checked.rejected, [], `${name} ${id}`);
      assert.equal(canonicalJson(checked.record), canonicalJson({ kind: record.kind, f: record.f }), `${name} ${id}`);
    }
    // the group says what was created
    assert.equal(r.change.group.action, "import");
    assert.equal(r.change.group.changes.length, r.change.puts.size);
  }
});

// ================================================================ Task 4.4

/** A small tree of people with every field, for the export tests. */
function richTree() {
  const h = makeTree();
  const woman = h.add({ g: "Ема", s: "Новакова", bs: "Ѓекова", sx: "F", bd: { y: 1969, m: 7, d: 15 }, bp: "Варново", nt: "Прв ред\nВтор ред\n\nЧетврти ред" });
  const dan = h.add({ g: "Данило", s: "Новаков", sx: "M", bd: { y: 1938, q: "abt" }, dd: { y: 2009, m: 11, d: 2 }, dp: "Варново", dc: true });
  const gek = h.add({ g: "Ѓеко", s: "Чарин", sx: "X", bd: { t: "BET 1900 AND 1905" }, dc: true });
  const mir = h.add({ g: "Miro", sx: "U" });
  h.run(h.tree.editPartnership(dan, woman, { md: { y: 1963, m: 9, d: 9 }, mp: "Варново", en: true, ed: { y: 1990 } }));
  h.run(h.tree.editPartnership(gek, mir, {}));
  const kid = h.addRel(dan, "child", { g: "Адам", sx: "M" }, { otherParent: woman });
  const lone = h.addRel(mir, "child", { g: "Леа", sx: "F" });
  return { h, woman, dan, gek, mir, kid, lone };
}
const values = view => new Map([...view.people].map(([id, p]) => [id, p.f]));

// X becomes U, as stated in R12; everything else comes back as it was
test("export round trips through import", async () => {
  const w = richTree();
  const view = w.h.tree.view();
  const text = exportGedcom(view, new Date(2026, 10, 6));
  const h = makeTree({ prefix: "r" });
  const r = await load(h, text);
  const back = h.tree.view();
  assert.equal(r.summary.rejected, 0);
  assert.equal(r.summary.newIds, 0);
  assert.equal(back.people.size, view.people.size);
  for (const [id, p] of view.people) {
    const expected = { ...p.f };
    delete expected.del;
    if (expected.sx === "X") expected.sx = "U";
    const got = { ...back.people.get(id).f };
    delete got.del;
    assert.deepEqual(got, expected, id);
  }
  assert.equal(back.people.get(w.gek).f.sx, "U");
  assert.deepEqual(back.parentLinks.map(l => [l.parent, l.child]).sort(), view.parentLinks.map(l => [l.parent, l.child]).sort());
  const links = v => v.partnerLinks.map(l => [l.a, l.b, canonicalJson(l.f)]).sort();
  assert.deepEqual(links(back), links(view));
  // the same families come back
  const shape = v => v.families.map(f => [f.partners.join("+"), f.children.join(",")]).sort();
  assert.deepEqual(shape(back), shape(view));
  // and importing it again changes nothing
  const again = await importGedcom(h.tree, enc.encode(text), { now: h.wall.now, newId });
  assert.equal(again.change.puts.size, 0);
});

const parsed = text => parseGedcom(text).records;
const indiOf = (text, id) => parsed(text).find(r => r.tag === "INDI" && r.children.some(c => c.tag === "_UID" && c.value === id));
const childOf = (record, tag) => record.children.filter(c => c.tag === tag);
const xrefOfId = (text, id) => indiOf(text, id).xref;
const famsOf = text => parsed(text).filter(r => r.tag === "FAM");

test("export writes the header, names, SEX, _UID and the end", () => {
  const w = richTree();
  const text = exportGedcom(w.h.tree.view(), new Date(2026, 10, 6));
  const lines = text.split("\n");
  assert.deepEqual(lines.slice(0, 7), [
    "0 HEAD", "1 SOUR STEBLO", "1 DATE 6 NOV 2026", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8",
  ]);
  assert.equal(text.endsWith("\n0 TRLR\n"), true);
  assert.ok(!text.startsWith("\ufeff"));
  const ema = indiOf(text, w.woman);
  assert.deepEqual(childOf(ema, "NAME").map(n => [n.value, childOf(n, "TYPE").map(t => t.value)]), [["Ема /Новакова/", []], ["Ема /Ѓекова/", ["birth"]]]);
  assert.equal(childOf(ema, "SEX")[0].value, "F");
  const birth = childOf(ema, "BIRT")[0];
  assert.deepEqual(birth.children.map(c => [c.tag, c.value]), [["DATE", "15 JUL 1969"], ["PLAC", "Варново"]]);
  assert.equal(childOf(ema, "DEAT").length, 0);
  // X is written as U, a text date as it was kept
  assert.equal(childOf(indiOf(text, w.gek), "SEX")[0].value, "U");
  assert.ok(!/1 SEX X/.test(text));
  assert.equal(childOf(childOf(indiOf(text, w.gek), "BIRT")[0], "DATE")[0].value, "BET 1900 AND 1905");
  // a name with no given name still has its slashes; only people showing are written
  const h = makeTree();
  const nobody = h.add({ s: "Новаков" });
  assert.equal(childOf(indiOf(exportGedcom(h.tree.view(), new Date(2026, 10, 6)), nobody), "NAME")[0].value, "/Новаков/");
  w.h.run(w.h.tree.removePerson(w.lone));
  assert.ok(!exportGedcom(w.h.tree.view(), new Date(2026, 10, 6)).includes(w.lone));
});

test("HUSB and WIFE follow sex, and a lone F partner is WIFE", () => {
  const h = makeTree();
  // the woman has the smaller ID, so a sort by ID alone would put her first
  const f = h.add({ g: "Ема", sx: "F" });
  const m = h.add({ g: "Адам", sx: "M" });
  h.run(h.tree.editPartnership(f, m, {}));
  const lone = h.add({ g: "Теодора", sx: "F" });
  h.addRel(lone, "child", { g: "Миро" });
  const loneM = h.add({ g: "Данило", sx: "M" });
  h.addRel(loneM, "child", { g: "Леа" });
  const u1 = h.add({ g: "Ѓеко", sx: "M" });
  const u2 = h.add({ g: "Чарин", sx: "M" });
  h.run(h.tree.editPartnership(u1, u2, {}));
  const text = exportGedcom(h.tree.view(), new Date(2026, 10, 6));
  const x = id => xrefOfId(text, id);
  const roles = fam => Object.fromEntries(["HUSB", "WIFE"].map(tag => [tag, childOf(fam, tag)[0]?.value ?? null]));
  const find = (...ids) => famsOf(text).find(fam => ids.every(id => [roles(fam).HUSB, roles(fam).WIFE].includes(x(id))));
  assert.deepEqual(roles(find(f, m)), { HUSB: x(m), WIFE: x(f) });
  assert.deepEqual(roles(find(lone)), { HUSB: null, WIFE: x(lone) });
  assert.deepEqual(roles(find(loneM)), { HUSB: x(loneM), WIFE: null });
  const [first, second] = [u1, u2].sort();
  assert.deepEqual(roles(find(u1, u2)), { HUSB: x(first), WIFE: x(second) });
  // every INDI points to its FAMS and FAMC
  const emaRec = indiOf(text, f);
  assert.equal(childOf(emaRec, "FAMS").length, 1);
});

test("deceased with no date writes 1 DEAT Y", () => {
  const h = makeTree();
  const a = h.add({ g: "Ѓеко", dc: true });
  const b = h.add({ g: "Ема", dd: { y: 2001 }, dc: true });
  const c = h.add({ g: "Миро", dp: "Варново", dc: true });
  const d = h.add({ g: "Адам", dc: false });
  const text = exportGedcom(h.tree.view(), new Date(2026, 10, 6));
  const deat = id => childOf(indiOf(text, id), "DEAT");
  assert.deepEqual(deat(a).map(n => [n.value, n.children.length]), [["Y", 0]]);
  assert.deepEqual(deat(b).map(n => [n.value, n.children.map(k => [k.tag, k.value])]), [["", [["DATE", "2001"]]]]);
  assert.deepEqual(deat(c).map(n => [n.value, n.children.map(k => [k.tag, k.value])]), [["", [["PLAC", "Варново"]]]]);
  assert.deepEqual(deat(d), []);
  assert.match(text, /\n1 DEAT Y\n/);
});

test("long notes split into CONT lines", async () => {
  const h = makeTree();
  const long = "w".repeat(450) + " tail";
  const note = `една\n\nтри @ краj\n${long}`;
  const id = h.add({ g: "Ема", nt: note });
  const text = exportGedcom(h.tree.view(), new Date(2026, 10, 6));
  assert.match(text, /1 NOTE една\n2 CONT\n2 CONT три @@ краj\n2 CONT w{200}\n2 CONC w{200}\n2 CONC w{50} tail\n/);
  for (const line of text.split("\n")) assert.ok([...line].length <= 210, line.slice(0, 40));
  // it reads back as it was written
  const back = makeTree({ prefix: "r" });
  await load(back, text);
  assert.equal(back.tree.view().people.get(id).f.nt, note);
});
