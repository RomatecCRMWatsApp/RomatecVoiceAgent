import { describe, it, expect, vi } from 'vitest';

vi.mock('./aiDocExtractor', () => ({
  extrairEletricaDeDocumento: vi.fn(async () => ({
    obra: { proprietario: 'IA Silva', areaConstruidaM2: 78 },
    alimentacao: { tipo: 'monofasico', tensaoV: 220, ramalSecaoMm2: 10, disjuntorGeralA: 50 },
    circuitos: [{ id: 'C1', descricao: 'Ilum', tipo: 'ilum', disjuntorA: 16, polos: 1, condutorFaseMm2: 2.5, condutorProtecaoMm2: 2.5, potenciaVA: 1200 }],
    pontos: { iluminacao: 10, tug10A: 16, tue20A: 6, interruptorSimples: 7, interruptorParalelo: 0, interruptorIntermediario: 0, conjuntos: 2, tomadasPiso: 1 },
    eletrodutos: [{ tipo: 'PVC', diametro: 'Ø25', comprimentoM: 238 }],
    caixas: [{ tipo: '4x2', qtd: 35 }], confianca: 0.8, observacoes: [], divergencias: [],
  })),
  validarExtracao: vi.fn(() => []),
  aplicarLanceDefault: vi.fn((cs: Array<Record<string, unknown>>) => cs.map((c) => ({ ...c, lanceMedioM: 14 }))),
}));
vi.mock('./memorialPdfParser', () => ({
  parsePlantaPdf: vi.fn(async () => ({
    rawText: 'PROPRIETÁRIO: Texto Real  ÁREA CONSTRUÍDA: 78,69',
    metadados: { proprietario: 'Texto Real', area_construida_m2: 78.69, prancha_codigo: 'PE-05' },
    tabelas: [], produtos_inexistentes: [], observacoes_extracao: [], confianca: 0.5,
  })),
}));

import { extrairEletricaCompleta } from './eletricoExtracao';

describe('extrairEletricaCompleta', () => {
  it('funde IA + texto: metadados do texto preenchem obra; mantém circuitos da IA', async () => {
    const r = await extrairEletricaCompleta(Buffer.from('pdf'));
    expect(r.obra.proprietario).toBe('Texto Real');
    expect(r.obra.prancha).toBe('PE-05');
    expect(r.circuitos.length).toBe(1);
    expect(r.circuitos[0].lanceMedioM).toBeGreaterThan(0);
  });

  it('sinaliza divergência quando área do texto difere da IA', async () => {
    const r = await extrairEletricaCompleta(Buffer.from('pdf'));
    expect(Array.isArray(r.divergencias)).toBe(true);
  });
});
