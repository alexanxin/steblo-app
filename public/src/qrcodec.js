// Frame bytes ⇄ QR codes. The decoder is passed in, because jsQR loads differently
// in Node (require) and in the browser (classic script in a worker or page).
import qrcode from "../vendor/qrcode.mjs";
import { encode as b45, decode as unb45 } from "./base45.js";

/** @returns {{size:number, dark:(r:number,c:number)=>boolean}} */
export function toMatrix(bytes, { ec = "L", mode = "byte" } = {}) {
  const q = qrcode(0, ec);
  if (mode === "base45") q.addData(b45(bytes), "Alphanumeric");
  else q.addData(String.fromCharCode(...bytes), "Byte");
  q.make();
  return { size: q.getModuleCount(), dark: (r, c) => q.isDark(r, c) };
}

export function toRgba(m, { scale = 4, quiet = 4 } = {}) {
  const width = (m.size + quiet * 2) * scale, data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) {
    if (!m.dark(r, c)) continue;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + quiet) * scale + y) * width + (c + quiet) * scale + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  return { data, width, height: width };
}

export function readRgba({ data, width, height }, jsQR, { mode = "byte" } = {}) {
  const hit = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
  if (!hit) return null;
  return mode === "base45" ? unb45(hit.data) : Uint8Array.from(hit.binaryData);
}
