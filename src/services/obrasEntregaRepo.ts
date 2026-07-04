// src/services/obrasEntregaRepo.ts
// v3.81.0 — Persistência do módulo "Entrega de Obra" (RE).
// Segurança (P1): todo UPDATE/DELETE/status carrega `colaborador_id` no WHERE,
// mesmo padrão do VTO Checklist. Fotos/NF em base64 (LONGTEXT).
import { createHash } from 'crypto';
import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import pool from '../database/connection';
import type {
  ObraEntrega, ObraEntregaResumo, EntregaFoto, EntregaMaterialSobra,
  PropostaOrigem, EntregaStatus, EntregaFotoTipo,
} from '../types/obrasEntrega';
import { ENTREGA_STATUS, ENTREGA_FOTO_TIPOS } from '../types/obrasEntrega';

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Remove prefixo data:...;base64, se vier — guardamos só o base64 puro. */
function apenasBase64(s?: string | null): string | null {
  if (!s) return null;
  const m = /^data:[^;]+;base64,(.*)$/s.exec(s);
  return m ? m[1] : s;
}

function gerarHash(numero: string, propostaId: number, colaboradorId: string): string {
  const base = `${numero}|${propostaId}|${Date.now()}|${colaboradorId}`;
  return createHash('sha256').update(base).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot da proposta de origem (propostas genéricas — mão de obra/consultoria).
// ─────────────────────────────────────────────────────────────────────────────
export async function snapshotProposta(propostaId: number): Promise<PropostaOrigem | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.id, p.numero, p.endereco_obra, p.valor_total, p.observacoes,
            c.nome AS cliente_nome, c.telefone AS cliente_telefone,
            c.cidade AS cliente_cidade, c.estado AS cliente_estado
       FROM propostas p
       LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
      WHERE p.id = ? AND p.deleted_at IS NULL
      LIMIT 1`,
    [propostaId],
  );
  if (!rows.length) return null;
  const r = rows[0];
  const cidadeUf = [r.cliente_cidade, r.cliente_estado].filter(Boolean).join(' / ') || null;
  return {
    proposta_id: Number(r.id),
    numero: r.numero ?? null,
    cliente: r.cliente_nome ?? null,
    cliente_telefone: r.cliente_telefone ?? null,
    endereco_obra: r.endereco_obra ?? null,
    cidade_uf: cidadeUf,
    resumo: r.observacoes ?? null,
    valor_orcado: num(r.valor_total),
    obra_id: null, // não há FK proposta→obra no schema real
    fotos_antes: [], // propostas genéricas não têm fotos; usuário adiciona no wizard
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Criação
// ─────────────────────────────────────────────────────────────────────────────
export async function criarDaProposta(colaboradorId: string, propostaId: number): Promise<ObraEntrega> {
  const snap = await snapshotProposta(propostaId);
  if (!snap) throw new Error('Proposta não encontrada.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute<ResultSetHeader>(
      `INSERT INTO obras_entregas
         (colaborador_id, proposta_id, obra_id, titulo, cliente, cliente_telefone,
          endereco_obra, cidade_uf, resumo_proposta, valor_orcado, valor_receber, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rascunho')`,
      [
        colaboradorId,
        propostaId,
        snap.obra_id,
        snap.numero ? `Entrega — ${snap.numero}` : null,
        snap.cliente,
        snap.cliente_telefone,
        snap.endereco_obra,
        snap.cidade_uf,
        snap.resumo,
        snap.valor_orcado,
        snap.valor_orcado, // valor_receber pré-preenchido = valor_orcado (editável)
      ],
    );
    const id = r.insertId;
    const ano = new Date().getFullYear();
    const numero = `RE-${ano}-${String(id).padStart(4, '0')}`;
    await conn.execute('UPDATE obras_entregas SET numero = ? WHERE id = ?', [numero, id]);
    await conn.commit();
    const doc = await buscar(id, colaboradorId);
    if (!doc) throw new Error('Falha ao recarregar entrega recém-criada.');
    return doc;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw new Error(`[obrasEntregaRepo.criarDaProposta] ${(err as Error).message}`);
  } finally {
    conn.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura
// ─────────────────────────────────────────────────────────────────────────────
function mapHeader(row: RowDataPacket): ObraEntrega {
  return {
    ...(row as unknown as ObraEntrega),
    valor_orcado: num(row.valor_orcado),
    valor_receber: num(row.valor_receber),
    fotos: [],
    materiais_sobra: [],
  };
}

async function carregarFotos(entregaId: number): Promise<EntregaFoto[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, entrega_id, tipo, mime, data_base64, legenda, ordem
       FROM obras_entregas_fotos WHERE entrega_id = ?
      ORDER BY FIELD(tipo,'antes','execucao','depois','sobra_material'), ordem, id`,
    [entregaId],
  );
  return rows as unknown as EntregaFoto[];
}

async function carregarMateriais(entregaId: number): Promise<EntregaMaterialSobra[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, entrega_id, material, quantidade, unidade, foto_mime, foto_base64, observacao, ordem
       FROM obras_entregas_materiais_sobra WHERE entrega_id = ?
      ORDER BY ordem, id`,
    [entregaId],
  );
  return (rows as unknown as EntregaMaterialSobra[]).map((m) => ({
    ...m,
    quantidade: m.quantidade == null ? null : Number(m.quantidade),
  }));
}

export async function buscar(id: number, colaboradorId: string): Promise<ObraEntrega | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM obras_entregas WHERE id = ? AND colaborador_id = ?',
    [id, colaboradorId],
  );
  if (!rows.length) return null;
  const doc = mapHeader(rows[0]);
  doc.fotos = await carregarFotos(id);
  doc.materiais_sobra = await carregarMateriais(id);
  return doc;
}

/** Página pública — sem exigir colaborador. */
export async function buscarPorHash(hash: string): Promise<ObraEntrega | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM obras_entregas WHERE hash_publico = ? LIMIT 1',
    [hash],
  );
  if (!rows.length) return null;
  const doc = mapHeader(rows[0]);
  const id = doc.id as number;
  doc.fotos = await carregarFotos(id);
  doc.materiais_sobra = await carregarMateriais(id);
  return doc;
}

export async function listar(
  colaboradorId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<ObraEntregaResumo[]> {
  const lim = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  const off = Math.max(0, Math.trunc(Number(offset) || 0));
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, numero, titulo, cliente, proposta_id, obra_id, status, valor_receber,
            data_entrega, hash_publico, recebimento_confirmado_em, created_at, updated_at
       FROM obras_entregas WHERE colaborador_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ${lim} OFFSET ${off}`,
    [colaboradorId],
  );
  return (rows as RowDataPacket[]).map((r) => ({
    id: Number(r.id),
    numero: r.numero ?? null,
    titulo: r.titulo ?? null,
    cliente: r.cliente ?? null,
    proposta_id: Number(r.proposta_id),
    obra_id: r.obra_id == null ? null : Number(r.obra_id),
    status: r.status as EntregaStatus,
    valor_receber: num(r.valor_receber),
    data_entrega: r.data_entrega ?? null,
    hash_publico: r.hash_publico ?? null,
    recebimento_confirmado_em: r.recebimento_confirmado_em ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Atualização de conteúdo (dono no WHERE)
// ─────────────────────────────────────────────────────────────────────────────
export async function atualizar(id: number, colaboradorId: string, data: Partial<ObraEntrega>): Promise<boolean> {
  const status: EntregaStatus | undefined =
    data.status && ENTREGA_STATUS.includes(data.status) ? data.status : undefined;
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE obras_entregas SET
       titulo = COALESCE(?, titulo),
       cliente = COALESCE(?, cliente),
       cliente_telefone = COALESCE(?, cliente_telefone),
       endereco_obra = COALESCE(?, endereco_obra),
       cidade_uf = COALESCE(?, cidade_uf),
       resumo_proposta = COALESCE(?, resumo_proposta),
       descricao_execucao = COALESCE(?, descricao_execucao),
       valor_orcado = COALESCE(?, valor_orcado),
       valor_receber = COALESCE(?, valor_receber),
       data_execucao = COALESCE(?, data_execucao),
       status = COALESCE(?, status)
     WHERE id = ? AND colaborador_id = ?`,
    [
      data.titulo ?? null,
      data.cliente ?? null,
      data.cliente_telefone ?? null,
      data.endereco_obra ?? null,
      data.cidade_uf ?? null,
      data.resumo_proposta ?? null,
      data.descricao_execucao ?? null,
      num(data.valor_orcado),
      num(data.valor_receber),
      data.data_execucao ?? null,
      status ?? null,
      id,
      colaboradorId,
    ],
  );
  return r.affectedRows > 0;
}

/** Garante posse antes de qualquer operação de anexo (fotos/materiais/NF). */
async function possui(id: number, colaboradorId: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM obras_entregas WHERE id = ? AND colaborador_id = ? LIMIT 1',
    [id, colaboradorId],
  );
  return rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fotos
// ─────────────────────────────────────────────────────────────────────────────
export async function adicionarFoto(
  entregaId: number, colaboradorId: string, foto: EntregaFoto,
): Promise<{ id: number } | null> {
  if (!(await possui(entregaId, colaboradorId))) return null;
  const tipo: EntregaFotoTipo = ENTREGA_FOTO_TIPOS.includes(foto.tipo) ? foto.tipo : 'execucao';
  const b64 = apenasBase64(foto.data_base64);
  if (!b64) throw new Error('Foto sem conteúdo base64.');
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO obras_entregas_fotos (entrega_id, tipo, mime, data_base64, legenda, ordem)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [entregaId, tipo, foto.mime || 'image/jpeg', b64, foto.legenda ?? null, foto.ordem ?? 0],
  );
  return { id: r.insertId };
}

export async function removerFoto(entregaId: number, colaboradorId: string, fotoId: number): Promise<boolean> {
  if (!(await possui(entregaId, colaboradorId))) return false;
  const [r] = await pool.execute<ResultSetHeader>(
    'DELETE FROM obras_entregas_fotos WHERE id = ? AND entrega_id = ?',
    [fotoId, entregaId],
  );
  return r.affectedRows > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Materiais de sobra (substituição em lote — só registro documental/fotográfico)
// ─────────────────────────────────────────────────────────────────────────────
export async function substituirMateriais(
  entregaId: number, colaboradorId: string, materiais: EntregaMaterialSobra[],
): Promise<boolean> {
  if (!(await possui(entregaId, colaboradorId))) return false;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM obras_entregas_materiais_sobra WHERE entrega_id = ?', [entregaId]);
    await inserirMateriais(conn, entregaId, materiais);
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw new Error(`[obrasEntregaRepo.substituirMateriais] ${(err as Error).message}`);
  } finally {
    conn.release();
  }
}

async function inserirMateriais(conn: PoolConnection, entregaId: number, materiais: EntregaMaterialSobra[]): Promise<void> {
  const lista = (materiais || []).filter((m) => m && String(m.material || '').trim());
  if (!lista.length) return;
  const ph = lista.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  const p: (string | number | null)[] = [];
  lista.forEach((m, i) => {
    p.push(
      entregaId,
      String(m.material).slice(0, 255),
      num(m.quantidade),
      m.unidade ? String(m.unidade).slice(0, 20) : null,
      m.foto_base64 ? (m.foto_mime || 'image/jpeg') : null,
      apenasBase64(m.foto_base64),
      m.observacao ? String(m.observacao).slice(0, 255) : null,
      m.ordem ?? i,
    );
  });
  await conn.execute(
    `INSERT INTO obras_entregas_materiais_sobra
       (entrega_id, material, quantidade, unidade, foto_mime, foto_base64, observacao, ordem)
     VALUES ${ph}`,
    p,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Nota fiscal (base64)
// ─────────────────────────────────────────────────────────────────────────────
export async function definirNotaFiscal(
  entregaId: number, colaboradorId: string,
  nf: { nome: string; mime: string; base64: string },
): Promise<boolean> {
  if (!(await possui(entregaId, colaboradorId))) return false;
  const b64 = apenasBase64(nf.base64);
  if (!b64) throw new Error('Nota fiscal sem conteúdo.');
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE obras_entregas
        SET nota_fiscal_nome = ?, nota_fiscal_mime = ?, nota_fiscal_base64 = ?
      WHERE id = ? AND colaborador_id = ?`,
    [nf.nome.slice(0, 255), nf.mime.slice(0, 80), b64, entregaId, colaboradorId],
  );
  return r.affectedRows > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Responsável (snapshot p/ assinatura no PDF)
// ─────────────────────────────────────────────────────────────────────────────
export async function definirResponsavel(
  entregaId: number, colaboradorId: string,
  resp: { equipe_id?: number | null; nome: string; cargo?: string | null; foto_base64?: string | null },
): Promise<boolean> {
  if (!(await possui(entregaId, colaboradorId))) return false;
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE obras_entregas
        SET responsavel_equipe_id = ?, responsavel_nome = ?, responsavel_cargo = ?, responsavel_foto_base64 = ?
      WHERE id = ? AND colaborador_id = ?`,
    [
      resp.equipe_id ?? null,
      String(resp.nome).slice(0, 200),
      resp.cargo ? String(resp.cargo).slice(0, 120) : null,
      apenasBase64(resp.foto_base64),
      entregaId,
      colaboradorId,
    ],
  );
  return r.affectedRows > 0;
}

/** Puxa nome/cargo/foto de um membro da equipe (romatec_obra_equipe). */
export async function snapshotResponsavelEquipe(equipeId: number): Promise<{ nome: string; cargo: string | null; foto_base64: string | null } | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT nome, funcao, foto, foto_url FROM romatec_obra_equipe WHERE id = ? LIMIT 1',
    [equipeId],
  );
  if (!rows.length) return null;
  const r = rows[0];
  let foto_base64: string | null = null;
  if (r.foto) {
    // foto é LONGBLOB (buffer de imagem) — vira base64 puro.
    const buf = r.foto as Buffer;
    foto_base64 = Buffer.isBuffer(buf) ? buf.toString('base64') : null;
  }
  return { nome: String(r.nome), cargo: r.funcao ?? null, foto_base64 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status / Entrega
// ─────────────────────────────────────────────────────────────────────────────
export async function definirStatus(id: number, colaboradorId: string, status: EntregaStatus): Promise<boolean> {
  if (!ENTREGA_STATUS.includes(status)) throw new Error('Status inválido.');
  const [r] = await pool.execute<ResultSetHeader>(
    'UPDATE obras_entregas SET status = ? WHERE id = ? AND colaborador_id = ?',
    [status, id, colaboradorId],
  );
  return r.affectedRows > 0;
}

/** Marca 'entregue', gera hash público (idempotente) e grava data_entrega. */
export async function marcarEntregue(id: number, colaboradorId: string): Promise<string | null> {
  const doc = await buscar(id, colaboradorId);
  if (!doc) return null;
  const hash = doc.hash_publico || gerarHash(doc.numero || String(id), doc.proposta_id, colaboradorId);
  await pool.execute(
    `UPDATE obras_entregas
        SET status = 'entregue', hash_publico = COALESCE(hash_publico, ?),
            data_entrega = COALESCE(data_entrega, NOW())
      WHERE id = ? AND colaborador_id = ?`,
    [hash, id, colaboradorId],
  );
  return hash;
}

/** Confirmação pública de recebimento pelo cliente (grava timestamp + IP). */
export async function confirmarRecebimento(hash: string, ip: string | null): Promise<{ ok: boolean; jaConfirmado: boolean }> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, recebimento_confirmado_em FROM obras_entregas WHERE hash_publico = ? LIMIT 1',
    [hash],
  );
  if (!rows.length) return { ok: false, jaConfirmado: false };
  if (rows[0].recebimento_confirmado_em) return { ok: true, jaConfirmado: true };
  await pool.execute(
    'UPDATE obras_entregas SET recebimento_confirmado_em = NOW(), recebimento_ip = ? WHERE hash_publico = ?',
    [ip ? ip.slice(0, 64) : null, hash],
  );
  return { ok: true, jaConfirmado: false };
}
