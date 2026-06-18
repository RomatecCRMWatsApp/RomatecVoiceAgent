// v3.67.0: tabelas da Proposta de Reforma — Piso Sobreposto.
// Idempotente (CREATE TABLE IF NOT EXISTS) — re-execução no boot não falha.
import pool from './connection';

const CREATE_PROPOSTAS = `
  CREATE TABLE IF NOT EXISTS propostas_reforma_piso (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    numero            VARCHAR(32)     NOT NULL,
    cliente_id        BIGINT UNSIGNED NULL,
    contratante_nome  VARCHAR(180)    NOT NULL,
    contratante_doc   VARCHAR(24)     NULL,
    contratante_fone  VARCHAR(24)     NULL,
    obra_endereco     VARCHAR(255)    NULL,
    cidade            VARCHAR(120)    NOT NULL DEFAULT 'Açailândia',
    uf                CHAR(2)         NOT NULL DEFAULT 'MA',
    com_remocao       TINYINT(1)      NOT NULL DEFAULT 0,
    config_json       JSON            NOT NULL,
    resultado_json    JSON            NULL,
    area_total_m2     DECIMAL(12,4)   NOT NULL DEFAULT 0,
    prazo_dias_uteis  INT UNSIGNED    NOT NULL DEFAULT 0,
    mao_obra_m2       DECIMAL(12,2)   NOT NULL DEFAULT 0,
    bdi_pct           DECIMAL(6,2)    NOT NULL DEFAULT 0,
    valor_materiais   DECIMAL(14,2)   NOT NULL DEFAULT 0,
    valor_mao_obra    DECIMAL(14,2)   NOT NULL DEFAULT 0,
    valor_final       DECIMAL(14,2)   NOT NULL DEFAULT 0,
    valor_m2_final    DECIMAL(12,2)   NOT NULL DEFAULT 0,
    validade_dias     INT UNSIGNED    NOT NULL DEFAULT 15,
    tema              ENUM('tradicional','prime1','prime2') NOT NULL DEFAULT 'tradicional',
    status            ENUM('rascunho','calculada','enviada','aceita','recusada','cancelada')
                      NOT NULL DEFAULT 'rascunho',
    criado_em         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_reforma_numero (numero),
    KEY idx_reforma_cliente (cliente_id),
    KEY idx_reforma_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const CREATE_AMBIENTES = `
  CREATE TABLE IF NOT EXISTS propostas_reforma_piso_ambientes (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    proposta_id   BIGINT UNSIGNED NOT NULL,
    descricao     VARCHAR(120)    NOT NULL,
    comprimento_m DECIMAL(10,3)   NOT NULL,
    largura_m     DECIMAL(10,3)   NOT NULL,
    area_m2       DECIMAL(12,4)   NOT NULL,
    ordem         INT UNSIGNED    NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_amb_proposta (proposta_id),
    CONSTRAINT fk_amb_proposta FOREIGN KEY (proposta_id)
      REFERENCES propostas_reforma_piso (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export async function runReformaPisoMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'propostas_reforma_piso', sql: CREATE_PROPOSTAS },
    { label: 'propostas_reforma_piso_ambientes', sql: CREATE_AMBIENTES },
  ];
  for (const { label, sql } of ops) {
    try {
      await pool.query(sql);
      console.log(`[reforma-piso-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists/i.test(msg)) console.log(`[reforma-piso-migrations] ja existe: ${label}`);
      else console.error(`[reforma-piso-migrations] FALHA ${label}:`, msg.slice(0, 200));
    }
  }
}
