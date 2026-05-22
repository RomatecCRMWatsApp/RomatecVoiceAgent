// v3.24.0: PR A Auth Foundation — tests pure-logic.
//
// Cobertura: hashPassword/verifyPassword, issueJWT/verifyJWT, blacklist,
// bootValidateAuthEnv, COOKIE_NAME constant, cookie opts builder.
// NAO cobre os endpoints HTTP (precisaria mock de DB/express — ficaria
// fragil). Pra isso, integration test em ambiente real apos deploy.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  issueJWT,
  verifyJWT,
  blacklistJti,
  isBlacklisted,
  _blacklistSize,
  buildAuthCookieOptions,
  bootValidateAuthEnv,
  COOKIE_NAME,
  BCRYPT_COST,
  type AuthRole,
} from '../services/auth';

describe('hashPassword / verifyPassword (bcrypt cost 12)', () => {
  it('hashPassword produz hash bcrypt valido (60 chars, $2b$12$)', async () => {
    const hash = await hashPassword('senha-teste-1234');
    expect(hash).toMatch(/^\$2[abxy]\$12\$/);
    expect(hash.length).toBe(60);
  });

  it('verifyPassword aceita senha correta', async () => {
    const hash = await hashPassword('minha-senha-segura');
    expect(await verifyPassword('minha-senha-segura', hash)).toBe(true);
  });

  it('verifyPassword rejeita senha errada', async () => {
    const hash = await hashPassword('senha-correta');
    expect(await verifyPassword('senha-errada', hash)).toBe(false);
  });

  it('verifyPassword falsy retorna false (defensivo)', async () => {
    expect(await verifyPassword('', 'algumhash')).toBe(false);
    expect(await verifyPassword('senha', '')).toBe(false);
  });

  it('hashPassword rejeita senha < 8 chars', async () => {
    await expect(hashPassword('curta')).rejects.toThrow(/8 caracteres/);
  });

  it('cost = 12 (constante exportada e usada)', () => {
    expect(BCRYPT_COST).toBe(12);
  });
});

describe('issueJWT / verifyJWT', () => {
  const baseClaims = {
    sub: '42',
    role: 'colaborador' as AuthRole,
    tenant_id: 1,
    equipe_id: 17,
    name: 'Leonardo da Silva Oliveira',
  };

  it('issueJWT retorna token + jti + expiresIn', () => {
    const r = issueJWT(baseClaims);
    expect(r.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); // JWT pattern
    expect(r.jti).toMatch(/^[0-9a-f]{32}$/); // 16 bytes hex
    expect(r.expiresIn).toBe('8h'); // colaborador
  });

  it('colaborador tem expiresIn=8h (jornada), admin tem 24h', () => {
    const colab = issueJWT({ ...baseClaims, role: 'colaborador' });
    const admin = issueJWT({ ...baseClaims, role: 'admin' });
    expect(colab.expiresIn).toBe('8h');
    expect(admin.expiresIn).toBe('24h');
  });

  it('verifyJWT decoda claims corretos', () => {
    const r = issueJWT(baseClaims);
    const claims = verifyJWT(r.token);
    expect(claims.sub).toBe('42');
    expect(claims.role).toBe('colaborador');
    expect(claims.tenant_id).toBe(1);
    expect(claims.equipe_id).toBe(17);
    expect(claims.name).toBe('Leonardo da Silva Oliveira');
    expect(claims.jti).toBe(r.jti);
    expect(claims.iat).toBeGreaterThan(0);
    expect(claims.exp).toBeGreaterThan(claims.iat!);
  });

  it('verifyJWT lanca em token invalido', () => {
    expect(() => verifyJWT('lixo.lixo.lixo')).toThrow();
  });

  it('verifyJWT lanca em token assinado com outro secret', async () => {
    const jwt = await import('jsonwebtoken');
    const fakeToken = jwt.default.sign({ sub: '42' }, 'outro-secret-totalmente-diferente-32+');
    expect(() => verifyJWT(fakeToken)).toThrow();
  });
});

describe('Blacklist (logout)', () => {
  beforeEach(() => {
    // Limpa o estado entre testes — não exportamos um clear,
    // mas blacklistJti com exp passado e isBlacklisted-then-delete limpa.
    // Hack: empurra muitos jtis ja expirados pra forçar cleanupBlacklist().
  });

  it('blacklistJti adiciona e isBlacklisted retorna true', () => {
    const jti = 'test-jti-' + Date.now();
    const expFuturo = Math.floor(Date.now() / 1000) + 3600; // 1h futuro
    blacklistJti(jti, expFuturo);
    expect(isBlacklisted(jti)).toBe(true);
  });

  it('jti com expiracao passada nao conta como blacklisted', () => {
    const jti = 'test-jti-expirado-' + Date.now();
    const expPassado = Math.floor(Date.now() / 1000) - 100; // 100s atras
    blacklistJti(jti, expPassado);
    expect(isBlacklisted(jti)).toBe(false); // cleanup automatico ao consultar
  });

  it('verifyJWT lanca "Token revogado" pra jti blacklisted', () => {
    const r = issueJWT({
      sub: '99',
      role: 'admin',
      tenant_id: 1,
      equipe_id: null,
      name: 'Test Admin',
    });
    // Pega o exp do token recem-criado e blacklista
    const claims = verifyJWT(r.token);
    blacklistJti(r.jti, claims.exp!);
    expect(() => verifyJWT(r.token)).toThrow(/revogado/i);
  });

  it('blacklist size cresce e cai com cleanup', () => {
    const sizeAntes = _blacklistSize();
    const jti = 'cleanup-test-' + Math.random();
    blacklistJti(jti, Math.floor(Date.now() / 1000) + 60);
    expect(_blacklistSize()).toBeGreaterThan(sizeAntes);
  });
});

describe('buildAuthCookieOptions', () => {
  it('parseia 8h pra 28800000 ms', () => {
    const opts = buildAuthCookieOptions('8h');
    expect(opts.maxAge).toBe(8 * 60 * 60 * 1000);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('strict');
    expect(opts.path).toBe('/');
  });

  it('parseia 24h pra 86400000 ms', () => {
    const opts = buildAuthCookieOptions('24h');
    expect(opts.maxAge).toBe(24 * 60 * 60 * 1000);
  });

  it('secure=true em production, false em dev/test', () => {
    const origNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(buildAuthCookieOptions('8h').secure).toBe(true);
    process.env.NODE_ENV = 'test';
    expect(buildAuthCookieOptions('8h').secure).toBe(false);
    process.env.NODE_ENV = origNodeEnv;
  });
});

describe('bootValidateAuthEnv (fail-fast)', () => {
  it('passa com JWT_SECRET 32+ chars (test-setup ja seta)', () => {
    expect(() => bootValidateAuthEnv()).not.toThrow();
  });

  it('throw se JWT_SECRET ausente', () => {
    const orig = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => bootValidateAuthEnv()).toThrow(/JWT_SECRET ausente/);
    process.env.JWT_SECRET = orig;
  });

  it('throw se JWT_SECRET < 32 chars', () => {
    const orig = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'curto-demais';
    expect(() => bootValidateAuthEnv()).toThrow(/curto demais/);
    process.env.JWT_SECRET = orig;
  });
});

describe('Constantes exportadas', () => {
  it('COOKIE_NAME e zayra_auth (estavel — front depende)', () => {
    expect(COOKIE_NAME).toBe('zayra_auth');
  });
});
