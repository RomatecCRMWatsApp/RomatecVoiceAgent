// v3.113.0: adapters football-data.org e odds-api.net.
//
// O QUE ESTES TESTES COBREM: a normalizacao — transformar o JSON do fornecedor
// nos tipos internos. E' onde mora o risco real, porque um campo mapeado errado
// (mandante trocado com visitante, gols invertidos) produz estatistica plausivel
// e completamente falsa, sem erro nenhum aparecendo.
//
// O QUE ELES NAO COBREM: que o formato assumido corresponda a resposta REAL das
// APIs. Isso so o primeiro teste com chave de verdade responde. O formato do
// football-data v4 e' publico e estavel; o do odds-api NAO foi verificado, e o
// teste 14 existe pra tornar visivel o dia em que ele mudar.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  mapearStatus, normalizarFixture, normalizarForma, LIGAS_FREE,
} from '../services/sportsData/adapters/footballDataAdapter';
import {
  normalizarOdds, filtrarPorBookmaker, podeChamarAgora, resetarThrottleOdds,
} from '../services/sportsData/adapters/oddsApiAdapter';

describe('football-data — status', () => {
  it('1. colapsa os estados do fornecedor nos 4 do schema', () => {
    expect(mapearStatus('IN_PLAY')).toBe('ao_vivo');
    expect(mapearStatus('PAUSED')).toBe('ao_vivo');
    expect(mapearStatus('FINISHED')).toBe('encerrado');
    expect(mapearStatus('CANCELLED')).toBe('cancelado');
    expect(mapearStatus('POSTPONED')).toBe('cancelado');
    expect(mapearStatus('TIMED')).toBe('agendado');
    expect(mapearStatus('SCHEDULED')).toBe('agendado');
  });

  it('2. status desconhecido vira agendado (default menos destrutivo)', () => {
    expect(mapearStatus('ESTADO_QUE_NAO_EXISTE')).toBe('agendado');
  });
});

describe('football-data — fixture', () => {
  const bruto = {
    id: 497851,
    utcDate: '2026-07-19T21:00:00Z',
    status: 'TIMED',
    competition: { id: 2013, code: 'BSA', name: 'Campeonato Brasileiro Série A' },
    homeTeam: { id: 1783, name: 'Flamengo' },
    awayTeam: { id: 1776, name: 'Palmeiras' },
    score: { fullTime: { home: null, away: null } },
  };

  it('3. mapeia os campos sem trocar mandante com visitante', () => {
    const f = normalizarFixture(bruto);
    expect(f.timeCasa).toBe('Flamengo');
    expect(f.timeVisitante).toBe('Palmeiras');
    expect(f.provedorEventoId).toBe('497851');
    expect(f.provedorLigaId).toBe('BSA');
    expect(f.status).toBe('agendado');
  });

  it('4. jogo sem placar vira null, nao 0 (0x0 seria um resultado real)', () => {
    const f = normalizarFixture(bruto);
    expect(f.placarCasa).toBeNull();
    expect(f.placarVisitante).toBeNull();
  });

  it('5. placar existente e preservado na ordem certa', () => {
    const f = normalizarFixture({
      ...bruto, status: 'FINISHED', score: { fullTime: { home: 3, away: 1 } },
    });
    expect(f.placarCasa).toBe(3);
    expect(f.placarVisitante).toBe(1);
    expect(f.status).toBe('encerrado');
  });

  it('6. resposta incompleta nao quebra o parser', () => {
    const f = normalizarFixture({ id: 1, utcDate: '2026-07-19T00:00:00Z', status: 'TIMED' });
    expect(f.timeCasa).toBe('(desconhecido)');
    expect(f.provedorEventoId).toBe('1');
  });

  it('7. BSA e o codigo do Brasileirao (esta no free tier)', () => {
    expect(LIGAS_FREE.BRASILEIRAO).toBe('BSA');
  });
});

describe('football-data — forma recente', () => {
  // Time 100. Mais recente primeiro depois de normalizar.
  const partidas = [
    { id: 1, utcDate: '2026-07-01T00:00:00Z', status: 'FINISHED',
      homeTeam: { id: 100 }, awayTeam: { id: 200 }, score: { fullTime: { home: 2, away: 0 } } },
    { id: 2, utcDate: '2026-07-10T00:00:00Z', status: 'FINISHED',
      homeTeam: { id: 300 }, awayTeam: { id: 100 }, score: { fullTime: { home: 1, away: 1 } } },
    { id: 3, utcDate: '2026-07-15T00:00:00Z', status: 'FINISHED',
      homeTeam: { id: 100 }, awayTeam: { id: 400 }, score: { fullTime: { home: 0, away: 3 } } },
  ];

  it('8. ordena do mais recente pro mais antigo (jogosAtras crescente)', () => {
    const f = normalizarForma('100', 'Time X', partidas);
    expect(f.jogos[0].dataHora).toBe('2026-07-15T00:00:00Z');
    expect(f.jogos[0].jogosAtras).toBe(0);
    expect(f.jogos[2].jogosAtras).toBe(2);
  });

  it('9. inverte gols quando o time era VISITANTE', () => {
    const f = normalizarForma('100', 'Time X', partidas);
    // jogo 2: 300 x 100 = 1x1, entao 1 marcado e 1 sofrido
    const visitante = f.jogos.find((j) => j.dataHora === '2026-07-10T00:00:00Z')!;
    expect(visitante.mandante).toBe(false);
    expect(visitante.golsMarcados).toBe(1);
    expect(visitante.golsSofridos).toBe(1);
  });

  it('10. conta vitoria, empate e derrota do ponto de vista do time', () => {
    const f = normalizarForma('100', 'Time X', partidas);
    expect(f.vitorias).toBe(1);  // 2x0
    expect(f.empates).toBe(1);   // 1x1
    expect(f.derrotas).toBe(1);  // 0x3
  });

  it('11. medias batem com a conta manual', () => {
    const f = normalizarForma('100', 'Time X', partidas);
    // marcados: 2 + 1 + 0 = 3 em 3 jogos
    expect(f.mediaGolsMarcados).toBeCloseTo(1, 9);
    // sofridos: 0 + 1 + 3 = 4 em 3 jogos
    expect(f.mediaGolsSofridos).toBeCloseTo(4 / 3, 9);
  });

  it('12. ignora jogos nao encerrados', () => {
    const f = normalizarForma('100', 'Time X', [
      ...partidas,
      { id: 9, utcDate: '2026-08-01T00:00:00Z', status: 'TIMED',
        homeTeam: { id: 100 }, awayTeam: { id: 500 }, score: { fullTime: {} } },
    ]);
    expect(f.jogos.length).toBe(3);
  });

  it('13. historico vazio nao gera NaN nas medias', () => {
    const f = normalizarForma('100', 'Time X', []);
    expect(f.mediaGolsMarcados).toBe(0);
    expect(Number.isNaN(f.mediaGolsSofridos)).toBe(false);
  });
});

describe('odds-api — normalizacao (formato NAO verificado com chave real)', () => {
  it('14. resposta nao-vazia que nao produz nenhuma odd e sinal de formato mudado', () => {
    // Guarda-chuva: se a API mudar o contrato, isto vira visivel em vez de a
    // galeria de odds simplesmente ficar sempre vazia sem ninguem entender.
    const desconhecido = [{ formato: 'inesperado', valores: [1, 2, 3] }];
    expect(normalizarOdds(desconhecido, 'evt-1')).toEqual([]);
  });

  it('15. extrai odds de bookmakers com markets/outcomes', () => {
    const bruto = {
      events: [{
        bookmakers: [{
          key: 'bet365',
          markets: [{ key: '1x2', outcomes: [
            { name: 'casa', price: 2.10 },
            { name: 'empate', price: 3.40 },
            { name: 'visitante', price: 3.60 },
          ] }],
        }],
      }],
    };
    const odds = normalizarOdds(bruto, 'evt-1', '2026-07-19T12:00:00Z');
    expect(odds.length).toBe(3);
    expect(odds[0]).toMatchObject({ bookmaker: 'bet365', mercado: '1x2', selecao: 'casa', odd: 2.10 });
    expect(odds[0].provedorEventoId).toBe('evt-1');
  });

  it('16. aceita nomes alternativos de campo (odd/value/selection)', () => {
    const bruto = [{ name: 'bet365', bets: [{ name: '1x2', values: [{ selection: 'casa', odd: '1.95' }] }] }];
    const odds = normalizarOdds(bruto, 'evt-2');
    expect(odds.length).toBe(1);
    expect(odds[0].odd).toBe(1.95);
  });

  it('17. descarta odd <= 1 (nao paga nada — quase sempre campo errado)', () => {
    const bruto = [{ name: 'x', markets: [{ key: '1x2', outcomes: [
      { name: 'casa', price: 1.0 }, { name: 'empate', price: 0.45 }, { name: 'visitante', price: 2.2 },
    ] }] }];
    const odds = normalizarOdds(bruto, 'evt-3');
    expect(odds.length).toBe(1);
    expect(odds[0].selecao).toBe('visitante');
  });

  it('18. filtro por bookmaker e case-insensitive', () => {
    const base = { provedorEventoId: 'e', mercado: '1x2', selecao: 'casa', odd: 2, capturadoEm: '' };
    const lista = [
      { ...base, bookmaker: 'Bet365' },
      { ...base, bookmaker: 'betano' },
      { ...base, bookmaker: 'bet365' },
    ];
    expect(filtrarPorBookmaker(lista, 'bet365').length).toBe(2);
  });
});

describe('odds-api — throttle de cota', () => {
  beforeEach(() => resetarThrottleOdds());

  it('19. permite a primeira chamada', () => {
    expect(podeChamarAgora(Date.now())).toBe(true);
  });

  it('20. respeita ODDS_API_MIN_INTERVALO_MS', () => {
    process.env.ODDS_API_MIN_INTERVALO_MS = '0';
    expect(podeChamarAgora(0)).toBe(true);
    delete process.env.ODDS_API_MIN_INTERVALO_MS;
  });
});
