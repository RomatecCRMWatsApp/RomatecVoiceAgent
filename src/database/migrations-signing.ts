// v1.99.7: migrations DEDICADAS de assinatura digital — rodam INDEPENDENTE
// do runMigrations principal, que tem bug em produçao (aborta na linha 1722
// por causa de um INSERT problematico em users.password_hash).
//
// Esta funcao tem try/catch em cada ALTER pra nao abortar — se uma coluna
// ja existe (Duplicate column), ignora silenciosamente.

import pool from './connection';

const ALTERS_RECIBOS = [
  "ALTER TABLE recibos ADD COLUMN assinado_em DATETIME NULL",
  "ALTER TABLE recibos ADD COLUMN assinado_por_cert_id INT NULL",
  "ALTER TABLE recibos ADD COLUMN pdf_assinado LONGBLOB NULL",
  "ALTER TABLE recibos ADD COLUMN assinatura_meta JSON NULL",
];

const CREATE_SIGNING_CERT_TABLE = `
  CREATE TABLE IF NOT EXISTS tenant_signing_certificates (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id     INT NOT NULL DEFAULT 1,
    perfil        ENUM('pj','pf') NOT NULL,
    label         VARCHAR(120) NOT NULL,
    pfx_enc       LONGBLOB NOT NULL,
    senha_enc     VARBINARY(512) NOT NULL,
    subject_cn    VARCHAR(255) NULL,
    subject_doc   VARCHAR(20) NULL,
    issuer_cn     VARCHAR(255) NULL,
    thumbprint    VARCHAR(64) NULL,
    validade_de   DATETIME NULL,
    validade_ate  DATETIME NULL,
    ativo         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tenant_perfil (tenant_id, perfil, ativo)
  )
`;

export async function runSigningMigrations(): Promise<void> {
  // 1) CREATE TABLE — idempotente
  try {
    await pool.execute(CREATE_SIGNING_CERT_TABLE);
    console.log('[signing-migrations] OK: tenant_signing_certificates');
  } catch (err) {
    console.error('[signing-migrations] FALHA tenant_signing_certificates:', (err as Error).message);
  }

  // 2) ALTERs em recibos — try/catch individual por ALTER
  for (const sql of ALTERS_RECIBOS) {
    try {
      await pool.execute(sql);
      console.log('[signing-migrations] OK:', sql.slice(0, 80));
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/Duplicate column|already exists/i.test(msg)) {
        console.log('[signing-migrations] ja existe (OK):', sql.slice(0, 80));
      } else {
        console.error('[signing-migrations] FALHA:', msg.slice(0, 200), '\n  SQL:', sql);
      }
    }
  }
}
