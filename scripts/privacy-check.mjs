#!/usr/bin/env node
// Fails if a tracked file contains a word whose matching key is on a names list kept
// outside the repo. Usage: STEBLO_NAMES=/path/to/names.txt node scripts/privacy-check.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { matchKey } from "../public/src/names.js";

const list = process.env.STEBLO_NAMES;
if (!list || !existsSync(list)) {
  console.error("privacy-check: set STEBLO_NAMES to the names list (kept outside the repo).");
  process.exit(2);
}
const keys = new Set(readFileSync(list, "utf8").split("\n").map(matchKey).filter(k => k.length >= 3));
const allowFile = new URL("./privacy-allow.txt", import.meta.url);
const allow = new Set(existsSync(allowFile) ? readFileSync(allowFile, "utf8").split("\n").map(matchKey) : []);
const files = (process.argv[2] ? [process.argv[2]] : execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n")).filter(f => f && existsSync(f));
const BINARY = /\.(png|jpg|ico|woff2?|wasm)$/;
let hits = 0;
for (const file of files) {
  if (BINARY.test(file) || file.startsWith("public/vendor/")) continue;
  readFileSync(file, "utf8").split("\n").forEach((text, i) => {
    for (const word of text.match(/\p{L}+/gu) ?? []) {
      const k = matchKey(word);
      if (k.length >= 3 && keys.has(k) && !allow.has(k)) { console.log(`${file}:${i + 1}: ${word}`); hits += 1; }
    }
  });
}
if (hits) { console.error(`privacy-check: ${hits} word(s) match the names list.`); process.exit(1); }
console.log(`privacy-check: clean (${files.length} files).`);
