// v3.54.0 — Testes do módulo Diligências (lógica pura: templates + helpers).
// As rotas/DB dependem de MySQL; aqui cobrimos as funções determinísticas que
// concentram a regra de negócio (mensagens, telefone, classificação de resposta).
import { describe, it, expect } from 'vitest';
import {
  FINALIDADE_LABEL,
  fmtDataHora,
  normalizarTelefone,
  telefoneValido,
  classificarResposta,
  montarMensagemConfirmacao,
  montarMensagemLembrete,
} from '../services/diligenciaMensagem';
import { DILIGENCIA_FINALIDADES } from '../types/diligencia';

describe('FINALIDADE_LABEL', () => {
  it('cobre as 7 finalidades', () => {
    for (const f of DILIGENCIA_FINALIDADES) {
      expect(typeof FINALIDADE_LABEL[f]).toBe('string');
      expect(FINALIDADE_LABEL[f].length).toBeGreaterThan(0);
    }
  });
});

describe('fmtDataHora', () => {
  it('formata pt-BR dd/MM/aaaa às HH:mm', () => {
    expect(fmtDataHora(new Date(2026, 5, 3, 14, 30))).toBe('03/06/2026 às 14:30');
  });
  it('data inválida vira string crua', () => {
    expect(fmtDataHora('xx')).toBe('xx');
  });
});

describe('normalizarTelefone', () => {
  it('mantém só dígitos', () => {
    expect(normalizarTelefone('+55 (99) 9 9181-1246')).toBe('5599991811246');
    expect(normalizarTelefone('')).toBe('');
  });
});

describe('telefoneValido', () => {
  it('aceita 10 a 13 dígitos', () => {
    expect(telefoneValido('9912345678')).toBe(true); // 10
    expect(telefoneValido('5599991811246')).toBe(true); // 13
  });
  it('rejeita curto/longo demais', () => {
    expect(telefoneValido('123')).toBe(false);
    expect(telefoneValido('12345678901234')).toBe(false);
  });
});

describe('classificarResposta', () => {
  it('SIM e variações', () => {
    expect(classificarResposta('SIM')).toBe('sim');
    expect(classificarResposta('sim, confirmo')).toBe('sim');
    expect(classificarResposta('Confirmado!')).toBe('sim');
  });
  it('REMARCAR e variações', () => {
    expect(classificarResposta('REMARCAR')).toBe('remarcar');
    expect(classificarResposta('quero reagendar')).toBe('remarcar');
    expect(classificarResposta('pode ser outro horario?')).toBe('remarcar');
  });
  it('NÃO e variações (com e sem acento)', () => {
    expect(classificarResposta('NÃO')).toBe('nao');
    expect(classificarResposta('nao posso')).toBe('nao');
    expect(classificarResposta('cancelar por favor')).toBe('nao');
  });
  it('texto irreconhecível → null', () => {
    expect(classificarResposta('bom dia tudo bem?')).toBeNull();
    expect(classificarResposta('')).toBeNull();
  });
});

const vars = {
  nomeCliente: 'João Lima',
  numProposta: 'PROP-2026-0034',
  finalidade: 'avaliacao' as const,
  enderecoImovel: 'Rua 16 Qd 24 Lt 22',
  dataHora: new Date(2026, 5, 3, 14, 30),
};

describe('montarMensagemConfirmacao', () => {
  it('contém nome, proposta, finalidade, endereço, data e opções', () => {
    const m = montarMensagemConfirmacao(vars);
    expect(m).toContain('João Lima');
    expect(m).toContain('PROP-2026-0034');
    expect(m).toContain('Avaliação de Imóvel');
    expect(m).toContain('Rua 16 Qd 24 Lt 22');
    expect(m).toContain('03/06/2026 às 14:30');
    expect(m).toContain('SIM');
    expect(m).toContain('REMARCAR');
    expect(m).toContain('NÃO');
  });
  it('fallback de endereço quando ausente', () => {
    const m = montarMensagemConfirmacao({ ...vars, enderecoImovel: null });
    expect(m).toContain('endereço constante na proposta');
  });
});

describe('montarMensagemLembrete', () => {
  it('é o lembrete D-1 com finalidade e proposta', () => {
    const m = montarMensagemLembrete(vars);
    expect(m).toContain('amanhã');
    expect(m).toContain('Avaliação de Imóvel');
    expect(m).toContain('PROP-2026-0034');
  });
});
