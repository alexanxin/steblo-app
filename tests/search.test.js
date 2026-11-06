import { test } from "node:test";
import assert from "node:assert/strict";
import { searchPeople } from "../public/src/search.js";
import { makeTree } from "./fixtures/helpers.js";

function sample() {
  const h = makeTree();
  const danilo = h.add({ g: "Данило", s: "Новаков", bd: { y: 1950 } });
  const teodora = h.add({ g: "Теодора", s: "Новакова", bd: { y: 1952 } });
  const gjeko = h.add({ g: "Ѓеко", s: "Чарин" });
  return { view: h.tree.view(), danilo, teodora, gjeko };
}

test("Cyrillic and Latin spellings find the same person", () => {
  const { view, danilo, gjeko } = sample();
  assert.deepEqual(searchPeople(view, "Danilo").map(r => r.id), [danilo]);
  assert.deepEqual(searchPeople(view, "данило").map(r => r.id), [danilo]);
  assert.deepEqual(searchPeople(view, "Gjeko").map(r => r.id), [gjeko]);
  assert.deepEqual(searchPeople(view, "Carin").map(r => r.id), [gjeko]);
});

test("every word must match, a number matches the birth year, and a female surname form matches the male one", () => {
  const { view, danilo, teodora } = sample();
  assert.deepEqual(searchPeople(view, "novakov").map(r => r.id).sort(), [danilo, teodora].sort());
  assert.deepEqual(searchPeople(view, "novakov 1952").map(r => r.id), [teodora]);
  assert.deepEqual(searchPeople(view, "danilo teodora"), []);
  assert.deepEqual(searchPeople(view, "   "), []);
  assert.deepEqual(searchPeople(view, "dan").map(r => r.id), [danilo]); // a start of a name is enough
});
