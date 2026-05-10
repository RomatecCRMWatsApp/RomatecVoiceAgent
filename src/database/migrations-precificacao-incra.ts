// src/database/migrations-precificacao-incra.ts
//
// v3.0.0: precificação automática INCRA (Portaria 12/2025).
// Adiciona 16 colunas em laudos_demarcacao + 1 índice. Idempotente.

import pool from './connection';

export async function runPrecificacaoIncraMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    // Unidade e critérios (1-10)
    { label: 'ALTER unidade_calculo',   sql: "ALTER TABLE laudos_demarcacao ADD COLUMN unidade_calculo ENUM('km','hectare','lote') NULL COMMENT 'Unidade base do calculo INCRA'" },
    { label: 'ALTER pont_vegetacao',    sql: "ALTER TABLE laudos_demarcacao ADD COLUMN pont_vegetacao TINYINT NULL COMMENT '1-10 conforme Quadro 1 Portaria INCRA 12/2025'" },
    { label: 'ALTER pont_relevo',       sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN pont_relevo TINYINT NULL' },
    { label: 'ALTER pont_insalubridade',sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN pont_insalubridade TINYINT NULL' },
    { label: 'ALTER pont_acesso',       sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN pont_acesso TINYINT NULL' },
    { label: 'ALTER pont_clima',        sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN pont_clima TINYINT NULL' },
    { label: 'ALTER pont_area_media',   sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN pont_area_media TINYINT NULL' },

    // Pontuação derivada e faixa
    { label: 'ALTER pontuacao_total',   sql: "ALTER TABLE laudos_demarcacao ADD COLUMN pontuacao_total SMALLINT NULL COMMENT 'Soma 6-60'" },
    { label: 'ALTER faixa_aplicada',    sql: "ALTER TABLE laudos_demarcacao ADD COLUMN faixa_aplicada VARCHAR(10) NULL COMMENT 'Ex 26-35'" },

    // Cálculo
    { label: 'ALTER valor_unitario',    sql: "ALTER TABLE laudos_demarcacao ADD COLUMN valor_unitario DECIMAL(12,2) NULL COMMENT 'R$/km, R$/ha ou R$/lote'" },
    { label: 'ALTER quantidade_calc',   sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN quantidade_calculo DECIMAL(14,4) NULL' },
    { label: 'ALTER valor_base_calc',   sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN valor_base_calculado DECIMAL(14,2) NULL' },

    // Desconto
    { label: 'ALTER desconto_tipo',     sql: "ALTER TABLE laudos_demarcacao ADD COLUMN desconto_tipo ENUM('percentual','fixo','nenhum') DEFAULT 'nenhum'" },
    { label: 'ALTER desconto_valor',    sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN desconto_valor DECIMAL(12,2) DEFAULT 0' },

    // Resultado
    { label: 'ALTER valor_final',       sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN valor_final DECIMAL(14,2) NULL' },
    { label: 'ALTER precif_obs',        sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN precificacao_observacoes TEXT NULL' },
    { label: 'ALTER precif_calc_em',    sql: "ALTER TABLE laudos_demarcacao ADD COLUMN precificacao_calculada_em DATETIME NULL COMMENT 'Flag: NOT NULL = INCRA aplicada'" },

    // Índice
    { label: 'CREATE idx_precificacao', sql: 'CREATE INDEX idx_laudos_precificacao ON laudos_demarcacao(precificacao_calculada_em)' },
  ];

  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[precif-incra-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate|Duplicate key name/i.test(msg)) {
        console.log(`[precif-incra-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[precif-incra-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
