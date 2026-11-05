// Spike only. Android Chrome offers "Install" only when a service worker has a real fetch
// handler. Network first, so every run uses the latest files; the copy lets it open offline.
const CACHE = "steblo-spike-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    })
    .catch(() => caches.match(e.request).then(hit => hit || Response.error())));
});
