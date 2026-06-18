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

// v3.68.0: fotos do relatório fotográfico (base64 no banco — Railway é efêmero).
const CREATE_FOTOS = `
  CREATE TABLE IF NOT EXISTS propostas_reforma_piso_fotos (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    proposta_id  BIGINT UNSIGNED NOT NULL,
    legenda      VARCHAR(255)    NULL,
    mime         VARCHAR(120)    NOT NULL DEFAULT 'image/jpeg',
    data_base64  LONGTEXT        NOT NULL,
    ordem        INT UNSIGNED    NOT NULL DEFAULT 0,
    created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_rpf_proposta (proposta_id),
    CONSTRAINT fk_rpf_proposta FOREIGN KEY (proposta_id)
      REFERENCES propostas_reforma_piso (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

// v3.68.0: anexos de plantas (PDF/DWG/DXF/imagem) — LONGBLOB + token de download.
const CREATE_ANEXOS = `
  CREATE TABLE IF NOT EXISTS propostas_reforma_piso_anexos (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    proposta_id     BIGINT UNSIGNED NOT NULL,
    nome_original   VARCHAR(255)    NOT NULL,
    mime_type       VARCHAR(120)    NOT NULL,
    tamanho_bytes   BIGINT UNSIGNED NOT NULL DEFAULT 0,
    is_imagem       TINYINT(1)      NOT NULL DEFAULT 0,
    conteudo_blob   LONGBLOB        NOT NULL,
    download_token  VARCHAR(64)     NOT NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_rpa_token (download_token),
    KEY idx_rpa_proposta (proposta_id),
    CONSTRAINT fk_rpa_proposta FOREIGN KEY (proposta_id)
      REFERENCES propostas_reforma_piso (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export async function runReformaPisoMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'propostas_reforma_piso', sql: CREATE_PROPOSTAS },
    { label: 'propostas_reforma_piso_ambientes', sql: CREATE_AMBIENTES },
    { label: 'propostas_reforma_piso_fotos', sql: CREATE_FOTOS },
    { label: 'propostas_reforma_piso_anexos', sql: CREATE_ANEXOS },
    // v3.76.0: forma de pagamento da proposta (condições de pagamento no PDF).
    { label: 'ALTER forma_pagamento',
      sql: "ALTER TABLE propostas_reforma_piso ADD COLUMN forma_pagamento VARCHAR(40) NULL DEFAULT 'sinal50'" },
  ];
  for (const { label, sql } of ops) {
    try {
      await pool.query(sql);
      console.log(`[reforma-piso-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate column/i.test(msg)) console.log(`[reforma-piso-migrations] ja existe: ${label}`);
      else console.error(`[reforma-piso-migrations] FALHA ${label}:`, msg.slice(0, 200));
    }
  }
}
