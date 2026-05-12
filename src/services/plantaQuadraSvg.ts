// src/services/plantaQuadraSvg.ts
//
// Render SVG puro da planta de uma quadra com o lote-objeto destacado.
// Sem deps externas. GeoJSON Polygon em UTM (metros) -> SVG com viewBox
// em mesmas unidades. PdfKit / inline pode embutir direto.

interface LoteInfo {
  id: number;
  numero_lote: string;
  geojson: string;
  isObjeto: boolean;
}

export interface PlantaQuadraInput {
  quadraNome: string;
  quadraGeojson: string;
  lotes: LoteInfo[];
}

type Ring = Array<[number, number]>;
type BBox = { minX: number; minY: number; maxX: number; maxY: number };

function lerPolygonRing(geojsonStr: string): Ring | null {
  try {
    const p = JSON.parse(geojsonStr);
    if (p?.type !== 'Polygon') return null;
    const ring = p.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    return ring as Ring;
  } catch {
    return null;
  }
}

function bboxRings(rings: Ring[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function centroide(ring: Ring): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  const n = Math.max(1, ring.length);
  return { x: sx / n, y: sy / n };
}

// SVG: Y cresce pra baixo. UTM: Y cresce pra cima. Invertemos com flip.
function svgPath(ring: Ring, bb: BBox): string {
  const flip = (y: number) => bb.maxY - y + bb.minY;
  const cmds = ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${flip(y).toFixed(2)}`);
  return cmds.join(' ') + ' Z';
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
}

export function plantaQuadraSvg(input: PlantaQuadraInput): string {
  const quadraRing = lerPolygonRing(input.quadraGeojson);
  if (!quadraRing) return '';

  const loteRings = input.lotes
    .map(l => ({ info: l, ring: lerPolygonRing(l.geojson) }))
    .filter((x): x is { info: LoteInfo; ring: Ring } => x.ring !== null);

  const bb = bboxRings([quadraRing, ...loteRings.map(l => l.ring)]);
  const margem = Math.max((bb.maxX - bb.minX) * 0.08, 5);
  const vbMinX = bb.minX - margem;
  const vbMinY = bb.minY - margem;
  const vbW = (bb.maxX - bb.minX) + margem * 2;
  const vbH = (bb.maxY - bb.minY) + margem * 2;

  const quadraPath = svgPath(quadraRing, bb);

  const lotesXml = loteRings.map(({ info, ring }) => {
    const fill = info.isObjeto ? '#fbbf24' : 'none';
    const stroke = info.isObjeto ? '#92400e' : '#666';
    const sw = info.isObjeto ? 0.6 : 0.3;
    const c = centroide(ring);
    const flipY = bb.maxY - c.y + bb.minY;
    return [
      `<path data-lote="${info.id}" d="${svgPath(ring, bb)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
      `<text x="${c.x.toFixed(2)}" y="${flipY.toFixed(2)}" font-size="${Math.max(2, margem * 0.5).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#222">${escapeXml(info.numero_lote)}</text>`,
    ].join('');
  }).join('');

  const titulo = `<text x="${(vbMinX + vbW / 2).toFixed(2)}" y="${(vbMinY + margem * 0.5).toFixed(2)}" font-size="${(margem * 0.7).toFixed(1)}" text-anchor="middle" font-weight="bold" fill="#111">Planta da Quadra ${escapeXml(input.quadraNome)}</text>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbMinX.toFixed(2)} ${vbMinY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}">`,
    `<path d="${quadraPath}" fill="#f3f4f6" stroke="#111" stroke-width="0.5"/>`,
    lotesXml,
    titulo,
    `</svg>`,
  ].join('');
}
