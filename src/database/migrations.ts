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

  // v1.65.40: campos do contrato/cronograma da obra. Adicionados via ALTER
  // pra nao quebrar bancos existentes. Idempotente — IF NOT EXISTS no MySQL
  // 8+ + try/catch fallback pro 5.7.
  for (const col of [
    `ADD COLUMN IF NOT EXISTS valor_contrato DECIMAL(14,2) NULL AFTER orcamento`,
    `ADD COLUMN IF NOT EXISTS prazo_dias INT NULL AFTER data_previsao`,
    `ADD COLUMN IF NOT EXISTS prazo_dias_uteis INT NULL AFTER prazo_dias`,
  ]) {
    await pool.execute(`ALTER TABLE romatec_obras ${col}`).catch(async () => {
      // MySQL < 8 nao suporta IF NOT EXISTS no ADD COLUMN. Verifica antes.
      const colName = (/ADD COLUMN IF NOT EXISTS (\w+)/.exec(col) || [])[1];
      if (!colName) return;
      const [c] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'romatec_obras' AND COLUMN_NAME = ?`,
        [colName]
      );
      if (Number((c[0] as { n: number }).n) === 0) {
        const sql = col.replace('IF NOT EXISTS ', '');
        await pool.execute(`ALTER TABLE romatec_obras ${sql}`);
      }
    });
  }

  // v1.65.40: parcelas de pagamento do cliente (receita da Romatec).
  // Diferente dos recibos quinzenais (pagamento dos trabalhadores).
  // Cada obra tem N parcelas com vencimento+valor. Ao gerar, ZAYRA pode
  // criar evento no Google Calendar pra lembrete + emissao de NF.
  // v1.65.41: +quinzena_inicio/quinzena_fim — define o intervalo da
  // quinzena que essa parcela representa (editavel pelo CEO).
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_obra_parcelas (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      obra_id           INT NOT NULL,
      numero            INT NOT NULL,
      valor             DECIMAL(14,2) NOT NULL,
      vencimento        DATE NOT NULL,
      prazo_dias        INT,
      quinzena_inicio   DATE,
      quinzena_fim      DATE,
      pago              TINYINT(1) DEFAULT 0,
      pago_em           TIMESTAMP NULL,
      observacoes       VARCHAR(300),
      calendar_event_id VARCHAR(120),
      nf_numero         VARCHAR(50),
      nf_emitida_em     TIMESTAMP NULL,
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_obra (obra_id),
      INDEX idx_venc (vencimento, pago)
    )
  `);

  // v1.65.41: ALTER idempotente pra DBs ja existentes
  for (const col of [`ADD COLUMN IF NOT EXISTS quinzena_inicio DATE NULL AFTER prazo_dias`,
                     `ADD COLUMN IF NOT EXISTS quinzena_fim DATE NULL AFTER quinzena_inicio`]) {
    await pool.execute(`ALTER TABLE romatec_obra_parcelas ${col}`).catch(async () => {
      const colName = (/ADD COLUMN IF NOT EXISTS (\w+)/.exec(col) || [])[1];
      if (!colName) return;
      const [c] = await pool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'romatec_obra_parcelas' AND COLUMN_NAME = ?`,
        [colName]
      );
      if (Number((c[0] as { n: number }).n) === 0) {
        await pool.execute(`ALTER TABLE romatec_obra_parcelas ${col.replace('IF NOT EXISTS ', '')}`);
      }
    });
  }

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
  // v1.65.23: log explicito + try/catch isolado pra evitar que falha aqui
  // pare o resto do migration. Issue #5 reportou que essa tabela estava
  // ausente do Railway apesar de definida aqui.
  try {
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
    console.log('[DB] romatec_team_members OK');
  } catch (err) {
    console.error('[DB] FALHA em romatec_team_members:', (err as Error).message);
  }

  // v1.39.0: alertas proativos (push notifications inteligentes)
  // Cada detector escreve aqui com alert_key único pra dedup (não spamma o CEO).
  try {
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
    console.log('[DB] romatec_proactive_alerts OK');
  } catch (err) {
    console.error('[DB] FALHA em romatec_proactive_alerts:', (err as Error).message);
  }

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
    // v1.65.10 — PR A: sync Equipe ↔ contacts ↔ memória ZAYRA
    // contacts ganha tratamento (Eng./Sr./Sra./Dr./...) + tom (formal/informal)
    // + tipo (cliente/colaborador/fornecedor/...) + tags (JSON array de strings)
    `ALTER TABLE contacts ADD COLUMN tratamento VARCHAR(40)  NULL`,
    `ALTER TABLE contacts ADD COLUMN tom        VARCHAR(20)  NULL DEFAULT 'formal'`,
    `ALTER TABLE contacts ADD COLUMN tipo       VARCHAR(40)  NULL`,
    `ALTER TABLE contacts ADD COLUMN tags       JSON         NULL`,
    `ALTER TABLE contacts ADD INDEX idx_tipo (tipo)`,
    // romatec_obra_equipe ganha link pra contacts + chave PIX (futuro fluxo de recibos)
    `ALTER TABLE romatec_obra_equipe ADD COLUMN contact_id              INT          NULL`,
    `ALTER TABLE romatec_obra_equipe ADD COLUMN chave_pix               VARCHAR(150) NULL`,
    `ALTER TABLE romatec_obra_equipe ADD COLUMN chave_pix_atualizada_em TIMESTAMP    NULL`,
    `ALTER TABLE romatec_obra_equipe ADD INDEX idx_contact (contact_id)`,
    // v1.65.19 — PR confirmação web: token único por envio (link clicável que vira botão no WhatsApp)
    `ALTER TABLE recibos_envios ADD COLUMN token_confirmacao VARCHAR(36) NULL`,
    `ALTER TABLE recibos_envios ADD UNIQUE INDEX uniq_token_confirmacao (token_confirmacao)`,
    // v1.65.55 — status do colaborador (tag visual em cada card de equipe).
    // 'ativo' = trabalhando normalmente; outros = não computa em folha/marcações.
    `ALTER TABLE romatec_obra_equipe ADD COLUMN status ENUM('ativo','ausente','doente','ferias','afastado','transferido','desligado') NOT NULL DEFAULT 'ativo' AFTER ativo`,
    `ALTER TABLE romatec_obra_equipe ADD INDEX idx_status (status)`,
    // v1.65.60 — leads AvalieImob: campo Telegram pra DBs ja existentes
    `ALTER TABLE romatec_avalieimob_leads ADD COLUMN ja_notificou_telegram BOOLEAN DEFAULT FALSE AFTER ja_notificou_ceo`,
  ]) {
    try {
      await pool.execute(stmt);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (!/Duplicate column|Duplicate key/i.test(msg)) {
        console.warn(`[DB] migration ALTER falhou (não-bloqueante): ${msg.slice(0, 120)}`);
      }
    }
  }

  // v1.65.60: leads do AvalieImob — captura cadastros + assinaturas vindos do
  // SEO/Google/Facebook ads pra ZAYRA monitorar. Webhook recebido em
  // POST /api/avalieimob/lead-webhook dispara INSERT/UPDATE nesta tabela
  // + notifica CEO via WhatsApp/email + auto-resposta opcional pro lead.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_avalieimob_leads (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      external_id     VARCHAR(120) NULL,
      event_type      ENUM('cadastro','assinatura','login','outro') NOT NULL DEFAULT 'cadastro',
      name            VARCHAR(200) NOT NULL,
      email           VARCHAR(200) NOT NULL,
      phone           VARCHAR(40)  NULL,
      role            VARCHAR(120) NULL,
      crea            VARCHAR(40)  NULL,
      utm_source      VARCHAR(100) NULL,
      utm_medium      VARCHAR(100) NULL,
      utm_campaign    VARCHAR(150) NULL,
      utm_content     VARCHAR(150) NULL,
      utm_term        VARCHAR(150) NULL,
      page_origin     VARCHAR(500) NULL,
      referrer        VARCHAR(500) NULL,
      assinatura_plano VARCHAR(60) NULL,
      assinatura_valor DECIMAL(10,2) NULL,
      ja_notificou_ceo BOOLEAN DEFAULT FALSE,
      ja_notificou_telegram BOOLEAN DEFAULT FALSE,
      ja_respondeu_lead BOOLEAN DEFAULT FALSE,
      payload_raw     JSON NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_email (email),
      INDEX idx_event_created (event_type, created_at DESC),
      INDEX idx_utm_source (utm_source),
      INDEX idx_external (external_id)
    )
  `);

  // v1.64.0: tenant_settings — preparação white-label estrutural.
  // Mono-tenant agora (Romatec). Estrutura pronta pra trocar logo/marca via UPDATE
  // quando virar SaaS. NÃO inclui multi-tenant real (auth, isolamento, billing).
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tenant_settings (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id          INT NOT NULL DEFAULT 1,
      brand_name         VARCHAR(150) NOT NULL,
      brand_short_name   VARCHAR(50),
      logo_path          VARCHAR(500),
      primary_color      VARCHAR(7) DEFAULT '#10b981',
      document_footer    TEXT,
      cnpj               VARCHAR(20),
      endereco           VARCHAR(255),
      telefone           VARCHAR(20),
      email              VARCHAR(150),
      site               VARCHAR(150),
      atualizado_em      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_tenant (tenant_id)
    )
  `);
  // Insert padrão Romatec (idempotente — INSERT IGNORE não falha se já existir)
  await pool.execute(`
    INSERT IGNORE INTO tenant_settings
      (tenant_id, brand_name, brand_short_name, logo_path, primary_color, cnpj, telefone, email)
    VALUES
      (1, 'Romatec Consultoria Imobiliária', 'Romatec', '/logo_R-removebg-preview.png', '#10b981',
       NULL, NULL, 'romateccrm@gmail.com')
  `);
  // v1.65.1: migra logos antigos (jpg, removebg-preview anterior) pro novo PNG transparente
  await pool.execute(`
    UPDATE tenant_settings
       SET logo_path = '/logo_R-removebg-preview.png'
     WHERE tenant_id = 1
       AND logo_path IN (
         '/romatec-logo.jpg',
         '/LOGO ROMATEC ATUAL.jpg',
         '/LOGO%20ROMATEC%20ATUAL.jpg',
         '/romatec-logo-removebg-preview.png'
       )
  `);

  // v1.65.0: Implementação 1 — Proposta de Mão de Obra (schema + catálogo SINAPI)
  // 4 tabelas: catálogo de serviços, clientes da proposta (separado do CRM),
  // propostas e itens de cada proposta.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sinapi_servicos (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      codigo_sinapi        VARCHAR(20),
      categoria            VARCHAR(80) NOT NULL,
      subcategoria         VARCHAR(80),
      descricao            VARCHAR(255) NOT NULL,
      unidade              VARCHAR(10) NOT NULL,
      valor_referencia     DECIMAL(10,2),
      valor_e_referencial  BOOLEAN DEFAULT TRUE,
      ativo                BOOLEAN DEFAULT TRUE,
      atualizado_em        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_categoria  (categoria, ativo),
      INDEX idx_codigo     (codigo_sinapi)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS propostas_clientes (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      nome            VARCHAR(150) NOT NULL,
      cpf_cnpj        VARCHAR(20),
      telefone        VARCHAR(20),
      email           VARCHAR(150),
      endereco        VARCHAR(255),
      cidade          VARCHAR(80),
      estado          VARCHAR(2),
      cep             VARCHAR(10),
      observacoes     TEXT,
      criado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at      TIMESTAMP NULL,
      INDEX idx_nome  (nome),
      INDEX idx_del   (deleted_at)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS propostas (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      numero            VARCHAR(20) NOT NULL UNIQUE,
      cliente_id        INT NOT NULL,
      endereco_obra     VARCHAR(255),
      data_proposta     DATE NOT NULL,
      validade_dias     INT DEFAULT 15,
      valor_total       DECIMAL(12,2) NOT NULL DEFAULT 0,
      observacoes       TEXT,
      status            ENUM('rascunho','enviada','aceita','recusada','expirada') DEFAULT 'rascunho',
      pdf_path          VARCHAR(500),
      enviada_whatsapp  BOOLEAN DEFAULT FALSE,
      enviada_em        TIMESTAMP NULL,
      criada_por        VARCHAR(80),
      criado_em         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at        TIMESTAMP NULL,
      INDEX idx_status  (status, deleted_at),
      INDEX idx_cliente (cliente_id),
      INDEX idx_numero  (numero)
    )
  `);

  // v1.67.0: Despesas Extras — gastos avulsos vinculados a obras (ferramentas,
  // alugueis, materiais avulsos) FORA do orcamento de empreita/diaria. Somam
  // no Consumo da obra junto com obras_transacoes.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS despesas_extras (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      obra_id         INT NOT NULL,
      data            DATE NOT NULL,
      loja            VARCHAR(120) NOT NULL,
      categoria       ENUM('ferramenta','aluguel','material','outros') NOT NULL DEFAULT 'outros',
      forma_pagamento ENUM('pix','dinheiro','cartao_credito','cartao_debito','boleto') NOT NULL DEFAULT 'pix',
      foto_b64        LONGTEXT,
      foto_mimetype   VARCHAR(40),
      observacoes     TEXT,
      valor_total     DECIMAL(10,2) NOT NULL DEFAULT 0,
      created_by      VARCHAR(80),
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at      TIMESTAMP NULL,
      INDEX idx_obra      (obra_id, deleted_at),
      INDEX idx_data      (data),
      INDEX idx_categoria (categoria)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS despesas_extras_itens (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      despesa_id  INT NOT NULL,
      descricao   VARCHAR(200) NOT NULL,
      valor       DECIMAL(10,2) NOT NULL,
      quantidade  DECIMAL(10,3) NOT NULL DEFAULT 1,
      ordem       INT NOT NULL DEFAULT 0,
      INDEX idx_despesa (despesa_id, ordem)
    )
  `);
  // v1.67.2/.11: campos novos. Idempotente — ignora "Duplicate column".
  for (const col of [
    "ALTER TABLE despesas_extras_itens ADD COLUMN quantidade DECIMAL(10,3) NOT NULL DEFAULT 1 AFTER valor",
    "ALTER TABLE despesas_extras ADD COLUMN desconto DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER valor_total",
    "ALTER TABLE despesas_extras ADD COLUMN destinatario VARCHAR(120) NULL AFTER loja",
  ]) {
    try { await pool.execute(col); }
    catch (err) {
      if (!/Duplicate column|already exists/i.test((err as Error).message)) {
        console.warn('[migrations] alter despesas falhou:', (err as Error).message.slice(0, 100));
      }
    }
  }

  // v1.66.9: anexos da Proposta de Consultoria (Planta Arquitetonica/Mapa).
  // Aceita PDF, PNG, JPEG. Sem limite de quantidade. Conteudo em base64
  // (LONGTEXT — ate 4GB; impomos limite ~10MB por anexo no client).
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS proposta_anexos (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      proposta_id   INT NOT NULL,
      filename      VARCHAR(255) NOT NULL,
      mimetype      VARCHAR(100) NOT NULL,
      tamanho_bytes INT NOT NULL,
      conteudo_b64  LONGTEXT NOT NULL,
      ordem         INT DEFAULT 0,
      criado_em     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_proposta (proposta_id, ordem)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS proposta_itens (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      proposta_id       INT NOT NULL,
      servico_id        INT,
      descricao         VARCHAR(255) NOT NULL,
      unidade           VARCHAR(10) NOT NULL,
      quantidade        DECIMAL(10,2) NOT NULL,
      valor_unitario    DECIMAL(10,2) NOT NULL,
      valor_total       DECIMAL(12,2) NOT NULL,
      ordem             INT DEFAULT 0,
      criado_em         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_proposta (proposta_id, ordem)
    )
  `);

  // Catálogo SINAPI inicial — ~100 itens em 12 categorias.
  // Valores são ESTIMATIVAS de mercado (briefing autorizou: valor_e_referencial=TRUE).
  // Atualizar manualmente quando SINAPI oficial for consultada.
  // INSERT IGNORE em chunks pra não duplicar se rodar de novo.
  // Desambiguação por descricao (não tem UNIQUE — confiamos no IGNORE de PRIMARY).
  await popularCatalogoSinapi();

  // v1.65.5: campos do gestor/indicador da proposta (sai no relatório)
  // v1.66.0: campos pra Proposta de Consultoria (averbacao, georref, desm, retif, ptam)
  for (const col of [
    "ADD COLUMN gestor_cargo    VARCHAR(40)  DEFAULT NULL AFTER criada_por",
    "ADD COLUMN gestor_nome     VARCHAR(150) DEFAULT NULL AFTER gestor_cargo",
    "ADD COLUMN gestor_telefone VARCHAR(20)  DEFAULT NULL AFTER gestor_nome",
    "ADD COLUMN tipo            ENUM('mao_de_obra','consultoria') NOT NULL DEFAULT 'mao_de_obra' AFTER numero",
    "ADD COLUMN subtipo_consultoria VARCHAR(40) DEFAULT NULL AFTER tipo",
    "ADD COLUMN dados_imovel    JSON DEFAULT NULL",
    "ADD COLUMN custos_calculados JSON DEFAULT NULL",
    "ADD COLUMN fontes_consulta JSON DEFAULT NULL",
  ]) {
    try { await pool.execute(`ALTER TABLE propostas ${col}`); }
    catch (err) {
      if (!/Duplicate column|already exists/i.test((err as Error).message)) {
        console.warn('[migrations] alter propostas falhou (não-bloqueante):', (err as Error).message.slice(0, 100));
      }
    }
  }

  // v1.65.13 — PR B.2: lotes de envio quinzenal (estado de cada disparo +
  // trilha de auditoria de toda mensagem trocada). PR B.3 adicionará handler
  // de respostas (1/2/PIX) que vai mutar status pra confirmado_aguardando_pix
  // / contestado / pix_recebido.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS recibos_envios_lotes (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      numero               VARCHAR(30) NOT NULL UNIQUE,
      periodo              VARCHAR(10) NOT NULL,
      periodo_inicio       DATE NOT NULL,
      periodo_fim          DATE NOT NULL,
      total_colaboradores  INT NOT NULL DEFAULT 0,
      total_valor          DECIMAL(12,2) NOT NULL DEFAULT 0,
      status               ENUM('rascunho','aguardando_confirmacao_ceo','enviando','concluido','cancelado')
                             NOT NULL DEFAULT 'rascunho',
      criado_por           VARCHAR(80),
      criado_em            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      confirmado_em        TIMESTAMP NULL,
      concluido_em         TIMESTAMP NULL,
      observacoes          TEXT,
      INDEX idx_periodo_status (periodo, status)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS recibos_envios (
      id                            INT AUTO_INCREMENT PRIMARY KEY,
      lote_id                       INT NOT NULL,
      membro_id                     INT NOT NULL,
      telefone                      VARCHAR(20),
      recibo_hash                   VARCHAR(64),
      valor                         DECIMAL(10,2) NOT NULL DEFAULT 0,
      status                        ENUM(
                                      'pendente_envio',
                                      'enviado_aguardando_confirmacao',
                                      'confirmado_aguardando_pix',
                                      'pix_recebido',
                                      'contestado',
                                      'expirado',
                                      'pago',
                                      'pulado_sem_telefone',
                                      'falha_envio'
                                    ) NOT NULL DEFAULT 'pendente_envio',
      enviado_em                    TIMESTAMP NULL,
      confirmado_em                 TIMESTAMP NULL,
      pix_recebido_em               TIMESTAMP NULL,
      pago_em                       TIMESTAMP NULL,
      confirmacao_resposta          TEXT,
      confirmacao_numero_origem     VARCHAR(20),
      confirmacao_message_id        VARCHAR(120),
      chave_pix                     VARCHAR(150),
      tipo_chave_pix                ENUM('cpf','cnpj','email','telefone','aleatoria') NULL,
      contestacao_motivo            TEXT,
      contestacao_repassada_ceo_em  TIMESTAMP NULL,
      tentativas_envio              INT NOT NULL DEFAULT 0,
      ultimo_erro                   TEXT,
      criado_em                     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em                 TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_lote_status   (lote_id, status),
      INDEX idx_membro        (membro_id),
      INDEX idx_telefone      (telefone),
      INDEX idx_status        (status)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS recibos_envios_mensagens (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      envio_id        INT NOT NULL,
      direcao         ENUM('saida','entrada') NOT NULL,
      tipo            ENUM('pdf_recibo','solicitacao_confirmacao','solicitacao_pix',
                           'confirmacao','pix','contestacao','aviso','outro') NOT NULL,
      conteudo        TEXT,
      message_id_zapi VARCHAR(120),
      enviado_em      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_envio (envio_id, enviado_em)
    )
  `);

  // v1.65.12 — PR B.1: ajustes do recibo quinzenal + emissões com hash de validação.
  // Período no formato "YYYY-MM-1" (dias 1-15) ou "YYYY-MM-2" (dias 16-fim).
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS recibos_ajustes (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      membro_id   INT NOT NULL,
      periodo     VARCHAR(10) NOT NULL,
      tipo        ENUM('desconto','adiantamento','bonus','horas_extras') NOT NULL,
      valor       DECIMAL(10,2) NOT NULL,
      descricao   VARCHAR(255),
      criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      criado_por  VARCHAR(80),
      INDEX idx_membro_periodo (membro_id, periodo)
    )
  `);
  // Snapshot dos recibos emitidos (assinatura digital via QR-code).
  // Armazena o estado congelado do recibo no momento da emissão.
  // Re-emitir mesma quinzena cria novo registro com novo hash — assim
  // recibos antigos continuam validáveis mesmo após edições.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS recibos_quinzena_emitidos (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      hash            VARCHAR(64) NOT NULL UNIQUE,
      membro_id       INT NOT NULL,
      periodo         VARCHAR(10) NOT NULL,
      total_dias      DECIMAL(5,1) NOT NULL,
      valor_diarias   DECIMAL(10,2) NOT NULL,
      total_ajustes   DECIMAL(10,2) NOT NULL DEFAULT 0,
      total_liquido   DECIMAL(10,2) NOT NULL,
      snapshot_json   JSON NOT NULL,
      emitido_em      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_membro_periodo (membro_id, periodo, emitido_em)
    )
  `);

  // v1.65.23: verificacao final das tabelas criticas. Se alguma das duas
  // tabelas centrais (romatec_team_members, romatec_proactive_alerts) nao
  // existir apos o run inteiro, loga warning e tenta recriar isolado.
  // Resolve Issue #5 onde essas tabelas estavam ausentes em prod apesar
  // de definidas aqui.
  await verifyCriticalTables();

  console.log('[DB] Migrations complete');
}

// v1.65.23: validador de tabelas criticas. Retorna lista de tabelas
// presentes/ausentes pra debug via /health/db.
const CRITICAL_TABLES = [
  'romatec_team_members',
  'romatec_proactive_alerts',
  'zayra_memory',
  'zayra_conversations',
  'romatec_obras',
  'romatec_obra_equipe',
] as const;

export async function listExistingTables(): Promise<string[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
  );
  return rows.map((r) => String((r as { name: string }).name));
}

export async function checkCriticalTables(): Promise<{ present: string[]; missing: string[] }> {
  const all = await listExistingTables();
  const allLower = new Set(all.map((t) => t.toLowerCase()));
  const present: string[] = [];
  const missing: string[] = [];
  for (const t of CRITICAL_TABLES) {
    if (allLower.has(t.toLowerCase())) present.push(t);
    else missing.push(t);
  }
  return { present, missing };
}

async function verifyCriticalTables(): Promise<void> {
  const status = await checkCriticalTables();
  if (status.missing.length === 0) {
    console.log(`[DB] Tabelas criticas OK: ${status.present.length}/${CRITICAL_TABLES.length}`);
    return;
  }
  console.warn(`[DB] ⚠️ Tabelas criticas AUSENTES: ${status.missing.join(', ')}`);

  // Retry isolado das que falharam — usa as mesmas definicoes acima.
  if (status.missing.includes('romatec_team_members')) {
    try {
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
      console.log('[DB] retry romatec_team_members OK');
    } catch (err) {
      console.error('[DB] retry romatec_team_members falhou:', (err as Error).message);
    }
  }

  if (status.missing.includes('romatec_proactive_alerts')) {
    try {
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
      console.log('[DB] retry romatec_proactive_alerts OK');
    } catch (err) {
      console.error('[DB] retry romatec_proactive_alerts falhou:', (err as Error).message);
    }
  }
}

// v1.65.0: catálogo SINAPI inicial (~100 itens em 12 categorias).
// Idempotente via INSERT IGNORE (UNIQUE descricao+unidade).
// Adiciona UNIQUE KEY se ainda não existe.
async function popularCatalogoSinapi(): Promise<void> {
  // Adiciona UNIQUE pra desambiguar (idempotente)
  try {
    await pool.execute(`ALTER TABLE sinapi_servicos ADD UNIQUE KEY uk_desc_unidade (descricao, unidade)`);
  } catch (err) {
    if (!/Duplicate key|already exists/i.test((err as Error).message)) {
      console.warn('[sinapi] add unique key falhou (não-bloqueante):', (err as Error).message.slice(0, 80));
    }
  }

  // Verifica se já tem dados — se sim, pula populacao (não força update de valores).
  // Atualizar valores SINAPI no futuro deve ser via tool dedicada, não no boot.
  type Cnt = { c: number };
  const [rowsAny] = await pool.execute(`SELECT COUNT(*) AS c FROM sinapi_servicos`);
  const c = Number((rowsAny as Cnt[])[0]?.c ?? 0);
  if (c >= 80) {
    return; // já populado
  }

  // [categoria, subcategoria, codigo_sinapi(opcional), descricao, unidade, valor_referencia]
  const itens: Array<[string, string | null, string | null, string, string, number]> = [
    // Cobertura/Telhado (8)
    ['Cobertura', 'Cerâmico',     '94209', 'Telha cerâmica colonial — assentamento + estrutura simples',        'm²',  85.00],
    ['Cobertura', 'Cerâmico',     null,    'Telha cerâmica francesa — assentamento + estrutura',                 'm²',  90.00],
    ['Cobertura', 'Fibrocimento', '94216', 'Telha fibrocimento 6mm — assentamento + tesouras de madeira',        'm²',  60.00],
    ['Cobertura', 'Metálico',     null,    'Telha metálica trapezoidal — instalação',                            'm²',  70.00],
    ['Cobertura', 'Manta',        null,    'Manta asfáltica aluminizada — aplicação',                            'm²',  35.00],
    ['Cobertura', 'Acessórios',   null,    'Calha em chapa galvanizada — instalação',                            'm',   45.00],
    ['Cobertura', 'Acessórios',   null,    'Rufo em chapa galvanizada — instalação',                             'm',   38.00],
    ['Cobertura', 'Demolição',    null,    'Remoção de cobertura existente (telhas + estrutura)',                'm²',  30.00],
    // Alvenaria/Estrutura (10)
    ['Alvenaria', 'Tijolo',       '87504', 'Elevação de parede — tijolo cerâmico 9x19x19 — espessura ½ vez',     'm²',  90.00],
    ['Alvenaria', 'Bloco',        null,    'Elevação de parede — bloco de concreto 14x19x39 — espessura ½ vez',  'm²',  95.00],
    ['Alvenaria', 'Tijolo',       null,    'Elevação de parede — tijolo cerâmico 9x14x19 — espessura 1 vez',     'm²', 130.00],
    ['Alvenaria', 'Demolição',    null,    'Demolição de parede de alvenaria (com remoção de entulho)',          'm²',  45.00],
    ['Alvenaria', 'Reboco',       '87775', 'Reboco interno (massa única) — espessura 2cm',                       'm²',  35.00],
    ['Alvenaria', 'Reboco',       null,    'Reboco externo — espessura 2,5cm',                                   'm²',  42.00],
    ['Alvenaria', 'Chapisco',     '87878', 'Chapisco de cimento e areia 1:3',                                    'm²',  12.00],
    ['Alvenaria', 'Estrutural',   null,    'Concreto estrutural — laje pré-moldada (mão de obra)',               'm²', 110.00],
    ['Alvenaria', 'Estrutural',   null,    'Pilar de concreto armado — execução (forma + ferro + concreto)',     'm³', 850.00],
    ['Alvenaria', 'Estrutural',   null,    'Viga de concreto armado — execução',                                 'm³', 800.00],
    // Pisos (10)
    ['Pisos',     'Cerâmico',     '87248', 'Assentamento piso cerâmico 45x45 (excl. material)',                  'm²',  55.00],
    ['Pisos',     'Porcelanato',  '87263', 'Assentamento piso porcelanato 60x60 (excl. material)',               'm²',  75.00],
    ['Pisos',     'Porcelanato',  null,    'Assentamento piso porcelanato 80x80 retificado',                     'm²',  85.00],
    ['Pisos',     'Esmaltado',    null,    'Assentamento piso esmaltado padrão',                                 'm²',  50.00],
    ['Pisos',     'Laminado',     null,    'Instalação piso laminado 7mm — clicado',                             'm²',  45.00],
    ['Pisos',     'Vinílico',     null,    'Instalação piso vinílico em manta',                                  'm²',  55.00],
    ['Pisos',     'Contrapiso',   '87752', 'Contrapiso de concreto magro — espessura 5cm',                       'm²',  38.00],
    ['Pisos',     'Regularização',null,    'Regularização de piso com argamassa — espessura 3cm',                'm²',  28.00],
    ['Pisos',     'Rejunte',      null,    'Aplicação de rejunte (até 3mm)',                                     'm²',   8.00],
    ['Pisos',     'Demolição',    null,    'Demolição de piso cerâmico/porcelanato com remoção',                 'm²',  35.00],
    // Revestimento de paredes (10)
    ['Revestimento','Azulejo',    '87264', 'Assentamento azulejo 30x40 — banheiro/cozinha (excl. material)',     'm²',  60.00],
    ['Revestimento','Cerâmica',   null,    'Assentamento cerâmica padrão 25x40 em parede',                       'm²',  55.00],
    ['Revestimento','Porcelanato',null,    'Porcelanato em parede 60x60 retificado',                             'm²',  90.00],
    ['Revestimento','Gesso',      null,    'Aplicação de gesso liso em paredes — interior',                      'm²',  25.00],
    ['Revestimento','Massa',      '88485', 'Massa corrida em paredes (2 demãos)',                                'm²',  18.00],
    ['Revestimento','Pintura',    '88489', 'Pintura látex acrílica — paredes (2 demãos)',                        'm²',  22.00],
    ['Revestimento','Pintura',    null,    'Pintura esmalte sintético em portas/grades (3 demãos)',              'm²',  35.00],
    ['Revestimento','Pintura',    null,    'Pintura textura projetada (1 demão)',                                'm²',  28.00],
    ['Revestimento','Pintura',    null,    'Pintura epóxi piso/área molhada',                                    'm²',  45.00],
    ['Revestimento','Lixamento',  null,    'Lixamento e preparo de parede pra pintura',                          'm²',  10.00],
    // Hidráulica (10)
    ['Hidráulica','Banheiro',     null,    'Instalação hidráulica completa de banheiro padrão (água+esgoto)',    'vb', 1800.00],
    ['Hidráulica','Cozinha',      null,    'Instalação hidráulica completa de cozinha padrão',                   'vb', 1500.00],
    ['Hidráulica','Área serviço', null,    'Instalação hidráulica área de serviço (tanque+máquina+ralo)',        'vb',  900.00],
    ['Hidráulica','Tubulação',    null,    'Tubulação PVC água fria 25mm — m linear instalado',                  'm',   18.00],
    ['Hidráulica','Tubulação',    null,    'Tubulação PVC esgoto 100mm — m linear instalado',                    'm',   28.00],
    ['Hidráulica','Registro',     null,    'Instalação de registro/válvula descarga',                            'un', 120.00],
    ['Hidráulica','Caixa',        null,    'Instalação caixa de água 1000L — fibra (excl. material)',            'un', 350.00],
    ['Hidráulica','Caixa',        null,    'Instalação caixa de passagem/inspeção esgoto',                       'un', 180.00],
    ['Hidráulica','Aquecedor',    null,    'Instalação de aquecedor a gás de passagem',                          'un', 280.00],
    ['Hidráulica','Reparo',       null,    'Conserto de vazamento (até 2h de serviço)',                          'h',   80.00],
    // Sanitária (6)
    ['Sanitária', 'Bacia',        null,    'Instalação de bacia sanitária com caixa acoplada',                   'un', 180.00],
    ['Sanitária', 'Lavatório',    null,    'Instalação de lavatório com coluna ou bancada',                      'un', 150.00],
    ['Sanitária', 'Chuveiro',     null,    'Instalação de chuveiro elétrico ou ducha',                           'un', 120.00],
    ['Sanitária', 'Acessórios',   null,    'Instalação de ralo sifonado',                                        'un',  60.00],
    ['Sanitária', 'Acessórios',   null,    'Instalação de papeleira/saboneteira/toalheiro (jogo 5 peças)',       'vb', 120.00],
    ['Sanitária', 'Bidê',         null,    'Instalação de bidê',                                                 'un', 150.00],
    // Elétrica (10)
    ['Elétrica',  'Completa',     null,    'Instalação elétrica completa (residência até 80m²)',                 'vb', 4500.00],
    ['Elétrica',  'Completa',     null,    'Instalação elétrica completa (residência 80-150m²)',                 'vb', 7500.00],
    ['Elétrica',  'Fiação',       null,    'Troca de fiação ponto a ponto — m de fiação',                        'm',   12.00],
    ['Elétrica',  'Quadro',       null,    'Instalação de quadro de distribuição até 12 disjuntores',            'un', 380.00],
    ['Elétrica',  'Tomada',       null,    'Instalação de tomada 2P+T 10A/20A',                                  'un',  35.00],
    ['Elétrica',  'Interruptor',  null,    'Instalação de interruptor simples/paralelo',                         'un',  30.00],
    ['Elétrica',  'Luminária',    null,    'Instalação de luminária de teto (plafon, painel LED)',               'un',  45.00],
    ['Elétrica',  'Luminária',    null,    'Instalação de spot/embutido com furo no gesso',                      'un',  55.00],
    ['Elétrica',  'Eletroduto',   null,    'Eletroduto PVC ½" — passagem em alvenaria (m linear)',               'm',   18.00],
    ['Elétrica',  'Aterramento',  null,    'Sistema de aterramento (haste + cabo até 10m)',                      'vb', 280.00],
    // Esquadrias (6)
    ['Esquadrias','Porta',        null,    'Instalação de porta de madeira completa (folha + batente + alizar)', 'un', 280.00],
    ['Esquadrias','Porta',        null,    'Instalação de porta de alumínio para banheiro',                      'un', 220.00],
    ['Esquadrias','Janela',       null,    'Instalação de janela de alumínio 1,2 x 1m com vidro',                'un', 320.00],
    ['Esquadrias','Janela',       null,    'Instalação de janela basculante 0,6x0,5m',                           'un', 180.00],
    ['Esquadrias','Fechadura',    null,    'Troca/instalação de fechadura simples',                              'un',  90.00],
    ['Esquadrias','Vidro',        null,    'Vidro temperado 8mm — instalação (m²)',                              'm²', 350.00],
    // Forros (4)
    ['Forros',    'Gesso',        null,    'Instalação de forro de gesso liso',                                  'm²',  65.00],
    ['Forros',    'Gesso',        null,    'Forro de gesso com sancas/rebaixos',                                 'm²',  85.00],
    ['Forros',    'PVC',          null,    'Instalação de forro de PVC',                                         'm²',  55.00],
    ['Forros',    'Madeira',      null,    'Forro de réguas de madeira (lambri)',                                'm²',  90.00],
    // Externos (6)
    ['Externos',  'Calçada',      null,    'Calçada de concreto desempenado — espessura 7cm',                    'm²',  85.00],
    ['Externos',  'Calçada',      null,    'Calçada com pedra portuguesa/intertravado',                          'm²', 110.00],
    ['Externos',  'Muro',         null,    'Construção de muro de alvenaria H=2m com pintura',                   'm', 280.00],
    ['Externos',  'Portão',       null,    'Instalação de portão social metálico',                               'un', 450.00],
    ['Externos',  'Portão',       null,    'Instalação de portão de garagem basculante manual',                  'un', 850.00],
    ['Externos',  'Jardim',       null,    'Plantio e preparo de gramado em rolo',                               'm²',  35.00],
    // Pacotes completos (4)
    ['Pacotes',   'Banheiro',     null,    'Banheiro completo padrão (3m²) — mão de obra completa',              'vb', 5500.00],
    ['Pacotes',   'Banheiro',     null,    'Banheiro de luxo (5m²) — mão de obra completa',                      'vb', 8500.00],
    ['Pacotes',   'Cozinha',      null,    'Cozinha completa padrão (10m²) — mão de obra completa',              'vb', 7500.00],
    ['Pacotes',   'Cozinha',      null,    'Cozinha gourmet com bancada (15m²) — mão de obra completa',          'vb',12000.00],
    // Serviços diversos (8)
    ['Serviços',  'Limpeza',      null,    'Limpeza pós-obra (faxina pesada)',                                   'm²',  12.00],
    ['Serviços',  'Limpeza',      null,    'Limpeza fina pré-entrega (vidros, polimento)',                       'm²',  18.00],
    ['Serviços',  'Entulho',      null,    'Remoção de entulho (caçamba até 4m³)',                               'un', 380.00],
    ['Serviços',  'Transporte',   null,    'Transporte de material — frete por viagem (cidade)',                 'vb', 250.00],
    ['Serviços',  'Mestre',       null,    'Mestre de obras — diária supervisão',                                'h',   45.00],
    ['Serviços',  'Pedreiro',     null,    'Pedreiro — mão de obra direta',                                      'h',   30.00],
    ['Serviços',  'Servente',     null,    'Servente/ajudante — mão de obra direta',                             'h',   18.00],
    ['Serviços',  'ART',          null,    'ART CREA — emissão de Anotação de Responsabilidade Técnica',         'un', 350.00],
  ];

  let inseridos = 0;
  for (const [cat, subcat, cod, desc, un, val] of itens) {
    try {
      const [r] = await pool.execute(
        `INSERT IGNORE INTO sinapi_servicos
           (categoria, subcategoria, codigo_sinapi, descricao, unidade, valor_referencia, valor_e_referencial)
         VALUES (?,?,?,?,?,?,TRUE)`,
        [cat, subcat, cod, desc, un, val],
      );
      if ((r as { affectedRows: number }).affectedRows > 0) inseridos++;
    } catch (err) {
      console.warn(`[sinapi] insert "${desc}" falhou:`, (err as Error).message.slice(0, 80));
    }
  }
  if (inseridos > 0) {
    console.log(`[sinapi] catálogo populado: ${inseridos}/${itens.length} itens novos inseridos`);
  }
}
