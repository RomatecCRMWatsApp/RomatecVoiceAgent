// v3.188.0 — Capa padrão do DOSSIÊ TÉCNICO DO LOTE DE PRODUÇÃO (modelo aprovado em 18/11/2026,
// Capa_Dossie_LT-05_Salete_Moreno_Romatec.pdf). Mesmas posições, cores e textos do gerador de
// referência (tools/pa-docs/capa_dossie_lote.py, ReportLab), aqui em HTML → PDF (puppeteer), com a
// Liberation Sans embutida (o servidor não tem a fonte instalada) e as artes em src/public/brand/pa.
// Coordenadas em pt (A4 595,28 × 841,89), medidas do topo; texto posicionado pela linha de base.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { haParaAlqueires } from './unidades';

export interface DadosCapa {
  lote: string;            // "LT-05"
  associado: string;
  numero: string;          // "PASM-014"
  lote_vila?: string | null;
  denominacao?: string | null;
  area_ha?: number | null;
  municipio?: string | null;
  associacao?: string | null;
  emissao?: string | null; // aaaa-mm-dd (padrão: hoje)
  subtitulo?: string | null;
  legenda_foto?: string | null;
  local?: string | null;
}
export const ASSOCIACAO_PADRAO = 'Associação dos Produtores Rurais do PA Salete Moreno';
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const br4 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export function dataExtensoCurta(iso: string | null | undefined, agora = new Date()): string {
  const d = iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const [a, m, dia] = d.split('-').map(Number);
  return `${dia} de ${MESES[m - 1]} de ${a}`;
}
/** Linhas do quadro de identificação (pura — testável). */
export function linhasCapa(L: DadosCapa): Array<[string, string]> {
  const area = Number(L.area_ha) || 0;
  return [
    ['Associado(a)', L.associado.toUpperCase()],
    ['Nº do associado', `${L.numero ?? ''}${L.lote_vila ? ` · lote da vila ${L.lote_vila}` : ''}`],
    ['Denominação', L.denominacao ? `“${L.denominacao}”` : '—'],
    ['Área', area ? `${br4(area)} ha · ${br4(haParaAlqueires(area))} alqueires` : 'a definir após o georreferenciamento'],
    ['Município', L.municipio || 'Açailândia/MA'],
    ['Associação', L.associacao || ASSOCIACAO_PADRAO],
    ['Emissão', dataExtensoCurta(L.emissao)],
  ];
}
export function nomeArquivoCapa(L: Pick<DadosCapa, 'lote' | 'associado'>): string {
  const titulo = L.associado.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  const slug = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `Capa_Dossie_${L.lote}_${slug}_Salete_Moreno_Romatec.pdf`;
}

const cache = new Map<string, string>();
function dataUri(rel: string, mime: string): string {
  const k = rel;
  if (cache.has(k)) return cache.get(k)!;
  const f = [path.resolve(__dirname, '../../public', rel), path.resolve(process.cwd(), 'src/public', rel), path.resolve(process.cwd(), 'dist/public', rel)].find((c) => existsSync(c));
  const v = f ? `data:${mime};base64,${readFileSync(f).toString('base64')}` : '';
  cache.set(k, v);
  return v;
}

export function htmlCapaDossie(L: DadosCapa): string {
  const W = 595.28, H = 841.89, M = 45.354;
  const fR = dataUri('fonts/LiberationSans-Regular.ttf', 'font/ttf'), fB = dataUri('fonts/LiberationSans-Bold.ttf', 'font/ttf');
  const logo = dataUri('brand/pa/logo_romatec_branco.png', 'image/png');
  const bras = dataUri('brand/pa/capa_brasao_salete_moreno.png', 'image/png');
  const foto = dataUri('brand/pa/capa_vista_aerea_salete_moreno.jpg', 'image/jpeg');
  // Liberation Sans: ascendente 0,905 em, descendente 0,212 em; com line-height:1 o meio-entrelinhamento
  // (−0,0585 em) sobe a linha de base → topo da caixa = base − 0,8465 em.
  const ASC = 0.8465;
  // texto pela linha de base: top = base − ascendente
  const t = (x: number, base: number, size: number, cor: string, txt: string, o: { bold?: boolean; track?: number; right?: boolean } = {}) =>
    `<div style="position:absolute;${o.right ? `right:${(W - x).toFixed(2)}pt;text-align:right` : `left:${x.toFixed(2)}pt`};top:${(base - size * ASC).toFixed(2)}pt;font-size:${size}pt;line-height:1;color:${cor};font-weight:${o.bold ? 700 : 400};white-space:nowrap;${o.track ? `letter-spacing:${o.track}pt;` : ''}">${esc(txt)}</div>`;
  const GOLD = '#D1B767', CREAM = '#F4F0E3', SOFT = '#DCE5DD', FOOT = '#C9D3CC';
  const linhas = linhasCapa(L).map(([k, v], i) => t(58.11, 541.25 + i * 12.42, 9.4, GOLD, k, { bold: true }) + t(162.99, 541.25 + i * 12.42, 9.4, CREAM, v)).join('');
  const rodape = ['J R P BEZERRA LTDA · CNPJ 17.261.987/0001-09', 'Rua São Raimundo, nº 10, Centro · Açailândia/MA · CEP 65.930-000',
    'Responsável técnico: José Romário Pinto Bezerra · Técnico em Agrimensura', 'CFT 01209185369 · INCRA FQNS',
    '(99) 99181-1246 · contato@consultoriaromatec.com.br · consultoriaromatec.com.br'].map((x, i) => t(M, 773.9 + i * 7.99, 7.5, FOOT, x)).join('');
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Capa – Dossiê técnico do lote ${esc(L.lote)}</title><style>
    ${fR ? `@font-face{font-family:'LS';src:url(${fR}) format('truetype');font-weight:400}` : ''}
    ${fB ? `@font-face{font-family:'LS';src:url(${fB}) format('truetype');font-weight:700}` : ''}
    @page{size:${W}pt ${H}pt;margin:0}*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    html,body{width:${W}pt;height:${H}pt;overflow:hidden}
    body{position:relative;font-family:'LS','Liberation Sans',Arial,sans-serif;background:#103E2B}
  </style></head><body>
    <div style="position:absolute;left:0;top:0;width:${W}pt;height:200pt;background:linear-gradient(to bottom,#476950 7.2pt,#103E2B 200pt)"></div>
    <div style="position:absolute;left:0;top:0;width:${W}pt;height:7.2pt;background:${GOLD}"></div>
    <div style="position:absolute;left:0;bottom:0;width:${W}pt;height:${(H - 834.15).toFixed(2)}pt;background:${GOLD}"></div>
    ${logo ? `<img src="${logo}" style="position:absolute;left:${M}pt;top:51.7pt;width:216pt;height:72pt">` : ''}
    ${bras ? `<img src="${bras}" style="position:absolute;left:464.85pt;top:36.45pt;width:85.04pt;height:99.9pt">` : ''}
    ${t(M, 157.0, 9.2, GOLD, 'DOSSIÊ TÉCNICO DO LOTE DE PRODUÇÃO', { track: 1.42 })}
    ${t(M, 183.6, 31.3, CREAM, `LOTE ${L.lote}`, { bold: true })}
    ${t(M, 196.5, 12.3, SOFT, L.subtitulo || 'Projeto de Assentamento Salete Moreno')}
    ${foto ? `<div style="position:absolute;left:${M}pt;top:210.5pt;width:${(W - 2 * M).toFixed(2)}pt;height:283.8pt;overflow:hidden"><img src="${foto}" style="width:100%;height:100%;object-fit:cover;display:block"></div>` : ''}
    ${t(M, 506.0, 7.3, '#E6E9E4', L.legenda_foto || 'Vista aérea do Projeto de Assentamento Salete Moreno')}
    ${t(W - M, 506.0, 7.3, GOLD, L.local || 'AÇAILÂNDIA / MA', { right: true })}
    <div style="position:absolute;left:${M}pt;top:522.4pt;width:${(W - 2 * M).toFixed(2)}pt;height:103.6pt;background:#194B36;border:.6pt solid rgba(209,183,103,.55);border-radius:6pt"></div>
    ${linhas}
    <div style="position:absolute;left:${M}pt;top:748.05pt;width:${(W - 2 * M).toFixed(2)}pt;height:0;border-top:.5pt solid rgba(209,183,103,.7)"></div>
    ${t(M, 764.6, 9.2, GOLD, 'ROMATEC CONSULTORIA TOTAL', { bold: true })}
    ${rodape}
  </body></html>`;
}

export async function pdfCapaDossie(L: DadosCapa): Promise<Buffer> {
  const { htmlToPdf } = await import('../../pdf/htmlToPdf');
  return htmlToPdf(htmlCapaDossie(L), { width: '595.28pt', height: '841.89pt', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' }, preferCSSPageSize: true });
}
