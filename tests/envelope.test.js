// Task 2.7: the encrypted envelope (reference R7, R6 step 1 code).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { newSession, deriveKey, seal, open, shortCode } from "../public/src/envelope.js";

const helloA = new TextEncoder().encode('{"f":1,"d":"a"}');
const helloB = new TextEncoder().encode('{"f":1,"d":"b"}');

/** Two phones that have agreed on a key. */
async function pair() {
  const a = await newSession();
  const b = await newSession();
  const keyA = await deriveKey(a, b.publicKey, a.nonce, b.nonce);
  const keyB = await deriveKey(b, a.publicKey, a.nonce, b.nonce);
  return { a, b, keyA, keyB };
}

test("two sessions derive the same key", async () => {
  const { a, b, keyA, keyB } = await pair();
  assert.equal(a.publicKey.length, 65);
  assert.equal(a.publicKey[0], 4); // uncompressed P-256 point
  assert.equal(a.nonce.length, 16);
  assert.notDeepEqual(a.publicKey, b.publicKey);
  assert.notDeepEqual(a.nonce, b.nonce);
  // the same key: what one seals, the other opens
  const sealed = await seal(keyA, 2, helloA, helloB, Uint8Array.of(1, 2, 3));
  assert.deepEqual(await open(keyB, 2, helloA, helloB, sealed), Uint8Array.of(1, 2, 3));
  // a third phone, or the nonces in the other order, gives another key
  const c = await newSession();
  const keyC = await deriveKey(c, a.publicKey, a.nonce, b.nonce);
  await assert.rejects(open(keyC, 2, helloA, helloB, sealed));
  const swapped = await deriveKey(b, a.publicKey, b.nonce, a.nonce);
  await assert.rejects(open(swapped, 2, helloA, helloB, sealed));
  // the private key can't be read out
  assert.equal(a.privateKey.extractable, false);
  assert.equal(keyA.extractable, false);
});

test("seal and open round trip", async () => {
  const { keyA, keyB } = await pair();
  for (const size of [0, 1, 1000, 200_000]) {
    const data = Uint8Array.from({ length: size }, (_, i) => (i * 7) & 255);
    const sealed = await seal(keyA, 3, helloA, helloB, data);
    // IV (12) ‖ ciphertext ‖ tag (16)
    assert.equal(sealed.length, 12 + size + 16);
    assert.deepEqual(await open(keyB, 3, helloA, helloB, sealed), data);
  }
  // a new random IV every time
  const one = await seal(keyA, 2, helloA, helloB, Uint8Array.of(9));
  const two = await seal(keyA, 2, helloA, helloB, Uint8Array.of(9));
  assert.notDeepEqual(one.subarray(0, 12), two.subarray(0, 12));
  // only steps 2 and 3 exist
  await assert.rejects(seal(keyA, 1, helloA, helloB, Uint8Array.of(1)));
  await assert.rejects(seal(keyA, 4, helloA, helloB, Uint8Array.of(1)));
});

test("a changed hello fails to open", async () => {
  const { keyA, keyB } = await pair();
  const sealed = await seal(keyA, 2, helloA, helloB, Uint8Array.of(1, 2, 3));
  const tweaked = Uint8Array.from(helloA);
  tweaked[tweaked.length - 3] ^= 1;
  await assert.rejects(open(keyB, 2, tweaked, helloB, sealed));
  await assert.rejects(open(keyB, 2, helloA, tweaked, sealed));
  // the hellos in the other order are a different message
  await assert.rejects(open(keyB, 2, helloB, helloA, sealed));
});

test("a step 2 message can't be opened as step 3", async () => {
  const { keyA, keyB } = await pair();
  const sealed = await seal(keyA, 2, helloA, helloB, Uint8Array.of(1, 2, 3));
  await assert.rejects(open(keyB, 3, helloA, helloB, sealed));
  assert.ok(await open(keyB, 2, helloA, helloB, sealed));
});

test("a changed byte fails to open", async () => {
  const { keyA, keyB } = await pair();
  const sealed = await seal(keyA, 2, helloA, helloB, Uint8Array.from({ length: 64 }, (_, i) => i));
  for (const at of [0, 11, 12, 40, sealed.length - 1]) {
    const damaged = Uint8Array.from(sealed);
    damaged[at] ^= 1;
    await assert.rejects(open(keyB, 2, helloA, helloB, damaged), `byte ${at}`);
  }
  await assert.rejects(open(keyB, 2, helloA, helloB, sealed.subarray(0, sealed.length - 1)));
  await assert.rejects(open(keyB, 2, helloA, helloB, new Uint8Array(10)));
  await assert.rejects(open(keyB, 2, helloA, helloB, new Uint8Array(0)));
});

test("shortCode is four letters and stable for a hello", async () => {
  const code = await shortCode(helloA);
  assert.match(code, /^[A-Z]{4}$/);
  assert.equal(await shortCode(helloA), code);
  assert.equal(await shortCode(Uint8Array.from(helloA)), code);
  // it comes from SHA-256 of the hello: four bytes, each reduced to a letter
  const digest = createHash("sha256").update(helloA).digest();
  assert.equal(code, [...digest.subarray(0, 4)].map(byte => String.fromCharCode(65 + (byte % 26))).join(""));
  // different hellos mostly differ
  const codes = new Set();
  for (let i = 0; i < 50; i++) codes.add(await shortCode(new TextEncoder().encode(`hello ${i}`)));
  assert.ok(codes.size > 45);
});
