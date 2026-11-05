#!/usr/bin/env node
// Fails if text contains a word whose matching key is on a names list kept outside the repo.
// Usage: STEBLO_NAMES=/path/to/names.txt node scripts/privacy-check.mjs [--staged | --push | file]
//   no argument: every tracked or new file in the working tree
//   --staged: the staged version of each staged file (pre-commit hook)
//   --push: every file version in the commits being pushed, refs read from stdin (pre-push hook),
//           so a name committed and later deleted is still caught
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

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
const lines = text => text.split("\n").filter(Boolean);
const ZERO = /^0+$/;

/** What to check: [{ path, label, read() }]. */
function sources(mode) {
  if (mode === "--staged") {
    return lines(git("diff", "--cached", "--name-only", "--diff-filter=ACMR"))
      .map(path => ({ path, label: path, read: () => git("show", `:${path}`) }));
  }
  if (mode === "--push") {
    const out = [];
    for (const line of lines(readFileSync(0, "utf8"))) {
      const [, local, , remote] = line.split(" ");
      if (!local || ZERO.test(local)) continue; // a branch being deleted
      let commits;
      try { commits = git("rev-list", ...(ZERO.test(remote) ? [local, "--not", "--remotes"] : [`${remote}..${local}`])); }
      catch { commits = git("rev-list", local, "--not", "--remotes"); } // remote commit not known here
      for (const commit of lines(commits)) {
        for (const path of lines(git("diff-tree", "-r", "--root", "--no-commit-id", "--name-only", "--diff-filter=ACMR", commit))) {
          out.push({ path, label: `${commit.slice(0, 7)}:${path}`, read: () => git("show", `${commit}:${path}`) });
        }
      }
    }
    return out;
  }
  const files = mode ? [mode] : lines(git("ls-files", "--cached", "--others", "--exclude-standard"));
  return files.filter(path => existsSync(path)).map(path => ({ path, label: path, read: () => readFileSync(path, "utf8") }));
}

const BINARY = /\.(png|jpg|ico|woff2?|wasm)$/;
const checked = sources(process.argv[2]).filter(s => !BINARY.test(s.path) && !s.path.startsWith("public/vendor/"));
let hits = 0;
for (const source of checked) {
  source.read().split("\n").forEach((text, i) => {
    for (const word of text.match(/\p{L}+/gu) ?? []) {
      const k = matchKey(word);
      if (k.length >= 3 && keys.has(k) && !allow.has(k)) { console.log(`${source.label}:${i + 1}: ${word}`); hits += 1; }
    }
  });
}
if (hits) { console.error(`privacy-check: ${hits} word(s) match the names list.`); process.exit(1); }
console.log(`privacy-check: clean (${checked.length} files).`);
