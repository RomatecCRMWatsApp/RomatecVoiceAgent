// v3.113.0 — Adapter football-data.org (API v4).
//
// Free tier: 10 req/min, cobre Brasileirao Serie A + 11 competicoes principais
// (verificado em 19/07/2026 na pagina de coverage). Auth por header X-Auth-Token.
//
// Cadastro: https://www.football-data.org/client/register
//
// A funcao deste arquivo e' UMA so: transformar o JSON do fornecedor nos tipos de
// ISportsDataProvider. Nenhuma regra de negocio, nenhum calculo — se aparecer
// estatistica sendo computada aqui, esta no lugar errado.

import axios, { AxiosError } from 'axios';
import type {
  Fixture, TeamForm, H2HRecord, JogoDaForma, ISportsDataProvider,
} from '../ISportsDataProvider';

const BASE = 'https://api.football-data.org/v4';
const TIMEOUT_MS = 12000;

/** Codigos das competicoes livres. BSA = Brasileirao Serie A. */
export const LIGAS_FREE = {
  BRASILEIRAO: 'BSA',
  PREMIER_LEAGUE: 'PL',
  LA_LIGA: 'PD',
  SERIE_A_ITALIA: 'SA',
  BUNDESLIGA: 'BL1',
  LIGUE_1: 'FL1',
  CHAMPIONS: 'CL',
} as const;

function chave(): string {
  const k = process.env.FOOTBALL_DATA_API_KEY;
  if (!k) {
    // Erro explicito: sem chave o modulo nao tem dados, e falhar em silencio aqui
    // faria a ZAYRA responder "nenhum jogo hoje" como se fosse um dia vazio.
    throw new Error(
      'FOOTBALL_DATA_API_KEY nao configurada. Cadastre em football-data.org e '
      + 'adicione a variavel no painel do Railway (aba Variables).',
    );
  }
  return k;
}

async function get<T>(caminho: string, params: Record<string, string | number>): Promise<T> {
  try {
    const r = await axios.get<T>(`${BASE}${caminho}`, {
      headers: { 'X-Auth-Token': chave() },
      params,
      timeout: TIMEOUT_MS,
    });
    return r.data;
  } catch (err) {
    const ax = err as AxiosError;
    const status = ax.response?.status;
    // 429 e' o caso mais provavel em producao: free tier sao 10 req/min.
    if (status === 429) {
      throw new Error('football-data.org: limite de requisicoes atingido (10/min no free tier). Tente de novo em 1 minuto.');
    }
    if (status === 403) {
      throw new Error('football-data.org: chave invalida ou competicao fora do plano gratuito.');
    }
    throw new Error(`football-data.org falhou (HTTP ${status ?? '?'}): ${ax.message}`);
  }
}

// ─── Formato cru do fornecedor (so o que usamos) ─────────────────────

interface MatchApi {
  id: number;
  utcDate: string;
  status: string;
  competition?: { id?: number; code?: string; name?: string };
  homeTeam?: { id?: number; name?: string; shortName?: string };
  awayTeam?: { id?: number; name?: string; shortName?: string };
  score?: { fullTime?: { home?: number | null; away?: number | null } };
}

/**
 * O status do football-data tem mais estados que o nosso enum (TIMED, SCHEDULED,
 * IN_PLAY, PAUSED, FINISHED, POSTPONED, SUSPENDED, CANCELLED). Colapsa pros 4 do
 * schema; desconhecido cai em 'agendado' por ser o default menos destrutivo.
 */
export function mapearStatus(status: string): Fixture['status'] {
  switch (status) {
    case 'IN_PLAY': case 'PAUSED': return 'ao_vivo';
    case 'FINISHED': case 'AWARDED': return 'encerrado';
    case 'CANCELLED': case 'POSTPONED': case 'SUSPENDED': return 'cancelado';
    default: return 'agendado';
  }
}

export function normalizarFixture(m: MatchApi): Fixture {
  return {
    provedorEventoId: String(m.id),
    competicao: m.competition?.name ?? '',
    provedorLigaId: m.competition?.code ?? String(m.competition?.id ?? ''),
    timeCasa: m.homeTeam?.name ?? m.homeTeam?.shortName ?? '(desconhecido)',
    timeVisitante: m.awayTeam?.name ?? m.awayTeam?.shortName ?? '(desconhecido)',
    dataHora: m.utcDate,
    status: mapearStatus(m.status),
    placarCasa: m.score?.fullTime?.home ?? null,
    placarVisitante: m.score?.fullTime?.away ?? null,
  };
}

function soData(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── API publica do adapter ──────────────────────────────────────────

/**
 * Jogos de uma liga nos proximos N dias.
 * `league` e' o codigo da competicao (ex.: 'BSA'). Passe '' pra todas as livres —
 * mas cuidado: sem filtro a resposta fica grande e consome cota igual.
 */
export async function getUpcomingFixtures(league: string, days: number): Promise<Fixture[]> {
  const hoje = new Date();
  const ate = new Date(hoje.getTime() + Math.max(0, days) * 86400000);
  const params: Record<string, string | number> = {
    dateFrom: soData(hoje),
    dateTo: soData(ate),
  };
  if (league) params.competitions = league;
  const data = await get<{ matches?: MatchApi[] }>('/matches', params);
  return (data.matches ?? []).map(normalizarFixture);
}

/** Converte a lista de jogos ja encerrados de um time no formato de forma recente. */
export function normalizarForma(
  timeId: string, timeNome: string, partidas: MatchApi[],
): TeamForm {
  // Mais recente primeiro — o campo jogosAtras alimenta o decaimento exponencial.
  const encerradas = partidas
    .filter((m) => mapearStatus(m.status) === 'encerrado')
    .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime());

  const jogos: JogoDaForma[] = [];
  let v = 0, e = 0, d = 0;
  encerradas.forEach((m, i) => {
    const mandante = String(m.homeTeam?.id ?? '') === String(timeId);
    const gc = m.score?.fullTime?.home ?? 0;
    const gv = m.score?.fullTime?.away ?? 0;
    const marcados = mandante ? gc : gv;
    const sofridos = mandante ? gv : gc;
    if (marcados > sofridos) v++; else if (marcados === sofridos) e++; else d++;
    jogos.push({ golsMarcados: marcados, golsSofridos: sofridos, jogosAtras: i, mandante, dataHora: m.utcDate });
  });

  const n = jogos.length || 1;
  return {
    timeNome, provedorTimeId: String(timeId), jogos,
    vitorias: v, empates: e, derrotas: d,
    mediaGolsMarcados: jogos.reduce((s, j) => s + j.golsMarcados, 0) / n,
    mediaGolsSofridos: jogos.reduce((s, j) => s + j.golsSofridos, 0) / n,
  };
}

export async function getTeamForm(teamId: string, lastN: number): Promise<TeamForm> {
  const data = await get<{ matches?: MatchApi[] }>(`/teams/${encodeURIComponent(teamId)}/matches`, {
    status: 'FINISHED',
    limit: Math.max(1, Math.min(lastN, 50)),
  });
  const partidas = data.matches ?? [];
  const primeira = partidas[0];
  const nome = String(primeira?.homeTeam?.id ?? '') === String(teamId)
    ? (primeira?.homeTeam?.name ?? '')
    : (primeira?.awayTeam?.name ?? '');
  return normalizarForma(teamId, nome, partidas);
}

export async function getHeadToHead(
  teamAId: string, teamBId: string, lastN: number,
): Promise<H2HRecord> {
  // A API expoe H2H pendurado num match (/matches/{id}/head2head). Sem um id de
  // partida em maos, a alternativa dentro do free tier e' cruzar o historico do
  // time A procurando o B — custa 1 requisicao em vez de 2.
  const data = await get<{ matches?: MatchApi[] }>(`/teams/${encodeURIComponent(teamAId)}/matches`, {
    status: 'FINISHED', limit: 50,
  });
  const confrontos = (data.matches ?? [])
    .filter((m) => String(m.homeTeam?.id) === String(teamBId) || String(m.awayTeam?.id) === String(teamBId))
    .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime())
    .slice(0, Math.max(1, lastN))
    .map((m) => {
      const aEraMandante = String(m.homeTeam?.id ?? '') === String(teamAId);
      const gc = m.score?.fullTime?.home ?? 0;
      const gv = m.score?.fullTime?.away ?? 0;
      return {
        dataHora: m.utcDate,
        golsA: aEraMandante ? gc : gv,
        golsB: aEraMandante ? gv : gc,
        aEraMandante,
      };
    });
  return { timeA: String(teamAId), timeB: String(teamBId), confrontos };
}

export const footballDataProvider: ISportsDataProvider = {
  getUpcomingFixtures, getTeamForm, getHeadToHead,
};
