// v3.23.2: garante que package.json eh a unica fonte da verdade pra versao.
//
// Antes a versao vivia em 3 arquivos (package.json, identity.ts, sw.js cache key)
// que precisavam ser bumpados juntos. Esquecer um quebrava o deploy de jeitos
// silenciosos:
//  - esquecer identity.ts -> badge no header continua mostrando versao antiga
//  - esquecer sw.js       -> Service Worker nao invalida cache, PWA serve HTML antigo
//
// Este teste verifica que:
//  1. AGENT_IDENTITY.version === package.json.version (identity le do pkg em runtime)
//  2. sw.js no disco contem o placeholder __APP_VERSION__ (nao mais hardcoded)
//  3. A rota Express /sw.js substitui o placeholder pela versao real

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import request from 'supertest';

const REPO_ROOT = join(__dirname, '..', '..');
const pkg = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
) as { version: string };
const swSource = readFileSync(
  join(__dirname, '..', 'public', 'sw.js'),
  'utf8',
);

describe('versao — fonte unica (package.json)', () => {
  it('AGENT_IDENTITY.version reflete package.json.version', async () => {
    const { AGENT_IDENTITY } = await import('../agent/identity');
    expect(AGENT_IDENTITY.version).toBe(pkg.version);
  });

  it('sw.js no disco usa o placeholder __APP_VERSION__ (nao hardcoded)', () => {
    expect(swSource).toContain("'zayra-v__APP_VERSION__'");
    // nao pode ter mais nenhuma string hardcoded "zayra-v3.x.y" como CACHE
    const cacheLine = swSource.match(/^const CACHE\s*=.*$/m);
    expect(cacheLine).not.toBeNull();
    expect(cacheLine![0]).not.toMatch(/zayra-v\d+\.\d+\.\d+/);
  });

  it('rota Express /sw.js injeta a versao atual', async () => {
    // Mini app que reproduz APENAS a logica da rota (sem subir o server inteiro,
    // que tentaria conectar no MySQL e nas APIs externas).
    const { AGENT_IDENTITY } = await import('../agent/identity');
    const app = express();
    app.get('/sw.js', (_req, res) => {
      const source = readFileSync(
        join(__dirname, '..', 'public', 'sw.js'),
        'utf8',
      );
      const injected = source.replace(/__APP_VERSION__/g, AGENT_IDENTITY.version);
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(injected);
    });

    const resp = await request(app).get('/sw.js');
    expect(resp.status).toBe(200);
    expect(resp.headers['content-type']).toMatch(/application\/javascript/);
    // A versao foi substituida — nao pode mais ter o placeholder
    expect(resp.text).not.toContain('__APP_VERSION__');
    // E tem que aparecer com a versao atual do package.json
    expect(resp.text).toContain(`'zayra-v${pkg.version}'`);
  });
});
