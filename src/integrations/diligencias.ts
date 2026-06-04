// v3.54.0 — Camada de dados/negócio do módulo Diligências de Campo.
import pool from '../database/connection';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { sendReply } from './whatsapp';
import {
  montarMensagemConfirmacao,
  montarMensagemLembrete,
  classificarResposta,
  normalizarTelefone,
  telefoneValido,
} from '../services/diligenciaMensagem';
import type {
  CreateDiligenciaDto,
  UpdateDiligenciaDto,
  DiligenciaComProposta,
  DiligenciaFinalidade,
  DiligenciaStatus,
} from '../types/diligencia';
import { DILIGENCIA_FINALIDADES, DILIGENCIA_STATUSES } from '../types/diligencia';

/** Erro com status HTTP pra rota mapear (404/422/400). */
export class DiligenciaError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'DiligenciaError';
  }
}

const SELECT_BASE = `
  SELECT d.*, p.numero AS proposta_numero, p.endereco_obra AS endereco_imovel,
         c.nome AS cliente_nome
    FROM diligencias d
    JOIN propostas p ON p.id = d.proposta_id
    LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
`;

function mapRow(r: RowDataPacket): DiligenciaComProposta {
  return {
    id: Number(r.id),
    proposta_id: Number(r.proposta_id),
    finalidade: r.finalidade as DiligenciaFinalidade,
    telefone: String(r.telefone),
    email: r.email ?? null,
    data_sugerida: new Date(r.data_sugerida),
    status: r.status as DiligenciaStatus,
    resposta_cliente: r.resposta_cliente ?? null,
    data_confirmacao: r.data_confirmacao ? new Date(r.data_confirmacao) : null,
    lembrete_enviado: Boolean(r.lembrete_enviado),
    created_at: new Date(r.created_at),
    updated_at: new Date(r.updated_at),
    proposta_numero: String(r.proposta_numero ?? ''),
    cliente_nome: String(r.cliente_nome ?? 'Cliente'),
    endereco_imovel: r.endereco_imovel ?? null,
  };
}

// ── Listagem com filtros + paginação ────────────────────────────────────────
export async function listarDiligencias(input: {
  status?: string;
  proposta_id?: string | number;
  page?: number;
  limit?: number;
}): Promise<{ items: DiligenciaComProposta[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (input.status && DILIGENCIA_STATUSES.includes(input.status as DiligenciaStatus)) {
    where.push('d.status = ?'); params.push(input.status);
  }
  if (input.proposta_id != null && Number(input.proposta_id)) {
    where.push('d.proposta_id = ?'); params.push(Number(input.proposta_id));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM diligencias d ${whereSql}`, params,
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await pool.query<RowDataPacket[]>(
    `${SELECT_BASE} ${whereSql} ORDER BY d.data_sugerida DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );
  return { items: rows.map(mapRow), total, page, limit };
}

export async function buscarDiligencia(id: number | string): Promise<DiligenciaComProposta | null> {
  const idNum = Number(id);
  if (!idNum) throw new DiligenciaError(400, 'id inválido');
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT_BASE} WHERE d.id = ? LIMIT 1`, [idNum]);
  return rows.length ? mapRow(rows[0]) : null;
}

/** Resolve id interno OU número da proposta ("PROP-...", "2026-00361") → id. */
export async function resolverPropostaId(ref: number | string): Promise<number> {
  const s = String(ref ?? '').trim();
  if (!s) throw new DiligenciaError(400, 'proposta_id obrigatório');
  if (/^\d+$/.test(s)) {
    const [byId] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM propostas WHERE id = ? AND deleted_at IS NULL LIMIT 1`, [Number(s)],
    );
    if (byId.length) return Number(byId[0].id);
  }
  const [byNum] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM propostas WHERE numero = ? AND deleted_at IS NULL LIMIT 1`, [s],
  );
  if (byNum.length) return Number(byNum[0].id);
  throw new DiligenciaError(404, 'proposta não encontrada');
}

// ── Criação (+ disparo de confirmação) ──────────────────────────────────────
export async function criarDiligencia(
  dto: CreateDiligenciaDto,
): Promise<{ diligencia: DiligenciaComProposta; aviso?: string }> {
  if (dto.proposta_id == null || String(dto.proposta_id).trim() === '') {
    throw new DiligenciaError(400, 'proposta_id obrigatório');
  }
  if (!DILIGENCIA_FINALIDADES.includes(dto.finalidade)) {
    throw new DiligenciaError(400, `finalidade inválida: ${dto.finalidade}`);
  }
  if (!telefoneValido(dto.telefone)) {
    throw new DiligenciaError(422, 'telefone deve ter entre 10 e 13 dígitos');
  }
  const data = new Date(dto.data_sugerida);
  if (isNaN(data.getTime())) throw new DiligenciaError(422, 'data_sugerida inválida');
  if (data.getTime() < Date.now()) throw new DiligenciaError(422, 'data_sugerida não pode ser no passado');

  // Resolve id interno OU número da proposta → id; 404 se não existir.
  const propostaId = await resolverPropostaId(dto.proposta_id);

  const telefone = normalizarTelefone(dto.telefone);
  const [ins] = await pool.execute<ResultSetHeader>(
    `INSERT INTO diligencias (proposta_id, finalidade, telefone, email, data_sugerida)
     VALUES (?, ?, ?, ?, ?)`,
    [propostaId, dto.finalidade, telefone, dto.email ?? null, data],
  );
  const diligencia = await buscarDiligencia(ins.insertId);
  if (!diligencia) throw new DiligenciaError(500, 'falha ao recarregar diligência criada');

  // Dispara confirmação — falha NÃO impede a criação.
  const envio = await dispararMensagem(diligencia, 'confirmacao');
  return envio.ok ? { diligencia } : { diligencia, aviso: 'Diligência criada, mas falha no envio WhatsApp' };
}

export async function atualizarDiligencia(
  id: number | string, dto: UpdateDiligenciaDto,
): Promise<DiligenciaComProposta> {
  const idNum = Number(id);
  if (!idNum) throw new DiligenciaError(400, 'id inválido');
  const fields: string[] = [];
  const params: (string | number | Date | null)[] = [];
  const set = (col: string, val: string | number | Date | null) => { fields.push(`${col} = ?`); params.push(val); };

  if (dto.status) {
    if (!DILIGENCIA_STATUSES.includes(dto.status)) throw new DiligenciaError(400, `status inválido: ${dto.status}`);
    set('status', dto.status);
  }
  if (dto.resposta_cliente !== undefined) set('resposta_cliente', dto.resposta_cliente);
  if (dto.data_sugerida) {
    const d = new Date(dto.data_sugerida);
    if (isNaN(d.getTime())) throw new DiligenciaError(422, 'data_sugerida inválida');
    set('data_sugerida', d);
  }
  if (dto.data_confirmacao) set('data_confirmacao', new Date(dto.data_confirmacao));
  if (dto.lembrete_enviado !== undefined) set('lembrete_enviado', dto.lembrete_enviado ? 1 : 0);

  if (!fields.length) throw new DiligenciaError(400, 'nada a atualizar');
  params.push(idNum);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE diligencias SET ${fields.join(', ')} WHERE id = ?`, params,
  );
  if (r.affectedRows === 0) throw new DiligenciaError(404, 'diligência não encontrada');
  const d = await buscarDiligencia(idNum);
  if (!d) throw new DiligenciaError(404, 'diligência não encontrada');
  return d;
}

/** Cancelamento soft: status = 'cancelado'. */
export async function cancelarDiligencia(id: number | string): Promise<DiligenciaComProposta> {
  return atualizarDiligencia(id, { status: 'cancelado' });
}

export async function reenviarConfirmacao(id: number | string): Promise<{ ok: boolean; aviso?: string }> {
  const d = await buscarDiligencia(id);
  if (!d) throw new DiligenciaError(404, 'diligência não encontrada');
  const envio = await dispararMensagem(d, 'confirmacao');
  return envio.ok ? { ok: true } : { ok: false, aviso: 'Falha no reenvio WhatsApp' };
}

// ── Envio + log ─────────────────────────────────────────────────────────────
async function registrarMensagem(input: {
  diligencia_id: number;
  tipo: 'confirmacao' | 'lembrete' | 'remarcacao';
  telefone: string;
  mensagem: string;
  zapi_message_id?: string | null;
  status_envio: 'enviado' | 'erro';
  erro_detalhe?: string | null;
}): Promise<void> {
  await pool.execute(
    `INSERT INTO diligencias_mensagens
       (diligencia_id, tipo, telefone, mensagem, zapi_message_id, status_envio, erro_detalhe)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.diligencia_id, input.tipo, input.telefone, input.mensagem,
     input.zapi_message_id ?? null, input.status_envio, input.erro_detalhe ?? null],
  );
}

async function dispararMensagem(
  d: DiligenciaComProposta, tipo: 'confirmacao' | 'lembrete',
): Promise<{ ok: boolean; messageId?: string }> {
  const vars = {
    nomeCliente: d.cliente_nome,
    numProposta: d.proposta_numero,
    finalidade: d.finalidade,
    enderecoImovel: d.endereco_imovel,
    dataHora: d.data_sugerida,
  };
  const mensagem = tipo === 'confirmacao'
    ? montarMensagemConfirmacao(vars)
    : montarMensagemLembrete(vars);
  try {
    const res = await sendReply(d.telefone, mensagem);
    await registrarMensagem({
      diligencia_id: d.id, tipo, telefone: d.telefone, mensagem,
      zapi_message_id: res.messageId ?? null, status_envio: 'enviado',
    });
    return { ok: true, messageId: res.messageId };
  } catch (err) {
    await registrarMensagem({
      diligencia_id: d.id, tipo, telefone: d.telefone, mensagem,
      status_envio: 'erro', erro_detalhe: (err as Error).message.slice(0, 500),
    }).catch(() => {});
    console.warn(`[diligencias] envio ${tipo} falhou (dil #${d.id}):`, (err as Error).message);
    return { ok: false };
  }
}

// ── Webhook: resposta do cliente ────────────────────────────────────────────
/**
 * Processa uma mensagem recebida. Se o telefone tiver diligência PENDENTE,
 * classifica SIM/REMARCAR/NÃO e atualiza. Retorna handled=true só quando
 * reconhecida (pra o webhook dar `continue` e não acionar a ZAYRA).
 */
export async function processarRespostaDiligencia(
  phone: string, texto: string,
): Promise<{ handled: boolean; acao?: 'confirmado' | 'remarcado' | 'cancelado'; diligencia_id?: number }> {
  const tel = normalizarTelefone(phone);
  if (!tel) return { handled: false };
  const acao = classificarResposta(texto);
  if (!acao) return { handled: false };

  // Diligência pendente mais recente desse telefone (match por sufixo, tolera DDI).
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM diligencias
      WHERE status = 'pendente' AND (telefone = ? OR ? LIKE CONCAT('%', telefone) OR telefone LIKE CONCAT('%', ?))
      ORDER BY created_at DESC LIMIT 1`,
    [tel, tel, tel],
  );
  if (!rows.length) return { handled: false };
  const id = Number(rows[0].id);

  if (acao === 'sim') {
    await pool.execute(
      `UPDATE diligencias SET status='confirmado', data_confirmacao=NOW(), resposta_cliente=? WHERE id=?`,
      [texto.slice(0, 1000), id],
    );
    return { handled: true, acao: 'confirmado', diligencia_id: id };
  }
  if (acao === 'remarcar') {
    await pool.execute(
      `UPDATE diligencias SET status='remarcado', resposta_cliente=? WHERE id=?`,
      [texto.slice(0, 1000), id],
    );
    return { handled: true, acao: 'remarcado', diligencia_id: id };
  }
  await pool.execute(
    `UPDATE diligencias SET status='cancelado', resposta_cliente=? WHERE id=?`,
    [texto.slice(0, 1000), id],
  );
  return { handled: true, acao: 'cancelado', diligencia_id: id };
}

// ── Job D-1: lembretes ──────────────────────────────────────────────────────
export async function buscarLembretesPendentes(): Promise<DiligenciaComProposta[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${SELECT_BASE}
      WHERE d.status = 'confirmado' AND d.lembrete_enviado = 0
        AND d.data_sugerida >= (CURDATE() + INTERVAL 1 DAY)
        AND d.data_sugerida <  (CURDATE() + INTERVAL 2 DAY)`,
  );
  return rows.map(mapRow);
}

export async function enviarLembretesDiligencias(): Promise<{ enviados: number; falhas: number }> {
  const pendentes = await buscarLembretesPendentes();
  let enviados = 0, falhas = 0;
  for (const d of pendentes) {
    const r = await dispararMensagem(d, 'lembrete');
    if (r.ok) {
      await pool.execute(`UPDATE diligencias SET lembrete_enviado = 1 WHERE id = ?`, [d.id]);
      enviados++;
    } else {
      falhas++;
    }
  }
  return { enviados, falhas };
}
