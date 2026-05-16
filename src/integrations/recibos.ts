// v1.69.0 — Recibos Universais
//
// Sistema unico pros 7 tipos de recibo: funcionario, parcela, despesa, proposta,
// vistoria, etapa, chaves. Cada recibo tem:
//   - numero sequencial por (tenant, tipo, ano): REC-FUN-2026-0001
//   - token (64 hex) -> link unico pra resposta via WhatsApp
//   - hash_validacao (64 hex) -> QR code de validacao publica permanente
//   - state machine de 10 estados (rascunho -> ... -> confirmado/contestado)
//
// Esse arquivo NAO expoe rotas REST (vem na v1.70.0). So o service.

import crypto from 'crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';

export type TipoRecibo =
  | 'funcionario' | 'parcela' | 'despesa' | 'proposta'
  | 'vistoria' | 'etapa' | 'chaves' | 'custom' | 'vale';

export type StatusRecibo =
  | 'rascunho' | 'aguardando_envio' | 'enviado' | 'entregue'
  | 'lido' | 'respondido' | 'confirmado' | 'contestado'
  | 'expirado' | 'cancelado';

export type FormaPagamento =
  | 'pix' | 'dinheiro' | 'transferencia' | 'cartao' | 'boleto' | 'cheque';

export type AcaoResposta = 'confirma' | 'contesta' | 'recebido' | 'pix';

const PREFIXOS: Record<TipoRecibo, string> = {
  funcionario: 'REC-FUN',
  parcela:     'REC-PAR',
  despesa:     'REC-DSP',
  proposta:    'REC-PRO',
  vistoria:    'REC-VTO',
  etapa:       'REC-ETP',
  chaves:      'REC-CHV',
  custom:      'REC-CUS',
  vale:        'REC-VAL', // v1.99.16: vale = recibo universal (fluxo confirmacao WhatsApp)
};

const TIPO_LABEL: Record<TipoRecibo, string> = {
  funcionario: 'Pagamento de funcionário',
  parcela:     'Pagamento de parcela',
  despesa:     'Reembolso de despesa',
  proposta:    'Aceite de proposta',
  vistoria:    'Ciência de vistoria',
  etapa:       'Aceite de etapa concluída',
  chaves:      'Termo de entrega de chaves',
  custom:      'Recibo personalizado',
  vale:        'Vale (adiantamento)',
};

const TITULO_PDF: Record<TipoRecibo, string> = {
  funcionario: 'RECIBO DE PAGAMENTO',
  parcela:     'COMPROVANTE DE PARCELA',
  despesa:     'RECIBO DE REEMBOLSO',
  proposta:    'TERMO DE ACEITE DE PROPOSTA',
  vistoria:    'CIÊNCIA DE VISTORIA',
  etapa:       'ACEITE DE ETAPA CONCLUÍDA',
  chaves:      'TERMO DE ENTREGA DE CHAVES',
  custom:      'RECIBO',
  vale:        'RECIBO DE VALE',
};

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function genHex(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Numero sequencial: REC-{PREFIXO}-{ANO}-{0001}. Lock pra evitar duplicacao.
 * Quando tipo='custom' e categoriaSigla informada, usa a sigla da categoria
 * (ex: REC-CAMP-2026-0001) com sequencia propria por (tenant, sigla, ano).
 * Caso contrario usa o prefixo do tipo padrao (REC-FUN, REC-PAR, etc).
 */
async function proximoNumero(
  tenantId: number, tipo: TipoRecibo, categoriaSigla?: string | null
): Promise<string> {
  const ano = new Date().getFullYear();
  const prefixo = (tipo === 'custom' && categoriaSigla)
    ? `REC-${categoriaSigla.toUpperCase()}`
    : PREFIXOS[tipo];
  const padrao = `${prefixo}-${ano}-%`;

  // FOR UPDATE evita race condition se 2 requests chegam simultaneos.
  // Sequencia e por (tenant, prefixo, ano) — categorias diferentes nao
  // misturam numeracao (REC-CAMP-2026-0001 e REC-AMB-2026-0001 paralelos).
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(
                MAX(CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED)),
                0
              ) AS atual
         FROM recibos
        WHERE tenant_id = ? AND numero LIKE ?
        FOR UPDATE`,
      [tenantId, padrao]
    );
    const proximo = Number(rows[0]?.atual || 0) + 1;
    await conn.commit();
    return `${prefixo}-${ano}-${String(proximo).padStart(4, '0')}`;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

function normalizarTelefone(tel: string, opcional = false): string {
  const digits = String(tel || '').replace(/\D/g, '');
  if (!digits) {
    if (opcional) return ''; // rascunho permite vazio
    throw new Error('Telefone obrigatorio');
  }
  if (digits.length < 10) throw new Error(`Telefone invalido: ${tel}`);
  // Garante DDI 55 (Brasil)
  return digits.startsWith('55') ? digits : `55${digits}`;
}

// ────────────────────────────────────────────────────────────────────────
// CRUD
// ────────────────────────────────────────────────────────────────────────

export interface CriarReciboInput {
  tenant_id?: number;                 // default 1 (Romatec)
  tipo: TipoRecibo;
  resource_type: string;              // 'romatec_obra_parcelas' | 'recibos_envios' | etc
  resource_id: string;
  destinatario_nome: string;
  destinatario_doc?: string | null;
  destinatario_phone: string;
  destinatario_email?: string | null;
  destinatario_endereco?: Record<string, unknown> | null;
  valor?: number | null;
  forma_pagamento?: FormaPagamento | null;
  descricao_servico?: string | null;
  codigo_servico_key?: string | null;
  /** v1.85.0: id do servico no catalogo (ex: 'geo-rural-sigef'). Apenas pra tipo='custom'. */
  categoria_servico?: string | null;
  /** v1.85.0: sigla da categoria pai (ex: 'CAMP'). Influencia o prefixo do numero. */
  categoria_grupo?: string | null;
  /** v1.96.0: id do perfil emitente — 'romatec_pj' (default) ou 'jose_romario_pf'. */
  emitente_perfil?: string | null;
  /** Em quantos dias expira o link (default: 7). */
  expira_em_dias?: number;
  created_by?: number | null;
  /** UUID local gerado offline pelo cliente — ecoado de volta pra reconciliacao. */
  uuid_local?: string;
}

export interface Recibo {
  id: number;
  tenant_id: number;
  numero: string;
  tipo: TipoRecibo;
  resource_type: string;
  resource_id: string;
  destinatario_nome: string;
  destinatario_doc: string | null;
  destinatario_phone: string;
  destinatario_email: string | null;
  destinatario_endereco: Record<string, unknown> | null;
  valor: number | null;
  forma_pagamento: FormaPagamento | null;
  descricao_servico: string | null;
  codigo_servico_key: string | null;
  categoria_servico: string | null;
  categoria_grupo: string | null;
  emitente_perfil: string;
  token: string;
  hash_validacao: string;
  status: StatusRecibo;
  resposta_acao: AcaoResposta | null;
  resposta_obs: string | null;
  resposta_foto_url: string | null;
  resposta_lat: number | null;
  resposta_lng: number | null;
  pdf_url: string | null;
  zapi_message_id: string | null;
  expires_at: Date | null;
  enviado_em: Date | null;
  entregue_em: Date | null;
  lido_em: Date | null;
  respondido_em: Date | null;
  ip_resposta: string | null;
  user_agent_resposta: string | null;
  last_reminder_at: Date | null;
  nota_fiscal_id: number | null;
  created_by: number | null;
  // v1.99.3: assinatura digital ICP-Brasil (PAdES)
  assinado_em: Date | string | null;
  assinado_por_cert_id: number | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(r: RowDataPacket): Recibo {
  return {
    id: Number(r.id),
    tenant_id: Number(r.tenant_id),
    numero: String(r.numero),
    tipo: r.tipo as TipoRecibo,
    resource_type: String(r.resource_type),
    resource_id: String(r.resource_id),
    destinatario_nome: String(r.destinatario_nome),
    destinatario_doc: r.destinatario_doc ?? null,
    destinatario_phone: String(r.destinatario_phone),
    destinatario_email: r.destinatario_email ?? null,
    destinatario_endereco: r.destinatario_endereco
      ? (typeof r.destinatario_endereco === 'string'
          ? JSON.parse(r.destinatario_endereco)
          : r.destinatario_endereco)
      : null,
    valor: r.valor != null ? Number(r.valor) : null,
    forma_pagamento: r.forma_pagamento as FormaPagamento | null,
    descricao_servico: r.descricao_servico ?? null,
    codigo_servico_key: r.codigo_servico_key ?? null,
    categoria_servico: r.categoria_servico ?? null,
    categoria_grupo: r.categoria_grupo ?? null,
    emitente_perfil: String(r.emitente_perfil || 'romatec_pj'),
    token: String(r.token),
    hash_validacao: String(r.hash_validacao),
    status: r.status as StatusRecibo,
    resposta_acao: r.resposta_acao as AcaoResposta | null,
    resposta_obs: r.resposta_obs ?? null,
    resposta_foto_url: r.resposta_foto_url ?? null,
    resposta_lat: r.resposta_lat != null ? Number(r.resposta_lat) : null,
    resposta_lng: r.resposta_lng != null ? Number(r.resposta_lng) : null,
    pdf_url: r.pdf_url ?? null,
    zapi_message_id: r.zapi_message_id ?? null,
    expires_at: r.expires_at ? new Date(r.expires_at as Date) : null,
    enviado_em: r.enviado_em ? new Date(r.enviado_em as Date) : null,
    entregue_em: r.entregue_em ? new Date(r.entregue_em as Date) : null,
    lido_em: r.lido_em ? new Date(r.lido_em as Date) : null,
    respondido_em: r.respondido_em ? new Date(r.respondido_em as Date) : null,
    ip_resposta: r.ip_resposta ?? null,
    user_agent_resposta: r.user_agent_resposta ?? null,
    last_reminder_at: r.last_reminder_at ? new Date(r.last_reminder_at as Date) : null,
    nota_fiscal_id: r.nota_fiscal_id != null ? Number(r.nota_fiscal_id) : null,
    created_by: r.created_by != null ? Number(r.created_by) : null,
    assinado_em: r.assinado_em ? new Date(r.assinado_em as Date).toISOString() : null,
    assinado_por_cert_id: r.assinado_por_cert_id != null ? Number(r.assinado_por_cert_id) : null,
    created_at: new Date(r.created_at as Date),
    updated_at: new Date(r.updated_at as Date),
  };
}

export async function criarRecibo(input: CriarReciboInput & { _rascunho?: boolean }): Promise<Recibo & { uuid_local?: string }> {
  const tenant_id = input.tenant_id ?? 1;
  if (!input.tipo || !PREFIXOS[input.tipo]) throw new Error('tipo invalido');
  // v1.94: rascunho permite nome vazio (placeholder) — usuario complementa depois
  const ehRascunho = !!input._rascunho;
  if (!ehRascunho && !input.destinatario_nome?.trim()) {
    throw new Error('destinatario_nome obrigatorio');
  }
  if (!input.resource_type?.trim() || !input.resource_id?.trim()) {
    throw new Error('resource_type e resource_id obrigatorios');
  }
  // v1.94: telefone opcional em rascunho — assim o user pode salvar e
  // completar dados depois, sem ser bloqueado.
  const phone = normalizarTelefone(input.destinatario_phone, ehRascunho);
  const numero = await proximoNumero(tenant_id, input.tipo, input.categoria_grupo);
  const token = genHex(32);
  const hash = genHex(32);
  const dias = Math.max(1, Math.min(365, input.expira_em_dias ?? 7));
  const expires_at = new Date(Date.now() + dias * 86400_000);

  const emitente = input.emitente_perfil === 'jose_romario_pf' ? 'jose_romario_pf' : 'romatec_pj';

  // v1.96.0: self-heal — se INSERT der "Unknown column", roda ALTERs faltantes
  // e retenta. Cobre casos onde migration nao rodou completa em producao.
  async function selfHealRecibos(): Promise<void> {
    const altersFaltantes = [
      "ALTER TABLE recibos ADD COLUMN categoria_servico VARCHAR(80) NULL",
      "ALTER TABLE recibos ADD COLUMN categoria_grupo VARCHAR(20) NULL",
      "ALTER TABLE recibos ADD COLUMN emitente_perfil VARCHAR(32) NOT NULL DEFAULT 'romatec_pj'",
    ];
    for (const sql of altersFaltantes) {
      try { await pool.execute(sql); console.log('[recibos:self-heal] OK:', sql.slice(0, 80)); }
      catch (e) {
        const m = (e as Error).message || '';
        if (!/Duplicate column|already exists/i.test(m)) {
          console.warn('[recibos:self-heal] falha:', m.slice(0, 100));
        }
      }
    }
  }

  async function executarInsert(): Promise<ResultSetHeader> {
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO recibos (
         tenant_id, numero, tipo, resource_type, resource_id,
         destinatario_nome, destinatario_doc, destinatario_phone,
         destinatario_email, destinatario_endereco,
         valor, forma_pagamento, descricao_servico, codigo_servico_key,
         categoria_servico, categoria_grupo, emitente_perfil,
         token, hash_validacao, status, expires_at, created_by
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'rascunho', ?, ?)`,
      [
        tenant_id, numero, input.tipo, input.resource_type, input.resource_id,
        (input.destinatario_nome || '— preencher —').trim().slice(0, 120),
        input.destinatario_doc?.replace(/\D/g, '').slice(0, 20) || null,
        phone,
        input.destinatario_email?.trim().slice(0, 150) || null,
        input.destinatario_endereco ? JSON.stringify(input.destinatario_endereco) : null,
        input.valor != null ? Math.round(Number(input.valor) * 100) / 100 : null,
        input.forma_pagamento || null,
        input.descricao_servico?.trim() || null,
        input.codigo_servico_key || null,
        input.categoria_servico || null,
        input.categoria_grupo ? input.categoria_grupo.toUpperCase().slice(0, 20) : null,
        emitente,
        token, hash, expires_at, input.created_by ?? null,
      ]
    );
    return res;
  }

  let res: ResultSetHeader;
  try {
    res = await executarInsert();
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/Unknown column/i.test(msg)) {
      console.warn('[recibos] Unknown column detectado — rodando self-heal e retentando...');
      await selfHealRecibos();
      res = await executarInsert(); // retenta — se ainda falhar, propaga
    } else {
      throw err;
    }
  }
  await registrarEvento(res.insertId, 'created', { numero, tipo: input.tipo });
  const recibo = await buscarReciboPorId(res.insertId);
  return input.uuid_local ? { ...recibo, uuid_local: input.uuid_local } : recibo;
}

export async function buscarReciboPorId(id: number | string): Promise<Recibo> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM recibos WHERE id = ?`, [Number(id)]
  );
  if (!rows.length) throw new Error('Recibo nao encontrado');
  return mapRow(rows[0]);
}

export async function buscarReciboPorToken(token: string): Promise<Recibo | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM recibos WHERE token = ? LIMIT 1`, [token]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

export async function buscarReciboPorHash(hash: string): Promise<Recibo | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM recibos WHERE hash_validacao = ? LIMIT 1`, [hash]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

export async function buscarReciboPorZapiMessageId(messageId: string): Promise<Recibo | null> {
  if (!messageId) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM recibos WHERE zapi_message_id = ? LIMIT 1`, [messageId]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

/**
 * v1.99.17: Busca o vale (recibo tipo='vale') mais recente PENDENTE pra um
 * telefone. Pendente = aguardando_envio | enviado | entregue | lido | respondido.
 * NAO inclui confirmado/contestado/cancelado/expirado.
 *
 * Usado pelo webhook do WhatsApp pra detectar resposta de confirmacao de vale
 * ANTES de cair no fluxo de recibo quinzenal.
 */
export async function buscarValePendentePorPhone(phone: string): Promise<Recibo | null> {
  const phoneNorm = normalizarTelefone(phone, true); // opcional=true: nao lanca se invalido
  if (!phoneNorm) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM recibos
      WHERE tenant_id = 1
        AND tipo = 'vale'
        AND destinatario_phone = ?
        AND status IN ('aguardando_envio','enviado','entregue','lido','respondido')
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 1`,
    [phoneNorm]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

/**
 * v1.99.17: Busca vale CONFIRMADO mais recente pra um telefone.
 * Usado pra responder idempotente quando funcionario manda CONFIRMO 2x.
 */
export async function buscarValeConfirmadoRecentePorPhone(phone: string): Promise<Recibo | null> {
  const phoneNorm = normalizarTelefone(phone, true);
  if (!phoneNorm) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM recibos
      WHERE tenant_id = 1
        AND tipo = 'vale'
        AND destinatario_phone = ?
        AND status = 'confirmado'
        AND respondido_em > NOW() - INTERVAL 24 HOUR
      ORDER BY respondido_em DESC
      LIMIT 1`,
    [phoneNorm]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

export interface ListarFiltro {
  tenant_id?: number;
  tipo?: TipoRecibo;
  status?: StatusRecibo;
  resource_type?: string;
  resource_id?: string;
  phone?: string;
  from?: string;          // YYYY-MM-DD
  to?: string;
  limite?: number;
}

export async function listarRecibos(input: ListarFiltro = {}): Promise<Recibo[]> {
  const tenant_id = input.tenant_id ?? 1;
  const limite = Math.min(Math.max(Number(input.limite) || 100, 1), 500);
  const params: (string | number)[] = [tenant_id];
  let sql = `SELECT * FROM recibos WHERE tenant_id = ?`;
  if (input.tipo)          { sql += ' AND tipo = ?';           params.push(input.tipo); }
  if (input.status)        { sql += ' AND status = ?';         params.push(input.status); }
  if (input.resource_type) { sql += ' AND resource_type = ?';  params.push(input.resource_type); }
  if (input.resource_id)   { sql += ' AND resource_id = ?';    params.push(input.resource_id); }
  if (input.phone)         { sql += ' AND destinatario_phone = ?'; params.push(normalizarTelefone(input.phone)); }
  if (input.from)          { sql += ' AND created_at >= ?';    params.push(input.from); }
  if (input.to)            { sql += ' AND created_at <= ?';    params.push(input.to + ' 23:59:59'); }
  sql += ` ORDER BY created_at DESC LIMIT ${limite}`;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return rows.map(mapRow);
}

export async function cancelarRecibo(id: number | string, motivo?: string): Promise<void> {
  await pool.execute(
    `UPDATE recibos SET status = 'cancelado'
      WHERE id = ? AND status NOT IN ('confirmado','cancelado')`,
    [Number(id)]
  );
  await registrarEvento(Number(id), 'canceled', { motivo: motivo || null });
}

/** Marca como respondido (chamada do endpoint publico /r/:token). */
export interface ResponderInput {
  token: string;
  acao: AcaoResposta;
  obs?: string;
  foto_url?: string;
  lat?: number;
  lng?: number;
  ip?: string;
  user_agent?: string;
}

export async function responderRecibo(input: ResponderInput): Promise<Recibo> {
  const r = await buscarReciboPorToken(input.token);
  if (!r) throw new Error('Recibo nao encontrado');
  if (r.status === 'confirmado' || r.status === 'contestado') {
    throw new Error(`Recibo ja foi ${r.status}`);
  }
  if (r.status === 'cancelado') throw new Error('Recibo foi cancelado');
  if (r.expires_at && r.expires_at.getTime() < Date.now()) {
    await pool.execute(`UPDATE recibos SET status = 'expirado' WHERE id = ?`, [r.id]);
    throw new Error('Link expirado');
  }
  const novoStatus: StatusRecibo =
    input.acao === 'confirma' ? 'confirmado' :
    input.acao === 'contesta' ? 'contestado' :
    'respondido';

  await pool.execute(
    `UPDATE recibos SET
       status = ?, resposta_acao = ?, resposta_obs = ?, resposta_foto_url = ?,
       resposta_lat = ?, resposta_lng = ?, ip_resposta = ?, user_agent_resposta = ?,
       respondido_em = NOW()
     WHERE id = ?`,
    [
      novoStatus, input.acao, input.obs?.trim()?.slice(0, 4000) || null,
      input.foto_url || null,
      input.lat ?? null, input.lng ?? null,
      input.ip?.slice(0, 45) || null, input.user_agent?.slice(0, 255) || null,
      r.id,
    ]
  );
  await registrarEvento(r.id, `answered:${input.acao}`, {
    obs: input.obs ? input.obs.slice(0, 200) : undefined,
    ip: input.ip,
  });

  // v1.78.0: dispara triggers downstream baseados em tipo + acao
  // (fire-and-forget — falha aqui nao impede a resposta voltar pro cliente)
  if (novoStatus === 'confirmado') {
    if (r.tipo === 'proposta') {
      void import('../services/recibosTriggers')
        .then(m => m.processarPropostaAceita(r))
        .catch(err => console.warn('[trigger proposta_aceita]', (err as Error).message));
    }
  }

  return await buscarReciboPorId(r.id);
}

/** Atualiza tracking de envio (entregue/lido) — chamado pelo webhook Z-API. */
export async function marcarEvento(
  id: number,
  evento: 'enviado' | 'entregue' | 'lido',
  zapiMessageId?: string
): Promise<void> {
  const col = evento === 'enviado' ? 'enviado_em'
            : evento === 'entregue' ? 'entregue_em'
            : 'lido_em';
  await pool.execute(
    `UPDATE recibos SET status = ?, ${col} = NOW()${zapiMessageId ? ', zapi_message_id = ?' : ''}
       WHERE id = ?
         AND status NOT IN ('confirmado','contestado','cancelado','expirado')`,
    zapiMessageId ? [evento, zapiMessageId, id] : [evento, id]
  );
  await registrarEvento(id, `delivery:${evento}`, { zapi_message_id: zapiMessageId });
}

async function registrarEvento(
  recibo_id: number,
  event_type: string,
  payload?: Record<string, unknown>
): Promise<void> {
  await pool.execute(
    `INSERT INTO recibos_eventos (recibo_id, event_type, payload) VALUES (?, ?, ?)`,
    [recibo_id, event_type.slice(0, 40), payload ? JSON.stringify(payload) : null]
  ).catch(err => {
    // Nao falha a operacao principal se evento nao gravar
    console.warn('[recibos:evento] falha gravar evento:', (err as Error).message);
  });
}

export async function listarEventos(recibo_id: number | string): Promise<Array<{
  id: number; event_type: string; payload: unknown; created_at: Date;
}>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, event_type, payload, created_at FROM recibos_eventos
      WHERE recibo_id = ? ORDER BY created_at ASC, id ASC`,
    [Number(recibo_id)]
  );
  return rows.map(r => ({
    id: Number(r.id),
    event_type: String(r.event_type),
    payload: r.payload
      ? (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload)
      : null,
    created_at: new Date(r.created_at as Date),
  }));
}

export const META = { TIPO_LABEL, TITULO_PDF, PREFIXOS };

// ────────────────────────────────────────────────────────────────────────
// Envio WhatsApp (Z-API)
// ────────────────────────────────────────────────────────────────────────

import { sendReply, sendDocument } from './whatsapp';
import { gerarPdfRecibo } from '../services/reciboPdf';
import { montarMensagem } from '../services/reciboWhatsappTemplates';
import { getTenantSettings } from '../services/tenantSettings';

function getBaseUrl(): string {
  return (process.env.BASE_URL || 'https://romatecvoiceagent-production.up.railway.app').replace(/\/$/, '');
}

/**
 * Envia o recibo pelo WhatsApp:
 *  1) mensagem texto com link unico /r/:token
 *  2) (opcional) PDF anexado como documento
 *
 * Atualiza status pra 'enviado' + grava enviado_em + zapi_message_id.
 * Idempotente — se ja foi enviado, nao reenvia (use reenviar() pra forcar).
 */
export async function enviarReciboWhatsApp(input: {
  id: number | string;
  enviar_pdf?: boolean;        // default: true
  forcar?: boolean;            // ignora status atual e reenvia
  /** v1.97.0: telefone alternativo — sobrescreve o destinatario do recibo SO neste envio.
   *  Usado pra mandar recibo ja emitido pra outro numero sem alterar o original. */
  phone_override?: string;
}): Promise<{ ok: true; messageId?: string; phone: string; numero: string }> {
  const r = await buscarReciboPorId(input.id);
  if (!input.forcar && r.status !== 'rascunho' && r.status !== 'aguardando_envio') {
    if (r.status === 'cancelado' || r.status === 'expirado') {
      throw new Error(`Recibo ${r.status}, nao pode ser enviado`);
    }
    if (r.status === 'confirmado' || r.status === 'contestado') {
      throw new Error(`Recibo ja foi ${r.status} pelo destinatario`);
    }
  }

  const tenant = await getTenantSettings(r.tenant_id).catch(() => null);
  const link = `${getBaseUrl()}/r/${r.token}`;
  const texto = montarMensagem(r, tenant ?? {}, link);

  // v1.97.0: phone override pra envio ad-hoc pra outro numero
  const telDestino = input.phone_override
    ? normalizarTelefone(input.phone_override)
    : r.destinatario_phone;

  // 1) texto com link
  const sentText = await sendReply(telDestino, texto);

  // 2) PDF (opcional, default true)
  if (input.enviar_pdf !== false) {
    try {
      const pdfBuf = await gerarPdfRecibo(r);
      const fileName = `${r.numero}.pdf`;
      await sendDocument(telDestino, pdfBuf.toString('base64'), fileName);
    } catch (err) {
      console.warn(`[recibos] falha enviar PDF do recibo #${r.id}:`, (err as Error).message);
    }
  }

  // Atualiza status (so se nao for override pra outro num — preserva
  // status original quando reenvio e ad-hoc pra outro destinatario)
  if (!input.phone_override || telDestino === r.destinatario_phone) {
    await pool.execute(
      `UPDATE recibos SET status = 'enviado', enviado_em = NOW(),
                         zapi_message_id = ?
         WHERE id = ?`,
      [sentText.messageId || null, r.id]
    );
  }
  await registrarEvento(r.id, input.phone_override ? 'sent_override' : 'sent', {
    phone: sentText.phone,
    messageId: sentText.messageId,
    pdf_anexado: input.enviar_pdf !== false,
    forcado: !!input.forcar,
    override: !!input.phone_override,
  });

  return {
    ok: true,
    messageId: sentText.messageId,
    phone: sentText.phone,
    numero: r.numero,
  };
}

/** Reenvia recibo (gera lembrete). Atualiza last_reminder_at. */
export async function reenviarRecibo(id: number | string): Promise<void> {
  const r = await buscarReciboPorId(id);
  if (r.status === 'confirmado' || r.status === 'contestado') {
    throw new Error('Recibo ja foi respondido');
  }
  if (r.status === 'cancelado' || r.status === 'expirado') {
    throw new Error(`Recibo ${r.status}`);
  }
  await enviarReciboWhatsApp({ id, forcar: true, enviar_pdf: false });
  await pool.execute(
    `UPDATE recibos SET last_reminder_at = NOW() WHERE id = ?`, [Number(id)]
  );
  await registrarEvento(Number(id), 'reminded', {});
}
