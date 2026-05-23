/**
 * Tipos do Live Feed Universal
 * ZAYRA v1.99.15 — Romatec
 */

export type LiveFeedTab =
  | 'painel'
  | 'obras'
  | 'folha'
  | 'despesas'
  | 'materiais'
  | 'financeiro'
  | 'clientes'
  | 'colaboradores'
  | 'contratos'
  | 'vales'
  | 'laudos'
  | 'diarias'
  | 'demarcacoes'
  | 'certs';

export type LiveFeedTheme = 'green' | 'gold' | 'orange' | 'red' | 'blue';
export type LiveFeedHighlight = 'green' | 'gold' | 'orange' | 'red' | 'white';

export interface LiveFeedMetric {
  label: string;
  value: string;
  highlight?: LiveFeedHighlight;
}

export interface LiveFeedCard {
  /** Iniciais para o avatar (2 letras) ou emoji */
  avatar: string;
  /** Título principal (ex: nome do funcionário) */
  title: string;
  /** Linha secundária (ex: "Pedreiro · RODO RANCHO") */
  subtitle: string;
  /** Tema de cor do card */
  theme: LiveFeedTheme;
  /** Grid de 3 métricas (label + value + opcional highlight) */
  metrics: LiveFeedMetric[];
  /** ID opcional para clique/navegação */
  id?: number | string;
  /** URL opcional ao clicar */
  href?: string;
}

export interface LiveFeedResponse {
  tab: LiveFeedTab;
  title: string;
  subtitle?: string;
  counterLabel: string;
  counterValue: number;
  theme: LiveFeedTheme;
  cards: LiveFeedCard[];
  /** Filtros aplicados (ex: obra ativa) */
  filters?: Record<string, string | number>;
  /** Timestamp ISO da geração */
  generatedAt: string;
}

export interface LiveFeedFetchOptions {
  obraId?: number;
  ano?: number;
  mes?: number;
  limit?: number;
}
