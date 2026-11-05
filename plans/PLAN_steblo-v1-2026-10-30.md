# Steblo v1 Implementation Plan

> **Source design:** [docs/specs/2026-10-30-steblo-v1-design.md](../docs/specs/2026-10-30-steblo-v1-design.md). Exact rules: [reference spec](../docs/specs/2026-10-30-steblo-v1-reference.md) (R1–R17). Stories: `.scratch/steblo-v1/spec.md`. Terms: `GLOSSARY.md`.

**Goal:** A free, installable PWA where relatives build a family tree on their own phones and combine it by QR code, with no server.

**Architecture:** A pure JavaScript core (records, later-wins rule, sync, join, GEDCOM, backup), tested in Node, with a thin browser layer (IndexedDB, camera, DOM). It ships as static files with no build step.

**Tech Stack:** Vanilla ES modules, Node 26 built-in test runner, IndexedDB, WebCrypto, CompressionStream, Vercel static hosting. Vendored: qrcode-generator 2.0.4 (MIT), jsQR 1.4.0 (Apache-2.0). Dev only: fake-indexeddb 6.2.5 (Apache-2.0).

## How to read this plan

**Milestone 0 is complete and runnable.** Its code was executed before it was written here: 18 tests passed on three runs in a row (Node 26.12.1). The 4 privacy-check tests were added on 2026-11-05. The spike page was only syntax-checked. It has never run in a browser.

**Milestones 1–8 are specified, not coded.** Each task names its files, its interface, the reference section that decides every rule, and its tests with expected results. Full code for those is written when each milestone starts. This is a deliberate departure from "complete code in every task", for two reasons: the spike can change formats, and pasting about 6,000 lines of code here would mean building the app twice. No design decision is left open: where a task doesn't state a rule, the reference spec does.

## Global Constraints

- **Commits:** Alex confirms before any commit or push. A task's commit step means "commit once Alex has given the go-ahead for this milestone". All work is on the `dev` branch.
- **GitHub and Vercel:** nothing is created or deployed without Alex's explicit go-ahead. Task 0.9 is the first such point. Vercel's production branch is `main`, which doesn't exist until task 8.4, so nothing reaches `steblo-app.vercel.app` before go-live. Phones use the public preview of `dev`.
- **Privacy:** no real family data, real names or private-repo history enters this repo. Fixtures use only: Danilo/Данило, Teodora/Теодора, Miro, Ema, Adam, Lea, Novakov/Новаков, Ѓеко/Gjeko, Чарин/Čarin. `privacy-check` must pass before every commit.
- **Private app:** read only, at `~/Desktop/Raboten/Стебло`. Never modify it. Never copy from its `data/` or `source/`. The one permitted read of its data is task 0.3 step 3, which writes the names list outside the repo; task 8.1 is the only other use, and it commits nothing.
- **Node:** version 26 or newer (`engines` in `package.json`). Checked on 26.12.1. Node 22 and 24 are untested.
- **Dependencies:** no runtime npm dependencies. Vendored files are pinned with hashes. New versions must be at least two weeks old, installed with `--ignore-scripts`. fake-indexeddb 6.2.7 and 6.2.6 are too new (2026-10-30 and 2026-10-16), so 6.2.5 is used.
- **Layout:** everything served lives in `public/`. Pure modules: `public/src/`. Browser modules: `public/ui/`. Tests import from `../public/src/`; storage tests import from `../public/ui/storage.js`.
- **Pure modules** use no `window`, `document`, `indexedDB` or `localStorage`.
- **UI text** goes through the strings files. **User text** goes through `textContent`, never `innerHTML`.
- **Style:** match the private app: two-space indent, double quotes, short comments that explain why.
- **Verified, inferred, assumed:**
  - Verified by running: payload sizes, frame and QR round trips, the cyclic and LT simulation, npm versions and hashes.
  - Assumed until the spike: phone QR speed, Wake Lock, file save and storage isolation on installed apps.
  - Settled 2026-11-05: the repo is `alexanxin/steblo-app` on Alex's personal account, which a Hobby Vercel account can import.
- **Goldfish review:** readiness review run on this plan; see `PLAN_steblo-v1-2026-10-30.review.md`.

## File Map

| File | Milestone | Responsibility |
|---|---|---|
| `package.json`, `.gitignore`, `LICENSE`, `README.md`, `vercel.json` | 0, 7 | Project setup, headers |
| `scripts/privacy-check.mjs`, `scripts/privacy-allow.txt` | 0 | Name leak check |
| `public/vendor/*` | 0 | Vendored QR libraries, hashes, licences |
| `public/src/names.js` | 0, 1 | Matching key; surname forms; name relations |
| `public/src/frames.js`, `base45.js`, `lt.js`, `qrcodec.js` | 0 | Bytes ⇄ QR frames |
| `public/spike/*` | 0 | Throwaway measuring page, deleted in task 6.1 |
| `public/src/clock.js` | 1 | Times and ordering |
| `public/src/records.js` | 1 | Record kinds, validator, later-wins rule |
| `public/src/dates.js` | 1 | Partial dates |
| `public/src/tree.js` | 1 | Operations, `view()` |
| `public/src/sets.js` | 1 | Union-find and set resolution, shared by `tree.js` and `history.js` |
| `public/src/history.js` | 1 | Change groups, undo, scrubbing |
| `public/src/sync.js` | 2 | Hello, hashes, payload, apply, re-stamp |
| `public/src/envelope.js` | 2 | Encryption |
| `public/src/join.js` | 3 | Walk and match rules |
| `public/src/gedcom.js` | 4 | Import, export |
| `public/src/backup.js` | 4 | Backup and restore |
| `public/src/layout.js` | 5 | Hourglass and whole-tree layout, pure |
| `scripts/make-fixture.mjs` | 4 | Writes an invented backup file for the phones |
| `public/ui/storage.js` | 5 | IndexedDB, transactions, migrations |
| `public/ui/app.js`, `render.js`, `forms.js`, `screens.js`, `i18n.js` | 5 | App shell and screens |
| `public/strings/en.json`, `mk.json` | 5 | UI text |
| `public/index.html`, `style.css`, `motion.css`, `manifest.webmanifest`, `icons/*` | 5 | Page and styling |
| `public/ui/scanner.js`, `decode-worker.js`, `display.js`, `sync-screens.js`, `join-screens.js` | 6 | Camera, code display, guided flows |
| `public/sw.js`, `public/sw-files.js`, `scripts/release.mjs` | 7 | Offline and updates |
| `CONTRIBUTING.md` | 7 | How to run tests, add a language |
| `tests/*.test.js`, `tests/fixtures/*` | all | Tests; `tests/fixtures/tree.js` is the invented-tree generator |
| `docs/specs/spike-results.md`, `docs/hand-check.md` | 0, 5–7 | Spike numbers; hand-check list |

## Interfaces between milestones

Milestones 1–8 build to these shapes and signatures. `async` marks everything that uses `crypto.subtle` or streams. Pure modules use WebCrypto's SHA-256 (async); there is no sync SHA-256.

```js
// Shapes
// time: [ms, counter]            triple: [value, ms, counter, by]
// record: { kind: "person"|"parent"|"partner"|"merge"|"notsame"|"device", f: { key: triple } }
// records: Map<recordId, record>
// meta: { device, name, last: time, thisIsMe: id|null, settings: { lang, latin }, lastBackup: ms|null }
// change (pending): { puts: Map<recordId, record>, group: group|null, meta: Partial<meta> }
// group: { id, at, action, device, session?, people: id[], changes, lost }
//   action: "add"|"edit"|"delete"|"restore"|"merge"|"notsame"|"erase"|"undo"|"sync"|"import"|"restamp"
//   changes: [{ r, f, before?: triple, after: triple } | { r, created: true }]
//   lost: [{ r, f, loser: triple, winner: triple }]
// relation: "parent"|"child"|"sibling"|"partner"
// choices (merge): { key: value }, the fields the user picked
// hello (parsed): { bytes: Uint8Array, f, app, d, w, k, n, h: Uint8Array(1024) }
// summary: { newPeople, changedFields, lost, rejected: { clock, invalid } }
// newGroups: [{ ids: id[], size }], largest first, size ≥ 2
// gainedRelatives: id[], existing canonical IDs that gained an incoming relative
// question: { id, x: person, relation, candidates: person[] }
// answer: { same: id } | "different" | "unsure"

// clock.js
createClock({ now = Date.now, last = [0, 0] }) // → { tick(): time, observe(time), last(): time, reset(time) }
compareTimes(a, b); compareTriples(a, b) // null value sorts lowest
canonicalJson(value)                     // sorted keys, no spaces

// records.js
FIELDS; kindOf(id); bucketOf(id); linkId(kind, a, b)
validateField(kind, key, value); validateTime(ms, counter, { now, helloW })
validateRecord(id, record, { now, helloW }) // → { record, rejected: [{ key, reason }] }
sanitiseText(key, value) // → { value, cut: boolean }, used by GEDCOM import only
applyTriple(record, key, triple)            // keeps the later triple; honours erased

// dates.js
parseGedcomDate(text); toGedcomDate(date); formatDate(date, lang); sortYear(date); isExact(date)

// names.js
matchKey(name); toLatin(s); baseSurname(s); formFor(s, sex); genderOf(s)
isPlaceholder(name); givenRelation(a, b) // → "same" | "close" | "placeholder" | "different"

// tree.js: createTree({ device, name, records, clock })
// each of these returns a pending change:
tree.addPerson(fields); tree.addRelative(id, relation, fields, { otherParent })
tree.edit(id, fields); tree.editPartnership(a, b, fields); tree.setDeviceName(name)
tree.removePerson(id); tree.restorePerson(id); tree.unlink(kind, a, b)
tree.link(kind, a, b) // kind "parent" (a is b's parent) or "partner"; both people already exist
tree.merge(a, b, choices, { session }); tree.notSame(a, b, { session })
tree.erase(id); tree.eraseRest(id); tree.undo(group)
// these don't:
tree.adopt(change); tree.view(); tree.records(); tree.resolve(id) // → canonical ID

// history.js
makeGroup({ action, device, at, session, people, changes, lost })
undoWrites(group, records) // → { writes: [{ r, f, v }], skipped: number }
scrubErased(groups, recordId); capHistory(groups, maxBytes)

// sync.js
async bucketHashes(records) // → Uint8Array(1024)
makeHello({ device, app, now, publicKey, nonce, hashes }) // → Uint8Array
parseHello(bytes) // → hello, or null if malformed
clocksAgree(helloA, helloB); restamp(tree, now) // → pending change or null
differingBuckets(hashes, hello) // → number[]
makeStep2(helloBytes, message | null); readStep2(bytes) // → { helloBytes, message | null }; hello ≤ 64 KB
buildPayload(records, buckets); buildDiff(records, received, buckets)
async packPayload(payload); async unpackPayload(bytes) // JSON + deflate-raw, 16 MiB limit
applyPayload(tree, payload, { now, helloW, allowErase })
// → { change, summary, incoming: Set<id>, newGroups, gainedRelatives, erases: id[] }
// Step 1 and step 3 streams are the plain hello and message bytes.

// envelope.js
async newSession() // → { publicKey, nonce, privateKey }
async deriveKey(session, peerPublicKey, nonceA, nonceB)
async seal(key, step, helloA, helloB, bytes); async open(key, step, helloA, helloB, bytes)
async shortCode(helloBytes) // → four letters

// join.js
compareCandidates(view, x, y, relation) // → "certain" | "possible" | "blocked" | "none"
createWalk(tree, { pairs, selfPairs, incoming, session }) // selfPairs comes from gainedRelatives
// walk: next() → question | null; answer(question, answer) → pending change; automatic(); differences()
duplicatesAround(tree, id)

// layout.js (pure)
layoutHourglass(view, focusId); layoutForest(view) // → { nodes, edges, bounds }

// gedcom.js
async importGedcom(tree, bytes) // → { change, summary, incoming, newGroups, gainedRelatives }
exportGedcom(view, today) // → string

// backup.js
writeBackup({ records, meta, history, createdAt }); validateBackup(text, { now })
restoreBackup(valid, { device, name }) // → { records, meta, history }

// ui/storage.js
async openStorage(indexedDB, locks) // takes the writer lock; state "ready", "locked" or "newer"
// → { state, load(), commit(change), restore(state), exportRaw(), close() }
```

---

# Milestone 0: Prove QR on real phones

Everything else depends on this, so it goes first. Reference: R8, R16, R17.

## Task 0.1: Project setup

**Risk:** none; everything sits on it.
**Depends on:** none

**Files:** Create `package.json`, `.gitignore`, `vercel.json`, `LICENSE`, `README.md`. Modify `CLAUDE.md`.

- [ ] **Step 1: Rename the folder.** The repo name is settled, so the working name goes.

```bash
mv ~/Desktop/Raboten/steblo-oss ~/Desktop/Raboten/steblo
```

Move the session to that folder and `cd` there. Change the title line of `CLAUDE.md` to `# Steblo`. Name the working branch `dev` (the repo has no commits yet, so this sets the unborn branch):

```bash
git symbolic-ref HEAD refs/heads/dev
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "steblo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=26" },
  "scripts": {
    "test": "node --test \"tests/**/*.test.js\"",
    "privacy": "node scripts/privacy-check.mjs"
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
.claude/settings.local.json
.vercel/
.DS_Store
```

- [ ] **Step 4: Write `vercel.json`** (reference R16)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "outputDirectory": "public",
  "headers": [
    { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "/spike/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
        { "key": "Permissions-Policy", "value": "camera=(self)" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "no-referrer" }
      ]
    }
  ]
}
```

- [ ] **Step 5: Write `LICENSE`** with the standard MIT text and the line `Copyright (c) 2026 alexanxin`.

- [ ] **Step 6: Write `README.md`**

```markdown
# Steblo

A family tree that lives on each relative's phone. Build your part, then combine trees face to face by QR code. No server, no accounts.

Work in progress. See `docs/specs/`.

MIT licence.
```

- [ ] **Step 7: Check.** Run: `node --version`. Expected: `v26` or newer.

## Task 0.2: Matching key

**Risk:** the privacy check depends on it.
**Depends on:** 0.1

**Files:** Create `public/src/names.js`, `tests/names.test.js`.
**Interfaces:** Produces `matchKey(name) → string`.

- [ ] **Step 1: Write the failing test** in `tests/names.test.js`

```js
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
```

- [ ] **Step 2: Run it.** `node --test tests/names.test.js`. Expected: FAIL, cannot find `names.js`.

- [ ] **Step 3: Write `public/src/names.js`**

```js
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
```

- [ ] **Step 4: Run it.** Same command. Expected: 2 tests pass.

## Task 0.3: Privacy check and hooks

**Risk:** a leak into a public repo can't be recalled, so this comes before the first commit.
**Depends on:** 0.2

**Files:** Create `scripts/privacy-check.mjs`, `scripts/privacy-allow.txt`, `tests/privacy-check.test.js`. Outside the repo: `~/.steblo-private-names.txt`, `.git/hooks/pre-commit`, `.git/hooks/pre-push`.

- [ ] **Step 1: Write `scripts/privacy-check.mjs`**

```js
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
```

- [ ] **Step 2: Write `scripts/privacy-allow.txt`.** Ordinary words that match a name, and the descriptive words the join rules list:

```
save
done
жена
маж
син
ќерка
прва
втора
pop
```

- [ ] **Step 3: Make the names list outside the repo.** Reads the private data; writes only to the home folder.

```bash
node -e 'const fs=require("fs"),b=require(process.env.HOME+"/Desktop/Raboten/Стебло/data/base.json");const o=new Set();for(const p of b.people)for(const f of [p.g,p.s])if(f)for(const v of f)for(const w of String(v).split(/\s+/))o.add(w);fs.writeFileSync(process.env.HOME+"/.steblo-private-names.txt",[...o].join("\n"),{mode:0o600})'
```

- [ ] **Step 4: Run it.** `STEBLO_NAMES=$HOME/.steblo-private-names.txt node scripts/privacy-check.mjs`. Expected: `privacy-check: clean`. A hit that is an ordinary word goes in the allow list. A hit that is a real name gets removed from the file.

- [ ] **Step 5: Install the hooks.** They live in `.git/` and are never committed.

```bash
printf '#!/bin/sh\nSTEBLO_NAMES=$HOME/.steblo-private-names.txt exec node scripts/privacy-check.mjs --staged\n' > .git/hooks/pre-commit
printf '#!/bin/sh\nSTEBLO_NAMES=$HOME/.steblo-private-names.txt exec node scripts/privacy-check.mjs --push\n' > .git/hooks/pre-push
chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

- [ ] **Step 6: Prove the check and the hook block.** All output is discarded, so no name reaches the transcript. The hook is run directly, so nothing is committed even if it were broken.

```bash
W=$(node -e 'console.log(require("fs").readFileSync(process.env.HOME+"/.steblo-private-names.txt","utf8").split("\n").find(w=>w.length>=5))')
printf '%s\n' "$W" > hook-proof.txt; unset W
git add hook-proof.txt
STEBLO_NAMES=$HOME/.steblo-private-names.txt node scripts/privacy-check.mjs > /dev/null 2>&1; echo "check exit $?"
.git/hooks/pre-commit > /dev/null 2>&1; echo "hook exit $?"
git rm -q --cached hook-proof.txt; rm hook-proof.txt
```

Expected: `check exit 1` and `hook exit 1`.

- [ ] **Step 7: Write `tests/privacy-check.test.js`.** It runs the script in a throwaway repo with an invented names list. The hooks check only what is committed or pushed, so one session's draft can't block another's commit, and a name committed and later deleted is still caught on push.

```js
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
```

- [ ] **Step 8: Run it.** `node --test tests/privacy-check.test.js`. Expected: 4 tests pass.

## Task 0.4: Vendor the QR libraries

**Risk:** a tampered file would run on every phone.
**Depends on:** 0.1

**Files:** Create `public/vendor/qrcode.mjs`, `jsQR.js`, `LICENSE-jsQR.txt`, `SHA256SUMS`, `package.json`, `README.md`; `tests/vendor.test.js`.

- [ ] **Step 1: Fetch the packages without running any scripts**

```bash
TMP=$(mktemp -d) && cd "$TMP" && npm pack --silent --ignore-scripts jsqr@1.4.0 qrcode-generator@2.0.4 && for f in *.tgz; do mkdir "x-$f" && tar -xzf "$f" -C "x-$f"; done && echo "$TMP"
```

- [ ] **Step 2: Copy into the repo.** From the printed folder: `x-qrcode-generator-2.0.4.tgz/package/dist/qrcode.mjs` to `public/vendor/qrcode.mjs`, `x-jsqr-1.4.0.tgz/package/dist/jsQR.js` to `public/vendor/jsQR.js`, and `x-jsqr-1.4.0.tgz/package/LICENSE` to `public/vendor/LICENSE-jsQR.txt`. Then delete the temporary folder.

- [ ] **Step 3: Write `public/vendor/SHA256SUMS`** with exactly these hashes (recorded 2026-10-30):

```
ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0  qrcode.mjs
bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859  jsQR.js
```

- [ ] **Step 4: Write `public/vendor/package.json`.** Without it, Node treats the UMD `jsQR.js` as an ES module and can't load it.

```json
{ "type": "commonjs" }
```

- [ ] **Step 5: Write `public/vendor/README.md`**

```markdown
# Vendored libraries

Copied unchanged from the npm packages. `SHA256SUMS` is checked by `tests/vendor.test.js`.

| File | Package | Licence |
|---|---|---|
| `qrcode.mjs` | qrcode-generator 2.0.4, `dist/qrcode.mjs` | MIT, stated at the top of the file |
| `jsQR.js` | jsqr 1.4.0, `dist/jsQR.js` | Apache-2.0, see `LICENSE-jsQR.txt` |
```

- [ ] **Step 6: Write `tests/vendor.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

test("vendored files match their recorded hashes", () => {
  const dir = new URL("../public/vendor/", import.meta.url);
  const lines = readFileSync(new URL("SHA256SUMS", dir), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const [hash, name] = line.split(/\s+/);
    assert.equal(createHash("sha256").update(readFileSync(new URL(name, dir))).digest("hex"), hash, name);
  }
});
```

- [ ] **Step 7: Run it.** `node --test tests/vendor.test.js`. Expected: 1 test passes. A failure means the download differs from what was recorded: stop and tell Alex.

## Task 0.5: LT fountain coding

**Risk:** simulation says it beats cyclic at every loss rate; the phones decide.
**Depends on:** 0.1

**Files:** Create `public/src/lt.js`, `tests/lt.test.js`.
**Interfaces:** Produces `picks(streamId, n, k)`, `encodeBlock(blocks, streamId, n)`, `Peeler` with `add(n, block)`, `got`, `known`.

- [ ] **Step 1: Write the failing test** in `tests/lt.test.js`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Peeler, encodeBlock, picks } from "../public/src/lt.js";

const blocks = k => Array.from({ length: k }, () => Uint8Array.from(randomBytes(64)));

test("picks are fixed for a stream and frame, distinct and in range", () => {
  const a = picks(99, 500, 300);
  assert.deepEqual(picks(99, 500, 300), a);
  assert.equal(new Set(a).size, a.length);
  assert.ok(a.every(i => i >= 0 && i < 300));
});

test("the first K frames carry the blocks themselves", () => {
  const b = blocks(10);
  assert.equal(encodeBlock(b, 1, 3), b[3]);
});

for (const lost of [0.05, 0.2, 0.35]) {
  test(`every block is recovered with ${lost * 100}% of frames lost`, () => {
    const k = 150, b = blocks(k), p = new Peeler(k, 77);
    for (let n = 0; p.got < k; n++) {
      assert.ok(n < k * 12, "gave up");
      if (Math.random() > lost) p.add(n, encodeBlock(b, 77, n));
    }
    b.forEach((block, i) => assert.deepEqual(p.known[i], block));
  });
}
```

- [ ] **Step 2: Run it.** `node --test tests/lt.test.js`. Expected: FAIL.

- [ ] **Step 3: Write `public/src/lt.js`**

```js
// Systematic LT coding (reference R8, coding = 1). Frames n < K carry block n; later frames
// carry the XOR of blocks chosen by mulberry32(streamId ^ n). Integer-only, so two engines agree.
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}
// Degree thresholds out of 2^32 († tuned by the spike): degree d is the first i with draw < CDF[i].
const DEGREES = [1, 2, 3, 4, 5, 8, 16, 32];
const CDF = [0.02, 0.47, 0.67, 0.77, 0.84, 0.91, 0.97, 1].map(p => Math.floor(p * 4294967295));

export function picks(streamId, n, k) {
  const next = mulberry32((streamId ^ n) >>> 0), draw = next();
  let d = DEGREES[DEGREES.length - 1];
  for (let i = 0; i < CDF.length; i++) if (draw <= CDF[i]) { d = DEGREES[i]; break; }
  d = Math.min(d, k);
  const out = new Set();
  while (out.size < d) out.add(next() % k);
  return [...out];
}

export function encodeBlock(blocks, streamId, n) {
  const k = blocks.length;
  if (n < k) return blocks[n];
  const out = new Uint8Array(blocks[0].length);
  for (const i of picks(streamId, n, k)) { const b = blocks[i]; for (let j = 0; j < out.length; j++) out[j] ^= b[j]; }
  return out;
}

/** Peeling decoder. add() returns how many source blocks are known. */
export class Peeler {
  constructor(k, streamId) { this.k = k; this.streamId = streamId; this.known = new Array(k); this.got = 0; this.waiting = new Map(); this.seen = new Set(); }
  add(n, block) {
    if (this.seen.has(n)) return this.got;
    this.seen.add(n);
    const set = new Set(n < this.k ? [n] : picks(this.streamId, n, this.k));
    const data = Uint8Array.from(block);
    for (const i of [...set]) if (this.known[i]) { set.delete(i); for (let j = 0; j < data.length; j++) data[j] ^= this.known[i][j]; }
    this.#place(set, data);
    return this.got;
  }
  #place(set, data) {
    if (set.size === 0) return;
    if (set.size > 1) { const e = { set, data }; for (const i of set) { if (!this.waiting.has(i)) this.waiting.set(i, []); this.waiting.get(i).push(e); } return; }
    const queue = [[[...set][0], data]];
    while (queue.length) {
      const [i, d] = queue.pop();
      if (this.known[i]) continue;
      this.known[i] = Uint8Array.from(d); this.got += 1;
      for (const e of this.waiting.get(i) || []) {
        if (!e.set.delete(i)) continue;
        for (let j = 0; j < d.length; j++) e.data[j] ^= this.known[i][j];
        if (e.set.size === 1) queue.push([[...e.set][0], e.data]);
      }
      this.waiting.delete(i);
    }
  }
}
```

The degree table uses floating-point maths only once at load, and `Math.floor` of those products is exact in every engine. If LT wins, task 0.11 replaces it with literal integers.

- [ ] **Step 4: Run it.** Expected: 5 tests pass.

## Task 0.6: Frames

**Risk:** the wire format everything crosses.
**Depends on:** 0.5

**Files:** Create `public/src/frames.js`, `tests/frames.test.js`.
**Interfaces:** Produces `crc32`, `makeFrame`, `parseFrame`, `splitBlocks`, `cyclicFrames`, `ltFrames`, `blockCount`, `Collector` (follows each stream's coding), `HEADER`, `CYCLIC`, `LT`.

- [ ] **Step 1: Write the failing test** in `tests/frames.test.js`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Collector, HEADER, crc32, cyclicFrames, ltFrames, makeFrame, parseFrame } from "../public/src/frames.js";

const frame = () => makeFrame({ streamId: 7, length: 400, blockSize: 300, n: 0 }, new Uint8Array(300));

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new TextEncoder().encode("1234"), new TextEncoder().encode("56789")), 0xcbf43926);
});

test("a frame survives a round trip", () => {
  const f = parseFrame(frame());
  assert.deepEqual([f.streamId, f.length, f.blockSize, f.coding, f.n], [7, 400, 300, 0, 0]);
});

test("corrupt frames are rejected", () => {
  const bad = frame(); bad[HEADER + 10] ^= 1;
  assert.equal(parseFrame(bad), null);
});

test("headers over the caps are rejected before any block is read", () => {
  const set = (offset, value, size) => {
    const f = frame(), v = new DataView(f.buffer);
    size === 4 ? v.setUint32(offset, value) : v.setUint16(offset, value);
    return f;
  };
  assert.equal(parseFrame(set(5, 5 * 1024 * 1024, 4)), null, "stream too long");
  assert.equal(parseFrame(set(9, 100, 2)), null, "block too small");
  assert.equal(parseFrame(set(9, 2000, 2)), null, "block too big");
  assert.equal(parseFrame(new Uint8Array(5)), null, "too short");
});

test("the collector rebuilds a stream with frames lost and shuffled", () => {
  const stream = randomBytes(5000), gen = cyclicFrames(stream, { streamId: 1, blockSize: 300 });
  const c = new Collector();
  const frames = Array.from({ length: 300 }, () => gen.next().value).sort(() => Math.random() - 0.5);
  for (const f of frames) { if (Math.random() < 0.2) continue; if (c.add(f).done) break; }
  assert.ok(c.progress().done);
  assert.deepEqual(Buffer.from(c.bytes()), stream);
});

test("the collector rebuilds an LT stream with frames lost", () => {
  const stream = randomBytes(5000), gen = ltFrames(stream, { streamId: 5, blockSize: 300 });
  const c = new Collector();
  for (let i = 0; i < 600 && !c.progress().done; i++) {
    const f = gen.next().value;
    if (Math.random() > 0.2) c.add(f);
  }
  assert.ok(c.progress().done);
  assert.deepEqual(Buffer.from(c.bytes()), stream);
});

test("the collector ignores another stream, then moves to it after a stall", () => {
  let t = 0;
  const c = new Collector({ now: () => t });
  const a = cyclicFrames(randomBytes(900), { streamId: 1, blockSize: 300 });
  const b = cyclicFrames(randomBytes(600), { streamId: 2, blockSize: 300 });
  c.add(a.next().value);
  c.add(b.next().value);
  assert.deepEqual(c.progress(), { received: 1, total: 3, done: false });
  t = 3000;
  c.add(b.next().value);
  assert.deepEqual(c.progress(), { received: 1, total: 2, done: false });
});
```

- [ ] **Step 2: Run it.** `node --test tests/frames.test.js`. Expected: FAIL, cannot find `frames.js`.

- [ ] **Step 3: Write `public/src/frames.js`**

```js
// Stream ⇄ QR frames (reference R8). Pure: no browser APIs.
import { Peeler, encodeBlock } from "./lt.js";

export const HEADER = 20;
export const MAX_LENGTH = 4 * 1024 * 1024;
export const MAX_BLOCKS = 16384;
export const MIN_BLOCK = 300;
export const MAX_BLOCK = 1500;
export const CYCLIC = 0;
export const LT = 1;

const TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(...parts) {
  let c = 0xffffffff;
  for (const bytes of parts) for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const blockCount = (length, blockSize) => Math.ceil(length / blockSize);

export function makeFrame({ streamId, length, blockSize, coding = CYCLIC, n }, block) {
  const out = new Uint8Array(HEADER + blockSize);
  const v = new DataView(out.buffer);
  v.setUint8(0, 1);
  v.setUint32(1, streamId);
  v.setUint32(5, length);
  v.setUint16(9, blockSize);
  v.setUint8(11, coding);
  v.setUint32(12, n);
  out.set(block, HEADER);
  v.setUint32(16, crc32(out.subarray(0, 16), out.subarray(HEADER)));
  return out;
}

export function parseFrame(bytes) {
  if (bytes.length < HEADER) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = v.getUint8(0), streamId = v.getUint32(1), length = v.getUint32(5);
  const blockSize = v.getUint16(9), coding = v.getUint8(11), n = v.getUint32(12), crc = v.getUint32(16);
  if (version !== 1 || coding > LT) return null;
  if (length < 1 || length > MAX_LENGTH) return null;
  if (blockSize < MIN_BLOCK || blockSize > MAX_BLOCK) return null;
  if (blockCount(length, blockSize) > MAX_BLOCKS) return null;
  if (bytes.length !== HEADER + blockSize) return null;
  const block = bytes.subarray(HEADER);
  if (crc32(bytes.subarray(0, 16), block) !== crc) return null;
  return { streamId, length, blockSize, coding, n, block };
}

export function splitBlocks(stream, blockSize) {
  const k = blockCount(stream.length, blockSize), blocks = [];
  for (let i = 0; i < k; i++) {
    const b = new Uint8Array(blockSize);
    b.set(stream.subarray(i * blockSize, (i + 1) * blockSize));
    blocks.push(b);
  }
  return blocks;
}

/** Frames for a stream: an endless cyclic sequence. */
export function* cyclicFrames(stream, { streamId, blockSize }) {
  const blocks = splitBlocks(stream, blockSize), length = stream.length;
  for (let n = 0; ; n++) yield makeFrame({ streamId, length, blockSize, coding: CYCLIC, n }, blocks[n % blocks.length]);
}

/** Frames for a stream: the blocks, then endless XOR combinations of them. */
export function* ltFrames(stream, { streamId, blockSize }) {
  const blocks = splitBlocks(stream, blockSize), length = stream.length;
  for (let n = 0; ; n++) yield makeFrame({ streamId, length, blockSize, coding: LT, n }, encodeBlock(blocks, streamId, n));
}

/** Collects the frames of one stream, moving to a new stream after a stall. */
export class Collector {
  constructor({ now = () => Date.now(), stallMs = 3000 } = {}) {
    this.now = now;
    this.stallMs = stallMs;
    this.stream = null;
  }
  #start(f) {
    const k = blockCount(f.length, f.blockSize);
    this.stream = {
      id: f.streamId, length: f.length, blockSize: f.blockSize, k, got: 0, at: this.now(),
      peel: f.coding === LT ? new Peeler(k, f.streamId) : null, blocks: new Array(k),
    };
  }
  add(bytes) {
    const f = parseFrame(bytes);
    if (!f) return this.progress();
    if (!this.stream) this.#start(f);
    if (f.streamId !== this.stream.id) {
      if (this.now() - this.stream.at < this.stallMs) return this.progress();
      this.#start(f);
    }
    const s = this.stream, before = s.got;
    if (s.peel) s.got = s.peel.add(f.n, f.block);
    else if (!s.blocks[f.n % s.k]) { s.blocks[f.n % s.k] = f.block.slice(); s.got += 1; }
    if (s.got !== before) s.at = this.now();
    return this.progress();
  }
  progress() {
    const s = this.stream;
    return { received: s ? s.got : 0, total: s ? s.k : 0, done: !!s && s.got === s.k };
  }
  bytes() {
    const s = this.stream, out = new Uint8Array(s.k * s.blockSize);
    (s.peel ? s.peel.known : s.blocks).forEach((b, i) => out.set(b, i * s.blockSize));
    return out.subarray(0, s.length);
  }
}
```

- [ ] **Step 4: Run it.** Expected: 7 tests pass.

## Task 0.7: base45 and QR codec

**Risk:** proves real QR images round-trip.
**Depends on:** 0.4, 0.6

**Files:** Create `public/src/base45.js`, `public/src/qrcodec.js`, `tests/qrcodec.test.js`.
**Interfaces:** Produces `encode`, `decode` (base45); `toMatrix(bytes, { ec, mode })`, `toRgba(matrix, { scale, quiet })`, `readRgba(image, jsQR, { mode })`.

- [ ] **Step 1: Write the failing test** in `tests/qrcodec.test.js`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { Collector, cyclicFrames } from "../public/src/frames.js";
import { decode, encode } from "../public/src/base45.js";
import { readRgba, toMatrix, toRgba } from "../public/src/qrcodec.js";

const jsQR = createRequire(import.meta.url)("../public/vendor/jsQR.js");

test("base45 matches RFC 9285", () => {
  const text = s => new TextEncoder().encode(s);
  assert.equal(encode(text("AB")), "BB8");
  assert.equal(encode(text("Hello!!")), "%69 VD92EX0");
  assert.deepEqual(decode("BB8"), text("AB"));
  assert.throws(() => decode("~~~"));
});

for (const mode of ["byte", "base45"]) {
  test(`a stream crosses real QR images with 20% of frames lost (${mode})`, () => {
    const stream = randomBytes(5000), gen = cyclicFrames(stream, { streamId: 42, blockSize: 300 });
    const c = new Collector();
    for (let i = 0; i < 400 && !c.progress().done; i++) {
      const f = gen.next().value;
      if (Math.random() < 0.2) continue;
      const got = readRgba(toRgba(toMatrix(f, { mode })), jsQR, { mode });
      assert.ok(got, "decoded");
      c.add(got);
    }
    assert.deepEqual(Buffer.from(c.bytes()), stream);
  });
}
```

- [ ] **Step 2: Run it.** `node --test tests/qrcodec.test.js`. Expected: FAIL.

- [ ] **Step 3: Write `public/src/base45.js`**

```js
// RFC 9285 base45, for alphanumeric-mode QR codes.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const VALUE = new Map([...ALPHABET].map((c, i) => [c, i]));

export function encode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let n = bytes[i] * 256 + bytes[i + 1];
      const c = n % 45; n = (n - c) / 45;
      const d = n % 45; n = (n - d) / 45;
      out += ALPHABET[c] + ALPHABET[d] + ALPHABET[n];
    } else {
      const n = bytes[i], c = n % 45;
      out += ALPHABET[c] + ALPHABET[(n - c) / 45];
    }
  }
  return out;
}

export function decode(text) {
  const out = new Uint8Array(Math.floor(text.length / 3) * 2 + (text.length % 3 === 2 ? 1 : 0));
  let o = 0;
  for (let i = 0; i < text.length; i += 3) {
    const c = VALUE.get(text[i]), d = VALUE.get(text[i + 1]);
    if (c === undefined || d === undefined) throw new Error("bad base45");
    if (i + 2 < text.length) {
      const e = VALUE.get(text[i + 2]);
      if (e === undefined) throw new Error("bad base45");
      const n = c + d * 45 + e * 2025;
      if (n > 65535) throw new Error("bad base45");
      out[o++] = n >> 8;
      out[o++] = n & 255;
    } else {
      const n = c + d * 45;
      if (n > 255) throw new Error("bad base45");
      out[o++] = n;
    }
  }
  return out;
}
```

- [ ] **Step 4: Write `public/src/qrcodec.js`**

```js
// Frame bytes ⇄ QR codes. The decoder is passed in, because jsQR loads differently
// in Node (require) and in the browser (classic script in a worker or page).
import qrcode from "../vendor/qrcode.mjs";
import { encode as b45, decode as unb45 } from "./base45.js";

/** @returns {{size:number, dark:(r:number,c:number)=>boolean}} */
export function toMatrix(bytes, { ec = "L", mode = "byte" } = {}) {
  const q = qrcode(0, ec);
  if (mode === "base45") q.addData(b45(bytes), "Alphanumeric");
  else q.addData(String.fromCharCode(...bytes), "Byte");
  q.make();
  return { size: q.getModuleCount(), dark: (r, c) => q.isDark(r, c) };
}

export function toRgba(m, { scale = 4, quiet = 4 } = {}) {
  const width = (m.size + quiet * 2) * scale, data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) {
    if (!m.dark(r, c)) continue;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + quiet) * scale + y) * width + (c + quiet) * scale + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  return { data, width, height: width };
}

export function readRgba({ data, width, height }, jsQR, { mode = "byte" } = {}) {
  const hit = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
  if (!hit) return null;
  return mode === "base45" ? unb45(hit.data) : Uint8Array.from(hit.binaryData);
}
```

- [ ] **Step 5: Run all tests.** `npm test`. Expected: 22 pass, 0 fail (18 here plus 4 from task 0.3).

## Task 0.8: The spike page

**Risk:** this page answers the question the project depends on.
**Depends on:** 0.7

**Files:** Create everything in `public/spike/`. Copy `public/icons/icon-192.png` and `icon-512.png` from the private app's `public/icons/` (logo images, no family data).

- [ ] **Step 1: Write `public/spike/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Steblo spike</title>
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="stylesheet" href="spike.css">
</head>
<body>
  <h1>Steblo spike</h1>
  <p id="mode"></p>
  <div id="settings">
    <label>KB <input id="kb" type="number" value="200"></label>
    <label>Block <input id="block" type="number" value="600" step="100"></label>
    <label>FPS <input id="fps" type="number" value="8"></label>
    <label>Level <select id="ec"><option>L</option><option>M</option></select></label>
    <label>Mode <select id="qrmode"><option>byte</option><option>base45</option></select></label>
    <label>Coding <select id="coding"><option value="1">LT</option><option value="0">cyclic</option></select></label>
    <label><input id="worker" type="checkbox" checked> Worker</label>
  </div>
  <div id="actions">
    <button id="show">Show</button>
    <button id="scan">Scan</button>
    <button id="stop">Stop</button>
    <button id="checks">Device checks</button>
    <button id="save">Save log</button>
    <input id="open" type="file">
  </div>
  <p id="status"></p>
  <canvas id="qr" width="10" height="10"></canvas>
  <video id="video" playsinline muted></video>
  <pre id="log"></pre>
  <script src="../vendor/jsQR.js"></script>
  <script type="module" src="spike.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/spike/spike.css`**

```css
body { margin: 0; padding: 16px; font: 15px system-ui, sans-serif; background: #0e141a; color: #e8eef2; }
#settings, #actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
input[type=number] { width: 64px; }
#status { font-size: 18px; min-height: 2.5em; }
#qr { display: none; width: 100%; max-width: 640px; background: #fff; }
#video { display: none; width: 100%; max-width: 640px; }
#log { white-space: pre-wrap; font-size: 12px; }
.on { display: block !important; }
```

- [ ] **Step 3: Write `public/spike/manifest.webmanifest`**

```json
{ "name": "Steblo spike", "short_name": "Spike", "start_url": "/spike/", "scope": "/spike/", "display": "standalone",
  "background_color": "#0e141a", "theme_color": "#0e141a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ] }
```

- [ ] **Step 4: Write `public/spike/decode-worker.js`**

```js
importScripts("../vendor/jsQR.js");
self.onmessage = ({ data }) => {
  const start = performance.now();
  const hit = self.jsQR(new Uint8ClampedArray(data.pixels), data.width, data.height, { inversionAttempts: "dontInvert" });
  self.postMessage({ text: hit?.data, bytes: hit ? Uint8Array.from(hit.binaryData) : null, ms: performance.now() - start });
};
```

- [ ] **Step 5: Write `public/spike/sw.js`.** Android Chrome offers Install only when a service worker has a real fetch handler (https://developer.chrome.com/blog/update-install-criteria). Added 2026-11-05 at Alex's request, after the phones couldn't install the page. It doesn't change what the spike measures.

```js
// Spike only. Android Chrome offers "Install" only when a service worker has a real fetch
// handler. Network first, so every run uses the latest files; the copy lets it open offline.
const CACHE = "steblo-spike-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    })
    .catch(() => caches.match(e.request).then(hit => hit || Response.error())));
});
```

- [ ] **Step 6: Write `public/spike/spike.js`**

```js
// Throwaway: measures QR transfer and device features on real phones (reference R17).
import { CYCLIC, LT, blockCount, makeFrame, parseFrame, splitBlocks } from "../src/frames.js";
import { Peeler, encodeBlock } from "../src/lt.js";
import { decode as unb45 } from "../src/base45.js";
import { toMatrix } from "../src/qrcodec.js";

const $ = id => document.getElementById(id);
const number = id => Number($(id).value);
const lines = [];
const log = entry => {
  lines.push(JSON.stringify({ at: new Date().toISOString(), ...entry }));
  $("log").textContent = lines.join("\n");
};
const status = text => { $("status").textContent = text; };
const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
$("mode").textContent = `${installed ? "Installed" : "Browser tab"} · ${navigator.userAgent}`;
navigator.serviceWorker?.register("sw.js").catch(e => log({ event: "serviceWorker", error: String(e) }));

const settings = () => ({ kb: number("kb"), block: number("block"), fps: number("fps"), ec: $("ec").value, mode: $("qrmode").value, coding: number("coding"), worker: $("worker").checked });
let stopper = null;
const stop = () => { stopper?.(); stopper = null; $("qr").classList.remove("on"); $("video").classList.remove("on"); };
$("stop").onclick = stop;

function randomStream(bytes) {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(i + 65536, bytes)));
  return out;
}
const shortHash = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].slice(0, 4).map(b => b.toString(16).padStart(2, "0")).join("");

function draw(canvas, matrix) {
  const quiet = 4, cells = matrix.size + quiet * 2, scale = Math.max(2, Math.floor(1000 / cells));
  canvas.width = canvas.height = cells * scale;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#000";
  for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) {
    if (matrix.dark(r, c)) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  }
}

$("show").onclick = async () => {
  stop();
  const s = settings(), stream = randomStream(s.kb * 1024), blocks = splitBlocks(stream, s.block);
  const streamId = crypto.getRandomValues(new Uint32Array(1))[0], length = stream.length;
  const lock = await navigator.wakeLock?.request("screen").catch(() => null);
  const canvas = $("qr"); canvas.classList.add("on");
  log({ event: "show", ...s, blocks: blocks.length, hash: await shortHash(stream), wakeLock: !!lock });
  let n = 0, running = true;
  const started = performance.now();
  const tick = () => {
    if (!running) return;
    const body = s.coding === LT ? encodeBlock(blocks, streamId, n) : blocks[n % blocks.length];
    draw(canvas, toMatrix(makeFrame({ streamId, length, blockSize: s.block, coding: s.coding, n }, body), { ec: s.ec, mode: s.mode }));
    n += 1;
    status(`Showing frame ${n}, ${(n / ((performance.now() - started) / 1000)).toFixed(1)} fps`);
    const next = started + n * (1000 / s.fps);
    setTimeout(tick, Math.max(0, next - performance.now()));
  };
  tick();
  stopper = () => { running = false; lock?.release(); log({ event: "stopped", frames: n, fps: n / ((performance.now() - started) / 1000) }); };
};

function collector() {
  let st = null;
  return f => {
    if (!st || st.id !== f.streamId) {
      const k = blockCount(f.length, f.blockSize);
      st = { id: f.streamId, k, peel: f.coding === LT ? new Peeler(k, f.streamId) : null, blocks: new Array(k), got: 0, first: performance.now(), ns: new Set(), low: f.n, high: f.n, length: f.length };
    }
    st.ns.add(f.n); st.low = Math.min(st.low, f.n); st.high = Math.max(st.high, f.n);
    if (st.peel) st.got = st.peel.add(f.n, f.block);
    else if (!st.blocks[f.n % st.k]) { st.blocks[f.n % st.k] = f.block.slice(); st.got += 1; }
    return st;
  };
}

$("scan").onclick = async () => {
  stop();
  const s = settings(), video = $("video");
  const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
  video.srcObject = media; video.classList.add("on"); await video.play();
  const add = collector(), grab = document.createElement("canvas"), g = grab.getContext("2d", { willReadFrequently: true });
  const worker = s.worker ? new Worker("decode-worker.js") : null;
  const scanStart = performance.now();
  let running = true, busy = false, tries = 0, hits = 0, spent = 0, last = null, firstReadMs = null;
  const take = (bytes, ms) => {
    tries += 1; spent += ms;
    if (!bytes) return;
    const f = parseFrame(s.mode === "base45" ? unb45(new TextDecoder().decode(bytes)) : bytes);
    if (!f) return;
    hits += 1;
    firstReadMs ??= performance.now() - scanStart;
    last = add(f);
    const secs = (performance.now() - last.first) / 1000;
    status(`${last.got}/${last.k} blocks, ${hits}/${tries} reads, ${(spent / tries).toFixed(0)} ms each, ${secs.toFixed(0)} s`);
    if (last.got === last.k) {
      const read = last.ns.size / (last.high - last.low + 1);
      log({ event: "done", ...s, length: last.length, seconds: secs, kbPerSec: last.length / 1024 / secs, shareRead: read, firstReadMs, reads: hits, tries, decodeMs: spent / tries, frames: last.ns.size, k: last.k });
      status(`Done: ${(last.length / 1024 / secs).toFixed(2)} KB/s in ${secs.toFixed(0)} s`);
      stop();
    }
  };
  if (worker) worker.onmessage = ({ data }) => { busy = false; take(s.mode === "base45" ? (data.text ? new TextEncoder().encode(data.text) : null) : data.bytes, data.ms); };
  const loop = () => {
    if (!running) return;
    if (!busy && video.videoWidth) {
      grab.width = video.videoWidth; grab.height = video.videoHeight;
      g.drawImage(video, 0, 0);
      const img = g.getImageData(0, 0, grab.width, grab.height);
      if (worker) { busy = true; worker.postMessage({ pixels: img.data.buffer, width: img.width, height: img.height }, [img.data.buffer]); }
      else {
        const start = performance.now(), hit = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        take(hit ? (s.mode === "base45" ? new TextEncoder().encode(hit.data) : Uint8Array.from(hit.binaryData)) : null, performance.now() - start);
      }
    }
    requestAnimationFrame(loop);
  };
  loop();
  stopper = () => { running = false; worker?.terminate(); media.getTracks().forEach(t => t.stop()); video.srcObject = null; log({ event: "scanStopped", ...s, firstReadMs, reads: hits, tries, decodeMs: tries ? spent / tries : 0, blocks: last?.got ?? 0 }); };
};

async function attempt(name, fn) {
  try { log({ check: name, ok: true, result: await fn() }); }
  catch (e) { log({ check: name, ok: false, error: String(e) }); }
}

$("checks").onclick = async () => {
  await attempt("webcrypto", async () => {
    const pair = () => crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const a = await pair(), b = await pair();
    const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: b.publicKey }, a.privateKey, 256);
    const hkdf = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("steblo-sync-1") }, hkdf, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12)), plain = new TextEncoder().encode("hello");
    const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed));
  });
  await attempt("deflate-raw", async () => {
    const pipe = (bytes, stream) => { const w = stream.writable.getWriter(); w.write(bytes); w.close(); return new Response(stream.readable).arrayBuffer(); };
    const packed = await pipe(new Uint8Array(1000), new CompressionStream("deflate-raw"));
    return [packed.byteLength, (await pipe(new Uint8Array(packed), new DecompressionStream("deflate-raw"))).byteLength];
  });
  await attempt("wakeLock", async () => { const l = await navigator.wakeLock.request("screen"); await l.release(); return "granted"; });
  await attempt("persist", async () => [await navigator.storage.persist(), await navigator.storage.persisted(), await navigator.storage.estimate()]);
  await attempt("locks", async () => navigator.locks.request("spike", async () => "held"));
  await attempt("storageMarker", () => new Promise((done, fail) => {
    const open = indexedDB.open("spike", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("kv", "readwrite"), store = tx.objectStore("kv"), get = store.get("firstSeen");
      get.onsuccess = () => {
        const here = installed ? "installed" : "browser";
        if (get.result) done({ here, firstSeen: get.result }); else { store.put(here, "firstSeen"); done({ here, firstSeen: "new, written now" }); }
      };
    };
  }));
};

$("save").onclick = async () => {
  const file = new File([lines.join("\n")], "steblo-spike.txt", { type: "text/plain" });
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }).catch(e => log({ event: "share", error: String(e) })); log({ event: "saved", how: "share" }); return; }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: file.name });
  a.click();
  log({ event: "saved", how: "download" });
};

$("open").onchange = async e => log({ event: "opened", bytes: (await e.target.files[0]?.text())?.length });
```

- [ ] **Step 7: Run it in a desktop browser.** Create `.claude/launch.json`:

```json
{ "version": "0.0.1", "configurations": [{ "name": "static", "runtimeExecutable": "python3", "runtimeArgs": ["-m", "http.server", "8080", "-d", "public"], "port": 8080 }] }
```

Start it and open `http://localhost:8080/spike/`. Expected:
  - no console errors
  - **Show** draws a changing code
  - **Device checks** logs `webcrypto`, `deflate-raw` and `storageMarker` as ok

  This page has never run in a browser, so fix whatever this finds. Python's server doesn't send the CSP; that is checked in task 0.9.

- [ ] **Step 8: Commit Milestone 0** (after Alex's go-ahead). The hook runs `privacy-check`.

```bash
git add .
git commit -m "Docs, spike page and QR transfer code"
```

## Task 0.9: Publish the preview

**Risk:** needs accounts; the first outward-facing step.
**Depends on:** 0.8, and **Alex's explicit go-ahead**

- [x] **Step 1: Create the repo** (after go-ahead). Public, on Alex's account, with `dev` as the only branch. Done 2026-11-05: `alexanxin/steblo-app` (first created as `Xin-Dragons/steblo` by mistake, then transferred).

```bash
gh repo create alexanxin/steblo-app --public --source=. --push
```

- [ ] **Step 2: Create the Vercel project** in the dashboard: import `alexanxin/steblo-app`, name it `steblo-app`, framework Other, output directory `public`.

- [ ] **Step 3: Set Settings → Git → Production Branch to `main`.** That branch doesn't exist yet, so `dev` only ever makes previews.

- [ ] **Step 4: Turn off Vercel Authentication** under Settings → Deployment Protection, so phones open previews with no login.

- [ ] **Step 5: Note the stable branch URL** of `dev` from the deployment page (it looks like `steblo-app-git-dev-….vercel.app`). `$PREVIEW` below means that URL.

- [ ] **Step 6: Open `$PREVIEW/spike/`** in a desktop browser. Expected: the same behaviour as task 0.8, with no CSP errors in the console. Check the headers:

```bash
curl -sI "$PREVIEW/spike/" | grep -i -E 'content-security-policy|permissions-policy|x-content-type|referrer-policy'
```

Expected: all four present.

- [ ] **Step 7: Turn on 2FA** on GitHub and Vercel (Alex).

## Task 0.10: Run the spike on the phones

**Risk:** this is the gate.
**Depends on:** 0.9. Needs Alex's iPhone and an Android phone.

**Files:** Create `docs/specs/spike-results.md`.

- [ ] **Step 1: Install.** Open `$PREVIEW/spike/` on each phone and add it to the Home Screen. Before installing, open it in the browser and tap **Device checks** once, so the storage marker records "browser".

- [ ] **Step 2: Device checks** on each phone, in the installed app. Tap **Device checks**, then **Save log**, then pick the saved file with the file button. Record R17 items 1, 3, 4, 6, 7 and 8. `storageMarker` shows "installed … firstSeen: browser" if storage is shared, and "new, written now" if it's isolated.

- [ ] **Step 3: Wake Lock** (item 5). Tap **Show** and leave the phone untouched for 3 minutes. Record whether the screen stayed on.

- [ ] **Step 4: Tuning grid** (item 0). One phone shows and the other scans, hand-held about 20 cm apart. Start at 200 KB, block 600, 8 fps, level L, byte, LT, Worker on. Each run ends with a `done` log line. Change one setting at a time, each change starting from the best so far. **Best** means the highest `kbPerSec`:
  1. fps: 4, 6, 8, 10, 15
  2. block: 300, 600, 800, 1200, 1500 (skip 1000 at level L; it fails in jsQR)
  3. level M
  4. base45
  5. cyclic
  6. Worker off (item 10)

- [ ] **Step 5: The gate** (item 2). With the best settings, run 200 KB three times in each direction, iPhone to Android and back. Pass: every run at most 120 s.

- [ ] **Step 6: Write `docs/specs/spike-results.md`:** the phone models and OS versions, a table of the runs (settings, seconds, KB/s, `shareRead`, ms per decode, `firstReadMs`), and a line per R17 item with pass or fail. Derive q = 1 − `shareRead` and the LT factor = `frames` ÷ `shareRead` ÷ `k` (frames shown per block) for the winning setting.

- [ ] **Step 7: Decide.** Pass: go to 0.11. Miss: stop and give Alex the numbers. Nothing else gets built until he decides (ADR 0002).

## Task 0.11: Pin what the spike decided

**Depends on:** 0.10 passed

**Files:** Modify `docs/specs/2026-10-30-steblo-v1-reference.md`, `public/src/frames.js`, `public/src/qrcodec.js`, tests, and per outcome below.

- [ ] **Step 1:** Replace every † in R8 with its measured value.
- [ ] **Step 2: If LT won:** delete `cyclicFrames` and its branch in `Collector`, and change `tests/frames.test.js` and `tests/qrcodec.test.js` to use `ltFrames`. Export `CDF` from `lt.js`, print it with `node -e 'import("./public/src/lt.js").then(m=>console.log(m.CDF))'`, replace it with those literal integers, and add a test pinning `picks(1, 1000, 334)` to its printed result. `public/spike/spike.js` still works unchanged.
- [ ] **Step 3: If cyclic won:** delete `public/src/lt.js`, `tests/lt.test.js`, `ltFrames`, the `peel` branch in `Collector`, and the `LT`, `Peeler` and `encodeBlock` lines in `public/spike/spike.js`.
- [ ] **Step 4: If byte mode won:** delete `public/src/base45.js`, the `mode` option in `qrcodec.js`, the `mode` loop and base45 test in `tests/qrcodec.test.js`, and the `unb45` lines in `spike.js`. **If base45 won:** delete the byte branches in the same places.
- [ ] **Step 5:** Apply each R17 fallback that a failed item calls for, to the design and reference.
- [ ] **Step 6:** `npm test`. Expected: all pass. Commit.

---

# Milestone 1: The tree

Reference: R1–R4, R10, R11. Every task follows the same steps: write the listed tests, watch them fail, implement, watch them pass, run `npm test`, commit. Test names below are the literal test titles.

## Task 1.1: Clock

**Files:** `public/src/clock.js`, `tests/clock.test.js`. **Rules:** R2. **Depends on:** Milestone 0.

Tests:
- "tick moves forward when the wall clock stands still": `now` fixed at 1000; ticks give `[1000,0]`, `[1000,1]`.
- "tick keeps moving when the wall clock goes backwards": `now` falls from 2000 to 1000; next tick is `[2000,1]`.
- "counter overflow moves to the next millisecond": `last = [5, 65535]`, `now` 5; tick gives `[6,0]`.
- "observe makes the next tick later than what was seen".
- "triples are ordered by ms, counter, by, then value": one pair per rule.
- "canonicalJson sorts keys": `{b:1,a:2}` gives `{"a":2,"b":1}`.
- "a null value sorts lowest in compareTriples".

## Task 1.2: Records and the validator

**Files:** `public/src/records.js`, `tests/records.test.js`. **Rules:** R1, R3. **Depends on:** 1.1.

Tests:
- "bucketOf follows the bucket key": `p:aa…:bb…` goes to bucket 0xbb; `u:aa…:bb…` to 0xaa.
- "linkId sorts partner and merge pairs but not parent links".
- "the validator cleans names": `"  Ема  Новакова "` gives `"Ема Новакова"`; 81 characters rejected.
- "notes keep newlines and tabs and drop other control characters".
- "< and > are allowed in every text field".
- "null clears every field except deleted, erased and name".
- "dates need y or t, and d must be a real day": 2024-02-29 passes, 2023-02-29 fails.
- "erased can only be true".
- "unknown fields are kept up to 4 and 4 KB": a fifth is rejected, and so is depth 5.
- "times beyond the later of now and hello w plus 24 hours are rejected".
- "sanitiseText cuts over-long text with an ellipsis and strips tags from notes".
- "applyTriple keeps the later triple".
- "applyTriple on an erased record keeps only er".

## Task 1.3: Dates

**Files:** `public/src/dates.js`, `tests/dates.test.js`. **Rules:** R3, R12 Dates. **Depends on:** 1.2.

Tests:
- "parseGedcomDate reads full, month and year dates": `12 MAR 1931`, `MAR 1931`, `1931`.
- "prefixes set q; CAL becomes est".
- "anything else is kept as text": `BET 1920 AND 1940` gives `{t}` with sort year 1920.
- "toGedcomDate reverses parseGedcomDate".
- "isExact is false with q or t".
- "formatDate shows about and before in English and Macedonian".

## Task 1.4: Name helpers

**Files:** Modify `public/src/names.js`, `tests/names.test.js`. **Rules:** R9 Surname key, Given names. **Depends on:** 0.2.

Port `toLatin`, `baseSurname`, `formFor` and `genderOf` from the private app's `public/shared/tree.js:6-61`, keeping the two-letter stem guard, and add Latin endings. Remove the comment examples there that use real surnames.

Tests:
- "toLatin follows the Macedonian table": `Теодора` gives `Teodora`.
- "baseSurname reduces both alphabets": `Новакова` gives `Новаков`; `Novakova` gives `Novakov`; `Даниловска` gives `Даниловски`.
- "the stem guard keeps short names": `Ова` is unchanged.
- "formFor gives the form for a sex in either alphabet".
- "genderOf reads sex from a surname ending, in either alphabet".
- "isPlaceholder catches empty, ?, other scripts and descriptive words": `Жена на Данило`, `Wife of Danilo`, `?`, `日本`.
- "givenRelation": same (`Ема`, `Ema`), close (`Teodora`, `Teodara`), placeholder, different; short names are never close.
- "a placeholder is never same, even with an equal key".

## Task 1.5: Tree operations

**Files:** `public/src/tree.js`, `tests/tree.test.js`. **Rules:** R1, R3, R14 write contract. **Depends on:** 1.1–1.4.

Tests:
- "an operation returns a pending change and changes nothing until adopted".
- "addPerson writes all its fields and deleted at one time".
- "addRelative writes the person and links in one change": for child, parent, sibling and partner.
- "a sibling of someone with no parents creates one placeholder parent linked to both".
- "otherParent also gets a parent link to the new child".
- "unlink hides a link and restores on undo".
- "editPartnership writes marriage and end fields".
- "resolve returns the canonical ID of a merged person".
- "setDeviceName writes the device record".
- "two devices adding the same link create the same record".
- "adding a third parent throws".
- "edit stores one new time and rejects invalid input".
- "removePerson and restorePerson round trip".

## Task 1.6: Sets and the view

**Files:** Modify `public/src/tree.js`, tests in `tests/view.test.js`. **Rules:** R4. **Depends on:** 1.5.

Tests:
- "a merged set shows the latest value of each field".
- "the canonical ID is the smallest, and chained merges join sets".
- "edits write the canonical record; delete and restore write every record".
- "a delete made after an edit wins, and an edit made after a delete revives".
- "a tie between deleted and another field counts as deleted".
- "links that resolve to one pair collapse, and delete hides them".
- "a link to a missing person stays hidden until it arrives".
- "a not-same record applies across sets, and an active merge beats it".
- "undoing a merge keeps edits on the canonical record" (edit, merge, unmerge).

## Task 1.7: Families and Needs attention

**Files:** Modify `public/src/tree.js`, tests in `tests/view.test.js`. **Rules:** R4 view, Layout contract. **Depends on:** 1.6.

Tests:
- "children group by own family, using the two parent links with the smallest IDs".
- "a partner link with no children still makes a family".
- "partners are ordered M, then X or U by ID, then F".
- "children are ordered by sort year, unknown last".
- "attention lists more than two parents, ancestor loops and partly erased people".
- "separate groups exclude the largest; ties go to the smaller lowest ID".
- "view is identical for the same records in any insertion order".

## Task 1.8: History and undo

**Files:** `public/src/history.js`, tests in `tests/history.test.js`. **Rules:** R10. **Depends on:** 1.6.

Tests:
- "each operation produces one change group with who and when".
- "creations are logged by ID only".
- "undo restores the old value as a new edit".
- "undo of a first value writes null".
- "undo of a creation deletes what was created".
- "undo skips fields changed since, and counts them".
- "undo of an undo restores the edit".
- "capHistory drops the oldest groups above the limit, and says so".

## Task 1.9: Erase

**Files:** Modify `public/src/tree.js`, `public/src/history.js`, tests in `tests/erase.test.js`. **Rules:** R11, ADR 0007. **Depends on:** 1.8.

Tests:
- "erase keeps only the er triple on the erasing device".
- "erase deletes links touching the set".
- "erase scrubs the record from history in the same change".
- "a later edit to an erased record is discarded".
- "a partly erased set is hidden and listed".
- "eraseRest erases the remaining records of a partly erased set".
- "erase groups can't be undone".

## Task 1.10: Invented-tree generator

**Files:** `tests/fixtures/tree.js`, `tests/numbers.test.js`. **Rules:** design §10, Testing. **Depends on:** 1.7.

`generateTree({ people, seed, clocks: "import" | "hand", noteShare })` builds an invented tree from a seeded linear congruential generator. Rules:
- names from 2–3 random consonant-vowel Cyrillic syllables: a pool of 400 given names, 300 surnames (ending -ов, -ски or -ев) and 150 places
- for person i from 40 up: 85% get a parent link and 60% a second, each to a random earlier person; 35% get a partner link to one
- fields: 70% birth date, 30% birth place, 40% death date, 20% deceased, 15% birth surname; `noteShare` get a 300-letter note
- `clocks: "import"` uses the import clock; `"hand"` gives each person and their links one new clock, from 5 devices, minutes to an hour apart

Tests:
- "the generator is stable for a seed".
- "view of 5,000 people takes under 200 ms".

---

# Milestone 2: Sync

Reference: R5, R7, R8. Same steps as Milestone 1.

## Task 2.1: Bucket hashes

**Files:** `public/src/sync.js`, `tests/sync.test.js`. **Depends on:** Milestone 1.

Tests:
- "identical records give identical hashes in any order".
- "an edit changes exactly one bucket's hash".
- "an empty bucket hashes []".

## Task 2.2: Hello and clock agreement

**Files:** Modify `public/src/sync.js`. **Rules:** R5 Hello, Clock agreement. **Depends on:** 2.1.

Tests:
- "hello round trips and carries 1024 bytes of hashes".
- "differingBuckets lists the buckets that differ".
- "makeStep2 and readStep2 round trip, with and without a message".
- "a hello length over 64 KB is rejected".
- "clocksAgree is false beyond 24 hours".
- "a hostile hello with bad shapes is rejected".

## Task 2.3: Compact payload

**Files:** Modify `public/src/sync.js`, tests in `tests/payload.test.js`. **Rules:** R5 Payload. **Depends on:** 2.1.

Tests:
- "payload round trips every kind of record".
- "fields set at a different time go in the override object".
- "the clock table is sorted and stores differences".
- "unpackPayload rejects over 16 MiB, stopping as it decompresses": a zip bomb built in the test.
- "payload for a hand-typed 3,420-person tree is at most 175 KB": `generateTree({ people: 3420, clocks: "hand", noteShare: 0.03 })`.
- "a repeat sync of 10 changed buckets is at most 15 KB".

## Task 2.4: Applying

**Files:** Modify `public/src/sync.js`, tests in `tests/apply.test.js`. **Rules:** R5 Applying, Losing values. **Depends on:** 2.3.

Tests:
- "applying is idempotent".
- "later triples win, per field".
- "a replaced value is logged by the phone that held it".
- "equal values aren't logged as lost".
- "rejected items aren't stored and are counted per reason".
- "a rejected item's bucket keeps differing".
- "erases aren't applied unless allowed, and are listed".
- "applying returns incoming IDs, new groups and gained relatives".
- "a hostile payload is rejected": over 200,000 records, bad IDs, extra fields, deep nesting, `__proto__` keys.
- "unknown fields on a stored record stay bounded across syncs": a merged record keeps only the 4 smallest unknown keys, so the result doesn't depend on arrival order (found in Milestone 1: the validator bounds one incoming record, not the merged result).
- "applyPayload validates before building the change": `tree.adopt` trusts its input.

## Task 2.5: Step 3 diff

**Files:** Modify `public/src/sync.js`. **Rules:** R5 What each step sends. **Depends on:** 2.4.

Tests:
- "buildDiff sends only fields that differ from what was received".
- "after step 3 both devices hold identical records".

## Task 2.6: Re-stamp

**Files:** Modify `public/src/sync.js`, tests in `tests/restamp.test.js`. **Rules:** R5 Re-stamp. **Depends on:** 2.4.

Tests:
- "own future triples get new times in their original order".
- "an edit made after a delete still revives after re-stamping".
- "other devices' triples are left alone".
- "nothing happens when no triple is ahead".
- "the re-stamp is one history group".

## Task 2.7: Envelope

**Files:** `public/src/envelope.js`, `tests/envelope.test.js`. **Rules:** R7, R6 step 1 code. **Depends on:** Milestone 0.

Tests:
- "two sessions derive the same key".
- "seal and open round trip".
- "a changed hello fails to open".
- "a step 2 message can't be opened as step 3".
- "a changed byte fails to open".
- "shortCode is four letters and stable for a hello".

## Task 2.8: Convergence

**Files:** `tests/convergence.test.js`, `tests/fixtures/simulate.js`. **Rules:** design Testing 1. **Depends on:** 2.1–2.7, 1.9.

`simulate({ seed, devices, rounds, ops })` runs seeded random operations: edit, delete, restore, merge, not-same, erase, undo, sync in random direction, and sync interrupted after step 2. Sync follows the three steps exactly. Task 4.6 adds import and restore to `ops`.

Tests:
- "devices converge after everyone syncs with everyone": 50 seeds, 3 and 4 devices, comparing `view()` and the sorted records.
- "a clock that was ahead converges after it is fixed".
- "a newer app with an extra field stays identical".
- "two devices with the same ID converge".
- "a device that drops malformed items equals the others minus exactly those items".

## Task 2.9: End-to-end over QR

**Files:** `tests/e2e-sync.test.js`. **Rules:** design Testing 2. **Depends on:** 2.8.

Test:
- "two trees sync through encrypted QR images with 20% of frames lost": 50 invented people on each side; each frame rendered and read back by jsQR, dropped at random, shuffled; both directions; records must be identical.

---

# Milestone 3: Join

Reference: R9. Same steps as Milestone 1.

## Task 3.1: Comparing two people

**Files:** `public/src/join.js`, `tests/join.test.js`. **Depends on:** Milestone 2.

Tests:
- One test per blocker: different known sexes; exact birth years more than 5 apart; already one set; related; not-same.
- "inexact dates count as unknown".
- "a certain parent, partner and child", one test each, from the R9 table.
- "remarriage: a partner with the same name but no year agreement is only possible".
- "a sibling with the same name and unknown year is only possible".
- "one child under two names is possible".
- "a placeholder parent is possible only when each side has one parent of that sex".
- "uniqueness downgrades two certain candidates to possible".
- "empty keys never match": two Japanese names are never certain.

## Task 3.2: New groups and start points

**Files:** Modify `public/src/join.js`. **Depends on:** 3.1.

Tests:
- "a new group is incoming people linked to nobody existing".
- "single-person groups aren't prompted".
- "groups come largest first".
- "an existing person who gains an incoming relative is a start point".
- "an empty device has no start points".

## Task 3.3: The walk

**Files:** Modify `public/src/join.js`. **Depends on:** 3.2.

Tests:
- "the overlap scenario": the Danilo, Teodora, Miro, Ema example from the design ends with no duplicates.
- "certain matches merge with no question, and queue their pair".
- "a question offers up to three candidates, best first".
- "a different person writes not-same for every candidate shown".
- "not sure writes nothing".
- "the same baby on both sides is merged from the parents".
- "each answer is its own change, tagged with the session".
- "undoing the session undoes the whole join".
- "continue joining skips answered pairs".

## Task 3.4: Review lists and later duplicates

**Files:** Modify `public/src/join.js`. **Depends on:** 3.3.

Tests:
- "automatic() lists every automatic merge".
- "not the same undoes one merge and writes not-same".
- "differences() skips names equal by key".
- "confirming differences writes new edits".
- "duplicatesAround finds two children with the same name and year".
- "duplicatesAround blocks two partners of one person, and same-name siblings with different years".

## Task 3.5: Budget fixture

**Files:** `tests/fixtures/overlap.js`, tests in `tests/join-budget.test.js`. **Rules:** R9 Budget fixture. **Depends on:** 3.4.

Shape it on the cases in `uds2gedcom/tests/test_merge.py`, reading that file for shapes only and using invented names.

Test:
- "the 300-person overlap needs at most 40 questions, with no false merge and nobody missed".

---

# Milestone 4: Files

Reference: R12, R13. Same steps as Milestone 1.

## Task 4.1: GEDCOM parsing

**Files:** `public/src/gedcom.js`, `tests/gedcom.test.js`. **Depends on:** Milestone 3.

Tests:
- "lines parse into a tree of records, joining CONT and CONC".
- "UTF-8 with and without BOM, and UTF-16, decode".
- "other encodings give the re-save message".
- "files over 20 MB are refused".

## Task 4.2: Import mapping and sanitising

**Files:** Modify `public/src/gedcom.js`, `tests/fixtures/*.ged` (hand-written, invented people). **Depends on:** 4.1.

One fixture each shaped like MyHeritage, Ancestry, Gramps and uds2gedcom exports. Check the real export shapes from public documentation and `uds2gedcom/uds2gedcom/gedcom.py`.

Tests:
- "INDI and FAM map to people and links", per fixture.
- "a NAME of type birth or maiden becomes birthSurname".
- "HTML in notes is removed and line breaks kept".
- "text over a limit is cut and counted".
- "tags not kept are counted by tag".
- "import runs the same join", through start points.

## Task 4.3: Import IDs and clock

**Files:** Modify `public/src/gedcom.js`. **Rules:** R12 IDs, Clock; ADR 0006. **Depends on:** 4.2.

Tests:
- "a 16-hex _UID is used as-is".
- "other _UID shapes hash to 16 hex; bad shapes fall back to the file hash".
- "the same file gives the same IDs and hashes on two devices, so sync sends nothing".
- "a re-import adds nobody".
- "a repeated _UID in one file gets its own ID".
- "imported values lose to any real edit, on another device too".
- "import never revives a deleted person or brings back an erased one".
- "import fills only fields with no triple".
- "a disagreeing INDI gets a new ID and reaches the walk".

## Task 4.4: Export

**Files:** Modify `public/src/gedcom.js`. **Depends on:** 4.3.

Tests:
- "export round trips through import": X becomes U, as stated.
- "HUSB and WIFE follow sex, and a lone F partner is WIFE".
- "deceased with no date writes 1 DEAT Y".
- "long notes split into CONT lines".

## Task 4.5: Backup

**Files:** `public/src/backup.js`, `tests/backup.test.js`. **Depends on:** Milestone 2.

Tests:
- "backup round trips records, meta and history".
- "restore gets a new device ID and writes a new device record".
- "an invalid item refuses the whole file, with a report".
- "files over 50 MB are refused".

## Task 4.6: Convergence with files

**Files:** Modify `tests/fixtures/simulate.js`, `tests/convergence.test.js`. **Depends on:** 2.8, 4.3, 4.5.

Add `import` (one of three invented GEDCOM files) and `restore` (backup, then restore with a new device ID) to the random operations.

Tests:
- "devices converge with imports mid-way".
- "restore with a new ID converges".

## Task 4.7: Fixture files for the phones

**Files:** `scripts/make-fixture.mjs`. **Depends on:** 1.10, 4.5.

`node scripts/make-fixture.mjs --people 3420 --seed 1 --out /tmp/steblo-fixture.json` writes an invented backup file. Put it on a phone with AirDrop or Nearby Share, and load it through **Restore a backup**.

---

# Milestone 5: The app

Reference: R14, design §9. Browser modules aren't unit-tested except storage; each task ends with a check in the desktop browser.

## Task 5.1: Storage

**Files:** `public/ui/storage.js`, `tests/storage.test.js`. **Depends on:** Milestones 1 and 4.

Install the dev dependency exactly, then commit the lockfile:

```bash
npm install --save-dev --save-exact --ignore-scripts fake-indexeddb@6.2.5
```

Tests (on fake-indexeddb, with failure injection):
- "commit writes records, history and meta in one transaction".
- "an aborted transaction leaves nothing and reports the failure".
- "a quota error is reported and locks editing".
- "load recomputes last from stored times".
- "restore swaps everything in one transaction".
- "a migration copies the stores to a snapshot first".
- "the snapshot is removed after the next good start".
- "VersionError gives state newer".
- "a second opener gets state locked".
- "exportRaw works in state newer".

## Task 5.2: Layout

**Files:** `public/src/layout.js`, `tests/layout.test.js`. **Rules:** R4 Layout contract. **Depends on:** 1.7.

Port the layout maths from the private app's `public/app.js:174-395` (`measureUp`, `placeUp`, `shapeDown`, `placeDown`, `layoutForest`) as pure functions of `view()` and a focus person, replacing `f.h`, `f.w`, `f.k` with `partners` and `children`, and `anchorOf`/`ownKids` with the R4 contract. The module uses no DOM, so it is tested in Node.

Tests:
- "the hourglass places ancestors above and descendants below".
- "an anchor is partners[0], and a child appears once in the forest".
- "an ancestor loop stops at the repeat".
- "layout of 3,420 invented people takes under 300 ms on Node".

## Task 5.3: Shell, strings and rendering

**Files:** `public/index.html`, `public/style.css`, `public/motion.css`, `public/ui/app.js`, `public/ui/render.js`, `public/ui/i18n.js`, `public/strings/en.json`, `public/strings/mk.json`, `public/manifest.webmanifest`, `public/icons/*`. **Depends on:** 5.1, 5.2.

Copy `style.css`, `motion.css` and the icons from the private app, removing the Google Fonts link and any `style=` use. Render with `createElementNS`, `textContent` and `el.style`. Redraw from `tree.view()` after each adopted change. Port the view maths from `public/app.js:505-617` and the pan, pinch and wheel handlers from `:1535-1610`.

Keep the element IDs the CSS relies on: `canvas`, `ruler`, `svg`, `glow`, `world`, `tags`, `search`, `results`, `panel`, `panel-body`, `status`, `btn-back`, `btn-fwd`, `btn-home`, `btn-fit`, `ctx`.

Start `docs/hand-check.md` here: one line per story this task delivers, with a pass condition and the device to use. Each later UI task adds its stories before starting.

Check in the browser:
- The tree draws and pans under the production CSP, with no console errors.
- The Macedonian strings show, and **Show in Latin letters** converts names and UI.

## Task 5.4: Forms and the card menu

**Files:** `public/ui/forms.js`. **Depends on:** 5.3.

First add `tree.link(kind, a, b)` to `public/src/tree.js`, with tests: "link makes an existing person a parent", "link makes two existing people partners", "linking a third parent throws", "a link that would make someone their own ancestor throws", "linking an existing link changes nothing". Then add **Link to someone already in the tree** (parent, child or partner, with a person picker) to the card menu (story 76).

Build the card menu and forms for edit, add relative (surname prefilled by `formFor`), partial dates, places, notes, marriage, deceased and birth surname. Delete and erase go in the menu, and erase needs the typed given name.

Add **This is me** to the menu (stored in `meta.thisIsMe`, resolved through merges).

Check in the browser: the `docs/hand-check.md` lines for stories 9–21, 24 and 76.

## Task 5.5: Other screens

**Files:** `public/ui/screens.js`. **Depends on:** 5.4.

Search by matching key, Needs attention, History (per person, deletions, undo with the warnings from R10), Settings (name, language, Latin switch, storage status, backup and restore, GEDCOM import and export with their warnings, last backup).

Needs attention also offers **Erase the rest** for partly erased people. Settings changes the name with `tree.setDeviceName`. The tree screen shows a quiet backup banner after 30 days with changes.

Check in the browser: the `docs/hand-check.md` lines for stories 22–27 and 52–72.

## Task 5.6: First start

**Files:** Modify `public/ui/app.js`. **Rules:** design §9 First start. **Depends on:** 5.5.

Detect standalone mode. On iOS outside the installed app, show only install instructions. Then language, name, and the four choices. Request persistent storage once a person exists. Apply any fallback from spike item 8. When `openStorage` gives state `locked`, show "Steblo is open in another tab."; state `newer` shows the newer-data screen with **Save backup**.

Check on phones: install flow on iPhone and Android.

## Task 5.7: Redraw speed on phones

**Depends on:** 5.5. **Rules:** R17 item 9.

Load the file from task 4.7, and measure a redraw with `performance.now()` around the `view()` and layout calls. Pass: at most 300 ms on both phones. On a miss, apply the R17 fallback. Add the result to `docs/specs/spike-results.md`.

---

# Milestone 6: Sync and join screens

Reference: R6, R9. Check on the two phones.

## Task 6.1: Scanner and display

**Files:** `public/ui/scanner.js`, `public/ui/decode-worker.js`, `public/ui/display.js`. **Depends on:** Milestone 5, 0.11.

Move the working camera and drawing code from `public/spike/spike.js`, using the settings pinned in task 0.11. The display requests Wake Lock on every showing screen, with the R17 fallback notice. The scanner handles camera denied and no camera.

Check: a code shown on one phone is read by the other. Then delete `public/spike/`, keeping `docs/specs/spike-results.md`, except for one file: replace `public/spike/sw.js` with a stub that unregisters itself (`install` calls `skipWaiting`, `activate` calls `self.registration.unregister()`), so phones that installed the spike stop serving its cached pages.

## Task 6.2: The sync flow

**Files:** `public/ui/sync-screens.js`. **Rules:** R6 table. **Depends on:** 6.1.

Implement each row of the R6 table: first-screen notice, roles, 4-letter code, Continue, time estimate from R8, Next: scan, Show my code, Finish, Cancel, summary. Editing is locked during a sync. Handle clock mismatch through the hello-only stream, version mismatch, and the erase confirmation.

Check on phones, using fixture files from task 4.7 with different seeds: first sync of two invented trees; repeat sync; cancel at each step and sync again; clocks 3 days apart; a device with an erase.

## Task 6.3: The join screens

**Files:** `public/ui/join-screens.js`. **Rules:** R9. **Depends on:** 6.2.

Build the picker for a join pair, questions, Keep separate, Keep all remaining separate, the automatic list, Check differences, Continue joining, Join from Needs attention, Same person as…, Look for duplicates around…. Also the import join for one person.

Check on phones: stories 42–51.

---

# Milestone 7: Release

## Task 7.1: Service worker

**Files:** `public/sw.js`, `public/sw-files.js`, `scripts/release.mjs`, `tests/release.test.js`. **Rules:** R15. **Depends on:** Milestone 6.

Add `"release": "node scripts/release.mjs"` to `package.json`. Run `npm run release` after any change in `public/`.

Tests:
- "every served file is in sw-files.js": on failure it says to run `npm run release`.
- "the version hash changes when a file changes".

Check in the browser: offline start, no mixed versions after an update, Update tap.

## Task 7.2: Guards

**Files:** `tests/no-network.test.js`, `tests/rendering.test.js`. **Depends on:** Milestone 6.

Tests:
- "no network APIs outside sw": `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`.
- "no innerHTML and no style attributes in public/": skips `public/vendor/`, which contains `style=` in unused code.
- "strings files have the same keys".

## Task 7.3: Docs

**Files:** `README.md`, `CONTRIBUTING.md`. **Depends on:** 7.1.

README: what it is, how to install, how sync works, privacy, limits. CONTRIBUTING: how to run tests, how to add a language, why name lists exist. Update `CLAUDE.md` if commands changed.

## Task 7.4: Hand-check list

**Files:** `docs/hand-check.md`. **Depends on:** Milestone 6.

Complete the list started in task 5.3, so every user story in `.scratch/steblo-v1/spec.md` has a line. Stories fully covered by automated tests say so.

---

# Milestone 8: Acceptance

## Task 8.1: Real-tree join run

**Files:** nothing committed. Script kept outside the repo. **Rules:** design Testing 4. **Depends on:** Milestone 7.

On Alex's Mac only. A script outside the repo converts the private `base.json` to records. It splits at random, with each half holding 70% of the people plus their links between them, and gives each half its own device. A person's original ID is the truth, but the halves use fresh IDs, so nothing matches by ID. Run the join with answers from the truth on three seeds, and print only counts. Pass: no false automatic merge, at most 10% of shared people asked, at most 2% missed. On a miss, adjust the rules using invented test cases, then rerun.

## Task 8.2: Hand check

Work through `docs/hand-check.md` on both phones. Fix what fails, with a test where one is possible.

## Task 8.3: Full sync with the largest tree

Import the 3,420-person GEDCOM from `uds2gedcom` on one phone (Alex's data, on his phone only), and sync it to the other. Pass: at most 2 minutes per direction. Nothing leaves the phones.

## Task 8.4: Go live

Only with Alex's go-ahead:
1. Create `main` from `dev`, push it, and make it the default branch. This is the first production deployment, at `steblo-app.vercel.app`.
2. Protect `main` on GitHub.
3. Confirm the headers with the curl check from task 0.9, against the production address.
4. Install from the production address on both phones. Earlier Home Screen icons can be removed.
5. Tag `v1.0.0`.

---

## Requirement coverage

| Requirement | Tasks |
|---|---|
| QR speed gate, spike items | 0.5–0.10, 5.7 |
| Data model, later-wins rule, sets, view | 1.1–1.7 |
| History, undo | 1.8 |
| Erase | 1.9, 2.4, 5.4, 6.2 |
| Bucket sync, payload, apply, clocks | 2.1–2.6 |
| Encryption, 4-letter code | 2.7, 6.2 |
| Convergence, end-to-end | 2.8, 2.9, 4.6 |
| Join | 3.1–3.5, 6.3, 8.1 |
| GEDCOM, ADR 0006 | 4.1–4.4 |
| Backup, durability | 4.5, 5.5, 5.6 |
| This is me, rename, other-tab screen, backup banner | 5.4, 5.5, 5.6 |
| Storage contract, migrations | 5.1 |
| UI, reuse from the private app, languages | 5.2–5.6 |
| Install-first | 5.6 |
| Service worker, updates | 7.1 |
| Security headers, no network, no innerHTML | 0.1, 7.2 |
| Privacy check | 0.3 |
| Hosting, address | 0.9, 8.4 |
| Vendored libraries | 0.4 |
| Hand-check list | 7.4, 8.2 |

## Verification Checklist

After all tasks:
- [ ] `npm test`: all pass
- [ ] `privacy-check`: clean
- [ ] No build step: `public/` is served as written
- [ ] `docs/hand-check.md`: every line ticked
- [ ] Real-tree join run within its thresholds
- [ ] The gate held on real phones
- [ ] Every requirement above is covered
