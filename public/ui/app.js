// The app shell: opens storage, builds the tree, draws it, and wires the screens.
// The write contract (R14): an operation returns a pending change; storage commits it; only then does the
// tree adopt it and the screen redraw from view(). Nothing reloads the page.
import { openStorage } from "./storage.js";
import { createI18n, guessLanguage } from "./i18n.js";
import { createClock } from "../src/clock.js";
import { createTree } from "../src/tree.js";
import { commitToHistory } from "../src/history.js";
import { layoutForest, layoutHourglass, spousesOf } from "../src/layout.js";
import { searchPeople } from "../src/search.js";
import { detectPlatform } from "../src/platform.js";
import { personInfo, fullName, label, lifespan, dateText } from "./people.js";
import { createCanvas } from "./render.js";
import { createForms } from "./forms.js";
import { createScreens } from "./screens.js";
import { runStart } from "./start.js";
import { h, svg, $, $$, clear } from "./dom.js";

const MAX_DEPTH = 8;
const DAY = 86_400_000;

// ---------- small per-viewer preferences (a remembered tab, never data)
const pref = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`steblo.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`steblo.${key}`, JSON.stringify(value)); } catch { /* private window: fine */ }
  },
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const el = {
  canvas: $("#canvas"), world: $("#world"), ruler: $("#ruler"), tags: $("#tags"), panel: $("#panel"),
  panelBody: $("#panel-body"), status: $("#status"), banner: $("#banner"), ctx: $("#ctx"), gate: $("#gate"),
  sheet: $("#sheet"), sheetTitle: $("#sheet-title"), sheetBody: $("#sheet-body"), sheetFoot: $("#sheet-foot"),
  top: $("#top"), bottom: $("#bottom"), search: $("#search"), results: $("#results"),
};

const S = {
  storage: null, tree: null, meta: null, history: [], historyDropped: false, i18n: null,
  mode: pref.get("mode", "both"), up: clamp(pref.get("up", 3), 0, MAX_DEPTH), down: clamp(pref.get("down", 2), 0, MAX_DEPTH),
  focus: null, panelOpen: pref.get("panelOpen", true), canvas: null, sheetClose: null, dismissedBackup: false,
  platform: detectPlatform({
    userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
    standaloneMedia: window.matchMedia("(display-mode: standalone)").matches, navigatorStandalone: navigator.standalone,
  }),
  installPrompt: null,
};
if (!["all", "both", "up", "down"].includes(S.mode)) S.mode = "both";
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installPrompt = e; });

// ---------- the context every screen gets
const ctx = {
  get i18n() { return S.i18n; },
  t: (key, vars) => S.i18n.t(key, vars),
  text: s => S.i18n.text(s),
  get tree() { return S.tree; },
  get view() { return S.tree.view(); },
  get meta() { return S.meta; },
  get history() { return S.history; },
  get historyDropped() { return S.historyDropped; },
  get storage() { return S.storage; },
  get platform() { return S.platform; },
  get installPrompt() { return S.installPrompt; },
  get focus() { return S.focus; },
  get lastRedraw() { return { ms: S.lastRedrawMs, people: S.lastRedrawPeople }; },
  el,
  act,
  redraw,
  show,
  openSheet,
  closeSheet,
  notify,
  setSettings,
  openMenu: (id, at) => forms.openMenu(id, at),
  info: id => personInfo(ctx, id),
  name: id => fullName(ctx, id),
  label: id => label(ctx, id),
  dateText: date => dateText(ctx, date),
  lifespan,
  /** Replace the whole state after a restore (storage.restore has already succeeded). */
  async adoptState(state) { await begin(state); },
  /** The tree is shown for the first time: persistent storage, hash route. */
  askPersistence,
  pref,
  attentionCount,
  daysSinceBackup: () => (S.meta.lastBackup ? Math.floor((Date.now() - S.meta.lastBackup) / DAY) : null),
};
const forms = createForms(ctx);
const screens = createScreens(ctx, forms);
ctx.screens = screens;
ctx.forms = forms;

// ---------- messages
let bannerTimer = 0;
function notify(message, { kind = "info", action = null, sticky = false } = {}) {
  clearTimeout(bannerTimer);
  clear(el.banner);
  el.banner.className = `banner banner-${kind}`;
  el.banner.append(h("span", null, message));
  if (action) el.banner.append(h("button", { class: "banner-btn", type: "button", on: { click: () => { el.banner.hidden = true; action.run(); } } }, action.label));
  el.banner.append(h("button", { class: "banner-btn quiet", type: "button", "aria-label": ctx.t("common.close"), on: { click: () => { el.banner.hidden = true; } } }, "×"));
  el.banner.hidden = false;
  if (!sticky) bannerTimer = setTimeout(() => { el.banner.hidden = true; }, 6000);
}

// ---------- sheets
function openSheet({ title, body, foot = [], onClose = null }) {
  closeSheet(false);
  el.sheetTitle.textContent = title;
  el.sheetBody.replaceChildren(...[body].flat().filter(Boolean));
  el.sheetFoot.replaceChildren(...foot.filter(Boolean));
  el.sheetFoot.hidden = foot.length === 0;
  el.sheet.hidden = false;
  S.sheetClose = onClose;
  el.sheetBody.scrollTop = 0;
  const first = el.sheetBody.querySelector("input:not([type=hidden]), select, textarea, button");
  first?.focus({ preventScroll: true });
}
function closeSheet(callback = true) {
  if (el.sheet.hidden) return;
  el.sheet.hidden = true;
  const fn = S.sheetClose;
  S.sheetClose = null;
  if (callback && fn) fn();
}
$("#sheet-close").addEventListener("click", () => closeSheet());
$("#sheet-back").addEventListener("click", () => closeSheet());

// ---------- committing a change
function saveFailed(err) {
  const code = err?.code;
  notify(code === "quota" ? ctx.t("save.quota") : ctx.t("save.failed"), { kind: "error", sticky: true });
}

/** Commit a pending change, then adopt it and redraw. Resolves to true if it was saved (or there was nothing to save). */
async function act(change) {
  if (!change) return true;
  const hasMeta = change.meta && Object.keys(change.meta).length > 0;
  if (change.puts.size === 0 && !change.group && !hasMeta) return true;
  try {
    await S.storage.commit(change);
  } catch (err) {
    saveFailed(err);
    return false;
  }
  S.tree.adopt(change);
  S.history = commitToHistory(S.history, change);
  if (hasMeta) for (const key of ["device", "name", "thisIsMe", "settings", "lastBackup"]) if (change.meta[key] !== undefined) S.meta[key] = change.meta[key];
  redraw();
  if (S.tree.view().people.size > 0) askPersistence();
  return true;
}

let persistenceAsked = false;
async function askPersistence() {
  if (persistenceAsked || !navigator.storage?.persist) return;
  persistenceAsked = true;
  try { S.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch { S.persisted = false; }
}
ctx.persisted = async () => {
  try { return (await navigator.storage?.persisted?.()) ?? null; } catch { return null; }
};

async function setSettings({ lang, latin }) {
  const next = { lang: lang ?? S.i18n.lang, latin: latin ?? S.i18n.latin };
  await S.i18n.set(next);
  S.i18n.apply();
  syncControls();
  if (S.tree) {
    await act({ puts: new Map(), group: null, meta: { settings: next } });
    S.meta.settings = next;
  } else {
    S.meta = { ...(S.meta || {}), settings: next };
  }
  if (S.tree) { redraw(); renderPanel(); renderStatus(); }
}

// ---------- which person is shown
function resolveFocus() {
  const view = S.tree.view();
  if (S.focus) {
    const id = view.merged.get(S.focus) ?? S.focus;
    if (view.people.has(id)) return id;
  }
  return null;
}

function defaultHome() {
  const view = S.tree.view();
  const me = S.meta.thisIsMe ? (view.merged.get(S.meta.thisIsMe) ?? S.meta.thisIsMe) : null;
  if (me && view.people.has(me)) return me;
  let best = null;
  for (const id of view.people.keys()) if (best === null || id < best) best = id;
  return best;
}

// ---------- drawing
function infoFor(id) {
  const tag = (() => {
    const p = personInfo(ctx, id);
    return (p.surname || p.given).toUpperCase();
  })();
  const spouses = spousesOf(S.tree.view(), id).map(s => fullName(ctx, s));
  return { ...personInfo(ctx, id), tag, spouse: spouses.length ? spouses[0] + (spouses.length > 1 ? ` +${spouses.length - 1}` : "") : "" };
}

function makeLayout() {
  const view = S.tree.view();
  if (S.mode === "all") return layoutForest(view);
  const focus = S.focus;
  return layoutHourglass(view, focus, { up: S.mode === "down" ? 0 : S.up, down: S.mode === "up" ? 0 : S.down });
}

let drawn = false;
function redraw() {
  if (!S.tree) return;
  const started = performance.now(); // view() and the layout together: the number task 5.7 measures on phones
  const view = S.tree.view();
  S.focus = resolveFocus() ?? (S.mode === "all" ? null : defaultHome());
  const layout = makeLayout();
  S.canvas.draw({ layout, mode: S.mode, focus: S.focus, info: infoFor });
  S.lastRedrawMs = performance.now() - started;
  S.lastRedrawPeople = view.people.size;
  if (!drawn || (!S.canvas.touched && layout.nodes.length > 0)) {
    drawn = layout.nodes.length > 0;
    if (S.mode === "all") S.canvas.fit(false);
    else S.canvas.centerOn(S.focus, false);
  }
  renderPanel();
  renderStatus();
  const wasHidden = el.top.hidden;
  el.top.hidden = el.bottom.hidden = false;
  if (wasHidden) syncControls();
  const badge = $("#menu-badge");
  const attention = attentionCount(view);
  badge.hidden = attention === 0;
  badge.textContent = String(attention);
  maybeBackupBanner();
}

function attentionCount(view) {
  const a = view.attention;
  return a.manyParents.length + a.loops.length + a.partlyErased.length + a.separate.length;
}

function renderStatus() {
  const view = S.tree.view();
  const shown = new Set(S.canvas.layout.nodes.map(n => n.id)).size;
  const num = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const parts = [h("span", { class: "dot" }), h("span", null, h("b", null, num(shown)), ` ${ctx.t("status.shown")}`), h("span", { class: "sep" }), h("span", null, `${num(view.people.size)} ${ctx.t("status.people")}`)];
  if (S.mode === "all") parts.push(h("span", { class: "sep" }), h("span", null, `${S.canvas.layout.lineages.length} ${ctx.t("status.lines")}`));
  if (S.storage.editingLocked) parts.push(h("span", { class: "sep" }), h("span", { class: "w" }, ctx.t("status.locked")));
  el.status.replaceChildren(...parts);
}

function maybeBackupBanner() {
  if (S.dismissedBackup || !S.meta) return;
  const groups = S.history;
  if (groups.length === 0) return;
  const since = S.meta.lastBackup ?? groups[0].at;
  if (Date.now() - since < 30 * DAY || !groups.some(g => g.at > since)) return;
  S.dismissedBackup = true;
  const days = Math.floor((Date.now() - since) / DAY);
  notify(S.meta.lastBackup ? ctx.t("backup.reminder", { days }) : ctx.t("backup.never"), { sticky: true, action: { label: ctx.t("backup.save"), run: () => screens.backup() } });
}

// ---------- the panel: one person, or the tree as a whole
function chip(id, extra = "") {
  const info = personInfo(ctx, id);
  return h("button", { class: "pchip", type: "button", data: { go: id }, on: { click: () => show(id) } }, `${info.given} ${info.surname}`.trim(), info.span ? h("span", { class: "y" }, info.span) : null, extra);
}

function renderPanel() {
  const view = S.tree.view();
  el.panel.hidden = false;
  el.panel.classList.toggle("is-collapsed", !S.panelOpen);
  $("#btn-panel").setAttribute("aria-expanded", String(S.panelOpen));
  const body = [];
  if (view.people.size === 0) {
    body.push(h("div", { class: "who" }, h("h1", null, ctx.t("panel.emptyTitle"))), h("p", { class: "note" }, ctx.t("panel.emptyText")),
      h("button", { class: "btn-ghost primary", type: "button", on: { click: () => forms.addFirst() } }, ctx.t("panel.addFirst")));
    el.panelBody.replaceChildren(...body);
    return;
  }
  const id = S.focus;
  if (!id || !view.people.has(id)) {
    body.push(h("div", { class: "who" }, h("h1", null, ctx.t("panel.wholeTree")), h("div", { class: "sn" }, `${S.canvas.layout.lineages.length} ${ctx.t("status.lines")}`)));
    body.push(h("p", { class: "note" }, ctx.t("panel.wholeNote")));
    const list = h("div", { class: "lineages" });
    S.canvas.layout.lineages.slice(0, 200).forEach((l, i) => {
      const info = infoFor(l.id);
      list.append(h("button", { class: "lineage", type: "button", on: { click: () => S.canvas.fitLineage(i) } },
        h("span", { class: "ln" }, info.tag), h("span", { class: "lr" }, `${info.given} ${info.surname}`.trim()), h("span", { class: "lc" }, `${l.size} · ${l.gens}`)));
    });
    body.push(h("section", { class: "sec" }, list));
    el.panelBody.replaceChildren(...body);
    return;
  }
  const person = view.people.get(id);
  const f = person.f;
  const info = personInfo(ctx, id);
  body.push(h("div", { class: "who" },
    h("h1", null, info.given),
    info.surname ? h("div", { class: "sn" }, info.surname.toUpperCase()) : null,
    h("div", { class: "meta" },
      info.span ? h("span", { class: "chip-y" }, info.span) : null,
      f.dc ? h("span", { class: "chip-y" }, ctx.t("person.deceased")) : null,
      S.meta.thisIsMe && (view.merged.get(S.meta.thisIsMe) ?? S.meta.thisIsMe) === id ? h("span", { class: "chip-y" }, ctx.t("person.isMe")) : null)));
  body.push(h("div", { class: "btn-row" },
    h("button", { class: "btn-ghost primary", type: "button", on: { click: ev => forms.openMenu(id, { rect: ev.currentTarget.getBoundingClientRect() }) } }, ctx.t("panel.actions")),
    h("button", { class: "btn-ghost", type: "button", on: { click: () => forms.editPerson(id) } }, ctx.t("menu.edit")),
    h("button", { class: "btn-ghost", type: "button", on: { click: () => screens.history(id) } }, ctx.t("menu.history"))));
  const rows = [];
  const row = (key, ...values) => { if (values.some(Boolean)) rows.push(h("dt", null, ctx.t(key)), h("dd", null, ...values.filter(Boolean).flatMap((v, i) => (i ? [h("br"), v] : [v])))); };
  row("person.born", f.bd && ctx.dateText(f.bd), f.bp && h("span", { class: "place" }, ctx.text(f.bp)));
  row("person.died", f.dd && ctx.dateText(f.dd), f.dp && h("span", { class: "place" }, ctx.text(f.dp)));
  row("person.birthSurname", f.bs && ctx.text(f.bs));
  row("person.sex", f.sx && ctx.t(`sex.${f.sx}`));
  if (rows.length) body.push(h("section", { class: "sec" }, h("dl", { class: "kv" }, ...rows)));
  if (f.nt) body.push(h("section", { class: "sec" }, h("h2", null, ctx.t("person.note")), h("p", { class: "note pre" }, ctx.text(f.nt))));

  const parents = view.parentLinks.filter(l => l.child === id).map(l => l.parent);
  const children = view.parentLinks.filter(l => l.parent === id).map(l => l.child);
  const partners = view.partnerLinks.filter(l => l.a === id || l.b === id);
  const group = (key, nodes) => nodes.length && body.push(h("section", { class: "sec" }, h("h2", null, ctx.t(key)), h("div", { class: "people-list" }, ...nodes)));
  group("rel.parents", parents.map(p => chip(p)));
  group("rel.partners", partners.map(l => {
    const other = l.a === id ? l.b : l.a;
    const bits = [l.f.md ? `⚭ ${ctx.dateText(l.f.md)}` : null, l.f.en ? ctx.t("rel.ended") : null].filter(Boolean).join(" · ");
    return h("span", { class: "partner-item" }, chip(other, bits ? ` ${bits}` : ""),
      h("button", { class: "mini-link", type: "button", on: { click: () => forms.editPartnership(id, other) } }, ctx.t("rel.editMarriage")));
  }));
  group("rel.children", children.map(c => chip(c)));
  if (view.attention.manyParents.includes(id)) body.push(h("section", { class: "sec warn" }, h("h2", null, ctx.t("attention.manyParents")), h("p", { class: "note" }, ctx.t("attention.manyParentsHelp"))));
  el.panelBody.replaceChildren(...body);
}
$("#btn-panel").addEventListener("click", () => {
  S.panelOpen = !S.panelOpen;
  pref.set("panelOpen", S.panelOpen);
  renderPanel();
});

// ---------- showing a person
function show(id) {
  const view = S.tree.view();
  id = view.merged.get(id) ?? id;
  if (!view.people.has(id)) return;
  if (S.mode === "all") {
    S.focus = id;
    S.canvas.markSelected(id);
    renderPanel();
    if (S.canvas.nodeOf(id)) S.canvas.centerOn(id, true, 0.7);
  } else {
    S.focus = id;
    S.canvas.touched = false;
    const before = S.canvas.nodeOf(id);
    redraw();
    if (before) S.canvas.centerOn(id, true); else S.canvas.centerOn(id, false);
  }
  writeHash();
}

function writeHash(replace = false) {
  const hash = S.mode === "all" ? (S.focus ? `all/${S.focus}` : "all") : (S.focus || "");
  if (location.hash.slice(1) === hash) return;
  if (replace) location.replace(`#${hash}`); else location.hash = hash;
}

function route() {
  const hash = location.hash.slice(1);
  const view = S.tree?.view();
  if (!view) return;
  if (hash === "all" || hash.startsWith("all/")) {
    const id = hash.slice(4) || null;
    if (S.mode !== "all") setMode("all", id);
    else if (id !== S.focus && (!id || view.people.has(id))) { S.focus = id; S.canvas.markSelected(id); renderPanel(); }
    return;
  }
  if (view.people.has(hash)) {
    if (S.mode === "all") setMode(pref.get("hourglass", "both"), hash);
    else if (hash !== S.focus) show(hash);
  }
}
window.addEventListener("hashchange", route);

function setMode(mode, id = S.focus) {
  const wasWhole = S.mode === "all";
  S.mode = mode;
  pref.set("mode", mode);
  if (mode !== "all") pref.set("hourglass", mode);
  S.canvas.touched = false;
  const view = S.tree.view();
  if (id) id = view.merged.get(id) ?? id;
  S.focus = id && view.people.has(id) ? id : null;
  redraw();
  syncControls();
  if (mode === "all") {
    S.canvas.fit(!wasWhole);
    if (S.focus && S.canvas.nodeOf(S.focus)) S.canvas.centerOn(S.focus, true, 0.7);
  } else {
    S.canvas.fit(false);
    if (S.focus) S.canvas.centerOn(S.focus, false);
  }
  writeHash();
}

// ---------- controls
function syncControls() {
  for (const b of $$(".tile[data-mode]")) {
    const on = b.dataset.mode === S.mode;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  }
  $("#val-up").textContent = String(S.up);
  $("#val-down").textContent = String(S.down);
  for (const n of $$(".param.depth")) n.hidden = S.mode === "all";
  for (const b of $$(".step")) {
    const v = S[b.dataset.step] + Number(b.dataset.delta);
    b.disabled = v < 0 || v > MAX_DEPTH;
  }
  const latin = S.i18n.latin ? "1" : "0";
  const tabs = $$(".t-tab");
  for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.latin === latin));
  const active = tabs.find(t => t.dataset.latin === latin);
  const pill = $(".t-tabs-pill");
  if (active && active.offsetWidth) {
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
  }
}
for (const b of $$(".tile[data-mode]")) b.addEventListener("click", () => { if (b.dataset.mode !== S.mode) setMode(b.dataset.mode); });
$("#btn-fit").addEventListener("click", () => S.canvas.fit());
for (const b of $$(".step")) {
  b.addEventListener("click", () => {
    S[b.dataset.step] = clamp(S[b.dataset.step] + Number(b.dataset.delta), 0, MAX_DEPTH);
    pref.set(b.dataset.step, S[b.dataset.step]);
    S.canvas.touched = false;
    redraw();
    syncControls();
    S.canvas.centerOn(S.focus, true);
  });
}
for (const t of $$(".t-tab")) t.addEventListener("click", () => setSettings({ latin: t.dataset.latin === "1" }));
$("#btn-back").addEventListener("click", () => history.back());
$("#btn-fwd").addEventListener("click", () => history.forward());
$("#btn-home").addEventListener("click", () => { const id = defaultHome(); if (id) show(id); });
$("#btn-menu").addEventListener("click", () => screens.menu());

// ---------- search
let activeResult = -1;
function closeResults() { el.results.classList.remove("is-open"); activeResult = -1; }
function renderResults() {
  const query = el.search.value;
  if (!query.trim()) { closeResults(); return; }
  const found = searchPeople(S.tree.view(), query, 30);
  clear(el.results);
  if (found.length === 0) el.results.append(h("div", { class: "results-note" }, ctx.t("search.none")));
  for (const { id } of found) {
    const info = personInfo(ctx, id);
    el.results.append(h("button", { class: "result", type: "button", role: "option", data: { id }, on: { click: () => { closeResults(); el.search.blur(); show(id); } } },
      h("span", { class: "rn" }, info.given), h("span", { class: "rs" }, info.surname.toUpperCase()), info.span ? h("span", { class: "ry" }, info.span) : null));
  }
  el.results.classList.add("is-open");
}
el.search.addEventListener("input", renderResults);
el.search.addEventListener("keydown", e => {
  const items = $$(".result", el.results);
  if (e.key === "Escape") { el.search.value = ""; closeResults(); el.search.blur(); return; }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    activeResult = clamp(activeResult + (e.key === "ArrowDown" ? 1 : -1), 0, items.length - 1);
    items.forEach((n, i) => n.classList.toggle("is-active", i === activeResult));
  } else if (e.key === "Enter") {
    (items[activeResult] || items[0])?.click();
  }
});
document.addEventListener("click", e => { if (!e.target.closest(".search-wrap")) closeResults(); });
document.addEventListener("keydown", e => {
  const typing = e.target.closest?.("input, textarea, select");
  if (e.key === "/" && !typing && el.sheet.hidden) { e.preventDefault(); el.search.focus(); }
  if (e.key === "Escape") { closeSheet(); forms.closeMenu(); }
});

// a resize re-fits, until the user has panned or zoomed
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!S.tree || !S.canvas) return;
    syncControls();
    if (S.canvas.touched) { S.canvas.applyView(); return; }
    if (S.mode === "all") S.canvas.fit(false);
    else if (S.focus) S.canvas.centerOn(S.focus, false);
  }, 120);
});

// ---------- starting up
async function begin(state) {
  const { records, meta, history } = state;
  S.meta = meta;
  S.history = history;
  S.historyDropped = !!state.historyDropped;
  const clock = createClock({ last: meta.last });
  S.tree = createTree({ device: meta.device, name: meta.name, records, clock });
  closeSheet(false);
  el.gate.hidden = true;
  if (!S.canvas) {
    S.canvas = createCanvas({
      canvas: el.canvas, world: el.world, ruler: el.ruler, tags: el.tags, panel: el.panel, panelOpen: () => S.panelOpen,
      onCard: id => { forms.closeMenu(); if (S.mode === "all") { S.focus = id; S.canvas.markSelected(id); renderPanel(); writeHash(); } else show(id); },
      onMenu: (id, at) => forms.openMenu(id, at),
      onLineage: i => S.canvas.fitLineage(i),
      onTouch: () => forms.closeMenu(),
    });
  }
  drawn = false;
  S.canvas.touched = false;
  S.focus = null;
  const view = S.tree.view();
  const hash = location.hash.slice(1);
  if (hash === "all" || hash.startsWith("all/")) { S.mode = "all"; S.focus = view.people.has(hash.slice(4)) ? hash.slice(4) : null; }
  else if (view.people.has(hash)) { S.focus = hash; if (S.mode === "all") S.mode = pref.get("hourglass", "both"); }
  redraw();
  syncControls();
  if (S.mode === "all") S.canvas.fit(false);
  else if (S.focus) S.canvas.centerOn(S.focus, false);
  if (view.people.size > 0) askPersistence();
  renderStatus();
}

function gateMessage(title, text, ...extra) {
  el.top.hidden = el.bottom.hidden = el.panel.hidden = true;
  el.gate.replaceChildren(h("div", { class: "gate-card" }, h("div", { class: "gate-mark" }, svg("svg", { viewBox: "0 0 24 24" }, svg("path", { d: "M12 21v-7m0 0-5-4m5 4 5-4M7 10V6m10 4V6" }))), h("h1", null, title), h("p", { class: "gate-sub" }, text), ...extra));
  el.gate.hidden = false;
}

async function main() {
  S.i18n = await createI18n({ lang: guessLanguage(navigator.languages || [navigator.language]) });
  S.i18n.apply();
  try {
    S.storage = await openStorage(indexedDB, navigator.locks ?? null);
  } catch (err) {
    gateMessage(ctx.t("gate.noStorageTitle"), ctx.t("gate.noStorage"));
    console.error(err);
    return;
  }
  if (S.storage.state === "locked") { gateMessage(ctx.t("gate.lockedTitle"), ctx.t("gate.locked")); return; }
  if (S.storage.state === "newer") {
    gateMessage(ctx.t("gate.newerTitle"), ctx.t("gate.newer"),
      h("button", { class: "gate-btn", type: "button", on: { click: () => screens.saveRawBackup() } }, ctx.t("backup.save")));
    return;
  }
  const state = await S.storage.load();
  const saved = state.meta.settings;
  if (saved?.lang) await S.i18n.set({ lang: saved.lang, latin: !!saved.latin });
  S.i18n.apply();
  window.addEventListener("pagehide", () => S.storage?.close());
  if (!state.meta.device) {
    S.meta = state.meta;
    await runStart(ctx, { storage: S.storage, begin, setLanguage: setSettings, screens, forms });
    return;
  }
  await begin(state);
  route();
}
main().catch(err => {
  console.error(err);
  gateMessage("Steblo", String(err?.message || err));
});
