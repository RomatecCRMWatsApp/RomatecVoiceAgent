// v3.48.0: calculator sanitario — Fase 2 do modulo Memoriais.
//
// Bases normativas:
//   - NBR 8160:1999 — Sistemas prediais de esgoto sanitario
//   - NBR 10844:1989 — Instalacoes prediais de aguas pluviais
//   - NBR 7229:1993 — Tanques septicos (fossa + sumidouro/filtro)
//
// Formulas-chave:
//   1. Esgoto: soma de UHC (Unidade de Hunter de Contribuicao) determina ramal/queda/coletor
//   2. Pluvial: Q = (i × A) / 60  [L/min onde i=mm/h e A=m²]
//   3. Fossa: V = N × C × T  (Norma 7229) ; C=contrib per capita, T=t. detencao
//
// Standalone — sem deps de mysql/pdfkit.

import type {
  WizardSanitario,
  MemorialSanitarioOutput,
  AparelhoSanitario,
} from './types';

// UHC por aparelho (NBR 8160 Tabela 3)
export const UHC_NBR8160: Record<AparelhoSanitario, number> = {
  bacia_sanitaria: 6,
  lavatorio: 1,
  chuveiro: 2,
  pia_cozinha: 3,
  tanque: 3,
  maquina_lavar: 3,
  ralo_sifonado: 1,
  ralo_seco: 1,
};

// Dimensionamento de ramal de descarga primario por UHC (NBR 8160 Tabela 4)
// soma_uhc -> DN_mm
const RAMAL_POR_UHC: Array<{ ate_uhc: number; DN_mm: number }> = [
  { ate_uhc: 3, DN_mm: 40 },
  { ate_uhc: 6, DN_mm: 50 },
  { ate_uhc: 20, DN_mm: 75 },
  { ate_uhc: 160, DN_mm: 100 },
  { ate_uhc: 620, DN_mm: 150 },
];

// Tubo de queda — soma UHC contribuinte vertical (NBR 8160 Tabela 5)
const TUBO_QUEDA_POR_UHC: Array<{ ate_uhc: number; DN_mm: number }> = [
  { ate_uhc: 4, DN_mm: 50 },
  { ate_uhc: 26, DN_mm: 75 },
  { ate_uhc: 240, DN_mm: 100 },
  { ate_uhc: 960, DN_mm: 150 },
];

// Calha — capacidade Q (L/min) por DN (NBR 10844 — semicircular, i=0,5%)
const CALHA_CAPACIDADE_LMIN: Array<{ DN_mm: number; Q_max: number }> = [
  { DN_mm: 100, Q_max: 130 },
  { DN_mm: 125, Q_max: 236 },
  { DN_mm: 150, Q_max: 384 },
  { DN_mm: 200, Q_max: 829 },
  { DN_mm: 250, Q_max: 1500 },
];

// Condutor vertical de aguas pluviais — capacidade Q (L/min)
const CONDUTOR_VERTICAL_LMIN: Array<{ DN_mm: number; Q_max: number }> = [
  { DN_mm: 75, Q_max: 80 },
  { DN_mm: 100, Q_max: 162 },
  { DN_mm: 125, Q_max: 268 },
  { DN_mm: 150, Q_max: 433 },
];

const PARAMS_DEFAULT_SAN = {
  contribuicao_per_capita_L_dia: 130,   // NBR 7229 — residencial padrao
  tempo_detencao_h: 24,                 // tempo minimo de detencao na fossa
  coef_runoff_pluvial: 1.0,             // telhado + laje = escoamento 100%
  intensidade_pluv_mmh_default: 150,    // Acailandia/MA — T=5 anos, t=5min
  inclinacao_calha_pct_default: 0.5,
  taxa_absorcao_sumidouro_L_m2_dia: 50, // K argilo-arenoso
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function escolherDN(
  tabela: Array<{ ate_uhc: number; DN_mm: number }>,
  somaUhc: number,
): number {
  for (const linha of tabela) {
    if (somaUhc <= linha.ate_uhc) return linha.DN_mm;
  }
  return tabela[tabela.length - 1].DN_mm;
}

function escolherCalha(vazaoLmin: number): { DN_mm: number; capacidade_Lmin: number; status: 'OK' | 'AJUSTAR' } {
  for (const c of CALHA_CAPACIDADE_LMIN) {
    if (vazaoLmin <= c.Q_max) return { DN_mm: c.DN_mm, capacidade_Lmin: c.Q_max, status: 'OK' };
  }
  const ult = CALHA_CAPACIDADE_LMIN[CALHA_CAPACIDADE_LMIN.length - 1];
  return { DN_mm: ult.DN_mm, capacidade_Lmin: ult.Q_max, status: 'AJUSTAR' };
}

function escolherCondutorVertical(vazaoLmin: number): { DN_mm: number; quantidade: number; status: 'OK' | 'AJUSTAR' } {
  for (const c of CONDUTOR_VERTICAL_LMIN) {
    if (vazaoLmin <= c.Q_max) return { DN_mm: c.DN_mm, quantidade: 1, status: 'OK' };
  }
  // Acima do maior — sugere 2 condutores
  const ult = CONDUTOR_VERTICAL_LMIN[CONDUTOR_VERTICAL_LMIN.length - 1];
  const qtd = Math.ceil(vazaoLmin / ult.Q_max);
  return { DN_mm: ult.DN_mm, quantidade: qtd, status: 'AJUSTAR' };
}

export function calcularEsgoto(aparelhos: WizardSanitario['aparelhos']): {
  soma_uhc: number;
  detalhamento_uhc: MemorialSanitarioOutput['esgoto']['detalhamento_uhc'];
} {
  const detalhamento_uhc = aparelhos
    .filter((a) => a.quantidade > 0)
    .map((a) => {
      const uhc_unit = UHC_NBR8160[a.tipo];
      if (uhc_unit == null) throw new Error(`Aparelho sanitario desconhecido: ${a.tipo}`);
      return { tipo: a.tipo, qtd: a.quantidade, uhc_unit, uhc_total: uhc_unit * a.quantidade };
    });
  const soma_uhc = detalhamento_uhc.reduce((s, x) => s + x.uhc_total, 0);
  return { soma_uhc, detalhamento_uhc };
}

export function calcularVazaoPluvial(area_m2: number, intensidade_mmh: number): number {
  if (!Number.isFinite(area_m2) || area_m2 < 0) throw new Error('area_cobertura_m2 deve ser >= 0');
  if (!Number.isFinite(intensidade_mmh) || intensidade_mmh <= 0) throw new Error('intensidade_mmh deve ser > 0');
  // Q (L/min) = (intensidade × area × coef_runoff) / 60
  return round2((intensidade_mmh * area_m2 * PARAMS_DEFAULT_SAN.coef_runoff_pluvial) / 60);
}

export function calcularFossa(num_pessoas: number): MemorialSanitarioOutput['fossa_sumidouro'] {
  if (num_pessoas < 1) return undefined;
  // V_decantacao = N × C × T (NBR 7229)
  // Pra contribuicao 130 L/p/dia, T=24h: V = N × 130 × 1 = N × 130 L
  const V_dec = num_pessoas * PARAMS_DEFAULT_SAN.contribuicao_per_capita_L_dia;
  // V_digestao = N × Lf × Td (Lf=lodo fresco 1 L/p/dia, Td=300 dias residencial)
  const V_dig = num_pessoas * 1 * 300;
  // Sumidouro — area = (N × contrib) / K
  const A_sum = round2((num_pessoas * PARAMS_DEFAULT_SAN.contribuicao_per_capita_L_dia) / PARAMS_DEFAULT_SAN.taxa_absorcao_sumidouro_L_m2_dia);
  return {
    volume_camara_decantacao_L: V_dec,
    volume_camara_digestao_L: V_dig,
    volume_total_L: V_dec + V_dig,
    area_sumidouro_m2: A_sum,
  };
}

export function calcularMemorialSanitario(input: WizardSanitario): MemorialSanitarioOutput {
  // 1. Esgoto
  const { soma_uhc, detalhamento_uhc } = calcularEsgoto(input.aparelhos);
  const dn_ramal = escolherDN(RAMAL_POR_UHC, soma_uhc);
  const dn_tubo_queda = escolherDN(TUBO_QUEDA_POR_UHC, soma_uhc);
  // Coletor predial: mesmo criterio do tubo de queda + declividade min
  const declividade_min = soma_uhc <= 180 ? 2.0 : 1.0;
  // 2. Pluvial
  const intensidade = input.intensidade_pluv_mmh && input.intensidade_pluv_mmh > 0
    ? input.intensidade_pluv_mmh
    : PARAMS_DEFAULT_SAN.intensidade_pluv_mmh_default;
  const vazao_pluv = calcularVazaoPluvial(input.area_cobertura_m2, intensidade);
  const calha = escolherCalha(vazao_pluv);
  const condutor = escolherCondutorVertical(vazao_pluv);
  // 3. Fossa (apenas se destino != rede_publica)
  const fossa = input.destino_efluente !== 'rede_publica'
    ? calcularFossa(input.num_pessoas)
    : undefined;

  return {
    esgoto: {
      soma_uhc,
      detalhamento_uhc,
      dimensionamento_ramais: { DN_mm: dn_ramal, descricao: `Ramal de descarga primario DN ${dn_ramal} mm (PVC esgoto)` },
      dimensionamento_tubo_queda: { DN_mm: dn_tubo_queda, descricao: `Tubo de queda DN ${dn_tubo_queda} mm com ventilacao primaria` },
      dimensionamento_coletor_predial: { DN_mm: dn_tubo_queda, declividade_min_pct: declividade_min },
    },
    aguas_pluviais: {
      area_contribuinte_m2: input.area_cobertura_m2,
      intensidade_mmh: intensidade,
      vazao_projeto_Lmin: vazao_pluv,
      dimensionamento_calha: calha,
      dimensionamento_condutor_vertical: condutor,
    },
    fossa_sumidouro: fossa,
    parametros_aplicados: {
      contribuicao_per_capita_L_dia: PARAMS_DEFAULT_SAN.contribuicao_per_capita_L_dia,
      tempo_detencao_h: PARAMS_DEFAULT_SAN.tempo_detencao_h,
      coef_runoff_pluvial: PARAMS_DEFAULT_SAN.coef_runoff_pluvial,
    },
  };
}

export const __internalsSanitario = {
  PARAMS_DEFAULT_SAN,
  UHC_NBR8160,
  RAMAL_POR_UHC,
  TUBO_QUEDA_POR_UHC,
  CALHA_CAPACIDADE_LMIN,
  CONDUTOR_VERTICAL_LMIN,
};
