// v3.28.0: repositorio do log de envios da galeria (fotos_envios_log).
// Conforme padrao do repo: integridade na aplicacao (sem FKs), idempotencia
// via idempotency_key (cardinality alta — usado pra dedup de retentativas).

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import type { LogRepo, CanalEnvio, CanalResultado } from '../integrations/fotoCompartilhamento';

async function registrarPendente(input: {
  foto_id: number;
  canal: CanalEnvio;
  user_id: number;
  destinatario?: string | null;
  idempotency_key?: string | null;
}): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO fotos_envios_log
       (foto_id, canal, destinatario, status, user_id, idempotency_key)
     VALUES (?, ?, ?, 'pendente', ?, ?)`,
    [input.foto_id, input.canal, input.destinatario ?? null, input.user_id, input.idempotency_key ?? null],
  );
  return r.insertId;
}

async function registrarSucesso(
  id: number,
  fields: { zapi_message_id?: string | null; telegram_message_id?: number | null },
): Promise<void> {
  await pool.execute(
    `UPDATE fotos_envios_log
        SET status = 'sucesso',
            zapi_message_id = COALESCE(?, zapi_message_id),
            telegram_message_id = COALESCE(?, telegram_message_id),
            enviado_em = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [fields.zapi_message_id ?? null, fields.telegram_message_id ?? null, id],
  );
}

async function registrarErro(id: number, mensagem: string): Promise<void> {
  await pool.execute(
    `UPDATE fotos_envios_log
        SET status = 'erro',
            mensagem_erro = ?,
            enviado_em = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [mensagem.slice(0, 4000), id],
  );
}

// Busca resultados de uma idempotency_key dentro de N segundos. Retorna NULL
// se nao houver hit ou se houver tentativas mas todas ainda em pendente.
async function buscarPorIdempotencyKey(
  key: string,
  dentroDeSegundos: number,
): Promise<CanalResultado[] | null> {
  if (!key) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT canal, status, zapi_message_id, telegram_message_id, mensagem_erro
       FROM fotos_envios_log
      WHERE idempotency_key = ?
        AND created_at >= (NOW() - INTERVAL ? SECOND)
        AND status IN ('sucesso','erro')
      ORDER BY id ASC`,
    [key, dentroDeSegundos],
  );
  if (!rows.length) return null;
  return rows.map((r) => ({
    canal: r.canal as CanalEnvio,
    status: r.status === 'sucesso' ? 'sucesso' : 'erro',
    message_id: r.zapi_message_id ?? (r.telegram_message_id != null ? Number(r.telegram_message_id) : undefined),
    erro: r.status === 'erro' ? (r.mensagem_erro ?? 'erro') : undefined,
  }));
}

export const fotosEnviosLogRepo: LogRepo = {
  registrarPendente,
  registrarSucesso,
  registrarErro,
  buscarPorIdempotencyKey,
};
