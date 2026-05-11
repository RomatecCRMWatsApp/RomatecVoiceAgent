// Service Worker da ZAYRA — versão atrelada à versão do app pra forçar
// rotação de cache em todo deploy. Se você bumpar a versão do app, bumpe esta
// constante também (ou no futuro, gere via build).
const CACHE = 'zayra-v3.4.6';

// App shell — recursos cacheados na instalação para garantir abertura offline.
// v2.4.3 P0.3: pre-cacheia também /obras e /js/catalogo-servicos.js — sem isso,
// quando o usuário abre o app sem internet em campo, o HTML não está disponível
// e o navegador mostra a tela "sem conexão" nativa. Mesmo HTML sendo
// network-first no fetch handler, o pre-cache é o fallback inicial.
const PRECACHE = [
  '/',
  '/obras',
  '/js/catalogo-servicos.js',
  '/avatar.png',
  '/manifest.json',
  '/manifest.webmanifest',
  '/manifest-obras.webmanifest',
  '/logo_R-removebg-preview.png',
  '/romatec-logo-removebg-preview.png',
];

// ── Install: pré-cacheia só recursos estáticos pequenos ─────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll é all-or-nothing: se um asset 404 (ex: manifest.json removido),
      // o install inteiro falha e o SW NUNCA atualiza. Em vez disso, tenta
      // cachear cada um individualmente e ignora os que falham.
      .then(c => Promise.all(PRECACHE.map(url =>
        c.add(url).catch(err => console.warn('[SW] precache miss', url, err.message))
      )))
      .then(() => self.skipWaiting()),
  );
});

// ── Activate: limpa caches antigos + força reload de todas as abas abertas ──
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // v1.25.1: notifica clients abertos pra recarregar quando troca de SW.
    // Sem isso, PWA standalone do iPhone fica grudado no JS antigo até
    // user fechar/reabrir manualmente o app.
    const clientList = await self.clients.matchAll({ type: 'window' });
    for (const client of clientList) {
      client.postMessage({ type: 'SW_UPDATED', cache: CACHE });
    }
  })());
});

// ── Fetch: HTML/SW = network-first, assets = cache-first ──────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Rotas de API: sempre rede, nunca cacheia
  const apiRoutes = ['/api/', '/text', '/voice', '/briefing', '/memory', '/notifications', '/webhook', '/zayra', '/auth', '/chat', '/health'];
  // v1.90.0: rotas que retornam binario (PDF, XML, imagens) NAO podem receber
  // fallback JSON — quebra o iframe/download. Pass-through sem .catch.
  const BINARY_PATTERNS = ['/pdf', '/pdf-assinado', '/preview-pdf', '/relatorio-pdf', '/danfse', '/xml', '/raw', '/foto'];
  const isBinaryEndpoint = BINARY_PATTERNS.some(p =>
    url.pathname.endsWith(p) || url.pathname.includes(p + '/') || url.pathname.includes(p + '?')
  );
  if (apiRoutes.some(r => url.pathname.startsWith(r)) || e.request.method !== 'GET') {
    if (isBinaryEndpoint) {
      e.respondWith(fetch(e.request)); // pass-through, sem fallback JSON
      return;
    }
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
  const HTML_ROUTES = ['/', '/obras', '/cartao', '/cartao/', '/sw.js'];
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

// ── SKIP_WAITING postMessage (v1.99.2: auto-update silencioso) ────────────
// Permite que o front mande SKIP_WAITING pra ativar o SW novo imediatamente
// sem precisar fechar/abrir aba. Combinado com 'controllerchange' listener no
// front, fecha o ciclo de auto-update sem botão.
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
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
