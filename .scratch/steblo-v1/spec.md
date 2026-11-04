# Steblo v1

Status: ready-for-agent

Technical design: `docs/specs/2026-10-30-steblo-v1-design.md`. Exact rules: `docs/specs/2026-10-30-steblo-v1-reference.md`. Vocabulary: `GLOSSARY.md`. Decisions: `docs/adr/` 0001–0007. All people named here are invented.

## Problem Statement

My family's history is scattered. Some of it is in an old desktop program, some in a relative's MyHeritage export, most in older relatives' heads. Each of us knows our own branch, and nobody has the whole picture. Online genealogy services want accounts, subscriptions and our data on their servers. A shared web app needs someone to run a server and keep it alive. I want to build my part of the tree on my phone, and when I meet my cousins, put our parts together right there, without internet, accounts, or anyone's server.

## Solution

Steblo is a free, open-source app installed from a web page onto the Home Screen of any iPhone or Android phone. Each relative builds their own part of the tree on their phone: add yourself, your parents, children, partners and siblings, with names, dates and places. It can also start from a GEDCOM file exported from another genealogy program.

When relatives meet, they sync. Their phones take turns showing and scanning moving QR codes, with no internet needed. The first time two trees meet, the relatives pick a person both trees share. The app connects the rest itself where it is certain, and asks a few short "is their Ema your Ema?" questions where it isn't. After that, any two relatives who sync get each other's latest changes automatically.

Everything stays on the phones. Every change is recorded and can be undone, and a person who asks to be removed can be erased. A backup file and a GEDCOM export mean nothing is ever locked in.

## User Stories

### Getting started

1. As a new user, I want to install the app from a web page to my Home Screen, so that it opens like any other app and works offline.
2. As a new iPhone user who opened the page in Safari, I want to be told to install the app before I enter anything, so that my tree isn't left behind in Safari.
3. As a new user, I want the app to appear in my phone's language (English or Macedonian), so that I can use it without changing settings.
4. As a new user, I want to enter my name once, so that my relatives can see which changes came from me.
5. As a new user with no data, I want to start my tree with myself, so that I can add relatives around me.
6. As a new user who has a GEDCOM file, I want to start my tree from it, so that I don't retype years of research.
7. As a new user at a family gathering, I want to get a relative's tree by scanning their phone, so that I start with what the family already has.
8. As a user moving to a new phone, I want to restore a backup file, so that I continue where I left off.

### Building the tree

9. As a user, I want to add a parent, child, partner or sibling from any person's card, so that the tree grows in every direction.
10. As a user, I want the surname of a new relative pre-filled in the right male or female form (Novakov / Novakova), so that adding family members is quick.
11. As a user, I want to record given name, surname, birth surname, sex, birth and death dates and places, and a note for each person, so that the tree holds what I know.
12. As a user, I want to enter partial or approximate dates (only the year, "about 1931", "before 1950"), so that I can record what I actually know.
13. As a user, I want to mark someone as deceased when I don't know the date, so that the tree doesn't present them as living.
14. As a user, I want to record a couple's marriage date and place, and their separation (divorce), so that partnerships are described properly.
15. As a user, I want to record a couple who never married, so that every child's parents can be shown.
16. As a user, I want to edit any person's details, so that I can correct mistakes.
17. As a user, I want to write notes over several lines, so that I can record stories.
18. As a user, I want to delete a person or a link I added by mistake, and restore it later from History, so that the tree stays correct.
19. As a user, I want to be stopped from adding a third parent, so that I don't create an impossible tree by accident.
20. As a user, I want to type names in Cyrillic or Latin as I like, so that names are stored exactly as the family writes them.
21. As a user, I want to be told clearly when the app couldn't save a change, so that I never lose work silently.

### Viewing the tree

22. As a user, I want an hourglass view around one person, showing ancestors above and descendants below, so that I can explore one branch at a time.
23. As a user, I want a whole-tree view, so that I can see how large the family is and how branches connect.
24. As a user, I want to mark which person is me, so that the tree opens centred on me.
25. As a user, I want to search for a person by name in either alphabet (Данило finds Danilo), so that I find people quickly.
26. As a user who reads Latin better than Cyrillic, I want a "Show in Latin letters" switch, so that Cyrillic names and the Macedonian interface appear in Latin letters.
27. As a user, I want the app to work fully offline, so that I can use it at a village gathering with no signal.

### Syncing with relatives

28. As a user meeting a relative, I want to sync by showing and scanning QR codes, so that we combine our trees without internet or accounts.
29. As a user, I want clear "show", "scan", "Got it ✓" and "Next" steps on both phones, and a short code to compare, so that the turn-taking is easy to follow and I know I scanned the right phone.
30. As a user, I want to be told before sending that the other phone gets everything it doesn't have yet (my whole tree the first time), so that I'm never surprised by what I shared.
31. As a user, I want a missed or blurry frame not to break the sync, so that I just keep the camera pointed until it finishes.
32. As a user, I want to see progress and the time remaining while scanning, so that I know how long to keep holding the phone.
33. As a user, I want the screen to stay on while it shows codes, so that the sync isn't interrupted.
34. As a user, I want an interrupted or cancelled sync to be safe to repeat, so that nothing is lost or duplicated.
35. As a user, I want the codes to be unreadable to a bystander filming them, so that our family data stays private.
36. As a user syncing again with a relative I synced with before, I want only the changes to be exchanged, so that a repeat sync takes seconds.
37. As a user, I want changes from relatives I never met to reach me through relatives we both sync with, so that the whole family's tree spreads.
38. As a user, I want a summary after a sync (new people, changed details, values that lost, items that couldn't be taken), so that I know what happened.
39. As a user whose phone clock or relative's phone clock is wrong, I want the sync to stop and show both dates, so that we can fix the clock and sync again without losing anything.
40. As a user with an older app version, I want a clear message to update when my relative's app is newer (and the reverse), so that syncs don't fail mysteriously.
41. As a user with a large tree, I want to see roughly how long a sync will take before it starts, with the option to cancel, so that I'm not left waiting.

### Joining trees the first time

42. As a user whose relative's tree is new to mine, I want to pick the one person both trees share, so that the app knows where our trees connect.
43. As a user, I want the app to connect the people it is certain about by itself, and show me the list with an undo for each, so that we don't answer hundreds of questions.
44. As a user, I want the app to ask about uncertain matches one at a time ("Their Ema, b. 1958: is she one of yours?"), so that shared relatives aren't duplicated.
45. As a user, I want candidates found across alphabets and spellings (Ѓеко, Ǵeko and Gjeko; Чарин and Carin; Новакова and Novakov), so that the same person isn't missed.
46. As a user, I want to answer "a different person" and never be asked about that pair again, on any phone, so that I'm not pestered.
47. As a user, I want to answer "not sure", so that I can decide later with an older relative.
48. As a user, I want to review at the end the merged people whose details differ, with mine preselected, so that the best information survives without a question per field.
49. As a user, I want to keep the new people separate for now and join them later from Needs attention, so that I can do it when I'm ready. If the app closes during a join, I want to continue where I left off.
50. As a user, I want the app to notice when both sides added the same new person (a new baby), and to look for duplicates around any person, so that people added twice can be merged.
51. As a user, I want to say "Same person as…" for any two people, so that I can fix duplicates the app didn't suggest.

### History, undo and erase

52. As a user, I want to see every change, including what changed, who made it, on which phone and when (by my phone's clock), so that I can follow how the tree evolved.
53. As a user, I want to see the history of one person, so that I can see who changed their details.
54. As a user, I want to undo any change, including a delete, a merge or an automatic match, so that mistakes, mine or a relative's, can be reversed.
55. As a user, I want my undo to reach my relatives at the next sync, so that a mistake is fixed everywhere.
56. As a user undoing a whole sync or import, I want to be told how many people and details it affects, here and on relatives' phones, so that I don't undo more than I meant to.
57. As a user, when two relatives edited the same detail differently, I want the later edit to win without a prompt, and the value that lost to stay in the history of the phone that held it, so that syncing never blocks on questions and nothing disappears unseen.
58. As a relative who doesn't want to be in the tree, I want my details erased on every phone that syncs afterwards, so that my wish is respected. As a user receiving an erase by sync, I want to see who it affects first, so that a mistake or a bad actor can't quietly remove people.
59. As a user erasing someone, I want to type their name to confirm, and to be told that saved files and phones that never sync again keep their copy, so that I don't erase by accident and I understand the limits.

### Needs attention

60. As a user, I want a list of things to check (separate groups, people with more than two parents, someone who is their own ancestor, partly erased people), so that sync oddities don't go unnoticed.

### Files

61. As a user, I want to import a GEDCOM file from MyHeritage, Ancestry, Gramps or uds2gedcom into my existing tree, so that I can add research from other programs.
62. As a user, I want a summary of what the import didn't keep or had to shorten (photos, sources, other events, cut notes), so that I know what was left behind.
63. As a user re-importing a file, or importing the same file a relative imported, I want the app to recognise the people already there without overwriting any edit, even when the file has no stable IDs, so that I don't get duplicates or lose changes.
64. As a user with a file in an old encoding, I want a clear message on how to re-save it, so that I'm not stuck.
65. As a user, I want to export my tree as a GEDCOM file, so that I can take it to any other genealogy program.
66. As a user, I want to save a backup file in one tap, with a reminder that anyone with the file can read it, so that losing my phone doesn't lose my tree.
67. As a user, I want to see how long ago my last backup was, and a gentle reminder after a month of changes, so that I keep a recent backup.
68. As a user restoring a backup, I want to be offered to save my current tree first, and to have a broken file refused whole, so that a restore never leaves me worse off.
69. As a user, I want the app to ask the phone to keep its data permanently, so that the system doesn't clear my tree.

### Using the app

70. As a user, I want to be told when a new version is ready and update with one tap, so that I get fixes without the app changing under me.
71. As a user who opens the app in a second tab, I want to be told it's already open, so that two copies don't overwrite each other.
72. As a user, I want to change my name, language and Latin-letters setting at any time, so that the app suits me.

### Contributors

73. As a translator, I want to add a language by adding one strings file, so that the app reaches more families.
74. As a developer, I want the tree logic to run in plain Node with no browser, so that I can test and reuse it.
75. As a privacy-minded user, I want the app to make no network requests besides loading itself, so that I can trust that my data never leaves my phone except by QR.

## Implementation Decisions

- **Shape.** Static PWA, vanilla JavaScript ES modules, no build step, no framework. Served as static files from `steblo-app.vercel.app`, deployed from `main` of the GitHub repo `Xin-Dragons/steblo`. MIT license. A release script only writes the service worker's file list.
- **Pure core** (tested in Node): clock, records (with the one validator), tree, history, names, dates, sync, join, gedcom, backup, envelope (WebCrypto), frames, qrcodec (vendored QR generator and decoder on raw pixels). Browser-only parts: storage, scanner, ui, sw.
- **Tree interface** (used by the UI and tests):
  - create from stored records, or empty
  - add person; add parent, child, partner or sibling
  - edit; delete and restore; erase
  - merge with conflict choices; mark not-same; undo a change group
  - `view()`: canonical people, links, derived families, needs-attention items
  - sync: hello; payload for the other device's hello; apply a payload (returns the summary, losing values, rejected counts and join start points)
  - join: start points, next question, answer, automatic matches, differences

  Every operation returns a pending change. `storage` commits it, and only then does `tree` adopt it.
  - GEDCOM import (returns the summary) and export
  - backup write, validate and restore
- **Data model** (ADR 0001):
  - People plus parent and partner links; families are derived, never stored.
  - Record IDs are derived; person and device IDs are 64-bit hex.
  - Every field is a triple (value, hybrid-logical-clock time, setter), totally ordered with a value tie-break.
  - Merges, not-same decisions, erasures and device names are records or fields too.
  - Merged people and collapsed links act as one record (latest triple per field, `deleted` included).
  - Unknown fields from newer apps are stored, relayed and hashed.
- **Sync** (ADR 0002, 0004):
  - 256 buckets of records; the hello carries a 4-byte hash of each; the two devices exchange the full contents of buckets that differ. There are no version vectors.
  - Rejected items aren't stored, so their bucket is offered again at the next sync.
  - The hellos carry each phone's clock. A sync stops if they differ by more than 24 hours. Once they agree, a device re-stamps its own far-future values. Values more than 24 hours ahead of the receiver are rejected.
  - Three QR steps with explicit taps; a 4-letter code to confirm the phone; the join on A between steps 2 and 3; a time estimate before showing changes. Step 3 sends an exact diff.
  - Compact payload (ID table, links by index, one clock per record, delta-encoded clock table); memory caps of 4 MiB stream and 16 MiB decompressed; formats pinned in the reference spec.
- **Privacy of sync.** Ephemeral ECDH P-256, then HKDF-SHA-256, then AES-GCM-256, with both hellos and the step number in the associated data. No passwords.
- **Join.** Rules follow `uds2gedcom`. A coarse ASCII matching key folds Cyrillic, diacritics and digraphs; an empty key never matches; descriptive names are placeholders. The walk starts from chosen join pairs and from every existing person who gained an incoming relative. Blockers; certain matches merged automatically and listed for review; uncertain ones asked; differences reviewed once at the end. Each answer commits on its own, and History treats the session as one group. Budget: at most 40 questions on the fixture in the reference spec.
- **History.** Local; one change group per action, receive or import; creations by ID; the phone that held a losing value logs it; undo of creations deletes, and undo of a first value clears it; capped at 20 MB.
- **Erase** (ADR 0007). Irreversible, confirmed by typing the given name; every device, the erasing one included, keeps only the erase mark, discards every other value for that record and scrubs its history. A received erase lists who it affects, with Continue and Not now.
- **GEDCOM.**
  - Import: 5.5.1 in UTF-8 or UTF-16, sanitised and then validated. Stable person IDs come from `_UID`, or from the file's hash and the person's xref. Imported values carry the lowest time (ADR 0006). Import never writes to a deleted or erased person.
  - Export: 5.5.1 with `_UID`.
- **Backup.** JSON with records, settings and history. Validated whole before a single-transaction swap; a new device ID afterwards.
- **Storage.** IndexedDB with versioned schema and tested migrations; a snapshot before each upgrade; one transaction per change; failures block editing with a message; a screen for data newer than the app; Web Lock single writer.
- **Service worker.** A versioned all-or-nothing precache from a generated file list; a new version activates only when the user taps Update.
- **UI.**
  - From the private Стебло app, with every real name scrubbed, only the layout maths, styles, transliteration, the manifest, and the shape of the add-relative flow and card menu are reused. The surname-form functions are extended to Latin endings.
  - Rendering is rewritten as DOM building (no `innerHTML`, no inline style attributes), and so are all forms with the new fields.
  - Install-first on iOS.
  - System fonts; English and Macedonian strings files; one "Show in Latin letters" switch.
- **Security.** Strict CSP (see the reference spec; `'wasm-unsafe-eval'` only if the zxing-wasm decoder is chosen); no third-party requests; `textContent`-only rendering; one validator for every input path; caps checked before allocation; vendored libraries pinned with hashes.
- **Spike first.** A throwaway page tests ten items under the production headers on Alex's iPhone and an Android phone (installed), each with a pass condition and a fallback (reference R17). Gate: a fixed 200 KB crosses in at most 2 minutes per direction. On a miss, building stops and Alex decides.

## Testing Decisions

- A good test drives the system through its public operations and checks what a user would see (`view()`, summaries, exported files). It also checks full state through the backup's sorted records, never internal maps or helpers.
- **Seam 1, pure modules in Node.**
  - Convergence with three to four simulated devices doing random edits, deletes, restores, merges, not-same, erase, undo, imports and syncs, with:
    - interrupted syncs
    - a clock that was ahead and is then fixed
    - a newer app with an extra field
    - restore with a new ID
    - two devices with the same ID
  - Devices with the same validator must end identical. A device that drops malformed items equals the others minus exactly those items, and reports them.
  - Rule tests.
  - Join tests (keys, blockers, certain and possible, the overlap case, the question budget).
  - GEDCOM round trip and hand-written invented fixtures shaped like each source program, including multi-line HTML-ish notes and bad `_UID`s.
  - Backup tests.
  - Hostile-input tests.
  - Storage tests on `fake-indexeddb` (dev-only, pinned), with failure injection.
  - Number tests, using a committed tree generator: payload at most 175 KB for a hand-typed 3,420-person tree; at most 15 KB for a repeat sync of 10 changed buckets; `view()` of 5,000 people under 200 ms.
  - A test fails if `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` or `EventSource` appear outside the service worker.
- **Seam 2, end-to-end sync in Node.** Real QR images from the vendored generator are read back by the vendored decoder. 20% of frames are dropped and the rest shuffled, in both directions, and both trees must be identical.
- **UI and camera:** checked by hand in a desktop browser and on Alex's iPhone and Android phone, using a hand-check list with pass conditions that ships with the plan.
- **Real-tree join run:** a release check on Alex's Mac only, never committed. The private tree is split into two overlapping halves, and only counts are reported. Pass: no false automatic merge, at most 10% of shared people asked, at most 2% missed.
- Tests and fixtures use only the invented name set listed in the design. `privacy-check` runs as local pre-commit and pre-push hooks on Alex's Mac.
- Prior art: the private app's `node --test` suite for its shared tree rules.

## Out of Scope

- Photos and media, sources and citations, events beyond birth, death, marriage and separation (divorce)
- Sharing only one branch; several trees on one device
- The self-hosted server device (later; the format already allows it)
- GEDCOM 7 and non-Unicode encodings
- Hiding living people in exports; encrypted backups
- Permissions, signed changes, an owner role
- Resuming an interrupted QR stream
- Bluetooth, WebRTC or file sync (if the spike misses its gate, Alex decides)
- Latin→Cyrillic conversion of names; nickname tables for matching
- UI languages beyond English and Macedonian

## Further Notes

- The address `steblo-app.vercel.app` must never change: each phone's tree is stored under it (ADR 0005). Never delete the Vercel project.
- Creating the GitHub repo, the Vercel project and any deployment waits for Alex's explicit go-ahead. The spike needs a public Vercel preview, so that go-ahead is the first blocker of the build. Whether a Hobby Vercel account can deploy from the `Xin-Dragons` org repo is checked at that point.
- `uds2gedcom` writes no `_UID`. Steblo copes through the file hash, but adding `_UID` there would keep IDs stable across re-conversions.
- Alex's iPhone and an Android phone are needed for the spike gate and the final acceptance check.
