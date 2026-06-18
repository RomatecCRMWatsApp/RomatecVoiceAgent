// v3.67.0: testes do motor de cálculo da Reforma — Piso Sobreposto.
import { describe, it, expect } from 'vitest';
import { calcular, consumoRejunteKgM2 } from './reformaPisoCalc';

describe('reformaPisoCalc', () => {
  const salas = [
    { descricao: 'Sala 01', comprimentoM: 4, larguraM: 3 },     // 12 m²
    { descricao: 'Sala 02', comprimentoM: 5, larguraM: 3 },     // 15 m²
    { descricao: 'Sala 03', comprimentoM: 3.5, larguraM: 3 },   // 10.5 m²
    { descricao: 'Sala 04', comprimentoM: 4.5, larguraM: 3 },   // 13.5 m²
  ];

  it('soma a área dos ambientes', () => {
    const r = calcular(salas);
    expect(r.areaTotalM2).toBe(51); // 12+15+10.5+13.5
  });

  it('aplica 10% de perda sobre o piso', () => {
    const r = calcular(salas);
    expect(r.areaComPerdaM2).toBeCloseTo(56.1, 4);
  });

  it('rejunte segue a fórmula NBR (60x60, junta 3mm, esp 9mm)', () => {
    // ((600+600)/(600*600)) * 3 * 9 * 1.6 = 0.144 kg/m² (NBR 14992 / fórmula fabricante)
    const c = consumoRejunteKgM2(600, 600, 3, 9, 1.6);
    expect(c).toBeCloseTo(0.144, 4);
  });

  it('valor final = (materiais + mão de obra) * (1 + BDI)', () => {
    const r = calcular(salas, { maoObraM2: 40, bdiPct: 20 });
    const esperado = Math.round((r.valorMateriais + r.valorMaoObra) * 1.2 * 100) / 100;
    expect(r.valorFinal).toBe(esperado);
    expect(r.valorMaoObra).toBe(51 * 40);
  });

  it('valor por m² final é coerente', () => {
    const r = calcular(salas);
    expect(r.valorM2Final).toBeCloseTo(r.valorFinal / r.areaTotalM2, 1);
  });

  it('prazo = assentamento + rejunte + cura', () => {
    const r = calcular(salas, { produtividadeM2DiaEquipe: 12, diasRejuntamento: 1, diasCuraLiberacao: 2 });
    // ceil(51/12)=5  + 1 + 2 = 8
    expect(r.prazoDiasUteis).toBe(8);
  });

  it('rejeita ambiente com dimensão inválida', () => {
    expect(() => calcular([{ descricao: 'X', comprimentoM: 0, larguraM: 3 }])).toThrow();
  });
});
