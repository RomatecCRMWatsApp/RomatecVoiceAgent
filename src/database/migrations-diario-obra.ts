// v3.125.0 — Migrations do módulo "Diário de Obra".
//
// Módulo NOVO, independente do "romatec_obra_diario" legado (que tem outro
// modelo de colunas — clima/horário/trabalhadores — e nunca foi exposto no
// menu). Aqui cada entrada = uma visita técnica vinculada a uma obra, com
// Observações / Pendências / Solicitações do Proprietário + anexos.
//
// Storage de anexos: base64 no MySQL (LONGTEXT), MESMO padrão técnico da
// Galeria/Inventário — Railway não tem disco. Escopo separado por diario_id
// (não mistura com galeria_fotos, como pede a regra de negócio da spec).
// Sem FK dura pra romatec_obras/tenant_users (convenção do projeto: galeria e
// inventário também não usam) — a cascata dos anexos é feita na aplicação.

import pool from './connection';

const CREATE_DIARIOS_OBRA = `
  CREATE TABLE IF NOT EXISTS diarios_obra (
    id                        INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id                 INT NOT NULL DEFAULT 1,
    obra_id                   INT NOT NULL,
    user_sub                  VARCHAR(64)  NULL,   -- req.user.sub (dono do lançamento)
    colaborador_equipe_id     INT          NULL,   -- req.user.equipe_id (pessoa em romatec_obra_equipe)
    colaborador_nome          VARCHAR(255) NULL,
    data_visita               DATE NOT NULL,
    hora_visita               TIME NOT NULL,
    observacoes               TEXT NULL,
    pendencias                TEXT NULL,
    solicitacoes_proprietario TEXT NULL,
    created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_diario_obra_data (obra_id, data_visita),
    INDEX idx_diario_user (user_sub)
  )
`;

const CREATE_DIARIOS_OBRA_ANEXOS = `
  CREATE TABLE IF NOT EXISTS diarios_obra_anexos (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    diario_id        INT NOT NULL,
    tipo             ENUM('foto','arquivo','desenho') NOT NULL DEFAULT 'foto',
    campo_referencia ENUM('observacoes','pendencias','solicitacoes_proprietario','geral')
                       NOT NULL DEFAULT 'geral',
    arquivo_b64      LONGTEXT NOT NULL,
    nome_original    VARCHAR(255) NULL,
    mime_type        VARCHAR(100) NULL,
    tamanho_bytes    INT NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_diario_anexo (diario_id)
  )
`;

export async function runDiarioObraMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'diarios_obra', sql: CREATE_DIARIOS_OBRA },
    { label: 'diarios_obra_anexos', sql: CREATE_DIARIOS_OBRA_ANEXOS },
  ];
  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[diario-obra-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate/i.test(msg)) {
        console.log(`[diario-obra-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[diario-obra-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
