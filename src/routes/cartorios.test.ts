import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import cartoriosRouter from './cartorios';
import pool from '../database/connection';

vi.mock('../database/connection', () => ({
  default: { execute: vi.fn() },
}));

// Extract the route handler directly (router.stack[0].route.stack[0].handle)
function getAutocompleteHandler() {
  // router.stack is an array of layers; find the autocomplete route
  const layer = (cartoriosRouter as any).stack.find(
    (l: any) => l.route && l.route.path === '/autocomplete'
  );
  if (!layer) throw new Error('autocomplete route not found');
  return layer.route.stack[0].handle as (req: Request, res: Response) => Promise<void>;
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('GET /api/cartorios/autocomplete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejeita query com menos de 2 caracteres', async () => {
    const handler = getAutocompleteHandler();
    const req = { query: { q: 'a' } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/mínimo 2/i) }));
  });

  it('busca tolerante a acento: normaliza q para cidade_normalizada e mantém q original para denominacao', async () => {
    (pool.execute as any).mockResolvedValueOnce([
      [{ cns: '00.123-4', denominacao: '1º Ofício de Registro de Imóveis', uf: 'MA', cidade: 'Açailândia' }],
      [],
    ]);
    const handler = getAutocompleteHandler();
    // Usuário digita SEM acento; cidade_normalizada precisa receber a forma sem acento
    const req = { query: { q: 'Açailândia' } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);

    const callArgs = (pool.execute as any).mock.calls[0];
    expect(callArgs[0]).toContain('SELECT cns, denominacao, uf, cidade');
    expect(callArgs[0]).toContain('cidade_normalizada LIKE ?');
    expect(callArgs[0]).toContain('denominacao LIKE ?');
    // 1º param: forma normalizada (lowercase sem acento)
    expect(callArgs[1][0]).toBe('%acailandia%');
    // 2º param: q original (preserva acentos para denominacao)
    expect(callArgs[1][1]).toBe('%Açailândia%');
    expect(res.json).toHaveBeenCalledWith([
      { cns: '00.123-4', denominacao: '1º Ofício de Registro de Imóveis', uf: 'MA', cidade: 'Açailândia' },
    ]);
  });

  it('filtra por uf opcional (uppercase)', async () => {
    (pool.execute as any).mockResolvedValueOnce([[], []]);
    const handler = getAutocompleteHandler();
    const req = { query: { q: 'Imov', uf: 'ma' } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    const callArgs = (pool.execute as any).mock.calls[0];
    expect(callArgs[0]).toContain('uf =');
    // UF deve vir uppercased
    expect(callArgs[1]).toContain('MA');
  });

  it('rejeita uf inválida (mais de 2 letras)', async () => {
    const handler = getAutocompleteHandler();
    const req = { query: { q: 'Imov', uf: 'MAA' } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/uf/i) }));
  });

  it('retorna 500 quando o pool falha', async () => {
    (pool.execute as any).mockRejectedValueOnce(new Error('db down'));
    const handler = getAutocompleteHandler();
    const req = { query: { q: 'Imov' } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
