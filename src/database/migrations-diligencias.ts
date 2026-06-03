// v3.54.0 — Migrations do módulo Diligências de Campo.
// Idempotentes (CREATE TABLE IF NOT EXISTS): seguem o padrão dos demais
// migrations-*.ts do projeto, chamadas no boot por server.ts.
import pool from './connection';

export async function runDiligenciasMigrations(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS diligencias (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      proposta_id      INT NOT NULL,
      finalidade       ENUM('avaliacao','georreferenciamento','desmembramento',
                            'remembramento','averbacao','vistoria','demarcacao') NOT NULL,
      telefone         VARCHAR(20) NOT NULL,
      email            VARCHAR(120),
      data_sugerida    DATETIME NOT NULL,
      status           ENUM('pendente','confirmado','remarcado','cancelado')
                         NOT NULL DEFAULT 'pendente',
      resposta_cliente TEXT,
      data_confirmacao DATETIME,
      lembrete_enviado TINYINT(1) NOT NULL DEFAULT 0,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_dil_status (status, lembrete_enviado),
      INDEX idx_dil_proposta (proposta_id),
      INDEX idx_dil_telefone (telefone),
      INDEX idx_dil_data (data_sugerida),
      CONSTRAINT fk_diligencias_proposta
        FOREIGN KEY (proposta_id) REFERENCES propostas(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS diligencias_mensagens (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      diligencia_id   INT NOT NULL,
      tipo            ENUM('confirmacao','lembrete','remarcacao') NOT NULL,
      telefone        VARCHAR(20) NOT NULL,
      mensagem        TEXT NOT NULL,
      zapi_message_id VARCHAR(100),
      status_envio    ENUM('enviado','erro') NOT NULL DEFAULT 'enviado',
      erro_detalhe    TEXT,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_dmsg_diligencia (diligencia_id),
      CONSTRAINT fk_dmsg_diligencia
        FOREIGN KEY (diligencia_id) REFERENCES diligencias(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('[diligencias-migrations] OK: diligencias + diligencias_mensagens');
}
