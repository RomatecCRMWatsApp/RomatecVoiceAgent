// Service Worker da ZAYRA — versão atrelada à versão do app pra forçar
// rotação de cache em todo deploy. Se você bumpar a versão do app, bumpe esta
// constante também (ou no futuro, gere via build).
const CACHE = 'zayra-v1.22.1';

// App shell — recursos pequenos que podem ser cacheados.
// HTML NÃO está aqui de propósito — é network-first.
const PRECACHE = ['/avatar.png', '/manifest.json'];

// ── Install: pré-cacheia só recursos estáticos pequenos ─────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

// ── Activate: limpa caches antigos (zayra-v1.4, zayra-v1.5, etc.) ──────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

// ── Fetch: HTML/SW = network-first, assets = cache-first ──────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Rotas de API: sempre rede, nunca cacheia
  const apiRoutes = ['/text', '/voice', '/briefing', '/memory', '/notifications', '/webhook', '/zayra', '/auth', '/chat', '/health'];
  if (apiRoutes.some(r => url.pathname.startsWith(r)) || e.request.method !== 'GET') {
    e.respondWith(
      fetch(e.request).catch(() => new Response('{"error":"offline"}', {
        headers: { 'Content-Type': 'application/json' },
      })),
    );
    return;
  }

  // HTML e o próprio SW: NETWORK-FIRST.
  // Garante que o usuário sempre veja a versão mais nova disponível.
  // Se rede falhar, cai pro cache (modo offline).
  // Inclui rotas SPA-like servidas pelo Express que renderizam HTML mas
  // não terminam em .html (ex: /obras, /vto se houver no futuro).
  const HTML_ROUTES = ['/', '/obras', '/sw.js'];
  const isHtml = HTML_ROUTES.includes(url.pathname) || url.pathname.endsWith('.html');
  const isSw   = url.pathname === '/sw.js';
  if (isHtml || isSw) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/'))),
    );
    return;
  }

  // Outros assets (imagens, manifest, fontes): cache-first
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

// ── Push notifications (quando configurado com VAPID) ──────────────────────
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
