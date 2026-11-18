// v3.182.0 — Motor do mapa dos lotes (Leaflet 2D + MapLibre 3D, bases Mapa/Satélite/Relevo,
// lote que sobe ao clicar, tela cheia). Compartilhado pela Gestão de PA (pa.html) e pelo
// mapa público dos associados (/pa/mapa/<token>). Usa `esc` global da página.

function carregarLeaflet(){
  if (window.L) return Promise.resolve(window.L);
  if (carregarLeaflet.p) return carregarLeaflet.p;
  carregarLeaflet.p = new Promise((ok, falha) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = () => ok(window.L); js.onerror = () => { carregarLeaflet.p = null; falha(new Error('não foi possível carregar o mapa (sem internet?)')); };
    document.head.appendChild(js);
  });
  return carregarLeaflet.p;
}
const BASES_MAPA = {
  mapa: ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }],
  satelite: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagem © Esri' }],
  relevo: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA) · relevo e curvas de nível' }],
};
// v3.156.0: Mapa 2D (Leaflet) e Mapa 3D (MapLibre — lotes em relevo; clicar sobe o lote, igual ao Mapa 3D do CRM)
function carregarMapLibre(){
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (carregarMapLibre.p) return carregarMapLibre.p;
  carregarMapLibre.p = new Promise((ok, falha) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
    js.onload = () => ok(window.maplibregl); js.onerror = () => { carregarMapLibre.p = null; falha(new Error('não foi possível carregar o mapa 3D (sem internet?)')); };
    document.head.appendChild(js);
  });
  return carregarMapLibre.p;
}
const TILES_3D = {
  mapa: { tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png', 'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'], maxzoom: 19, attribution: '© OpenStreetMap' },
  satelite: { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19, attribution: 'Imagem © Esri' },
  relevo: { tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'], maxzoom: 17, attribution: '© OpenTopoMap (CC-BY-SA) · relevo e curvas de nível' },
};
const ICO_CHEIA = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICO_SAIR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
/** v3.163.1: botão de tela cheia dentro do mapa (canto de cima à direita, acima do zoom) — igual ao do CRM. */
function controleTelaCheia(box, classe){
  const el = document.createElement('div'); el.className = classe + ' ml-fsctl';
  const cheia = !!(box.parentElement && box.parentElement.classList.contains('cheia'));
  el.innerHTML = `<button type="button" class="ml-fsico" title="${cheia ? 'Sair da tela cheia' : 'Tela cheia'}" aria-label="Tela cheia">${cheia ? ICO_SAIR : ICO_CHEIA}</button>`;
  el.querySelector('button').onclick = (e) => { e.preventDefault(); e.stopPropagation(); alternarTelaCheia(box.parentElement); };
  return el;
}
const BASE_LEMBRADA = {};
function aplicarBaseLembrada(ctx){
  const b = BASE_LEMBRADA[ctx.baseSel];
  if (!b || b === 'mapa') return;
  const bt = document.querySelector(ctx.baseSel.replace('[data-base]', `[data-base="${b}"]`));
  if (bt && bt.onclick) bt.onclick();
}
function redimensionarMapa(w){
  const box = w.querySelector('.ml-mapa') || {}, m = box.__mapa;
  [60, 350].forEach((t) => setTimeout(() => {
    try { if (m && m.resize) m.resize(); if (m && m.invalidateSize) m.invalidateSize(); if (t === 350 && box.__ajustar) box.__ajustar(); } catch { /* ok */ }
  }, t));
}
function alternarTelaCheia(w){
  if (!w) return;
  const sair = w.classList.contains('cheia');
  const card = w.closest('.card');
  const temBotaoCabecalho = !!(card && card.querySelector('.ml-fullbtn'));
  let bt = w.querySelector(':scope > .ml-full');
  if (!sair && !bt && !temBotaoCabecalho) { bt = document.createElement('button'); bt.type = 'button'; bt.className = 'ml-full'; bt.dataset.temp = '1'; w.appendChild(bt); }
  if (sair) {
    w.classList.remove('cheia'); document.body.classList.remove('ml-travado');
    (w.__movidos || []).forEach(({ el, ph }) => ph.replaceWith(el)); w.__movidos = null;
    w.querySelectorAll(':scope > .ml-fsbar').forEach((x) => x.remove());
    if (document.fullscreenElement === w || document.webkitFullscreenElement === w) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch { /* ok */ } }
    if (bt && bt.dataset.temp) bt.remove(); else if (bt) bt.textContent = '⛶ Tela cheia';
    if (card) card.querySelectorAll('.ml-fullbtn').forEach((x) => { x.textContent = '⛶ Tela cheia'; });
    w.querySelectorAll('.ml-fsico').forEach((x) => { x.innerHTML = ICO_CHEIA; x.title = 'Tela cheia'; });
  } else {
    w.classList.add('cheia'); document.body.classList.add('ml-travado');
    // leva para dentro do mapa os botões Mapa/Satélite/Relevo e 2D/3D/Tela cheia (voltam ao sair)
    const mover = card ? [card.querySelector('.ml-modo'), card.querySelector('.mlBase, .pgBase, .dvBase')].filter(Boolean) : [];
    if (mover.length) {
      const barra = document.createElement('div'); barra.className = 'ml-fsbar';
      w.__movidos = mover.map((el) => { const ph = document.createComment('ml-fs'); el.replaceWith(ph); barra.appendChild(el); return { el, ph }; });
      w.appendChild(barra);
    }
    if (bt) bt.textContent = '✕ Sair da tela cheia';
    if (card) card.querySelectorAll('.ml-fullbtn').forEach((x) => { x.textContent = '✕ Sair da tela cheia'; });
    w.querySelectorAll('.ml-fsico').forEach((x) => { x.innerHTML = ICO_SAIR; x.title = 'Sair da tela cheia'; });
    const f = w.requestFullscreen || w.webkitRequestFullscreen; // computador/Android: esconde também a barra do navegador
    if (f) { try { const r = f.call(w); if (r && r.catch) r.catch(() => {}); } catch { /* ok */ } }
  }
  redimensionarMapa(w);
}
document.addEventListener('click', (e) => {
  if (!e.target.closest) return;
  const b = e.target.closest('.ml-full');
  if (b) { alternarTelaCheia(b.parentElement); return; }
  const f = e.target.closest('.ml-fullbtn');
  if (f) { const w = f.closest('.ml-wrap') || (f.closest('.card') && f.closest('.card').querySelector('.ml-wrap')); alternarTelaCheia(w); }
});
const aoSairFullscreen = () => { if (document.fullscreenElement || document.webkitFullscreenElement) return; document.querySelectorAll('.cheia').forEach((w) => alternarTelaCheia(w)); };
document.addEventListener('fullscreenchange', aoSairFullscreen);
document.addEventListener('webkitfullscreenchange', aoSairFullscreen);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.cheia').forEach((w) => alternarTelaCheia(w)); });
function modoMapaLotes(){ try { return localStorage.getItem('pa_mapa_modo') === '2d' ? '2d' : '3d'; } catch { return '3d'; } }
function mapaLotes2D(L, box, ctx){
  const mapa = L.map(box, { zoomControl: true, scrollWheelZoom: true, zoomSnap: .25, zoomDelta: .5 });
  box.__mapa = mapa;
  const CtlCheia = L.Control.extend({ options: { position: 'topright' }, onAdd: () => { const el = controleTelaCheia(box, 'leaflet-bar ml-fsctl-l'); L.DomEvent.disableClickPropagation(el); return el; } });
  new CtlCheia().addTo(mapa);
  let base = L.tileLayer(...BASES_MAPA.mapa).addTo(mapa);
  const camadas = {};
  let atual = null;
  document.querySelectorAll(ctx.baseSel).forEach((b) => {
    b.className = 'btn btn-sm ' + (b.dataset.base === 'mapa' ? 'btn-primary' : 'btn-ghost');
    b.onclick = () => {
      mapa.removeLayer(base); base = L.tileLayer(...BASES_MAPA[b.dataset.base]).addTo(mapa); base.bringToBack();
      BASE_LEMBRADA[ctx.baseSel] = b.dataset.base;
      document.querySelectorAll(ctx.baseSel).forEach((x) => x.className = 'btn btn-sm ' + (x === b ? 'btn-primary' : 'btn-ghost'));
    };
  });
  const estilo = { APP: { color: '#3E8E41', weight: 1, fillColor: '#9FD08A', fillOpacity: .45 }, COMUNITARIA: { color: '#A07A10', weight: 1.5, fillColor: '#F1DFA4', fillOpacity: .75 },
    ESTRADA: { color: '#8C5A2B', weight: 3 }, AGUA: { color: '#2B6CB0', weight: 1.6 }, OUTRA: { color: '#999', weight: 1 },
    PERIMETRO: { color: '#0C3320', weight: 3, dashArray: '8 5', fill: false }, VILA: { color: '#B3261E', weight: 2, dashArray: '4 4', fill: false } };
  estilo.LOTE_CTX = { color: '#ffffff', weight: 1.2, opacity: .9, fill: false };
  estilo.DIVISA = { color: '#C62828', weight: 3.5, dashArray: '14 5 3 5' };
  L.geoJSON({ type: 'FeatureCollection', features: ctx.outros || ctx.geo.features.filter((f) => f.properties.tipo !== 'LOTE') }, {
    style: (f) => estilo[f.properties.tipo] || estilo.OUTRA, interactive: false,
  }).addTo(mapa);
  const corLote = (f, s) => s ? (f.properties.cor ? f.properties.cor : '#2F5FD0') : f.properties.cor || (f.properties.beneficiario ? '#9CC46A' : '#F3E3C3');
  const borda = (f) => ctx.borda ? ctx.borda : f.properties.cor ? '#0C3320' : f.properties.beneficiario ? '#6E9E3A' : '#ffffff';
  const opF = ctx.opacFill ?? .12;
  const lotes = L.geoJSON({ type: 'FeatureCollection', features: ctx.lotesF }, {
    style: (f) => ({ color: borda(f), weight: ctx.borda ? 3 : 1.8, dashArray: ctx.borda ? '8 5' : null, fillColor: corLote(f, false), fillOpacity: opF }),
    onEachFeature: (f, ly) => {
      camadas[f.properties.lote] = ly;
      ly.bindTooltip(ctx.rotulo ? ctx.rotulo(f) : 'LT-' + f.properties.lote, { permanent: true, direction: 'center', className: 'ml-rot' });
      ly.on('click', () => ctx.selecionar(f.properties.lote, true));
    },
  }).addTo(mapa);
  mapa.fitBounds(lotes.getBounds(), { padding: [12, 12] });
  box.__ajustar = () => mapa.fitBounds(lotes.getBounds(), { padding: [16, 16] });
  aplicarBaseLembrada(ctx);
  // v3.159.0: pontos clicáveis (vértices do perímetro)
  const pts2 = {};
  for (const pt of ctx.pontos || []) {
    pts2[pt.id] = L.circleMarker([pt.lngLat[1], pt.lngLat[0]], { radius: pt.cor ? 6 : 5, color: '#fff', weight: 1.5, fillColor: pt.cor || '#B3261E', fillOpacity: 1 })
      .bindTooltip(pt.nome, { permanent: true, direction: 'top', offset: [0, -4], className: 'ml-rot ml-rotv' }).on('click', () => ctx.selPonto(pt.id)).addTo(mapa);
  }
  let ptAtual = null;
  return {
    mapa, parar: () => {},
    limpar(){
      if (atual && camadas[atual]) camadas[atual].setStyle({ fillColor: corLote(camadas[atual].feature, false), color: borda(camadas[atual].feature), weight: ctx.borda ? 3 : 1.8, fillOpacity: opF });
      atual = null;
    },
    marcarPonto(id){
      if (ptAtual != null && pts2[ptAtual]) { const pa = (ctx.pontos || []).find((x) => x.id === ptAtual); pts2[ptAtual].setStyle({ radius: pa && pa.cor ? 6 : 5, fillColor: (pa && pa.cor) || '#B3261E' }); }
      ptAtual = id; const m = pts2[id]; if (!m) return; m.setStyle({ radius: 9, fillColor: '#2F5FD0' }); m.bringToFront();
      mapa.setView(m.getLatLng(), Math.max(mapa.getZoom(), 15));
    },
    marcar(lote, centralizar){
      const ly = camadas[lote];
      if (atual && camadas[atual]) camadas[atual].setStyle({ fillColor: corLote(camadas[atual].feature, false), color: borda(camadas[atual].feature), weight: ctx.borda ? 3 : 1.8, fillOpacity: opF });
      atual = lote; ly.setStyle({ fillColor: corLote(ly.feature, true), color: '#1E3F99', weight: 3, fillOpacity: ctx.opacSel2d ?? .7 }); ly.bringToFront();
      if (centralizar) mapa.fitBounds(ly.getBounds(), { padding: [60, 60], maxZoom: 16 });
    },
  };
}
function mapaLotes3D(maplibregl, box, ctx){
  const anel = (f) => f.geometry.coordinates[0];
  const bbox = (pts) => pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const centro = (pts) => { // centróide do polígono (cai fora só em lote muito côncavo; aí usa o centro do bbox)
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; const k = x0 * y1 - x1 * y0; a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k; }
    if (Math.abs(a) < 1e-14) { const b = bbox(pts); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
    return [cx / (3 * a), cy / (3 * a)];
  };
  const tot = bbox(ctx.lotesF.flatMap(anel));
  // altura das placas proporcional ao tamanho do loteamento (lote rural de dezenas de ha ≠ lote urbano)
  const diag = Math.hypot((tot[2] - tot[0]) * 111320 * Math.cos(((tot[1] + tot[3]) / 2) * Math.PI / 180), (tot[3] - tot[1]) * 110540);
  const H = { relevo: Math.max(5, diag * .006), sobe: Math.max(15, diag * .022) };
  let relevo = 'relevo', atual = null, girando = false, rafGiro = 0, rafSobe = 0, ptAtual = null;
  const marcadores = {};
  const cor = ['case', ['==', ['get', 'tem'], 1], '#9CC46A', '#FFFFFF'];
  const lotesGeo = { type: 'FeatureCollection', features: ctx.lotesF.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { lote: f.properties.lote, tem: f.properties.beneficiario ? 1 : 0, cor: f.properties.cor || null } })) };
  const outros = ctx.outros || ctx.geo.features.filter((f) => f.properties.tipo !== 'LOTE');
  const fc = (tipos, poly) => ({ type: 'FeatureCollection', features: outros.filter((f) => tipos.includes(f.properties.tipo) && (poly === undefined || (f.geometry.type === 'Polygon') === poly)) });
  const mapa = new maplibregl.Map({
    container: box, attributionControl: { compact: true }, maxPitch: 75, antialias: true,
    style: { version: 8, sources: { base: { type: 'raster', tileSize: 256, ...TILES_3D.mapa } },
      layers: [{ id: 'fundo', type: 'background', paint: { 'background-color': '#DDE6CF' } },
        { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': .55, 'raster-saturation': -.6 } }] },
    bounds: [[tot[0], tot[1]], [tot[2], tot[3]]], fitBoundsOptions: { padding: 30 },
  });
  mapa.addControl({ onAdd: () => controleTelaCheia(box, 'maplibregl-ctrl maplibregl-ctrl-group'), onRemove: () => {} }, 'top-right');
  mapa.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  box.__mapa = mapa;
  box.__ajustar = () => {
    const cam = mapa.cameraForBounds([[tot[0], tot[1]], [tot[2], tot[3]]], { padding: 40, bearing: mapa.getBearing() });
    if (cam) mapa.easeTo({ center: cam.center, zoom: cam.zoom + (mapa.getPitch() > 20 ? (ctx.zoomExtra ?? .6) : 0), duration: 600 });
  };
  mapa.on('load', () => {
    mapa.addSource('outros', { type: 'geojson', data: fc(['APP', 'COMUNITARIA', 'ESTRADA', 'AGUA', 'OUTRA', 'PERIMETRO', 'VILA', 'LOTE_CTX', 'DIVISA']) });
    mapa.addLayer({ id: 'ctxlotes', type: 'line', source: 'outros', filter: ['==', ['get', 'tipo'], 'LOTE_CTX'], paint: { 'line-color': '#FFFFFF', 'line-width': 1.1, 'line-opacity': .85 } });
    mapa.addSource('lotes', { type: 'geojson', data: lotesGeo });
    mapa.addLayer({ id: 'app', type: 'fill', source: 'outros', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'tipo'], 'APP']], paint: { 'fill-color': '#9FD08A', 'fill-opacity': .35 } });
    mapa.addLayer({ id: 'com', type: 'fill', source: 'outros', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'tipo'], 'COMUNITARIA']], paint: { 'fill-color': '#F1DFA4', 'fill-opacity': .5 } });
    mapa.addLayer({ id: 'estrada', type: 'line', source: 'outros', filter: ['==', ['get', 'tipo'], 'ESTRADA'], paint: { 'line-color': '#8C5A2B', 'line-width': 3 } });
    mapa.addLayer({ id: 'agua', type: 'line', source: 'outros', filter: ['==', ['get', 'tipo'], 'AGUA'], paint: { 'line-color': '#2B6CB0', 'line-width': 2 } });
    mapa.addLayer({ id: 'per', type: 'line', source: 'outros', filter: ['==', ['get', 'tipo'], 'PERIMETRO'], paint: { 'line-color': '#0C3320', 'line-width': 2.5, 'line-dasharray': [3, 2] } });
    mapa.addLayer({ id: 'divisa', type: 'line', source: 'outros', filter: ['==', ['get', 'tipo'], 'DIVISA'], paint: { 'line-color': '#C62828', 'line-width': 3.5, 'line-dasharray': [4, 1.5, 1, 1.5] } });
    mapa.addLayer({ id: 'vila', type: 'line', source: 'outros', filter: ['==', ['get', 'tipo'], 'VILA'], paint: { 'line-color': '#B3261E', 'line-width': 2, 'line-dasharray': [2, 2] } });
    // v3.157.0: lotes transparentes (vê-se a imagem por baixo); só o clicado sobe em azul
    mapa.addLayer({ id: 'lotes3d', type: 'fill', source: 'lotes', filter: ['!=', ['get', 'lote'], ''], paint: { 'fill-color': ['coalesce', ['get', 'cor'], cor], 'fill-opacity': ctx.opacFill ?? .12 } });
    mapa.addLayer({ id: 'lotesborda', type: 'line', source: 'lotes', paint: ctx.borda ? { 'line-color': ctx.borda, 'line-width': 3, 'line-dasharray': [3, 2] } : ctx.bordaCor ? { 'line-color': ctx.bordaCor, 'line-width': 2.5 } : { 'line-color': ['case', ['==', ['get', 'tem'], 1], '#9CC46A', '#FFFFFF'], 'line-width': 1.8, 'line-opacity': .95 } });
    mapa.addLayer({ id: 'lotesel', type: 'fill-extrusion', source: 'lotes', filter: ['==', ['get', 'lote'], ''],
      paint: { 'fill-extrusion-color': ['coalesce', ['get', 'cor'], '#2F5FD0'], 'fill-extrusion-height': H.relevo, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': ctx.opacSel3d ?? .97, 'fill-extrusion-vertical-gradient': true } });
    for (const id of ['lotes3d', 'lotesel']) {
      mapa.on('click', id, (e) => { const f = e.features && e.features[0]; if (f) ctx.selecionar(f.properties.lote, true); });
      mapa.on('mouseenter', id, () => { mapa.getCanvas().style.cursor = 'pointer'; });
      mapa.on('mouseleave', id, () => { mapa.getCanvas().style.cursor = ''; });
    }
    for (const f of ctx.lotesF) {
      const el = document.createElement('div'); el.className = 'ml-rot3d'; el.textContent = ctx.rotulo ? ctx.rotulo(f) : 'LT-' + f.properties.lote;
      new maplibregl.Marker({ element: el }).setLngLat(centro(anel(f))).addTo(mapa);
    }
    // v3.159.0: pontos clicáveis (vértices do perímetro)
    for (const pt of ctx.pontos || []) {
      const el = document.createElement('div'); el.className = 'ml-vert'; el.innerHTML = `<i></i><span>${esc(pt.nome)}</span>`;
      if (pt.cor) el.style.setProperty('--vc', pt.cor); // v3.169.0: cor por ponto (locado/existente)
      el.onclick = (ev) => { ev.stopPropagation(); ctx.selPonto(pt.id); };
      marcadores[pt.id] = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(pt.lngLat).addTo(mapa);
    }
    mapa.easeTo({ pitch: 55, bearing: -18, zoom: mapa.getZoom() + (ctx.zoomExtra ?? .6), duration: 900 });
    aplicarBaseLembrada(ctx);
    if (atual) marcar(atual, false, true);
  });
  // controles por cima do mapa (Girar / Plano / Alto relevo / Vista de cima)
  const ctl = ctx.ctl;
  ctl.innerHTML = `<button class="pill" data-a="girar">🔄 Girar</button>
    <div class="seg"><button data-a="plano">▱ Plano</button><button data-a="relevo" class="on">⛰️ Alto relevo</button><button data-a="cima">🧭 Vista de cima</button></div>`;
  ctl.hidden = false;
  const btn = (a) => ctl.querySelector(`[data-a="${a}"]`);
  const altSel = () => relevo === 'plano' ? H.relevo : H.sobe; // Plano: sobe pouco · Alto relevo: sobe alto
  const pronto = () => mapa.getLayer && mapa.getLayer('lotes3d');
  const pintarSeg = (a) => ['plano', 'relevo', 'cima'].forEach((x) => btn(x).classList.toggle('on', x === a));
  const animarSel = (de, ate, ms = 450) => {
    cancelAnimationFrame(rafSobe); const t0 = performance.now();
    const passo = (t) => { const k = Math.max(0, Math.min(1, (t - t0) / ms)); const e = 1 - Math.pow(1 - k, 3);
      if (pronto()) mapa.setPaintProperty('lotesel', 'fill-extrusion-height', de + (ate - de) * e);
      if (k < 1) rafSobe = requestAnimationFrame(passo); };
    rafSobe = requestAnimationFrame(passo);
  };
  const aplicarRelevo = () => {
    if (!pronto()) return;
    if (atual) mapa.setPaintProperty('lotesel', 'fill-extrusion-height', altSel());
  };
  btn('plano').onclick = () => { relevo = 'plano'; pintarSeg('plano'); aplicarRelevo(); if (mapa.getPitch() < 20) mapa.easeTo({ pitch: 50, duration: 600 }); };
  btn('relevo').onclick = () => { relevo = 'relevo'; pintarSeg('relevo'); aplicarRelevo(); if (mapa.getPitch() < 20) mapa.easeTo({ pitch: 55, duration: 600 }); };
  btn('cima').onclick = () => { pintarSeg('cima'); pararGiro(); mapa.easeTo({ pitch: 0, bearing: 0, duration: 700 }); };
  const pararGiro = () => { girando = false; cancelAnimationFrame(rafGiro); btn('girar').classList.remove('on'); };
  btn('girar').onclick = () => {
    if (girando) return pararGiro();
    girando = true; btn('girar').classList.add('on');
    if (mapa.getPitch() < 20) { pintarSeg(relevo); mapa.easeTo({ pitch: 55, duration: 500 }); }
    let ult = performance.now();
    const passo = (t) => { if (!girando) return; mapa.setBearing(mapa.getBearing() + (t - ult) * .012); ult = t; rafGiro = requestAnimationFrame(passo); };
    rafGiro = requestAnimationFrame(passo);
  };
  mapa.on('dragstart', () => girando && pararGiro());
  // bases Mapa / Satélite / Relevo
  document.querySelectorAll(ctx.baseSel).forEach((b) => {
    b.className = 'btn btn-sm ' + (b.dataset.base === 'mapa' ? 'btn-primary' : 'btn-ghost');
    b.onclick = () => {
      const t = TILES_3D[b.dataset.base];
      if (mapa.getLayer('base')) mapa.removeLayer('base');
      if (mapa.getSource('base')) mapa.removeSource('base');
      mapa.addSource('base', { type: 'raster', tileSize: 256, ...t });
      const antes = mapa.getLayer('ctxlotes') ? 'ctxlotes' : undefined;
      mapa.addLayer({ id: 'base', type: 'raster', source: 'base', paint: b.dataset.base === 'mapa' ? { 'raster-opacity': .55, 'raster-saturation': -.6 } : { 'raster-opacity': 1 } }, antes);
      BASE_LEMBRADA[ctx.baseSel] = b.dataset.base;
      document.querySelectorAll(ctx.baseSel).forEach((x) => x.className = 'btn btn-sm ' + (x === b ? 'btn-primary' : 'btn-ghost'));
    };
  });
  function marcar(lote, centralizar, semAnim){
    atual = lote;
    if (!pronto()) return; // aplica no 'load'
    mapa.setFilter('lotes3d', ['!=', ['get', 'lote'], lote]);
    mapa.setFilter('lotesel', ['==', ['get', 'lote'], lote]);
    if (semAnim) mapa.setPaintProperty('lotesel', 'fill-extrusion-height', altSel());
    else animarSel(0, altSel());
    if (centralizar) {
      const b = bbox(anel(ctx.porLote[lote]));
      const cam = mapa.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 70, bearing: mapa.getBearing() });
      if (cam) mapa.easeTo({ center: cam.center, zoom: Math.min(cam.zoom, 17), duration: 700 });
    }
  }
  function limpar(){
    atual = null;
    if (!pronto()) return;
    mapa.setFilter('lotes3d', ['!=', ['get', 'lote'], '']);
    mapa.setFilter('lotesel', ['==', ['get', 'lote'], '']);
  }
  function marcarPonto(id){
    if (ptAtual != null && marcadores[ptAtual]) marcadores[ptAtual].getElement().classList.remove('on');
    ptAtual = id; const m = marcadores[id]; if (!m) return;
    m.getElement().classList.add('on');
    mapa.easeTo({ center: m.getLngLat(), zoom: Math.max(mapa.getZoom(), 14.5), duration: 700 });
  }
  return { mapa, parar: () => { pararGiro(); cancelAnimationFrame(rafSobe); }, marcar, marcarPonto, limpar };
}
