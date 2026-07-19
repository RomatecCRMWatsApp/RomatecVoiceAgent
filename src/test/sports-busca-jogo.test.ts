// v3.117.0: busca de UM jogo especifico por nome de time.
//
// Motivo de existir: o CEO pediu pra testar a final da Copa (Argentina x Espanha),
// e a Copa do Mundo NAO esta em LIGAS_ACOMPANHADAS — a lista dele foi Brasileirao,
// Libertadores e europeus. O jogo seria filtrado fora antes de chegar ao motor.
//
// Solucao adotada: quando o usuario cita times, o filtro de liga e' IGNORADO.
// Assim funciona pra Copa, amistoso ou qualquer competicao, sem depender de eu
// acertar o id da liga na API — que eu nao tenho como verificar daqui.

import { describe, it, expect } from 'vitest';
import { normalizarNomeTime, jogoBateComBusca } from '../services/sportsData/consultaEsportiva';

const jogo = { timeCasa: 'Argentina', timeVisitante: 'Spain' };

describe('normalizacao de nome de time', () => {
  it('1. tira acento e caixa', () => {
    expect(normalizarNomeTime('Espanha')).toBe('espanha');
    expect(normalizarNomeTime('ATLÉTICO')).toBe('atletico');
    expect(normalizarNomeTime('  São Paulo  ')).toBe('sao paulo');
  });

  it('2. nulo/vazio nao quebra', () => {
    expect(normalizarNomeTime('')).toBe('');
    expect(normalizarNomeTime(undefined as unknown as string)).toBe('');
  });
});

describe('busca de jogo por time', () => {
  it('3. acha pelo mandante', () => {
    expect(jogoBateComBusca(jogo, ['Argentina'])).toBe(true);
  });

  it('4. acha pelo visitante', () => {
    expect(jogoBateComBusca(jogo, ['Spain'])).toBe(true);
  });

  it('5. basta UM dos termos casar (o usuario pode errar o outro)', () => {
    expect(jogoBateComBusca(jogo, ['Argentina', 'Espanha'])).toBe(true);
  });

  it('6. nome parcial serve', () => {
    expect(jogoBateComBusca({ timeCasa: 'Manchester City', timeVisitante: 'Arsenal' }, ['city'])).toBe(true);
  });

  it('7. jogo sem relacao nao casa', () => {
    expect(jogoBateComBusca(jogo, ['Flamengo'])).toBe(false);
  });

  it('8. termo curto demais e ignorado (evita "as" casar com meio mundo)', () => {
    expect(jogoBateComBusca(jogo, ['ar'])).toBe(false);
  });

  it('9. sem termos, nao filtra nada', () => {
    expect(jogoBateComBusca(jogo, [])).toBe(true);
  });
});
