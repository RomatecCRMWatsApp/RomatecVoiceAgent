// v3.27.0: migration idempotente para adicionar credencial INCRA do tecnico
// (prefixo FQNS + contadores vitalicios JSON) na tabela `users` do sistema de
// auth SaaS (v3.24.0).
//
// IMPORTANTE: o prompt original v3.27.0 refere-se a "usuarios" — no repo real
// a tabela equivalente chama-se `users` (auth_users do PR A). A semantica e a
// mesma: e' o metadado do tecnico responsavel, FORA do dominio Proposta. Por
// isso a promessa "ZERO ALTER em propostas" continua honrada.
//
// Comportamento:
//   1. Verifica se colunas credencial_incra_prefixo + credencial_contadores
//      existem em INFORMATION_SCHEMA.
//   2. ADD COLUMN se nao existem (try/catch tolerante a Duplicate column).
//   3. Seed do CEO (Jose Romario): se houver linha com email LIKE '%romario%'
//      ou role='admin' sem prefixo, atribui 'FQNS' + contadores zerados.
//   4. Idempotente: rodar N vezes nao duplica nem reseta contadores ja
//      avancados.
//
// Log com prefixo [MigrationUsuariosCredencial] (espelha o padrao do
// runPropostasRevisaoMigrations).

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from './connection';

const CONTADORES_INICIAIS = JSON.stringify({ V: 0, M_CC: 0, M_TG: 0, P: 0 });
const PREFIXO_CEO = 'FQNS';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table],
  );
  return rows.length > 0;
}

export async function runMigrationsUsuariosCredencialIncra(): Promise<void> {
  // 1) Verifica se a tabela users existe (em DBs novos pode ainda nao existir
  //    se essa migration rodar antes de migrations-auth)
  if (!(await tableExists('users'))) {
    console.log('[MigrationUsuariosCredencial] tabela users ainda nao existe — skip');
    return;
  }

  // 2) ADD COLUMN credencial_incra_prefixo
  try {
    if (!(await columnExists('users', 'credencial_incra_prefixo'))) {
      await pool.execute(
        `ALTER TABLE users ADD COLUMN credencial_incra_prefixo VARCHAR(20) NULL`,
      );
      console.log('[MigrationUsuariosCredencial] OK: ADD COLUMN credencial_incra_prefixo');
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (!/Duplicate column/i.test(msg)) {
      console.error('[MigrationUsuariosCredencial] FALHA credencial_incra_prefixo:', msg);
    }
  }

  // 3) ADD COLUMN credencial_contadores
  try {
    if (!(await columnExists('users', 'credencial_contadores'))) {
      await pool.execute(
        `ALTER TABLE users ADD COLUMN credencial_contadores JSON NULL`,
      );
      console.log('[MigrationUsuariosCredencial] OK: ADD COLUMN credencial_contadores');
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (!/Duplicate column/i.test(msg)) {
      console.error('[MigrationUsuariosCredencial] FALHA credencial_contadores:', msg);
    }
  }

  // 4) Seed do CEO (Jose Romario). Idempotente: so atualiza linhas sem prefixo.
  //    Criterio amplo: email LIKE '%romario%' OR role='admin' AND credencial nula.
  try {
    const [r] = await pool.execute<ResultSetHeader>(
      `UPDATE users
          SET credencial_incra_prefixo = ?,
              credencial_contadores    = ?
        WHERE credencial_incra_prefixo IS NULL
          AND (LOWER(email) LIKE '%romario%' OR role = 'admin')`,
      [PREFIXO_CEO, CONTADORES_INICIAIS],
    );
    if (r.affectedRows > 0) {
      console.log(`[MigrationUsuariosCredencial] OK: seed FQNS aplicado em ${r.affectedRows} usuario(s)`);
    } else {
      console.log('[MigrationUsuariosCredencial] OK: nenhum usuario a seedar (ja configurado ou nenhum CEO/admin)');
    }
  } catch (err) {
    console.error('[MigrationUsuariosCredencial] FALHA seed CEO:', (err as Error).message);
  }
}
