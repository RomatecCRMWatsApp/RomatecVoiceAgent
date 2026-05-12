// src/services/plantaQuadraPdfSection.test.ts
//
// Testa a guarda tripla da seção "Planta da Quadra" (v3.6.0):
//   URBANO + lote_loteamento_id + geometria existe.
//
// Mockamos carregarPlantaQuadra pra isolar a função.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCarregar = vi.fn();
vi.mock('../integrations/loteamentos', () => ({
  carregarPlantaQuadra: (id: number) => mockCarregar(id),
}));

import { secaoPlantaQuadra } from './plantaQuadraPdfSection';

function makeFakeDoc() {
  const fake = {
    addPage: vi.fn(() => fake),
    fontSize: vi.fn(() => fake),
    fillColor: vi.fn(() => fake),
    strokeColor: vi.fn(() => fake),
    fillOpacity: vi.fn(() => fake),
    lineWidth: vi.fn(() => fake),
    font: vi.fn(() => fake),
    text: vi.fn(() => fake),
    rect: vi.fn(() => fake),
    moveTo: vi.fn(() => fake),
    lineTo: vi.fn(() => fake),
    closePath: vi.fn(() => fake),
    fill: vi.fn(() => fake),
    stroke: vi.fn(() => fake),
  };
  return fake;
}

describe('secaoPlantaQuadra — guarda tripla', () => {
  beforeEach(() => {
    mockCarregar.mockReset();
  });

  it('rural pula — não chama carregarPlantaQuadra', async () => {
    const doc = makeFakeDoc();
    await secaoPlantaQuadra(doc as unknown as PDFKit.PDFDocument, {
      tipo_imovel: 'RURAL',
      lote_loteamento_id: 5,
    });
    expect(mockCarregar).not.toHaveBeenCalled();
    expect(doc.addPage).not.toHaveBeenCalled();
  });

  it('urbano sem lote_loteamento_id pula', async () => {
    const doc = makeFakeDoc();
    await secaoPlantaQuadra(doc as unknown as PDFKit.PDFDocument, {
      tipo_imovel: 'URBANO',
      lote_loteamento_id: null,
    });
    expect(mockCarregar).not.toHaveBeenCalled();
    expect(doc.addPage).not.toHaveBeenCalled();
  });

  it('urbano com lote_loteamento_id mas sem geometria → carrega mas pula desenho', async () => {
    mockCarregar.mockResolvedValue(null);
    const doc = makeFakeDoc();
    await secaoPlantaQuadra(doc as unknown as PDFKit.PDFDocument, {
      tipo_imovel: 'URBANO',
      lote_loteamento_id: 5,
    });
    expect(mockCarregar).toHaveBeenCalledWith(5);
    expect(doc.addPage).not.toHaveBeenCalled();
  });

  it('caso completo → desenha (addPage chamado, texto da quadra emitido)', async () => {
    const polyJson = (x0: number) => JSON.stringify({
      type: 'Polygon',
      coordinates: [[[x0,0],[x0+10,0],[x0+10,20],[x0,20],[x0,0]]],
    });
    mockCarregar.mockResolvedValue({
      lote: { id: 2, numero_lote: '2', geojson: polyJson(10) },
      quadra: {
        id: 100, nome: 'Q-01',
        geojson: JSON.stringify({
          type: 'Polygon',
          coordinates: [[[0,0],[30,0],[30,20],[0,20],[0,0]]],
        }),
      },
      vizinhos: [
        { id: 1, numero_lote: '1', geojson: polyJson(0) },
        { id: 3, numero_lote: '3', geojson: polyJson(20) },
      ],
    });
    const doc = makeFakeDoc();
    await secaoPlantaQuadra(doc as unknown as PDFKit.PDFDocument, {
      tipo_imovel: 'URBANO',
      lote_loteamento_id: 2,
    });
    expect(mockCarregar).toHaveBeenCalledWith(2);
    expect(doc.addPage).toHaveBeenCalledTimes(1);
    // v3.6.1: título normaliza "Q-01" → "Q. 01"
    const tituloChamada = (doc.text.mock.calls as unknown[][]).find(
      args => typeof args[0] === 'string' && (args[0] as string).includes('Q. 01'),
    );
    expect(tituloChamada).toBeTruthy();
    // E o lote-objeto é rotulado pelo numero_lote do cadastro quando o laudo
    // não tem override
    const labelLoteChamada = (doc.text.mock.calls as unknown[][]).find(
      args => typeof args[0] === 'string' && (args[0] as string) === 'LOTE 2',
    );
    expect(labelLoteChamada).toBeTruthy();
  });

  // v3.6.1 — Quando o laudo tem quadra/numero_lote digitados (seção 3 do PDF),
  // eles DEVEM ser usados na Planta da Quadra. Cenário real: cadastro vinculado
  // tem labels divergentes (CSV mal-formatado), mas a seção 3 e a planta
  // precisam contar a mesma história. Geometria continua vindo do cadastro.
  it('labels do laudo têm precedência sobre cadastro (corrige swap CSV Colina Park)', async () => {
    const polyJson = (x0: number) => JSON.stringify({
      type: 'Polygon',
      coordinates: [[[x0,0],[x0+10,0],[x0+10,20],[x0,20],[x0,0]]],
    });
    // Cadastro tem labels SWAPPED — quadra="24", lote="15"
    mockCarregar.mockResolvedValue({
      lote: { id: 5, numero_lote: '15', geojson: polyJson(10) },
      quadra: {
        id: 200, nome: 'Q. 24',
        geojson: JSON.stringify({
          type: 'Polygon',
          coordinates: [[[0,0],[30,0],[30,20],[0,20],[0,0]]],
        }),
      },
      vizinhos: [],
    });
    const doc = makeFakeDoc();
    // Laudo declara o que deve aparecer no PDF: Quadra 15, Lote 24
    await secaoPlantaQuadra(doc as unknown as PDFKit.PDFDocument, {
      tipo_imovel: 'URBANO',
      lote_loteamento_id: 5,
      quadra: '15',
      numero_lote: '24',
    });
    // Título usa o valor do laudo, normalizado pra "Q. 15"
    const tituloChamada = (doc.text.mock.calls as unknown[][]).find(
      args => typeof args[0] === 'string' && (args[0] as string).includes('PLANTA DA QUADRA — Q. 15'),
    );
    expect(tituloChamada).toBeTruthy();
    // Não deve aparecer "Q. 24" (do cadastro divergente)
    const tituloErrado = (doc.text.mock.calls as unknown[][]).find(
      args => typeof args[0] === 'string' && (args[0] as string).includes('Q. 24'),
    );
    expect(tituloErrado).toBeFalsy();
    // Label do lote-objeto usa numero_lote do laudo
    const labelChamada = (doc.text.mock.calls as unknown[][]).find(
      args => typeof args[0] === 'string' && (args[0] as string) === 'LOTE 24',
    );
    expect(labelChamada).toBeTruthy();
    // Não deve aparecer "LOTE 15" (do cadastro divergente)
    const labelErrado = (doc.text.mock.calls as unknown[][]).find(
      args => typeof args[0] === 'string' && (args[0] as string) === 'LOTE 15',
    );
    expect(labelErrado).toBeFalsy();
  });

  // v3.6.1 — Já normalizado: aceita "Q-XX", "QUADRA XX", "Q. XX" e "XX" cru
  it('normaliza variantes de nome de quadra no título', async () => {
    const variantes: Array<[string, string]> = [
      ['Q-01', 'PLANTA DA QUADRA — Q. 01'],
      ['QUADRA 03', 'PLANTA DA QUADRA — Q. 03'],
      ['Q. 24', 'PLANTA DA QUADRA — Q. 24'],
      ['15', 'PLANTA DA QUADRA — Q. 15'],
    ];
    for (const [nome, titulo] of variantes) {
      mockCarregar.mockReset();
      mockCarregar.mockResolvedValue({
        lote: { id: 1, numero_lote: '1', geojson: JSON.stringify({
          type: 'Polygon', coordinates: [[[5,5],[10,5],[10,10],[5,10],[5,5]]],
        })},
        quadra: { id: 1, nome, geojson: JSON.stringify({
          type: 'Polygon', coordinates: [[[0,0],[20,0],[20,20],[0,20],[0,0]]],
        })},
        vizinhos: [],
      });
      const doc = makeFakeDoc();
      await secaoPlantaQuadra(doc as unknown as PDFKit.PDFDocument, {
        tipo_imovel: 'URBANO',
        lote_loteamento_id: 1,
      });
      const t = (doc.text.mock.calls as unknown[][]).find(
        args => typeof args[0] === 'string' && (args[0] as string) === titulo,
      );
      expect(t, `nome="${nome}" deveria gerar título "${titulo}"`).toBeTruthy();
    }
  });

  it('carregar lança → não quebra, omite silenciosamente', async () => {
    mockCarregar.mockRejectedValue(new Error('db down'));
    const doc = makeFakeDoc();
    await expect(
      secaoPlantaQuadra(doc as unknown as PDFKit.PDFDocument, {
        tipo_imovel: 'URBANO',
        lote_loteamento_id: 7,
      }),
    ).resolves.toBeUndefined();
    expect(doc.addPage).not.toHaveBeenCalled();
  });
});
