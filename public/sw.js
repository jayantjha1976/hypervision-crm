/* Hypervision CRM — offline support.
   The app's own files: fetched fresh when online (so updates appear at once), cached copy when offline.
   Library files (Firebase SDK, Excel reader): versioned URLs, so the cached copy is used first.
   Firebase data/sign-in traffic is not touched here; Firebase has its own offline storage. */
const CACHE = 'hv-crm-v2';
const APP_FILES = ['/', '/index.html', '/hv-cloud-boot.js', '/hv-cloud.js', '/firebase-config.js',
  '/HVLogo.png', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/favicon-64.png'];
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const LIBS = [SDK + 'firebase-app.js', SDK + 'firebase-auth.js', SDK + 'firebase-firestore.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP_FILES);
    await Promise.all(LIBS.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isLib = (url) => url.startsWith('https://www.gstatic.com/firebasejs/') || url.startsWith('https://cdnjs.cloudflare.com/');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isLib(req.url)) {                       // cache first
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;   // everything else off-site: leave alone
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  e.respondWith((async () => {                // network first, cache when offline
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req.mode === 'navigate' ? '/index.html' : req, res.clone());
      return res;
    } catch (err) {
      const hit = await caches.match(req.mode === 'navigate' ? '/index.html' : req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});

/* ---- Notifications sent by the reminder job ---- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Hypervision CRM', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Hypervision CRM', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-64.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: /starting now|30 minutes/.test(d.title || ''),
    data: { url: d.url || '/' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if (w.url.startsWith(self.location.origin)) { await w.focus(); return; }
    await self.clients.openWindow(target);
  })());
});
