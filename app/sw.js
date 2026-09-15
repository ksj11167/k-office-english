/**
 * Offline shell.
 *
 * Reviewing already-built cards needs no network at all — the deck and its
 * schedule live in localStorage — so the app should open on a train. Only
 * building new cards needs to reach a translation provider.
 *
 * Strategy: precache the shell on install, then serve the app's own files
 * cache-first and fall back to the network. API and font requests are left
 * alone; fonts are cached opportunistically as they are fetched.
 */
const VERSION = 'rte-v2';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/kakao-parser.js',
  './js/srs.js',
  './js/swipe.js',
  './js/translate.js',
  './js/job-decks.js',
  './js/platform.js',
  './vendor/ts-fsrs.mjs',
  './privacy.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname === 'api.anthropic.com') return;        // never cache model calls

  e.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok && (url.origin === location.origin || url.hostname.endsWith('gstatic.com'))) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
