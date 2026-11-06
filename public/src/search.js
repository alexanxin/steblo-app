// Search by name in either alphabet (story 25). Pure: a function of view().people.
// A query is words; each word must start some word of the person's name (given, surname, birth surname),
// compared by matching key, so "Данило", "Danilo" and "danilo" find the same person. A number matches the birth year.
import { matchKey } from "./names.js";
import { sortYear } from "./dates.js";

const words = s => String(s || "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The people whose names match, best first: [{ id, score }]. */
export function searchPeople(view, query, limit = 30) {
  const tokens = words(query).map(w => (/^\d+$/.test(w) ? { year: w } : { key: matchKey(w) })).filter(t => t.year || t.key);
  if (tokens.length === 0) return [];
  const found = [];
  for (const person of view.people.values()) {
    const f = person.f;
    const nameKeys = [...words(f.g), ...words(f.s), ...words(f.bs)].map(matchKey).filter(Boolean);
    const year = f.bd ? sortYear(f.bd) : null;
    let score = 0;
    let ok = true;
    for (const token of tokens) {
      if (token.year) {
        if (year !== null && String(year).startsWith(token.year)) score += 1;
        else { ok = false; break; }
      } else {
        const exact = nameKeys.some(k => k === token.key);
        if (exact) score += 3;
        else if (nameKeys.some(k => k.startsWith(token.key))) score += 2;
        else { ok = false; break; }
      }
    }
    if (ok) found.push({ id: person.id, score });
  }
  found.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return found.slice(0, limit);
}
