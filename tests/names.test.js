import test from "node:test";
import assert from "node:assert/strict";
import { matchKey, toLatin, baseSurname, formFor, genderOf, isPlaceholder, givenRelation } from "../public/src/names.js";

test("matchKey folds alphabets and spellings", () => {
  for (const name of ["Ѓеко", "Gjeko", "Ǵeko", "Đeko", "Djeko", "Ǵeko"]) assert.equal(matchKey(name), "geko", name);
  for (const name of ["Чарин", "Čarin", "Charin", "Carin"]) assert.equal(matchKey(name), "carin", name);
  assert.equal(matchKey("Данило"), matchKey("Danilo"));
  assert.equal(matchKey("Новаков"), "novakov");
  for (const name of ["Џо", "Džo", "Dzho", "Dzo"]) assert.equal(matchKey(name), "dzo", name);
});

test("matchKey is empty for other scripts and for no name", () => {
  for (const name of ["日本", "?", "", null, undefined]) assert.equal(matchKey(name), "");
});

test("toLatin follows the Macedonian table", () => {
  assert.equal(toLatin("Теодора"), "Teodora");
  assert.equal(toLatin("Данило Новаков"), "Danilo Novakov");
  assert.equal(toLatin("ѓ ќ ж ч ш џ љ њ ѕ"), "ǵ ḱ ž č š dž lj nj dz");
  assert.equal(toLatin("Ѓеко"), "Ǵeko");
  assert.equal(toLatin("Чарин"), "Čarin");
  // a capital that starts a digraph keeps only its first letter capital; in capitals both are
  assert.equal(toLatin("Џо"), "Džo");
  assert.equal(toLatin("ЏО"), "DŽO");
  assert.equal(toLatin("ЛЕА"), "LEA");
  // other letters are left alone
  assert.equal(toLatin("Lea 1931 日本"), "Lea 1931 日本");
  assert.equal(toLatin(""), "");
  assert.equal(toLatin(null), "");
  assert.equal(toLatin(undefined), "");
});

test("baseSurname reduces both alphabets", () => {
  assert.equal(baseSurname("Новакова"), "Новаков");
  assert.equal(baseSurname("Novakova"), "Novakov");
  assert.equal(baseSurname("Даниловска"), "Даниловски");
  assert.equal(baseSurname("Danilovska"), "Danilovski");
  assert.equal(baseSurname("Адамева"), "Адамев");
  assert.equal(baseSurname("Adameva"), "Adamev");
  assert.equal(baseSurname("Емацка"), "Емацки");
  assert.equal(baseSurname("Emacka"), "Emacki");
  // male forms and names with no such ending stay as they are
  for (const same of ["Новаков", "Novakov", "Даниловски", "Чарин", "Čarin", "Ѓеко", "Gjeko", ""]) assert.equal(baseSurname(same), same);
  // case follows the last letter; each word of a compound is reduced
  assert.equal(baseSurname("НОВАКОВА"), "НОВАКОВ");
  assert.equal(baseSurname("Новакова-Даниловска"), "Новаков-Даниловски");
  assert.equal(baseSurname("Чарин Новакова"), "Чарин Новаков");
  assert.equal(baseSurname(null), "");
  assert.equal(baseSurname(undefined), "");
});

test("the stem guard keeps short names", () => {
  // at least two letters must stay before the ending
  assert.equal(baseSurname("Ова"), "Ова");
  assert.equal(baseSurname("Ova"), "Ova");
  assert.equal(baseSurname("Нова"), "Нова");
  assert.equal(baseSurname("Nova"), "Nova");
  assert.equal(baseSurname("Ева"), "Ева");
  assert.equal(baseSurname("Eva"), "Eva");
  assert.equal(formFor("Ов", "F"), "Ов");
  assert.equal(formFor("Ov", "F"), "Ov");
  assert.equal(genderOf("Ова"), null);
  assert.equal(genderOf("Ov"), null);
  assert.equal(genderOf("Eva"), null);
  // with two letters before the ending it applies
  assert.equal(baseSurname("Лиова"), "Лиов");
  assert.equal(formFor("Лиов", "F"), "Лиова");
});

test("formFor gives the form for a sex in either alphabet", () => {
  assert.equal(formFor("Новаков", "F"), "Новакова");
  assert.equal(formFor("Новакова", "F"), "Новакова");
  assert.equal(formFor("Новакова", "M"), "Новаков");
  assert.equal(formFor("Novakov", "F"), "Novakova");
  assert.equal(formFor("Novakova", "M"), "Novakov");
  assert.equal(formFor("Даниловски", "F"), "Даниловска");
  assert.equal(formFor("Даниловска", "F"), "Даниловска");
  assert.equal(formFor("Danilovski", "F"), "Danilovska");
  assert.equal(formFor("Адамев", "F"), "Адамева");
  assert.equal(formFor("Adamev", "F"), "Adameva");
  assert.equal(formFor("Емацки", "F"), "Емацка");
  assert.equal(formFor("Emacki", "F"), "Emacka");
  assert.equal(formFor("НОВАКОВ", "F"), "НОВАКОВА");
  assert.equal(formFor("Новаков-Даниловски", "F"), "Новакова-Даниловска");
  // a surname with no such ending has one form
  assert.equal(formFor("Чарин", "F"), "Чарин");
  assert.equal(formFor("Čarin", "M"), "Čarin");
  // unknown sex or no sex: unchanged
  for (const sex of ["X", "U", undefined, null, ""]) {
    assert.equal(formFor("Новакова", sex), "Новакова", String(sex));
    assert.equal(formFor("Новаков", sex), "Новаков", String(sex));
  }
  assert.equal(formFor("", "F"), "");
  assert.equal(formFor(null, "F"), "");
});

test("genderOf reads sex from a surname ending, in either alphabet", () => {
  for (const f of ["Новакова", "Novakova", "Даниловска", "Danilovska", "Адамева", "Adameva", "Емацка", "Emacka", "НОВАКОВА", "Чарин-Новакова"]) assert.equal(genderOf(f), "F", f);
  for (const m of ["Новаков", "Novakov", "Даниловски", "Danilovski", "Адамев", "Adamev", "Емацки", "Emacki", "Новаков Чарин-Даниловски"]) assert.equal(genderOf(m), "M", m);
  for (const none of ["Чарин", "Čarin", "Ѓеко", "Gjeko", "", null, undefined, "1931", "日本"]) assert.equal(genderOf(none), null, String(none));
  // the last word decides
  assert.equal(genderOf("Новакова Чарин"), null);
});

test("isPlaceholder catches empty, ?, other scripts and descriptive words", () => {
  for (const name of ["", "  ", "?", "??", "日本", null, undefined, "Жена на Данило", "Wife of Danilo", "Husband of Teodora", "Son of Miro", "Daughter", "Child", "unknown", "Unknown Novakov", "Маж на Теодора", "Син на Данило", "Ќерка на Миро", "Дете", "Прва жена", "Втора жена", "Zhena na Danilo", "Kjerka na Miro", "Prva zena", "Vtora zena", "Maz", "Sin", "Dete", "Danilo's wife", "Wife-of-Danilo"]) {
    assert.equal(isPlaceholder(name), true, String(name));
  }
  for (const name of ["Данило", "Teodora", "Миро", "Ema", "Adam", "Леа", "Ѓеко", "Gjeko", "Чарин", "Čarin", "Данило Новаков", "Миросин", "Адамдете"]) {
    assert.equal(isPlaceholder(name), false, name);
  }
});

test("givenRelation", () => {
  // same: equal keys, whatever the alphabet or spelling
  assert.equal(givenRelation("Ема", "Ema"), "same");
  assert.equal(givenRelation("Данило", "Danilo"), "same");
  assert.equal(givenRelation("Ѓеко", "Gjeko"), "same");
  assert.equal(givenRelation("Чарин", "Čarin"), "same");
  assert.equal(givenRelation("Miro", "Miro"), "same");
  // close: both keys have 4 or more letters, one edit apart
  assert.equal(givenRelation("Teodora", "Teodara"), "close");   // one letter changed
  assert.equal(givenRelation("Теодора", "Teodra"), "close");    // one letter missing
  assert.equal(givenRelation("Danilo", "Daniilo"), "close");    // one letter added
  assert.equal(givenRelation("Adam", "Adan"), "close");         // the shortest that can be close
  // different
  assert.equal(givenRelation("Danilo", "Teodora"), "different");
  assert.equal(givenRelation("Teodora", "Teadaro"), "different"); // three letters changed
  assert.equal(givenRelation("Danilo", "Denila"), "different");    // two letters changed
});

test("short names are never close", () => {
  // 3 letters each, one edit apart
  assert.equal(givenRelation("Ema", "Eva"), "different");
  assert.equal(givenRelation("Lea", "Leo"), "different");
  // one key has only 3 letters
  assert.equal(givenRelation("Ema", "Emma"), "different");
  assert.equal(givenRelation("Miro", "Mir"), "different");
  // 4 letters on both sides is enough
  assert.equal(givenRelation("Miro", "Miru"), "close");
  assert.equal(givenRelation("Miro", "Mirco"), "close");
  // two edits are not close
  assert.equal(givenRelation("Miro", "Teodora"), "different");
});

test("a placeholder is never same, even with an equal key", () => {
  assert.equal(givenRelation("Жена на Данило", "Жена на Данило"), "placeholder");
  assert.equal(givenRelation("Wife of Danilo", "Жена на Данило"), "placeholder");
  assert.equal(givenRelation("?", "?"), "placeholder");
  assert.equal(givenRelation("", ""), "placeholder");
  assert.equal(givenRelation("日本", "日本"), "placeholder");
  assert.equal(givenRelation("Ema", "?"), "placeholder");
  assert.equal(givenRelation("Жена", "Ема"), "placeholder");
  assert.equal(givenRelation("Ема", null), "placeholder");
});
