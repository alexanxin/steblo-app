// Reads one camera picture with jsQR. Two of these run side by side, so a new picture can be tried
// while another is being decoded (R8). A classic worker: jsQR is a classic script.
importScripts("../vendor/jsQR.js");
self.onmessage = ({ data }) => {
  const start = performance.now();
  const hit = self.jsQR(new Uint8ClampedArray(data.pixels), data.width, data.height, { inversionAttempts: "dontInvert" });
  self.postMessage({ bytes: hit ? Uint8Array.from(hit.binaryData) : null, ms: performance.now() - start });
};
