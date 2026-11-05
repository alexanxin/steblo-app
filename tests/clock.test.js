import test from "node:test";
import assert from "node:assert/strict";
import { createClock, compareTimes, compareTriples, canonicalJson } from "../public/src/clock.js";

const BY = "00000000000000aa";

test("tick moves forward when the wall clock stands still", () => {
  const clock = createClock({ now: () => 1000 });
  assert.deepEqual(clock.tick(), [1000, 0]);
  assert.deepEqual(clock.tick(), [1000, 1]);
  assert.deepEqual(clock.last(), [1000, 1]);
});

test("tick keeps moving when the wall clock goes backwards", () => {
  const readings = [2000, 1000];
  const clock = createClock({ now: () => readings.shift() });
  assert.deepEqual(clock.tick(), [2000, 0]);
  assert.deepEqual(clock.tick(), [2000, 1]);
});

test("counter overflow moves to the next millisecond", () => {
  const clock = createClock({ now: () => 5, last: [5, 65535] });
  assert.deepEqual(clock.tick(), [6, 0]);
  assert.deepEqual(clock.tick(), [6, 1]);
});

test("observe makes the next tick later than what was seen", () => {
  const clock = createClock({ now: () => 1000 });
  clock.observe([9000, 7]);
  assert.deepEqual(clock.last(), [9000, 7]);
  const next = clock.tick();
  assert.deepEqual(next, [9000, 8]);
  assert.equal(compareTimes(next, [9000, 7]), 1);
  // seeing something older changes nothing
  clock.observe([10, 3]);
  assert.deepEqual(clock.last(), [9000, 8]);
  // seeing a counter at the limit pushes the next tick into the next millisecond
  clock.observe([9000, 65535]);
  assert.deepEqual(clock.tick(), [9001, 0]);
});

test("reset sets last to exactly the given time, even a lower one", () => {
  const clock = createClock({ now: () => 100, last: [5000, 4] });
  clock.reset([300, 2]);
  assert.deepEqual(clock.last(), [300, 2]);
  assert.deepEqual(clock.tick(), [300, 3]);
});

test("last and the returned times can't be changed from outside", () => {
  const clock = createClock({ now: () => 1000 });
  const t = clock.tick();
  t[0] = 99999;
  clock.last()[1] = 77;
  assert.deepEqual(clock.last(), [1000, 0]);
});

test("triples are ordered by ms, counter, by, then value", () => {
  // ms first
  assert.equal(compareTriples(["z", 1, 9, "ff"], ["a", 2, 0, "00"]), -1);
  assert.equal(compareTriples(["a", 2, 0, "00"], ["z", 1, 9, "ff"]), 1);
  // counter next
  assert.equal(compareTriples(["z", 5, 1, "ff"], ["a", 5, 2, "00"]), -1);
  // by next, as a string
  assert.equal(compareTriples(["z", 5, 1, "0000000000000001"], ["a", 5, 1, "0000000000000002"]), -1);
  assert.equal(compareTriples(["a", 5, 1, "00000000000000ab"], ["z", 5, 1, "00000000000000aa"]), 1);
  // value last, by its canonical JSON
  assert.equal(compareTriples(["a", 5, 1, BY], ["b", 5, 1, BY]), -1);
  assert.equal(compareTriples([{ y: 1931 }, 5, 1, BY], [{ y: 1931 }, 5, 1, BY]), 0);
  assert.equal(compareTriples([{ y: 1932 }, 5, 1, BY], [{ y: 1931 }, 5, 1, BY]), 1);
  // numbers in time compare as numbers, not text
  assert.equal(compareTriples(["a", 9, 0, BY], ["a", 10, 0, BY]), -1);
});

test("any two different triples are ordered the same way round", () => {
  const triples = [
    [null, 1, 0, BY], ["x", 1, 0, BY], [true, 1, 0, BY], [false, 1, 0, BY],
    [{ y: 1 }, 1, 0, BY], [{ y: 1, m: 2 }, 1, 0, BY], [5, 1, 0, BY], ["x", 1, 1, BY],
  ];
  for (const a of triples) {
    for (const b of triples) {
      assert.equal(compareTriples(a, b) + compareTriples(b, a), 0);
      if (a !== b) assert.notEqual(compareTriples(a, b), 0);
    }
  }
});

test("canonicalJson sorts keys", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ b: { d: [1, { z: 1, y: 2 }], c: null }, a: "x y" }), '{"a":"x y","b":{"c":null,"d":[1,{"y":2,"z":1}]}}');
  assert.equal(canonicalJson(null), "null");
  assert.equal(canonicalJson([]), "[]");
  assert.equal(canonicalJson("Ѓеко"), '"Ѓеко"');
});

test("canonicalJson gives the same text whatever order the keys were added in", () => {
  const a = { y: 1931, m: 3, d: 12 };
  const b = {};
  b.d = 12; b.m = 3; b.y = 1931;
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), '{"d":12,"m":3,"y":1931}');
});

test("a null value sorts lowest in compareTriples", () => {
  for (const v of ["", "a", 0, false, true, { y: 1 }, []]) {
    assert.equal(compareTriples([null, 7, 3, BY], [v, 7, 3, BY]), -1, JSON.stringify(v));
    assert.equal(compareTriples([v, 7, 3, BY], [null, 7, 3, BY]), 1, JSON.stringify(v));
  }
  assert.equal(compareTriples([null, 7, 3, BY], [null, 7, 3, BY]), 0);
  // time still decides before the value does
  assert.equal(compareTriples([null, 8, 0, BY], ["a", 7, 3, BY]), 1);
});

test("compareTimes orders by ms then counter", () => {
  assert.equal(compareTimes([1, 5], [2, 0]), -1);
  assert.equal(compareTimes([2, 1], [2, 0]), 1);
  assert.equal(compareTimes([2, 1], [2, 1]), 0);
});
