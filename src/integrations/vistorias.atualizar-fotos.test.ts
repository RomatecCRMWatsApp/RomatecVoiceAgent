// v3.67.0: garante que editar uma vistoria NAO apaga as fotos existentes —
// as fotos novas sao ANEXADAS (a remocao individual usa apagarFotoVistoria).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../database/connection', () => ({ default: { execute: vi.fn() } }));
// Corta a cadeia de imports pesada (whatsapp -> agent/think + ragIngest -> voyageai)
// que so e usada pelos envios, nao pelo atualizarVistoria sob teste.
vi.mock('./whatsapp', () => ({ sendDocument: vi.fn() }));
vi.mock('./telegram', () => ({ sendDocument: vi.fn() }));

import pool from '../database/connection';
import { atualizarVistoria } from './vistorias';

const exec = (pool as unknown as { execute: ReturnType<typeof vi.fn> }).execute;

function mockVistoriaRow() {
  return {
    id: 5, obra_id: 1, data: new Date('2026-06-16'), hora: null, titulo: 't',
    vistoriador: null, descricao: 'd', observacoes: null, pendencias: null,
    status_obra: 'regular', pdf_assinado: null, assinatura_meta: null, assinado_em: null,
  };
}

describe('atualizarVistoria — fotos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('NAO apaga fotos existentes e ANEXA as novas (ordem continua do max)', async () => {
    exec
      .mockResolvedValueOnce([[mockVistoriaRow()]])                                  // buscarVistoria: row
      .mockResolvedValueOnce([[{ id: 10, legenda: null, mime: 'image/jpeg', ordem: 0 }]]) // buscarVistoria: fotos
      .mockResolvedValueOnce([{ affectedRows: 1 }])                                  // UPDATE
      .mockResolvedValueOnce([[{ prox: 1 }]])                                        // SELECT MAX(ordem)+1
      .mockResolvedValueOnce([{ insertId: 11 }]);                                    // INSERT nova foto

    await atualizarVistoria({ id: '5', descricao: 'd2', fotos: [{ mime: 'image/jpeg', data_base64: 'AAA' }] });

    const sqls = exec.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' ').trim());
    expect(sqls.some((s) => /DELETE FROM romatec_obra_vistoria_fotos/i.test(s))).toBe(false);

    const insert = exec.mock.calls.find((c) => /INSERT INTO romatec_obra_vistoria_fotos/i.test(String(c[0])));
    expect(insert).toBeTruthy();
    expect(insert![1]).toEqual([5, null, 'image/jpeg', 'AAA', 1]); // anexada após ordem 0
  });

  it('sem fotos novas, nao toca nas fotos existentes', async () => {
    exec
      .mockResolvedValueOnce([[mockVistoriaRow()]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await atualizarVistoria({ id: '5', descricao: 'd2' });

    const sqls = exec.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /DELETE FROM romatec_obra_vistoria_fotos/i.test(s))).toBe(false);
    expect(sqls.some((s) => /INSERT INTO romatec_obra_vistoria_fotos/i.test(s))).toBe(false);
  });
});
