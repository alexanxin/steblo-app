// Change groups, undo and erase scrubbing (reference R10, R11). Pure.
import { compareTriples } from "./clock.js";
import { validateField, isErased } from "./records.js";
import { analyse } from "./sets.js";

export function randomHex(bytes = 8) {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(raw, b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One entry of History: what one action did, who did it (device) and when (at, this
 * phone's Date.now()). `changes` is [{ r, f, before?, after } | { r, created: true }].
 * `lost` is [{ r, f, loser, winner }], filled by sync only.
 */
export function makeGroup({ action, device, at, session, people = [], changes = [], lost = [] }) {
  const group = { id: randomHex(8), at, action, device };
  if (session !== undefined) group.session = session;
  group.people = people;
  group.changes = changes;
  group.lost = lost;
  return group;
}

/**
 * What undoing a group would write: [{ r, f, v }] (newest change first) and how many
 * changes were skipped. Runs against the current records and changes nothing.
 *
 * - A created record gets deleted = true, unless other records now share its set (a merge
 *   or a twin link): then it is skipped, and the merge has to be undone first.
 * - A field whose showing triple still equals `after` gets `before` written back as a new
 *   edit, or null if it had none (false for deleted, which can't be null).
 * - Fields changed since, records that are gone or erased, and values that no longer
 *   validate are skipped and counted. An erase can't be undone.
 * - Undoing a merge removes the merge record only. Values chosen while merging stay.
 */
export function undoWrites(group, records) {
  if (group.action === "erase") return { writes: [], skipped: group.changes.length };
  const a = analyse(records);
  const writes = [];
  const done = new Set();
  let skipped = 0;
  for (let i = group.changes.length - 1; i >= 0; i--) {
    const change = group.changes[i];
    const record = records.get(change.r);
    if (change.erased || !record || isErased(record)) { skipped += 1; continue; }
    if (group.action === "merge" && !change.r.startsWith("m:")) continue;

    let write;
    if (change.created) {
      if (record.kind === "device" || !a.solo(change.r)) { skipped += 1; continue; }
      if (a.isDeleted(change.r)) continue; // already gone
      write = { r: change.r, f: "del", v: true };
    } else {
      const showing = a.triple(change.r, change.f);
      if (!showing || compareTriples(showing, change.after) !== 0) { skipped += 1; continue; }
      // Edits to a merged person go to the canonical record (R4); delete and restore go to each record.
      const root = a.find(change.r);
      const canonical = record.kind === "person" && change.f !== "del" && !isErased(records.get(root)) ? root : change.r;
      write = { r: canonical, f: change.f, v: change.before ? change.before[0] : change.f === "del" ? false : null };
    }
    const checked = validateField(record.kind, write.f, write.v);
    if (!checked.ok) { skipped += 1; continue; }
    const key = `${write.r}|${write.f}`;
    if (done.has(key)) continue;
    done.add(key);
    writes.push({ r: write.r, f: write.f, v: checked.value });
  }
  return { writes, skipped };
}

/**
 * Replace everything a group says about the given record(s) with { r, erased: true }
 * (R11). Groups that don't mention them come back as the same objects.
 */
export function scrubErased(groups, recordIds) {
  const ids = typeof recordIds === "string" ? new Set([recordIds]) : new Set(recordIds);
  return groups.map(group => {
    let touched = false;
    const mark = entry => {
      if (entry.erased || !ids.has(entry.r)) return entry;
      touched = true;
      return { r: entry.r, erased: true };
    };
    const changes = group.changes.map(mark);
    const lost = group.lost.map(mark);
    return touched ? { ...group, changes, lost } : group;
  });
}

/**
 * Keep the newest groups that fit in `maxBytes` of JSON. → { groups, dropped }: History
 * shows "Older history was removed." when dropped > 0 (R10).
 */
export function capHistory(groups, maxBytes) {
  const encoder = new TextEncoder();
  let total = 0;
  let keepFrom = groups.length;
  for (let i = groups.length - 1; i >= 0; i--) {
    const size = encoder.encode(JSON.stringify(groups[i])).length;
    if (total + size > maxBytes) break;
    total += size;
    keepFrom = i;
  }
  return { groups: groups.slice(keepFrom), dropped: keepFrom };
}

/**
 * The history after committing a change: the change's group appended, and every record the
 * change erased scrubbed from all earlier groups. Storage does this in the same transaction
 * as the records (R11), so an erased value is never in History for a moment.
 */
export function commitToHistory(groups, change) {
  const erased = [];
  for (const [id, record] of change.puts) if (isErased(record)) erased.push(id);
  const scrubbed = erased.length ? scrubErased(groups, erased) : groups;
  return change.group ? [...scrubbed, change.group] : scrubbed;
}
