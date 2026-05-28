// v3.29.0: repos do aditivo de campo — config (templates) + vinculos (snapshots).

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import type {
  AditivoConfig,
  AditivoConfigRepoLike,
  AditivoTipo,
  AditivoGrau,
} from '../services/aditivoCampoCalculator';

function rowToConfig(r: RowDataPacket): AditivoConfig {
  return {
    id: Number(r.id),
    tipo: r.tipo as AditivoTipo,
    grau: r.grau as AditivoGrau,
    percentual: Number(r.percentual),
    descricao_curta: String(r.descricao_curta),
    fundamentacao_legal: String(r.fundamentacao_legal),
    texto_explicativo_md: String(r.texto_explicativo_md),
    ativo: Number(r.ativo) === 1,
  };
}

export const aditivoCampoConfigRepo: AditivoConfigRepoLike & {
  listarAtivos(): Promise<AditivoConfig[]>;
  buscarPorId(id: number): Promise<AditivoConfig | null>;
} = {
  async findByTipoGrau(tipo: AditivoTipo, grau: AditivoGrau): Promise<AditivoConfig | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM aditivo_campo_config WHERE tipo = ? AND grau = ? LIMIT 1`,
      [tipo, grau],
    );
    if (!rows.length) return null;
    return rowToConfig(rows[0]);
  },
  async listarAtivos(): Promise<AditivoConfig[]> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM aditivo_campo_config WHERE ativo = 1
        ORDER BY tipo ASC, FIELD(grau, 'minimo','medio','maximo','unico')`,
    );
    return rows.map(rowToConfig);
  },
  async buscarPorId(id: number): Promise<AditivoConfig | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM aditivo_campo_config WHERE id = ? LIMIT 1`,
      [id],
    );
    if (!rows.length) return null;
    return rowToConfig(rows[0]);
  },
};

// ── Snapshot do aditivo aplicado em uma proposta ───────────────────────────

export interface AditivoSnapshot {
  proposta_tipo: string;
  proposta_id: number;
  aditivo_config_id: number;
  tipo: AditivoTipo;
  grau: AditivoGrau;
  percentual_aplicado: number;
  base_calculo_descricao: string;
  base_calculo_valor: number;
  valor_aditivo: number;
  texto_pdf_md: string;
  observacao_tecnica: string | null;
}

export const propostasAditivosCampoRepo = {
  async upsert(snap: AditivoSnapshot): Promise<void> {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO propostas_aditivos_campo
        (proposta_tipo, proposta_id, aditivo_config_id, tipo, grau,
         percentual_aplicado, base_calculo_descricao, base_calculo_valor,
         valor_aditivo, texto_pdf_md, observacao_tecnica)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         aditivo_config_id      = VALUES(aditivo_config_id),
         tipo                   = VALUES(tipo),
         grau                   = VALUES(grau),
         percentual_aplicado    = VALUES(percentual_aplicado),
         base_calculo_descricao = VALUES(base_calculo_descricao),
         base_calculo_valor     = VALUES(base_calculo_valor),
         valor_aditivo          = VALUES(valor_aditivo),
         texto_pdf_md           = VALUES(texto_pdf_md),
         observacao_tecnica     = VALUES(observacao_tecnica),
         updated_at             = CURRENT_TIMESTAMP`,
      [
        snap.proposta_tipo, snap.proposta_id, snap.aditivo_config_id,
        snap.tipo, snap.grau, snap.percentual_aplicado,
        snap.base_calculo_descricao, snap.base_calculo_valor,
        snap.valor_aditivo, snap.texto_pdf_md, snap.observacao_tecnica,
      ],
    );
  },
  async buscar(proposta_tipo: string, proposta_id: number): Promise<AditivoSnapshot | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT proposta_tipo, proposta_id, aditivo_config_id, tipo, grau,
              percentual_aplicado, base_calculo_descricao, base_calculo_valor,
              valor_aditivo, texto_pdf_md, observacao_tecnica
         FROM propostas_aditivos_campo
        WHERE proposta_tipo = ? AND proposta_id = ?
        LIMIT 1`,
      [proposta_tipo, proposta_id],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      proposta_tipo: String(r.proposta_tipo),
      proposta_id: Number(r.proposta_id),
      aditivo_config_id: Number(r.aditivo_config_id),
      tipo: r.tipo as AditivoTipo,
      grau: r.grau as AditivoGrau,
      percentual_aplicado: Number(r.percentual_aplicado),
      base_calculo_descricao: String(r.base_calculo_descricao),
      base_calculo_valor: Number(r.base_calculo_valor),
      valor_aditivo: Number(r.valor_aditivo),
      texto_pdf_md: String(r.texto_pdf_md),
      observacao_tecnica: r.observacao_tecnica != null ? String(r.observacao_tecnica) : null,
    };
  },
  async remover(proposta_tipo: string, proposta_id: number): Promise<void> {
    await pool.execute(
      `DELETE FROM propostas_aditivos_campo WHERE proposta_tipo = ? AND proposta_id = ?`,
      [proposta_tipo, proposta_id],
    );
  },
};
