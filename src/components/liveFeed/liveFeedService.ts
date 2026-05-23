/**
 * Live Feed Universal — Service
 * ZAYRA v1.99.15 — Romatec
 */

import type { Pool } from 'mysql2/promise';
import * as Q from './liveFeedQueries';
import type {
  LiveFeedCard,
  LiveFeedFetchOptions,
  LiveFeedResponse,
  LiveFeedTab,
  LiveFeedTheme,
} from './liveFeedTypes';

const MES_NOMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
] as const;

function mesNome(mes: number): string {
  return MES_NOMES[mes - 1] ?? '';
}

interface TabConfig {
  title: string | ((opts: LiveFeedFetchOptions) => string);
  counterLabel: string;
  theme: LiveFeedTheme;
  fetcher: (pool: Pool, opts: LiveFeedFetchOptions) => Promise<LiveFeedCard[]>;
  requires?: Array<keyof LiveFeedFetchOptions>;
}

const TABS: Record<LiveFeedTab, TabConfig> = {
  painel: {
    title: 'Obras em Andamento',
    counterLabel: 'OBRAS',
    theme: 'green',
    fetcher: (pool) => Q.queryPainel(pool),
  },
  obras: {
    title: 'Obras Cadastradas',
    counterLabel: 'OBRAS',
    theme: 'gold',
    fetcher: (pool) => Q.queryObras(pool),
  },
  folha: {
    title: (opts) =>
      `Folha Mensal · ${mesNome(opts.mes ?? new Date().getMonth() + 1)}/${opts.ano ?? new Date().getFullYear()}`,
    counterLabel: 'FUNCIONÁRIOS',
    theme: 'orange',
    requires: ['obraId'],
    fetcher: (pool, opts) => {
      const now = new Date();
      return Q.queryFolhaMensal(
        pool,
        opts.obraId!,
        opts.ano ?? now.getFullYear(),
        opts.mes ?? now.getMonth() + 1,
      );
    },
  },
  despesas: {
    title: 'Despesas Extras',
    counterLabel: 'LANÇAMENTOS',
    theme: 'red',
    fetcher: (pool, opts) => Q.queryDespesas(pool, opts.obraId),
  },
  materiais: {
    title: 'Materiais Cadastrados',
    counterLabel: 'ITENS',
    theme: 'gold',
    fetcher: (pool, opts) => Q.queryMateriais(pool, opts.obraId),
  },
  financeiro: {
    title: 'Lançamentos Financeiros',
    counterLabel: 'MOVIMENTOS',
    theme: 'green',
    fetcher: (pool, opts) => Q.queryFinanceiro(pool, opts.obraId),
  },
  clientes: {
    title: 'Clientes',
    counterLabel: 'CLIENTES',
    theme: 'green',
    fetcher: (pool) => Q.queryClientes(pool),
  },
  colaboradores: {
    title: 'Equipe',
    counterLabel: 'COLABORADORES',
    theme: 'green',
    fetcher: (pool) => Q.queryColaboradores(pool),
  },
  contratos: {
    title: 'Contratos / Propostas',
    counterLabel: 'CONTRATOS',
    theme: 'gold',
    fetcher: (pool) => Q.queryContratos(pool),
  },
  vales: {
    title: 'Vales / Recibos',
    counterLabel: 'VALES',
    theme: 'orange',
    fetcher: (pool) => Q.queryVales(pool),
  },
  laudos: {
    title: 'Laudos Técnicos',
    counterLabel: 'LAUDOS',
    theme: 'gold',
    fetcher: (pool) => Q.queryLaudos(pool),
  },
  diarias: {
    title: 'Diárias Lançadas',
    counterLabel: 'DIÁRIAS',
    theme: 'green',
    fetcher: (pool, opts) => Q.queryDiarias(pool, opts.obraId),
  },
  demarcacoes: {
    title: 'Demarcações',
    counterLabel: 'DEMARCAÇÕES',
    theme: 'gold',
    fetcher: (pool) => Q.queryDemarcacoes(pool),
  },
  certs: {
    title: 'Certificações Técnicas',
    counterLabel: 'RESPONSÁVEIS',
    theme: 'green',
    fetcher: (pool) => Q.queryCerts(pool),
  },
};

export class LiveFeedService {
  constructor(private pool: Pool) {}

  async fetch(tab: LiveFeedTab, opts: LiveFeedFetchOptions = {}): Promise<LiveFeedResponse> {
    const config = TABS[tab];
    if (!config) {
      throw new Error(`Aba desconhecida: ${tab}`);
    }

    for (const required of config.requires ?? []) {
      if (opts[required] == null) {
        throw new Error(`Parâmetro obrigatório ausente: ${required}`);
      }
    }

    let cards = await config.fetcher(this.pool, opts);

    if (opts.limit && opts.limit > 0) {
      cards = cards.slice(0, opts.limit);
    }

    const title = typeof config.title === 'function' ? config.title(opts) : config.title;

    const filters: Record<string, string | number> = {};
    if (opts.obraId != null) filters.obraId = opts.obraId;
    if (opts.ano != null) filters.ano = opts.ano;
    if (opts.mes != null) filters.mes = opts.mes;
    if (opts.limit != null) filters.limit = opts.limit;

    return {
      tab,
      title,
      counterLabel: config.counterLabel,
      counterValue: cards.length,
      theme: config.theme,
      cards,
      filters,
      generatedAt: new Date().toISOString(),
    };
  }
}
