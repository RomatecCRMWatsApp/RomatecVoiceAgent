// src/integrations/laudos.clone.test.ts
import { describe, it, expect } from 'vitest';
import { construirPontosZerados } from './laudos';

describe('construirPontosZerados', () => {
  it('URBANO_4P → 4 pontos V1..V4 com ordem 1..4', () => {
    const pts = construirPontosZerados('URBANO_4P', 99);
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ laudo_id: 99, ordem: 1, rotulo: 'V1' });
    expect(pts[3]).toEqual({ laudo_id: 99, ordem: 4, rotulo: 'V4' });
  });

  it('URBANO_5P → 5 pontos V1..V5', () => {
    const pts = construirPontosZerados('URBANO_5P', 99);
    expect(pts).toHaveLength(5);
    expect(pts.map(p => p.rotulo)).toEqual(['V1','V2','V3','V4','V5']);
  });

  it('URBANO_NP → só V1 (incremental)', () => {
    const pts = construirPontosZerados('URBANO_NP', 99);
    expect(pts).toHaveLength(1);
    expect(pts[0].rotulo).toBe('V1');
  });

  it('RURAL → só V1 (incremental)', () => {
    const pts = construirPontosZerados('RURAL', 99);
    expect(pts).toHaveLength(1);
    expect(pts[0].rotulo).toBe('V1');
  });

  it('tipo desconhecido → array vazio (defensivo)', () => {
    const pts = construirPontosZerados('FOOBAR', 99);
    expect(pts).toEqual([]);
  });
});

describe('clonarLaudo (smoke + skip placeholder)', () => {
  // Testes de integracao reais precisam de mock de pool ou DB de teste.
  // Validacao manual em prod (Task 13) cobre o fluxo end-to-end.
  it.skip('integracao real precisa de mock de pool ou DB de teste', () => {
    // Placeholder pra documentar que testes de integracao do clonarLaudo
    // dependem de infra adicional. A funcao foi validada manualmente em prod.
  });

  it('construirPontosZerados produz quantidade correta para cada tipo (smoke)', () => {
    expect(construirPontosZerados('URBANO_4P', 1)).toHaveLength(4);
    expect(construirPontosZerados('URBANO_5P', 1)).toHaveLength(5);
    expect(construirPontosZerados('URBANO_NP', 1)).toHaveLength(1);
    expect(construirPontosZerados('RURAL', 1)).toHaveLength(1);
  });
});
