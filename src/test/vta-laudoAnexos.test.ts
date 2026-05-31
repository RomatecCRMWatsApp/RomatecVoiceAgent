// v3.51.1 — testes do laudoAnexos (funcoes puras + rasterizador degradavel).
// Sem DB e sem binarios nativos (sharp/node-canvas ausentes no CI → null).
import { describe, it, expect } from 'vitest';
import {
  montarNotaAsBuilt,
  legendaTecnicaFoto,
  escolherCanvasCroqui,
  parseDataUri,
  normalizarFotosRelatorio,
  rasterizarSvg,
  type CanvasGraficoRow,
  type FotoVistoriaRow,
} from '../services/laudoAnexos';

describe('montarNotaAsBuilt', () => {
  it('cita As-Built, NBR 13133 e NTGIR quando ha croqui', () => {
    const t = montarNotaAsBuilt({ temCroqui: true, temFotos: false });
    expect(t).toContain('AS-BUILT');
    expect(t).toContain('NBR 13133');
    expect(t).toContain('NTGIR');
    expect(t).toContain('SIRGAS 2000');
  });
  it('inclui bloco de evidencia fotografica quando ha fotos', () => {
    const t = montarNotaAsBuilt({ temCroqui: false, temFotos: true });
    expect(t).toContain('registros fotograficos');
    expect(t).toContain('UTM');
    expect(t).not.toContain('NBR 13133');
  });
  it('default (sem opts) traz croqui + fotos', () => {
    const t = montarNotaAsBuilt();
    expect(t).toContain('NBR 13133');
    expect(t).toContain('registros fotograficos');
  });
});

describe('legendaTecnicaFoto', () => {
  const base: FotoVistoriaRow = {
    base64_overlay: null, descricao: 'Marco P1', municipio: 'Acailandia',
    logradouro: 'Rua A', utm_zona: '23S', utm_e: 678910.5, utm_n: 9456789.2,
    datum: 'SIRGAS 2000', colaborador: 'Romario', ordem: 0,
  };
  it('monta descricao + local + georref', () => {
    const l = legendaTecnicaFoto(base, 1);
    expect(l).toContain('Marco P1');
    expect(l).toContain('Rua A/Acailandia');
    expect(l).toContain('UTM 23S');
    expect(l).toContain('SIRGAS 2000');
    expect(l).toContain('678.911'); // arredonda + pt-BR
  });
  it('usa fallback de indice quando sem descricao', () => {
    const l = legendaTecnicaFoto({ ...base, descricao: null }, 4);
    expect(l).toContain('Registro fotografico 4');
  });
  it('omite georref quando coords ausentes/invalidas', () => {
    const l = legendaTecnicaFoto({ ...base, utm_e: null, utm_n: null, datum: null }, 2);
    expect(l).not.toContain('UTM');
    expect(l).toBe('Marco P1 — Rua A/Acailandia');
  });
});

describe('escolherCanvasCroqui', () => {
  const mk = (id: number, tipo: string, svg: string | null): CanvasGraficoRow => ({
    id, tipo, titulo: `c${id}`, dados_svg: svg, largura_virtual: 2000,
    altura_virtual: 2000, escala_grafica: '1:500',
  });
  it('prioriza tipo croqui sobre outros', () => {
    const r = escolherCanvasCroqui([mk(1, 'livre', '<l/>'), mk(2, 'croqui', '<l/>'), mk(3, 'quadra', '<l/>')]);
    expect(r?.id).toBe(2);
  });
  it('desempata por id maior (mais recente)', () => {
    const r = escolherCanvasCroqui([mk(5, 'croqui', '<l/>'), mk(9, 'croqui', '<l/>')]);
    expect(r?.id).toBe(9);
  });
  it('ignora linhas sem dados_svg', () => {
    expect(escolherCanvasCroqui([mk(1, 'croqui', null), mk(2, 'croqui', '   ')])).toBeNull();
  });
  it('cai p/ tipo livre quando e o unico com svg', () => {
    const r = escolherCanvasCroqui([mk(1, 'croqui', null), mk(2, 'livre', '<l/>')]);
    expect(r?.id).toBe(2);
  });
});

describe('parseDataUri', () => {
  it('extrai mime + base64 de data URI', () => {
    const r = parseDataUri('data:image/jpeg;base64,QUJD');
    expect(r).toEqual({ mime: 'image/jpeg', base64: 'QUJD' });
  });
  it('aceita base64 cru longo como jpeg', () => {
    const cru = 'QUJD'.repeat(10);
    expect(parseDataUri(cru)).toEqual({ mime: 'image/jpeg', base64: cru });
  });
  it('rejeita null/vazio/lixo', () => {
    expect(parseDataUri(null)).toBeNull();
    expect(parseDataUri('')).toBeNull();
    expect(parseDataUri('xx')).toBeNull();
  });
});

describe('normalizarFotosRelatorio', () => {
  it('converte linhas validas e descarta sem imagem', () => {
    const rows: FotoVistoriaRow[] = [
      { base64_overlay: 'data:image/jpeg;base64,QUJD', descricao: 'F1', municipio: 'X',
        logradouro: null, utm_zona: '23S', utm_e: 1, utm_n: 2, datum: 'SIRGAS 2000', colaborador: 'R', ordem: 0 },
      { base64_overlay: null, descricao: 'F2', municipio: null, logradouro: null,
        utm_zona: null, utm_e: null, utm_n: null, datum: null, colaborador: null, ordem: 1 },
    ];
    const out = normalizarFotosRelatorio(rows);
    expect(out).toHaveLength(1);
    expect(out[0].mime).toBe('image/jpeg');
    expect(out[0].base64).toBe('QUJD');
    expect(out[0].legenda).toContain('F1');
  });
});

describe('rasterizarSvg', () => {
  it('retorna null sem rasterizador nativo (degrada sem lancar)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
    const r = await rasterizarSvg(svg, 100);
    expect(r === null || Buffer.isBuffer(r)).toBe(true);
  });
  it('svg vazio -> null', async () => {
    expect(await rasterizarSvg('', 100)).toBeNull();
  });
});
