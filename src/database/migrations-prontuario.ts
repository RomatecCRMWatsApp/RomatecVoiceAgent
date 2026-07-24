// src/database/migrations-prontuario.ts
// v3.126.0 — Migrations do "Prontuário do Escritório (Multi-Serviços)".
//
// Convenções do repo (ver migrations-inventario-obra.ts / migrations-diario-obra.ts):
//   - Idempotente: CREATE TABLE IF NOT EXISTS + erros de duplicidade engolidos,
//     pra rodar a cada boot no Railway sem quebrar o deploy.
//   - FK real só entre pai↔filha DESTE módulo (CASCADE). Vínculos cross-módulo
//     (obra_id) ficam sem FK, com índice, integridade na aplicação.
//   - Autor = user_sub VARCHAR(64) (sub do JWT — padrão VTO/entregas/diário).
//
// Modelo: 1 prontuário = 1 serviço contratado por um cliente. As etapas nascem
// do template da categoria/sub-tipo (services/prontuario/prontuarioTemplates.ts)
// e são COPIADAS para prontuario_etapas na criação — mudar o template depois
// não reescreve prontuário já aberto. Cada etapa pode ter um checklist de
// documentos (prontuario_etapa_documentos).

import pool from './connection';

async function exec(sql: string, tag: string): Promise<void> {
  try {
    await pool.query(sql);
    console.log(`[prontuario-migrations] OK: ${tag}`);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (
      e.code === 'ER_TABLE_EXISTS_ERROR' ||
      e.code === 'ER_DUP_FIELDNAME' ||
      e.code === 'ER_DUP_KEYNAME' ||
      /Duplicate (column|key)|already exists/i.test(e.message ?? '')
    ) {
      console.log(`[prontuario-migrations] ja existe (OK): ${tag}`);
      return;
    }
    console.error(`[prontuario-migrations] FALHA ${tag}:`, (e.message ?? '').slice(0, 200));
    throw err;
  }
}

export async function runProntuarioMigrations(): Promise<void> {
  // ── Prontuário (cabeçalho: cliente + serviço contratado) ──────────────────
  // `numero` (PRN-AAAA-NNN) é atribuído pós-insert, a partir do id — por isso
  // nasce NULL e é UNIQUE (nunca dois prontuários com o mesmo número).
  await exec(`
    CREATE TABLE IF NOT EXISTS prontuarios (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 1,
      numero VARCHAR(20) NULL,
      cliente_nome VARCHAR(255) NOT NULL,
      cliente_cpf_cnpj VARCHAR(24) NULL,
      cliente_telefone VARCHAR(32) NULL,
      categoria VARCHAR(40) NOT NULL,
      sub_tipo VARCHAR(60) NULL,
      servico_nome VARCHAR(255) NULL,
      data_contratacao DATE NULL,
      previsao_conclusao DATE NULL,
      status ENUM('em_andamento','concluido','cancelado') NOT NULL DEFAULT 'em_andamento',
      responsavel VARCHAR(255) NULL,
      observacoes TEXT NULL,
      obra_id INT NULL,
      user_sub VARCHAR(64) NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_prontuario_numero (numero),
      KEY idx_prontuario_cliente (cliente_nome),
      KEY idx_prontuario_categoria (categoria, sub_tipo),
      KEY idx_prontuario_status (status),
      KEY idx_prontuario_obra (obra_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'tabela prontuarios');

  // ── Etapas do prontuário (cópia do template, na ordem do roteiro) ─────────
  await exec(`
    CREATE TABLE IF NOT EXISTS prontuario_etapas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      prontuario_id INT NOT NULL,
      ordem INT NOT NULL,
      nome VARCHAR(255) NOT NULL,
      status ENUM('pendente','em_andamento','concluido') NOT NULL DEFAULT 'pendente',
      data_conclusao DATE NULL,
      responsavel VARCHAR(255) NULL,
      observacoes TEXT NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_pront_etapa (prontuario_id, ordem),
      CONSTRAINT fk_pront_etapa_prontuario FOREIGN KEY (prontuario_id)
        REFERENCES prontuarios(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'tabela prontuario_etapas');

  // ── Checklist de documentos da etapa ──────────────────────────────────────
  // `prontuario_id` é redundante de propósito: permite listar/limpar tudo de um
  // prontuário sem JOIN, e mantém a consulta da tela em 3 SELECTs simples.
  await exec(`
    CREATE TABLE IF NOT EXISTS prontuario_etapa_documentos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      etapa_id INT NOT NULL,
      prontuario_id INT NOT NULL,
      doc VARCHAR(255) NOT NULL,
      status ENUM('ok','pendente') NOT NULL DEFAULT 'pendente',
      observacao VARCHAR(255) NULL,
      criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_pront_doc_etapa (etapa_id),
      KEY idx_pront_doc_prontuario (prontuario_id),
      CONSTRAINT fk_pront_doc_etapa FOREIGN KEY (etapa_id)
        REFERENCES prontuario_etapas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'tabela prontuario_etapa_documentos');

  console.log('[prontuario-migrations] concluídas');
}
