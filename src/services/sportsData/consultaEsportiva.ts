// v3.115.0 — Consulta sob demanda: jogos do dia -> probabilidades -> ranking.
//
// DESENHO ESCOLHIDO PELO CEO: sem cron. Nada roda em background; tudo acontece
// quando ele pergunta. Isso obriga a tratar duas coisas com cuidado:
//
//  1. LATENCIA. Calcular probabilidade exige a forma recente de CADA time — uma
//     requisicao por time. 20 jogos = 40 chamadas so de forma, mais odds. Sem
//     cache, a resposta levaria mais de um minuto. Por isso o banco funciona como
//     cache com validade: forma vale 24h, jogos e odds valem 1h.
//
//  2. COTA E VOLUME. O diagnostico real mostrou 1.470 linhas de odds por partida
//     (todos os bookmakers x todos os mercados). Filtramos na origem — so bet365,
//     so os mercados que o motor usa — e limitamos o numero de jogos por consulta.
//
// EFEITO COLATERAL DESEJADO: tudo que e buscado fica gravado. Sem cron, o
// historico pro backtest (compararComMercado) se forma pelo proprio uso, sem
// gastar nenhuma requisicao a mais.

import pool from '../../database/connection';
import type { RowDataPacket } from 'mysql2';
import {
  getFixturesPorData, getTeamForm, getOddsBet365, LIGAS,
} from './adapters/apiSportsAdapter';
import type { Fixture, TeamForm, MarketOdds } from './ISportsDataProvider';
import {
  calcularForcaTime, calcularProbabilidadePartida, probabilidadesImplicitas,
  valorEsperado, METODOLOGIA, DISCLAIMER_OBRIGATORIO,
} from './probabilityEngine';

/** Ligas escolhidas pelo CEO. Ids da API-Sports. */
export const LIGAS_ACOMPANHADAS: number[] = [
  LIGAS.BRASILEIRAO_A, LIGAS.BRASILEIRAO_B, LIGAS.COPA_DO_BRASIL, LIGAS.LIBERTADORES,
  LIGAS.PREMIER_LEAGUE, LIGAS.LA_LIGA, LIGAS.CHAMPIONS,
  135, // Serie A Italia
  78,  // Bundesliga
  61,  // Ligue 1
];

const TTL_FORMA_MS = 24 * 3600_000;
const TTL_ODDS_MS = 3600_000;
/** Teto de jogos por consulta — protege latencia e cota. */
const MAX_JOGOS = 20;
/** Fallback quando nao da pra estimar a media da liga com os dados em maos. */
const MEDIA_GOLS_PADRAO = 1.35;
/** Mando de campo no futebol brasileiro. */
const FATOR_MANDO = 1.25;

// ─── Cache de forma ──────────────────────────────────────────────────

interface ForcaSalva { ataque: number; defesa: number; nome: string; idadeMs: number }

async function lerForcaCache(timeId: string, janela: number): Promise<ForcaSalva | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT time_nome, forca_ataque, forca_defesa,
            TIMESTAMPDIFF(SECOND, atualizado_em, NOW()) * 1000 AS idade_ms
       FROM esportes_estatisticas_time
      WHERE provedor_time_id = ? AND janela_jogos = ?`,
    [timeId, janela],
  );
  if (!rows.length || rows[0].forca_ataque == null) return null;
  return {
    ataque: Number(rows[0].forca_ataque),
    defesa: Number(rows[0].forca_defesa),
    nome: String(rows[0].time_nome ?? ''),
    idadeMs: Number(rows[0].idade_ms ?? 0),
  };
}

async function gravarForca(
  timeId: string, forma: TeamForm, janela: number, ataque: number, defesa: number,
): Promise<void> {
  await pool.execute(
    `INSERT INTO esportes_estatisticas_time
       (provedor_time_id, time_nome, janela_jogos, vitorias, empates, derrotas,
        media_gols_marcados, media_gols_sofridos, forca_ataque, forca_defesa)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       time_nome = VALUES(time_nome), vitorias = VALUES(vitorias),
       empates = VALUES(empates), derrotas = VALUES(derrotas),
       media_gols_marcados = VALUES(media_gols_marcados),
       media_gols_sofridos = VALUES(media_gols_sofridos),
       forca_ataque = VALUES(forca_ataque), forca_defesa = VALUES(forca_defesa),
       atualizado_em = NOW()`,
    [timeId, forma.timeNome, janela, forma.vitorias, forma.empates, forma.derrotas,
     forma.mediaGolsMarcados, forma.mediaGolsSofridos, ataque, defesa],
  );
}

/**
 * Forca de um time, do cache se fresco (24h) ou da API se vencido.
 * Devolve null quando nao ha dado suficiente — o chamador pula o jogo em vez de
 * inventar forca 1.0, que produziria probabilidade de aparencia normal e sem lastro.
 */
async function obterForca(
  timeId: string, mediaGolsLiga: number, janela = 10,
): Promise<{ ataque: number; defesa: number; nome: string } | null> {
  const cache = await lerForcaCache(timeId, janela).catch(() => null);
  if (cache && cache.idadeMs < TTL_FORMA_MS) return cache;
  try {
    const forma = await getTeamForm(timeId, janela);
    if (!forma.jogos.length) return cache ?? null;
    const f = calcularForcaTime(forma.jogos, mediaGolsLiga);
    await gravarForca(timeId, forma, janela, f.ataque, f.defesa).catch(() => {});
    return { ataque: f.ataque, defesa: f.defesa, nome: forma.timeNome };
  } catch {
    // Cota estourada ou API fora: cache velho ainda e melhor que nada.
    return cache ?? null;
  }
}

// ─── Persistencia ────────────────────────────────────────────────────

async function gravarEvento(f: Fixture, casaId?: string, visitanteId?: string): Promise<void> {
  await pool.execute(
    `INSERT INTO esportes_eventos
       (provedor_evento_id, provedor_liga_id, competicao, time_casa, time_visitante,
        time_casa_id, time_visitante_id, data_hora, status, placar_casa, placar_visitante)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status), placar_casa = VALUES(placar_casa),
       placar_visitante = VALUES(placar_visitante), atualizado_em = NOW()`,
    [f.provedorEventoId, f.provedorLigaId, f.competicao, f.timeCasa, f.timeVisitante,
     casaId ?? null, visitanteId ?? null,
     f.dataHora ? f.dataHora.slice(0, 19).replace('T', ' ') : null,
     f.status, f.placarCasa, f.placarVisitante],
  ).catch(() => {});
}

async function gravarOdds(odds: MarketOdds[]): Promise<void> {
  for (const o of odds) {
    await pool.execute(
      `INSERT INTO esportes_odds (provedor_evento_id, casa_aposta, mercado, selecao, odd)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE odd = VALUES(odd), capturado_em = NOW()`,
      [o.provedorEventoId, o.bookmaker, o.mercado, o.selecao, o.odd],
    ).catch(() => {});
  }
}

async function gravarProbabilidades(
  eventoId: string, linhas: Array<{ selecao: string; prob: number; implicita: number | null; odd: number | null; ev: number | null }>,
): Promise<void> {
  for (const l of linhas) {
    await pool.execute(
      `INSERT INTO esportes_probabilidades
         (provedor_evento_id, mercado, selecao, probabilidade_estimada,
          probabilidade_implicita_mercado, odd_referencia, valor_esperado, metodologia)
       VALUES (?, '1x2', ?, ?, ?, ?, ?, ?)`,
      [eventoId, l.selecao, l.prob, l.implicita, l.odd, l.ev, METODOLOGIA],
    ).catch(() => {});
  }
}

// ─── Odds com cache ──────────────────────────────────────────────────

/** Mapeia os rotulos da API-Sports pro vocabulario interno. */
export function mapearSelecao1x2(valor: string): 'casa' | 'empate' | 'visitante' | null {
  const v = valor.trim().toLowerCase();
  if (v === 'home' || v === 'casa' || v === '1') return 'casa';
  if (v === 'draw' || v === 'empate' || v === 'x') return 'empate';
  if (v === 'away' || v === 'visitante' || v === '2') return 'visitante';
  return null;
}

/** Mercado 1x2 na API-Sports chama "Match Winner". */
function ehMercado1x2(nome: string): boolean {
  const n = nome.trim().toLowerCase();
  return n === 'match winner' || n === '1x2' || n === 'fulltime result';
}

async function lerOddsCache(eventoId: string): Promise<Map<string, number> | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT selecao, odd, TIMESTAMPDIFF(SECOND, capturado_em, NOW()) * 1000 AS idade_ms
       FROM esportes_odds
      WHERE provedor_evento_id = ? AND mercado = '1x2'`,
    [eventoId],
  );
  if (!rows.length) return null;
  const maisVelha = Math.max(...rows.map((r) => Number(r.idade_ms ?? 0)));
  if (maisVelha > TTL_ODDS_MS) return null;
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r.selecao), Number(r.odd));
  return m;
}

/** Odds 1x2 do bet365, do cache (1h) ou da API. */
async function obterOdds1x2(eventoId: string): Promise<Map<string, number> | null> {
  const cache = await lerOddsCache(eventoId).catch(() => null);
  if (cache) return cache;
  try {
    const brutas = await getOddsBet365(eventoId);
    const normalizadas: MarketOdds[] = [];
    const m = new Map<string, number>();
    for (const o of brutas) {
      if (!ehMercado1x2(o.mercado)) continue;
      const sel = mapearSelecao1x2(o.selecao);
      if (!sel) continue;
      m.set(sel, o.odd);
      normalizadas.push({ ...o, mercado: '1x2', selecao: sel });
    }
    if (normalizadas.length) await gravarOdds(normalizadas);
    return m.size ? m : null;
  } catch {
    return null;
  }
}

// ─── Consulta principal ──────────────────────────────────────────────

export interface JogoAvaliado {
  eventoId: string;
  competicao: string;
  timeCasa: string;
  timeVisitante: string;
  dataHora: string;
  probCasa: number;
  probEmpate: number;
  probVisitante: number;
  /** Melhor linha por valor esperado, quando ha odds. */
  melhor: null | {
    selecao: 'casa' | 'empate' | 'visitante';
    probabilidadeEstimada: number;
    odd: number;
    probabilidadeImplicita: number;
    valorEsperado: number;
  };
}

export interface ResultadoConsulta {
  data: string;
  jogos: JogoAvaliado[];
  totalJogosNoDia: number;
  jogosAnalisados: number;
  semOdds: number;
  disclaimer: string;
  aviso?: string;
}

/**
 * Fluxo completo de uma pergunta ("quais jogos de hoje...").
 *
 * `ordenarPor` = 'valor' usa o valor esperado (exige odds); 'confianca' usa a
 * maior probabilidade estimada, e funciona mesmo sem odds.
 */
export async function consultarJogosDoDia(opts: {
  data?: string;
  maxJogos?: number;
  ordenarPor?: 'valor' | 'confianca';
} = {}): Promise<ResultadoConsulta> {
  const data = opts.data || new Date().toISOString().slice(0, 10);
  const limite = Math.max(1, Math.min(opts.maxJogos ?? MAX_JOGOS, MAX_JOGOS));
  const ordenarPor = opts.ordenarPor ?? 'valor';

  // 1 requisicao pra todos os jogos do dia; o filtro por liga e' local, pra nao
  // gastar uma chamada por competicao.
  const todos = await getFixturesPorData(data);
  const doInteresse = todos
    .filter((f) => LIGAS_ACOMPANHADAS.includes(Number(f.provedorLigaId)))
    .filter((f) => f.status === 'agendado' || f.status === 'ao_vivo')
    .sort((a, b) => new Date(a.dataHora).getTime() - new Date(b.dataHora).getTime());

  const selecionados = doInteresse.slice(0, limite);
  const avaliados: JogoAvaliado[] = [];
  let semOdds = 0;

  for (const f of selecionados) {
    await gravarEvento(f, f.timeCasaId, f.timeVisitanteId);
    const mediaLiga = MEDIA_GOLS_PADRAO;

    // Forca vem por ID (a API identifica time por id, nao por nome). Cada time
    // custa no maximo 1 requisicao, e so quando o cache de 24h esta vencido.
    const forcaCasa = await obterForca(f.timeCasaId, mediaLiga);
    const forcaVisitante = await obterForca(f.timeVisitanteId, mediaLiga);

    if (!forcaCasa || !forcaVisitante) {
      avaliados.push({
        eventoId: f.provedorEventoId, competicao: f.competicao,
        timeCasa: f.timeCasa, timeVisitante: f.timeVisitante, dataHora: f.dataHora,
        probCasa: NaN, probEmpate: NaN, probVisitante: NaN, melhor: null,
      });
      continue;
    }

    const r = calcularProbabilidadePartida({
      casa: forcaCasa, visitante: forcaVisitante,
      mediaGolsLiga: mediaLiga, fatorMando: FATOR_MANDO,
    });

    const odds = await obterOdds1x2(f.provedorEventoId);
    let melhor: JogoAvaliado['melhor'] = null;
    const linhasParaGravar: Array<{ selecao: string; prob: number; implicita: number | null; odd: number | null; ev: number | null }> = [];

    const selecoes: Array<['casa' | 'empate' | 'visitante', number]> = [
      ['casa', r.probCasa], ['empate', r.probEmpate], ['visitante', r.probVisitante],
    ];

    if (odds && odds.size === 3) {
      const listaOdds = selecoes.map(([s]) => odds.get(s) ?? 0);
      const { probabilidades: implicitas } = probabilidadesImplicitas(listaOdds);
      selecoes.forEach(([sel, prob], i) => {
        const odd = listaOdds[i];
        const ev = valorEsperado(prob, odd);
        linhasParaGravar.push({ selecao: sel, prob, implicita: implicitas[i], odd, ev });
        if (!melhor || ev > melhor.valorEsperado) {
          melhor = { selecao: sel, probabilidadeEstimada: prob, odd,
                     probabilidadeImplicita: implicitas[i], valorEsperado: ev };
        }
      });
    } else {
      semOdds++;
      selecoes.forEach(([sel, prob]) => {
        linhasParaGravar.push({ selecao: sel, prob, implicita: null, odd: null, ev: null });
      });
    }

    await gravarProbabilidades(f.provedorEventoId, linhasParaGravar);
    avaliados.push({
      eventoId: f.provedorEventoId, competicao: f.competicao,
      timeCasa: f.timeCasa, timeVisitante: f.timeVisitante, dataHora: f.dataHora,
      probCasa: r.probCasa, probEmpate: r.probEmpate, probVisitante: r.probVisitante,
      melhor,
    });
  }

  const comModelo = avaliados.filter((j) => Number.isFinite(j.probCasa));
  comModelo.sort((a, b) => {
    if (ordenarPor === 'valor') {
      const va = a.melhor?.valorEsperado ?? -Infinity;
      const vb = b.melhor?.valorEsperado ?? -Infinity;
      if (va !== vb) return vb - va;
    }
    return Math.max(b.probCasa, b.probEmpate, b.probVisitante)
         - Math.max(a.probCasa, a.probEmpate, a.probVisitante);
  });

  const semModelo = avaliados.length - comModelo.length;
  return {
    data,
    jogos: comModelo,
    totalJogosNoDia: todos.length,
    jogosAnalisados: comModelo.length,
    semOdds,
    disclaimer: DISCLAIMER_OBRIGATORIO,
    aviso: semModelo > 0
      ? `${semModelo} jogo(s) ficaram de fora por falta de historico dos times.`
      : undefined,
  };
}

export { obterForca };
