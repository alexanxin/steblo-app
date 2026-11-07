// The logic of the sync screens, kept free of the DOM so tests can run it (reference R6, R8, R9).
// Pure: no window, no document, no storage. The screens in ui/sync-screens.js and ui/join-screens.js call these.

const DAY = 86_400_000;

// ---------------------------------------------------------------- the stream (R8)

export const BLOCK = 600; // S: senders use 600-byte blocks
export const FPS = 8; // frames shown per second
export const UNKNOWN_MISS = 0.5; // q until the scanner has seen enough frames to measure it
export const APP_FORMAT = 1; // the hello's `f` this build speaks

/** How many blocks a stream of this many bytes has. */
export const blocksFor = length => Math.ceil(length / BLOCK);

/** Frames a receiver needs, on average, per R8: 1.4 per block below 100 blocks, 1.25 from there. */
export const framesNeeded = k => k * (k < 100 ? 1.4 : 1.25);

/**
 * Seconds to send a stream of `k` blocks when the scanner misses a share `q` of the frames:
 * K × 1.4 ÷ (1 − q) ÷ 8 below 100 blocks, K × 1.25 ÷ (1 − q) ÷ 8 above (R8).
 */
export function estimateSeconds(k, q = UNKNOWN_MISS) {
  const share = Number.isFinite(q) ? Math.min(0.9, Math.max(0, q)) : UNKNOWN_MISS;
  return framesNeeded(k) / (1 - share) / FPS;
}

/** How the estimate is worded: one minute or less reads "about a minute", else whole minutes rounded up. */
export function estimateWords(seconds) {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? { key: "sync.aboutOne", n: 1 } : { key: "sync.about", n: minutes };
}

/**
 * The share of frames the scanner misses, from the frame numbers of one stream it has seen: `distinct` different
 * numbers between `low` and `high`. null until the span is long enough to mean something.
 */
export function missShare({ distinct, low, high }, minSpan = 12) {
  const span = high - low + 1;
  if (!(span >= minSpan) || distinct < 1) return null;
  return Math.min(1, Math.max(0, 1 - distinct / span));
}

/**
 * Time left while scanning, from distinct frames received over the last five seconds (R8).
 * `samples` is [{ t, distinct }] in time order. → { almost: true } | { seconds } | null (not enough to say yet).
 */
export function timeLeft({ k, received, distinct, samples, now }) {
  const left = k - received;
  if (left <= Math.max(2, Math.ceil(k * 0.05))) return { almost: true };
  const recent = samples.filter(s => s.t >= now - 5000);
  const first = recent[0];
  if (!first || now - first.t < 1000) return null;
  const rate = (distinct - first.distinct) / ((now - first.t) / 1000);
  if (!(rate > 0)) return null;
  const remaining = Math.max(left, framesNeeded(k) - distinct);
  return { seconds: remaining / rate };
}

// ---------------------------------------------------------------- reading a hello that isn't ours

/** The `f` a hello claims, even when parseHello refuses it, or null when the bytes aren't a hello at all. */
export function peekFormat(bytes) {
  try {
    const json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return json && typeof json === "object" && Number.isSafeInteger(json.f) ? json.f : null;
  } catch {
    return null;
  }
}

/** What to tell the user about a hello with another `f`: the phone with the lower f is the one that must update. */
export const versionAdvice = theirs => (theirs > APP_FORMAT ? "update" : "askUpdate");

/** Whole days between two phones' clocks, at least 1 (only asked once they differ by more than a day). */
export const clockDays = (a, b) => Math.max(1, Math.round(Math.abs(a - b) / DAY));

// ---------------------------------------------------------------- the flow (R6)

export const FINAL = new Set(["done", "cancelled", "failed"]);

// state → event → next state. Phone A shows first, phone B scans first.
const TABLE = {
  notice: { show: "a.show1", scan: "b.scan1" },
  "a.show1": { scan: "a.scan2" },
  "a.scan2": { got: "a.applied" },
  "a.applied": { join: "a.join", showCode: "a.show3" },
  "a.join": { showCode: "a.show3" },
  "a.show3": { finish: "done" },
  "b.scan1": { got: "b.got" },
  "b.got": { next: "b.show2" },
  "b.show2": { scan: "b.scan3" },
  "b.scan3": { got: "b.applied" },
  "b.applied": { join: "b.join", finish: "done" },
  "b.join": { finish: "done" },
};

// Events that need the camera: a device without one can only show codes (R6 "No camera").
const NEEDS_CAMERA = new Set(["scan"]);

/**
 * What is written to the tree on each transition. Nothing is written until a stream has been decoded whole and
 * checked, and then only these, in this order. Everything else (showing, scanning, cancelling) writes nothing.
 *  - restamp: this phone rewrites its own times that sit more than a day ahead (R5), one History group
 *  - apply: the other phone's data (R5); idempotent, so a repeat sync heals whatever was cut short
 *  - join: each answer, and each batch of automatic merges, as its own transaction (R9)
 */
export const WRITES = {
  "b.scan1:got": ["restamp"],
  "a.scan2:got": ["restamp", "apply"],
  "b.scan3:got": ["apply"],
  "a.applied:join": ["join"],
  "b.applied:join": ["join"],
};

/**
 * One step of the flow. Throws for an event the state doesn't have. `cancel` is allowed everywhere before the end and
 * `fail` too (with a reason); both leave whatever was already written, as R6 says.
 * → the next state.
 */
export function step(state, event, { camera = true } = {}) {
  if (FINAL.has(state)) throw Object.assign(new Error(`the sync is over (${state})`), { code: "state" });
  if (event === "cancel") return "cancelled";
  if (event === "fail") return "failed";
  const next = TABLE[state]?.[event];
  if (!next) throw Object.assign(new Error(`no ${event} from ${state}`), { code: "state" });
  if (NEEDS_CAMERA.has(event) && !camera) throw Object.assign(new Error("this device has no camera"), { code: "camera" });
  return next;
}

/** What the writes on a transition are (empty for any that write nothing). */
export const writesOn = (state, event) => WRITES[`${state}:${event}`] ?? [];

/** Which screens ask for the camera, and which show codes. */
export const SCANNING = new Set(["a.scan2", "b.scan1", "b.scan3"]);
export const SHOWING = new Set(["a.show1", "b.show2", "a.show3"]);

/** Cancel is on every screen until the end. */
export const canCancel = state => !FINAL.has(state);

/** Editing stays locked from the moment a role is chosen until the sync is over. */
export const locksEditing = state => !FINAL.has(state);

// ---------------------------------------------------------------- start points (R9)

/**
 * The IDs a separate group's records have, for rebuilding the "incoming" set after the app was closed:
 * the people's records and the link records that join them to each other. Join from Needs attention and
 * Continue joining treat the group as the new side (R9 Commits).
 */
export function groupRecords(view, ids) {
  const inGroup = new Set(ids);
  const out = new Set();
  for (const id of ids) for (const member of view.people.get(id)?.members ?? []) out.add(member);
  for (const l of view.parentLinks) if (inGroup.has(l.parent) && inGroup.has(l.child)) for (const r of l.ids) out.add(r);
  for (const l of view.partnerLinks) if (inGroup.has(l.a) && inGroup.has(l.b)) for (const r of l.ids) out.add(r);
  return out;
}

/** People of the tree that aren't in `fresh` (an incoming set): who a new group can be joined to. */
export function existingPeople(view, incoming) {
  const out = [];
  for (const [id, person] of view.people) if (!person.members.every(m => incoming.has(m))) out.push(id);
  return out;
}
