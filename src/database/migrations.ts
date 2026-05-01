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

  // v1.45.0: equipe Romatec (multi-tenant pra Eldemberto, Rosielma, etc)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_team_members (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      nome               VARCHAR(150) NOT NULL,
      telegram_chat_id   VARCHAR(50) UNIQUE,
      whatsapp_phone     VARCHAR(20),
      email              VARCHAR(200),
      role               ENUM('admin','engenheiro','corretor','comercial','leitura') NOT NULL DEFAULT 'leitura',
      cargo              VARCHAR(100),
      ativo              TINYINT(1) DEFAULT 1,
      observacoes        TEXT,
      criado_em          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_telegram (telegram_chat_id),
      INDEX idx_ativo_role (ativo, role)
    )
  `);

  // v1.39.0: alertas proativos (push notifications inteligentes)
  // Cada detector escreve aqui com alert_key único pra dedup (não spamma o CEO).
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_proactive_alerts (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      alert_key        VARCHAR(255) NOT NULL UNIQUE,
      detector         VARCHAR(50) NOT NULL,
      type             VARCHAR(20) NOT NULL DEFAULT 'alert',
      urgency          ENUM('low','medium','high','urgent') DEFAULT 'medium',
      title            VARCHAR(200) NOT NULL,
      message          TEXT NOT NULL,
      payload          JSON,
      first_detected   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_sent        TIMESTAMP NULL,
      send_count       INT DEFAULT 0,
      acknowledged_at  TIMESTAMP NULL,
      silenced_until   TIMESTAMP NULL,
      INDEX idx_silenced (silenced_until),
      INDEX idx_detector (detector, first_detected DESC)
    )
  `);

  // ═══════════════════════════════════════════════════════════════════════════
  // v1.59.0: Schema do CRM WhatsApp (replicado do projeto Romatec_CRM_WhatsApp).
  // Os nomes seguem o original do CRM (camelCase, sem prefixo romatec_) pra
  // que o CRM possa apontar pro mesmo banco no futuro sem precisar
  // remigrar. ZAYRA lê essas tabelas via integrations/crm.ts e
  // services/syncContatosCRM.ts.
  // ═══════════════════════════════════════════════════════════════════════════
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      openId       VARCHAR(64) NOT NULL UNIQUE,
      name         TEXT,
      email        VARCHAR(320),
      loginMethod  VARCHAR(64),
      role         ENUM('user','admin') NOT NULL DEFAULT 'user',
      createdAt    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS contacts (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      name         VARCHAR(255) NOT NULL,
      phone        VARCHAR(20)  NOT NULL UNIQUE,
      email        VARCHAR(255),
      status       ENUM('active','blocked','inactive') NOT NULL DEFAULT 'active',
      blockedUntil TIMESTAMP NULL,
      createdAt    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_created (createdAt DESC)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS properties (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      denomination    VARCHAR(255) NOT NULL,
      address         TEXT NOT NULL,
      city            VARCHAR(255),
      state           VARCHAR(2),
      cep             VARCHAR(10),
      price           DECIMAL(12,2) NOT NULL,
      offerPrice      DECIMAL(12,2),
      description     TEXT,
      images          JSON,
      videoUrl        TEXT,
      plantaBaixaUrl  TEXT,
      areaConstruida  DECIMAL(10,2),
      areaCasa        DECIMAL(10,2),
      areaTerreno     DECIMAL(10,2),
      bedrooms        INT,
      bathrooms       INT,
      garageSpaces    INT,
      propertyType    VARCHAR(100),
      publicSlug      VARCHAR(255),
      finalidade      VARCHAR(20) NOT NULL DEFAULT 'venda',
      status          ENUM('available','sold','inactive') NOT NULL DEFAULT 'available',
      createdAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status   (status),
      INDEX idx_city     (city, state),
      INDEX idx_slug     (publicSlug)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      propertyId               INT NOT NULL,
      name                     VARCHAR(255) NOT NULL,
      status                   ENUM('draft','scheduled','running','paused','completed') NOT NULL DEFAULT 'draft',
      messageVariations        JSON,
      totalContacts            INT DEFAULT 2,
      sentCount                INT DEFAULT 0,
      failedCount              INT DEFAULT 0,
      messagesPerHour          INT DEFAULT 1,
      startDate                TIMESTAMP NULL,
      endDate                  TIMESTAMP NULL,
      activeDay                BOOLEAN NOT NULL DEFAULT FALSE,
      activeNight              BOOLEAN NOT NULL DEFAULT FALSE,
      cycleActivationUpdatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      createdAt                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status   (status),
      INDEX idx_property (propertyId)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS campaignContacts (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      campaignId      INT NOT NULL,
      contactId       INT NOT NULL,
      messagesSent    INT DEFAULT 0,
      lastMessageSent TIMESTAMP NULL,
      status          ENUM('pending','sent','failed','blocked') NOT NULL DEFAULT 'pending',
      createdAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_camp     (campaignId, status),
      INDEX idx_contact  (contactId),
      UNIQUE KEY uniq_camp_contact (campaignId, contactId)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      campaignId    INT NOT NULL,
      contactId     INT NOT NULL,
      propertyId    INT NOT NULL,
      messageText   TEXT NOT NULL,
      status        ENUM('pending','sent','delivered','failed','blocked') NOT NULL DEFAULT 'pending',
      zApiMessageId VARCHAR(255),
      sentAt        TIMESTAMP NULL,
      deliveredAt   TIMESTAMP NULL,
      errorMessage  TEXT,
      createdAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_campaign (campaignId, status),
      INDEX idx_contact  (contactId, sentAt),
      INDEX idx_zapi     (zApiMessageId)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS companyConfig (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      companyName      VARCHAR(255) NOT NULL,
      phone            VARCHAR(20)  NOT NULL,
      address          TEXT,
      zApiInstanceId   VARCHAR(255),
      zApiToken        VARCHAR(255),
      zApiClientToken  VARCHAR(255),
      zApiConnected    BOOLEAN DEFAULT FALSE,
      zApiLastChecked  TIMESTAMP NULL,
      telegramBotToken VARCHAR(255),
      telegramChatId   VARCHAR(100),
      openAiApiKey     VARCHAR(255),
      createdAt        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS interactions (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      messageId    INT NOT NULL,
      contactId    INT NOT NULL,
      campaignId   INT NOT NULL,
      responseText TEXT,
      sentiment    ENUM('positive','negative','neutral','unknown') DEFAULT 'unknown',
      responseTime INT,
      createdAt    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_contact   (contactId, createdAt DESC),
      INDEX idx_campaign  (campaignId)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS contactCampaignHistory (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      contactId      INT NOT NULL,
      campaignId     INT NOT NULL,
      lastCampaignId INT,
      sentAt         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_contact (contactId, sentAt DESC)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS campaignSchedules (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      hourCycle       INT NOT NULL DEFAULT 0,
      campaign1Id     INT NOT NULL,
      campaign2Id     INT NOT NULL,
      message1SentAt  TIMESTAMP NULL,
      message2SentAt  TIMESTAMP NULL,
      status          ENUM('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
      createdAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status, createdAt DESC)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS messageVariations (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      campaignId   INT NOT NULL,
      messageText  TEXT NOT NULL,
      messageOrder INT NOT NULL DEFAULT 0,
      createdAt    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_campaign (campaignId, messageOrder)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS dailyReports (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      date          VARCHAR(10) NOT NULL,
      totalSent     INT NOT NULL DEFAULT 0,
      totalFailed   INT NOT NULL DEFAULT 0,
      totalBlocked  INT NOT NULL DEFAULT 0,
      executionTime INT NOT NULL DEFAULT 0,
      successRate   DECIMAL(5,2) DEFAULT 0,
      createdAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_date (date)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schedulerState (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      status             ENUM('stopped','running','paused') NOT NULL DEFAULT 'stopped',
      currentPairIndex   INT NOT NULL DEFAULT 0,
      cycleNumber        INT NOT NULL DEFAULT 0,
      messagesThisCycle  INT NOT NULL DEFAULT 0,
      startedAt          TIMESTAMP NULL,
      cycleStartedAt     TIMESTAMP NULL,
      stateJson          JSON,
      updatedAt          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS leadQualifications (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      contactId         INT,
      campaignId        INT,
      phone             VARCHAR(20) NOT NULL,
      answers           JSON,
      nome              VARCHAR(255),
      valorParcela      VARCHAR(100),
      valorEntrada      VARCHAR(100),
      tipoEmprego       VARCHAR(100),
      restricaoCPF      VARCHAR(100),
      prazo             VARCHAR(100),
      primeiroImovel    VARCHAR(100),
      stage             VARCHAR(50) DEFAULT 'qual_etapa_1',
      score             ENUM('quente','morno','frio') NOT NULL DEFAULT 'frio',
      campanhaOrigem    VARCHAR(255),
      lastActivityAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      blockedUntil      TIMESTAMP NULL,
      discardReason     VARCHAR(255),
      createdAt         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_phone        (phone),
      INDEX idx_score_act    (score, lastActivityAt DESC),
      INDEX idx_stage        (stage),
      INDEX idx_campaign     (campaignId),
      INDEX idx_contact      (contactId)
    )
  `);

  // v1.61.0: drafts persistentes de WhatsApp.
  // Antes, o draft (preview→confirmação) só vivia no histórico do LLM (truncado em
  // AI_MAX_HISTORY_MESSAGES=12). Quando a conversa passava de 12 turnos OU trocava
  // de provider, o LLM esquecia o conteúdo e pedia reenvio. Solução: persistência
  // em DB com TTL (default 30 min). Tools criam/listam/confirmam/cancelam.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS zayra_whatsapp_drafts (
      id              VARCHAR(36) PRIMARY KEY,
      session_id      VARCHAR(100) NOT NULL,
      destinatario    VARCHAR(20)  NOT NULL,
      conteudo        MEDIUMTEXT   NOT NULL,
      tipo            ENUM('texto','audio','imagem','documento') NOT NULL,
      filename        VARCHAR(255) NULL,
      caption         TEXT         NULL,
      status          ENUM('awaiting_confirmation','sent','cancelled','expired') NOT NULL DEFAULT 'awaiting_confirmation',
      criado_em       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      expira_em       TIMESTAMP    NOT NULL,
      enviado_em      TIMESTAMP    NULL,
      cancelado_em    TIMESTAMP    NULL,
      message_id_zapi VARCHAR(100) NULL,
      INDEX idx_sess_status (session_id, status, expira_em),
      INDEX idx_status_exp  (status, expira_em)
    )
  `);

  // v1.62.0: campos de auditoria pra romatec_obra_transacoes (soft delete + tracking).
  // v1.63.0: 9 colunas novas em romatec_obra_equipe (cadastro completo de membro:
  //          RG, email, data_admissao, endereço completo, foto).
  // Idempotente: cada ALTER em try/catch porque ALTER TABLE ADD COLUMN não tem IF NOT EXISTS no MySQL 5.7/8.0
  // (existe em MariaDB 10.4+ e MySQL 8.0.29+, mas Railway usa imagens variáveis).
  for (const stmt of [
    // v1.62.0
    `ALTER TABLE romatec_obra_transacoes ADD COLUMN deleted_at TIMESTAMP NULL`,
    `ALTER TABLE romatec_obra_transacoes ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
    `ALTER TABLE romatec_obra_transacoes ADD COLUMN updated_by VARCHAR(80) NULL`,
    `ALTER TABLE romatec_obra_transacoes ADD COLUMN deleted_by VARCHAR(80) NULL`,
    `ALTER TABLE romatec_obra_transacoes ADD INDEX idx_obra_deleted (obra_id, deleted_at)`,
    // v1.63.0 — cadastro completo de membro
    `ALTER TABLE romatec_obra_equipe ADD COLUMN rg                VARCHAR(20)  NULL`,
    `ALTER TABLE romatec_obra_equipe ADD COLUMN email             VARCHAR(150) NULL`,
    `ALTER TABLE romatec_obra_equipe ADD COLUMN data_admissao     DATE         NULL`,
    `ALTER TABLE romatec_obra_equipe ADD COLUMN endereco_rua      VARCHAR(200) NULL`,
    `ALTER TABLE romatec_obra_equipe ADD COLUMN endereco_numero   VARCHAR(20)  NULL`,
    `ALTER TABLE romatec_obra_equipe ADD COLUMN endereco_bairro   VARCHAR(120) NULL`,
    `ALTER TABLE romatec_obra_equipe ADD COLUMN endereco_cidade   VARCHAR(120) NULL`,
    `ALTER TABLE romatec_obra_equipe ADD COLUMN endereco_estado   VARCHAR(2)   NULL`,
    `ALTER TABLE romatec_obra_equipe ADD COLUMN endereco_cep      VARCHAR(10)  NULL`,
    `ALTER TABLE romatec_obra_equipe ADD COLUMN foto_url          VARCHAR(500) NULL`,
  ]) {
    try {
      await pool.execute(stmt);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      // Ignora "Duplicate column name" / "Duplicate key name" — coluna/index já existe (idempotência manual).
      if (!/Duplicate column|Duplicate key/i.test(msg)) {
        console.warn(`[DB] migration ALTER falhou (não-bloqueante): ${msg.slice(0, 120)}`);
      }
    }
  }

  console.log('[DB] Migrations complete');
}
