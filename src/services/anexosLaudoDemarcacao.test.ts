// v3.64.0 — testes do agregador read-only de anexos do laudo de demarcação.
// Mocka as fontes (laudos, arquivos vetoriais) e o pool (relatórios/pontos).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const buscarLaudo = vi.fn();
const listarFotosDoLaudo = vi.fn();
const listarArquivosVetoriais = vi.fn();
const execute = vi.fn();

vi.mock('../integrations/laudos', () => ({
  buscarLaudo: (...a: unknown[]) => buscarLaudo(...a),
  listarFotosDoLaudo: (...a: unknown[]) => listarFotosDoLaudo(...a),
}));
vi.mock('./arquivosVetoriaisService', () => ({
  listarArquivosVetoriais: (...a: unknown[]) => listarArquivosVetoriais(...a),
}));
vi.mock('../database/connection', () => ({
  default: { execute: (...a: unknown[]) => execute(...a) },
}));

import { listarAnexosDoLaudo } from './anexosLaudoDemarcacao';

const laudoBase = {
  id: 1,
  numero_laudo: 'LAUDO-2026-0033',
  tipo_imovel: 'URBANO',
  croqui_tipo: 'AUTO_SVG',
  recibo_id: null,
  assinado_em: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // padrão: sem pontos (COUNT=0), sem relatórios fotográficos
  execute.mockResolvedValue([[{ c: 0 }]]);
  listarFotosDoLaudo.mockResolvedValue([]);
  listarArquivosVetoriais.mockResolvedValue([]);
});

describe('listarAnexosDoLaudo', () => {
  it('lança 404 quando o laudo não existe', async () => {
    buscarLaudo.mockResolvedValueOnce(null);
    await expect(listarAnexosDoLaudo(999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('inclui o PDF de prévia quando o laudo não foi assinado', async () => {
    buscarLaudo.mockResolvedValueOnce({ ...laudoBase });
    const anexos = await listarAnexosDoLaudo(1);
    const pdf = anexos.find(a => a.categoria === 'pdf_laudo');
    expect(pdf).toBeDefined();
    expect(pdf?.url).toBe('/api/laudos-demarcacao/1/pdf');
    expect(pdf?.podeExcluir).toBe(false);
  });

  it('usa o PDF assinado quando há assinado_em', async () => {
    buscarLaudo.mockResolvedValueOnce({ ...laudoBase, assinado_em: '2026-06-10T12:00:00Z' });
    const anexos = await listarAnexosDoLaudo(1);
    const pdf = anexos.find(a => a.categoria === 'pdf_laudo');
    expect(pdf?.url).toBe('/api/laudos-demarcacao/1/pdf-assinado');
    expect(pdf?.rotulo).toContain('assinado');
  });

  it('agrega recibo, foto e arquivo avulso com as flags de exclusão corretas', async () => {
    buscarLaudo.mockResolvedValueOnce({ ...laudoBase, recibo_id: 42 });
    listarFotosDoLaudo.mockResolvedValueOnce([
      { id: 7, laudo_id: 1, ponto_id: 3, ordem: 1, mime: 'image/jpeg', legenda: 'P1', created_at: '2026-06-01' },
    ]);
    listarArquivosVetoriais.mockResolvedValueOnce([
      { id: 9, laudo_id: 1, tipo: 'dxf', nome_original: 'planta.dxf', tamanho_bytes: 2048,
        mime_type: 'image/vnd.dxf', download_token: 'tok123', created_at: '2026-06-02' },
    ]);

    const anexos = await listarAnexosDoLaudo(1);
    const categorias = anexos.map(a => a.categoria);
    expect(categorias).toContain('recibo');
    expect(categorias).toContain('foto');
    expect(categorias).toContain('dxf');

    const recibo = anexos.find(a => a.categoria === 'recibo');
    expect(recibo?.url).toBe('/api/recibos/42/pdf');

    const foto = anexos.find(a => a.categoria === 'foto');
    expect(foto?.url).toBe('/api/laudos-demarcacao/foto/7');
    expect(foto?.podeExcluir).toBe(false);

    const arquivo = anexos.find(a => a.categoria === 'dxf');
    expect(arquivo?.url).toBe('/d/tok123');
    expect(arquivo?.podeExcluir).toBe(true);
    expect(arquivo?.excluirUrl).toBe('/api/laudos-demarcacao/1/arquivos/9');
  });

  it('inclui o croqui quando há 2+ pontos (AUTO_SVG)', async () => {
    buscarLaudo.mockResolvedValueOnce({ ...laudoBase });
    execute.mockReset();
    // 1ª chamada: COUNT de pontos = 4; demais (relatórios) → vazio
    execute.mockResolvedValueOnce([[{ c: 4 }]]).mockResolvedValue([[]]);
    const anexos = await listarAnexosDoLaudo(1);
    const croqui = anexos.find(a => a.categoria === 'croqui');
    expect(croqui).toBeDefined();
    expect(croqui?.url).toBe('/api/laudos-demarcacao/1/croqui');
    expect(croqui?.mimeType).toBe('image/svg+xml');
  });

  it('omite o croqui AUTO_SVG sem pontos suficientes', async () => {
    buscarLaudo.mockResolvedValueOnce({ ...laudoBase });
    const anexos = await listarAnexosDoLaudo(1);
    expect(anexos.find(a => a.categoria === 'croqui')).toBeUndefined();
  });
});
