// v3.10.0 — Migrations do Fechamento de Folha (período flexível).
//
// Mapeamento de tabelas v3.9.x (em relação ao pacote de v1.99.15 original):
//   obras                       → romatec_obras
//   funcionarios                → romatec_obra_equipe (campo diaria → valor_dia)
//   marcar_dias                 → romatec_obra_funcionario_dias
//
// Regra:
//  - Cada obra tem um ciclo padrão (ex: quinzenal dia 15, mensal dia 30)
//  - O sistema sugere data_inicio/data_fim com base nesse padrão
//  - Usuário pode ajustar a data_fim REAL (dia que fechou de fato)
//  - Próximo ciclo começa em (data_fim real + 1 dia)

import pool from './connection';

// 1) Colunas de ciclo de pagamento em romatec_obras
const ALTERS_OBRAS: Array<{ label: string; sql: string }> = [
  {
    label: 'ALTER romatec_obras ciclo_pagamento',
    sql: `ALTER TABLE romatec_obras ADD COLUMN ciclo_pagamento ENUM('quinzenal','mensal','semanal','personalizado') NOT NULL DEFAULT 'quinzenal'`,
  },
  {
    label: 'ALTER romatec_obras dia_corte_padrao',
    sql: `ALTER TABLE romatec_obras ADD COLUMN dia_corte_padrao TINYINT NULL`,
  },
  {
    label: 'ALTER romatec_obras ultima_data_fechada',
    sql: `ALTER TABLE romatec_obras ADD COLUMN ultima_data_fechada DATE NULL`,
  },
];

// 2) Cabeçalho do fechamento
const CREATE_FECHAMENTOS = `
  CREATE TABLE IF NOT EXISTS folha_fechamentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    obra_id INT NOT NULL,
    data_inicio DATE NOT NULL,
    data_fim DATE NOT NULL,
    data_fim_prevista DATE NULL COMMENT 'Data que seria o corte padrão; data_fim é a real.',
    rotulo VARCHAR(120) NULL,
    data_fechamento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_funcionarios INT NOT NULL DEFAULT 0,
    total_valor DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_vales DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_liquido DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status ENUM('aberta','parcialmente_paga','quitada','cancelada') NOT NULL DEFAULT 'aberta',
    observacoes TEXT NULL,
    fechado_por VARCHAR(100) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ff_obra (obra_id),
    INDEX idx_ff_status (status),
    INDEX idx_ff_periodo (data_inicio, data_fim)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

// 3) Itens (snapshot por funcionário)
const CREATE_FECHAMENTO_ITENS = `
  CREATE TABLE IF NOT EXISTS folha_fechamento_itens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fechamento_id INT NOT NULL,
    funcionario_id INT NOT NULL,
    funcionario_nome VARCHAR(200) NOT NULL,
    funcao VARCHAR(120) NULL,
    diaria DECIMAL(10,2) NOT NULL,
    dias_integral DECIMAL(5,2) NOT NULL DEFAULT 0,
    dias_manha DECIMAL(5,2) NOT NULL DEFAULT 0,
    dias_tarde DECIMAL(5,2) NOT NULL DEFAULT 0,
    dias_equivalente DECIMAL(6,2) NOT NULL DEFAULT 0,
    valor_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    valor_vales DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    valor_liquido DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status_pagamento ENUM('aberta','paga','cancelada') NOT NULL DEFAULT 'aberta',
    data_pagamento DATETIME NULL,
    recibo_id INT NULL,
    forma_pagamento ENUM('pix','dinheiro','transferencia','cheque','outro') NULL,
    observacoes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ffi_fechamento (fechamento_id),
    INDEX idx_ffi_funcionario (funcionario_id),
    INDEX idx_ffi_status (status_pagamento)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

// 4) Vincula lançamentos diários ao fechamento
const ALTERS_FUNCIONARIO_DIAS: Array<{ label: string; sql: string }> = [
  {
    label: 'ALTER romatec_obra_funcionario_dias fechamento_id',
    sql: `ALTER TABLE romatec_obra_funcionario_dias ADD COLUMN fechamento_id INT NULL`,
  },
  {
    label: 'ALTER romatec_obra_funcionario_dias bloqueado_em',
    sql: `ALTER TABLE romatec_obra_funcionario_dias ADD COLUMN bloqueado_em DATETIME NULL`,
  },
  {
    label: 'INDEX idx_dias_fechamento',
    sql: `ALTER TABLE romatec_obra_funcionario_dias ADD INDEX idx_dias_fechamento (fechamento_id)`,
  },
];

// 5) Auditoria de pagamentos
const CREATE_PAGAMENTOS_LOG = `
  CREATE TABLE IF NOT EXISTS folha_pagamentos_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fechamento_item_id INT NOT NULL,
    acao ENUM('marcou_pago','reverteu','cancelou','emitiu_recibo') NOT NULL,
    valor DECIMAL(12,2) NULL,
    forma_pagamento VARCHAR(30) NULL,
    usuario VARCHAR(120) NULL,
    observacao TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_fpl_item (fechamento_item_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

function logOK(label: string) { console.log(`[folha-fechamento-migrations] OK: ${label}`); }
function logExists(label: string) { console.log(`[folha-fechamento-migrations] ja existe (OK): ${label}`); }
function logFail(label: string, msg: string) { console.error(`[folha-fechamento-migrations] FALHA ${label}:`, msg.slice(0, 200)); }

export async function runFolhaFechamentoMigrations(): Promise<void> {
  const creates: Array<{ label: string; sql: string }> = [
    { label: 'folha_fechamentos', sql: CREATE_FECHAMENTOS },
    { label: 'folha_fechamento_itens', sql: CREATE_FECHAMENTO_ITENS },
    { label: 'folha_pagamentos_log', sql: CREATE_PAGAMENTOS_LOG },
  ];
  for (const { label, sql } of creates) {
    try {
      await pool.execute(sql);
      logOK(label);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists/i.test(msg)) logExists(label);
      else logFail(label, msg);
    }
  }

  // ALTERs idempotentes (rodam separados pra cada um sobreviver a 'Duplicate column')
  const alters = [...ALTERS_OBRAS, ...ALTERS_FUNCIONARIO_DIAS];
  for (const { label, sql } of alters) {
    try {
      await pool.execute(sql);
      logOK(label);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/Duplicate (column|key)|already exists/i.test(msg)) logExists(label);
      else logFail(label, msg);
    }
  }
}

// v3.10.2 — Adiciona tipo_chave_pix em romatec_obra_equipe pra suportar
// cadastro de PIX por tipo (cpf, cnpj, email, telefone, aleatoria).
// chave_pix ja existe desde v1.65.x — so adiciona o tipo.
export async function runEquipePixMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    {
      label: 'ALTER romatec_obra_equipe tipo_chave_pix',
      sql: `ALTER TABLE romatec_obra_equipe ADD COLUMN tipo_chave_pix ENUM('cpf','cnpj','email','telefone','aleatoria') NULL`,
    },
  ];
  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[equipe-pix-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/Duplicate (column|key)|already exists/i.test(msg)) {
        console.log(`[equipe-pix-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[equipe-pix-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}

// v3.11.0 — Adiciona colunas pra anexar comprovante de pagamento no item do fechamento.
// Quando o usuario faz upload de comprovante (JPG/PDF), o sistema:
//   1) Salva o arquivo binario em comprovante_arquivo
//   2) Roda OCR (Claude Vision) e salva extraido em comprovante_extraido (JSON)
//   3) Marca status_pagamento='paga' automaticamente
//   4) Envia via WhatsApp pro colaborador e marca enviado_whatsapp
export async function runComprovanteMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    {
      label: 'ALTER folha_fechamento_itens comprovante_arquivo',
      sql: `ALTER TABLE folha_fechamento_itens ADD COLUMN comprovante_arquivo LONGBLOB NULL`,
    },
    {
      label: 'ALTER folha_fechamento_itens comprovante_mime',
      sql: `ALTER TABLE folha_fechamento_itens ADD COLUMN comprovante_mime VARCHAR(60) NULL`,
    },
    {
      label: 'ALTER folha_fechamento_itens comprovante_filename',
      sql: `ALTER TABLE folha_fechamento_itens ADD COLUMN comprovante_filename VARCHAR(200) NULL`,
    },
    {
      label: 'ALTER folha_fechamento_itens comprovante_extraido',
      sql: `ALTER TABLE folha_fechamento_itens ADD COLUMN comprovante_extraido JSON NULL`,
    },
    {
      label: 'ALTER folha_fechamento_itens comprovante_uploaded_em',
      sql: `ALTER TABLE folha_fechamento_itens ADD COLUMN comprovante_uploaded_em TIMESTAMP NULL`,
    },
    {
      label: 'ALTER folha_fechamento_itens comprovante_enviado_whatsapp',
      sql: `ALTER TABLE folha_fechamento_itens ADD COLUMN comprovante_enviado_whatsapp TIMESTAMP NULL`,
    },
  ];
  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[comprovante-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/Duplicate (column|key)|already exists/i.test(msg)) {
        console.log(`[comprovante-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[comprovante-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
