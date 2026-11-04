# Our own later-wins rule per field, compared by bucket fingerprints

Sync uses a small rule we write ourselves, not Automerge or Yjs.
- Every field of every person and link remembers who set it and when, using a hybrid logical clock. A change made after seeing another always comes later, even when phone clocks disagree. The later setting wins.
- `deleted` is a field too. It counts only while no other field of the record (or of its merged set) was set later, so an edit made after a delete revives the record.
- To find what differs, each device's first code carries a 4-byte hash of each of 256 buckets of records, and the two devices exchange the full contents of the buckets that differ. Only current values travel. Each device keeps its own history of what it saw change, including values that lost, so undo still works.

## Considered Options

- **Automerge** and **Yjs** merge generic documents. Neither knows about merging two person records or about link IDs derived from person IDs, so that logic would be ours anyway. We did not measure their encoding of a tree.
- **Each person editable only on the device that added them**: no merge at all. But nobody could fix a relative's typo, and a lost phone would freeze its branch on every device.
- **Version vectors**: the fewest bytes, and our first draft used them. Review showed they trust their bookkeeping too much. A forged vector stops changes flowing, rejected data can never be requested again, and two phones sharing a device ID lose edits. Bucket fingerprints cost more bytes on repeat syncs (about 10 KB for 10 changed buckets on a 3,420-person tree), and any disagreement heals at the next sync.
- **Sending the full tree every time**: the simplest option, but every repeat sync would take about 2 minutes each way.
