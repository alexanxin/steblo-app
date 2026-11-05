// Hybrid logical clock and triple ordering (reference R2). Pure.
// A time is [ms, counter]; a triple is [value, ms, counter, by].

export const MAX_COUNTER = 65535;

export function compareTimes(a, b) {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}

/** Sorted keys, no spaces. The same value always gives the same text. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  }
  return `{${parts.join(",")}}`;
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Order of two triples: ms, counter, by (as text), then the canonical JSON of
 * the value. A null value sorts lowest. Any two different triples are ordered.
 */
export function compareTriples(a, b) {
  const byTime = compareTimes([a[1], a[2]], [b[1], b[2]]);
  if (byTime) return byTime;
  const byDevice = compareText(a[3], b[3]);
  if (byDevice) return byDevice;
  if (a[0] === null || b[0] === null) return a[0] === b[0] ? 0 : a[0] === null ? -1 : 1;
  return compareText(canonicalJson(a[0]), canonicalJson(b[0]));
}

/**
 * The clock of one device. tick() gives the time for one local action;
 * observe() is called for every accepted triple so the next tick is later.
 */
export function createClock({ now = Date.now, last = [0, 0] } = {}) {
  let ms = last[0];
  let counter = last[1];

  const clock = {
    tick() {
      const wall = now();
      if (wall > ms) {
        ms = wall;
        counter = 0;
      } else if (counter >= MAX_COUNTER) {
        ms += 1;
        counter = 0;
      } else {
        counter += 1;
      }
      return [ms, counter];
    },
    observe(time) {
      if (compareTimes(time, [ms, counter]) > 0) [ms, counter] = time;
    },
    last: () => [ms, counter],
    reset(time) {
      [ms, counter] = time;
    },
  };
  return clock;
}
