// src/services/plantaQuadraPdfSection.ts
//
// v3.6.0 — Desenha a seção "Planta da Quadra" no PDF do laudo usando
// PDFKit primitives (mesma abordagem do croqui inline da seção 10 do
// laudoPdf.ts — o projeto não embarca SVG).
//
// Guarda tripla — só desenha se:
//   1) laudo.tipo_imovel === 'URBANO'
//   2) laudo.lote_loteamento_id != null
//   3) carregarPlantaQuadra() retorna geometria de lote E quadra
//
// Caso contrário, retorna silenciosamente. Nunca lança.

import { carregarPlantaQuadra } from '../integrations/loteamentos';

interface LaudoMinimo {
  tipo_imovel: string;
  lote_loteamento_id: number | null;
  // v3.6.1 — rótulos digitados no laudo (seção 3 do PDF). Têm precedência
  // sobre data.quadra.nome / data.lote.numero_lote pra manter a Planta da
  // Quadra coerente com o resto do documento mesmo quando o cadastro vinculado
  // (lote_loteamento_id) tem labels diferentes — caso observado no CSV Colina
  // Park onde quadra/numero_lote do registro divergiam do laudo emitido.
  quadra?: string | null;
  numero_lote?: string | null;
}

type Ring = Array<[number, number]>;

/**
 * v3.6.1 — Normaliza o rótulo da quadra pro título do PDF. Aceita as variantes
 * que aparecem nos CSVs reais ("Q. 24", "Q-01", "QUADRA 03") e o formato cru
 * que vem do laudo digitado ("15"). Saída sempre canônica: "Q. 15".
 */
function fmtTituloQuadra(s: string): string {
  const limpo = String(s).trim().replace(/^Q(uadra)?[\s.\-]+/i, '');
  return `Q. ${limpo}`;
}

function lerRing(s: string): Ring | null {
  try {
    const p = JSON.parse(s);
    if (p?.type !== 'Polygon') return null;
    const r = p.coordinates?.[0];
    if (!Array.isArray(r) || r.length < 3) return null;
    return r as Ring;
  } catch { return null; }
}

export async function secaoPlantaQuadra(
  doc: PDFKit.PDFDocument,
  laudo: LaudoMinimo,
): Promise<boolean> {
  if (laudo.tipo_imovel !== 'URBANO') return false;
  if (!laudo.lote_loteamento_id) return false;

  let data;
  try {
    data = await carregarPlantaQuadra(Number(laudo.lote_loteamento_id));
  } catch {
    return false;
  }
  if (!data) return false;

  const quadraRing = lerRing(data.quadra.geojson);
  const loteRing = lerRing(data.lote.geojson);
  if (!quadraRing || !loteRing) return false;
  const vizinhos = data.vizinhos
    .map(v => ({ info: v, ring: lerRing(v.geojson) }))
    .filter((x): x is { info: typeof data.vizinhos[number]; ring: Ring } => x.ring !== null);

  // v3.7.2 — Bbox principal SÓ do que é "Q.15 + ruas" (não inclui quadras
  // vizinhas, senão a Q.15 fica microscópica). Quadras vizinhas são
  // desenhadas DEPOIS, parcialmente visíveis nas margens — apenas as
  // geograficamente adjacentes (até 25m da Q.15, medindo bbox-a-bbox).
  let qMinX0 = Infinity, qMinY0 = Infinity, qMaxX0 = -Infinity, qMaxY0 = -Infinity;
  for (const [x, y] of quadraRing) {
    if (x < qMinX0) qMinX0 = x; if (y < qMinY0) qMinY0 = y;
    if (x > qMaxX0) qMaxX0 = x; if (y > qMaxY0) qMaxY0 = y;
  }
  const TOL_VIZINHA_M = 25; // até 25m de distância da Q.15
  const quadrasVizinhasProx = (data.quadras_vizinhas || [])
    .map(qv => ({ info: qv, ring: lerRing(qv.geojson) }))
    .filter((x): x is { info: typeof data.quadras_vizinhas[number]; ring: Ring } => x.ring !== null)
    .filter(({ ring }) => {
      // bbox da vizinha
      let vMinX = Infinity, vMinY = Infinity, vMaxX = -Infinity, vMaxY = -Infinity;
      for (const [x, y] of ring) {
        if (x < vMinX) vMinX = x; if (y < vMinY) vMinY = y;
        if (x > vMaxX) vMaxX = x; if (y > vMaxY) vMaxY = y;
      }
      // Distância entre bboxes em cada eixo (0 se sobrepõem)
      const dx = Math.max(0, Math.max(qMinX0 - vMaxX, vMinX - qMaxX0));
      const dy = Math.max(0, Math.max(qMinY0 - vMaxY, vMinY - qMaxY0));
      return Math.hypot(dx, dy) <= TOL_VIZINHA_M;
    });

  // Bbox principal: APENAS quadra-objeto + lotes vizinhos (mantém zoom apertado)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of [quadraRing, loteRing, ...vizinhos.map(v => v.ring)]) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  // v3.7.4 — Padding UTM ainda menor (4m) pra apertar zoom na Q.15.
  minX -= 4; minY -= 4; maxX += 4; maxY += 4;
  const rangeX = Math.max(maxX - minX, 0.001);
  const rangeY = Math.max(maxY - minY, 0.001);

  // v3.6.1 — Labels do laudo têm precedência. Se laudo.quadra ou
  // laudo.numero_lote diferem do cadastro vinculado, o operador vê um warn no
  // log (data integrity) mas o PDF sai coerente com a seção 3.
  const laudoQuadra = laudo.quadra != null ? String(laudo.quadra).trim() : '';
  const laudoLote = laudo.numero_lote != null ? String(laudo.numero_lote).trim() : '';
  const tituloQuadra = laudoQuadra || data.quadra.nome;
  const labelLote = laudoLote || data.lote.numero_lote;
  // v3.7.1 — Normaliza antes de comparar pra evitar warn ruidoso quando a
  // diferença é só de prefixo ("15" vs "Q. 15") ou letter-case.
  const normCmpQuadra = (s: string) =>
    String(s).trim().toUpperCase().replace(/^Q(UADRA)?[\s.\-]+/i, '');
  if (laudoQuadra && normCmpQuadra(laudoQuadra) !== normCmpQuadra(data.quadra.nome)) {
    console.warn(
      `[plantaQuadra] laudo.quadra="${laudoQuadra}" != cadastro.quadra.nome="${data.quadra.nome}" ` +
      `(lote_loteamento_id=${laudo.lote_loteamento_id}) — usando label do laudo no PDF`,
    );
  }
  if (laudoLote && laudoLote !== data.lote.numero_lote) {
    console.warn(
      `[plantaQuadra] laudo.numero_lote="${laudoLote}" != cadastro.lote.numero_lote="${data.lote.numero_lote}" ` +
      `(lote_loteamento_id=${laudo.lote_loteamento_id}) — usando label do laudo no PDF`,
    );
  }

  doc.addPage();
  let cy = 60;
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold')
     .text(`PLANTA DA QUADRA — ${fmtTituloQuadra(tituloQuadra)}`, 40, cy);
  cy += 14;

  // v3.7.4 — Box maior + padding menor pra mais zoom na Q.15.
  const padding = 22;
  const boxW = 480, boxH = 580;
  const boxX = (595 - boxW) / 2; // centralizado
  const boxY = cy;
  doc.rect(boxX, boxY, boxW, boxH).strokeColor('#ddd').lineWidth(0.5).stroke();

  const scale = Math.min(
    (boxW - 2 * padding) / rangeX,
    (boxH - 2 * padding) / rangeY,
  );
  const drawW = rangeX * scale;
  const drawH = rangeY * scale;
  const offX = boxX + (boxW - drawW) / 2;
  const offY = boxY + (boxH - drawH) / 2;
  const toX = (x: number) => offX + (x - minX) * scale;
  const toY = (y: number) => offY + drawH - (y - minY) * scale;

  const tracarRing = (ring: Ring): void => {
    ring.forEach(([x, y], i) => {
      if (i === 0) doc.moveTo(toX(x), toY(y));
      else doc.lineTo(toX(x), toY(y));
    });
    doc.closePath();
  };

  // v3.7.0 — Pré-cálculo de qual lado (N/S/L/O) cada rua adjacente ocupa.
  // Lógica antes ficava dentro do bloco de nomes das ruas; agora vem antes
  // pra ser usado também pelos eixos das ruas (linhas tracejadas azuis).
  type LadoCardinal = 'N' | 'S' | 'L' | 'O';
  const ladoMaisFreq: Map<number, LadoCardinal> = new Map();
  {
    const lotesPorRua = new Map<number, Ring[]>();
    for (const v of vizinhos) {
      const rid = v.info.rua_frente_id;
      if (rid == null) continue;
      if (!lotesPorRua.has(rid)) lotesPorRua.set(rid, []);
      lotesPorRua.get(rid)!.push(v.ring);
    }
    if (data.lote.rua_frente_id != null) {
      const rid = data.lote.rua_frente_id;
      if (!lotesPorRua.has(rid)) lotesPorRua.set(rid, []);
      lotesPorRua.get(rid)!.push(loteRing);
    }
    let qMnX = Infinity, qMnY = Infinity, qMxX = -Infinity, qMxY = -Infinity;
    for (const [x, y] of quadraRing) {
      if (x < qMnX) qMnX = x; if (y < qMnY) qMnY = y;
      if (x > qMxX) qMxX = x; if (y > qMxY) qMxY = y;
    }
    for (const [rid, rings] of lotesPorRua) {
      let sumX = 0, sumY = 0;
      for (const ring of rings) {
        sumX += ring.reduce((s, p) => s + p[0], 0) / ring.length;
        sumY += ring.reduce((s, p) => s + p[1], 0) / ring.length;
      }
      const cx = sumX / rings.length, cy_ = sumY / rings.length;
      const dN = qMxY - cy_, dS = cy_ - qMnY, dL = qMxX - cx, dO = cx - qMnX;
      const dMin = Math.min(dN, dS, dL, dO);
      let lado: LadoCardinal;
      if (dMin === dN) lado = 'N';
      else if (dMin === dS) lado = 'S';
      else if (dMin === dL) lado = 'L';
      else lado = 'O';
      ladoMaisFreq.set(rid, lado);
    }
  }

  // v3.7.0 — Eixos das ruas: linha tracejada azul paralela a cada lado da
  // quadra correspondente, deslocada 6m pra fora. Funciona pras 4 ruas (N/S/L/O)
  // sem precisar de geometria de rua no banco. Cota "12,00" em vermelho perto
  // do meio do eixo.
  const ringPtsQ = quadraRing[0][0] === quadraRing[quadraRing.length - 1][0]
    && quadraRing[0][1] === quadraRing[quadraRing.length - 1][1]
    ? quadraRing.slice(0, -1) : quadraRing;
  const centroQuadraEixos: [number, number] = [
    ringPtsQ.reduce((s, p) => s + p[0], 0) / ringPtsQ.length,
    ringPtsQ.reduce((s, p) => s + p[1], 0) / ringPtsQ.length,
  ];
  const ladosUsados = new Set(Array.from(ladoMaisFreq.values()));
  const lados: LadoCardinal[] = ['N', 'S', 'L', 'O'];
  doc.save();
  for (const lado of lados) {
    if (!ladosUsados.has(lado)) continue;
    // Encontra segmento da quadra mais alinhado a esse lado
    let bestI = 0, bestScore = -Infinity;
    for (let i = 0; i < ringPtsQ.length; i++) {
      const a = ringPtsQ[i];
      const b = ringPtsQ[(i + 1) % ringPtsQ.length];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      // Score: quão "extremo" o ponto médio está naquele lado
      let s = 0;
      if (lado === 'N') s = my;
      else if (lado === 'S') s = -my;
      else if (lado === 'L') s = mx;
      else s = -mx;
      // Pondera pelo comprimento do segmento (lados longos vencem chanfros)
      const comp = Math.hypot(b[0] - a[0], b[1] - a[1]);
      s = s * Math.sqrt(comp);
      if (s > bestScore) { bestScore = s; bestI = i; }
    }
    const a = ringPtsQ[bestI];
    const b = ringPtsQ[(bestI + 1) % ringPtsQ.length];
    // Vetor normal pra fora da quadra
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    // Garante que o normal aponta pra FORA da quadra
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dxOut = mx + nx - centroQuadraEixos[0];
    const dyOut = my + ny - centroQuadraEixos[1];
    const dxIn = mx - centroQuadraEixos[0];
    const dyIn = my - centroQuadraEixos[1];
    if (dxOut * dxIn + dyOut * dyIn < 0) { nx = -nx; ny = -ny; }
    // Desloca segmento 6m pra fora
    const off = 6;
    const ax = a[0] + nx * off, ay = a[1] + ny * off;
    const bx = b[0] + nx * off, by = b[1] + ny * off;
    // Desenha linha azul tracejada
    doc.dash(3, { space: 2 });
    doc.moveTo(toX(ax), toY(ay)).lineTo(toX(bx), toY(by))
       .strokeColor('#2563eb').lineWidth(0.7).stroke();
    doc.undash();
    // Cota "12,00" em vermelho no meio da linha
    const mxOff = (ax + bx) / 2;
    const myOff = (ay + by) / 2;
    // Posição da cota: 3m a mais pra fora
    const cxR = mxOff + nx * 3;
    const cyR = myOff + ny * 3;
    doc.fontSize(6).fillColor('#dc2626').font('Helvetica-Bold')
       .text('12,00', toX(cxR) - 12, toY(cyR) - 3,
         { width: 24, align: 'center', lineBreak: false });
  }
  doc.restore();

  // v3.7.0 — Quadras vizinhas: desenha contorno + círculo magenta com label
  // "Q. NN" no centroide (estilo CAD do projeto Colina Park).
  for (const { info, ring } of quadrasVizinhasProx) {
    tracarRing(ring);
    doc.fillColor('#fafafa').fillOpacity(0.6).fill();
    doc.fillOpacity(1);
    tracarRing(ring);
    doc.strokeColor('#94a3b8').lineWidth(0.4).stroke();
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const px = toX(cx);
    const py = toY(cy);
    doc.save();
    doc.circle(px, py, 11).fillColor('#fff').fillOpacity(0.92).fill();
    doc.fillOpacity(1);
    doc.circle(px, py, 11).strokeColor('#c026d3').lineWidth(0.7).stroke();
    doc.fontSize(6.5).fillColor('#a21caf').font('Helvetica-Bold')
       .text(fmtTituloQuadra(info.nome), px - 14, py - 3,
         { width: 28, align: 'center', lineBreak: false });
    doc.restore();
  }

  // Quadra-objeto (em cima das vizinhas, contorno preto mais grosso)
  tracarRing(quadraRing);
  doc.fillColor('#f3f4f6').fillOpacity(1).fill();
  tracarRing(quadraRing);
  doc.strokeColor('#111').lineWidth(0.8).stroke();

  // v3.6.2 — Helper shoelace pra calcular área do polígono (m²)
  const areaShoelace = (ring: Ring): number => {
    let a = 0;
    const n = ring.length;
    for (let i = 0; i < n - 1; i++) {
      a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(a) / 2;
  };

  for (const { info, ring } of vizinhos) {
    tracarRing(ring);
    doc.strokeColor('#666').lineWidth(0.5).stroke();
    const cxN = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cyN = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    // Número do lote (em cima)
    doc.fontSize(7).fillColor('#444').font('Helvetica-Bold')
       .text(info.numero_lote, toX(cxN) - 10, toY(cyN) - 6, { width: 20, align: 'center', lineBreak: false });
    // v3.6.2 — Área m² (embaixo, fonte menor)
    const aLote = areaShoelace(ring);
    if (aLote > 0) {
      doc.fontSize(5).fillColor('#64748b').font('Helvetica')
         .text(`${aLote.toFixed(0)} m²`, toX(cxN) - 14, toY(cyN) + 2,
           { width: 28, align: 'center', lineBreak: false });
    }
  }

  tracarRing(loteRing);
  doc.fillColor('#fbbf24').fillOpacity(0.6).fill();
  doc.fillOpacity(1);
  tracarRing(loteRing);
  doc.strokeColor('#92400e').lineWidth(1.2).stroke();
  const cxO = loteRing.reduce((s, p) => s + p[0], 0) / loteRing.length;
  const cyO = loteRing.reduce((s, p) => s + p[1], 0) / loteRing.length;
  doc.fontSize(9).fillColor('#111').font('Helvetica-Bold')
     .text(`LOTE ${labelLote}`, toX(cxO) - 28, toY(cyO) - 5, { width: 56, align: 'center' });

  // v3.6.2 — Cotas externas (testadas) do lote-objeto, estilo CAD.
  // Texto em vermelho rotacionado alinhado a cada lado do polígono.
  const ringClosed = loteRing[0][0] === loteRing[loteRing.length - 1][0]
    && loteRing[0][1] === loteRing[loteRing.length - 1][1];
  const ringPts = ringClosed ? loteRing.slice(0, -1) : loteRing;
  for (let i = 0; i < ringPts.length; i++) {
    const a = ringPts[i];
    const b = ringPts[(i + 1) % ringPts.length];
    const distM = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (distM < 1) continue;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const ang = Math.atan2(toY(b[1]) - toY(a[1]), toX(b[0]) - toX(a[0]));
    let angDeg = (ang * 180) / Math.PI;
    if (angDeg > 90 || angDeg < -90) angDeg += 180;
    doc.save();
    doc.translate(toX(mx), toY(my));
    doc.rotate(angDeg);
    doc.fontSize(6).fillColor('#dc2626').font('Helvetica-Bold')
       .text(`${distM.toFixed(2).replace('.', ',')} m`, -24, -9,
         { width: 48, align: 'center', lineBreak: false });
    doc.restore();
  }

  // v3.6.3 — Nomes das ruas adjacentes desenhados nas 4 bordas.
  // v3.7.3 — Posições agora relativas ao bbox PROJETADO da Q.15 (não fixas no
  // box do PDF). Assim os nomes ficam alinhados ao eixo de cada rua mesmo
  // quando a Q.15 não está centralizada no box.
  const ruasInfo = data.ruas;
  if (ruasInfo.length > 0) {
    // BBox projetada da Q.15
    const projXs = quadraRing.map(p => toX(p[0]));
    const projYs = quadraRing.map(p => toY(p[1]));
    const qPdfMinX = Math.min(...projXs);
    const qPdfMaxX = Math.max(...projXs);
    const qPdfMinY = Math.min(...projYs);
    const qPdfMaxY = Math.max(...projYs);
    const qPdfCx = (qPdfMinX + qPdfMaxX) / 2;
    const qPdfCy = (qPdfMinY + qPdfMaxY) / 2;
    for (const r of ruasInfo) {
      const lado = ladoMaisFreq.get(r.id);
      if (!lado) continue;
      doc.fontSize(8).fillColor('#0f172a').font('Helvetica-Bold');
      const nome = r.nome.toUpperCase();
      if (lado === 'N') {
        // Acima da Q.15
        doc.text(nome, qPdfCx - 100, qPdfMinY - 18,
          { width: 200, align: 'center', lineBreak: false, characterSpacing: 2 });
      } else if (lado === 'S') {
        doc.text(nome, qPdfCx - 100, qPdfMaxY + 8,
          { width: 200, align: 'center', lineBreak: false, characterSpacing: 2 });
      } else if (lado === 'L') {
        // v3.7.4 — afasta mais pra não colidir com as cotas vermelhas "12,00"
        doc.save();
        doc.translate(qPdfMaxX + 32, qPdfCy);
        doc.rotate(-90);
        doc.text(nome, -100, -4,
          { width: 200, align: 'center', lineBreak: false, characterSpacing: 2 });
        doc.restore();
      } else {
        doc.save();
        doc.translate(qPdfMinX - 28, qPdfCy);
        doc.rotate(-90);
        doc.text(nome, -100, -4,
          { width: 200, align: 'center', lineBreak: false, characterSpacing: 2 });
        doc.restore();
      }
    }
  }

  // v3.6.2 — Seta Norte no canto superior direito do box (orientação)
  const nX = boxX + boxW - 24;
  const nY = boxY + 30;
  doc.save();
  doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold')
     .text('N', nX - 4, nY - 22, { lineBreak: false });
  doc.moveTo(nX, nY + 4).lineTo(nX, nY - 12)
     .strokeColor('#0f172a').lineWidth(1.0).stroke();
  doc.moveTo(nX - 3, nY - 8).lineTo(nX, nY - 12).lineTo(nX + 3, nY - 8).stroke();
  doc.restore();

  // v3.7.3 — Legenda inferior simplificada: só 2 linhas curtas no rodapé,
  // sem repetir os nomes das ruas (que já aparecem na planta).
  doc.fontSize(7).fillColor('#666').font('Helvetica-Oblique')
     .text(`Lote-objeto destacado em amarelo · ${vizinhos.length} lotes vizinhos · ${data.ruas.length} ruas adjacentes`,
       40, boxY + boxH + 6, { width: 515, align: 'center', lineBreak: false });
  if (quadrasVizinhasProx.length > 0) {
    doc.fontSize(6.5).fillColor('#a21caf').font('Helvetica')
       .text(`Quadras adjacentes: ${quadrasVizinhasProx.map(qv => fmtTituloQuadra(qv.info.nome)).join(' · ')}`,
         40, boxY + boxH + 16, { width: 515, align: 'center', lineBreak: false });
  }
  return true;
}
