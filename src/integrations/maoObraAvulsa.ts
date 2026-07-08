// src/integrations/maoObraAvulsa.ts
// v3.92.0 — Persistência do detalhe de "Pagamento a Mão de Obra Avulsa".
// O hash/QR/status/confirmação vivem no RECIBO UNIVERSAL (recibos); aqui só os
// campos do prestador/serviço/obra + o comprovante (base64), ligados ao recibo
// por recibo_id / resource_id.
import pool from '../database/connection';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export type FormaPagamentoAvulsa = 'pix' | 'dinheiro' | 'transferencia' | 'outro';
export const FORMAS_AVULSA: FormaPagamentoAvulsa[] = ['pix', 'dinheiro', 'transferencia', 'outro'];

export interface MaoObraAvulsa {
  id: number;
  obra_id: number | null;
  recibo_id: number | null;
  nome_prestador: string;
  telefone_whatsapp: string;
  cpf: string | null;
  tipo_servico: string;
  descricao_servico: string | null;
  valor_pago: number;
  forma_pagamento: FormaPagamentoAvulsa;
  data_pagamento: string | null;
  comprovante_nome: string | null;
  comprovante_mime: string | null;
  created_at: string;
  updated_at: string;
  // Enriquecidos via JOIN com recibos (quando já enviado):
  recibo_numero?: string | null;
  recibo_status?: string | null;
  recibo_hash?: string | null;
  obra_nome?: string | null;
  tem_comprovante?: boolean;
}

export interface CriarMaoObraInput {
  obra_id?: number | null;
  nome_prestador: string;
  telefone_whatsapp: string;
  cpf?: string | null;
  tipo_servico: string;
  descricao_servico?: string | null;
  valor_pago: number;
  forma_pagamento?: FormaPagamentoAvulsa;
  data_pagamento: string; // YYYY-MM-DD
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

function apenasBase64(s?: string | null): string | null {
  if (!s) return null;
  const m = /^data:[^;]+;base64,(.*)$/s.exec(s);
  return m ? m[1] : s;
}

/**
 * v3.92.3 — Resolve o obra_id a partir de um nome livre: acha por nome
 * (case-insensitive) ou CRIA uma obra nova em romatec_obras (reutilizável na
 * próxima). Permite o campo "Obra" ser combobox editável (opção OU texto livre).
 */
export async function resolverObraIdPorNome(nome: string): Promise<number | null> {
  const n = String(nome || '').trim();
  if (!n) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM romatec_obras WHERE LOWER(nome) = LOWER(?) ORDER BY id LIMIT 1', [n],
  );
  if (rows.length) return Number(rows[0].id);
  const [r] = await pool.execute<ResultSetHeader>(
    'INSERT INTO romatec_obras (nome) VALUES (?)', [n.slice(0, 200)],
  );
  return r.insertId;
}

export async function criar(input: CriarMaoObraInput): Promise<{ id: number }> {
  const forma: FormaPagamentoAvulsa = FORMAS_AVULSA.includes(input.forma_pagamento as FormaPagamentoAvulsa)
    ? (input.forma_pagamento as FormaPagamentoAvulsa) : 'pix';
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO mao_obra_avulsa
       (obra_id, nome_prestador, telefone_whatsapp, cpf, tipo_servico, descricao_servico,
        valor_pago, forma_pagamento, data_pagamento)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.obra_id ?? null,
      String(input.nome_prestador).slice(0, 150),
      String(input.telefone_whatsapp).replace(/\D/g, '').slice(0, 20),
      input.cpf ? String(input.cpf).slice(0, 20) : null,
      String(input.tipo_servico).slice(0, 255),
      input.descricao_servico ?? null,
      Number(input.valor_pago),
      forma,
      input.data_pagamento,
    ],
  );
  return { id: r.insertId };
}

function mapRow(r: RowDataPacket): MaoObraAvulsa {
  return {
    id: Number(r.id),
    obra_id: r.obra_id == null ? null : Number(r.obra_id),
    recibo_id: r.recibo_id == null ? null : Number(r.recibo_id),
    nome_prestador: String(r.nome_prestador),
    telefone_whatsapp: String(r.telefone_whatsapp),
    cpf: r.cpf ?? null,
    tipo_servico: String(r.tipo_servico),
    descricao_servico: r.descricao_servico ?? null,
    valor_pago: num(r.valor_pago),
    forma_pagamento: r.forma_pagamento as FormaPagamentoAvulsa,
    data_pagamento: r.data_pagamento ? String(r.data_pagamento).slice(0, 10) : null,
    comprovante_nome: r.comprovante_nome ?? null,
    comprovante_mime: r.comprovante_mime ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    recibo_numero: r.recibo_numero ?? null,
    recibo_status: r.recibo_status ?? null,
    recibo_hash: r.recibo_hash ?? null,
    obra_nome: r.obra_nome ?? null,
    tem_comprovante: r.tem_comprovante === 1 || r.tem_comprovante === '1',
  };
}

const SELECT_JOIN = `
  SELECT m.*,
         (m.comprovante_b64 IS NOT NULL) AS tem_comprovante,
         r.numero AS recibo_numero, r.status AS recibo_status, r.hash_validacao AS recibo_hash,
         o.nome AS obra_nome
    FROM mao_obra_avulsa m
    LEFT JOIN recibos r ON r.id = m.recibo_id
    LEFT JOIN romatec_obras o ON o.id = m.obra_id`;

export async function buscar(id: number): Promise<MaoObraAvulsa | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(`${SELECT_JOIN} WHERE m.id = ? LIMIT 1`, [id]);
  return rows.length ? mapRow(rows[0]) : null;
}

/** Busca o comprovante (base64) de um registro. */
export async function comprovanteB64(id: number): Promise<{ mime: string; base64: string; nome: string } | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT comprovante_mime, comprovante_b64, comprovante_nome FROM mao_obra_avulsa WHERE id = ? LIMIT 1', [id],
  );
  if (!rows.length || !rows[0].comprovante_b64) return null;
  return { mime: rows[0].comprovante_mime || 'application/octet-stream', base64: String(rows[0].comprovante_b64), nome: rows[0].comprovante_nome || 'comprovante' };
}

export async function definirComprovante(id: number, nf: { nome: string; mime: string; base64: string }): Promise<boolean> {
  const b64 = apenasBase64(nf.base64);
  if (!b64) throw new Error('Comprovante sem conteúdo.');
  const [r] = await pool.execute<ResultSetHeader>(
    'UPDATE mao_obra_avulsa SET comprovante_nome = ?, comprovante_mime = ?, comprovante_b64 = ? WHERE id = ?',
    [nf.nome.slice(0, 255), nf.mime.slice(0, 80), b64, id],
  );
  return r.affectedRows > 0;
}

export async function vincularRecibo(id: number, reciboId: number): Promise<void> {
  await pool.execute('UPDATE mao_obra_avulsa SET recibo_id = ? WHERE id = ?', [reciboId, id]);
}

/** v3.92.4 — Edita os campos do detalhe (o PDF é gerado a partir daqui, então
 * editar + reenviar já reflete no recibo reemitido). */
export async function atualizar(id: number, patch: Partial<CriarMaoObraInput>): Promise<boolean> {
  const forma = patch.forma_pagamento && FORMAS_AVULSA.includes(patch.forma_pagamento)
    ? patch.forma_pagamento : null;
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE mao_obra_avulsa SET
       obra_id = ?, nome_prestador = COALESCE(?, nome_prestador),
       telefone_whatsapp = COALESCE(?, telefone_whatsapp), cpf = ?,
       tipo_servico = COALESCE(?, tipo_servico), descricao_servico = ?,
       valor_pago = COALESCE(?, valor_pago), forma_pagamento = COALESCE(?, forma_pagamento),
       data_pagamento = COALESCE(?, data_pagamento)
     WHERE id = ?`,
    [
      patch.obra_id ?? null,
      patch.nome_prestador != null ? String(patch.nome_prestador).slice(0, 150) : null,
      patch.telefone_whatsapp != null ? String(patch.telefone_whatsapp).replace(/\D/g, '').slice(0, 20) : null,
      patch.cpf != null ? String(patch.cpf).slice(0, 20) : null,
      patch.tipo_servico != null ? String(patch.tipo_servico).slice(0, 255) : null,
      patch.descricao_servico ?? null,
      patch.valor_pago != null ? Number(patch.valor_pago) : null,
      forma,
      patch.data_pagamento ?? null,
      id,
    ],
  );
  return r.affectedRows > 0;
}

/** v3.92.4 — Remove o registro; se tiver recibo (não confirmado), marca cancelado. */
export async function remover(id: number): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT recibo_id FROM mao_obra_avulsa WHERE id = ? LIMIT 1', [id]);
  if (!rows.length) return false;
  const reciboId = rows[0].recibo_id;
  if (reciboId) {
    await pool.execute("UPDATE recibos SET status = 'cancelado' WHERE id = ? AND status <> 'confirmado'", [reciboId]).catch(() => undefined);
  }
  const [r] = await pool.execute<ResultSetHeader>('DELETE FROM mao_obra_avulsa WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

export async function listar(opts: { obra_id?: number; status?: string; limit?: number } = {}): Promise<MaoObraAvulsa[]> {
  const lim = Math.max(1, Math.min(200, Math.trunc(Number(opts.limit) || 100)));
  const wheres: string[] = [];
  const params: Array<number | string> = [];
  if (opts.obra_id != null) { wheres.push('m.obra_id = ?'); params.push(opts.obra_id); }
  if (opts.status) { wheres.push('r.status = ?'); params.push(opts.status); }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const [rows] = await pool.execute<RowDataPacket[]>(
    `${SELECT_JOIN} ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT ${lim}`, params,
  );
  return (rows as RowDataPacket[]).map(mapRow);
}

/** Detalhe ligado a um recibo (pra PDF / webhook). */
export async function buscarPorReciboId(reciboId: number): Promise<MaoObraAvulsa | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(`${SELECT_JOIN} WHERE m.recibo_id = ? LIMIT 1`, [reciboId]);
  return rows.length ? mapRow(rows[0]) : null;
}
