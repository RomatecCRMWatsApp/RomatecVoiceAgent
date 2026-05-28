// v3.27.0: testes do mint atomico FQNS — usa mysql2 mock + vi.fn().

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mintarCodigosDemarcacao, mintarDeltaDemarcacao } from './mintCodigosDemarcacao';
import type { MarcoDiscriminado, CodigosMintadosFQNS } from './types';

interface MockState {
  prefixo: string | null;
  contadores: { V: number; M_CC: number; M_TG: number; P: number };
  commitCount: number;
  rollbackCount: number;
  selectQueries: string[];
}

function makeMockConn(state: MockState) {
  const conn = {
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {
      state.commitCount++;
    }),
    rollback: vi.fn(async () => {
      state.rollbackCount++;
    }),
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      const sqlNorm = String(sql).replace(/\s+/g, ' ').trim();
      state.selectQueries.push(sqlNorm);
      if (/SELECT[\s\S]*FROM users/i.test(sqlNorm)) {
        if (state.prefixo == null) return [[], []] as unknown;
        return [
          [
            {
              credencial_incra_prefixo: state.prefixo,
              credencial_contadores: { ...state.contadores },
            },
          ],
          [],
        ] as unknown;
      }
      if (/UPDATE users/i.test(sqlNorm)) {
        const params = _params as unknown[] | undefined;
        if (params && typeof params[0] === 'string') {
          state.contadores = JSON.parse(params[0]);
        }
        return [{ affectedRows: 1 }, []] as unknown;
      }
      return [[], []] as unknown;
    }),
  };
  return conn as unknown as Parameters<typeof mintarCodigosDemarcacao>[0];
}

function marco(tipo: MarcoDiscriminado['tipo'], qtd: number): MarcoDiscriminado {
  return { tipo, quantidade: qtd, valor_unitario_congelado: 100 };
}

let state: MockState;
beforeEach(() => {
  state = {
    prefixo: 'FQNS',
    contadores: { V: 0, M_CC: 0, M_TG: 0, P: 0 },
    commitCount: 0,
    rollbackCount: 0,
    selectQueries: [],
  };
});

describe('mintarCodigosDemarcacao — atomicidade FQNS (v3.27.0)', () => {
  it('1. Vertices: 8 vertices, contador zerado -> gera V-001 a V-008 com padding 3 digitos', async () => {
    const conn = makeMockConn(state);
    const r = await mintarCodigosDemarcacao(conn, 1, { num_vertices: 8, marcos: [] });
    expect(r.vertices).toEqual([
      'FQNS-V-001', 'FQNS-V-002', 'FQNS-V-003', 'FQNS-V-004',
      'FQNS-V-005', 'FQNS-V-006', 'FQNS-V-007', 'FQNS-V-008',
    ]);
    expect(state.commitCount).toBe(1);
    expect(state.contadores.V).toBe(8);
  });

  it('2. Marcos concreto: 6 marcos -> M-0001-CC a M-0006-CC; M_TG nao incrementa', async () => {
    const conn = makeMockConn(state);
    const r = await mintarCodigosDemarcacao(conn, 1, {
      num_vertices: 0,
      marcos: [marco('concreto', 6)],
    });
    expect(r.marcos_por_tipo.concreto).toEqual([
      'FQNS-M-0001-CC', 'FQNS-M-0002-CC', 'FQNS-M-0003-CC',
      'FQNS-M-0004-CC', 'FQNS-M-0005-CC', 'FQNS-M-0006-CC',
    ]);
    expect(state.contadores.M_CC).toBe(6);
    expect(state.contadores.M_TG).toBe(0);
    expect(state.contadores.P).toBe(0);
  });

  it('3. Marcos mistos: 4 concreto + 2 tubo + 3 madeira -> 3 contadores avancam independentemente', async () => {
    const conn = makeMockConn(state);
    const r = await mintarCodigosDemarcacao(conn, 1, {
      num_vertices: 9,
      marcos: [marco('concreto', 4), marco('tubo_galvanizado', 2), marco('madeira', 3)],
    });
    expect(r.marcos_por_tipo.concreto).toHaveLength(4);
    expect(r.marcos_por_tipo.tubo_galvanizado).toHaveLength(2);
    expect(r.marcos_por_tipo.madeira).toHaveLength(3);
    expect(r.vertices).toHaveLength(9);
    // V-codes sem sufixo material
    expect(r.vertices.every((c) => !/-(?:CC|TG|MD)$/.test(c))).toBe(true);
    expect(state.contadores).toEqual({ V: 9, M_CC: 4, M_TG: 2, P: 3 });
  });

  it('4. Contador vitalicio: proposta 1 com M_CC=0001..0008, proposta 2 comeca em M_CC=0009', async () => {
    const conn = makeMockConn(state);
    await mintarCodigosDemarcacao(conn, 1, { num_vertices: 0, marcos: [marco('concreto', 8)] });
    expect(state.contadores.M_CC).toBe(8);
    const r2 = await mintarCodigosDemarcacao(conn, 1, { num_vertices: 0, marcos: [marco('concreto', 2)] });
    expect(r2.marcos_por_tipo.concreto).toEqual(['FQNS-M-0009-CC', 'FQNS-M-0010-CC']);
    expect(state.contadores.M_CC).toBe(10);
  });

  it('5. Delta-mint: idempotencia quando nao ha mudancas -> retorna os codigos existentes sem tocar contador', async () => {
    const conn = makeMockConn(state);
    const existentes: CodigosMintadosFQNS = {
      prefixo: 'FQNS',
      mintado_em: '2026-05-01T10:00:00.000Z',
      vertices: ['FQNS-V-001', 'FQNS-V-002'],
      marcos_por_tipo: { concreto: ['FQNS-M-0001-CC'], tubo_galvanizado: [], madeira: [] },
    };
    const r = await mintarDeltaDemarcacao(conn, 1, {
      delta_vertices: 0,
      delta_marcos: [],
      codigos_existentes: existentes,
    });
    expect(r).toBe(existentes);
    expect(state.contadores).toEqual({ V: 0, M_CC: 0, M_TG: 0, P: 0 });
    expect(state.commitCount).toBe(0); // Nem chamou begin
  });

  it('6. Delta-mint em revisao: 4 concreto -> +2 -> codigos novos concatenados aos 4 originais', async () => {
    state.contadores = { V: 8, M_CC: 4, M_TG: 0, P: 0 };
    const conn = makeMockConn(state);
    const existentes: CodigosMintadosFQNS = {
      prefixo: 'FQNS',
      mintado_em: '2026-05-01T10:00:00.000Z',
      vertices: ['FQNS-V-001', 'FQNS-V-002', 'FQNS-V-003', 'FQNS-V-004', 'FQNS-V-005', 'FQNS-V-006', 'FQNS-V-007', 'FQNS-V-008'],
      marcos_por_tipo: {
        concreto: ['FQNS-M-0001-CC', 'FQNS-M-0002-CC', 'FQNS-M-0003-CC', 'FQNS-M-0004-CC'],
        tubo_galvanizado: [],
        madeira: [],
      },
    };
    const r = await mintarDeltaDemarcacao(conn, 1, {
      delta_vertices: 0,
      delta_marcos: [marco('concreto', 2)],
      codigos_existentes: existentes,
    });
    expect(r.marcos_por_tipo.concreto).toEqual([
      'FQNS-M-0001-CC', 'FQNS-M-0002-CC', 'FQNS-M-0003-CC', 'FQNS-M-0004-CC',
      'FQNS-M-0005-CC', 'FQNS-M-0006-CC',
    ]);
    expect(r.mintado_em).toBe(existentes.mintado_em); // timestamp original preservado
    expect(state.contadores.M_CC).toBe(6);
  });

  it('7. Usuario sem credencial_incra_prefixo -> throw com mensagem clara', async () => {
    state.prefixo = '';
    const conn = makeMockConn(state);
    await expect(
      mintarCodigosDemarcacao(conn, 1, { num_vertices: 3, marcos: [] }),
    ).rejects.toThrow(/sem credencial INCRA/i);
    expect(state.rollbackCount).toBe(1);
  });

  it('8. Lock atomico: 2 chamadas sequenciais com mesmo conn nao colidem (ordem preservada via FOR UPDATE)', async () => {
    const conn = makeMockConn(state);
    const r1 = await mintarCodigosDemarcacao(conn, 1, { num_vertices: 3, marcos: [marco('concreto', 1)] });
    const r2 = await mintarCodigosDemarcacao(conn, 1, { num_vertices: 3, marcos: [marco('concreto', 1)] });
    expect(r1.vertices[0]).toBe('FQNS-V-001');
    expect(r2.vertices[0]).toBe('FQNS-V-004');
    expect(r1.marcos_por_tipo.concreto[0]).toBe('FQNS-M-0001-CC');
    expect(r2.marcos_por_tipo.concreto[0]).toBe('FQNS-M-0002-CC');
    // FOR UPDATE foi usado em todas as selects
    expect(state.selectQueries.filter((q) => /FOR UPDATE/i.test(q)).length).toBe(2);
  });
});
