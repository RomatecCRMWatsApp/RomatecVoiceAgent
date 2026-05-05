// v1.66.0: calculadora SERO/INSS de obra (afericao indireta IN RFB 2021/2021).
// Receita Federal NAO oferece API publica. Calculo oficial e feito via
// portal e-CAC com login gov.br. Replicamos a formula offline pra dar
// uma estimativa ao cliente. Aviso obrigatorio impresso no PDF.
//
// Formula (afericao indireta, IN 2021/2021):
//   Custo Global da Obra = CUB regional x area construida
//   RMT (Remuneracao Maoo de Obra) = Custo Global x % mao de obra
//   INSS devido    = RMT x 20%
//   Sistema S      = RMT x 8%
//   TOTAL devido   = INSS + Sistema S = RMT x 28%
//
// % mao de obra (IN 2021/2021):
//   Residencial alvenaria sem premoldados: 14%
//   Residencial alvenaria com premoldados: 4%
//   Residencial madeira:                   14%
//   Comercial medio:                       10%

import { getParams, cubPorPadrao } from '../pricing/params';
import type { PadraoConstrutivo, ResponsavelObra } from '../pricing/types';

export interface InputSERO {
  area_construida: number;       // m2
  padrao_construtivo: PadraoConstrutivo;
  modalidade: 'residencial' | 'comercial';
  responsavel: ResponsavelObra;
  com_premoldados?: boolean;     // afeta % mao de obra residencial
}

export interface ResultadoSERO {
  custo_global: number;
  rmt: number;                   // remuneracao mao de obra
  inss: number;                  // RMT * 20%
  sistema_s: number;             // RMT * 8%
  total: number;                 // INSS + Sistema S (= 0 se PJ_com_contabilidade)
  cub_usado: number;
  percentual_mao_obra: number;
  fonte: string;
  aviso: string;
  observacao_pj?: string;
}

export function calcularSERO(input: InputSERO): ResultadoSERO {
  const params = getParams();
  const cub = cubPorPadrao(input.padrao_construtivo);
  const custo_global = input.area_construida * cub;

  let pmo: number;
  if (input.modalidade === 'residencial') {
    pmo = input.com_premoldados
      ? params.sero_inss.percentual_mao_obra.residencial_alvenaria_com_premoldado
      : params.sero_inss.percentual_mao_obra.residencial_alvenaria_sem_premoldado;
  } else {
    pmo = params.sero_inss.percentual_mao_obra.comercial_medio;
  }

  const rmt = custo_global * pmo;
  const inss = rmt * params.sero_inss.aliquota_inss;
  const sistema_s = rmt * params.sero_inss.aliquota_sistema_s;

  // PJ com contabilidade regular -> INSS apurado via folha, nao usa SERO
  const aplicaSero = input.responsavel !== 'PJ_com_contabilidade';
  const total = aplicaSero ? inss + sistema_s : 0;

  return {
    custo_global,
    rmt,
    inss,
    sistema_s,
    total,
    cub_usado: cub,
    percentual_mao_obra: pmo,
    fonte: params.sero_inss.fonte,
    aviso: params.sero_inss.aviso_pdf,
    observacao_pj: !aplicaSero
      ? 'Apurado via contabilidade regular da PJ (nao se aplica SERO afericao indireta).'
      : undefined,
  };
}
