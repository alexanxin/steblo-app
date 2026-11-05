import test from "node:test";
import assert from "node:assert/strict";
import {
  FIELDS, MAX_RECORDS, kindOf, bucketOf, linkId,
  validateField, validateTime, validateRecord, sanitiseText, applyTriple,
} from "../public/src/records.js";

// Invented IDs: 16 lowercase hex characters.
const A = "aa00000000000001";
const B = "bb00000000000002";
const C = "cc00000000000003";
const DEV = "d0d0d0d0d0d0d0d0";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const opts = { now: NOW };

const triple = (v, ms = NOW - 1000, counter = 0, by = DEV) => [v, ms, counter, by];
const check = (kind, key, value) => validateField(kind, key, value);

test("kindOf reads the shape of an ID", () => {
  assert.equal(kindOf(A), "person");
  assert.equal(kindOf(`p:${A}:${B}`), "parent");
  assert.equal(kindOf(`u:${A}:${B}`), "partner");
  assert.equal(kindOf(`m:${A}:${B}`), "merge");
  assert.equal(kindOf(`n:${A}:${B}`), "notsame");
  assert.equal(kindOf(`d:${DEV}`), "device");
  for (const bad of ["", "AA00000000000001", "aa0000000000000", "aa000000000000011", `x:${A}:${B}`, `p:${A}`, `p:${A}:${B}:${C}`, `d:${A}:${B}`, `u:${B}:${A}`, `m:${B}:${A}`, `n:${B}:${A}`, null, undefined, 5]) {
    assert.equal(kindOf(bad), null, String(bad));
  }
  // parent links keep their direction: parent first, whatever the order of the IDs
  assert.equal(kindOf(`p:${B}:${A}`), "parent");
});

test("bucketOf follows the bucket key", () => {
  assert.equal(bucketOf(A), 0xaa);
  assert.equal(bucketOf(`p:${A}:${B}`), 0xbb); // the child
  assert.equal(bucketOf(`p:${B}:${A}`), 0xaa);
  assert.equal(bucketOf(`u:${A}:${B}`), 0xaa); // the smaller
  assert.equal(bucketOf(`m:${A}:${B}`), 0xaa);
  assert.equal(bucketOf(`n:${A}:${B}`), 0xaa);
  assert.equal(bucketOf(`d:${DEV}`), 0xd0);
  assert.equal(bucketOf("00ffffffffffffff"), 0);
  assert.equal(bucketOf("ff00000000000000"), 255);
  assert.equal(bucketOf("not an id"), null);
});

test("linkId sorts partner and merge pairs but not parent links", () => {
  assert.equal(linkId("parent", B, A), `p:${B}:${A}`);
  assert.equal(linkId("parent", A, B), `p:${A}:${B}`);
  assert.equal(linkId("partner", B, A), `u:${A}:${B}`);
  assert.equal(linkId("partner", A, B), `u:${A}:${B}`);
  assert.equal(linkId("merge", B, A), `m:${A}:${B}`);
  assert.equal(linkId("notsame", B, A), `n:${A}:${B}`);
  assert.throws(() => linkId("sibling", A, B));
});

test("FIELDS lists each kind's short keys with their names", () => {
  assert.deepEqual(Object.keys(FIELDS.person), ["g", "s", "bs", "sx", "bd", "bp", "dd", "dp", "dc", "nt", "del", "er"]);
  assert.equal(FIELDS.person.g, "given");
  assert.deepEqual(Object.keys(FIELDS.parent), ["del"]);
  assert.deepEqual(Object.keys(FIELDS.partner), ["md", "mp", "en", "ed", "del"]);
  assert.deepEqual(Object.keys(FIELDS.merge), ["del"]);
  assert.deepEqual(Object.keys(FIELDS.notsame), ["del"]);
  assert.deepEqual(Object.keys(FIELDS.device), ["nm"]);
  assert.equal(MAX_RECORDS, 200000);
});

test("the validator cleans names", () => {
  assert.deepEqual(check("person", "g", "  Ема  Новакова "), { ok: true, value: "Ема Новакова" });
  assert.deepEqual(check("person", "s", "Новаков"), { ok: true, value: "Новаков" });
  assert.deepEqual(check("person", "bs", "Чарин\u0000"), { ok: true, value: "Чарин" });
  assert.deepEqual(check("person", "g", "Ема  Леа"), { ok: true, value: "Ема Леа" });
  // 80 characters pass, 81 are rejected
  assert.equal(check("person", "g", "а".repeat(80)).ok, true);
  assert.deepEqual(check("person", "g", "а".repeat(81)), { ok: false, reason: "invalid" });
  // length counts characters, not UTF-16 units
  assert.equal(check("person", "g", "😀".repeat(80)).ok, true);
  assert.equal(check("person", "g", "😀".repeat(81)).ok, false);
  // empty after cleaning is not a name; clearing is done with null
  for (const empty of ["", "   ", "\u0007\u0000"]) assert.equal(check("person", "g", empty).ok, false);
  // a line break inside a name is a control character and is removed
  assert.equal(check("person", "g", "Ема\nЛеа").value, "ЕмаЛеа");
  // places allow 120
  assert.equal(check("person", "bp", "м".repeat(120)).ok, true);
  assert.equal(check("person", "dp", "м".repeat(121)).ok, false);
  assert.equal(check("partner", "mp", "м".repeat(121)).ok, false);
  // text must be text
  for (const bad of [5, true, {}, [], ["Ема"]]) assert.equal(check("person", "g", bad).ok, false);
});

test("the device name is 1 to 60 characters on one line", () => {
  assert.deepEqual(check("device", "nm", " Теодорин  телефон "), { ok: true, value: "Теодорин телефон" });
  assert.equal(check("device", "nm", "т".repeat(60)).ok, true);
  assert.equal(check("device", "nm", "т".repeat(61)).ok, false);
  assert.equal(check("device", "nm", "").ok, false);
});

test("notes keep newlines and tabs and drop other control characters", () => {
  assert.deepEqual(check("person", "nt", "Ред едно\nред\tдва\r\n\u0007три\u0000"), { ok: true, value: "Ред едно\nред\tдва\nтри" });
  assert.equal(check("person", "nt", "н".repeat(5000)).ok, true);
  assert.equal(check("person", "nt", "н".repeat(5001)).ok, false);
  // notes are not trimmed or collapsed
  assert.equal(check("person", "nt", "  два  празни \n").value, "  два  празни \n");
});

test("< and > are allowed in every text field", () => {
  const text = "a <b> & c > d < e";
  for (const [kind, key] of [["person", "g"], ["person", "s"], ["person", "bs"], ["person", "bp"], ["person", "dp"], ["partner", "mp"], ["person", "nt"], ["device", "nm"]]) {
    assert.deepEqual(check(kind, key, text), { ok: true, value: text }, key);
  }
  assert.deepEqual(check("person", "bd", { t: "<script>" }), { ok: true, value: { t: "<script>" } });
});

test("sex is M, F, X or U", () => {
  for (const sex of ["M", "F", "X", "U"]) assert.deepEqual(check("person", "sx", sex), { ok: true, value: sex });
  for (const bad of ["m", "male", "", "MF", 1, true]) assert.equal(check("person", "sx", bad).ok, false, String(bad));
});

test("booleans are true or false", () => {
  for (const [kind, key] of [["person", "dc"], ["person", "del"], ["partner", "en"], ["partner", "del"], ["parent", "del"], ["merge", "del"], ["notsame", "del"]]) {
    assert.equal(check(kind, key, true).ok, true);
    assert.equal(check(kind, key, false).ok, true);
    for (const bad of ["true", 1, 0, "", {}]) assert.equal(check(kind, key, bad).ok, false, `${key} ${String(bad)}`);
  }
});

test("null clears every field except deleted, erased and name", () => {
  for (const [kind, keys] of Object.entries(FIELDS)) {
    for (const key of Object.keys(keys)) {
      const mustStay = key === "del" || key === "er" || (kind === "device" && key === "nm");
      assert.equal(check(kind, key, null).ok, !mustStay, `${kind}.${key}`);
    }
  }
  assert.deepEqual(check("person", "g", null), { ok: true, value: null });
});

test("dates need y or t, and d must be a real day", () => {
  assert.deepEqual(check("person", "bd", { y: 1931, m: 3, d: 12 }), { ok: true, value: { y: 1931, m: 3, d: 12 } });
  assert.equal(check("person", "bd", { y: 1931 }).ok, true);
  assert.equal(check("person", "bd", { y: 1931, m: 3 }).ok, true);
  assert.equal(check("person", "bd", { t: "BET 1920 AND 1940" }).ok, true);
  assert.equal(check("person", "bd", { y: 1931, q: "abt" }).ok, true);
  // needs y or t
  for (const bad of [{}, { m: 3 }, { m: 3, d: 12 }, { q: "abt" }, { d: 5 }]) assert.equal(check("person", "bd", bad).ok, false, JSON.stringify(bad));
  // leap years
  assert.equal(check("person", "bd", { y: 2024, m: 2, d: 29 }).ok, true);
  assert.equal(check("person", "bd", { y: 2023, m: 2, d: 29 }).ok, false);
  assert.equal(check("person", "bd", { y: 1900, m: 2, d: 29 }).ok, false);
  assert.equal(check("person", "bd", { y: 2000, m: 2, d: 29 }).ok, true);
  assert.equal(check("person", "bd", { y: 1931, m: 4, d: 31 }).ok, false);
  assert.equal(check("person", "bd", { y: 1931, m: 4, d: 30 }).ok, true);
  assert.equal(check("person", "bd", { y: 1931, m: 12, d: 31 }).ok, true);
  assert.equal(check("person", "bd", { y: 1931, m: 1, d: 0 }).ok, false);
  // ranges
  assert.equal(check("person", "bd", { y: 1 }).ok, true);
  assert.equal(check("person", "bd", { y: 2200 }).ok, true);
  assert.equal(check("person", "bd", { y: 0 }).ok, false);
  assert.equal(check("person", "bd", { y: 2201 }).ok, false);
  assert.equal(check("person", "bd", { y: 1931, m: 0 }).ok, false);
  assert.equal(check("person", "bd", { y: 1931, m: 13 }).ok, false);
  // types
  for (const bad of [{ y: 1931.5 }, { y: "1931" }, { y: 1931, m: "3" }, { y: NaN }, { y: Infinity }]) assert.equal(check("person", "bd", bad).ok, false, JSON.stringify(bad));
  // a day needs a month; a month needs a year
  assert.equal(check("person", "bd", { y: 1931, d: 12 }).ok, false);
  assert.equal(check("person", "bd", { t: "spring", m: 3 }).ok, false);
  // q
  for (const q of ["abt", "bef", "aft", "est"]) assert.equal(check("person", "bd", { y: 1931, q }).ok, true, q);
  for (const q of ["cal", "ABT", "", null, 1]) assert.equal(check("person", "bd", { y: 1931, q }).ok, false, String(q));
  // t is one line of at most 60 characters
  assert.equal(check("person", "bd", { t: "x".repeat(60) }).ok, true);
  assert.equal(check("person", "bd", { t: "x".repeat(61) }).ok, false);
  assert.deepEqual(check("person", "bd", { t: "  BET  1920\n AND 1940 " }), { ok: true, value: { t: "BET 1920 AND 1940" } });
  assert.equal(check("person", "bd", { t: "" }).ok, false);
  // anything else in the object, and things that aren't objects, are rejected
  for (const bad of [{ y: 1931, x: 1 }, [], "1931", 1931, true]) assert.equal(check("person", "bd", bad).ok, false, JSON.stringify(bad));
  // all four date fields use the same rule
  assert.equal(check("person", "dd", { y: 2023, m: 2, d: 29 }).ok, false);
  assert.equal(check("partner", "md", { y: 1955 }).ok, true);
  assert.equal(check("partner", "ed", { y: 1960, m: 2, d: 30 }).ok, false);
});

test("a date that is valid comes back without extra keys and in its own object", () => {
  const input = { y: 1931, m: 3 };
  const out = check("person", "bd", input).value;
  assert.deepEqual(out, { y: 1931, m: 3 });
  assert.notEqual(out, input);
});

test("erased can only be true", () => {
  assert.deepEqual(check("person", "er", true), { ok: true, value: true });
  for (const bad of [false, null, "true", 1]) assert.equal(check("person", "er", bad).ok, false, String(bad));
  // only people have it
  assert.equal(check("parent", "er", true).ok, false);
  assert.equal(check("device", "er", true).ok, false);
});

test("a field the kind doesn't have is not accepted by validateField", () => {
  assert.equal(check("parent", "g", "Ема").ok, false);
  assert.equal(check("person", "md", { y: 1950 }).ok, false);
  assert.equal(check("device", "g", "Ема").ok, false);
  assert.equal(check("nonsense", "g", "Ема").ok, false);
});

test("validateTime accepts up to the later of now and hello w plus 24 hours", () => {
  assert.equal(validateTime(0, 0, opts), true);
  assert.equal(validateTime(NOW + DAY, 65535, opts), true);
  assert.equal(validateTime(NOW + DAY + 1, 0, opts), false);
  // the sender's w can raise the limit
  const helloW = NOW + 10 * DAY;
  assert.equal(validateTime(helloW + DAY, 0, { now: NOW, helloW }), true);
  assert.equal(validateTime(helloW + DAY + 1, 0, { now: NOW, helloW }), false);
  // ... but a lower w does not lower it
  assert.equal(validateTime(NOW + DAY, 0, { now: NOW, helloW: 5 }), true);
  // counter and types
  assert.equal(validateTime(5, 65536, opts), false);
  assert.equal(validateTime(5, -1, opts), false);
  assert.equal(validateTime(-1, 0, opts), false);
  assert.equal(validateTime(5.5, 0, opts), false);
  assert.equal(validateTime(5, 0.5, opts), false);
  assert.equal(validateTime("5", 0, opts), false);
  assert.equal(validateTime(Number.NaN, 0, opts), false);
  assert.equal(validateTime(Infinity, 0, opts), false);
});

test("times beyond the later of now and hello w plus 24 hours are rejected", () => {
  const id = A;
  const late = { kind: "person", f: { g: triple("Ема", NOW + DAY + 1), s: triple("Новакова", NOW + DAY), sx: triple("F", NOW - 5) } };
  const result = validateRecord(id, late, opts);
  assert.deepEqual(Object.keys(result.record.f).sort(), ["s", "sx"]);
  assert.deepEqual(result.rejected, [{ key: "g", reason: "clock" }]);
  // a hello w later than now lifts the limit
  const lifted = validateRecord(id, late, { now: NOW, helloW: NOW + 5 * DAY });
  assert.deepEqual(lifted.rejected, []);
  assert.equal(lifted.record.f.g[0], "Ема");
});

test("by must be 16 lowercase hex characters", () => {
  const rec = { kind: "person", f: { g: triple("Ема", NOW - 1, 0, "ABCDEF0123456789"), s: triple("Новаков", NOW - 1, 0, "short"), sx: triple("M", NOW - 1, 0, 7) } };
  const result = validateRecord(A, rec, opts);
  assert.deepEqual(result.record.f, {});
  assert.deepEqual(result.rejected, [{ key: "g", reason: "invalid" }, { key: "s", reason: "invalid" }, { key: "sx", reason: "invalid" }]);
});

test("validateRecord returns the cleaned record and what it rejected", () => {
  const rec = {
    kind: "person",
    f: {
      g: triple("  Данило  "),
      s: triple("Новаков", NOW - 500, 3),
      sx: triple("male"), // bad
      bd: triple({ y: 1931, m: 3, d: 12 }),
      dd: triple(null),
      del: triple(false),
    },
  };
  const { record, rejected } = validateRecord(A, rec, opts);
  assert.equal(record.kind, "person");
  assert.deepEqual(record.f.g, ["Данило", NOW - 1000, 0, DEV]);
  assert.deepEqual(record.f.s, ["Новаков", NOW - 500, 3, DEV]);
  assert.deepEqual(record.f.bd, [{ y: 1931, m: 3, d: 12 }, NOW - 1000, 0, DEV]);
  assert.deepEqual(record.f.dd, [null, NOW - 1000, 0, DEV]);
  assert.deepEqual(record.f.del, [false, NOW - 1000, 0, DEV]);
  assert.equal("sx" in record.f, false);
  assert.deepEqual(rejected, [{ key: "sx", reason: "invalid" }]);
  // the input is not changed
  assert.equal(rec.f.g[0], "  Данило  ");
});

test("validateRecord rejects a whole record with a bad ID, kind or shape", () => {
  const good = { kind: "person", f: { g: triple("Ема") } };
  for (const [id, record] of [
    ["not-an-id", good],
    [A, { kind: "parent", f: { del: triple(false) } }], // kind doesn't match the ID
    [`p:${A}:${B}`, good],
    [A, { kind: "family", f: {} }],
    [A, { kind: "person" }],
    [A, { kind: "person", f: [] }],
    [A, { kind: "person", f: null }],
    [A, null],
    [A, "person"],
    [`u:${B}:${A}`, { kind: "partner", f: { del: triple(false) } }],
  ]) {
    const result = validateRecord(id, record, opts);
    assert.equal(result.record, null, `${id} ${JSON.stringify(record)}`);
    assert.deepEqual(result.rejected, [{ key: null, reason: "invalid" }]);
  }
});

test("validateRecord rejects fields the kind doesn't have and malformed triples", () => {
  const rec = {
    kind: "parent",
    f: {
      del: triple(true),
      md: triple({ y: 1950 }), // a partner field on a parent link
      g: triple("Ема"),
      Given: triple("Ема"),   // not a field name at all
    },
  };
  Object.defineProperty(rec.f, "__proto__", { value: triple(1), enumerable: true });
  const result = validateRecord(`p:${A}:${B}`, rec, opts);
  assert.deepEqual(Object.keys(result.record.f), ["del"]);
  assert.equal(result.rejected.length, 4);
  assert.ok(result.rejected.every(r => r.reason === "invalid"));
  const shapes = { kind: "person", f: { g: "Ема", s: [], sx: ["M", NOW, 0], bd: [{ y: 1 }, NOW, 0, DEV, 1], nt: triple("ok") } };
  const second = validateRecord(A, shapes, opts);
  assert.deepEqual(Object.keys(second.record.f), ["nt"]);
  assert.deepEqual(second.rejected.map(r => r.key).sort(), ["bd", "g", "s", "sx"]);
});

test("unknown fields are kept up to 4 and 4 KB", () => {
  const f = { g: triple("Ема"), aaaa: triple("a"), bbbb: triple(2), cc: triple([1, 2]), d: triple({ x: true }), eeee: triple("fifth") };
  const result = validateRecord(A, { kind: "person", f }, opts);
  assert.deepEqual(Object.keys(result.record.f).sort(), ["aaaa", "bbbb", "cc", "d", "g"]);
  assert.deepEqual(result.rejected, [{ key: "eeee", reason: "invalid" }]);
  // the unknown values are stored as they came
  assert.deepEqual(result.record.f.cc, [[1, 2], NOW - 1000, 0, DEV]);
  assert.deepEqual(result.record.f.d[0], { x: true });

  // depth: 4 passes, 5 is rejected
  const four = [[[[1]]]];
  const five = [[[[[1]]]]];
  assert.equal(check("person", "zz", four).ok, true);
  assert.equal(check("person", "zz", five).ok, false);
  assert.equal(check("person", "zz", { a: { b: { c: { d: 1 } } } }).ok, true);
  assert.equal(check("person", "zz", { a: { b: { c: { d: { e: 1 } } } } }).ok, false);
  const deep = validateRecord(A, { kind: "person", f: { zz: triple(five), yy: triple(four) } }, opts);
  assert.deepEqual(Object.keys(deep.record.f), ["yy"]);
  assert.deepEqual(deep.rejected, [{ key: "zz", reason: "invalid" }]);

  // 4 KB of JSON for the unknown fields of one record
  const big = validateRecord(A, { kind: "person", f: { aa: triple("x".repeat(5000)), bb: triple("short") } }, opts);
  assert.deepEqual(Object.keys(big.record.f), ["bb"]);
  assert.deepEqual(big.rejected, [{ key: "aa", reason: "invalid" }]);
  const two = validateRecord(A, { kind: "person", f: { aa: triple("x".repeat(3000)), bb: triple("y".repeat(3000)) } }, opts);
  assert.deepEqual(Object.keys(two.record.f), ["aa"]);
  assert.deepEqual(two.rejected, [{ key: "bb", reason: "invalid" }]);
  // the size is counted in bytes
  const bytes = validateRecord(A, { kind: "person", f: { aa: triple("я".repeat(2100)) } }, opts);
  assert.deepEqual(bytes.rejected, [{ key: "aa", reason: "invalid" }]);
});

test("unknown field names are 1 to 4 lowercase letters, and values must be plain JSON", () => {
  for (const key of ["a", "ab", "abc", "abcd"]) assert.equal(validateRecord(A, { kind: "person", f: { [key]: triple(1) } }, opts).rejected.length, 0, key);
  for (const key of ["abcde", "Ab", "a1", "", "a-b"]) assert.equal(validateRecord(A, { kind: "person", f: { [key]: triple(1) } }, opts).rejected.length, 1, key);
  for (const bad of [undefined, Number.NaN, Infinity, () => 1, new Date(0), new Map(), 10n]) {
    assert.equal(check("person", "zz", bad).ok, false, String(bad));
  }
  // a later version's null is fine
  assert.deepEqual(check("person", "zz", null), { ok: true, value: null });
  // a known field of another kind is not "unknown": the device record has only nm, but a 2-letter key is still allowed there
  assert.equal(validateRecord(`d:${DEV}`, { kind: "device", f: { nm: triple("Телефон"), zz: triple(1) } }, opts).rejected.length, 0);
});

test("sanitiseText cuts over-long text with an ellipsis and strips tags from notes", () => {
  // cut: the result has exactly the limit's length and ends with …
  const cut = sanitiseText("g", "а".repeat(100));
  assert.equal(cut.cut, true);
  assert.equal([...cut.value].length, 80);
  assert.ok(cut.value.endsWith("…"));
  assert.equal(cut.value, "а".repeat(79) + "…");
  assert.equal(check("person", "g", cut.value).ok, true);
  assert.deepEqual(sanitiseText("g", "а".repeat(80)), { value: "а".repeat(80), cut: false });
  assert.equal([...sanitiseText("bp", "м".repeat(200)).value].length, 120);
  assert.equal([...sanitiseText("nm", "м".repeat(200)).value].length, 60);
  assert.equal([...sanitiseText("t", "м".repeat(200)).value].length, 60);
  const longNote = sanitiseText("nt", "н".repeat(6000));
  assert.deepEqual([longNote.cut, [...longNote.value].length], [true, 5000]);
  assert.equal(check("person", "nt", longNote.value).ok, true);

  // notes: <br> and <p> become newlines, other tags go
  assert.deepEqual(sanitiseText("nt", "Ред едно<br>ред два<BR/>три<br />четири"), { value: "Ред едно\nред два\nтри\nчетири", cut: false });
  assert.equal(sanitiseText("nt", "<p>Прво</p><p class=\"x\">Второ</p>").value, "Прво\nВторо");
  assert.equal(sanitiseText("nt", "Ема <b>работеше</b> <a href=\"http://example.test\">тука</a>").value, "Ема работеше тука");
  // a bare < or > is text, not a tag
  assert.equal(sanitiseText("nt", "1 < 2 and 3 > 2, a<b").value, "1 < 2 and 3 > 2, a<b");
  // tags are not stripped from other fields
  assert.equal(sanitiseText("g", "<b>Ема</b>").value, "<b>Ема</b>");
  // control characters follow the field's rule
  assert.equal(sanitiseText("g", "Ема\u0000  Леа\n").value, "Ема Леа");
  assert.equal(sanitiseText("nt", "а\u0007б\nв\tг").value, "аб\nв\tг");
  // a stripped note is cut after the tags go
  const tagged = sanitiseText("nt", "<b>" + "н".repeat(5000) + "</b>");
  assert.deepEqual([tagged.cut, [...tagged.value].length], [false, 5000]);
  // anything that isn't a text field is returned as it was
  assert.deepEqual(sanitiseText("bd", { y: 1931 }), { value: { y: 1931 }, cut: false });
  assert.deepEqual(sanitiseText("g", null), { value: null, cut: false });
});

test("applyTriple keeps the later triple", () => {
  const record = { kind: "person", f: { g: [ "Ема", 1000, 0, DEV ] } };
  const later = applyTriple(record, "g", ["Теодора", 1000, 1, DEV]);
  assert.deepEqual(later.f.g, ["Теодора", 1000, 1, DEV]);
  // the input record is not changed
  assert.deepEqual(record.f.g, ["Ема", 1000, 0, DEV]);
  assert.notEqual(later, record);

  // an earlier triple changes nothing, and gives back the same object
  assert.equal(applyTriple(record, "g", ["Леа", 999, 9, DEV]), record);
  // so does the same triple
  assert.equal(applyTriple(record, "g", ["Ема", 1000, 0, DEV]), record);
  // ties on time go to the larger setter, then the larger value
  const other = "ffffffffffffffff";
  assert.deepEqual(applyTriple(record, "g", ["Леа", 1000, 0, other]).f.g, ["Леа", 1000, 0, other]);
  assert.equal(applyTriple(record, "g", ["Леа", 1000, 0, "0000000000000000"]), record);
  assert.deepEqual(applyTriple(record, "g", ["Миро", 1000, 0, DEV]).f.g[0], "Миро");
  assert.equal(applyTriple(record, "g", ["Адам", 1000, 0, DEV]), record);
  // a new field is added
  const added = applyTriple(record, "s", ["Новаков", 5, 0, DEV]);
  assert.deepEqual(Object.keys(added.f).sort(), ["g", "s"]);
  // a null value is a value: a later null clears, and an earlier one loses
  assert.deepEqual(applyTriple(record, "g", [null, 1001, 0, DEV]).f.g, [null, 1001, 0, DEV]);
  assert.equal(applyTriple(record, "g", [null, 1000, 0, DEV]), record);
  // the order of arrival doesn't matter
  const t1 = ["Ема", 10, 0, DEV];
  const t2 = ["Леа", 10, 0, other];
  const t3 = ["Миро", 11, 0, "00000000000000bb"];
  const empty = { kind: "person", f: {} };
  const one = applyTriple(applyTriple(applyTriple(empty, "g", t1), "g", t2), "g", t3);
  const two = applyTriple(applyTriple(applyTriple(empty, "g", t3), "g", t1), "g", t2);
  assert.deepEqual(one, two);
});

test("applyTriple on an erased record keeps only er", () => {
  const erasedAt = [true, 2000, 0, DEV];
  const record = { kind: "person", f: { g: ["Ема", 1000, 0, DEV], s: ["Новакова", 1000, 0, DEV], bd: [{ y: 1931 }, 1000, 0, DEV] } };

  // applying er discards every other field of the record
  const erased = applyTriple(record, "er", erasedAt);
  assert.deepEqual(erased, { kind: "person", f: { er: erasedAt } });

  // later edits, even with a later time, are discarded
  assert.equal(applyTriple(erased, "g", ["Леа", 9999, 0, DEV]), erased);
  assert.equal(applyTriple(erased, "del", [false, 9999, 0, DEV]), erased);
  assert.equal(applyTriple(erased, "zz", [1, 9999, 0, DEV]), erased);

  // a record that arrives already erased and carries more fields ends the same way
  let arrived = { kind: "person", f: {} };
  arrived = applyTriple(arrived, "g", ["Ема", 1000, 0, DEV]);
  arrived = applyTriple(arrived, "er", erasedAt);
  assert.deepEqual(arrived, erased);

  // two devices that erased at different times converge on the later er
  const second = [true, 3000, 0, "00000000000000bb"];
  assert.deepEqual(applyTriple(erased, "er", second), { kind: "person", f: { er: second } });
  assert.deepEqual(applyTriple(applyTriple(erased, "er", second), "er", erasedAt).f.er, second);
  // the same er again changes nothing
  assert.equal(applyTriple(erased, "er", erasedAt), erased);
});
