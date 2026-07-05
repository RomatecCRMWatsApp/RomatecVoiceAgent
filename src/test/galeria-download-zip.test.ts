// v3.90.0 — Download em lote (ZIP) da Galeria. As fotos são base64 no banco
// (galeria_fotos.arquivo_b64); gerarZipFotos converte pra Buffer e empacota com
// archiver. Cobre: lista vazia → 400, > 200 → 400, válido → ZIP (assinatura PK),
// foto ausente → pulada (não quebra), todas ausentes → 404.
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('../database/connection', () => ({ default: { execute: vi.fn() } }));

import pool from '../database/connection';
import { gerarZipFotos, ZipGaleriaError } from '../integrations/galeria';

const p = pool as unknown as { execute: Mock };

/** Linha fake de galeria_fotos (buscarFotoComB64 faz SELECT * → [[row]]). */
function fakeRow(id: number) {
  return [[{
    id, tenant_id: 1, user_id: null, user_nome: null, mime: 'image/jpeg',
    arquivo_b64: Buffer.from(`imagem-${id}`).toString('base64'),
    legenda: null, lat: null, lng: null, altitude_m: null, accuracy_m: null,
    endereco_reverso: 'Rua Exemplo 123', capturada_em: null, tags: null,
    obra_id: null, criada_em: '2026-01-01',
  }]];
}

describe('gerarZipFotos — download em lote da Galeria (v3.90.0)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lista vazia → erro 400', async () => {
    await expect(gerarZipFotos([])).rejects.toThrow(/Nenhuma foto selecionada/i);
    await gerarZipFotos([]).catch((e: unknown) => {
      expect(e).toBeInstanceOf(ZipGaleriaError);
      expect((e as ZipGaleriaError).status).toBe(400);
    });
    expect(p.execute).not.toHaveBeenCalled();
  });

  it('mais de 200 fotos → erro 400', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    await gerarZipFotos(ids).catch((e: unknown) => {
      expect(e).toBeInstanceOf(ZipGaleriaError);
      expect((e as ZipGaleriaError).status).toBe(400);
    });
    expect(p.execute).not.toHaveBeenCalled();
  });

  it('válido → retorna Buffer ZIP (assinatura PK)', async () => {
    p.execute.mockResolvedValueOnce(fakeRow(1)).mockResolvedValueOnce(fakeRow(2));
    const zip = await gerarZipFotos([1, 2]);
    expect(Buffer.isBuffer(zip)).toBe(true);
    expect(zip.length).toBeGreaterThan(0);
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK'); // assinatura de arquivo ZIP
  });

  it('foto ausente é PULADA (não quebra) — mistura ok + ausente ainda gera ZIP', async () => {
    p.execute.mockResolvedValueOnce(fakeRow(1)).mockResolvedValueOnce([[]]); // 2ª não existe
    const zip = await gerarZipFotos([1, 2]);
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('todas ausentes → erro 404', async () => {
    p.execute.mockResolvedValue([[]]);
    await gerarZipFotos([1, 2]).catch((e: unknown) => {
      expect(e).toBeInstanceOf(ZipGaleriaError);
      expect((e as ZipGaleriaError).status).toBe(404);
    });
  });
});
