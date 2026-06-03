// v1.99.16 — Testes dos mappers DB → shape Prime.
import { describe, it, expect } from 'vitest';
import {
  reciboToReciboDados,
  propostaConsultoriaToPropostaDados,
  fmtDataCurta,
  fmtDataExtenso,
  type PropostaConsultoriaView,
} from './mappers';
import type { Recibo } from '../integrations/recibos';

function fakeRecibo(over: Partial<Recibo> = {}): Recibo {
  return {
    numero: 'REC-2026-0001',
    destinatario_nome: 'Maria Souza',
    destinatario_doc: '123.456.789-00',
    descricao_servico: 'Vistoria de obra',
    categoria_servico: null,
    valor: 2500,
    status: 'confirmado',
    hash_validacao: 'abc123',
    created_at: new Date('2026-06-01T10:00:00Z'),
    enviado_em: new Date('2026-06-02T09:00:00Z'),
    resposta_obs: null,
    ...over,
  } as unknown as Recibo;
}

describe('reciboToReciboDados', () => {
  it('mapeia campos principais', () => {
    const d = reciboToReciboDados(fakeRecibo(), 'https://romatec.app/');
    expect(d.numero).toBe('REC-2026-0001');
    expect(d.cliente.nome).toBe('Maria Souza');
    expect(d.cliente.cpfCnpj).toBe('123.456.789-00');
    expect(d.servico).toBe('Vistoria de obra');
    expect(d.valorTotal).toBe(2500);
    expect(d.valorTotalExtenso).toContain('dois mil e quinhentos reais');
  });
  it('monta urlVerificacao sem barra dupla e marca confirmado', () => {
    const d = reciboToReciboDados(fakeRecibo({ status: 'confirmado' }), 'https://romatec.app/');
    expect(d.urlVerificacao).toBe('https://romatec.app/v/abc123');
    expect(d.confirmado).toBe(true);
  });
  it('confirmado=false para status diferente', () => {
    expect(reciboToReciboDados(fakeRecibo({ status: 'enviado' }), 'x').confirmado).toBe(false);
  });
  it('fallback de doc e servico ausentes', () => {
    const d = reciboToReciboDados(
      fakeRecibo({ destinatario_doc: null, descricao_servico: null, categoria_servico: null }),
      'x',
    );
    expect(d.cliente.cpfCnpj).toBe('—');
    expect(d.servico).toBe('Servico Romatec');
  });
});

describe('propostaConsultoriaToPropostaDados', () => {
  const base: PropostaConsultoriaView = {
    numero: 'PROP-2026-0011',
    subtipo: 'georreferenciamento_rural',
    cliente: { nome: 'Joao Lima', cpf_cnpj: '999.999.999-99', cidade: 'Acailandia', estado: 'MA' },
    data_proposta: '2026-06-02',
    validade_dias: 30,
    valor_total: 8000,
    observacoes: 'obs',
    gestor_nome: null,
    gestor_cargo: null,
    dados_imovel: { nome: 'Fazenda X', municipio: 'Acailandia', uf: 'MA', area_ha: '50,00', matricula: 'M-9' },
    custos_calculados: {
      secao_1_projetos: ['Levantamento de campo', 'Processamento e peca tecnica'],
      secao_2_taxas: [{ ordem: 1, descricao: 'SIGEF', valor: 500 }],
      secao_3_honorarios: [
        { ordem: 1, descricao: 'Honorarios Romatec', valor: 7000 },
        { ordem: 2, descricao: 'Taxa pendente', valor: 0, pendente: true },
      ],
      condicoes_pagamento: [{ rotulo: 'P1 – 40%', descricao: 'Na assinatura', valor: 3200 }],
      secao_4_checklist: [],
      secao_5_total: 8000,
      avisos: [],
    },
  };

  it('mapeia tipoServico via SUBTIPO_LABEL e marca DRL para georref rural', () => {
    const d = propostaConsultoriaToPropostaDados(base);
    expect(d.tipoServico).toBe('Georreferenciamento de Imovel Rural');
    expect(d.drlIncluida).toBe(true);
  });
  it('servicos combinam honorarios + taxas; pendente vira valor null', () => {
    const d = propostaConsultoriaToPropostaDados(base);
    expect(d.servicos).toHaveLength(3);
    const pend = d.servicos.find((s) => s.descricao === 'Taxa pendente');
    expect(pend?.valor).toBeNull();
  });
  it('parcelas e etapas derivadas dos custos', () => {
    const d = propostaConsultoriaToPropostaDados(base);
    expect(d.parcelas[0].label).toBe('P1 – 40%');
    expect(d.etapas).toHaveLength(2);
    expect(d.etapas[0].numero).toBe('01');
  });
  it('imovel e valor por extenso', () => {
    const d = propostaConsultoriaToPropostaDados(base);
    expect(d.imovel?.nome).toBe('Fazenda X');
    expect(d.imovel?.areaHa).toBe('50,00');
    expect(d.valorTotalExtenso).toContain('oito mil reais');
  });
  it('subtipo nao-georref nao marca DRL', () => {
    const d = propostaConsultoriaToPropostaDados({ ...base, subtipo: 'avaliacao_ptam' });
    expect(d.drlIncluida).toBe(false);
    expect(d.tipoServico).toBe('Avaliacao de Imoveis (PTAM)');
  });
});

describe('formatadores de data', () => {
  it('fmtDataCurta', () => {
    expect(fmtDataCurta('2026-06-02')).toBe('02/06/2026');
    expect(fmtDataCurta(null)).toBe('—');
  });
  it('fmtDataExtenso', () => {
    expect(fmtDataExtenso('2026-06-02')).toBe('02 de junho de 2026');
  });
});
