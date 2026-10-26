// Lets the program open and work without internet.
// - Program files: ask the server for the newest copy first (so updates arrive right away); if there is no
//   internet, or the server takes longer than a few seconds, use the copy saved on this device.
// - Everything the program needs is saved when it is installed, so it opens offline even on pages not yet visited.
// - Fonts (Google Fonts) are kept too, so screens and printed bills look right offline.
const CACHE = 'kaset-shop-v21';
const FONTS = 'kaset-fonts-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/backend-cloud.js', './js/backend-local.js', './js/firebase-config.js', './js/firebase.bundle.js',
  './js/shop.js', './js/interest.js', './js/store.js', './js/xlsx.bundle.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png', './icons/icon-maskable-512.png', './icons/logo.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => fetch(u, { cache: 'no-cache' }).then((r) => r.ok && c.put(u, r)).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com') {
    // font files never change: saved copy first; the font list: saved copy, refreshed in the background
    e.respondWith(caches.open(FONTS).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; });
      if (hit) { if (url.hostname === 'fonts.googleapis.com') net.catch(() => {}); return hit; }
      return net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  const nav = req.mode === 'navigate';
  const fromCache = () => caches.match(req, { ignoreSearch: nav }).then((r) => r || (nav ? caches.match('./index.html') : undefined)).then((r) => r || Response.error());
  const net = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(nav ? './index.html' : req, copy)); }
    return res;
  });
  e.respondWith(Promise.race([net, timeout(4000)]).catch(() => caches.match(req, { ignoreSearch: nav }).then((hit) => hit || net).catch(fromCache)));
});

// Tapping a phone notification opens (or focuses) the program on the right page.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(self.registration.scope));
    if (w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
