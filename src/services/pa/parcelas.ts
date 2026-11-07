// v3.151.0 — Subdivisão do PA em parcelas (lotes rurais) a partir do DXF.
// O DXF da divisão traz: perímetro (PA_PERIMETRO), uma polilinha fechada por
// lote (camada com "LOTE" no nome) e o rótulo "LT-NN" dentro de cada uma, além
// de estradas, APP e áreas comunitárias. Cada lote vira um perímetro próprio
// (vértices, azimutes, distâncias, área) com confrontantes por lado. Funções puras.
import { PaErro } from './erros';
import { montarPerimetro, type Perimetro } from './perimetro';
import { alqueiresTxt, haAlq } from './unidades';
import { limparPoligonais, areaAssinada, type RelatorioLote, type Pt } from './limpezaLotes';

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
    } else if (val === 'POLYLINE') {
      // v3.158.0: POLYLINE + VERTEX… + SEQEND (DXF R12 — inclusive o "DXF limpo" que o sistema exporta)
      let camada = '', flag = 0;
      for (i++; i < pares.length && pares[i][0] !== 0; i++) { const [c, v] = pares[i]; if (c === 8) camada = v; else if (c === 70) flag = Number(v); }
      const pts: Array<{ x: number; y: number }> = [];
      while (i < pares.length && pares[i][0] === 0 && pares[i][1] === 'VERTEX') {
        let x = NaN, y = NaN;
        for (i++; i < pares.length && pares[i][0] !== 0; i++) { const [c, v] = pares[i]; if (c === 10) x = Number(v); else if (c === 20) y = Number(v); }
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
      }
      i--;
      if (pts.length >= 2) {
        const f = pts[0], u = pts[pts.length - 1];
        polilinhas.push({ camada, pts, fechada: (flag & 1) === 1 || (pts.length > 3 && Math.abs(f.x - u.x) < 1e-6 && Math.abs(f.y - u.y) < 1e-6) });
      }
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
export function marcosDoDxf(pontos: PontoDxf[], textos: TextoDxf[], camada: RegExp = /MARCO/i): Marco[] {
  const pts = pontos.filter((p) => camada.test(p.camada));
  const rots = textos.filter((t) => camada.test(t.camada) && /^[A-Z]{1,4}[-_ ]?\d{1,5}$/i.test(t.texto.trim()));
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
export interface LimpezaSubdivisao { em: string; versao: number; lotes_corrigidos: number; relatorio: RelatorioLote[]; avisos: string[] }
export interface Subdivisao {
  parcelas: Parcela[]; camadas: CamadaDesenho[]; marcos: number; fuso: number; hemisferio: 'S' | 'N'; arquivo: string | null; atualizado_em: string | null;
  /** v3.158.0: resultado da limpeza das poligonais */
  limpeza?: LimpezaSubdivisao;
  /** v3.158.0: posição do rótulo LT-NN de cada lote (UTM) — usada para reprocessar */
  rotulos?: Record<string, [number, number]>;
  /** v3.158.0: geometria como veio do arquivo, antes da primeira limpeza (backup) */
  geometria_original?: Array<{ lote: string; pts: Array<[number, number]> }>;
}
export const VERSAO_LIMPEZA = 1;

const tipoCamada = (c: string): CamadaDesenho['tipo'] =>
  /ESTRADA|VICINAL|SERVID/i.test(c) ? 'ESTRADA' : /APP/i.test(c) ? 'APP' : /COMUNIT/i.test(c) ? 'COMUNITARIA' : /CORREG|NASCENT|RIO|AGUA|ÁGUA/i.test(c) ? 'AGUA' : 'OUTRA';
const nLote = (t: string) => { const m = t.match(/\bL(?:OTE|T)?[\s\-–_.]*0*(\d{1,4})\b/i); return m ? m[1].padStart(2, '0') : null; };
const haDoTexto = (t: string) => { const m = t.match(/(\d+[.,]\d+)\s*ha/i); return m ? Number(m[1].replace(',', '.')) : null; };

/** Extrai as parcelas (lotes) do DXF da divisão — já com as poligonais limpas (v3.158.0). */
export function subdivisaoDeDxf(dxf: string, opts: { fuso?: number | null; hemisferio?: 'S' | 'N'; arquivo?: string | null; perimetro?: Pt[] | null } = {}): Subdivisao {
  const { polilinhas, textos, pontos } = lerDxfEntidades(dxf);
  const marcos = marcosDoDxf(pontos, textos);
  const lotesPl = polilinhas.filter((p) => p.fechada && /LOTE/i.test(p.camada) && p.pts.length >= 3);
  const abertasLote = polilinhas.filter((p) => !p.fechada && /LOTE/i.test(p.camada));
  const rotulosLote = textos.filter((t) => (/LOTE/i.test(t.camada) || nLote(t.texto)) && nLote(t.texto));
  if (!lotesPl.length && !(abertasLote.length && rotulosLote.length)) throw new PaErro('SUBDIVISAO_DXF', 'Nenhuma polilinha de lote encontrada no DXF (camada com "LOTE" no nome)', 400);
  const fuso = opts.fuso ?? 23, hem = opts.hemisferio ?? 'S';

  // rótulo de cada polilinha: primeiro as que têm um rótulo só; polilinha com 2+ rótulos (fechou no canto errado
  // e engoliu o do vizinho) fica com o mais perto do centro que ainda não foi usado.
  const centro = (pts: Pt[]) => ({ x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length });
  const cand = lotesPl.map((pl) => rotulosLote.filter((t) => pontoNoPoligono(t, pl.pts)));
  const usado = new Set<TextoDxf>();
  const escolha: Array<TextoDxf | null> = lotesPl.map(() => null);
  cand.forEach((c, k) => { if (c.length === 1) { escolha[k] = c[0]; usado.add(c[0]); } });
  cand.forEach((c, k) => {
    if (escolha[k] || !c.length) return;
    const ce = centro(lotesPl[k].pts);
    const livre = c.filter((t) => !usado.has(t)).sort((a, b) => Math.hypot(a.x - ce.x, a.y - ce.y) - Math.hypot(b.x - ce.x, b.y - ce.y));
    escolha[k] = livre[0] ?? c[0]; usado.add(escolha[k]!);
  });
  const brutas = lotesPl.map((pl, k) => {
    const rot = escolha[k];
    const lote = rot ? nLote(rot.texto)! : `S${String(k + 1).padStart(2, '0')}`;
    const util = textos.filter((t) => pontoNoPoligono(t, pl.pts)).map((t) => haDoTexto(t.texto)).find((v) => v != null) ?? null;
    return { pts: pl.pts as Pt[] | null, lote, rotulo: rot?.texto ?? `Sem rótulo ${k + 1}`, rotuloXY: rot ? { x: rot.x, y: rot.y } : null, util };
  });
  // lote só com rótulo (polilinha aberta): a região sai das linhas vizinhas
  for (const t of rotulosLote) {
    const lote = nLote(t.texto)!;
    if (brutas.some((b) => b.lote === lote)) continue;
    const util = textos.filter((x) => Math.hypot(x.x - t.x, x.y - t.y) < 60).map((x) => haDoTexto(x.texto)).find((v) => v != null) ?? null;
    brutas.push({ pts: null, lote, rotulo: t.texto, rotuloXY: { x: t.x, y: t.y }, util });
  }
  const repetidos = brutas.map((b) => b.lote).filter((l, i, a) => a.indexOf(l) !== i);
  if (repetidos.length) throw new PaErro('SUBDIVISAO_DXF', `Rótulo de lote repetido no DXF: ${[...new Set(repetidos)].join(', ')}`, 400);

  const extras = [...abertasLote, ...polilinhas.filter((p) => /PERIMETRO/i.test(p.camada))].map((p) => (p.fechada ? [...p.pts, p.pts[0]] : p.pts));
  const lp = limparPoligonais(brutas.map((b) => ({ lote: b.lote, anel: b.pts, rotulo: b.rotuloXY })), extras, { perimetro: opts.perimetro ?? null });

  const r1 = (n: number) => Math.round(n * 10) / 10;
  const camadas: CamadaDesenho[] = polilinhas
    .filter((p) => !/LOTE|PERIMETRO/i.test(p.camada) && tipoCamada(p.camada) !== 'OUTRA')
    .map((p) => ({
      camada: p.camada, tipo: tipoCamada(p.camada), fechada: p.fechada, pts: p.pts.map((q) => [r1(q.x), r1(q.y)] as [number, number]),
      rotulo: p.fechada ? (textos.find((t) => t.camada === p.camada && pontoNoPoligono(t, p.pts))?.texto ?? null) : null,
    }));
  const marcoEm = (q: Pt) => marcos.find((m) => Math.hypot(m.x - q.x, m.y - q.y) < 0.5) ?? null;
  const porLote = new Map(brutas.map((b) => [b.lote, b]));
  const parcelas = construirParcelas(
    lp.lotes.map((l) => ({ lote: l.lote, pts: l.anel, rotulo: porLote.get(l.lote)!.rotulo, util: porLote.get(l.lote)!.util })),
    camadas, (q) => marcoEm(q)?.codigo ?? null, (q) => marcoEm(q)?.tipo ?? null, fuso, hem, opts.arquivo ?? null,
  );
  const rotulos: Record<string, [number, number]> = {};
  for (const b of brutas) if (b.rotuloXY) rotulos[b.lote] = [b.rotuloXY.x, b.rotuloXY.y];
  return {
    parcelas, camadas, marcos: marcos.length, fuso, hemisferio: hem, arquivo: opts.arquivo ?? null, atualizado_em: null, rotulos,
    geometria_original: brutas.filter((b) => b.pts).map((b) => ({ lote: b.lote, pts: b.pts!.map((q) => [q.x, q.y] as [number, number]) })),
    limpeza: resumoLimpeza(lp),
  };
}

function resumoLimpeza(lp: ReturnType<typeof limparPoligonais>): LimpezaSubdivisao {
  const relatorio = lp.relatorio.filter((r) => r.alterado);
  return { em: new Date().toISOString(), versao: VERSAO_LIMPEZA, lotes_corrigidos: relatorio.length, relatorio, avisos: lp.avisos };
}

/** Monta as parcelas (perímetro, nomes dos vértices, confrontantes) a partir dos anéis já limpos. */
function construirParcelas(
  brutas: Array<{ lote: string; pts: Pt[]; rotulo: string; util: number | null }>, camadas: CamadaDesenho[],
  nomeDe: (q: Pt) => string | null, tipoDe: (q: Pt) => string | null, fuso: number, hem: 'S' | 'N', arquivo: string | null,
): Parcela[] {
  const comunit = camadas.filter((c) => c.fechada && c.tipo === 'COMUNITARIA').map((c) => ({ pts: c.pts.map(([x, y]) => ({ x, y })), rotulo: c.rotulo }));
  const estradas = camadas.filter((c) => c.tipo === 'ESTRADA').map((c) => c.pts.map(([x, y]) => ({ x, y })));
  // Confrontante de um lado: ponto 1 m para fora do meio do lado.
  // shortcut: um confrontante por lado (pelo ponto médio); lado longo com 2 vizinhos mostra só um — dividir o lado nos vértices do vizinho se precisar.
  const confrontante = (a: Pt, b: Pt, propria: number): string => {
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // vértices em sentido horário → o lado de fora é à esquerda do sentido de percurso
    const fora = { x: (a.x + b.x) / 2 - ((b.y - a.y) / L) * 1, y: (a.y + b.y) / 2 + ((b.x - a.x) / L) * 1 };
    const viz = brutas.findIndex((o, j) => j !== propria && pontoNoPoligono(fora, o.pts));
    if (viz >= 0) return `Lote ${brutas[viz].lote}`;
    const c = comunit.find((p) => pontoNoPoligono(fora, p.pts));
    if (c) return c.rotulo || 'Área comunitária';
    const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (estradas.some((e) => e.some((p, i) => i > 0 && distPontoSegmento(meio, e[i - 1], p) < 25))) return 'Estrada vicinal';
    return 'Limite do Projeto de Assentamento';
  };
  return brutas.map((b, k) => {
    // Vértice com marco usa o código do marco (M-001…); sem marco, L02-P01… (único entre lotes).
    // sentido horário antes de numerar (L02-P01, P02… seguem a ordem do memorial)
    const pts = areaAssinada(b.pts) > 0 ? [b.pts[0], ...b.pts.slice(1).reverse()] : b.pts;
    let semMarco = 0;
    const nomes = pts.map((q) => nomeDe(q) ?? `L${b.lote}-P${String(++semMarco).padStart(2, '0')}`);
    const perimetro = montarPerimetro({ sistema: 'UTM', pares: pts, nomes }, { fuso, hemisferio: hem, formato: 'DXF', arquivo });
    const tipos_vertice = perimetro.vertices.map((vv) => tipoDe({ x: vv.E, y: vv.N }));
    const v = perimetro.vertices;
    const lados: LadoParcela[] = perimetro.segmentos.map((s, i) => {
      const w = v[(i + 1) % v.length];
      return { ...s, confrontante: confrontante({ x: v[i].E, y: v[i].N }, { x: w.E, y: w.N }, k) };
    });
    return { lote: b.lote, rotulo: b.rotulo, area_util_ha: b.util, perimetro, lados, tipos_vertice };
  }).sort((a, b) => a.lote.localeCompare(b.lote, 'pt-BR', { numeric: true }));
}

/**
 * v3.158.0: limpa uma subdivisão já salva (sem o DXF original): usa os vértices de cada lote,
 * os rótulos (se houver) e o perímetro do PA. Nomes de marco (M-001…) e tipos dos vértices
 * que continuam no lugar são preservados.
 */
export function limparSubdivisao(sub: Subdivisao, perimetro: Pt[] | null = null): Subdivisao {
  const nomes = new Map<string, { nome: string; tipo: string | null }>();
  const k = (q: Pt) => `${Math.round(q.x * 20)},${Math.round(q.y * 20)}`; // 5 cm
  for (const pc of sub.parcelas) pc.perimetro.vertices.forEach((v, i) => {
    if (/^L\d+-P\d+$/.test(v.nome)) return; // nome automático: renumera
    nomes.set(k({ x: v.E, y: v.N }), { nome: v.nome, tipo: pc.tipos_vertice?.[i] ?? null });
  });
  const ach = (q: Pt) => { for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) { const n = nomes.get(`${Math.round(q.x * 20) + dx},${Math.round(q.y * 20) + dy}`); if (n) return n; } return null; };
  const ent = sub.parcelas.map((pc) => ({
    lote: pc.lote, anel: pc.perimetro.vertices.map((v) => ({ x: v.E, y: v.N })),
    rotulo: sub.rotulos?.[pc.lote] ? { x: sub.rotulos[pc.lote][0], y: sub.rotulos[pc.lote][1] } : null,
  }));
  const lp = limparPoligonais(ent, [], { perimetro });
  const porLote = new Map(sub.parcelas.map((p) => [p.lote, p]));
  const parcelas = construirParcelas(
    lp.lotes.map((l) => ({ lote: l.lote, pts: l.anel, rotulo: porLote.get(l.lote)!.rotulo, util: porLote.get(l.lote)!.area_util_ha })),
    sub.camadas, (q) => ach(q)?.nome ?? null, (q) => ach(q)?.tipo ?? null, sub.fuso, sub.hemisferio, sub.arquivo,
  );
  return {
    ...sub, parcelas,
    geometria_original: sub.geometria_original ?? sub.parcelas.map((pc) => ({ lote: pc.lote, pts: pc.perimetro.vertices.map((v) => [v.E, v.N] as [number, number]) })),
    limpeza: resumoLimpeza(lp),
  };
}

/** v3.158.0: DXF (R12) da subdivisão limpa — lotes fechados, rótulos, marcos, camadas e perímetro. */
export function dxfSubdivisao(sub: Subdivisao, perimetro: Pt[] | null = null): string {
  const o: string[] = [];
  const g = (c: number, v: string | number) => { o.push(String(c), String(v)); };
  const n = (v: number) => v.toFixed(4);
  const camadasUsadas = new Set<string>(['LOTES', 'LOTES_TEXTO', 'PA_PERIMETRO']);
  const marcoLayer = (t: string | null) => `MARCO_${(t || 'VERTICE').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  for (const pc of sub.parcelas) pc.tipos_vertice?.forEach((t) => { if (t) camadasUsadas.add(marcoLayer(t)); });
  for (const c of sub.camadas) camadasUsadas.add(c.camada);
  const cor: Record<string, number> = { LOTES: 3, LOTES_TEXTO: 3, PA_PERIMETRO: 1 };
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 6); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, camadasUsadas.size);
  for (const l of camadasUsadas) { g(0, 'LAYER'); g(2, l); g(70, 0); g(62, cor[l] ?? (/^MARCO/.test(l) ? 1 : /ESTRADA/i.test(l) ? 30 : /APP/i.test(l) ? 82 : /CORREG|AGUA|RIO/i.test(l) ? 5 : 7)); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const poli = (layer: string, pts: Array<[number, number]>, fechada: boolean) => {
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, fechada ? 1 : 0);
    for (const [x, y] of pts) { g(0, 'VERTEX'); g(8, layer); g(10, n(x)); g(20, n(y)); g(30, 0); }
    g(0, 'SEQEND'); g(8, layer);
  };
  const texto = (layer: string, x: number, y: number, h: number, t: string) => { g(0, 'TEXT'); g(8, layer); g(10, n(x)); g(20, n(y)); g(30, 0); g(40, h); g(1, t); };
  const marcosFeitos = new Set<string>();
  for (const pc of sub.parcelas) {
    const pts = pc.perimetro.vertices.map((v) => [v.E, v.N] as [number, number]);
    poli('LOTES', pts, true);
    // rótulo dentro do lote: o salvo (se ainda cair dentro) ou o ponto interno mais afastado das bordas entre amostras
    const anel = pts.map(([x, y]) => ({ x, y }));
    let r: Pt | null = sub.rotulos?.[pc.lote] ? { x: sub.rotulos[pc.lote][0], y: sub.rotulos[pc.lote][1] } : null;
    if (!r || !pontoNoPoligono(r, anel)) r = pontoInterno(anel);
    texto('LOTES_TEXTO', r.x, r.y, 12, `LT-${pc.lote}`);
    if (pc.area_util_ha != null) texto('LOTES_TEXTO', r.x, r.y - 18, 8, `útil ${pc.area_util_ha.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ha`);
    pc.perimetro.vertices.forEach((v, i) => {
      const t = pc.tipos_vertice?.[i];
      if (!t || /^L\d+-P\d+$/.test(v.nome) || marcosFeitos.has(v.nome)) return;
      marcosFeitos.add(v.nome);
      const layer = marcoLayer(t);
      g(0, 'POINT'); g(8, layer); g(10, n(v.E)); g(20, n(v.N)); g(30, 0);
      texto(layer, v.E + 5, v.N + 5, 4, v.nome);
    });
  }
  for (const c of sub.camadas) {
    poli(c.camada, c.pts, c.fechada);
    if (c.rotulo && c.fechada) { const p = pontoInterno(c.pts.map(([x, y]) => ({ x, y }))); texto(c.camada, p.x, p.y, 8, c.rotulo); }
  }
  if (perimetro && perimetro.length >= 3) poli('PA_PERIMETRO', perimetro.map((q) => [q.x, q.y] as [number, number]), true);
  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}

/** Ponto bem dentro do polígono (amostragem em grade; o mais longe das bordas). */
export function pontoInterno(p: Pt[]): Pt {
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let melhor: Pt = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, md = -1;
  for (let i = 1; i < 20; i++) for (let j = 1; j < 20; j++) {
    const q = { x: x0 + ((x1 - x0) * i) / 20, y: y0 + ((y1 - y0) * j) / 20 };
    if (!pontoNoPoligono(q, p)) continue;
    let d = Infinity;
    for (let k = 0; k < p.length; k++) d = Math.min(d, distPontoSegmento(q, p[k], p[(k + 1) % p.length]));
    if (d > md) { md = d; melhor = q; }
  }
  return melhor;
}

const m2br = (v: number, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const dms = (g: number) => { const t = Math.round(g * 3600); return `${Math.floor(t / 3600)}°${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}'${String(t % 60).padStart(2, '0')}"`; };

/** Memorial descritivo de uma parcela, com confrontantes (lados seguidos com o mesmo confrontante são agrupados no texto). */
export function textoMemorialParcela(pc: Parcela, nomePa: string, municipio: string, beneficiario: string | null): string[] {
  const p = pc.perimetro, v = p.vertices;
  const par: string[] = [];
  par.push(`Imóvel: Lote ${pc.lote} do ${nomePa} — ${municipio}.${beneficiario ? ` Beneficiário(a): ${beneficiario}.` : ''} Área total: ${m2br(p.area_ha, 4)} ha (${alqueiresTxt(p.area_ha)}; ${m2br(p.area_m2)} m²), incluídas as áreas de preservação permanente (APP) e as faixas de estrada que incidem no lote${pc.area_util_ha != null ? `; área útil (descontadas APP e estradas): ${haAlq(pc.area_util_ha)}` : ''}. Perímetro: ${m2br(p.perimetro_m)} m. Sistema de referência: ${p.datum}, projeção UTM, fuso ${p.fuso}${p.hemisferio === 'S' ? ' Sul' : ' Norte'}.`);
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

// ─── v3.154.0: perímetro real da vila (DXF da AC-01: área total + núcleo levantado) ─
export interface VilaPerimetro { total: Perimetro; nucleo: Perimetro | null; arquivo: string | null; atualizado_em: string | null }

/** Lê do DXF da vila a poligonal da área total (camada com "TOTAL" ou a maior) e a do núcleo (camada com "NUCLEO"); vértices nomeados pelos rótulos VL-01…/VN-01…. */
export function vilaDeDxf(dxf: string, opts: { fuso?: number | null; hemisferio?: 'S' | 'N'; arquivo?: string | null } = {}): VilaPerimetro {
  const { polilinhas, textos, pontos } = lerDxfEntidades(dxf);
  const fechadas = polilinhas.filter((p) => p.fechada && p.pts.length >= 3);
  if (!fechadas.length) throw new PaErro('VILA_DXF', 'Nenhuma polilinha fechada no DXF da vila', 400);
  const area = (p: PolilinhaDxf) => { let a = 0; for (let i = 0; i < p.pts.length; i++) { const q = p.pts[i], r = p.pts[(i + 1) % p.pts.length]; a += q.x * r.y - r.x * q.y; } return Math.abs(a / 2); };
  const nucleoPl = fechadas.find((p) => /NUCLEO|NÚCLEO/i.test(p.camada)) ?? null;
  const totalPl = fechadas.find((p) => /TOTAL/i.test(p.camada)) ?? [...fechadas].filter((p) => p !== nucleoPl).sort((a, b) => area(b) - area(a))[0] ?? nucleoPl!;
  const fuso = opts.fuso ?? 23, hem = opts.hemisferio ?? 'S';
  const montar = (pl: PolilinhaDxf, prefixo: string) => {
    const mk = marcosDoDxf(pontos, textos, new RegExp(pl.camada.replace(/[^A-Z0-9]/gi, '.').replace(/\.(VERTICES|TEXTO)$/i, '') || 'VILA', 'i'));
    const em = (q: { x: number; y: number }) => mk.find((m) => Math.hypot(m.x - q.x, m.y - q.y) < 0.5)?.codigo ?? null;
    let k = 0;
    const nomes = pl.pts.map((q) => em(q) ?? `${prefixo}-${String(++k).padStart(2, '0')}`);
    return montarPerimetro({ sistema: 'UTM', pares: pl.pts, nomes }, { fuso, hemisferio: hem, formato: 'DXF', arquivo: opts.arquivo ?? null });
  };
  return { total: montar(totalPl, 'VL'), nucleo: nucleoPl && nucleoPl !== totalPl ? montar(nucleoPl, 'VN') : null, arquivo: opts.arquivo ?? null, atualizado_em: null };
}
