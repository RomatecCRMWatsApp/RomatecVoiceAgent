// v3.122.0 — Valor de diária editável no apontamento.
//
// Contexto: a diária podia subir no meio da obra (ex.: R$170 → R$250). Antes,
// o único valor disponível era `romatec_obra_equipe.valor_dia`, então corrigir
// o cadastro reescrevia o cálculo dos dias já lançados. A coluna
// `romatec_obra_funcionario_dias.valor` já era um snapshot por dia — o que
// faltava era poder DIGITAR esse valor na marcação.
//
// Este teste cobre:
//   1. override do valor na marcação (integral e meia diária);
//   2. validação do override (zero, negativo, não-numérico, teto);
//   3. bloqueio de dias já comprometidos com folha emitida — no marcar E no
//      desmarcar (o DELETE não tinha guard nenhum: o front faz DELETE+POST pra
//      reaplicar período, então clicar num dia pago apagava a linha que a folha
//      fechada referencia);
//   4. `valor_diaria` + `bloqueado` expostos na listagem pro front travar a UI.
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('../database/connection', () => ({
  default: { execute: vi.fn(), query: vi.fn(), getConnection: vi.fn() },
}));
// obras.ts importa agent/proactive e integrations/telegram, que arrastam o SDK
// da Voyage (ESM quebrado sob vitest). Nada aqui usa parcela nem Telegram.
vi.mock('../agent/proactive', () => ({ broadcastParcelaEvent: vi.fn() }));
vi.mock('../integrations/telegram', () => ({ sendMessage: vi.fn() }));

import pool from '../database/connection';
import {
  marcarDiaTrabalhado,
  desmarcarDiaTrabalhado,
  listarDiasFuncionario,
} from '../integrations/obras';

const p = pool as unknown as { execute: Mock };

const FUNC = { id: 9, nome: 'Leonardo', funcao: 'Pedreiro', valor_dia: '170.00' };

/** Sequência de respostas do marcarDiaTrabalhado: SELECT equipe → guard → INSERT. */
function mockMarcar(opts: { bloqueio?: Record<string, unknown>[] } = {}) {
  p.execute
    .mockResolvedValueOnce([[FUNC]])                  // SELECT romatec_obra_equipe
    .mockResolvedValueOnce([opts.bloqueio ?? []])     // diasBloqueadosPorFolha
    .mockResolvedValueOnce([{ insertId: 101 }]);      // INSERT ... ON DUPLICATE KEY
}

/** Params do INSERT (3ª chamada) — [func, obra, data, periodo, valor, obs]. */
function paramsDoInsert(): unknown[] {
  const call = p.execute.mock.calls[2];
  return call[1] as unknown[];
}

describe('v3.122.0 — override do valor na marcação', () => {
  // resetAllMocks (nao clearAllMocks): precisa limpar a FILA de
  // mockResolvedValueOnce, senao respostas nao consumidas por um teste vazam
  // pro proximo e ele le a sequencia errada.
  beforeEach(() => vi.resetAllMocks());

  it('sem valor_diaria: usa a diária do cadastro (comportamento anterior)', async () => {
    mockMarcar();
    const r = await marcarDiaTrabalhado({
      funcionario_id: '9', data: '2026-07-10', periodo: 'integral', confirm: true,
    });
    expect(paramsDoInsert()[4]).toBe(170);
    expect(r.message).not.toMatch(/valor especial/);
  });

  it('com valor_diaria: grava o valor digitado, NÃO o do cadastro', async () => {
    mockMarcar();
    const r = await marcarDiaTrabalhado({
      funcionario_id: '9', data: '2026-07-10', periodo: 'integral',
      valor_diaria: 250, confirm: true,
    });
    expect(paramsDoInsert()[4]).toBe(250);
    // sinaliza no retorno que o dia saiu do valor cadastrado
    expect(r.message).toMatch(/valor especial/);
  });

  it('meia diária (manhã/tarde) grava METADE do valor digitado', async () => {
    mockMarcar();
    await marcarDiaTrabalhado({
      funcionario_id: '9', data: '2026-07-10', periodo: 'manha',
      valor_diaria: 250, confirm: true,
    });
    expect(paramsDoInsert()[4]).toBe(125);
  });

  it('arredonda pra 2 casas (diária ímpar em meia diária não vaza dízima)', async () => {
    mockMarcar();
    await marcarDiaTrabalhado({
      funcionario_id: '9', data: '2026-07-10', periodo: 'tarde',
      valor_diaria: 175.55, confirm: true,
    });
    expect(paramsDoInsert()[4]).toBe(87.78);
  });

  it('aceita valor_diaria como string (vem do input do front)', async () => {
    mockMarcar();
    await marcarDiaTrabalhado({
      funcionario_id: '9', data: '2026-07-10', periodo: 'integral',
      valor_diaria: '250', confirm: true,
    });
    expect(paramsDoInsert()[4]).toBe(250);
  });

  it('string vazia = ausente (cai no cadastro, não vira 0)', async () => {
    mockMarcar();
    await marcarDiaTrabalhado({
      funcionario_id: '9', data: '2026-07-10', periodo: 'integral',
      valor_diaria: '  ', confirm: true,
    });
    expect(paramsDoInsert()[4]).toBe(170);
  });

  it.each([
    ['zero', 0],
    ['negativo', -50],
    ['não-numérico', 'abc'],
    ['acima do teto', 100001],
  ])('rejeita valor_diaria %s', async (_label, valor) => {
    p.execute.mockResolvedValueOnce([[FUNC]]); // só o SELECT da equipe
    await expect(
      marcarDiaTrabalhado({
        funcionario_id: '9', data: '2026-07-10', periodo: 'integral',
        valor_diaria: valor as number, confirm: true,
      }),
    ).rejects.toThrow(/valor_diaria/);
  });
});

describe('v3.122.0 — bloqueio de dias já em folha emitida', () => {
  // resetAllMocks (nao clearAllMocks): precisa limpar a FILA de
  // mockResolvedValueOnce, senao respostas nao consumidas por um teste vazam
  // pro proximo e ele le a sequencia errada.
  beforeEach(() => vi.resetAllMocks());

  it('marcar: recusa dia vinculado a fechamento e NÃO chega no INSERT', async () => {
    mockMarcar({ bloqueio: [{ data: '2026-07-10', fechamento_id: 42, pago_legado: 0 }] });
    await expect(
      marcarDiaTrabalhado({
        funcionario_id: '9', data: '2026-07-10', periodo: 'integral',
        valor_diaria: 250, confirm: true,
      }),
    ).rejects.toThrow(/fechamento #42/);
    expect(p.execute).toHaveBeenCalledTimes(2); // SELECT + guard, sem INSERT
  });

  it('marcar: recusa dia coberto por recibo quinzenal legado pago', async () => {
    mockMarcar({ bloqueio: [{ data: '2026-07-10', fechamento_id: null, pago_legado: 1 }] });
    await expect(
      marcarDiaTrabalhado({
        funcionario_id: '9', data: '2026-07-10', periodo: 'integral', confirm: true,
      }),
    ).rejects.toThrow(/recibo quinzenal/);
  });

  it('desmarcar: recusa apagar dia em fechamento (regressão do DELETE sem guard)', async () => {
    p.execute.mockResolvedValueOnce([[{ data: '2026-07-10', fechamento_id: 42, pago_legado: 0 }]]);
    await expect(
      desmarcarDiaTrabalhado({ funcionario_id: '9', data: '2026-07-10', confirm: true }),
    ).rejects.toThrow(/fechamento #42/);
    expect(p.execute).toHaveBeenCalledTimes(1); // só o guard, o DELETE não roda
  });

  it('desmarcar: dia em aberto continua podendo ser apagado', async () => {
    p.execute
      .mockResolvedValueOnce([[]])                  // guard: nada bloqueado
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // DELETE
    const r = await desmarcarDiaTrabalhado({
      funcionario_id: '9', data: '2026-07-10', confirm: true,
    });
    expect(r.ok).toBe(true);
    expect(p.execute.mock.calls[1][0]).toMatch(/^DELETE FROM romatec_obra_funcionario_dias/);
  });

  it('dia sem linha ainda lançada nunca é bloqueado (marcação nova passa)', async () => {
    mockMarcar({ bloqueio: [] });
    const r = await marcarDiaTrabalhado({
      funcionario_id: '9', data: '2026-07-11', periodo: 'integral', confirm: true,
    });
    expect(r.ok).toBe(true);
  });
});

describe('v3.122.0 — listagem expõe o que a UI precisa pra travar/etiquetar', () => {
  // resetAllMocks (nao clearAllMocks): precisa limpar a FILA de
  // mockResolvedValueOnce, senao respostas nao consumidas por um teste vazam
  // pro proximo e ele le a sequencia errada.
  beforeEach(() => vi.resetAllMocks());

  it('devolve valor_diaria (cheia) e bloqueado por dia', async () => {
    p.execute.mockResolvedValueOnce([[
      // integral a R$250 (acima do cadastro) e em aberto
      { id: 1, funcionario_id: 9, obra_id: 3, data: '2026-07-10', periodo: 'integral',
        valor: '250.00', observacoes: null, fechamento_id: null,
        status_fechamento: null, data_pagamento: null, pago_legado: 0 },
      // meia diária: valor gravado é metade, valor_diaria reconstrói a cheia
      { id: 2, funcionario_id: 9, obra_id: 3, data: '2026-07-11', periodo: 'manha',
        valor: '125.00', observacoes: null, fechamento_id: null,
        status_fechamento: null, data_pagamento: null, pago_legado: 0 },
      // já em fechamento → travado
      { id: 3, funcionario_id: 9, obra_id: 3, data: '2026-07-12', periodo: 'integral',
        valor: '170.00', observacoes: null, fechamento_id: 42,
        status_fechamento: 'paga', data_pagamento: null, pago_legado: 0 },
      // pago pelo sistema legado → travado mesmo sem fechamento_id
      { id: 4, funcionario_id: 9, obra_id: 3, data: '2026-07-13', periodo: 'integral',
        valor: '170.00', observacoes: null, fechamento_id: null,
        status_fechamento: null, data_pagamento: null, pago_legado: 1 },
    ]]);

    const dias = await listarDiasFuncionario({ funcionario_id: '9' });

    expect(dias[0].valor_diaria).toBe(250);
    expect(dias[0].bloqueado).toBe(false);
    // meia diária: valor=125 no banco, mas a diária cheia daquele dia é 250
    expect(dias[1].valor).toBe(125);
    expect(dias[1].valor_diaria).toBe(250);
    expect(dias[2].bloqueado).toBe(true);
    expect(dias[3].bloqueado).toBe(true);
  });
});
