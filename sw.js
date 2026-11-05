// Offline support: keeps the app's files on the phone so it opens without internet.
// Bump VERSION whenever you upload changed files so phones pick up the update.
const VERSION = 'freshkeep-v2';
const FILES = [
  './',
  'index.html',
  'style.css',
  'js/app.js',
  'js/dates.js',
  'js/scanner.js',
  'js/share.js',
  'js/store.js',
  'js/ui.js',
  'js/wheel.js',
  'vendor/barcode-detector.js',
  'vendor/zxing_reader.wasm',
  'vendor/qrcode.js',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first for the app's own files (so updates show up), falling back to the cache when offline.
// The date reader (Tesseract, from jsDelivr) is cached as it's used, so it works offline afterwards.
// Product lookups and photos are left to the browser.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const own = url.origin === location.origin;
  const reader = url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('tessdata.projectnaptha.com');
  if (!own && !reader) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
