import { describe, it, expect } from 'vitest';
import { ALQUEIRE_HA, haParaAlqueires, alqueiresTxt, haAlq, haAlqCurto } from './unidades';
import { montarPerimetro, textoMemorialPerimetro } from './perimetro';

describe('unidades — hectare e alqueire (4,84 ha, padrão MA)', () => {
  it('converte ha -> alqueire', () => {
    expect(ALQUEIRE_HA).toBe(4.84);
    expect(haParaAlqueires(4.84)).toBeCloseTo(1, 12);
    expect(haParaAlqueires(35.5676)).toBeCloseTo(7.3487, 4);
  });
  it('formata nas duas grandezas', () => {
    expect(alqueiresTxt(4.84)).toBe('1,0000 alqueire');
    expect(haAlq(35.5676)).toBe('35,5676 ha (7,3487 alqueires)');
    expect(haAlqCurto(9.68)).toBe('9,6800 ha · 2,0000 alq.');
  });
  it('memorial do perímetro traz a área em ha e em alqueires', () => {
    const p = montarPerimetro({ sistema: 'UTM', pares: [{ x: 500000, y: 9450000 }, { x: 500220, y: 9450000 }, { x: 500220, y: 9450220 }, { x: 500000, y: 9450220 }] }, { fuso: 23, hemisferio: 'S', formato: 'CSV', arquivo: null });
    const t = textoMemorialPerimetro(p, 'Imóvel teste', 'Açailândia/MA')[0];
    expect(t).toContain('4,8400 ha (1,0000 alqueire; 48.400,00 m²)');
  });
});
