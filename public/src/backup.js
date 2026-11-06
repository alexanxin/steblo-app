// Backup file: write, validate in full, restore with a new device ID (reference R13). Pure.
// The file is JSON: { format, version, createdAt, records: [[id, kind, fields]…], meta: {name, thisIsMe, settings}, history }.
// Nothing here touches storage: validateBackup says yes or no for the whole file, and restoreBackup
// builds the state the storage layer then swaps in, in one transaction.
import { isErased, kindOf, validateField, validateRecord, validateTime, MAX_RECORDS } from "./records.js";

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_REPORTED = 50;
const HEX16 = /^[0-9a-f]{16}$/;
const ACTIONS = ["add", "edit", "delete", "restore", "merge", "notsame", "erase", "undo", "sync", "import", "restamp"];
const GROUP_KEYS = new Set(["id", "at", "action", "device", "session", "people", "changes", "lost"]);
const DAY = 86_400_000;

const fail = (code, message) => Object.assign(new Error(message), { code });

/** The file's text. `records` is a Map (or any iterable of [id, record]). Same input, same bytes. */
export function writeBackup({ records, meta, history = [], createdAt }) {
  const list = [...records].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, record]) => [id, record.kind, record.f]);
  return JSON.stringify({
    format: "steblo-backup",
    version: 1,
    createdAt,
    records: list,
    meta: { name: meta.name ?? "", thisIsMe: meta.thisIsMe ?? null, settings: { lang: meta.settings?.lang ?? "en", latin: meta.settings?.latin === true } },
    history,
  });
}

const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isWhole = (v, min = 0) => Number.isSafeInteger(v) && v >= min;

/** A triple [value, ms, counter, by] whose value fits the field of that record. → a reason, or null. */
function tripleProblem(recordId, key, t, now) {
  if (!Array.isArray(t) || t.length !== 4) return "triple";
  const kind = kindOf(recordId);
  if (!kind || typeof key !== "string" || !validateField(kind, key, t[0]).ok) return "value";
  if (typeof t[3] !== "string" || !HEX16.test(t[3]) || !validateTime(t[1], t[2], { now })) return "time";
  return null;
}

function entryProblem(entry, now) {
  if (!isObject(entry) || typeof entry.r !== "string" || kindOf(entry.r) === null) return "record";
  const keys = Object.keys(entry);
  const only = (...allowed) => keys.every(k => allowed.includes(k));
  if (entry.created !== undefined) return entry.created === true && only("r", "created") ? null : "created";
  if (entry.erased !== undefined) return entry.erased === true && only("r", "erased") ? null : "erased";
  if (entry.loser !== undefined || entry.winner !== undefined) {
    return only("r", "f", "loser", "winner") ? tripleProblem(entry.r, entry.f, entry.loser, now) ?? tripleProblem(entry.r, entry.f, entry.winner, now) : "keys";
  }
  if (!only("r", "f", "before", "after")) return "keys";
  return tripleProblem(entry.r, entry.f, entry.after, now) ?? (entry.before === undefined ? null : tripleProblem(entry.r, entry.f, entry.before, now));
}

function groupProblem(group, now) {
  if (!isObject(group)) return "group";
  if (Object.keys(group).some(k => !GROUP_KEYS.has(k))) return "keys";
  if (typeof group.id !== "string" || !HEX16.test(group.id)) return "id";
  if (!isWhole(group.at)) return "at";
  if (!ACTIONS.includes(group.action)) return "action";
  if (typeof group.device !== "string" || !HEX16.test(group.device)) return "device";
  if (group.session !== undefined && (typeof group.session !== "string" || group.session.length > 64)) return "session";
  if (!Array.isArray(group.people) || !group.people.every(id => typeof id === "string" && kindOf(id) !== null)) return "people";
  if (!Array.isArray(group.changes) || !Array.isArray(group.lost)) return "changes";
  for (const [list, name] of [[group.changes, "changes"], [group.lost, "lost"]]) {
    for (let n = 0; n < list.length; n++) {
      const problem = entryProblem(list[n], now);
      if (problem) return `${name}[${n}] ${problem}`;
    }
  }
  return null;
}

function metaProblem(meta) {
  if (!isObject(meta)) return "meta";
  if (typeof meta.name !== "string" || (meta.name !== "" && !validateField("device", "nm", meta.name).ok)) return "meta.name";
  if (meta.thisIsMe !== null && (typeof meta.thisIsMe !== "string" || kindOf(meta.thisIsMe) !== "person")) return "meta.thisIsMe";
  const s = meta.settings;
  if (!isObject(s) || typeof s.lang !== "string" || !/^[a-z]{2,3}$/.test(s.lang) || typeof s.latin !== "boolean") return "meta.settings";
  return null;
}

const byteLength = text => (text.length * 3 <= MAX_BACKUP_BYTES ? text.length * 3 : new TextEncoder().encode(text).length);

/**
 * Check a whole backup file before anything is stored. → { ok: true, valid, errors: [] } or
 * { ok: false, errors: [{ where, reason }], errorCount }. `errors` lists the first 50 problems.
 * `valid` is { createdAt, records: Map, meta, history } for restoreBackup. One bad item refuses the file.
 */
export function validateBackup(text, { now = Date.now() } = {}) {
  const errors = [];
  let errorCount = 0;
  const report = (where, reason) => { errorCount += 1; if (errors.length < MAX_REPORTED) errors.push({ where, reason }); };
  const refuse = () => ({ ok: false, errors, errorCount });

  if (typeof text !== "string") { report("file", "text"); return refuse(); }
  // the size is bytes: a Cyrillic letter is two
  if (text.length > MAX_BACKUP_BYTES || (text.length * 3 > MAX_BACKUP_BYTES && byteLength(text) > MAX_BACKUP_BYTES)) {
    report("file", "size");
    return refuse();
  }
  let file;
  try { file = JSON.parse(text); } catch { report("file", "json"); return refuse(); }
  if (!isObject(file)) { report("file", "format"); return refuse(); }
  if (file.format !== "steblo-backup") report("format", "unknown file type");
  if (file.version !== 1) report("version", "unsupported version");
  if (!isWhole(file.createdAt)) report("createdAt", "invalid");
  const metaWhy = metaProblem(file.meta);
  if (metaWhy) report("meta", metaWhy);
  if (!Array.isArray(file.records)) report("records", "not a list");
  else if (file.records.length > MAX_RECORDS) report("records", "too many");
  if (!Array.isArray(file.history)) report("history", "not a list");
  if (errorCount > 0) return refuse();

  const records = new Map();
  file.records.forEach((entry, n) => {
    const where = `records[${n}]${Array.isArray(entry) && typeof entry[0] === "string" ? ` (${entry[0].slice(0, 40)})` : ""}`;
    if (!Array.isArray(entry) || entry.length !== 3 || typeof entry[0] !== "string" || typeof entry[1] !== "string") return report(where, "not [id, kind, fields]");
    const [id, kind, fields] = entry;
    if (records.has(id)) return report(where, "duplicate");
    if (!isObject(fields)) return report(where, "fields");
    const checked = validateRecord(id, { kind, f: fields }, { now });
    if (!checked.record || checked.rejected.length > 0) {
      const first = checked.rejected[0];
      return report(where, first ? `${first.key ?? "record"}: ${first.reason}` : "invalid");
    }
    // an erased record holds nothing but its erase mark, whatever the file says
    const record = isErased(checked.record) ? { kind, f: { er: checked.record.f.er } } : checked.record;
    records.set(id, record);
  });
  file.history.forEach((group, n) => {
    const why = groupProblem(group, now);
    if (why) report(`history[${n}]`, why);
  });
  if (errorCount > 0) return refuse();

  const meta = { name: file.meta.name, thisIsMe: file.meta.thisIsMe, settings: { lang: file.meta.settings.lang, latin: file.meta.settings.latin } };
  return { ok: true, errors: [], errorCount: 0, valid: { createdAt: file.createdAt, records, meta, history: file.history } };
}

/**
 * The state to store after a restore: the backup's records, plus a new device record for this phone, and
 * `meta` { device, name, last, thisIsMe, settings, lastBackup }. The phone takes `device` (a new ID) so its
 * new edits can never be mistaken for the old phone's. The name is the one now set on this phone, or the
 * backup's. The device record's time is later than everything stored. `valid` is not changed.
 */
export function restoreBackup(valid, { device, name, now = Date.now() } = {}) {
  if (typeof device !== "string" || !HEX16.test(device)) throw fail("setup", "device must be 16 lowercase hex characters");
  const records = new Map(valid.records);
  let last = [0, 0];
  for (const record of records.values()) {
    for (const t of Object.values(record.f)) if (t[1] > last[0] || (t[1] === last[0] && t[2] > last[1])) last = [t[1], t[2]];
  }
  const current = typeof name === "string" && name.trim() !== "" && validateField("device", "nm", name).ok ? validateField("device", "nm", name).value : "";
  const finalName = current || valid.meta.name || "";
  let stamp = last;
  if (finalName) {
    let ms = Math.max(now, last[0]);
    let counter = ms === last[0] ? last[1] + 1 : 0;
    if (counter > 65535) { ms += 1; counter = 0; }
    stamp = [ms, counter];
    records.set(`d:${device}`, { kind: "device", f: { nm: [finalName, ms, counter, device] } });
  }
  return {
    records,
    meta: {
      device, name: finalName, last: stamp, thisIsMe: valid.meta.thisIsMe,
      settings: { ...valid.meta.settings }, lastBackup: valid.createdAt,
    },
    history: valid.history,
  };
}
