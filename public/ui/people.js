// How a person is shown: names, years, one-line labels. Reads view().people; user text goes through ctx.text (Latin switch).
import { sortYear, formatDate } from "../src/dates.js";
import { isPlaceholder } from "../src/names.js";

const yearOf = date => {
  const y = date ? sortYear(date) : null;
  return y === null || y === undefined || y === Infinity ? "" : String(y);
};

export function lifespan(f) {
  const b = yearOf(f.bd);
  const d = yearOf(f.dd);
  if (b && d) return `${b}–${d}`;
  if (b) return `* ${b}`;
  if (d) return `† ${d}`;
  return "";
}

/** What a card needs: given name, surname, years, sex, and whether the name is only a placeholder. */
export function personInfo(ctx, id, extra = {}) {
  const person = ctx.view.people.get(id) || ctx.view.deleted.get(id);
  const f = person ? person.f : {};
  const given = ctx.text(f.g || "") || "?";
  return {
    given,
    surname: ctx.text(f.s || ""),
    span: lifespan(f),
    birthYear: Number(yearOf(f.bd)) || null,
    sex: f.sx,
    vague: isPlaceholder(f.g),
    ...extra,
  };
}

export function fullName(ctx, id) {
  const info = personInfo(ctx, id);
  return `${info.given} ${info.surname}`.trim();
}

/** "Ema Novakova * 1950" for lists. */
export function label(ctx, id) {
  const info = personInfo(ctx, id);
  return [fullName(ctx, id), info.span].filter(Boolean).join("  ");
}

export const dateText = (ctx, date) => ctx.text(formatDate(date, ctx.i18n.lang));
export const birthYear = f => yearOf(f.bd);
