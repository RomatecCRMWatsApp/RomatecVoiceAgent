// v3.14.0 — Relatório de Fatura de Demarcações
// Executa idempotente (IF NOT EXISTS / ALTER não-bloqueante).

import pool from './connection';

async function tryAlter(sql: string, tag: string): Promise<void> {
  try {
    await pool.execute(sql);
    console.log(`[relatorio-demarcacao-migrations] OK: ${tag}`);
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException & { code?: string }).code;
    if (msg === 'ER_DUP_FIELDNAME' || msg === 'ER_DUP_KEYNAME' || msg === 'ER_TABLE_EXISTS_ERROR') {
      console.log(`[relatorio-demarcacao-migrations] ja existe (OK): ${tag}`);
    } else {
      console.warn(`[relatorio-demarcacao-migrations] aviso (${tag}):`, (err as Error).message.slice(0, 120));
    }
  }
}

export async function runRelatorioDemarcacaoMigrations(): Promise<void> {
  // Campos de faturamento no laudo
  await tryAlter(`ALTER TABLE laudos_demarcacao ADD COLUMN valor_demarcacao DECIMAL(10,2) NULL`, 'ALTER laudos_demarcacao valor_demarcacao');
  await tryAlter(`ALTER TABLE laudos_demarcacao ADD COLUMN status_faturamento ENUM('pendente','faturado','pago','cancelado') NOT NULL DEFAULT 'pendente'`, 'ALTER laudos_demarcacao status_faturamento');
  await tryAlter(`ALTER TABLE laudos_demarcacao ADD COLUMN relatorio_id INT NULL`, 'ALTER laudos_demarcacao relatorio_id');
  await tryAlter(`ALTER TABLE laudos_demarcacao ADD COLUMN faturado_em DATETIME NULL`, 'ALTER laudos_demarcacao faturado_em');
  await tryAlter(`ALTER TABLE laudos_demarcacao ADD COLUMN pago_em DATETIME NULL`, 'ALTER laudos_demarcacao pago_em');
  await tryAlter(`ALTER TABLE laudos_demarcacao ADD INDEX idx_status_fat (status_faturamento)`, 'INDEX idx_status_fat');
  await tryAlter(`ALTER TABLE laudos_demarcacao ADD INDEX idx_relatorio (relatorio_id)`, 'INDEX idx_relatorio');

  // Loteadores
  await tryAlter(`
    CREATE TABLE IF NOT EXISTS loteadores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(150) NOT NULL,
      documento VARCHAR(20) NULL,
      empresa VARCHAR(150) NULL,
      telefone VARCHAR(20) NULL,
      whatsapp VARCHAR(20) NULL,
      email VARCHAR(120) NULL,
      endereco VARCHAR(255) NULL,
      loteamento_padrao VARCHAR(150) NULL,
      observacoes TEXT NULL,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_nome (nome),
      INDEX idx_doc (documento)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `, 'CREATE TABLE loteadores');

  // Cabeçalho do relatório
  await tryAlter(`
    CREATE TABLE IF NOT EXISTS relatorios_demarcacao (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numero VARCHAR(20) NOT NULL UNIQUE,
      loteador_id INT NULL,
      loteador_nome VARCHAR(150) NOT NULL,
      loteador_documento VARCHAR(20) NULL,
      loteador_whatsapp VARCHAR(20) NULL,
      loteamento VARCHAR(150) NULL,
      data_emissao DATE NOT NULL,
      data_vencimento DATE NULL,
      periodo_inicio DATE NULL,
      periodo_fim DATE NULL,
      qtd_itens INT NOT NULL DEFAULT 0,
      area_total_m2 DECIMAL(12,2) NOT NULL DEFAULT 0,
      valor_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      pagamento_pix VARCHAR(120) NULL,
      pagamento_banco VARCHAR(80) NULL,
      pagamento_agencia VARCHAR(20) NULL,
      pagamento_conta VARCHAR(30) NULL,
      pagamento_titular VARCHAR(150) NULL,
      pagamento_documento VARCHAR(20) NULL,
      observacoes TEXT NULL,
      status ENUM('emitido','enviado','pago','cancelado') NOT NULL DEFAULT 'emitido',
      hash_validacao VARCHAR(64) NULL,
      pdf_path VARCHAR(500) NULL,
      enviado_em DATETIME NULL,
      pago_em DATETIME NULL,
      emitido_por VARCHAR(100) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_loteador (loteador_id),
      INDEX idx_status (status),
      INDEX idx_periodo (periodo_inicio, periodo_fim),
      CONSTRAINT fk_relatorio_loteador FOREIGN KEY (loteador_id) REFERENCES loteadores(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `, 'CREATE TABLE relatorios_demarcacao');

  // Itens do relatório
  await tryAlter(`
    CREATE TABLE IF NOT EXISTS relatorios_demarcacao_itens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      relatorio_id INT NOT NULL,
      laudo_id INT NOT NULL,
      laudo_numero VARCHAR(30) NOT NULL,
      tipo_imovel VARCHAR(40) NULL,
      imovel_descricao VARCHAR(255) NULL,
      contrato VARCHAR(60) NULL,
      quadra VARCHAR(20) NULL,
      lote VARCHAR(20) NULL,
      data_demarcacao DATE NULL,
      area_m2 DECIMAL(12,2) NOT NULL,
      valor DECIMAL(10,2) NOT NULL,
      observacao VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_rel (relatorio_id),
      INDEX idx_laudo (laudo_id),
      CONSTRAINT fk_rdi_relatorio FOREIGN KEY (relatorio_id) REFERENCES relatorios_demarcacao(id) ON DELETE CASCADE,
      CONSTRAINT fk_rdi_laudo FOREIGN KEY (laudo_id) REFERENCES laudos_demarcacao(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `, 'CREATE TABLE relatorios_demarcacao_itens');

  // FK do laudo → relatório
  await tryAlter(`
    ALTER TABLE laudos_demarcacao
      ADD CONSTRAINT fk_laudo_relatorio FOREIGN KEY (relatorio_id)
        REFERENCES relatorios_demarcacao(id) ON DELETE SET NULL
  `, 'FK fk_laudo_relatorio');

  // Dados bancários do emissor
  await tryAlter(`
    CREATE TABLE IF NOT EXISTS dados_pagamento_emissor (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pix VARCHAR(120) NULL,
      banco VARCHAR(80) NULL,
      agencia VARCHAR(20) NULL,
      conta VARCHAR(30) NULL,
      tipo_conta ENUM('corrente','poupanca','pagamento') NULL,
      titular VARCHAR(150) NOT NULL,
      documento VARCHAR(20) NOT NULL,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `, 'CREATE TABLE dados_pagamento_emissor');

  // Seed do emissor (só insere se vazio) — v3.15.7: dados reais Romatec/J R P Bezerra LTDA
  try {
    await pool.execute(`
      INSERT IGNORE INTO dados_pagamento_emissor (id, pix, banco, agencia, conta, tipo_conta, titular, documento)
      VALUES (1, 'romatec.cad@hotmail.com', 'Banco Santander', '1225', '130007144', 'corrente',
              'J R P BEZERRA LTDA', '17.261.987/0001-09')
    `);
  } catch { /* nao bloqueia */ }
  // v3.15.7: se row id=1 ainda tem os placeholders antigos, sobrescreve com dados reais
  try {
    await pool.execute(`
      UPDATE dados_pagamento_emissor
         SET pix = 'romatec.cad@hotmail.com',
             banco = 'Banco Santander',
             agencia = '1225',
             conta = '130007144',
             tipo_conta = 'corrente',
             titular = 'J R P BEZERRA LTDA',
             documento = '17.261.987/0001-09'
       WHERE id = 1
         AND (pix = 'PREENCHER_PIX' OR banco = 'PREENCHER_BANCO' OR documento = 'PREENCHER_CPF_CNPJ')
    `);
  } catch { /* nao bloqueia */ }

  // Sequência de numeração
  await tryAlter(`
    CREATE TABLE IF NOT EXISTS relatorios_demarcacao_seq (
      ano INT PRIMARY KEY,
      ultimo_numero INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `, 'CREATE TABLE relatorios_demarcacao_seq');
}
