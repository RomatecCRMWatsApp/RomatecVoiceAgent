// v3.28.0: log de auditoria de envios de fotos da galeria.
// Cardinalidade alta (N envios por foto, M canais por envio) — tabela dedicada.
// FKs omitidas seguindo padrao do repo (integridade na aplicacao, vide demais
// migrations).

import pool from './connection';

export async function runMigrationsFotosEnviosLog(): Promise<void> {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS fotos_envios_log (
        id INT PRIMARY KEY AUTO_INCREMENT,
        foto_id INT NOT NULL,
        canal ENUM('celular_download','whatsapp','telegram','sistema') NOT NULL,
        destinatario VARCHAR(255) NULL,
        status ENUM('pendente','sucesso','erro') NOT NULL DEFAULT 'pendente',
        mensagem_erro TEXT NULL,
        zapi_message_id VARCHAR(120) NULL,
        telegram_message_id BIGINT NULL,
        enviado_em TIMESTAMP NULL,
        user_id INT NOT NULL,
        idempotency_key VARCHAR(120) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_foto (foto_id),
        INDEX idx_canal (canal),
        INDEX idx_status (status),
        INDEX idx_enviado_em (enviado_em),
        INDEX idx_idempotency (idempotency_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[fotos-envios-log-migrations] OK: fotos_envios_log');
  } catch (err) {
    console.error('[fotos-envios-log-migrations] FALHA:', (err as Error).message);
  }
}
