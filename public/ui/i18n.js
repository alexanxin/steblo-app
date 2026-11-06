// UI text: one JSON file per language in strings/. A missing key falls back to English, then to the key itself.
// "Show in Latin letters" runs Cyrillic through toLatin, for the Macedonian UI and for names (story 26).
import { toLatin } from "../src/names.js";

export const LANGUAGES = ["en", "mk"];
const cache = new Map();

async function fetchStrings(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const response = await fetch(`strings/${lang}.json`);
  if (!response.ok) throw new Error(`could not load the ${lang} strings`);
  const strings = await response.json();
  cache.set(lang, strings);
  return strings;
}

/** The language to start in: the phone's language if we have it, else English. */
export function guessLanguage(navigatorLanguages = []) {
  for (const tag of navigatorLanguages) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (LANGUAGES.includes(base)) return base;
  }
  return "en";
}

export async function createI18n({ lang = "en", latin = false } = {}) {
  const english = await fetchStrings("en");
  let strings = lang === "en" ? english : await fetchStrings(lang);
  const state = { lang, latin };

  const i18n = {
    get lang() { return state.lang; },
    get latin() { return state.latin; },
    async set({ lang: nextLang = state.lang, latin: nextLatin = state.latin }) {
      if (nextLang !== state.lang) strings = nextLang === "en" ? english : await fetchStrings(nextLang);
      state.lang = nextLang;
      state.latin = nextLatin;
    },
    /** Names and any other user text. */
    text: s => (state.latin ? toLatin(s ?? "") : s ?? ""),
    /** UI text with {name} placeholders. */
    t(key, vars) {
      let s = strings[key] ?? english[key] ?? key;
      if (vars) for (const [name, value] of Object.entries(vars)) s = s.replaceAll(`{${name}}`, String(value));
      return state.latin ? toLatin(s) : s;
    },
    /** Fill every element marked with data-i18n (text), data-i18n-label (aria-label), data-i18n-tip, data-i18n-ph. */
    apply(root = document) {
      document.documentElement.lang = state.lang === "mk" && state.latin ? "mk-Latn" : state.lang;
      for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = i18n.t(el.dataset.i18n);
      for (const el of root.querySelectorAll("[data-i18n-label]")) el.setAttribute("aria-label", i18n.t(el.dataset.i18nLabel));
      for (const el of root.querySelectorAll("[data-i18n-tip]")) el.dataset.tip = i18n.t(el.dataset.i18nTip);
      for (const el of root.querySelectorAll("[data-i18n-ph]")) el.placeholder = i18n.t(el.dataset.i18nPh);
    },
  };
  return i18n;
}
