// Bump this version whenever a shipped app-shell file changes.
const PREFIX = `jazz-keys:${self.registration.scope}:`;
const CACHE = `${PREFIX}v3`;
const ASSETS = [
  "./index.html",
  "./styles.css",
  "./src/app.js",
  "./src/audio.js",
  "./src/chords.js",
  "./src/input.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];
const urlFor = (path) => new URL(path, self.registration.scope).href;

self.addEventListener("install", (event) => {
  // All or nothing: never advertise offline readiness with a partial shell.
  event.waitUntil(caches.open(CACHE).then((cache) =>
    cache.addAll(ASSETS.map((path) => new Request(urlFor(path), { cache: "reload" })))));
  // No skipWaiting: a playing session keeps a consistent version until closed.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (request.mode === "navigate" &&
        (url.pathname === new URL(self.registration.scope).pathname || url.pathname === new URL(urlFor("./index.html")).pathname)) {
      const shell = await cache.match(urlFor("./index.html"));
      if (shell) return shell;
    }
    return (await cache.match(request, { ignoreSearch: true })) || fetch(request);
  })());
});
