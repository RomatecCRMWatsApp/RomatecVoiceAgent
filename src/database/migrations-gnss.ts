// v3.18.0: Tabelas de processamento GNSS (RINEX -> IBGE-PPP -> coordenadas SIRGAS2000)
// Storage no próprio banco como LONGBLOB (mesmo padrão de laudos_demarcacao_arquivos
// e laudos_demarcacao_fotos) — Railway tem containers efêmeros.
// Idempotente: re-execução ignora "already exists".

import pool from './connection';

export async function runGnssMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'CREATE TABLE processamentos_gnss',
      sql: `CREATE TABLE processamentos_gnss (
        id INT AUTO_INCREMENT PRIMARY KEY,
        laudo_id INT NULL COMMENT 'pode existir sem laudo vinculado',
        ponto_id INT NULL COMMENT 'FK laudos_demarcacao_pontos quando vinculado',
        rotulo VARCHAR(50) NOT NULL COMMENT 'M01, V03, P-ESTACA-02...',
        status ENUM(
          'rinex_carregado','aguardando_submissao_ibge','aguardando_retorno_ibge',
          'processado','erro','cancelado'
        ) NOT NULL DEFAULT 'rinex_carregado',
        fonte ENUM('rinex_ibge','ppp_manual','rtk_csv','outro') NOT NULL,
        inicio_rastreio DATETIME NULL,
        fim_rastreio DATETIME NULL,
        duracao_segundos INT NULL,
        intervalo_amostragem_s DECIMAL(5,2) NULL,
        num_epocas INT NULL,
        receptor_modelo VARCHAR(120) NULL,
        receptor_serial VARCHAR(80) NULL,
        antena_modelo VARCHAR(120) NULL,
        antena_altura_m DECIMAL(6,3) NULL,
        sistemas_gnss VARCHAR(80) NULL COMMENT 'CSV: GPS,GLO,GAL,BDS',
        ref_geodesico VARCHAR(40) NULL DEFAULT 'SIRGAS2000',
        latitude_graus DECIMAL(12,9) NULL,
        longitude_graus DECIMAL(13,9) NULL,
        altitude_geometrica_m DECIMAL(10,3) NULL,
        altitude_ortometrica_m DECIMAL(10,3) NULL,
        modelo_geoidal VARCHAR(40) NULL DEFAULT 'MAPGEO2015',
        utm_norte_m DECIMAL(12,3) NULL,
        utm_leste_m DECIMAL(12,3) NULL,
        utm_zona TINYINT NULL,
        utm_hemisferio CHAR(1) NULL,
        utm_mc INT NULL,
        sigma_lat_m DECIMAL(7,4) NULL,
        sigma_lon_m DECIMAL(7,4) NULL,
        sigma_alt_m DECIMAL(7,4) NULL,
        pdop_medio DECIMAL(5,2) NULL,
        observacoes TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        processado_at DATETIME NULL,
        CONSTRAINT fk_pgnss_laudo FOREIGN KEY (laudo_id)
          REFERENCES laudos_demarcacao(id) ON DELETE SET NULL,
        CONSTRAINT fk_pgnss_ponto FOREIGN KEY (ponto_id)
          REFERENCES laudos_demarcacao_pontos(id) ON DELETE SET NULL,
        INDEX idx_pgnss_laudo (laudo_id),
        INDEX idx_pgnss_status (status),
        INDEX idx_pgnss_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` },

    { label: 'CREATE TABLE processamentos_gnss_arquivos',
      sql: `CREATE TABLE processamentos_gnss_arquivos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        processamento_id INT NOT NULL,
        papel ENUM(
          'rinex_obs','rinex_nav_gps','rinex_nav_glo','rinex_nav_gal','rinex_nav_bds',
          'rinex_rnx3','ibge_zip_envio','ibge_zip_retorno','ibge_pdf','ibge_txt',
          'ibge_kml','ibge_pos','ppp_externo_pdf','ppp_externo_kml','ppp_externo_pos',
          'rtk_csv','outro'
        ) NOT NULL,
        nome_original VARCHAR(255) NOT NULL,
        nome_armazenado VARCHAR(300) NOT NULL,
        tamanho_bytes BIGINT NOT NULL,
        mime_type VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
        sha256 CHAR(64) NOT NULL,
        conteudo_blob LONGBLOB NOT NULL,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_pgnss_arq_proc FOREIGN KEY (processamento_id)
          REFERENCES processamentos_gnss(id) ON DELETE CASCADE,
        INDEX idx_pgnss_arq_proc (processamento_id),
        INDEX idx_pgnss_arq_papel (papel),
        INDEX idx_pgnss_arq_ativo (ativo)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` },
  ];

  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[gnss-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate|Duplicate key name/i.test(msg)) {
        console.log(`[gnss-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[gnss-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }

  // Seed em configuracoes (idempotente)
  const seeds: Array<[string, string, string]> = [
    ['IBGE_PPP_URL_PORTAL',
      'https://www.ibge.gov.br/geociencias/modelos-digitais-de-superficie/modelos-digitais-de-elevacao/19219-ppp-posicionamento-por-ponto-preciso.html',
      'URL do portal IBGE-PPP para submissao manual'],
    ['UPLOAD_MAX_SIZE_MB_RINEX_OBS', '20', 'Tamanho maximo do arquivo RINEX de observacao (MB)'],
    ['UPLOAD_MAX_SIZE_MB_RINEX_NAV', '5', 'Tamanho maximo do arquivo RINEX de navegacao (MB)'],
    ['UPLOAD_MAX_SIZE_MB_IBGE_ZIP', '15', 'Tamanho maximo do .zip de retorno do IBGE-PPP (MB)'],
    ['GNSS_DURACAO_MINIMA_S', '300', 'Duracao minima absoluta de rastreio para PPP (s); abaixo disso bloqueia'],
    ['GNSS_DURACAO_RECOMENDADA_S', '1200', 'Duracao minima recomendada (s) para PPP estavel; abaixo gera warning'],
  ];
  for (const [chave, valor, descricao] of seeds) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO configuracoes (chave, valor, descricao) VALUES (?, ?, ?)`,
        [chave, valor, descricao]
      );
    } catch (err) {
      console.error(`[gnss-seed] FALHA ${chave}:`, (err as Error).message);
    }
  }

  // v3.21.0: ALTER ADD COLUMN tipo_sessao — distingue sessao GNSS de vertice
  // (M01, V01, P01...) de sessao da BASE de referencia (Base_RCP, B-XX...).
  // Auto-aplicar so cria vertice no laudo quando tipo='vertice'. Base preenche
  // somente os campos base_* do laudo (sem poluir a poligonal).
  try {
    await pool.execute(
      `ALTER TABLE processamentos_gnss
         ADD COLUMN tipo_sessao ENUM('vertice','base') NOT NULL DEFAULT 'vertice'
         AFTER fonte`
    );
    console.log(`[gnss-migrations] OK: ALTER ADD tipo_sessao`);
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/Duplicate column|already exists/i.test(msg)) {
      console.log(`[gnss-migrations] ja existe (OK): tipo_sessao`);
    } else {
      console.warn(`[gnss-migrations] aviso ALTER tipo_sessao: ${msg.slice(0, 200)}`);
    }
  }

  // v3.21.0: heuristica retroativa — marca sessoes ja criadas cujo rotulo
  // sugere base (BASE/RCP/B-) como tipo='base'. Idempotente.
  try {
    await pool.execute(
      `UPDATE processamentos_gnss
          SET tipo_sessao = 'base'
        WHERE tipo_sessao = 'vertice'
          AND (rotulo LIKE 'Base%'
            OR rotulo LIKE 'BASE%'
            OR rotulo LIKE 'B-%'
            OR rotulo LIKE 'B\\_%'
            OR rotulo LIKE '%_RCP%')`
    );
    console.log(`[gnss-migrations] OK: heuristica retro tipo='base'`);
  } catch (err) {
    console.warn(`[gnss-migrations] aviso heuristica: ${(err as Error).message.slice(0, 200)}`);
  }

  // v3.21.1: CLEANUP retroativo — apaga vertices fantasma que o auto-aplicar
  // antigo (pre-v3.21.0) criou no laudo a partir de sessoes que agora estao
  // marcadas como tipo='base'. Idempotente: re-execucao no-op quando vazio.
  // Tambem zera processamentos_gnss.ponto_id pra base, pra nao restar referencia.
  try {
    const [delRes] = await pool.execute<import('mysql2').ResultSetHeader>(
      `DELETE p FROM laudos_demarcacao_pontos p
         INNER JOIN processamentos_gnss g ON g.ponto_id = p.id
        WHERE g.tipo_sessao = 'base'`
    );
    const apagados = (delRes as { affectedRows?: number }).affectedRows ?? 0;
    await pool.execute(
      `UPDATE processamentos_gnss SET ponto_id = NULL WHERE tipo_sessao = 'base'`
    );
    if (apagados > 0) {
      console.log(`[gnss-migrations] OK: cleanup ${apagados} vertice(s) fantasma de sessao base`);
    } else {
      console.log(`[gnss-migrations] cleanup vertices base: 0 (ja limpo)`);
    }
  } catch (err) {
    console.warn(`[gnss-migrations] aviso cleanup vertices base: ${(err as Error).message.slice(0, 200)}`);
  }
}
