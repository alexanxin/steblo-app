// Partial dates (reference R3 and R12 Dates). Pure.
// A date is { y?, m?, d?, q?, t? }: q is abt, bef, aft or est; t is text kept as written.

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const PREFIX = { ABT: "abt", BEF: "bef", AFT: "aft", EST: "est", CAL: "est" };
const SHAPE = /^(?:(ABT|BEF|AFT|EST|CAL)\s+)?(?:(?:(\d{1,2})\s+)?([A-Z]{3})\s+)?(\d{1,4})$/i;

const daysIn = (y, m) => (m === 2 ? (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);

/**
 * Read a GEDCOM date: `D MON YYYY`, `MON YYYY` or `YYYY`, optionally after ABT,
 * BEF, AFT, EST or CAL (CAL becomes est). Anything else, including impossible
 * days, years outside 1–2200 and ranges, is kept as { t } with white space tidied.
 * Returns null for no date. The text is not cut to 60 characters here; the
 * importer does that with sanitiseText("t", …) so it can count it.
 */
export function parseGedcomDate(text) {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
  if (!clean) return null;
  const match = SHAPE.exec(clean);
  if (match) {
    const [, prefix, day, monthName, year] = match;
    const y = Number(year);
    const month = monthName === undefined ? 0 : MONTHS.indexOf(monthName.toUpperCase()) + 1;
    const d = day === undefined ? undefined : Number(day);
    const monthOk = monthName === undefined || month > 0;
    if (monthOk && y >= 1 && y <= 2200 && (d === undefined || (d >= 1 && d <= daysIn(y, month)))) {
      const date = { y };
      if (month) date.m = month;
      if (d !== undefined) date.d = d;
      if (prefix) date.q = PREFIX[prefix.toUpperCase()];
      return date;
    }
  }
  return { t: clean };
}

/** The GEDCOM text for a date; text dates are written as they were kept. */
export function toGedcomDate(date) {
  if (!date) return "";
  if (date.t !== undefined) return date.t;
  if (date.y === undefined) return "";
  const parts = [];
  if (date.q) parts.push(date.q.toUpperCase());
  if (date.d !== undefined) parts.push(String(date.d));
  if (date.m !== undefined) parts.push(MONTHS[date.m - 1]);
  parts.push(String(date.y));
  return parts.join(" ");
}

/** y, or else the first four-digit number in t, or null. */
export function sortYear(date) {
  if (!date) return null;
  if (date.y !== undefined) return date.y;
  const found = typeof date.t === "string" ? /(?<!\d)\d{4}(?!\d)/.exec(date.t) : null;
  return found ? Number(found[0]) : null;
}

/** Exact means a year with no q and no t. A year alone is exact. */
export const isExact = date => !!date && date.y !== undefined && date.q === undefined && date.t === undefined;

const WORDS = {
  en: {
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    q: { abt: "about", bef: "before", aft: "after", est: "est." },
  },
  mk: {
    months: ["јануари", "февруари", "март", "април", "мај", "јуни", "јули", "август", "септември", "октомври", "ноември", "декември"],
    q: { abt: "околу", bef: "пред", aft: "по", est: "прибл." },
  },
};

/** A date as people read it, in "en" or "mk" (anything else reads as English). */
export function formatDate(date, lang = "en") {
  if (!date) return "";
  if (date.t !== undefined) return date.t;
  if (date.y === undefined) return "";
  const words = WORDS[lang] ?? WORDS.en;
  const parts = [];
  if (date.q) parts.push(words.q[date.q]);
  if (date.d !== undefined) parts.push(String(date.d));
  if (date.m !== undefined) parts.push(words.months[date.m - 1]);
  parts.push(String(date.y));
  return parts.join(" ");
}
