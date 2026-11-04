# Steblo

A family tree app that lives on each relative's phone. Relatives build their own parts of the tree and combine them by syncing phone to phone.

## Language

### The tree

**Tree**:
All the people and links held on one device. Each device holds exactly one tree.
_Avoid_: database, file, project

**Person**:
One human in the tree, known by a person ID that never changes.
_Avoid_: individual, INDI, member

**Parent link**:
The fact that one person is a parent of another.
_Avoid_: family, FAM, child-of

**Partner link**:
The fact that two people are or were a couple, married or not.
_Avoid_: family, union, marriage, spouse link, husband/wife

### Combining trees

**Device**:
One installed copy of the app, with its own tree.
_Avoid_: replica, client, peer

**Sync**:
Two devices exchanging changes by QR code until both hold the same tree.
_Avoid_: merge, import, transfer

**Join**:
The step where a sync or GEDCOM import brings in people not connected to anyone in your tree, and the two relatives show where the trees connect. It starts at the join person and asks about the people around them one by one.
_Avoid_: sync node, graft, anchor, append

**Join person**:
The person the two relatives pick as the one both trees share, where the join starts.
_Avoid_: sync node, root, anchor

**Hello**:
The opening QR code of a sync. It says which device is speaking and gives a fingerprint of its tree.
_Avoid_: handshake, greeting

**Merge**:
A person's decision that two person records describe the same human, after which they count as one person. It can be undone.
_Avoid_: dedupe, link, sync

**Separate group**:
People in a tree who are not connected to its largest part by any parent or partner link, usually because a join was skipped.
_Avoid_: island, orphan, component

**Needs attention**:
The list of things in a tree a person should check: separate groups, someone with more than two parents, someone who is their own ancestor, a partly erased person.
_Avoid_: warnings, issues, errors

**Erase**:
Permanently blanking a person's details on every device that syncs afterwards, for someone who asks to be removed. Unlike delete, it can't be undone.
_Avoid_: purge, wipe, hard delete

**History**:
The record of every change to the tree: what changed, who made it, on which device and when. Any change in it can be undone, except an erase.
_Avoid_: log, audit trail

### Files

**Backup**:
A file holding a whole tree with its history, for restoring on the same or another device.
_Avoid_: export, snapshot

**GEDCOM import / export**:
Reading a tree from, or writing it to, the standard genealogy file format, to start a tree or to take it to another program.
_Avoid_: backup, sync
