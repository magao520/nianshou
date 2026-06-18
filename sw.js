const CACHE_NAME = "survival-3d-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest?v=19",
  "./src/styles.css?v=19",
  "./src/game.js?v=19",
  "./assets/icon.svg",
  "./assets/vendor/three.module.js",
  "./assets/vendor/loaders/GLTFLoader.js",
  "./assets/vendor/utils/BufferGeometryUtils.js",
  "./assets/models/kenney/survival/tree.glb",
  "./assets/models/kenney/survival/tree-tall.glb",
  "./assets/models/kenney/survival/rock-a.glb",
  "./assets/models/kenney/survival/rock-c.glb",
  "./assets/models/kenney/survival/grass-large.glb",
  "./assets/models/kenney/survival/patch-grass-large.glb",
  "./assets/models/kenney/survival/campfire-pit.glb",
  "./assets/models/kenney/survival/tent.glb",
  "./assets/models/kenney/survival/structure-floor.glb",
  "./assets/models/kenney/survival/chest.glb",
  "./assets/models/kenney/nature/plant_bushSmall.glb",
  "./assets/models/kenney/nature/tree_palmBend.glb",
  "./assets/models/kenney/nature/rock_largeA.glb",
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
