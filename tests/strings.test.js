// The UI strings: every language file has the same keys, and every key the UI code asks for exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { guessLanguage } from "../public/ui/i18n.js";

const dir = new URL("../public/", import.meta.url);
const load = lang => JSON.parse(readFileSync(new URL(`strings/${lang}.json`, dir), "utf8"));
const languages = readdirSync(new URL("strings/", dir)).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));

// keys built from a variable: the values the code can put there
const DYNAMIC = {
  "date.${v}": ["abt", "bef", "aft", "est"],
  "dup.${d.relation}": ["parent", "partner", "child"],
  "form.add.${relation}": ["parent", "child", "partner", "sibling"],
  "history.action.${g.action}": ["add", "edit", "delete", "restore", "merge", "notsame", "erase", "undo", "sync", "import", "restamp"],
  "join.asks.${q.relation}": ["parent", "partner", "child"],
  "join.autoRel.${e.relation}": ["parent", "partner", "child"],
  "lang.${v}": ["en", "mk"],
  "link.pick.${role}": ["parent", "child", "partner"],
  "same.reason.${r}": ["sex", "years", "related", "notsame", "same", "missing", "partners", "siblings"],
  "sex.${f.sx}": ["M", "F", "X", "U"],
  "sex.${v}": ["M", "F", "X", "U"],
};

function usedKeys() {
  const keys = new Set();
  for (const file of readdirSync(new URL("ui/", dir)).filter(f => f.endsWith(".js"))) {
    const source = readFileSync(new URL(`ui/${file}`, dir), "utf8");
    for (const m of source.matchAll(/(?<![\w.])(?:t|field|dateField|row)\(\s*[`"]([a-z][\w.${}]*)[`"]/g)) keys.add(m[1]);
  }
  const html = readFileSync(new URL("index.html", dir), "utf8");
  for (const m of html.matchAll(/data-i18n(?:-label|-tip|-ph)?="([^"]+)"/g)) keys.add(m[1]);
  return keys;
}

test("every language file has the same keys as English", () => {
  const english = Object.keys(load("en")).sort();
  assert.ok(languages.includes("en") && languages.includes("mk"));
  for (const lang of languages) {
    const keys = Object.keys(load(lang)).sort();
    assert.deepEqual(keys.filter(k => !english.includes(k)), [], `${lang} has keys English lacks`);
    assert.deepEqual(english.filter(k => !keys.includes(k)), [], `${lang} lacks keys`);
    // the same {placeholders} in every language
    const en = load("en");
    const other = load(lang);
    for (const key of english) {
      const marks = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
      assert.equal(marks(other[key]), marks(en[key]), `${lang}: placeholders of ${key}`);
    }
  }
});

test("every key the UI code uses exists in English", () => {
  const en = load("en");
  for (const key of usedKeys()) {
    const variants = key.includes("${") ? DYNAMIC[key]?.map(v => key.replace(/\$\{[^}]+\}/, v)) : [key];
    assert.ok(variants, `unknown dynamic key ${key}: list its values in this test`);
    for (const k of variants) assert.ok(k in en, `missing string: ${k}`);
  }
});

test("the phone's language picks the strings, English otherwise", () => {
  assert.equal(guessLanguage(["mk-MK", "en"]), "mk");
  assert.equal(guessLanguage(["de-DE", "en-US"]), "en");
  assert.equal(guessLanguage(["sr", "mk"]), "mk");
  assert.equal(guessLanguage([]), "en");
});
