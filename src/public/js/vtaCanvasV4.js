/**
 * vtaCanvasV4.js — Motor CAD As-Built v4 (estilo Revit) para VTA
 * Romatec Consultoria Total — ZAYRA
 * V3 + correções: modo Orto (F8), input de distância, edição de parede,
 * autosave localStorage + recuperação, dialog de saída, snap 15px.
 * Persistência via /api/canvas. Voltar: /obras?vta=1.
 */
const CanvasEngine = (() => {
  'use strict';

  const BASE_SCALE = { '1:50': 0.76, '1:100': 0.38, '1:200': 0.19, '1:500': 0.076 };
  const SNAP_RADIUS_PX = 15;
  const JOIN_TOL_CM = 5;
  const GRID_CM = 10;
  const COL = {
    bg: '#1a2332', gridMinor: 'rgba(255,255,255,0.04)', gridMajor: 'rgba(255,255,255,0.12)',
    wallFill: '#2d5a27', wallStroke: '#4a8f40', door: '#e8b84b', window: '#5ba4cf',
    dim: '#f0c040', snap: '#00ff88', text: '#ffffff', select: '#ffd24a', axis: 'rgba(70,85,122,0.7)',
  };
  const state = {
    scale: '1:100', zoom: 1.0, pan: { x: 0, y: 0 }, wallThickness: 15,
    walls: [], openings: [], rooms: [], dimensions: [], texts: [],
  };
  const undoStack = [], redoStack = [];
  const MAX_HISTORY = 50;

  let canvas, ctx, wrap, W = 0, H = 0;
  let activeTool = 'wall', canvasId = null;
  let wallChain = null, dimDraft = null, measureDraft = null;
  let selected = null, panDrag = null;
  let pointer = { sx: 0, sy: 0, wx: 0, wy: 0 };
  let snapPt = null, lastTouchDist = null, seq = 1;
  let orthoMode = false;                 // correção 1
  let distBuffer = '', distActive = false; // correção 2
  let dragHandle = null;                  // correção 3: 'p1'|'p2'|'move'
  let dragLast = null;
  let savedClean = true;                  // correção 4/5: estado salvo no servidor?

  const cfg = ((typeof window !== 'undefined' && window.VTA_INIT) || {});
  const API = cfg.apiBase || '/api/canvas';
  const STORAGE_KEY = 'vta_croqui_' + (cfg.canvasId || cfg.laudoId || cfg.propostaId || 'novo');

  function uid(p) { return p + Date.now().toString(36) + (seq++).toString(36); }
  function pxPerCm() { return (BASE_SCALE[state.scale] || 0.38) * state.zoom; }
  function cmToPx(cm) { return cm * pxPerCm(); }
  function pxToCm(px) { return px / pxPerCm(); }
  function worldToScreen(cx, cy) { const k = pxPerCm(); return { x: cx * k + state.pan.x, y: cy * k + state.pan.y }; }
  function screenToWorld(sx, sy) { const k = pxPerCm(); return { x: (sx - state.pan.x) / k, y: (sy - state.pan.y) / k }; }

  function dist(ax, ay, bx, by) { if (typeof ax === 'object') { return Math.hypot(ay.x - ax.x, ay.y - ax.y); } return Math.hypot(bx - ax, by - ay); }
  function lineIntersect(p1, p2, p3, p4) {
    const d1 = { x: p2.x - p1.x, y: p2.y - p1.y }, d2 = { x: p4.x - p3.x, y: p4.y - p3.y };
    const cross = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(cross) < 0.001) return null;
    const t = ((p3.x - p1.x) * d2.y - (p3.y - p1.y) * d2.x) / cross;
    return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
  }
  function shoelaceArea(verts) {
    let a = 0;
    for (let i = 0; i < verts.length; i++) { const j = (i + 1) % verts.length; a += verts[i].x * verts[j].y - verts[j].x * verts[i].y; }
    return Math.abs(a) / 2 / 10000;
  }
  function centroid(verts) {
    let cx = 0, cy = 0, a = 0;
    for (let i = 0; i < verts.length; i++) { const j = (i + 1) % verts.length; const cr = verts[i].x * verts[j].y - verts[j].x * verts[i].y; a += cr; cx += (verts[i].x + verts[j].x) * cr; cy += (verts[i].y + verts[j].y) * cr; }
    a /= 2;
    if (Math.abs(a) < 1e-6) { let mx = 0, my = 0; verts.forEach(p => { mx += p.x; my += p.y; }); return { x: mx / verts.length, y: my / verts.length }; }
    return { x: cx / (6 * a), y: cy / (6 * a) };
  }
  function wallDir(w) { const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy) || 1e-9; return { ux: dx / L, uy: dy / L, nx: -dy / L, ny: dx / L, len: L }; }
  function wallLength(w) { return Math.hypot(w.x2 - w.x1, w.y2 - w.y1); }
  function wallAngleDeg(w) { return Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180 / Math.PI; }
  function projSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1e-9;
    let t = ((px - ax) * vx + (py - ay) * vy) / L2; t = Math.max(0, Math.min(1, t));
    return { t, x: ax + t * vx, y: ay + t * vy, d: Math.hypot(px - (ax + t * vx), py - (ay + t * vy)) };
  }
  function fmtM(cm) { return (cm / 100).toFixed(2).replace('.', ','); }

  // ─── CORREÇÃO 1: ORTO ────────────────────────────────────────────────────────
  function applyOrtho(startPt, rawPt) {
    if (!orthoMode) return rawPt;
    const dx = rawPt.x - startPt.x, dy = rawPt.y - startPt.y;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const d = Math.sqrt(dx * dx + dy * dy);
    const snappedAngle = Math.round(angle / 90) * 90;  // 0/90/180/270 (sem 45°)
    const rad = snappedAngle * Math.PI / 180;
    return { x: startPt.x + d * Math.cos(rad), y: startPt.y + d * Math.sin(rad) };
  }
  // ponto efetivo da parede em desenho: snap vence; senão ortho; senão raw
  function wallPlacePoint(wx, wy, snap) {
    if (snap) return { x: snap.x, y: snap.y };
    if (orthoMode && wallChain && wallChain.pts.length) return applyOrtho(wallChain.pts[wallChain.pts.length - 1], { x: wx, y: wy });
    return { x: wx, y: wy };
  }
  function toggleOrtho() {
    orthoMode = !orthoMode;
    const b = document.getElementById('btn-ortho'); if (b) b.classList.toggle('on', orthoMode);
    showToast('Orto ' + (orthoMode ? 'ATIVO' : 'desligado'), 800);
    redraw();
  }

  function getWallPolygon(wall) {
    const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1, len = Math.hypot(dx, dy) || 1e-9;
    const nx = (-dy / len) * (wall.thickness / 2), ny = (dx / len) * (wall.thickness / 2);
    return [
      { x: wall.x1 + nx, y: wall.y1 + ny }, { x: wall.x2 + nx, y: wall.y2 + ny },
      { x: wall.x2 - nx, y: wall.y2 - ny }, { x: wall.x1 - nx, y: wall.y1 - ny },
    ];
  }
  function buildWallChains() {
    const used = new Set(), chains = [];
    const key = (x, y) => Math.round(x / JOIN_TOL_CM) + ',' + Math.round(y / JOIN_TOL_CM);
    const adj = new Map();
    state.walls.forEach(w => { [[w.x1, w.y1], [w.x2, w.y2]].forEach(([x, y]) => { const k = key(x, y); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(w); }); });
    state.walls.forEach(w => {
      if (used.has(w.id)) return;
      const pts = [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]; used.add(w.id);
      let grew = true;
      while (grew) {
        grew = false;
        const tail = pts[pts.length - 1], head = pts[0];
        for (const end of [tail, head]) {
          const cands = (adj.get(key(end.x, end.y)) || []).filter(o => !used.has(o.id) && o.thickness === w.thickness);
          if (cands.length === 1) {
            const o = cands[0]; used.add(o.id);
            const op = (Math.abs(o.x1 - end.x) < JOIN_TOL_CM && Math.abs(o.y1 - end.y) < JOIN_TOL_CM) ? { x: o.x2, y: o.y2 } : { x: o.x1, y: o.y1 };
            if (end === tail) pts.push(op); else pts.unshift(op);
            grew = true; break;
          }
        }
      }
      chains.push({ pts, thickness: w.thickness });
    });
    return chains;
  }
  function drawWalls() {
    const chains = buildWallChains();
    ctx.lineJoin = 'miter'; ctx.lineCap = 'butt'; ctx.miterLimit = 8;
    chains.forEach(ch => {
      if (ch.pts.length < 2) return;
      ctx.beginPath();
      const s0 = worldToScreen(ch.pts[0].x, ch.pts[0].y); ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < ch.pts.length; i++) { const s = worldToScreen(ch.pts[i].x, ch.pts[i].y); ctx.lineTo(s.x, s.y); }
      ctx.strokeStyle = COL.wallFill; ctx.lineWidth = Math.max(1, cmToPx(ch.thickness)); ctx.stroke();
    });
    ctx.lineWidth = 1; ctx.strokeStyle = COL.wallStroke; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    state.walls.forEach(w => {
      const q = getWallPolygon(w).map(p => worldToScreen(p.x, p.y));
      ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y);
      ctx.moveTo(q[3].x, q[3].y); ctx.lineTo(q[2].x, q[2].y); ctx.stroke();
    });
  }

  function openingPoints(wall, op) {
    const d = wallDir(wall); const s = op.posAlongWall, e = op.posAlongWall + op.width; const h = wall.thickness / 2;
    const P = (t, off) => ({ x: wall.x1 + d.ux * t + d.nx * off, y: wall.y1 + d.uy * t + d.ny * off });
    return { d, s, e, h, P };
  }
  function sc2(g, t, off) { const p = g.P(t, off); return worldToScreen(p.x, p.y); }
  function drawOpeningsCut() {
    state.openings.forEach(op => {
      const wall = state.walls.find(W2 => W2.id === op.wallId); if (!wall) return;
      const g = openingPoints(wall, op);
      const a = sc2(g, g.s, g.h + 1), b = sc2(g, g.e, g.h + 1), c = sc2(g, g.e, -g.h - 1), f = sc2(g, g.s, -g.h - 1);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(f.x, f.y); ctx.closePath();
      ctx.fillStyle = COL.bg; ctx.fill();
      ctx.strokeStyle = COL.wallStroke; ctx.lineWidth = 1.2;
      const sa = sc2(g, g.s, g.h), sb = sc2(g, g.s, -g.h), ea = sc2(g, g.e, g.h), eb = sc2(g, g.e, -g.h);
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.moveTo(ea.x, ea.y); ctx.lineTo(eb.x, eb.y); ctx.stroke();
    });
  }
  function drawOpenings() {
    state.openings.forEach(op => {
      const w = state.walls.find(W2 => W2.id === op.wallId); if (!w) return;
      if (op.type === 'door') drawDoorSymbol(op, w); else drawWindowSymbol(op, w);
      labelOpening(op, w);
    });
  }
  function drawDoorSymbol(op, wall) {
    const g = openingPoints(wall, op);
    let hingeAtStart = op.swingDir !== 'right';
    if (op.flipped) hingeAtStart = !hingeAtStart;
    const sideSign = (op.rotation === 180) ? -1 : 1;
    const hingeT = hingeAtStart ? g.s : g.e, otherT = hingeAtStart ? g.e : g.s;
    const hinge = sc2(g, hingeT, 0);
    const leafEnd = sc2(g, hingeT, op.width * sideSign);
    ctx.strokeStyle = COL.door; ctx.lineWidth = 1.6; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(hinge.x, hinge.y); ctx.lineTo(leafEnd.x, leafEnd.y); ctx.stroke();
    const closed = sc2(g, otherT, 0);
    const a0 = Math.atan2(leafEnd.y - hinge.y, leafEnd.x - hinge.x), a1 = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(hinge.x, hinge.y, cmToPx(op.width), Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
    ctx.setLineDash([]);
    if (op.doorType === 'sliding' || op.doorType === 'gate') {
      const m1 = sc2(g, g.s, 0), m2 = sc2(g, g.e, 0); ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
    } else if (op.doorType === 'swing2') {
      const h2 = sc2(g, otherT, 0), le2 = sc2(g, otherT, op.width * sideSign);
      ctx.beginPath(); ctx.moveTo(h2.x, h2.y); ctx.lineTo(le2.x, le2.y); ctx.stroke();
    }
  }
  function drawWindowSymbol(op, wall) {
    const g = openingPoints(wall, op);
    ctx.strokeStyle = COL.window; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    [g.h, 0, -g.h].forEach(off => { const a = sc2(g, g.s, off), b = sc2(g, g.e, off); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
    const nDiv = op.windowType === 'sliding4' ? 4 : (op.windowType === 'sliding2' ? 2 : 0);
    for (let i = 1; i < nDiv; i++) { const t = g.s + (g.e - g.s) * i / nDiv; const a = sc2(g, t, g.h), b = sc2(g, t, -g.h); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }
  function labelOpening(op, wall) {
    if (!op.code) return;
    const g = openingPoints(wall, op);
    const p = sc2(g, (g.s + g.e) / 2, -(wall.thickness / 2 + pxToCm(16)));
    ctx.fillStyle = op.type === 'door' ? COL.door : COL.window;
    ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(op.code, p.x, p.y);
  }

  // ─── SNAP (correção 6: 15px, endpoint>mid>face>grid) ─────────────────────────
  function snapCandidates() {
    const out = [];
    state.walls.forEach(w => {
      out.push({ x: w.x1, y: w.y1, type: 'wallEndpoint', pr: 0 });
      out.push({ x: w.x2, y: w.y2, type: 'wallEndpoint', pr: 0 });
      out.push({ x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2, type: 'wallMidpoint', pr: 1 });
    });
    if (wallChain && wallChain.pts.length) { const p0 = wallChain.pts[0]; out.push({ x: p0.x, y: p0.y, type: 'chainStart', pr: 0 }); }
    return out;
  }
  function findSnap(mousePx) {
    if (distActive) return null; // input de distância: direção livre
    const mw = screenToWorld(mousePx.x, mousePx.y);
    let best = null, bestScore = Infinity;
    snapCandidates().forEach(c => {
      const s = worldToScreen(c.x, c.y); const d = Math.hypot(mousePx.x - s.x, mousePx.y - s.y);
      if (d < SNAP_RADIUS_PX) { const score = c.pr * 1000 + d; if (score < bestScore) { bestScore = score; best = c; } }
    });
    if (best) return best;
    // wallFace (perpendicular)
    state.walls.forEach(w => {
      const pr = projSeg(mw.x, mw.y, w.x1, w.y1, w.x2, w.y2);
      if (pr.t > 0.05 && pr.t < 0.95) { const s = worldToScreen(pr.x, pr.y); const d = Math.hypot(mousePx.x - s.x, mousePx.y - s.y); if (d < SNAP_RADIUS_PX && d < bestScore) { bestScore = d; best = { x: pr.x, y: pr.y, type: 'wallFace', pr: 2 }; } }
    });
    if (best) return best;
    // gridPoint (10cm)
    const gx = Math.round(mw.x / GRID_CM) * GRID_CM, gy = Math.round(mw.y / GRID_CM) * GRID_CM;
    const gs = worldToScreen(gx, gy);
    if (Math.hypot(mousePx.x - gs.x, mousePx.y - gs.y) < SNAP_RADIUS_PX) return { x: gx, y: gy, type: 'gridPoint', pr: 3 };
    return null;
  }
  function drawSnapIndicator() {
    if (!snapPt) return;
    const s = worldToScreen(snapPt.x, snapPt.y);
    ctx.strokeStyle = COL.snap; ctx.fillStyle = COL.snap; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.stroke();
    if (snapPt.type === 'wallEndpoint' || snapPt.type === 'chainStart') ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
    else if (snapPt.type === 'wallMidpoint') { ctx.beginPath(); ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x + 5, s.y + 4); ctx.lineTo(s.x - 5, s.y + 4); ctx.closePath(); ctx.stroke(); }
    else if (snapPt.type === 'wallFace') { ctx.beginPath(); ctx.moveTo(s.x - 4, s.y - 4); ctx.lineTo(s.x + 4, s.y + 4); ctx.moveTo(s.x + 4, s.y - 4); ctx.lineTo(s.x - 4, s.y + 4); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, Math.PI * 2); ctx.fill(); }
  }
  function wallUnderCursor(wx, wy) {
    let best = null, bestPx = 16;
    state.walls.forEach(w => { const pr = projSeg(wx, wy, w.x1, w.y1, w.x2, w.y2); const px = cmToPx(pr.d); if (px < bestPx) { bestPx = px; best = { wall: w, t: pr.t, x: pr.x, y: pr.y }; } });
    return best;
  }

  function drawDimensions() {
    ctx.strokeStyle = COL.dim; ctx.fillStyle = COL.dim; ctx.setLineDash([]);
    state.dimensions.forEach(dm => {
      const ox = dm.offsetDir.x * dm.offsetDist, oy = dm.offsetDir.y * dm.offsetDist;
      const pA = worldToScreen(dm.x1, dm.y1), pB = worldToScreen(dm.x2, dm.y2);
      const cA = { x: pA.x + ox, y: pA.y + oy }, cB = { x: pB.x + ox, y: pB.y + oy };
      ctx.lineWidth = 1;
      const mag = Math.hypot(ox, oy) || 1, en = { x: ox / mag, y: oy / mag };
      ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(cA.x + en.x * 5, cA.y + en.y * 5);
      ctx.moveTo(pB.x, pB.y); ctx.lineTo(cB.x + en.x * 5, cB.y + en.y * 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cA.x, cA.y); ctx.lineTo(cB.x, cB.y); ctx.stroke();
      const ang = Math.atan2(cB.y - cA.y, cB.x - cA.x);
      [cA, cB].forEach(p => { ctx.beginPath(); ctx.moveTo(p.x - Math.cos(ang + Math.PI / 4) * 4, p.y - Math.sin(ang + Math.PI / 4) * 4); ctx.lineTo(p.x + Math.cos(ang + Math.PI / 4) * 4, p.y + Math.sin(ang + Math.PI / 4) * 4); ctx.stroke(); });
      const mx = (cA.x + cB.x) / 2, my = (cA.y + cB.y) / 2;
      ctx.save(); ctx.translate(mx, my); let r = ang; if (r > Math.PI / 2 || r < -Math.PI / 2) r += Math.PI; ctx.rotate(r);
      ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(fmtM(dm.value) + ' m', 0, -4); ctx.restore();
    });
  }

  function makeRoomFromChain(pts) {
    const verts = pts.slice(0, -1);
    if (verts.length < 3) return;
    const area = shoelaceArea(verts), c = centroid(verts), id = uid('r');
    state.rooms.push({ id, name: 'Ambiente', wallIds: [], vertices: verts, area, centerX: c.x, centerY: c.y });
    state.texts.push({ id: uid('t'), x: c.x, y: c.y, text: 'Ambiente\n' + area.toFixed(2).replace('.', ',') + ' m²', roomId: id });
    showToast('Ambiente detectado: ' + area.toFixed(2).replace('.', ',') + ' m² — 2 cliques p/ nomear', 2400);
  }
  function drawRooms() {
    ctx.fillStyle = 'rgba(74,143,64,0.05)';
    state.rooms.forEach(r => {
      if (!r.vertices || r.vertices.length < 3) return;
      ctx.beginPath();
      const s0 = worldToScreen(r.vertices[0].x, r.vertices[0].y); ctx.moveTo(s0.x, s0.y);
      r.vertices.forEach((p, i) => { if (i) { const s = worldToScreen(p.x, p.y); ctx.lineTo(s.x, s.y); } });
      ctx.closePath(); ctx.fill();
    });
  }
  function roomUnderPoint(wx, wy) { for (const r of state.rooms) { if (r.vertices && r.vertices.length >= 3 && pointInPoly(wx, wy, r.vertices)) return r; } return null; }
  function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
    }
    return inside;
  }
  function drawTexts() {
    ctx.fillStyle = COL.text; ctx.textAlign = 'center';
    state.texts.forEach(t => {
      const p = worldToScreen(t.x, t.y); const lines = String(t.text).split('\n');
      lines.forEach((ln, i) => { ctx.font = (i === 0 ? 'bold ' : '') + '12px sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(ln, p.x, p.y + (i - (lines.length - 1) / 2) * 15); });
    });
  }

  function drawGrid() {
    const minor = 100, major = 500;
    const tl = screenToWorld(0, 0), br = screenToWorld(W, H);
    const lines = (step, color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
      const x0 = Math.floor(tl.x / step) * step, x1 = Math.ceil(br.x / step) * step;
      for (let x = x0; x <= x1; x += step) { const s = worldToScreen(x, 0).x; ctx.moveTo(s, 0); ctx.lineTo(s, H); }
      const y0 = Math.floor(tl.y / step) * step, y1 = Math.ceil(br.y / step) * step;
      for (let y = y0; y <= y1; y += step) { const s = worldToScreen(0, y).y; ctx.moveTo(0, s); ctx.lineTo(W, s); }
      ctx.stroke();
    };
    if (cmToPx(minor) > 6) lines(minor, COL.gridMinor, 1);
    lines(major, COL.gridMajor, 1);
    ctx.strokeStyle = COL.axis; ctx.lineWidth = 1; ctx.beginPath();
    const o = worldToScreen(0, 0); ctx.moveTo(o.x, 0); ctx.lineTo(o.x, H); ctx.moveTo(0, o.y); ctx.lineTo(W, o.y); ctx.stroke();
  }
  function redraw() {
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    drawGrid(); drawRooms(); drawWalls(); drawOpeningsCut(); drawOpenings(); drawDimensions(); drawTexts();
    drawGhost(); drawSelection(); drawSnapIndicator(); updateHud();
    scheduleAutosave();
  }
  function drawGhost() {
    if (wallChain && wallChain.pts.length) {
      ctx.strokeStyle = COL.wallStroke; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.4;
      ctx.beginPath();
      const s0 = worldToScreen(wallChain.pts[0].x, wallChain.pts[0].y); ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < wallChain.pts.length; i++) { const s = worldToScreen(wallChain.pts[i].x, wallChain.pts[i].y); ctx.lineTo(s.x, s.y); }
      const cur = wallPlacePoint(pointer.wx, pointer.wy, snapPt); const sc = worldToScreen(cur.x, cur.y); ctx.lineTo(sc.x, sc.y);
      ctx.stroke(); ctx.setLineDash([]);
      const last = wallChain.pts[wallChain.pts.length - 1];
      ctx.fillStyle = COL.dim; ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('→ ' + fmtM(dist(last.x, last.y, cur.x, cur.y)) + ' m', sc.x + 10, sc.y - 8);
    }
    const draft = dimDraft || measureDraft;
    if (draft) {
      const a = worldToScreen(draft.a.x, draft.a.y); const cur = snapPt || { x: pointer.wx, y: pointer.wy }; const b = worldToScreen(cur.x, cur.y);
      ctx.strokeStyle = measureDraft ? '#9fd0ff' : COL.dim; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle; ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(fmtM(dist(draft.a.x, draft.a.y, cur.x, cur.y)) + ' m', b.x + 8, b.y - 6);
    }
  }
  function drawSelection() {
    if (!selected || selected.kind !== 'wall') return;
    const w = state.walls.find(x => x.id === selected.id); if (!w) return;
    const q = getWallPolygon(w).map(p => worldToScreen(p.x, p.y));
    ctx.strokeStyle = COL.dim; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); q.forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    // handles nos endpoints (quadrados brancos 8x8)
    ctx.fillStyle = '#fff'; ctx.strokeStyle = COL.dim;
    [[w.x1, w.y1], [w.x2, w.y2]].forEach(([x, y]) => { const s = worldToScreen(x, y); ctx.fillRect(s.x - 4, s.y - 4, 8, 8); ctx.strokeRect(s.x - 4, s.y - 4, 8, 8); });
  }
  function updateHud() {
    const z = document.getElementById('zoom'); if (z) z.textContent = Math.round(state.zoom * 100) + '%' + (orthoMode ? ' · ORTO' : '');
  }
  let toastTimer = null;
  function showToast(msg, dur = 1600) { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, dur); }
  function setLoading(s) { const l = document.getElementById('loading'); if (l) l.classList.toggle('visible', s); }

  // ─── UNDO/REDO + AUTOSAVE (correção 4) ───────────────────────────────────────
  function snapshot() { return JSON.stringify({ walls: state.walls, openings: state.openings, rooms: state.rooms, dimensions: state.dimensions, texts: state.texts }); }
  function pushHistory() { undoStack.push(snapshot()); if (undoStack.length > MAX_HISTORY) undoStack.shift(); redoStack.length = 0; savedClean = false; }
  function applySnap(s) { const o = JSON.parse(s); state.walls = o.walls; state.openings = o.openings; state.rooms = o.rooms; state.dimensions = o.dimensions; state.texts = o.texts; }
  function undo() { if (!undoStack.length) { showToast('Nada para desfazer', 900); return; } redoStack.push(snapshot()); applySnap(undoStack.pop()); selected = null; closeWallPanel(); redraw(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); applySnap(redoStack.pop()); selected = null; redraw(); }
  function clearAll() { if (!confirm('Limpar todo o croqui?')) return; pushHistory(); state.walls = []; state.openings = []; state.rooms = []; state.dimensions = []; state.texts = []; wallChain = dimDraft = measureDraft = null; selected = null; closeWallPanel(); redraw(); }

  let autosaveTimer = null;
  function scheduleAutosave() { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(autosave, 800); }
  function autosave() {
    try {
      if (!state.walls.length && !state.openings.length && !state.texts.length) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
      localStorage.setItem(STORAGE_KEY + '_ts', Date.now().toString());
    } catch (e) { /* quota / modo privado */ }
  }
  function clearAutosave() { try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_KEY + '_ts'); } catch (e) {} }

  function serializeState() { return { scale: state.scale, zoom: state.zoom, pan: { ...state.pan }, wallThickness: state.wallThickness, walls: state.walls, openings: state.openings, rooms: state.rooms, dimensions: state.dimensions, texts: state.texts }; }
  function restoreState(o) {
    if (!o) return;
    state.scale = o.scale || state.scale; state.zoom = o.zoom || 1; state.pan = o.pan || { x: 0, y: 0 }; state.wallThickness = o.wallThickness || 15;
    state.walls = o.walls || []; state.openings = o.openings || []; state.rooms = o.rooms || []; state.dimensions = o.dimensions || []; state.texts = o.texts || [];
  }
  function addWall(w) { state.walls.push(w); }
  function clearWalls() { state.walls = []; }

  const DOOR_LABEL = { swing1: 'Abrir 1F', swing2: 'Abrir 2F', sliding: 'Correr', gate: 'Portão' };
  const WIN_LABEL = { maximar: 'Máximo-ar', sliding2: 'Correr 2F', sliding4: 'Correr 4F', hopper: 'Basculante' };
  function groupOpenings(kind, typeField) {
    const groups = {};
    state.openings.filter(o => o.type === kind).forEach(op => {
      const key = op[typeField] + '_' + op.width + 'x' + op.height;
      if (!groups[key]) groups[key] = { [typeField]: op[typeField], width: op.width, height: op.height, count: 0, codes: [] };
      groups[key].count++; if (op.code) groups[key].codes.push(op.code);
    });
    return Object.values(groups).sort((a, b) => (a.codes[0] || '').localeCompare(b.codes[0] || '', 'pt', { numeric: true }));
  }
  function buildDoorsTable() { return groupOpenings('door', 'doorType'); }
  function buildWindowsTable() { return groupOpenings('window', 'windowType'); }
  function buildRoomsTable() { return state.rooms.map(r => ({ name: r.name || '(sem nome)', area: r.area.toFixed(2).replace('.', ',') })); }
  function dimStr(cm) { return (cm / 100).toFixed(2).replace('.', ','); }
  function openTables() { const ov = document.getElementById('tablesOverlay'); if (!ov) return; renderTablesTab('doors'); ov.style.display = 'flex'; }
  function renderTablesTab(tab) {
    document.querySelectorAll('#tablesOverlay .ttab').forEach(b => b.classList.toggle('active', b.dataset.ttab === tab));
    const host = document.getElementById('tablesBody'); if (!host) return;
    let rows = [], headers = [];
    if (tab === 'doors') { headers = ['Código(s)', 'Tipo', 'L×A (m)', 'Qtd']; rows = buildDoorsTable().map(d => [d.codes.join(', ') || '—', DOOR_LABEL[d.doorType] || d.doorType, dimStr(d.width) + '×' + dimStr(d.height), String(d.count)]); }
    else if (tab === 'windows') { headers = ['Código(s)', 'Tipo', 'L×A (m)', 'Qtd']; rows = buildWindowsTable().map(d => [d.codes.join(', ') || '—', WIN_LABEL[d.windowType] || d.windowType, dimStr(d.width) + '×' + dimStr(d.height), String(d.count)]); }
    else { headers = ['Ambiente', 'Área (m²)']; rows = buildRoomsTable().map(r => [r.name, r.area]); }
    if (!rows.length) { host.innerHTML = '<p style="opacity:.55;padding:10px 0">Nenhum item.</p>'; host._rows = null; return; }
    let html = '<table><thead><tr>' + headers.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>';
    rows.forEach(r => { html += '<tr>' + r.map((c, i) => '<td' + (i === r.length - 1 ? ' class="num"' : '') + '>' + c + '</td>').join('') + '</tr>'; });
    host.innerHTML = html + '</tbody></table>';
    host._headers = headers; host._rows = rows;
  }
  function copyTable(sep) {
    const host = document.getElementById('tablesBody'); if (!host || !host._rows) return;
    const esc = v => sep === ',' && /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    const txt = [host._headers.map(esc).join(sep), ...host._rows.map(r => r.map(esc).join(sep))].join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => showToast('Copiado ' + (sep === ',' ? 'CSV' : 'TSV'), 1100),
      () => { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); showToast('Copiado', 1100); });
  }

  let openingCtx = null;
  const DOOR_TYPES = [['swing1', 'Abrir 1 folha'], ['swing2', 'Abrir 2 folhas'], ['sliding', 'Correr'], ['gate', 'Portão']];
  const WIN_TYPES = [['maximar', 'Máximo-ar'], ['sliding2', 'Correr 2 folhas'], ['sliding4', 'Correr 4 folhas'], ['hopper', 'Basculante']];
  function showOpeningPanel(kind, sx, sy, existing) {
    const panel = document.getElementById('openingPanel'); if (!panel) return;
    const isDoor = kind === 'door';
    document.getElementById('op-title').textContent = (existing ? 'Editar ' : 'Inserir ') + (isDoor ? 'Porta' : 'Janela');
    const codeEl = document.getElementById('op-code');
    if (existing) codeEl.value = existing.code || '';
    else { const pref = isDoor ? 'P' : 'J'; const nums = state.openings.filter(o => o.type === kind).map(o => parseInt((o.code || '').replace(/\D/g, '')) || 0); codeEl.value = pref + ((nums.length ? Math.max(...nums) : (isDoor ? 5 : 10)) + 1); }
    document.getElementById('op-w').value = existing ? existing.width : (isDoor ? 80 : 120);
    document.getElementById('op-h').value = existing ? existing.height : (isDoor ? 210 : 110);
    const typeSel = document.getElementById('op-type'); typeSel.innerHTML = '';
    (isDoor ? DOOR_TYPES : WIN_TYPES).forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; typeSel.appendChild(o); });
    if (existing) typeSel.value = isDoor ? existing.doorType : existing.windowType;
    document.getElementById('op-swing-wrap').style.display = isDoor ? 'block' : 'none';
    if (existing && isDoor) document.getElementById('op-swing').value = existing.swingDir || 'left';
    panel.dataset.kind = kind;
    const wr = wrap.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(sx, wr.width - 230)) + 'px';
    panel.style.top = Math.max(8, Math.min(sy, wr.height - 290)) + 'px';
    panel.style.display = 'block'; codeEl.focus();
  }
  function hideOpeningPanel() { const p = document.getElementById('openingPanel'); if (p) p.style.display = 'none'; openingCtx = null; }
  function applyOpening() {
    if (!openingCtx) return hideOpeningPanel();
    const kind = document.getElementById('openingPanel').dataset.kind;
    const code = document.getElementById('op-code').value.trim();
    const width = parseFloat(document.getElementById('op-w').value) || 80;
    const height = parseFloat(document.getElementById('op-h').value) || 210;
    const type = document.getElementById('op-type').value;
    pushHistory();
    if (openingCtx.editId) {
      const op = state.openings.find(o => o.id === openingCtx.editId);
      if (op) { op.code = code; op.width = width; op.height = height; if (kind === 'door') { op.doorType = type; op.swingDir = document.getElementById('op-swing').value; } else op.windowType = type; }
    } else {
      const op = { id: uid('o'), type: kind, wallId: openingCtx.wall.id, posAlongWall: Math.max(0, openingCtx.posAlongWall - width / 2), width, height, code, flipped: false, rotation: 0 };
      if (kind === 'door') { op.doorType = type; op.swingDir = 'left'; } else op.windowType = type;
      state.openings.push(op);
    }
    hideOpeningPanel(); redraw();
  }
  function flipSelectedOpening() { if (selected && selected.kind === 'opening') { const op = state.openings.find(o => o.id === selected.id); if (op) { pushHistory(); op.flipped = !op.flipped; redraw(); } } }
  function rotateSelectedOpening() { if (selected && selected.kind === 'opening') { const op = state.openings.find(o => o.id === selected.id); if (op) { pushHistory(); op.rotation = op.rotation === 180 ? 0 : 180; redraw(); } } }

  // ─── CORREÇÃO 3: EDIÇÃO DE PAREDE ────────────────────────────────────────────
  function openWallPanel(wall) {
    const p = document.getElementById('wallEditPanel'); if (!p) return;
    document.getElementById('wallLenInput').value = Math.round(wallLength(wall));
    document.getElementById('wallAngleInput').value = Math.round(wallAngleDeg(wall) * 10) / 10;
    document.getElementById('wallThickInput').value = wall.thickness;
    p.style.display = 'block';
  }
  function closeWallPanel() { const p = document.getElementById('wallEditPanel'); if (p) p.style.display = 'none'; }
  function selWall() { return selected && selected.kind === 'wall' ? state.walls.find(w => w.id === selected.id) : null; }
  function applyWallLength() {
    const w = selWall(); if (!w) return; const nl = parseFloat(document.getElementById('wallLenInput').value); if (!(nl > 0)) return;
    pushHistory(); const dx = w.x2 - w.x1, dy = w.y2 - w.y1, cur = Math.hypot(dx, dy) || 1e-9, s = nl / cur;
    w.x2 = w.x1 + dx * s; w.y2 = w.y1 + dy * s; redraw();
  }
  function applyWallAngle() {
    const w = selWall(); if (!w) return; const na = parseFloat(document.getElementById('wallAngleInput').value); if (isNaN(na)) return;
    pushHistory(); const len = wallLength(w), rad = na * Math.PI / 180; w.x2 = w.x1 + len * Math.cos(rad); w.y2 = w.y1 + len * Math.sin(rad); redraw();
  }
  function applyWallThick() { const w = selWall(); if (!w) return; pushHistory(); w.thickness = parseInt(document.getElementById('wallThickInput').value) || 15; redraw(); }
  function rotate90(x, y, cx, cy) { return [cx + (y - cy), cy - (x - cx)]; }
  function rotateWall90() { const w = selWall(); if (!w) return; pushHistory(); const cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2;[w.x1, w.y1] = rotate90(w.x1, w.y1, cx, cy);[w.x2, w.y2] = rotate90(w.x2, w.y2, cx, cy); openWallPanel(w); redraw(); }
  function flipWall() { const w = selWall(); if (!w) return; pushHistory();[w.x1, w.x2] = [w.x2, w.x1];[w.y1, w.y2] = [w.y2, w.y1]; openWallPanel(w); redraw(); }
  function deleteSelected() { if (!selected) return; pushHistory(); removeElement(selected); selected = null; closeWallPanel(); redraw(); }
  function checkHandleHit(mpx) {
    const w = selWall(); if (!w) return null;
    const p1 = worldToScreen(w.x1, w.y1), p2 = worldToScreen(w.x2, w.y2);
    if (Math.hypot(mpx.x - p1.x, mpx.y - p1.y) < 9) return 'p1';
    if (Math.hypot(mpx.x - p2.x, mpx.y - p2.y) < 9) return 'p2';
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    if (Math.hypot(mpx.x - mid.x, mpx.y - mid.y) < 12) return 'move';
    return null;
  }

  function pickElement(wx, wy) {
    for (const op of state.openings) {
      const w = state.walls.find(W2 => W2.id === op.wallId); if (!w) continue;
      const d = wallDir(w); const cx = w.x1 + d.ux * (op.posAlongWall + op.width / 2), cy = w.y1 + d.uy * (op.posAlongWall + op.width / 2);
      if (cmToPx(dist(wx, wy, cx, cy)) < 18) return { kind: 'opening', id: op.id };
    }
    for (const t of state.texts) if (cmToPx(dist(wx, wy, t.x, t.y)) < 30) return { kind: 'text', id: t.id };
    for (const dm of state.dimensions) { const pr = projSeg(wx, wy, dm.x1, dm.y1, dm.x2, dm.y2); if (cmToPx(pr.d) < 14) return { kind: 'dimension', id: dm.id }; }
    for (const w of state.walls) { const pr = projSeg(wx, wy, w.x1, w.y1, w.x2, w.y2); if (cmToPx(pr.d) < Math.max(9, cmToPx(w.thickness / 2))) return { kind: 'wall', id: w.id }; }
    return null;
  }
  function removeElement(hit) {
    if (hit.kind === 'wall') { state.walls = state.walls.filter(w => w.id !== hit.id); state.openings = state.openings.filter(o => o.wallId !== hit.id); }
    else if (hit.kind === 'opening') state.openings = state.openings.filter(o => o.id !== hit.id);
    else if (hit.kind === 'text') state.texts = state.texts.filter(t => t.id !== hit.id);
    else if (hit.kind === 'dimension') state.dimensions = state.dimensions.filter(d => d.id !== hit.id);
  }

  function onToolDown(wx, wy, snap) {
    const place = wallPlacePoint(wx, wy, snap);
    const tx = snap ? snap.x : wx, ty = snap ? snap.y : wy;
    switch (activeTool) {
      case 'wall': {
        if (!wallChain) { wallChain = { pts: [place], thickness: state.wallThickness }; break; }
        const p0 = wallChain.pts[0]; const sp = worldToScreen(p0.x, p0.y), scn = worldToScreen(place.x, place.y);
        const closing = wallChain.pts.length >= 3 && Math.hypot(sp.x - scn.x, sp.y - scn.y) <= SNAP_RADIUS_PX;
        if (closing) { finishWall(true); } else wallChain.pts.push(place);
        break;
      }
      case 'door': case 'window': {
        const wu = wallUnderCursor(wx, wy);
        if (!wu) { showToast('Clique sobre uma parede', 1200); break; }
        const d = wallDir(wu.wall);
        openingCtx = { wall: wu.wall, posAlongWall: wu.t * d.len, editId: null };
        const s = worldToScreen(wu.x, wu.y); showOpeningPanel(activeTool, s.x + 12, s.y + 12, null);
        break;
      }
      case 'dim': {
        if (!dimDraft) { dimDraft = { a: { x: tx, y: ty } }; showToast('Clique o 2º ponto', 1000); break; }
        const a = dimDraft.a, b = { x: tx, y: ty };
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1e-9;
        let dir = { x: -dy / L, y: dx / L };
        const bb = bbox(); const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (dir.x * (bb.cx - mid.x) + dir.y * (bb.cy - mid.y) > 0) dir = { x: -dir.x, y: -dir.y };
        pushHistory();
        state.dimensions.push({ id: uid('d'), x1: a.x, y1: a.y, x2: b.x, y2: b.y, offsetDir: dir, offsetDist: 40, value: dist(a.x, a.y, b.x, b.y) });
        dimDraft = null; redraw();
        break;
      }
      case 'measure': {
        if (!measureDraft) { measureDraft = { a: { x: tx, y: ty } }; showToast('Clique o 2º ponto', 1000); }
        else { showToast('Distância: ' + fmtM(dist(measureDraft.a.x, measureDraft.a.y, tx, ty)) + ' m', 2200); measureDraft = null; }
        break;
      }
      case 'text': {
        const room = roomUnderPoint(wx, wy);
        const nome = prompt('Nome do ambiente:', room ? (room.name || '') : '');
        if (nome === null) break;
        pushHistory();
        if (room) { room.name = nome; const tl = state.texts.find(t => t.roomId === room.id); const txt = nome + '\n' + room.area.toFixed(2).replace('.', ',') + ' m²'; if (tl) tl.text = txt; else state.texts.push({ id: uid('t'), x: room.centerX, y: room.centerY, text: txt, roomId: room.id }); }
        else state.texts.push({ id: uid('t'), x: wx, y: wy, text: nome });
        redraw();
        break;
      }
      case 'north': { pushHistory(); state.texts.push({ id: uid('t'), x: wx, y: wy, text: 'N↑', isNorth: true }); redraw(); break; }
      case 'erase': { const hit = pickElement(wx, wy); if (hit) { pushHistory(); removeElement(hit); selected = null; closeWallPanel(); redraw(); } break; }
      case 'select': {
        const hit = pickElement(wx, wy); selected = hit; closeWallPanel(); hideOpeningPanel();
        if (hit && hit.kind === 'wall') openWallPanel(state.walls.find(w => w.id === hit.id));
        else if (hit && hit.kind === 'opening') { const op = state.openings.find(o => o.id === hit.id); const w = state.walls.find(W2 => W2.id === op.wallId); const d = wallDir(w); const c = worldToScreen(w.x1 + d.ux * (op.posAlongWall + op.width / 2), w.y1 + d.uy * (op.posAlongWall + op.width / 2)); openingCtx = { wall: w, posAlongWall: op.posAlongWall, editId: op.id }; showOpeningPanel(op.type, c.x, c.y, op); }
        redraw();
        break;
      }
    }
  }
  function finishWall(closed) {
    if (!wallChain || wallChain.pts.length < 2) { wallChain = null; return; }
    pushHistory();
    const pts = wallChain.pts.slice(); const th = wallChain.thickness;
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; state.walls.push({ id: uid('w'), x1: a.x, y1: a.y, x2: b.x, y2: b.y, thickness: th }); }
    if (closed) makeRoomFromChain(pts.concat([pts[0]]));
    wallChain = null; redraw();
  }
  function bbox() {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    state.walls.forEach(w => { a = Math.min(a, w.x1, w.x2); b = Math.min(b, w.y1, w.y2); c = Math.max(c, w.x1, w.x2); d = Math.max(d, w.y1, w.y2); });
    if (!isFinite(a)) return { cx: 0, cy: 0 };
    return { cx: (a + c) / 2, cy: (b + d) / 2 };
  }

  function rawPos(e) { const r = canvas.getBoundingClientRect(); if (e.touches && e.touches.length) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top }; return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function onDown(e) {
    if (e.cancelable) e.preventDefault();
    const rp = rawPos(e); const w = screenToWorld(rp.x, rp.y); pointer = { sx: rp.x, sy: rp.y, wx: w.x, wy: w.y };
    if (activeTool === 'pan' || e.button === 1) { panDrag = { sx: rp.x, sy: rp.y, px: state.pan.x, py: state.pan.y }; wrap.classList.add('panning'); return; }
    if (activeTool === 'select' && selWall()) { const h = checkHandleHit(rp); if (h) { dragHandle = h; dragLast = { x: w.x, y: w.y }; pushHistory(); return; } }
    onToolDown(w.x, w.y, findSnap(rp));
  }
  function onMove(e) {
    if (e.cancelable) e.preventDefault();
    const rp = rawPos(e); const w = screenToWorld(rp.x, rp.y); pointer = { sx: rp.x, sy: rp.y, wx: w.x, wy: w.y };
    if (panDrag) { state.pan.x = panDrag.px + (rp.x - panDrag.sx); state.pan.y = panDrag.py + (rp.y - panDrag.sy); redraw(); return; }
    if (dragHandle) {
      const wl = selWall(); if (wl) {
        const sn = findSnap(rp); const tx = sn ? sn.x : w.x, ty = sn ? sn.y : w.y;
        if (dragHandle === 'p1') { wl.x1 = tx; wl.y1 = ty; }
        else if (dragHandle === 'p2') { wl.x2 = tx; wl.y2 = ty; }
        else { const ddx = w.x - dragLast.x, ddy = w.y - dragLast.y; wl.x1 += ddx; wl.y1 += ddy; wl.x2 += ddx; wl.y2 += ddy; dragLast = { x: w.x, y: w.y }; }
        openWallPanel(wl);
      }
      redraw(); return;
    }
    if (['wall', 'dim', 'measure'].includes(activeTool)) snapPt = findSnap(rp);
    else if (['door', 'window'].includes(activeTool)) { const wu = wallUnderCursor(w.x, w.y); snapPt = wu ? { x: wu.x, y: wu.y, type: 'wallFace' } : null; }
    else snapPt = null;
    redraw();
  }
  function onUp() { if (dragHandle) { dragHandle = null; redraw(); } panDrag = null; if (wrap) wrap.classList.remove('panning'); }
  function onDbl(e) {
    const rp = rawPos(e); const w = screenToWorld(rp.x, rp.y);
    if (activeTool === 'wall' && wallChain) { finishWall(false); return; }
    const room = roomUnderPoint(w.x, w.y);
    if (room) { const nome = prompt('Nome do cômodo:', room.name || ''); if (nome !== null) { pushHistory(); room.name = nome; const tl = state.texts.find(t => t.roomId === room.id); if (tl) tl.text = nome + '\n' + room.area.toFixed(2).replace('.', ',') + ' m²'; redraw(); } }
  }
  function onWheel(e) { e.preventDefault(); const rp = rawPos(e); const before = screenToWorld(rp.x, rp.y); const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; state.zoom = Math.max(0.2, Math.min(5, state.zoom * f)); const after = screenToWorld(rp.x, rp.y); state.pan.x += (after.x - before.x) * pxPerCm(); state.pan.y += (after.y - before.y) * pxPerCm(); redraw(); }
  function touchDist(e) { return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
  function onTouchStart(e) { if (e.touches.length === 2) { lastTouchDist = touchDist(e); return; } onDown(e); }
  function onTouchMove(e) {
    if (e.touches.length === 2 && lastTouchDist !== null) {
      e.preventDefault(); const nd = touchDist(e), f = nd / lastTouchDist;
      const r = canvas.getBoundingClientRect(); const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      const before = screenToWorld(cx, cy); state.zoom = Math.max(0.2, Math.min(5, state.zoom * f));
      const after = screenToWorld(cx, cy); state.pan.x += (after.x - before.x) * pxPerCm(); state.pan.y += (after.y - before.y) * pxPerCm();
      lastTouchDist = nd; redraw(); return;
    }
    onMove(e);
  }
  function onTouchEnd(e) { lastTouchDist = null; onUp(e); }

  // ─── CORREÇÃO 2: INPUT DE DISTÂNCIA ──────────────────────────────────────────
  function showDistInput() {
    const el = document.getElementById('distInput'); if (!el) return;
    document.getElementById('distInputValue').textContent = distBuffer || '0';
    el.style.display = 'block'; el.style.left = (pointer.sx + 16) + 'px'; el.style.top = (pointer.sy - 12) + 'px';
  }
  function cancelDist() { distBuffer = ''; distActive = false; const el = document.getElementById('distInput'); if (el) el.style.display = 'none'; }
  function commitDist() {
    const cm = parseFloat(distBuffer);
    if (!(cm > 0) || !wallChain || !wallChain.pts.length) return cancelDist();
    const last = wallChain.pts[wallChain.pts.length - 1];
    let dir = { x: pointer.wx - last.x, y: pointer.wy - last.y };
    if (orthoMode) { const o = applyOrtho(last, { x: pointer.wx, y: pointer.wy }); dir = { x: o.x - last.x, y: o.y - last.y }; }
    const L = Math.hypot(dir.x, dir.y); if (L < 0.01) return cancelDist();
    dir = { x: dir.x / L, y: dir.y / L };
    wallChain.pts.push({ x: last.x + dir.x * cm, y: last.y + dir.y * cm });
    cancelDist(); redraw();
  }
  function onKey(e) {
    const typing = /input|select|textarea/i.test(e.target.tagName || '');
    // input de distância (parede em desenho)
    if (!typing && activeTool === 'wall' && wallChain && wallChain.pts.length) {
      if ((e.key >= '0' && e.key <= '9') || e.key === '.' || e.key === ',') { distBuffer += (e.key === ',' ? '.' : e.key); distActive = true; showDistInput(); e.preventDefault(); return; }
      if (e.key === 'Backspace' && distActive) { distBuffer = distBuffer.slice(0, -1); showDistInput(); e.preventDefault(); return; }
      if (e.key === 'Enter' && distActive && distBuffer) { commitDist(); e.preventDefault(); return; }
    }
    if (typing) return;
    if (e.key === 'F8') { e.preventDefault(); toggleOrtho(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') { if (distActive) { cancelDist(); return; } wallChain = dimDraft = measureDraft = null; hideOpeningPanel(); closeWallPanel(); selected = null; redraw(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { pushHistory(); removeElement(selected); selected = null; closeWallPanel(); redraw(); return; }
    const map = { s: 'select', h: 'pan', w: 'wall', p: 'door', j: 'window', c: 'dim', t: 'text', m: 'measure', n: 'north', e: 'erase' };
    if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
  }
  function setTool(tool) {
    activeTool = tool; wallChain = dimDraft = measureDraft = null; hideOpeningPanel(); closeWallPanel(); cancelDist(); selected = null;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    if (wrap) wrap.className = 'tool-' + tool;
    redraw();
  }
  function resizeCanvas() {
    const rect = wrap.getBoundingClientRect(); W = rect.width; H = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    redraw();
  }

  function exportDataURL() {
    if (!state.walls.length) return canvas.toDataURL('image/png');
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    state.walls.forEach(w => { getWallPolygon(w).forEach(p => { a = Math.min(a, p.x); b = Math.min(b, p.y); c = Math.max(c, p.x); d = Math.max(d, p.y); }); });
    state.texts.forEach(t => { a = Math.min(a, t.x); b = Math.min(b, t.y); c = Math.max(c, t.x); d = Math.max(d, t.y); });
    const padCm = 80, wCm = (c - a) + padCm * 2, hCm = (d - b) + padCm * 2;
    const px = Math.min(2400 / wCm, 2400 / hCm, 6) || 1;
    const off = document.createElement('canvas'); off.width = Math.max(1, Math.round(wCm * px)); off.height = Math.max(1, Math.round(hCm * px));
    const savCtx = ctx, savW = W, savH = H, savPan = { ...state.pan }, savZoom = state.zoom, savScale = state.scale;
    ctx = off.getContext('2d'); W = off.width; H = off.height;
    state.zoom = 1; state.scale = '__png__'; BASE_SCALE['__png__'] = px; state.pan = { x: (-a + padCm) * px, y: (-b + padCm) * px };
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    drawRooms(); drawWalls(); drawOpeningsCut(); drawOpenings(); drawDimensions(); drawTexts();
    const url = off.toDataURL('image/png');
    ctx = savCtx; W = savW; H = savH; state.pan = savPan; state.zoom = savZoom; state.scale = savScale; delete BASE_SCALE['__png__'];
    return url;
  }
  function svgConteudo() { return '<image href="' + exportDataURL() + '" x="0" y="0" width="2000" height="2000" preserveAspectRatio="xMidYMid meet"/>'; }
  function exportPNG() { try { const a = document.createElement('a'); a.href = exportDataURL(); a.download = 'croqui_vta_' + (cfg.canvasId || canvasId || 'novo') + '_' + Date.now() + '.png'; a.click(); showToast('PNG exportado ✓', 1200); } catch (err) { showToast('Erro PNG: ' + err.message, 1800); } }

  function api(path, opts) {
    opts = opts || {}; opts.credentials = 'include';
    return fetch(API + path, opts).then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('não autenticado'); } return r.json().then(j => { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); });
  }
  function titleNow() { return document.getElementById('title-text')?.textContent || cfg.titulo || 'Croqui As-Built'; }
  function escalaNow() { return state.scale; }
  function loadExisting() {
    let rota = null;
    if (canvasId) rota = '/' + canvasId; else if (cfg.laudoId != null) rota = '/por-laudo/' + cfg.laudoId; else if (cfg.propostaId != null) rota = '/por-proposta/' + cfg.propostaId;
    if (!rota) return Promise.resolve(false);
    return api(rota).then(j => {
      const c = j.canvas; if (!c) return false;
      canvasId = c.id;
      let dj = c.dados_json; if (typeof dj === 'string') { try { dj = JSON.parse(dj); } catch { dj = null; } }
      if (dj && dj.engine === 'asbuilt-v3' && dj.state) restoreState(dj.state);
      if (dj && dj.viewport) { state.pan = dj.viewport.pan || state.pan; state.zoom = dj.viewport.zoom || state.zoom; }
      const tt = document.getElementById('title-text'); if (tt && c.titulo) tt.textContent = c.titulo;
      if (c.escala_grafica && BASE_SCALE[c.escala_grafica]) { state.scale = c.escala_grafica; const sel = document.getElementById('sel-escala'); if (sel) sel.value = c.escala_grafica; }
      const vb = document.getElementById('vinculo-badge'); if (vb) { vb.style.display = ''; vb.textContent = '🔗 Editando #' + c.id; }
      const be = document.getElementById('btn-edit'); if (be) be.style.display = 'inline-flex';
      savedClean = true;
      return true;
    }).catch(() => false);
  }
  function ensureCanvas() {
    if (canvasId) return Promise.resolve(canvasId);
    const body = { tipo: 'croqui', titulo: titleNow(), escala_grafica: escalaNow(), largura_virtual: 2000, altura_virtual: 2000, laudo_id: cfg.laudoId ?? null, proposta_id: cfg.propostaId ?? null };
    return api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j => { canvasId = j.id; return canvasId; });
  }
  function save() {
    setLoading(true);
    return ensureCanvas().then(id => api('/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: titleNow(), escala_grafica: escalaNow(), largura_virtual: 2000, altura_virtual: 2000, dados_json: { engine: 'asbuilt-v3', state: serializeState(), viewport: { pan: state.pan, zoom: state.zoom } }, dados_svg: svgConteudo() }),
    })).then(() => { savedClean = true; clearAutosave(); showToast('Salvo com sucesso ✓', 1400); return canvasId; }).catch(e => { showToast('Erro ao salvar: ' + e.message, 2200); throw e; }).finally(() => setLoading(false));
  }
  function gerarPrancha(form) {
    setLoading(true);
    return save().then(id => api('/' + id + '/prancha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tituloObra: form.tituloObra, proprietario: form.proprietario, endereco: form.endereco, municipio: form.municipio, tipoObra: form.tipoObra, numeroPrancha: form.numeroPrancha, revisao: form.revisao, escala: escalaNow() }) }))
      .then(j => { const w = window.open('', '_blank'); if (w) { w.document.write(j.svg); w.document.close(); } showToast('Prancha #' + j.pranchaId + ' gerada ✓', 1500); return j; }).catch(e => { showToast('Erro prancha: ' + e.message, 2000); throw e; }).finally(() => setLoading(false));
  }
  function enviarWhatsapp(telefone) {
    setLoading(true);
    return ensureCanvas().then(id => api('/' + id + '/exportar-whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telefone, imagemBase64: exportDataURL(), legenda: 'Croqui As-Built — Romatec Consultoria Total' }) }))
      .then(j => { showToast('Enviado por WhatsApp ✓', 1500); return j; }).catch(e => { showToast('Erro WhatsApp: ' + e.message, 2000); throw e; }).finally(() => setLoading(false));
  }

  // ─── CORREÇÃO 4/5: VOLTAR com confirmação + recuperação ──────────────────────
  function hasContent() { return state.walls.length > 0 || state.openings.length > 0 || state.texts.length > 0; }
  function overlay(html) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:1000';
    d.innerHTML = '<div style="background:#1e2d3d;border:1px solid #2d4a5a;border-radius:8px;padding:22px;max-width:330px;width:90%;color:#fff;font:14px sans-serif">' + html + '</div>';
    document.body.appendChild(d); return d;
  }
  function handleBack() {
    if (!hasContent() || savedClean) { location.href = '/obras?vta=1'; return; }
    const d = overlay('<div style="font-size:16px;font-weight:bold;margin-bottom:10px">Sair do croqui?</div><div style="color:#aaa;margin-bottom:18px">Há alterações não enviadas ao servidor.</div><div style="display:flex;flex-direction:column;gap:8px"><button id="bk-save" style="background:#3a7d44;border:none;color:#fff;padding:10px;border-radius:4px;cursor:pointer">💾 Salvar e Sair</button><button id="bk-exit" style="background:#5a2d2d;border:none;color:#fff;padding:10px;border-radius:4px;cursor:pointer">🚪 Sair sem Salvar</button><button id="bk-cancel" style="background:transparent;border:1px solid #2d4a5a;color:#aaa;padding:10px;border-radius:4px;cursor:pointer">✕ Cancelar</button></div>');
    d.querySelector('#bk-save').onclick = () => { save().then(() => { location.href = '/obras?vta=1'; }).catch(() => {}); };
    d.querySelector('#bk-exit').onclick = () => { clearAutosave(); location.href = '/obras?vta=1'; };
    d.querySelector('#bk-cancel').onclick = () => d.remove();
  }
  function offerRecovery() {
    let ts; try { if (!localStorage.getItem(STORAGE_KEY)) return; ts = localStorage.getItem(STORAGE_KEY + '_ts'); } catch (e) { return; }
    if (hasContent()) return; // já carregou do servidor
    const ageMin = ts ? Math.max(0, Math.round((Date.now() - parseInt(ts)) / 60000)) : 0;
    const d = overlay('<div style="font-size:16px;font-weight:bold;margin-bottom:8px">📋 Rascunho encontrado</div><div style="color:#aaa;margin-bottom:18px">Croqui não enviado (' + ageMin + ' min atrás). Recuperar?</div><div style="display:flex;flex-direction:column;gap:8px"><button id="rc-yes" style="background:#3a7d44;border:none;color:#fff;padding:10px;border-radius:4px;cursor:pointer">📂 Recuperar</button><button id="rc-no" style="background:#5a2d2d;border:none;color:#fff;padding:10px;border-radius:4px;cursor:pointer">🗑 Descartar</button></div>');
    d.querySelector('#rc-yes').onclick = () => { try { restoreState(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (e) {} const sel = document.getElementById('sel-escala'); if (sel) sel.value = state.scale; d.remove(); redraw(); };
    d.querySelector('#rc-no').onclick = () => { clearAutosave(); d.remove(); };
  }

  function bind() {
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('dblclick', onDbl);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', resizeCanvas);
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('btn-voltar', handleBack);
    on('btn-ortho', toggleOrtho);
    on('btn-edit', () => { const be = document.getElementById('btn-edit'); if (be) be.style.display = 'none'; showToast('Modo edição ativo', 900); });
    on('act-undo', undo); on('act-redo', redo); on('act-clear', clearAll); on('act-png', exportPNG);
    on('act-save', () => save().catch(() => {})); on('act-tables', openTables);
    on('btn-zoom-in', () => { state.zoom = Math.min(5, state.zoom * 1.2); redraw(); });
    on('btn-zoom-out', () => { state.zoom = Math.max(0.2, state.zoom / 1.2); redraw(); });
    on('act-whats', () => document.getElementById('dlg-whats')?.showModal());
    on('act-prancha', () => document.getElementById('dlg-prancha')?.showModal());
    on('p-cancel', () => document.getElementById('dlg-prancha')?.close());
    on('p-gerar', () => { const v = id => document.getElementById(id)?.value || ''; gerarPrancha({ tituloObra: v('p-titulo') || titleNow(), proprietario: v('p-prop'), endereco: v('p-end'), municipio: v('p-mun'), tipoObra: v('p-tipo'), numeroPrancha: v('p-num'), revisao: v('p-rev') }).then(() => document.getElementById('dlg-prancha')?.close()).catch(() => {}); });
    on('w-cancel', () => document.getElementById('dlg-whats')?.close());
    on('w-enviar', () => { const tel = (document.getElementById('w-tel')?.value || '').trim(); if (!tel) { showToast('Informe o telefone', 1200); return; } enviarWhatsapp(tel).then(() => document.getElementById('dlg-whats')?.close()).catch(() => {}); });
    const selT = document.getElementById('sel-espessura'); if (selT) selT.addEventListener('change', e => { state.wallThickness = parseInt(e.target.value) || 15; });
    const selE = document.getElementById('sel-escala'); if (selE) selE.addEventListener('change', e => { state.scale = e.target.value; redraw(); });
    on('op-ok', applyOpening); on('op-cancel', hideOpeningPanel);
    on('op-flip', () => { if (openingCtx && openingCtx.editId) { selected = { kind: 'opening', id: openingCtx.editId }; flipSelectedOpening(); } });
    on('op-rotate', () => { if (openingCtx && openingCtx.editId) { selected = { kind: 'opening', id: openingCtx.editId }; rotateSelectedOpening(); } });
    // painel de edição de parede
    on('we-len-ok', applyWallLength); on('we-angle-ok', applyWallAngle);
    on('we-rot', rotateWall90); on('we-flip', flipWall); on('we-del', deleteSelected); on('we-close', () => { closeWallPanel(); selected = null; redraw(); });
    const wt = document.getElementById('wallThickInput'); if (wt) wt.addEventListener('change', applyWallThick);
    document.querySelectorAll('#tablesOverlay .ttab').forEach(b => b.addEventListener('click', () => renderTablesTab(b.dataset.ttab)));
    on('tbl-csv', () => copyTable(',')); on('tbl-tsv', () => copyTable('\t')); on('tbl-close', () => { const o = document.getElementById('tablesOverlay'); if (o) o.style.display = 'none'; });
  }

  function init() {
    canvas = document.getElementById('main-canvas'); ctx = canvas.getContext('2d'); wrap = document.getElementById('canvas-wrap');
    canvasId = cfg.canvasId || null;
    if (cfg.escala && BASE_SCALE[cfg.escala]) { state.scale = cfg.escala; const sel = document.getElementById('sel-escala'); if (sel) sel.value = cfg.escala; }
    resizeCanvas(); bind(); setTool('wall');
    state.pan = { x: 80, y: 80 };
    loadExisting().finally(() => { redraw(); offerRecovery(); showToast('Canvas pronto ✓', 1000); });
  }

  return {
    init, undo, redo, clearAll, exportPNG, save, gerarPrancha, enviarWhatsapp, setTool, openTables, resizeCanvas, redraw, toggleOrtho,
    cmToPx, pxToCm, worldToScreen, screenToWorld, getWallPolygon, lineIntersect, shoelaceArea, applyOrtho, wallLength, wallAngleDeg, rotate90,
    findSnap, serializeState, restoreState, buildDoorsTable, buildWindowsTable, buildRoomsTable, addWall, clearWalls,
    get _state() { return state; }, get _canvas() { return canvas; }, set _ortho(v) { orthoMode = v; },
  };
})();

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => { try { CanvasEngine.init(); } catch (e) { console.error('[vtaCanvas] init falhou:', e); } });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { CanvasEngine };
// ── fim do vtaCanvasV4.js (Romatec / ZAYRA) — motor CAD As-Built v4 ──
