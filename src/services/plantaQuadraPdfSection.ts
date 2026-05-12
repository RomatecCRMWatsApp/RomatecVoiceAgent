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
}

type Ring = Array<[number, number]>;

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

  doc.addPage();
  let cy = 60;
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold')
     .text(`PLANTA DA QUADRA — ${data.quadra.nome}`, 40, cy);
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

  for (const { info, ring } of vizinhos) {
    tracarRing(ring);
    doc.strokeColor('#666').lineWidth(0.5).stroke();
    const cxN = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cyN = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    doc.fontSize(7).fillColor('#444').font('Helvetica')
       .text(info.numero_lote, toX(cxN) - 8, toY(cyN) - 4, { width: 16, align: 'center' });
  }

  tracarRing(loteRing);
  doc.fillColor('#fbbf24').fillOpacity(0.6).fill();
  doc.fillOpacity(1);
  tracarRing(loteRing);
  doc.strokeColor('#92400e').lineWidth(1.2).stroke();
  const cxO = loteRing.reduce((s, p) => s + p[0], 0) / loteRing.length;
  const cyO = loteRing.reduce((s, p) => s + p[1], 0) / loteRing.length;
  doc.fontSize(9).fillColor('#111').font('Helvetica-Bold')
     .text(`LOTE ${data.lote.numero_lote}`, toX(cxO) - 28, toY(cyO) - 5, { width: 56, align: 'center' });

  doc.fontSize(8).fillColor('#666').font('Helvetica-Oblique')
     .text(`Lote-objeto da demarcação destacado em amarelo. ${vizinhos.length} lotes vizinhos.`,
       40, boxY + boxH + 8, { width: 515, align: 'center' });
}
