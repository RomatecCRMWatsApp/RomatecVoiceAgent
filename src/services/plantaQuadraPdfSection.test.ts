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
    // Título da quadra entra como argumento de doc.text
    const tituloChamada = (doc.text.mock.calls as unknown[][]).find(
      args => typeof args[0] === 'string' && (args[0] as string).includes('Q-01'),
    );
    expect(tituloChamada).toBeTruthy();
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
