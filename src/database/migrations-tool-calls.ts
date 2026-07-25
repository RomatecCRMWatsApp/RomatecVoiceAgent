// v3.130.0 — Instrumentação de uso de tools da ZAYRA.
//
// Registra CADA invocação de executeTool (tool_name + quem chamou), pra que a
// poda das tools ociosas deixe de ser palpite: em 2-4 semanas dá pra cruzar a
// lista registrada contra o uso real dos últimos 90 dias e cortar com dado.
// Fire-and-forget na aplicação — nunca bloqueia nem derruba a tool.
import pool from './connection';

const CREATE_TOOL_CALLS = `
  CREATE TABLE IF NOT EXISTS zayra_tool_calls (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    tool_name    VARCHAR(64) NOT NULL,
    caller_nome  VARCHAR(120) NULL,
    caller_role  VARCHAR(40) NULL,
    criado_em    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_toolcall_nome_data (tool_name, criado_em),
    INDEX idx_toolcall_data (criado_em)
  )
`;

export async function runToolCallsMigrations(): Promise<void> {
  try {
    await pool.execute(CREATE_TOOL_CALLS);
    console.log('[tool-calls-migrations] OK: zayra_tool_calls');
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/already exists|Duplicate/i.test(msg)) {
      console.log('[tool-calls-migrations] ja existe (OK): zayra_tool_calls');
    } else {
      console.error('[tool-calls-migrations] FALHA:', msg.slice(0, 200));
    }
  }
}
