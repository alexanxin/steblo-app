import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A throwaway repo with the real script and an invented names list.
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "privacy-check-"));
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "public/src"), { recursive: true });
  copyFileSync(new URL("../scripts/privacy-check.mjs", import.meta.url), join(dir, "scripts/privacy-check.mjs"));
  copyFileSync(new URL("../public/src/names.js", import.meta.url), join(dir, "public/src/names.js"));
  writeFileSync(join(dir, "names.txt"), "Quorvin\nZelbrak\n");
  writeFileSync(join(dir, ".gitignore"), "names.txt\n");
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "dev");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  const write = (path, text) => writeFileSync(join(dir, path), text);
  const check = (args = [], input = "") => spawnSync("node", ["scripts/privacy-check.mjs", ...args], {
    cwd: dir, input, encoding: "utf8", env: { ...process.env, STEBLO_NAMES: join(dir, "names.txt") },
  }).status;
  return { dir, git, write, check, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("staged mode ignores names in files that aren't staged", () => {
  const s = sandbox();
  s.write("draft.txt", "Quorvin\n");
  s.write("clean.txt", "Danilo\n");
  s.git("add", "clean.txt");
  assert.equal(s.check(["--staged"]), 0);
  assert.equal(s.check(), 1, "the working-tree mode still sees the draft");
  s.done();
});

test("staged mode checks the staged version, not the working copy", () => {
  const s = sandbox();
  s.write("notes.txt", "Zelbrak\n");
  s.git("add", "notes.txt");
  s.write("notes.txt", "Ema\n");
  assert.equal(s.check(["--staged"]), 1);
  s.done();
});

test("push mode catches a name committed and later deleted", () => {
  const s = sandbox();
  s.write("a.txt", "Teodora\n");
  s.git("add", "a.txt", "scripts", "public", ".gitignore");
  s.git("commit", "-q", "-m", "one");
  s.write("a.txt", "Quorvin\n");
  s.git("commit", "-q", "-am", "two");
  s.write("a.txt", "Teodora\n");
  s.git("commit", "-q", "-am", "three");
  const head = s.git("rev-parse", "HEAD").trim(), zero = "0".repeat(40);
  assert.equal(s.check(["--push"], `refs/heads/dev ${head} refs/heads/dev ${zero}\n`), 1);
  s.done();
});

test("push mode passes clean commits and ignores working-tree drafts", () => {
  const s = sandbox();
  s.write("a.txt", "Miro\n");
  s.git("add", "a.txt", "scripts", "public", ".gitignore");
  s.git("commit", "-q", "-m", "one");
  const first = s.git("rev-parse", "HEAD").trim();
  s.write("b.txt", "Lea\n");
  s.git("add", "b.txt");
  s.git("commit", "-q", "-m", "two");
  s.write("draft.txt", "Zelbrak\n");
  const head = s.git("rev-parse", "HEAD").trim();
  assert.equal(s.check(["--push"], `refs/heads/dev ${head} refs/heads/dev ${first}\n`), 0);
  s.done();
});
