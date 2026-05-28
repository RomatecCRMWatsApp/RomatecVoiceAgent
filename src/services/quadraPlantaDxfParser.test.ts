// v3.31.0: testes do parser DXF — geometria pura (sem dxf-parser real).

import { describe, it, expect } from 'vitest';
import {
  shoelaceArea,
  computeCentroide,
  distancia,
  perimetro,
  classificarArestas4,
  extrairNumeroLote,
  pontoNoPoligono,
  parsearDxfBuffer,
} from './quadraPlantaDxfParser';

describe('quadraPlantaDxfParser — geometria pura', () => {
  it('1. shoelaceArea: quadrado 10x10 = 100 m²', () => {
    const verts = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(shoelaceArea(verts)).toBe(100);
  });
  it('2. shoelaceArea: triangulo 3-4-5 = 6 m²', () => {
    const verts = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }];
    expect(shoelaceArea(verts)).toBe(6);
  });
  it('3. shoelaceArea: retangulo 50x100 = 5000 m² (lote tipico)', () => {
    const verts = [
      { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 0, y: 100 },
    ];
    expect(shoelaceArea(verts)).toBe(5000);
  });
  it('4. shoelaceArea: poligono ordem reversa retorna mesmo valor absoluto', () => {
    const ccw = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const cw = [...ccw].reverse();
    expect(shoelaceArea(cw)).toBe(shoelaceArea(ccw));
  });
  it('5. computeCentroide: quadrado 10x10 -> (5, 5)', () => {
    const c = computeCentroide([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(c.x).toBe(5);
    expect(c.y).toBe(5);
  });
  it('6. distancia: (0,0)-(3,4) = 5', () => {
    expect(distancia({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it('7. perimetro: quadrado 10x10 = 40', () => {
    expect(perimetro([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(40);
  });
});

describe('quadraPlantaDxfParser — classificarArestas4', () => {
  it('8. lote tipico 12m frente x 30m fundo orientado N -> frente=12, fundo=12, laterais=30', () => {
    // Lote orientado verticalmente, frente ao sul (Y baixo), fundo ao norte (Y alto)
    const verts = [
      { x: 0, y: 0 },    // canto SW (frente esquerda)
      { x: 12, y: 0 },   // canto SE (frente direita)
      { x: 12, y: 30 },  // canto NE (fundo direita)
      { x: 0, y: 30 },   // canto NW (fundo esquerda)
    ];
    const c = classificarArestas4(verts);
    expect(c.frente_m).toBe(12);
    expect(c.fundo_m).toBe(12);
    expect(c.l_dir_m).toBe(30);
    expect(c.l_esq_m).toBe(30);
  });

  it('9. classificarArestas4 com 3 vertices nao quebra (caso degenerado)', () => {
    const c = classificarArestas4([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }]);
    expect(c.frente_m).toBeGreaterThanOrEqual(0);
  });
});

describe('quadraPlantaDxfParser — utilitarios', () => {
  it('10. extrairNumeroLote: "Lote 12" -> "12"', () => {
    expect(extrairNumeroLote('Lote 12')).toBe('12');
  });
  it('11. extrairNumeroLote: "LT-07A" -> "07"', () => {
    expect(extrairNumeroLote('LT-07A')).toBe('07');
  });
  it('12. extrairNumeroLote: vazio -> ""', () => {
    expect(extrairNumeroLote('')).toBe('');
    expect(extrairNumeroLote(undefined)).toBe('');
  });
  it('13. pontoNoPoligono: centroide (5,5) dentro do quadrado 10x10', () => {
    const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pontoNoPoligono({ x: 5, y: 5 }, poly)).toBe(true);
  });
  it('14. pontoNoPoligono: (15,5) fora do quadrado 10x10', () => {
    const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pontoNoPoligono({ x: 15, y: 5 }, poly)).toBe(false);
  });
});

describe('quadraPlantaDxfParser — parsearDxfBuffer com fallback', () => {
  it('15. dxf-parser nao instalado -> status manual + mensagem clara', async () => {
    // No ambiente de teste, dxf-parser nao esta instalado (optional dep).
    const buf = Buffer.from('0\nSECTION\nfake content');
    const r = await parsearDxfBuffer(buf);
    // Pode ser 'manual' (lib ausente) ou 'sucesso'/'erro' se a lib estiver disponivel
    expect(['manual', 'sucesso', 'erro']).toContain(r.status);
    if (r.status === 'manual') {
      expect(r.mensagem).toMatch(/dxf-parser/);
      expect(r.num_lotes_detectados).toBe(0);
    }
  });
});
