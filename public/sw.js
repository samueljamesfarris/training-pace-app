/*
 * Offline shell for the pace app.
 *
 * Two rules, chosen for how this app is actually used:
 *
 * 1. Vite gives every JS/CSS bundle a content-hashed filename, so those are
 *    immutable — cache-first, forever, and a deploy simply asks for different
 *    names. That is what makes a dead-zone cold start work.
 *
 * 2. The HTML entry point is NOT hashed, so it is network-first with a cache
 *    fallback. Online, you always get the newest build; offline, you get the
 *    last one that loaded.
 *
 * The worker never activates itself. A new version waits until the page asks,
 * because swapping the bundle out from under a running workout is exactly the
 * failure this app cannot have. The page shows an update prompt instead.
 */

const VERSION = 'pace-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// Everything needed to boot with no network at all.
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // Individually, so one 404 can't fail the whole install.
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      ),
    ),
  );
  // Deliberately no skipWaiting(): see the note above.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** The page asks for the update when it is safe to take one. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isHashedAsset(url) {
  return /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, so a deploy is picked up as soon as there is
  // signal, and the last good page is served when there isn't.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() =>
          caches
            .match('./index.html')
            .then((cached) => cached ?? caches.match('./')),
        ),
    );
    return;
  }

  // Content-hashed bundles never change meaning: serve from cache if present.
  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (icons, manifest): cache with a network refresh behind it.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit ?? network;
    }),
  );
});
