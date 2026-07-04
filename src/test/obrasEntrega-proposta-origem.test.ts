// v3.82.0 — Cobre os dois branches de proposta_origem (interna x externa) do
// módulo Entrega de Obra: criação no repositório e renderização do PDF.
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock do pool (execute + getConnection para as transações).
vi.mock('../database/connection', () => ({
  default: { execute: vi.fn(), getConnection: vi.fn() },
}));

import pool from '../database/connection';
import { criarDaProposta, criarExterna } from '../services/obrasEntregaRepo';
import { renderEntregaHtml } from '../services/obrasEntregaPdf';
import type { ObraEntrega } from '../types/obrasEntrega';

const p = pool as unknown as { execute: Mock; getConnection: Mock };

/** conn falso com execute sequenciável (INSERT depois UPDATE numero). */
function fakeConn() {
  const execute = vi.fn();
  const conn = {
    execute,
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  };
  return { conn, execute };
}

function rowEntrega(over: Record<string, unknown> = {}) {
  return {
    id: 7, colaborador_id: 'u1', proposta_id: null, proposta_origem: 'externa',
    numero: 'RE-2026-0007', titulo: 'T', cliente: 'Cli', valor_orcado: '100.00',
    valor_receber: '100.00', status: 'rascunho', hash_publico: null,
    proposta_externa_valor_orcado: '100.00', ...over,
  };
}

describe('Entrega de Obra — proposta_origem (repo)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('EXTERNA: exige o PDF (rejeita sem base64)', async () => {
    await expect(
      criarExterna('u1', { titulo: 'X', pdf: { nome: 'p.pdf', mime: 'application/pdf', base64: '' } }),
    ).rejects.toThrow(/obrigatóri/i);
    // Não deve nem abrir conexão/transação.
    expect(p.getConnection).not.toHaveBeenCalled();
  });

  it('EXTERNA: insere proposta_id NULL + proposta_origem=externa + guarda o PDF', async () => {
    const { conn, execute } = fakeConn();
    execute
      .mockResolvedValueOnce([{ insertId: 7 }])   // INSERT
      .mockResolvedValueOnce([{}]);               // UPDATE numero
    p.getConnection.mockResolvedValue(conn);
    p.execute
      .mockResolvedValueOnce([[rowEntrega()]])    // buscar: SELECT *
      .mockResolvedValueOnce([[]])                // carregarFotos
      .mockResolvedValueOnce([[]]);               // carregarMateriais

    const doc = await criarExterna('u1', {
      titulo: 'Reforma X', escopo: 'Escopo externo', valor_orcado: 100,
      pdf: { nome: 'orig.pdf', mime: 'application/pdf', base64: 'QUJD' },
    });

    const insert = execute.mock.calls[0];
    const sql = String(insert[0]).replace(/\s+/g, ' ');
    expect(sql).toMatch(/INSERT INTO obras_entregas/i);
    expect(sql).toMatch(/VALUES \(\?, NULL, 'externa'/);      // proposta_id NULL, origem externa
    expect(insert[1][0]).toBe('u1');                           // dono
    expect(insert[1]).toContain('QUJD');                       // base64 do PDF persistido
    expect(doc.proposta_origem).toBe('externa');
    expect(doc.proposta_id).toBeNull();
  });

  it('INTERNA: snapshot ausente rejeita "Proposta não encontrada"', async () => {
    p.execute.mockResolvedValueOnce([[]]); // snapshotProposta: nada
    await expect(criarDaProposta('u1', 999)).rejects.toThrow(/não encontrada/i);
    expect(p.getConnection).not.toHaveBeenCalled();
  });

  it('INTERNA: insere com proposta_id da proposta do sistema', async () => {
    const { conn, execute } = fakeConn();
    p.execute
      // snapshotProposta: SELECT join propostas+clientes
      .mockResolvedValueOnce([[{
        id: 5, numero: 'PROP-2026-0005', endereco_obra: 'Rua A', valor_total: '200.00',
        observacoes: 'obs', cliente_nome: 'Cli', cliente_telefone: '5599', cliente_cidade: 'Açailândia', cliente_estado: 'MA',
      }]])
      // buscar após criar:
      .mockResolvedValueOnce([[rowEntrega({ id: 9, proposta_id: 5, proposta_origem: 'interna' })]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    execute
      .mockResolvedValueOnce([{ insertId: 9 }]) // INSERT
      .mockResolvedValueOnce([{}]);             // UPDATE numero
    p.getConnection.mockResolvedValue(conn);

    const doc = await criarDaProposta('u1', 5);

    const insert = execute.mock.calls[0];
    const sql = String(insert[0]).replace(/\s+/g, ' ');
    expect(sql).toMatch(/INSERT INTO obras_entregas/i);
    expect(sql).not.toMatch(/'externa'/);   // interna não injeta literal de origem
    expect(insert[1][0]).toBe('u1');         // dono
    expect(insert[1][1]).toBe(5);            // proposta_id
    expect(doc.proposta_origem).toBe('interna');
    expect(doc.proposta_id).toBe(5);
  });
});

describe('Entrega de Obra — proposta_origem (PDF render)', () => {
  const base: ObraEntrega = {
    colaborador_id: 'u1', numero: 'RE-1', fotos: [], materiais_sobra: [],
  };

  it('INTERNA: usa o resumo da proposta, sem apêndice externo', () => {
    const html = renderEntregaHtml({
      ...base, proposta_origem: 'interna', resumo_proposta: 'ESCOPO_INTERNO_XYZ',
    });
    expect(html).toContain('Resumo da proposta original');
    expect(html).toContain('ESCOPO_INTERNO_XYZ');
    expect(html).not.toMatch(/anexada ao final/i);
  });

  it('EXTERNA: usa escopo manual e anuncia o PDF anexado', () => {
    const html = renderEntregaHtml({
      ...base, proposta_origem: 'externa',
      proposta_externa_titulo: 'TITULO_EXT', proposta_externa_escopo: 'ESCOPO_EXTERNO_ABC',
      proposta_externa_pdf_nome: 'orig.pdf',
    });
    expect(html).toContain('Resumo da proposta externa');
    expect(html).toContain('ESCOPO_EXTERNO_ABC');
    expect(html).toMatch(/anexada ao final/i);
    expect(html).toContain('orig.pdf');
  });

  it('MATERIAIS: foto do material aparece em miniatura no PDF', () => {
    const html = renderEntregaHtml({
      ...base, proposta_origem: 'interna',
      materiais_sobra: [{ material: 'Cimento', quantidade: 2, unidade: 'sc', foto_mime: 'image/jpeg', foto_base64: 'ZZZ123' }],
    });
    expect(html).toContain('mat-foto');
    expect(html).toContain('ZZZ123');
    expect(html).toContain('Cimento');
  });
});
