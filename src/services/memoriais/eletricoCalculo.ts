// v3.49.3: Orquestrador do Memorial Eletrico (NBR 5410:2004) — modulo
// Memoriais & Quantitativos. Envolve eletricoCalc.ts (motor ja existente) e
// monta o ResultadoEletrico que alimenta os PDFs (Memorial + Quantitativo) e
// as rotas /api/memoriais/eletrico/*. Mesmo desenho do hidraulicoCalculo.ts.
//
// Standalone — sem deps de mysql/pdfkit.

import { calcularMemorialEletrico } from './eletricoCalc';
import type { WizardEletrico, MemorialEletricoOutput } from './types';

export interface DadosObraEle {
  titulo: string;
  endereco: string;
  municipio: string;
  uf: string;
  proprietario: string;
  cpfCnpj: string;
  areaM2: number;
  areaLoteM2?: number;
  nPavimentos: number;
  prancha: string;
  trtNumero?: string;
}

export interface DadosUsoEle {
  tipoUso: 'residencial' | 'comercial';
  tensaoNominalV: 127 | 220 | 380;
  tipoAlimentacao: 'monofasico' | 'bifasico' | 'trifasico';
  comprimentoRamalM: number;
  cargas: Array<{ tipo: WizardEletrico['cargas'][number]['tipo']; potencia_w: number; quantidade: number }>;
}

export interface MaterialItem {
  descricao: string;
  unidade: string;
  qtd: number;
}

export interface ResultadoEletrico {
  dadosObra: DadosObraEle;
  dadosUso: DadosUsoEle;
  saida: MemorialEletricoOutput;
  circuitos: Array<{ descricao: string; disjuntor_A: number; secao_mm2: number }>;
  materiais: {
    eletrodutos: MaterialItem[];
    condutores: MaterialItem[];
    protecao: MaterialItem[];
    pontos: MaterialItem[];
    quadros: MaterialItem[];
    insumos: MaterialItem[];
  };
  totais: {
    pontosLuz: number;
    tugs: number;
    tues: number;
    circuitos: number;
    disjuntores: number;
  };
  statusNormativo: {
    quedaTensaoOK: boolean;     // <= 4%
    drObrigatorioAtendido: boolean;
    dpsObrigatorioAtendido: boolean;
    aterramentoDefinido: boolean;
  };
  alertas: string[];
}

const LABEL_CARGA: Record<string, string> = {
  iluminacao_tug: 'Iluminacao + TUG',
  tue_chuveiro: 'Chuveiro eletrico',
  tue_aquecedor: 'Aquecedor / boiler',
  tue_ar_condicionado: 'Ar-condicionado (split)',
  tue_maquina_lavar: 'Maquina de lavar / lava-loucas',
  tue_forno_micro: 'Forno + microondas',
  tue_outros: 'Outros TUE',
};

export function labelCarga(tipo: string): string {
  return LABEL_CARGA[tipo] ?? tipo;
}

export interface EntradaResumoEle {
  dadosObra: DadosObraEle;
  dadosUso: DadosUsoEle;
}

const APARELHOS_PADRAO_ELE: DadosUsoEle['cargas'] = [
  { tipo: 'tue_chuveiro', potencia_w: 5500, quantidade: 1 },
  { tipo: 'tue_ar_condicionado', potencia_w: 1400, quantidade: 1 },
  { tipo: 'tue_maquina_lavar', potencia_w: 1500, quantidade: 1 },
  { tipo: 'tue_forno_micro', potencia_w: 2000, quantidade: 1 },
];

function ceilPos(n: number): number { return Math.max(1, Math.ceil(n)); }

export function calcularResumoEletrico(entrada: EntradaResumoEle): ResultadoEletrico {
  const { dadosObra, dadosUso } = entrada;
  const cargas = dadosUso.cargas && dadosUso.cargas.length > 0 ? dadosUso.cargas : APARELHOS_PADRAO_ELE;

  const wizard: WizardEletrico = {
    uso_edificacao: dadosUso.tipoUso === 'residencial' ? 'Residencial unifamiliar' : 'Comercial',
    num_pavimentos: dadosObra.nPavimentos,
    area_construida_m2: dadosObra.areaM2,
    cargas,
    fator_demanda: dadosUso.tipoUso,
    tensao_nominal_v: dadosUso.tensaoNominalV,
    tipo_alimentacao: dadosUso.tipoAlimentacao,
    comprimento_ramal_m: dadosUso.comprimentoRamalM,
    trt_numero: dadosObra.trtNumero,
  };

  const saida = calcularMemorialEletrico(wizard);

  // Estimativa de circuitos terminais (NBR 5410): ilum, TUGs por area, + 1 por TUE.
  const area = dadosObra.areaM2;
  const nLuz = ceilPos(area / 12);                 // pontos de luz ~1 a cada 12 m2
  const nTug = ceilPos(area / 5) + 4;              // TUGs por area + areas molhadas
  const tues = cargas.filter((c) => c.tipo !== 'iluminacao_tug' && c.quantidade > 0);
  const nCircIlum = ceilPos(nLuz / 8);
  const nCircTug = ceilPos(nTug / 10);
  const nCircTue = tues.reduce((s, c) => s + c.quantidade, 0);
  const totalCircuitos = nCircIlum + nCircTug + nCircTue;

  const circuitos: ResultadoEletrico['circuitos'] = [];
  for (let i = 1; i <= nCircIlum; i++) circuitos.push({ descricao: `Iluminacao ${i}`, disjuntor_A: 10, secao_mm2: 1.5 });
  for (let i = 1; i <= nCircTug; i++) circuitos.push({ descricao: `TUG ${i}`, disjuntor_A: 16, secao_mm2: 2.5 });
  tues.forEach((c) => {
    for (let i = 0; i < c.quantidade; i++) {
      const ic = saida.corrente_projeto_A;
      const dj = c.tipo === 'tue_chuveiro' ? 40 : c.tipo === 'tue_ar_condicionado' ? 20 : 20;
      const sec = c.tipo === 'tue_chuveiro' ? 6.0 : 2.5;
      circuitos.push({ descricao: labelCarga(c.tipo), disjuntor_A: dj, secao_mm2: sec });
      void ic;
    }
  });

  // Comprimento estimado de condutor: media 12 m por circuito x 3 condutores (F+N+T)
  const metrosPorCircuito = 12;
  const metrosEletroduto = totalCircuitos * metrosPorCircuito;
  const condutorPorSecao: Record<number, number> = {};
  circuitos.forEach((c) => {
    condutorPorSecao[c.secao_mm2] = (condutorPorSecao[c.secao_mm2] || 0) + metrosPorCircuito * 3;
  });
  // ramal de entrada
  condutorPorSecao[saida.dimensionamento_ramal.secao_condutor_mm2] =
    (condutorPorSecao[saida.dimensionamento_ramal.secao_condutor_mm2] || 0) + dadosUso.comprimentoRamalM * 3;

  const condutores: MaterialItem[] = Object.keys(condutorPorSecao)
    .map(Number).sort((a, b) => a - b)
    .map((sec) => ({ descricao: `Cabo flexivel PVC 750V ${sec} mm2`, unidade: 'm', qtd: Math.ceil(condutorPorSecao[sec] * 1.1) }));

  const eletrodutos: MaterialItem[] = [
    { descricao: 'Eletroduto PVC corrugado antichamas Ø25 (NBR 15465)', unidade: 'm', qtd: Math.ceil(metrosEletroduto * 0.7 * 1.1) },
    { descricao: 'Eletroduto PVC corrugado antichamas Ø32', unidade: 'm', qtd: Math.ceil(metrosEletroduto * 0.3 * 1.1) },
    { descricao: 'Caixa de passagem 4x2"', unidade: 'un', qtd: nLuz + nTug },
    { descricao: 'Caixa de passagem 4x4"', unidade: 'un', qtd: ceilPos(totalCircuitos / 4) },
  ];

  const protecao: MaterialItem[] = [
    { descricao: 'Disjuntor termomagnetico DIN 10A (iluminacao)', unidade: 'un', qtd: nCircIlum },
    { descricao: 'Disjuntor termomagnetico DIN 16A (TUG)', unidade: 'un', qtd: nCircTug },
    { descricao: 'Disjuntor termomagnetico DIN 20A (TUE)', unidade: 'un', qtd: tues.filter(c => c.tipo !== 'tue_chuveiro').reduce((s, c) => s + c.quantidade, 0) },
    { descricao: 'Disjuntor termomagnetico DIN 40A (chuveiro)', unidade: 'un', qtd: tues.filter(c => c.tipo === 'tue_chuveiro').reduce((s, c) => s + c.quantidade, 0) },
    { descricao: `Disjuntor geral ${saida.dimensionamento_ramal.disjuntor_geral_A}A`, unidade: 'un', qtd: 1 },
    { descricao: 'Interruptor diferencial residual (DR) 40A 30mA', unidade: 'un', qtd: 1 },
    { descricao: 'DPS Classe II 275V 20kA', unidade: 'un', qtd: dadosUso.tipoAlimentacao === 'trifasico' ? 3 : 2 },
  ].filter((x) => x.qtd > 0);

  const pontos: MaterialItem[] = [
    { descricao: 'Ponto de luz (plafonier + lampada LED)', unidade: 'un', qtd: nLuz },
    { descricao: 'Tomada de uso geral (TUG) 10A 2P+T', unidade: 'un', qtd: nTug },
    { descricao: 'Tomada de uso especifico (TUE) 20A 2P+T', unidade: 'un', qtd: nCircTue },
    { descricao: 'Interruptor simples/paralelo', unidade: 'un', qtd: nLuz },
  ];

  const quadros: MaterialItem[] = [
    { descricao: `Quadro de distribuicao de embutir ${Math.max(12, totalCircuitos + 4)} disjuntores`, unidade: 'un', qtd: 1 },
    { descricao: 'Barramento de terra + neutro', unidade: 'cj', qtd: 1 },
    { descricao: 'Haste de aterramento cobreada 5/8" x 2,4 m', unidade: 'un', qtd: 1 },
    { descricao: 'Conector de aterramento + cordoalha', unidade: 'cj', qtd: 1 },
  ];

  const insumos: MaterialItem[] = [
    { descricao: 'Fita isolante 19mm x 20m', unidade: 'un', qtd: ceilPos(totalCircuitos / 6) },
    { descricao: 'Conector de emenda (kit)', unidade: 'cj', qtd: ceilPos(totalCircuitos / 4) },
    { descricao: 'Abracadeira / fixacao (vb)', unidade: 'vb', qtd: 1 },
  ];

  const quedaOK = saida.dimensionamento_ramal.queda_tensao_pct <= 4;
  const alertas: string[] = [];
  if (!quedaOK) alertas.push(`Queda de tensao ${saida.dimensionamento_ramal.queda_tensao_pct}% acima de 4% — revisar bitola/comprimento do ramal.`);
  if (saida.dimensionamento_ramal.status === 'AJUSTAR') alertas.push('Dimensionamento do ramal requer ajuste (status AJUSTAR).');

  return {
    dadosObra,
    dadosUso,
    saida,
    circuitos,
    materiais: { eletrodutos, condutores, protecao, pontos, quadros, insumos },
    totais: {
      pontosLuz: nLuz,
      tugs: nTug,
      tues: nCircTue,
      circuitos: totalCircuitos,
      disjuntores: protecao.reduce((s, x) => s + x.qtd, 0),
    },
    statusNormativo: {
      quedaTensaoOK: quedaOK,
      drObrigatorioAtendido: saida.protecao.dr_obrigatorio,
      dpsObrigatorioAtendido: saida.protecao.dps_obrigatorio,
      aterramentoDefinido: !!saida.protecao.aterramento_tipo,
    },
    alertas,
  };
}
