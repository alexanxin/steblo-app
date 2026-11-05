import test from "node:test";
import assert from "node:assert/strict";
import { parseGedcomDate, toGedcomDate, formatDate, sortYear, isExact } from "../public/src/dates.js";
import { validateField } from "../public/src/records.js";

test("parseGedcomDate reads full, month and year dates", () => {
  assert.deepEqual(parseGedcomDate("12 MAR 1931"), { y: 1931, m: 3, d: 12 });
  assert.deepEqual(parseGedcomDate("MAR 1931"), { y: 1931, m: 3 });
  assert.deepEqual(parseGedcomDate("1931"), { y: 1931 });
  // case, spaces and a leading zero make no difference
  assert.deepEqual(parseGedcomDate("  05  mar   1931 "), { y: 1931, m: 3, d: 5 });
  assert.deepEqual(parseGedcomDate("Dec 1999"), { y: 1999, m: 12 });
  // all twelve months
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  months.forEach((name, i) => assert.deepEqual(parseGedcomDate(`1 ${name} 1950`), { y: 1950, m: i + 1, d: 1 }, name));
  // leap days
  assert.deepEqual(parseGedcomDate("29 FEB 2024"), { y: 2024, m: 2, d: 29 });
  assert.deepEqual(parseGedcomDate("29 FEB 2023"), { t: "29 FEB 2023" });
});

test("prefixes set q; CAL becomes est", () => {
  assert.deepEqual(parseGedcomDate("ABT 1931"), { y: 1931, q: "abt" });
  assert.deepEqual(parseGedcomDate("BEF MAR 1931"), { y: 1931, m: 3, q: "bef" });
  assert.deepEqual(parseGedcomDate("AFT 12 MAR 1931"), { y: 1931, m: 3, d: 12, q: "aft" });
  assert.deepEqual(parseGedcomDate("EST 1931"), { y: 1931, q: "est" });
  assert.deepEqual(parseGedcomDate("CAL 1931"), { y: 1931, q: "est" });
  assert.deepEqual(parseGedcomDate("abt  1931"), { y: 1931, q: "abt" });
});

test("anything else is kept as text", () => {
  const between = parseGedcomDate("BET 1920 AND 1940");
  assert.deepEqual(between, { t: "BET 1920 AND 1940" });
  assert.equal(sortYear(between), 1920);
  assert.deepEqual(parseGedcomDate("FROM 1920 TO 1930"), { t: "FROM 1920 TO 1930" });
  assert.equal(sortYear({ t: "FROM 1920 TO 1930" }), 1920);
  assert.deepEqual(parseGedcomDate("@#DJULIAN@ 12 MAR 1931"), { t: "@#DJULIAN@ 12 MAR 1931" });
  assert.equal(sortYear(parseGedcomDate("@#DJULIAN@ 12 MAR 1931")), 1931);
  // impossible days and months, years out of range, extra words
  assert.deepEqual(parseGedcomDate("31 FEB 1931"), { t: "31 FEB 1931" });
  assert.deepEqual(parseGedcomDate("12 XXX 1931"), { t: "12 XXX 1931" });
  assert.deepEqual(parseGedcomDate("0 MAR 1931"), { t: "0 MAR 1931" });
  assert.deepEqual(parseGedcomDate("12 1931"), { t: "12 1931" });
  assert.deepEqual(parseGedcomDate("3000"), { t: "3000" });
  assert.deepEqual(parseGedcomDate("0000"), { t: "0000" });
  assert.deepEqual(parseGedcomDate("ABT"), { t: "ABT" });
  assert.deepEqual(parseGedcomDate("ABT BET 1920 AND 1940"), { t: "ABT BET 1920 AND 1940" });
  assert.deepEqual(parseGedcomDate("(unknown)"), { t: "(unknown)" });
  assert.equal(sortYear({ t: "(unknown)" }), null);
  // white space inside the text is tidied; empty means no date
  assert.deepEqual(parseGedcomDate("BET  1920\tAND\n1940"), { t: "BET 1920 AND 1940" });
  for (const none of ["", "   ", null, undefined, 1931]) assert.equal(parseGedcomDate(none), null, String(none));
});

test("parsed dates pass the validator", () => {
  for (const text of ["12 MAR 1931", "MAR 1931", "1931", "ABT 1931", "CAL 1931", "BET 1920 AND 1940", "31 FEB 1931", "@#DJULIAN@ 12 MAR 1931", "(unknown)", "3000"]) {
    const date = parseGedcomDate(text);
    assert.equal(validateField("person", "bd", date).ok, true, text);
  }
});

test("toGedcomDate reverses parseGedcomDate", () => {
  for (const text of ["12 MAR 1931", "5 JAN 1900", "MAR 1931", "1931", "ABT 1931", "BEF MAR 1931", "AFT 12 MAR 1931", "EST 1931", "BET 1920 AND 1940", "FROM 1920 TO 1930", "31 FEB 1931", "@#DJULIAN@ 12 MAR 1931"]) {
    assert.equal(toGedcomDate(parseGedcomDate(text)), text, text);
  }
  // CAL comes back as EST, and tidying is kept
  assert.equal(toGedcomDate(parseGedcomDate("cal 1931")), "EST 1931");
  assert.equal(toGedcomDate(parseGedcomDate("05 mar 1931")), "5 MAR 1931");
  // and the other direction
  for (const date of [{ y: 1931, m: 3, d: 12 }, { y: 1931, m: 3 }, { y: 1931 }, { y: 1931, q: "abt" }, { y: 1931, m: 3, q: "bef" }, { t: "see note" }]) {
    assert.deepEqual(parseGedcomDate(toGedcomDate(date)), date);
  }
  assert.equal(toGedcomDate(null), "");
  assert.equal(toGedcomDate({}), "");
});

test("sortYear is y, or the first four-digit number in t, or null", () => {
  assert.equal(sortYear({ y: 1931, m: 3 }), 1931);
  assert.equal(sortYear({ y: 1931, q: "abt" }), 1931);
  assert.equal(sortYear({ t: "around 1925, maybe 1926" }), 1925);
  assert.equal(sortYear({ t: "year 123 or 12345" }), null);
  assert.equal(sortYear({ t: "x1999y" }), 1999);
  assert.equal(sortYear({ y: 1931, t: "ABT 1940" }), 1931);
  assert.equal(sortYear(null), null);
  assert.equal(sortYear(undefined), null);
  assert.equal(sortYear({}), null);
});

test("isExact is false with q or t", () => {
  assert.equal(isExact({ y: 1931 }), true);
  assert.equal(isExact({ y: 1931, m: 3 }), true);
  assert.equal(isExact({ y: 1931, m: 3, d: 12 }), true);
  assert.equal(isExact({ y: 1931, q: "abt" }), false);
  assert.equal(isExact({ y: 1931, q: "est" }), false);
  assert.equal(isExact({ t: "BET 1920 AND 1940" }), false);
  assert.equal(isExact({ y: 1931, t: "x" }), false);
  assert.equal(isExact({}), false);
  assert.equal(isExact(null), false);
  assert.equal(isExact(undefined), false);
});

test("formatDate shows about and before in English and Macedonian", () => {
  assert.equal(formatDate({ y: 1931, q: "abt" }, "en"), "about 1931");
  assert.equal(formatDate({ y: 1931, m: 3, q: "bef" }, "en"), "before March 1931");
  assert.equal(formatDate({ y: 1931, m: 3, d: 12, q: "aft" }, "en"), "after 12 March 1931");
  assert.equal(formatDate({ y: 1931, q: "est" }, "en"), "est. 1931");
  assert.equal(formatDate({ y: 1931, m: 3, d: 12 }, "en"), "12 March 1931");
  assert.equal(formatDate({ y: 1931, m: 3 }, "en"), "March 1931");
  assert.equal(formatDate({ y: 1931 }, "en"), "1931");

  assert.equal(formatDate({ y: 1931, q: "abt" }, "mk"), "околу 1931");
  assert.equal(formatDate({ y: 1931, m: 3, q: "bef" }, "mk"), "пред март 1931");
  assert.equal(formatDate({ y: 1931, m: 3, d: 12, q: "aft" }, "mk"), "по 12 март 1931");
  assert.equal(formatDate({ y: 1931, q: "est" }, "mk"), "прибл. 1931");
  assert.equal(formatDate({ y: 1931, m: 3, d: 12 }, "mk"), "12 март 1931");
  const mkMonths = ["јануари", "февруари", "март", "април", "мај", "јуни", "јули", "август", "септември", "октомври", "ноември", "декември"];
  mkMonths.forEach((name, i) => assert.equal(formatDate({ y: 1950, m: i + 1 }, "mk"), `${name} 1950`));
  const enMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  enMonths.forEach((name, i) => assert.equal(formatDate({ y: 1950, m: i + 1 }, "en"), `${name} 1950`));

  // text is shown as written; no date is an empty string; an unknown language falls back to English
  assert.equal(formatDate({ t: "BET 1920 AND 1940" }, "mk"), "BET 1920 AND 1940");
  assert.equal(formatDate(null, "en"), "");
  assert.equal(formatDate({}, "en"), "");
  assert.equal(formatDate({ y: 1931, q: "abt" }, "fr"), "about 1931");
  assert.equal(formatDate({ y: 1931, q: "abt" }), "about 1931");
});
