// v3.143.0 — Webhook Asaas do PA: autenticação por asaas-access-token.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/pa/paBoletos', () => ({
  processarEventoAsaas: vi.fn(async () => ({ acao: 'baixado', boleto_id: 3 })),
}));

import router, { tokenConfere, corpoDoEvento } from './paWebhookAsaas';
import { processarEventoAsaas } from '../services/pa/paBoletos';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/webhook/asaas-pa', router);
  return a;
}
const evento = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', value: 350, billingType: 'BOLETO', paymentDate: '2026-11-09' } };

describe('webhook Asaas (PA)', () => {
  const antes = process.env.ASAAS_WEBHOOK_TOKEN;
  beforeEach(() => { vi.clearAllMocks(); process.env.ASAAS_WEBHOOK_TOKEN = 'segredo-teste'; });
  afterEach(() => { process.env.ASAAS_WEBHOOK_TOKEN = antes; });

  it('tokenConfere em tempo constante', () => {
    expect(tokenConfere('segredo-teste', 'segredo-teste')).toBe(true);
    expect(tokenConfere('errado', 'segredo-teste')).toBe(false);
    expect(tokenConfere(undefined, 'segredo-teste')).toBe(false);
    expect(tokenConfere('x', undefined)).toBe(false);
  });
  it('sem token configurado → 503; token errado → 401; nada processado', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = '';
    expect((await request(app()).post('/webhook/asaas-pa').send(evento)).status).toBe(503);
    process.env.ASAAS_WEBHOOK_TOKEN = 'segredo-teste';
    expect((await request(app()).post('/webhook/asaas-pa').set('asaas-access-token', 'errado').send(evento)).status).toBe(401);
    expect(processarEventoAsaas).not.toHaveBeenCalled();
  });
  it('token certo → processa e responde 200', async () => {
    const r = await request(app()).post('/webhook/asaas-pa').set('asaas-access-token', 'segredo-teste').send(evento);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, acao: 'baixado' });
    expect(processarEventoAsaas).toHaveBeenCalledWith(evento);
  });
  it('token com espaço sobrando no fim ainda é aceito', async () => {
    const r = await request(app()).post('/webhook/asaas-pa').set('asaas-access-token', 'segredo-teste  ').send(evento);
    expect(r.status).toBe(200);
  });
  it('plano B: token na URL (?token=) também é aceito; errado na URL → 401', async () => {
    expect((await request(app()).post('/webhook/asaas-pa?token=segredo-teste').send(evento)).status).toBe(200);
    expect((await request(app()).post('/webhook/asaas-pa?token=errado').send(evento)).status).toBe(401);
  });
  it('corpo JSON com content-type não-JSON (text/plain) ainda é lido', async () => {
    const r = await request(app()).post('/webhook/asaas-pa?token=segredo-teste')
      .set('Content-Type', 'text/plain').send(JSON.stringify(evento));
    expect(r.status).toBe(200);
    expect(processarEventoAsaas).toHaveBeenCalledWith(evento);
  });
  it('corpoDoEvento: string JSON, form com campo data, objeto e lixo', () => {
    expect(corpoDoEvento(JSON.stringify(evento))).toEqual(evento);
    expect(corpoDoEvento('data=' + encodeURIComponent(JSON.stringify(evento)))).toEqual(evento);
    expect(corpoDoEvento(evento)).toEqual(evento);
    expect(corpoDoEvento('xx')).toEqual({});
  });
  it('falha interna → 500 (o Asaas reenvia)', async () => {
    vi.mocked(processarEventoAsaas).mockRejectedValueOnce(new Error('banco fora'));
    const r = await request(app()).post('/webhook/asaas-pa').set('asaas-access-token', 'segredo-teste').send(evento);
    expect(r.status).toBe(500);
  });
});
