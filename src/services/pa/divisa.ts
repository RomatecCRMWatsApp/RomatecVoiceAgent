// v3.160.0 — Divisa municipal do PA (ex.: Açailândia × Itinga do Maranhão).
// Guarda a linha da divisa intermunicipal (IBGE) e os municípios de cada lado; as áreas
// saem SEMPRE do perímetro GNSS salvo do PA, cortado pela linha (o PDF/DXF serve só de
// fonte da linha). Também reparte as áreas comunitárias e os lotes que a divisa atravessa.
// Funções puras, sem banco.
import { PaErro } from './erros';
import { lerDxfEntidades, pontoInterno, pontoNoPoligono } from './parcelas';
import { areaAssinada, type Pt } from './limpezaLotes';

export interface MunicipioDivisa { nome: string; ibge: string | null; ref: [number, number]; cor: string }
export interface DivisaSalva {
  linha: Array<[number, number]>;
  municipios: MunicipioDivisa[];
  corregos?: Array<Array<[number, number]>>;
  estradas?: Array<Array<[number, number]>>;
  perimetro_pdf?: Array<[number, number]>;
  fonte: string | null;
  arquivo?: string | null;
  atualizado_em?: string | null;
}
export interface ParteMunicipio { nome: string; ibge: string | null; cor: string; area_m2: number; area_ha: number; pct: number; aneis: Pt[][] }
export interface PontoDivisa { nome: string; E: number; N: number }
export interface ResultadoDivisa {
  municipios: ParteMunicipio[];
  pontos: PontoDivisa[];
  extensao_m: number;
  total_m2: number;
  comunitarias: Array<{ rotulo: string; por_municipio: number[] }>;
  lotes_divididos: Array<{ lote: string; por_municipio: number[] }>;
  lotes_por_municipio: number[];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const area = (r: Pt[]) => Math.abs(areaAssinada(r));

/** Interseção dos segmentos ab × cd: parâmetros t (em ab) e u (em cd), ou null. */
function cruza(a: Pt, b: Pt, c: Pt, d: Pt): { t: number; u: number; p: Pt } | null {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den, u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-12 || u > 1 + 1e-12) return null;
  return { t, u, p: { x: a.x + t * r.x, y: a.y + t * r.y } };
}

/** Pontos onde a linha cruza o anel, em ordem ao longo da linha (s = posição acumulada). */
function cruzamentos(anel: Pt[], linha: Pt[]): Array<{ s: number; seg: number; u: number; aresta: number; t: number; p: Pt }> {
  const out: Array<{ s: number; seg: number; u: number; aresta: number; t: number; p: Pt }> = [];
  for (let j = 1; j < linha.length; j++) {
    for (let i = 0; i < anel.length; i++) {
      const x = cruza(anel[i], anel[(i + 1) % anel.length], linha[j - 1], linha[j]);
      if (!x) continue;
      if (out.some((o) => dist(o.p, x.p) < 1e-6)) continue; // passou exatamente num vértice
      out.push({ s: j - 1 + x.u, seg: j, u: x.u, aresta: i, t: x.t, p: x.p });
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

/** Corta o anel pelo caminho interno A→B (A e B no contorno). */
function cortar(anel: Pt[], a: Pt, b: Pt, caminho: Pt[]): [Pt[], Pt[]] | null {
  const loc = (p: Pt) => {
    for (let i = 0; i < anel.length; i++) {
      const q = anel[i], r = anel[(i + 1) % anel.length], L = dist(q, r);
      if (L < 1e-9) continue;
      const t = ((p.x - q.x) * (r.x - q.x) + (p.y - q.y) * (r.y - q.y)) / (L * L);
      if (t < -1e-9 || t > 1 + 1e-9) continue;
      if (Math.abs((r.x - q.x) * (p.y - q.y) - (r.y - q.y) * (p.x - q.x)) / L < 1e-4) return { i, t };
    }
    return null;
  };
  const la = loc(a), lb = loc(b);
  if (!la || !lb) return null;
  // insere A e B como vértices
  const ins = [{ ...la, p: a, k: 'A' }, { ...lb, p: b, k: 'B' }].sort((x, y) => (x.i - y.i) || (x.t - y.t));
  const r: Pt[] = []; let iA = -1, iB = -1;
  for (let i = 0; i < anel.length; i++) {
    r.push(anel[i]);
    for (const x of ins) if (x.i === i) { if (dist(r[r.length - 1], x.p) > 1e-9) r.push(x.p); if (x.k === 'A') iA = r.length - 1; else iB = r.length - 1; }
  }
  if (iA < 0 || iB < 0 || iA === iB) return null;
  const vol = (de: number, ate: number) => { const o: Pt[] = []; for (let k = de; ; k = (k + 1) % r.length) { o.push(r[k]); if (k === ate) break; } return o; };
  const p1 = [...vol(iA, iB), ...caminho.slice().reverse()];
  const p2 = [...vol(iB, iA), ...caminho];
  return [p1, p2];
}

/** Divide um polígono por uma polilinha (que pode cruzar várias vezes). */
export function dividirPorLinha(anel: Pt[], linha: Pt[]): Pt[][] {
  const xs = cruzamentos(anel, linha);
  let pecas: Pt[][] = [anel];
  for (let k = 0; k + 1 < xs.length; k++) {
    const A = xs[k], B = xs[k + 1];
    const caminho = linha.slice(A.seg, B.seg); // vértices da linha entre A e B
    const meio = caminho.length ? caminho[Math.floor(caminho.length / 2)] : { x: (A.p.x + B.p.x) / 2, y: (A.p.y + B.p.y) / 2 };
    const mid = caminho.length === 0 ? meio : (caminho.length === 1 ? caminho[0] : { x: (caminho[0].x + caminho[1].x) / 2, y: (caminho[0].y + caminho[1].y) / 2 });
    const pi = pecas.findIndex((pc) => pontoNoPoligono(mid, pc));
    if (pi < 0) continue; // trecho por fora do polígono
    const c = cortar(pecas[pi], A.p, B.p, caminho);
    if (!c || area(c[0]) < 1e-6 || area(c[1]) < 1e-6) continue;
    pecas = [...pecas.slice(0, pi), c[0], c[1], ...pecas.slice(pi + 1)];
  }
  return pecas;
}

/** Lado (+1/−1) de um ponto em relação à linha: pelo segmento mais próximo. */
function lado(p: Pt, linha: Pt[]): number {
  let melhor = Infinity, s = 0;
  for (let j = 1; j < linha.length; j++) {
    const a = linha[j - 1], b = linha[j], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < melhor) { melhor = d; s = Math.sign(dx * (p.y - a.y) - dy * (p.x - a.x)) || 1; }
  }
  return s;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Calcula as partes do PA em cada município, os pontos da divisa no perímetro e o rateio das áreas comunitárias/lotes. */
export function calcularDivisa(
  perimetro: Pt[], div: DivisaSalva,
  extras: { comunitarias?: Array<{ rotulo: string; pts: Pt[] }>; lotes?: Array<{ lote: string; pts: Pt[] }> } = {},
): ResultadoDivisa {
  if (perimetro.length < 3) throw new PaErro('SEM_PERIMETRO', 'Perímetro do PA inválido', 409);
  if (div.linha.length < 2) throw new PaErro('DIVISA_INVALIDA', 'Linha da divisa sem pontos', 400);
  if (div.municipios.length < 2) throw new PaErro('DIVISA_INVALIDA', 'Informe os dois municípios da divisa', 400);
  const linha = div.linha.map(([x, y]) => ({ x, y }));
  const ladoMun = div.municipios.map((m) => lado({ x: m.ref[0], y: m.ref[1] }, linha));
  if (ladoMun[0] === ladoMun[1]) throw new PaErro('DIVISA_INVALIDA', 'Os dois municípios ficaram do mesmo lado da divisa — confira os pontos de referência', 400);
  const porLado = (q: Pt) => { const i = ladoMun.indexOf(lado(q, linha)); return i < 0 ? 0 : i; };

  const pecas = dividirPorLinha(perimetro, linha);
  const total = area(perimetro);
  const xs = cruzamentos(perimetro, linha);
  if (xs.length < 2) throw new PaErro('DIVISA_FORA', 'A linha da divisa não atravessa o perímetro do PA', 400);
  const municipios: ParteMunicipio[] = div.municipios.map((m) => ({ nome: m.nome, ibge: m.ibge, cor: m.cor, area_m2: 0, area_ha: 0, pct: 0, aneis: [] }));
  // peça do PA: a que contém o ponto de referência do município; as demais, pelo lado da linha
  const donoPeca = pecas.map((pc) => { const i = div.municipios.findIndex((m) => pontoNoPoligono({ x: m.ref[0], y: m.ref[1] }, pc)); return i >= 0 ? i : porLado(pontoInterno(pc)); });
  pecas.forEach((pc, k) => { const m = municipios[donoPeca[k]]; m.aneis.push(pc); m.area_m2 += area(pc); });
  // qualquer outra área (comunitária, lote): a parte que cai dentro do PA vai pro município da peça onde está;
  // fora do PA (raro), pelo lado da linha
  const deQuem = (pc: Pt[]) => { const q = pontoInterno(pc); const k = pecas.findIndex((x) => pontoNoPoligono(q, x)); return k >= 0 ? donoPeca[k] : porLado(q); };
  const repartir = (anel: Pt[]) => { const v = div.municipios.map(() => 0); for (const pc of dividirPorLinha(anel, linha)) v[deQuem(pc)] += area(pc); return v; };
  for (const m of municipios) { m.area_m2 = r2(m.area_m2); m.area_ha = Math.round(m.area_m2) / 10000; m.pct = total ? Math.round((m.area_m2 / total) * 10000) / 100 : 0; }
  // extensão da divisa dentro do PA (trechos entre cruzamentos que ficam dentro)
  let ext = 0;
  for (let k = 0; k + 1 < xs.length; k++) {
    const A = xs[k], B = xs[k + 1];
    const pts = [A.p, ...linha.slice(A.seg, B.seg), B.p];
    const mid = pts.length > 2 ? pts[1] : { x: (A.p.x + B.p.x) / 2, y: (A.p.y + B.p.y) / 2 };
    if (!pontoNoPoligono(pts.length > 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : mid, perimetro)) continue;
    for (let i = 1; i < pts.length; i++) ext += dist(pts[i - 1], pts[i]);
  }
  const comunitarias = (extras.comunitarias ?? []).map((c) => ({ rotulo: c.rotulo, por_municipio: repartir(c.pts).map(r2) }));
  const lotes_por_municipio = div.municipios.map(() => 0);
  const lotes_divididos: ResultadoDivisa['lotes_divididos'] = [];
  for (const l of extras.lotes ?? []) {
    const v = repartir(l.pts);
    const tot = v.reduce((a, b) => a + b, 0);
    const maior = v.indexOf(Math.max(...v));
    lotes_por_municipio[maior]++;
    if (v.filter((x) => x > Math.max(100, tot * 0.001)).length > 1) lotes_divididos.push({ lote: l.lote, por_municipio: v.map(r2) });
  }
  return {
    municipios, pontos: xs.map((x, i) => ({ nome: `D-${String(i + 1).padStart(2, '0')}`, E: Math.round(x.p.x * 1000) / 1000, N: Math.round(x.p.y * 1000) / 1000 })),
    extensao_m: r2(ext), total_m2: r2(total), comunitarias, lotes_divididos, lotes_por_municipio,
  };
}

/**
 * Lê a divisa de um DXF: linha na camada com "DIVISA" (a mais longa) e, se houver, as partes
 * do PA em camadas "PA_EM_<MUNICIPIO>" (dão o lado de cada município). Córregos/estradas vão junto.
 */
export function divisaDeDxf(dxf: string, nomes: Array<string | null> = [], arquivo: string | null = null): DivisaSalva {
  const { polilinhas } = lerDxfEntidades(dxf);
  const comp = (p: Pt[]) => p.reduce((s, q, i) => (i ? s + dist(p[i - 1], q) : 0), 0);
  const linhas = polilinhas.filter((p) => /DIVISA/i.test(p.camada) && !/PONTO/i.test(p.camada)).sort((a, b) => comp(b.pts) - comp(a.pts));
  if (!linhas.length) throw new PaErro('DIVISA_DXF', 'Nenhuma linha na camada "DIVISA" do DXF', 400);
  const partes = polilinhas.filter((p) => p.fechada && /^PA_EM_/i.test(p.camada));
  const nomeCamada = (c: string) => c.replace(/^PA_EM_/i, '').replace(/_/g, ' ').toLowerCase().replace(/\b\p{L}/gu, (l) => l.toUpperCase()).replace(/\b(Do|Da|De|Dos|Das)\b/g, (x) => x.toLowerCase());
  const cores = ['#F0A04A', '#5C9BD6', '#8BC34A', '#BA68C8'];
  // nomes oficiais (IBGE) da região — a camada do CAD não tem acento
  const OFICIAIS: Record<string, [string, string]> = {
    ACAILANDIA: ['Açailândia/MA', '2100055'], ITINGA_DO_MARANHAO: ['Itinga do Maranhão/MA', '2105427'], CIDELANDIA: ['Cidelândia/MA', '2103257'],
    SAO_FRANCISCO_DO_BREJAO: ['São Francisco do Brejão/MA', '2110856'], BOM_JESUS_DAS_SELVAS: ['Bom Jesus das Selvas/MA', '2101970'],
    BURITICUPU: ['Buriticupu/MA', '2102325'], JOAO_LISBOA: ['João Lisboa/MA', '2105500'], IMPERATRIZ: ['Imperatriz/MA', '2105302'],
    DOM_ELISEU: ['Dom Eliseu/PA', '1502939'], RONDON_DO_PARA: ['Rondon do Pará/PA', '1506187'],
  };
  const oficial = (c: string) => OFICIAIS[c.replace(/^PA_EM_/i, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/_MA$|_PA$/, '')] ?? null;
  let municipios: MunicipioDivisa[];
  if (partes.length >= 2) {
    municipios = partes.slice(0, 2).map((p, i) => { const r = pontoInterno(p.pts); const of = oficial(p.camada); return { nome: nomes[i] || of?.[0] || nomeCamada(p.camada), ibge: of?.[1] ?? null, ref: [r.x, r.y] as [number, number], cor: cores[i] }; });
  } else {
    // sem as partes: um ponto de cada lado, a 200 m do meio da linha
    const L = linhas[0].pts, m = Math.floor(L.length / 2), a = L[Math.max(0, m - 1)], b = L[Math.min(L.length - 1, m)];
    const dx = b.x - a.x, dy = b.y - a.y, n = Math.hypot(dx, dy) || 1, c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    municipios = [1, -1].map((s, i) => ({ nome: nomes[i] || `Município ${i + 1}`, ibge: null, ref: [c.x - (dy / n) * 200 * s, c.y + (dx / n) * 200 * s] as [number, number], cor: cores[i] }));
  }
  const xy = (p: Pt[]) => p.map((q) => [Math.round(q.x * 1000) / 1000, Math.round(q.y * 1000) / 1000] as [number, number]);
  return {
    linha: xy(linhas[0].pts), municipios,
    corregos: polilinhas.filter((p) => /CORREG|AGUA|ÁGUA|RIO/i.test(p.camada)).map((p) => xy(p.pts)),
    estradas: polilinhas.filter((p) => /ESTRADA|VICINAL/i.test(p.camada)).map((p) => xy(p.pts)),
    fonte: `DXF ${arquivo ?? ''}`.trim(), arquivo, atualizado_em: null,
  };
}

/** DXF (R12) do mapa de divisa: perímetro, divisa, partes por município, pontos D, córregos, estradas e comunitárias. */
export function dxfDivisa(perimetro: Pt[], div: DivisaSalva, r: ResultadoDivisa, comunitarias: Array<{ rotulo: string; pts: Pt[] }> = []): string {
  const o: string[] = [];
  const g = (c: number, v: string | number) => { o.push(String(c), String(v)); };
  const n = (v: number) => v.toFixed(4);
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\/MA$/, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const camadas: Array<[string, number]> = [['PA_PERIMETRO', 3], ['DIVISA_INTERMUNICIPAL_IBGE', 1], ['PONTOS_DIVISA', 1], ['AREAS_COMUNITARIAS', 6], ['CORREGOS', 150], ['ESTRADAS', 8], ['TEXTOS', 7],
    ...r.municipios.map((m, i) => [`PA_EM_${slug(m.nome)}`, i ? 5 : 30] as [string, number])];
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 6); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, camadas.length);
  for (const [l, c] of camadas) { g(0, 'LAYER'); g(2, l); g(70, 0); g(62, c); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC'); g(0, 'SECTION'); g(2, 'ENTITIES');
  const poli = (layer: string, pts: Array<Pt | [number, number]>, fechada: boolean) => {
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, fechada ? 1 : 0);
    for (const q of pts) { const [x, y] = Array.isArray(q) ? q : [q.x, q.y]; g(0, 'VERTEX'); g(8, layer); g(10, n(x)); g(20, n(y)); g(30, 0); }
    g(0, 'SEQEND'); g(8, layer);
  };
  const texto = (layer: string, x: number, y: number, h: number, t: string) => { g(0, 'TEXT'); g(8, layer); g(10, n(x)); g(20, n(y)); g(30, 0); g(40, h); g(1, t); };
  const br = (v: number, d = 4) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  poli('PA_PERIMETRO', perimetro, true);
  poli('DIVISA_INTERMUNICIPAL_IBGE', div.linha, false);
  r.municipios.forEach((m) => {
    const layer = `PA_EM_${slug(m.nome)}`;
    for (const a of m.aneis) poli(layer, a, true);
    const maior = m.aneis.slice().sort((a, b) => area(b) - area(a))[0];
    if (maior) { const c = pontoInterno(maior); texto(layer, c.x, c.y + 60, 50, `PARTE EM ${m.nome.toUpperCase()}`); texto(layer, c.x, c.y, 35, `${br(m.area_ha)} ha - ${br(m.area_ha / 4.84)} alqueires - ${br(m.pct, 2)} %`); }
  });
  for (const p of r.pontos) { g(0, 'POINT'); g(8, 'PONTOS_DIVISA'); g(10, n(p.E)); g(20, n(p.N)); g(30, 0); texto('PONTOS_DIVISA', p.E + 5, p.N + 5, 30, p.nome); }
  for (const c of comunitarias) { poli('AREAS_COMUNITARIAS', c.pts, true); const q = pontoInterno(c.pts); texto('AREAS_COMUNITARIAS', q.x, q.y, 15, c.rotulo); }
  for (const l of div.corregos ?? []) poli('CORREGOS', l, false);
  for (const l of div.estradas ?? []) poli('ESTRADAS', l, false);
  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}
