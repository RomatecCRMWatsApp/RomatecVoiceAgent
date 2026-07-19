// v3.109.0: requireCeoToken lia o cookie ERRADO.
//
// O bug: o middleware procurava `req.cookies.auth_token`, mas o login grava o JWT
// no cookie `zayra_auth` (COOKIE_NAME em services/auth). Resultado: o caminho
// "JWT valido -> libera" NUNCA disparava por cookie. Todas as ~96 rotas
// protegidas caiam no fallback do header X-CEO-Token — inclusive pro proprio CEO
// logado. Foi a causa real dos "sem permissao" que apareceram em campo ao tentar
// excluir e mover fotos.
//
// Segunda mudanca (a pedido do CEO): a exigencia de role admin/owner saiu. O
// sistema e' de uso interno unico; estar logado basta. Quando virar SaaS, o
// controle volta como requireRole(...) por rota, nao como token compartilhado.
//
// Estes testes rodam o middleware de verdade sobre um Express minimo.

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// JWT_SECRET precisa existir ANTES de importar os modulos (fail-fast no import).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(48);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let requireCeoToken: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let issueJWT: any;
let COOKIE_NAME: string;

beforeAll(async () => {
  ({ requireCeoToken } = await import('../middleware/auth'));
  ({ issueJWT, COOKIE_NAME } = await import('../services/auth'));
});

function appComRota() {
  const app = express();
  app.get('/protegida', requireCeoToken, (_req, res) => { res.json({ ok: true }); });
  return app;
}

describe('requireCeoToken — JWT por cookie zayra_auth', () => {
  it('1. JWT de admin no cookie zayra_auth libera (era o bug: cookie errado)', async () => {
    const { token } = issueJWT({ sub: '1', email: 'ceo@romatec.com', role: 'admin' });
    const r = await request(appComRota()).get('/protegida').set('Cookie', `${COOKIE_NAME}=${token}`);
    expect(r.status).toBe(200);
  });

  it('2. o cookie usado e mesmo zayra_auth, nao auth_token', async () => {
    expect(COOKIE_NAME).toBe('zayra_auth');
    const { token } = issueJWT({ sub: '1', email: 'ceo@romatec.com', role: 'admin' });
    // Com o nome ANTIGO nao deve passar (prova que o teste 1 nao passa por acaso).
    const r = await request(appComRota()).get('/protegida').set('Cookie', `auth_token=${token}`);
    expect(r.status).not.toBe(200);
  });

  it('3. colaborador logado tambem passa (gate de role removido na v3.109.0)', async () => {
    const { token } = issueJWT({ sub: '9', email: 'campo@romatec.com', role: 'colaborador' });
    const r = await request(appComRota()).get('/protegida').set('Cookie', `${COOKIE_NAME}=${token}`);
    expect(r.status).toBe(200);
  });

  it('4. Authorization: Bearer continua funcionando (scripts/curl)', async () => {
    const { token } = issueJWT({ sub: '1', email: 'ceo@romatec.com', role: 'admin' });
    const r = await request(appComRota()).get('/protegida').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
  });

  it('5. sem credencial nenhuma continua bloqueado (nao virou rota aberta)', async () => {
    const r = await request(appComRota()).get('/protegida');
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.ok).toBeUndefined();
  });

  it('6. JWT invalido nao libera', async () => {
    const r = await request(appComRota()).get('/protegida').set('Cookie', `${COOKIE_NAME}=nao-e-um-jwt`);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.ok).toBeUndefined();
  });
});
