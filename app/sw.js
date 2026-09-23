/**
 * Offline shell.
 *
 * Reviewing already-built cards needs no network at all — the conversation and
 * its schedule live in localStorage — so the app should open on a train. Only
 * translating a new day needs to reach a provider.
 *
 * Strategy: precache the shell on install, then serve the app's own files
 * stale-while-revalidate — the cached copy answers immediately and a fresh copy
 * is fetched in the background for next time.
 *
 * That last part is not a detail. A plain cache-first worker with a fixed cache
 * name pins every visitor to whatever version they happened to load first: ship
 * a fix and the people who already opened the app never see it. Revalidating
 * means a release reaches them on their second load, and it also means a file
 * missing from SHELL heals itself instead of staying broken offline forever.
 *
 * Google Fonts files are content-addressed, so those stay cache-first.
 */
const VERSION = 'koe-v3';
const SHARE_KEY = './__shared-export';
const SHELL = [
  './',
  './index.html',
  './privacy.html',
  './styles.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/kakao-parser.js',
  './js/srs.js',
  './js/swipe.js',
  './js/translate.js',
  './js/platform.js',
  './vendor/ts-fsrs.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // One bad URL must not fail the whole install, or the app has no shell at all.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/* An installed PWA on Android can be a share target, which is the half of
   "stop exporting by hand every time" that the web can solve. The share arrives
   here as a POST, not as a navigation, so the worker has to catch it, stash the
   text, and send the browser to the app — which then picks it up. */
self.addEventListener('fetch', (e) => {
  const { request } = e;

  if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/')) {
    e.respondWith((async () => {
      let text = '';
      try {
        const form = await request.formData();
        const file = form.get('file');
        if (file && typeof file.text === 'function') text = await file.text();
        if (!text) text = String(form.get('text') || '');
      } catch { /* a share we cannot read is not worth a crash */ }

      if (text.trim()) {
        const c = await caches.open(VERSION);
        await c.put(SHARE_KEY, new Response(text, { headers: { 'content-type': 'text/plain' } }));
      }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.hostname === 'api.anthropic.com') return;          // never cache model calls

  const sameOrigin = url.origin === location.origin;
  const font = url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com');
  if (!sameOrigin && !font) return;

  if (font) {
    e.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(request, res.clone()));
        return res;
      })),
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((hit) => {
      const fresh = fetch(request)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => hit || caches.match('./index.html'));
      // Cached copy now, fresh copy for next time. With nothing cached, wait.
      return hit || fresh;
    }),
  );
});
