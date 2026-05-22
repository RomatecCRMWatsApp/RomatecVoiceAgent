// v3.24.0: migrations dedicadas do sistema de auth (PR A — Auth Foundation).
//
// Idempotente — roda standalone do runMigrations principal pra nao bloquear
// boot do server. Try/catch por ALTER pra Duplicate column nao abortar.

import type { RowDataPacket } from 'mysql2';
import pool from './connection';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function indexExists(table: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, indexName],
  );
  return rows.length > 0;
}

const CREATE_AUTH_LOGS = `
  CREATE TABLE IF NOT EXISTS auth_logs (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NULL,
    login_attempt   VARCHAR(255) NOT NULL,
    ip              VARCHAR(45) NOT NULL,
    user_agent      TEXT NULL,
    sucesso         TINYINT(1) NOT NULL,
    motivo_falha    VARCHAR(100) NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_auth_logs_user (user_id),
    INDEX idx_auth_logs_ip_time (ip, created_at),
    INDEX idx_auth_logs_attempt (login_attempt),
    INDEX idx_auth_logs_failures (sucesso, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export async function runAuthMigrations(): Promise<void> {
  // 1) auth_logs (idempotente via CREATE TABLE IF NOT EXISTS)
  try {
    await pool.execute(CREATE_AUTH_LOGS);
    console.log('[auth-migrations] OK: auth_logs');
  } catch (err) {
    console.error('[auth-migrations] FALHA auth_logs:', (err as Error).message);
  }

  // 2) tenant_users.equipe_id (vinculo opcional pra role='colaborador')
  //    A pessoa fisica do trabalhador continua em romatec_obra_equipe.
  //    user_id (auth) -> tenant_users.role + tenant_users.equipe_id -> equipe.id
  try {
    if (!(await columnExists('tenant_users', 'equipe_id'))) {
      await pool.execute(
        `ALTER TABLE tenant_users
           ADD COLUMN equipe_id INT NULL DEFAULT NULL
           COMMENT 'FK pra romatec_obra_equipe.id quando role=colaborador'`,
      );
      console.log('[auth-migrations] OK: ADD COLUMN tenant_users.equipe_id');
    } else {
      console.log('[auth-migrations] ja existe (OK): tenant_users.equipe_id');
    }

    if (!(await indexExists('tenant_users', 'idx_tu_role_equipe'))) {
      await pool.execute(
        `ALTER TABLE tenant_users ADD INDEX idx_tu_role_equipe (role, equipe_id)`,
      );
      console.log('[auth-migrations] OK: INDEX idx_tu_role_equipe');
    } else {
      console.log('[auth-migrations] ja existe (OK): idx_tu_role_equipe');
    }
  } catch (err) {
    console.error('[auth-migrations] FALHA tenant_users.equipe_id:', (err as Error).message);
  }

  // 3) Comentario na users SaaS (linha 1447) documentando a divida da legacy.
  //    Nao podemos adicionar comment na linha 517 (legacy OAuth) sem risco —
  //    so registramos no docs/debt-users-legacy.md. SQL comment puro na nova:
  try {
    await pool.execute(
      `ALTER TABLE users COMMENT = 'Auth de aplicacao (PR A v3.24.0). Use email+password_hash. NAO confundir com a tabela users legacy do OAuth (Telegram/Google/Spotify) que vive no schema antigo — ver docs/debt-users-legacy.md'`,
    );
    console.log('[auth-migrations] OK: COMMENT users (SaaS)');
  } catch (err) {
    // Nao critico — se a coluna comment nao puder ser setada por permissao
    console.warn('[auth-migrations] aviso COMMENT users:', (err as Error).message);
  }

  // 4) v3.25.0: users.permissions (JSON granular) + users.active + users.created_by
  //    permissions: array de strings tipo ["proposta:criar","proposta:assinar",...]
  //                 quando NULL = usa permissoes default do role (admin = tudo,
  //                 gestor = quase tudo, colaborador = so /minha-quinzena)
  //    active: soft-disable de user (mantem dados pra audit, bloqueia login)
  //    created_by: user_id de quem criou (auditoria)
  try {
    if (!(await columnExists('users', 'permissions'))) {
      await pool.execute(
        `ALTER TABLE users ADD COLUMN permissions JSON NULL
           COMMENT 'v3.25.0: array de strings com permissoes granulares. NULL = usa defaults do role'`,
      );
      console.log('[auth-migrations] OK: ADD COLUMN users.permissions');
    } else {
      console.log('[auth-migrations] ja existe (OK): users.permissions');
    }
    if (!(await columnExists('users', 'active'))) {
      await pool.execute(
        `ALTER TABLE users ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1
           COMMENT 'v3.25.0: soft-disable. 0 = bloqueado pra login'`,
      );
      console.log('[auth-migrations] OK: ADD COLUMN users.active');
    } else {
      console.log('[auth-migrations] ja existe (OK): users.active');
    }
    if (!(await columnExists('users', 'created_by'))) {
      await pool.execute(
        `ALTER TABLE users ADD COLUMN created_by INT NULL
           COMMENT 'v3.25.0: id do admin que criou este user'`,
      );
      console.log('[auth-migrations] OK: ADD COLUMN users.created_by');
    } else {
      console.log('[auth-migrations] ja existe (OK): users.created_by');
    }
  } catch (err) {
    console.error('[auth-migrations] FALHA users.permissions/active/created_by:', (err as Error).message);
  }
}
