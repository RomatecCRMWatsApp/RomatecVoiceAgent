// v3.35.0: parser heuristico de PDFs Revit (plantas) — extrai metadados +
// tabelas tecnicas + deteccao de "Produto Inexistente".
//
// pdf-parse ja esta em deps do projeto (v2.4.5). Import e' direto.
// Standalone — sem deps de mysql/express.

import type { PdfExtractionResult, TabelaExtraida, ProdutoInexistente } from './types';

// O wrapper aceita Buffer (servidor) ou string (testes diretos).
async function lerTextoPdf(input: Buffer | string): Promise<string> {
  if (typeof input === 'string') return input;
  // Lazy import para evitar custo no boot e permitir teste sem pdf real
  const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
  const mod = await dynamicImport('pdf-parse') as { default: (b: Buffer) => Promise<{ text: string }> };
  const r = await mod.default(input);
  return r.text || '';
}

// Heuristica de metadados — padrao Revit do José Romário (vide PH-03/PS-04/PE-05/PA-02)
export function extrairMetadados(text: string): PdfExtractionResult['metadados'] {
  const result: PdfExtractionResult['metadados'] = {};

  // PROPRIETARIO
  const propMatch = text.match(/PROPRIET[ÁA]RIO[:\s]+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-záéíóúâêôãõç\s]+)/);
  if (propMatch) {
    result.proprietario = propMatch[1].trim().replace(/\s+/g, ' ');
  }

  // CPF
  const cpfMatch = text.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
  if (cpfMatch) result.cpf_cnpj = cpfMatch[1];
  // CNPJ (fallback)
  if (!result.cpf_cnpj) {
    const cnpjMatch = text.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
    if (cnpjMatch) result.cpf_cnpj = cnpjMatch[1];
  }

  // Area construida
  const areaConstrMatch = text.match(/[ÁA]REA\s+(?:DA\s+)?CONSTRUC[ÃA]O[:\s]+([\d.,]+)/i)
    || text.match(/[ÁA]REA\s+CONSTRU[ÍI]DA[:\s]+([\d.,]+)/i);
  if (areaConstrMatch) {
    const n = parseFloat(areaConstrMatch[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n) && n > 0) result.area_construida_m2 = n;
  }

  // Area do lote
  const areaLoteMatch = text.match(/[ÁA]REA\s+(?:DO\s+)?LOTE[:\s]+([\d.,]+)/i);
  if (areaLoteMatch) {
    const n = parseFloat(areaLoteMatch[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n) && n > 0) result.area_lote_m2 = n;
  }

  // Taxa de ocupacao
  const txMatch = text.match(/TAXA\s+DE\s+OCUPAC[ÃA]O[:\s]+([\d.,]+)\s*%/i);
  if (txMatch) {
    const n = parseFloat(txMatch[1].replace(',', '.'));
    if (Number.isFinite(n)) result.taxa_ocupacao_pct = n;
  }

  // Numero de pavimentos
  const pavMatch = text.match(/N[ºO°]?\s*(?:DE\s+)?PAVIMENTOS?[:\s]+(\d+)/i);
  if (pavMatch) result.num_pavimentos = parseInt(pavMatch[1], 10);

  // Prancha (PH-03, PS-04, PE-05, PA-02, PR-01)
  const pranchaMatch = text.match(/N[ºO°]?\s*FOLHA[:\s]+(P[HSEARI]-?\d{2,3})/i)
    || text.match(/\b(P[HSEARI]-\d{2,3})\b/);
  if (pranchaMatch) {
    result.prancha_codigo = pranchaMatch[1].toUpperCase().replace(/^(P[HSEARI])(\d)/, '$1-$2');
  }

  // Quadra / Lote
  const qdMatch = text.match(/QUADRA\s+(\w+).*?LOTE\s+(\w+)/i);
  if (qdMatch) {
    result.quadra = qdMatch[1];
    result.lote = qdMatch[2];
  }

  // Municipio / UF
  const ufMatch = text.match(/\b([A-ZÁÉÍÓÚÇ][a-záéíóúç]+(?:\s+[A-ZÁÉÍÓÚÇa-záéíóúç]+)?)\s*[-,/]\s*(MA|PA|MT|GO|MG|SP|RJ|ES|BA|PE|PB|CE|RN|AL|SE|TO|PI|AP|AC|AM|RO|RR|DF|RS|SC|PR|MS)\b/);
  if (ufMatch) {
    result.municipio = ufMatch[1].trim();
    result.uf = ufMatch[2];
  }

  return result;
}

// Heuristica de tabelas: padrao "Tabela X.X - Titulo" seguido de
// linhas com 2+ colunas separadas por 2+ espacos.
export function extrairTabelas(text: string): TabelaExtraida[] {
  const linhas = text.split('\n').map((l) => l.trim());
  const tabelas: TabelaExtraida[] = [];

  for (let i = 0; i < linhas.length; i++) {
    const m =
      linhas[i].match(/^(?:\d+\.\d+\s+)?TABELA\s*[-–—:]\s*(.+)/i) ||
      linhas[i].match(/^Tabela\s+\d+\.\d+\s*[-–—:]?\s*(.+)/i);
    if (!m) continue;

    const titulo = m[1].trim();
    // procura proxima linha nao-vazia = cabecalho
    let cabIdx = i + 1;
    while (cabIdx < linhas.length && linhas[cabIdx].length === 0) cabIdx++;
    const cabecalho = (linhas[cabIdx] || '').split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    if (cabecalho.length < 2) continue;

    const linhasTabela: string[][] = [];
    for (let j = cabIdx + 1; j < linhas.length; j++) {
      const cols = linhas[j].split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
      if (cols.length === 0) break;
      if (cols.length === 1 && cols[0].length > 80) break;
      if (/^TABELA|^Tabela|^SUBTOTAL|^TOTAL/i.test(linhas[j])) break;
      linhasTabela.push(cols);
    }

    tabelas.push({
      titulo,
      cabecalho,
      linhas: linhasTabela,
      num_linhas: linhasTabela.length,
    });
  }

  return tabelas;
}

// Deteccao de "Produto Inexistente" — comum em PDFs Revit por famílias custom sem schedule.
export function detectarProdutoInexistente(text: string): ProdutoInexistente[] {
  const matches: ProdutoInexistente[] = [];
  // Padrao: "Produto Inexistente" + (qualquer texto até 200 chars) + numero + "un|peças|pç"
  const regex = /Produto\s+Inexistente[\s\S]{0,200}?(\d+)\s*(?:un|unid|pe[çc]as?|p[çc])/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    matches.push({
      contexto: text.substring(Math.max(0, m.index - 100), Math.min(text.length, m.index + 200)),
      quantidade: parseInt(m[1], 10),
    });
  }
  return matches;
}

// Confianca da extracao (0-1) — soma de pontos por padroes detectados.
export function calcularConfianca(text: string): number {
  let score = 0;
  if (/PROPRIET[ÁA]RIO/i.test(text)) score += 0.2;
  if (/[ÁA]REA\s+(?:DA\s+)?CONSTRU[CÍ]/i.test(text)) score += 0.2;
  if (/QUADRA[\s\S]{0,80}LOTE/i.test(text)) score += 0.1;
  if (/TABELA/i.test(text)) score += 0.2;
  if (/TIGRE|STECK|PIAL|TRAMONTINA/i.test(text)) score += 0.1;
  if (/NBR\s*\d{4}/i.test(text)) score += 0.1;
  if (/P[HSEARI]-?\d{2,3}/i.test(text)) score += 0.1;
  return Math.min(round2(score), 1.0);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// API publica — parser principal.
export async function parsePlantaPdf(input: Buffer | string): Promise<PdfExtractionResult> {
  const rawText = await lerTextoPdf(input);
  return {
    rawText,
    metadados: extrairMetadados(rawText),
    tabelas: extrairTabelas(rawText),
    produtos_inexistentes: detectarProdutoInexistente(rawText),
    observacoes_extracao: [],
    confianca: calcularConfianca(rawText),
  };
}
