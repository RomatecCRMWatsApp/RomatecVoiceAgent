// src/services/cartoriosImporter.ts
//
// v3.2.0: importacao do catalogo nacional de cartorios do CNJ.
//
// Entrada: data/cartorios-cns.csv (formato CNJ — UTF-8, virgula como sep,
// campos com aspas duplas quando ha virgula interna). Schema:
// CNS, Dat. Instalacao, Denominacao, Tipo, Atribuicoes, Status,
// Situacao juridica da serventia, Data decisao, UF, Cidade, E-mail contato,
// Dat. ingresso responsavel, Responsavel, Substituto.
//
// Saida: registros UPSERTed na tabela `cartorios`. Apenas linhas cuja
// coluna "Atribuicoes" contenha "Registro de Imoveis" sao consideradas
// (o CSV pode vir filtrado ou nao — filtramos por seguranca).
//
// Usa batch UPSERT de 500 linhas/vez via INSERT ... ON DUPLICATE KEY UPDATE
// (chave natural: cns sem pontuacao).

import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import pool from '../database/connection';

/** Linha do CSV crua (campos opcionais ja podem vir como string vazia). */
interface CsvRow {
  CNS?: string;
  'Denominação'?: string;
  Denominacao?: string;
  Tipo?: string;
  'Atribuições'?: string;
  Atribuicoes?: string;
  Status?: string;
  'Situação jurídica da serventia'?: string;
  UF?: string;
  Cidade?: string;
  'E-mail contato'?: string;
  'Responsável'?: string;
  Responsavel?: string;
}

/** Cartorio normalizado pronto para o banco. */
export interface CartorioRow {
  cns: string;            // so digitos, ex: '000075'
  cns_formatado: string;  // com pontuacao, ex: '00.007-5'
  denominacao: string;
  uf: string;
  cidade: string;
  cidade_normalizada: string;
  responsavel: string | null;
  email: string | null;
  status: string | null;
  situacao_juridica: string | null;
}

export interface ImportResult {
  totalCsv: number;
  filtrados: number;     // apos filtro "Registro de Imoveis"
  invalidos: number;     // sem CNS/UF/Cidade/Denominacao
  upserted: number;      // linhas afetadas (INSERTs + UPDATEs)
  duracaoMs: number;
  exemplos: CartorioRow[]; // primeiros 3 pra sanity check no response
}

/** Normaliza cidade para busca (sem acento, minusculo, espacos colapsados). */
export function normalizarCidade(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Detecta se o registro contem atribuicao de Registro de Imoveis. */
export function temAtribuicaoRegistroImoveis(atribuicoes: string): boolean {
  // CSV usa "Registro de Imóveis" (com acento). Comparacao case-insensitive
  // e tolerante a acentos cobre variacoes.
  return /registro de im[oó]veis/i.test(atribuicoes);
}

/** Parseia o texto do CSV, filtra cartorios de Registro de Imoveis e normaliza. */
export function parseCsvToCartorios(csvText: string): {
  rows: CartorioRow[];
  totalCsv: number;
  invalidos: number;
} {
  const parsed = Papa.parse<CsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  });
  const totalCsv = parsed.data.length;
  const rows: CartorioRow[] = [];
  let invalidos = 0;

  for (const r of parsed.data) {
    const atribuicoes = (r['Atribuições'] ?? r.Atribuicoes ?? '').toString();
    if (!temAtribuicaoRegistroImoveis(atribuicoes)) continue;

    const cnsFormatado = (r.CNS ?? '').trim();
    const denominacao = (r['Denominação'] ?? r.Denominacao ?? '').trim();
    const uf = (r.UF ?? '').trim().toUpperCase();
    const cidade = (r.Cidade ?? '').trim();
    if (!cnsFormatado || !denominacao || !uf || !cidade) { invalidos++; continue; }
    if (uf.length !== 2) { invalidos++; continue; }

    const cns = cnsFormatado.replace(/\D/g, '');
    if (!cns) { invalidos++; continue; }

    const responsavel = (r['Responsável'] ?? r.Responsavel ?? '').trim();
    const email = (r['E-mail contato'] ?? '').trim();
    const status = (r.Status ?? '').trim();
    const situacao = (r['Situação jurídica da serventia'] ?? '').trim();

    rows.push({
      cns,
      cns_formatado: cnsFormatado,
      denominacao: denominacao.slice(0, 500),
      uf,
      cidade: cidade.slice(0, 120),
      cidade_normalizada: normalizarCidade(cidade).slice(0, 120),
      responsavel: responsavel ? responsavel.slice(0, 200) : null,
      email: email ? email.slice(0, 200) : null,
      status: status ? status.slice(0, 40) : null,
      situacao_juridica: situacao ? situacao.slice(0, 60) : null,
    });
  }

  return { rows, totalCsv, invalidos };
}

const BATCH_SIZE = 500;

/** Faz UPSERT de um batch via INSERT ON DUPLICATE KEY UPDATE. */
async function upsertBatch(rows: CartorioRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const placeholders = rows.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
  const values: Array<string | null> = [];
  for (const r of rows) {
    values.push(r.cns, r.cns_formatado, r.denominacao, r.uf, r.cidade,
      r.cidade_normalizada, r.responsavel, r.email, r.status, r.situacao_juridica);
  }
  const sql =
    `INSERT INTO cartorios
      (cns, cns_formatado, denominacao, uf, cidade, cidade_normalizada,
       responsavel, email, status, situacao_juridica)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       cns_formatado=VALUES(cns_formatado),
       denominacao=VALUES(denominacao),
       uf=VALUES(uf),
       cidade=VALUES(cidade),
       cidade_normalizada=VALUES(cidade_normalizada),
       responsavel=VALUES(responsavel),
       email=VALUES(email),
       status=VALUES(status),
       situacao_juridica=VALUES(situacao_juridica)`;
  const [result] = await pool.execute(sql, values);
  // mysql2: para INSERT...ON DUPLICATE KEY, affectedRows = inserted + 2*updated.
  // Aproximamos como rows.length (qtd que tentamos UPSERT).
  return (result as { affectedRows?: number }).affectedRows ?? rows.length;
}

/** Le o CSV, parseia, filtra e faz UPSERT em batches. Lanca se nao houver arquivo. */
export async function importarCartoriosFromFile(
  csvPath = path.join(process.cwd(), 'data', 'cartorios-cns.csv'),
): Promise<ImportResult> {
  const inicio = Date.now();
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV nao encontrado em ${csvPath}`);
  }
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const { rows, totalCsv, invalidos } = parseCsvToCartorios(csvText);

  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    upserted += await upsertBatch(rows.slice(i, i + BATCH_SIZE));
  }

  return {
    totalCsv,
    filtrados: rows.length,
    invalidos,
    upserted,
    duracaoMs: Date.now() - inicio,
    exemplos: rows.slice(0, 3),
  };
}
