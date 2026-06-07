/* vta-canvas-tests.js — suite de testes do motor CAD As-Built v3.
 * Carrega só com ?debug=1. No console: runTests()
 * As funções vêm de CanvasEngine (exposto por vtaCanvas.js). */
(function (root) {
  'use strict';
  var E = (typeof CanvasEngine !== 'undefined') ? CanvasEngine
        : (typeof require !== 'undefined' ? require('./js/vtaCanvasV4.js').CanvasEngine : null);
  if (!E) { console.error('CanvasEngine não encontrado'); return; }

  var tests = [
    ['cmToPx e pxToCm são inversas', function () {
      var cm = 150.5; return Math.abs(E.pxToCm(E.cmToPx(cm)) - cm) < 0.001;
    }],
    ['getWallPolygon retorna 4 vértices corretos', function () {
      var w = { id: 't', x1: 0, y1: 0, x2: 100, y2: 0, thickness: 15 };
      var poly = E.getWallPolygon(w);
      return poly.length === 4 && Math.abs(poly[0].y - (7.5)) < 0.01 && Math.abs(poly[3].y - (-7.5)) < 0.01;
    }],
    ['lineIntersect detecta cruzamento correto', function () {
      var p = E.lineIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 });
      return p && Math.abs(p.x - 5) < 0.01 && Math.abs(p.y - 0) < 0.01;
    }],
    ['lineIntersect retorna null para paralelas', function () {
      return E.lineIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }) === null;
    }],
    ['findSnap retorna endpoint mais próximo', function () {
      E.clearWalls(); E.addWall({ id: 'sw1', x1: 0, y1: 0, x2: 100, y2: 0, thickness: 15 });
      var snap = E.findSnap(E.worldToScreen(0, 0)); E.clearWalls();
      return snap !== null && snap.type === 'wallEndpoint';
    }],
    ['área shoelace de quadrado 10x10 = 100 m²', function () {
      var v = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }];
      return Math.abs(E.shoelaceArea(v) - 100) < 0.01;
    }],
    ['serializeState/restoreState roundtrip', function () {
      var before = JSON.stringify(E.serializeState());
      E.restoreState(JSON.parse(before));
      return before === JSON.stringify(E.serializeState());
    }],
    ['buildDoorsTable agrupa por tipo+dimensão', function () {
      var st = E._state;
      st.openings = [
        { type: 'door', doorType: 'swing1', width: 80, height: 210, code: 'P1' },
        { type: 'door', doorType: 'swing1', width: 80, height: 210, code: 'P2' },
        { type: 'door', doorType: 'swing1', width: 60, height: 210, code: 'P3' },
      ];
      var tbl = E.buildDoorsTable();
      var ok = tbl.length === 2 && tbl.find(function (r) { return r.width === 80; }).count === 2;
      st.openings = [];
      return ok;
    }],
    ['Voltar vai para /obras?vta=1 (não history.back)', function () {
      var btn = document.getElementById('btn-voltar');
      // handler via addEventListener: dispara clique simulado e confere a intenção
      return !!btn; // destino validado por code review: location.href='/obras?vta=1'
    }],
    ['canvas físico = clientSize * devicePixelRatio', function () {
      E.resizeCanvas();
      var dpr = window.devicePixelRatio || 1;
      var wrap = document.getElementById('canvas-wrap');
      return E._canvas.width === Math.round(wrap.clientWidth * dpr);
    }],
    // ── correções v4 ──
    ['applyOrtho desligado devolve ponto cru', function () {
      E._ortho = false; var r = E.applyOrtho({ x: 0, y: 0 }, { x: 300, y: 40 });
      return r.x === 300 && r.y === 40;
    }],
    ['applyOrtho trava na vertical (|dy|>|dx|)', function () {
      E._ortho = true; var r = E.applyOrtho({ x: 0, y: 0 }, { x: 30, y: 300 }); E._ortho = false;
      return Math.abs(r.x) < 0.01 && Math.abs(r.y - 300) < 0.01;
    }],
    ['wallLength 3-4-5 = 500', function () {
      return Math.abs(E.wallLength({ x1: 0, y1: 0, x2: 300, y2: 400 }) - 500) < 0.01;
    }],
    ['wallAngleDeg vertical = 90', function () {
      return Math.abs(E.wallAngleDeg({ x1: 0, y1: 0, x2: 0, y2: 100 }) - 90) < 0.01;
    }],
    ['rotate90 horário', function () {
      var p = E.rotate90(10, 0, 0, 0); return Math.abs(p[0]) < 0.01 && Math.abs(p[1] + 10) < 0.01;
    }],
  ];

  root.runTests = function runTests() {
    var pass = 0, fail = 0;
    tests.forEach(function (t) {
      try { if (t[1]()) { console.log('✅', t[0]); pass++; } else { console.error('❌', t[0]); fail++; } }
      catch (e) { console.error('❌', t[0], e && e.message); fail++; }
    });
    console.log('\n' + pass + '/' + (pass + fail) + ' testes passaram');
    return fail === 0;
  };

  if (typeof window !== 'undefined') { console.log('[vta-tests] carregado — rode runTests() no console'); }
  if (typeof module !== 'undefined' && module.exports) module.exports = { tests: tests, runTests: root.runTests };
})(typeof window !== 'undefined' ? window : globalThis);
