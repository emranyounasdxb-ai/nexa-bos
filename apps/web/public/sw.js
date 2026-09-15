const CACHE_PREFIX = "amafh-core-static-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const PUBLIC_ASSETS = new Set([
  "/icon1.png",
  "/icon2.png",
  "/apple-icon.png",
  "/pwa/amafh-core-maskable-512.png",
  "/brand/amafh-core-full-logo-exact.svg",
  "/brand/amafh-core-full-logo-dark.svg",
  "/brand/amafh-core-mark-exact.svg",
  "/brand/amafh-dubai-banking-login.webp",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([...PUBLIC_ASSETS]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function canCache(response) {
  return response.ok && (response.type === "basic" || response.type === "default");
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (canCache(response)) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (canCache(response)) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode === "navigate") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (PUBLIC_ASSETS.has(url.pathname)) {
    event.respondWith(networkFirst(request));
  }
});
