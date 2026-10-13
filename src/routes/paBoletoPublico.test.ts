// v3.144.0 — Link público do boleto Romatec.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/pa/paBoletoPdf', async () => {
  const { PaErro } = await import('../services/pa/erros');
  return {
    boletoPorToken: vi.fn(async (t: string) => {
      if (t === 'tokenvalidotokenvalido') return 9;
      if (t === 'tokencanceladotokencan') throw new PaErro('BOLETO_CANCELADO', 'Este boleto foi cancelado.', 410);
      throw new PaErro('BOLETO_NAO_ENCONTRADO', 'Boleto não encontrado', 404);
    }),
    gerarPdfBoleto: vi.fn(async () => ({ pdf: Buffer.from('%PDF-1.4 x'), nome: 'BOLETO-PAT-001-Sinal.pdf' })),
  };
});

import router from './paBoletoPublico';
import { gerarPdfBoleto } from '../services/pa/paBoletoPdf';

const app = () => { const a = express(); a.use('/pa/boleto', router); return a; };

describe('/pa/boleto/:token', () => {
  beforeEach(() => vi.clearAllMocks());
  it('token válido → PDF inline, sem cache e noindex', async () => {
    const r = await request(app()).get('/pa/boleto/tokenvalidotokenvalido');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['cache-control']).toContain('no-store');
    expect(r.headers['x-robots-tag']).toBe('noindex');
    expect(gerarPdfBoleto).toHaveBeenCalledWith(9, 'carne');
  });
  it('sempre gera o modelo Carnê (parâmetro de modelo é ignorado)', async () => {
    await request(app()).get('/pa/boleto/tokenvalidotokenvalido?modelo=carta');
    expect(gerarPdfBoleto).toHaveBeenCalledWith(9, 'carne');
  });
  it('token inexistente → 404 em HTML; cancelado → 410', async () => {
    const r = await request(app()).get('/pa/boleto/naoexisteessetokenaqui');
    expect(r.status).toBe(404);
    expect(r.text).toContain('Boleto não encontrado');
    expect((await request(app()).get('/pa/boleto/tokencanceladotokencan')).status).toBe(410);
  });
});
