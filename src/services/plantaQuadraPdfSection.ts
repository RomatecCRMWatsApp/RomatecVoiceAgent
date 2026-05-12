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
): Promise<void> {
  if (laudo.tipo_imovel !== 'URBANO') return;
  if (!laudo.lote_loteamento_id) return;

  let data;
  try {
    data = await carregarPlantaQuadra(Number(laudo.lote_loteamento_id));
  } catch {
    return;
  }
  if (!data) return;

  const quadraRing = lerRing(data.quadra.geojson);
  const loteRing = lerRing(data.lote.geojson);
  if (!quadraRing || !loteRing) return;
  const vizinhos = data.vizinhos
    .map(v => ({ info: v, ring: lerRing(v.geojson) }))
    .filter((x): x is { info: typeof data.vizinhos[number]; ring: Ring } => x.ring !== null);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of [quadraRing, loteRing, ...vizinhos.map(v => v.ring)]) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const rangeX = Math.max(maxX - minX, 0.001);
  const rangeY = Math.max(maxY - minY, 0.001);

  // v3.6.1 — Labels do laudo têm precedência. Se laudo.quadra ou
  // laudo.numero_lote diferem do cadastro vinculado, o operador vê um warn no
  // log (data integrity) mas o PDF sai coerente com a seção 3.
  const laudoQuadra = laudo.quadra != null ? String(laudo.quadra).trim() : '';
  const laudoLote = laudo.numero_lote != null ? String(laudo.numero_lote).trim() : '';
  const tituloQuadra = laudoQuadra || data.quadra.nome;
  const labelLote = laudoLote || data.lote.numero_lote;
  if (laudoQuadra && laudoQuadra !== data.quadra.nome) {
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

  const padding = 60;
  const boxX = 40, boxY = cy;
  const boxW = 515, boxH = 500;
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

  doc.fontSize(8).fillColor('#666').font('Helvetica-Oblique')
     .text(`Lote-objeto da demarcação destacado em amarelo. ${vizinhos.length} lotes vizinhos.`,
       40, boxY + boxH + 8, { width: 515, align: 'center' });
}
