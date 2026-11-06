// v3.151.0 — Subdivisão do PA em parcelas (lotes rurais) a partir do DXF.
// O DXF da divisão traz: perímetro (PA_PERIMETRO), uma polilinha fechada por
// lote (camada com "LOTE" no nome) e o rótulo "LT-NN" dentro de cada uma, além
// de estradas, APP e áreas comunitárias. Cada lote vira um perímetro próprio
// (vértices, azimutes, distâncias, área) com confrontantes por lado. Funções puras.
import { PaErro } from './erros';
import { montarPerimetro, type Perimetro } from './perimetro';

export interface PolilinhaDxf { camada: string; pts: Array<{ x: number; y: number }>; fechada: boolean }
export interface TextoDxf { camada: string; x: number; y: number; texto: string }
export interface PontoDxf { camada: string; x: number; y: number }

/** Lê LWPOLYLINE e TEXT/MTEXT do DXF, com a camada de cada um. */
export function lerDxfEntidades(dxf: string): { polilinhas: PolilinhaDxf[]; textos: TextoDxf[]; pontos: PontoDxf[] } {
  const l = dxf.split(/\r?\n/);
  const pares: Array<[number, string]> = [];
  for (let i = 0; i + 1 < l.length; i += 2) pares.push([Number(l[i].trim()), l[i + 1].replace(/\s+$/, '').replace(/^\s+/, '')]);
  const polilinhas: PolilinhaDxf[] = [];
  const textos: TextoDxf[] = [];
  const pontos: PontoDxf[] = [];
  for (let i = 0; i < pares.length; i++) {
    const [cod, val] = pares[i];
    if (cod !== 0) continue;
    if (val === 'LWPOLYLINE') {
      const pts: Array<{ x: number; y: number }> = [];
      let camada = '', flag = 0, x: number | null = null;
      for (i++; i < pares.length && pares[i][0] !== 0; i++) {
        const [c, v] = pares[i];
        if (c === 8) camada = v;
        else if (c === 70) flag = Number(v);
        else if (c === 10) x = Number(v);
        else if (c === 20 && x != null) { pts.push({ x, y: Number(v) }); x = null; }
      }
      i--;
      const f = pts[0], u = pts[pts.length - 1];
      const fechada = (flag & 1) === 1 || (pts.length > 3 && Math.abs(f.x - u.x) < 1e-6 && Math.abs(f.y - u.y) < 1e-6);
      if (pts.length >= 2) polilinhas.push({ camada, pts, fechada });
    } else if (val === 'POINT') {
      let camada = '', x = NaN, y = NaN;
      for (i++; i < pares.length && pares[i][0] !== 0; i++) {
        const [c, v] = pares[i];
        if (c === 8) camada = v; else if (c === 10) x = Number(v); else if (c === 20) y = Number(v);
      }
      i--;
      if (Number.isFinite(x) && Number.isFinite(y)) pontos.push({ camada, x, y });
    } else if (val === 'TEXT' || val === 'MTEXT') {
      let camada = '', x = NaN, y = NaN, texto = '';
      for (i++; i < pares.length && pares[i][0] !== 0; i++) {
        const [c, v] = pares[i];
        if (c === 8) camada = v;
        else if (c === 10) x = Number(v);
        else if (c === 20) y = Number(v);
        else if (c === 1 || c === 3) texto += v;
      }
      i--;
      if (Number.isFinite(x) && Number.isFinite(y) && texto) textos.push({ camada, x, y, texto: texto.replace(/\\P/g, ' ').replace(/\{|\}|\\[A-Za-z][^;]*;/g, '').trim() });
    }
  }
  return { polilinhas, textos, pontos };
}

export function pontoNoPoligono(p: { x: number; y: number }, poly: Array<{ x: number; y: number }>): boolean {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

function distPontoSegmento(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export interface Marco { codigo: string; tipo: string; x: number; y: number }
/**
 * Marcos (POINT em camada com "MARCO") com o código do rótulo mais próximo (M-001…).
 * O CAD põe o rótulo deslocado do ponto sempre do mesmo jeito (ex.: +5 m, +5 m):
 * acha esse deslocamento (mediana) e casa cada ponto com o rótulo mais próximo de
 * "ponto + deslocamento" — o mais próximo do ponto pode ser o rótulo do vizinho.
 */
export function marcosDoDxf(pontos: PontoDxf[], textos: TextoDxf[]): Marco[] {
  const pts = pontos.filter((p) => /MARCO/i.test(p.camada));
  const rots = textos.filter((t) => /MARCO/i.test(t.camada) && /^[A-Z]{1,4}[-_ ]?\d{1,5}$/i.test(t.texto.trim()));
  if (!pts.length || !rots.length) return [];
  const mediana = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
  const viz = pts.map((p) => rots.reduce((b, t) => (Math.hypot(t.x - p.x, t.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? t : b)));
  const off = { x: mediana(viz.map((t, i) => t.x - pts[i].x)), y: mediana(viz.map((t, i) => t.y - pts[i].y)) };
  const pares: Array<{ i: number; j: number; d: number }> = [];
  pts.forEach((p, i) => rots.forEach((t, j) => { const d = Math.hypot(t.x - p.x - off.x, t.y - p.y - off.y); if (d < 30) pares.push({ i, j, d }); }));
  pares.sort((a, b) => a.d - b.d);
  const usadoP = new Set<number>(), usadoT = new Set<number>();
  const out: Marco[] = [];
  for (const q of pares) {
    if (usadoP.has(q.i) || usadoT.has(q.j)) continue;
    usadoP.add(q.i); usadoT.add(q.j);
    const tipo = pts[q.i].camada.replace(/^MARCOS?_?/i, '').replace(/_/g, ' ').toLowerCase();
    out.push({ codigo: rots[q.j].texto.trim().toUpperCase(), tipo, x: pts[q.i].x, y: pts[q.i].y });
  }
  return out;
}

export interface LadoParcela { de: string; para: string; azimute: number; distancia: number; confrontante: string }
export interface Parcela { lote: string; rotulo: string; area_util_ha: number | null; perimetro: Perimetro; lados: LadoParcela[]; tipos_vertice: Array<string | null> }
export interface CamadaDesenho { camada: string; tipo: 'ESTRADA' | 'APP' | 'COMUNITARIA' | 'AGUA' | 'OUTRA'; pts: Array<[number, number]>; fechada: boolean; rotulo: string | null }
export interface Subdivisao { parcelas: Parcela[]; camadas: CamadaDesenho[]; marcos: number; fuso: number; hemisferio: 'S' | 'N'; arquivo: string | null; atualizado_em: string | null }

const tipoCamada = (c: string): CamadaDesenho['tipo'] =>
  /ESTRADA|VICINAL|SERVID/i.test(c) ? 'ESTRADA' : /APP/i.test(c) ? 'APP' : /COMUNIT/i.test(c) ? 'COMUNITARIA' : /CORREG|NASCENT|RIO|AGUA|ÁGUA/i.test(c) ? 'AGUA' : 'OUTRA';
const nLote = (t: string) => { const m = t.match(/\bL(?:OTE|T)?[\s\-–_.]*0*(\d{1,4})\b/i); return m ? m[1].padStart(2, '0') : null; };
const haDoTexto = (t: string) => { const m = t.match(/(\d+[.,]\d+)\s*ha/i); return m ? Number(m[1].replace(',', '.')) : null; };

/** Extrai as parcelas (lotes) do DXF da divisão. */
export function subdivisaoDeDxf(dxf: string, opts: { fuso?: number | null; hemisferio?: 'S' | 'N'; arquivo?: string | null } = {}): Subdivisao {
  const { polilinhas, textos, pontos } = lerDxfEntidades(dxf);
  const marcos = marcosDoDxf(pontos, textos);
  const marcoEm = (q: { x: number; y: number }) => marcos.find((m) => Math.hypot(m.x - q.x, m.y - q.y) < 0.5) ?? null;
  const lotesPl = polilinhas.filter((p) => p.fechada && /LOTE/i.test(p.camada) && p.pts.length >= 3);
  if (!lotesPl.length) throw new PaErro('SUBDIVISAO_DXF', 'Nenhuma polilinha fechada de lote encontrada no DXF (camada com "LOTE" no nome)', 400);
  const rotulosLote = textos.filter((t) => /LOTE/i.test(t.camada) || nLote(t.texto));
  const comunit = polilinhas.filter((p) => p.fechada && tipoCamada(p.camada) === 'COMUNITARIA');
  const estradas = polilinhas.filter((p) => tipoCamada(p.camada) === 'ESTRADA');
  const fuso = opts.fuso ?? 23, hem = opts.hemisferio ?? 'S';

  const brutas = lotesPl.map((pl, k) => {
    const dentro = rotulosLote.filter((t) => pontoNoPoligono(t, pl.pts));
    const rot = dentro.find((t) => nLote(t.texto));
    const lote = rot ? nLote(rot.texto)! : `S${String(k + 1).padStart(2, '0')}`;
    const util = dentro.map((t) => haDoTexto(t.texto)).find((v) => v != null) ?? null;
    return { pl, lote, rotulo: rot?.texto ?? `Sem rótulo ${k + 1}`, util };
  });
  const repetidos = brutas.map((b) => b.lote).filter((l, i, a) => a.indexOf(l) !== i);
  if (repetidos.length) throw new PaErro('SUBDIVISAO_DXF', `Rótulo de lote repetido no DXF: ${[...new Set(repetidos)].join(', ')}`, 400);

  // Confrontante de um lado: ponto 1 m para fora do meio do lado.
  // shortcut: um confrontante por lado (pelo ponto médio); lado longo com 2 vizinhos mostra só um — dividir o lado nos vértices do vizinho se precisar.
  const confrontante = (a: { x: number; y: number }, b: { x: number; y: number }, propria: number): string => {
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // vértices em sentido horário → o lado de fora é à esquerda do sentido de percurso
    const fora = { x: (a.x + b.x) / 2 - ((b.y - a.y) / L) * 1, y: (a.y + b.y) / 2 + ((b.x - a.x) / L) * 1 };
    const viz = brutas.findIndex((o, j) => j !== propria && pontoNoPoligono(fora, o.pl.pts));
    if (viz >= 0) return `Lote ${brutas[viz].lote}`;
    const c = comunit.find((p) => pontoNoPoligono(fora, p.pts));
    if (c) return textos.find((t) => tipoCamada(t.camada) === 'COMUNITARIA' && pontoNoPoligono(t, c.pts))?.texto || 'Área comunitária';
    const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (estradas.some((e) => e.pts.some((p, i) => i > 0 && distPontoSegmento(meio, e.pts[i - 1], p) < 25))) return 'Estrada vicinal';
    return 'Limite do Projeto de Assentamento';
  };

  const parcelas: Parcela[] = brutas.map((b, k) => {
    // Vértice com marco usa o código do marco (M-001…); sem marco, L02-P01… (único entre lotes).
    let semMarco = 0;
    const nomes = b.pl.pts.map((q) => marcoEm(q)?.codigo ?? `L${b.lote}-P${String(++semMarco).padStart(2, '0')}`);
    const perimetro = montarPerimetro({ sistema: 'UTM', pares: b.pl.pts, nomes }, { fuso, hemisferio: hem, formato: 'DXF', arquivo: opts.arquivo ?? null });
    const tipos_vertice = perimetro.vertices.map((vv) => marcoEm({ x: vv.E, y: vv.N })?.tipo ?? null);
    const v = perimetro.vertices;
    const lados: LadoParcela[] = perimetro.segmentos.map((s, i) => {
      const w = v[(i + 1) % v.length];
      return { ...s, confrontante: confrontante({ x: v[i].E, y: v[i].N }, { x: w.E, y: w.N }, k) };
    });
    return { lote: b.lote, rotulo: b.rotulo, area_util_ha: b.util, perimetro, lados, tipos_vertice };
  }).sort((a, b) => a.lote.localeCompare(b.lote, 'pt-BR', { numeric: true }));

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const camadas: CamadaDesenho[] = polilinhas
    .filter((p) => !/LOTE|PERIMETRO/i.test(p.camada) && tipoCamada(p.camada) !== 'OUTRA')
    .map((p) => ({
      camada: p.camada, tipo: tipoCamada(p.camada), fechada: p.fechada, pts: p.pts.map((q) => [r1(q.x), r1(q.y)] as [number, number]),
      rotulo: p.fechada ? (textos.find((t) => t.camada === p.camada && pontoNoPoligono(t, p.pts))?.texto ?? null) : null,
    }));
  return { parcelas, camadas, marcos: marcos.length, fuso, hemisferio: hem, arquivo: opts.arquivo ?? null, atualizado_em: null };
}

const m2br = (v: number, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const dms = (g: number) => { const t = Math.round(g * 3600); return `${Math.floor(t / 3600)}°${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}'${String(t % 60).padStart(2, '0')}"`; };

/** Memorial descritivo de uma parcela, com confrontantes (lados seguidos com o mesmo confrontante são agrupados no texto). */
export function textoMemorialParcela(pc: Parcela, nomePa: string, municipio: string, beneficiario: string | null): string[] {
  const p = pc.perimetro, v = p.vertices;
  const par: string[] = [];
  par.push(`Imóvel: Lote ${pc.lote} do ${nomePa} — ${municipio}.${beneficiario ? ` Beneficiário(a): ${beneficiario}.` : ''} Área total: ${m2br(p.area_ha, 4)} ha (${m2br(p.area_m2)} m²), incluídas as áreas de preservação permanente (APP) e as faixas de estrada que incidem no lote${pc.area_util_ha != null ? `; área útil (descontadas APP e estradas): ${m2br(pc.area_util_ha, 4)} ha` : ''}. Perímetro: ${m2br(p.perimetro_m)} m. Sistema de referência: ${p.datum}, projeção UTM, fuso ${p.fuso}${p.hemisferio === 'S' ? ' Sul' : ' Norte'}.`);
  const trechos: string[] = [];
  let conf = '';
  pc.lados.forEach((s, i) => {
    const w = v[(i + 1) % v.length];
    const pre = s.confrontante !== conf ? `deste segue confrontando com ${s.confrontante}, ` : 'deste segue ';
    conf = s.confrontante;
    trechos.push(`${pre}com azimute de ${dms(s.azimute)} e distância de ${m2br(s.distancia)} m até o vértice ${s.para}, de coordenadas N ${m2br(w.N, 3)} m e E ${m2br(w.E, 3)} m`);
  });
  par.push(`Inicia-se a descrição deste perímetro no vértice ${v[0].nome}, de coordenadas N ${m2br(v[0].N, 3)} m e E ${m2br(v[0].E, 3)} m; ${trechos.join('; ')}, ponto inicial da descrição deste perímetro.`);
  par.push('Todas as coordenadas aqui descritas estão georreferenciadas ao Sistema Geodésico Brasileiro, referenciadas ao datum SIRGAS 2000, e encontram-se representadas no sistema UTM. Os azimutes e distâncias, área e perímetro foram calculados no plano de projeção UTM.');
  return par;
}
