// Throwaway: measures QR transfer and device features on real phones (reference R17).
import { CYCLIC, LT, blockCount, makeFrame, parseFrame, splitBlocks } from "../src/frames.js";
import { Peeler, encodeBlock } from "../src/lt.js";
import { decode as unb45 } from "../src/base45.js";
import { toMatrix } from "../src/qrcodec.js";

const $ = id => document.getElementById(id);
const number = id => Number($(id).value);
const lines = [];
const log = entry => {
  lines.push(JSON.stringify({ at: new Date().toISOString(), ...entry }));
  $("log").textContent = lines.join("\n");
};
const status = text => { $("status").textContent = text; };
const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
$("mode").textContent = `${installed ? "Installed" : "Browser tab"} · ${navigator.userAgent}`;
navigator.serviceWorker?.register("sw.js").catch(e => log({ event: "serviceWorker", error: String(e) }));

// Chrome lets a page offer its own install only once Chrome finds it installable, so the
// button doubles as the answer to "does Chrome think this can be installed?"
let installPrompt = null;
addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installPrompt = e;
  if ($("install")) $("install").hidden = false;
  log({ event: "installable", value: true });
});
addEventListener("appinstalled", () => log({ event: "installed" }));
if ($("install")) $("install").onclick = async () => { // absent in a stale cached page
  installPrompt.prompt();
  log({ event: "installPrompt", outcome: (await installPrompt.userChoice).outcome });
  installPrompt = null;
  $("install").hidden = true;
};
setTimeout(() => { if (!installPrompt && !installed) log({ event: "installable", value: false, after: "60 s" }); }, 60000);

const settings = () => ({ kb: number("kb"), block: number("block"), fps: number("fps"), ec: $("ec").value, mode: $("qrmode").value, coding: number("coding"), worker: $("worker").checked, scanPx: number("scanpx") });
let stopper = null;
const stop = () => { stopper?.(); stopper = null; $("qr").classList.remove("on"); $("video").classList.remove("on"); };
$("stop").onclick = stop;

function randomStream(bytes) {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(i + 65536, bytes)));
  return out;
}
const shortHash = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].slice(0, 4).map(b => b.toString(16).padStart(2, "0")).join("");

function draw(canvas, matrix) {
  const quiet = 4, cells = matrix.size + quiet * 2, scale = Math.max(2, Math.floor(1000 / cells));
  canvas.width = canvas.height = cells * scale;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#000";
  for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) {
    if (matrix.dark(r, c)) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
  }
}

$("show").onclick = async () => {
  stop();
  const s = settings(), stream = randomStream(s.kb * 1024), blocks = splitBlocks(stream, s.block);
  const streamId = crypto.getRandomValues(new Uint32Array(1))[0], length = stream.length;
  const lock = await navigator.wakeLock?.request("screen").catch(() => null);
  const canvas = $("qr"); canvas.classList.add("on");
  log({ event: "show", ...s, blocks: blocks.length, hash: await shortHash(stream), wakeLock: !!lock });
  let n = 0, running = true;
  const started = performance.now();
  const tick = () => {
    if (!running) return;
    const body = s.coding === LT ? encodeBlock(blocks, streamId, n) : blocks[n % blocks.length];
    draw(canvas, toMatrix(makeFrame({ streamId, length, blockSize: s.block, coding: s.coding, n }, body), { ec: s.ec, mode: s.mode }));
    n += 1;
    status(`Showing frame ${n}, ${(n / ((performance.now() - started) / 1000)).toFixed(1)} fps`);
    const next = started + n * (1000 / s.fps);
    setTimeout(tick, Math.max(0, next - performance.now()));
  };
  tick();
  stopper = () => { running = false; lock?.release(); log({ event: "stopped", frames: n, fps: n / ((performance.now() - started) / 1000) }); };
};

function collector() {
  let st = null;
  return f => {
    if (!st || st.id !== f.streamId) {
      const k = blockCount(f.length, f.blockSize);
      st = { id: f.streamId, k, peel: f.coding === LT ? new Peeler(k, f.streamId) : null, blocks: new Array(k), got: 0, first: performance.now(), ns: new Set(), low: f.n, high: f.n, length: f.length };
    }
    st.ns.add(f.n); st.low = Math.min(st.low, f.n); st.high = Math.max(st.high, f.n);
    if (st.peel) st.got = st.peel.add(f.n, f.block);
    else if (!st.blocks[f.n % st.k]) { st.blocks[f.n % st.k] = f.block.slice(); st.got += 1; }
    return st;
  };
}

$("scan").onclick = async () => {
  stop();
  const s = settings(), video = $("video");
  const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
  video.srcObject = media; video.classList.add("on"); await video.play();
  const add = collector(), grab = document.createElement("canvas"), g = grab.getContext("2d", { willReadFrequently: true });
  const worker = s.worker ? new Worker("decode-worker.js") : null;
  const scanStart = performance.now();
  let running = true, busy = false, tries = 0, hits = 0, spent = 0, last = null, firstReadMs = null;
  const take = (bytes, ms) => {
    tries += 1; spent += ms;
    if (!bytes) return;
    const f = parseFrame(s.mode === "base45" ? unb45(new TextDecoder().decode(bytes)) : bytes);
    if (!f) return;
    hits += 1;
    firstReadMs ??= performance.now() - scanStart;
    last = add(f);
    const secs = (performance.now() - last.first) / 1000;
    status(`${last.got}/${last.k} blocks, ${hits}/${tries} reads, ${(spent / tries).toFixed(0)} ms each, ${secs.toFixed(0)} s`);
    if (last.got === last.k) {
      const read = last.ns.size / (last.high - last.low + 1);
      log({ event: "done", ...s, length: last.length, seconds: secs, kbPerSec: last.length / 1024 / secs, shareRead: read, firstReadMs, reads: hits, tries, decodeMs: spent / tries, frames: last.ns.size, k: last.k });
      status(`Done: ${(last.length / 1024 / secs).toFixed(2)} KB/s in ${secs.toFixed(0)} s`);
      stop();
    }
  };
  if (worker) worker.onmessage = ({ data }) => { busy = false; take(s.mode === "base45" ? (data.text ? new TextEncoder().encode(data.text) : null) : data.bytes, data.ms); };
  const loop = () => {
    if (!running) return;
    if (!busy && video.videoWidth) {
      // The centre square, shrunk: jsQR then searches a small picture that is mostly code.
      const vw = video.videoWidth, vh = video.videoHeight, crop = Math.round(Math.min(vw, vh) * 0.8);
      if (s.scanPx) {
        grab.width = grab.height = Math.min(crop, s.scanPx);
        g.drawImage(video, (vw - crop) / 2, (vh - crop) / 2, crop, crop, 0, 0, grab.width, grab.height);
      } else {
        grab.width = vw; grab.height = vh;
        g.drawImage(video, 0, 0);
      }
      const img = g.getImageData(0, 0, grab.width, grab.height);
      if (worker) { busy = true; worker.postMessage({ pixels: img.data.buffer, width: img.width, height: img.height }, [img.data.buffer]); }
      else {
        const start = performance.now(), hit = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        take(hit ? (s.mode === "base45" ? new TextEncoder().encode(hit.data) : Uint8Array.from(hit.binaryData)) : null, performance.now() - start);
      }
    }
    requestAnimationFrame(loop);
  };
  loop();
  stopper = () => { running = false; worker?.terminate(); media.getTracks().forEach(t => t.stop()); video.srcObject = null; log({ event: "scanStopped", ...s, firstReadMs, reads: hits, tries, decodeMs: tries ? spent / tries : 0, blocks: last?.got ?? 0 }); };
};

async function attempt(name, fn) {
  try { log({ check: name, ok: true, result: await fn() }); }
  catch (e) { log({ check: name, ok: false, error: String(e) }); }
}

$("checks").onclick = async () => {
  await attempt("webcrypto", async () => {
    const pair = () => crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const a = await pair(), b = await pair();
    const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: b.publicKey }, a.privateKey, 256);
    const hkdf = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("steblo-sync-1") }, hkdf, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12)), plain = new TextEncoder().encode("hello");
    const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed));
  });
  await attempt("deflate-raw", async () => {
    const pipe = (bytes, stream) => { const w = stream.writable.getWriter(); w.write(bytes); w.close(); return new Response(stream.readable).arrayBuffer(); };
    const packed = await pipe(new Uint8Array(1000), new CompressionStream("deflate-raw"));
    return [packed.byteLength, (await pipe(new Uint8Array(packed), new DecompressionStream("deflate-raw"))).byteLength];
  });
  await attempt("wakeLock", async () => { const l = await navigator.wakeLock.request("screen"); await l.release(); return "granted"; });
  await attempt("persist", async () => [await navigator.storage.persist(), await navigator.storage.persisted(), await navigator.storage.estimate()]);
  await attempt("locks", async () => navigator.locks.request("spike", async () => "held"));
  await attempt("storageMarker", () => new Promise((done, fail) => {
    const open = indexedDB.open("spike", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("kv", "readwrite"), store = tx.objectStore("kv"), get = store.get("firstSeen");
      get.onsuccess = () => {
        const here = installed ? "installed" : "browser";
        if (get.result) done({ here, firstSeen: get.result }); else { store.put(here, "firstSeen"); done({ here, firstSeen: "new, written now" }); }
      };
    };
  }));
};

$("save").onclick = async () => {
  const file = new File([lines.join("\n")], "steblo-spike.txt", { type: "text/plain" });
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }).catch(e => log({ event: "share", error: String(e) })); log({ event: "saved", how: "share" }); return; }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: file.name });
  a.click();
  log({ event: "saved", how: "download" });
};

$("open").onchange = async e => log({ event: "opened", bytes: (await e.target.files[0]?.text())?.length });
