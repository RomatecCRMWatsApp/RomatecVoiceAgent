// v1.99.15 — BUG 2: parcelas R$ 0,00 no PDF de proposta PTAM.
// Cobre (a) o engine PTAM produzindo parcelas não-zero e com fechamento, e
// (b) o guard defensivo do mapper que recompõe parcelas quando vêm 0/undefined.
import { describe, it, expect } from 'vitest';
import { calcularAvaliacaoPTAM } from '../services/pricing/ptam';
import {
  propostaConsultoriaToPropostaDados,
  type PropostaConsultoriaView,
} from '../pdf/mappers';
import type { InputAvaliacaoPTAM } from '../services/pricing/types';

const inputPTAM: InputAvaliacaoPTAM = {
  tipo_imovel: 'rural',
  area_terreno: 726,
  area_construida: 0,
  localizacao: { municipio: 'Acailandia' },
  finalidade: 'inventario',
  nivel_precisao: 'normal',
  faixa_honorario: '4_fazenda_grande',
};

describe('PTAM — engine de parcelas', () => {
  it('parcelas PTAM nunca retornam valor 0', async () => {
    const { custos } = await calcularAvaliacaoPTAM(inputPTAM);
    const cps = custos.condicoes_pagamento ?? [];
    expect(cps).toHaveLength(2);
    for (const cp of cps) {
      expect(typeof cp.valor).toBe('number');
      expect(Number.isFinite(cp.valor)).toBe(true);
      expect(cp.valor).toBeGreaterThan(0);
    }
  });

  it('parcela_1 + parcela_2 = total (fechamento)', async () => {
    const { custos } = await calcularAvaliacaoPTAM(inputPTAM);
    const cps = custos.condicoes_pagamento ?? [];
    const soma = cps.reduce((s, cp) => s + Number(cp.valor), 0);
    // secao_5_total = taxas + honorarios; as 2 parcelas são 50/50 do total.
    expect(soma).toBeCloseTo(custos.secao_5_total, 2);
  });
});

function viewComParcelas(
  cps: Array<{ rotulo: string; descricao: string; valor: number }>,
  valor_total = 10000,
): PropostaConsultoriaView {
  return {
    numero: 'PROP-TEST-PTAM',
    subtipo: 'avaliacao_ptam',
    cliente: { nome: 'Cliente Teste', cpf_cnpj: '000.000.000-00' },
    data_proposta: '2026-06-03',
    validade_dias: 15,
    valor_total,
    custos_calculados: {
      secao_1_projetos: [],
      secao_2_taxas: [],
      secao_3_honorarios: [],
      condicoes_pagamento: cps,
      secao_4_checklist: [],
      secao_5_total: valor_total,
      avisos: [],
    },
  };
}

describe('Mapper — guard de defesa das parcelas', () => {
  it('guard de defesa recomputa parcelas quando valor = 0 (partes iguais)', () => {
    const dados = propostaConsultoriaToPropostaDados(
      viewComParcelas([
        { rotulo: '1a parcela', descricao: 'na assinatura', valor: 0 },
        { rotulo: '2a parcela', descricao: 'na entrega', valor: 0 },
      ]),
    );
    expect(dados.parcelas).toHaveLength(2);
    for (const p of dados.parcelas) {
      expect(p.descricao).not.toContain('R$ 0,00');
      expect(p.descricao).toContain('R$ 5.000,00'); // 10000 / 2
    }
  });

  it('guard recompõe por percentual quando o rótulo traz a porcentagem', () => {
    const dados = propostaConsultoriaToPropostaDados(
      viewComParcelas([
        { rotulo: 'P1 – 40%', descricao: 'na assinatura', valor: 0 },
        { rotulo: 'P2 – 60%', descricao: 'na entrega', valor: 0 },
      ]),
    );
    expect(dados.parcelas[0].descricao).toContain('R$ 4.000,00'); // 40%
    expect(dados.parcelas[1].descricao).toContain('R$ 6.000,00'); // 60%
  });

  it('não altera parcelas quando os valores já são válidos', () => {
    const dados = propostaConsultoriaToPropostaDados(
      viewComParcelas([
        { rotulo: '1a parcela', descricao: 'na assinatura', valor: 3000 },
        { rotulo: '2a parcela', descricao: 'na entrega', valor: 7000 },
      ]),
    );
    expect(dados.parcelas[0].descricao).toContain('R$ 3.000,00');
    expect(dados.parcelas[1].descricao).toContain('R$ 7.000,00');
  });

  it('valor undefined não vira TypeError nem "R$ 0,00" silencioso', () => {
    const dados = propostaConsultoriaToPropostaDados(
      viewComParcelas([
        { rotulo: '1a parcela – 50%', descricao: 'na assinatura', valor: undefined as unknown as number },
        { rotulo: '2a parcela – 50%', descricao: 'na entrega', valor: undefined as unknown as number },
      ]),
    );
    expect(dados.parcelas[0].descricao).toContain('R$ 5.000,00');
  });
});
