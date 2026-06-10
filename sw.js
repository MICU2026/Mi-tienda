const CACHE = 'micustore-v11';
const ASSETS = [
  './', './index.html', './app.js', './firebase-api.js',
  './manifest.webmanifest', './icon-192.svg', './icon-512.svg',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];
const NO_CACHE_HOSTS = ['firebaseio.com', 'firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'firebasestorage.googleapis.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (NO_CACHE_HOSTS.some(h => req.url.includes(h))) return;
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        const url = req.url;
        const cacheable = res && res.status === 200 && (url.startsWith(self.location.origin) || ASSETS.includes(url) || url.includes('gstatic.com/firebasejs'));
        if (cacheable) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
