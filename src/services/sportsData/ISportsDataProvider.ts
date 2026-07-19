// v3.113.0 — Contratos dos provedores externos (spec, secao 2).
//
// A razao de existir desta camada: os provedores gratuitos tem limite de cota e
// cobertura instaveis, e trocar de fornecedor e' questao de tempo. Todo o resto do
// modulo (motor Poisson, Elo, ensemble, avaliacao) fala com ESTES tipos, nunca com
// o JSON cru do fornecedor. Trocar de provedor vira escrever um adapter novo.

/** Partida agendada ou ja encerrada, normalizada. */
export interface Fixture {
  /** Id do evento NO PROVEDOR — chave de deduplicacao do job (spec, secao 6). */
  provedorEventoId: string;
  competicao: string;
  /** Id da competicao no provedor, pra filtrar por liga. */
  provedorLigaId: string;
  timeCasa: string;
  timeVisitante: string;
  /** ISO 8601 em UTC. */
  dataHora: string;
  status: 'agendado' | 'ao_vivo' | 'encerrado' | 'cancelado';
  placarCasa: number | null;
  placarVisitante: number | null;
}

/** Um jogo dentro do historico de um time, do ponto de vista DELE. */
export interface JogoDaForma {
  golsMarcados: number;
  golsSofridos: number;
  /** 0 = jogo mais recente. Alimenta o decaimento em calcularForcaTime. */
  jogosAtras: number;
  mandante: boolean;
  dataHora: string;
}

export interface TeamForm {
  timeNome: string;
  provedorTimeId: string;
  jogos: JogoDaForma[];
  vitorias: number;
  empates: number;
  derrotas: number;
  mediaGolsMarcados: number;
  mediaGolsSofridos: number;
}

export interface H2HRecord {
  timeA: string;
  timeB: string;
  /** Confrontos do mais recente pro mais antigo. */
  confrontos: Array<{
    dataHora: string;
    golsA: number;
    golsB: number;
    /** true se A jogou em casa naquele confronto. */
    aEraMandante: boolean;
  }>;
}

export interface MarketOdds {
  provedorEventoId: string;
  bookmaker: string;
  /** '1x2' | 'over_under' | 'ambas_marcam' — string livre pra nao travar em mercados novos. */
  mercado: string;
  selecao: string;
  /** Odd decimal (2.10), nunca fracionaria nem americana. */
  odd: number;
  capturadoEm: string;
}

export interface ISportsDataProvider {
  getUpcomingFixtures(league: string, days: number): Promise<Fixture[]>;
  getTeamForm(teamId: string, lastN: number): Promise<TeamForm>;
  getHeadToHead(teamAId: string, teamBId: string, lastN: number): Promise<H2HRecord>;
}

export interface IOddsProvider {
  getOdds(fixtureId: string): Promise<MarketOdds[]>;
}
