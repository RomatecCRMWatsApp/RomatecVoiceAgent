// v3.49.4: Orquestrador do Memorial Sanitario (NBR 8160/10844/7229) — modulo
// Memoriais & Quantitativos. Envolve sanitarioCalc.ts (motor existente) e monta
// o ResultadoSanitario que alimenta os PDFs e as rotas /api/memoriais/sanitario/*.
// Mesmo desenho do eletricoCalculo.ts. Standalone — sem deps de mysql/pdfkit.

import { calcularMemorialSanitario } from './sanitarioCalc';
import type { WizardSanitario, MemorialSanitarioOutput, AparelhoSanitario } from './types';

export interface DadosObraSan {
  titulo: string; endereco: string; municipio: string; uf: string;
  proprietario: string; cpfCnpj: string; areaM2: number; areaLoteM2?: number;
  nPavimentos: number; prancha: string; trtNumero?: string;
}

export interface DadosUsoSan {
  tipoUso: 'residencial' | 'comercial';
  numPessoas: number;
  aparelhos: Array<{ tipo: AparelhoSanitario; quantidade: number }>;
  areaCoberturaM2: number;
  intensidadePluvMmh?: number;
  destinoEfluente: WizardSanitario['destino_efluente'];
  temCaixaGordura: boolean;
}

export interface MaterialItem { descricao: string; unidade: string; qtd: number; }

export interface ResultadoSanitario {
  dadosObra: DadosObraSan;
  dadosUso: DadosUsoSan;
  saida: MemorialSanitarioOutput;
  materiais: {
    tubos_esgoto: MaterialItem[];
    conexoes_esgoto: MaterialItem[];
    aguas_pluviais: MaterialItem[];
    fossa_sumidouro: MaterialItem[];
    caixas_ralos: MaterialItem[];
    insumos: MaterialItem[];
  };
  totais: { aparelhos: number; somaUhc: number; pontosEsgoto: number; metrosTubo: number; };
  statusNormativo: {
    esgotoDimensionadoOK: boolean;
    pluvialOK: boolean;
    fossaDimensionada: boolean;
    caixaGorduraPrevista: boolean;
  };
  alertas: string[];
}

const LABEL_APARELHO: Record<AparelhoSanitario, string> = {
  bacia_sanitaria: 'Bacia sanitaria com caixa acoplada',
  lavatorio: 'Lavatorio',
  chuveiro: 'Chuveiro / ducha',
  pia_cozinha: 'Pia de cozinha',
  tanque: 'Tanque de lavar',
  maquina_lavar: 'Maquina de lavar',
  ralo_sifonado: 'Ralo sifonado',
  ralo_seco: 'Ralo seco',
};
export function labelAparelho(tipo: AparelhoSanitario): string { return LABEL_APARELHO[tipo] ?? tipo; }

export interface EntradaResumoSan { dadosObra: DadosObraSan; dadosUso: DadosUsoSan; }

const APARELHOS_PADRAO_SAN: DadosUsoSan['aparelhos'] = [
  { tipo: 'bacia_sanitaria', quantidade: 2 },
  { tipo: 'lavatorio', quantidade: 2 },
  { tipo: 'chuveiro', quantidade: 2 },
  { tipo: 'pia_cozinha', quantidade: 1 },
  { tipo: 'tanque', quantidade: 1 },
  { tipo: 'maquina_lavar', quantidade: 1 },
  { tipo: 'ralo_sifonado', quantidade: 3 },
];

function ceilPos(n: number): number { return Math.max(0, Math.ceil(n)); }

export function calcularResumoSanitario(entrada: EntradaResumoSan): ResultadoSanitario {
  const { dadosObra, dadosUso } = entrada;
  const aparelhos = dadosUso.aparelhos && dadosUso.aparelhos.length > 0 ? dadosUso.aparelhos : APARELHOS_PADRAO_SAN;
  const numPessoas = dadosUso.numPessoas && dadosUso.numPessoas > 0 ? dadosUso.numPessoas : Math.max(2, ceilPos(dadosObra.areaM2 / 40));

  const wizard: WizardSanitario = {
    uso_edificacao: dadosUso.tipoUso === 'residencial' ? 'Residencial unifamiliar' : 'Comercial',
    num_pavimentos: dadosObra.nPavimentos,
    area_construida_m2: dadosObra.areaM2,
    num_pessoas: numPessoas,
    aparelhos,
    area_cobertura_m2: dadosUso.areaCoberturaM2 && dadosUso.areaCoberturaM2 > 0 ? dadosUso.areaCoberturaM2 : dadosObra.areaM2,
    intensidade_pluv_mmh: dadosUso.intensidadePluvMmh,
    destino_efluente: dadosUso.destinoEfluente,
    tem_caixa_gordura: dadosUso.temCaixaGordura,
    trt_numero: dadosObra.trtNumero,
  };

  const saida = calcularMemorialSanitario(wizard);
  const esg = saida.esgoto;
  const plu = saida.aguas_pluviais;
  const fossa = saida.fossa_sumidouro;

  const totalAparelhos = aparelhos.reduce((s, a) => s + (a.quantidade > 0 ? a.quantidade : 0), 0);
  const nBacias = aparelhos.filter((a) => a.tipo === 'bacia_sanitaria').reduce((s, a) => s + a.quantidade, 0);
  const nRalos = aparelhos.filter((a) => a.tipo === 'ralo_sifonado' || a.tipo === 'ralo_seco').reduce((s, a) => s + a.quantidade, 0);
  const nColuna = Math.max(1, dadosObra.nPavimentos);

  // Estimativas de metragem (barras de 6 m -> convertido em metros, com 10% perdas)
  const mRamal = ceilPos(totalAparelhos * 2.5 * 1.1);                 // ramais primarios
  const mQueda = ceilPos(esg.dimensionamento_tubo_queda.DN_mm > 0 ? dadosObra.nPavimentos * 3.0 : 0);
  const mColetor = ceilPos(dadosObra.areaM2 * 0.25 * 1.1);
  const mVentilacao = ceilPos(dadosObra.nPavimentos * 3.0 + 2);
  const mPluvCalha = ceilPos(Math.sqrt(Math.max(1, wizard.area_cobertura_m2)) * 2 * 1.1);
  const mPluvCondutor = ceilPos(plu.dimensionamento_condutor_vertical.quantidade * dadosObra.nPavimentos * 3.2);

  const dnRamal = esg.dimensionamento_ramais.DN_mm;
  const dnQueda = esg.dimensionamento_tubo_queda.DN_mm;
  const dnColetor = esg.dimensionamento_coletor_predial.DN_mm;
  const dnCalha = plu.dimensionamento_calha.DN_mm;
  const dnCondutor = plu.dimensionamento_condutor_vertical.DN_mm;

  const tubos_esgoto: MaterialItem[] = [
    { descricao: `Tubo PVC esgoto serie normal DN ${dnRamal} mm (ramais)`, unidade: 'm', qtd: mRamal },
    { descricao: `Tubo PVC esgoto DN ${dnQueda} mm (tubo de queda)`, unidade: 'm', qtd: mQueda },
    { descricao: `Tubo PVC esgoto DN ${dnColetor} mm (coletor predial)`, unidade: 'm', qtd: mColetor },
    { descricao: `Tubo PVC DN 50 mm (ventilacao)`, unidade: 'm', qtd: mVentilacao },
  ].filter((x) => x.qtd > 0);

  const conexoes_esgoto: MaterialItem[] = [
    { descricao: `Joelho 90 PVC esgoto DN ${dnRamal} mm`, unidade: 'un', qtd: ceilPos(totalAparelhos * 1.5) },
    { descricao: `Te / juncao PVC esgoto DN ${dnColetor} mm`, unidade: 'un', qtd: ceilPos(totalAparelhos * 0.6) },
    { descricao: `Curva 90 longa PVC DN ${dnQueda} mm`, unidade: 'un', qtd: ceilPos(nColuna * 2) },
    { descricao: `Luva de correr / reducao PVC esgoto`, unidade: 'un', qtd: ceilPos(totalAparelhos * 0.5) },
    { descricao: `Anel de vedacao / pasta lubrificante (kit)`, unidade: 'un', qtd: ceilPos(totalAparelhos * 1.2) },
  ];

  const aguas_pluviais: MaterialItem[] = [
    { descricao: `Calha PVC / chapa galvanizada DN ${dnCalha} mm`, unidade: 'm', qtd: mPluvCalha },
    { descricao: `Condutor vertical PVC DN ${dnCondutor} mm`, unidade: 'm', qtd: mPluvCondutor },
    { descricao: `Bocal / cabeca pluvial DN ${dnCondutor} mm`, unidade: 'un', qtd: ceilPos(plu.dimensionamento_condutor_vertical.quantidade) },
    { descricao: `Joelho 90 PVC pluvial DN ${dnCondutor} mm`, unidade: 'un', qtd: ceilPos(plu.dimensionamento_condutor_vertical.quantidade * 2) },
  ];

  const fossa_sumidouro: MaterialItem[] = fossa ? [
    { descricao: `Anel de concreto / kit fossa septica ~${fossa.volume_total_L} L`, unidade: 'cj', qtd: 1 },
    { descricao: `Sumidouro - area de infiltracao ${fossa.area_sumidouro_m2} m2`, unidade: 'm2', qtd: fossa.area_sumidouro_m2 },
    { descricao: `Brita / pedra de mao para sumidouro`, unidade: 'm3', qtd: ceilPos(fossa.area_sumidouro_m2 * 0.5) },
    { descricao: `Tubo PVC DN 100 mm (interligacao fossa-sumidouro)`, unidade: 'm', qtd: 6 },
  ] : [];

  const caixas_ralos: MaterialItem[] = [
    { descricao: `Caixa de inspecao / passagem 0,40x0,40 m`, unidade: 'un', qtd: ceilPos(dadosObra.areaM2 / 60) + 1 },
    { descricao: `Caixa sifonada PVC com grelha`, unidade: 'un', qtd: Math.max(1, nRalos) },
    { descricao: `Ralo seco / grelha`, unidade: 'un', qtd: ceilPos(nRalos * 0.5) },
    ...(dadosUso.temCaixaGordura ? [{ descricao: 'Caixa de gordura dupla PVC', unidade: 'un', qtd: 1 }] : []),
  ];

  const insumos: MaterialItem[] = [
    { descricao: 'Cimento (assentamento e caixas)', unidade: 'sc', qtd: ceilPos(dadosObra.areaM2 / 25) },
    { descricao: 'Areia media', unidade: 'm3', qtd: ceilPos(dadosObra.areaM2 / 80) },
    { descricao: 'Adesivo / solucao limpadora PVC', unidade: 'un', qtd: ceilPos(totalAparelhos / 6) + 1 },
  ];

  const pluvialOK = plu.dimensionamento_calha.status === 'OK' && plu.dimensionamento_condutor_vertical.status === 'OK';
  const alertas: string[] = [];
  if (!pluvialOK) alertas.push('Vazao pluvial elevada — calha/condutor exigem ajuste de bitola ou condutor adicional (NBR 10844).');
  if (esg.soma_uhc <= 0) alertas.push('Nenhum aparelho sanitario informado — nao foi possivel dimensionar o esgoto.');
  if (dadosUso.destinoEfluente !== 'rede_publica' && !fossa) alertas.push('Destino sem rede publica, porem fossa nao dimensionada — verificar num_pessoas.');

  return {
    dadosObra, dadosUso: { ...dadosUso, numPessoas, aparelhos },
    saida,
    materiais: { tubos_esgoto, conexoes_esgoto, aguas_pluviais, fossa_sumidouro, caixas_ralos, insumos },
    totais: {
      aparelhos: totalAparelhos,
      somaUhc: esg.soma_uhc,
      pontosEsgoto: totalAparelhos + nRalos,
      metrosTubo: mRamal + mQueda + mColetor + mVentilacao,
    },
    statusNormativo: {
      esgotoDimensionadoOK: esg.soma_uhc > 0 && dnRamal > 0,
      pluvialOK,
      fossaDimensionada: !!fossa,
      caixaGorduraPrevista: !!dadosUso.temCaixaGordura,
    },
    alertas,
  };
}
