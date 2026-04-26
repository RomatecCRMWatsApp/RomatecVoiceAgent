import type { RowDataPacket } from 'mysql2';
import pool from './connection';

async function indexExists(table: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, indexName],
  );
  return rows.length > 0;
}

export async function runMigrations(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS zayra_memory (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      type           ENUM('fact','preference','decision','context','reminder') NOT NULL,
      content        TEXT NOT NULL,
      relevance_tags VARCHAR(500),
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      expires_at     TIMESTAMP NULL
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS zayra_conversations (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(100) NOT NULL,
      role       ENUM('user','assistant') NOT NULL,
      content    TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS zayra_chat_sessions (
      id          VARCHAR(100) PRIMARY KEY,
      title       VARCHAR(200),
      channel     ENUM('text','voice','whatsapp','mixed') DEFAULT 'text',
      msg_count   INT DEFAULT 0,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  if (!(await indexExists('zayra_conversations', 'idx_session_created'))) {
    await pool.execute(
      'CREATE INDEX idx_session_created ON zayra_conversations (session_id, created_at)',
    );
  }

  if (!(await indexExists('zayra_conversations', 'idx_content_fulltext'))) {
    try {
      await pool.execute(
        'CREATE FULLTEXT INDEX idx_content_fulltext ON zayra_conversations (content)',
      );
    } catch (err) {
      console.warn('[DB] FULLTEXT index skipped (engine may not support it):', err);
    }
  }

  if (!(await indexExists('zayra_chat_sessions', 'idx_updated'))) {
    await pool.execute(
      'CREATE INDEX idx_updated ON zayra_chat_sessions (updated_at DESC)',
    );
  }

  // v1.13: embeddings vetoriais pra RAG semântico
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS zayra_embeddings (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NOT NULL,
      role            ENUM('user','assistant') NOT NULL,
      content_preview VARCHAR(255),
      vector_json     JSON NOT NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  if (!(await indexExists('zayra_embeddings', 'idx_emb_conv'))) {
    await pool.execute('CREATE INDEX idx_emb_conv ON zayra_embeddings (conversation_id)');
  }
  if (!(await indexExists('zayra_embeddings', 'idx_emb_created'))) {
    await pool.execute('CREATE INDEX idx_emb_created ON zayra_embeddings (created_at DESC)');
  }

  // v1.16: módulo de gestão de obras
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_obras (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      nome                VARCHAR(200) NOT NULL,
      tipo                ENUM('residencial','comercial','industrial','reforma','publica') NOT NULL DEFAULT 'residencial',
      cliente             VARCHAR(200),
      cliente_telefone    VARCHAR(30),
      endereco            VARCHAR(300),
      cidade              VARCHAR(100),
      area_m2             DECIMAL(10,2),
      orcamento           DECIMAL(14,2),
      status              ENUM('planejamento','em_andamento','paralisada','concluida') NOT NULL DEFAULT 'planejamento',
      responsavel_tecnico VARCHAR(200),
      data_inicio         DATE,
      data_previsao       DATE,
      observacoes         TEXT,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_obra_etapas (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      obra_id      INT NOT NULL,
      nome         VARCHAR(200) NOT NULL,
      responsavel  VARCHAR(200),
      data_inicio  DATE,
      data_fim     DATE,
      descricao    TEXT,
      status       ENUM('pendente','em_andamento','concluido','atrasado') NOT NULL DEFAULT 'pendente',
      ordem        INT DEFAULT 0,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_obra (obra_id, ordem)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_obra_transacoes (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      obra_id         INT NOT NULL,
      tipo            ENUM('entrada','saida') NOT NULL,
      categoria       VARCHAR(80),
      descricao       VARCHAR(300) NOT NULL,
      valor           DECIMAL(14,2) NOT NULL,
      data            DATE NOT NULL,
      fornecedor      VARCHAR(200),
      nota_fiscal     VARCHAR(80),
      forma_pagamento ENUM('dinheiro','pix','transferencia','cartao','boleto') DEFAULT 'pix',
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_obra_data (obra_id, data DESC)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_obra_equipe (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      nome           VARCHAR(200) NOT NULL,
      funcao         VARCHAR(120),
      tipo_contrato  ENUM('clt','diarista','empreitada','terceirizado') DEFAULT 'diarista',
      cpf            VARCHAR(20),
      telefone       VARCHAR(30),
      valor_dia      DECIMAL(10,2),
      especialidade  VARCHAR(200),
      observacoes    TEXT,
      ativo          BOOLEAN DEFAULT TRUE,
      obras_ids      VARCHAR(500),
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_obra_materiais (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      nome                 VARCHAR(200) NOT NULL,
      categoria            VARCHAR(120),
      unidade              VARCHAR(20) DEFAULT 'un',
      estoque              DECIMAL(12,3) DEFAULT 0,
      estoque_minimo       DECIMAL(12,3) DEFAULT 0,
      valor_unitario       DECIMAL(12,2),
      fornecedor_principal VARCHAR(200),
      local_armazenamento  VARCHAR(200),
      created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_obra_diario (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      obra_id                  INT NOT NULL,
      data                     DATE NOT NULL,
      clima                    ENUM('sol','nublado','chuva','tempestade') DEFAULT 'sol',
      horario_inicio           TIME,
      horario_fim              TIME,
      quantidade_trabalhadores INT,
      visitas                  VARCHAR(300),
      atividades               TEXT NOT NULL,
      equipe_presente          TEXT,
      ocorrencias              TEXT,
      fotos_urls               TEXT,
      created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_obra_data (obra_id, data DESC)
    )
  `);

  // v1.22: Cowork — tarefas em background
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS zayra_tarefas (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      descricao     VARCHAR(300) NOT NULL,
      prompt        TEXT NOT NULL,
      status        ENUM('pendente','executando','concluida','falhou','cancelada') DEFAULT 'pendente',
      resultado     LONGTEXT,
      tools_usadas  VARCHAR(500),
      erro          TEXT,
      session_id    VARCHAR(100),
      criada_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      iniciada_em   TIMESTAMP NULL,
      concluida_em  TIMESTAMP NULL,
      INDEX idx_status (status, criada_em)
    )
  `);

  // v1.23: Equipe e Materiais linkados por obra (preserva 'global' = NULL)
  await pool.execute(`
    ALTER TABLE romatec_obra_equipe
      ADD COLUMN IF NOT EXISTS obra_id INT NULL AFTER ativo
  `).catch(async () => {
    // MySQL < 8.0 não suporta IF NOT EXISTS em ALTER ADD. Verifica antes.
    const [c] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'romatec_obra_equipe' AND COLUMN_NAME = 'obra_id'`
    );
    if (Number((c[0] as { n: number }).n) === 0) {
      await pool.execute('ALTER TABLE romatec_obra_equipe ADD COLUMN obra_id INT NULL AFTER ativo');
    }
  });
  await pool.execute(`
    ALTER TABLE romatec_obra_materiais
      ADD COLUMN IF NOT EXISTS obra_id INT NULL AFTER local_armazenamento
  `).catch(async () => {
    const [c] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'romatec_obra_materiais' AND COLUMN_NAME = 'obra_id'`
    );
    if (Number((c[0] as { n: number }).n) === 0) {
      await pool.execute('ALTER TABLE romatec_obra_materiais ADD COLUMN obra_id INT NULL AFTER local_armazenamento');
    }
  });

  // v1.21: VTO — Vistoria Técnica de Obra
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_obra_vistorias (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      obra_id      INT NOT NULL,
      data         DATE NOT NULL,
      titulo       VARCHAR(200),
      vistoriador  VARCHAR(200),
      descricao    TEXT NOT NULL,
      observacoes  TEXT,
      pendencias   TEXT,
      status_obra  ENUM('regular','atencao','critica') DEFAULT 'regular',
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_obra_data (obra_id, data DESC)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_obra_vistoria_fotos (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      vistoria_id   INT NOT NULL,
      legenda       VARCHAR(300),
      mime          VARCHAR(50) DEFAULT 'image/jpeg',
      data_base64   LONGTEXT NOT NULL,
      ordem         INT DEFAULT 0,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_vistoria (vistoria_id, ordem)
    )
  `);

  // v1.19: alarmes/despertadores
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS zayra_alarmes (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      titulo          VARCHAR(200) NOT NULL,
      descricao       TEXT,
      trigger_at      DATETIME NOT NULL,
      repeticao       ENUM('uma_vez','diario','semanal','dias_uteis') DEFAULT 'uma_vez',
      canais          VARCHAR(120) DEFAULT 'sse,telegram',
      status          ENUM('ativo','disparado','cancelado') DEFAULT 'ativo',
      ultimo_disparo  DATETIME,
      proximo_disparo DATETIME,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_proximo (proximo_disparo, status)
    )
  `);

  // v1.18: catálogo de profissões da construção civil (referência sindical)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_obra_profissoes_catalogo (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      nome                     VARCHAR(150) NOT NULL UNIQUE,
      categoria                VARCHAR(80),
      valor_dia_referencia     DECIMAL(10,2),
      salario_mensal_referencia DECIMAL(12,2),
      descricao                VARCHAR(500),
      created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed apenas se vazio
  const [c] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM romatec_obra_profissoes_catalogo');
  if (Number((c[0] as { n: number }).n) === 0) {
    const profissoes: [string, string, number, number, string][] = [
      // [nome, categoria, valor_dia_ref, salario_mensal_ref, descricao]
      ['Servente',                  'Auxiliar',     115, 1800, 'Auxilia em todas as etapas, carga/descarga, mistura'],
      ['Meio-oficial',              'Auxiliar',     150, 2300, 'Auxiliar especializado, em transição pra oficial'],
      ['Pedreiro',                  'Alvenaria',    200, 3000, 'Alvenaria, contrapiso, reboco, assentamento'],
      ['Pedreiro de acabamento',    'Alvenaria',    250, 3700, 'Acabamento fino, assentamento de cerâmica/porcelanato'],
      ['Pedreiro fachadista',       'Alvenaria',    320, 4500, 'Especialista em fachadas, andaime, revestimento externo'],
      ['Carpinteiro',               'Madeira',      230, 3400, 'Formas de concreto, esquadrias, telhado'],
      ['Carpinteiro de fôrma',      'Madeira',      250, 3700, 'Especialista em fôrmas pra concreto armado'],
      ['Marceneiro',                'Madeira',      260, 3800, 'Móveis sob medida, esquadrias finas'],
      ['Armador (ferreiro)',        'Estrutura',    230, 3400, 'Corte, dobra e amarração de aço pra concreto armado'],
      ['Soldador',                  'Estrutura',    300, 4400, 'Solda elétrica, MIG/MAG, estruturas metálicas'],
      ['Eletricista predial',       'Instalações',  300, 4500, 'Instalação elétrica residencial e comercial'],
      ['Eletricista industrial',    'Instalações',  380, 5500, 'Quadros, comandos, alta tensão, automação'],
      ['Encanador (bombeiro hidráulico)', 'Instalações', 260, 3800, 'Hidráulica, esgoto, gás'],
      ['Pintor',                    'Acabamento',   210, 3100, 'Pintura geral, massa corrida, textura'],
      ['Pintor de epóxi',           'Acabamento',   320, 4500, 'Pisos industriais, garagens, áreas técnicas'],
      ['Azulejista',                'Acabamento',   300, 4400, 'Assentamento de cerâmica, porcelanato, pastilha'],
      ['Gesseiro',                  'Acabamento',   240, 3500, 'Forro, parede, sanca, drywall'],
      ['Estucador',                 'Acabamento',   250, 3700, 'Reboco fino, decorações em massa'],
      ['Impermeabilizador',         'Acabamento',   300, 4400, 'Manta asfáltica, lajes, banheiros, piscinas'],
      ['Vidraceiro',                'Acabamento',   280, 4100, 'Instalação de vidros, box, espelhos, fachadas'],
      ['Mestre de obras',           'Liderança',    420, 6000, 'Liderança da obra, decisão técnica em campo'],
      ['Encarregado',               'Liderança',    300, 4500, 'Coordena equipes específicas (ex: alvenaria, instalação)'],
      ['Apontador',                 'Apoio',        160, 2400, 'Controle de presença, materiais, diários'],
      ['Almoxarife',                'Apoio',        180, 2700, 'Recebimento, estoque, distribuição de materiais'],
      ['Vigia / Porteiro',          'Apoio',        130, 2000, 'Segurança patrimonial, controle de acesso'],
      ['Auxiliar de limpeza',       'Apoio',        115, 1800, 'Limpeza pós-obra, varrição diária'],
      ['Operador de máquinas',      'Operação',     320, 4700, 'Retroescavadeira, trator, betoneira grande'],
      ['Operador de guincho',       'Operação',     280, 4100, 'Guincho de coluna, elevador de obra'],
      ['Topógrafo',                 'Técnico',      450, 6500, 'Levantamento, locação de obra, nivelamento'],
      ['Engenheiro civil',          'Técnico',      900, 13000, 'Responsável técnico, projeto executivo, ART'],
      ['Arquiteto',                 'Técnico',      850, 12000, 'Projeto arquitetônico, compatibilização, RRT'],
    ];
    for (const [nome, categoria, vd, sm, desc] of profissoes) {
      await pool.execute(
        'INSERT IGNORE INTO romatec_obra_profissoes_catalogo (nome, categoria, valor_dia_referencia, salario_mensal_referencia, descricao) VALUES (?,?,?,?,?)',
        [nome, categoria, vd, sm, desc],
      );
    }
    console.log('[DB] Catálogo de profissões populado:', profissoes.length);
  }

  // v1.17: marcação de dias trabalhados (integral / manhã / tarde)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_obra_funcionario_dias (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      funcionario_id  INT NOT NULL,
      obra_id         INT,
      data            DATE NOT NULL,
      periodo         ENUM('integral','manha','tarde') NOT NULL DEFAULT 'integral',
      valor           DECIMAL(10,2),
      observacoes     TEXT,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_func_data_periodo (funcionario_id, data, periodo),
      INDEX idx_func_mes (funcionario_id, data),
      INDEX idx_obra_data (obra_id, data)
    )
  `);

  console.log('[DB] Migrations complete');
}
