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
