# Hand-check list

One line per user story (numbers from `.scratch/steblo-v1/spec.md`), with a pass condition and the device to use. Tick a line only after you have seen it pass yourself. "Desktop-checked" means the build session saw it work in a desktop browser under the production headers (2026-11-06); it does not replace the phone.

Load the 3,420-person file with `node scripts/make-fixture.mjs --people 3420 --seed 1 --out /tmp/steblo-fixture.json` where a line says "big file".

## Milestone 5.3: shell, strings, drawing

- [ ] **3** App appears in the phone's language. *Phone, Settings language set to Macedonian or English before first open.* Pass: first screen is in that language with no setting changed. Desktop-checked: English and Macedonian strings both load; every key exists in both (a test).
- [ ] **22** Hourglass view. *Any phone.* Pass: ancestors above the chosen person, descendants and partners below and beside; the generation ruler shows +1, −1. Desktop-checked.
- [ ] **23** Whole-tree view. *Any phone, big file.* Pass: every family line is drawn on shelves with a name tag; pinch zooms out to all of it; tapping a tag zooms to that line. Desktop-checked (3,341 cards).
- [ ] **26** Show in Latin letters. *Any phone.* Pass: the АБВ/ABC switch turns names and the Macedonian screens into Latin letters and back, and the choice survives a restart. Desktop-checked.
- [ ] Pan, pinch and long-press. *Both phones.* Pass: one finger pans, two fingers zoom, a long press on a card opens its menu, a short tap selects it. Not desktop-checked (touch).
- [ ] Nothing leaves the phone. *Desktop.* Pass: with the browser's network panel open, only the app's own files load; no console errors. Desktop-checked.

## Milestone 5.4: forms and the card menu

- [ ] **9** Add parent, child, partner or sibling from a card. *Any phone.* Pass: each of the four adds a person in the right place; "Parent" is greyed out once there are two. Desktop-checked (partner, child, parent).
- [ ] **10** Surname pre-filled in the right form. *Any phone.* Pass: adding a daughter of Novakov offers Novakova once you pick Female; typing your own surname stops the change. Desktop-checked.
- [ ] **11** All person fields. *Any phone.* Pass: given name, surname, birth surname, sex, birth and death date and place, and a note are saved and shown on the card panel. Desktop-checked.
- [ ] **12** Partial dates. *Any phone.* Pass: only a year, "about 1931", "before 1950" and words like "spring 1931" are accepted; 31 February is refused with a message. Desktop-checked.
- [ ] **13** Deceased with no date. *Any phone.* Pass: the box marks the person as deceased and the panel says so. Desktop-checked.
- [ ] **14** Marriage date, place and separation. *Any phone.* Pass: adding a partner can record them; **edit** next to a partner changes them; the year shows on the line between the couple. Desktop-checked.
- [ ] **15** A couple who never married. *Any phone.* Pass: a partner added with no marriage details still shows as a couple and as the other parent when adding a child.
- [ ] **16** Edit any person. *Any phone.* Pass: changed fields are saved; cleared fields disappear. Desktop-checked.
- [ ] **17** Multi-line notes. *Any phone.* Pass: a note with two lines shows both lines. Desktop-checked.
- [ ] **18** Delete and restore. *Any phone.* Pass: Delete removes the person after a confirmation; History › Deleted people › Restore brings them back. Desktop-checked.
- [ ] **19** No third parent. *Any phone.* Pass: Parent is greyed out for someone with two parents; linking a third parent is refused ("not possible"). Desktop-checked (menu; the refusal has a unit test).
- [ ] **20** Names in either alphabet. *Any phone.* Pass: a name typed in Cyrillic or Latin is stored and shown exactly as typed (until the Latin switch is on). Desktop-checked.
- [ ] **21** A failed save is never silent. *Phone with almost full storage, or skip.* Pass: the message "Couldn't save. Your last change was not kept. Free some space or reopen the app." stays on screen and editing stays locked. Covered by storage tests (quota error); not checked on a phone.
- [ ] **24** This is me. *Any phone.* Pass: the menu entry marks you; after a restart the tree opens on you. Desktop-checked.
- [ ] **76** Link to someone already in the tree. *Any phone.* Pass: card menu › Link… › parent, child or partner › pick a person; a third parent, a loop and an existing link are refused or greyed; the picker explains why. Desktop-checked (partner).
- [ ] Erase needs the typed name. *Any phone.* Pass: the Erase button stays off until the given name is typed (either alphabet); the text says saved files and phones that never sync again keep their copy. Desktop-checked.

## Milestone 5.5: other screens

- [ ] **25** Search in either alphabet. *Any phone.* Pass: typing "Danilo" or "Данило" finds the same person; a year narrows the list. Desktop-checked (and unit-tested).
- [ ] **52** History shows what changed, by whom, on which phone, when. *Any phone.* Pass: each row names the action, the phone, the time and the people. Desktop-checked.
- [ ] **53** History of one person. *Any phone.* Pass: the **History** button on a person's panel lists only that person's changes. Desktop-checked in code path; spot-check on a phone.
- [ ] **54** Undo. *Any phone.* Pass: Undo reverses a delete, an edit or a GEDCOM import. Desktop-checked (import, delete).
- [ ] **56** Undo of a whole import tells the numbers first. *Any phone.* Pass: "This removes N people and changes M details on this phone, and on your relatives' phones the next time you sync." Desktop-checked.
- [ ] **58, 59** Erase. *Any phone.* Pass: as in the line above. Receiving an erase by sync is line **58, 59** under Milestone 6.
- [ ] **60** Needs attention. *Any phone.* Pass: the menu shows a count; separate groups, more than two parents, loops and partly erased people are listed; **Erase the rest** finishes a partly erased person. Desktop-checked (separate groups).
- [ ] **61, 62** GEDCOM import with summary. *Any phone, a .ged file.* Pass: the summary lists new people and links and what was not kept; nothing is stored until you tap **Add to my tree**. Desktop-checked.
- [ ] **64** Old-encoding file. *Any phone.* Pass: a non-UTF-8 file gives "Open the file in your genealogy program and save it as UTF-8." Covered by unit tests; not checked in the browser.
- [ ] **65** GEDCOM export. *Both phones.* Pass: the warning shows, the file is saved (share sheet on a phone) and opens in another program. Desktop-checked (download).
- [ ] **66** Backup in one tap. *Both phones.* Pass: warning, then the file is saved through the share sheet (iPhone) or a download (Android). Desktop-checked (download); phones owed.
- [ ] **67** Backup age and the 30-day reminder. *Any phone.* Pass: Settings says how many days ago; a banner appears after 30 days with changes. Age text desktop-checked; banner not.
- [ ] **68** Restore. *Both phones.* Pass: **Save current tree first** is offered; a damaged file is refused whole with reasons and nothing changes; a good file replaces the tree. Desktop-checked (good and damaged file).
- [ ] **69** Persistent storage. *Both phones, installed.* Pass: Settings says "The phone has agreed to keep your data." after the first person is added. Phones owed (desktop browser said it may clear data).
- [ ] **71** Second tab. *Desktop, or a phone with two windows.* Pass: a second tab shows "Steblo is open in another tab." Covered by storage tests; open the app in two tabs to see it.
- [ ] **72** Name, language and Latin setting any time. *Any phone.* Pass: Settings changes each one, immediately and after a restart. Desktop-checked.
- [ ] Newer data. *Skip unless you can make it.* Pass: an older app meeting newer data shows the newer-data screen with **Save backup**. Covered by storage tests.

## Milestone 5.6: first start (phones)

- [ ] **1** Install to the Home Screen. *iPhone and Android.* Pass: Android Chrome offers **Install** on the first screen; iPhone Safari shows the install steps; the installed app opens full screen and starts offline after the first load (offline needs Milestone 7).
- [ ] **2** iPhone in Safari must install first. *iPhone, Safari tab.* Pass: only the install steps show; no field can be typed in. Logic unit-tested; screen checked on desktop with a stand-in.
- [ ] **4** Enter your name once. *Both phones.* Pass: the first screen asks for it and refuses an empty name.
- [ ] **5** Start with myself. *Both phones.* Pass: you appear as the first card, marked "this is me".
- [ ] **6** Start from a GEDCOM file. *Both phones.* Pass: choice 2 opens the file picker and the same summary as Settings.
- [ ] **8** Restore on a new phone. *Both phones.* Pass: choice 3 restores a backup file made on the other phone.
- [ ] **7** Scan a relative's tree. *Both phones, a second phone with a tree.* Pass: choice 4 makes this phone, then opens the Sync notice; after a first sync this phone holds the other phone's whole tree. Two simulated phones in one browser page did this on 2026-11-07 (empty phone scans, gets 7 people); the real run is still owed.

## Milestone 5.7: redraw speed (phones)

- [ ] Load the big file through **Restore a backup**, switch to the whole tree, then open Settings and read "Last redraw". Pass: at most 300 ms on both phones. Desktop (Mac, Chrome) reads about 100 ms for the whole tree.

## Milestone 6: sync and join (two phones)

Use two phones with the same build, each with a tree from `node scripts/make-fixture.mjs --people 400 --seed 1 --out FILE` (seeds 1 and 2) loaded through **Restore a backup**. For the join lines use two trees that share people: the overlap builder in `tests/fixtures/overlap.js` makes them (a sketch is in the Milestone 6 notes). "Simulated" below means two instances of the app in one desktop browser page, with a canvas as the camera (2026-11-07). That checks the screens and the order of steps, not a real camera, real light or a real hand.

- [ ] **30** Notice before sending. *Both phones.* Pass: Menu › **Sync with a relative** opens "This sends everything the other phone doesn't have yet. On a first sync, that is your whole tree." and editing is locked until Finish or Cancel. Simulated.
- [ ] **31** A missed frame doesn't matter. *Both phones, both directions.* Pass: shake the phone or cover the code for a second; the sync still finishes without restarting. Needs the real camera.
- [ ] **32** Progress and time left. *Receiving phone.* Pass: the bar and "N of M parts" move; "About N minutes left" appears after a few seconds and "Almost done" at the end. Simulated (progress); the time left needs real speeds.
- [ ] **33** Screen stays on while showing. *Both phones, installed.* Pass: leave a code showing for 3 minutes (use the 400-person fixture to get a long one): the screen doesn't dim. If it does, the orange note "Keep the screen awake: tap it now and then." must have been on the screen. Not checked (the framed test pages refuse Wake Lock, which showed the note).
- [ ] **34** Cancel at every step, then sync again. *Both phones.* Pass: cancel on each screen of both phones in turn (A: code, scan, after "Got it"; B: scan, "Got it", code, scan); each time the sync closes with "Sync cancelled", editing works, and a new sync finishes with the two trees identical. Simulated.
- [ ] **34** Closing the app in the middle. *One phone.* Pass: force-close the app during step 2 or 3 and during a join; reopen; a new sync finishes. After a join was killed, what was answered stays and Menu › Needs attention › **Continue joining** offers any groups still separate. Not checked on a phone.
- [ ] **35** Codes are unreadable to a bystander. *Any phone.* Pass: film a data code, then scan the film with a QR reader: the text is not readable (the first code, the hello, is plain by design). Unit-tested (encryption); not checked on a phone.
- [ ] **36** Repeat sync is quick. *Both phones.* Pass: sync twice with no edits between; the second says "0 new people", takes seconds and asks no question. Simulated.
- [ ] **37** Changes spread through a third phone. *Three phones, or two phones plus a backup.* Pass: A edits and syncs with B; B syncs with C; C shows A's edit. Convergence is unit-tested; not run on phones.
- [ ] **38** Summary after a sync. *Both phones.* Pass: both show new people, changed details, replaced values (kept in History) and refused items. Simulated.
- [ ] **39** Clocks three days apart. *Both phones.* Pass: set one phone's date three days ahead; the scanning phone shows a hello-only code and "The two phones' clocks differ by 3 days…" with both dates; the other phone shows the same message after scanning it. Nothing is written. Fix the date and sync again. Simulated (clock skewed in code).
- [ ] **39** Clock was ahead once. *One phone.* Pass: edit with the date set days ahead, put it right, then sync; History shows "Fixed times after a clock error". Unit-tested; not run on a phone.
- [ ] **40** Older app. *Both phones.* Pass: with one phone on a build whose hello format is higher, the lower phone says "Update the app: open it once while online." and the other "Ask the other phone to update." Unit-tested (format reading); not run, there is no second build.
- [ ] **41** Time before a big sync. *Both phones.* Pass: with the 400-person fixture, the "Got it" screen and "Show my code" say "About N minutes" before anything is shown, and Cancel is there. Simulated (the text); the numbers need phones.
- [ ] **58, 59** Receiving an erase. *Both phones.* Pass: erase a person on one phone, sync: the other shows "This sync erases 1 person" with the name, **Continue** and **Not now**. Not now keeps the person, and the question returns at the next sync; Continue erases. Simulated (Continue); Not now not run.
- [ ] No camera. *A device with no camera (a desktop browser).* Pass: the notice says "This device can only show codes."; **I'll scan** is off; role A shows the first code only. Simulated.
- [ ] Camera refused. *Both phones.* Pass: deny the camera in the browser settings, tap I'll scan: "Steblo needs the camera to scan. Allow it in Settings → Safari or Chrome → Camera." and **Try again** works after allowing. Simulated (the message); the real permission prompt not run.
- [ ] Four-letter check. *Both phones.* Pass: the code on the showing phone and in "The other phone shows ABCD?" are the same four letters. Simulated.
- [ ] First scan within 2 seconds. *Both phones, installed.* Pass: from tapping **I'll scan** to "Got it" for the first (3-block) code takes at most a few seconds in normal light. Not checked.
- [ ] Speed. *Both phones, installed.* Pass: a 20 KB sync (about 400 people, one lineage) finishes within 30 seconds each way; record the 400-person fixture time. Spike measured 5–11 s for 20 KB; the app has not been timed on a phone.

### Join (stories 42–51)

- [ ] **42** Pick the shared person. *Phone A, two trees that share people.* Pass: after the first sync "Join the trees" shows each new group, largest first, with a list of the group's people and a search box for your tree; **Join them** needs both picked; a warning shows if the pair doesn't fit (different sex, far apart birth years). Simulated.
- [ ] **43** Automatic matches with an undo each. *Phone A.* Pass: "We matched N people automatically" lists them; **Not the same** takes one back and it is never suggested again. Simulated (list); the Not the same button not run.
- [ ] **44** Questions one at a time. *Phone A.* Pass: a close name (Miro / Мироо) is asked with both people's birth year, place, parents and partners; **Same person** merges, **A different person** and **Not sure** don't. Simulated (Same person); the other two not run.
- [ ] **45** Across alphabets. *Phone A.* Pass: Ѓеко / Gjeko, Чарин / Čarin, Новакова / Novakov are found as candidates. Unit-tested; the simulated run matched Cyrillic and Latin spellings.
- [ ] **46** A different person is remembered. *Both phones.* Pass: answer A different person; sync again on both phones; the pair is not asked again. Unit-tested; not run.
- [ ] **47** Not sure. *Phone A.* Pass: nothing is written; the same pair is asked at the next join. Unit-tested; not run in the screens.
- [ ] **48** Check differences. *Phone A.* Pass: merged people whose details differ are listed with Yours preselected; **Keep my choices** writes them, **Skip** leaves the later change. Simulated (Keep my choices).
- [ ] **49** Keep separate, then join later. *Phone A.* Pass: **Keep separate** and **Keep all remaining separate** leave the people in Needs attention; there, **Join** (one group) and **Continue joining** (all groups) start the same screens. Simulated.
- [ ] **49** The app closes during a join. *Phone A.* Pass: kill the app after a few answers; the answers stay; Needs attention offers **Continue joining**. **Known gap:** people already merged are not new, so relatives of people merged before the kill are not visited again. Look for the rest with the card menu › **Look for duplicates around…**. Unit-tested (every prefix is a sound tree); not run on a phone.
- [ ] **50** A new baby added on both sides. *Both phones.* Pass: add the same child on both phones, sync; the join asks about it because their parent gained a relative; later, **Look for duplicates around…** finds any that slipped through. Unit-tested; not run.
- [ ] **51** Same person as… *Any phone.* Pass: any two people can be merged, with a warning (never a block) if they don't fit. Desktop-checked in Milestone 5.
- [ ] Phone B's join. *Both phones.* Pass: if A kept a group separate that B doesn't have, B is offered that group after Done, and only groups (never "gained relatives"). Simulated.
- [ ] GEDCOM import join. *One phone with a tree.* Pass: after **Add to my tree** the join starts for the new groups, with one person answering; on an empty tree nothing is asked. Simulated.
- [ ] Editing is locked. *Both phones.* Pass: during a sync or join nothing behind the screen can be tapped; after Finish, Cancel or Close it works again. Simulated.
