# Goldfish Review: Steblo v1 plan

Status: resolved
Doc: plans/PLAN_steblo-v1-2026-10-30.md · Reviewer: goldfish-readiness (IR) · Round: 1

Verdict: FAIL, 1 Blocker. Milestone 0 held up: no transcription drift, and the test count matches. The gaps are in the contracts between later milestones.

Re-derived before triage:
- `npm test` with the directory form passes on Node 26.12.1, and a helper file in `tests/fixtures/` did not show up as a test.
- `qrcode.mjs:460` and `:472` contain `style="`.
- Pan and pinch handlers are at `app.js:1535` onward.

| ID | Sev | Finding (one line) | Call | Evidence or edit |
|----|-----|--------------------|------|------------------|
| IR-1 | Blocker | Convergence task 2.8 needs GEDCOM import and restore, which come in Milestone 4 | FIX | 2.8 covers everything except those two. New task 4.6 adds import and restore to `simulate`. |
| IR-2 | Major | Interfaces don't say what is async, and leave shapes undefined | FIX | Mark async (everything using `crypto.subtle` or streams). Hello: `{ bytes, f, app, d, w, k, n, h }` from `parseHello`. Records: `Map`. Define `meta`, ChangeGroup, `choices`, `relation`, `writes`, `summary`, `newGroups`, questions and answers. `gainedRelatives` feeds `selfPairs`. Storage gains `exportRaw()`; the lock is taken in `openStorage`. |
| IR-3 | Major | If LT wins, no production LT stream code exists, and the collector would misread it | FIX | Move LT into `frames.js` now: `ltFrames` and a `Collector` that follows `coding`, with tests. Task 0.11 lists exact deletions per outcome, spike imports included. |
| IR-4 | Major | Nothing owns step stream assembly | FIX | Add `makeStep2` and `readStep2` to `sync.js`, with the hello-only variant and a 64 KB hello limit. Steps 1 and 3 are plain bytes. |
| IR-5 | Major | Directory form of `npm test` might fail | FIX (partial CONTEST) | Directory form ran fine (above). Still changed to `node --test "tests/**/*.test.js"`, which can never run helpers. |
| IR-6 | Major | Spike URL is the production address; no way to get builds to phones during Milestones 5–8 | FIX | All work is on a `dev` branch, which is the repo's default until go-live. Vercel's production branch is `main`, which doesn't exist until task 8.4, so nothing reaches `steblo-app.vercel.app` before then. Every push to `dev` gets a public preview at a stable branch URL, and phones use that. Vercel steps stated as dashboard actions. **Alex decides** (asked with this triage). |
| IR-7 | Major | Values to pin aren't logged or derivable | FIX | Derivations stated: LT factor = frames ÷ K, q = 1 − shareRead. "Best" = highest KB/s that meets the gate. Each grid change starts from the best so far. Spike logs `firstReadMs`. R17 item 10 changes to "higher share of frames read wins". |
| IR-8 | Major | Task 7.2's guards would fail on vendored files | FIX | The guard skips `public/vendor/`. The spike is deleted earlier, in task 6.1, once its camera code has moved. |
| IR-9 | Major | Generator points at a scratch file; no way to load invented trees on phones | FIX | Rules for the generator written into 1.10. New `scripts/make-fixture.mjs` writes an invented backup file, restored on the phone through the Files app. |
| IR-10 | Major | No task for This is me, device rename, Erase the rest, the other-tab screen, the 30-day banner | FIX | Added to tasks 5.4–5.6, with `tree.setDeviceName`, `tree.eraseRest` and `meta.thisIsMe`. |
| IR-11 | Major | Pan and zoom line range wrong | FIX | Cite `app.js:505-617` and `:1535-1610`. |
| IR-12 | Major | Hook proof is prose and could print a real name; constraint contradicts the names list | FIX | Exact commands with stdout discarded. Constraint now says the names list in step 3 is the one permitted read of private data. |
| IR-13 | Major | UI pass conditions arrive too late; DOM ids unstated | FIX | `docs/hand-check.md` starts in 5.3 and grows per task. Task 5.3 lists the DOM ids the CSS needs. |
| IR-14 | Major | `addRelative` semantics undefined; several operations untested | FIX | Rules: a sibling of someone with no parents creates one placeholder parent linked to both; `otherParent` is an existing person ID that also gets a parent link. Tests added for `unlink`, `editPartnership`, `resolve`, `sanitiseText`, `genderOf`. |
| IR-15 | Major | Real-tree split undefined | FIX | Random split: 70% of people in each half, three seeds. Records are built by a script outside the repo. Truth is the person's original ID. |
| IR-16 | Nit | Question budget 30 in spec, 40 elsewhere | FIX | Spec updated to 40. |
| IR-17 | Nit | Assorted | FIX | `cd` after the rename. Launch config shown. `layout.js` moves to `public/src/` (it's pure); storage tests may import from `public/ui/`. Icons listed once. `scripts/release.mjs` gets `npm run release`, and `npm test` fails with a clear message when it's stale. 8.3 pass is 2 minutes per direction. 5.7 measures with `performance.now()`. `CONTRIBUTING.md` added to the File Map. `differingBuckets` test moves to 2.2. The 175 KB test sets `noteShare` 0.03. "null sorts lowest" belongs to `compareTriples`. |

Counts: 17 rows: 17 FIX (one partial CONTEST) · 1 Blocker: IR-1.

## Outcome (2026-11-04)

Alex approved applying all rows, including the `dev` branch model. All were applied. Two further changes keep Milestone 0 free of commits until Alex allows them: the `dev` branch is set with `git symbolic-ref` (the repo has no commits yet), and the hook proof runs the hook directly rather than attempting a commit.

Not re-audited: no reviewer has read these fixes. Milestone 0's are checked by rebuilding its files from the plan text and running the tests. Milestones 1–8 are re-checked when each milestone's full code is written.
