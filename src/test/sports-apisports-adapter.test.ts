// v3.114.0: adapter API-Sports (provedor primario, plano Pro do CEO).
//
// AVISO HONESTO SOBRE O ALCANCE DESTES TESTES:
// eles provam que a NORMALIZACAO esta correta dado o formato que assumimos. Nao
// provam que o formato assumido e' o que a API realmente devolve — a documentacao
// da API-Sports bloqueia acesso automatizado (403), entao o mapeamento veio do
// contrato v3 conhecido, nao de uma chamada verificada.
//
// A confirmacao real e' `diagnosticarConexao()` rodando com a chave. Se o formato
// divergir, corrige-se os normalizadores exportados e estes testes acusam na hora.
//
// O risco que eles COBREM e' o pior de todos aqui: campo trocado. Mandante lido
// como visitante, ou gols invertidos, produz estatistica plausivel e completamente
// falsa — o motor calcula feliz e ninguem percebe.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  mapearStatusApiSports, normalizarFixtureApiSports, normalizarFormaApiSports,
  normalizarOddsApiSports, LIGAS, BOOKMAKER_BET365,
} from '../services/sportsData/adapters/apiSportsAdapter';

describe('API-Sports — status', () => {
  it('1. codigos ao vivo', () => {
    for (const s of ['1H', 'HT', '2H', 'ET', 'P', 'LIVE']) {
      expect(mapearStatusApiSports(s)).toBe('ao_vivo');
    }
  });

  it('2. codigos de encerrado', () => {
    for (const s of ['FT', 'AET', 'PEN']) expect(mapearStatusApiSports(s)).toBe('encerrado');
  });

  it('3. codigos de cancelado/adiado', () => {
    for (const s of ['PST', 'CANC', 'ABD', 'SUSP']) {
      expect(mapearStatusApiSports(s)).toBe('cancelado');
    }
  });

  it('4. NS e desconhecido caem em agendado', () => {
    expect(mapearStatusApiSports('NS')).toBe('agendado');
    expect(mapearStatusApiSports('TBD')).toBe('agendado');
    expect(mapearStatusApiSports('XYZ')).toBe('agendado');
  });

  it('5. aceita minusculo', () => {
    expect(mapearStatusApiSports('ft')).toBe('encerrado');
  });
});

describe('API-Sports — fixture', () => {
  const bruto = {
    fixture: { id: 1035001, date: '2026-07-19T21:00:00+00:00', status: { short: 'NS' } },
    league: { id: 71, name: 'Serie A' },
    teams: { home: { id: 127, name: 'Flamengo' }, away: { id: 121, name: 'Palmeiras' } },
    goals: { home: null, away: null },
  };

  it('6. nao troca mandante com visitante', () => {
    const f = normalizarFixtureApiSports(bruto);
    expect(f.timeCasa).toBe('Flamengo');
    expect(f.timeVisitante).toBe('Palmeiras');
  });

  it('7. id do evento vira string (chave de deduplicacao do job)', () => {
    expect(normalizarFixtureApiSports(bruto).provedorEventoId).toBe('1035001');
  });

  it('8. sem placar vira null, nao 0', () => {
    const f = normalizarFixtureApiSports(bruto);
    expect(f.placarCasa).toBeNull();
    expect(f.placarVisitante).toBeNull();
  });

  it('9. placar preservado na ordem certa', () => {
    const f = normalizarFixtureApiSports({
      ...bruto, fixture: { ...bruto.fixture, status: { short: 'FT' } },
      goals: { home: 2, away: 1 },
    });
    expect(f.placarCasa).toBe(2);
    expect(f.placarVisitante).toBe(1);
    expect(f.status).toBe('encerrado');
  });

  it('10. resposta incompleta nao quebra', () => {
    const f = normalizarFixtureApiSports({});
    expect(f.timeCasa).toBe('(desconhecido)');
    expect(f.status).toBe('agendado');
  });

  it('11. Brasileirao Serie A e a liga 71', () => {
    expect(LIGAS.BRASILEIRAO_A).toBe(71);
  });
});

describe('API-Sports — forma recente', () => {
  const partidas = [
    { fixture: { id: 1, date: '2026-07-01T00:00:00+00:00', status: { short: 'FT' } },
      teams: { home: { id: 127, name: 'Flamengo' }, away: { id: 121 } }, goals: { home: 3, away: 0 } },
    { fixture: { id: 2, date: '2026-07-10T00:00:00+00:00', status: { short: 'FT' } },
      teams: { home: { id: 118 }, away: { id: 127, name: 'Flamengo' } }, goals: { home: 2, away: 1 } },
    { fixture: { id: 3, date: '2026-07-16T00:00:00+00:00', status: { short: 'NS' } },
      teams: { home: { id: 127 }, away: { id: 130 } }, goals: { home: null, away: null } },
  ];

  it('12. ignora jogo nao encerrado', () => {
    expect(normalizarFormaApiSports('127', partidas).jogos.length).toBe(2);
  });

  it('13. ordena do mais recente pro mais antigo', () => {
    const f = normalizarFormaApiSports('127', partidas);
    expect(f.jogos[0].dataHora).toBe('2026-07-10T00:00:00+00:00');
    expect(f.jogos[0].jogosAtras).toBe(0);
  });

  it('14. inverte gols quando o time jogou FORA', () => {
    const f = normalizarFormaApiSports('127', partidas);
    const fora = f.jogos.find((j) => !j.mandante)!;
    // 118 x 127 = 2x1 -> Flamengo marcou 1, sofreu 2
    expect(fora.golsMarcados).toBe(1);
    expect(fora.golsSofridos).toBe(2);
  });

  it('15. contabiliza vitoria e derrota do ponto de vista do time', () => {
    const f = normalizarFormaApiSports('127', partidas);
    expect(f.vitorias).toBe(1); // 3x0 em casa
    expect(f.derrotas).toBe(1); // 1x2 fora
    expect(f.empates).toBe(0);
  });

  it('16. medias conferem com a conta manual', () => {
    const f = normalizarFormaApiSports('127', partidas);
    expect(f.mediaGolsMarcados).toBeCloseTo((3 + 1) / 2, 9);
    expect(f.mediaGolsSofridos).toBeCloseTo((0 + 2) / 2, 9);
  });

  it('17. descobre o nome do time mesmo quando so aparece como visitante', () => {
    const so = [partidas[1]];
    expect(normalizarFormaApiSports('127', so).timeNome).toBe('Flamengo');
  });

  it('18. historico vazio nao gera NaN', () => {
    const f = normalizarFormaApiSports('127', []);
    expect(f.mediaGolsMarcados).toBe(0);
    expect(Number.isNaN(f.mediaGolsSofridos)).toBe(false);
  });
});

describe('API-Sports — odds', () => {
  const bruto = [{
    fixture: { id: 1035001 },
    update: '2026-07-19T12:00:00+00:00',
    bookmakers: [{
      id: 8, name: 'Bet365',
      bets: [{
        id: 1, name: 'Match Winner',
        values: [
          { value: 'Home', odd: '2.10' },
          { value: 'Draw', odd: '3.40' },
          { value: 'Away', odd: '3.60' },
        ],
      }],
    }],
  }];

  it('19. achata bookmakers > bets > values', () => {
    const odds = normalizarOddsApiSports(bruto);
    expect(odds.length).toBe(3);
    expect(odds[0]).toMatchObject({
      provedorEventoId: '1035001', bookmaker: 'Bet365',
      mercado: 'Match Winner', selecao: 'Home', odd: 2.10,
    });
  });

  it('20. converte odd de STRING pra numero (a API manda texto)', () => {
    expect(typeof normalizarOddsApiSports(bruto)[0].odd).toBe('number');
  });

  it('21. descarta odd <= 1 (nao paga nada, quase sempre campo errado)', () => {
    const ruim = [{ fixture: { id: 1 }, bookmakers: [{ name: 'x', bets: [{ name: 'm', values: [
      { value: 'a', odd: '1.00' }, { value: 'b', odd: '0.5' }, { value: 'c', odd: '1.80' },
    ] }] }] }];
    const odds = normalizarOddsApiSports(ruim);
    expect(odds.length).toBe(1);
    expect(odds[0].selecao).toBe('c');
  });

  it('22. resposta vazia devolve lista vazia, sem quebrar', () => {
    expect(normalizarOddsApiSports([])).toEqual([]);
    expect(normalizarOddsApiSports([{ fixture: { id: 1 } }])).toEqual([]);
  });

  it('23. usa update como capturadoEm quando presente', () => {
    expect(normalizarOddsApiSports(bruto)[0].capturadoEm).toBe('2026-07-19T12:00:00+00:00');
  });

  it('24. id do bet365 esta definido pra filtro no endpoint', () => {
    expect(BOOKMAKER_BET365).toBe(8);
  });
});

describe('rota de diagnostico — gate de acesso', () => {
  const serverTs = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8');
  const linha = serverTs.split('\n').find((l) => l.includes("app.get('/api/esportes/diagnostico'"));

  it('25. a rota existe', () => {
    expect(linha, 'rota /api/esportes/diagnostico nao encontrada').toBeDefined();
  });

  it('26. exige sessao E papel de dono — requireCeoToken nao serve mais pra isso', () => {
    // A v3.109.0 removeu o gate de role do requireCeoToken a pedido do CEO, entao
    // hoje qualquer usuario logado passa por ele. Restringir ao dono exige
    // requireRole explicito. Este teste trava o padrao pra fase 4 seguir.
    expect(linha).toContain('requireAuth');
    expect(linha).toContain("requireRole('admin', 'owner')");
    expect(linha).not.toContain('requireCeoToken');
  });

  it('27. o modulo esportivo nao ganhou nenhuma outra rota (spec: sem tela)', () => {
    const rotas = serverTs.split('\n').filter((l) => /^app\.(get|post|put|delete)\('\/api\/esportes/.test(l.trim()));
    expect(rotas.length, `rotas de esportes encontradas:\n${rotas.join('\n')}`).toBe(1);
  });
});

describe('propagacao dos ids de time (bug corrigido antes de ir pro ar)', () => {
  // Sem o id, obterForca() nao tem o que consultar: o cache nunca se preenche e
  // TODO jogo sai sem probabilidade. A API identifica time por id, nao por nome —
  // a primeira versao guardava so o nome e o modulo teria nascido inerte.
  it('28. fixture carrega os ids de mandante e visitante', () => {
    const f = normalizarFixtureApiSports({
      fixture: { id: 1, date: '2026-07-19T21:00:00+00:00', status: { short: 'NS' } },
      teams: { home: { id: 127, name: 'Flamengo' }, away: { id: 121, name: 'Palmeiras' } },
    });
    expect(f.timeCasaId).toBe('127');
    expect(f.timeVisitanteId).toBe('121');
  });

  it('29. id ausente vira string vazia, nao "undefined"', () => {
    const f = normalizarFixtureApiSports({});
    expect(f.timeCasaId).toBe('');
    expect(f.timeVisitanteId).toBe('');
  });

  it('30. os ids nao saem trocados entre si', () => {
    const f = normalizarFixtureApiSports({
      fixture: { id: 9 },
      teams: { home: { id: 111, name: 'A' }, away: { id: 222, name: 'B' } },
    });
    expect(f.timeCasa).toBe('A');
    expect(f.timeCasaId).toBe('111');
    expect(f.timeVisitante).toBe('B');
    expect(f.timeVisitanteId).toBe('222');
  });
});
