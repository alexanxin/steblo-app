// LT coding (reference R8, coding = 1). Frames carry the XOR of blocks chosen by
// mulberry32(streamId ^ n) and a degree table for the transfer's size class. Below 100 blocks the
// first K frames carry the blocks themselves, which simulation showed needs fewer frames there.
// Integer-only, so two engines agree.
import { TABLES } from "./lt-tables.js";

const SYSTEMATIC_BELOW = 100;
const systematic = k => k < SYSTEMATIC_BELOW;
const tableFor = k => (TABLES.find(t => t.k >= k) ?? TABLES[TABLES.length - 1]).cdf;

function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}
export function picks(streamId, n, k) {
  const next = mulberry32((streamId ^ n) >>> 0), draw = next(), cdf = tableFor(k);
  let d = cdf.length;
  for (let i = 0; i < cdf.length; i++) if (draw <= cdf[i]) { d = i + 1; break; }
  d = Math.min(d, k);
  const out = new Set();
  while (out.size < d) out.add(next() % k);
  return [...out];
}

export function encodeBlock(blocks, streamId, n) {
  const k = blocks.length;
  if (systematic(k) && n < k) return blocks[n];
  const out = new Uint8Array(blocks[0].length);
  for (const i of picks(streamId, n, k)) { const b = blocks[i]; for (let j = 0; j < out.length; j++) out[j] ^= b[j]; }
  return out;
}

/** Peeling decoder. add() returns how many source blocks are known. */
export class Peeler {
  constructor(k, streamId) { this.k = k; this.streamId = streamId; this.known = new Array(k); this.got = 0; this.waiting = new Map(); this.seen = new Set(); }
  add(n, block) {
    if (this.seen.has(n)) return this.got;
    this.seen.add(n);
    const set = new Set(systematic(this.k) && n < this.k ? [n] : picks(this.streamId, n, this.k));
    const data = Uint8Array.from(block);
    for (const i of [...set]) if (this.known[i]) { set.delete(i); for (let j = 0; j < data.length; j++) data[j] ^= this.known[i][j]; }
    this.#place(set, data);
    return this.got;
  }
  #place(set, data) {
    if (set.size === 0) return;
    if (set.size > 1) { const e = { set, data }; for (const i of set) { if (!this.waiting.has(i)) this.waiting.set(i, []); this.waiting.get(i).push(e); } return; }
    const queue = [[[...set][0], data]];
    while (queue.length) {
      const [i, d] = queue.pop();
      if (this.known[i]) continue;
      this.known[i] = Uint8Array.from(d); this.got += 1;
      for (const e of this.waiting.get(i) || []) {
        if (!e.set.delete(i)) continue;
        for (let j = 0; j < d.length; j++) e.data[j] ^= this.known[i][j];
        if (e.set.size === 1) queue.push([[...e.set][0], e.data]);
      }
      this.waiting.delete(i);
    }
  }
}
