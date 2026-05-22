// v3.25.0: Rotas da aba Configuracoes > Usuarios.
// Todas exigem JWT admin/owner (requireRole).
//
// Endpoints:
//   GET    /api/admin/users-config                  → lista todos os users
//   POST   /api/admin/users-config                  → cria user com role + permissoes
//   PUT    /api/admin/users-config/:id              → atualiza dados/role/permissoes/active
//   DELETE /api/admin/users-config/:id              → soft-delete
//   POST   /api/admin/users-config/:id/reset-senha  → reseta senha + retorna temporaria
//   GET    /api/admin/permissions-catalog           → catalogo de permissoes do sistema
//   GET    /api/admin/auditoria                     → ultimos 100 auth_logs

import { Router, type Request, type Response } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  listarUsuariosAdmin,
  criarUsuarioAdmin,
  atualizarUsuarioAdmin,
  excluirUsuarioAdmin,
  resetarSenhaUsuario,
  listarAuditoriaRecente,
} from '../integrations/adminUsers';
import {
  CATEGORIAS_PERMISSOES,
  DEFAULT_PERMISSIONS_BY_ROLE,
  type RoleNome,
} from '../constants/permissoesSistema';

const router = Router();
router.use(requireAuth, requireRole('admin', 'owner'));

router.get('/permissions-catalog', (_req: Request, res: Response) => {
  res.json({
    categorias: CATEGORIAS_PERMISSOES,
    defaults_por_role: DEFAULT_PERMISSIONS_BY_ROLE,
  });
});

router.get('/users-config', async (_req: Request, res: Response) => {
  try {
    const users = await listarUsuariosAdmin();
    res.json({ total: users.length, items: users });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.post('/users-config', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      email?: string; name?: string; phone?: string;
      role?: RoleNome; equipe_id?: number | null;
      permissions?: string[] | null; senha?: string;
    };
    const createdBy = (req as { user?: { sub?: number } }).user?.sub;
    const r = await criarUsuarioAdmin({
      email: String(body.email || ''),
      name: String(body.name || ''),
      phone: body.phone,
      role: (body.role || 'colaborador') as RoleNome,
      equipe_id: body.equipe_id ?? null,
      permissions: body.permissions ?? null,
      senha: body.senha,
      created_by: createdBy,
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.put('/users-config/:id', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      name?: string; phone?: string;
      role?: RoleNome; equipe_id?: number | null;
      permissions?: string[] | null; active?: boolean;
    };
    const r = await atualizarUsuarioAdmin({
      id: Number(req.params.id),
      name: body.name,
      phone: body.phone,
      role: body.role,
      equipe_id: body.equipe_id,
      permissions: body.permissions,
      active: body.active,
    });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/users-config/:id', async (req: Request, res: Response) => {
  try {
    const r = await excluirUsuarioAdmin(Number(req.params.id));
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/users-config/:id/reset-senha', async (req: Request, res: Response) => {
  try {
    const body = req.body as { senha?: string };
    const r = await resetarSenhaUsuario(Number(req.params.id), body.senha);
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/auditoria', async (req: Request, res: Response) => {
  try {
    const limite = Number(req.query.limite) || 100;
    const items = await listarAuditoriaRecente(limite);
    res.json({ total: items.length, items });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
