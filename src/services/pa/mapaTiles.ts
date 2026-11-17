// v3.172.0 — Mapa dos lotes para PDF igual ao do sistema (Leaflet): imagem de fundo
// (satélite Esri, mapa OSM ou relevo OpenTopoMap) baixada no servidor e embutida, com a
// mesma simbologia do mapa 2D (perímetro tracejado, estradas, córregos, APP, áreas
// comunitárias, divisa) e os lotes coloridos com rótulo central. Projeção Web Mercator.
// Sem internet ou se o servidor de imagens falhar, sai o mesmo desenho sobre fundo neutro.

export type BaseMapa = 'satelite' | 'mapa' | 'relevo';
export const BASES_MAPA: Record<BaseMapa, { url: (z: number, x: number, y: number) => string; max: number; credito: string }> = {
  satelite: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 19, credito: 'Imagem © Esri, Maxar, Earthstar Geographics' },
  mapa: { url: (z, x, y) => `https://${'abc'[(x + y) % 3]}.tile.openstreetmap.org/${z}/${x}/${y}.png`, max: 19, credito: '© OpenStreetMap' },
  relevo: { url: (z, x, y) => `https://${'abc'[(x + y) % 3]}.tile.opentopomap.org/${z}/${x}/${y}.png`, max: 17, credito: '© OpenTopoMap (CC-BY-SA)' },
};
export const baseValida = (v: unknown): BaseMapa => (v === 'mapa' || v === 'relevo' ? v : 'satelite');

type Pos = [number, number];
interface Feicao { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }
export interface RotuloLote { cor: string; rotulo: string; sub?: string; opac?: number; destaque?: boolean }
export type BuscarTile = (url: string) => Promise<Buffer | null>;

/** Web Mercator: lon/lat → pixel do "mundo" no zoom 0 (256 px). */
export function mundo([lon, lat]: Pos): Pos {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [((lon + 180) / 360) * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256];
}

/** Enquadramento: zoom fracionário que cabe os lotes em W×H px (pura — testável). */
export function enquadrar(pts: Pos[], W: number, H: number, margem = 0.05, maxZoom = 19) {
  const ws = pts.map(mundo);
  const xs = ws.map((p) => p[0]), ys = ws.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const zf = Math.min(maxZoom, Math.log2(Math.min((W * (1 - 2 * margem)) / Math.max(x1 - x0, 1e-9), (H * (1 - 2 * margem)) / Math.max(y1 - y0, 1e-9))));
  const k = 2 ** zf;
  const cx = ((x0 + x1) / 2) * k, cy = ((y0 + y1) / 2) * k;
  const px = (p: Pos): Pos => { const m = mundo(p); return [m[0] * k - cx + W / 2, m[1] * k - cy + H / 2]; };
  const latC = (pts.reduce((s, p) => s + p[1], 0) / pts.length) * (Math.PI / 180);
  const mPorPx = (156543.03392 * Math.cos(latC)) / k;
  return { zf, k, cx, cy, px, mPorPx };
}

export const buscarTileHttp: BuscarTile = async (url) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'RomatecPA/1.0 (mapas de campo)' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
};

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const ESTILO: Record<string, { stroke: string; w: number; fill?: string; op?: number; dash?: string }> = {
  APP: { stroke: '#3E8E41', w: 1, fill: '#9FD08A', op: 0.45 }, COMUNITARIA: { stroke: '#A07A10', w: 1.5, fill: '#F1DFA4', op: 0.75 },
  ESTRADA: { stroke: '#8C5A2B', w: 3 }, AGUA: { stroke: '#2B6CB0', w: 1.6 }, OUTRA: { stroke: '#999', w: 1 },
  PERIMETRO: { stroke: '#0C3320', w: 3, dash: '8 5' }, VILA: { stroke: '#B3261E', w: 2, dash: '4 4' }, DIVISA: { stroke: '#C62828', w: 3.5, dash: '14 5 3 5' },
};

function centroide(pts: Pos[]): Pos {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; const k = x0 * y1 - x1 * y0; a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k; }
  if (Math.abs(a) < 1e-9) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * HTML (div com as imagens de fundo + SVG por cima) do mapa dos lotes como no sistema.
 * `cores`: cor/rótulo por lote; lotes fora dele saem em contorno branco.
 */
export async function htmlMapaLotes(geo: { features: Feicao[] }, cores: Record<string, RotuloLote>, opts: { base?: BaseMapa; W?: number; H?: number; buscar?: BuscarTile } = {}): Promise<{ html: string; imagem: boolean }> {
  const W = opts.W ?? 718, H = opts.H ?? 560;
  const base = BASES_MAPA[opts.base ?? 'satelite'];
  const lotes = geo.features.filter((f) => f.properties.tipo === 'LOTE' && f.geometry.type === 'Polygon');
  const outros = geo.features.filter((f) => f.properties.tipo !== 'LOTE');
  const anel = (f: Feicao) => ((f.geometry.coordinates as Pos[][])[0] ?? []);
  const todos = lotes.flatMap(anel);
  if (!todos.length) return { html: '<div style="padding:20mm;text-align:center;color:#777">Subdivisão dos lotes ainda não carregada.</div>', imagem: false };
  const g = enquadrar(todos, W, H, 0.03, base.max);

  // imagens de fundo: zoom +1 desenhado na metade (fica nítido na impressão)
  const z = Math.max(0, Math.min(base.max, Math.floor(g.zf) + 1));
  const esc2 = g.k / 2 ** z; // px de saída por px do tile no zoom z
  const tam = 256 * esc2;
  const ox = g.cx - W / 2, oy = g.cy - H / 2; // canto do recorte em px (zoom zf)
  const tx0 = Math.floor(ox / tam), tx1 = Math.floor((ox + W) / tam), ty0 = Math.floor(oy / tam), ty1 = Math.floor((oy + H) / tam);
  const lista: Array<{ x: number; y: number }> = [];
  for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) if (y >= 0 && y < 2 ** z) lista.push({ x, y });
  const buscar = opts.buscar ?? buscarTileHttp;
  const imgs: string[] = [];
  let ok = 0;
  for (let i = 0; i < lista.length; i += 8) {
    const lote = lista.slice(i, i + 8);
    const res = await Promise.all(lote.map(async (t) => ({ t, b: await buscar(base.url(z, ((t.x % 2 ** z) + 2 ** z) % 2 ** z, t.y)) })));
    for (const { t, b } of res) {
      if (!b) continue;
      ok++;
      const tipo = b[0] === 0x89 ? 'image/png' : 'image/jpeg';
      imgs.push(`<img src="data:${tipo};base64,${b.toString('base64')}" style="position:absolute;left:${(t.x * tam - ox).toFixed(2)}px;top:${(t.y * tam - oy).toFixed(2)}px;width:${(tam + 0.6).toFixed(2)}px;height:${(tam + 0.6).toFixed(2)}px">`);
    }
    if (!ok) break; // servidor de imagens fora do ar: não espera o resto (sai com fundo neutro)
  }
  const temImagem = ok > 0 && ok >= lista.length * 0.6;

  const path = (cs: Pos[], fechar: boolean) => cs.map((p, i) => { const [x, y] = g.px(p); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('') + (fechar ? 'Z' : '');
  const linhas = outros.map((f) => {
    const e = ESTILO[String(f.properties.tipo)] ?? ESTILO.OUTRA;
    const fechado = f.geometry.type === 'Polygon';
    const cs = fechado ? anel(f) : (f.geometry.coordinates as Pos[]);
    if (!cs?.length) return '';
    const fill = fechado && e.fill ? `fill="${e.fill}" fill-opacity="${e.op}"` : 'fill="none"';
    return `<path d="${path(cs, fechado)}" ${fill} stroke="${e.stroke}" stroke-width="${e.w}" ${e.dash ? `stroke-dasharray="${e.dash}"` : ''} stroke-linejoin="round"/>`;
  }).join('');
  const poli = lotes.map((f) => {
    const c = cores[String(f.properties.lote)];
    return `<path d="${path(anel(f), true)}" fill="${c?.cor ?? 'none'}" fill-opacity="${c ? (c.opac ?? 0.5) : 0}" stroke="${c ? '#0C3320' : '#fff'}" stroke-width="${c?.destaque ? 2.6 : 1.8}" stroke-linejoin="round"/>`;
  }).join('');
  const halo = 'stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round"';
  const fs = Math.max(7, Math.min(10, Math.sqrt((W * H) / Math.max(lotes.length, 1)) / 7));
  const rots = lotes.map((f) => {
    const c = cores[String(f.properties.lote)];
    const [x, y] = g.px(centroide(anel(f)));
    const r = c?.rotulo ?? `LT-${f.properties.lote}`;
    return `<text x="${x.toFixed(1)}" y="${(y - (c?.sub ? fs * 0.45 : 0)).toFixed(1)}" font-size="${fs}" font-weight="800" fill="#0C3320" text-anchor="middle" dominant-baseline="middle" ${halo}>${esc(r)}</text>`
      + (c?.sub ? `<text x="${x.toFixed(1)}" y="${(y + fs * 0.75).toFixed(1)}" font-size="${(fs * 0.85).toFixed(1)}" font-weight="700" fill="#0C3320" text-anchor="middle" dominant-baseline="middle" ${halo}>${esc(c.sub)}</text>` : '');
  }).join('');
  // escala gráfica e norte
  const alvo = (W / 5) * g.mPorPx;
  const passo = [1, 2, 5].map((m) => m * 10 ** Math.floor(Math.log10(alvo))).concat([10 ** Math.ceil(Math.log10(alvo))]).reduce((a, b) => (Math.abs(b - alvo) < Math.abs(a - alvo) ? b : a));
  const lpx = passo / g.mPorPx;
  const escala = `<g transform="translate(14,${H - 18})"><rect x="-6" y="-16" width="${lpx + 12}" height="28" rx="4" fill="#fff" fill-opacity=".85"/>
    <rect x="0" y="0" width="${lpx / 2}" height="5" fill="#0C3320"/><rect x="${lpx / 2}" y="0" width="${lpx / 2}" height="5" fill="#fff" stroke="#0C3320" stroke-width=".8"/>
    <text x="0" y="-4" font-size="8" fill="#0C3320">0</text><text x="${lpx}" y="-4" font-size="8" text-anchor="end" fill="#0C3320">${passo >= 1000 ? `${passo / 1000} km` : `${passo} m`}</text></g>`;
  const norte = `<g transform="translate(${W - 24},30)"><circle r="15" fill="#fff" fill-opacity=".85"/><polygon points="0,-11 6,7 0,3 -6,7" fill="#0C3320"/><text y="-1" dy="-12" font-size="0">N</text><text y="13" font-size="7.5" font-weight="800" text-anchor="middle" fill="#0C3320">N</text></g>`;
  const credito = temImagem ? `<div style="position:absolute;right:0;bottom:0;background:rgba(255,255,255,.8);font-size:6.5pt;padding:.4mm 1.5mm;color:#333">${esc(base.credito)}</div>` : '';
  const html = `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${temImagem ? '#DDE3D5' : '#F1F3EC'}">
    ${temImagem ? imgs.join('') : ''}
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0" font-family="Liberation Sans, Arial, sans-serif">${linhas}${poli}${rots}${escala}${norte}</svg>${credito}</div>`;
  return { html, imagem: temImagem };
}
