const CACHE = 'zayra-v1.4';
const SHELL = ['/', '/avatar.png', '/manifest.json'];

// Instala e cacheia o app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

// Ativa e limpa caches antigos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

// Fetch: Network-first para API, Cache-first para assets estáticos
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Rotas de API sempre via rede (sem cache)
  const apiRoutes = ['/text', '/voice', '/briefing', '/memory', '/notifications', '/webhook', '/zayra', '/auth'];
  if (apiRoutes.some(r => url.pathname.startsWith(r)) || e.request.method !== 'GET') {
    e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // Assets estáticos: cache first, fallback network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.url.startsWith(self.location.origin)) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/'));
    }),
  );
});

// Push notifications (quando configurado)
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  e.waitUntil(
    self.registration.showNotification(data.title ?? 'ZAYRA — Romatec', {
      body:    data.message ?? '',
      icon:    '/avatar.png',
      badge:   '/avatar.png',
      vibrate: [200, 100, 200],
      data:    { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url ?? '/'));
});
