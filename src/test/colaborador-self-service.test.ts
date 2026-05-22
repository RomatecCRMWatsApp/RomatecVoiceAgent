// v3.24.1: PR B — Colaborador self-service. Smoke tests do middleware
// requireColaboradorOwnership (logica pura, sem HTTP/DB).

import { describe, it, expect, vi } from 'vitest';
import { requireColaboradorOwnership, type AuthedRequest } from '../middleware/auth';
import type { Response, NextFunction } from 'express';
import type { JWTClaims, AuthRole } from '../services/auth';

function makeReq(overrides: Partial<AuthedRequest> = {}): AuthedRequest {
  return {
    params: {},
    query: {},
    headers: {},
    ...overrides,
  } as unknown as AuthedRequest;
}

function makeRes(): Response & { _status?: number; _body?: unknown } {
  const res = {} as Response & { _status?: number; _body?: unknown };
  res.status = vi.fn((c: number) => { res._status = c; return res; }) as unknown as Response['status'];
  res.json = vi.fn((b: unknown) => { res._body = b; return res; }) as unknown as Response['json'];
  return res;
}

function makeUser(over: Partial<JWTClaims> = {}): JWTClaims {
  return {
    sub: '42',
    role: 'colaborador' as AuthRole,
    tenant_id: 1,
    equipe_id: 17,
    name: 'Leonardo da Silva Oliveira',
    jti: 'test-jti',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...over,
  };
}

describe('requireColaboradorOwnership', () => {
  it('401 se requireAuth nao rodou (req.user ausente)', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    requireColaboradorOwnership(req, res, next as NextFunction);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('admin passa sem checar equipe_id (deixa rota generica decidir)', () => {
    const req = makeReq({ user: makeUser({ role: 'admin', equipe_id: null }) });
    const res = makeRes();
    const next = vi.fn();
    requireColaboradorOwnership(req, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res._status).toBeUndefined();
  });

  it('gestor tambem passa', () => {
    const req = makeReq({ user: makeUser({ role: 'gestor', equipe_id: null }) });
    const res = makeRes();
    const next = vi.fn();
    requireColaboradorOwnership(req, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('colaborador sem equipe_id no JWT recebe 403', () => {
    const req = makeReq({ user: makeUser({ role: 'colaborador', equipe_id: null }) });
    const res = makeRes();
    const next = vi.fn();
    requireColaboradorOwnership(req, res, next as NextFunction);
    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ error: expect.stringMatching(/vinculo a equipe_id/i) });
    expect(next).not.toHaveBeenCalled();
  });

  it('colaborador sem param/query (rota generica) passa', () => {
    const req = makeReq({ user: makeUser() });
    const res = makeRes();
    const next = vi.fn();
    requireColaboradorOwnership(req, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('colaborador tenta acessar :colaboradorId DIFERENTE → 403', () => {
    const req = makeReq({
      user: makeUser({ equipe_id: 17 }),
      params: { colaboradorId: '99' },
    });
    const res = makeRes();
    const next = vi.fn();
    requireColaboradorOwnership(req, res, next as NextFunction);
    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ error: expect.stringMatching(/so pode acessar seus proprios dados/) });
  });

  it('colaborador tenta acessar :colaboradorId IGUAL ao seu → passa', () => {
    const req = makeReq({
      user: makeUser({ equipe_id: 17 }),
      params: { colaboradorId: '17' },
    });
    const res = makeRes();
    const next = vi.fn();
    requireColaboradorOwnership(req, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('colaborador tenta query ?funcionario_id=99 (alheio) → 403', () => {
    const req = makeReq({
      user: makeUser({ equipe_id: 17 }),
      query: { funcionario_id: '99' },
    });
    const res = makeRes();
    const next = vi.fn();
    requireColaboradorOwnership(req, res, next as NextFunction);
    expect(res._status).toBe(403);
  });

  it('colaborador com query ?funcionario_id IGUAL ao seu → passa', () => {
    const req = makeReq({
      user: makeUser({ equipe_id: 17 }),
      query: { funcionario_id: '17' },
    });
    const res = makeRes();
    const next = vi.fn();
    requireColaboradorOwnership(req, res, next as NextFunction);
    expect(next).toHaveBeenCalled();
  });

  it('aceita variacoes de param: funcionarioId, equipeId, colaborador_id', () => {
    for (const key of ['funcionarioId', 'equipeId', 'colaborador_id']) {
      const req = makeReq({
        user: makeUser({ equipe_id: 17 }),
        params: { [key]: '99' },
      });
      const res = makeRes();
      const next = vi.fn();
      requireColaboradorOwnership(req, res, next as NextFunction);
      expect(res._status, `param ${key} deveria bloquear`).toBe(403);
    }
  });
});

describe('Tela /minha-quinzena.html — smoke estrutural', () => {
  it('contem elementos chave do front', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'minha-quinzena.html'),
      'utf8',
    );
    // Cards principais
    expect(html).toContain('Saldo a Receber');
    expect(html).toContain('Dias da Quinzena');
    expect(html).toContain('Vales Recebidos');
    // Botoes obrigatorios
    expect(html).toMatch(/id="btnSair"/);
    expect(html).toMatch(/id="btnHistorico"/);
    // Chama API correta
    expect(html).toContain("'/api/minha-quinzena'");
    expect(html).toContain("'/api/minha-quinzena/historico'");
    expect(html).toContain("'/api/auth/me'");
    expect(html).toContain("'/api/auth/logout'");
    // Redireciona 401 pra /login
    expect(html).toMatch(/status === 401[\s\S]*?\/login/);
    // Mobile-first viewport
    expect(html).toMatch(/viewport[\s\S]*?width=device-width/);
    // safe-area pra notch iOS
    expect(html).toContain('safe-area-inset-top');
  });
});
