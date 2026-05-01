// v1.65.2: módulo de Propostas de Mão de Obra (Romatec) — backend CRUD.
// Tabelas: sinapi_servicos (catálogo), propostas_clientes (clientes da proposta,
// distinto do CRM), propostas (cabeçalho), proposta_itens (linhas).
// Soft delete via deleted_at em propostas e propostas_clientes.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { formatBR, formatBRDate } from '../util/format';

// ── Types ────────────────────────────────────────────────────────────────────
type SinapiRow = RowDataPacket & {
  id: number; codigo_sinapi: string | null;
  categoria: string; subcategoria: string | null;
  descricao: string; unidade: string;
  valor_referencia: string | null;
  valor_e_referencial: number; ativo: number;
};

type ClienteRow = RowDataPacket & {
  id: number; nome: string; cpf_cnpj: string | null;
  telefone: string | null; email: string | null;
  endereco: string | null; cidade: string | null;
  estado: string | null; cep: string | null;
  observacoes: string | null;
  criado_em: Date; atualizado_em: Date;
};

type PropostaRow = RowDataPacket & {
  id: number; numero: string;
  cliente_id: number; cliente_nome?: string;
  endereco_obra: string | null;
  data_proposta: Date; validade_dias: number;
  valor_total: string;
  observacoes: string | null;
  status: 'rascunho' | 'enviada' | 'aceita' | 'recusada' | 'expirada';
  pdf_path: string | null;
  enviada_whatsapp: number; enviada_em: Date | null;
  criada_por: string | null;
  criado_em: Date; atualizado_em: Date;
};

type ItemRow = RowDataPacket & {
  id: number; proposta_id: number; servico_id: number | null;
  descricao: string; unidade: string;
  quantidade: string; valor_unitario: string; valor_total: string;
  ordem: number;
};

export interface MutationResult {
  ok: true;
  affected?: number;
  insertId?: number;
  message: string;
}

const num = (v: string | null | undefined): number => v ? Number(v) : 0;

// ── Catálogo SINAPI ──────────────────────────────────────────────────────────
export async function listarCatalogoSinapi(input: {
  busca?: string; categoria?: string; ativo?: boolean;
  agrupado?: boolean;
} = {}) {
  const params: (string | number)[] = [];
  let sql = `SELECT id, codigo_sinapi, categoria, subcategoria, descricao, unidade,
                    valor_referencia, valor_e_referencial, ativo
               FROM sinapi_servicos WHERE 1=1`;
  if (input.ativo !== false) { sql += ' AND ativo = 1'; }
  if (input.categoria) { sql += ' AND categoria = ?'; params.push(input.categoria); }
  if (input.busca) {
    sql += ' AND (descricao LIKE ? OR codigo_sinapi LIKE ?)';
    params.push(`%${input.busca}%`, `%${input.busca}%`);
  }
  sql += ' ORDER BY categoria, subcategoria, descricao';
  const [rows] = await pool.execute<SinapiRow[]>(sql, params);
  const items = rows.map(r => ({
    id: String(r.id),
    codigo_sinapi: r.codigo_sinapi,
    categoria: r.categoria,
    subcategoria: r.subcategoria,
    descricao: r.descricao,
    unidade: r.unidade,
    valor_referencia: num(r.valor_referencia),
    valor_e_referencial: !!r.valor_e_referencial,
    ativo: !!r.ativo,
  }));
  if (input.agrupado) {
    const grupos: Record<string, typeof items> = {};
    for (const it of items) {
      if (!grupos[it.categoria]) grupos[it.categoria] = [];
      grupos[it.categoria].push(it);
    }
    return { agrupado: true, total: items.length, categorias: grupos };
  }
  return { total: items.length, items };
}

export async function listarCategoriasSinapi() {
  const [rows] = await pool.execute<RowDataPacket[]>(`
    SELECT categoria, COUNT(*) AS qtd
      FROM sinapi_servicos WHERE ativo = 1
     GROUP BY categoria ORDER BY categoria
  `);
  return rows.map(r => ({ categoria: String(r.categoria), qtd: Number(r.qtd) }));
}

// ── Clientes ─────────────────────────────────────────────────────────────────
export async function listarClientesProposta(input: { busca?: string; limite?: number } = {}) {
  const limit = Math.min(Math.max(Number(input.limite) || 100, 1), 500);
  const params: (string | number)[] = [];
  let sql = 'SELECT * FROM propostas_clientes WHERE deleted_at IS NULL';
  if (input.busca) {
    sql += ' AND (nome LIKE ? OR cpf_cnpj LIKE ? OR telefone LIKE ?)';
    const q = `%${input.busca}%`;
    params.push(q, q, q);
  }
  sql += ` ORDER BY nome ASC LIMIT ${limit}`;
  const [rows] = await pool.execute<ClienteRow[]>(sql, params);
  return rows.map(r => ({
    id: String(r.id),
    nome: r.nome,
    cpf_cnpj: r.cpf_cnpj,
    telefone: r.telefone,
    email: r.email,
    endereco: r.endereco,
    cidade: r.cidade,
    estado: r.estado,
    cep: r.cep,
    observacoes: r.observacoes,
  }));
}

export async function criarClienteProposta(input: {
  nome: string; cpf_cnpj?: string; telefone?: string; email?: string;
  endereco?: string; cidade?: string; estado?: string; cep?: string; observacoes?: string;
}): Promise<MutationResult> {
  if (!input.nome?.trim()) throw new Error('nome obrigatório');
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO propostas_clientes
       (nome, cpf_cnpj, telefone, email, endereco, cidade, estado, cep, observacoes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      input.nome.trim(),
      input.cpf_cnpj ?? null, input.telefone ?? null, input.email ?? null,
      input.endereco ?? null, input.cidade ?? null, input.estado ?? null, input.cep ?? null,
      input.observacoes ?? null,
    ]
  );
  return { ok: true, insertId: r.insertId, message: `Cliente "${input.nome}" criado.` };
}

export async function atualizarClienteProposta(input: {
  id: string;
  nome?: string; cpf_cnpj?: string; telefone?: string; email?: string;
  endereco?: string; cidade?: string; estado?: string; cep?: string; observacoes?: string;
}): Promise<MutationResult> {
  const id = Number(input.id);
  if (!id) throw new Error('id inválido');
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (k: string, v: unknown) => { if (v !== undefined) { fields.push(`${k} = ?`); params.push((v as string) ?? null); } };
  set('nome', input.nome); set('cpf_cnpj', input.cpf_cnpj); set('telefone', input.telefone);
  set('email', input.email); set('endereco', input.endereco); set('cidade', input.cidade);
  set('estado', input.estado); set('cep', input.cep); set('observacoes', input.observacoes);
  if (!fields.length) return { ok: true, affected: 0, message: 'Nada a atualizar.' };
  params.push(id);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE propostas_clientes SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
    params
  );
  return { ok: true, affected: r.affectedRows, message: 'Cliente atualizado.' };
}

export async function apagarClienteProposta(input: { id: string }): Promise<MutationResult> {
  const id = Number(input.id);
  if (!id) throw new Error('id inválido');
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE propostas_clientes SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  return { ok: true, affected: r.affectedRows, message: 'Cliente removido.' };
}

// ── Numeração ────────────────────────────────────────────────────────────────
async function gerarNumeroProposta(): Promise<string> {
  const ano = new Date().getFullYear();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT numero FROM propostas
      WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`,
    [`PROP-${ano}-%`]
  );
  let seq = 1;
  if (rows.length) {
    const m = String(rows[0].numero).match(/PROP-\d{4}-(\d+)/);
    if (m) seq = Number(m[1]) + 1;
  }
  return `PROP-${ano}-${String(seq).padStart(4, '0')}`;
}

// ── Propostas ────────────────────────────────────────────────────────────────
export async function listarPropostas(input: {
  status?: string; cliente_id?: string; busca?: string; limite?: number;
} = {}) {
  const limit = Math.min(Math.max(Number(input.limite) || 50, 1), 500);
  const params: (string | number)[] = [];
  let sql = `SELECT p.*, c.nome AS cliente_nome
               FROM propostas p
               LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
              WHERE p.deleted_at IS NULL`;
  if (input.status)     { sql += ' AND p.status = ?';     params.push(input.status); }
  if (input.cliente_id) { sql += ' AND p.cliente_id = ?'; params.push(Number(input.cliente_id)); }
  if (input.busca) {
    sql += ' AND (p.numero LIKE ? OR c.nome LIKE ?)';
    const q = `%${input.busca}%`;
    params.push(q, q);
  }
  sql += ` ORDER BY p.criado_em DESC LIMIT ${limit}`;
  const [rows] = await pool.execute<PropostaRow[]>(sql, params);
  return rows.map(r => ({
    id: String(r.id),
    numero: r.numero,
    cliente_id: String(r.cliente_id),
    cliente_nome: r.cliente_nome ?? null,
    endereco_obra: r.endereco_obra,
    data_proposta: formatBRDate(r.data_proposta),
    validade_dias: r.validade_dias,
    valor_total: num(r.valor_total),
    valor_total_br: formatBR(num(r.valor_total)),
    status: r.status,
    pdf_path: r.pdf_path,
    enviada_whatsapp: !!r.enviada_whatsapp,
    enviada_em: r.enviada_em ? formatBRDate(r.enviada_em) : null,
    criada_por: r.criada_por,
  }));
}

export async function buscarProposta(id: string) {
  const numId = Number(id);
  if (!numId) throw new Error('id inválido');
  const [rows] = await pool.execute<PropostaRow[]>(
    `SELECT p.*, c.nome AS cliente_nome
       FROM propostas p
       LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
      WHERE p.id = ? AND p.deleted_at IS NULL`,
    [numId]
  );
  if (!rows.length) throw new Error('proposta não encontrada');
  const p = rows[0];

  const [cliRows] = await pool.execute<ClienteRow[]>(
    `SELECT * FROM propostas_clientes WHERE id = ?`, [p.cliente_id]
  );
  const cli = cliRows[0];

  const [itens] = await pool.execute<ItemRow[]>(
    `SELECT * FROM proposta_itens WHERE proposta_id = ? ORDER BY ordem ASC, id ASC`,
    [numId]
  );

  return {
    id: String(p.id),
    numero: p.numero,
    cliente_id: String(p.cliente_id),
    cliente: cli ? {
      id: String(cli.id), nome: cli.nome,
      cpf_cnpj: cli.cpf_cnpj, telefone: cli.telefone, email: cli.email,
      endereco: cli.endereco, cidade: cli.cidade, estado: cli.estado, cep: cli.cep,
    } : null,
    endereco_obra: p.endereco_obra,
    data_proposta: formatBRDate(p.data_proposta),
    validade_dias: p.validade_dias,
    valor_total: num(p.valor_total),
    valor_total_br: formatBR(num(p.valor_total)),
    observacoes: p.observacoes,
    status: p.status,
    pdf_path: p.pdf_path,
    enviada_whatsapp: !!p.enviada_whatsapp,
    enviada_em: p.enviada_em ? formatBRDate(p.enviada_em) : null,
    criada_por: p.criada_por,
    itens: itens.map(i => ({
      id: String(i.id),
      servico_id: i.servico_id ? String(i.servico_id) : null,
      descricao: i.descricao,
      unidade: i.unidade,
      quantidade: num(i.quantidade),
      valor_unitario: num(i.valor_unitario),
      valor_total: num(i.valor_total),
      valor_total_br: formatBR(num(i.valor_total)),
      ordem: i.ordem,
    })),
  };
}

export async function criarProposta(input: {
  cliente_id: string;
  endereco_obra?: string;
  data_proposta?: string;
  validade_dias?: number;
  observacoes?: string;
  criada_por?: string;
}): Promise<MutationResult> {
  const cliId = Number(input.cliente_id);
  if (!cliId) throw new Error('cliente_id obrigatório');
  const numero = await gerarNumeroProposta();
  const data = input.data_proposta && /^\d{4}-\d{2}-\d{2}$/.test(input.data_proposta)
    ? input.data_proposta
    : new Date().toISOString().slice(0, 10);
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO propostas
       (numero, cliente_id, endereco_obra, data_proposta, validade_dias, observacoes, criada_por)
     VALUES (?,?,?,?,?,?,?)`,
    [
      numero, cliId,
      input.endereco_obra ?? null,
      data,
      Number(input.validade_dias) || 15,
      input.observacoes ?? null,
      input.criada_por ?? null,
    ]
  );
  return { ok: true, insertId: r.insertId, message: `Proposta ${numero} criada.` };
}

export async function atualizarProposta(input: {
  id: string;
  endereco_obra?: string;
  data_proposta?: string;
  validade_dias?: number;
  observacoes?: string;
  status?: 'rascunho' | 'enviada' | 'aceita' | 'recusada' | 'expirada';
}): Promise<MutationResult> {
  const id = Number(input.id);
  if (!id) throw new Error('id inválido');
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (k: string, v: unknown) => { if (v !== undefined) { fields.push(`${k} = ?`); params.push((v as string) ?? null); } };
  set('endereco_obra', input.endereco_obra);
  if (input.data_proposta && /^\d{4}-\d{2}-\d{2}$/.test(input.data_proposta)) {
    fields.push('data_proposta = ?'); params.push(input.data_proposta);
  }
  if (input.validade_dias !== undefined) { fields.push('validade_dias = ?'); params.push(Number(input.validade_dias)); }
  set('observacoes', input.observacoes);
  set('status', input.status);
  if (!fields.length) return { ok: true, affected: 0, message: 'Nada a atualizar.' };
  params.push(id);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE propostas SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
    params
  );
  return { ok: true, affected: r.affectedRows, message: 'Proposta atualizada.' };
}

export async function apagarProposta(input: { id: string }): Promise<MutationResult> {
  const id = Number(input.id);
  if (!id) throw new Error('id inválido');
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE propostas SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  return { ok: true, affected: r.affectedRows, message: 'Proposta removida.' };
}

// ── Itens ────────────────────────────────────────────────────────────────────
async function recalcularTotalProposta(propostaId: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(valor_total), 0) AS total FROM proposta_itens WHERE proposta_id = ?`,
    [propostaId]
  );
  const total = Number(rows[0]?.total ?? 0);
  await pool.execute(
    `UPDATE propostas SET valor_total = ? WHERE id = ?`,
    [total.toFixed(2), propostaId]
  );
  return total;
}

export async function adicionarItemProposta(input: {
  proposta_id: string;
  servico_id?: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  ordem?: number;
}): Promise<MutationResult> {
  const propostaId = Number(input.proposta_id);
  if (!propostaId) throw new Error('proposta_id obrigatório');
  if (!input.descricao?.trim()) throw new Error('descricao obrigatória');
  if (!input.unidade?.trim()) throw new Error('unidade obrigatória');
  const qtd = Number(input.quantidade);
  const valor = Number(input.valor_unitario);
  if (!isFinite(qtd) || qtd <= 0) throw new Error('quantidade inválida');
  if (!isFinite(valor) || valor < 0) throw new Error('valor_unitario inválido');
  const total = qtd * valor;

  let ordem = Number(input.ordem);
  if (!isFinite(ordem) || ordem < 0) {
    const [maxRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(MAX(ordem), -1) + 1 AS prox FROM proposta_itens WHERE proposta_id = ?`,
      [propostaId]
    );
    ordem = Number(maxRows[0]?.prox ?? 0);
  }

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO proposta_itens
       (proposta_id, servico_id, descricao, unidade, quantidade, valor_unitario, valor_total, ordem)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      propostaId,
      input.servico_id ? Number(input.servico_id) : null,
      input.descricao.trim(),
      input.unidade.trim(),
      qtd.toFixed(2), valor.toFixed(2), total.toFixed(2),
      ordem,
    ]
  );
  await recalcularTotalProposta(propostaId);
  return { ok: true, insertId: r.insertId, message: 'Item adicionado.' };
}

export async function atualizarItemProposta(input: {
  id: string;
  descricao?: string;
  unidade?: string;
  quantidade?: number;
  valor_unitario?: number;
  ordem?: number;
}): Promise<MutationResult> {
  const id = Number(input.id);
  if (!id) throw new Error('id inválido');
  const [rowsAny] = await pool.execute<ItemRow[]>(
    `SELECT * FROM proposta_itens WHERE id = ?`, [id]
  );
  if (!rowsAny.length) throw new Error('item não encontrado');
  const cur = rowsAny[0];

  const desc = input.descricao !== undefined ? input.descricao.trim() : cur.descricao;
  const un   = input.unidade   !== undefined ? input.unidade.trim()   : cur.unidade;
  const qtd  = input.quantidade !== undefined ? Number(input.quantidade)     : Number(cur.quantidade);
  const vu   = input.valor_unitario !== undefined ? Number(input.valor_unitario) : Number(cur.valor_unitario);
  if (!isFinite(qtd) || qtd <= 0) throw new Error('quantidade inválida');
  if (!isFinite(vu)  || vu  <  0) throw new Error('valor_unitario inválido');
  const total = qtd * vu;

  const fields = ['descricao = ?', 'unidade = ?', 'quantidade = ?', 'valor_unitario = ?', 'valor_total = ?'];
  const params: (string | number)[] = [desc, un, qtd.toFixed(2), vu.toFixed(2), total.toFixed(2)];
  if (input.ordem !== undefined) { fields.push('ordem = ?'); params.push(Number(input.ordem)); }
  params.push(id);

  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE proposta_itens SET ${fields.join(', ')} WHERE id = ?`, params
  );
  await recalcularTotalProposta(cur.proposta_id);
  return { ok: true, affected: r.affectedRows, message: 'Item atualizado.' };
}

export async function removerItemProposta(input: { id: string }): Promise<MutationResult> {
  const id = Number(input.id);
  if (!id) throw new Error('id inválido');
  const [rowsAny] = await pool.execute<ItemRow[]>(
    `SELECT proposta_id FROM proposta_itens WHERE id = ?`, [id]
  );
  if (!rowsAny.length) return { ok: true, affected: 0, message: 'Item já removido.' };
  const propostaId = rowsAny[0].proposta_id;
  const [r] = await pool.execute<ResultSetHeader>(
    `DELETE FROM proposta_itens WHERE id = ?`, [id]
  );
  await recalcularTotalProposta(propostaId);
  return { ok: true, affected: r.affectedRows, message: 'Item removido.' };
}

export async function reordenarItensProposta(input: {
  proposta_id: string; ordem_ids: string[];
}): Promise<MutationResult> {
  const propostaId = Number(input.proposta_id);
  if (!propostaId) throw new Error('proposta_id obrigatório');
  if (!Array.isArray(input.ordem_ids) || !input.ordem_ids.length) {
    return { ok: true, affected: 0, message: 'Nada a reordenar.' };
  }
  let i = 0;
  for (const idStr of input.ordem_ids) {
    const id = Number(idStr);
    if (!id) continue;
    await pool.execute(
      `UPDATE proposta_itens SET ordem = ? WHERE id = ? AND proposta_id = ?`,
      [i, id, propostaId]
    );
    i++;
  }
  return { ok: true, affected: i, message: 'Ordem atualizada.' };
}
