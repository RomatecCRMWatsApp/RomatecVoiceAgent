import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../services/memoriais/eletricoExtracao', () => ({
  extrairEletricaCompleta: vi.fn(async () => ({ circuitos: [], pontos: {}, obra: {}, alimentacao: {}, eletrodutos: [], caixas: [], confianca: 0.7, observacoes: [], divergencias: [] })),
}));
import { handleExtrairPdfEletrico } from './memoriais';

function mockRes() {
  const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res;
}

describe('handleExtrairPdfEletrico', () => {
  it('400 sem arquivo', async () => {
    const res = mockRes();
    await handleExtrairPdfEletrico({ file: undefined } as unknown as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it('200 com arquivo', async () => {
    const res = mockRes();
    await handleExtrairPdfEletrico({ file: { buffer: Buffer.from('x') } } as unknown as Request, res as Response);
    expect(res.json).toHaveBeenCalled();
  });
});
