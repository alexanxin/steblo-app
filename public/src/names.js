// Names: the matching key, surname forms and given-name relations (reference R9). Pure.
const LETTER = {
  џ: "dz", ѕ: "dz", ѓ: "g", ђ: "g", ǵ: "g", đ: "g", ќ: "k", ћ: "k", ḱ: "k", ć: "k",
  ж: "z", ž: "z", ш: "s", щ: "s", š: "s", ч: "c", č: "c", љ: "l", њ: "n",
  я: "ja", ю: "ju", ј: "j", й: "j", ы: "i", ё: "e", э: "e", ъ: "", ь: "",
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", з: "z", и: "i", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
};
const DIGRAPHS = [["dzh", "dz"], ["gj", "g"], ["dj", "g"], ["kj", "k"], ["zh", "z"], ["sh", "s"], ["ch", "c"], ["lj", "l"], ["nj", "n"]];

export function matchKey(name) {
  let out = "";
  for (const ch of (name ?? "").normalize("NFC").toLowerCase()) out += LETTER[ch] ?? ch;
  for (const [from, to] of DIGRAPHS) out = out.replaceAll(from, to);
  return out.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z]/g, "");
}

// ---------------------------------------------------------------- Cyrillic → Latin
// Ported from the private app's shared rules (Macedonian table, surname endings),
// with Latin endings added and the examples replaced by invented names.

const CYR = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ѓ: "ǵ", е: "e", ж: "ž", з: "z", ѕ: "dz", и: "i", ј: "j",
  к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ќ: "ḱ",
  у: "u", ф: "f", х: "h", ц: "c", ч: "č", џ: "dž", ш: "š",
};

export function toLatin(s) {
  const chars = [...(s || "")];
  return chars.map((ch, i) => {
    const low = ch.toLowerCase();
    const m = CYR[low];
    if (m === undefined) return ch;
    if (ch === low) return m;
    const near = chars[i + 1] || chars[i - 1] || "";
    const wordIsCaps = near !== near.toLowerCase();
    return wordIsCaps ? m.toUpperCase() : m[0].toUpperCase() + m.slice(1);
  }).join("");
}

// [male ending, female ending], Cyrillic then Latin:
// НОВАКОВ / НОВАКОВА, АДАМЕВ / АДАМЕВА, ДАНИЛОВСКИ / ДАНИЛОВСКА, EMACKI / EMACKA
const ENDINGS = [
  ["СКИ", "СКА"], ["ЦКИ", "ЦКА"], ["ОВ", "ОВА"], ["ЕВ", "ЕВА"],
  ["SKI", "SKA"], ["CKI", "CKA"], ["OV", "OVA"], ["EV", "EVA"],
];
const WORD = /\p{L}+/gu;

// At least two letters must stay before the ending ("Ова" is a name, not a surname form).
function swapEnding(word, toMale) {
  const up = word.toUpperCase();
  for (const [m, f] of ENDINGS) {
    const [from, to] = toMale ? [f, m] : [m, f];
    if (up.endsWith(from) && up.length > from.length + 1) {
      const last = word[word.length - 1];
      return word.slice(0, word.length - from.length) + (last === last.toUpperCase() ? to : to.toLowerCase());
    }
  }
  return word;
}

/** The male form, which is what identifies a surname. */
export const baseSurname = s => (s || "").replace(WORD, w => swapEnding(w, true));

/** The surname in the form for this sex ("M", "F"); unchanged if unknown. */
export function formFor(s, sex) {
  if (sex === "F") return baseSurname(s).replace(WORD, w => swapEnding(w, false));
  if (sex === "M") return baseSurname(s);
  return s || "";
}

/** "F" or "M" if the surname's ending says so, else null. */
export function genderOf(s) {
  const words = (s || "").match(WORD);
  if (!words) return null;
  const up = words[words.length - 1].toUpperCase();
  for (const [m, f] of ENDINGS) {
    if (up.endsWith(f) && up.length > f.length + 1) return "F";
    if (up.endsWith(m) && up.length > m.length + 1) return "M";
  }
  return null;
}

// ---------------------------------------------------------------- given names (R9)

// Words that describe a relation instead of naming someone, compared by matching key
// so every spelling in either alphabet is caught.
const DESCRIPTIVE = new Set(
  ["wife", "husband", "son", "daughter", "child", "unknown", "жена", "маж", "син", "ќерка", "дете", "прва", "втора"].map(matchKey),
);

/** True for no name, "?", a name in another script, or a descriptive word ("Wife of Danilo"). */
export function isPlaceholder(name) {
  if (typeof name !== "string" || matchKey(name) === "") return true;
  return name.split(/[^\p{L}]+/u).some(word => word && DESCRIPTIVE.has(matchKey(word)));
}

function oneEditApart(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.slice(i) === long.slice(i + 1);
}

/**
 * How two given names relate: "placeholder" (either is one; never same, even equal),
 * "same" (equal keys), "close" (both keys 4+ letters, one edit apart) or "different".
 */
export function givenRelation(a, b) {
  if (isPlaceholder(a) || isPlaceholder(b)) return "placeholder";
  const x = matchKey(a);
  const y = matchKey(b);
  if (x === y) return "same";
  return x.length >= 4 && y.length >= 4 && oneEditApart(x, y) ? "close" : "different";
}
