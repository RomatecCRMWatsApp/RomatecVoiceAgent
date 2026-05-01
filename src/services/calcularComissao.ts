// v1.54.0 — Calculadora de comissão de corretagem.
//
// Base: Tabela CRECI/MA sugestiva (CRECI 16ª Região). É SUGESTIVA, não é lei —
// pode ser livremente negociada entre as partes. O contrato de corretagem é
// regido pelo Código Civil arts. 722-729 (a comissão é devida quando a
// aproximação útil é resultado da intermediação do corretor — mesmo que o
// negócio seja fechado depois sem ele presente).
//
// Tabelas usadas:
//   COMPRA_E_VENDA_URBANO: 6%   (sugestivo CRECI)
//   COMPRA_E_VENDA_RURAL:  10%  (rural cobra mais por dificuldade)
//   COMPRA_E_VENDA_INDUSTRIAL: 8%
//   PERMUTA: 4% sobre o MAIOR valor (cada parte paga sobre o seu lado)
//   LOCAÇÃO_RESIDENCIAL: 1 aluguel (taxa de intermediação) + 8% mensal (administração)
//   LOCAÇÃO_COMERCIAL: 1 aluguel + 10% mensal
//   ADMINISTRAÇÃO_AVULSA: 8-10% sobre aluguel mensal
//   AVALIAÇÃO/PERÍCIA: 1-3% do valor avaliado, mín. 1 SM (R$ 1.518 em 2026)
//
// Splits típicos:
//   - Imobiliária X corretor único: 50/50
//   - Captador + Vendedor + Imobiliária: 30/30/40 (configurável)
//   - Corretor autônomo: 100% (se ele captou + vendeu sozinho fora da casa)

export type TipoOperacao =
  | 'venda_urbano'
  | 'venda_rural'
  | 'venda_industrial'
  | 'permuta'
  | 'locacao_residencial'
  | 'locacao_comercial'
  | 'administracao'
  | 'avaliacao';

interface TabelaCreci {
  percentual?:           number;  // p/ vendas e admin (ex: 0.06)
  taxa_intermediacao?:   number;  // p/ locação, em meses de aluguel (ex: 1)
  taxa_administracao?:   number;  // mensal s/ aluguel (ex: 0.08)
  base_calculo:          string;  // descrição
  observacoes:           string;
}

const TABELA: Record<TipoOperacao, TabelaCreci> = {
  venda_urbano: {
    percentual: 0.06,
    base_calculo: 'valor da venda (urbano)',
    observacoes: 'Sugestivo CRECI 16ª Região (MA): 6% urbano. Negociável.',
  },
  venda_rural: {
    percentual: 0.10,
    base_calculo: 'valor da venda (rural)',
    observacoes: 'Sugestivo CRECI: 10% rural. Justifica-se pela dificuldade de comercialização (georreferenciamento, certidões INCRA, prazos maiores).',
  },
  venda_industrial: {
    percentual: 0.08,
    base_calculo: 'valor da venda (galpão/indústria/comercial)',
    observacoes: 'Sugestivo CRECI: 8% comercial/industrial. Imóveis comerciais têm liquidez intermediária.',
  },
  permuta: {
    percentual: 0.04,
    base_calculo: 'maior dos valores das partes',
    observacoes: 'Sugestivo: 4% sobre o MAIOR valor envolvido na permuta. Cada parte costuma pagar a sua comissão.',
  },
  locacao_residencial: {
    taxa_intermediacao: 1,
    taxa_administracao: 0.08,
    base_calculo: 'valor do aluguel mensal',
    observacoes: 'Intermediação: 1 aluguel mensal cobrado uma vez na assinatura (do locador). Administração: 8% mensal sobre o aluguel.',
  },
  locacao_comercial: {
    taxa_intermediacao: 1,
    taxa_administracao: 0.10,
    base_calculo: 'valor do aluguel mensal',
    observacoes: 'Intermediação: 1 aluguel cobrado uma vez. Administração: 10% mensal (maior risco/complexidade).',
  },
  administracao: {
    percentual: 0.10,
    base_calculo: 'aluguel mensal',
    observacoes: 'Administração avulsa de imóvel já alugado: 8-10% mensal.',
  },
  avaliacao: {
    percentual: 0.01, // 1% mínimo
    base_calculo: 'valor avaliado',
    observacoes: 'Avaliação/perícia: 1-3% do valor avaliado, mín. 1 salário mínimo (R$ 1.518 em 2026). Aqui usamos 1% como base — ajustar conforme complexidade do laudo.',
  },
};

export interface SplitParticipante {
  nome:          string;
  papel:         'captador' | 'vendedor' | 'imobiliaria' | 'corretor_unico' | 'outro';
  percentual:    number; // 0-1 (ex: 0.5 = 50% do total da comissão)
}

export interface ComissaoInput {
  tipo:                  TipoOperacao;
  valor_negocio:         number;     // venda: valor venda; locação: aluguel mensal; etc
  meses_locacao?:        number;     // se locação e quer projetar 12m
  imposto_renda_pct?:    number;     // default 27,5% (alíquota máxima IRRF)
  recolhe_inss?:         boolean;    // corretor autônomo → INSS 11% (até teto)
  split?:                SplitParticipante[]; // se omitido, usa default 50/50 imobiliária+corretor
  percentual_custom?:    number;     // override se você negociou taxa diferente (ex: 0.07)
}

export interface ComissaoOutput {
  tipo:                   TipoOperacao;
  base_calculo_valor:     number;
  percentual_usado:       number;
  percentual_pct:         string;
  comissao_bruta:         number;
  detalhes_locacao?:      {
    intermediacao_unica:   number;  // 1× aluguel
    administracao_mensal:  number;  // 8-10% × aluguel
    administracao_anual:   number;  // mensal × 12
    total_ano1:            number;
  };
  splits:                 Array<{
    nome:                  string;
    papel:                 string;
    percentual:            number;
    valor_bruto:           number;
    valor_irrf:            number;
    valor_inss:            number;
    valor_liquido:         number;
  }>;
  observacoes:            string[];
  fonte:                  string;
}

const SALARIO_MINIMO_2026 = 1518; // pra cálculo de mínimo de avaliação
const TETO_INSS_2026      = 7507.49; // teto de contribuição (limite progressivo)

export function calcularComissao(input: ComissaoInput): ComissaoOutput {
  if (!input.tipo)        throw new Error('tipo de operação é obrigatório.');
  if (!(input.valor_negocio > 0)) throw new Error('valor_negocio deve ser > 0.');

  const tabela = TABELA[input.tipo];
  if (!tabela) throw new Error(`Tipo "${input.tipo}" não suportado.`);

  const observacoes: string[] = [tabela.observacoes];
  let percentualUsado = input.percentual_custom ?? tabela.percentual ?? 0;
  let comissaoBruta = 0;
  let detalhesLocacao: ComissaoOutput['detalhes_locacao'] | undefined;

  // ── Cálculo bruto ──────────────────────────────────────────────────────
  if (input.tipo === 'locacao_residencial' || input.tipo === 'locacao_comercial') {
    const intermediacao = input.valor_negocio * (tabela.taxa_intermediacao ?? 1);
    const adminMensal   = input.valor_negocio * (tabela.taxa_administracao ?? 0.08);
    const meses         = input.meses_locacao ?? 12;
    const adminAnual    = adminMensal * meses;
    comissaoBruta       = intermediacao + adminAnual;
    detalhesLocacao = {
      intermediacao_unica:  round(intermediacao),
      administracao_mensal: round(adminMensal),
      administracao_anual:  round(adminAnual),
      total_ano1:           round(comissaoBruta),
    };
    percentualUsado = (tabela.taxa_administracao ?? 0.08);
    observacoes.push(`Projeção considera ${meses} meses de administração — ajuste meses_locacao se o contrato for diferente.`);
  } else if (input.tipo === 'permuta') {
    comissaoBruta = input.valor_negocio * percentualUsado;
    observacoes.push('Em permuta, cada parte costuma pagar a comissão sobre seu lado da operação. Valor aqui é só do lado informado.');
  } else if (input.tipo === 'avaliacao') {
    const calc = input.valor_negocio * percentualUsado;
    comissaoBruta = Math.max(calc, SALARIO_MINIMO_2026);
    if (calc < SALARIO_MINIMO_2026) {
      observacoes.push(`Cálculo proporcional (R$ ${calc.toFixed(2)}) ficou abaixo do mínimo CRECI (1 SM = R$ ${SALARIO_MINIMO_2026}). Aplicado o piso.`);
    }
  } else {
    comissaoBruta = input.valor_negocio * percentualUsado;
  }

  if (input.percentual_custom != null) {
    observacoes.push(`Percentual customizado aplicado (${(input.percentual_custom * 100).toFixed(2)}%) — diferente do sugestivo CRECI ${(tabela.percentual ?? 0) * 100}%.`);
  }

  // ── Splits ─────────────────────────────────────────────────────────────
  const splits = input.split && input.split.length > 0
    ? input.split
    : [
        { nome: 'Imobiliária Romatec', papel: 'imobiliaria' as const, percentual: 0.5 },
        { nome: 'Corretor responsável', papel: 'corretor_unico' as const, percentual: 0.5 },
      ];

  const totalPct = splits.reduce((s, p) => s + p.percentual, 0);
  if (Math.abs(totalPct - 1) > 0.01) {
    observacoes.push(`⚠️ Soma dos percentuais do split = ${(totalPct * 100).toFixed(1)}% (deveria ser 100%).`);
  }

  const irrfPct = input.imposto_renda_pct ?? 0.275; // alíquota máxima IRRF default
  const recolheInss = input.recolhe_inss ?? false;

  const splitsDetalhados = splits.map(p => {
    const bruto  = comissaoBruta * p.percentual;
    // IRRF e INSS só pra pessoa física (corretor autônomo); imobiliária é PJ.
    const ehPF = p.papel !== 'imobiliaria';
    const irrf = ehPF ? bruto * irrfPct : 0;
    const inss = ehPF && recolheInss ? Math.min(bruto * 0.11, TETO_INSS_2026 * 0.11) : 0;
    const liquido = bruto - irrf - inss;
    return {
      nome:          p.nome,
      papel:         p.papel,
      percentual:    p.percentual,
      valor_bruto:   round(bruto),
      valor_irrf:    round(irrf),
      valor_inss:    round(inss),
      valor_liquido: round(liquido),
    };
  });

  return {
    tipo:               input.tipo,
    base_calculo_valor: input.valor_negocio,
    percentual_usado:   percentualUsado,
    percentual_pct:     (percentualUsado * 100).toFixed(2) + '%',
    comissao_bruta:     round(comissaoBruta),
    detalhes_locacao:   detalhesLocacao,
    splits:             splitsDetalhados,
    observacoes,
    fonte:              'Tabela sugestiva CRECI 16ª Região (MA). Negociável entre as partes — Código Civil arts. 722-729.',
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function listarTabelaComissao(): Record<TipoOperacao, TabelaCreci> {
  return TABELA;
}
