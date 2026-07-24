// src/services/prontuario/prontuarioRepo.ts
// v3.126.0 — Repositório do "Prontuário do Escritório (Multi-Serviços)".
//
// Criar prontuário = 1 transação: insere o cabeçalho, carimba o número
// (PRN-AAAA-NNN, derivado do id), copia as etapas do template e os checklists
// de documentos. Ou tudo entra, ou nada entra — prontuário sem etapas é um
// registro inútil na tela.
//
// A cascata de etapas/documentos no DELETE é do banco (FK ON DELETE CASCADE
// entre as tabelas DESTE módulo — ver migrations-prontuario.ts).

import pool from '../../database/connection';
import type { RowDataPacket, ResultSetHeader, PoolConnection } from 'mysql2/promise';
import {
  etapasDoTemplate,
  rotuloServico,
  formatarNumeroProntuario,
  calcularProgresso,
  type StatusEtapa,
  type StatusDocumento,
  type ResumoProgresso,
  type AtualizacaoEtapaNormalizada,
} from './prontuarioTemplates';

// ── Tipos ────────────────────────────────────────────────────────────────────
export type StatusProntuario = 'em_andamento' | 'concluido' | 'cancelado';

export interface DocumentoEtapa {
  id: number;
  etapa_id: number;
  doc: string;
  status: StatusDocumento;
  observacao: string | null;
}

export interface EtapaProntuario {
  id: number;
  prontuario_id: number;
  ordem: number;
  nome: string;
  status: StatusEtapa;
  data_conclusao: string | null;
  responsavel: string | null;
  observacoes: string | null;
  checklist_documentos: DocumentoEtapa[];
}

export interface Prontuario {
  id: number;
  numero: string;
  cliente: { nome: string; cpf_cnpj: string | null; telefone: string | null };
  servico_contratado: {
    categoria: string;
    sub_tipo: string | null;
    nome: string;
    data_contratacao: string | null;
    previsao_conclusao: string | null;
  };
  status: StatusProntuario;
  responsavel: string | null;
  observacoes: string | null;
  obra_id: number | null;
  user_sub: string | null;
  criado_em: string;
  atualizado_em: string;
  progresso: ResumoProgresso;
  etapas?: EtapaProntuario[];
}

export interface NovoProntuario {
  cliente_nome: string;
  cliente_cpf_cnpj?: string | null;
  cliente_telefone?: string | null;
  categoria: string;
  sub_tipo?: string | null;
  data_contratacao?: string | null;
  previsao_conclusao?: string | null;
  responsavel?: string | null;
  observacoes?: string | null;
  obra_id?: number | null;
  user_sub?: string | null;
}

/** Erro de regra de negócio → a rota traduz para 400 (e não 500). */
export class TemplateDesconhecidoError extends Error {
  constructor(categoria: string, subTipo?: string | null) {
    super(
      `Nenhum roteiro de etapas para categoria "${categoria}"` +
      (subTipo ? ` / sub-tipo "${subTipo}"` : '') +
      '. Confira as opções em GET /api/prontuarios/templates.',
    );
    this.name = 'TemplateDesconhecidoError';
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function isoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function txt(v: unknown, max = 255): string | null {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

// ── Criação ──────────────────────────────────────────────────────────────────
/**
 * Cria o prontuário e gera as etapas do template da categoria/sub-tipo.
 * Lança TemplateDesconhecidoError se a combinação não existir no catálogo.
 */
export async function criarProntuario(input: NovoProntuario): Promise<{ id: number; numero: string; etapas: number }> {
  const etapasTemplate = etapasDoTemplate(input.categoria, input.sub_tipo ?? null);
  if (!etapasTemplate.length) throw new TemplateDesconhecidoError(input.categoria, input.sub_tipo);

  const servicoNome = rotuloServico(input.categoria, input.sub_tipo ?? null);
  const conn = (await pool.getConnection()) as PoolConnection;
  try {
    await conn.beginTransaction();

    const [r] = await conn.execute<ResultSetHeader>(
      `INSERT INTO prontuarios
         (cliente_nome, cliente_cpf_cnpj, cliente_telefone, categoria, sub_tipo, servico_nome,
          data_contratacao, previsao_conclusao, responsavel, observacoes, obra_id, user_sub)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txt(input.cliente_nome)!,
        txt(input.cliente_cpf_cnpj, 24),
        txt(input.cliente_telefone, 32),
        input.categoria,
        input.sub_tipo ?? null,
        servicoNome.slice(0, 255),
        isoDate(input.data_contratacao),
        isoDate(input.previsao_conclusao),
        txt(input.responsavel),
        input.observacoes ? String(input.observacoes) : null,
        input.obra_id ?? null,
        input.user_sub ?? null,
      ],
    );
    const id = r.insertId;

    // Número derivado do id — só existe depois do insert.
    const anoBase = isoDate(input.data_contratacao) ?? new Date().toISOString().slice(0, 10);
    const numero = formatarNumeroProntuario(id, Number(anoBase.slice(0, 4)));
    await conn.execute(`UPDATE prontuarios SET numero = ? WHERE id = ?`, [numero, id]);

    for (const et of etapasTemplate) {
      const [re] = await conn.execute<ResultSetHeader>(
        `INSERT INTO prontuario_etapas (prontuario_id, ordem, nome) VALUES (?, ?, ?)`,
        [id, et.ordem, et.nome.slice(0, 255)],
      );
      for (const d of et.checklist_documentos ?? []) {
        await conn.execute(
          `INSERT INTO prontuario_etapa_documentos (etapa_id, prontuario_id, doc) VALUES (?, ?, ?)`,
          [re.insertId, id, d.doc.slice(0, 255)],
        );
      }
    }

    await conn.commit();
    return { id, numero, etapas: etapasTemplate.length };
  } catch (err) {
    try { await conn.rollback(); } catch { /* conexão já perdida — o erro original é o que importa */ }
    throw err;
  } finally {
    conn.release();
  }
}

// ── Leitura ──────────────────────────────────────────────────────────────────
export async function listarProntuarios(filtros: {
  cliente?: string | null;
  categoria?: string | null;
  status?: string | null;
  obra_id?: number | null;
} = {}): Promise<Prontuario[]> {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filtros.cliente) { where.push('(p.cliente_nome LIKE ? OR p.numero LIKE ?)'); params.push(`%${filtros.cliente}%`, `%${filtros.cliente}%`); }
  if (filtros.categoria) { where.push('p.categoria = ?'); params.push(filtros.categoria); }
  if (filtros.status) { where.push('p.status = ?'); params.push(filtros.status); }
  if (filtros.obra_id != null) { where.push('p.obra_id = ?'); params.push(filtros.obra_id); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.*,
            (SELECT COUNT(*) FROM prontuario_etapas e WHERE e.prontuario_id = p.id) AS total_etapas,
            (SELECT COUNT(*) FROM prontuario_etapas e WHERE e.prontuario_id = p.id AND e.status = 'concluido') AS etapas_concluidas,
            (SELECT COUNT(*) FROM prontuario_etapas e WHERE e.prontuario_id = p.id AND e.status = 'em_andamento') AS etapas_andamento
       FROM prontuarios p
       ${clause}
      ORDER BY p.criado_em DESC, p.id DESC
      LIMIT 500`,
    params,
  );
  return rows.map(mapProntuarioComContagem);
}

/** Detalhe completo: cabeçalho + etapas + checklists, na ordem do roteiro. */
export async function obterProntuario(id: number): Promise<Prontuario | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM prontuarios WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) return null;
  const etapas = await listarEtapas(id);
  const p = mapProntuario(rows[0]);
  p.etapas = etapas;
  p.progresso = calcularProgresso(etapas);
  return p;
}

/** Busca pelo número (PRN-2026-015) — entrada natural de comando por voz/chat. */
export async function obterProntuarioPorNumero(numero: string): Promise<Prontuario | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM prontuarios WHERE numero = ? LIMIT 1`, [String(numero).trim().toUpperCase()],
  );
  return rows.length ? obterProntuario(Number(rows[0].id)) : null;
}

export async function listarEtapas(prontuarioId: number): Promise<EtapaProntuario[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM prontuario_etapas WHERE prontuario_id = ? ORDER BY ordem ASC, id ASC`,
    [prontuarioId],
  );
  const [docs] = await pool.query<RowDataPacket[]>(
    `SELECT id, etapa_id, doc, status, observacao
       FROM prontuario_etapa_documentos WHERE prontuario_id = ? ORDER BY id ASC`,
    [prontuarioId],
  );
  const porEtapa = new Map<number, DocumentoEtapa[]>();
  for (const d of docs) {
    const eid = Number(d.etapa_id);
    if (!porEtapa.has(eid)) porEtapa.set(eid, []);
    porEtapa.get(eid)!.push({
      id: Number(d.id),
      etapa_id: eid,
      doc: String(d.doc),
      status: d.status as StatusDocumento,
      observacao: d.observacao ?? null,
    });
  }
  return rows.map((r) => ({
    id: Number(r.id),
    prontuario_id: Number(r.prontuario_id),
    ordem: Number(r.ordem),
    nome: String(r.nome),
    status: r.status as StatusEtapa,
    data_conclusao: isoDate(r.data_conclusao),
    responsavel: r.responsavel ?? null,
    observacoes: r.observacoes ?? null,
    checklist_documentos: porEtapa.get(Number(r.id)) ?? [],
  }));
}

/** Prontuário dono de uma etapa (pra 404 e pra recalcular o progresso depois). */
export async function prontuarioDaEtapa(etapaId: number): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT prontuario_id FROM prontuario_etapas WHERE id = ? LIMIT 1`, [etapaId],
  );
  return rows.length ? Number(rows[0].prontuario_id) : null;
}

export async function prontuarioDoDocumento(docId: number): Promise<{ prontuario_id: number; etapa_id: number } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT prontuario_id, etapa_id FROM prontuario_etapa_documentos WHERE id = ? LIMIT 1`, [docId],
  );
  return rows.length ? { prontuario_id: Number(rows[0].prontuario_id), etapa_id: Number(rows[0].etapa_id) } : null;
}

// ── Escrita ──────────────────────────────────────────────────────────────────
export async function atualizarProntuario(id: number, campos: {
  cliente_nome?: string | null;
  cliente_cpf_cnpj?: string | null;
  cliente_telefone?: string | null;
  data_contratacao?: string | null;
  previsao_conclusao?: string | null;
  status?: StatusProntuario;
  responsavel?: string | null;
  observacoes?: string | null;
  obra_id?: number | null;
}): Promise<void> {
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  const push = (col: string, val: string | number | null) => { sets.push(`${col} = ?`); vals.push(val); };

  if (campos.cliente_nome !== undefined) push('cliente_nome', txt(campos.cliente_nome) ?? '');
  if (campos.cliente_cpf_cnpj !== undefined) push('cliente_cpf_cnpj', txt(campos.cliente_cpf_cnpj, 24));
  if (campos.cliente_telefone !== undefined) push('cliente_telefone', txt(campos.cliente_telefone, 32));
  if (campos.data_contratacao !== undefined) push('data_contratacao', isoDate(campos.data_contratacao));
  if (campos.previsao_conclusao !== undefined) push('previsao_conclusao', isoDate(campos.previsao_conclusao));
  if (campos.status !== undefined) push('status', campos.status);
  if (campos.responsavel !== undefined) push('responsavel', txt(campos.responsavel));
  if (campos.observacoes !== undefined) push('observacoes', campos.observacoes ? String(campos.observacoes) : null);
  if (campos.obra_id !== undefined) push('obra_id', campos.obra_id ?? null);

  if (!sets.length) return;
  vals.push(id);
  await pool.execute(`UPDATE prontuarios SET ${sets.join(', ')} WHERE id = ?`, vals);
}

/** Aplica a atualização JÁ normalizada (ver normalizarAtualizacaoEtapa). */
export async function atualizarEtapa(etapaId: number, campos: AtualizacaoEtapaNormalizada): Promise<void> {
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  if (campos.status !== undefined) { sets.push('status = ?'); vals.push(campos.status); }
  if (campos.data_conclusao !== undefined) { sets.push('data_conclusao = ?'); vals.push(campos.data_conclusao); }
  if (campos.responsavel !== undefined) { sets.push('responsavel = ?'); vals.push(campos.responsavel); }
  if (campos.observacoes !== undefined) { sets.push('observacoes = ?'); vals.push(campos.observacoes); }
  if (!sets.length) return;
  vals.push(etapaId);
  await pool.execute(`UPDATE prontuario_etapas SET ${sets.join(', ')} WHERE id = ?`, vals);
}

export async function atualizarDocumento(docId: number, campos: {
  status?: StatusDocumento; observacao?: string | null;
}): Promise<void> {
  const sets: string[] = [];
  const vals: Array<string | null> = [];
  if (campos.status !== undefined) { sets.push('status = ?'); vals.push(campos.status); }
  if (campos.observacao !== undefined) { sets.push('observacao = ?'); vals.push(txt(campos.observacao)); }
  if (!sets.length) return;
  vals.push(String(docId));
  await pool.execute(`UPDATE prontuario_etapa_documentos SET ${sets.join(', ')} WHERE id = ?`, vals);
}

/** Documento avulso numa etapa (o cliente trouxe uma exigência fora do template). */
export async function adicionarDocumento(etapaId: number, prontuarioId: number, doc: string): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO prontuario_etapa_documentos (etapa_id, prontuario_id, doc) VALUES (?, ?, ?)`,
    [etapaId, prontuarioId, doc.slice(0, 255)],
  );
  return r.insertId;
}

export async function excluirDocumento(docId: number): Promise<void> {
  await pool.execute(`DELETE FROM prontuario_etapa_documentos WHERE id = ?`, [docId]);
}

/** Etapas e documentos caem junto pela FK ON DELETE CASCADE. */
export async function excluirProntuario(id: number): Promise<void> {
  await pool.execute(`DELETE FROM prontuarios WHERE id = ?`, [id]);
}

// ── Mapeamento ───────────────────────────────────────────────────────────────
function mapProntuario(r: RowDataPacket): Prontuario {
  return {
    id: Number(r.id),
    numero: String(r.numero ?? ''),
    cliente: {
      nome: String(r.cliente_nome ?? ''),
      cpf_cnpj: r.cliente_cpf_cnpj ?? null,
      telefone: r.cliente_telefone ?? null,
    },
    servico_contratado: {
      categoria: String(r.categoria ?? ''),
      sub_tipo: r.sub_tipo ?? null,
      nome: String(r.servico_nome ?? rotuloServico(String(r.categoria ?? ''), r.sub_tipo ?? null)),
      data_contratacao: isoDate(r.data_contratacao),
      previsao_conclusao: isoDate(r.previsao_conclusao),
    },
    status: (r.status ?? 'em_andamento') as StatusProntuario,
    responsavel: r.responsavel ?? null,
    observacoes: r.observacoes ?? null,
    obra_id: r.obra_id != null ? Number(r.obra_id) : null,
    user_sub: r.user_sub ?? null,
    criado_em: String(r.criado_em ?? ''),
    atualizado_em: String(r.atualizado_em ?? ''),
    progresso: { total: 0, concluidas: 0, em_andamento: 0, pendentes: 0, percentual: 0 },
  };
}

/** Versão da lista: progresso vem das contagens do SQL (sem carregar etapas). */
function mapProntuarioComContagem(r: RowDataPacket): Prontuario {
  const p = mapProntuario(r);
  const total = Number(r.total_etapas ?? 0);
  const concluidas = Number(r.etapas_concluidas ?? 0);
  const emAndamento = Number(r.etapas_andamento ?? 0);
  p.progresso = {
    total,
    concluidas,
    em_andamento: emAndamento,
    pendentes: total - concluidas - emAndamento,
    percentual: total === 0 ? 0 : Math.round((concluidas / total) * 100),
  };
  return p;
}
