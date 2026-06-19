const CACHE_NAME = "cloud-farm-v41";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest?v=41",
  "./src/styles.css?v=41",
  "./src/game.js?v=41",
  "./assets/icon.svg",
  "./assets/art/cloud_farm_entry_bg.jpg",
  "./assets/2d/kenney/particles/flame_06.png",
  "./assets/2d/kenney/particles/smoke_07.png",
  "./assets/2d/kenney/particles/spark_06.png",
  "./assets/2d/kenney/particles/slash_01.png",
  "./assets/2d/kenney/particles/light_01.png",
  "./assets/2d/kenney/ui/panel_beige.png",
  "./assets/2d/kenney/ui/buttonLong_beige.png",
  "./assets/2d/kenney/farm/dirtFarmland_E.png",
  "./assets/2d/kenney/farm/corn_E.png",
  "./assets/2d/kenney/farm/cornYoung_S.png",
  "./assets/2d/kenney/farm/cornDouble_E.png",
  "./assets/2d/kenney/farm/fenceHigh_N.png",
  "./assets/2d/kenney/farm/fenceHigh_S.png",
  "./assets/2d/kenney/farm/fenceHigh_W.png",
  "./assets/2d/kenney/farm/sack_N.png",
  "./assets/2d/kenney/farm/hayBalesStacked_W.png",
  "./assets/2d/kenney/game-icons/trashcanOpen.png",
  "./assets/2d/kenney/game-icons/multiplayer.png",
  "./assets/2d/kenney/game-icons/medal1.png",
  "./assets/vendor/ASSET_CREDITS.md",
  "./assets/vendor/KENNEY_CC0_LICENSE.txt",
  "./assets/vendor/kenney/audio/dice-shake-3.ogg",
  "./assets/vendor/kenney/audio/chips-stack-6.ogg",
  "./assets/vendor/kenney/audio/chips-handle-1.ogg",
  "./assets/vendor/kenney/audio/card-slide-1.ogg",
  "./assets/vendor/kenney/audio/card-place-1.ogg",
  "./assets/vendor/kenney/audio/card-shuffle.ogg",
  "./assets/vendor/kenney/audio/cards-pack-open-1.ogg",
  "./assets/vendor/kenney/cards/card_back.png",
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
