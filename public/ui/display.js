// The showing side of a sync: draws a stream as endless QR frames (reference R8, R17 item 5).
// LT frames, QR byte mode, error correction L, 8 frames per second. The screen is kept awake while codes show.
import { ltFrames } from "../src/frames.js";
import { toMatrix } from "../src/qrcodec.js";
import { BLOCK, FPS } from "../src/sync-flow.js";

/**
 * Hold the screen on. → { ok, release() }. `ok` is false where the browser has no Wake Lock or refuses it:
 * the screen then shows the "keep the screen awake" notice (R17). The lock is asked for again when the page
 * comes back to the front, because the browser drops it whenever the page is hidden.
 */
export async function keepAwake() {
  if (!navigator.wakeLock?.request) return { ok: false, release() {} };
  let lock = null;
  let released = false;
  const ask = async () => {
    try { lock = await navigator.wakeLock.request("screen"); } catch { lock = null; }
  };
  const again = () => { if (!released && document.visibilityState === "visible" && (!lock || lock.released)) ask(); };
  await ask();
  document.addEventListener("visibilitychange", again);
  return {
    ok: !!lock,
    release() {
      released = true;
      document.removeEventListener("visibilitychange", again);
      lock?.release().catch(() => {});
    },
  };
}

function draw(canvas, matrix) {
  const quiet = 4;
  const cells = matrix.size + quiet * 2;
  const scale = Math.max(2, Math.floor(1000 / cells));
  canvas.width = canvas.height = cells * scale;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#000";
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) if (matrix.dark(r, c)) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  }
}

/**
 * Show `bytes` as a stream of QR codes in `canvas` until stop(). → { stop(), shown(), awake } where `awake` is a
 * promise of the keepAwake result (the caller shows the fallback notice when it comes back not ok).
 */
export function showStream({ canvas, bytes, fps = FPS, blockSize = BLOCK }) {
  const streamId = crypto.getRandomValues(new Uint32Array(1))[0];
  const frames = ltFrames(bytes, { streamId, blockSize });
  const awake = keepAwake();
  let running = true;
  let n = 0;
  let timer = 0;
  let nextAt = performance.now();
  const tick = () => {
    if (!running) return;
    draw(canvas, toMatrix(frames.next().value, { ec: "L" }));
    n += 1;
    nextAt += 1000 / fps;
    const now = performance.now();
    if (nextAt < now) nextAt = now; // after a stall (a hidden page), carry on from now instead of racing to catch up
    timer = setTimeout(tick, nextAt - now);
  };
  tick();
  return {
    awake,
    shown: () => n,
    stop() {
      running = false;
      clearTimeout(timer);
      awake.then(a => a.release());
    },
  };
}
