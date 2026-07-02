// v3.80.0 — Validação de escopo (fechamento por funcionário + desvínculo).
import { describe, it, expect } from 'vitest';
import { normalizarEscopoFolha, FolhaError } from './folhaFechamento';

describe('normalizarEscopoFolha', () => {
  it('sem funcionário → escopo "todos" (obra inteira)', () => {
    const e = normalizarEscopoFolha({});
    expect(e.funcionarioId).toBeNull();
    expect(e.desvincular).toBe(false);
    expect(e.forcarDesvinculo).toBe(false);
  });

  it('aceita funcionario_id (snake) e funcionarioId (camel)', () => {
    expect(normalizarEscopoFolha({ funcionario_id: 7 }).funcionarioId).toBe(7);
    expect(normalizarEscopoFolha({ funcionarioId: 9 }).funcionarioId).toBe(9);
    expect(normalizarEscopoFolha({ funcionario_id: '12' }).funcionarioId).toBe(12);
  });

  it('string vazia = sem funcionário', () => {
    expect(normalizarEscopoFolha({ funcionario_id: '' }).funcionarioId).toBeNull();
  });

  it('funcionario_id inválido → FolhaError 400', () => {
    for (const bad of [0, -1, 'abc', 1.5]) {
      expect(() => normalizarEscopoFolha({ funcionario_id: bad })).toThrow(FolhaError);
    }
  });

  it('desvincular sem funcionário → FolhaError 400', () => {
    try {
      normalizarEscopoFolha({ desvincular: true });
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(FolhaError);
      expect((e as FolhaError).status).toBe(400);
    }
  });

  it('desvincular com funcionário → ok', () => {
    const e = normalizarEscopoFolha({ funcionario_id: 3, desvincular: true });
    expect(e.funcionarioId).toBe(3);
    expect(e.desvincular).toBe(true);
  });

  it('forcar_desvinculo mapeia (snake e camel)', () => {
    expect(normalizarEscopoFolha({ funcionario_id: 3, desvincular: true, forcar_desvinculo: true }).forcarDesvinculo).toBe(true);
    expect(normalizarEscopoFolha({ funcionario_id: 3, desvincular: true, forcarDesvinculo: true }).forcarDesvinculo).toBe(true);
  });
});
