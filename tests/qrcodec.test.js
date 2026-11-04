import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { Collector, cyclicFrames } from "../public/src/frames.js";
import { decode, encode } from "../public/src/base45.js";
import { readRgba, toMatrix, toRgba } from "../public/src/qrcodec.js";

const jsQR = createRequire(import.meta.url)("../public/vendor/jsQR.js");

test("base45 matches RFC 9285", () => {
  const text = s => new TextEncoder().encode(s);
  assert.equal(encode(text("AB")), "BB8");
  assert.equal(encode(text("Hello!!")), "%69 VD92EX0");
  assert.deepEqual(decode("BB8"), text("AB"));
  assert.throws(() => decode("~~~"));
});

for (const mode of ["byte", "base45"]) {
  test(`a stream crosses real QR images with 20% of frames lost (${mode})`, () => {
    const stream = randomBytes(5000), gen = cyclicFrames(stream, { streamId: 42, blockSize: 300 });
    const c = new Collector();
    for (let i = 0; i < 400 && !c.progress().done; i++) {
      const f = gen.next().value;
      if (Math.random() < 0.2) continue;
      const got = readRgba(toRgba(toMatrix(f, { mode })), jsQR, { mode });
      assert.ok(got, "decoded");
      c.add(got);
    }
    assert.deepEqual(Buffer.from(c.bytes()), stream);
  });
}
