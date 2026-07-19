// v3.114.0 — Adapter API-Sports (v3.football.api-sports.io). PROVEDOR PRIMARIO.
//
// O CEO ja tem plano Pro: 7.500 requisicoes/DIA no futebol. Isso e' ~225k/mes,
// contra as 10 req/min do football-data.org e as ~1.000/mes da odds-api. Com essa
// folga, o cron da spec (secao 6) roda sem chegar perto do limite.
//
// VANTAGEM ESTRUTURAL: esta API entrega fixtures E odds no mesmo lugar, com bet365
// entre os bookmakers. Um provedor, uma chave. O footballDataAdapter continua no
// repo como alternativa, mas nao e' mais o caminho principal.
//
// ATENCAO — FORMATO NAO VERIFICADO AO VIVO:
// a documentacao da API-Sports bloqueia acesso automatizado (HTTP 403), entao o
// mapeamento abaixo foi escrito a partir do contrato v3 conhecido, NAO de uma
// chamada real. Todos os normalizadores estao exportados e isolados justamente
// pra correcao rapida no primeiro teste com a chave. Use `diagnosticarConexao()`
// pra validar tudo de uma vez antes de plugar no job.

import axios, { AxiosError } from 'axios';
import type {
  Fixture, TeamForm, H2HRecord, JogoDaForma, MarketOdds,
  ISportsDataProvider, IOddsProvider,
} from '../ISportsDataProvider';

const BASE = 'https://v3.football.api-sports.io';
const TIMEOUT_MS = 12000;

/** Ids de liga na API-Sports. 71 = Brasileirao Serie A. */
export const LIGAS = {
  BRASILEIRAO_A: 71,
  BRASILEIRAO_B: 72,
  COPA_DO_BRASIL: 73,
  LIBERTADORES: 13,
  PREMIER_LEAGUE: 39,
  LA_LIGA: 140,
  CHAMPIONS: 2,
} as const;

/** Bookmaker bet365 na API-Sports. Confirmar em /odds/bookmakers no primeiro uso. */
export const BOOKMAKER_BET365 = 8;

let avisouNomeVariavel = false;

/**
 * Le a chave da API-Sports.
 *
 * O fallback pra FOOTBALL_DATA_API_KEY existe por um motivo concreto: a chave da
 * API-Sports foi cadastrada no Railway sob esse nome, que na verdade pertence ao
 * football-data.org — outro fornecedor, outra URL, outro header. Aceitar as duas
 * grafias evita que a integracao morra por causa do nome, mas avisa alto, porque
 * a confusao volta a morder no dia em que alguem cadastrar uma chave de
 * football-data.org de verdade e este adapter a usar contra a API-Sports.
 */
function chave(): string {
  const correta = process.env.API_SPORTS_KEY;
  if (correta) return correta;

  const legada = process.env.FOOTBALL_DATA_API_KEY;
  if (legada) {
    if (!avisouNomeVariavel) {
      avisouNomeVariavel = true;
      console.warn(
        '[api-sports] usando FOOTBALL_DATA_API_KEY como chave da API-Sports. '
        + 'Esse nome pertence ao football-data.org (outro fornecedor). '
        + 'Renomeie a variavel pra API_SPORTS_KEY no Railway pra evitar confusao futura.',
      );
    }
    return legada;
  }
  throw new Error(
    'API_SPORTS_KEY nao configurada. Pegue em api-sports.io (Meu acesso > Chave da API) '
    + 'e adicione no painel do Railway, aba Variables.',
  );
}

/** Envelope padrao da API-Sports: erros vem em 200 com `errors` preenchido. */
interface EnvelopeApiSports<T> {
  results?: number;
  errors?: unknown;
  response?: T[];
}

function temErro(errors: unknown): string | null {
  if (!errors) return null;
  // A API devolve [] quando esta tudo bem, e objeto/array com mensagens quando nao.
  if (Array.isArray(errors)) return errors.length ? JSON.stringify(errors) : null;
  if (typeof errors === 'object') {
    const vals = Object.values(errors as Record<string, unknown>).filter(Boolean);
    return vals.length ? vals.join(' | ') : null;
  }
  return String(errors);
}

async function get<T>(caminho: string, params: Record<string, string | number>): Promise<T[]> {
  try {
    const r = await axios.get<EnvelopeApiSports<T>>(`${BASE}${caminho}`, {
      headers: { 'x-apisports-key': chave() },
      params,
      timeout: TIMEOUT_MS,
    });
    // Armadilha desta API: cota estourada e parametro invalido voltam com HTTP 200
    // e a mensagem dentro de `errors`. Sem esta checagem, o job trataria como
    // "nenhum jogo hoje" e ninguem descobriria que a integracao parou.
    const erro = temErro(r.data?.errors);
    if (erro) throw new Error(`API-Sports recusou a chamada: ${erro}`);
    return r.data?.response ?? [];
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('API-Sports recusou')) throw err;
    const ax = err as AxiosError;
    const status = ax.response?.status;
    if (status === 401 || status === 403) throw new Error('API-Sports: chave invalida ou plano sem acesso a este endpoint.');
    if (status === 429) throw new Error('API-Sports: limite diario atingido (7.500/dia no plano Pro).');
    throw new Error(`API-Sports falhou (HTTP ${status ?? '?'}): ${ax.message}`);
  }
}

// ─── Formato cru (so o que usamos) ───────────────────────────────────

interface FixtureApi {
  fixture?: { id?: number; date?: string; status?: { short?: string } };
  league?: { id?: number; name?: string };
  teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } };
  goals?: { home?: number | null; away?: number | null };
}

/**
 * Colapsa os codigos curtos da API-Sports nos 4 estados do schema.
 * NS/TBD agendado · 1H,HT,2H,ET,P,LIVE ao vivo · FT,AET,PEN encerrado ·
 * PST,CANC,ABD,SUSP,INT cancelado.
 */
export function mapearStatusApiSports(short: string): Fixture['status'] {
  const s = (short || '').toUpperCase();
  if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(s)) return 'ao_vivo';
  if (['FT', 'AET', 'PEN', 'WO'].includes(s)) return 'encerrado';
  if (['PST', 'CANC', 'ABD', 'SUSP', 'AWD'].includes(s)) return 'cancelado';
  return 'agendado';
}

export function normalizarFixtureApiSports(f: FixtureApi): Fixture {
  return {
    provedorEventoId: String(f.fixture?.id ?? ''),
    competicao: f.league?.name ?? '',
    provedorLigaId: String(f.league?.id ?? ''),
    timeCasa: f.teams?.home?.name ?? '(desconhecido)',
    timeVisitante: f.teams?.away?.name ?? '(desconhecido)',
    dataHora: f.fixture?.date ?? '',
    status: mapearStatusApiSports(f.fixture?.status?.short ?? ''),
    placarCasa: f.goals?.home ?? null,
    placarVisitante: f.goals?.away ?? null,
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────

function soData(d: Date): string { return d.toISOString().slice(0, 10); }

/**
 * Jogos dos proximos N dias. `league` aceita o id numerico (ex.: 71) ou ''.
 *
 * A API exige `season` quando se filtra por liga. Usamos o ano corrente; no
 * Brasileirao a temporada bate com o ano civil, mas em ligas europeias (que
 * viram o ano) isso precisa de ajuste — ver parametro `season`.
 */
export async function getUpcomingFixtures(
  league: string, days: number, season?: number,
): Promise<Fixture[]> {
  const hoje = new Date();
  const params: Record<string, string | number> = {
    from: soData(hoje),
    to: soData(new Date(hoje.getTime() + Math.max(0, days) * 86400000)),
    timezone: 'America/Sao_Paulo',
  };
  if (league) {
    params.league = league;
    params.season = season ?? hoje.getUTCFullYear();
  }
  const bruto = await get<FixtureApi>('/fixtures', params);
  return bruto.map(normalizarFixtureApiSports);
}

/** Jogos de uma data especifica (usado pelo tool: "jogos de hoje"). */
export async function getFixturesPorData(
  data: string, league?: string, season?: number,
): Promise<Fixture[]> {
  const params: Record<string, string | number> = { date: data, timezone: 'America/Sao_Paulo' };
  if (league) {
    params.league = league;
    params.season = season ?? new Date(data).getUTCFullYear();
  }
  const bruto = await get<FixtureApi>('/fixtures', params);
  return bruto.map(normalizarFixtureApiSports);
}

// ─── Forma recente ───────────────────────────────────────────────────

export function normalizarFormaApiSports(
  timeId: string, partidas: FixtureApi[],
): TeamForm {
  const encerradas = partidas
    .filter((m) => mapearStatusApiSports(m.fixture?.status?.short ?? '') === 'encerrado')
    .sort((a, b) => new Date(b.fixture?.date ?? 0).getTime() - new Date(a.fixture?.date ?? 0).getTime());

  const jogos: JogoDaForma[] = [];
  let v = 0, e = 0, d = 0;
  let nome = '';
  encerradas.forEach((m, i) => {
    const mandante = String(m.teams?.home?.id ?? '') === String(timeId);
    if (!nome) nome = (mandante ? m.teams?.home?.name : m.teams?.away?.name) ?? '';
    const gc = m.goals?.home ?? 0;
    const gv = m.goals?.away ?? 0;
    const marcados = mandante ? gc : gv;
    const sofridos = mandante ? gv : gc;
    if (marcados > sofridos) v++; else if (marcados === sofridos) e++; else d++;
    jogos.push({
      golsMarcados: marcados, golsSofridos: sofridos, jogosAtras: i,
      mandante, dataHora: m.fixture?.date ?? '',
    });
  });

  const n = jogos.length || 1;
  return {
    timeNome: nome, provedorTimeId: String(timeId), jogos,
    vitorias: v, empates: e, derrotas: d,
    mediaGolsMarcados: jogos.reduce((s, j) => s + j.golsMarcados, 0) / n,
    mediaGolsSofridos: jogos.reduce((s, j) => s + j.golsSofridos, 0) / n,
  };
}

export async function getTeamForm(teamId: string, lastN: number): Promise<TeamForm> {
  const bruto = await get<FixtureApi>('/fixtures', {
    team: teamId,
    last: Math.max(1, Math.min(lastN, 50)),
  });
  return normalizarFormaApiSports(teamId, bruto);
}

export async function getHeadToHead(
  teamAId: string, teamBId: string, lastN: number,
): Promise<H2HRecord> {
  const bruto = await get<FixtureApi>('/fixtures/headtohead', {
    h2h: `${teamAId}-${teamBId}`,
    last: Math.max(1, Math.min(lastN, 50)),
  });
  const confrontos = bruto
    .filter((m) => mapearStatusApiSports(m.fixture?.status?.short ?? '') === 'encerrado')
    .sort((a, b) => new Date(b.fixture?.date ?? 0).getTime() - new Date(a.fixture?.date ?? 0).getTime())
    .map((m) => {
      const aEraMandante = String(m.teams?.home?.id ?? '') === String(teamAId);
      const gc = m.goals?.home ?? 0;
      const gv = m.goals?.away ?? 0;
      return {
        dataHora: m.fixture?.date ?? '',
        golsA: aEraMandante ? gc : gv,
        golsB: aEraMandante ? gv : gc,
        aEraMandante,
      };
    });
  return { timeA: String(teamAId), timeB: String(teamBId), confrontos };
}

// ─── Odds ────────────────────────────────────────────────────────────

interface OddsApi {
  fixture?: { id?: number };
  update?: string;
  bookmakers?: Array<{
    id?: number; name?: string;
    bets?: Array<{ id?: number; name?: string; values?: Array<{ value?: string; odd?: string }> }>;
  }>;
}

/**
 * Normaliza /odds. A API aninha bookmakers > bets (mercados) > values (selecoes),
 * com a odd vindo como STRING — dai o Number() e o descarte de <= 1.
 */
export function normalizarOddsApiSports(bruto: OddsApi[]): MarketOdds[] {
  const saida: MarketOdds[] = [];
  for (const item of bruto) {
    const eventoId = String(item.fixture?.id ?? '');
    const quando = item.update || new Date().toISOString();
    for (const bk of item.bookmakers ?? []) {
      const casa = bk.name ?? String(bk.id ?? 'desconhecido');
      for (const bet of bk.bets ?? []) {
        const mercado = bet.name ?? String(bet.id ?? '');
        for (const val of bet.values ?? []) {
          const odd = Number(val.odd);
          if (!Number.isFinite(odd) || odd <= 1) continue;
          saida.push({
            provedorEventoId: eventoId, bookmaker: casa, mercado,
            selecao: val.value ?? '', odd, capturadoEm: quando,
          });
        }
      }
    }
  }
  return saida;
}

export async function getOdds(fixtureId: string, bookmakerId?: number): Promise<MarketOdds[]> {
  const params: Record<string, string | number> = { fixture: fixtureId };
  if (bookmakerId != null) params.bookmaker = bookmakerId;
  return normalizarOddsApiSports(await get<OddsApi>('/odds', params));
}

/** Atalho da secao 2.1 da spec: odds do bet365 pra uma partida. */
export async function getOddsBet365(fixtureId: string): Promise<MarketOdds[]> {
  return getOdds(fixtureId, BOOKMAKER_BET365);
}

// ─── Diagnostico ─────────────────────────────────────────────────────

/**
 * Valida chave, cota e formato numa tacada — rode ANTES de plugar o job.
 * Gasta 2 requisicoes das 7.500 diarias.
 */
export async function diagnosticarConexao(): Promise<{
  ok: boolean;
  chaveConfigurada: boolean;
  jogosEncontrados: number;
  oddsDisponiveis: boolean | 'nao_testado';
  detalhe: string;
}> {
  const base = { chaveConfigurada: !!(process.env.API_SPORTS_KEY || process.env.FOOTBALL_DATA_API_KEY) };
  if (!base.chaveConfigurada) {
    return { ...base, ok: false, jogosEncontrados: 0, oddsDisponiveis: 'nao_testado',
             detalhe: 'API_SPORTS_KEY ausente nas variaveis de ambiente.' };
  }
  try {
    const jogos = await getFixturesPorData(new Date().toISOString().slice(0, 10));
    let oddsDisponiveis: boolean | 'nao_testado' = 'nao_testado';
    let detalhe = `${jogos.length} jogo(s) encontrados hoje.`;
    if (jogos.length) {
      try {
        const odds = await getOdds(jogos[0].provedorEventoId);
        oddsDisponiveis = odds.length > 0;
        detalhe += odds.length
          ? ` Odds OK (${odds.length} linhas na primeira partida).`
          : ' Endpoint de odds respondeu vazio — pode ser plano sem odds ou jogo sem mercado aberto.';
      } catch (e) {
        oddsDisponiveis = false;
        detalhe += ` Odds indisponiveis: ${(e as Error).message}`;
      }
    }
    return { ...base, ok: true, jogosEncontrados: jogos.length, oddsDisponiveis, detalhe };
  } catch (err) {
    return { ...base, ok: false, jogosEncontrados: 0, oddsDisponiveis: 'nao_testado',
             detalhe: (err as Error).message };
  }
}

export const apiSportsProvider: ISportsDataProvider = {
  getUpcomingFixtures: (league, days) => getUpcomingFixtures(league, days),
  getTeamForm, getHeadToHead,
};

export const apiSportsOddsProvider: IOddsProvider = { getOdds: (id) => getOdds(id) };
