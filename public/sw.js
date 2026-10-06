const CACHE = "orda-shell-v1";
const SHELL = ["/offline", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline")));
    return;
  }
  if (!url.pathname.startsWith("/_next/static/") && !url.pathname.startsWith("/_next/image") && url.pathname !== "/manifest.webmanifest") return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok && response.type === "basic") caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_PRIVATE_DATA") return;
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
    new Promise((resolve) => {
      const request = indexedDB.deleteDatabase("orda-offline-v1");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    }),
  ]));
});
