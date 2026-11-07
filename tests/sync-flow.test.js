// Task 6.2: the logic behind the sync screens: time estimates, the flow of R6, and the start points of the join.
import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_FORMAT, FINAL, SCANNING, SHOWING, WRITES, blocksFor, canCancel, clockDays, estimateSeconds, estimateWords, existingPeople,
  framesNeeded, groupRecords, locksEditing, missShare, peekFormat, step, timeLeft, versionAdvice, writesOn,
} from "../public/src/sync-flow.js";
import { makeHello } from "../public/src/sync.js";
import { makeTree } from "./fixtures/helpers.js";

// ---------------------------------------------------------------- estimates (R8)

test("the estimate below 100 blocks is K × 1.4 ÷ (1 − q) ÷ 8 seconds", () => {
  assert.equal(estimateSeconds(34, 0.5), 34 * 1.4 / 0.5 / 8);
  assert.equal(estimateSeconds(10, 0), 10 * 1.4 / 8);
});

test("from 100 blocks the estimate uses 1.25 instead of 1.4", () => {
  assert.equal(estimateSeconds(342, 0.5), 342 * 1.25 / 0.5 / 8);
  assert.equal(framesNeeded(99), 99 * 1.4);
  assert.equal(framesNeeded(100), 100 * 1.25);
});

test("q is 0.5 until it is known, and a wild q is kept in range", () => {
  assert.equal(estimateSeconds(40), estimateSeconds(40, 0.5));
  assert.equal(estimateSeconds(40, null), estimateSeconds(40, 0.5));
  assert.equal(estimateSeconds(40, 5), estimateSeconds(40, 0.9));
  assert.equal(estimateSeconds(40, -1), estimateSeconds(40, 0));
});

test("blocks are 600 bytes: a 1,801-byte stream is 4 blocks", () => {
  assert.equal(blocksFor(1), 1);
  assert.equal(blocksFor(600), 1);
  assert.equal(blocksFor(601), 2);
  assert.equal(blocksFor(1801), 4);
});

test("the estimate is worded as a minute or whole minutes rounded up", () => {
  assert.deepEqual(estimateWords(5), { key: "sync.aboutOne", n: 1 });
  assert.deepEqual(estimateWords(60), { key: "sync.aboutOne", n: 1 });
  assert.deepEqual(estimateWords(61), { key: "sync.about", n: 2 });
  assert.deepEqual(estimateWords(190), { key: "sync.about", n: 4 });
});

test("the share of frames missed is measured from the frame numbers seen, once the span is long enough", () => {
  assert.equal(missShare({ distinct: 5, low: 0, high: 5 }), null);
  assert.equal(missShare({ distinct: 6, low: 10, high: 29 }), 1 - 6 / 20);
  assert.equal(missShare({ distinct: 20, low: 0, high: 19 }), 0);
  assert.equal(missShare({ distinct: 0, low: 0, high: 30 }), null);
});

test("time left comes from distinct frames over the last five seconds", () => {
  const k = 200;
  // 20 frames in 4 s = 5 frames/s; needs 250 frames in all, has 100 → 150 more, but 100 blocks are still missing
  const samples = [{ t: 6000, distinct: 80 }, { t: 10000, distinct: 100 }];
  const left = timeLeft({ k, received: 100, distinct: 100, samples, now: 10000 });
  assert.equal(left.seconds, 150 / 5);
});

test("time left says almost done when few blocks remain, and nothing before there is a rate", () => {
  assert.deepEqual(timeLeft({ k: 100, received: 96, distinct: 130, samples: [], now: 9000 }), { almost: true });
  assert.deepEqual(timeLeft({ k: 4, received: 3, distinct: 5, samples: [], now: 9000 }), { almost: true });
  assert.equal(timeLeft({ k: 100, received: 10, distinct: 10, samples: [], now: 9000 }), null);
  assert.equal(timeLeft({ k: 100, received: 10, distinct: 10, samples: [{ t: 8800, distinct: 8 }], now: 9000 }), null);
  // no new frame in five seconds
  assert.equal(timeLeft({ k: 100, received: 10, distinct: 10, samples: [{ t: 4000, distinct: 10 }, { t: 9000, distinct: 10 }], now: 9000 }), null);
});

test("samples older than five seconds are ignored", () => {
  const samples = [{ t: 0, distinct: 0 }, { t: 7000, distinct: 40 }, { t: 12000, distinct: 60 }];
  const left = timeLeft({ k: 200, received: 50, distinct: 60, samples, now: 12000 });
  assert.equal(left.seconds, (250 - 60) / (20 / 5));
});

// ---------------------------------------------------------------- hellos that aren't ours

test("a hello with another format number is recognised, and the lower phone is told to update", () => {
  const enc = obj => new TextEncoder().encode(JSON.stringify(obj));
  assert.equal(peekFormat(enc({ f: 2, app: "9" })), 2);
  assert.equal(versionAdvice(2), "update");
  assert.equal(versionAdvice(0), "askUpdate");
  assert.equal(versionAdvice(APP_FORMAT), "askUpdate");
  assert.equal(peekFormat(enc({ app: "9" })), null);
  assert.equal(peekFormat(new Uint8Array([255, 254, 1])), null);
  assert.equal(peekFormat(enc([1])), null);
});

test("our own hello is format 1", () => {
  const bytes = makeHello({ device: "d000000000000001", app: "x", now: 1, publicKey: new Uint8Array(65), nonce: new Uint8Array(16), hashes: new Uint8Array(1024) });
  assert.equal(peekFormat(bytes), APP_FORMAT);
});

test("clocks are reported in whole days, at least one", () => {
  assert.equal(clockDays(0, 3 * 86_400_000), 3);
  assert.equal(clockDays(3 * 86_400_000, 0), 3);
  assert.equal(clockDays(0, 25 * 3_600_000), 1);
  assert.equal(clockDays(0, 36 * 3_600_000 + 1), 2);
});

// ---------------------------------------------------------------- the flow (R6)

const run = (state, events, opts) => events.reduce((s, e) => step(s, e, opts), state);

test("phone A: show, scan, apply, join, show again, finish", () => {
  assert.equal(run("notice", ["show", "scan", "got", "join", "showCode", "finish"]), "done");
  assert.equal(run("notice", ["show", "scan", "got", "showCode", "finish"]), "done");
});

test("phone B: scan, got it, continue, show, scan, apply, join, finish", () => {
  assert.equal(run("notice", ["scan", "got", "next", "scan", "got", "join", "finish"]), "done");
  assert.equal(run("notice", ["scan", "got", "next", "scan", "got", "finish"]), "done");
});

test("the screens go in the order of the R6 table", () => {
  const a = ["notice"];
  for (const e of ["show", "scan", "got", "showCode"]) a.push(step(a.at(-1), e));
  assert.deepEqual(a, ["notice", "a.show1", "a.scan2", "a.applied", "a.show3"]);
  const b = ["notice"];
  for (const e of ["scan", "got", "next", "scan", "got"]) b.push(step(b.at(-1), e));
  assert.deepEqual(b, ["notice", "b.scan1", "b.got", "b.show2", "b.scan3", "b.applied"]);
});

test("a step can't be skipped or repeated", () => {
  assert.throws(() => step("a.show1", "got"), { code: "state" });
  assert.throws(() => step("a.show1", "showCode"), { code: "state" });
  assert.throws(() => step("b.scan1", "next"), { code: "state" });
  assert.throws(() => step("b.show2", "finish"), { code: "state" });
  assert.throws(() => step("notice", "finish"), { code: "state" });
  assert.throws(() => step("a.show3", "scan"), { code: "state" });
});

test("cancel works on every screen before the end, and nothing works after it", () => {
  const live = ["notice", "a.show1", "a.scan2", "a.applied", "a.join", "a.show3", "b.scan1", "b.got", "b.show2", "b.scan3", "b.applied", "b.join"];
  for (const state of live) {
    assert.ok(canCancel(state), state);
    assert.equal(step(state, "cancel"), "cancelled");
    assert.equal(step(state, "fail"), "failed");
  }
  for (const state of FINAL) {
    assert.equal(canCancel(state), false);
    assert.throws(() => step(state, "cancel"), { code: "state" });
  }
});

test("a device with no camera can show codes but cannot scan", () => {
  assert.equal(step("notice", "show", { camera: false }), "a.show1");
  assert.throws(() => step("notice", "scan", { camera: false }), { code: "camera" });
  assert.throws(() => step("a.show1", "scan", { camera: false }), { code: "camera" });
});

test("editing is locked from the first screen until the sync is over", () => {
  for (const state of ["notice", "a.show1", "b.got", "a.join", "b.applied"]) assert.ok(locksEditing(state), state);
  for (const state of FINAL) assert.equal(locksEditing(state), false);
});

test("scanning screens and showing screens are told apart", () => {
  assert.deepEqual([...SCANNING].sort(), ["a.scan2", "b.scan1", "b.scan3"]);
  assert.deepEqual([...SHOWING].sort(), ["a.show1", "a.show3", "b.show2"]);
});

test("nothing is written before a stream has been read whole: only the decoded transitions and the join write", () => {
  // every transition in the flow, by walking it
  const seen = [];
  const walk = (state, event) => { const next = step(state, event); seen.push([state, event, next]); return next; };
  for (const events of [["show", "scan", "got", "join", "showCode", "finish"], ["scan", "got", "next", "scan", "got", "join", "finish"]]) {
    events.reduce(walk, "notice");
  }
  const writing = seen.filter(([state, event]) => writesOn(state, event).length > 0).map(([state, event]) => `${state}:${event}`).sort();
  assert.deepEqual(writing, ["a.applied:join", "a.scan2:got", "b.applied:join", "b.scan1:got", "b.scan3:got"]);
  // showing a code, tapping Next, Continue, Finish and Cancel never write
  for (const [state, event] of [["a.show1", "scan"], ["b.got", "next"], ["b.show2", "scan"], ["a.show3", "finish"], ["a.scan2", "cancel"], ["b.scan3", "cancel"]]) {
    assert.deepEqual(writesOn(state, event), []);
  }
});

test("the writes of one transition go in a fixed order: re-stamp, then apply", () => {
  assert.deepEqual(WRITES["a.scan2:got"], ["restamp", "apply"]);
  assert.deepEqual(WRITES["b.scan1:got"], ["restamp"]);
  assert.deepEqual(WRITES["b.scan3:got"], ["apply"]);
});

// ---------------------------------------------------------------- start points for a join that starts later

function twoGroups() {
  const h = makeTree({ prefix: "a" });
  const danilo = h.add({ g: "Danilo", s: "Novakov" });
  const teodora = h.addRel(danilo, "partner", { g: "Teodora", s: "Novakova" });
  const miro = h.addRel(danilo, "child", { g: "Miro", s: "Novakov" }, { otherParent: teodora });
  h.advance();
  const gjeko = h.add({ g: "Ѓеко", s: "Чарин" });
  const lea = h.addRel(gjeko, "partner", { g: "Леа", s: "Чарин" });
  return { h, danilo, teodora, miro, gjeko, lea };
}

test("a separate group's records are its people and the links between them, nothing else", () => {
  const { h, danilo, gjeko, lea } = twoGroups();
  const view = h.tree.view();
  const group = view.attention.separate.find(g => g.ids.includes(gjeko) || g.ids.includes(lea));
  assert.ok(group, "the small family is a separate group");
  const records = groupRecords(view, group.ids);
  const expected = new Set([...group.ids.flatMap(id => view.people.get(id).members), ...view.partnerLinks.filter(l => group.ids.includes(l.a)).flatMap(l => l.ids)]);
  assert.deepEqual(records, expected);
  assert.ok(records.size >= 3);
  for (const id of view.people.get(danilo).members) assert.ok(!records.has(id));
});

test("people already in the tree are everyone outside the incoming set", () => {
  const { h, danilo, teodora, miro, gjeko, lea } = twoGroups();
  const view = h.tree.view();
  const incoming = groupRecords(view, [gjeko, lea]);
  assert.deepEqual(existingPeople(view, incoming).sort(), [danilo, miro, teodora].sort());
  assert.deepEqual(existingPeople(view, new Set()).length, 5);
});
