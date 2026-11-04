# Steblo v1 design

Status: draft for approval · 2026-10-30
Exact rules: [reference spec](2026-10-30-steblo-v1-reference.md). Vocabulary: [GLOSSARY.md](../../GLOSSARY.md). Decisions: [docs/adr](../adr/) 0001–0007. User stories: `.scratch/steblo-v1/spec.md`. Review: [review file](2026-10-30-steblo-v1-design.review.md).

**Alex** (GitHub `alexanxin`) owns this project. His private app, **Стебло** ("the private app"), holds his real family tree and runs on Vercel behind a family password. This app reuses some of its code and none of its data. The public code will live in `Xin-Dragons/steblo`, under his GitHub organisation. **uds2gedcom** is his public converter from old Sierra Generations files to GEDCOM. All people in this document are invented.

## Problem

Families keep their history in old desktop programs, in GEDCOM exports from MyHeritage or Ancestry, or nowhere. The private app shows one family's tree on phones, but it needs a server Alex runs, a password and an administrator. That doesn't work for other families, and Alex won't run servers for them.

The goal is an open-source app (MIT) that anyone installs from a web page onto their phone:
- Each person builds their part of the tree on their own phone.
- When relatives meet, they combine their trees phone to phone by showing and scanning QR codes, with no internet and no server.
- After the first time, any two relatives can sync again and get each other's changes.

## Approaches considered

### How trees combine

**A. Our own later-wins rule per field, plus a join at a chosen person (chosen).** Every field remembers who set it and when, and the later setting wins (ADR 0004). The first time two trees meet, the relatives pick a person both trees share. The app walks outward from that person, merges certain matches by itself, and asks only about uncertain ones (the join). After that, people share IDs, and later syncs rarely need a question.
- Pro: small, testable, no dependency. QR payloads carry only current values.
- Con: we own its correctness. Mitigated by convergence tests over full state.

**B. A CRDT library (Automerge or Yjs).** These merge generic documents. Neither knows about merging two person records or about link IDs derived from person IDs, so the hard part stays ours. We have not measured their encoding of a tree. We rejected them because they don't solve that hard part, and they add a dependency to a project that otherwise has almost none.

**C. Each person editable only on the device that added them.** No merging at all. But nobody could fix a relative's typo, and a lost phone would freeze its branch everywhere. This contradicts ADR 0003.

**D. Graft only: append the other tree at a chosen person, with no field rule.**
- *Overlap.* Adam's tree has grandpa Danilo, grandma Teodora and their children Miro and Ema. Cousin Lea's tree has the same four. Appending Lea's tree at Danilo gives Adam two Teodoras, two Miros and two Emas.
- *A year later.* Lea fixed Teodora's birth year, and Adam fixed Miro's death date. Everything is already connected, so there is nothing to append. Only shared IDs plus a per-field rule can carry both fixes.

A keeps D's good idea, the chosen person, as the start of the join.

### How two devices find what differs

**Version vectors.** Each device tracks what it has seen from every other device and sends only newer changes. This sends the fewest bytes. But it trusts that bookkeeping completely. A forged or wrong vector silently stops changes flowing, data that was rejected once can never be asked for again, and two phones sharing an ID (after a whole-phone restore) lose edits.

**Full state every time.** The simplest and most robust option. But a 3,420-person repeat sync would take as long as the first one, about 2 minutes each way.

**Bucket fingerprints (chosen).** Every record belongs to one of 256 buckets by its ID. The opening code (the **hello**) carries a 4-byte hash of each bucket, about 1 KB. Each phone sends the full contents of the buckets whose hashes differ.
- Any disagreement, whatever caused it, shows up as a differing bucket and heals at the next sync.
- A forged hello can only cause extra bytes.
- Two phones with the same device ID just work.
- Imported values can carry the file's date.
- The cost is that a repeat sync sends whole buckets one way. Measured on a 3,420-person tree of about 37 records per bucket, at the gate's rate of 1.7 KB/s:

  | Changed buckets | Share of tree | Size | Time |
  |---|---|---|---|
  | 10 | 4% | 10 KB | 6 s |
  | 50 | 20% | 44 KB | 26 s |
  | 100 | 39% | 77 KB | 45 s |
  | 200 | 78% | 144 KB | 85 s |

  The way back is an exact diff, because the sender already holds the other phone's copy of those buckets. One changed person usually touches one bucket, so a typical reunion sync stays under a minute. More buckets would shrink this but enlarge the hello, and 256 keeps it about 1 KB.

### Transport

QR only (ADR 0002). Web Bluetooth can't advertise and isn't in iOS Safari, and WebRTC depends on the local network. If the speed test (§10) misses its gate, Alex decides what happens next. No other transport gets added without him.

### Frame coding

The scanning phone will miss some frames. **Cyclic repeat** shows the blocks in a loop: simple, but a missed block costs a full loop. **LT fountain coding** shows random XOR combinations of blocks after the first pass, so almost any frames will do: about 60 more lines and some decoding work. Simulated at the gate's size (334 blocks), cyclic needs 2.5 frames per block at 5% lost and 3.9 at 20%; LT needs 1.8 and 2.2. The spike tests both on real phones, and only the winner ships.

## Design

### 1. Components

Modules marked "pure" use no browser-only APIs and run in Node (checked on 26.12.1, which has WebCrypto and CompressionStream `deflate-raw`).

| Module | Purpose | Runs |
|---|---|---|
| clock | Make, order and bound-check times | pure |
| records | Record kinds, the one validator, the later-wins rule | pure |
| tree | In-memory records, sets and canonical IDs, edit operations, `view()` | pure |
| history | Change groups, undo, erase scrubbing, size cap | pure |
| names | Cyrillic→Latin display, surname forms in both alphabets, matching keys | pure |
| dates | Partial dates: parse, format, sort year | pure |
| sync | Hello, bucket hashes, payload, apply, re-stamp | pure |
| join | Start points, the walk, match rules, review lists | pure |
| gedcom | GEDCOM 5.5.1 import with sanitising, export | pure |
| backup | Write, validate, restore | pure |
| envelope | ECDH, HKDF, AES-GCM | pure (WebCrypto) |
| frames | Compression with caps, blocks, frame header, CRC | pure |
| qrcodec | Vendored QR generator and decoder, on raw RGBA pixels | pure |
| storage | IndexedDB schema, migrations, one transaction per change | browser |
| scanner | Camera to `qrcodec` | browser |
| ui | Screens, layout, DOM rendering, i18n | browser |
| sw | Service worker: versioned precache, update prompt | browser |
| scripts | `release` (service worker file list), `privacy-check` | dev only |

**The write contract.** The UI never touches records. A `tree` operation returns a pending change. `storage` commits it in one transaction, and only then does `tree` adopt it and the UI redraw from `view()`. Sync payloads are built only from adopted state, so a change that failed to save can never leave the phone. Nothing reloads the page.

### 2. Data model

People plus parent links and partner links; families are computed, never stored (ADR 0001). Merges, not-same decisions and device names are records too. Record IDs are derived from the people they connect, so the same action on two devices creates the same record.

Every field is a triple: value, clock time, and the device that set it. Clock times come from a hybrid logical clock, so a change made after seeing another always sorts after it, even when phone clocks disagree. When two copies of a record meet, each field keeps the later triple (ADR 0004). `deleted` is a field too: it counts only while no other field was set later, so an edit made after a delete revives the person.

Merged people form a **set**, and links that end up joining the same pair form one too. A set acts as one record: each field takes the latest triple across it. Its smallest ID is its canonical ID. Edits write the canonical record, and delete and restore write every record. Undoing a merge just splits the set.

One validator guards every way in: local edits, GEDCOM import, received data, restore and undo. Unknown fields that a newer app adds are stored, relayed and hashed but not shown, so a new field doesn't force a whole family to update at once. Full rules: reference R1–R4.

### 3. Sync

Both relatives open Sync, and one taps "I'll show first". There are three QR steps, with an explicit tap at each switch (reference R6):
1. A shows its hello and a 4-letter code. B scans it and checks that the code matches A's screen, so you know you scanned the right phone.
2. B shows its hello, then the buckets that differ, encrypted. A scans and applies them. If new people came in, A runs the join with both relatives looking at A's screen.
3. A shows the fields B still lacks, encrypted, including any join results. B scans and applies. Both trees are now identical. If A kept groups separate, B is offered a join for those too, and its answers reach A at their next sync.

Before showing changes, each phone says roughly how long it will take, with Continue and Cancel. Applying is idempotent, so a sync that fails or is cancelled is simply repeated.

**Clocks.** The hellos carry each phone's current time. If the two differ by more than 24 hours, B sends no data, and both phones show both dates. Once they agree, a device that holds its own triples dated more than a day ahead (because its clock was wrong when it made them) rewrites those fields with a corrected time, in their original order, so its changes can spread. A device's clock alone can't prove anything; two agreeing clocks can. Far-future triples from anywhere else are rejected.

**Rejected data.** A rejected item isn't stored, so its bucket stays different and it is offered again at the next sync. The cost is limited to the buckets that hold such items. The summary says how many items couldn't be taken.

**Encryption.** Each sync uses fresh ECDH P-256 keys from the hellos, then AES-GCM, with both hellos in the associated data. Someone filming every code learns only device IDs, the clock time and bucket hashes. Being physically there, plus the 4-letter code, is the authentication. Reference R5, R7 and R8 pin the formats. Size caps are memory guards, not product limits.

### 4. Join

The rules follow Alex's `uds2gedcom`, which worked them out on real family files. Matching compares names by a deliberately coarse key that folds alphabets and spellings, because people skip the special letters when typing: ѓ, ǵ, gj, đ and dj become one, ж, ž, zh and z become one, and female surname forms reduce to male ones, so Новакова matches Novakov. Descriptive names such as "Wife of Danilo" are placeholders and never match by name. Names in other scripts have an empty key, and an empty key never matches.

A **new group** is a connected group of incoming people with no link to anyone already on this phone.

**Where it starts.** The walk starts from two kinds of point:
- each **join pair**: one person from a new group and one from the existing tree, both picked by the relatives
- each existing person who gained an incoming relative, which catches the same baby added on two phones

A join runs on A during a sync, and for one person after a GEDCOM import.

**The walk.** From each merged pair it compares relatives in the same relation (parents, partners, children). Certain matches merge by themselves. Possible ones become a question with up to three candidates. People with no candidate simply stay as new. Rules: reference R9.

**After the walk.** A list shows everyone matched automatically, each with **Not the same**. A second screen shows merged people whose details differ, with ours preselected.

**Interrupted joins.** Each answer commits on its own, so a killed app loses nothing, and Needs attention offers **Continue joining**. History shows the whole join as one group and can undo it as one. Skipped groups stay in Needs attention, where **Join** opens the same picker.

### 5. History and undo

History stays on each device and is included in its backups. Each action, sync or import is one change group. Created records are logged by ID only, so a 3,420-person import is about 500 KB with its links. When a sync replaces a value, the phone that held it logs the value that lost; only current values travel, so the other phone never sees it. History is capped at 20 MB, dropping the oldest groups with a note.

Undo writes the old values back as new edits, and they sync like any other change. Undoing a creation deletes what was created, and undoing a first value clears the field. Fields changed since are skipped and counted. Undoing a whole sync or import first says it also reaches relatives' phones. Erase can't be undone. Rules: reference R10.

### 6. Erase

For a living relative who asks to be removed (ADR 0007). The user must type the person's given name. Every device, the erasing one included, then keeps only an erased mark for that person, discards any other value forever, even one set later, and scrubs them from its history. A phone that receives an erase by sync lists who it affects first, with Continue and Not now. The confirmation says saved files and phones that never sync again keep their copy. Rules: reference R11.

### 7. GEDCOM

**Import** reads 5.5.1 in UTF-8 or UTF-16. Text is sanitised and then validated, and a summary lists what was cut or not kept. A person's ID comes from the file's `_UID`, or from the file's hash and the person's position in it if there is none (uds2gedcom writes none). So two relatives importing the same file get the same people, with no join and no bytes to sync. Imported values carry the lowest possible time (ADR 0006), so any real edit beats them. Import never touches a deleted or erased person. A later file can add people, and the join connects them.

**Export** writes 5.5.1 with `_UID`, after warning that anyone with the file can read the tree. Rules: reference R12.

### 8. Backup and durability

A backup is a JSON file of records, history and settings. Saving warns that anyone with the file can read the tree. Restore validates the whole file before touching anything, offers **Save current tree first**, swaps in one transaction, and takes a new device ID.

Once the tree holds a person, the app requests persistent storage. iOS 17+ supports it, and grants it based on signals such as opening from the Home Screen ([WebKit blog](https://webkit.org/blog/14403/updates-to-storage-policy/), read 2026-10-30). Settings shows the age of the last backup, and a quiet banner appears after 30 days with changes. Rules: reference R13.

### 9. App and UI

**First start.** On iOS outside the installed app, the app shows only install instructions and allows no data entry, because Safari and the Home Screen app keep separate storage. On Android a browser tab shows an **Install** button and still allows use, unless the spike finds the same isolation there. Then: language, your name, and four choices: start with yourself, import GEDCOM, restore a backup, or get a relative's tree by scanning.

**Tree screen.** Hourglass and whole-tree views, search by matching key, **This is me** (per device, resolved through merges). The person card menu has edit, add relative, Same person as…, Look for duplicates around…, delete, erase, and history. Other screens: Sync, Join, Needs attention, History, Settings. One **Show in Latin letters** switch covers names and the Macedonian UI. English and Macedonian strings live in one file each.

**What comes from the private app.** Every real name is scrubbed.
- *Reused:*
  - the layout maths, adapted to the contract in reference R4
  - `style.css` and `motion.css`
  - `toLatin`
  - the manifest
  - the shape of the add-relative flow and card menu
- *Extended:* `baseSurname`, `formFor` and `genderOf`, to handle Latin endings too.
- *Rewritten:*
  - All rendering, as DOM building with `textContent` and positions set through `el.style`, because the private app's `innerHTML` templates and inline styles don't fit the CSP.
  - Every form that holds partial dates, places, notes, marriage, deceased or birth surname, because the private app only edits names and years.
  - App state, which the private app builds once and reloads after each edit.
  - Storage and the service worker. The private versions swallow errors and auto-activate, which is unsafe when the phone holds the only copy.
- *Dropped:* login, suggestions, admin review, all `/api` calls, Google Fonts (the app uses system fonts).

**Storage** (reference R14). IndexedDB, with failures shown to the user and editing locked. Before a schema upgrade the app copies its stores to a snapshot. An older app meeting newer data shows a screen with **Save backup** rather than failing. A Web Lock allows one editing tab.

**Updates** (reference R15). A release script writes the list of served files, and the output is committed. The service worker caches all of it or none. A new version waits until the user taps **Update**, so modules from two versions never mix.

### 10. Spike first

Before anything else, a throwaway page runs under the production headers on Alex's iPhone (iOS 17+) and an Android phone, both installed to the Home Screen. Reference R17 lists its items, each with a pass condition and a fallback. They include the tuning grid, camera, Wake Lock, file save, storage isolation, and redraw speed on a real phone.

**Payload measurement** (Node 26.12.1, `deflate-raw`, invented trees of 3,420 people with 400 given names, 300 surnames, 5 devices and about 6,100 links; compact encoding, 64-bit IDs, one clock per record):

| Tree | Size |
|---|---|
| Imported from GEDCOM | 152 KB |
| Typed by hand, one action per person | 168 KB |
| Typed by hand, 15% of people with a 300-character note | 233 KB |

Real names may compress differently, and real notes should compress better than these random ones. Before the compact encoding, the same kind of tree measured 322 KB.

**Gate.** A fixed 200 KB of encrypted data must cross in at most 2 minutes per direction, both ways. That is about 1.7 KB/s effective, counting missed frames. If it doesn't, building stops and the numbers go to Alex. A tree larger than the gate's still syncs; it just takes longer, and the estimate says so first.

The spike needs HTTPS for the camera, so it is deployed as a public Vercel preview. That needs the GitHub repo and the Vercel project, created only with Alex's go-ahead.

### 11. Hosting and security

- Static files on Vercel at `steblo-app.vercel.app` (ADR 0005), production deploys from `main` of `Xin-Dragons/steblo` only.
- No server functions, no analytics, no third-party requests. Headers and CSP: reference R16.
- Vendored libraries sit in one folder at pinned versions, with licences and recorded SHA-256 hashes. Candidates: qrcode-generator (MIT); jsQR (Apache-2.0) or zxing-wasm.
- **Privacy check.** `scripts/privacy-check` folds every word in the tracked files with the matching key and compares it against a names list kept outside the repo, made from the private app's data. It runs as local pre-commit and pre-push hooks on Alex's Mac, and contributors' pull requests are merged only from there. A CI check isn't used, because GitHub doesn't give secrets to pull requests from forks, so it couldn't block them. Fixtures use only the invented set Danilo/Данило, Teodora/Теодора, Miro, Ema, Adam, Lea, Novakov/Новаков, Ѓеко/Gjeko and Чарин/Čarin, which had no collisions on 2026-10-30.

## Testing strategy

The seams were agreed with Alex. Tests use public operations and check what users see, plus full state through the backup's sorted records.

1. **Pure modules in Node** (`node --test`):
   - **Convergence.** Three to four simulated devices run random edits, deletes, restores, merges, not-same, erase, undo and imports, then sync in random order and direction. Scenarios:
     - interrupted syncs
     - a device whose clock was ahead and is then fixed
     - restore with a new ID
     - two devices with the same ID
     - a newer app with an extra field

     Devices with the same validator must end identical. A device that drops malformed items equals the others minus exactly those items, and reports them. Fixed seeds, many rounds.
   - **Rules.** Ordering, sets, the `deleted` tie, not-same across sets, erase beating later edits, undo of creations, losing values logged, import never reviving a deleted or erased person.
   - **Join.** Keys, blockers, the certain and possible table, the walk, Continue joining, and the budget fixture (reference R9).
   - **GEDCOM.** Round trip (X becomes U). Hand-written invented fixtures shaped like MyHeritage, Ancestry, Gramps and uds2gedcom exports. HTML-ish multi-line notes. Bad and duplicate `_UID`s.
   - **Backup, validation.** Hostile inputs: bad kinds, huge strings, bad dates, extra fields, too many unknown fields, out-of-range clocks, oversized frame headers, a decompression bomb.
   - **Storage**, on `fake-indexeddb` (dev-only, pinned), with failure injection: aborted transactions, quota errors, `VersionError`, the restore swap, migrations and the snapshot.
   - **Numbers.** The tree generator is committed as a fixture.
     - Payload for the hand-typed tree at most 175 KB.
     - A repeat sync of 10 changed buckets at most 15 KB.
     - `view()` for 5,000 people under 200 ms on Node.
   - **No network.** A test fails if `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` or `EventSource` appear outside `sw`. The only exemption is the decoder's own wasm load, if zxing-wasm wins.
2. **End-to-end in Node.** A device's payload is encrypted and framed, each frame rendered to a real QR image and read back by the vendored decoder from RGBA. A random 20% of frames are dropped and the rest shuffled, in both directions. Then both trees must be identical.
3. **UI and camera** are checked by hand in a desktop browser and on Alex's two phones, using a hand-check list with pass conditions that ships with the plan.
4. **Real-tree join run.** A release check, on Alex's Mac only and never committed: split the private tree into two overlapping halves, run the join, and report only counts. Pass: no false automatic merge, at most 10% of shared people asked, at most 2% missed.

Prior art: the private app tests its shared tree rules with `node --test`.

## Risks

| Risk | Mitigation |
|---|---|
| QR too slow for large trees | Compact encoding (measured); gate on real phones; on a miss, Alex decides |
| Real phones read fewer frames than hoped, so cyclic needs extra loops | Spike tests cyclic and LT together and measures the share of frames read |
| Real trees are bigger than measured (long notes, more history) | Gate is 200 KB, above typical trees; byte-budget test; time estimate shown before sending |
| iOS: storage separate from Safari; camera, Wake Lock or file save quirks | Install-first; spike items with fallbacks |
| A sync or merge bug silently corrupts or diverges trees | Convergence tests over full state; one validator; transactions; bucket fingerprints heal differences at the next sync; undo; backups |
| A 4-byte bucket hash collides and hides a difference | About 1 in 4 billion per bucket; the difference heals at that bucket's next change |
| Permanently invalid data | Limited to the buckets that hold it, resent each sync, counted in the summary |
| A newer or hostile app fills trees with unknown fields | Caps per record and per payload; over the caps counts as rejected |
| A phone with a wrong clock | Sync refused until clocks agree; re-stamp after the fix; far-future values rejected. Accepted trade-offs: a re-stamped edit can beat an edit made in the meantime, and two phones wrong together can keep a future copy until the date passes |
| Two phones share a device ID | Harmless: bucket sync and the value tie-break handle it |
| Scanning the wrong phone in a crowded room | 4-letter code on both screens before any data is sent |
| Users merge two different people | Conservative certain rules; every merge can be undone; not-same records |
| Join asks too much, or merges wrongly on real data | Automatic certain matches; budget fixture; real-tree join run before release |
| Import overrides edits or revives deleted or erased people | Imported values carry the lowest time; import never writes to deleted or erased people |
| Accidental or hostile Erase, or a bulk erase arriving by sync (everyone is an equal editor) | The user must type the name; a received erase lists who it affects and can be refused. Accepted trade-off: a relative who insists can still erase anyone, as ADR 0003 allows |
| Garbled or hostile input (QR, GEDCOM, backup) | One validator; caps checked before allocation; `textContent` only; strict CSP |
| Storage write fails | Transactions; editing locked with a message |
| A bad migration, or an older app after a rollback | Snapshot before upgrade; the newer-data screen with Save backup |
| Mixed app versions after an update | All-or-nothing precache; update only on the user's tap |
| A living relative wants out | Erase, with its limits stated |
| Backup or GEDCOM file leaked | Plain files by Alex's choice; a warning before saving |
| Real family data reaches the public repo | Privacy rule; invented fixture set; `privacy-check` as pre-commit and pre-push hooks; contributions merged only from Alex's Mac |
| Someone takes over `steblo-app.vercel.app` (project deleted, account compromised) | Never delete the project; 2FA on GitHub and Vercel; protected `main`; production deploys from `main` only. Name unused on 2026-10-30 (`DEPLOYMENT_NOT_FOUND`). Alex chose this over a domain we own |
| A vendored library is tampered with | Pinned, with recorded hashes; updates reviewed as diffs |
| Large trees slow to draw on phones | Budget test on Node; spike item 9 on real phones, with a fallback |

Zero-context design review: done in three rounds, all findings resolved. See the review file.

## Out of scope for v1

- Photos and media, sources and citations, events beyond birth, death, marriage and separation (divorce)
- Sharing one branch only; several trees per device
- The self-hosted server device (a later milestone; records and bucket sync already allow it)
- GEDCOM 7, ANSEL and other non-Unicode encodings
- Hiding living people in exports; encrypted backups
- Permissions, signed changes, an owner role
- Resuming an interrupted QR stream
- Bluetooth, WebRTC or file sync (if the spike misses its gate, Alex decides)
- Latin→Cyrillic conversion of names; nickname tables for matching
- UI languages beyond English and Macedonian
