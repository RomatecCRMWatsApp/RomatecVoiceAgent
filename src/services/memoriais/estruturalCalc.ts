// v3.48.0: calculator estrutural — Fase 2 do modulo Memoriais.
//
// Bases normativas:
//   - NBR 6118:2014 — Projeto de estruturas de concreto
//   - NBR 6120:2019 — Acoes para o calculo de estruturas
//   - NBR 6122:2019 — Projeto e execucao de fundacoes
//
// Pre-dimensionamento PARAMETRICO (residencial/comercial leve ate 4 pavimentos).
// NAO substitui calculo detalhado — apenas balizamento inicial pro memorial.
//
// Formulas-chave:
//   1. Carga total ≈ peso_proprio + alvenaria + acidental
//   2. Pilar: secao min 14×30 cm (NBR 6118 13.2.3)
//      area = N(kN) / (0,85 × fck × 1,4)
//   3. Viga: altura ≈ vao/12 (residencial), b min 12 cm
//   4. Laje macica: e ≥ L/40 ou L/35 conforme apoio
//   5. Fundacao: A = N / σ_solo
//
// Standalone — sem deps de mysql/pdfkit.

import type {
  WizardEstrutural,
  MemorialEstruturalOutput,
} from './types';

// Tensoes admissiveis tipicas por tipo de solo (kPa)
const TENSAO_SOLO_KPA: Record<WizardEstrutural['tipo_solo'], number> = {
  argiloso_mole: 60,
  argiloso_medio: 150,
  arenoso_compacto: 300,
  rocha: 1000,
};

// Resistencia caracteristica do concreto (MPa)
const FCK_MPA: Record<WizardEstrutural['classe_concreto'], number> = {
  C20: 20, C25: 25, C30: 30, C35: 35,
};

// Cobrimento minimo (mm) — Classe de Agressividade Ambiental II urbana
const COBRIMENTO_CAA_II = {
  laje: 25,
  viga_pilar: 30,
  fundacao: 40,
};

const PARAMS_DEFAULT_EST = {
  peso_proprio_laje_macica_kn_m2: 2.5,         // gama=25 kN/m³, e=10cm
  peso_proprio_laje_nervurada_kn_m2: 1.8,
  peso_proprio_laje_premoldada_kn_m2: 2.2,
  peso_alvenaria_tijolo_furado_kn_m: 1.5,
  carga_acidental_residencial_kn_m2: 1.5,     // NBR 6120
  carga_acidental_comercial_kn_m2: 2.5,
  taxa_aco_kg_m3_residencial: 80,
  taxa_aco_kg_m3_comercial: 100,
  coef_seguranca_solo: 2.0,                    // FS sobre tensao admissivel
  fator_redutor_carga: 1.4,                    // gamaf NBR 6118
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pesoLajePorTipo(tipo: WizardEstrutural['laje_tipo']): number {
  if (tipo === 'macica') return PARAMS_DEFAULT_EST.peso_proprio_laje_macica_kn_m2;
  if (tipo === 'nervurada') return PARAMS_DEFAULT_EST.peso_proprio_laje_nervurada_kn_m2;
  return PARAMS_DEFAULT_EST.peso_proprio_laje_premoldada_kn_m2;
}

function escolherFundacao(
  tensao_solo_kpa: number,
  carga_total_kn: number,
): MemorialEstruturalOutput['fundacao_sugerida']['tipo'] {
  if (tensao_solo_kpa >= 300) {
    return carga_total_kn > 500 ? 'sapata_isolada' : 'sapata_corrida';
  }
  if (tensao_solo_kpa >= 150) {
    return 'sapata_isolada';
  }
  // Solo mole — radier ou estaca
  if (carga_total_kn > 1000) return 'estaca_pre_moldada';
  return 'radier';
}

export function calcularPreDimensionamento(input: WizardEstrutural): MemorialEstruturalOutput['pre_dimensionamento'] {
  const fck = FCK_MPA[input.classe_concreto];
  // Pilar: secao minima 14×30 cm NBR 6118 13.2.3 + estimativa por carga
  // Considerando carga area influencia = vao × vao × N pavimentos × carga total
  const area_influencia = input.vao_medio_pilares_m ** 2;
  const carga_acidental = input.carga_acidental_kn_m2 ?? PARAMS_DEFAULT_EST.carga_acidental_residencial_kn_m2;
  const peso_laje = pesoLajePorTipo(input.laje_tipo);
  const carga_pavto = peso_laje + carga_acidental + 1.0; // +1 kN/m² revestimentos
  const N_pilar_kn = area_influencia * carga_pavto * input.num_pavimentos * PARAMS_DEFAULT_EST.fator_redutor_carga;
  // A_pilar = N / (0,85 × fck/1,4)  [N em kN, A em cm²]
  const fcd_kpa = (fck * 1000) / 1.4;
  const A_pilar_cm2 = Math.max(14 * 30, round2((N_pilar_kn / (0.85 * fcd_kpa)) * 10000));

  // Viga: h ≈ L/12 (residencial)
  const h_viga = Math.max(30, Math.ceil(input.vao_medio_pilares_m * 100 / 12 / 5) * 5); // arredonda em 5 cm
  const b_viga = Math.max(12, Math.round(h_viga / 3));

  // Laje espessura minima
  const espessura_laje = Math.max(8, Math.ceil(input.vao_medio_pilares_m * 100 / 40));

  return {
    pilar_secao_min_cm: { b: 14, h: 30 },
    pilar_area_concreto_cm2: A_pilar_cm2,
    viga_secao_min_cm: { b: b_viga, h: h_viga },
    viga_altura_recomendada_cm: h_viga,
    laje_espessura_min_cm: espessura_laje,
  };
}

export function calcularCargasEstimadas(input: WizardEstrutural): MemorialEstruturalOutput['cargas_estimadas'] {
  const peso_laje = pesoLajePorTipo(input.laje_tipo);
  const carga_acidental = input.carga_acidental_kn_m2 ?? PARAMS_DEFAULT_EST.carga_acidental_residencial_kn_m2;
  return {
    peso_proprio_estrutura_kn_m2: peso_laje,
    carga_alvenaria_kn_m: PARAMS_DEFAULT_EST.peso_alvenaria_tijolo_furado_kn_m,
    carga_acidental_kn_m2: carga_acidental,
    carga_total_pavimento_kn_m2: round2(peso_laje + carga_acidental + 1.0),
  };
}

export function calcularFundacao(input: WizardEstrutural): MemorialEstruturalOutput['fundacao_sugerida'] {
  const tensao_solo = TENSAO_SOLO_KPA[input.tipo_solo];
  // Carga total no pilar mais carregado (estimativa)
  const area_influencia = input.vao_medio_pilares_m ** 2;
  const cargas = calcularCargasEstimadas(input);
  const N_kn = area_influencia * cargas.carga_total_pavimento_kn_m2 * input.num_pavimentos;
  const tensao_adm_segura = tensao_solo / PARAMS_DEFAULT_EST.coef_seguranca_solo;
  const A_min_m2 = round2(N_kn / tensao_adm_segura);
  const tipo = escolherFundacao(tensao_solo, N_kn);
  // Profundidade minima — 80 cm pra sapata, 1.5 m pra estaca, 1.2 m pra radier
  let prof_min = 0.8;
  if (tipo === 'radier') prof_min = 1.2;
  if (tipo.startsWith('estaca')) prof_min = 1.5;
  return {
    tipo,
    tensao_admissivel_solo_kpa: tensao_solo,
    area_minima_sapata_m2: A_min_m2,
    profundidade_minima_m: prof_min,
  };
}

export function calcularConsumosConcretoAco(input: WizardEstrutural): {
  concreto: MemorialEstruturalOutput['concreto'];
  aco: MemorialEstruturalOutput['aco'];
} {
  const fck = FCK_MPA[input.classe_concreto];
  // Volume estimativo: 0,15 m³/m² × num_pavimentos (residencial tipico)
  const consumo_concreto = round2(input.area_construida_m2 * 0.15 * input.num_pavimentos);
  const taxa_aco = PARAMS_DEFAULT_EST.taxa_aco_kg_m3_residencial;
  const consumo_aco = round2(consumo_concreto * taxa_aco);
  return {
    concreto: {
      classe: input.classe_concreto,
      fck_mpa: fck,
      cobrimento_minimo_mm: COBRIMENTO_CAA_II.viga_pilar,
      consumo_estimado_m3: consumo_concreto,
    },
    aco: {
      taxa_kg_m3_concreto: taxa_aco,
      consumo_estimado_kg: consumo_aco,
    },
  };
}

export function calcularMemorialEstrutural(input: WizardEstrutural): MemorialEstruturalOutput {
  if (!Number.isFinite(input.vao_medio_pilares_m) || input.vao_medio_pilares_m < 2) {
    throw new Error('vao_medio_pilares_m deve ser >= 2 m');
  }
  if (!Number.isFinite(input.num_pavimentos) || input.num_pavimentos < 1) {
    throw new Error('num_pavimentos deve ser >= 1');
  }
  const pre = calcularPreDimensionamento(input);
  const cargas = calcularCargasEstimadas(input);
  const fundacao = calcularFundacao(input);
  const { concreto, aco } = calcularConsumosConcretoAco(input);

  return {
    pre_dimensionamento: pre,
    cargas_estimadas: cargas,
    fundacao_sugerida: fundacao,
    concreto,
    aco,
    parametros_aplicados: {
      coef_seguranca_solo: PARAMS_DEFAULT_EST.coef_seguranca_solo,
      fator_redutor_carga: PARAMS_DEFAULT_EST.fator_redutor_carga,
    },
  };
}

export const __internalsEstrutural = {
  PARAMS_DEFAULT_EST,
  TENSAO_SOLO_KPA,
  FCK_MPA,
  COBRIMENTO_CAA_II,
};
