/**
 * vtaCanvas.js — Engine de Canvas 2D PURO para VTA (Vistoria Técnica de As-Built)
 * Romatec Consultoria Total — ZAYRA v1.99.16
 *
 * HTML5 Canvas 2D API pura. SEM Konva, SEM dependências externas (o Konva via CDN
 * quebrava a tela inteira quando o script não carregava). Suporta mouse, touch
 * (pinch-zoom) e stylus (Apple Pencil / S-Pen).
 *
 * Persistência reaproveita o backend existente /api/canvas (canvas_graficos):
 *   POST  /api/canvas            → cria (retorna {id})
 *   PUT   /api/canvas/:id        → salva { dados_json:{engine,shapes,viewport}, dados_svg }
 *   GET   /api/canvas/:id        → { canvas } (dados_json com shapes)
 *   GET   /api/canvas/por-laudo/:id | /por-proposta/:id  → { canvas }
 *   POST  /api/canvas/:id/prancha          → { svg } (carimbo Romatec)
 *   POST  /api/canvas/:id/exportar-whatsapp→ envia PNG via Z-API
 */
const CanvasEngine = (() => {
  // ─── ESTADO ──────────────────────────────────────────────────────────────────
  let canvas, ctx, wrap;
  let W = 0, H = 0;
  let VW = 2000, VH = 2000;            // dimensões virtuais (largura/altura)
  let vp = { x: 0, y: 0, scale: 1.0 };
  const SCALE_MIN = 0.05, SCALE_MAX = 20;

  let activeTool = 'pan';
  let props = { color: '#ffffff', lineWidth: 2, dash: [], fillColor: '#1a3a1a', fillAlpha: 0.30 };

  let shapes = [];
  let history = [];
  const MAX_HISTORY = 50;

  let drawing = false, panStart = null, drawStart = null;
  let currentShape = null, selectedId = null;
  let polyPoints = [], lastTouchDist = null;
  let canvasId = null;

  const GRID = 20;
  const cfg = ((typeof window !== 'undefined' && window.VTA_INIT) || {});
  const API = cfg.apiBase || '/api/canvas';

  // ─── INIT ────────────────────────────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('main-canvas');
    ctx    = canvas.getContext('2d');
    wrap   = document.getElementById('canvas-wrap');
    canvasId = cfg.canvasId || null;

    resize();
    bindEvents();
    bindToolbar();
    bindActions();
    centerOrigin();
    loadExisting().finally(() => {
      render();
      showToast('Canvas pronto ✓', 1200);
    });
  }

  function centerOrigin() { vp = { x: W / 2, y: H / 2, scale: 1.0 }; }

  // ─── RESIZE ──────────────────────────────────────────────────────────────────
  function resize() {
    const rect = wrap.getBoundingClientRect();
    W = rect.width; H = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // v3.62.6: guard — sem isso, carregar a engine fora do browser (ex: teste com
  // window=undefined) quebra em `undefined.addEventListener` no top-level do IIFE.
  if (typeof window !== 'undefined') window.addEventListener('resize', () => { resize(); });

  // ─── RENDER LOOP ──────────────────────────────────────────────────────────────
  function render() {
    ctx.save();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c0e12';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(vp.x, vp.y);
    ctx.scale(vp.scale, vp.scale);
    drawGrid(ctx);
    shapes.forEach(s => drawShape(ctx, s));
    if (currentShape) drawShape(ctx, currentShape, true);
    if (selectedId !== null) {
      const sel = shapes.find(s => s.id === selectedId);
      if (sel) drawSelection(ctx, sel);
    }
    ctx.restore();
    requestAnimationFrame(render);
  }

  // ─── GRID ────────────────────────────────────────────────────────────────────
  function drawGrid(c) {
    c.save();
    const left = -vp.x / vp.scale, top = -vp.y / vp.scale;
    const right = left + W / vp.scale, bottom = top + H / vp.scale;
    const sX = Math.floor(left / GRID) * GRID, sY = Math.floor(top / GRID) * GRID;
    c.strokeStyle = 'rgba(255,255,255,0.05)';
    c.lineWidth = 1 / vp.scale;
    c.beginPath();
    for (let x = sX; x <= right; x += GRID) { c.moveTo(x, top); c.lineTo(x, bottom); }
    for (let y = sY; y <= bottom; y += GRID) { c.moveTo(left, y); c.lineTo(right, y); }
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.09)';
    c.lineWidth = 1.4 / vp.scale;
    c.beginPath();
    for (let x = sX; x <= right; x += GRID * 5) { c.moveTo(x, top); c.lineTo(x, bottom); }
    for (let y = sY; y <= bottom; y += GRID * 5) { c.moveTo(left, y); c.lineTo(right, y); }
    c.stroke();
    // eixos (origem virtual)
    c.strokeStyle = 'rgba(70,85,122,0.8)';
    c.lineWidth = 1.5 / vp.scale;
    c.beginPath(); c.moveTo(0, top); c.lineTo(0, bottom); c.moveTo(left, 0); c.lineTo(right, 0); c.stroke();
    c.restore();
  }

  // ─── DRAW SHAPE ──────────────────────────────────────────────────────────────
  function drawShape(c, s, isPreview = false) {
    c.save();
    c.globalAlpha = isPreview ? 0.7 : 1.0;
    c.strokeStyle = s.color || '#ffffff';
    c.lineWidth   = (s.lineWidth || 2) / vp.scale;
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.setLineDash(s.dash && s.dash.length ? s.dash.map(d => d / vp.scale) : []);
    switch (s.type) {
      case 'line':
        c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke(); break;
      case 'wall': drawWall(c, s); break;
      case 'rect': {
        const rx = Math.min(s.x1, s.x2), ry = Math.min(s.y1, s.y2);
        const rw = Math.abs(s.x2 - s.x1), rh = Math.abs(s.y2 - s.y1);
        if (s.fillAlpha > 0) { c.globalAlpha = isPreview ? 0.4 : s.fillAlpha; c.fillStyle = s.fillColor || '#1a3a1a'; c.fillRect(rx, ry, rw, rh); c.globalAlpha = isPreview ? 0.7 : 1.0; }
        c.strokeRect(rx, ry, rw, rh);
        if (s.label) { c.fillStyle = s.color || '#fff'; c.font = `${Math.max(8, 12 / vp.scale)}px monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s.label, rx + rw / 2, ry + rh / 2); }
        break;
      }
      case 'circle': {
        const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
        const rX = Math.abs(s.x2 - s.x1) / 2, rY = Math.abs(s.y2 - s.y1) / 2;
        c.beginPath(); c.ellipse(cx, cy, rX, rY, 0, 0, Math.PI * 2);
        if (s.fillAlpha > 0) { c.globalAlpha = isPreview ? 0.4 : s.fillAlpha; c.fillStyle = s.fillColor || '#1a3a1a'; c.fill(); c.globalAlpha = isPreview ? 0.7 : 1.0; }
        c.stroke(); break;
      }
      case 'arrow': drawArrow(c, s.x1, s.y1, s.x2, s.y2, false); break;
      case 'dbl-arrow':
        drawArrow(c, s.x1, s.y1, s.x2, s.y2, true);
        if (s.measureText) { const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2; c.fillStyle = '#f0c040'; c.font = `bold ${Math.max(6, 10 / vp.scale)}px monospace`; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(s.measureText, mx, my - 3 / vp.scale); }
        break;
      case 'measure': drawMeasure(c, s); break;
      case 'polyline': {
        if (!s.points || s.points.length < 2) break;
        c.beginPath(); c.moveTo(s.points[0].x, s.points[0].y);
        s.points.forEach((p, i) => { if (i > 0) c.lineTo(p.x, p.y); });
        if (s.closed) c.closePath();
        if (s.closed && s.fillAlpha > 0) { c.globalAlpha = isPreview ? 0.4 : s.fillAlpha; c.fillStyle = s.fillColor || '#1a3a1a'; c.fill(); c.globalAlpha = isPreview ? 0.7 : 1.0; }
        c.stroke(); break;
      }
      case 'text': {
        const fs = Math.max(8, (s.fontSize || 14) / vp.scale);
        c.font = `${s.bold ? 'bold ' : ''}${fs}px monospace`; c.fillStyle = s.color || '#fff';
        c.textAlign = s.align || 'left'; c.textBaseline = 'top'; c.fillText(s.text || '', s.x1, s.y1); break;
      }
      case 'door': drawDoor(c, s); break;
      case 'window': drawWindow(c, s); break;
      case 'north': drawNorth(c, s.x1, s.y1, s.size || 40); break;
    }
    c.restore();
  }

  function drawArrow(c, x1, y1, x2, y2, dbl) {
    const aw = Math.max(6, 10 / vp.scale), ang = Math.atan2(y2 - y1, x2 - x1);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.beginPath(); c.moveTo(x2, y2);
    c.lineTo(x2 - aw * Math.cos(ang - Math.PI / 7), y2 - aw * Math.sin(ang - Math.PI / 7));
    c.lineTo(x2 - aw * Math.cos(ang + Math.PI / 7), y2 - aw * Math.sin(ang + Math.PI / 7));
    c.closePath(); c.fillStyle = c.strokeStyle; c.fill();
    if (dbl) { const a = ang + Math.PI; c.beginPath(); c.moveTo(x1, y1);
      c.lineTo(x1 - aw * Math.cos(a - Math.PI / 7), y1 - aw * Math.sin(a - Math.PI / 7));
      c.lineTo(x1 - aw * Math.cos(a + Math.PI / 7), y1 - aw * Math.sin(a + Math.PI / 7));
      c.closePath(); c.fill(); }
  }
  function drawWall(c, s) {
    const t = (s.thickness || 15) / vp.scale, ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), perp = ang + Math.PI / 2;
    const dx = Math.cos(perp) * t / 2, dy = Math.sin(perp) * t / 2;
    c.beginPath(); c.moveTo(s.x1 + dx, s.y1 + dy); c.lineTo(s.x2 + dx, s.y2 + dy);
    c.lineTo(s.x2 - dx, s.y2 - dy); c.lineTo(s.x1 - dx, s.y1 - dy); c.closePath();
    c.fillStyle = s.fillColor || '#4a3020'; c.fill(); c.stroke();
  }
  function drawDoor(c, s) {
    const sz = Math.abs(s.x2 - s.x1) || 40;
    c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x1 + sz, s.y1); c.stroke();
    c.beginPath(); c.arc(s.x1, s.y1, sz, 0, Math.PI / 2); c.stroke();
  }
  function drawWindow(c, s) {
    const w = Math.abs(s.x2 - s.x1) || 60, lw = c.lineWidth;
    c.strokeRect(s.x1, s.y1 - lw, w, lw * 3);
  }
  function drawMeasure(c, s) {
    const tick = Math.max(4, 8 / vp.scale), ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), perp = ang + Math.PI / 2;
    c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
    [[s.x1, s.y1], [s.x2, s.y2]].forEach(([px, py]) => {
      c.beginPath(); c.moveTo(px + Math.cos(perp) * tick, py + Math.sin(perp) * tick);
      c.lineTo(px - Math.cos(perp) * tick, py - Math.sin(perp) * tick); c.stroke();
    });
    if (s.measureText) {
      const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2, fs = Math.max(6, 11 / vp.scale);
      c.fillStyle = '#f0c040'; c.font = `bold ${fs}px monospace`; c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.save(); c.translate(mx, my); let a = ang; if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI;
      c.rotate(a); c.fillText(s.measureText, 0, -3 / vp.scale); c.restore();
    }
  }
  function drawNorth(c, cx, cy, size) {
    const s = size / vp.scale;
    c.beginPath(); c.arc(cx, cy, s * 0.5, 0, Math.PI * 2); c.strokeStyle = '#f0c040'; c.lineWidth = Math.max(1, 2 / vp.scale); c.stroke();
    c.fillStyle = '#f0c040'; c.beginPath(); c.moveTo(cx, cy - s * 0.5); c.lineTo(cx - s * 0.15, cy + s * 0.2); c.lineTo(cx, cy); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(cx, cy - s * 0.5); c.lineTo(cx + s * 0.15, cy + s * 0.2); c.lineTo(cx, cy); c.closePath(); c.fillStyle = 'rgba(240,192,64,0.4)'; c.fill();
    c.fillStyle = '#fff'; c.font = `bold ${Math.max(8, s * 0.35)}px monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('N', cx, cy - s * 0.72);
  }
  function drawSelection(c, s) {
    c.save(); c.strokeStyle = '#3a8c3a'; c.lineWidth = 2 / vp.scale; c.setLineDash([4 / vp.scale, 4 / vp.scale]);
    const pad = 8 / vp.scale, bb = getBoundingBox(s);
    c.strokeRect(bb.x - pad, bb.y - pad, bb.w + pad * 2, bb.h + pad * 2); c.restore();
  }
  function getBoundingBox(s) {
    if (s.points && s.points.length) {
      const xs = s.points.map(p => p.x), ys = s.points.map(p => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    const x = Math.min(s.x1 ?? 0, s.x2 ?? 0), y = Math.min(s.y1 ?? 0, s.y2 ?? 0);
    return { x, y, w: Math.abs((s.x2 ?? 0) - (s.x1 ?? 0)), h: Math.abs((s.y2 ?? 0) - (s.y1 ?? 0)) };
  }

  // ─── COORDENADAS ─────────────────────────────────────────────────────────────
  function screenToCanvas(sx, sy) { return { x: (sx - vp.x) / vp.scale, y: (sy - vp.y) / vp.scale }; }
  function snap(v) { return Math.round(v / GRID) * GRID; }
  function rawPos(e) {
    const r = canvas.getBoundingClientRect();
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function logicPos(e) { const r = rawPos(e); return screenToCanvas(r.x, r.y); }

  // ─── EVENTOS ─────────────────────────────────────────────────────────────────
  function bindEvents() {
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', onUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onUp, { passive: false });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);
    window.addEventListener('keydown', onKey);
    bindProps();
  }
  function bindProps() {
    const g = id => document.getElementById(id);
    g('prop-color') && (g('prop-color').oninput = e => { props.color = e.target.value; });
    g('prop-width') && (g('prop-width').oninput = e => { props.lineWidth = parseInt(e.target.value); const v = g('prop-width-val'); if (v) v.textContent = e.target.value + 'px'; });
    g('prop-dash') && (g('prop-dash').onchange = e => { props.dash = e.target.value ? e.target.value.split(',').map(Number) : []; });
    g('prop-fill') && (g('prop-fill').oninput = e => { props.fillColor = e.target.value; });
    g('prop-fill-alpha') && (g('prop-fill-alpha').oninput = e => { props.fillAlpha = parseInt(e.target.value) / 100; });
  }

  function onDown(e) {
    e.preventDefault();
    const lp = logicPos(e), rp = rawPos(e);
    if (activeTool === 'pan') { drawing = true; panStart = { sx: rp.x, sy: rp.y, vx: vp.x, vy: vp.y }; wrap.classList.add('panning'); return; }
    if (activeTool === 'select') { hitTest(lp.x, lp.y); return; }
    if (activeTool === 'eraser') { eraseAt(lp.x, lp.y); return; }
    if (activeTool === 'polyline') {
      polyPoints.push({ x: snap(lp.x), y: snap(lp.y) });
      if (polyPoints.length >= 2) currentShape = { id: null, type: 'polyline', points: [...polyPoints], color: props.color, lineWidth: props.lineWidth, dash: props.dash, fillColor: props.fillColor, fillAlpha: props.fillAlpha, closed: false };
      return;
    }
    if (activeTool === 'north') { pushHistory(); shapes.push({ id: genId(), type: 'north', x1: snap(lp.x), y1: snap(lp.y), size: 40, color: props.color, lineWidth: props.lineWidth }); return; }
    if (activeTool === 'text') { openText(rp.x, rp.y, lp.x, lp.y); return; }
    if (activeTool === 'measure') { drawing = true; drawStart = { x: snap(lp.x), y: snap(lp.y) }; currentShape = { id: null, type: 'measure', x1: drawStart.x, y1: drawStart.y, x2: drawStart.x, y2: drawStart.y, color: props.color, lineWidth: props.lineWidth, dash: props.dash, measureText: '0' }; return; }
    drawing = true; drawStart = { x: snap(lp.x), y: snap(lp.y) }; currentShape = newShape(activeTool, drawStart.x, drawStart.y);
  }
  function onMove(e) {
    e.preventDefault();
    const lp = logicPos(e), rp = rawPos(e);
    if (activeTool === 'pan' && drawing && panStart) { vp.x = panStart.vx + (rp.x - panStart.sx); vp.y = panStart.vy + (rp.y - panStart.sy); return; }
    if (!drawing || !currentShape) return;
    const ex = snap(lp.x), ey = snap(lp.y);
    currentShape.x2 = ex; currentShape.y2 = ey;
    if (currentShape.type === 'measure') { const dx = ex - currentShape.x1, dy = ey - currentShape.y1; currentShape.measureText = pxToMetros(Math.hypot(dx, dy)); }
  }
  function onUp() {
    if (activeTool === 'pan') { drawing = false; panStart = null; wrap.classList.remove('panning'); return; }
    if (drawing && currentShape && activeTool !== 'polyline') {
      if (isValid(currentShape)) { pushHistory(); currentShape.id = genId(); shapes.push({ ...currentShape }); }
      currentShape = null; drawing = false; drawStart = null;
    }
  }
  function onDblClick() {
    if (activeTool === 'polyline' && polyPoints.length >= 3) {
      pushHistory();
      shapes.push({ id: genId(), type: 'polyline', points: [...polyPoints], color: props.color, lineWidth: props.lineWidth, dash: props.dash, fillColor: props.fillColor, fillAlpha: props.fillAlpha, closed: true });
      polyPoints = []; currentShape = null;
    }
  }
  function onTouchStart(e) { e.preventDefault(); if (e.touches.length === 2) { lastTouchDist = touchDist(e); return; } onDown(e); }
  function onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2 && lastTouchDist !== null) {
      const nd = touchDist(e), f = nd / lastTouchDist;
      const r = canvas.getBoundingClientRect();
      zoomAt((e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top, f);
      lastTouchDist = nd; return;
    }
    onMove(e);
  }
  function onTouchEnd(e) { lastTouchDist = null; onUp(e); }
  function touchDist(e) { return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
  function onWheel(e) { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 0.89); }
  function zoomAt(sx, sy, f) {
    const ns = Math.min(SCALE_MAX, Math.max(SCALE_MIN, vp.scale * f)), k = ns / vp.scale;
    vp.x = sx - k * (sx - vp.x); vp.y = sy - k * (sy - vp.y); vp.scale = ns; updZoom();
  }
  function onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); }
    if (e.key === 'Escape') { if (activeTool === 'polyline') { polyPoints = []; currentShape = null; } setTool('pan'); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null) deleteSelected();
  }

  // ─── TOOLBAR ─────────────────────────────────────────────────────────────────
  function bindToolbar() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      const t = btn.dataset.tool;
      btn.addEventListener('click', () => setTool(t));
      btn.addEventListener('touchend', e => { e.preventDefault(); setTool(t); });
    });
    const on = (id, fn) => { const el = document.getElementById(id); if (el) { el.addEventListener('click', fn); el.addEventListener('touchend', e => { e.preventDefault(); fn(); }); } };
    on('btn-undo', undo);
    on('btn-zoom-in', () => zoomAt(W / 2, H / 2, 1.3));
    on('btn-zoom-out', () => zoomAt(W / 2, H / 2, 0.77));
    on('btn-fit', fitAll);
  }
  function setTool(tool) {
    activeTool = tool; drawing = false; currentShape = null; polyPoints = [];
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    wrap.className = `tool-${tool}`;
    const showProps = ['line', 'wall', 'arrow', 'dbl-arrow', 'rect', 'circle', 'polyline', 'door', 'window', 'measure'].includes(tool);
    const pp = document.getElementById('props-panel'); if (pp) pp.classList.toggle('visible', showProps);
    const fg = document.getElementById('prop-fill-group'); if (fg) fg.style.display = ['rect', 'circle', 'polyline'].includes(tool) ? 'flex' : 'none';
    showToast('Ferramenta: ' + tool.toUpperCase(), 700);
  }

  // ─── SHAPE HELPERS ───────────────────────────────────────────────────────────
  function newShape(type, x, y) { return { id: null, type, x1: x, y1: y, x2: x, y2: y, color: props.color, lineWidth: props.lineWidth, dash: [...props.dash], fillColor: props.fillColor, fillAlpha: props.fillAlpha }; }
  function isValid(s) {
    if (['north', 'text'].includes(s.type)) return true;
    if (s.type === 'polyline') return (s.points || []).length >= 2;
    return Math.hypot((s.x2 || 0) - (s.x1 || 0), (s.y2 || 0) - (s.y1 || 0)) > 3;
  }
  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ─── HIT TEST / SELECT / ERASE ───────────────────────────────────────────────
  function hitTest(lx, ly) {
    const tol = 12 / vp.scale; selectedId = null;
    for (let i = shapes.length - 1; i >= 0; i--) { if (hitShape(shapes[i], lx, ly, tol)) { selectedId = shapes[i].id; break; } }
  }
  function hitShape(s, lx, ly, tol) {
    if (s.type === 'text' || s.type === 'north') return Math.abs(lx - s.x1) < tol * 3 && Math.abs(ly - s.y1) < tol * 3;
    if (s.type === 'polyline' && s.points) return s.points.some((p, i, a) => i < a.length - 1 && distSeg(lx, ly, p.x, p.y, a[i + 1].x, a[i + 1].y) < tol);
    if (s.type === 'rect') return lx >= Math.min(s.x1, s.x2) - tol && lx <= Math.max(s.x1, s.x2) + tol && ly >= Math.min(s.y1, s.y2) - tol && ly <= Math.max(s.y1, s.y2) + tol;
    return distSeg(lx, ly, s.x1 || 0, s.y1 || 0, s.x2 || 0, s.y2 || 0) < tol;
  }
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function deleteSelected() { if (selectedId === null) return; pushHistory(); shapes = shapes.filter(s => s.id !== selectedId); selectedId = null; showToast('Elemento removido', 700); }
  function eraseAt(lx, ly) { const tol = 18 / vp.scale, before = shapes.length; shapes = shapes.filter(s => !hitShape(s, lx, ly, tol)); if (shapes.length < before) pushHistory(); }

  // ─── TEXTO ───────────────────────────────────────────────────────────────────
  function openText(sx, sy, lx, ly) {
    const inp = document.getElementById('text-input-overlay'); if (!inp) return;
    inp.style.display = 'block'; inp.style.left = (sx + 64) + 'px'; inp.style.top = (sy + 52) + 'px'; inp.value = ''; inp.focus();
    const finish = () => {
      inp.style.display = 'none'; const txt = inp.value.trim();
      if (txt) { pushHistory(); shapes.push({ id: genId(), type: 'text', x1: lx, y1: ly, text: txt, fontSize: 14, color: props.color }); }
      inp.removeEventListener('blur', finish); inp.removeEventListener('keydown', onk);
    };
    const onk = e => { if (e.key === 'Enter') { e.preventDefault(); finish(); } };
    inp.addEventListener('blur', finish); inp.addEventListener('keydown', onk);
  }

  // ─── MEDIDA ──────────────────────────────────────────────────────────────────
  function pxToMetros(px) {
    const esc = parseEscala();
    const m = px * esc / (GRID * 200); // GRID px = (esc/200) m → ajustável p/ campo
    return m < 1 ? (m * 100).toFixed(0) + 'cm' : m.toFixed(2) + 'm';
  }
  function parseEscala() {
    const el = (typeof document !== 'undefined') ? document.getElementById('escala-text') : null;
    const t = ((el && el.textContent) || cfg.escala || '1:500').split(':');
    return t.length === 2 ? (parseInt(t[1]) || 500) : 500;
  }

  // ─── HISTORY / EDIÇÃO ────────────────────────────────────────────────────────
  function pushHistory() { history.push(JSON.stringify(shapes)); if (history.length > MAX_HISTORY) history.shift(); }
  function undo() { if (!history.length) { showToast('Nada para desfazer', 900); return; } shapes = JSON.parse(history.pop()); currentShape = null; selectedId = null; showToast('Desfeito ↩', 700); }
  function clearAll() { if (!shapes.length) return; if (!confirm('Limpar todo o desenho?')) return; pushHistory(); shapes = []; selectedId = null; showToast('Canvas limpo', 900); }
  function updZoom() { const z = document.getElementById('zoom'); if (z) z.textContent = Math.round(vp.scale * 100) + '%'; }
  function fitAll() {
    if (!shapes.length) { centerOrigin(); updZoom(); return; }
    let a = Infinity, b = Infinity, cM = -Infinity, d = -Infinity;
    shapes.forEach(s => { const bb = getBoundingBox(s); a = Math.min(a, bb.x); b = Math.min(b, bb.y); cM = Math.max(cM, bb.x + bb.w); d = Math.max(d, bb.y + bb.h); });
    const pad = 40, sx = (W - pad * 2) / (cM - a || 1), sy = (H - pad * 2) / (d - b || 1);
    vp.scale = Math.min(sx, sy, SCALE_MAX);
    vp.x = pad - a * vp.scale + (W - pad * 2 - (cM - a) * vp.scale) / 2;
    vp.y = pad - b * vp.scale + (H - pad * 2 - (d - b) * vp.scale) / 2;
    updZoom(); showToast('Ajustado ⊡', 700);
  }

  // ─── EXPORT (render offscreen do desenho inteiro) ─────────────────────────────
  function exportDataURL() {
    if (!shapes.length) return canvas.toDataURL('image/png');
    let a = Infinity, b = Infinity, cM = -Infinity, d = -Infinity;
    shapes.forEach(s => { const bb = getBoundingBox(s); a = Math.min(a, bb.x); b = Math.min(b, bb.y); cM = Math.max(cM, bb.x + bb.w); d = Math.max(d, bb.y + bb.h); });
    const pad = 40, w = (cM - a) + pad * 2, h = (d - b) + pad * 2;
    const sc = Math.min(2400 / w, 2400 / h, 4);
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(w * sc)); off.height = Math.max(1, Math.round(h * sc));
    const oc = off.getContext('2d');
    oc.fillStyle = '#0c0e12'; oc.fillRect(0, 0, off.width, off.height);
    const saved = { ...vp }; vp = { x: 0, y: 0, scale: sc }; // drawShape usa vp.scale p/ espessuras
    oc.save(); oc.translate((-a + pad) * sc, (-b + pad) * sc); oc.scale(sc, sc);
    shapes.forEach(s => drawShape(oc, s));
    oc.restore(); vp = saved;
    return off.toDataURL('image/png');
  }
  function svgConteudo() {
    return `<image href="${exportDataURL()}" x="0" y="0" width="${VW}" height="${VH}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  function exportPNG() {
    try { const a = document.createElement('a'); a.href = exportDataURL(); a.download = `croqui_${Date.now()}.png`; a.click(); showToast('PNG exportado ✓', 1200); }
    catch (err) { showToast('Erro PNG: ' + err.message, 1800); }
  }

  // ─── API / PERSISTÊNCIA ──────────────────────────────────────────────────────
  function api(path, opts) {
    opts = opts || {}; opts.credentials = 'include';
    return fetch(API + path, opts).then(r => {
      if (r.status === 401) { location.href = '/login'; throw new Error('não autenticado'); }
      return r.json().then(j => { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
    });
  }
  function loadExisting() {
    let rota = null;
    if (canvasId) rota = '/' + canvasId;
    else if (cfg.laudoId != null) rota = '/por-laudo/' + cfg.laudoId;
    else if (cfg.propostaId != null) rota = '/por-proposta/' + cfg.propostaId;
    if (!rota) return Promise.resolve();
    return api(rota).then(j => {
      const c = j.canvas; if (!c) return;
      canvasId = c.id;
      if (c.largura_virtual) VW = Number(c.largura_virtual) || VW;
      if (c.altura_virtual) VH = Number(c.altura_virtual) || VH;
      let dj = c.dados_json; if (typeof dj === 'string') { try { dj = JSON.parse(dj); } catch { dj = null; } }
      if (dj && Array.isArray(dj.shapes)) shapes = dj.shapes;
      if (dj && dj.viewport) vp = dj.viewport;
      const tt = document.getElementById('title-text'); if (tt && c.titulo) tt.textContent = c.titulo;
      const et = document.getElementById('escala-text'); if (et && c.escala_grafica) et.textContent = c.escala_grafica;
      const vb = document.getElementById('vinculo-badge'); if (vb) { vb.style.display = ''; vb.textContent = '🔗 Editando #' + c.id; }
    }).catch(() => { /* 404 = começa em branco */ });
  }
  function ensureCanvas() {
    if (canvasId) return Promise.resolve(canvasId);
    const body = {
      tipo: 'croqui',
      titulo: titleNow(), escala_grafica: escalaNow(),
      largura_virtual: VW, altura_virtual: VH,
      laudo_id: cfg.laudoId ?? null, proposta_id: cfg.propostaId ?? null,
    };
    return api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(j => { canvasId = j.id; return canvasId; });
  }
  function titleNow() { return document.getElementById('title-text')?.textContent || cfg.titulo || 'Croqui As-Built'; }
  function escalaNow() { return document.getElementById('escala-text')?.textContent || cfg.escala || '1:500'; }
  function save() {
    setLoading(true);
    return ensureCanvas().then(id => api('/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: titleNow(), escala_grafica: escalaNow(),
        largura_virtual: VW, altura_virtual: VH,
        dados_json: { engine: 'vtaCanvas-v2', shapes, viewport: vp },
        dados_svg: svgConteudo(),
      }),
    })).then(() => { showToast('Salvo com sucesso ✓', 1400); return canvasId; })
      .catch(e => { showToast('Erro ao salvar: ' + e.message, 2000); throw e; })
      .finally(() => setLoading(false));
  }

  // ─── PRANCHA ─────────────────────────────────────────────────────────────────
  function gerarPrancha(form) {
    setLoading(true);
    return save().then(id => api('/' + id + '/prancha', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tituloObra: form.tituloObra, proprietario: form.proprietario, endereco: form.endereco,
        municipio: form.municipio, tipoObra: form.tipoObra, numeroPrancha: form.numeroPrancha,
        revisao: form.revisao, escala: escalaNow(),
      }),
    })).then(j => {
      const w = window.open('', '_blank'); if (w) { w.document.write(j.svg); w.document.close(); }
      showToast('Prancha #' + j.pranchaId + ' gerada ✓', 1500); return j;
    }).catch(e => { showToast('Erro prancha: ' + e.message, 2000); throw e; })
      .finally(() => setLoading(false));
  }

  // ─── WHATSAPP ────────────────────────────────────────────────────────────────
  function enviarWhatsapp(telefone) {
    setLoading(true);
    return ensureCanvas().then(id => api('/' + id + '/exportar-whatsapp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefone, imagemBase64: exportDataURL(), legenda: 'Croqui - Romatec Consultoria Total' }),
    })).then(j => { showToast('Enviado por WhatsApp ✓', 1500); return j; })
      .catch(e => { showToast('Erro WhatsApp: ' + e.message, 2000); throw e; })
      .finally(() => setLoading(false));
  }

  // ─── AÇÕES (topbar + dialogs) ────────────────────────────────────────────────
  function bindActions() {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('btn-voltar', () => { location.href = '/obras?vta=1'; }); // volta ao /obras e reabre o painel VTA
    on('act-undo', undo);
    on('act-clear', clearAll);
    on('act-png', exportPNG);
    on('act-save', () => save().catch(() => {}));
    on('act-whats', () => document.getElementById('dlg-whats')?.showModal());
    on('act-prancha', () => document.getElementById('dlg-prancha')?.showModal());
    // Dialog prancha
    on('p-cancel', () => document.getElementById('dlg-prancha')?.close());
    on('p-gerar', () => {
      const v = id => document.getElementById(id)?.value || '';
      gerarPrancha({ tituloObra: v('p-titulo') || titleNow(), proprietario: v('p-prop'), endereco: v('p-end'), municipio: v('p-mun'), tipoObra: v('p-tipo'), numeroPrancha: v('p-num'), revisao: v('p-rev') })
        .then(() => document.getElementById('dlg-prancha')?.close()).catch(() => {});
    });
    // Dialog whatsapp
    on('w-cancel', () => document.getElementById('dlg-whats')?.close());
    on('w-enviar', () => {
      const tel = (document.getElementById('w-tel')?.value || '').trim();
      if (!tel) { showToast('Informe o telefone', 1200); return; }
      enviarWhatsapp(tel).then(() => document.getElementById('dlg-whats')?.close()).catch(() => {});
    });
  }

  // ─── UI HELPERS ──────────────────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, dur = 1800) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, dur); }
  function setLoading(s) { const l = document.getElementById('loading'); if (l) l.classList.toggle('visible', s); }

  // expostos p/ testes/uso externo
  return { init, undo, clearAll, exportPNG, save, gerarPrancha, enviarWhatsapp, setTool, fitAll,
    _isValid: isValid, _distSeg: distSeg, _parseEscala: parseEscala, _pxToMetros: pxToMetros };
})();

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => { try { CanvasEngine.init(); } catch (e) { console.error('[vtaCanvas] init falhou:', e); } });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { CanvasEngine };
// ── fim do vtaCanvas.js (Romatec / ZAYRA) ──
// (linhas de rodapé para estabilidade de leitura do arquivo)
//
//
//
