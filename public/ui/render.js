// Drawing the tree: SVG built from a layout, plus pan, pinch, wheel and fit (ported from the private app).
// Everything is created with createElementNS and textContent; positions go through attributes and el.style.
import { CARD_W, CARD_H, HALF, ROW_H } from "../src/layout.js";
import { svg, h, clear } from "./dom.js";

const MIN_K = 0.015; // the whole tree is wide; allow zooming out to see all of it
const MAX_K = 2.6;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t;
  const sy = t => ((ay * t + by) * t + cy) * t;
  const dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      const d = dx(t);
      if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sy(clamp(t, 0, 1));
  };
}

export function createCanvas({ canvas, world, ruler, tags, panel, panelOpen, onCard, onMenu, onLineage, onTouch }) {
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const durationMs = (name, fallback) => {
    const raw = css(name);
    const n = parseFloat(raw);
    if (!raw || Number.isNaN(n)) return fallback;
    return raw.endsWith("ms") ? n : n * 1000;
  };
  const ease = bezier(...(css("--ease-smooth-out").match(/[\d.]+/g) || [0.22, 1, 0.36, 1]).map(Number));
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const st = { view: { x: 0, y: 0, k: 1 }, layout: null, mode: "both", focus: null, info: null, touched: false };
  let anim = 0;

  // ---------- drawing
  function cardNode(n) {
    const info = st.info(n.id);
    const cls = ["card"];
    if (n.id === st.focus) cls.push("is-focus");
    if (info.vague) cls.push("is-vague");
    const g = svg("g", {
      class: cls.join(" "),
      transform: `translate(${n.x - HALF},${n.y - CARD_H / 2})`,
      "data-id": n.id,
      tabindex: "0",
      role: "button",
      "aria-label": `${info.given} ${info.surname} ${info.span}`.trim(),
    });
    if (n.id === st.focus) g.append(svg("rect", { class: "glow-ring", width: CARD_W, height: CARD_H, rx: 12 }));
    g.append(svg("rect", { class: "card-bg", width: CARD_W, height: CARD_H, rx: 12 }));
    const hasSpouse = st.mode === "all" && info.spouse;
    g.append(
      svg("text", { class: "name", x: 14, y: hasSpouse ? 27 : 34 }, clip(info.given, 18)),
      svg("text", { class: "surname", x: 14, y: hasSpouse ? 43 : 52 }, clip(info.surname.toUpperCase(), 22)),
    );
    if (hasSpouse) g.append(svg("text", { class: "spouse", x: 14, y: 58 }, clip(`⚭ ${info.spouse}`, 28)));
    const sx = CARD_W - 18;
    const sy = 18;
    if (info.sex === "F") g.append(svg("circle", { class: "sex", cx: sx, cy: sy, r: 4.5 }));
    else if (info.sex === "M") g.append(svg("rect", { class: "sex", x: sx - 4.5, y: sy - 4.5, width: 9, height: 9, rx: 2 }));
    if (info.span) {
      const w = info.span.length * 6.4 + 14; // stays clear of the centre connection point
      g.append(svg("g", { class: "ychip", transform: "translate(12,-9)" },
        svg("rect", { width: w, height: 18, rx: 9 }),
        svg("text", { x: w / 2, y: 12.5, "text-anchor": "middle" }, info.span)));
    }
    return g;
  }

  function draw({ layout, mode, focus, info }) {
    st.layout = layout;
    st.mode = mode;
    st.focus = focus;
    st.info = info;
    const rows = svg("g");
    const links = svg("g");
    const verts = svg("g", { class: "vertices" });
    const cards = svg("g");
    const chips = svg("g");
    if (mode !== "all" && layout.nodes.length > 0) {
      for (const y of new Set(layout.nodes.map(n => n.y))) {
        rows.append(svg("line", { class: `row-line${y === 0 ? " is-zero" : ""}`, x1: layout.bounds.minX - 6000, x2: layout.bounds.maxX + 6000, y1: y, y2: y, "vector-effect": "non-scaling-stroke" }));
      }
    }
    for (const l of layout.edges) links.append(svg("path", { class: `link ${l.cls}`, d: l.d }));
    const seen = new Set();
    for (const [x, y] of layout.vertices) {
      const key = `${Math.round(x)},${Math.round(y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      verts.append(svg("circle", { class: "vertex", cx: x, cy: y, r: 4.5 }));
    }
    for (const c of layout.chips) {
      const w = c.text.length * 6.9 + 14;
      chips.append(svg("g", { class: "mchip", transform: `translate(${c.x - w / 2},${c.y - 9})` },
        svg("rect", { width: w, height: 18, rx: 9 }),
        svg("text", { x: w / 2, y: 12.5, "text-anchor": "middle" }, c.text)));
    }
    for (const n of layout.nodes) cards.append(cardNode(n));
    world.replaceChildren(rows, links, cards, verts, chips);
    overlay();
  }

  /** Light up one person without a new layout. */
  function markSelected(id) {
    st.focus = id;
    for (const c of world.querySelectorAll(".card.is-focus")) {
      c.classList.remove("is-focus");
      c.querySelector(".glow-ring")?.remove();
    }
    if (!id) return;
    for (const c of world.querySelectorAll(".card")) {
      if (c.dataset.id !== id) continue;
      c.classList.add("is-focus");
      c.prepend(svg("rect", { class: "glow-ring", width: CARD_W, height: CARD_H, rx: 12 }));
    }
  }

  // ---------- ruler and lineage tags
  function overlay() {
    clear(ruler);
    clear(tags);
    if (!st.layout) return;
    const { x, y, k } = st.view;
    if (st.mode !== "all") {
      const byRow = new Map();
      for (const n of st.layout.nodes) {
        const year = st.info(n.id).birthYear;
        if (!byRow.has(n.y)) byRow.set(n.y, []);
        if (year) byRow.get(n.y).push(year);
      }
      for (const [rowY, years] of [...byRow].sort((a, b) => a[0] - b[0])) {
        const sy = y + rowY * k;
        if (sy < 120 || sy > window.innerHeight - 50) continue;
        const gen = Math.round(rowY / ROW_H);
        years.sort((a, b) => a - b);
        const median = years.length ? years[Math.floor(years.length / 2)] : null;
        const gauge = h("div", { class: "gen" }, h("b", null, gen > 0 ? `+${gen}` : gen < 0 ? `−${-gen}` : "0"), median ? h("span", null, `≈${median}`) : null);
        gauge.style.top = `${sy}px`;
        ruler.append(gauge);
      }
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    st.layout.lineages.forEach((l, i) => {
      const sx = x + l.x * k;
      const sy = y + l.y * k;
      const sw = l.w * k;
      if (sw < 70 || sx + sw < 0 || sx > W || sy < 60 || sy > H + 40) return;
      const tag = h("button", { class: "tag", type: "button", data: { lineage: i } }, st.info(l.id).tag, " ", h("b", null, String(l.size)));
      tag.style.left = `${Math.max(sx, 8)}px`;
      tag.style.top = `${sy}px`;
      tags.append(tag);
    });
  }
  tags.addEventListener("click", e => {
    const tag = e.target.closest("[data-lineage]");
    if (tag && onLineage) onLineage(Number(tag.dataset.lineage));
  });

  // ---------- viewport
  function applyView() {
    const { x, y, k } = st.view;
    world.setAttribute("transform", `translate(${x},${y}) scale(${k})`);
    const minor = 24 * k;
    const major = 120 * k;
    canvas.style.backgroundSize = `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`;
    canvas.style.backgroundPosition = `${x}px ${y}px`;
    canvas.classList.toggle("far", k < 0.3); // too small to read: drop the text
    overlay();
  }

  function animateView(to, durName = "--duration-slow") {
    cancelAnimationFrame(anim);
    if (reducedMotion()) { st.view = to; applyView(); return; }
    const from = { ...st.view };
    const t0 = performance.now();
    const dur = durationMs(durName, 400);
    const step = now => {
      const t = Math.min(1, (now - t0) / dur);
      const e = ease(t);
      st.view = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      applyView();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  // the part of the screen not covered by the floating chrome
  function safeArea() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const narrow = W <= 720;
    const open = panelOpen() && !panel.hidden;
    const rect = panel.hidden ? { right: 0, top: H } : panel.getBoundingClientRect();
    const left = !narrow && open ? rect.right + 24 : 24;
    const top = narrow ? 215 : W <= 1100 ? 196 : 152;
    const bottom = narrow ? (open ? rect.top - 12 : H - 70) : H - 70;
    return { left, top, right: W - 24, bottom: Math.max(bottom, top + 120) };
  }

  function fitBox(x0, y0, x1, y1, animated = true, maxK = 1.1) {
    const a = safeArea();
    const k = clamp(Math.min((a.right - a.left) / Math.max(1, x1 - x0), (a.bottom - a.top) / Math.max(1, y1 - y0)), MIN_K, maxK);
    const to = { k, x: (a.left + a.right) / 2 - ((x0 + x1) / 2) * k, y: (a.top + a.bottom) / 2 - ((y0 + y1) / 2) * k };
    if (animated) animateView(to);
    else { st.view = to; applyView(); }
  }

  function fit(animated = true) {
    if (!st.layout || st.layout.nodes.length === 0) { st.view = { x: 0, y: 0, k: 1 }; applyView(); return; }
    const b = st.layout.bounds;
    fitBox(b.minX, b.minY - 40, b.maxX, b.maxY, animated);
  }

  // a family line: the whole of it if that is still readable, otherwise its oldest ancestor at a size you can read
  function fitLineage(i) {
    const l = st.layout.lineages[i];
    if (!l) return;
    const a = safeArea();
    const k = Math.min((a.right - a.left) / l.w, (a.bottom - a.top) / (l.h + 80));
    if (k >= 0.35) { fitBox(l.x, l.y - 20, l.x + l.w, l.y + l.h + 60, true, 0.9); return; }
    const root = st.layout.nodes[l.nodes[0]];
    animateView({ k: 0.6, x: (a.left + a.right) / 2 - root.x * 0.6, y: a.top + 60 - root.y * 0.6 });
  }

  /** Where a person is drawn: their own card, else the card of the partner whose line names them. */
  function nodeOf(id) {
    if (!st.layout || !id) return null;
    const ns = st.layout.nodes.filter(n => n.id === id);
    const own = ns.find(n => n.kind !== "spouse") || ns[0];
    if (own) return own;
    const host = st.layout.host.get(id);
    return host ? nodeOf(host) : null;
  }

  function centerOn(id, animated = true, minK = 0) {
    const n = nodeOf(id);
    if (!n) return;
    const a = safeArea();
    const k = Math.max(st.view.k, minK);
    const to = { k, x: (a.left + a.right) / 2 - n.x * k, y: (a.top + a.bottom) / 2 - n.y * k };
    if (animated) animateView(to);
    else { st.view = to; applyView(); }
  }

  function zoomAt(factor, cx, cy) {
    st.touched = true;
    const { x, y, k } = st.view;
    const k2 = clamp(k * factor, MIN_K, MAX_K);
    st.view = { k: k2, x: cx - (cx - x) * (k2 / k), y: cy - (cy - y) * (k2 / k) };
    applyView();
  }

  // ---------- pointer: pan, pinch, click, long press
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let pressTimer = 0;
  canvas.addEventListener("contextmenu", e => {
    e.preventDefault();
    const card = e.target.closest(".card");
    if (card) onMenu(card.dataset.id, { x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener("pointerdown", e => {
    onTouch?.();
    drag = { x: e.clientX, y: e.clientY, vx: st.view.x, vy: st.view.y, moved: false, card: e.target.closest(".card") };
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearTimeout(pressTimer);
    if (e.pointerType !== "mouse" && drag.card) {
      // holding a finger on a card opens its menu (phones have no right-click)
      const press = drag;
      const { clientX: x, clientY: y } = e;
      pressTimer = setTimeout(() => {
        if (drag === press && !press.moved) { press.longPress = true; onMenu(press.card.dataset.id, { x, y }); }
      }, 550);
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: st.view.k };
      drag = null;
      clearTimeout(pressTimer);
    }
    canvas.setPointerCapture(e.pointerId);
    cancelAnimationFrame(anim);
  });
  canvas.addEventListener("pointermove", e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((pinch.k * d / pinch.d) / st.view.k, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    clearTimeout(pressTimer);
    st.touched = true;
    canvas.classList.add("is-panning");
    st.view = { ...st.view, x: drag.vx + dx, y: drag.vy + dy };
    applyView();
  });
  const endPointer = e => {
    pointers.delete(e.pointerId);
    clearTimeout(pressTimer);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && !drag.longPress && drag.card && e.type === "pointerup" && e.button === 0) onCard(drag.card.dataset.id);
    if (pointers.size === 0) { drag = null; canvas.classList.remove("is-panning"); }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
  }, { passive: false });
  canvas.addEventListener("dblclick", e => {
    if (!e.target.closest(".card")) fit();
  });
  world.addEventListener("keydown", e => {
    const card = e.target.closest(".card");
    if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onCard(card.dataset.id); }
  });

  return {
    draw, markSelected, fit, fitLineage, centerOn, nodeOf, applyView, zoomAt,
    get view() { return st.view; },
    set view(v) { st.view = v; },
    get touched() { return st.touched; },
    set touched(v) { st.touched = v; },
    get layout() { return st.layout; },
    cardRect: id => world.querySelector(`.card[data-id="${id}"]`)?.getBoundingClientRect() ?? null,
  };
}
