// v3.49.5: Orquestrador do Memorial Estrutural (NBR 6118/6120/6122) — modulo
// Memoriais & Quantitativos. Envolve estruturalCalc.ts (motor existente) e monta
// o ResultadoEstrutural que alimenta os PDFs e as rotas /api/memoriais/estrutural/*.
// Mesmo desenho do eletricoCalculo.ts. Standalone — sem deps de mysql/pdfkit.

import { calcularMemorialEstrutural } from './estruturalCalc';
import type { WizardEstrutural, MemorialEstruturalOutput } from './types';

export interface DadosObraEst {
  titulo: string; endereco: string; municipio: string; uf: string;
  proprietario: string; cpfCnpj: string; areaM2: number; areaLoteM2?: number;
  nPavimentos: number; prancha: string; trtNumero?: string;
}

export interface DadosUsoEst {
  tipoUso: 'residencial' | 'comercial';
  vaoMedioPilaresM: number;
  cargaAcidentalKnM2?: number;
  classeConcreto: WizardEstrutural['classe_concreto'];
  tipoSolo: WizardEstrutural['tipo_solo'];
  temSubsolo: boolean;
  lajeTipo: WizardEstrutural['laje_tipo'];
}

export interface MaterialItem { descricao: string; unidade: string; qtd: number; }

export interface ResultadoEstrutural {
  dadosObra: DadosObraEst;
  dadosUso: DadosUsoEst;
  saida: MemorialEstruturalOutput;
  materiais: {
    concreto: MaterialItem[];
    aco: MaterialItem[];
    formas: MaterialItem[];
    fundacao: MaterialItem[];
    vedacao: MaterialItem[];
    insumos: MaterialItem[];
  };
  totais: { volumeConcretoM3: number; pesoAcoKg: number; areaFormasM2: number; };
  statusNormativo: {
    cobrimentoAdequado: boolean;
    fckAdequado: boolean;
    fundacaoDefinida: boolean;
    lajeMinimaAtendida: boolean;
  };
  alertas: string[];
}

const LABEL_FUNDACAO: Record<string, string> = {
  sapata_corrida: 'Sapata corrida',
  sapata_isolada: 'Sapata isolada',
  radier: 'Radier',
  estaca_helice: 'Estaca helice continua',
  estaca_pre_moldada: 'Estaca pre-moldada',
};
export function labelFundacao(t: string): string { return LABEL_FUNDACAO[t] ?? t; }

const LABEL_SOLO: Record<string, string> = {
  argiloso_mole: 'Argiloso mole',
  argiloso_medio: 'Argiloso medio',
  arenoso_compacto: 'Arenoso compacto',
  rocha: 'Rocha',
};
export function labelSolo(t: string): string { return LABEL_SOLO[t] ?? t; }

export interface EntradaResumoEst { dadosObra: DadosObraEst; dadosUso: DadosUsoEst; }

function ceilPos(n: number): number { return Math.max(0, Math.ceil(n)); }
function r2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

export function calcularResumoEstrutural(entrada: EntradaResumoEst): ResultadoEstrutural {
  const { dadosObra, dadosUso } = entrada;
  const wizard: WizardEstrutural = {
    uso_edificacao: dadosUso.tipoUso === 'residencial' ? 'Residencial unifamiliar' : 'Comercial',
    num_pavimentos: dadosObra.nPavimentos,
    area_construida_m2: dadosObra.areaM2,
    vao_medio_pilares_m: dadosUso.vaoMedioPilaresM && dadosUso.vaoMedioPilaresM >= 2 ? dadosUso.vaoMedioPilaresM : 4,
    carga_acidental_kn_m2: dadosUso.cargaAcidentalKnM2,
    classe_concreto: dadosUso.classeConcreto,
    tipo_solo: dadosUso.tipoSolo,
    tem_subsolo: dadosUso.temSubsolo,
    laje_tipo: dadosUso.lajeTipo,
    trt_numero: dadosObra.trtNumero,
  };

  const saida = calcularMemorialEstrutural(wizard);
  const pre = saida.pre_dimensionamento;
  const fund = saida.fundacao_sugerida;
  const conc = saida.concreto;
  const aco = saida.aco;

  const volConcreto = conc.consumo_estimado_m3;
  const pesoAco = aco.consumo_estimado_kg;
  const areaPavimento = dadosObra.areaM2;
  const areaFormas = ceilPos(areaPavimento * 2.4);   // ~2,4 m2 de forma por m2 de laje (lajes+vigas+pilares)

  // estimativa de elementos
  const nPilares = ceilPos(areaPavimento / Math.pow(dadosUso.vaoMedioPilaresM || 4, 2)) + 4;
  const espLaje = pre.laje_espessura_min_cm;

  const materiais: ResultadoEstrutural['materiais'] = {
    concreto: [
      { descricao: `Concreto usinado ${conc.classe} (fck ${conc.fck_mpa} MPa) - fundacao`, unidade: 'm3', qtd: r2(volConcreto * 0.25) },
      { descricao: `Concreto usinado ${conc.classe} - pilares e vigas`, unidade: 'm3', qtd: r2(volConcreto * 0.35) },
      { descricao: `Concreto usinado ${conc.classe} - lajes (${pre.laje_espessura_min_cm} cm)`, unidade: 'm3', qtd: r2(volConcreto * 0.40) },
    ],
    aco: [
      { descricao: 'Aco CA-50 bitolas 8.0 a 12.5 mm (armadura longitudinal)', unidade: 'kg', qtd: ceilPos(pesoAco * 0.65) },
      { descricao: 'Aco CA-60 bitola 5.0 mm (estribos / armadura de distribuicao)', unidade: 'kg', qtd: ceilPos(pesoAco * 0.25) },
      { descricao: 'Aco CA-50 bitola 16.0 a 20.0 mm (pilares e fundacao)', unidade: 'kg', qtd: ceilPos(pesoAco * 0.10) },
      { descricao: 'Arame recozido n.18 (amarracao)', unidade: 'kg', qtd: ceilPos(pesoAco * 0.01) + 1 },
    ],
    formas: [
      { descricao: 'Forma em chapa de madeira compensada resinada 12 mm', unidade: 'm2', qtd: areaFormas },
      { descricao: 'Escoramento metalico / madeira (pontaletes)', unidade: 'm2', qtd: ceilPos(areaPavimento * dadosObra.nPavimentos) },
      { descricao: 'Desmoldante para formas', unidade: 'L', qtd: ceilPos(areaFormas / 30) + 1 },
    ],
    fundacao: [
      { descricao: `${labelFundacao(fund.tipo)} - ${labelSolo(dadosUso.tipoSolo)} (sigma ${fund.tensao_admissivel_solo_kpa} kPa)`, unidade: 'un/m', qtd: nPilares },
      { descricao: `Lastro de concreto magro / brita - profundidade ${fund.profundidade_minima_m} m`, unidade: 'm3', qtd: r2(nPilares * fund.area_minima_sapata_m2 * 0.1) },
      { descricao: 'Impermeabilizante para baldrame / blocos', unidade: 'L', qtd: ceilPos(areaPavimento / 8) },
    ],
    vedacao: [
      { descricao: 'Bloco ceramico de vedacao 9x19x19 cm', unidade: 'un', qtd: ceilPos(areaPavimento * dadosObra.nPavimentos * 22) },
      { descricao: 'Verga / contraverga pre-moldada', unidade: 'm', qtd: ceilPos(areaPavimento / 6) },
    ],
    insumos: [
      { descricao: 'Cimento CP-II (chumbamento e graute complementar)', unidade: 'sc', qtd: ceilPos(volConcreto * 1.5) },
      { descricao: 'Espacador / pastilha de cobrimento', unidade: 'un', qtd: ceilPos(areaFormas * 4) },
      { descricao: 'Prego / parafuso para formas', unidade: 'kg', qtd: ceilPos(areaFormas / 20) + 1 },
    ],
  };

  const lajeMin = espLaje >= (dadosUso.lajeTipo === 'macica' ? 8 : 7);
  const fckAdequado = conc.fck_mpa >= 25 || (dadosUso.tipoUso === 'residencial' && conc.fck_mpa >= 20);
  const alertas: string[] = [];
  if (!fckAdequado) alertas.push(`Classe ${conc.classe} (fck ${conc.fck_mpa} MPa) abaixo do recomendado (CAA II urbana exige fck >= 25 MPa para durabilidade - NBR 6118 Tabela 7.1).`);
  if (dadosUso.tipoSolo === 'argiloso_mole') alertas.push('Solo argiloso mole — recomenda-se sondagem SPT e analise geotecnica especifica antes da execucao da fundacao.');
  if (!lajeMin) alertas.push(`Espessura de laje (${espLaje} cm) no limite minimo — verificar flecha e cobrimento.`);

  return {
    dadosObra, dadosUso,
    saida,
    materiais,
    totais: { volumeConcretoM3: volConcreto, pesoAcoKg: pesoAco, areaFormasM2: areaFormas },
    statusNormativo: {
      cobrimentoAdequado: conc.cobrimento_minimo_mm >= 25,
      fckAdequado,
      fundacaoDefinida: !!fund.tipo,
      lajeMinimaAtendida: lajeMin,
    },
    alertas,
  };
}
