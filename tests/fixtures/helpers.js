// Shared by the tree tests. Not a test file: the runner only picks up *.test.js.
import { createClock } from "../../public/src/clock.js";
import { createTree } from "../../public/src/tree.js";

export const T0 = 1_700_000_000_000;

/** An ID like "a000000000000007": a letter, then the number padded to 16 characters. */
export const pid = (prefix, n) => prefix + String(n).padStart(15, "0");

/**
 * A tree on a manual wall clock, with predictable new IDs (prefix + 1, 2, 3 …).
 * `adopt` is applied for you by run(); ops that return a change are checked by the tests.
 */
export function makeTree({ device = pid("d", 1), name = "Test phone", records = new Map(), prefix = "a", start = T0, from = 0 } = {}) {
  const wall = { now: start };
  const clock = createClock({ now: () => wall.now });
  let n = from;
  const newId = () => pid(prefix, ++n);
  const tree = createTree({ device, name, records, clock, now: () => wall.now, newId });
  const h = {
    tree, clock, wall, device,
    advance(ms = 1000) { wall.now += ms; },
    /** Adopt a change and hand it back. */
    run(change) { tree.adopt(change); return change; },
    /** Add a person and return their ID. */
    add(fields = {}) {
      const change = h.run(tree.addPerson(fields));
      return [...change.puts.keys()][0];
    },
    /** Add a relative and return the new person's ID (the first record put that is a person). */
    addRel(id, relation, fields = {}, opts) {
      const before = new Set(tree.records().keys());
      const change = h.run(tree.addRelative(id, relation, fields, opts));
      return [...change.puts.keys()].filter(r => !before.has(r) && /^[0-9a-f]{16}$/.test(r))[0];
    },
    get(id) { return tree.records().get(id); },
    value(id, key) { return tree.records().get(id)?.f[key]?.[0]; },
  };
  return h;
}

/** A copy of a tree's records, for building a second device that knows the same people. */
export const copyRecords = records => new Map([...records].map(([id, record]) => [id, { kind: record.kind, f: { ...record.f } }]));
