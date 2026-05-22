// v3.25.0: CRUD de usuarios + permissoes granulares pra aba Configuracoes.
//
// Restricoes:
//   - Todas as funcoes assumem que requireRole('admin') ja validou no caller
//   - hashPassword usa bcrypt cost 12 (igual /api/auth/login)
//   - users.permissions JSON => string[] (null = usa defaults do role)
//   - Soft-delete: users.deleted_at + users.active=0

import pool from '../database/connection';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { hashPassword } from '../services/auth';
import {
  PERMISSIONS_VALIDAS,
  type RoleNome,
} from '../constants/permissoesSistema';

export interface UserAdminRow extends RowDataPacket {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  role: RoleNome | null;
  active: 0 | 1;
  permissions: string | null; // JSON string
  last_login_at: Date | null;
  created_at: Date;
  tenant_role: RoleNome | null;
  equipe_id: number | null;
  equipe_nome: string | null;
}

/**
 * Lista todos os users com role do tenant_users + nome do colaborador vinculado.
 * Inclui inativos pra admin poder reativar.
 *
 * v3.25.1: query defensiva — descobre quais colunas opcionais existem no schema
 * (created_at, last_login_at, active, permissions) e monta SELECT dinamico.
 * Necessario porque schema legacy nao tem todas as colunas SaaS.
 */
async function colunaExiste(tabela: string, coluna: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tabela, coluna],
  );
  return rows.length > 0;
}

export async function listarUsuariosAdmin() {
  // Detecta colunas opcionais
  const [hasCreated, hasLastLogin, hasActive, hasPerms, hasDeleted] = await Promise.all([
    colunaExiste('users', 'created_at'),
    colunaExiste('users', 'last_login_at'),
    colunaExiste('users', 'active'),
    colunaExiste('users', 'permissions'),
    colunaExiste('users', 'deleted_at'),
  ]);

  // Monta SELECT dinamico — campos faltantes viram NULL
  const colCreatedAt   = hasCreated   ? 'u.created_at'    : 'NULL AS created_at';
  const colLastLogin   = hasLastLogin ? 'u.last_login_at' : 'NULL AS last_login_at';
  const colActive      = hasActive    ? 'u.active'        : '1 AS active'; // legacy = sempre ativo
  const colPermissions = hasPerms     ? 'u.permissions'   : 'NULL AS permissions';
  const whereDeleted   = hasDeleted   ? 'WHERE u.deleted_at IS NULL' : '';
  const orderBy        = hasCreated   ? 'ORDER BY ' + colActive + ' DESC, u.created_at DESC'
                                       : 'ORDER BY u.id DESC';

  const sql = `
    SELECT u.id, u.email, u.name, u.phone,
           COALESCE(u.role, tu.role) AS role,
           ${colActive}, ${colPermissions}, ${colLastLogin}, ${colCreatedAt},
           tu.role AS tenant_role, tu.equipe_id,
           e.nome AS equipe_nome
      FROM users u
      LEFT JOIN tenant_users tu ON tu.user_id = u.id AND tu.tenant_id = 1
      LEFT JOIN romatec_obra_equipe e ON e.id = tu.equipe_id
     ${whereDeleted}
     ${orderBy}
  `;
  const [rows] = await pool.execute<UserAdminRow[]>(sql);
  return rows.map(r => ({
    id: r.id,
    email: r.email,
    name: r.name,
    phone: r.phone,
    role: r.role || 'colaborador',
    active: r.active == null ? true : !!r.active,
    permissions: r.permissions ? safeJsonParse(r.permissions) : null,
    last_login_at: r.last_login_at,
    created_at: r.created_at,
    equipe_id: r.equipe_id,
    equipe_nome: r.equipe_nome,
  }));
}

function safeJsonParse(s: string): string[] | null {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; }
  catch { return null; }
}

function gerarSenhaTemporaria(): string {
  // 12 chars, mistura mai/min/dig/simbolo. Evita chars confusos (0/O/l/1).
  const sets = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghjkmnpqrstuvwxyz',
    '23456789',
    '!@#$%&*-+',
  ];
  const chars: string[] = [];
  for (const s of sets) for (let i = 0; i < 3; i++) chars.push(s[Math.floor(Math.random() * s.length)]);
  // Embaralha
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export async function criarUsuarioAdmin(input: {
  email: string;
  name: string;
  phone?: string;
  role: RoleNome;
  equipe_id?: number | null;
  permissions?: string[] | null;
  senha?: string; // se nao vier, gera temporaria
  created_by?: number;
}) {
  if (!input.email || !input.name) throw new Error('email e name obrigatorios');
  if (!['admin','gestor','colaborador'].includes(input.role)) {
    throw new Error('role invalido (admin/gestor/colaborador)');
  }
  const emailLower = input.email.trim().toLowerCase();
  // Verifica duplicata
  const [exist] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM users WHERE LOWER(email) = ? AND deleted_at IS NULL LIMIT 1`,
    [emailLower],
  );
  if (exist.length > 0) throw new Error('Email ja cadastrado');

  const senhaUsada = input.senha || gerarSenhaTemporaria();
  const hash = await hashPassword(senhaUsada);

  const permsValidadas = input.permissions
    ? input.permissions.filter(k => PERMISSIONS_VALIDAS.has(k))
    : null;

  const openId = `app-${input.role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // INSERT com fallback: tenta schema completo, cai pro legacy se colunas faltarem
  let insertId: number;
  try {
    const [r] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (openId, email, name, phone, loginMethod, role, password_hash,
                          permissions, active, created_by)
       VALUES (?, ?, ?, ?, 'password', ?, ?, ?, 1, ?)`,
      [openId, emailLower, input.name.trim(), input.phone || null, input.role, hash,
       permsValidadas ? JSON.stringify(permsValidadas) : null,
       input.created_by ?? null],
    );
    insertId = r.insertId;
  } catch (err) {
    if (/Unknown column/i.test((err as Error).message)) {
      // Schema sem permissions/active/created_by — usa legacy
      const [r] = await pool.execute<ResultSetHeader>(
        `INSERT INTO users (openId, email, name, phone, loginMethod, role, password_hash)
         VALUES (?, ?, ?, ?, 'password', ?, ?)`,
        [openId, emailLower, input.name.trim(), input.phone || null, input.role, hash],
      );
      insertId = r.insertId;
    } else {
      throw err;
    }
  }

  // Vincula em tenant_users (idempotente — se ja vinculado, ON DUPLICATE atualiza role)
  await pool.execute(
    `INSERT INTO tenant_users (tenant_id, user_id, role, equipe_id, accepted_at)
     VALUES (1, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE role = VALUES(role), equipe_id = VALUES(equipe_id)`,
    [insertId, input.role, input.equipe_id ?? null],
  );

  return {
    ok: true as const,
    id: insertId,
    email: emailLower,
    name: input.name.trim(),
    role: input.role,
    senha_temporaria: senhaUsada,
    message: `Usuario "${input.name}" criado com role ${input.role}. Senha temporaria gerada.`,
  };
}

export async function atualizarUsuarioAdmin(input: {
  id: number;
  name?: string;
  phone?: string;
  role?: RoleNome;
  equipe_id?: number | null;
  permissions?: string[] | null; // null = usa defaults do role; [] = sem permissoes
  active?: boolean;
}) {
  if (!input.id) throw new Error('id obrigatorio');
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  if (input.name !== undefined) { fields.push('name = ?'); params.push(input.name); }
  if (input.phone !== undefined) { fields.push('phone = ?'); params.push(input.phone || null); }
  if (input.role !== undefined) { fields.push('role = ?'); params.push(input.role); }
  if (input.active !== undefined) {
    try { fields.push('active = ?'); params.push(input.active ? 1 : 0); }
    catch { /* coluna pode nao existir */ }
  }
  if (input.permissions !== undefined) {
    const valid = input.permissions === null
      ? null
      : input.permissions.filter(k => PERMISSIONS_VALIDAS.has(k));
    fields.push('permissions = ?');
    params.push(valid === null ? null : JSON.stringify(valid));
  }
  if (fields.length > 0) {
    params.push(input.id);
    try {
      await pool.execute<ResultSetHeader>(
        `UPDATE users SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        params,
      );
    } catch (err) {
      // Fallback se permissions/active nao existir em prod
      if (/Unknown column/i.test((err as Error).message)) {
        const fLegacy: string[] = [];
        const pLegacy: (string | number | null)[] = [];
        if (input.name !== undefined) { fLegacy.push('name = ?'); pLegacy.push(input.name); }
        if (input.phone !== undefined) { fLegacy.push('phone = ?'); pLegacy.push(input.phone || null); }
        if (input.role !== undefined) { fLegacy.push('role = ?'); pLegacy.push(input.role); }
        if (fLegacy.length > 0) {
          pLegacy.push(input.id);
          await pool.execute(
            `UPDATE users SET ${fLegacy.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
            pLegacy,
          );
        }
      } else { throw err; }
    }
  }
  // Atualiza tenant_users se role/equipe_id mudaram
  if (input.role !== undefined || input.equipe_id !== undefined) {
    await pool.execute(
      `UPDATE tenant_users SET role = COALESCE(?, role), equipe_id = ?
        WHERE user_id = ? AND tenant_id = 1`,
      [input.role ?? null, input.equipe_id ?? null, input.id],
    );
  }
  return { ok: true as const, id: input.id, message: 'Usuario atualizado.' };
}

export async function excluirUsuarioAdmin(id: number) {
  if (!id) throw new Error('id obrigatorio');
  // Soft-delete + desativar
  try {
    await pool.execute(
      `UPDATE users SET deleted_at = NOW(), active = 0 WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  } catch (err) {
    if (/Unknown column/i.test((err as Error).message)) {
      await pool.execute(
        `UPDATE users SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
        [id],
      );
    } else { throw err; }
  }
  return { ok: true as const, message: 'Usuario desativado (soft-delete).' };
}

export async function resetarSenhaUsuario(id: number, novaSenha?: string) {
  if (!id) throw new Error('id obrigatorio');
  const senha = novaSenha || gerarSenhaTemporaria();
  const hash = await hashPassword(senha);
  await pool.execute(
    `UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
    [hash, id],
  );
  return {
    ok: true as const,
    id,
    senha_temporaria: senha,
    message: 'Senha resetada. Envie a nova senha pro usuario.',
  };
}

// Lista os 100 logs mais recentes pra aba Auditoria
export async function listarAuditoriaRecente(limite = 100) {
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT al.id, al.user_id, al.login_attempt, al.ip,
           al.sucesso, al.motivo_falha, al.created_at,
           u.name AS user_name, u.email AS user_email
      FROM auth_logs al
      LEFT JOIN users u ON u.id = al.user_id
     ORDER BY al.created_at DESC
     LIMIT ?
  `, [Number(limite)]);
  return rows;
}
