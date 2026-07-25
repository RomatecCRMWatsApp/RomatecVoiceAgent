// v3.130.0 — Logger de uso de tools (fire-and-forget).
//
// Chamado no topo do executeTool. Grava tool_name + quem chamou pra base de
// dados de poda. NUNCA lança nem bloqueia: se o INSERT falhar, só loga e segue.
// Ver migrations-tool-calls.ts e a consulta de poda no fim deste arquivo.
import pool from '../database/connection';

export function registrarChamadaTool(
  toolName: string,
  caller: { role: string; nome: string } | null,
): void {
  // Não usa await — não segura a resposta da tool.
  pool
    .execute(
      `INSERT INTO zayra_tool_calls (tool_name, caller_nome, caller_role) VALUES (?, ?, ?)`,
      [toolName.slice(0, 64), caller?.nome?.slice(0, 120) ?? null, caller?.role?.slice(0, 40) ?? null],
    )
    .catch((err: unknown) => {
      console.error('[tool-calls] INSERT falhou (ignorado):', (err as Error)?.message);
    });
}

// Consulta de poda (rodar manualmente após 2-4 semanas de coleta):
//
//   SELECT tool_name, COUNT(*) AS chamadas, MAX(criado_em) AS ultima
//     FROM zayra_tool_calls
//    WHERE criado_em > NOW() - INTERVAL 90 DAY
//    GROUP BY tool_name
//    ORDER BY chamadas ASC;
//
// Tools ATIVAS que não aparecerem nessa lista = candidatas a entrar no
// DISABLED_TOOLS (código preservado, reversível).
