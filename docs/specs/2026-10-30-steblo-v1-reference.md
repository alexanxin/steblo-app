# Steblo v1 reference

Status: draft for approval · 2026-10-30
The exact rules behind [the design](2026-10-30-steblo-v1-design.md). Vocabulary: [GLOSSARY.md](../../GLOSSARY.md). All people here are invented. The spike's measured settings are pinned in R8 (results: `docs/specs/spike-results.md`). After the first public release, any change to the stored or wire format needs `format: 2`.

## R1. IDs and buckets

- **Person ID.** 16 lowercase hex characters, from 64 random bits. People imported from GEDCOM get a derived ID instead (R12), so the same file gives the same IDs on every phone.
- **Device ID.** 16 lowercase hex characters.
- **Record IDs:**

  | Kind | ID | Bucket key |
  |---|---|---|
  | person | `<personId>` | the ID |
  | parent link | `p:<parentId>:<childId>` | childId |
  | partner link | `u:<smaller>:<larger>` | smaller |
  | merge | `m:<smaller>:<larger>` | smaller |
  | not-same | `n:<smaller>:<larger>` | smaller |
  | device | `d:<deviceId>` | deviceId |

- **Bucket.** A record's bucket is the first two hex characters of its bucket key, a number from 0 to 255. A person and the links to its parents fall in the same bucket, so one edit usually touches one bucket.

## R2. Clock

- **Time.** A time is `(ms, counter)`, with `ms` an integer and `counter` an integer from 0 to 65535.
- **Order.** Triples `(v, t, by)` are ordered by `ms`, then `counter`, then `by` (as a string), then the canonical JSON of `v` (keys sorted, no whitespace, `null` lowest). Any two different triples are ordered.
- **Local action.** A new time is computed as `ms = max(Date.now(), last.ms)`. The counter is `last.counter + 1` if `ms` is unchanged, else 0. If the counter would pass 65535, `ms + 1` and counter 0. Every field written by one action gets the same time.
- **Applying a triple.** `last = max(last, t)` for every accepted triple.
- **On load.** `last` is the maximum stored `t` of the device's own triples and of every triple it accepted. In practice that is the maximum of all stored triples.

## R3. Records, fields and the validator

**Fields per kind.** The key column is the short key used on the wire (R5).

| Kind | Fields (key) |
|---|---|
| person | given (g), surname (s), birthSurname (bs), sex (sx), birthDate (bd), birthPlace (bp), deathDate (dd), deathPlace (dp), deceased (dc), note (nt), deleted (del), erased (er) |
| parent link | deleted (del) |
| partner link | marriageDate (md), marriagePlace (mp), ended (en), endDate (ed), deleted (del) |
| merge, not-same | deleted (del) |
| device | name (nm) |

**Unknown fields.** A field name matching `[a-z]{1,4}` that this version doesn't know is an unknown field. Unknown fields are stored, relayed and hashed, never shown. This lets a later version add a field without breaking older phones. Limits: at most 4 per record, 4 KB of JSON per record, nesting depth at most 4. Anything over counts as rejected.

**The validator.** One function, used for local edits, GEDCOM import (after sanitising, R12), applying received data, restore, and undo writes. `null` means "cleared" and is valid for every field except `deleted`, `erased` and the device name.

| Item | Rule |
|---|---|
| given, surname, birthSurname | single line (control characters removed, runs of spaces collapsed, trimmed); 1–80 characters |
| birthPlace, deathPlace, marriagePlace | as above, 1–120 characters |
| note | `\n` and `\t` kept, other control characters removed; at most 5000 characters |
| device name | 1–60 characters, single line |
| sex | `M`, `F`, `X` or `U` |
| booleans (deceased, ended, deleted) | `true` or `false` |
| erased | only `true` |
| date | `{y?, m?, d?, q?, t?}`: `y` is an integer 1–2200; `m` is 1–12; `d` must be a real day of that month (Gregorian, leap years); `q` is one of `abt`, `bef`, `aft`, `est`; `t` is a single line of at most 60 characters. A date needs `y` or `t`. |
| triple time | `ms` an integer from 0 to (the later of the receiver's `Date.now()` and the sender's hello `w`) + 86 400 000; `counter` an integer from 0 to 65535 |
| by | 16 lowercase hex characters |
| record | a known kind; an ID of the right shape; only that kind's fields plus unknown fields |
| payload | at most 200 000 records |

`<` and `>` are allowed everywhere, because the app never renders text as HTML.

**Exact date.** A date is exact if it has `y`, no `q` and no `t`. Its **sort year** is `y`, or else the first four-digit number in `t`.

## R4. Sets and the view

- **Person sets.** Every merge record whose `deleted` is false joins its two person IDs (union-find). A set's **canonical ID** is its smallest ID.
- **Link sets.** Links of one kind whose endpoints resolve to the same canonical pair form a set too.
- **A set acts as one record.** Each field, including `deleted` and unknown fields, takes the latest triple across the set's records.
- **Writes on a set.** Edits write the canonical record. Delete and restore write every record of the set. A history entry's `before` is the set's visible triple. After a merge is undone, the canonical record keeps any edit made while merged, and the other records show what they held.
- **Deleted.** A set is deleted when its latest `deleted` triple is `true` and no other field of the set has a later time. A tie counts as deleted.
- **Erased.**
  - A person set in which every record is erased is **erased**. It is hidden and never listed anywhere.
  - A set in which some, but not all, records are erased is **partly erased**. It is hidden and listed in Needs attention with the action **Erase the rest**.
- **Not-same.** A not-same record that is not deleted, between any member of set X and any member of set Y, stops X and Y being suggested as a pair. An active merge record always wins over it.
- **`view()`** is a pure function of the stored records. It returns:
  - `people`: canonical ID → visible fields and member record IDs, for sets that are neither deleted nor erased.
  - `parentLinks` and `partnerLinks` between visible people, after dropping self-links and links to missing or hidden people.
  - `families`: `{partners, children, partnership}`:
    - Each child's **own family** is the parent pair given by its two parent links with the smallest IDs.
    - Children are grouped by own family.
    - Every visible partner link adds its pair, if not already present.
    - `partners` is ordered: sex M first, then X or U (by ID), then F.
    - Children are ordered by sort year (unknown last), then ID.
  - `attention`:
    - people with more than two parents
    - ancestor loops (the first repeat is reported, and the layout stops there)
    - partly erased people
    - **separate groups**: every connected group of visible people except the largest. Ties go to the group with the smaller lowest canonical ID.
- **Layout contract.**
  - The hourglass and whole-tree layouts take `view()` and a focus person.
  - A person's ancestors come from their own family. Descendants come from every family where they are a partner.
  - The whole-tree **anchor** of a family is `partners[0]`.
  - This replaces the private app's `anchorOf`/`ownKids`, which assumed husband/wife records.

## R5. Sync

**Hello** (UTF-8 JSON, not encrypted):

```
{"f":1, "app":"<version>", "d":"<device id>", "w":<sender Date.now()>,
 "k":"<base64url raw P-256 public key, 65 bytes>", "n":"<base64url 16-byte nonce>",
 "h":"<base64url 1024 bytes: 4-byte hash per bucket 0..255>"}
```

**Bucket hash.** The first 4 bytes of SHA-256 over:
- the canonical JSON of the bucket's records, sorted by ID
- each record written as `[id, {field: [v, ms, counter, by], …}]`, with fields sorted by key
- an empty bucket hashes the empty array `[]`

**Clock agreement.** B checks on reading A's hello. If the two `w` differ by more than 24 hours, B doesn't send any data: it shows a hello-only stream, A scans it, and both phones say: "The two phones' clocks differ by N days. Set the right date and time, then sync again." Both dates are shown.

**Re-stamp.** Once the clocks agree, a device rewrites its own triples dated more than 24 hours after its own `Date.now()`. These come from a period when its clock was ahead. `last` is first reset to the latest stored time within that bound. Each distinct original time then gets its own new time, in the original order, so an edit made after a delete still comes after it. This happens before the device builds its payload, and is logged in History as one group: "Fixed times after a clock error".

**Payload** (UTF-8 JSON → `deflate-raw` → encrypted, R7):

```
{"f":1,
 "b":[bucket numbers],
 "dv":["<by>", ...],                                  setters
 "c":[[Δms,counter,dvIndex], ...],                    clock table, sorted by time, ms as differences
 "i":["<person id>", ...],                            every person ID referenced
 "p":[[i, c, {"<key>":v}, {"<key>":[v,c]}?], ...],    person records
 "l":[["p"|"u", ai, bi, c, {...}?, {...}?], ...],     parent and partner links
 "x":[["m"|"n", ai, bi, c, {...}?, {...}?], ...],     merge and not-same records
 "d":[["<device id>", c, {"nm":v}], ...]}             device records
```

`i` indexes `"i"` and `c` indexes `"c"`. Each record has one clock, used by its fields in the first object. The optional second object lists fields set at a different time, each with its own clock. A date is `{"y","m","d","q","t"}`, with absent keys omitted.

**What each step sends.**
- In step 2, B sends every record of every bucket whose hash differs from A's hello.
- In step 3, A has applied B's data, so it holds B's full copy of those buckets. It sends only the fields where its triple differs from what B sent.

**Applying.** Before anything is stored, a payload that erases people this phone holds shows "This sync erases N people: …" with **Continue** and **Not now**. Not now rejects those erase marks, and the question returns at the next sync. Then, for each record and each field:
1. Validate it.
2. If it is accepted, keep whichever of the stored and received triples is later.
3. If the record is erased (stored or received `er`), keep only the `er` triple and discard every other field.
4. Rejected items are counted per reason. They are not stored, and their bucket stays different, so they are offered again at the next sync.

**Losing values.** When a stored value is replaced by a later received one and the two values differ, the phone logs `{record, field, loser, winner}`. So the phone that held the losing value is the one that keeps it. Only current values travel, so the other phone never sees it.

**Result of applying:**
- counts of new people, changed fields, losing values and rejected items
- the IDs of new records
- **start points** for the join (R9)

## R6. Flow, screen by screen

Both phones open **Sync**. The first screen says: "This sends everything the other phone doesn't have yet. On a first sync, that is your whole tree." Editing is locked until **Finish** or **Cancel**. Cancel is available on every screen. It never corrupts anything: what was already applied stays, and a repeat sync heals the rest.

| Step | Phone A | Phone B |
|---|---|---|
| 0 | Taps **I'll show first**. | Taps **I'll scan**. |
| 1 | Shows its hello codes (Wake Lock on) and a 4-letter code from SHA-256 of its hello, with "Lea scans this. When her phone says Got it, tap **Next: scan**." | Camera with progress. When the hello is decoded: "Got it ✓". Clock agreement and re-stamp run. "The other phone shows ABCD? About N minutes. **Continue**" |
| 2 | Taps **Next: scan**. Camera with progress and time left. When decoded, it applies the data and shows what came in. If there are new groups or other start points, the join runs (R9), or **Keep separate**. | After **Continue**: shows its hello plus changes (Wake Lock on), with "Adam scans this. When his phone says Got it, tap **Next: scan**." |
| 3 | Taps **Show my code**. "About N minutes." Shows its changes (Wake Lock on), with "When Lea's phone says Done, tap **Finish**." | Taps **Next: scan**. Camera with progress. When decoded, it applies and shows "Done ✓" and the summary. Both trees are now identical. If A kept groups separate, B is offered a join for those new groups only. B's answers reach A at their next sync. |
| end | Taps **Finish** and sees the summary. | — |

- **Version mismatch.** If `f` differs, the phone with the lower `f` says "Update the app: open it once while online." The other says "Ask the other phone to update."
- **Camera denied.** "Steblo needs the camera to scan. Allow it in Settings → Safari or Chrome → Camera." with **Try again**.
- **No camera.** "This device can only show codes." The device can take role A for step 1 only. It can't complete a sync.

## R7. Encryption

- **Key agreement.** ECDH P-256 between my private key and the other device's public key, giving 256 bits.
- **Key.** HKDF-SHA-256 with salt `nonceA ‖ nonceB` and info `steblo-sync-1`, producing an AES-GCM-256 key.
- **Message.** `IV (12 random bytes) ‖ ciphertext ‖ tag (16)`.
- **Associated data.** `"steblo-sync-1" ‖ step (1 byte: 2 or 3) ‖ SHA-256(hello A) ‖ SHA-256(hello B)`.
- **Key lifetime.** Fresh keys for every sync, never stored.

## R8. Stream and frames

Settings pinned by the spike on 2026-11-06 (see `docs/specs/spike-results.md`).

- **Streams.**
  - Step 1 is the hello bytes.
  - Step 2 is `u32 length ‖ hello ‖ message`, or just `u32 length ‖ hello` when the clocks disagree.
  - Step 3 is the message.
- **Frame** (bytes, big-endian):

  | Offset | Size | Field |
  |---|---|---|
  | 0 | 1 | version = 1 |
  | 1 | 4 | stream ID (random) |
  | 5 | 4 | stream length L |
  | 9 | 2 | block size S |
  | 11 | 1 | coding = 1 (LT); any other value is rejected |
  | 12 | 4 | frame number n |
  | 16 | 4 | CRC32 of bytes 0–15 and the block |
  | 20 | S | block |

- **Blocks.** K = ⌈L / S⌉, with the last block zero-padded. Senders use S = 600.
- **Caps.** These are memory guards, checked from the header before any allocation:
  - L ≤ 4 MiB
  - S from 300 to 1500
  - K ≤ 16384
  - decompressed ≤ 16 MiB, enforced while decompressing

  Frames with a bad CRC are ignored. Frames from a different stream ID are ignored too, unless the current stream has made no progress for 3 seconds; then the scanner moves to the new stream.
- **QR.** Each frame is one QR code in byte mode at error-correction level L, shown at 8 frames per second.
- **Scanning.** The scanner takes the centre 80% square of the camera picture, shrinks it to at most 640 px, and decodes it with jsQR in 2 Web Workers, so a new camera picture can be tried while another is decoding.
- **LT coding.** Below 100 blocks, frames n < K carry block n. Every other frame carries the XOR of blocks chosen by `mulberry32(streamId XOR n)`, which returns a u32.
  - The degree comes from the robust-soliton table (c = 0.05, δ = 0.5, degrees 1–64) of the smallest size class (16, 32, … 16384) that is at least K.
  - The tables are stored as integer thresholds out of 2³² − 1 in `public/src/lt-tables.js`, generated by `scripts/lt-tables.mjs`.
  - Block indices are `next() mod K`, rejecting repeats.
  - `picks(1, 1000, 334)` is pinned to `[23, 88]` by a test; a change there is a format change.
  - Measured on the module with 40–60% of frames lost: 1.42 frames read per block at K = 34, and 1.24 at K = 342.
- **Estimates.** With q the share of frames the scanner misses, measured as the sync runs (0.5 until known), the pre-send estimate is `K × 1.4 ÷ (1 − q) ÷ 8` seconds below 100 blocks, and `K × 1.25 ÷ (1 − q) ÷ 8` above. Time left is based on distinct frames received over the last 5 seconds, and shows "Almost done" when few blocks remain.

## R9. Join

**Prior art.** These rules follow `uds2gedcom` (`merge.py`, `translit.py`, `docs/merge-rules.md`), which were worked out on real family files. Tests use the same shapes with invented names.

**Matching key** for names. It is deliberately coarse, because people skip the special letters when typing, and every use of it is backed by other checks.
1. Normalise to NFC and lowercase.
2. Apply, longest first:

   | Input | Key |
   |---|---|
   | џ dž dzh | dz |
   | ѕ dz | dz |
   | ѓ ђ ǵ đ gj dj | g |
   | ќ ћ ḱ ć kj | k |
   | ж ž zh | z |
   | ш щ š sh | s |
   | ч č ch | c |
   | љ lj | l |
   | њ nj | n |
   | я | ja |
   | ю | ju |
   | ј й | j |
   | ы ё э | i, e, e |
   | ъ ь | removed |

3. Other Cyrillic letters map to one Latin letter each (а→a, б→b, в→v, г→g, д→d, е→e, з→z, и→i, к→k, л→l, м→m, н→n, о→o, п→p, р→r, с→s, т→t, у→u, ф→f, х→h, ц→c).
4. Decompose (NFD), drop combining marks, keep only `a–z`.

So Чарин, Čarin, Charin and Carin share one key. Names in other scripts have an empty key. This key replaces the private app's search `fold`.

**Surname key.** The surname is reduced to its male form first, keeping the private app's rule that at least two letters must stay before the ending. Endings in either alphabet:

| Female | Male |
|---|---|
| -ова, -ova | -ов, -ov |
| -ева, -eva | -ев, -ev |
| -ска, -ska | -ски, -ski |
| -цка, -cka | -цки, -cki |

The same functions give the female form for prefilling a new relative.

**Given names.**
- **placeholder**: the key is empty, or the name is only `?`, or it contains a descriptive word (wife, husband, son, daughter, child, unknown, жена, маж, син, ќерка, дете, прва, втора, and their Latin forms). This is checked first. A placeholder is never same, close or a surname match.
- **same**: equal keys
- **close**: both keys have 4 or more letters and are one edit apart (Levenshtein 1)
- otherwise **different**

**Comparing an incoming person x with an existing person y.** x and y are both relatives, in the same relation, of an already-merged person.

- **Blocked** (never suggested) if any of these hold:
  - both sexes are known and differ
  - both birth dates are exact and more than 5 years apart
  - they are already in one set
  - one is an ancestor, descendant or partner of the other
  - there is a not-same record between their sets
  - for **Look for duplicates around X** only: both are partners of X, or siblings with the same given key and different exact birth years, because one tree already lists them as two people
- **Surname match:** any non-empty surname key of x (surname or birth surname) equals any of y's.
- **Years:**
  - *equal*: both exact and the same year
  - *unknown*: either is not exact
  - *near*: both exact, 1 to 5 years apart

| Relation | Certain when (all of these, and not blocked) | Possible when (not blocked, not certain) |
|---|---|---|
| parents | given same; surname match; years equal or unknown | given same or close; or either is a placeholder and each side has exactly one parent of x's sex |
| partners | given same; surname match; birth years equal, or both marriage dates exact and in the same year | given same or close |
| children | given same; surname match; years equal, or years unknown and no other child of y's family has the same given key | given same or close; or both birth dates exact and equal with a surname match (one child recorded under two names) |

**Uniqueness.** A certain pair counts only if x has exactly one certain y, and y exactly one certain x. Otherwise every such pair is downgraded to possible.

**New group.** A connected group of incoming records with no link to any existing person.

**Start points.** The walk starts from:
1. Each **join pair**: one person from a new group and one from the existing tree, picked by the relatives (largest group first). Groups of a single person aren't prompted; they go to Needs attention. **Keep all remaining separate** skips the rest.
2. Each **existing person who gained an incoming relative**: the apply result lists every new link record that joins an existing person to a new one. Such a person is paired with itself.

The join runs on A. B is offered only new groups, after A's merges are applied, and never start point 2. A GEDCOM import runs the same join, with one person answering. If the device had no people, nothing runs. Repeat syncs run the walk too, but it asks only when a candidate exists.

**Walk.**
1. A queue holds pairs (P, Q).
2. For each pair and each relation, Q's relatives through new link records are compared with P's relatives through existing link records.
3. Certain pairs are merged at once and queued.
4. Possible pairs become questions, at most 3 candidates each, best first. Order: given same before close; surname match; years equal, then unknown, then near.
5. Answers:
   - a candidate: merge and queue that pair
   - **A different person**: write not-same records for every candidate shown
   - **Not sure**: nothing is written

**Look for duplicates around X.** For each relation of X, compares X's relatives with each other, pairwise. Uses the same table, with "incoming" and "existing" both meaning "relative of X".

**Commits.**
- Each answer, and each batch of automatic merges, is its own transaction, tagged with the join session ID.
- History shows a session as one group and undoes it as one.
- If the app is killed, the answers so far stay. Needs attention then offers **Continue joining**, which restarts the walk from the separate groups; pairs already answered are skipped by their merge or not-same records.

**Review screens.**
1. "We matched N people automatically": each has **Not the same**, which undoes that merge and writes a not-same record.
2. "Check differences": merged people whose fields differ. Names are compared by key, dates by structure, other text trimmed. Ours is preselected. Confirming writes the choices as new edits. Skipping leaves the later-wins rule to decide.

**Manual merge** (**Same person as…**) shows any blocking reasons as a warning, never a block.

**Budget fixture.**
- Two invented trees of 400 and 350 people that share 300.
- 30 of the shared people have a close-but-not-same given name on one side.
- 20% of birth dates are not exact.
- It includes repeated names across branches, as in real village trees.
- Pass: at most 40 questions, no false merge, and every shared person merged after the questions are answered from the fixture's truth table.

**Real-tree run** (release check, on Alex's Mac only, never committed, counts only): no false automatic merge, at most 10% of shared people asked, at most 2% missed.

## R10. History

- **Change group.** `{id, at (this phone's Date.now()), action, device, session?, people, changes, lost}`.
- **Changes:**
  - Edits: `{r, f, before?, after}` with triples.
  - Creations: `{r, created: true}`.
  - The re-stamp group lists the fields it rewrote.
- **Undo** runs in reverse:
  - A created record gets `deleted = true`.
  - A field whose current triple equals `after` gets `before.v` written as a new edit, or `null` if there was no `before`.
  - Fields changed since then are skipped and counted.
  - Every write is validated.
  - Erase groups can't be undone.
- **Undoing a sync or import** first says: "This removes N people and changes M details on this phone, and on your relatives' phones the next time you sync."
- **Size.** At most 20 MB, serialised. When the limit is passed, the oldest groups are dropped, and History says "Older history was removed."

## R11. Erase

- **Confirmation.** The user must type the person's given name. The text: "This erases Ema's details on every phone that syncs after this. Backups or GEDCOM files already saved, and phones that never sync again, keep their copy. It can't be undone."
- **Writes.** One time for everything, in one transaction:
  - on every record of the set: `er = true`
  - on every link touching the set: `del = true`
- **Every device, the erasing one included**, on storing `er`:
  - keeps only the `er` triple, so all devices hold the same record
  - discards all other fields of that record now and in future
  - replaces that record's values in History with `{erased: true}`
- **Received erases** ask first (R5).
- **History** keeps "Erased a person" with who and when, and no details.

## R12. GEDCOM

**Reading.**
- GEDCOM 5.5.1 lines `level [@xref@] TAG [value]`, with CONT and CONC joined.
- Encoding by BOM, else by `1 CHAR`: `UTF-8` or `UNICODE` (UTF-16). Anything else: "Open the file in your genealogy program and save it as UTF-8."
- File at most 20 MB.

**Sanitising** (before the validator). Each change is counted in the import summary:
- In notes, `<br>` and `<p>` become newlines and all other tags are removed.
- Text longer than its limit is cut to the limit, ending with `…`.
- Disallowed control characters are removed.

**Mapping.**
- **INDI** → person:
  - first NAME: given is the text before `/`; surname is the text between `/…/`, or SURN if present
  - a NAME with `TYPE birth` or `TYPE maiden` → birthSurname
  - SEX `M` or `F`, else `U`
  - BIRT and DEAT: DATE, PLAC; `1 DEAT Y` with no date → deceased
  - NOTE → note (several are joined with blank lines)
- **FAM:**
  - HUSB and WIFE → partner link: MARR DATE and PLAC → marriage date and place; DIV → ended, with DIV DATE → endDate
  - each CHIL → a parent link from each listed partner
- **Dates:**
  - `D MON YYYY`, `MON YYYY` or `YYYY` give y, m, d
  - prefixes `ABT`, `BEF`, `AFT`, `EST` give `q`
  - `CAL` is treated as `est`
  - anything else (`BET … AND …`, `FROM … TO …`, `@#D…@` calendar escapes) is kept as `t`
- **Counted as not kept:** every other tag, grouped by tag (for example OCCU 120, SOUR 45, OBJE 12, PEDI 3).

**IDs.**
- Accepted `_UID` shapes: 16, 32 or 36 hex characters, or a hyphenated UUID.
- A person's ID is, in order:
  - a 16-hex `_UID` (our own export), as-is
  - any other accepted `_UID`: the first 16 hex characters of SHA-256 of the lowercased `_UID`
  - no accepted `_UID`: the first 16 hex characters of SHA-256 of (SHA-256 of the file ‖ the INDI's xref)
- Within one file, a repeated `_UID` adds its occurrence number to the hash.
- So the same file gives the same IDs on every phone, even with no `_UID` at all, as in uds2gedcom's output.
- If the ID exists in the tree:
  - **Deleted or erased set:** skip the INDI (counted as "skipped").
  - **Name key and exact birth year agree** (or one side has no year): the INDI is that person. Only fields that have no triple at all are written.
  - **Otherwise:** give the INDI a fresh random ID. The walk reaches it through its links (R9 start points).

**Clock** (ADR 0006). All imported values use the time `(0, 0)` and the setter `0000000000000000`. Any real edit is later. Identical files give identical triples, so they cost nothing to sync. Import writes `del = false` only on records it creates. It never writes `del` on an existing record, and never writes `er`.

**Export.** 5.5.1, UTF-8, with:
- HEAD: `SOUR STEBLO`, `DATE` (today), `GEDC` / `VERS 5.5.1` / `FORM LINEAGE-LINKED`, `CHAR UTF-8`
- INDI:
  - `NAME given /surname/`
  - a second `NAME` with `2 TYPE birth` when birthSurname is set
  - SEX, with X exported as U
  - BIRT, DEAT (`1 DEAT Y` when deceased with no date), NOTE as CONT lines
  - `_UID` = person ID
- FAM per `view().families`:
  - HUSB is the M partner and WIFE the F partner; otherwise the first partner is HUSB and the second WIFE; a lone F partner is WIFE
  - MARR, DIV, CHIL
- TRLR at the end

## R13. Backup

- **Format.** `{format: "steblo-backup", version: 1, createdAt, records: [[id, kind, fields]…], meta: {name, thisIsMe, settings}, history: […]}`.
- **Limits.** At most 50 MB. Every record, meta value and history entry is validated before storage is touched, and any failure refuses the whole file with a report.
- **Restore.**
  1. Offers **Save current tree first**.
  2. Swaps everything in one transaction.
  3. Takes a new device ID and writes a new device record with the current name, or the backup's if none is set.

## R14. Storage

**Database** `steblo`, schema version 1:
- `records`: key is the record ID; the value is `{kind, f: {key: [v, ms, counter, by]}}`
- `history`: auto key; change groups
- `meta`: device ID, name, `last`, This is me, settings, last backup time

**The write contract.**
1. A `tree` operation returns a pending change: records to write, a history group and meta updates.
2. `storage` commits it in one transaction across all stores.
3. Only then does `tree` adopt it in memory and the UI redraw.
4. Sync payloads and hashes are built only from adopted state.
5. If the commit fails, the change is discarded, editing is locked, and the app says "Couldn't save. Your last change was not kept. Free some space or reopen the app."

**Migrations.**
- Before upgrading the schema, the migration copies every store into a `snapshot` store with the old version number. It stays until the next successful start on the new version.
- Each migration is a numbered function with a fixture test.
- Storage sits behind a small interface and is tested in Node on `fake-indexeddb` (a dev-only, pinned dependency), with failure injection: aborted transaction, quota error, `VersionError`, restore swap, and snapshot.
- On `VersionError` (an older app meeting newer data): "This phone has data from a newer Steblo. Open the app while online to update." with **Save backup**, which exports from the raw stores.

**Single writer.** A Web Lock named `steblo-writer` allows one editing tab. A second tab says "Steblo is open in another tab."

## R15. Service worker and release

- **Release script.** `scripts/release` writes `sw-files.js`, a list of every served file plus a version hash of their contents. The output is committed. A test fails if any served file is missing from the list or the hash is stale.
- **Updates.**
  - Install caches every listed file or none.
  - A new worker waits. The app shows **Update**, and tapping it sends `skipWaiting`, then the app reloads.
  - Fetches are served cache-first from the active version's cache only.
  - `sw.js` itself is served with `Cache-Control: no-cache`.

## R16. Headers

Set in `vercel.json`.

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Add `'wasm-unsafe-eval'` to `script-src` only if the spike picks the zxing-wasm decoder.
- `Permissions-Policy: camera=(self)`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

## R17. Spike items: pass condition, and what happens on a fail

All items run under the R16 headers, on an iPhone (iOS 17+) and an Android phone with Chrome, both installed to the Home Screen. The Vercel preview must be public, so the phones can open it with no login.

| # | Item | Pass | If it fails |
|---|---|---|---|
| 0 | Tuning grid | Done 2026-11-06; settings pinned in R8 | — |
| 1 | Rear camera in the installed app | Scans a code within 2 s of opening | Camera-denied and no-camera screens (R6). If it never works on one platform, stop and ask Alex. |
| 2 | Sending **20 KB** of encrypted data, one lineage | ≤ 30 s per direction, both ways. Also record one 200 KB run each way, for the estimate shown on big first syncs | If the best setting still misses, stop and ask Alex. |
| 3 | WebCrypto ECDH, HKDF, AES-GCM | Round trip OK | Stop and ask Alex. Vendoring crypto isn't planned. |
| 4 | CompressionStream `deflate-raw` | Round trip OK | Vendor fflate (MIT). |
| 5 | Screen Wake Lock in the installed app | Screen stays on for 3 min while showing | Notice "Keep the screen awake: tap it now and then", and the display rate rises to shorten the time. |
| 6 | Save and open a file in the installed app | Backup saved and reopened | Share sheet for saving; file picker for opening |
| 7 | `navigator.storage.persist()` | Returns true after install | A stronger backup reminder (after 7 days, not 30) |
| 8 | Storage isolation between browser and installed app | Recorded per platform | Install-first on any platform that isolates |
| 9 | `view()` and layout speed with 3,420 invented people (run at milestone 5, once they exist) | Redraw ≤ 300 ms on both phones | Memoise `view()` per change and lay out only the visible part |
| 10 | Decoder on the main thread vs a Worker | Higher share of frames read wins | Worker only if it reads more frames |
