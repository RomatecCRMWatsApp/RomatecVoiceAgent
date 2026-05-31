// v3.51.1 — VTA Laudo Anexos: integra Croqui As-Built (Canvas / Modulo A) e
// Relatorio Fotografico georreferenciado (Modulo B) dentro do PDF do Laudo de
// Demarcacao (laudoPdf.ts).
//
// Linguagem As-Built / regularizacao:
//   - O croqui do Canvas representa o imovel COMO LEVANTADO EM CAMPO (as-built),
//     base grafica da peca de regularizacao fundiaria/edilicia.
//   - As fotos do Relatorio Fotografico ja carregam overlay tecnico
//     georreferenciado (SIRGAS 2000 / UTM), servindo de evidencia da situacao
//     real existente.
//
// Boot-safe: pool e rasterizadores nativos (sharp / node-canvas) importados de
// forma LAZY. Nenhuma falha de anexo derruba a geracao do PDF — sempre degrada
// para null e o laudoPdf.ts cai no croqui vetorial nativo (poligono PDFKit).
//
// Funcoes puras (montarNotaAsBuilt, legendaTecnicaFoto, escolherCanvasCroqui,
// parseDataUri, normalizarFotosRelatorio) sao testadas sem DB nem binarios.

import type { RowDataPacket } from 'mysql2';
import { gerarPranchaSVG } from './canvasService';

// ── Tipos ────────────────────────────────────────────────────────────────
export interface FotoAnexo {
  base64: string; // base64 PURO (sem prefixo data:)
  mime: string;
  legenda: string;
}

export interface CroquiCanvasInfo {
  titulo: string | null;
  escala: string | null;
  tipo: string | null;
}

export interface LaudoAnexos {
  croquiCanvasPng: Buffer | null;
  croquiCanvasInfo: CroquiCanvasInfo | null;
  fotosRelatorio: FotoAnexo[];
}

export interface CanvasGraficoRow {
  id: number;
  tipo: string | null;
  titulo: string | null;
  dados_svg: string | null;
  largura_virtual: number | null;
  altura_virtual: number | null;
  escala_grafica: string | null;
}

export interface FotoVistoriaRow {
  base64_overlay: string | null;
  descricao: string | null;
  municipio: string | null;
  logradouro: string | null;
  utm_zona: string | null;
  utm_e: number | string | null;
  utm_n: number | string | null;
  datum: string | null;
  colaborador: string | null;
  ordem: number | null;
}

// ── Texto As-Built / regularizacao (puro) ──────────────────────────────────
// Citacoes: NBR 13133 (levantamento topografico), NBR 14653 (avaliacao quando
// vinculada), NTGIR/INCRA (georreferenciamento). Linguagem formal BR.
export function montarNotaAsBuilt(opts?: { temCroqui?: boolean; temFotos?: boolean }): string {
  const temCroqui = opts?.temCroqui !== false;
  const temFotos = opts?.temFotos !== false;
  const partes: string[] = [];
  partes.push(
    'O presente registro tem natureza AS-BUILT (representacao do imovel conforme '
    + 'efetivamente levantado em campo), destinando-se a instruir processo de '
    + 'regularizacao fundiaria e/ou edilicia.',
  );
  if (temCroqui) {
    partes.push(
      'O croqui tecnico foi elaborado a partir da poligonal materializada em '
      + 'campo, em conformidade com a NBR 13133 (Execucao de Levantamento '
      + 'Topografico) e com a sistematica de georreferenciamento do INCRA (NTGIR), '
      + 'referenciado ao SIRGAS 2000.',
    );
  }
  if (temFotos) {
    partes.push(
      'Os registros fotograficos integram a caracterizacao do estado existente, '
      + 'com sobreposicao de metadados georreferenciados (coordenadas UTM / SIRGAS '
      + '2000, data e responsavel pela captura), constituindo evidencia da situacao '
      + 'real apurada na vistoria.',
    );
  }
  return partes.join(' ');
}

// ── Legenda tecnica de foto (puro) ─────────────────────────────────────────
export function legendaTecnicaFoto(f: FotoVistoriaRow, indice?: number): string {
  const base = (f.descricao && String(f.descricao).trim())
    || (indice != null ? `Registro fotografico ${indice}` : 'Registro fotografico');
  const local: string[] = [];
  if (f.logradouro && String(f.logradouro).trim()) local.push(String(f.logradouro).trim());
  if (f.municipio && String(f.municipio).trim()) local.push(String(f.municipio).trim());

  const geo: string[] = [];
  const e = f.utm_e != null ? Number(f.utm_e) : null;
  const n = f.utm_n != null ? Number(f.utm_n) : null;
  if (e != null && Number.isFinite(e) && n != null && Number.isFinite(n)) {
    const zona = f.utm_zona ? ` ${String(f.utm_zona).trim()}` : '';
    geo.push(`UTM${zona}: E ${Math.round(e).toLocaleString('pt-BR')} / N ${Math.round(n).toLocaleString('pt-BR')}`);
  }
  if (f.datum && String(f.datum).trim()) geo.push(String(f.datum).trim());

  let txt = base;
  if (local.length) txt += ` — ${local.join('/')}`;
  if (geo.length) txt += ` (${geo.join(' · ')})`;
  return txt;
}

// ── Escolha do canvas-croqui do laudo (puro) ────────────────────────────────
// Prioridade: tipo='croqui' > 'quadra' > qualquer outro com dados_svg; entre
// iguais, o de maior id (mais recente — assume-se array ja ordenado DESC ou
// resolve aqui por id).
export function escolherCanvasCroqui(rows: CanvasGraficoRow[]): CanvasGraficoRow | null {
  const comSvg = rows.filter(r => r.dados_svg && String(r.dados_svg).trim());
  if (!comSvg.length) return null;
  const rank = (t: string | null): number => {
    const tipo = (t || '').toLowerCase();
    if (tipo === 'croqui') return 3;
    if (tipo === 'quadra') return 2;
    return 1;
  };
  return [...comSvg].sort((a, b) => {
    const r = rank(b.tipo) - rank(a.tipo);
    return r !== 0 ? r : (b.id - a.id);
  })[0];
}

// ── Parse de data URI -> {mime, base64 puro} (puro) ─────────────────────────
export function parseDataUri(s: string | null | undefined): { mime: string; base64: string } | null {
  if (!s || typeof s !== 'string') return null;
  const str = s.trim();
  if (!str) return null;
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(str);
  if (m) return { mime: m[1], base64: m[2] };
  // base64 cru sem prefixo: assume jpeg (padrao do overlayService)
  if (/^[A-Za-z0-9+/=\s]+$/.test(str) && str.length > 32) {
    return { mime: 'image/jpeg', base64: str.replace(/\s+/g, '') };
  }
  return null;
}

// ── Normaliza fotos do relatorio -> FotoAnexo[] (puro) ──────────────────────
export function normalizarFotosRelatorio(rows: FotoVistoriaRow[]): FotoAnexo[] {
  const out: FotoAnexo[] = [];
  rows.forEach((f, i) => {
    const parsed = parseDataUri(f.base64_overlay);
    if (!parsed || !parsed.mime.startsWith('image/')) return;
    out.push({ base64: parsed.base64, mime: parsed.mime, legenda: legendaTecnicaFoto(f, i + 1) });
  });
  return out;
}

// ── Rasterizacao SVG -> PNG (lazy nativo, degrada p/ null) ───────────────────
// Tenta sharp (optionalDependency) e depois node-canvas (dep dura usada pelo
// overlayService). Em ambiente sem binario nativo retorna null sem lancar.
export async function rasterizarSvg(svg: string, larguraPx = 1600): Promise<Buffer | null> {
  if (!svg || !svg.trim()) return null;
  const buf = Buffer.from(svg, 'utf8');
  // 1) sharp
  try {
    const mod = await import('sharp');
    const sharp = (mod as { default?: unknown }).default ?? mod;
    const png = await (sharp as (b: Buffer) => {
      resize(w: number): { png(): { toBuffer(): Promise<Buffer> } };
    })(buf).resize(larguraPx).png().toBuffer();
    if (png && png.length) return png;
  } catch { /* tenta node-canvas */ }
  // 2) node-canvas
  try {
    const cv = await import('canvas') as unknown as {
      loadImage: (src: Buffer) => Promise<{ width: number; height: number }>;
      createCanvas: (w: number, h: number) => {
        getContext(t: '2d'): { drawImage(img: unknown, x: number, y: number, w: number, h: number): void };
        toBuffer(mime: 'image/png'): Buffer;
      };
    };
    const img = await cv.loadImage(buf);
    const ratio = img.height && img.width ? img.height / img.width : 0.62;
    const w = larguraPx;
    const h = Math.max(1, Math.round(w * ratio));
    const canvas = cv.createCanvas(w, h);
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const png = canvas.toBuffer('image/png');
    if (png && png.length) return png;
  } catch { /* sem rasterizador disponivel */ }
  return null;
}

// ── Loaders (DB, lazy) ──────────────────────────────────────────────────────
async function getPool() {
  const m = await import('../database/connection');
  return m.default;
}

// Carrega o croqui do Canvas (Modulo A) vinculado ao laudo. Prefere a prancha
// tecnica ja salva (svg_final com carimbo); senao gera on-the-fly do dados_svg.
export async function carregarCroquiCanvasLaudo(
  laudoId: number | string,
): Promise<{ svg: string; info: CroquiCanvasInfo } | null> {
  try {
    const pool = await getPool();
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, tipo, titulo, dados_svg, largura_virtual, altura_virtual, escala_grafica
         FROM canvas_graficos WHERE laudo_id = ? ORDER BY id DESC`,
      [laudoId],
    );
    const escolhido = escolherCanvasCroqui(rows as unknown as CanvasGraficoRow[]);
    if (!escolhido) return null;

    const info: CroquiCanvasInfo = {
      titulo: escolhido.titulo ?? null,
      escala: escolhido.escala_grafica ?? null,
      tipo: escolhido.tipo ?? null,
    };

    // Prancha tecnica ja renderizada (carimbo Romatec)?
    const [pranchas] = await pool.execute<RowDataPacket[]>(
      'SELECT svg_final FROM pranchas_tecnicas WHERE canvas_id = ? ORDER BY id DESC LIMIT 1',
      [escolhido.id],
    );
    const svgPronto = pranchas.length ? String((pranchas[0] as { svg_final?: string }).svg_final || '') : '';
    if (svgPronto.trim()) return { svg: svgPronto, info };

    // Fallback: gera prancha do conteudo bruto.
    const svg = gerarPranchaSVG({
      tituloObra: escolhido.titulo ?? undefined,
      escala: escolhido.escala_grafica ?? undefined,
      conteudoSvg: escolhido.dados_svg ?? '',
      larguraVirtual: escolhido.largura_virtual ?? undefined,
      alturaVirtual: escolhido.altura_virtual ?? undefined,
    });
    return { svg, info };
  } catch {
    return null;
  }
}

// Carrega fotos dos relatorios fotograficos (Modulo B) vinculados ao laudo.
export async function carregarFotosRelatorioLaudo(laudoId: number | string): Promise<FotoAnexo[]> {
  try {
    const pool = await getPool();
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT fv.base64_overlay, fv.descricao, fv.municipio, fv.logradouro, fv.utm_zona,
              fv.utm_e, fv.utm_n, fv.datum, fv.colaborador, fv.ordem
         FROM fotos_vistoria fv
         JOIN relatorios_fotograficos rf ON rf.id = fv.relatorio_id
        WHERE rf.laudo_id = ?
        ORDER BY rf.id, fv.ordem, fv.id`,
      [laudoId],
    );
    return normalizarFotosRelatorio(rows as unknown as FotoVistoriaRow[]);
  } catch {
    return [];
  }
}

// Orquestrador: tudo que o laudoPdf.ts precisa para as secoes 10 e 11.
export async function carregarAnexosLaudo(laudoId: number | string): Promise<LaudoAnexos> {
  const [croqui, fotosRelatorio] = await Promise.all([
    carregarCroquiCanvasLaudo(laudoId),
    carregarFotosRelatorioLaudo(laudoId),
  ]);
  let croquiCanvasPng: Buffer | null = null;
  if (croqui?.svg) croquiCanvasPng = await rasterizarSvg(croqui.svg, 1600);
  return {
    croquiCanvasPng,
    croquiCanvasInfo: croqui?.info ?? null,
    fotosRelatorio,
  };
}
