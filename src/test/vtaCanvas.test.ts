// v3.57.0 — VTA Canvas (Canvas 2D puro): testes da lógica pura da engine.
//
// A engine (src/public/js/vtaCanvas.js) é browser-side e NÃO é um módulo TS.
// Para testá-la sem quebrar o typecheck (tsconfig sem allowJs) nem precisar de
// DOM, carregamos o arquivo real via fs + new Function, injetando module/window/
// document como undefined — os guards `typeof window/document !== 'undefined'`
// fazem a engine pular qualquer acesso ao DOM. Isso valida a engine REAL.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

let E: any;

beforeAll(() => {
  const src = readFileSync(join(__dirname, '..', 'public', 'js', 'vtaCanvas.js'), 'utf8');
  const mod: { exports: any } = { exports: {} };
  // new Function compila a engine; lança se houver erro de sintaxe (valida o arquivo).
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const load: any = new Function('module', 'window', 'document', src);
  load(mod, undefined, undefined);
  E = mod.exports.CanvasEngine;
});

describe('vtaCanvas — engine Canvas 2D puro (arquivo real, sem DOM)', () => {
  it('carrega a engine e expõe os helpers puros', () => {
    expect(E).toBeTruthy();
    expect(typeof E._distSeg).toBe('function');
    expect(typeof E._isValid).toBe('function');
    expect(typeof E._parseEscala).toBe('function');
    expect(typeof E._pxToMetros).toBe('function');
  });

  describe('_distSeg (distância ponto→segmento)', () => {
    it('ponto sobre o segmento → 0', () => {
      expect(E._distSeg(5, 0, 0, 0, 10, 0)).toBeCloseTo(0, 6);
    });
    it('ponto perpendicular ao meio → distância reta', () => {
      expect(E._distSeg(5, 5, 0, 0, 10, 0)).toBeCloseTo(5, 6);
    });
    it('segmento degenerado (a==b) → distância euclidiana', () => {
      expect(E._distSeg(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 6);
    });
  });

  describe('_isValid (validação de shape antes de persistir)', () => {
    it('linha com distância ~0 é inválida', () => {
      expect(E._isValid({ type: 'line', x1: 10, y1: 10, x2: 10, y2: 10 })).toBe(false);
    });
    it('linha com comprimento > 3 é válida', () => {
      expect(E._isValid({ type: 'line', x1: 0, y1: 0, x2: 50, y2: 0 })).toBe(true);
    });
    it('texto e norte são sempre válidos', () => {
      expect(E._isValid({ type: 'text', x1: 0, y1: 0 })).toBe(true);
      expect(E._isValid({ type: 'north', x1: 0, y1: 0 })).toBe(true);
    });
    it('polyline exige >= 2 pontos', () => {
      expect(E._isValid({ type: 'polyline', points: [{ x: 0, y: 0 }] })).toBe(false);
      expect(E._isValid({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] })).toBe(true);
    });
  });

  describe('_parseEscala / _pxToMetros (sem DOM → escala default 1:500)', () => {
    it('_parseEscala retorna 500 por padrão', () => {
      expect(E._parseEscala()).toBe(500);
    });
    it('_pxToMetros retorna string com unidade (m/cm)', () => {
      const r = E._pxToMetros(4000);
      expect(typeof r).toBe('string');
      expect(/(m|cm)$/.test(r)).toBe(true);
    });
  });
});
