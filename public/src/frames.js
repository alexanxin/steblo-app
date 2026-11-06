// Stream ⇄ QR frames (reference R8). Pure: no browser APIs.
import { Peeler, encodeBlock } from "./lt.js";

export const HEADER = 20;
export const MAX_LENGTH = 4 * 1024 * 1024;
export const MAX_BLOCKS = 16384;
export const MIN_BLOCK = 300;
export const MAX_BLOCK = 1500;
export const LT = 1; // the only coding (the spike measured it against cyclic repeat)

const TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(...parts) {
  let c = 0xffffffff;
  for (const bytes of parts) for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const blockCount = (length, blockSize) => Math.ceil(length / blockSize);

export function makeFrame({ streamId, length, blockSize, coding = LT, n }, block) {
  const out = new Uint8Array(HEADER + blockSize);
  const v = new DataView(out.buffer);
  v.setUint8(0, 1);
  v.setUint32(1, streamId);
  v.setUint32(5, length);
  v.setUint16(9, blockSize);
  v.setUint8(11, coding);
  v.setUint32(12, n);
  out.set(block, HEADER);
  v.setUint32(16, crc32(out.subarray(0, 16), out.subarray(HEADER)));
  return out;
}

export function parseFrame(bytes) {
  if (bytes.length < HEADER) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = v.getUint8(0), streamId = v.getUint32(1), length = v.getUint32(5);
  const blockSize = v.getUint16(9), coding = v.getUint8(11), n = v.getUint32(12), crc = v.getUint32(16);
  if (version !== 1 || coding !== LT) return null;
  if (length < 1 || length > MAX_LENGTH) return null;
  if (blockSize < MIN_BLOCK || blockSize > MAX_BLOCK) return null;
  if (blockCount(length, blockSize) > MAX_BLOCKS) return null;
  if (bytes.length !== HEADER + blockSize) return null;
  const block = bytes.subarray(HEADER);
  if (crc32(bytes.subarray(0, 16), block) !== crc) return null;
  return { streamId, length, blockSize, coding, n, block };
}

export function splitBlocks(stream, blockSize) {
  const k = blockCount(stream.length, blockSize), blocks = [];
  for (let i = 0; i < k; i++) {
    const b = new Uint8Array(blockSize);
    b.set(stream.subarray(i * blockSize, (i + 1) * blockSize));
    blocks.push(b);
  }
  return blocks;
}

/** Frames for a stream: the blocks, then endless XOR combinations of them. */
export function* ltFrames(stream, { streamId, blockSize }) {
  const blocks = splitBlocks(stream, blockSize), length = stream.length;
  for (let n = 0; ; n++) yield makeFrame({ streamId, length, blockSize, coding: LT, n }, encodeBlock(blocks, streamId, n));
}

/** Collects the frames of one stream, moving to a new stream after a stall. */
export class Collector {
  constructor({ now = () => Date.now(), stallMs = 3000 } = {}) {
    this.now = now;
    this.stallMs = stallMs;
    this.stream = null;
  }
  #start(f) {
    const k = blockCount(f.length, f.blockSize);
    this.stream = { id: f.streamId, length: f.length, blockSize: f.blockSize, k, got: 0, at: this.now(), peel: new Peeler(k, f.streamId) };
  }
  add(bytes) {
    const f = parseFrame(bytes);
    if (!f) return this.progress();
    if (!this.stream) this.#start(f);
    if (f.streamId !== this.stream.id) {
      if (this.now() - this.stream.at < this.stallMs) return this.progress();
      this.#start(f);
    }
    const s = this.stream, before = s.got;
    s.got = s.peel.add(f.n, f.block);
    if (s.got !== before) s.at = this.now();
    return this.progress();
  }
  progress() {
    const s = this.stream;
    return { received: s ? s.got : 0, total: s ? s.k : 0, done: !!s && s.got === s.k };
  }
  bytes() {
    const s = this.stream, out = new Uint8Array(s.k * s.blockSize);
    s.peel.known.forEach((b, i) => out.set(b, i * s.blockSize));
    return out.subarray(0, s.length);
  }
}
