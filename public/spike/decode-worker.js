importScripts("../vendor/jsQR.js");
self.onmessage = ({ data }) => {
  const start = performance.now();
  const hit = self.jsQR(new Uint8ClampedArray(data.pixels), data.width, data.height, { inversionAttempts: "dontInvert" });
  self.postMessage({ bytes: hit ? Uint8Array.from(hit.binaryData) : null, ms: performance.now() - start });
};
