// v3.115.0 — Migrations do modulo de estatisticas esportivas.
//
// PAPEL DESTAS TABELAS: cache com validade, nao arquivo de coleta em massa.
// O CEO optou por "so quando eu perguntar" (sem cron), entao nada aqui e
// preenchido em background. Cada pergunta busca o que estiver vencido, grava, e
// as perguntas seguintes respondem do banco.
//
// O que SOBREVIVE ao cache e vira historico: esportes_probabilidades e as odds
// capturadas. Elas nunca sao apagadas, e e' desse acumulo que sai o backtest la
// na frente (compararComMercado precisa de linha de fechamento + resultado real
// ao longo de semanas). Sem cron, esse historico se forma pelo uso.
//
// DIMENSIONAMENTO — o diagnostico com a chave real mostrou 1.470 linhas de odds
// numa unica partida (todos os bookmakers x todos os mercados). Guardar tudo daria
// centenas de milhares de linhas por coleta. O job filtra na origem: so bet365 e
// so os 3 mercados que o motor usa. Se alguem remover esse filtro, esta tabela
// cresce descontrolada — daí o indice unico por (evento, casa, mercado, selecao),
// que ao menos impede duplicata da mesma linha.

import pool from './connection';

const CREATE_MODALIDADES = `
  CREATE TABLE IF NOT EXISTS esportes_modalidades (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    nome              VARCHAR(60) NOT NULL,
    provedor_liga_id  VARCHAR(60) NOT NULL,
    ativo             TINYINT(1) DEFAULT 1,
    UNIQUE KEY uk_modalidade_liga (provedor_liga_id)
  )
`;

const CREATE_EVENTOS = `
  CREATE TABLE IF NOT EXISTS esportes_eventos (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    modalidade_id       INT NULL,
    provedor_evento_id  VARCHAR(80) NOT NULL,
    provedor_liga_id    VARCHAR(60) NULL,
    competicao          VARCHAR(120) NULL,
    time_casa           VARCHAR(120) NOT NULL,
    time_visitante      VARCHAR(120) NOT NULL,
    time_casa_id        VARCHAR(40) NULL,
    time_visitante_id   VARCHAR(40) NULL,
    data_hora           DATETIME NOT NULL,
    status              ENUM('agendado','ao_vivo','encerrado','cancelado') DEFAULT 'agendado',
    placar_casa         INT NULL,
    placar_visitante    INT NULL,
    atualizado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_evento_provedor (provedor_evento_id),
    INDEX idx_evento_data (data_hora),
    INDEX idx_evento_liga (provedor_liga_id)
  )
`;

// FK pra esportes_eventos foi deliberadamente OMITIDA: o modulo grava evento e
// odds em ordens diferentes conforme o cache, e uma FK rigida faria a gravacao
// falhar por corrida em vez de simplesmente sobrescrever depois.
const CREATE_ODDS = `
  CREATE TABLE IF NOT EXISTS esportes_odds (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    provedor_evento_id  VARCHAR(80) NOT NULL,
    casa_aposta         VARCHAR(80) NOT NULL,
    mercado             VARCHAR(60) NOT NULL,
    selecao             VARCHAR(60) NOT NULL,
    odd                 DECIMAL(8,3) NOT NULL,
    capturado_em        DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_odd_linha (provedor_evento_id, casa_aposta, mercado, selecao),
    INDEX idx_odd_evento (provedor_evento_id)
  )
`;

const CREATE_ESTATISTICAS_TIME = `
  CREATE TABLE IF NOT EXISTS esportes_estatisticas_time (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    provedor_time_id     VARCHAR(40) NOT NULL,
    time_nome            VARCHAR(120) NOT NULL,
    provedor_liga_id     VARCHAR(60) NULL,
    janela_jogos         INT NOT NULL,
    vitorias             INT DEFAULT 0,
    empates              INT DEFAULT 0,
    derrotas             INT DEFAULT 0,
    media_gols_marcados  DECIMAL(5,2) NULL,
    media_gols_sofridos  DECIMAL(5,2) NULL,
    -- forca ja normalizada pela media da liga, pronta pro motor Poisson
    forca_ataque         DECIMAL(6,3) NULL,
    forca_defesa         DECIMAL(6,3) NULL,
    atualizado_em        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_stats_time (provedor_time_id, janela_jogos),
    INDEX idx_stats_atualizado (atualizado_em)
  )
`;

// Esta tabela NAO e' cache: e' o historico que viabiliza o backtest. Cada calculo
// vira uma linha nova (nao ha UNIQUE), justamente pra guardar a evolucao da
// estimativa ao longo do tempo ate o jogo acontecer.
const CREATE_PROBABILIDADES = `
  CREATE TABLE IF NOT EXISTS esportes_probabilidades (
    id                              INT AUTO_INCREMENT PRIMARY KEY,
    provedor_evento_id              VARCHAR(80) NOT NULL,
    mercado                         VARCHAR(60) NOT NULL,
    selecao                         VARCHAR(60) NOT NULL,
    probabilidade_estimada          DECIMAL(6,5) NOT NULL,
    probabilidade_implicita_mercado DECIMAL(6,5) NULL,
    odd_referencia                  DECIMAL(8,3) NULL,
    valor_esperado                  DECIMAL(8,5) NULL,
    metodologia                     VARCHAR(60) NOT NULL,
    calculado_em                    DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_prob_evento (provedor_evento_id),
    INDEX idx_prob_calculado (calculado_em)
  )
`;

// Fecha o ciclo do backtest: previsao guardada + o que de fato aconteceu.
const CREATE_BACKTEST = `
  CREATE TABLE IF NOT EXISTS esportes_backtest_resultados (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    provedor_evento_id      VARCHAR(80) NOT NULL,
    metodologia             VARCHAR(60) NOT NULL,
    prob_casa               DECIMAL(6,5) NULL,
    prob_empate             DECIMAL(6,5) NULL,
    prob_visitante          DECIMAL(6,5) NULL,
    prob_mercado_casa       DECIMAL(6,5) NULL,
    prob_mercado_empate     DECIMAL(6,5) NULL,
    prob_mercado_visitante  DECIMAL(6,5) NULL,
    resultado_real          ENUM('casa','empate','visitante') NULL,
    brier_score             DECIMAL(8,5) NULL,
    conferido_em            DATETIME NULL,
    criado_em               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_backtest (provedor_evento_id, metodologia),
    INDEX idx_backtest_conferido (conferido_em)
  )
`;

export async function runEsportesMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'esportes_modalidades', sql: CREATE_MODALIDADES },
    { label: 'esportes_eventos', sql: CREATE_EVENTOS },
    { label: 'esportes_odds', sql: CREATE_ODDS },
    { label: 'esportes_estatisticas_time', sql: CREATE_ESTATISTICAS_TIME },
    { label: 'esportes_probabilidades', sql: CREATE_PROBABILIDADES },
    { label: 'esportes_backtest_resultados', sql: CREATE_BACKTEST },
  ];
  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[esportes-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate/i.test(msg)) {
        console.log(`[esportes-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[esportes-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
