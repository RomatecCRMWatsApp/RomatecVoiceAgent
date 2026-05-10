// src/services/pricing/incra.ts
//
// Precificação INCRA — Portaria nº 12, de 23 de abril de 2025.
// Base: 3ª Edição da Norma Técnica para Georreferenciamento de Imóveis Rurais.
// Fonte: https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/portaria_12_2025_geo.pdf
//
// AVISO: este arquivo é espelhado em src/public/js/incraCalc.js (vanilla JS, front).
// Mudou aqui? Atualize lá. Teste de paridade em incra.test.ts garante que back e
// front calculam o mesmo (54 cenários: 6 faixas × 3 unidades × 3 tipos de desconto).

export interface FaixaIncra {
  pontuacaoMin: number;
  pontuacaoMax: number;
  rendimentoKmDia: number;
  valorPorKm: number;
  valorPorHectare: number;
  valorPorLote: number;
  label: string;
}

export const TABELA_INCRA_2025: FaixaIncra[] = [
  { pontuacaoMin: 6,  pontuacaoMax: 15, rendimentoKmDia: 5.00, valorPorKm: 747.52,  valorPorHectare: 49.83,  valorPorLote: 617.79,  label: '06-15' },
  { pontuacaoMin: 16, pontuacaoMax: 25, rendimentoKmDia: 4.25, valorPorKm: 897.03,  valorPorHectare: 59.80,  valorPorLote: 741.34,  label: '16-25' },
  { pontuacaoMin: 26, pontuacaoMax: 35, rendimentoKmDia: 3.50, valorPorKm: 1571.64, valorPorHectare: 104.78, valorPorLote: 1298.88, label: '26-35' },
  { pontuacaoMin: 36, pontuacaoMax: 45, rendimentoKmDia: 2.15, valorPorKm: 2023.23, valorPorHectare: 134.88, valorPorLote: 1672.09, label: '36-45' },
  { pontuacaoMin: 46, pontuacaoMax: 55, rendimentoKmDia: 1.25, valorPorKm: 2474.20, valorPorHectare: 164.95, valorPorLote: 2044.80, label: '46-55' },
  { pontuacaoMin: 56, pontuacaoMax: 60, rendimentoKmDia: 0.80, valorPorKm: 3043.12, valorPorHectare: 202.87, valorPorLote: 2514.97, label: '56-60' },
];

export const CRITERIOS_INCRA = {
  vegetacao: {
    label: 'Vegetação',
    descricao: 'Distribuição da cobertura vegetal',
    niveis: [
      { faixa: '1-3',  rotulo: 'Aberta',        descricao: 'Vegetação rasteira, sem árvores' },
      { faixa: '4-6',  rotulo: 'Intermediária', descricao: 'Arbustos e árvores de pequeno porte (cerrado, caatinga)' },
      { faixa: '7-10', rotulo: 'Fechada',       descricao: 'Árvores de médio/grande porte (mata atlântica, Amazônia)' },
    ],
  },
  relevo: {
    label: 'Relevo',
    descricao: 'Declividade do terreno',
    niveis: [
      { faixa: '1-3',  rotulo: 'Plano a Suave Ondulado',           descricao: 'Declividade 0-5%' },
      { faixa: '4-6',  rotulo: 'Moderadamente ondulado a Ondulado',descricao: 'Declividade 5-15%' },
      { faixa: '7-10', rotulo: 'Forte ondulado a Escarpado',        descricao: 'Declividade > 15%' },
    ],
  },
  insalubridade: {
    label: 'Insalubridade',
    descricao: 'Incidência de endemias/epidemias',
    niveis: [
      { faixa: '1-3',  rotulo: 'Baixa', descricao: 'Pouco ou nenhum histórico' },
      { faixa: '4-6',  rotulo: 'Média', descricao: 'Histórico recente' },
      { faixa: '7-10', rotulo: 'Alta',  descricao: 'Histórico frequente' },
    ],
  },
  acesso: {
    label: 'Acesso',
    descricao: 'Vias disponíveis e trafegabilidade',
    niveis: [
      { faixa: '1-3',  rotulo: 'Fácil',   descricao: 'Vias com boas condições' },
      { faixa: '4-6',  rotulo: 'Regular', descricao: 'Baixa condição de trafegabilidade' },
      { faixa: '7-10', rotulo: 'Difícil', descricao: 'Insuficiência de vias' },
    ],
  },
  clima: {
    label: 'Clima',
    descricao: 'Condições meteorológicas no período',
    niveis: [
      { faixa: '1-3',  rotulo: 'Favorável',    descricao: 'Sem chuvas, temperaturas amenas' },
      { faixa: '4-6',  rotulo: 'Mediano',      descricao: 'Chuvas esparsas, temperaturas médias' },
      { faixa: '7-10', rotulo: 'Desfavorável', descricao: 'Chuvas frequentes, temperaturas extremas' },
    ],
  },
  area_media: {
    label: 'Área Média dos Lotes',
    descricao: 'Tamanho médio dos lotes a demarcar',
    niveis: [
      { faixa: '1-3',  rotulo: 'Favorável',    descricao: 'Acima de 35 ha' },
      { faixa: '4-6',  rotulo: 'Mediano',      descricao: 'De 15 a 35 ha' },
      { faixa: '7-10', rotulo: 'Desfavorável', descricao: 'Até 15 ha' },
    ],
  },
} as const;

export const PORTARIA_INCRA_REFERENCIA = {
  numero: '12/2025',
  data: '23 de abril de 2025',
  orgao: 'INCRA — Diretoria de Governança da Terra',
  url: 'https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/portaria_12_2025_geo.pdf',
  observacao: 'Valores referenciais com variação admissível de ±10% conforme Anexo I, nota [1].',
};

export type UnidadeCalculo = 'km' | 'hectare' | 'lote';
export type DescontoTipo = 'percentual' | 'fixo' | 'nenhum';

export interface CriteriosPontuacao {
  vegetacao: number;
  relevo: number;
  insalubridade: number;
  acesso: number;
  clima: number;
  area_media: number;
}

export interface InputPrecificacao {
  criterios: CriteriosPontuacao;
  unidade: UnidadeCalculo;
  quantidade: number;
  desconto: { tipo: DescontoTipo; valor: number };
}

export interface ResultadoPrecificacao {
  pontuacaoTotal: number;
  faixa: FaixaIncra;
  valorUnitario: number;
  valorBase: number;
  descontoAplicado: number;
  valorFinal: number;
  detalhamento: { formula: string; avisos: string[] };
}

export interface DadosLaudoParaSugestao {
  area_total_m2?: number;
  perimetro_m?: number;
  num_pontos?: number;
  municipio?: string;
  uf?: string;
  tipo_vegetacao?: 'aberta' | 'intermediaria' | 'fechada';
}

export function validarCriterios(c: CriteriosPontuacao): { ok: boolean; erros: string[] } {
  const erros: string[] = [];
  for (const [k, v] of Object.entries(c)) {
    if (!Number.isInteger(v) || v < 1 || v > 10) {
      erros.push(`Critério ${k}: pontuação deve ser inteiro de 1 a 10 (recebido: ${v})`);
    }
  }
  return { ok: erros.length === 0, erros };
}
