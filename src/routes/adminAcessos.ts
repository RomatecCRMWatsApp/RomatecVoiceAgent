// v3.24.2: PR C — Admin de gestão de acessos de colaboradores.
//
// Endpoints (todos protegidos com requireAuth + requireRole('admin', 'gestor')):
//   GET    /api/admin/colaboradores              → lista equipe + status de acesso
//   POST   /api/admin/colaboradores/:id/criar-acesso
//   POST   /api/admin/colaboradores/:id/resetar-senha
//   POST   /api/admin/colaboradores/:id/enviar-credenciais-whatsapp
//   POST   /api/admin/colaboradores/:id/desativar-acesso
//
// O endpoint criar-acesso cria user + tenant_users (role='colaborador',
// equipe_id=:id) com senha temporária aleatória de 8 chars sem ambiguidade.
// Retorna a senha plana UMA UNICA VEZ no response (admin anota).
//
// resetar-senha gera nova senha + atualiza hash + retorna plana 1x.
// enviar-credenciais-whatsapp manda template via Z-API pro telefone do
// colaborador (precisa ter colaborador.telefone preenchido).
// desativar-acesso seta users.deleted_at = NOW() (soft delete).

import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { requireAuth, requireRole } from '../middleware/auth';
import { sendReply as sendWhatsAppText } from '../integrations/whatsapp';
import { getValidacaoBaseUrl } from '../integrations/propostasConsultoria';
import {
  gerarSenhaTemporaria, montarMensagemCredenciais, emailPadrao,
} from '../services/admin-acessos-helpers';

const router = Router();
router.use(requireAuth, requireRole('admin', 'gestor', 'owner'));

const TENANT_ID_PADRAO = 1;

interface EquipeRow extends RowDataPacket {
  id: number; nome: string; funcao: string | null;
  telefone: string | null; ativo: number;
}
interface UserRow extends RowDataPacket {
  id: number; email: string; name: string; phone: string | null;
  deleted_at: Date | string | null;
}
interface TenantUserRow extends RowDataPacket {
  id: number; user_id: number; role: string; equipe_id: number | null;
}

async function buscarEquipe(id: number): Promise<EquipeRow | null> {
  const [rows] = await pool.execute<EquipeRow[]>(
    `SELECT id, nome, funcao, telefone, ativo FROM romatec_obra_equipe WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

// ─── GET /api/admin/colaboradores ─────────────────────────────────────
router.get('/colaboradores', async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT e.id, e.nome, e.funcao, e.telefone, e.valor_dia, e.ativo,
              tu.user_id, tu.role,
              u.email, u.deleted_at
         FROM romatec_obra_equipe e
         LEFT JOIN tenant_users tu ON tu.equipe_id = e.id AND tu.role = 'colaborador'
         LEFT JOIN users u ON u.id = tu.user_id
        ORDER BY e.ativo DESC, e.nome ASC`,
    );
    res.json({
      total: rows.length,
      itens: rows.map((r) => ({
        equipe_id: Number(r.id),
        nome: r.nome,
        funcao: r.funcao ?? null,
        telefone: r.telefone ?? null,
        ativo: Number(r.ativo) === 1,
        acesso: r.user_id
          ? {
              user_id: Number(r.user_id),
              email: r.email,
              role: r.role,
              status: r.deleted_at ? 'desativado' : 'ativo',
            }
          : null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── POST /api/admin/colaboradores/:id/criar-acesso ───────────────────
router.post('/colaboradores/:id/criar-acesso', async (req: Request, res: Response) => {
  try {
    const equipeId = Number(req.params.id);
    if (!Number.isFinite(equipeId)) {
      res.status(400).json({ error: 'id de equipe invalido' });
      return;
    }
    const equipe = await buscarEquipe(equipeId);
    if (!equipe) {
      res.status(404).json({ error: 'colaborador nao encontrado em romatec_obra_equipe' });
      return;
    }

    const body = (req.body || {}) as { email?: string; senha_inicial?: string };
    const email = (body.email?.trim().toLowerCase()) || emailPadrao(equipeId, equipe.nome);

    // Verifica se ja existe user com esse email
    const [usersExist] = await pool.execute<UserRow[]>(
      `SELECT id, email, deleted_at FROM users WHERE email = ? LIMIT 1`,
      [email],
    );
    if (usersExist.length > 0) {
      res.status(409).json({
        error: `Ja existe um user com email ${email}. Use POST /resetar-senha pra gerar nova senha, ou escolha outro email no body.`,
        existing_user_id: usersExist[0].id,
      });
      return;
    }

    // Gera senha (ou usa fornecida)
    const senha = body.senha_inicial && body.senha_inicial !== 'auto'
      ? body.senha_inicial
      : gerarSenhaTemporaria(8);
    if (senha.length < 8) {
      res.status(400).json({ error: 'senha_inicial deve ter ao menos 8 chars (ou use "auto")' });
      return;
    }
    const hash = await bcrypt.hash(senha, 12);

    // INSERT em users — schema hibrido (legacy openId + SaaS password_hash)
    const openId = `colab-${equipeId}-${Date.now()}`;
    const [insUser] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (openId, email, name, phone, loginMethod, role, password_hash)
       VALUES (?, ?, ?, ?, 'password', 'user', ?)`,
      [openId, email, equipe.nome, equipe.telefone, hash],
    );
    const userId = insUser.insertId;

    // INSERT em tenant_users
    await pool.execute<ResultSetHeader>(
      `INSERT INTO tenant_users (tenant_id, user_id, role, equipe_id)
       VALUES (?, ?, 'colaborador', ?)`,
      [TENANT_ID_PADRAO, userId, equipeId],
    );

    res.json({
      ok: true,
      user_id: userId,
      equipe_id: equipeId,
      nome: equipe.nome,
      login: email,
      senha_temporaria: senha,    // ← unica resposta com senha plana
      forcar_troca_senha: true,
      url_login: getValidacaoBaseUrl().replace(/\/+$/, '') + '/login',
      aviso: '⚠️ Anote a senha AGORA. Nao sera reimpressa.',
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── POST /api/admin/colaboradores/:id/resetar-senha ──────────────────
router.post('/colaboradores/:id/resetar-senha', async (req: Request, res: Response) => {
  try {
    const equipeId = Number(req.params.id);
    const [tuRows] = await pool.execute<TenantUserRow[]>(
      `SELECT tu.id, tu.user_id, tu.role, tu.equipe_id
         FROM tenant_users tu
        WHERE tu.equipe_id = ? AND tu.role = 'colaborador'
        LIMIT 1`,
      [equipeId],
    );
    if (tuRows.length === 0) {
      res.status(404).json({ error: 'colaborador sem acesso cadastrado. Use POST /criar-acesso primeiro.' });
      return;
    }
    const userId = tuRows[0].user_id;

    const senha = gerarSenhaTemporaria(8);
    const hash = await bcrypt.hash(senha, 12);
    await pool.execute(
      `UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL,
                        deleted_at = NULL
                  WHERE id = ?`,
      [hash, userId],
    );

    const [u] = await pool.execute<UserRow[]>(
      `SELECT email, name FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );
    res.json({
      ok: true,
      user_id: userId,
      equipe_id: equipeId,
      nome: u[0]?.name,
      login: u[0]?.email,
      senha_temporaria: senha,
      url_login: getValidacaoBaseUrl().replace(/\/+$/, '') + '/login',
      aviso: '⚠️ Anote a senha AGORA. Nao sera reimpressa.',
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── POST /api/admin/colaboradores/:id/enviar-credenciais-whatsapp ────
// Body opcional: { senha: "xxxx" }. Se nao passar, reseta a senha primeiro.
router.post('/colaboradores/:id/enviar-credenciais-whatsapp', async (req: Request, res: Response) => {
  try {
    const equipeId = Number(req.params.id);
    const body = (req.body || {}) as { senha?: string; resetar?: boolean };

    const equipe = await buscarEquipe(equipeId);
    if (!equipe) {
      res.status(404).json({ error: 'colaborador nao encontrado' });
      return;
    }
    if (!equipe.telefone) {
      res.status(400).json({ error: `Colaborador ${equipe.nome} sem telefone cadastrado em romatec_obra_equipe. Atualize antes de enviar credenciais.` });
      return;
    }

    const [tuRows] = await pool.execute<TenantUserRow[]>(
      `SELECT tu.user_id FROM tenant_users tu
        WHERE tu.equipe_id = ? AND tu.role = 'colaborador' LIMIT 1`,
      [equipeId],
    );
    if (tuRows.length === 0) {
      res.status(404).json({ error: 'colaborador sem acesso. Use POST /criar-acesso primeiro.' });
      return;
    }
    const userId = tuRows[0].user_id;

    let senha = body.senha;
    if (!senha || body.resetar) {
      senha = gerarSenhaTemporaria(8);
      const hash = await bcrypt.hash(senha, 12);
      await pool.execute(
        `UPDATE users SET password_hash = ?, failed_login_attempts = 0,
                          locked_until = NULL, deleted_at = NULL
                    WHERE id = ?`,
        [hash, userId],
      );
    }

    const [u] = await pool.execute<UserRow[]>(
      `SELECT email FROM users WHERE id = ? LIMIT 1`, [userId],
    );
    const login = u[0]?.email || '';
    const urlLogin = getValidacaoBaseUrl().replace(/\/+$/, '') + '/login';
    const mensagem = montarMensagemCredenciais({
      nome: equipe.nome.split(' ')[0],
      login,
      senha,
      urlLogin,
    });

    const r = await sendWhatsAppText(equipe.telefone, mensagem);
    res.json({
      ok: true,
      enviado_para: r.phone,
      message_id: r.messageId ?? null,
      senha_resetada: !body.senha || body.resetar === true,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── POST /api/admin/colaboradores/:id/desativar-acesso ───────────────
// Soft delete: seta deleted_at em users. Mantem tenant_users intacto pra
// auditoria. Login subsequente retorna "Login ou senha invalidos" (porque
// buscarUserPorLogin filtra deleted_at IS NULL).
router.post('/colaboradores/:id/desativar-acesso', async (req: Request, res: Response) => {
  try {
    const equipeId = Number(req.params.id);
    const [tuRows] = await pool.execute<TenantUserRow[]>(
      `SELECT user_id FROM tenant_users WHERE equipe_id = ? AND role = 'colaborador' LIMIT 1`,
      [equipeId],
    );
    if (tuRows.length === 0) {
      res.status(404).json({ error: 'colaborador sem acesso cadastrado' });
      return;
    }
    const userId = tuRows[0].user_id;
    await pool.execute(
      `UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [userId],
    );
    res.json({ ok: true, user_id: userId, desativado_em: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
