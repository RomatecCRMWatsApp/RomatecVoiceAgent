// v3.48.0: calculator eletrico — Fase 2 do modulo Memoriais.
//
// Bases normativas:
//   - NBR 5410:2004 — Instalacoes eletricas de baixa tensao
//   - NBR 5444:1989 — Simbolos graficos
//   - Padrao Equatorial Maranhao — bitolas minimas de entrada
//
// Formulas-chave:
//   1. Carga TUG por area: ~100 VA/m² residencial NBR 5410 Anexo C
//   2. Iluminacao: 100 VA pra primeiros 6 m² + 60 VA por 4 m² adicional
//   3. Corrente: I = P / (V × cosfi × √3 se trifasico)
//   4. Queda tensao: ΔV = (2 × L × I × ρ) / S  (monofasico, ρ=Cu)
//
// Standalone — sem deps de mysql/pdfkit.

import type {
  WizardEletrico,
  MemorialEletricoOutput,
  CargaEletrica,
} from './types';

// Fator de demanda por tipo de carga (NBR 5410 Tabela 47)
const FATOR_DEMANDA_NBR5410: Record<CargaEletrica, number> = {
  iluminacao_tug: 0.66,       // residencial
  tue_chuveiro: 1.00,         // sempre 100% (curto + alta corrente)
  tue_aquecedor: 1.00,
  tue_ar_condicionado: 0.75,
  tue_maquina_lavar: 0.70,
  tue_forno_micro: 0.70,
  tue_outros: 0.85,
};

// Tabela de secao mínima de condutor por corrente (NBR 5410 Tabela 36 — PVC)
const SECAO_POR_CORRENTE: Array<{ ate_A: number; secao_mm2: number }> = [
  { ate_A: 16, secao_mm2: 1.5 },
  { ate_A: 23, secao_mm2: 2.5 },
  { ate_A: 30, secao_mm2: 4.0 },
  { ate_A: 40, secao_mm2: 6.0 },
  { ate_A: 54, secao_mm2: 10.0 },
  { ate_A: 73, secao_mm2: 16.0 },
  { ate_A: 90, secao_mm2: 25.0 },
  { ate_A: 110, secao_mm2: 35.0 },
  { ate_A: 137, secao_mm2: 50.0 },
];

// Disjuntor padrao (sobre dimensiona em 10% acima da corrente do condutor)
const DISJUNTORES_NBR_IEC = [10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250];

const PARAMS_DEFAULT_ELE = {
  iluminacao_va_m2: 12,             // VA/m² residencial (NBR 5410 9.5.2.1.1)
  tug_padrao_va: 100,               // VA por TUG em area molhada
  fator_potencia: 0.92,             // cosfi residencial tipico
  queda_max_pct: 4,                 // residencial NBR 5410 6.2.7
  resistividade_cu_ohm_mm2_m: 0.0172, // condutor de cobre 20°C
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function escolherSecaoCondutor(corrente_A: number): number {
  for (const linha of SECAO_POR_CORRENTE) {
    if (corrente_A <= linha.ate_A) return linha.secao_mm2;
  }
  return SECAO_POR_CORRENTE[SECAO_POR_CORRENTE.length - 1].secao_mm2;
}

function escolherDisjuntor(corrente_A: number): number {
  const corrente_sobre = corrente_A * 1.1; // sobre dim 10%
  for (const dj of DISJUNTORES_NBR_IEC) {
    if (corrente_sobre <= dj) return dj;
  }
  return DISJUNTORES_NBR_IEC[DISJUNTORES_NBR_IEC.length - 1];
}

export function calcularCargaInstalada(
  area_construida_m2: number,
  cargas: WizardEletrico['cargas'],
): { total_w: number; detalhamento: Array<{ tipo: CargaEletrica; pot_total_w: number }> } {
  // Iluminacao + TUG por area (NBR 5410 anexo C)
  const ilum_va = Math.max(100, area_construida_m2 * PARAMS_DEFAULT_ELE.iluminacao_va_m2);
  // Soma cargas explicitas
  const detalhamento = cargas
    .filter((c) => c.quantidade > 0 && c.potencia_w > 0)
    .map((c) => ({ tipo: c.tipo, pot_total_w: c.potencia_w * c.quantidade }));
  // Inclui ilum + TUG como `iluminacao_tug` agregado
  const totalCargas = detalhamento.reduce((s, x) => s + x.pot_total_w, 0);
  const total_w = round2(ilum_va * PARAMS_DEFAULT_ELE.fator_potencia + totalCargas);
  // Adiciona linha de iluminacao no detalhamento
  detalhamento.unshift({
    tipo: 'iluminacao_tug',
    pot_total_w: round2(ilum_va * PARAMS_DEFAULT_ELE.fator_potencia),
  });
  return { total_w, detalhamento };
}

export function calcularDemanda(
  detalhamento: Array<{ tipo: CargaEletrica; pot_total_w: number }>,
): { demandada_w: number; detalhamento_demanda: MemorialEletricoOutput['detalhamento_cargas'] } {
  const detalhamento_demanda = detalhamento.map((c) => {
    const fd = FATOR_DEMANDA_NBR5410[c.tipo];
    return {
      tipo: c.tipo,
      pot_total_w: round2(c.pot_total_w),
      fator_demanda_pct: round2(fd * 100),
      pot_demandada_w: round2(c.pot_total_w * fd),
    };
  });
  const demandada_w = round2(detalhamento_demanda.reduce((s, x) => s + x.pot_demandada_w, 0));
  return { demandada_w, detalhamento_demanda };
}

export function calcularCorrente(
  potencia_w: number,
  tensao_v: number,
  tipo: 'monofasico' | 'bifasico' | 'trifasico',
): number {
  const fp = PARAMS_DEFAULT_ELE.fator_potencia;
  if (tipo === 'trifasico') {
    // I = P / (√3 × V × cosφ)
    return round2(potencia_w / (Math.sqrt(3) * tensao_v * fp));
  }
  if (tipo === 'bifasico') {
    return round2(potencia_w / (tensao_v * fp));
  }
  return round2(potencia_w / (tensao_v * fp));
}

export function calcularQuedaTensao(
  corrente_A: number,
  comprimento_m: number,
  secao_mm2: number,
  tensao_v: number,
): number {
  // ΔV(V) = (2 × L × I × ρ) / S   (monofasico, retorno duplicado)
  const dvV = (2 * comprimento_m * corrente_A * PARAMS_DEFAULT_ELE.resistividade_cu_ohm_mm2_m) / secao_mm2;
  return round2((dvV / tensao_v) * 100);
}

export function calcularMemorialEletrico(input: WizardEletrico): MemorialEletricoOutput {
  // 1. Carga instalada total
  const { total_w, detalhamento } = calcularCargaInstalada(input.area_construida_m2, input.cargas);
  // 2. Demanda
  const { demandada_w, detalhamento_demanda } = calcularDemanda(detalhamento);
  const demandada_kw = round2(demandada_w / 1000);
  // 3. Corrente de projeto
  const corrente_A = calcularCorrente(demandada_w, input.tensao_nominal_v, input.tipo_alimentacao);
  // 4. Dimensionamento condutor
  let secao = escolherSecaoCondutor(corrente_A);
  // Aumenta secao se queda > 4%
  let queda = calcularQuedaTensao(corrente_A, input.comprimento_ramal_m, secao, input.tensao_nominal_v);
  let iterMax = 5;
  while (queda > PARAMS_DEFAULT_ELE.queda_max_pct && iterMax > 0) {
    // Sobe pra proxima bitola
    const idx = SECAO_POR_CORRENTE.findIndex((l) => l.secao_mm2 === secao);
    if (idx < 0 || idx + 1 >= SECAO_POR_CORRENTE.length) break;
    secao = SECAO_POR_CORRENTE[idx + 1].secao_mm2;
    queda = calcularQuedaTensao(corrente_A, input.comprimento_ramal_m, secao, input.tensao_nominal_v);
    iterMax--;
  }
  const disjuntor = escolherDisjuntor(corrente_A);
  const status: 'OK' | 'AJUSTAR' = queda <= PARAMS_DEFAULT_ELE.queda_max_pct ? 'OK' : 'AJUSTAR';

  return {
    carga_total_instalada_w: total_w,
    carga_demandada_kw: demandada_kw,
    corrente_projeto_A: corrente_A,
    detalhamento_cargas: detalhamento_demanda,
    dimensionamento_ramal: {
      secao_condutor_mm2: secao,
      queda_tensao_pct: queda,
      disjuntor_geral_A: disjuntor,
      status,
    },
    protecao: {
      dr_obrigatorio: true,                  // NBR 5410 5.1.3.2.2 sempre em residencial
      dps_obrigatorio: input.fator_demanda === 'residencial',
      aterramento_tipo: 'TN-S',              // padrao Equatorial MA
    },
    parametros_aplicados: {
      iluminacao_va_m2: PARAMS_DEFAULT_ELE.iluminacao_va_m2,
      tug_padrao_va: PARAMS_DEFAULT_ELE.tug_padrao_va,
      fator_potencia: PARAMS_DEFAULT_ELE.fator_potencia,
      queda_max_pct: PARAMS_DEFAULT_ELE.queda_max_pct,
    },
  };
}

export const __internalsEletrico = {
  PARAMS_DEFAULT_ELE,
  FATOR_DEMANDA_NBR5410,
  SECAO_POR_CORRENTE,
  DISJUNTORES_NBR_IEC,
};
