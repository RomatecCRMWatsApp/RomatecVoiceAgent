// v3.97.0 — Migrations do INVENTÁRIO DE MATERIAIS POR OBRA.
//
// Convenções do repo (ver migrations-mao-obra-avulsa.ts / migrations-fotos-envios-log.ts):
//   - obra = romatec_obras, SEM FK cross-table (obra_id INT + índice; integridade
//     na aplicação). FKs reais só entre pai↔filha DESTE módulo (CASCADE).
//   - Autor = colaborador_id VARCHAR(64) (sub do JWT — padrão VTO/entregas).
//   - Arquivos/fotos em BASE64 (LONGTEXT) no MySQL — Railway tem container
//     efêmero, NADA em disco.
//   - Idempotente: CREATE IF NOT EXISTS + erros de duplicidade engolidos.
//
// Regra central: saldo = quantidade_comprada - quantidade_utilizada (coluna
// GERADA no banco — nunca dessincroniza). Trava de saldo negativo na aplicação
// (transação + SELECT ... FOR UPDATE no repo).

import pool from './connection';

async function exec(sql: string, tag: string): Promise<void> {
  try {
    await pool.query(sql);
    console.log(`[inventario-migrations] OK: ${tag}`);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (
      e.code === 'ER_TABLE_EXISTS_ERROR' ||
      e.code === 'ER_DUP_FIELDNAME' ||
      e.code === 'ER_DUP_KEYNAME' ||
      /Duplicate (column|key)/i.test(e.message ?? '')
    ) {
      console.log(`[inventario-migrations] ja existe: ${tag}`);
      return;
    }
    console.error(`[inventario-migrations] AVISO em ${tag}:`, e.message);
    throw err;
  }
}

export async function runInventarioObraMigrations(): Promise<void> {
  // ── Etapas/frentes de serviço do inventário (ex.: Instalação Elétrica) ────
  await exec(`
    CREATE TABLE IF NOT EXISTS obra_inventario_etapas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      obra_id INT NOT NULL,
      titulo VARCHAR(150) NOT NULL,
      descricao TEXT NULL,
      ordem INT NOT NULL DEFAULT 0,
      status ENUM('planejada','em_andamento','concluida') NOT NULL DEFAULT 'planejada',
      -- vínculo OPCIONAL com a disciplina do checklist VTO (vto_atividades_catalogo.disciplina_ordem)
      disciplina_vto_ordem SMALLINT NULL,
      colaborador_id VARCHAR(64) NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_inv_etapas_obra (obra_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'tabela obra_inventario_etapas');

  // ── Notas fiscais de ENTRADA de material (upload XML/PDF/foto) ────────────
  await exec(`
    CREATE TABLE IF NOT EXISTS obra_inventario_notas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      obra_id INT NOT NULL,
      etapa_id INT NULL,
      numero_nota VARCHAR(50) NULL,
      chave_acesso VARCHAR(44) NULL,
      fornecedor_nome VARCHAR(200) NULL,
      fornecedor_cnpj VARCHAR(18) NULL,
      data_emissao DATE NULL,
      valor_total DECIMAL(12,2) NULL,
      arquivo_nome VARCHAR(255) NOT NULL,
      arquivo_mime VARCHAR(100) NOT NULL,
      arquivo_b64 LONGTEXT NOT NULL,
      arquivo_tipo ENUM('xml_nfe','pdf_danfe','imagem') NOT NULL,
      status_processamento ENUM('pendente','processando','processado','erro','revisao_manual') NOT NULL DEFAULT 'pendente',
      erro_processamento TEXT NULL,
      confianca DECIMAL(4,3) NULL,
      colaborador_id VARCHAR(64) NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_inv_notas_obra (obra_id),
      KEY idx_inv_notas_etapa (etapa_id),
      CONSTRAINT fk_inv_nota_etapa FOREIGN KEY (etapa_id)
        REFERENCES obra_inventario_etapas(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'tabela obra_inventario_notas');

  // ── Itens do inventário (núcleo). saldo = coluna GERADA (nunca dessincroniza)
  await exec(`
    CREATE TABLE IF NOT EXISTS obra_inventario_itens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      obra_id INT NOT NULL,
      etapa_id INT NULL,
      nota_id INT NULL,
      descricao VARCHAR(300) NOT NULL,
      codigo_produto VARCHAR(60) NULL,
      unidade_medida VARCHAR(10) NOT NULL DEFAULT 'UN',
      quantidade_comprada DECIMAL(12,3) NOT NULL DEFAULT 0,
      valor_unitario DECIMAL(12,2) NULL,
      valor_total DECIMAL(12,2) NULL,
      quantidade_utilizada DECIMAL(12,3) NOT NULL DEFAULT 0,
      quantidade_saldo DECIMAL(12,3) GENERATED ALWAYS AS (quantidade_comprada - quantidade_utilizada) STORED,
      status_utilizacao ENUM('nao_utilizado','parcial','total') NOT NULL DEFAULT 'nao_utilizado',
      origem ENUM('nota_fiscal','manual') NOT NULL DEFAULT 'manual',
      confianca_baixa TINYINT(1) NOT NULL DEFAULT 0,
      observacoes TEXT NULL,
      colaborador_id VARCHAR(64) NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_inv_itens_obra (obra_id),
      KEY idx_inv_itens_etapa (etapa_id),
      KEY idx_inv_itens_status (status_utilizacao),
      KEY idx_inv_itens_nota (nota_id),
      CONSTRAINT fk_inv_item_nota FOREIGN KEY (nota_id)
        REFERENCES obra_inventario_notas(id) ON DELETE SET NULL,
      CONSTRAINT fk_inv_item_etapa FOREIGN KEY (etapa_id)
        REFERENCES obra_inventario_etapas(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'tabela obra_inventario_itens');

  // ── Histórico IMUTÁVEL de utilizações (estorno fica pra v2) ────────────────
  await exec(`
    CREATE TABLE IF NOT EXISTS obra_inventario_utilizacoes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      item_id INT NOT NULL,
      tipo_utilizacao ENUM('total','parcial') NOT NULL,
      quantidade_utilizada DECIMAL(12,3) NOT NULL,
      data_utilizacao DATE NOT NULL,
      etapa_execucao_id INT NULL,
      observacoes TEXT NULL,
      colaborador_id VARCHAR(64) NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_inv_util_item (item_id),
      CONSTRAINT fk_inv_util_item FOREIGN KEY (item_id)
        REFERENCES obra_inventario_itens(id) ON DELETE CASCADE,
      CONSTRAINT fk_inv_util_etapa FOREIGN KEY (etapa_execucao_id)
        REFERENCES obra_inventario_etapas(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'tabela obra_inventario_utilizacoes');

  // ── Relatório fotográfico do item (entrega × instalação) ──────────────────
  await exec(`
    CREATE TABLE IF NOT EXISTS obra_inventario_fotos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      item_id INT NOT NULL,
      utilizacao_id INT NULL,
      tipo_foto ENUM('entrega','instalacao','avaria','outro') NOT NULL,
      data_base64 LONGTEXT NOT NULL,
      mime VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
      legenda VARCHAR(255) NULL,
      latitude DECIMAL(10,7) NULL,
      longitude DECIMAL(10,7) NULL,
      colaborador_id VARCHAR(64) NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_inv_fotos_item (item_id),
      CONSTRAINT fk_inv_foto_item FOREIGN KEY (item_id)
        REFERENCES obra_inventario_itens(id) ON DELETE CASCADE,
      CONSTRAINT fk_inv_foto_util FOREIGN KEY (utilizacao_id)
        REFERENCES obra_inventario_utilizacoes(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'tabela obra_inventario_fotos');

  // ── Ponte SOBRAS da Entrega de Obra → inventário (fase 2 do registro
  // documental de obras_entregas_materiais_sobra). Rastro: origem
  // 'sobra_entrega' + entrega_id/entrega_sobra_id no item. ALTERs idempotentes
  // (MODIFY re-executa sem efeito; ADDs duplicados são engolidos pelo exec).
  await exec(`
    ALTER TABLE obra_inventario_itens
      MODIFY origem ENUM('nota_fiscal','manual','sobra_entrega') NOT NULL DEFAULT 'manual'
  `, "origem 'sobra_entrega' em obra_inventario_itens");
  await exec(
    `ALTER TABLE obra_inventario_itens ADD COLUMN entrega_id INT UNSIGNED NULL`,
    'coluna entrega_id em obra_inventario_itens',
  );
  await exec(
    `ALTER TABLE obra_inventario_itens ADD COLUMN entrega_sobra_id INT UNSIGNED NULL`,
    'coluna entrega_sobra_id em obra_inventario_itens',
  );
  // 1 sobra ↔ 1 item: a UNIQUE garante que a reconciliação nunca duplica.
  await exec(
    `ALTER TABLE obra_inventario_itens ADD UNIQUE KEY uq_inv_item_sobra (entrega_sobra_id)`,
    'unique uq_inv_item_sobra',
  );
  await exec(
    `ALTER TABLE obra_inventario_itens ADD KEY idx_inv_itens_entrega (entrega_id)`,
    'indice idx_inv_itens_entrega',
  );

  // ── v3.100.0: Cabeçalho do inventário — NÚMERO automático linkado à obra ──
  // 1 inventário por obra (UNIQUE obra_id). numero = INV-AAAA-NNNN, atribuído
  // pós-insert (mesmo padrão do RE-AAAA-NNNN das entregas). Criado na primeira
  // abertura do inventário da obra.
  await exec(`
    CREATE TABLE IF NOT EXISTS obra_inventario_cabecalho (
      id INT AUTO_INCREMENT PRIMARY KEY,
      obra_id INT NOT NULL,
      numero VARCHAR(20) NULL,
      colaborador_id VARCHAR(64) NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_inv_cab_obra (obra_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'tabela obra_inventario_cabecalho');

  // v3.101.1: link PÚBLICO do inventário (cliente acompanha sempre atualizado,
  // sem login — padrão /v/entrega). Hash de 64 hex, ímpar de adivinhar.
  await exec(`
    ALTER TABLE obra_inventario_cabecalho ADD COLUMN hash_publico VARCHAR(64) NULL
  `, 'coluna hash_publico');
  await exec(`
    ALTER TABLE obra_inventario_cabecalho ADD UNIQUE KEY uq_inv_hash (hash_publico)
  `, 'unique hash_publico');

  console.log('[inventario-migrations] concluídas');
}
