// The encrypted envelope of a sync (reference R7). Pure: WebCrypto only, no storage.
// Fresh keys for every sync, never stored. The associated data covers both hellos and the step,
// so a changed hello, a swapped step or a replayed message fails to open.
const subtle = globalThis.crypto.subtle;
const LABEL = new TextEncoder().encode("steblo-sync-1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

const fail = message => Object.assign(new Error(message), { code: "envelope" });
const sha256 = async bytes => new Uint8Array(await subtle.digest("SHA-256", bytes));

/** → { publicKey: Uint8Array(65), nonce: Uint8Array(16), privateKey: CryptoKey (not extractable) } */
export async function newSession() {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const publicKey = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  return { publicKey, nonce: globalThis.crypto.getRandomValues(new Uint8Array(16)), privateKey: pair.privateKey };
}

/**
 * ECDH with the other phone's public key, then HKDF-SHA-256 with salt nonceA ‖ nonceB.
 * A is the phone that showed the first code. Both phones pass the nonces in the same roles.
 */
export async function deriveKey(session, peerPublicKey, nonceA, nonceB) {
  let peer;
  try {
    peer = await subtle.importKey("raw", peerPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch {
    throw fail("not a P-256 public key");
  }
  const secret = await subtle.deriveBits({ name: "ECDH", public: peer }, session.privateKey, 256);
  const material = await subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  const salt = new Uint8Array(nonceA.length + nonceB.length);
  salt.set(nonceA);
  salt.set(nonceB, nonceA.length);
  return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: LABEL }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function associatedData(step, helloA, helloB) {
  if (step !== 2 && step !== 3) throw fail("step must be 2 or 3");
  const out = new Uint8Array(LABEL.length + 1 + 64);
  out.set(LABEL);
  out[LABEL.length] = step;
  out.set(await sha256(helloA), LABEL.length + 1);
  out.set(await sha256(helloB), LABEL.length + 33);
  return out;
}

/** → IV (12 random bytes) ‖ ciphertext ‖ tag (16) */
export async function seal(key, step, helloA, helloB, bytes) {
  const additionalData = await associatedData(step, helloA, helloB);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const body = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData, tagLength: TAG_BYTES * 8 }, key, bytes));
  const out = new Uint8Array(IV_BYTES + body.length);
  out.set(iv);
  out.set(body, IV_BYTES);
  return out;
}

/** The plain bytes, or a rejection (code "envelope") if anything about the message, the hellos or the step is not as sealed. */
export async function open(key, step, helloA, helloB, bytes) {
  const additionalData = await associatedData(step, helloA, helloB);
  if (!(bytes instanceof Uint8Array) || bytes.length < IV_BYTES + TAG_BYTES) throw fail("message too short");
  try {
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, IV_BYTES), additionalData, tagLength: TAG_BYTES * 8 }, key, bytes.subarray(IV_BYTES));
    return new Uint8Array(plain);
  } catch {
    throw fail("could not open the message");
  }
}

/** The four letters both phones show for a hello: SHA-256 of it, four bytes, each reduced to A–Z. */
export async function shortCode(helloBytes) {
  const digest = await sha256(helloBytes);
  return Array.from(digest.subarray(0, 4), byte => String.fromCharCode(65 + (byte % 26))).join("");
}
