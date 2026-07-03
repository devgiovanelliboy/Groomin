/* Groomin — Service Worker
   Estratégia online-first: não guarda shell/código em cache.
   O Firestore é a fonte de verdade; cada navegação deve buscar a versão atual.
*/
const VERSION = 'groomin-live-v24';

const OFFLINE_HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sem conexão — Groomin</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#F8FAFC;color:#111827;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}
.box{max-width:340px}.mark{width:72px;height:72px;border-radius:20px;margin:0 auto 20px;display:block}
h1{font-size:20px;margin:0 0 8px}p{color:#64748B;font-size:14.5px;line-height:1.6;margin:0 0 24px}
button{background:#7C3AED;color:#fff;border:none;border-radius:10px;padding:13px 26px;font-size:15px;font-weight:700;cursor:pointer}</style></head>
<body><div class="box"><img class="mark" src="/assets/pwa/logo-mark-192.png" alt="Groomin" onerror="this.style.display='none'">
<h1>Você está sem internet</h1><p>Não foi possível carregar o Groomin. Verifique sua conexão e tente novamente.</p>
<button onclick="location.reload()">Tentar novamente</button></div></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
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

  // Navegações, JS e CSS: sempre rede, sem cache do navegador/SW.
  if (req.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(new Request(req, { cache: 'no-store' }))
        .catch(() => new Response(req.mode === 'navigate' ? OFFLINE_HTML : 'Sem conexão.', {
          status: 503,
          headers: { 'Content-Type': req.mode === 'navigate' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' }
        }))
    );
    return;
  }

  // Ícones da marca: cache-first (aparecem até na página offline)
  if (url.pathname.startsWith('/assets/pwa/')) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => fetch(req))
    );
    return;
  }

  event.respondWith(fetch(req));
});

// ============================================================
// Push notifications (Web Push / FCM)
// ============================================================
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const n = data.notification || data;
  const title = n.title || 'Groomin';
  const options = {
    body: n.body || 'Você tem uma nova atualização.',
    icon: './assets/pwa/logo-mark-192.png',
    badge: './assets/pwa/logo-mark-192.png',
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
