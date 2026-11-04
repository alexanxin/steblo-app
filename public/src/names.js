// Names: the matching key (reference R9). Pure.
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
