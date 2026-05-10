// src/services/pricing/incra.test.ts
import { describe, it, expect } from 'vitest';
import { validarCriterios, type CriteriosPontuacao } from './incra';

const valido: CriteriosPontuacao = {
  vegetacao: 5, relevo: 5, insalubridade: 5, acesso: 5, clima: 5, area_media: 5,
};

describe('validarCriterios', () => {
  it('retorna ok=true para entrada válida', () => {
    const r = validarCriterios(valido);
    expect(r.ok).toBe(true);
    expect(r.erros).toEqual([]);
  });

  it('rejeita pontuação 0', () => {
    const r = validarCriterios({ ...valido, vegetacao: 0 });
    expect(r.ok).toBe(false);
    expect(r.erros[0]).toMatch(/vegetacao/);
  });

  it('rejeita pontuação 11', () => {
    const r = validarCriterios({ ...valido, relevo: 11 });
    expect(r.ok).toBe(false);
    expect(r.erros[0]).toMatch(/relevo/);
  });

  it('rejeita não-inteiro', () => {
    const r = validarCriterios({ ...valido, clima: 5.5 });
    expect(r.ok).toBe(false);
    expect(r.erros[0]).toMatch(/clima/);
  });

  it('acumula múltiplos erros', () => {
    const r = validarCriterios({ ...valido, vegetacao: 0, relevo: 11 });
    expect(r.erros.length).toBe(2);
  });
});
