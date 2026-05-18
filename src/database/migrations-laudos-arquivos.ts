// v3.17.0: Anexos vetoriais (DXF/DWG/KML) do Laudo de Demarcação.
// Storage no próprio banco como LONGBLOB (mesmo padrão de laudos_demarcacao_fotos)
// — Railway tem containers efêmeros sem volume persistente confiável.
// Idempotente: re-execução ignora "already exists".

import pool from './connection';

export async function runLaudosArquivosMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'CREATE TABLE laudos_demarcacao_arquivos',
      sql: `CREATE TABLE laudos_demarcacao_arquivos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        laudo_id INT NOT NULL,
        tipo ENUM('dxf','dwg','kml') NOT NULL,
        nome_original VARCHAR(255) NOT NULL COMMENT 'nome enviado pelo usuário',
        nome_armazenado VARCHAR(300) NOT NULL COMMENT 'nome sanitizado com hash',
        tamanho_bytes BIGINT NOT NULL,
        mime_type VARCHAR(120) NOT NULL,
        sha256 CHAR(64) NOT NULL COMMENT 'hash do conteúdo para integridade',
        conteudo_blob LONGBLOB NOT NULL COMMENT 'bytes do arquivo',
        download_token VARCHAR(64) NOT NULL COMMENT 'token público para /d/:token',
        download_expira_em DATETIME NULL COMMENT 'NULL = não expira',
        download_count INT UNSIGNED NOT NULL DEFAULT 0,
        ultimo_download_at DATETIME NULL,
        ultimo_download_ip VARCHAR(45) NULL,
        ativo BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'soft delete',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_lda_token (download_token),
        INDEX idx_lda_laudo (laudo_id),
        INDEX idx_lda_ativo (ativo),
        CONSTRAINT fk_lda_laudo FOREIGN KEY (laudo_id)
          REFERENCES laudos_demarcacao(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` },
  ];

  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[laudos-arquivos-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate|Duplicate key name/i.test(msg)) {
        console.log(`[laudos-arquivos-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[laudos-arquivos-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }

  // Seed em configuracoes (idempotente — INSERT IGNORE)
  const seeds: Array<[string, string, string]> = [
    ['UPLOAD_MAX_SIZE_MB_DXF', '50', 'Tamanho máximo de arquivo DXF em MB'],
    ['UPLOAD_MAX_SIZE_MB_DWG', '50', 'Tamanho máximo de arquivo DWG em MB'],
    ['UPLOAD_MAX_SIZE_MB_KML', '20', 'Tamanho máximo de arquivo KML em MB'],
    ['DOWNLOAD_TOKEN_EXPIRACAO_DIAS', '365', 'Validade do token de download em dias (0 = sem expiração)'],
  ];
  for (const [chave, valor, descricao] of seeds) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO configuracoes (chave, valor, descricao) VALUES (?, ?, ?)`,
        [chave, valor, descricao]
      );
    } catch (err) {
      console.error(`[laudos-arquivos-seed] FALHA ${chave}:`, (err as Error).message);
    }
  }
}
