// v3.23.5: backfill idempotente que adiciona o sufixo -R1 ao `numero` das propostas
// existentes que ainda nao tem revisao (legado pre-v3.23.5).
//
// Decisao tomada com o CEO: numeracao agora segue PROP-AAAA-NNNN-R{N} sempre.
// Propostas antigas sao R1 implicito; nao precisam de revisao incrementada, so
// renomear pra ficar consistente. Quando o cliente recebeu PROP-2026-0011 no
// arquivo antigo, e ele edita hoje apos ENVIADA, vai virar PROP-2026-0011-R2,
// nao -R1 (porque a versao original ja foi entregue). Por isso o backfill marca
// todas como R1 (a versao atual em maos do cliente).
//
// Migration idempotente: roda quantas vezes quiser, so atualiza linhas que ainda
// nao tem o sufixo -R\d+ no final do numero.

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import pool from './connection';

export async function runPropostasRevisaoMigrations(): Promise<void> {
  try {
    // 1. Conta propostas sem sufixo -R{N} no numero
    const [count] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM propostas
        WHERE numero IS NOT NULL
          AND numero LIKE 'PROP-%'
          AND numero NOT REGEXP '-R[0-9]+$'`
    );
    const pendentes = Number(count[0]?.n || 0);
    if (pendentes === 0) {
      console.log('[propostas-revisao-migrations] OK: 0 numeros legados pra backfillar');
      return;
    }

    // 2. Adiciona "-R1" ao final dos numeros que nao tem sufixo
    const [r] = await pool.execute<ResultSetHeader>(
      `UPDATE propostas
          SET numero = CONCAT(numero, '-R1')
        WHERE numero IS NOT NULL
          AND numero LIKE 'PROP-%'
          AND numero NOT REGEXP '-R[0-9]+$'`
    );
    console.log(`[propostas-revisao-migrations] OK: backfill ${r.affectedRows} numero(s) -> -R1`);
  } catch (err) {
    console.error('[propostas-revisao-migrations] FALHA:', (err as Error).message);
  }
}
