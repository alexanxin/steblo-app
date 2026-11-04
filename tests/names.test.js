import test from "node:test";
import assert from "node:assert/strict";
import { matchKey } from "../public/src/names.js";

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
