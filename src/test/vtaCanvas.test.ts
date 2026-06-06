// v3.57.0 — VTA Canvas (Canvas 2D puro): testes da lógica pura da engine.
// A engine é browser-side; aqui validamos apenas as funções puras expostas
// (sem DOM/canvas): _distSeg, _isValid, _parseEscala, _pxToMetros.
import { describe, it, expect } from 'vitest';

// vtaCanvas.js é CommonJS (module.exports). Import dinâmico p/ interop seguro.
async function loadEngine(): Promise<any> {
  const mod: any = await import('../public/js/vtaCanvas.js');
  return mod.CanvasEngine || mod.default?.CanvasEngine || mod.default;
}

describe('vtaCanvas — engine Canvas 2D puro', () => {
  it('carrega o módulo em Node sem acessar DOM', async () => {
    const E = await loadEngine();
    expect(E).toBeTruthy();
    expect(typeof E._distSeg).toBe('function');
    expect(typeof E._isValid).toBe('function');
  });

  describe('_distSeg (distância ponto→segmento)', () => {
    it('ponto sobre o segmento → 0', async () => {
      const E = await loadEngine();
      expect(E._distSeg(5, 0, 0, 0, 10, 0)).toBeCloseTo(0, 6);
    });
    it('ponto perpendicular ao meio → distância reta', async () => {
      const E = await loadEngine();
      expect(E._distSeg(5, 5, 0, 0, 10, 0)).toBeCloseTo(5, 6);
    });
    it('segmento degenerado (a==b) → distância euclidiana', async () => {
      const E = await loadEngine();
      expect(E._distSeg(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 6);
    });
  });

  describe('_isValid (validação de shape antes de persistir)', () => {
    it('linha com distância ~0 é inválida', async () => {
      const E = await loadEngine();
      expect(E._isValid({ type: 'line', x1: 10, y1: 10, x2: 10, y2: 10 })).toBe(false);
    });
    it('linha com comprimento > 3 é válida', async () => {
      const E = await loadEngine();
      expect(E._isValid({ type: 'line', x1: 0, y1: 0, x2: 50, y2: 0 })).toBe(true);
    });
    it('texto e norte são sempre válidos', async () => {
      const E = await loadEngine();
      expect(E._isValid({ type: 'text', x1: 0, y1: 0 })).toBe(true);
      expect(E._isValid({ type: 'north', x1: 0, y1: 0 })).toBe(true);
    });
    it('polyline exige >= 2 pontos', async () => {
      const E = await loadEngine();
      expect(E._isValid({ type: 'polyline', points: [{ x: 0, y: 0 }] })).toBe(false);
      expect(E._isValid({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] })).toBe(true);
    });
  });

  describe('_parseEscala / _pxToMetros (escala 1:500 default sem DOM)', () => {
    it('_parseEscala retorna 500 por padrão (sem document)', async () => {
      const E = await loadEngine();
      expect(E._parseEscala()).toBe(500);
    });
    it('_pxToMetros retorna string com unidade', async () => {
      const E = await loadEngine();
      const r = E._pxToMetros(4000);
      expect(typeof r).toBe('string');
      expect(/m$|cm$/.test(r)).toBe(true);
    });
  });
});
