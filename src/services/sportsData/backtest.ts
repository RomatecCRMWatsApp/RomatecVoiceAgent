// v3.118.0 — Backtest: o modelo bate a linha de fechamento, ou nao?
//
// POR QUE ESTE ARQUIVO E O MAIS IMPORTANTE DO MODULO:
// um modelo de probabilidade nunca erra de forma visivel. Ele diz 54%, o jogo
// acontece, e 54% nao e' certo nem errado num jogo so. Da pra rodar um modelo
// completamente quebrado por uma temporada inteira sem ninguem perceber, porque a
// saida sempre parece razoavel. Sem o que esta aqui, todo o resto do modulo e'
// gerador de numero bonito.
//
// A pergunta que ele responde: ao longo de dezenas de jogos, as previsoes do
// modelo erraram MENOS que a probabilidade implicita da odd de fechamento? Se
// nao, o modelo nao esta agregando informacao — seguir o ranking dele equivale a
// apostar no escuro com passos a mais. A linha de fechamento e' notoriamente
// eficiente; bater ela e' dificil, e o resultado provavel e' que nao bata.
//
// Sem cron, o historico se forma pelo uso: cada consulta grava previsao + odds.
// Este modulo so fecha o ciclo, conferindo o placar depois do apito.

import pool from '../../database/connection';
import type { RowDataPacket } from 'mysql2';
import { getFixturesPorData } from './adapters/apiSportsAdapter';
import {
  brierScore, logLoss, calibracao, erroCalibracao, compararComMercado,
  type PrevisaoAvaliada, type ResultadoObservado,
} from './avaliacaoModelo';
import { METODOLOGIA } from './probabilityEngine';

/** Quantos dias pra tras procurar jogos ainda nao conferidos. */
const JANELA_DIAS = 14;
/** Teto de datas por execucao — cada uma custa 1 requisicao. */
const MAX_DATAS = 8;

function resultadoDoPlacar(casa: number, visitante: number): ResultadoObservado {
  if (casa > visitante) return 'casa';
  if (casa === visitante) return 'empate';
  return 'visitante';
}

/**
 * Busca previsoes 1x2 sem resultado conferido, pega o placar final e grava no
 * backtest. Idempotente: o UNIQUE(evento, metodologia) impede linha duplicada.
 *
 * Usa a ULTIMA previsao de cada evento (a mais proxima do jogo), que e' a
 * comparavel a linha de fechamento.
 */
export async function conferirResultadosPendentes(): Promise<{
  datasConsultadas: number; conferidos: number; aindaPendentes: number;
}> {
  const [pendentes] = await pool.execute<RowDataPacket[]>(
    `SELECT p.provedor_evento_id, DATE(e.data_hora) AS dia
       FROM esportes_probabilidades p
       JOIN esportes_eventos e ON e.provedor_evento_id = p.provedor_evento_id
      WHERE p.mercado = '1x2'
        AND e.data_hora < NOW()
        AND e.data_hora > DATE_SUB(NOW(), INTERVAL ${JANELA_DIAS} DAY)
        AND NOT EXISTS (
          SELECT 1 FROM esportes_backtest_resultados b
           WHERE b.provedor_evento_id = p.provedor_evento_id
             AND b.metodologia = p.metodologia
             AND b.resultado_real IS NOT NULL
        )
      GROUP BY p.provedor_evento_id, dia`,
  );
  if (!pendentes.length) return { datasConsultadas: 0, conferidos: 0, aindaPendentes: 0 };

  const porDia = new Map<string, Set<string>>();
  for (const r of pendentes) {
    const dia = String(r.dia).slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, new Set());
    porDia.get(dia)!.add(String(r.provedor_evento_id));
  }

  let conferidos = 0;
  let datasConsultadas = 0;
  for (const [dia, ids] of [...porDia.entries()].slice(0, MAX_DATAS)) {
    let fixtures;
    try {
      fixtures = await getFixturesPorData(dia);
      datasConsultadas++;
    } catch {
      continue; // cota ou rede: tenta na proxima execucao
    }
    for (const f of fixtures) {
      if (!ids.has(f.provedorEventoId)) continue;
      if (f.status !== 'encerrado' || f.placarCasa == null || f.placarVisitante == null) continue;

      // Placar tambem vai pro evento, pra nao precisar rebuscar depois.
      await pool.execute(
        `UPDATE esportes_eventos SET status = 'encerrado', placar_casa = ?, placar_visitante = ?
          WHERE provedor_evento_id = ?`,
        [f.placarCasa, f.placarVisitante, f.provedorEventoId],
      ).catch(() => {});

      const real = resultadoDoPlacar(f.placarCasa, f.placarVisitante);
      const [linhas] = await pool.execute<RowDataPacket[]>(
        `SELECT selecao, probabilidade_estimada, probabilidade_implicita_mercado
           FROM esportes_probabilidades
          WHERE provedor_evento_id = ? AND mercado = '1x2' AND metodologia = ?
          ORDER BY calculado_em DESC LIMIT 3`,
        [f.provedorEventoId, METODOLOGIA],
      );
      if (linhas.length < 3) continue;

      const porSel = new Map(linhas.map((l) => [String(l.selecao), l]));
      const pega = (s: string, campo: string) => {
        const v = porSel.get(s)?.[campo];
        return v == null ? null : Number(v);
      };
      const pc = pega('casa', 'probabilidade_estimada');
      const pe = pega('empate', 'probabilidade_estimada');
      const pv = pega('visitante', 'probabilidade_estimada');
      if (pc == null || pe == null || pv == null) continue;

      const brier = ([['casa', pc], ['empate', pe], ['visitante', pv]] as const)
        .reduce((s, [sel, p]) => s + (p - (sel === real ? 1 : 0)) ** 2, 0);

      await pool.execute(
        `INSERT INTO esportes_backtest_resultados
           (provedor_evento_id, metodologia, prob_casa, prob_empate, prob_visitante,
            prob_mercado_casa, prob_mercado_empate, prob_mercado_visitante,
            resultado_real, brier_score, conferido_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           resultado_real = VALUES(resultado_real), brier_score = VALUES(brier_score),
           conferido_em = NOW()`,
        [f.provedorEventoId, METODOLOGIA, pc, pe, pv,
         pega('casa', 'probabilidade_implicita_mercado'),
         pega('empate', 'probabilidade_implicita_mercado'),
         pega('visitante', 'probabilidade_implicita_mercado'),
         real, brier],
      ).catch(() => {});
      conferidos++;
    }
  }
  return { datasConsultadas, conferidos, aindaPendentes: pendentes.length - conferidos };
}

export interface RelatorioDesempenho {
  amostra: number;
  amostraComMercado: number;
  brierModelo: number | null;
  brierMercado: number | null;
  logLossModelo: number | null;
  logLossMercado: number | null;
  modeloBateuMercado: boolean | null;
  erroCalibracao: number | null;
  faixasDesalinhadas: Array<{ faixa: string; previsto: number; observado: number; n: number }>;
  veredito: string;
}

/**
 * Le o historico conferido e diz, em uma frase, se ha evidencia de que o modelo
 * vale alguma coisa.
 *
 * O campo `veredito` e' deliberadamente conservador: com amostra pequena qualquer
 * resultado e' ruido, e dizer "o modelo esta ganhando" com 12 jogos seria induzir
 * o usuario ao erro justamente no momento em que ele mais tende a acreditar.
 */
export async function relatorioDesempenho(): Promise<RelatorioDesempenho> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT prob_casa, prob_empate, prob_visitante,
            prob_mercado_casa, prob_mercado_empate, prob_mercado_visitante, resultado_real
       FROM esportes_backtest_resultados
      WHERE resultado_real IS NOT NULL AND metodologia = ?`,
    [METODOLOGIA],
  );

  const vazio: RelatorioDesempenho = {
    amostra: 0, amostraComMercado: 0,
    brierModelo: null, brierMercado: null, logLossModelo: null, logLossMercado: null,
    modeloBateuMercado: null, erroCalibracao: null, faixasDesalinhadas: [],
    veredito: 'Ainda nao ha jogos conferidos. O historico se forma conforme voce consulta — '
            + 'cada pergunta grava a previsao, e o resultado e conferido depois do jogo.',
  };
  if (!rows.length) return vazio;

  const modelo: PrevisaoAvaliada[] = [];
  const mercado: PrevisaoAvaliada[] = [];
  for (const r of rows) {
    const obs = String(r.resultado_real) as ResultadoObservado;
    modelo.push({
      probCasa: Number(r.prob_casa), probEmpate: Number(r.prob_empate),
      probVisitante: Number(r.prob_visitante), observado: obs,
    });
    if (r.prob_mercado_casa != null) {
      mercado.push({
        probCasa: Number(r.prob_mercado_casa), probEmpate: Number(r.prob_mercado_empate),
        probVisitante: Number(r.prob_mercado_visitante), observado: obs,
      });
    }
  }

  const brierM = brierScore(modelo);
  const ece = erroCalibracao(modelo);
  const desalinhadas = calibracao(modelo)
    .filter((f) => f.n >= 5 && Math.abs(f.desvio) > 0.1)
    .map((f) => ({
      faixa: `${Math.round(f.de * 100)}-${Math.round(f.ate * 100)}%`,
      previsto: Number(f.probabilidadeMedia.toFixed(3)),
      observado: Number(f.frequenciaObservada.toFixed(3)),
      n: f.n,
    }));

  // So compara com o mercado nos jogos em que HA odds — misturar os dois
  // conjuntos daria vantagem artificial a um dos lados.
  const modeloComOdds = modelo.filter((_, i) => rows[i].prob_mercado_casa != null);
  const podeComparar = mercado.length >= 1 && modeloComOdds.length === mercado.length;
  const comp = podeComparar ? compararComMercado(modeloComOdds, mercado) : null;

  let veredito: string;
  if (rows.length < 30) {
    veredito = `Amostra de ${rows.length} jogo(s) — pequena demais pra concluir qualquer coisa. `
             + 'Abaixo de ~30 jogos, qualquer vantagem ou desvantagem aqui e ruido. Continue consultando.';
  } else if (!comp) {
    veredito = `${rows.length} jogos conferidos, mas sem odds guardadas pra comparar com o mercado. `
             + 'Da pra ver calibracao, nao se o modelo bate a linha de fechamento.';
  } else if (comp.modeloBateuMercado) {
    veredito = `Em ${comp.amostra} jogos o modelo errou menos que a linha de fechamento `
             + `(Brier ${comp.brierModelo.toFixed(3)} contra ${comp.brierMercado.toFixed(3)}). `
             + 'E um sinal positivo, nao uma prova: bater o mercado por acaso numa amostra dessas ainda e possivel.';
  } else {
    veredito = `Em ${comp.amostra} jogos o modelo NAO bateu a linha de fechamento `
             + `(Brier ${comp.brierModelo.toFixed(3)} contra ${comp.brierMercado.toFixed(3)}). `
             + 'Ou seja: ele nao esta agregando informacao sobre o que a casa ja precifica. '
             + 'E o resultado mais comum — o mercado e muito eficiente.';
  }

  return {
    amostra: rows.length,
    amostraComMercado: mercado.length,
    brierModelo: Number(brierM.toFixed(4)),
    brierMercado: comp ? Number(comp.brierMercado.toFixed(4)) : null,
    logLossModelo: Number(logLoss(modelo).toFixed(4)),
    logLossMercado: comp ? Number(comp.logLossMercado.toFixed(4)) : null,
    modeloBateuMercado: comp ? comp.modeloBateuMercado : null,
    erroCalibracao: Number(ece.toFixed(4)),
    faixasDesalinhadas: desalinhadas,
    veredito,
  };
}

/** Confere o que der e devolve o relatorio — o que o tool chama. */
export async function conferirERelatar(): Promise<RelatorioDesempenho & {
  conferidosAgora: number;
}> {
  const c = await conferirResultadosPendentes().catch(() => ({ conferidos: 0 }));
  const rel = await relatorioDesempenho();
  return { ...rel, conferidosAgora: c.conferidos };
}
