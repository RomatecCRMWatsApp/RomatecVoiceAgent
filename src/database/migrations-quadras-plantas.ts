// v3.31.0: planta individual por quadra — tabela nova `loteamento_quadras_plantas`
// (vincula 1:1 com loteamento_quadras) + ALTER em loteamento_quadras pra adicionar
// `tem_planta_individual` (flag de query rapida).
//
// FK lógica em uploaded_by_user_id pra users (auth SaaS v3.24.0). Soft delete
// via deleted_at. Idempotente.

import pool from './connection';
import type { RowDataPacket } from 'mysql2';

async function tableExists(table: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table],
  );
  return rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

export async function runMigrationsQuadrasPlantas(): Promise<void> {
  // Prerequisito: tabela loteamento_quadras deve existir (migrations-loteamentos.ts)
  if (!(await tableExists('loteamento_quadras'))) {
    console.log('[quadras-plantas-migrations] loteamento_quadras ainda nao existe — skip');
    return;
  }

  // 1) Tabela principal
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS loteamento_quadras_plantas (
        id INT PRIMARY KEY AUTO_INCREMENT,
        quadra_id INT NOT NULL,
        loteamento_id INT NOT NULL,

        dxf_filename VARCHAR(255) NULL,
        dxf_path VARCHAR(500) NULL,
        dxf_size_bytes BIGINT NULL,
        dxf_uploaded_at TIMESTAMP NULL,
        dxf_hash_sha256 CHAR(64) NULL,

        dwg_filename VARCHAR(255) NULL,
        dwg_path VARCHAR(500) NULL,
        dwg_size_bytes BIGINT NULL,
        dwg_uploaded_at TIMESTAMP NULL,
        dwg_hash_sha256 CHAR(64) NULL,

        pdf_filename VARCHAR(255) NULL,
        pdf_path VARCHAR(500) NULL,
        pdf_size_bytes BIGINT NULL,
        pdf_uploaded_at TIMESTAMP NULL,
        pdf_hash_sha256 CHAR(64) NULL,

        num_lotes_detectados INT NULL,
        perimetro_quadra_m DECIMAL(12,2) NULL,
        area_total_quadra_m2 DECIMAL(14,2) NULL,
        lotes_extraidos_json MEDIUMTEXT NULL,
        parsed_at TIMESTAMP NULL,
        parse_status ENUM('pendente','sucesso','erro','manual') NOT NULL DEFAULT 'pendente',
        parse_error TEXT NULL,

        uploaded_by_user_id INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,

        UNIQUE KEY uq_quadra_planta (quadra_id),
        INDEX idx_loteamento (loteamento_id),
        INDEX idx_parse_status (parse_status),
        INDEX idx_deleted (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[quadras-plantas-migrations] OK: loteamento_quadras_plantas');
  } catch (err) {
    console.error('[quadras-plantas-migrations] FALHA tabela:', (err as Error).message);
  }

  // 2) ALTER loteamento_quadras pra flag rapida
  try {
    if (!(await columnExists('loteamento_quadras', 'tem_planta_individual'))) {
      await pool.execute(
        `ALTER TABLE loteamento_quadras
           ADD COLUMN tem_planta_individual TINYINT(1) NOT NULL DEFAULT 0`,
      );
      console.log('[quadras-plantas-migrations] OK: ADD COLUMN tem_planta_individual');
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (!/Duplicate column/i.test(msg)) {
      console.error('[quadras-plantas-migrations] FALHA ALTER:', msg);
    }
  }
}
