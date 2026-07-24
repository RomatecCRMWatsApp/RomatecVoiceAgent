// src/database/migrations-diario-assinatura.ts
// v3.128.0 — Assinatura formal do proprietário/responsável no Diário de Obra.
//
// Fluxo próprio, sobre o módulo Diário de Obra (v3.125.0). Cada linha = um ato
// de assinatura de UMA entrada de diário: a rubrica desenhada no canvas (base64),
// a qualificação do signatário (nome, CPF, papel), o carimbo de data/hora, GPS
// opcional e um hash SHA-256 que sela o conteúdo assinado — mesmo espírito do
// hash de recibo/entrega (createHash('sha256')).
//
// Convenções do módulo Diário (ver migrations-diario-obra.ts): SEM FK dura pra
// tabelas de fora; a cascata ao excluir o diário é feita na aplicação
// (excluirDiario remove as assinaturas junto). Idempotente: CREATE IF NOT
// EXISTS + duplicidade engolida.
//
// Por que guardar SNAPSHOT do conteúdo: o que foi assinado precisa ficar
// congelado. Se alguém editar a entrada do diário depois, a assinatura continua
// provando o texto que existia no momento da rubrica — e o hash confere com
// esse snapshot, não com o texto atual.

import pool from './connection';

const CREATE_ASSINATURAS = `
  CREATE TABLE IF NOT EXISTS diario_obra_assinaturas (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id            INT NOT NULL DEFAULT 1,
    diario_id            INT NOT NULL,
    obra_id              INT NULL,
    -- Qualificação do signatário
    signatario_nome      VARCHAR(255) NOT NULL,
    signatario_cpf       VARCHAR(24)  NULL,
    signatario_papel     ENUM('proprietario','responsavel') NOT NULL DEFAULT 'proprietario',
    -- Rubrica desenhada no canvas (PNG base64, sem prefixo data:)
    assinatura_b64       LONGTEXT NOT NULL,
    -- Selo de integridade + página pública
    hash_validacao       VARCHAR(64) NOT NULL,
    snapshot_json        LONGTEXT NULL,   -- conteúdo do diário congelado na assinatura
    -- Carimbo temporal e local
    assinado_em          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    latitude             DECIMAL(10,7) NULL,
    longitude            DECIMAL(10,7) NULL,
    local_texto          VARCHAR(255) NULL,
    ip                   VARCHAR(64)  NULL,
    user_agent           VARCHAR(255) NULL,
    -- Autoria do lançamento (quem colheu a assinatura) + status
    criado_por           VARCHAR(64)  NULL,   -- req.user.sub
    status               ENUM('assinado','anulado') NOT NULL DEFAULT 'assinado',
    criado_em            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_diario_assinatura_hash (hash_validacao),
    INDEX idx_diario_assinatura_diario (diario_id),
    INDEX idx_diario_assinatura_obra (obra_id)
  )
`;

export async function runDiarioAssinaturaMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'diario_obra_assinaturas', sql: CREATE_ASSINATURAS },
  ];
  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[diario-assinatura-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate/i.test(msg)) {
        console.log(`[diario-assinatura-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[diario-assinatura-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
