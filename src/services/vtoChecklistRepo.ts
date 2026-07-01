// src/services/vtoChecklistRepo.ts
// v3.78.0 — Persistência do VTO Checklist (pool MySQL2 do projeto).
// Segurança (P1): todo UPDATE/DELETE/status carrega `colaborador_id` no WHERE.
import { createHash } from 'crypto';
import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import pool from '../database/connection';
import { VTO_CATALOGO } from '../data/vtoCatalogo';
import { calcularPercentual } from './vtoChecklistCalc';
import type {
  VtoCatalogoItem, VtoChecklist, VtoChecklistItem, VtoStatus,
} from '../types/vtoChecklist';

const STATUS_VALIDOS: VtoStatus[] = ['nao_iniciado', 'iniciado', 'em_andamento', 'concluido'];
const RESP_PADRAO = 'José Romário Pinto Bezerra — Téc. Edificações / Agrimensura';

function normStatus(s: unknown): VtoStatus {
  return STATUS_VALIDOS.includes(s as VtoStatus) ? (s as VtoStatus) : 'nao_iniciado';
}

/** Catálogo de atividades (fallback para a constante se a tabela vier vazia). */
export async function getCatalogo(): Promise<VtoCatalogoItem[]> {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT disciplina_ordem, disciplina_nome, atividade, atividade_ordem
         FROM vto_atividades_catalogo WHERE ativo = 1
        ORDER BY disciplina_ordem, atividade_ordem`,
    );
    if (rows.length) return rows as unknown as VtoCatalogoItem[];
  } catch (err) {
    console.warn('[vtoChecklistRepo.getCatalogo] fallback constante:', (err as Error).message.slice(0, 140));
  }
  return VTO_CATALOGO;
}

function gerarHash(obra_nome: string, cliente: string, data_vistoria: string, colaboradorId: string): string {
  const base = `${obra_nome}|${cliente}|${data_vistoria}|${Date.now()}|${colaboradorId}`;
  return createHash('sha256').update(base).digest('hex');
}

async function inserirItens(conn: PoolConnection, checklistId: number, itens: VtoChecklistItem[]): Promise<void> {
  if (!itens.length) return;
  const ph = itens.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  const p: (string | number | null)[] = [];
  for (const it of itens) {
    const m2 = it.metros_quadrados;
    p.push(
      checklistId,
      it.disciplina_ordem,
      it.disciplina_nome,
      it.atividade,
      it.atividade_ordem,
      normStatus(it.status),
      it.comodo_local ?? null,
      m2 == null || Number.isNaN(Number(m2)) ? null : Number(m2),
      it.observacao ?? null,
    );
  }
  await conn.execute(
    `INSERT INTO vto_checklist_itens
       (checklist_id, disciplina_ordem, disciplina_nome, atividade, atividade_ordem,
        status, comodo_local, metros_quadrados, observacao)
     VALUES ${ph}`,
    p,
  );
}

export async function criar(data: VtoChecklist): Promise<{ id: number; percentual_fisico: number; hash_validacao: string; numero_vto: string }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const percentual = calcularPercentual(data.itens || []).geral;
    const hash = gerarHash(data.obra_nome, data.cliente ?? '', data.data_vistoria ?? '', data.colaborador_id);

    const [r] = await conn.execute<ResultSetHeader>(
      `INSERT INTO vto_checklist
         (colaborador_id, obra_id, numero_vto, obra_nome, cliente, endereco, cidade_uf,
          data_vistoria, etapa, responsavel_tecnico, art_trt, observacoes_gerais,
          pendencias, proxima_vistoria, percentual_fisico, status, hash_validacao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.colaborador_id,
        data.obra_id ?? null,
        data.numero_vto ?? null,
        data.obra_nome,
        data.cliente ?? null,
        data.endereco ?? null,
        data.cidade_uf ?? null,
        data.data_vistoria ?? null,
        data.etapa ?? null,
        data.responsavel_tecnico?.trim() || RESP_PADRAO,
        data.art_trt ?? null,
        data.observacoes_gerais ?? null,
        data.pendencias ?? null,
        data.proxima_vistoria ?? null,
        percentual,
        data.status && ['rascunho', 'finalizado', 'enviado'].includes(data.status) ? data.status : 'rascunho',
        hash,
      ],
    );
    const id = r.insertId;

    // Numeração automática se não veio no payload: VTO-AAAA-NNNN.
    let numero = data.numero_vto ?? '';
    if (!numero) {
      const ano = (data.data_vistoria ? new Date(data.data_vistoria) : new Date()).getFullYear();
      numero = `VTO-${ano}-${String(id).padStart(4, '0')}`;
      await conn.execute('UPDATE vto_checklist SET numero_vto = ? WHERE id = ?', [numero, id]);
    }

    await inserirItens(conn, id, data.itens || []);
    await conn.commit();
    return { id, percentual_fisico: percentual, hash_validacao: hash, numero_vto: numero };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw new Error(`[vtoChecklistRepo.criar] ${(err as Error).message}`);
  } finally {
    conn.release();
  }
}

async function carregarItens(checklistId: number): Promise<VtoChecklistItem[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, disciplina_ordem, disciplina_nome, atividade, atividade_ordem,
            status, comodo_local, metros_quadrados, observacao
       FROM vto_checklist_itens WHERE checklist_id = ?
      ORDER BY disciplina_ordem, atividade_ordem`,
    [checklistId],
  );
  return (rows as unknown as VtoChecklistItem[]).map((it) => ({
    ...it,
    metros_quadrados: it.metros_quadrados == null ? null : Number(it.metros_quadrados),
  }));
}

function mapHeader(row: RowDataPacket): VtoChecklist {
  return {
    ...(row as unknown as VtoChecklist),
    percentual_fisico: row.percentual_fisico == null ? 0 : Number(row.percentual_fisico),
    itens: [],
  };
}

export async function buscar(id: number, colaboradorId: string): Promise<VtoChecklist | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM vto_checklist WHERE id = ? AND colaborador_id = ?',
    [id, colaboradorId],
  );
  if (!rows.length) return null;
  const doc = mapHeader(rows[0]);
  doc.itens = await carregarItens(id);
  return doc;
}

/** Página pública de validação — sem exigir colaborador. */
export async function buscarPorHash(hash: string): Promise<VtoChecklist | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM vto_checklist WHERE hash_validacao = ? LIMIT 1',
    [hash],
  );
  if (!rows.length) return null;
  const doc = mapHeader(rows[0]);
  doc.itens = await carregarItens(doc.id as number);
  return doc;
}

export async function atualizar(id: number, colaboradorId: string, data: VtoChecklist): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const percentual = calcularPercentual(data.itens || []).geral;
    // Dono no WHERE do UPDATE (P1). Só atualiza colunas de conteúdo.
    const [r] = await conn.execute<ResultSetHeader>(
      `UPDATE vto_checklist SET
         obra_id = ?, numero_vto = COALESCE(?, numero_vto), obra_nome = ?, cliente = ?, endereco = ?,
         cidade_uf = ?, data_vistoria = ?, etapa = ?, responsavel_tecnico = ?, art_trt = ?,
         observacoes_gerais = ?, pendencias = ?, proxima_vistoria = ?, percentual_fisico = ?
       WHERE id = ? AND colaborador_id = ?`,
      [
        data.obra_id ?? null,
        data.numero_vto ?? null,
        data.obra_nome,
        data.cliente ?? null,
        data.endereco ?? null,
        data.cidade_uf ?? null,
        data.data_vistoria ?? null,
        data.etapa ?? null,
        data.responsavel_tecnico?.trim() || RESP_PADRAO,
        data.art_trt ?? null,
        data.observacoes_gerais ?? null,
        data.pendencias ?? null,
        data.proxima_vistoria ?? null,
        percentual,
        id,
        colaboradorId,
      ],
    );
    if (!r.affectedRows) { await conn.rollback().catch(() => undefined); return false; }
    // Substitui itens (só quando o dono confere — o checklist_id já foi validado acima).
    await conn.execute('DELETE FROM vto_checklist_itens WHERE checklist_id = ?', [id]);
    await inserirItens(conn, id, data.itens || []);
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw new Error(`[vtoChecklistRepo.atualizar] ${(err as Error).message}`);
  } finally {
    conn.release();
  }
}

export async function listar(
  colaboradorId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<VtoChecklist[]> {
  const lim = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  const off = Math.max(0, Math.trunc(Number(offset) || 0));
  // LIMIT/OFFSET inlinados (inteiros validados) — evita quirk do prepared stmt.
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, colaborador_id, obra_id, numero_vto, obra_nome, cliente, endereco, cidade_uf,
            data_vistoria, etapa, art_trt, percentual_fisico, status, hash_validacao,
            created_at, updated_at
       FROM vto_checklist WHERE colaborador_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ${lim} OFFSET ${off}`,
    [colaboradorId],
  );
  return (rows as RowDataPacket[]).map((row) => mapHeader(row));
}

export async function definirStatusEnviado(id: number, colaboradorId: string): Promise<void> {
  await pool.execute(
    "UPDATE vto_checklist SET status = 'enviado' WHERE id = ? AND colaborador_id = ?",
    [id, colaboradorId],
  );
}

export async function definirStatusFinalizado(id: number, colaboradorId: string): Promise<void> {
  await pool.execute(
    "UPDATE vto_checklist SET status = 'finalizado' WHERE id = ? AND colaborador_id = ? AND status = 'rascunho'",
    [id, colaboradorId],
  );
}
