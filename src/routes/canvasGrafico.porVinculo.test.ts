// v3.52.0 — testes das rotas GET /api/canvas/por-laudo|por-proposta.
// Extrai o handler final (pula requireAuth) e mocka o pool, no padrao do
// cartorios.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import canvasRouter from './canvasGrafico';
import pool from '../database/connection';

vi.mock('../database/connection', () => ({
  default: { execute: vi.fn() },
}));

function getHandler(pathInclui: string) {
  const layer = (canvasRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }> })
    .stack.find((l) => !!l.route && l.route.path.includes(pathInclui));
  if (!layer || !layer.route) throw new Error(`rota ${pathInclui} nao encontrada`);
  // ultimo handle = handler real (requireAuth e' o primeiro)
  return layer.route.stack[layer.route.stack.length - 1].handle as (req: Request, res: Response) => Promise<void>;
}

function mockRes() {
  const res = {} as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('GET /api/canvas/por-laudo/:laudoId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna o canvas mais recente do laudo (ORDER BY id DESC LIMIT 1)', async () => {
    const linha = { id: 9, tipo: 'croqui', titulo: 'Croqui', dados_svg: '<x/>', dados_json: null,
      largura_virtual: 2000, altura_virtual: 2000, escala_grafica: '1:500' };
    (pool.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([[linha], []]);
    const handler = getHandler('por-laudo');
    const req = { params: { laudoId: '7' } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    // SQL filtra por laudo_id e ordena desc limit 1
    const [sql, params] = (pool.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(sql)).toContain('laudo_id = ?');
    expect(String(sql)).toContain('ORDER BY id DESC LIMIT 1');
    expect(params).toEqual(['7']);
    expect(res.json).toHaveBeenCalledWith({ canvas: linha });
  });

  it('404 quando o laudo nao tem canvas vinculado', async () => {
    (pool.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([[], []]);
    const handler = getHandler('por-laudo');
    const req = { params: { laudoId: '7' } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/nenhum canvas/i) }));
  });
});

describe('GET /api/canvas/por-proposta/:propostaId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filtra por proposta_id', async () => {
    (pool.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([[{ id: 3 }], []]);
    const handler = getHandler('por-proposta');
    const req = { params: { propostaId: '12' } } as unknown as Request;
    const res = mockRes();
    await handler(req, res);
    const [sql, params] = (pool.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(sql)).toContain('proposta_id = ?');
    expect(params).toEqual(['12']);
    expect(res.json).toHaveBeenCalledWith({ canvas: { id: 3 } });
  });
});
