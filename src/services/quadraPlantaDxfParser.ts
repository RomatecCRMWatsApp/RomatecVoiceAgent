// v3.31.0: parser DXF de planta da quadra. Extrai lotes (polylines fechadas
// no layer LOTES) com numero, vertices, area (shoelace) e medidas das arestas.
//
// Estrategia:
//   - Lazy import de `dxf-parser` (optional dep). Se nao instalado, retorna
//     parse_status='manual' com mensagem clara.
//   - Geometria pura: shoelace + centroide + classificacao de arestas
//     (frente/fundo/laterais por orientacao). Funcoes puras testaveis.
//   - Tolera DXFs com layer 'LOTES', 'LOTE-XX', 'LOTE_XX', case-insensitive.
//
// Tipo da estrutura retornada por `dxf-parser` (subset minimo). Tipos
// internos pra nao depender de @types/dxf-parser (nao existe oficial).

export type Ponto = { x: number; y: number };

export interface LoteExtraido {
  lote_numero: string;
  vertices_xy: Ponto[];
  area_m2: number;
  perimetro_m: number;
  frente_m: number;
  fundo_m: number;
  l_dir_m: number;
  l_esq_m: number;
}

export interface ResultadoParseDxf {
  status: 'sucesso' | 'erro' | 'manual';
  lotes: LoteExtraido[];
  num_lotes_detectados: number;
  area_total_m2: number;
  perimetro_total_m: number;
  mensagem?: string;
}

// ─── Geometria pura (testavel sem dxf-parser) ─────────────────────────────

export function shoelaceArea(vertices: Ponto[]): number {
  if (vertices.length < 3) return 0;
  let soma = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    soma += a.x * b.y - b.x * a.y;
  }
  return Math.abs(soma) / 2;
}

export function computeCentroide(vertices: Ponto[]): Ponto {
  let cx = 0, cy = 0;
  for (const v of vertices) { cx += v.x; cy += v.y; }
  const n = vertices.length || 1;
  return { x: cx / n, y: cy / n };
}

export function distancia(a: Ponto, b: Ponto): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function perimetro(vertices: Ponto[]): number {
  let s = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    s += distancia(a, b);
  }
  return s;
}

// Classifica 4 arestas em frente/fundo/lateral direita/lateral esquerda.
// Heuristica: frente = aresta de menor Y medio (mais ao sul, virada pra rua);
// fundo = aresta oposta; laterais = as 2 restantes (direita = maior X medio,
// esquerda = menor). Para poligonos nao-retangulares, retorna ' aproximacao'.
export interface ArestasClassificadas {
  frente_m: number;
  fundo_m: number;
  l_dir_m: number;
  l_esq_m: number;
}

export function classificarArestas4(vertices: Ponto[]): ArestasClassificadas {
  if (vertices.length < 4) {
    // Caso degenerado — distribui o perimetro igualmente
    const p = perimetro(vertices);
    return { frente_m: p / 4, fundo_m: p / 4, l_dir_m: p / 4, l_esq_m: p / 4 };
  }
  const arestas = vertices.map((a, i) => {
    const b = vertices[(i + 1) % vertices.length];
    return {
      comprimento: distancia(a, b),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      a, b,
    };
  });
  // Aresta com menor midY = frente
  const ordenadaPorY = [...arestas].sort((u, v) => u.midY - v.midY);
  const frente = ordenadaPorY[0];
  const fundo = ordenadaPorY[ordenadaPorY.length - 1];
  // Demais arestas → laterais. Direita = maior midX.
  const laterais = arestas.filter((e) => e !== frente && e !== fundo);
  if (laterais.length < 2) {
    return { frente_m: frente.comprimento, fundo_m: fundo.comprimento, l_dir_m: 0, l_esq_m: 0 };
  }
  const lDir = laterais.reduce((a, b) => (a.midX > b.midX ? a : b));
  const lEsq = laterais.find((e) => e !== lDir) || laterais[0];
  return {
    frente_m: round2(frente.comprimento),
    fundo_m: round2(fundo.comprimento),
    l_dir_m: round2(lDir.comprimento),
    l_esq_m: round2(lEsq.comprimento),
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Extrai numero do lote de uma string de texto (TEXT/MTEXT) que pode vir como
// "Lote 12", "LT 12", "12", "L-12" etc.
export function extrairNumeroLote(texto: string | undefined): string {
  if (!texto) return '';
  const m = String(texto).match(/\d+/);
  return m ? m[0] : String(texto).trim().slice(0, 20);
}

// Testa se o ponto p esta dentro do poligono (ray casting).
export function pontoNoPoligono(p: Ponto, poly: Ponto[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y))
      && (p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ─── Parser principal (com lazy import de dxf-parser) ─────────────────────

interface DxfEntity {
  type: string;
  layer?: string;
  closed?: boolean;
  vertices?: Array<{ x: number; y: number }>;
  position?: { x: number; y: number };
  text?: string;
  string?: string;
}
interface DxfData {
  entities: DxfEntity[];
}

let _parserCache: ((s: string) => DxfData) | null | undefined;
async function carregarParser(): Promise<((s: string) => DxfData) | null> {
  if (_parserCache !== undefined) return _parserCache;
  try {
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
    const mod = await dynamicImport('dxf-parser') as { default?: new () => { parseSync(s: string): DxfData } };
    const Ctor = mod.default;
    if (!Ctor) { _parserCache = null; return null; }
    const inst = new Ctor();
    _parserCache = (s: string) => inst.parseSync(s);
    return _parserCache;
  } catch {
    _parserCache = null;
    return null;
  }
}

export async function parsearDxfBuffer(buffer: Buffer): Promise<ResultadoParseDxf> {
  const parser = await carregarParser();
  if (!parser) {
    return {
      status: 'manual',
      lotes: [],
      num_lotes_detectados: 0,
      area_total_m2: 0,
      perimetro_total_m: 0,
      mensagem: 'dxf-parser nao instalado — parse manual requerido (npm i dxf-parser).',
    };
  }

  try {
    const conteudo = buffer.toString('utf8');
    const dxf = parser(conteudo);
    const entities: DxfEntity[] = Array.isArray(dxf?.entities) ? dxf.entities : [];

    const polylines = entities.filter((e) => {
      if (e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE') return false;
      if (e.closed !== true) return false;
      const layer = (e.layer || '').toLowerCase();
      return /^lote/i.test(layer) || layer.includes('lote');
    });

    const lotes: LoteExtraido[] = polylines.map((poly) => {
      const vertices: Ponto[] = (poly.vertices || []).map((v) => ({ x: Number(v.x) || 0, y: Number(v.y) || 0 }));
      const area = shoelaceArea(vertices);
      const peri = perimetro(vertices);
      const cl = classificarArestas4(vertices);

      // Procura texto dentro do poligono
      const textoEntidade = entities.find((e) => {
        if (e.type !== 'TEXT' && e.type !== 'MTEXT') return false;
        const pos = e.position;
        if (!pos) return false;
        return pontoNoPoligono({ x: Number(pos.x) || 0, y: Number(pos.y) || 0 }, vertices);
      });
      const numero = extrairNumeroLote(textoEntidade?.text || textoEntidade?.string);

      return {
        lote_numero: numero,
        vertices_xy: vertices,
        area_m2: round2(area),
        perimetro_m: round2(peri),
        ...cl,
      };
    });

    return {
      status: 'sucesso',
      lotes,
      num_lotes_detectados: lotes.length,
      area_total_m2: round2(lotes.reduce((s, l) => s + l.area_m2, 0)),
      perimetro_total_m: round2(lotes.reduce((s, l) => s + l.perimetro_m, 0)),
    };
  } catch (err) {
    return {
      status: 'erro',
      lotes: [],
      num_lotes_detectados: 0,
      area_total_m2: 0,
      perimetro_total_m: 0,
      mensagem: (err as Error).message,
    };
  }
}
