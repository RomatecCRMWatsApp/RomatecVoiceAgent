// v3.8.0 — Migrations da Galeria de Fotos.
// Tabela central de fotos georreferenciadas com carimbo aplicado,
// reutilizáveis em Laudos, VTO, Propostas. Envio direto via WhatsApp/Telegram.

import pool from './connection';

const CREATE_GALERIA_FOTOS = `
  CREATE TABLE IF NOT EXISTS galeria_fotos (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id       INT NOT NULL DEFAULT 1,
    user_id         INT NULL,
    user_nome       VARCHAR(255) NULL,
    mime            VARCHAR(50)  NOT NULL DEFAULT 'image/jpeg',
    arquivo_b64     LONGTEXT     NOT NULL,
    legenda         VARCHAR(500) NULL,
    lat             DECIMAL(10,7) NULL,
    lng             DECIMAL(10,7) NULL,
    altitude_m      DECIMAL(8,2)  NULL,
    accuracy_m      DECIMAL(8,2)  NULL,
    endereco_reverso VARCHAR(500) NULL,
    capturada_em    DATETIME      NULL,
    tags            VARCHAR(255)  NULL,
    obra_id         INT NULL,
    criada_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_galeria_tenant (tenant_id),
    INDEX idx_galeria_criada (criada_em DESC),
    INDEX idx_galeria_obra (obra_id)
  )
`;

// v3.108.0 — deduplicação por hash de conteúdo.
//
// O índice é (tenant_id, obra_id, hash_sha256) e NÃO é UNIQUE de propósito: no MySQL
// cada NULL é distinto num índice único, então UNIQUE não deduplicaria a galeria geral
// (onde obra_id é NULL justamente pra todo mundo). A regra vive na aplicação; o índice
// existe só pra busca de duplicata sair barata.
const ADD_HASH_COLUNA = `
  ALTER TABLE galeria_fotos ADD COLUMN hash_sha256 CHAR(64) NULL
`;
const ADD_HASH_INDEX = `
  CREATE INDEX idx_galeria_hash ON galeria_fotos (tenant_id, obra_id, hash_sha256)
`;

// Log das duplicatas descartadas: sem isto, uma foto "some" e não há como explicar.
const CREATE_DUPLICATAS_LOG = `
  CREATE TABLE IF NOT EXISTS galeria_duplicatas_log (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id      INT NOT NULL DEFAULT 1,
    hash_sha256    CHAR(64) NOT NULL,
    foto_original_id INT NOT NULL,
    obra_id        INT NULL,
    origem         VARCHAR(30) NOT NULL DEFAULT 'upload',
    user_nome      VARCHAR(255) NULL,
    capturada_em   DATETIME NULL,
    descartada_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dup_hash (hash_sha256),
    INDEX idx_dup_original (foto_original_id)
  )
`;

export async function runGaleriaMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'galeria_fotos', sql: CREATE_GALERIA_FOTOS },
    { label: 'galeria_fotos.hash_sha256', sql: ADD_HASH_COLUNA },
    { label: 'idx_galeria_hash', sql: ADD_HASH_INDEX },
    { label: 'galeria_duplicatas_log', sql: CREATE_DUPLICATAS_LOG },
  ];
  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[galeria-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate/i.test(msg)) {
        console.log(`[galeria-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[galeria-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
