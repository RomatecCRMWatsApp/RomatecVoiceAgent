// v3.50.0: testes do PIN secundario + admin bypass.
//
// Cobre:
//  - isAdminBypassPin: admin/owner true; outros roles false
//  - validarFormatoPin: aceita 4 digitos, rejeita o resto
//  - hashPin / compararPin (roundtrip bcrypt)
//  - middleware requirePin: bypass admin/owner, exige PIN pros outros,
//    aceita X-CEO-Token legacy quando sem sessao
//  - migration: arquivo exporta runPinSecundarioMigrations, SQL contem
//    as 4 colunas esperadas
//  - server.ts: migration wired, requirePin importado, aplicado nas 6 rotas
//  - rotas /api/auth/me/pin/* registradas

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Request, Response, NextFunction } from 'express';
import {
  isAdminBypassPin,
  validarFormatoPin,
  hashPin,
  compararPin,
  PIN_LENGTH,
  PIN_MAX_FAILED_ATTEMPTS,
  PIN_LOCK_DURATION_MS,
} from '../services/pinSecundario';
import { requirePin } from '../middleware/requirePin';
import type { JWTClaims, AuthRole } from '../services/auth';

function mockClaims(role: AuthRole): JWTClaims {
  return {
    sub: '42',
    role,
    tenant_id: 1,
    equipe_id: null,
    name: 'Teste',
    jti: 'jti-test',
  };
}

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('pinSecundario — helpers puros (v3.50.0)', () => {
  describe('isAdminBypassPin', () => {
    it('retorna true para admin', () => {
      expect(isAdminBypassPin(mockClaims('admin'))).toBe(true);
    });
    it('retorna true para owner', () => {
      expect(isAdminBypassPin(mockClaims('owner'))).toBe(true);
    });
    it('retorna false para outros roles', () => {
      for (const r of ['gestor', 'engenheiro', 'financeiro', 'colaborador', 'viewer'] as AuthRole[]) {
        expect(isAdminBypassPin(mockClaims(r))).toBe(false);
      }
    });
    it('retorna false quando claims ausente', () => {
      expect(isAdminBypassPin(undefined)).toBe(false);
      expect(isAdminBypassPin(null)).toBe(false);
    });
  });

  describe('validarFormatoPin', () => {
    it('aceita 4 digitos numericos', () => {
      expect(validarFormatoPin('1234')).toBe(true);
      expect(validarFormatoPin('0000')).toBe(true);
      expect(validarFormatoPin('9999')).toBe(true);
    });
    it('rejeita comprimento diferente de 4', () => {
      expect(validarFormatoPin('123')).toBe(false);
      expect(validarFormatoPin('12345')).toBe(false);
      expect(validarFormatoPin('')).toBe(false);
    });
    it('rejeita caracteres nao-numericos', () => {
      expect(validarFormatoPin('12a4')).toBe(false);
      expect(validarFormatoPin('abcd')).toBe(false);
      expect(validarFormatoPin('12-4')).toBe(false);
    });
    it('rejeita tipos nao-string', () => {
      expect(validarFormatoPin(1234)).toBe(false);
      expect(validarFormatoPin(null)).toBe(false);
      expect(validarFormatoPin(undefined)).toBe(false);
    });
  });

  describe('hashPin + compararPin (roundtrip)', () => {
    it('hash bate com o PIN original', async () => {
      const hash = await hashPin('1234');
      expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
      expect(await compararPin('1234', hash)).toBe(true);
      expect(await compararPin('4321', hash)).toBe(false);
    });

    it('hashes do mesmo PIN sao diferentes (salt aleatorio)', async () => {
      const a = await hashPin('1234');
      const b = await hashPin('1234');
      expect(a).not.toBe(b);
    });

    it('hashPin lanca erro pra formato invalido', async () => {
      await expect(hashPin('abc')).rejects.toThrow(/4 digitos/);
    });
  });

  describe('constantes', () => {
    it('PIN_LENGTH = 4', () => expect(PIN_LENGTH).toBe(4));
    it('PIN_MAX_FAILED_ATTEMPTS = 5', () => expect(PIN_MAX_FAILED_ATTEMPTS).toBe(5));
    it('PIN_LOCK_DURATION_MS = 15 min', () => expect(PIN_LOCK_DURATION_MS).toBe(15 * 60 * 1000));
  });
});

describe('requirePin middleware (v3.50.0)', () => {
  it('admin bypassa sem PIN — next() chamado', () => {
    const req = { user: mockClaims('admin'), body: {}, headers: {} } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    requirePin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('owner bypassa sem PIN', () => {
    const req = { user: mockClaims('owner'), body: {}, headers: {} } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    requirePin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('sem sessao + sem X-CEO-Token = 401', () => {
    const req = { body: {}, headers: {} } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    delete process.env.CEO_API_TOKEN;
    requirePin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('X-CEO-Token valido bypassa quando sem sessao', () => {
    const oldEnv = process.env.CEO_API_TOKEN;
    process.env.CEO_API_TOKEN = 'token-secreto';
    const req = { body: {}, headers: { 'x-ceo-token': 'token-secreto' } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    requirePin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    if (oldEnv === undefined) delete process.env.CEO_API_TOKEN; else process.env.CEO_API_TOKEN = oldEnv;
  });

  it('role nao-admin sem PIN retorna 403 PIN_REQUIRED', () => {
    const req = {
      user: mockClaims('gestor'),
      body: {},
      headers: {},
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    requirePin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    const callArgs = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.code).toBe('PIN_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });
});

describe('migration pin-secundario (v3.50.0)', () => {
  it('exporta runPinSecundarioMigrations', async () => {
    const mod = await import('../database/migrations-pin-secundario');
    expect(typeof mod.runPinSecundarioMigrations).toBe('function');
  });

  it('SQL contem as 4 colunas esperadas em users', () => {
    const code = readFileSync(
      join(__dirname, '..', 'database', 'migrations-pin-secundario.ts'),
      'utf8',
    );
    expect(code).toContain('pin_hash VARCHAR(255) NULL');
    expect(code).toContain('pin_set_at DATETIME NULL');
    expect(code).toContain('pin_failed_attempts INT UNSIGNED NOT NULL DEFAULT 0');
    expect(code).toContain('pin_locked_until DATETIME NULL');
  });

  it('checa columnExists pra ser idempotente', () => {
    const code = readFileSync(
      join(__dirname, '..', 'database', 'migrations-pin-secundario.ts'),
      'utf8',
    );
    expect(code).toContain('columnExists');
    expect(code).toMatch(/Duplicate column\|already exists/i);
  });
});

describe('server.ts — wiring PIN (v3.50.0)', () => {
  const serverTs = readFileSync(
    join(__dirname, '..', 'server.ts'),
    'utf8',
  );

  it('migration pin-secundario eh chamada no boot', () => {
    expect(serverTs).toContain("await import('./database/migrations-pin-secundario')");
    expect(serverTs).toContain('runPinSecundarioMigrations()');
  });

  it('requirePin esta importado', () => {
    expect(serverTs).toContain("from './middleware/requirePin'");
  });

  it('aplicado em DELETE /api/recibos/:id (excluir recibo)', () => {
    expect(serverTs).toMatch(/app\.delete\(['"]\/api\/recibos\/:id['"]\s*,\s*requireAuth\s*,\s*requirePin/);
  });

  it('aplicado em POST /api/recibos/:id/cancelar', () => {
    expect(serverTs).toMatch(/\/api\/recibos\/:id\/cancelar['"]\s*,\s*requireAuth\s*,\s*requirePin/);
  });

  it('aplicado em POST /api/recibos/disparar (fechar quinzena)', () => {
    expect(serverTs).toMatch(/\/api\/recibos\/disparar['"]\s*,\s*requireCeoToken\s*,\s*requirePin/);
  });

  it('aplicado em POST /api/folha/fechar', () => {
    expect(serverTs).toMatch(/\/api\/folha\/fechar['"]\s*,\s*requireAuth\s*,\s*requirePin/);
  });

  it('aplicado em DELETE /api/laudos-demarcacao/:id', () => {
    expect(serverTs).toMatch(/\/api\/laudos-demarcacao\/:id['"]\s*,\s*requireCeoToken\s*,\s*requirePin/);
  });

  it('aplicado em DELETE /api/propostas/:id', () => {
    expect(serverTs).toMatch(/app\.delete\(['"]\/api\/propostas\/:id['"]\s*,\s*requireCeoToken\s*,\s*requirePin/);
  });

  it('aplicado em POST /api/notas-fiscais/:id/cancelar', () => {
    expect(serverTs).toMatch(/\/api\/notas-fiscais\/:id\/cancelar['"]\s*,\s*requireAuth\s*,\s*requirePin/);
  });
});

describe('routes/auth.ts — endpoints /api/auth/me/pin/* (v3.50.0)', () => {
  const authTs = readFileSync(
    join(__dirname, '..', 'routes', 'auth.ts'),
    'utf8',
  );

  it('GET /me/pin/status registrado', () => {
    expect(authTs).toMatch(/router\.get\(['"]\/me\/pin\/status['"]/);
  });

  it('POST /me/pin (cadastra/troca) registrado', () => {
    expect(authTs).toMatch(/router\.post\(['"]\/me\/pin['"]/);
  });

  it('DELETE /me/pin (remove) registrado', () => {
    expect(authTs).toMatch(/router\.delete\(['"]\/me\/pin['"]/);
  });

  it('cadastro/troca exige senha atual antes do PIN (anti-takeover)', () => {
    expect(authTs).toContain('Senha atual obrigatoria');
    expect(authTs).toContain('verifyPassword');
  });
});

describe('frontend obras.html — UI PIN + modal (v3.50.0)', () => {
  const obrasHtml = readFileSync(
    join(__dirname, '..', 'public', 'obras.html'),
    'utf8',
  );

  it('aba Seguranca aparece em Configuracoes', () => {
    expect(obrasHtml).toContain('data-sub="seguranca"');
    expect(obrasHtml).toContain('🔐 Segurança');
  });

  it('renderCfgSeguranca chama /api/auth/me/pin/status', () => {
    expect(obrasHtml).toContain("api('/api/auth/me/pin/status')");
  });

  it('helper pinConfirmar exposto em window.pinConfirmar', () => {
    expect(obrasHtml).toContain('async function pinConfirmar(');
    expect(obrasHtml).toContain('window.pinConfirmar = pinConfirmar');
  });

  it('modal exige 4 digitos numericos (regex client-side)', () => {
    expect(obrasHtml).toMatch(/\/\^\\d\{4\}\$\//);
  });

  it('admin bypass na UI — modal retorna string vazia se bypass', () => {
    expect(obrasHtml).toContain('if (st && st.bypass) return');
  });

  it('handler data-rec-del chama pinConfirmar antes da DELETE', () => {
    expect(obrasHtml).toMatch(/data-rec-del[\s\S]*?pinConfirmar/);
  });

  it('handler data-nf-cancelar chama pinConfirmar', () => {
    expect(obrasHtml).toMatch(/data-nf-cancelar[\s\S]*?pinConfirmar/);
  });

  it('handler data-laudo-del chama pinConfirmar', () => {
    expect(obrasHtml).toMatch(/data-laudo-del[\s\S]*?pinConfirmar/);
  });

  it('handler data-del-prop chama pinConfirmar', () => {
    expect(obrasHtml).toMatch(/data-del-prop[\s\S]*?pinConfirmar/);
  });
});
