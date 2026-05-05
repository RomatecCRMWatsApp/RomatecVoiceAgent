// v1.66.0: leitor de taxas da Prefeitura de Acailandia. Sem API publica.
// Valores manuais em config/pricing-params.json -> prefeitura_acailandia.
// Quando null, retorna { valor: null, pendente: true } pra UI/PDF
// imprimirem "A confirmar com a Prefeitura".

import { getParams } from '../pricing/params';

export interface TaxaPrefeitura {
  valor: number | null;
  pendente: boolean;
  rotulo: string;
  observacao_pdf: string;
}

export function taxaHabiteSe(): TaxaPrefeitura {
  const v = getParams().prefeitura_acailandia.habite_se;
  return {
    valor: v,
    pendente: v == null,
    rotulo: 'Taxa de Habite-se — Prefeitura Acailandia',
    observacao_pdf: v == null
      ? 'A confirmar com a Prefeitura de Acailandia (Secretaria de Obras).'
      : '',
  };
}

export function taxaAlvaraConstrucao(): TaxaPrefeitura {
  const v = getParams().prefeitura_acailandia.alvara_construcao;
  return {
    valor: v,
    pendente: v == null,
    rotulo: 'Alvara de Construcao — Prefeitura Acailandia',
    observacao_pdf: v == null
      ? 'A confirmar com a Prefeitura de Acailandia (Secretaria de Obras).'
      : '',
  };
}

export function taxaAprovacaoDesmembramento(): TaxaPrefeitura {
  const v = getParams().prefeitura_acailandia.aprovacao_desmembramento;
  return {
    valor: v,
    pendente: v == null,
    rotulo: 'Aprovacao de Desmembramento — Prefeitura Acailandia',
    observacao_pdf: v == null
      ? 'A confirmar com a Prefeitura de Acailandia (Secretaria de Obras).'
      : '',
  };
}
