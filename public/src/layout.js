// Hourglass and whole-tree layout (reference R4, layout contract). Pure: a function of view() and a focus person.
// The maths is ported from the private app's layout, changed to read view().families:
//   - a person's ancestors come from their own family (the family they are a child of)
//   - descendants come from every family where they are a partner (hourglass), or from the
//     families they anchor (whole tree): the anchor of a family is partners[0]
//   - a child is in one family only, so it is drawn once
// Result: { nodes, edges, bounds, chips, vertices, lineages, host }.
//   nodes     [{ id, x, y, kind }]   kind "" or "spouse"; x is the card centre
//   edges     [{ cls, d }]           SVG path data: "", "marriage" or "marriage later"
//   chips     [{ x, y, text }]       marriage years drawn on the lines
//   vertices  [[x, y]]               joints of the lines
//   lineages  whole tree only: [{ id, size, gens, x, y, w, h, nodes: [first, end] }], biggest first
//   host      Map: a married-in person with no card → the person whose card names them (whole tree)
import { sortYear } from "./dates.js";

export const CARD_W = 188;
export const CARD_H = 66;
export const HALF = CARD_W / 2;
export const GAP = 26; // between sibling subtrees
export const COUPLE_GAP = 40; // between partners (the marriage line runs here)
export const ROW_H = 160; // one generation

const SHELF_GAP = 320;
const TREE_GAP = 260;

const push = (map, key, value) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const indexes = new WeakMap();

/** The lookups every layout needs, built once per view. */
function indexOf(view) {
  const cached = indexes.get(view);
  if (cached) return cached;
  const ownFam = new Map(); // child → the family it is a child of
  const partnerFams = new Map(); // person → families where they are a partner
  const anchorFams = new Map(); // person → families with children that they anchor (partners[0])
  const anchored = new Set(); // people who are partners[0] of any family
  for (const family of view.families) {
    for (const child of family.children) ownFam.set(child, family);
    for (const p of family.partners) push(partnerFams, p, family);
    anchored.add(family.partners[0]);
    if (family.children.length > 0) push(anchorFams, family.partners[0], family);
  }
  // A married-in partner (no parents, anchors nothing) has no card in the whole tree: a line on the anchor's card.
  const hosted = new Map();
  for (const [id, fams] of partnerFams) {
    if (ownFam.has(id) || anchored.has(id) || !view.people.has(id)) continue;
    const family = fams.find(f => f.partners[0] !== id && view.people.has(f.partners[0]));
    if (family) hosted.set(id, family.partners[0]);
  }
  const result = { ownFam, partnerFams, anchorFams, hosted, loops: view.attention.loops.length > 0 };
  indexes.set(view, result);
  return result;
}

/** The partners of a person, in family order (used on the card in the whole tree). */
export function spousesOf(view, id) {
  const { partnerFams } = indexOf(view);
  const out = [];
  for (const family of partnerFams.get(id) || []) {
    for (const p of family.partners) if (p !== id && view.people.has(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

const yearText = family => {
  const year = family.partnership?.f?.md ? sortYear(family.partnership.f.md) : null;
  return year ? `⚭ ${year}` : "";
};

function bounds(nodes) {
  if (nodes.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  return { minX: minX - HALF, maxX: maxX + HALF, minY: minY - CARD_H / 2, maxY: maxY + CARD_H / 2 };
}

/** One layout run: `whole` for the forest, else an hourglass with `up` and `down` generations. */
function engine(view, { whole, up = 0, down = 0 }) {
  const { ownFam, partnerFams, anchorFams, hosted, loops } = indexOf(view);
  const visible = id => view.people.has(id);
  const depthUp = up;
  const depthDown = whole ? Infinity : down;
  const upCache = new Map();
  const downCache = new Map();
  const spouseFamsOf = id => (partnerFams.get(id) || []).filter(f => f.partners.some(p => p !== id && visible(p)));
  const childFams = id => (whole ? anchorFams.get(id) || [] : partnerFams.get(id) || []);
  const kidsOf = (id, path) => childFams(id).flatMap(f => f.children).filter(c => visible(c) && !path.has(c));
  const parentsOfId = (id, path) => {
    const f = ownFam.get(id);
    if (!f) return null;
    const [a, b] = f.partners.filter(p => visible(p) && !path.has(p));
    return a === undefined ? null : { a, b, family: f };
  };

  // ---------- ancestors: each couple sits so the child's x falls in the gap between the two parent cards
  function measureUp(id, gen, path) {
    const key = `${id}|${gen}`;
    if (!loops && upCache.has(key)) return upCache.get(key);
    let r = { L: HALF, R: HALF };
    const f = gen < depthUp ? parentsOfId(id, path) : null;
    if (f) {
      path.add(id);
      if (f.b !== undefined) {
        const a = measureUp(f.a, gen + 1, path);
        const b = measureUp(f.b, gen + 1, path);
        r = { L: Math.max(HALF, COUPLE_GAP / 2 + a.L + a.R), R: Math.max(HALF, COUPLE_GAP / 2 + b.L + b.R) };
      } else {
        const one = measureUp(f.a, gen + 1, path);
        r = { L: Math.max(HALF, one.L), R: Math.max(HALF, one.R) };
      }
      path.delete(id);
    }
    if (!loops) upCache.set(key, r);
    return r;
  }

  function placeUp(id, gen, x, out, path) {
    const f = gen < depthUp ? parentsOfId(id, path) : null;
    if (!f) return;
    const y = -gen * ROW_H;
    const py = y - ROW_H;
    path.add(id);
    if (f.b !== undefined) {
      const a = measureUp(f.a, gen + 1, path);
      const b = measureUp(f.b, gen + 1, path);
      const fx = x - COUPLE_GAP / 2 - a.R;
      const mx = x + COUPLE_GAP / 2 + b.L;
      out.nodes.push({ id: f.a, x: fx, y: py, kind: "" });
      out.nodes.push({ id: f.b, x: mx, y: py, kind: "" });
      out.edges.push({ cls: "marriage", d: `M${fx + HALF},${py}H${mx - HALF}` });
      out.edges.push({ cls: "", d: `M${x},${py}V${y - CARD_H / 2}` });
      out.vertices.push([x, py]);
      const text = yearText(f.family);
      if (text) out.chips.push({ x, y: py + ROW_H / 2, text }); // sits on the line down to the child
      placeUp(f.a, gen + 1, fx, out, path);
      placeUp(f.b, gen + 1, mx, out, path);
    } else {
      out.nodes.push({ id: f.a, x, y: py, kind: "" });
      out.edges.push({ cls: "", d: `M${x},${py + CARD_H / 2}V${y - CARD_H / 2}` });
      placeUp(f.a, gen + 1, x, out, path);
    }
    path.delete(id);
    out.vertices.push([x, y - CARD_H / 2]);
  }

  // ---------- descendants, packed by their contours (tidy tree): for each generation below a person,
  // how far the subtree reaches left (L[d]) and right (R[d]). Siblings slide together until some
  // generation would touch, so a short branch tucks in beside a deep one. kx: children's x relative to the person.
  const spouseRowRight = id => (whole ? HALF : HALF + spouseFamsOf(id).length * (CARD_W + COUPLE_GAP));

  function shapeDown(id, gen, path) {
    const key = `${id}|${gen}`;
    if (!loops && downCache.has(key)) return downCache.get(key);
    const rowR = spouseRowRight(id);
    path.add(id);
    const kids = gen < depthDown ? kidsOf(id, path) : [];
    let shape = { L: [-HALF], R: [rowR], kx: [] };
    if (kids.length) {
      const shapes = kids.map(k => shapeDown(k, gen + 1, path));
      const pos = [0];
      const accL = shapes[0].L.slice();
      const accR = shapes[0].R.slice();
      for (let i = 1; i < shapes.length; i++) {
        const s = shapes[i];
        let shift = -Infinity;
        for (let d = 0; d < Math.min(accR.length, s.L.length); d++) shift = Math.max(shift, accR[d] + GAP - s.L[d]);
        pos.push(shift);
        for (let d = 0; d < s.L.length; d++) {
          accL[d] = d < accL.length ? Math.min(accL[d], shift + s.L[d]) : shift + s.L[d];
          accR[d] = d < accR.length ? Math.max(accR[d], shift + s.R[d]) : shift + s.R[d];
        }
      }
      const cc = (rowR - HALF) / 2; // centre the children under the couple
      const off = cc - (pos[0] + pos[pos.length - 1]) / 2;
      shape = { L: [-HALF, ...accL.map(v => v + off)], R: [rowR, ...accR.map(v => v + off)], kx: pos.map(p => p + off) };
    }
    path.delete(id);
    if (!loops) downCache.set(key, shape);
    return shape;
  }

  function measureDown(id, gen) {
    const s = shapeDown(id, gen, new Set());
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of s.L) if (v < lo) lo = v;
    for (const v of s.R) if (v > hi) hi = v;
    return { L: -lo, R: hi };
  }

  function placeDown(id, gen, x, out, path, baseY = 0) {
    const y = baseY + gen * ROW_H;
    const withKids = new Set(childFams(id));
    const groups = [];
    path.add(id);
    if (whole) {
      for (const f of childFams(id)) groups.push({ f, from: [x, y + CARD_H / 2], xs: [] });
    } else {
      let slot = 0;
      for (const f of spouseFamsOf(id)) {
        const sp = f.partners.find(p => p !== id && visible(p));
        slot += 1;
        const sx = x + slot * (CARD_W + COUPLE_GAP);
        if (!path.has(sp)) out.nodes.push({ id: sp, x: sx, y, kind: "spouse" });
        const gx = sx - HALF - COUPLE_GAP / 2;
        if (slot === 1) {
          out.edges.push({ cls: "marriage", d: `M${x + HALF},${y}H${sx - HALF}` });
        } else {
          // later partners: a dashed bridge over the cards between, from the top-right corners so it
          // cannot pass for the line to the parents
          const top = y - CARD_H / 2;
          const lift = 16 + 7 * (slot - 2);
          const x1 = x + HALF - 22;
          const x2 = sx + HALF - 22;
          out.edges.push({ cls: "marriage later", d: `M${x1},${top}V${top - lift}H${x2}V${top}` });
          out.vertices.push([x1, top], [x2, top]);
        }
        const text = yearText(f);
        if (text) out.chips.push({ x: gx, y: y + CARD_H / 2 + 20, text });
        groups.push({ f, from: [gx, y], xs: [] });
      }
      // a single parent with children and no partner card
      for (const f of withKids) if (!groups.some(g => g.f === f)) groups.push({ f, from: [x, y + CARD_H / 2], xs: [] });
    }
    if (gen < depthDown) {
      // the same order shapeDown used: families as childFams lists them, so kx[i] belongs to kids[i]
      const kids = childFams(id).flatMap(f => {
        const g = groups.find(x => x.f === f);
        return f.children.filter(c => visible(c) && !path.has(c)).map(k => ({ k, g }));
      });
      if (kids.length) {
        const { kx } = shapeDown(id, gen, new Set(path));
        const cy = y + ROW_H;
        kids.forEach(({ k, g }, i) => {
          const cx = x + kx[i];
          out.nodes.push({ id: k, x: cx, y: cy, kind: "" });
          g.xs.push(cx);
          placeDown(k, gen + 1, cx, out, path, baseY);
        });
        const used = groups.filter(g => g.xs.length);
        used.forEach((g, i) => {
          const busY = y + ROW_H / 2 + (i - (used.length - 1) / 2) * 8;
          const [fx, fy] = g.from;
          const lo = Math.min(fx, ...g.xs);
          const hi = Math.max(fx, ...g.xs);
          let d = `M${fx},${fy}V${busY}M${lo},${busY}H${hi}`;
          for (const cx of g.xs) d += `M${cx},${busY}V${cy - CARD_H / 2}`;
          out.edges.push({ cls: "", d });
          out.vertices.push([fx, fy]);
          for (const cx of g.xs) out.vertices.push([cx, cy - CARD_H / 2]);
        });
      }
    }
    path.delete(id);
  }

  return { measureDown, placeDown, placeUp, shapeDown };
}

const empty = () => ({ nodes: [], edges: [], vertices: [], chips: [], lineages: [], host: new Map() });

/**
 * The hourglass around `focusId`: ancestors above (up to `up` generations), descendants below
 * (`down`), partners to the right of each person. `up` or `down` of 0 leaves that side out.
 */
export function layoutHourglass(view, focusId, { up = 3, down = 2 } = {}) {
  const out = empty();
  if (!view.people.has(focusId)) return { ...out, bounds: bounds([]) };
  const e = engine(view, { whole: false, up, down });
  out.nodes.push({ id: focusId, x: 0, y: 0, kind: "" });
  e.placeUp(focusId, 0, 0, out, new Set());
  // Ancestors are placed; a descendant that is also an ancestor (only in a loop) is not drawn again.
  const above = new Set(out.nodes.map(n => n.id));
  e.placeDown(focusId, 0, 0, out, above);
  return { ...out, bounds: bounds(out.nodes) };
}

/**
 * Every family line (lineage) drawn down from its oldest ancestor, side by side on shelves, biggest first,
 * wrapped to a width that keeps the whole roughly screen-shaped. Partners with no parents of their own
 * have no card: they are a line on the anchor's card (`host`).
 */
export function layoutForest(view) {
  const { ownFam, anchorFams, hosted } = indexOf(view);
  const out = empty();
  out.host = new Map(hosted);
  const e = engine(view, { whole: true });

  // roots: people with no parents who are not a married-in partner
  const roots = [];
  for (const id of view.people.keys()) if (!ownFam.has(id) && !hosted.has(id)) roots.push(id);
  const lineages = roots.map(id => {
    let size = 0;
    let gens = 0;
    const seen = new Set();
    const stack = [[id, 1]];
    while (stack.length) {
      const [x, g] = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x);
      size += 1;
      gens = Math.max(gens, g);
      for (const f of anchorFams.get(x) || []) for (const c of f.children) stack.push([c, g + 1]);
    }
    return { id, size, gens };
  }).sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1));

  const boxes = lineages.map(l => {
    const m = e.measureDown(l.id, 0);
    return { l, L: m.L, R: m.R, h: (l.gens - 1) * ROW_H + CARD_H };
  });
  const area = boxes.reduce((s, b) => s + (b.L + b.R + TREE_GAP) * (b.h + SHELF_GAP), 0);
  const target = Math.max(0, ...boxes.map(b => b.L + b.R), Math.sqrt(area * 1.7));
  let cx = 0;
  let cy = 0;
  let shelfH = 0;
  for (const b of boxes) {
    const w = b.L + b.R;
    if (cx > 0 && cx + w > target) {
      cx = 0;
      cy += shelfH + SHELF_GAP;
      shelfH = 0;
    }
    const x = cx + b.L;
    const first = out.nodes.length;
    out.nodes.push({ id: b.l.id, x, y: cy, kind: "" });
    e.placeDown(b.l.id, 0, x, out, new Set(), cy);
    out.lineages.push({ ...b.l, x: cx, y: cy - CARD_H / 2 - 26, w, h: b.h, nodes: [first, out.nodes.length] });
    cx += w + TREE_GAP;
    shelfH = Math.max(shelfH, b.h);
  }
  return { ...out, bounds: bounds(out.nodes) };
}
