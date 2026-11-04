# Goldfish Review: Steblo v1 design

Status: resolved
Doc: docs/specs/2026-10-30-steblo-v1-design.md · Reviewers: goldfish-zoom-out (ZO), goldfish-naive-reader (NR), goldfish-critic (CR) · Rounds: 3

Verdicts: all three PASS WITH FINDINGS, no Blockers. Findings that name the same problem are merged into one row.

Re-derived before triage:
- The private app's `app.js` has 16 `innerHTML` uses, 2 inline `style="` templates, and `location.reload()` at lines 908, 1044 and 1203.
- `session.js:40-44` swallows every IndexedDB error.
- `sw.js` calls `skipWaiting()` on install and serves network-first per file.
- `tree.js:203` rejects `\u0000-\u001f<>`, newline included.
- A payload measurement (`payload-size.mjs`, scratchpad, Node 26.12.1) on an invented tree of 3,420 people, deflate-raw:

| Encoding | Size |
|---|---|
| naive, UUID IDs | 322 KB |
| compact, UUID IDs | 124 KB |
| naive, 64-bit IDs | 174 KB |
| compact, 64-bit IDs | 87 KB |

"Compact" means IDs listed once, links by index, and one clock per action. The invented names come from small lists and compress better than real ones, so these are lower bounds.

| ID | Sev | Finding (one line) | Call | Evidence or edit |
|----|-----|--------------------|------|------------------|
| ZO-5, NR-2, CR-1 | Major | `vv` advances past records the receiver dropped, so they are never resent; import and edit don't share sync's validator | FIX | One validator for edit, import, receive and restore. On receive, `vv[d]` is held below the earliest rejected triple from `d`. Links to a missing person stay hidden until it arrives. Convergence test with one device running a stricter validator. |
| NR-8, CR-2, ZO-17 | Major | "Control characters and `<>` rejected" breaks multi-line notes and GEDCOM; import behaviour on bad text undefined | FIX | Names and places are single-line (control characters stripped, spaces collapsed). Notes keep `\n` and `\t`. `<>` allowed everywhere, since all text renders as text. Import strips HTML tags from notes and cuts text over the limit; both are counted in the import summary. Fixture with a multi-line, HTML-ish note. |
| NR-7, CR-14 (clock) | Major | No bound on clock values: one far-future phone or forged triple drags every clock forward for good | FIX | A triple is rejected if `ms` > receiver's now + 24 h or `counter` > 65535. It is held back per row 1, and the user is told the other phone's clock looks ahead. |
| ZO-6, NR-17 | Major | B's `vv` after the last step is undefined; payload lacks `vv`; plaintext hello isn't authenticated | FIX | The payload carries the sender's `vv` inside the ciphertext. AES-GCM associated data covers both hellos and the direction. Test: step 2 delivered, step 3 lost, sync again. |
| NR-4, ZO-12 (PRNG), CR-7 (PRNG, caps) | Major | Wire format can't be implemented from the doc: keys, header layout, PRNG and fountain parameters missing; header length uncapped | FIX | New wire-format appendix with hello and payload keys and the frame header byte layout. PRNG mulberry32 (integer-only, the same in every engine). Total length and block count are capped before any allocation. |
| ZO-12, CR-7 | Major | LT fountain coding chosen before measuring; no simpler alternative weighed | FIX | The spike compares plain cyclic repeat against systematic+LT on the phones, including decode CPU, and picks by the numbers. Alternatives entry and a Risks row added. |
| ZO-1, NR-10, CR-6 | Major | Speed gate sized for 300 people, but the real tree is 3,420; bytes per person not measured; caps incoherent; no ETA | FIX + QUESTION | Record the measurement above. Choose compact encoding and 64-bit person IDs. Byte-budget test with realistic clocks and devices (3,420 people ≤ 150 KB). Gate: 3,420 people ≤ 2 min per direction. ETA shown while scanning. Max tree 10,000 people; caps 4 MB compressed and 16 MB decompressed, with a clear refusal above. **Question for Alex:** if the phones miss the gate, may the fallback be an encrypted sync file sent by AirDrop or Nearby Share, or does QR stay the only way (ADR 0002 is his decision)? |
| NR-5 | Major | No mechanism for switching between showing and scanning | FIX | Taps: the showing screen has "They've got it, now scan theirs"; the scanning phone shows "Got it ✓" with a big "Show my code" button. Both screens defined per step. |
| ZO-11, CR-4 | Major | A cloned phone (whole-device restore) writing under the same device ID silently loses changes; triples can tie | FIX (partial) | Order becomes `(ms, counter, device, value)`, which is total. Hello check: if the other phone's `vv[myId]` is above mine, someone else writes as me, so rotate my ID and exchange every triple of the old ID in full. A web app has no storage that survives a device restore, so a clone the check misses stays possible: accepted trade-off in Risks. |
| ZO-8, NR-6, CR-16, NR-12 (order), NR-3 (tie) | Major | Merged sets: `deleted` rule contradicts the latest-field rule; collapsed links have no rule; not-same ignores merges; "created first" has no data | FIX | A set of records (merged people, or links that resolve to one pair) acts as one record: every field, `deleted` included, takes the latest triple across the set. Deleted means the latest `deleted` is true and no other field of the set is later (`≥`). Delete and restore write every record in the set. Not-same applies set to set, and an active merge beats it. More than two parents: the layout uses the two links with the smallest IDs. |
| ZO-9, NR-12 | Major | "New groups" is device-local state inside `view()` | FIX | Needs attention lists every component other than the largest (a pure function of the view). The join prompt comes from what receiving returns, not from the view. B gets the join prompt too if A skipped it. |
| ZO-7, NR-3, CR-12 (undo) | Major | Undo of a creation undefined; undoing a sync deletes relatives' data on their phones without saying so | FIX | Undoing a creation sets `deleted` on the created records, and fields with no `before` are left alone. The confirmation for undoing a sync says it also removes those people on relatives' phones at their next sync. |
| CR-11 | Major | "The other value kept in history" is false when the incoming value loses | FIX | The sync change group logs every losing triple, in both directions (record, field, the value that lost, and whose it was). Test that the loser is visible in the winner's history. |
| NR-13, CR-12 (size), ZO-19 (size) | Major | History stores full triples for every import and sync, grows without limit, and goes into every backup | FIX | Created records are logged by ID only, about 70 KB for a 3,420-person import. Kept in full up to 20 MB, after which the oldest groups are dropped with a note in History. |
| ZO-4, NR-9, CR-3 | Major | Reused IndexedDB helper swallows errors; no atomicity, migrations or clock reload | FIX | Persistence contract: each action, receive, import or restore is one transaction over records, `vv`, history and meta. A failure shows an error and blocks editing. The schema is versioned, with tested migrations. On load, `last` = the max of all stored `t` and `vv`. |
| ZO-4, CR-10 (sw), CR-18 (SHELL) | Major | Reused service worker auto-activates and mixes module versions; hand-kept file list | FIX | A release script writes the file list and its hash version; a test checks every served file is listed. Install caches everything or nothing. The new version waits until the user taps "Update", then reloads. Cache-first from the versioned cache. |
| ZO-2, ZO-3, NR-1, NR-11, CR-10 | Major | The `app.js` "port" is a rewrite; `innerHTML` and inline styles conflict with the CSP; zxing-wasm needs `wasm-unsafe-eval` | FIX | Say it plainly: layout maths and styles are reused, rendering is rewritten as DOM building with positions set through `el.style`. The view-to-layout contract is written down. The full CSP is in the doc. The spike runs under it, and `'wasm-unsafe-eval'` is added only if zxing-wasm wins. |
| ZO-10, CR-5 | Major | iOS keeps Safari storage separate from the Home Screen app, so a tree typed in Safari is lost on install | FIX | On iOS outside the installed app, first start shows install instructions and allows no data entry. Spike item checks the isolation. Risks row. |
| ZO-13, CR-8, NR-14, ZO-19 (rules) | Major | The join could ask hundreds of questions; transliteration keys miss gj/zh/đ variants; scoring vague; sides indistinguishable after merging | FIX | Names are compared by an ASCII key that folds Cyrillic, diacritics and digraphs (ѓ/ǵ/gj/đ/dj, ж/ž/zh, ђ, ћ). Certain matches are merged automatically and listed for review with one-tap undo; only uncertain ones are asked. No field question when values are equal after folding; real conflicts are reviewed once at the end, ours preselected. Scoring, blockers and the spouse and sibling rules (adapted from the private app's matching rules) are spelled out. Budget test: on a 300-person overlap fixture, at most 10% of matched people get a question. |
| NR-15, CR-9 | Major | Adopting `_UID`: short or duplicate values conflate people; a later re-import overrides relatives' edits or revives deletions | FIX | Strict shapes only: 16, 32 or 36 hex characters, or a UUID. Duplicates within a file get new IDs. An existing ID whose name or birth year disagrees goes to the join instead. Imported values are written under a per-import identity with the file's export date as their clock time, so any real edit beats them, and re-import never writes `deleted`. |
| CR-13 | Major | Restore isn't validated, has no size cap, and overwrites without a safety copy | FIX | Validate the whole file, history included, before touching storage. 50 MB cap. The swap is one transaction, so the old tree stays until the new one is committed. The warning offers "Save current tree first". Undo re-validates. |
| CR-14 (erase, files) | Major | Deleted people's data still travels in syncs and backups; backups and exports are plaintext | FIX + QUESTION + CONTEST | FIX: backup and GEDCOM export warn "Anyone with this file can read your tree." CONTEST encrypted backups: plain JSON was Alex's choice (round-2 Q11). **Question for Alex:** should v1 have "Erase", which blanks a person's details on every phone and scrubs them from history, for a living relative who asks to be removed? |
| CR-15 | Major | Data is tied to a free subdomain we don't own: project deletion or account compromise means takeover of every tree | FIX + CONTEST | FIX: Risks row with hardening: never delete the Vercel project, 2FA on GitHub and Vercel, protected `main`, production deploys only from `main`. Availability checked 2026-10-30 (`x-vercel-error: DEPLOYMENT_NOT_FOUND`). CONTEST buying a domain: Alex chose a vercel.app subdomain like the private app. |
| CR-17 | Major | Convergence tests compare only `view()`; missing scenarios; no numbers behind the claims | FIX | Compare full record state and `vv` as written to a backup, sorted. Generator operations added: interrupted sync, clock skew, restore with a new ID, GEDCOM import mid-sync, stricter validator, clone. Numeric checks: `view()` for 5,000 people under 200 ms in Node, payload budget, join question budget. |
| ZO-15, NR-16 | Major | Stories 22, 45 and restore have no entry in the UI | FIX | Search on the tree screen; "Same person as…" in the card menu; deleted people restorable from History, which can be filtered to deletions. |
| ZO-14, NR-19 | Nit | "Merge" and "peer" used against the glossary; doc terms missing from it | FIX | Use "apply" for receiving and "later-wins rule" for fields, and "device" throughout. Glossary gains Separate group and Needs attention. |
| ZO-18, CR-18, NR-20 (claims) | Nit | Unverified or loose claims: npm sizes, Node version, "verified" label, 3,420 count, dead review link | FIX | Caveat the npm sizes as package size, not download size. Node: checked on 26.12.1. The 3,420 count is from the private data file, 2026-10-30. Remove the claim that the layout already draws it. This file now exists. |
| NR-18, CR-18, ZO-15 (wording) | Nit | Step numbering differs between doc and spec; divorce vs separation | FIX | Three QR steps, with the join between steps 2 and 3, in both. "Separation (divorce)" in both. |
| ZO-15 (X), NR-20 (X) | Nit | Sex X has no story, and 5.5.1 has no X | CONTEST | Decided by Alex in round-1 Q6. It is exported as U, the round-trip test excludes it, and the doc says so. |
| ZO-16 | Nit | Plaintext hello reveals device count and edit times; `vv` grows | FIX | Documented as a known, minor leak. `vv` grows by one entry per device and per import. |
| ZO-19, NR-20 (rest) | Nit | Assorted | FIX | Cut "pluggable". The QR decoder is callable on raw RGBA in Node. A date may hold `text` without `y`; its sort year comes from the first four-digit year in `text`. Format mismatch handled both ways. "This is me" resolves through merges. History says times are this phone's. The device record follows the normal `vv` rule. Over-cap input is rejected, never truncated. Install: instructions on iOS, an install button on Android. Alex and the private app are introduced. |

Counts: 26 FIX (one partial, two combined with a CONTEST or question) · 1 CONTEST (plus two partial) · 2 questions for Alex.

## Round 1 outcome (2026-10-30)

- Alex approved applying all FIX rows. All were applied to the design doc, the spec, the glossary and ADRs 0002 and 0004–0007.
- Alex's answers to the two questions:
  - If the speed gate is missed, building stops and he decides. There is no pre-approved fallback.
  - Erase is in v1 (ADR 0007).
- Round 2 runs all three reviewers again, because every one of them had Major findings fixed.

## Round 2 (2026-10-30)

Reviewers: goldfish-zoom-out (ZO), goldfish-naive-reader (NR), goldfish-critic (CR). All three PASS WITH FINDINGS, no Blockers. Round-2 IDs restart at 1.

The main structural finding is CR-4. Version vectors (`vv`) are the root of CR-1, CR-2, CR-3, ZO-4, NR-7, CR-16 and the clone mechanism (ZO-7). The proposed fix is to replace them with **bucket digests**:
- Every record belongs to one of 256 buckets by ID.
- The hello carries a 4-byte hash per bucket, about 1 KB.
- The phones exchange the full contents of every bucket whose hashes differ.
- There is no `vv` at all.

What this buys:
- Divergence heals itself at the next sync.
- A cloned device ID needs no special handling, since the value tie-break settles it.
- A forged hello can only cause extra bytes to be sent.
- Imported values can be dated by the file without a separate identity.

The cost: a repeat sync sends whole buckets, about 35 records each for 3,420 people, rather than single fields. For 10 changed people that is about 10–15 KB, which is seconds.

| ID | Sev | Finding (one line) | Call | Evidence or edit |
|----|-----|--------------------|------|------------------|
| CR-4, CR-1, CR-2, CR-3, ZO-4, NR-7, ZO-7, CR-16 (vv parts) | Major | `vv` deltas are fragile: forged or out-of-range `vv`, hold-back with no exit, clones that strand triples, empty state undefined | FIX | Replace `vv` with 256 bucket digests (above). Delete the clone mechanism, `vv` validation and the hold-back rule. Rejected triples leave their bucket different, so they are resent each sync (bounded to that bucket) and counted. Test: a permanently invalid triple keeps the payload bounded. |
| ZO-1, NR-6 | Major | A phone whose clock was ahead stays unsyncable after the clock is fixed | FIX | On start and before each sync, a device with `last.ms > now + 24 h` re-stamps its own triples that are dated beyond now + 24 h at the current clock, and resets `last`. Receivers still reject triples beyond now + 24 h. Message and story 39 updated. Test: skew, fix, sync. |
| NR-8, CR-16 (counter) | Major | Counter overflow undefined | FIX | On overflow, `ms + 1` and counter 0. |
| ZO-2 | Major | Commit order between memory and IndexedDB undefined; no owner for sets | FIX | Each `tree` operation returns a pending change (records, history group, meta). `storage` commits it in one transaction, and only then does `tree` adopt it. Sync payloads are built only from adopted state. `tree` owns sets and canonical IDs. |
| ZO-3, NR-2, CR-7 | Major | "About 10,000 people" doesn't follow from the caps; block cap inconsistent with block size; no time warning | FIX | The caps are memory guards only (stream ≤ 4 MiB, S 300–1500, K ≤ 16384). Before showing codes, the sender shows "About N minutes" from the stream size and the throughput measured in the spike, with Continue and Cancel. The 10,000 figure is removed. |
| NR-1 | Major | The gate runs on a payload the doc calls a lower bound | FIX | Gate payload: 3,420 people with high-entropy invented names, realistic clocks and history, padded to at least the 150 KB budget. Its byte size is stated in the spike report. |
| CR-8 | Major | Imported `_UID`s break the 64-bit-ID size assumption | FIX | A foreign `_UID` becomes the first 16 hex of SHA-256 of the lowercased `_UID`. That is deterministic, so two relatives importing one file agree. A 16-hex `_UID` (our own export) is used as-is. |
| ZO-5 | Major | Closed format: any new field forces lockstep updates or permanent rejections | FIX | Unknown fields of known kinds (name `[a-z]{1,4}`, value ≤ 1 KB of JSON) are stored, relayed and hashed but not shown. `format` changes only for incompatible changes, and validation limits change only with `format`. |
| CR-5, CR-6, NR-10 | Major | Import can revive deleted or erased people; "empty" undefined; a disagreeing INDI linked to a matched person escapes the join | FIX | Import never writes to a deleted or erased set and skips INDIs that resolve to one (counted "skipped"). "Empty" means no triple at all. The walk also starts from every existing person who gained incoming relatives (below), so linked INDIs are asked about. Imports no longer need an identity (ADR 0006 revised: dated by the file under the importing device's ID). |
| NR-4, CR-9 | Major | Walk undefined for one person; no way back into a skipped join; a killed join undefined | FIX | The walk's start points are the chosen join pairs, plus every existing person who gained incoming relatives in this receive or import. "Look for duplicates around X" compares X's relatives within each relation with each other. Needs attention → separate group → **Join** opens the join-person picker. Each answer commits on its own, tagged with a join session; History shows and undoes the session as one group. A killed join keeps its answers, and Needs attention offers **Continue joining**. |
| NR-5 | Major | "Partly erased" condition and action undefined | FIX | Listed only when some, but not all, records of a set are erased. Action: **Erase the rest**. |
| NR-9, CR-14 | Major | Certain and possible rules ambiguous; inexact dates block merges | FIX | An explicit table per relation in the reference spec. Only exact dates (no `q`, no `text`) count as known years. Uniqueness is checked from both sides. A manual "Same person as…" warns instead of blocking. |
| NR-12, CR-12 | Major | The question-budget fixture is undefined and invented to suit the rules | FIX | Fixture: two trees of 400 and 350 people sharing 300, with 30 shared people given a close-but-not-same spelling on one side, plus 20% unknown birth years. Also a local-only acceptance run on Alex's Mac, never committed: split the private tree into two overlapping halves and report only counts (questions, false merges, misses). It is a release criterion. |
| NR-13 | Major | Tap sequence and the end of a sync are muddled; join commit semantics conflict | FIX | A per-step table: screen, button, trigger and next screen for each phone. The join runs only on A. B is offered a join only for groups A kept separate, and B's answers reach A at their next sync. |
| NR-11 | Major | Convergence expectations impossible for the stricter-validator and future-clock cases | FIX | Expected results stated. Devices with the same validator end identical. A device that drops malformed triples equals the others minus exactly those triples, and reports them. After a clock fix and re-stamp, all are identical. The "stricter validator" case becomes "newer version with an extra field", which must stay identical. |
| NR-3 | Major | The reused surname functions are Cyrillic-only | FIX | Moved to "extended": Latin endings -ova/-ov, -eva/-ev, -ska/-ski, -cka/-cki, keeping the minimum-stem guard. |
| CR-10 | Major | Spike items lack pass/fail criteria and fallbacks (Wake Lock on iOS Home Screen apps is suspect) | FIX | A pass condition and fallback for each item: Wake Lock falls back to an "Keep the screen awake: tap it now and then" notice; the camera has denied and missing screens; file save falls back to the share sheet; a failed persistence request gets a stronger backup nudge. |
| CR-11 | Major | No safety copy before migrations; older app meeting newer data | FIX | Before a schema upgrade, copy all stores into a dated snapshot store, kept until the next successful start. On `VersionError`, show "This phone has data from a newer Steblo", with **Save backup**. Risks row added. |
| CR-13 | Major | Missing Risks rows; hostile or accidental Erase | FIX | Rows added for the new risks. Erase requires typing the person's given name. |
| ZO-6 | Nit | Both frame codings specified and shipped | FIX | Cyclic is the default. LT is built only if cyclic misses the gate, and the loser is deleted from the reference spec and tests. |
| ZO-8 | Nit | One prompt per separate group, including singletons | FIX | Groups of one person aren't prompted; they go to Needs attention. **Keep all remaining separate** button. |
| ZO-9 | Nit | The private app's search `fold` differs from the new key | FIX | The new matching key supersedes `fold`. |
| ZO-10, NR-15 (glossary) | Nit | "Peer", "component" and "transfer" still used; Erase contradicts "any change can be undone" | FIX | Wording fixed. Glossary History and ADR 0003 say "except Erase". |
| ZO-11 | Nit | base45 and the Worker unjustified | FIX | The spike picks byte mode or base45 (decoder handling of binary data), and the Worker only if decoding on the main thread drops frames. |
| ZO-12 | Nit | Reference detail buries the architecture | FIX | Split: the design keeps architecture and decisions; a new `2026-10-30-steblo-v1-reference.md` holds wire format, validator, matching rules, flow table and frame details. |
| ZO-13 | Nit | Layout contract missing (anchor and one family per child); local path in a public doc; repo owner unexplained | FIX | Contract: `view()` gives each child one **own family** (its two parent links with the smallest IDs), and the anchor is `partners[0]`. The local path is removed. `Xin-Dragons` is Alex's GitHub organisation. |
| CR-15 | Nit | Equal-value "losers" flood the log after a shared import | FIX | A loser equal in value to the winner isn't logged. |
| NR-14 | Nit | Vague mechanisms | FIX | `mulberry32` returns a u32. The CDF holds integer thresholds out of 2³². Canonical JSON = sorted keys, no spaces. Differences compare dates structurally and text trimmed. Largest-group ties go to the smaller canonical ID. Partner order: M, then X or U by ID, then F; a lone F parent is exported as WIFE. Undo equality is triple equality. Wake Lock is requested on every showing screen. Time remaining = blocks left ÷ measured rate. |
| NR-15 | Nit | Terms undefined or used before definition | FIX | Hello, version, LT, systematic and uds2gedcom defined at first use. Review IDs removed from Risks. The `_UID` shapes are written exactly. |
| NR-16, CR-17 | Nit | Process and hosting gaps | FIX | `sw-files.js` is committed, and a test checks it is current. `privacy-check` is a local pre-commit hook on Alex's Mac (contributors can't run it). System fonts, no font files. The backup includes name, This is me and settings, and restore writes a new device record. Minimum platforms: iOS 17+, Chrome on Android from the last two years. Install-first on Android too if the spike finds isolation. CRC32 per frame. Headers add `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and no-cache for `sw.js`. The `view()` budget is re-measured on the phones in the spike. |
| CR-18 | Nit | No automated guard for "no network requests" | FIX + CONTEST | FIX: a test fails if `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` or `EventSource` appear outside `sw`. CONTEST the browser smoke test: Alex chose no UI automation (test seams, round 1). |

Counts: 29 rows, all FIX (one with a partial CONTEST) · no Blockers.

## Round 2 outcome (2026-10-30)

- Alex approved applying all rows, including the switch to bucket fingerprints and the split of the doc into a design and a reference spec. All were applied.
- A later measurement replaced the estimates. A realistic tree of 3,420 invented people (400 given names, 300 surnames, 5 devices, 23 sessions, 6,158 links) is 150 KB deflated. Ten changed buckets are 10.6 KB. The byte budget was set to 175 KB and the repeat-sync budget to 15 KB.
- One change goes beyond the rows above. Re-stamping purely on a local check is unsafe: a phone whose clock moved backwards would rewrite good data as old. So the hello now carries each phone's clock, a sync stops if the two differ by more than 24 hours, and re-stamping runs only once two clocks agree.
- Alex asked for a round 3, because the sync mechanism changed. All three reviewers re-read the design and the reference spec.
- The real-tree join run is a release check, local only, reporting counts (Alex approved).

## Round 3 (2026-10-30)

Reviewers: all three again, on the design and the reference spec. All PASS WITH FINDINGS, no Blockers. IDs restart at 1.

Re-derived before triage:
- `uds2gedcom/gedcom.py:143-145`: HEAD has no DATE, and no `_UID` is written.
- `merge.py:9,191,231` and `translit.py` `_KEY_FOLD`: the matching rules and the coarser key exist and are tested on real files.
- New measurements (`deflate-raw`, 3,420 invented people; every number below is a rerun):

| Tree | Clock per field | Clock per record, table delta-encoded |
|---|---|---|
| imported, one clock | 157 KB | 152 KB |
| hand-typed, one clock per person (links share it) | not measured | 168 KB |
| hand-typed, 15% with 300-character notes | not measured | 233 KB |

The earlier 150 KB was not a safe figure: giving each record and link its own clock reached 275 KB (239 KB delta-encoded). Repeat syncs: 10 buckets 9.8 KB, 50 buckets 44 KB, 100 buckets 77 KB, 200 buckets 144 KB. Cyclic loops needed for 150 blocks: 1.1 at 99% of frames read, 1.7 at 95%, 2.2 at 90%, 3.1 at 80%.

| ID | Sev | Finding (one line) | Call | Evidence or edit |
|----|-----|--------------------|------|------------------|
| CR-3, NR-6 | Major | 150 KB doesn't follow the clock model; gate and budget disagree | FIX | Payload uses one clock per record with field overrides, and a delta-encoded table. Gate payload is a fixed **200 KB**, at most 2 minutes per direction (about 1.7 KB/s effective). Budget test: hand-typed tree at most 175 KB. The generator gets committed as a test fixture. |
| CR-4 | Major | Repeat-sync cost understated; step 3 resends B's own records; no stated size | FIX | Numbers for 10, 50, 100 and 200 buckets go in the doc. Step 3 becomes an exact diff: A already holds B's full copy of every differing bucket, so it sends only fields B lacks. CONTEST more buckets: 256 keeps the hello small, and a typical repeat sync stays under a minute. Supported tree size stated as 3,420 people at the gate; larger trees just take longer, with the estimate shown. |
| CR-5, NR-7 | Major | Cyclic loops ignored in estimates; ETA stalls | FIX | Estimate uses loops ≈ max(1, ln K ÷ ln(1/(1−p))) with p measured. Time left counts distinct blocks and shows "almost done" in the tail. The spike tests LT in the same run, not as a remote fallback. |
| CR-2, NR-3 | Major | "Both phones show both dates" can't be built | FIX | B checks clocks at step 1. On a mismatch B shows a hello-only stream, A scans it, and both show both dates. |
| CR-1, NR-4 | Major | "Both phones log the loser" is impossible when only current values travel | FIX | Reworded: the phone that held the losing value logs it. Story 57 and the test change to match. |
| CR-6, ZO-5, NR-5 | Major | First-time values can't be undone; `null` not valid for dates and booleans; erase writes invalid values; erasing device unlike receivers | FIX | `null` means "cleared" for every field except `del` and `er`. Undo with no `before` writes `null`. The erasing device keeps only `er` and scrubs its history in the same transaction, so all devices match. |
| CR-7 | Major | File-date stamps still beat earlier edits and deletes | FIX | Imported values get the lowest time, `(0, 0)`, and a fixed all-zero setter. Any real edit beats them, and identical files give identical triples, so they cost no bytes to sync. ADR 0006 rewritten. |
| ZO-2, NR-10, CR-19 | Major | Files with no `_UID` (uds2gedcom writes none) get random IDs, so the claim about shared IDs fails; re-import duplicates everyone | FIX | With no accepted `_UID`, ID = first 16 hex of SHA-256(file hash ‖ xref). Repeats of a `_UID` in one file use SHA-256(`_UID` ‖ occurrence). Import runs the same join, with one person answering. |
| ZO-1, CR-14, NR-12, ZO-3 | Major | The join ignores tested rules in uds2gedcom; key can be empty and an empty key matches; precomposed-only table | FIX | Adopt a coarser key: NFC first, then gj/dj/ѓ→g, kj/ќ→k, zh/ж→z, sh/ш→s, ch/ч→c, dzh/џ→dz, lj→l, nj→n, plus the rest of Cyrillic. An empty key is a placeholder and never same or surname match. Adopt descriptive placeholders, the two-partners and same-name-sibling rules, and the "same child, two names" possible case. Budget fixture modelled on the shapes in uds2gedcom's tests, with invented names. |
| ZO-4 | Major | Writes on a merged set undefined | FIX | Edits write the canonical record; delete and restore write every record. `before` is the set's visible triple. After undoing a merge, the canonical record keeps edits made while merged. |
| NR-1, NR-2, ZO-8 | Major | "New group" undefined; B's join re-asks | FIX | New group = a connected group of incoming records linked to no existing person. B is offered only new groups, after A's merges are applied, and never the existing-person walk. "Identical" qualified. |
| NR-8 | Major | † values have no spike item; decoder choice unassigned; wasm fetch vs the no-network test | FIX | New spike items: tuning grid with starting values, and jsQR vs zxing-wasm. The no-network test exempts only the decoder's own wasm load, if zxing-wasm wins. |
| NR-9, ZO-9, CR-18 | Major | Re-stamp reference undefined, order lost; tolerances stack | FIX | Reference is the device's own clock once clocks agree. Original order kept, each original time getting its own new time. Validation bound is the later of receiver's clock and the hello's `w`, plus 24 h. Two limits become accepted trade-offs: a re-stamped edit can beat a meanwhile edit, and two phones wrong together can keep a future copy. |
| CR-8, ZO-7 | Major | Unknown fields unbounded | FIX | At most 4 per record, 4 KB per record, depth 4; records per payload at most 200,000. Over the cap counts as rejected. |
| CR-9 | Major | A received erase applies silently | FIX | Before applying, "This sync erases N people: …" with Continue and Not now. Not now leaves them unapplied, and the question returns next sync. |
| CR-10 | Major | Nothing confirms which phone you scanned | FIX | A 4-letter code from SHA-256 of A's hello shows on A's screen and on B's Continue screen. A scanner moves to a new stream after 3 s with no progress. |
| CR-11 | Major | The storage layer has no tests | FIX | Storage tests in Node on `fake-indexeddb` (dev-only, pinned), with failure injection: aborted transaction, quota, `VersionError`, restore swap, snapshot. Snapshot store created by the first migration, not v1 (ZO-6). |
| CR-12 | Major | Pre-commit hook is bypassable | FIX + CONTEST | FIX: add a pre-push hook; contributor PRs are merged only from Alex's machine. CONTEST CI with a secret list: GitHub doesn't give secrets to fork PRs, so it can't block them. |
| CR-13, NR-16 | Major | Several criteria aren't checkable | FIX | A hand-check list ships with the plan. Real-tree run thresholds: no false automatic merge, at most 10% of shared people asked, at most 2% missed. Budget fixture raised to at most 40 questions. Repeat-sync test defined in buckets. |
| ZO-10, NR-14, NR-15, NR-13, CR-15, CR-16, CR-17, NR-11, NR-17, CR-20 | Nit | Terms, wording, history size, cancel wording, unverified platform claims | FIX | Glossary gains Hello and uses join pair. Process narrative removed. "Scoring" renamed. Rejected-item cost is "those buckets". History for a 3,420-person import is about 500 KB. Cancel "never corrupts; a retry heals". "Later syncs need no questions" reworded. Headers live in `vercel.json`. The preview must be public. Vercel Hobby deploying from an org repo is checked when the repo is created. CONTEST CR-17: the CRDT rejection doesn't rest on bytes. |

Counts: 20 rows: 20 FIX (3 with a partial CONTEST) · no Blockers.

## Round 3 outcome (2026-10-30): review closed

- Alex approved applying all rows and closing the review with no round 4. All were applied to the design, the reference spec, the user stories, the glossary and ADRs 0004, 0006 and 0007.
- Accepted trade-offs, recorded in Risks:
  - a re-stamped edit can beat an edit made in the meantime
  - two phones wrong together can keep a future copy until the date passes
  - a relative who insists can still erase anyone
- The fixes from this round have not been re-reviewed. The convergence tests are their check.
- After closing, the plan's prototype replaced the cyclic estimate with a simulated one: the loop count in the CR-5 row was low, because the last missing block waits on average half a loop more. The reference spec has the corrected formula and table.
