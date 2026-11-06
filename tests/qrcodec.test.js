import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { Collector, ltFrames } from "../public/src/frames.js";
import { readRgba, toMatrix, toRgba } from "../public/src/qrcodec.js";

const jsQR = createRequire(import.meta.url)("../public/vendor/jsQR.js");

test("a stream crosses real QR images with 20% of frames lost", () => {
  const stream = randomBytes(5000), gen = ltFrames(stream, { streamId: 42, blockSize: 300 });
  const c = new Collector();
  for (let i = 0; i < 400 && !c.progress().done; i++) {
    const f = gen.next().value;
    if (Math.random() < 0.2) continue;
    const got = readRgba(toRgba(toMatrix(f)), jsQR);
    assert.ok(got, "decoded");
    c.add(got);
  }
  assert.deepEqual(Buffer.from(c.bytes()), stream);
});
