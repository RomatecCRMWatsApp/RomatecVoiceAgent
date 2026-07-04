// v3.83.0 — Regressão do bug "fotos não persistem": garante que adicionarFoto e
// adicionarMaterial GRAVAM o base64 (com overlay) e as COORDENADAS GPS nas
// tabelas obras_entregas_fotos / obras_entregas_materiais_sobra.
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('../database/connection', () => ({ default: { execute: vi.fn(), getConnection: vi.fn() } }));

import pool from '../database/connection';
import { adicionarFoto, adicionarMaterial, removerFoto } from '../services/obrasEntregaRepo';

const p = pool as unknown as { execute: Mock };

describe('Entrega de Obra — persistência de fotos + coordenadas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adicionarFoto grava data_base64 (sem prefixo) e lat/long na tabela de fotos', async () => {
    p.execute
      .mockResolvedValueOnce([[{ '1': 1 }]])   // possui → dono confere
      .mockResolvedValueOnce([{ insertId: 42 }]); // INSERT foto

    const r = await adicionarFoto(7, 'u1', {
      tipo: 'execucao',
      mime: 'image/jpeg',
      data_base64: 'data:image/jpeg;base64,ABC123',   // vem com prefixo (overlay data URL)
      legenda: 'parede',
      latitude: -4.9471, longitude: -47.4954, altitude_m: 210,
      utm_zona: '23S', municipio: 'Açailândia', colaborador: 'José',
      horario_captura: '2026-07-04T10:00:00.000Z',
    });

    expect(r).toEqual({ id: 42 });
    const insert = p.execute.mock.calls[1];
    const sql = String(insert[0]).replace(/\s+/g, ' ');
    expect(sql).toMatch(/INSERT INTO obras_entregas_fotos/i);
    expect(sql).toMatch(/latitude, longitude/);
    const params = insert[1] as unknown[];
    expect(params[0]).toBe(7);            // entrega_id
    expect(params[3]).toBe('ABC123');     // base64 SEM o prefixo data:
    expect(params).toContain(-4.9471);    // latitude persistida
    expect(params).toContain(-47.4954);   // longitude persistida
  });

  it('adicionarFoto NÃO insere se o dono não confere (retorna null)', async () => {
    p.execute.mockResolvedValueOnce([[]]); // possui → vazio
    const r = await adicionarFoto(7, 'intruso', { tipo: 'execucao', mime: 'image/jpeg', data_base64: 'ABC' });
    expect(r).toBeNull();
    expect(p.execute).toHaveBeenCalledTimes(1); // só o possui, nenhum INSERT
  });

  it('adicionarMaterial grava foto_base64 + lat/long do material', async () => {
    p.execute
      .mockResolvedValueOnce([[{ '1': 1 }]])   // possui
      .mockResolvedValueOnce([{ insertId: 5 }]); // INSERT material

    const r = await adicionarMaterial(7, 'u1', {
      material: 'Cimento CP-II', quantidade: 3, unidade: 'sc',
      foto_mime: 'image/jpeg', foto_base64: 'data:image/jpeg;base64,MATFOTO',
      latitude: -4.9, longitude: -47.5,
    });

    expect(r).toEqual({ id: 5 });
    const insert = p.execute.mock.calls[1];
    const sql = String(insert[0]).replace(/\s+/g, ' ');
    expect(sql).toMatch(/INSERT INTO obras_entregas_materiais_sobra/i);
    expect(sql).toMatch(/latitude, longitude/);
    const params = insert[1] as unknown[];
    expect(params).toContain('MATFOTO');  // foto do material persistida (sem prefixo)
    expect(params).toContain(-4.9);
    expect(params).toContain(-47.5);
  });

  it('removerFoto respeita a posse (dono no WHERE)', async () => {
    p.execute
      .mockResolvedValueOnce([[{ '1': 1 }]])       // possui
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // DELETE
    const ok = await removerFoto(7, 'u1', 42);
    expect(ok).toBe(true);
    const del = p.execute.mock.calls[1];
    expect(String(del[0])).toMatch(/DELETE FROM obras_entregas_fotos/i);
  });
});
