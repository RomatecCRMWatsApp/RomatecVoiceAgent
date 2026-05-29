// v3.49.0: Anexos de documentos em recibos universais (CCIR, ITR/NIRF, CAR
// e outros documentos complementares por serviço).
//
// Storage no proprio banco como LONGBLOB (mesmo padrao de laudos_demarcacao_arquivos
// e romatec_obra_vistoria_fotos) — Railway tem containers efemeros sem volume
// persistente confiavel.
//
// Idempotente: re-execucao ignora "already exists".

import pool from './connection';

export async function runRecibosAnexosMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    {
      label: 'CREATE TABLE recibos_anexos',
      sql: `CREATE TABLE recibos_anexos (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        recibo_id       INT NOT NULL,
        nome_original   VARCHAR(255) NOT NULL COMMENT 'nome enviado pelo usuario',
        nome_armazenado VARCHAR(300) NOT NULL COMMENT 'sanitizado com prefixo sha256',
        descricao       VARCHAR(255) NULL COMMENT 'label opcional: CCIR Antigo, CCIR Atualizado, etc.',
        mime_type       VARCHAR(120) NOT NULL,
        tamanho_bytes   BIGINT NOT NULL,
        sha256          CHAR(64) NOT NULL COMMENT 'hash do conteudo (integridade)',
        conteudo_blob   LONGBLOB NOT NULL COMMENT 'bytes do arquivo',
        download_token  VARCHAR(64) NOT NULL COMMENT 'token publico (64 hex)',
        ativo           BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'soft delete',
        criado_em       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_ra_token (download_token),
        INDEX idx_ra_recibo (recibo_id),
        INDEX idx_ra_ativo (ativo),
        CONSTRAINT fk_ra_recibo FOREIGN KEY (recibo_id)
          REFERENCES recibos(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
  ];

  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[recibos-anexos-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate|Duplicate key name/i.test(msg)) {
        console.log(`[recibos-anexos-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[recibos-anexos-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
