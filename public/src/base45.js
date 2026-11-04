// RFC 9285 base45, for alphanumeric-mode QR codes.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const VALUE = new Map([...ALPHABET].map((c, i) => [c, i]));

export function encode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let n = bytes[i] * 256 + bytes[i + 1];
      const c = n % 45; n = (n - c) / 45;
      const d = n % 45; n = (n - d) / 45;
      out += ALPHABET[c] + ALPHABET[d] + ALPHABET[n];
    } else {
      const n = bytes[i], c = n % 45;
      out += ALPHABET[c] + ALPHABET[(n - c) / 45];
    }
  }
  return out;
}

export function decode(text) {
  const out = new Uint8Array(Math.floor(text.length / 3) * 2 + (text.length % 3 === 2 ? 1 : 0));
  let o = 0;
  for (let i = 0; i < text.length; i += 3) {
    const c = VALUE.get(text[i]), d = VALUE.get(text[i + 1]);
    if (c === undefined || d === undefined) throw new Error("bad base45");
    if (i + 2 < text.length) {
      const e = VALUE.get(text[i + 2]);
      if (e === undefined) throw new Error("bad base45");
      const n = c + d * 45 + e * 2025;
      if (n > 65535) throw new Error("bad base45");
      out[o++] = n >> 8;
      out[o++] = n & 255;
    } else {
      const n = c + d * 45;
      if (n > 255) throw new Error("bad base45");
      out[o++] = n;
    }
  }
  return out;
}
