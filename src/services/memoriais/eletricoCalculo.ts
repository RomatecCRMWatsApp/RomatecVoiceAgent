// v3.49.3: Orquestrador do Memorial Eletrico (NBR 5410:2004) — modulo
// Memoriais & Quantitativos. Envolve eletricoCalc.ts (motor ja existente) e
// monta o ResultadoEletrico que alimenta os PDFs (Memorial + Quantitativo) e
// as rotas /api/memoriais/eletrico/*. Mesmo desenho do hidraulicoCalculo.ts.
//
// v3.66.0: suporte a extracao de circuitos reais (calcularComExtracao).
//
// Standalone — sem deps de mysql/pdfkit.

import { calcularMemorialEletrico } from './eletricoCalc';
import type { WizardEletrico, MemorialEletricoOutput } from './types';
import type { ExtracaoEletrica, CircuitoEletrico } from './eletricoExtracaoTypes';

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
  circuitos: Array<{
    descricao: string; disjuntor_A: number; secao_mm2: number;
    // v3.66.0 — presentes quando vindos de extração:
    id?: string; tipo?: 'ilum' | 'tug' | 'tue'; potencia_va?: number; ip_a?: number;
    condutor_protecao_mm2?: number | null; capacidade_cond_a?: number; status_ok?: boolean; polos?: number;
  }>;
  materiais: {
    eletrodutos: MaterialItem[];
    condutores: MaterialItem[];
    protecao: MaterialItem[];
    pontos: MaterialItem[];
    quadros: MaterialItem[];
    insumos: MaterialItem[];
    caixas: MaterialItem[];
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
  extracao?: Pick<ExtracaoEletrica, 'circuitos' | 'pontos' | 'eletrodutos' | 'caixas'>;
}

const APARELHOS_PADRAO_ELE: DadosUsoEle['cargas'] = [
  { tipo: 'tue_chuveiro', potencia_w: 5500, quantidade: 1 },
  { tipo: 'tue_ar_condicionado', potencia_w: 1400, quantidade: 1 },
  { tipo: 'tue_maquina_lavar', potencia_w: 1500, quantidade: 1 },
  { tipo: 'tue_forno_micro', potencia_w: 2000, quantidade: 1 },
];

function ceilPos(n: number): number { return Math.max(1, Math.ceil(n)); }

// ---------------------------------------------------------------------------
// Helpers reutilizáveis nos dois caminhos (heurístico + extração)
// ---------------------------------------------------------------------------

function montarQuadros(totalCircuitos: number): MaterialItem[] {
  return [
    { descricao: `Quadro de distribuicao de embutir ${Math.max(12, totalCircuitos + 4)} disjuntores`, unidade: 'un', qtd: 1 },
    { descricao: 'Barramento de terra + neutro', unidade: 'cj', qtd: 1 },
    { descricao: 'Haste de aterramento cobreada 5/8" x 2,4 m', unidade: 'un', qtd: 1 },
    { descricao: 'Conector de aterramento + cordoalha', unidade: 'cj', qtd: 1 },
  ];
}

function montarInsumos(totalCircuitos: number): MaterialItem[] {
  return [
    { descricao: 'Fita isolante 19mm x 20m', unidade: 'un', qtd: ceilPos(totalCircuitos / 6) },
    { descricao: 'Conector de emenda (kit)', unidade: 'cj', qtd: ceilPos(totalCircuitos / 4) },
    { descricao: 'Abracadeira / fixacao (vb)', unidade: 'vb', qtd: 1 },
  ];
}

// Agrupamento de disjuntores a partir de circuitos reais (extração).
// Para o caminho heurístico os disjuntores são montados inline (mantém valores inalterados).
function montarProtecaoDeCircuitos(
  circuitos: CircuitoEletrico[],
  dadosUso: DadosUsoEle,
  saida: MemorialEletricoOutput,
): MaterialItem[] {
  // Agrupa disjuntores terminais por amperagem
  const porAmpere: Record<number, number> = {};
  for (const c of circuitos) {
    porAmpere[c.disjuntorA] = (porAmpere[c.disjuntorA] || 0) + 1;
  }
  const terminais: MaterialItem[] = Object.entries(porAmpere)
    .map(([amp, qtd]) => ({
      descricao: `Disjuntor termomagnetico DIN ${amp}A`,
      unidade: 'un',
      qtd,
    }));

  const geral: MaterialItem = {
    descricao: `Disjuntor geral ${saida.dimensionamento_ramal.disjuntor_geral_A}A`,
    unidade: 'un',
    qtd: 1,
  };
  const dr: MaterialItem = {
    descricao: 'Interruptor diferencial residual (DR) 40A 30mA',
    unidade: 'un',
    qtd: 1,
  };
  const dps: MaterialItem = {
    descricao: 'DPS Classe II 275V 20kA',
    unidade: 'un',
    qtd: dadosUso.tipoAlimentacao === 'trifasico' ? 3 : 2,
  };

  return [...terminais, geral, dr, dps].filter((x) => x.qtd > 0);
}

// ---------------------------------------------------------------------------
// Capacidade de condução (NBR 5410 Tabela 36/47, método B1/B2, cobre/PVC)
// ---------------------------------------------------------------------------
const CAP_COND_A: Record<number, number> = { 1.5: 15.5, 2.5: 21, 4: 27, 6: 32, 10: 44, 16: 59, 25: 77 };

// ---------------------------------------------------------------------------
// Caminho com extração de circuitos reais
// ---------------------------------------------------------------------------

function calcularComExtracao(
  dadosObra: DadosObraEle,
  dadosUso: DadosUsoEle,
  ext: Pick<ExtracaoEletrica, 'circuitos' | 'pontos' | 'eletrodutos' | 'caixas'>,
  saida: MemorialEletricoOutput,
): ResultadoEletrico {
  const { circuitos: extCircuitos, pontos, eletrodutos: extEletrodutos, caixas: extCaixas } = ext;

  // Circuitos mapeados com campos enriquecidos (v3.66.0)
  const V = dadosUso.tensaoNominalV;
  const circuitos: ResultadoEletrico['circuitos'] = extCircuitos.map((c) => {
    const ip_a = Math.round((c.potenciaVA / V) * 10) / 10;
    const capacidade_cond_a = CAP_COND_A[c.condutorFaseMm2] ?? 0;
    const status_ok = capacidade_cond_a >= ip_a && c.disjuntorA <= capacidade_cond_a;
    return {
      descricao: `${c.id} — ${c.descricao}`,
      disjuntor_A: c.disjuntorA,
      secao_mm2: c.condutorFaseMm2,
      id: c.id,
      tipo: c.tipo,
      potencia_va: c.potenciaVA,
      ip_a,
      condutor_protecao_mm2: c.condutorProtecaoMm2 ?? null,
      capacidade_cond_a,
      status_ok,
      polos: c.polos,
    };
  });

  // Cabos por seção
  // Fase+Neutro usam condutorFaseMm2; Terra usa condutorProtecaoMm2 (default 2.5)
  const porSecao: Record<number, number> = {};
  for (const c of extCircuitos) {
    const lance = c.lanceMedioM ?? 12;
    const secFase = c.condutorFaseMm2;
    const secTerra = c.condutorProtecaoMm2 ?? 2.5;
    // F+N: lance * 2
    porSecao[secFase] = (porSecao[secFase] || 0) + lance * 2;
    // Terra: lance * 1
    porSecao[secTerra] = (porSecao[secTerra] || 0) + lance * 1;
  }

  // Ramal de entrada: quantidade de condutores por tipo de alimentação
  const nCondRamal = dadosUso.tipoAlimentacao === 'trifasico' ? 5
    : dadosUso.tipoAlimentacao === 'bifasico' ? 4
    : 3; // monofasico: F+N+T
  const secRamal = saida.dimensionamento_ramal.secao_condutor_mm2;
  porSecao[secRamal] = (porSecao[secRamal] || 0) + dadosUso.comprimentoRamalM * nCondRamal;

  // Format section: integers that aren't whole (e.g. 1.5, 2.5) stay as-is;
  // whole integers like 6 become "6.0" to match test expectations (/6\.0 mm2/).
  function fmtSec(sec: number): string {
    return Number.isInteger(sec) ? `${sec}.0` : String(sec);
  }

  const condutores: MaterialItem[] = Object.keys(porSecao)
    .map(Number)
    .sort((a, b) => a - b)
    .map((sec) => ({
      descricao: `Cabo flexivel cobre 450/750V ${fmtSec(sec)} mm2`,
      unidade: 'm',
      qtd: Math.ceil(porSecao[sec] * 1.1),
    }));

  // Eletrodutos: soma os extraídos ou usa fallback pelo número de circuitos
  const totalEletrodutoM = extEletrodutos.reduce((s, e) => s + e.comprimentoM, 0);
  const eletrodutos: MaterialItem[] = totalEletrodutoM > 0
    ? [{ descricao: 'Eletroduto PVC corrugado antichamas Ø25 (NBR 15465)', unidade: 'm', qtd: Math.ceil(totalEletrodutoM * 1.1) }]
    : [{ descricao: 'Eletroduto PVC corrugado antichamas Ø25 (NBR 15465)', unidade: 'm', qtd: Math.ceil(extCircuitos.length * 12 * 1.1) }];

  // Pontos de instalação
  const pontosItems: MaterialItem[] = [
    { descricao: 'Ponto de luz (plafonier + lampada LED)', unidade: 'un', qtd: pontos.iluminacao },
    { descricao: 'Tomada de uso geral (TUG) 10A 2P+T', unidade: 'un', qtd: pontos.tug10A },
    { descricao: 'Tomada de uso especifico (TUE) 20A 2P+T', unidade: 'un', qtd: pontos.tue20A },
    { descricao: 'Interruptor simples', unidade: 'un', qtd: pontos.interruptorSimples },
    { descricao: 'Interruptor paralelo (three-way)', unidade: 'un', qtd: pontos.interruptorParalelo },
  ].filter((x) => x.qtd > 0);

  // Caixas de embutir
  const caixas: MaterialItem[] = extCaixas.map((c) => ({
    descricao: `Caixa de embutir ${c.tipo}`,
    unidade: 'un',
    qtd: c.qtd,
  }));

  // Proteção, quadros e insumos
  const protecao = montarProtecaoDeCircuitos(extCircuitos, dadosUso, saida);
  const quadros = montarQuadros(extCircuitos.length);
  const insumos = montarInsumos(extCircuitos.length);

  // Potência instalada real
  const piVA = extCircuitos.reduce((s, c) => s + c.potenciaVA, 0);
  const saida2: MemorialEletricoOutput = { ...saida, carga_total_instalada_w: piVA };

  // Totais
  const totaisCircuitos = extCircuitos.length;
  const totaisDisjuntores = protecao.reduce((s, x) => s + x.qtd, 0);

  const quedaOK2 = saida.dimensionamento_ramal.queda_tensao_pct <= 4;
  const alertas2: string[] = [];
  if (!quedaOK2) alertas2.push(`Queda de tensao ${saida.dimensionamento_ramal.queda_tensao_pct}% acima de 4% — revisar bitola/comprimento do ramal.`);
  if (saida.dimensionamento_ramal.status === 'AJUSTAR') alertas2.push('Dimensionamento do ramal requer ajuste (status AJUSTAR).');

  return {
    dadosObra,
    dadosUso,
    saida: saida2,
    circuitos,
    materiais: { eletrodutos, condutores, protecao, pontos: pontosItems, quadros, insumos, caixas },
    totais: {
      pontosLuz: pontos.iluminacao,
      tugs: pontos.tug10A,
      tues: pontos.tue20A,
      circuitos: totaisCircuitos,
      disjuntores: totaisDisjuntores,
    },
    statusNormativo: {
      quedaTensaoOK: quedaOK2,
      drObrigatorioAtendido: saida.protecao.dr_obrigatorio,
      dpsObrigatorioAtendido: saida.protecao.dps_obrigatorio,
      aterramentoDefinido: !!saida.protecao.aterramento_tipo,
    },
    alertas: alertas2,
  };
}

// ---------------------------------------------------------------------------
// Caminho heurístico (área) — retrocompatível
// ---------------------------------------------------------------------------

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

  // Caminho de extração — usa circuitos reais quando disponíveis
  if (entrada.extracao && entrada.extracao.circuitos.length > 0) {
    return calcularComExtracao(dadosObra, dadosUso, entrada.extracao, saida);
  }

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

  const quadros = montarQuadros(totalCircuitos);
  const insumos = montarInsumos(totalCircuitos);

  const quedaOK = saida.dimensionamento_ramal.queda_tensao_pct <= 4;
  const alertas: string[] = [];
  if (!quedaOK) alertas.push(`Queda de tensao ${saida.dimensionamento_ramal.queda_tensao_pct}% acima de 4% — revisar bitola/comprimento do ramal.`);
  if (saida.dimensionamento_ramal.status === 'AJUSTAR') alertas.push('Dimensionamento do ramal requer ajuste (status AJUSTAR).');

  return {
    dadosObra,
    dadosUso,
    saida,
    circuitos,
    materiais: { eletrodutos, condutores, protecao, pontos, quadros, insumos, caixas: [] },
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
