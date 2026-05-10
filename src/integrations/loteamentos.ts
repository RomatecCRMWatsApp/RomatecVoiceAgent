// v2.8.0 — Modulo de Loteamentos / Auto-preenchimento de Laudo.
//
// CRUD basico + importer CSV/XLSX em 2 passadas:
//   1) cria loteamento, ruas, quadras, lotes (confrontantes salvos como texto)
//   2) resolve FKs `LOTE:Quadra/Numero` agora que todos os lotes existem
//
// Convencao de confrontante no CSV/XLSX:
//   - Texto livre → fica em conf_*_texto, conf_*_lote_id permanece NULL
//   - "LOTE:Q. 02/03" → resolve para conf_*_lote_id (FK), conf_*_texto fica NULL

import pool from '../database/connection';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

// ──────────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────────

export type OrigemDado = 'manual' | 'csv' | 'xlsx' | 'dwg';

export interface Loteamento {
  id: number;
  nome: string;
  municipio: string | null;
  uf: string | null;
  arquivo_planta_pdf: string | null;
  arquivo_dwg_original: string | null;
  sistema_coordenadas: string | null;
  observacoes: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoteamentoRua {
  id: number;
  loteamento_id: number;
  nome: string;
}

export interface LoteamentoQuadra {
  id: number;
  loteamento_id: number;
  nome: string;
}

export interface LoteamentoLote {
  id: number;
  quadra_id: number;
  numero_lote: string;
  rua_frente_id: number | null;
  conf_frente_lote_id: number | null;
  conf_frente_texto: string | null;
  conf_fundo_lote_id: number | null;
  conf_fundo_texto: string | null;
  conf_lateral_dir_lote_id: number | null;
  conf_lateral_dir_texto: string | null;
  conf_lateral_esq_lote_id: number | null;
  conf_lateral_esq_texto: string | null;
  medida_frente_m: number | null;
  medida_fundo_m: number | null;
  medida_lateral_dir_m: number | null;
  medida_lateral_esq_m: number | null;
  area_m2: number | null;
  area_calculada_m2: number | null;
  numero_lados: number | null;
  vertices_geojson: string | null;
  origem_dado: OrigemDado;
  observacoes: string | null;
}

export interface ConfiguracoesDemarcacao {
  id: number;
  tolerancia_medida_cm: number;
  updated_at: string;
}

const asNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const asStr = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

// ──────────────────────────────────────────────────────────────────────────────
// CRUD de leitura
// ──────────────────────────────────────────────────────────────────────────────

export async function listarLoteamentos(): Promise<Loteamento[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM loteamentos WHERE ativo = TRUE ORDER BY nome'
  );
  return rows.map(r => ({
    id: Number(r.id),
    nome: r.nome,
    municipio: r.municipio ?? null,
    uf: r.uf ?? null,
    arquivo_planta_pdf: r.arquivo_planta_pdf ?? null,
    arquivo_dwg_original: r.arquivo_dwg_original ?? null,
    sistema_coordenadas: r.sistema_coordenadas ?? null,
    observacoes: r.observacoes ?? null,
    ativo: r.ativo === 1 || r.ativo === true,
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  }));
}

export async function buscarLoteamento(id: number | string): Promise<Loteamento | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM loteamentos WHERE id = ?', [Number(id)]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    nome: r.nome,
    municipio: r.municipio ?? null,
    uf: r.uf ?? null,
    arquivo_planta_pdf: r.arquivo_planta_pdf ?? null,
    arquivo_dwg_original: r.arquivo_dwg_original ?? null,
    sistema_coordenadas: r.sistema_coordenadas ?? null,
    observacoes: r.observacoes ?? null,
    ativo: r.ativo === 1 || r.ativo === true,
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
  };
}

export async function listarQuadras(loteamentoId: number | string): Promise<LoteamentoQuadra[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, loteamento_id, nome FROM loteamento_quadras WHERE loteamento_id = ? ORDER BY nome',
    [Number(loteamentoId)]
  );
  return rows.map(r => ({ id: Number(r.id), loteamento_id: Number(r.loteamento_id), nome: r.nome }));
}

export async function listarLotesPorQuadra(quadraId: number | string): Promise<LoteamentoLote[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM loteamento_lotes WHERE quadra_id = ? ORDER BY numero_lote',
    [Number(quadraId)]
  );
  return rows.map(rowToLote);
}

export async function buscarLote(id: number | string): Promise<LoteamentoLote | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM loteamento_lotes WHERE id = ?', [Number(id)]
  );
  return rows.length ? rowToLote(rows[0]) : null;
}

function rowToLote(r: RowDataPacket): LoteamentoLote {
  return {
    id: Number(r.id),
    quadra_id: Number(r.quadra_id),
    numero_lote: r.numero_lote,
    rua_frente_id: r.rua_frente_id != null ? Number(r.rua_frente_id) : null,
    conf_frente_lote_id: r.conf_frente_lote_id != null ? Number(r.conf_frente_lote_id) : null,
    conf_frente_texto: r.conf_frente_texto ?? null,
    conf_fundo_lote_id: r.conf_fundo_lote_id != null ? Number(r.conf_fundo_lote_id) : null,
    conf_fundo_texto: r.conf_fundo_texto ?? null,
    conf_lateral_dir_lote_id: r.conf_lateral_dir_lote_id != null ? Number(r.conf_lateral_dir_lote_id) : null,
    conf_lateral_dir_texto: r.conf_lateral_dir_texto ?? null,
    conf_lateral_esq_lote_id: r.conf_lateral_esq_lote_id != null ? Number(r.conf_lateral_esq_lote_id) : null,
    conf_lateral_esq_texto: r.conf_lateral_esq_texto ?? null,
    medida_frente_m: asNum(r.medida_frente_m),
    medida_fundo_m: asNum(r.medida_fundo_m),
    medida_lateral_dir_m: asNum(r.medida_lateral_dir_m),
    medida_lateral_esq_m: asNum(r.medida_lateral_esq_m),
    area_m2: asNum(r.area_m2),
    area_calculada_m2: asNum(r.area_calculada_m2),
    numero_lados: r.numero_lados != null ? Number(r.numero_lados) : null,
    vertices_geojson: r.vertices_geojson ?? null,
    origem_dado: (r.origem_dado as OrigemDado) || 'manual',
    observacoes: r.observacoes ?? null,
  };
}

export async function getConfig(): Promise<ConfiguracoesDemarcacao> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM configuracoes_demarcacao WHERE id = 1'
  );
  if (!rows.length) {
    return { id: 1, tolerancia_medida_cm: 5, updated_at: '' };
  }
  return {
    id: Number(rows[0].id),
    tolerancia_medida_cm: Number(rows[0].tolerancia_medida_cm),
    updated_at: String(rows[0].updated_at ?? ''),
  };
}

export async function setTolerancia(toleranciaCm: number): Promise<void> {
  await pool.execute(
    'INSERT INTO configuracoes_demarcacao (id, tolerancia_medida_cm) VALUES (1, ?) ON DUPLICATE KEY UPDATE tolerancia_medida_cm = VALUES(tolerancia_medida_cm)',
    [Math.max(0, Math.round(toleranciaCm))]
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Importer CSV/XLSX em 2 passadas
// ──────────────────────────────────────────────────────────────────────────────

export interface LinhaImport {
  loteamento?: string;
  quadra?: string;
  lote?: string;
  rua_frente?: string;
  conf_frente?: string;
  conf_fundo?: string;
  conf_lateral_dir?: string;
  conf_lateral_esq?: string;
  medida_frente_m?: string | number;
  medida_fundo_m?: string | number;
  medida_lateral_dir_m?: string | number;
  medida_lateral_esq_m?: string | number;
  area_m2?: string | number;
  area_calculada_m2?: string | number;
  numero_de_lados?: string | number;
  observacoes?: string;
}

export interface RelatorioImport {
  loteamento_id: number | null;
  loteamento_nome: string;
  total_linhas: number;
  lotes_criados: number;
  lotes_atualizados: number;
  fks_resolvidas: number;
  fks_pendentes: number;
  duplicatas: number;
  erros: Array<{ linha: number; mensagem: string }>;
}

/**
 * Importa linhas (já parseadas do CSV ou XLSX) num loteamento.
 *
 * Estrategia 2-pass:
 *   1) cria/atualiza loteamento, ruas, quadras, lotes — confrontantes salvos
 *      como texto cru (incluindo prefixo "LOTE:Q.X/Y" sem resolver)
 *   2) resolve FKs lendo todos os lotes do loteamento e fazendo matching pela
 *      convencao "LOTE:Quadra/Numero" → atualiza conf_*_lote_id e zera o texto
 *      quando a FK eh resolvida com sucesso
 *
 * preview=true → apenas valida e retorna relatorio sem persistir
 */
export async function importarLinhas(
  linhas: LinhaImport[],
  origem: OrigemDado,
  opts: { preview?: boolean } = {}
): Promise<RelatorioImport> {
  const { preview = false } = opts;
  const erros: RelatorioImport['erros'] = [];
  const relatorio: RelatorioImport = {
    loteamento_id: null,
    loteamento_nome: '',
    total_linhas: linhas.length,
    lotes_criados: 0,
    lotes_atualizados: 0,
    fks_resolvidas: 0,
    fks_pendentes: 0,
    duplicatas: 0,
    erros,
  };

  if (!linhas.length) {
    erros.push({ linha: 0, mensagem: 'arquivo vazio' });
    return relatorio;
  }

  // Identifica loteamento — assume coluna `loteamento` igual em todas as linhas
  const nomesLoteamento = new Set(
    linhas.map(l => asStr(l.loteamento)).filter((x): x is string => !!x)
  );
  if (nomesLoteamento.size === 0) {
    erros.push({ linha: 0, mensagem: 'coluna `loteamento` ausente ou vazia em todas as linhas' });
    return relatorio;
  }
  if (nomesLoteamento.size > 1) {
    erros.push({
      linha: 0,
      mensagem: `arquivo contem ${nomesLoteamento.size} loteamentos diferentes — separe em arquivos distintos`,
    });
    return relatorio;
  }
  const loteamentoNome = [...nomesLoteamento][0];
  relatorio.loteamento_nome = loteamentoNome;

  if (preview) {
    // Em preview, valida estrutura e conta sem persistir
    let pendentes = 0;
    let resolvidas = 0;
    const ehFkRef = (s: string | null | undefined) =>
      typeof s === 'string' && /^lote\s*:/i.test(s.trim());
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      if (!asStr(l.quadra)) erros.push({ linha: i + 2, mensagem: 'coluna `quadra` vazia' });
      if (!asStr(l.lote)) erros.push({ linha: i + 2, mensagem: 'coluna `lote` vazia' });
      [l.conf_frente, l.conf_fundo, l.conf_lateral_dir, l.conf_lateral_esq].forEach(c => {
        if (ehFkRef(c)) pendentes++;
        else if (asStr(c)) resolvidas++; // texto livre conta como "resolvido"
      });
    }
    relatorio.fks_pendentes = pendentes;
    relatorio.fks_resolvidas = resolvidas;
    return relatorio;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ── Cria/recupera loteamento ───────────────────────────────────────────
    const [lotRows] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM loteamentos WHERE nome = ?', [loteamentoNome]
    );
    let loteamentoId: number;
    if (lotRows.length) {
      loteamentoId = Number(lotRows[0].id);
      // Reativa se estava desativado
      await conn.execute('UPDATE loteamentos SET ativo = TRUE WHERE id = ?', [loteamentoId]);
    } else {
      const [r] = await conn.execute<ResultSetHeader>(
        'INSERT INTO loteamentos (nome) VALUES (?)', [loteamentoNome]
      );
      loteamentoId = r.insertId;
    }
    relatorio.loteamento_id = loteamentoId;

    // ── PASSADA 1: cria ruas, quadras, lotes (FKs ainda como texto) ───────
    const ruasMap = new Map<string, number>(); // nome → id
    const quadrasMap = new Map<string, number>(); // nome → id
    const lotesCriadosKeys = new Set<string>(); // "Q. 01/03" pra detectar duplicatas no arquivo

    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      const linhaNum = i + 2; // +1 header +1 1-based
      try {
        const quadraNome = asStr(l.quadra);
        const loteNumero = asStr(l.lote);
        if (!quadraNome || !loteNumero) {
          erros.push({ linha: linhaNum, mensagem: 'quadra ou lote vazio' });
          continue;
        }

        const chaveLote = `${quadraNome}/${loteNumero}`;
        if (lotesCriadosKeys.has(chaveLote)) {
          relatorio.duplicatas++;
          continue;
        }
        lotesCriadosKeys.add(chaveLote);

        // Quadra
        let quadraId = quadrasMap.get(quadraNome);
        if (!quadraId) {
          const [qr] = await conn.execute<RowDataPacket[]>(
            'SELECT id FROM loteamento_quadras WHERE loteamento_id = ? AND nome = ?',
            [loteamentoId, quadraNome]
          );
          if (qr.length) {
            quadraId = Number(qr[0].id);
          } else {
            const [r] = await conn.execute<ResultSetHeader>(
              'INSERT INTO loteamento_quadras (loteamento_id, nome) VALUES (?, ?)',
              [loteamentoId, quadraNome]
            );
            quadraId = r.insertId;
          }
          quadrasMap.set(quadraNome, quadraId);
        }

        // Rua frente (opcional)
        let ruaFrenteId: number | null = null;
        const ruaNome = asStr(l.rua_frente);
        if (ruaNome) {
          let rid = ruasMap.get(ruaNome);
          if (!rid) {
            const [rr] = await conn.execute<RowDataPacket[]>(
              'SELECT id FROM loteamento_ruas WHERE loteamento_id = ? AND nome = ?',
              [loteamentoId, ruaNome]
            );
            if (rr.length) {
              rid = Number(rr[0].id);
            } else {
              const [r] = await conn.execute<ResultSetHeader>(
                'INSERT INTO loteamento_ruas (loteamento_id, nome) VALUES (?, ?)',
                [loteamentoId, ruaNome]
              );
              rid = r.insertId;
            }
            ruasMap.set(ruaNome, rid);
          }
          ruaFrenteId = rid;
        }

        // Lote — UPSERT (cria se nao existe, atualiza se sim)
        const dadosLote = {
          conf_frente_texto: asStr(l.conf_frente),
          conf_fundo_texto: asStr(l.conf_fundo),
          conf_lateral_dir_texto: asStr(l.conf_lateral_dir),
          conf_lateral_esq_texto: asStr(l.conf_lateral_esq),
          medida_frente_m: asNum(l.medida_frente_m),
          medida_fundo_m: asNum(l.medida_fundo_m),
          medida_lateral_dir_m: asNum(l.medida_lateral_dir_m),
          medida_lateral_esq_m: asNum(l.medida_lateral_esq_m),
          area_m2: asNum(l.area_m2),
          area_calculada_m2: asNum(l.area_calculada_m2),
          numero_lados: asNum(l.numero_de_lados),
          observacoes: asStr(l.observacoes),
        };

        const [existRows] = await conn.execute<RowDataPacket[]>(
          'SELECT id FROM loteamento_lotes WHERE quadra_id = ? AND numero_lote = ?',
          [quadraId, loteNumero]
        );

        if (existRows.length) {
          await conn.execute(
            `UPDATE loteamento_lotes SET
               rua_frente_id = ?,
               conf_frente_lote_id = NULL, conf_frente_texto = ?,
               conf_fundo_lote_id = NULL, conf_fundo_texto = ?,
               conf_lateral_dir_lote_id = NULL, conf_lateral_dir_texto = ?,
               conf_lateral_esq_lote_id = NULL, conf_lateral_esq_texto = ?,
               medida_frente_m = ?, medida_fundo_m = ?,
               medida_lateral_dir_m = ?, medida_lateral_esq_m = ?,
               area_m2 = ?, area_calculada_m2 = ?, numero_lados = ?,
               origem_dado = ?, observacoes = ?
             WHERE id = ?`,
            [
              ruaFrenteId,
              dadosLote.conf_frente_texto,
              dadosLote.conf_fundo_texto,
              dadosLote.conf_lateral_dir_texto,
              dadosLote.conf_lateral_esq_texto,
              dadosLote.medida_frente_m,
              dadosLote.medida_fundo_m,
              dadosLote.medida_lateral_dir_m,
              dadosLote.medida_lateral_esq_m,
              dadosLote.area_m2,
              dadosLote.area_calculada_m2,
              dadosLote.numero_lados,
              origem,
              dadosLote.observacoes,
              Number(existRows[0].id),
            ]
          );
          relatorio.lotes_atualizados++;
        } else {
          await conn.execute(
            `INSERT INTO loteamento_lotes
              (quadra_id, numero_lote, rua_frente_id,
               conf_frente_texto, conf_fundo_texto, conf_lateral_dir_texto, conf_lateral_esq_texto,
               medida_frente_m, medida_fundo_m, medida_lateral_dir_m, medida_lateral_esq_m,
               area_m2, area_calculada_m2, numero_lados, origem_dado, observacoes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              quadraId, loteNumero, ruaFrenteId,
              dadosLote.conf_frente_texto, dadosLote.conf_fundo_texto,
              dadosLote.conf_lateral_dir_texto, dadosLote.conf_lateral_esq_texto,
              dadosLote.medida_frente_m, dadosLote.medida_fundo_m,
              dadosLote.medida_lateral_dir_m, dadosLote.medida_lateral_esq_m,
              dadosLote.area_m2, dadosLote.area_calculada_m2, dadosLote.numero_lados,
              origem, dadosLote.observacoes,
            ]
          );
          relatorio.lotes_criados++;
        }
      } catch (err) {
        erros.push({ linha: linhaNum, mensagem: (err as Error).message.slice(0, 200) });
      }
    }

    // ── PASSADA 2: resolve FKs "LOTE:Q. 02/03" → conf_*_lote_id ───────────
    // Carrega TODOS os lotes do loteamento com chave "Q. XX/NN" pra lookup O(1)
    const [todosLotes] = await conn.execute<RowDataPacket[]>(
      `SELECT l.id, q.nome AS quadra, l.numero_lote
         FROM loteamento_lotes l
         JOIN loteamento_quadras q ON q.id = l.quadra_id
        WHERE q.loteamento_id = ?`,
      [loteamentoId]
    );
    const lookupMap = new Map<string, number>();
    for (const r of todosLotes) {
      const chave = `${r.quadra}/${r.numero_lote}`.toLowerCase();
      lookupMap.set(chave, Number(r.id));
    }

    const camposFk: Array<{ texto: string; fk: string }> = [
      { texto: 'conf_frente_texto', fk: 'conf_frente_lote_id' },
      { texto: 'conf_fundo_texto', fk: 'conf_fundo_lote_id' },
      { texto: 'conf_lateral_dir_texto', fk: 'conf_lateral_dir_lote_id' },
      { texto: 'conf_lateral_esq_texto', fk: 'conf_lateral_esq_lote_id' },
    ];

    // Le todos os lotes com texto que comeca com "LOTE:"
    const [lotesComFk] = await conn.execute<RowDataPacket[]>(
      `SELECT l.id,
              l.conf_frente_texto, l.conf_fundo_texto,
              l.conf_lateral_dir_texto, l.conf_lateral_esq_texto
         FROM loteamento_lotes l
         JOIN loteamento_quadras q ON q.id = l.quadra_id
        WHERE q.loteamento_id = ?
          AND (
                l.conf_frente_texto LIKE 'LOTE:%' OR l.conf_fundo_texto LIKE 'LOTE:%'
             OR l.conf_lateral_dir_texto LIKE 'LOTE:%' OR l.conf_lateral_esq_texto LIKE 'LOTE:%'
          )`,
      [loteamentoId]
    );

    for (const lot of lotesComFk) {
      for (const { texto, fk } of camposFk) {
        const v = lot[texto] as string | null;
        if (!v || !/^lote\s*:/i.test(v)) continue;
        // "LOTE:Q. 02/03" → "Q. 02/03"
        const ref = v.replace(/^lote\s*:\s*/i, '').trim();
        const fkId = lookupMap.get(ref.toLowerCase());
        if (fkId) {
          await conn.execute(
            `UPDATE loteamento_lotes SET ${fk} = ?, ${texto} = NULL WHERE id = ?`,
            [fkId, Number(lot.id)]
          );
          relatorio.fks_resolvidas++;
        } else {
          relatorio.fks_pendentes++;
        }
      }
    }

    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch {}
    erros.push({ linha: 0, mensagem: 'erro fatal: ' + (err as Error).message });
  } finally {
    conn.release();
  }

  return relatorio;
}
