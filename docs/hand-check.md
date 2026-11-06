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
- [ ] **58, 59** Erase. *Any phone.* Pass: as in the line above. Receiving an erase by sync waits for Milestone 6.
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
- [ ] **7** Scan a relative's tree. Not built yet (Milestone 6): the choice is shown greyed out with a note.

## Milestone 5.7: redraw speed (phones)

- [ ] Load the big file through **Restore a backup**, switch to the whole tree, then open Settings and read "Last redraw". Pass: at most 300 ms on both phones. Desktop (Mac, Chrome) reads about 100 ms for the whole tree.
