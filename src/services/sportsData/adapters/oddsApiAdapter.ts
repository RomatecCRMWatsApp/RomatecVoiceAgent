// v3.113.0 — Adapter odds-api.net (v1), fonte de odds incluindo bet365.
//
// AVISO SOBRE O MAPEAMENTO: o formato exato da resposta desta API NAO foi
// validado contra uma chamada real — nao ha chave cadastrada ainda. O parser
// abaixo e' deliberadamente TOLERANTE (aceita varios nomes de campo e formatos
// de mercado) e `normalizarOdds` esta isolada e exportada justamente pra ser
// corrigida rapido no primeiro teste com chave de verdade. Se a resposta vier
// diferente, ajusta-se ESTA funcao e nada mais.
//
// Cadastro: https://odds-api.net — tier Sandbox gratuito.
//
// COTA: o free tier da ~1.000 requisicoes por MES (~33/dia). O cron de 30 em 30
// minutos previsto na spec faria ~1.440/mes e queimaria a cota antes do fim do
// mes. Por isso este adapter tem throttle proprio (ODDS_API_MIN_INTERVALO_MS,
// default 1h) que RECUSA a chamada em vez de gastar credito.

import axios, { AxiosError } from 'axios';
import type { MarketOdds, IOddsProvider } from '../ISportsDataProvider';

const BASE = 'https://api.odds-api.net/v1';
const TIMEOUT_MS = 12000;
const INTERVALO_PADRAO_MS = 3600000; // 1h -> ~720 req/mes, cabe no free tier

function chave(): string {
  const k = process.env.ODDS_API_KEY;
  if (!k) {
    throw new Error(
      'ODDS_API_KEY nao configurada. Cadastre em odds-api.net e adicione a '
      + 'variavel no painel do Railway (aba Variables).',
    );
  }
  return k;
}

function intervaloMinimo(): number {
  const v = Number(process.env.ODDS_API_MIN_INTERVALO_MS);
  return Number.isFinite(v) && v >= 0 ? v : INTERVALO_PADRAO_MS;
}

// Throttle em memoria. Some quando o processo reinicia — aceitavel: o pior caso
// e' uma chamada extra por deploy, nao um vazamento de cota.
let ultimaChamadaMs = 0;

/** Exportado pra teste: zera o throttle. */
export function resetarThrottleOdds(): void {
  ultimaChamadaMs = 0;
}

export function podeChamarAgora(agoraMs: number): boolean {
  return agoraMs - ultimaChamadaMs >= intervaloMinimo();
}

// ─── Normalizacao ────────────────────────────────────────────────────

/** Formato cru esperado — campos opcionais porque o contrato nao foi verificado. */
interface OddsApiRespostaCrua {
  events?: unknown[];
  data?: unknown[];
  bookmakers?: unknown[];
  [k: string]: unknown;
}

function comoNumero(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (typeof v === 'number' ? v : NaN);
  // Odd decimal valida e' sempre > 1. Odd 1.00 nao paga nada e normalmente indica
  // campo errado (ex.: peguei probabilidade em vez de odd).
  return Number.isFinite(n) && n > 1 ? n : null;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Achata a resposta em MarketOdds[]. Tolerante de proposito: varre as formas
 * mais comuns (lista na raiz, em .data, em .events, bookmakers aninhados com
 * markets/outcomes) e ignora o que nao reconhece, em vez de estourar.
 *
 * Se vier vazio com resposta nao-vazia, e' sinal de que o formato real difere —
 * o teste 8 cobre esse caso pra falhar visivelmente em vez de silenciosamente.
 */
export function normalizarOdds(
  bruto: OddsApiRespostaCrua | unknown[], provedorEventoId: string, capturadoEm = '',
): MarketOdds[] {
  const saida: MarketOdds[] = [];
  const quando = capturadoEm || new Date().toISOString();

  const visitarOutcome = (bookmaker: string, mercado: string, o: Record<string, unknown>) => {
    const odd = comoNumero(o.price ?? o.odd ?? o.odds ?? o.value);
    const selecao = texto(o.name ?? o.selection ?? o.outcome ?? o.label);
    if (odd != null && selecao) {
      saida.push({ provedorEventoId, bookmaker, mercado, selecao, odd, capturadoEm: quando });
    }
  };

  const visitarBookmaker = (b: Record<string, unknown>) => {
    const nome = texto(b.key ?? b.name ?? b.bookmaker ?? b.title) || 'desconhecido';
    const markets = (b.markets ?? b.bets ?? b.odds) as unknown;
    if (Array.isArray(markets)) {
      for (const m of markets) {
        if (!m || typeof m !== 'object') continue;
        const mm = m as Record<string, unknown>;
        const mercado = texto(mm.key ?? mm.name ?? mm.market) || '1x2';
        const outcomes = (mm.outcomes ?? mm.selections ?? mm.values) as unknown;
        if (Array.isArray(outcomes)) {
          for (const o of outcomes) {
            if (o && typeof o === 'object') visitarOutcome(nome, mercado, o as Record<string, unknown>);
          }
        }
      }
    }
  };

  const raizes: unknown[] = Array.isArray(bruto)
    ? bruto
    : [...(bruto.events ?? []), ...(bruto.data ?? []), ...(bruto.bookmakers ?? [])];

  for (const item of raizes) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (Array.isArray(obj.bookmakers)) {
      for (const b of obj.bookmakers) {
        if (b && typeof b === 'object') visitarBookmaker(b as Record<string, unknown>);
      }
    } else {
      visitarBookmaker(obj);
    }
  }
  return saida;
}

// ─── API publica ─────────────────────────────────────────────────────

export async function getOdds(fixtureId: string, sport = 'soccer'): Promise<MarketOdds[]> {
  const agora = Date.now();
  if (!podeChamarAgora(agora)) {
    const faltam = Math.ceil((intervaloMinimo() - (agora - ultimaChamadaMs)) / 60000);
    throw new Error(
      `odds-api: throttle ativo pra proteger a cota do free tier (~1.000 req/mes). `
      + `Proxima chamada liberada em ~${faltam} min. Ajuste ODDS_API_MIN_INTERVALO_MS se tiver plano pago.`,
    );
  }
  try {
    const r = await axios.get(`${BASE}/odds`, {
      headers: { 'X-API-Key': chave() },
      params: { sport, eventId: fixtureId },
      timeout: TIMEOUT_MS,
    });
    ultimaChamadaMs = agora;
    return normalizarOdds(r.data, fixtureId);
  } catch (err) {
    const ax = err as AxiosError;
    const status = ax.response?.status;
    if (status === 401 || status === 403) throw new Error('odds-api: chave invalida ou sem permissao.');
    if (status === 429) throw new Error('odds-api: cota esgotada no free tier (~1.000/mes).');
    throw new Error(`odds-api falhou (HTTP ${status ?? '?'}): ${ax.message}`);
  }
}

/**
 * Filtro por casa de aposta, conforme a secao 2.1 da spec.
 * Comparacao case-insensitive: provedores variam entre 'bet365' e 'Bet365'.
 */
export function filtrarPorBookmaker(odds: MarketOdds[], bookmaker: string): MarketOdds[] {
  const alvo = bookmaker.trim().toLowerCase();
  return odds.filter((o) => o.bookmaker.trim().toLowerCase() === alvo);
}

export async function getOddsBet365(fixtureId: string): Promise<MarketOdds[]> {
  return filtrarPorBookmaker(await getOdds(fixtureId), 'bet365');
}

export const oddsApiProvider: IOddsProvider = { getOdds: (id) => getOdds(id) };
