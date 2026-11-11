// The camera side of a sync: reads QR frames and hands the finished stream over (reference R8).
// Settings pinned by the spike (docs/specs/spike-results.md): jsQR in 2 workers, on the centre 80% square of the
// camera picture shrunk to at most 640 px. Frames go to a Collector, which peels the LT blocks.
import { Collector, parseFrame } from "../src/frames.js";
import { missShare } from "../src/sync-flow.js";

const WORKERS = 2;
const CROP = 0.8;
const SCAN_PX = 640;

/** Whether this device could scan at all: a camera API and at least one video input. */
export async function hasCamera() {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) return false;
  try {
    const devices = await media.enumerateDevices();
    return devices.length === 0 || devices.some(d => d.kind === "videoinput");
  } catch {
    return true;
  }
}

/** The kind of failure getUserMedia gave: "denied", "nocamera" or "failed". */
export function cameraFailure(err) {
  const name = err?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "nocamera";
  return "failed";
}

/**
 * Ask the camera for continuous focus where it can, and report the zoom range where it has one.
 * A camera that lacks a setting, or has no capabilities API (Safari, older Chrome), is left as it is: no errors.
 * → { zoom: { min, max, step, value } | null, setZoom(value) }
 */
export function tuneCamera(track) {
  let caps = {};
  try { caps = track?.getCapabilities?.() ?? {}; } catch { caps = {}; }
  const apply = advanced => {
    try { Promise.resolve(track.applyConstraints({ advanced: [advanced] })).catch(() => {}); } catch { /* unsupported: ignore */ }
  };
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) apply({ focusMode: "continuous" });
  const z = caps.zoom;
  const usable = z && typeof z.min === "number" && typeof z.max === "number" && z.max > z.min;
  let value = 1;
  if (usable) {
    try { const current = track.getSettings?.().zoom; if (typeof current === "number") value = current; } catch { /* keep the default */ }
    value = Math.min(z.max, Math.max(z.min, value));
  }
  const modes = Array.isArray(caps.focusMode) ? caps.focusMode : [];
  // Some phones (a Galaxy S23+) open focused far away and never refocus alone: nudge with a one-shot, then back to continuous.
  const refocus = () => {
    if (modes.includes("single-shot")) apply({ focusMode: "single-shot" });
    if (modes.includes("continuous")) setTimeout(() => apply({ focusMode: "continuous" }), 600);
  };
  return {
    refocus,
    zoom: usable ? { min: z.min, max: z.max, step: z.step > 0 ? z.step : (z.max - z.min) / 20, value } : null,
    setZoom: v => apply({ zoom: v }),
  };
}

/**
 * Start the camera in `video` and read frames until one stream is whole.
 * `onProgress({ received, total, distinct, q, samples })` runs on every new frame; `onDone(bytes)` once, at the end.
 * → { stop(), stats(), zoom, setZoom(value) }; `zoom` is null where the camera can't zoom. Rejects with { code: "denied" | "nocamera" | "failed" } if the camera won't start.
 */
export async function startScanner({ video, onProgress, onDone }) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("no camera API"), { code: "nocamera" });
  let media;
  try {
    media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", advanced: [{ focusMode: "continuous" }], width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
  } catch (err) {
    throw Object.assign(new Error(String(err?.message || err)), { code: cameraFailure(err) });
  }
  const tuned = tuneCamera(media.getVideoTracks?.()[0]);
  video.srcObject = media;
  video.muted = true;
  video.setAttribute("playsinline", "");
  try { await video.play(); } catch { /* autoplay can refuse; the picture still arrives once it starts */ }
  tuned.refocus(); // once the picture runs, focus again: a phone that opened out of focus stays that way otherwise
  const onTap = () => tuned.refocus();
  video.addEventListener("click", onTap);

  const collector = new Collector();
  const grab = document.createElement("canvas");
  const g = grab.getContext("2d", { willReadFrequently: true });
  const pool = Array.from({ length: WORKERS }, () => ({ worker: new Worker(new URL("decode-worker.js", import.meta.url)), busy: false }));
  const t0 = performance.now();
  let running = true;
  let tries = 0;
  let reads = 0;
  let decodeMs = 0;
  let firstReadMs = null;
  let seen = null; // { id, ns: Set, low, high } for the stream the collector is on
  let samples = []; // { t, distinct } for the time-left estimate

  const stats = () => ({ tries, reads, decodeMs: tries ? decodeMs / tries : 0, firstReadMs });
  const stop = () => {
    if (!running) return;
    running = false;
    for (const p of pool) p.worker.terminate();
    video.removeEventListener("click", onTap);
    for (const track of media.getTracks()) track.stop();
    video.srcObject = null;
  };

  function take(bytes, ms) {
    tries += 1;
    decodeMs += ms;
    if (!bytes || !running) return;
    const frame = parseFrame(bytes);
    if (!frame) return;
    reads += 1;
    firstReadMs ??= performance.now() - t0;
    const progress = collector.add(bytes);
    const id = collector.stream?.id;
    if (!seen || seen.id !== id) { seen = { id, ns: new Set(), low: frame.n, high: frame.n }; samples = []; }
    if (frame.streamId === id) {
      seen.ns.add(frame.n);
      seen.low = Math.min(seen.low, frame.n);
      seen.high = Math.max(seen.high, frame.n);
    }
    const now = performance.now();
    samples.push({ t: now, distinct: seen.ns.size });
    if (samples.length > 400) samples = samples.slice(-200);
    const q = missShare({ distinct: seen.ns.size, low: seen.low, high: seen.high });
    onProgress?.({ received: progress.received, total: progress.total, distinct: seen.ns.size, q, samples, now });
    if (progress.done) {
      const bytesOut = collector.bytes();
      stop();
      onDone(bytesOut);
    }
  }

  for (const slot of pool) {
    slot.worker.onmessage = ({ data }) => { slot.busy = false; take(data.bytes, data.ms); };
    slot.worker.onerror = () => { slot.busy = false; };
  }

  const loop = () => {
    if (!running) return;
    const slot = pool.find(p => !p.busy);
    if (slot && video.videoWidth) {
      // The centre square, shrunk: jsQR then searches a small picture that is mostly code.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const crop = Math.round(Math.min(vw, vh) * CROP);
      grab.width = grab.height = Math.min(crop, SCAN_PX);
      g.drawImage(video, (vw - crop) / 2, (vh - crop) / 2, crop, crop, 0, 0, grab.width, grab.height);
      const img = g.getImageData(0, 0, grab.width, grab.height);
      slot.busy = true;
      slot.worker.postMessage({ pixels: img.data.buffer, width: img.width, height: img.height }, [img.data.buffer]);
    }
    requestAnimationFrame(loop);
  };
  loop();
  return { stop, stats, zoom: tuned.zoom, setZoom: tuned.setZoom };
}
