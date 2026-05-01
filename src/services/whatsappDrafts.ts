// v1.61.0 — Drafts persistentes de envio WhatsApp.
//
// Problema que esse service resolve:
//   Antes, o "preview→confirmação" das tools `enviar_whatsapp*` dependia do LLM
//   lembrar o conteúdo entre 2 turnos de conversa. Como o histórico é truncado
//   em AI_MAX_HISTORY_MESSAGES (default 12), conversas longas perdiam o draft —
//   CEO confirmava e o LLM pedia reenvio.
//
// Solução:
//   Toda 1ª chamada (sem confirm) cria um draft no DB com TTL de 30 min e
//   retorna o draft_id. Na 2ª chamada (confirm:true), o LLM passa o draft_id;
//   service busca o conteúdo no DB e dispara o envio. Conteúdo vive fora do
//   contexto do LLM, então não importa quantos turnos passaram.
//
// Estados:
//   awaiting_confirmation → sent | cancelled | expired
//
// TTL configurável via DRAFT_TTL_MINUTES (default 30).

import { randomUUID } from 'node:crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';

export type DraftTipo = 'texto' | 'audio' | 'imagem' | 'documento';
export type DraftStatus = 'awaiting_confirmation' | 'sent' | 'cancelled' | 'expired';

export interface DraftRow extends RowDataPacket {
  id:              string;
  session_id:      string;
  destinatario:    string;
  conteudo:        string;
  tipo:            DraftTipo;
  filename:        string | null;
  caption:         string | null;
  status:          DraftStatus;
  criado_em:       Date;
  expira_em:       Date;
  enviado_em:      Date | null;
  cancelado_em:    Date | null;
  message_id_zapi: string | null;
}

const DEFAULT_TTL_MIN = parseInt(process.env.DRAFT_TTL_MINUTES ?? '30', 10);

function ttlMinutes(): number {
  return Number.isFinite(DEFAULT_TTL_MIN) && DEFAULT_TTL_MIN > 0 ? DEFAULT_TTL_MIN : 30;
}

export interface CriarDraftInput {
  sessionId:    string;
  destinatario: string;
  conteudo:     string;
  tipo:         DraftTipo;
  filename?:    string;
  caption?:     string;
  ttlMinutes?:  number;
}

export interface DraftPreview {
  draft_id:     string;
  expira_em:    string;
  ttl_minutos:  number;
  destinatario: string;
  tipo:         DraftTipo;
  preview:      string;
}

/**
 * Busca draft idêntico já pendente na mesma sessão+destinatário+conteúdo+tipo.
 * Usado como guard pelo `criarDraft` pra evitar duplicação quando o LLM
 * chama a tool repetidamente com mesmos args (bug observado em produção
 * pós-PR #7: Claude/gpt-4o-mini ocasionalmente chamam `enviar_whatsapp` com
 * `para`+`mensagem` na 2ª chamada em vez de `confirm:true`+`draft_id`).
 */
export async function buscarDraftDuplicado(input: {
  sessionId:    string;
  destinatario: string;
  conteudo:     string;
  tipo:         DraftTipo;
}): Promise<DraftRow | null> {
  const [rows] = await pool.execute<DraftRow[]>(
    `SELECT * FROM zayra_whatsapp_drafts
      WHERE session_id   = ?
        AND destinatario = ?
        AND conteudo     = ?
        AND tipo         = ?
        AND status       = 'awaiting_confirmation'
        AND expira_em    > NOW()
      ORDER BY criado_em DESC
      LIMIT 1`,
    [input.sessionId, input.destinatario, input.conteudo, input.tipo],
  );
  return rows[0] ?? null;
}

/**
 * Cria um draft em status `awaiting_confirmation`.
 * Retorna draft_id que o LLM deve repassar quando o CEO confirmar.
 *
 * GUARD ANTI-DUPLICATA: se já existir draft idêntico pendente na mesma
 * sessão, retorna o draft EXISTENTE (com flag duplicada=true) em vez de
 * criar novo. Defesa em profundidade contra LLM chamando 2x com args iguais.
 */
export async function criarDraft(input: CriarDraftInput): Promise<DraftPreview & { duplicada?: boolean }> {
  if (!input.sessionId)    throw new Error('sessionId obrigatório');
  if (!input.destinatario) throw new Error('destinatario obrigatório');
  if (!input.conteudo)     throw new Error('conteudo obrigatório');
  if (!input.tipo)         throw new Error('tipo obrigatório');

  // Camada 1 anti-duplicate: se LLM chamou de novo com mesmos args, devolve
  // o draft existente em vez de criar duplicata. LLM percebe pelo flag e
  // pelo aviso no preview que precisa usar confirm:true+draft_id.
  const existente = await buscarDraftDuplicado({
    sessionId:    input.sessionId,
    destinatario: input.destinatario,
    conteudo:     input.conteudo,
    tipo:         input.tipo,
  });
  if (existente) {
    console.log(`[whatsappDrafts] ⚠️ DUPLICATA detectada — devolvendo draft existente id=${existente.id} em vez de criar novo`);
    return {
      draft_id:     existente.id,
      expira_em:    new Date(existente.expira_em).toISOString(),
      ttl_minutos:  ttlMinutes(),
      destinatario: existente.destinatario,
      tipo:         existente.tipo,
      preview:
        `⚠️ Já existe draft idêntico pendente (id=${existente.id}). NÃO foi criado novo. ` +
        `Pra enviar, chame essa MESMA tool de novo com confirm:true + draft_id="${existente.id}" (NÃO repasse "para" nem "mensagem"). ` +
        `Pra cancelar, mostre ao Chefe e peça orientação.`,
      duplicada: true,
    };
  }

  const id  = randomUUID();
  const ttl = input.ttlMinutes ?? ttlMinutes();
  const expiraEm = new Date(Date.now() + ttl * 60 * 1000);
  const expiraEmSql = expiraEm.toISOString().slice(0, 19).replace('T', ' ');

  await pool.execute(
    `INSERT INTO zayra_whatsapp_drafts
       (id, session_id, destinatario, conteudo, tipo, filename, caption, expira_em)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      id,
      input.sessionId,
      input.destinatario,
      input.conteudo,
      input.tipo,
      input.filename ?? null,
      input.caption  ?? null,
      expiraEmSql,
    ],
  );

  console.log(`[whatsappDrafts] ✏️ DRAFT criado id=${id} session=${input.sessionId} dest=${input.destinatario} tipo=${input.tipo} ttl=${ttl}min`);

  // Preview textual amigável pro LLM mostrar ao CEO
  const preview = montarPreview(input);

  return {
    draft_id:     id,
    expira_em:    expiraEm.toISOString(),
    ttl_minutos:  ttl,
    destinatario: input.destinatario,
    tipo:         input.tipo,
    preview,
  };
}

function montarPreview(input: CriarDraftInput): string {
  switch (input.tipo) {
    case 'texto':
      return `[PREVIEW] Texto pra ${input.destinatario}: "${input.conteudo}"`;
    case 'audio': {
      const trecho = input.conteudo.slice(0, 120) + (input.conteudo.length > 120 ? '…' : '');
      return `[PREVIEW] Áudio TTS pra ${input.destinatario}: "${trecho}" (${input.conteudo.length} chars)`;
    }
    case 'imagem': {
      const tipoSrc = input.conteudo.startsWith('data:') ? 'imagem (base64)' : `imagem (${input.conteudo.slice(0, 60)}…)`;
      return `[PREVIEW] ${tipoSrc} pra ${input.destinatario}${input.caption ? ' com legenda "' + input.caption + '"' : ''}`;
    }
    case 'documento': {
      const sizeKb = Math.round((input.conteudo.length * 3 / 4) / 1024);
      return `[PREVIEW] Documento "${input.filename}" (${sizeKb}KB) pra ${input.destinatario}`;
    }
  }
}

/**
 * Busca um draft pelo id, validando que está awaiting_confirmation e dentro do TTL.
 * Comparação de TTL é feita pelo MySQL (`expira_em > NOW()`) pra evitar offset
 * de timezone entre Date.now() do Node e o TIMESTAMP do MySQL.
 * Se expirou, atualiza status pra 'expired' e lança erro.
 */
export async function buscarDraft(draftId: string): Promise<DraftRow> {
  const [rows] = await pool.execute<DraftRow[]>(
    `SELECT *,
            (expira_em > NOW()) AS still_valid
       FROM zayra_whatsapp_drafts
      WHERE id = ?
      LIMIT 1`,
    [draftId],
  );
  if (rows.length === 0) {
    throw new Error(`Draft ${draftId} não encontrado`);
  }
  const d = rows[0];
  if (d.status !== 'awaiting_confirmation') {
    throw new Error(`Draft ${draftId} já está em status "${d.status}" — não pode ser confirmado de novo`);
  }
  // MySQL já avaliou se expira_em > NOW() — usa o resultado direto (1=valid, 0=expired)
  const stillValid = Number((d as DraftRow & { still_valid: number }).still_valid) === 1;
  if (!stillValid) {
    await pool.execute(
      `UPDATE zayra_whatsapp_drafts SET status = 'expired' WHERE id = ?`,
      [draftId],
    );
    console.warn(`[whatsappDrafts] ⏱️ DRAFT expirou id=${draftId}`);
    throw new Error(`Draft ${draftId} EXPIROU (TTL ${ttlMinutes()} min). Peça pro Chefe refazer a mensagem.`);
  }
  return d;
}

/**
 * Lista drafts pendentes de uma sessão (status awaiting_confirmation, não expirados).
 * Útil quando o LLM esquece o draft_id e precisa recuperar.
 */
export async function listarDraftsPendentes(sessionId: string): Promise<DraftRow[]> {
  const [rows] = await pool.execute<DraftRow[]>(
    `SELECT * FROM zayra_whatsapp_drafts
      WHERE session_id = ?
        AND status = 'awaiting_confirmation'
        AND expira_em > NOW()
      ORDER BY criado_em DESC`,
    [sessionId],
  );
  return rows;
}

/**
 * Marca um draft como `sent` (após envio Z-API com sucesso).
 */
export async function marcarEnviado(draftId: string, messageIdZapi: string): Promise<void> {
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE zayra_whatsapp_drafts
        SET status = 'sent', enviado_em = CURRENT_TIMESTAMP, message_id_zapi = ?
      WHERE id = ? AND status = 'awaiting_confirmation'`,
    [messageIdZapi, draftId],
  );
  if (r.affectedRows === 0) {
    console.warn(`[whatsappDrafts] ⚠️ marcarEnviado: draft ${draftId} não estava awaiting_confirmation (ignorado)`);
    return;
  }
  console.log(`[whatsappDrafts] ✅ DRAFT enviado id=${draftId} zapi=${messageIdZapi}`);
}

/**
 * Cancela um draft (CEO desistiu).
 */
export async function cancelarDraft(draftId: string): Promise<{ id: string; cancelado: boolean }> {
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE zayra_whatsapp_drafts
        SET status = 'cancelled', cancelado_em = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'awaiting_confirmation'`,
    [draftId],
  );
  const cancelado = r.affectedRows > 0;
  if (cancelado) {
    console.log(`[whatsappDrafts] 🚫 DRAFT cancelado id=${draftId}`);
  } else {
    console.warn(`[whatsappDrafts] ⚠️ cancelarDraft: draft ${draftId} não estava pendente`);
  }
  return { id: draftId, cancelado };
}

/**
 * Limpa drafts expirados (status awaiting_confirmation com expira_em < agora).
 * Chamar periodicamente via scheduler. Idempotente.
 */
export async function limparExpirados(): Promise<{ expirados: number }> {
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE zayra_whatsapp_drafts
        SET status = 'expired'
      WHERE status = 'awaiting_confirmation'
        AND expira_em < NOW()`,
  );
  if (r.affectedRows > 0) {
    console.log(`[whatsappDrafts] 🧹 ${r.affectedRows} draft(s) expirado(s) marcados`);
  }
  return { expirados: r.affectedRows };
}

/**
 * Inicia ticker de limpeza periódica (chama limparExpirados a cada 5 min).
 * Tem guard idempotente — chamar múltiplas vezes não cria múltiplos timers.
 */
let _cleanupTimer: NodeJS.Timeout | null = null;
export function startDraftCleanup(): void {
  if (_cleanupTimer) return;
  // Roda imediatamente (em background, sem bloquear) e depois a cada 5 min
  void limparExpirados().catch(err =>
    console.warn('[whatsappDrafts] limparExpirados inicial falhou:', (err as Error).message),
  );
  _cleanupTimer = setInterval(() => {
    void limparExpirados().catch(err =>
      console.warn('[whatsappDrafts] limparExpirados periódico falhou:', (err as Error).message),
    );
  }, 5 * 60 * 1000);
  console.log('[whatsappDrafts] ticker de limpeza iniciado (a cada 5 min)');
}
