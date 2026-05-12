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

export async function runGaleriaMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'galeria_fotos', sql: CREATE_GALERIA_FOTOS },
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
