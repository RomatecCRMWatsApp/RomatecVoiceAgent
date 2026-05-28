// v3.35.0: calculator hidraulico — NBR 5626:2020 (Sistema Predial de Agua Fria).
//
// Replica a logica do memorial PROP-2026 Resid. Nayara Brito (PDF anexado no
// prompt v1.99.19). Standalone — sem deps de mysql/pdfkit.
//
// Formulas-chave:
//   1. Consumo diario:
//      total = pessoas × 150 (L/pessoa/dia) + maq_lavar(120) + limpeza(80)
//      total += 10% reserva
//
//   2. Reservatorio:
//      V_minimo = 2 × consumo_diario     (NBR 5626 item 5.4.2)
//      V_recomendado = ceil(V_minimo / 250) × 250
//
//   3. Vazao de projeto:
//      Q = 0.3 × √(Σ pesos)              (NBR 5626 item 5.3.1.2)
//
//   4. Dimensionamento barrilete (DN):
//      Escolhe menor DN onde v <= 3.0 m/s
//      v = (Q/1000) / (π × (Dint/2000)²)

import type {
  WizardHidraulico,
  MemorialHidraulicoOutput,
  AparelhoHidraulico,
} from './types';

// Pesos relativos NBR 5626 Tabela 1 (subset comum residencial)
export const PESOS_NBR5626: Record<AparelhoHidraulico, number> = {
  bacia_caixa_acoplada: 0.30,
  lavatorio: 0.30,
  chuveiro: 0.40,
  ducha_higienica: 0.10,
  pia_cozinha: 0.70,
  tanque: 0.70,
  maquina_lavar: 1.00,
  torneira_geral: 0.40,
};

// Tabela de diametros internos por DN (TIGRE Soldavel Classe A — em mm)
// Source: catalogo TIGRE 2024 — tubos Soldavel Marrom
const DIAMETROS_INTERNOS_MM: Record<number, number> = {
  20: 17.0,
  25: 21.6,
  32: 27.8,
  40: 35.2,
  50: 44.0,
  60: 53.4,
  75: 66.6,
  85: 75.6,
};

const DN_DISPONIVEIS = Object.keys(DIAMETROS_INTERNOS_MM).map(Number).sort((a, b) => a - b);

// Parametros default (em runtime — podem ser sobrescritos via config)
const PARAMS_DEFAULT = {
  consumo_per_capita_L_dia: 150,
  incremento_maq_lavar_L: 120,
  incremento_limpeza_L: 80,
  reserva_pct: 10,
  velocidade_max_ms: 3.0,
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

export function calcularConsumoDiario(numPessoas: number, opts: {
  temMaqLavar: boolean;
  temLimpezaExterna: boolean;
}): number {
  if (!Number.isFinite(numPessoas) || numPessoas < 1) {
    throw new Error('numPessoas deve ser >= 1');
  }
  const P = PARAMS_DEFAULT;
  let total = numPessoas * P.consumo_per_capita_L_dia;
  if (opts.temMaqLavar) total += P.incremento_maq_lavar_L;
  if (opts.temLimpezaExterna) total += P.incremento_limpeza_L;
  // Reserva: arredonda pra cima
  total += Math.ceil(total * P.reserva_pct / 100);
  return total;
}

export function calcularReservatorio(consumoDiarioL: number): {
  volume_minimo_L: number;
  volume_recomendado_L: number;
} {
  const vMinimo = consumoDiarioL * 2;
  const vRecomendado = Math.ceil(vMinimo / 250) * 250;
  return { volume_minimo_L: vMinimo, volume_recomendado_L: vRecomendado };
}

export function calcularVazaoProjeto(somaPesos: number): number {
  if (!Number.isFinite(somaPesos) || somaPesos < 0) {
    throw new Error('somaPesos deve ser >= 0');
  }
  return round3(0.3 * Math.sqrt(somaPesos));
}

export function somarPesos(aparelhos: WizardHidraulico['aparelhos']): {
  soma: number;
  detalhamento: Array<{ tipo: AparelhoHidraulico; qtd: number; peso_unit: number; peso_total: number }>;
} {
  const detalhamento = aparelhos
    .filter((a) => a.quantidade > 0)
    .map((a) => {
      const peso_unit = PESOS_NBR5626[a.tipo];
      if (peso_unit == null) throw new Error(`Aparelho desconhecido: ${a.tipo}`);
      return {
        tipo: a.tipo,
        qtd: a.quantidade,
        peso_unit,
        peso_total: round2(peso_unit * a.quantidade),
      };
    });
  const soma = round2(detalhamento.reduce((s, x) => s + x.peso_total, 0));
  return { soma, detalhamento };
}

// Escolhe o menor DN onde velocidade <= 3.0 m/s (NBR 5626 item 5.3.2).
export function dimensionarBarrilete(vazaoLs: number): {
  DN_mm: number;
  velocidade_ms: number;
  status: 'OK' | 'AJUSTAR';
} {
  if (vazaoLs <= 0) {
    return { DN_mm: 0, velocidade_ms: 0, status: 'OK' };
  }
  const Q_m3s = vazaoLs / 1000;
  for (const DN of DN_DISPONIVEIS) {
    const Dint = DIAMETROS_INTERNOS_MM[DN] / 1000; // m
    const area = Math.PI * (Dint / 2) ** 2;        // m²
    const v = Q_m3s / area;                         // m/s
    if (v <= PARAMS_DEFAULT.velocidade_max_ms) {
      return { DN_mm: DN, velocidade_ms: round3(v), status: 'OK' };
    }
  }
  // Nenhum DN da tabela atende — caso teorico (Q muito alto)
  const ultimoDN = DN_DISPONIVEIS[DN_DISPONIVEIS.length - 1];
  const Dint = DIAMETROS_INTERNOS_MM[ultimoDN] / 1000;
  const area = Math.PI * (Dint / 2) ** 2;
  const v = Q_m3s / area;
  return { DN_mm: ultimoDN, velocidade_ms: round3(v), status: 'AJUSTAR' };
}

export function calcularMemorialHidraulico(input: WizardHidraulico): MemorialHidraulicoOutput {
  // 1. Consumo diario
  const consumoDiario = calcularConsumoDiario(input.num_pessoas, {
    temMaqLavar: !!input.tem_maquina_lavar,
    temLimpezaExterna: !!input.tem_limpeza_externa,
  });

  // 2. Reservatorio
  const reservatorio = calcularReservatorio(consumoDiario);
  // Se o usuario forneceu volume manualmente, usar; senao, default recomendado
  const volReservatorioFinal = input.volume_reservatorio_L && input.volume_reservatorio_L > 0
    ? input.volume_reservatorio_L
    : reservatorio.volume_recomendado_L;
  const volRecomendadoOutput = volReservatorioFinal;

  // 3. Pesos
  const pesos = somarPesos(input.aparelhos);

  // 4. Vazao
  const vazao = calcularVazaoProjeto(pesos.soma);

  // 5. Dimensionamento barrilete
  const dimBarrilete = dimensionarBarrilete(vazao);

  return {
    consumo_diario_L: consumoDiario,
    reservatorio: {
      volume_minimo_L: reservatorio.volume_minimo_L,
      volume_recomendado_L: volRecomendadoOutput,
    },
    pesos: {
      soma_pesos: pesos.soma,
      vazao_total_Ls: vazao,
      detalhamento: pesos.detalhamento,
    },
    dimensionamento_barrilete: dimBarrilete,
    parametros_aplicados: {
      consumo_per_capita_L_dia: PARAMS_DEFAULT.consumo_per_capita_L_dia,
      incremento_maq_lavar_L: PARAMS_DEFAULT.incremento_maq_lavar_L,
      incremento_limpeza_L: PARAMS_DEFAULT.incremento_limpeza_L,
      reserva_pct: PARAMS_DEFAULT.reserva_pct,
    },
  };
}

export const __internals = {
  PARAMS_DEFAULT,
  DIAMETROS_INTERNOS_MM,
  DN_DISPONIVEIS,
};
