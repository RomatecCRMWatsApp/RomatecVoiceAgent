// v1.66.0: orquestrador TJMA. Fase 1 usa SO o fallback hardcoded da
// Resolucao GP 143/2025 (vigente desde 01/01/2026). Scraper real fica
// pra Fase 4 — quando vier, esta funcao vira: tenta scraping -> cache
// 24h -> fallback. API publica permanece igual.

import {
  TABELA_16_3, TABELA_16_9,
  VALOR_AVERBACAO_SEM_VALOR_DECLARADO,
  VALOR_AVERBACAO_GEORREF_SIGEF,
  VALOR_DESDOBRO_UNIFICACAO,
  VALOR_REGISTRO_LOTE_DESM_INCORP,
} from './tabela-fallback-2026';

export interface Faixa { ate: number; valor: number }

export type AtoTJMA =
  | 'averbacao_construcao'      // averbacao com valor declarado (usa 16.9)
  | 'averbacao_sem_valor'       // sem valor declarado (16.22.2)
  | 'registro_propriedade'      // registro com valor declarado (16.3)
  | 'retificacao'               // retificacao = 16.9 com 50% (16.22.8.1)
  | 'desmembramento'            // por matricula nova (16.3) + cada lote (16.5)
  | 'georreferenciamento'       // averbacao SIGEF (16.22.4)
  | 'desdobro_unificacao';      // 16.22.6

export interface ResultadoEmolumentos {
  valor: number;
  fonte: 'scraping' | 'fallback';
  consultadoEm: Date;
  base_calculo?: string;
  observacao?: string;
}

function buscarFaixa(tabela: Faixa[], valorDeclarado: number): number {
  for (const f of tabela) if (valorDeclarado <= f.ate) return f.valor;
  return tabela[tabela.length - 1].valor;
}

export async function calcularEmolumentos(
  ato: AtoTJMA,
  valorDeclarado: number = 0
): Promise<ResultadoEmolumentos> {
  const consultadoEm = new Date();
  switch (ato) {
    case 'averbacao_construcao':
      return {
        valor: buscarFaixa(TABELA_16_9, valorDeclarado),
        fonte: 'fallback',
        consultadoEm,
        base_calculo: `Tabela TJMA 16.9 — registros torrens (averbacao com valor)`,
        observacao: `Valor venal: R$ ${valorDeclarado.toFixed(2)}`,
      };
    case 'averbacao_sem_valor':
      return {
        valor: VALOR_AVERBACAO_SEM_VALOR_DECLARADO,
        fonte: 'fallback',
        consultadoEm,
        base_calculo: 'Tabela TJMA 16.22.2 — averbacao sem valor declarado',
      };
    case 'registro_propriedade':
      return {
        valor: buscarFaixa(TABELA_16_3, valorDeclarado),
        fonte: 'fallback',
        consultadoEm,
        base_calculo: 'Tabela TJMA 16.3 — registro com valor declarado',
      };
    case 'retificacao':
      // Tabela 16.22.8.1: retificacao = 16.9 com 1/2 da base (50%)
      return {
        valor: buscarFaixa(TABELA_16_9, valorDeclarado) * 0.5,
        fonte: 'fallback',
        consultadoEm,
        base_calculo: 'Tabela TJMA 16.22.8.1 — retificacao (16.9 com 50%)',
      };
    case 'desmembramento':
      return {
        valor: buscarFaixa(TABELA_16_3, valorDeclarado),
        fonte: 'fallback',
        consultadoEm,
        base_calculo: 'Tabela TJMA 16.3 — registro de desmembramento (acrescentar 16.5 por lote)',
      };
    case 'georreferenciamento':
      return {
        valor: VALOR_AVERBACAO_GEORREF_SIGEF,
        fonte: 'fallback',
        consultadoEm,
        base_calculo: 'Tabela TJMA 16.22.4 — averbacao certificacao SIGEF/INCRA',
      };
    case 'desdobro_unificacao':
      return {
        valor: VALOR_DESDOBRO_UNIFICACAO,
        fonte: 'fallback',
        consultadoEm,
        base_calculo: 'Tabela TJMA 16.22.6 — desdobro/unificacao',
      };
  }
}

export function valorPorLoteAdicional(): number {
  return VALOR_REGISTRO_LOTE_DESM_INCORP;
}
