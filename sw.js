/* BarberOS — Service Worker
   Estratégia: precache do app shell + stale-while-revalidate para o resto
   (inclui CDNs de fonte e Chart.js, cacheados na primeira visita online).
*/
const VERSION = 'barberos-v14';
const APP_SHELL = [
  './',
  './index.html',
  './app/index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './js/firebase-config.js',
  './js/firebase-adapter.js',
  './js/01-icons.js',
  './js/02-data-core.js',
  './js/03-analytics-landing.js',
  './js/04-public-booking.js',
  './js/05-admin.js',
  './js/06-dashboard.js',
  './js/07-marketplace-boot.js',
  './js/08-pos.js',
  './js/09-pwa.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  // Navegações: network-first com fallback para o shell offline.
  if (req.mode === 'navigate') {
    const shell = url.pathname === '/app' || url.pathname.startsWith('/app/') ? './app/index.html' : './index.html';
    event.respondWith(
      fetch(req).catch(() => caches.match(shell).then((r) => r || caches.match('./')))
    );
    return;
  }

  // JS e CSS: network-first — clientes sempre executam a versão mais recente.
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Demais assets (imagens, fontes, CDN): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// ============================================================
// Push notifications (Web Push / FCM)
// ============================================================
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const n = data.notification || data;
  const title = n.title || 'BarberOS';
  const options = {
    body: n.body || 'Você tem uma nova atualização.',
    icon: './icon.svg',
    badge: './icon.svg',
    tag: n.tag || 'barberos',
    data: { url: (data.fcmOptions && data.fcmOptions.link) || n.click_action || './' },
    vibrate: [60, 30, 60]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// ============================================================
// Background sync — avisa os clientes para reprocessar a fila.
// (O Firestore já reenfileira escritas offline automaticamente;
//  este gancho serve para revalidação/refresh proativo.)
// ============================================================
self.addEventListener('sync', (event) => {
  if (event.tag === 'barberos-sync') {
    event.waitUntil(
      self.clients.matchAll().then((list) => list.forEach((c) => c.postMessage({ type: 'SYNC' })))
    );
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'barberos-refresh') {
    event.waitUntil(
      self.clients.matchAll().then((list) => list.forEach((c) => c.postMessage({ type: 'REFRESH' })))
    );
  }
});
