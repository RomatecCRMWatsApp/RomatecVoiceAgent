// v3.124.0 — Teste de INTEGRAÇÃO do gate com Express de verdade.
//
// Existe por causa de uma suposição que, se estiver errada, derruba o login em
// produção: dentro de `app.use('/api', mw)` o Express entrega `req.path` já
// RELATIVO ao mount ('/auth/login', não '/api/auth/login'). A allowlist é
// escrita em cima disso. Se o Express mudasse esse comportamento, TODA a
// allowlist deixaria de casar e até o login passaria a exigir... login.
//
// Por isso aqui não se testa a função pura (isso é o outro arquivo) e sim o
// comportamento HTTP observável, montando o gate igual ao server.ts.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { apiAuthGate } from '../middleware/apiAuthGate';

function appDeTeste() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // exatamente como no server.ts, antes de qualquer rota /api
  app.use('/api', apiAuthGate);
  // rotas de mentira cobrindo allowlist e área protegida
  app.post('/api/auth/login', (_r, res) => { res.json({ ok: 'login' }); });
  app.get('/api/version', (_r, res) => { res.json({ ok: 'version' }); });
  app.post('/api/wifi/lead', (_r, res) => { res.json({ ok: 'lead' }); });
  app.get('/api/galeria/export', (_r, res) => { res.json({ ok: 'galeria' }); });
  app.get('/api/funcionarios/9/dias', (_r, res) => { res.json({ ok: 'dias' }); });
  app.delete('/api/obras/5', (_r, res) => { res.json({ ok: 'delete-obra' }); });
  app.post('/api/equipe', (_r, res) => { res.json({ ok: 'equipe' }); });
  // fora de /api: não deve ser alcançado pelo gate
  app.post('/webhook/zapi', (_r, res) => { res.json({ ok: 'webhook' }); });
  app.get('/v/abc/pdf', (_r, res) => { res.json({ ok: 'validacao-publica' }); });
  app.post('/recibos/confirmar/tok/confirma', (_r, res) => { res.json({ ok: 'confirma' }); });
  return app;
}

describe('v3.124.0 — gate montado em Express real', () => {
  const app = appDeTeste();

  it('login continua acessível sem cookie (o teste que protege contra tijolar o sistema)', async () => {
    const r = await request(app).post('/api/auth/login').send({ u: 'x' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe('login');
  });

  it.each([
    ['GET',  '/api/version',        'version'],
    ['POST', '/api/wifi/lead',      'lead'],
    ['GET',  '/api/galeria/export', 'galeria'],
  ])('%s %s passa sem cookie', async (metodo, url, esperado) => {
    const req = metodo === 'POST' ? request(app).post(url) : request(app).get(url);
    const r = await req;
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(esperado);
  });

  it.each([
    ['GET',    '/api/funcionarios/9/dias'],
    ['DELETE', '/api/obras/5'],
    ['POST',   '/api/equipe'],
  ])('%s %s responde 401 sem cookie', async (metodo, url) => {
    const r = await (metodo === 'GET' ? request(app).get(url)
      : metodo === 'DELETE' ? request(app).delete(url)
      : request(app).post(url));
    expect(r.status).toBe(401);
  });

  it.each([
    ['POST', '/webhook/zapi'],
    ['GET',  '/v/abc/pdf'],
    ['POST', '/recibos/confirmar/tok/confirma'],
  ])('%s %s (fora de /api) não é afetado pelo gate', async (metodo, url) => {
    const r = await (metodo === 'GET' ? request(app).get(url) : request(app).post(url));
    expect(r.status).toBe(200);
  });

  it('cookie zayra_auth invalido continua 401 (o gate nao aceita qualquer coisa)', async () => {
    const r = await request(app)
      .get('/api/funcionarios/9/dias')
      .set('Cookie', 'zayra_auth=lixo.nao.eh.jwt');
    expect(r.status).toBe(401);
  });
});
