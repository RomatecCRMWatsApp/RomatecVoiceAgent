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

  it('valor = mão de obra * (1 + BDI) sem NF — materiais NÃO entram (informativos)', () => {
    const r = calcular(salas, { maoObraM2: 40, bdiPct: 20, nfPct: 0 });
    expect(r.valorMaoObra).toBe(51 * 40);          // 2040
    expect(r.subtotal).toBe(2040);                 // só mão de obra
    expect(r.valorFinal).toBe(Math.round(2040 * 1.2 * 100) / 100); // 2448 (NF 0)
    expect(r.valorMateriais).toBeGreaterThan(0);   // computado, mas informativo (fora do valor)
  });

  it('v3.74.0: NF/ISS faz gross-up sobre (mão de obra + BDI)', () => {
    const r = calcular(salas, { maoObraM2: 40, bdiPct: 20, nfPct: 5 });
    const comBdi = 2040 * 1.2;                      // 2448
    expect(r.valorNf).toBe(Math.round(comBdi * 0.05 * 100) / 100); // 122.40
    expect(r.valorFinal).toBe(Math.round((comBdi + comBdi * 0.05) * 100) / 100); // 2570.40
  });

  it('v3.74.0: rodapé embutido acrescenta % na mão de obra; sobrepor não', () => {
    const semRodape = calcular(salas, { maoObraM2: 40, bdiPct: 0, nfPct: 0, rodapeEmbutidoPct: 20 }, false, false);
    const comEmbutido = calcular(salas, { maoObraM2: 40, bdiPct: 0, nfPct: 0, rodapeEmbutidoPct: 20 }, false, true);
    expect(semRodape.valorRodapeAdicional).toBe(0);
    expect(semRodape.valorMaoObra).toBe(2040);
    expect(comEmbutido.valorRodapeAdicional).toBe(Math.round(2040 * 0.2 * 100) / 100); // 408
    expect(comEmbutido.valorMaoObra).toBe(2040 + 408); // 2448
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

  it('rejeita ambiente sem C×L e sem área direta', () => {
    expect(() => calcular([{ descricao: 'X', comprimentoM: 0, larguraM: 3 }])).toThrow();
  });

  // v3.71.0: área informada direto (cômodo poligonal)
  it('aceita área direta (poligonal) e soma com os retangulares', () => {
    const r = calcular([
      { descricao: 'Sala retangular', comprimentoM: 4, larguraM: 3 },          // 12 m²
      { descricao: 'Hall poligonal', comprimentoM: 0, larguraM: 0, areaM2: 7.5 }, // 7.5 m² direto
    ]);
    expect(r.areaTotalM2).toBe(19.5);
    const polig = r.ambientes.find(a => a.descricao === 'Hall poligonal');
    expect(polig!.areaM2).toBe(7.5);
    expect(polig!.comprimentoM).toBe(0); // sem C×L → 0 (PDF mostra "—")
  });

  // v3.70.0: disco de corte + argamassa por remoção
  it('inclui disco de corte diamantado no quantitativo', () => {
    const r = calcular(salas);
    const disco = r.insumos.find(i => /disco de corte/i.test(i.item));
    expect(disco).toBeDefined();
    // 51 m² / 30 m² por disco = ceil(1.7) = 2
    expect(disco!.quantidade).toBe(2);
  });

  it('sem remoção (piso sobre piso) usa AC-III + consumo maior', () => {
    const r = calcular(salas, undefined, false); // sem remoção (default do módulo)
    const arg = r.insumos.find(i => /argamassa colante/i.test(i.item));
    expect(arg!.item).toContain('AC-III');
    expect(arg!.obs).toMatch(/dupla colagem/i);
    // 51 m² * 8 kg/m² / 20 kg/saco = ceil(20.4) = 21 sacos
    expect(arg!.quantidade).toBe(21);
  });

  it('com remoção usa AC-II + consumo padrão', () => {
    const r = calcular(salas, undefined, true); // com remoção
    const arg = r.insumos.find(i => /argamassa colante/i.test(i.item));
    expect(arg!.item).toContain('AC-II');
    expect(arg!.item).not.toContain('AC-III');
    // 51 m² * 5 kg/m² / 20 kg/saco = ceil(12.75) = 13 sacos
    expect(arg!.quantidade).toBe(13);
  });
});
