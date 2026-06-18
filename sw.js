const CACHE_NAME = "cloud-farm-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest?v=4",
  "./src/styles.css?v=4",
  "./src/game.js?v=4",
  "./assets/icon.svg",
  "./assets/world_map.jpg",
  "./assets/farmer.jpg",
  "./assets/plot_soil.jpg",
  "./assets/crops_mature.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const request = event.request;
  const wantsFresh =
    request.mode === "navigate" ||
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "manifest";

  if (wantsFresh) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
