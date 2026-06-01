// v3.53.0 — Task 1 (plano VTA): testes puros do gerador de PDF do Relatorio
// Fotografico. Sem DB, sem PDFKit render — so os helpers de legenda/paginacao.
import { describe, it, expect } from 'vitest';
import { legendaFotoRelatorio, paginarFotos, type FotoVistoriaPdf } from './relatorioFotograficoPdf';

const base: FotoVistoriaPdf = {
  base64_overlay: null, descricao: 'Fachada frontal', municipio: 'Acailandia',
  logradouro: 'Rua A', utm_zona: '23S', utm_e: 678910.5, utm_n: 9456789.2,
  datum: 'SIRGAS 2000', colaborador: 'Romario', horario_captura: '2026-05-31T14:30:00',
};

describe('legendaFotoRelatorio', () => {
  it('inclui descricao, local, UTM georref, datum e colaborador', () => {
    const l = legendaFotoRelatorio(base, 1);
    expect(l).toContain('Fachada frontal');
    expect(l).toContain('Rua A/Acailandia');
    expect(l).toContain('UTM 23S');
    expect(l).toContain('678.911'); // arredonda + pt-BR
    expect(l).toContain('SIRGAS 2000');
    expect(l).toContain('Romario');
  });
  it('usa fallback de indice quando nao ha descricao', () => {
    const l = legendaFotoRelatorio({ ...base, descricao: null }, 3);
    expect(l).toContain('Registro fotográfico 3');
  });
  it('omite georref quando coords ausentes', () => {
    const l = legendaFotoRelatorio({ ...base, utm_e: null, utm_n: null, datum: null }, 2);
    expect(l).not.toContain('UTM');
  });
});

describe('paginarFotos', () => {
  it('agrupa em paginas de N', () => {
    const arr = Array.from({ length: 5 }, (_, i) => ({ ...base, descricao: 'F' + i }));
    const pgs = paginarFotos(arr, 2);
    expect(pgs.length).toBe(3);
    expect(pgs[0].length).toBe(2);
    expect(pgs[2].length).toBe(1);
  });
  it('lista vazia retorna []', () => {
    expect(paginarFotos([], 4)).toEqual([]);
  });
  it('porPagina invalido cai no default 4', () => {
    const arr = Array.from({ length: 4 }, (_, i) => ({ ...base }));
    expect(paginarFotos(arr, 0).length).toBe(1);
  });
});
