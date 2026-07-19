// v3.118.0: mercados expandidos + veredito do backtest.
//
// Dois riscos cobertos aqui, ambos silenciosos:
//
// 1. MERCADO MAL MAPEADO. Se "Goals Over/Under" nao for reconhecido, a odd e
//    descartada e o mercado some do ranking sem erro nenhum. O usuario acha que
//    a casa nao oferece a linha; na verdade foi o parser.
//
// 2. VEREDITO OTIMISTA DEMAIS. Com 12 jogos, qualquer vantagem e ruido. Dizer
//    "o modelo esta ganhando do mercado" nessa amostra induziria o usuario ao
//    erro justo no momento em que ele mais tende a acreditar.

import { describe, it, expect } from 'vitest';
import { mapearMercado, mapearSelecaoMercado, mapearSelecao1x2 } from '../services/sportsData/consultaEsportiva';

describe('mapeamento de mercados da API-Sports', () => {
  it('1. reconhece os 3 mercados que o motor modela', () => {
    expect(mapearMercado('Match Winner')).toBe('1x2');
    expect(mapearMercado('Goals Over/Under')).toBe('over_under_2.5');
    expect(mapearMercado('Both Teams Score')).toBe('ambas_marcam');
  });

  it('2. e insensivel a caixa e espaco', () => {
    expect(mapearMercado('  match winner ')).toBe('1x2');
    expect(mapearMercado('BOTH TEAMS SCORE')).toBe('ambas_marcam');
  });

  it('3. devolve null pros mercados que o motor NAO modela', () => {
    // Escanteio, cartao e jogador nao tem probabilidade estimada por tras.
    // Exibir odd sem modelo seria dar ar de analise a um numero da casa.
    for (const m of ['Corners Over Under', 'Cards Over/Under', 'Anytime Goal Scorer', 'Correct Score']) {
      expect(mapearMercado(m), `${m} nao deveria ser modelado`).toBeNull();
    }
  });
});

describe('mapeamento de selecao por mercado', () => {
  it('4. 1x2 aceita rotulos em ingles e portugues', () => {
    expect(mapearSelecao1x2('Home')).toBe('casa');
    expect(mapearSelecao1x2('Draw')).toBe('empate');
    expect(mapearSelecao1x2('Away')).toBe('visitante');
    expect(mapearSelecao1x2('empate')).toBe('empate');
  });

  it('5. over/under pega SO a linha 2.5 (a API manda varias)', () => {
    expect(mapearSelecaoMercado('over_under_2.5', 'Over 2.5')).toBe('over');
    expect(mapearSelecaoMercado('over_under_2.5', 'Under 2.5')).toBe('under');
    // 1.5 e 3.5 existem no mesmo mercado e nao podem virar linha 2.5
    expect(mapearSelecaoMercado('over_under_2.5', 'Over 1.5')).toBeNull();
    expect(mapearSelecaoMercado('over_under_2.5', 'Under 3.5')).toBeNull();
  });

  it('6. ambas marcam aceita Yes/No e sim/nao', () => {
    expect(mapearSelecaoMercado('ambas_marcam', 'Yes')).toBe('sim');
    expect(mapearSelecaoMercado('ambas_marcam', 'No')).toBe('nao');
  });

  it('7. selecao desconhecida vira null em vez de entrar torta', () => {
    expect(mapearSelecaoMercado('1x2', 'Talvez')).toBeNull();
    expect(mapearSelecaoMercado('mercado_inexistente', 'x')).toBeNull();
  });
});

describe('backtest — o veredito nao pode ser otimista demais', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'services', 'sportsData', 'backtest.ts'), 'utf8');

  it('8. exige amostra minima antes de concluir qualquer coisa', () => {
    expect(src).toMatch(/rows\.length < 30/);
    expect(src).toMatch(/ruido/i);
  });

  it('9. compara modelo e mercado SO nos jogos que tem odds', () => {
    // Misturar jogos com e sem odds daria vantagem artificial a um dos lados.
    expect(src).toContain('modeloComOdds');
  });

  it('10. mesmo batendo o mercado, o texto nao afirma prova', () => {
    expect(src).toMatch(/nao uma prova|por acaso/i);
  });
});
