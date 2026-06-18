const CACHE_NAME = "survival-2d-ultimate-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest?v=26",
  "./src/styles.css?v=26",
  "./src/game.js?v=26",
  "./assets/icon.svg",
  "./assets/2d/kenney/particles/flame_06.png",
  "./assets/2d/kenney/particles/smoke_07.png",
  "./assets/2d/kenney/particles/spark_06.png",
  "./assets/2d/kenney/particles/slash_01.png",
  "./assets/2d/kenney/particles/light_01.png",
  "./assets/2d/kenney/ui/panel_beige.png",
  "./assets/2d/kenney/ui/buttonLong_beige.png",
  "./assets/vendor/ASSET_CREDITS.md",
  "./assets/vendor/KENNEY_CC0_LICENSE.txt",
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
