// The Milestone 0 spike page is gone. Phones that installed it still run its old service worker, which keeps serving
// the cached spike pages. This replacement takes over at once and removes itself, so those phones stop doing that.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.registration.unregister());
