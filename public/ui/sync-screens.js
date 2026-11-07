// The sync flow, screen by screen (reference R6). Phone A shows first, phone B scans first:
//   A: hello  →  scan B's hello + data (apply, join)  →  show its changes
//   B: scan A's hello (re-stamp)  →  show hello + data  →  scan A's changes (apply)
// Nothing is written until a stream has been decoded whole and checked (see WRITES in sync-flow.js). Cancel is on every
// screen and never undoes what was applied: applying is idempotent, so a repeat sync heals whatever was cut short.
import {
  applyPayload, bucketHashes, buildDiff, buildPayload, clocksAgree, differingBuckets, makeHello, makeStep2,
  packPayload, parseHello, readStep2, restamp, unpackPayload,
} from "../src/sync.js";
import { deriveKey, newSession, open, seal, shortCode } from "../src/envelope.js";
import { startPoints } from "../src/join.js";
import {
  APP_FORMAT, FINAL, blocksFor, clockDays, estimateSeconds, estimateWords, peekFormat, step, timeLeft, versionAdvice,
} from "../src/sync-flow.js";
import { hasCamera, startScanner } from "./scanner.js";
import { showStream } from "./display.js";
import { h } from "./dom.js";

const APP_VERSION = "0.6";

export function createSync(ctx, overlay, join) {
  const { t } = ctx;
  let run = null;

  const btn = (label, onClick, cls = "", extra = {}) => h("button", { class: `btn-ghost ${cls}`.trim(), type: "button", on: { click: onClick }, ...extra }, label);
  const note = text => h("p", { class: "note" }, text);
  const ask = text => h("p", { class: "ask" }, text);
  const alive = me => run === me && me.alive;

  /** The name of the other phone if this tree has met it before, else a plain description. */
  function otherName(deviceId) {
    const nm = deviceId ? ctx.tree.records().get(`d:${deviceId}`)?.f.nm?.[0] : null;
    return nm ? ctx.text(nm) : t("sync.otherPhone");
  }
  /** "the phone of Adam", or "the other phone" when this tree has never met it. */
  function phoneOf(deviceId) {
    const nm = deviceId ? ctx.tree.records().get(`d:${deviceId}`)?.f.nm?.[0] : null;
    return nm ? t("sync.phoneOf", { name: ctx.text(nm) }) : t("sync.theOtherPhone");
  }
  const daysText = n => (n === 1 ? t("sync.dayOne") : t("sync.days", { n }));
  const dateOf = ms => new Date(ms).toLocaleString(ctx.i18n.lang === "mk" ? "mk" : undefined, { dateStyle: "medium", timeStyle: "short" });
  const wordsOf = seconds => { const w = estimateWords(seconds); return t(w.key, { n: w.n }); };

  // ---------------------------------------------------------------- bookkeeping

  /** Stop whatever is using the camera or the screen. */
  function stopMedia() {
    for (const stop of run?.stoppers.splice(0) ?? []) { try { stop(); } catch { /* already stopped */ } }
  }

  function go(event) {
    run.state = step(run.state, event, { camera: run.camera });
  }

  function finishRun() {
    stopMedia();
    run.alive = false;
    run = null;
    overlay.hide();
    ctx.lock(false);
  }

  /** Cancel, from any screen. Whatever was applied stays. */
  function cancel() {
    if (!run) return;
    join.abort();
    if (FINAL.has(run.state)) { finishRun(); return; }
    run.state = step(run.state, "cancel");
    const wrote = run.wrote;
    finishRun();
    ctx.notify(wrote ? t("sync.cancelledKept") : t("sync.cancelled"));
  }

  /** A final screen with only a Close button. */
  function ending(title, body, extra = []) {
    stopMedia();
    overlay.show({ title, body, foot: [...extra, btn(t("common.close"), () => finishRun(), "primary")] });
  }

  /** The state after a problem: the sync is over, whatever was written stays. */
  function markFailed() {
    if (!FINAL.has(run.state)) run.state = step(run.state, "fail");
  }

  function failed(kind) {
    if (!run) return;
    join.abort();
    markFailed();
    stopMedia();
    const text = {
      update: t("sync.update"),
      askUpdate: t("sync.askUpdate"),
      unreadable: t("sync.unreadable"),
      save: t("save.failed"),
      same: t("sync.samePhone"),
    }[kind] ?? t("error.generic");
    ending(t("sync.stopped"), [ask(text), note(t("sync.stoppedHelp"))]);
  }

  // ---------------------------------------------------------------- shared pieces

  function qrScreen({ title, lines, stream, code = null, onNext = null, nextLabel = null, extra = [] }) {
    const canvas = h("canvas", { class: "sync-qr", width: 10, height: 10, "aria-label": t("sync.codeAlt") });
    const awakeNote = h("p", { class: "note warn", hidden: true });
    const display = showStream({ canvas, bytes: stream });
    run.stoppers.push(() => display.stop());
    const me = run;
    display.awake.then(a => {
      if (alive(me) && !a.ok) { awakeNote.textContent = t("sync.keepAwake"); awakeNote.hidden = false; }
    });
    overlay.show({
      title,
      body: [code ? h("div", { class: "sync-code", "aria-live": "polite" }, code) : null, h("div", { class: "sync-qr-wrap" }, canvas), ...lines.map(l => (typeof l === "string" ? note(l) : l)), awakeNote, ...extra],
      foot: onNext ? [btn(nextLabel, onNext, "primary")] : [],
      onCancel: cancel,
    });
  }

  /** The camera, with progress and time left. `onDone(bytes)` runs once when the stream is whole. */
  async function scanScreen({ title, hint, onDone, ready = null }) {
    const me = run;
    const video = h("video", { class: "sync-video", playsinline: "", muted: "" });
    const bar = h("span", { class: "sync-bar-fill" });
    const status = h("p", { class: "sync-status", "aria-live": "polite" }, t("sync.waitingForCode"));
    const left = h("p", { class: "note" });
    overlay.show({
      title,
      body: [h("div", { class: "sync-video-wrap" }, video), h("div", { class: "sync-bar" }, bar), status, left, note(hint)],
      onCancel: cancel,
    });
    let scanner = null;
    const onProgress = ({ received, total, distinct, q, samples, now }) => {
      if (!alive(me)) return;
      if (q !== null) me.q = q;
      bar.style.width = `${total ? Math.round((received / total) * 100) : 0}%`;
      status.textContent = t("sync.progress", { got: received, total });
      const l = timeLeft({ k: total, received, distinct, samples, now });
      left.textContent = !l ? "" : l.almost ? t("sync.almostDone") : t("sync.timeLeft", { time: wordsOf(l.seconds) });
    };
    try {
      scanner = await startScanner({ video, onProgress, onDone: bytes => { if (alive(me)) onDone(bytes); } });
      if (!alive(me)) { scanner.stop(); return; }
      me.stoppers.push(scanner.stop);
      ready?.(scanner);
    } catch (err) {
      if (!alive(me)) return;
      cameraProblem(err.code, () => scanScreen({ title, hint, onDone, ready }));
    }
  }

  function cameraProblem(kind, retry) {
    stopMedia();
    overlay.show({
      title: t("sync.cameraTitle"),
      body: [ask(kind === "denied" ? t("sync.cameraDenied") : kind === "nocamera" ? t("sync.cameraNone") : t("sync.cameraFailed"))],
      foot: kind === "nocamera" ? [] : [btn(t("sync.tryAgain"), retry, "primary")],
      onCancel: cancel,
    });
  }

  /** Counts of what came in, as a list. */
  function summaryList(summary) {
    const lines = [
      t("sync.newPeople", { n: summary.newPeople }),
      t("sync.changedFields", { n: summary.changedFields }),
      summary.lost ? t("sync.lost", { n: summary.lost }) : null,
      summary.rejected.clock + summary.rejected.invalid ? t("sync.rejected", { n: summary.rejected.clock + summary.rejected.invalid }) : null,
    ].filter(Boolean);
    return h("ul", { class: "problems" }, ...lines.map(l => h("li", null, l)));
  }

  /** Applying that erases people asks first (R5). Resolves to the result to store. */
  async function applyAsking(payload, helloW) {
    const opts = { now: Date.now(), helloW };
    let applied = applyPayload(ctx.tree, payload, { ...opts, allowErase: false });
    if (applied.erases.length === 0) return applied;
    // two merged records of one person are one person on the screen
    const people = [...new Set(applied.erases.map(id => ctx.view.merged.get(id) ?? id))].filter(id => ctx.view.people.has(id));
    const names = people.slice(0, 12).map(id => ctx.label(id));
    const more = people.length - names.length;
    const me = run;
    const yes = await new Promise(resolve => {
      overlay.show({
        title: t("sync.eraseTitle"),
        body: [ask(t("sync.erases", { n: people.length })), h("ul", { class: "problems" }, ...names.map(n => h("li", null, n)), more > 0 ? h("li", null, t("sync.andMore", { n: more })) : null), note(t("sync.eraseHelp"))],
        foot: [btn(t("common.continue"), () => resolve(true), "danger"), btn(t("sync.notNow"), () => resolve(false))],
        onCancel: () => { resolve(null); cancel(); },
      });
    });
    if (yes === null || !alive(me)) return null;
    if (yes) applied = applyPayload(ctx.tree, payload, { ...opts, allowErase: true });
    return applied;
  }

  /** Store a re-stamp or an apply. False (and a stopped sync) if the phone could not save it. */
  async function write(change) {
    const me = run;
    const ok = await ctx.act(change, { internal: true });
    if (!alive(me)) return false;
    if (!ok) { failed("save"); return false; }
    me.wrote = true;
    return true;
  }

  // ---------------------------------------------------------------- the first screen

  function notice() {
    const lines = [ask(t("sync.notice")), note(t("sync.noticeLock"))];
    if (!run.camera) lines.push(note(t("sync.cameraNone")));
    overlay.show({
      title: t("sync.title"),
      body: lines,
      foot: [
        btn(t("sync.showFirst"), () => { go("show"); aShow1(); }, "primary"),
        btn(t("sync.scanFirst"), () => { go("scan"); bScan1(); }, "", { disabled: !run.camera }),
      ],
      onCancel: cancel,
    });
  }

  // ---------------------------------------------------------------- phone A

  async function aShow1() {
    const me = run;
    const session = await newSession();
    const bytes = makeHello({
      device: ctx.meta.device, app: APP_VERSION, now: Date.now(), publicKey: session.publicKey, nonce: session.nonce,
      hashes: await bucketHashes(ctx.tree.records()),
    });
    const code = await shortCode(bytes);
    if (!alive(me)) return;
    me.A = { session, bytes, hello: parseHello(bytes), code };
    qrScreen({
      title: t("sync.showTitle"),
      stream: bytes,
      code,
      lines: [ask(t("sync.aShow1", { name: t("sync.otherPhone") })), ...(me.camera ? [] : [note(t("sync.cameraNone"))])],
      onNext: me.camera ? () => { stopMedia(); go("scan"); aScan2(); } : null,
      nextLabel: t("sync.nextScan"),
    });
  }

  function aScan2() {
    scanScreen({ title: t("sync.scanTitle"), hint: t("sync.aScan2"), onDone: bytes => aApply(bytes) });
  }

  /** Version, clocks, re-stamp, decrypt, apply: the first writes of phone A. */
  async function aApply(bytes) {
    const me = run;
    const read = readStep2(bytes);
    if (!read) { failed("unreadable"); return; }
    const heardB = parseHello(read.helloBytes);
    if (!heardB) { checkVersion(read.helloBytes); return; }
    if (heardB.d === ctx.meta.device) { failed("same"); return; }
    if (read.message === null || !clocksAgree(me.A.hello, heardB)) { clockScreen(me.A.hello.w, heardB.w, null); return; }
    me.B = { hello: heardB };

    overlay.show({ title: t("sync.gotIt"), body: [note(t("sync.working"))], onCancel: cancel });
    const stamp = restamp(ctx.tree, Date.now());
    if (stamp && !(await write(stamp))) return;
    let payload;
    try {
      const key = await deriveKey(me.A.session, heardB.k, me.A.session.nonce, heardB.n);
      me.A.key = key;
      payload = await unpackPayload(await open(key, 2, me.A.bytes, read.helloBytes, read.message));
    } catch {
      if (alive(me)) failed("unreadable");
      return;
    }
    if (!alive(me)) return;
    me.A.payload = payload;
    me.A.helloB = read.helloBytes;
    const applied = await applyAsking(payload, heardB.w);
    if (!applied || !alive(me)) return;
    if (!(await write(applied.change))) return;
    me.applied = applied;
    me.summary = applied.summary;
    go("got");
    aApplied(false);
  }

  /** "Got it" with what came in; the join runs from here when there is something to join. */
  function aApplied(joined) {
    const me = run;
    const points = joined ? { newGroups: [], gainedRelatives: [] } : startPoints(ctx.tree.view(), me.applied.incoming);
    const needsJoin = points.newGroups.length > 0 || points.gainedRelatives.length > 0;
    overlay.show({
      title: t("sync.gotIt"),
      body: [ask(t("sync.cameIn", { name: otherName(me.B.hello.d) })), summaryList(me.summary), needsJoin ? note(t("sync.joinNext")) : null],
      foot: needsJoin
        ? [btn(t("sync.joinGo"), async () => {
          go("join");
          const result = await join.run({ incoming: me.applied.incoming, newGroups: points.newGroups, gainedRelatives: points.gainedRelatives, mode: "sync", onCancel: cancel });
          if (!alive(me)) return;
          if (result.failed) { failed("save"); return; }
          aApplied(true);
        }, "primary")]
        : [btn(t("sync.showMyCode"), () => aShow3(), "primary")],
      onCancel: cancel,
    });
  }

  async function aShow3() {
    const me = run;
    go("showCode");
    overlay.show({ title: t("sync.showTitle"), body: [note(t("sync.working"))], onCancel: cancel });
    // after the join, so the merges and the answers travel with it
    const packed = await packPayload(buildDiff(ctx.tree.records(), me.A.payload, me.A.payload.b));
    const sealed = await seal(me.A.key, 3, me.A.bytes, me.A.helloB, packed);
    if (!alive(me)) return;
    const seconds = estimateSeconds(blocksFor(sealed.length), me.q ?? undefined);
    qrScreen({
      title: t("sync.showTitle"),
      stream: sealed,
      lines: [note(wordsOf(seconds)), ask(t("sync.aShow3", { phone: phoneOf(me.B.hello.d) }))],
      onNext: () => { go("finish"); aDone(); },
      nextLabel: t("sync.finish"),
    });
  }

  function aDone() {
    const me = run;
    ending(t("sync.doneTitle"), [ask(t("sync.doneText")), summaryList(me.summary)]);
  }

  // ---------------------------------------------------------------- phone B

  function bScan1() {
    scanScreen({ title: t("sync.scanTitle"), hint: t("sync.bScan1"), onDone: bytes => bGot(bytes) });
  }

  /** Version, clocks, re-stamp, then B's own hello and data, ready to show after Continue. */
  async function bGot(bytes) {
    const me = run;
    const heardA = parseHello(bytes);
    if (!heardA) { checkVersion(bytes); return; }
    if (heardA.d === ctx.meta.device) { failed("same"); return; }
    const session = await newSession();
    const clockNow = Date.now();
    if (!clocksAgree({ w: clockNow }, heardA)) {
      // A hello-only stream: nothing is sent, and A shows the same message when it scans this (R5)
      const hashes = await bucketHashes(ctx.tree.records());
      const helloB = makeHello({ device: ctx.meta.device, app: APP_VERSION, now: clockNow, publicKey: session.publicKey, nonce: session.nonce, hashes });
      if (alive(me)) clockScreen(clockNow, heardA.w, makeStep2(helloB, null));
      return;
    }
    overlay.show({ title: t("sync.gotIt"), body: [note(t("sync.working"))], onCancel: cancel });
    const stamp = restamp(ctx.tree, Date.now());
    if (stamp && !(await write(stamp))) return;
    const hashes = await bucketHashes(ctx.tree.records());
    const helloBytes = makeHello({ device: ctx.meta.device, app: APP_VERSION, now: Date.now(), publicKey: session.publicKey, nonce: session.nonce, hashes });
    const buckets = differingBuckets(hashes, heardA);
    const key = await deriveKey(session, heardA.k, heardA.n, session.nonce);
    const sealed = await seal(key, 2, heardA.bytes, helloBytes, await packPayload(buildPayload(ctx.tree.records(), buckets)));
    const stream = makeStep2(helloBytes, sealed);
    const code = await shortCode(heardA.bytes);
    if (!alive(me)) return;
    me.B = { session, key, helloBytes, heardA, stream };
    const seconds = estimateSeconds(blocksFor(stream.length), me.q ?? undefined);
    go("got");
    overlay.show({
      title: t("sync.gotIt"),
      body: [h("div", { class: "sync-code" }, code), ask(t("sync.checkCode", { code })), note(wordsOf(seconds))],
      foot: [btn(t("common.continue"), () => { go("next"); bShow2(); }, "primary")],
      onCancel: cancel,
    });
  }

  function bShow2() {
    const me = run;
    qrScreen({
      title: t("sync.showTitle"),
      stream: me.B.stream,
      lines: [ask(t("sync.bShow2", { name: otherName(me.B.heardA.d) }))],
      onNext: () => { stopMedia(); go("scan"); bScan3(); },
      nextLabel: t("sync.nextScan"),
    });
  }

  function bScan3() {
    scanScreen({ title: t("sync.scanTitle"), hint: t("sync.bScan3"), onDone: bytes => bApply(bytes) });
  }

  async function bApply(bytes) {
    const me = run;
    let payload;
    try {
      payload = await unpackPayload(await open(me.B.key, 3, me.B.heardA.bytes, me.B.helloBytes, bytes));
    } catch {
      if (alive(me)) failed("unreadable");
      return;
    }
    if (!alive(me)) return;
    const applied = await applyAsking(payload, me.B.heardA.w);
    if (!applied || !alive(me)) return;
    if (!(await write(applied.change))) return;
    me.applied = applied;
    me.summary = applied.summary;
    go("got");
    bDone(false);
  }

  /** "Done ✓" and the summary. B is offered a join for the new groups only, never for relatives gained (R9). */
  function bDone(joined) {
    const me = run;
    const groups = joined ? [] : startPoints(ctx.tree.view(), me.applied.incoming).newGroups;
    overlay.show({
      title: t("sync.doneTitle"),
      body: [ask(t("sync.doneText")), summaryList(me.summary), groups.length ? note(t("sync.joinNextB")) : null],
      foot: [
        groups.length ? btn(t("sync.joinGo"), async () => {
          go("join");
          const result = await join.run({ incoming: me.applied.incoming, newGroups: groups, gainedRelatives: [], mode: "sync", onCancel: cancel });
          if (!alive(me)) return;
          if (result.failed) { failed("save"); return; }
          bDone(true);
        }, "primary") : null,
        btn(t("common.close"), () => { go("finish"); finishRun(); ctx.notify(t("sync.finishedNote")); }, groups.length ? "" : "primary"),
      ],
      onCancel: groups.length ? cancel : null,
    });
  }

  // ---------------------------------------------------------------- problems

  function checkVersion(helloBytes) {
    const theirs = peekFormat(helloBytes);
    if (theirs !== null && theirs !== APP_FORMAT) failed(versionAdvice(theirs));
    else failed("unreadable");
  }

  /** "The two phones' clocks differ by N days…" with both dates. B also shows the hello-only stream. */
  function clockScreen(mine, theirs, stream) {
    const me = run;
    markFailed();
    const days = clockDays(mine, theirs);
    const body = [ask(t("sync.clocks", { days: daysText(days) })), h("p", { class: "note" }, t("sync.clockDates", { mine: dateOf(mine), theirs: dateOf(theirs) }))];
    if (stream) {
      const canvas = h("canvas", { class: "sync-qr", width: 10, height: 10, "aria-label": t("sync.codeAlt") });
      const display = showStream({ canvas, bytes: stream });
      me.stoppers.push(() => display.stop());
      body.unshift(h("div", { class: "sync-qr-wrap" }, canvas));
      body.push(note(t("sync.clocksShow")));
    }
    overlay.show({ title: t("sync.stopped"), body, foot: [btn(t("common.close"), () => finishRun(), "primary")] });
  }

  // ---------------------------------------------------------------- start

  async function start() {
    if (run) return;
    const me = { id: Math.random(), state: "notice", alive: true, stoppers: [], camera: true, wrote: false, q: null };
    run = me;
    ctx.lock(true);
    me.camera = await hasCamera();
    if (alive(me)) notice();
  }

  return { start, cancel, get running() { return !!run; } };
}
