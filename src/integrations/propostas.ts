// v1.65.2: módulo de Propostas de Mão de Obra (Romatec) — backend CRUD.
// Tabelas: sinapi_servicos (catálogo), propostas_clientes (clientes da proposta,
// distinto do CRM), propostas (cabeçalho), proposta_itens (linhas).
// Soft delete via deleted_at em propostas e propostas_clientes.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { formatBRDate, formatBRL } from '../util/format';
import { sendDocument } from './whatsapp';
import { getTenantSettings } from '../services/tenantSettings';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

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
  gestor_cargo: string | null;
  gestor_nome: string | null;
  gestor_telefone: string | null;
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
    valor_total_br: formatBRL(num(r.valor_total)),
    status: r.status,
    pdf_path: r.pdf_path,
    enviada_whatsapp: !!r.enviada_whatsapp,
    enviada_em: r.enviada_em ? formatBRDate(r.enviada_em) : null,
    criada_por: r.criada_por,
    gestor_cargo: r.gestor_cargo,
    gestor_nome: r.gestor_nome,
    gestor_telefone: r.gestor_telefone,
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
    valor_total_br: formatBRL(num(p.valor_total)),
    observacoes: p.observacoes,
    status: p.status,
    pdf_path: p.pdf_path,
    enviada_whatsapp: !!p.enviada_whatsapp,
    enviada_em: p.enviada_em ? formatBRDate(p.enviada_em) : null,
    criada_por: p.criada_por,
    gestor_cargo: p.gestor_cargo,
    gestor_nome: p.gestor_nome,
    gestor_telefone: p.gestor_telefone,
    itens: itens.map(i => ({
      id: String(i.id),
      servico_id: i.servico_id ? String(i.servico_id) : null,
      descricao: i.descricao,
      unidade: i.unidade,
      quantidade: num(i.quantidade),
      valor_unitario: num(i.valor_unitario),
      valor_total: num(i.valor_total),
      valor_total_br: formatBRL(num(i.valor_total)),
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
  gestor_cargo?: string;
  gestor_nome?: string;
  gestor_telefone?: string;
}): Promise<MutationResult> {
  const cliId = Number(input.cliente_id);
  if (!cliId) throw new Error('cliente_id obrigatório');
  const numero = await gerarNumeroProposta();
  const data = input.data_proposta && /^\d{4}-\d{2}-\d{2}$/.test(input.data_proposta)
    ? input.data_proposta
    : new Date().toISOString().slice(0, 10);
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO propostas
       (numero, cliente_id, endereco_obra, data_proposta, validade_dias, observacoes, criada_por,
        gestor_cargo, gestor_nome, gestor_telefone)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      numero, cliId,
      input.endereco_obra ?? null,
      data,
      Number(input.validade_dias) || 15,
      input.observacoes ?? null,
      input.criada_por ?? null,
      input.gestor_cargo ?? null,
      input.gestor_nome ?? null,
      input.gestor_telefone ?? null,
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
  gestor_cargo?: string;
  gestor_nome?: string;
  gestor_telefone?: string;
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
  set('gestor_cargo',    input.gestor_cargo);
  set('gestor_nome',     input.gestor_nome);
  set('gestor_telefone', input.gestor_telefone);
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

// ── HTML Relatório (preview/imprimir/PDF via browser) ────────────────────────
function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// v1.65.5: relatórios usam o logo "tradicional" (/romatec-logo.jpg).
// O logo R (/logo_R-removebg-preview.png) fica reservado pra UI do app
// (cabeçalho da tela "Gestão de Obras"), pois é decisão do CEO separar.
const LOGO_RELATORIO = '/romatec-logo.jpg';

export async function gerarHtmlPropostaRelatorio(id: string): Promise<string> {
  const p = await buscarProposta(id);
  const t = await getTenantSettings(1).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliária';
  const logo  = LOGO_RELATORIO;
  const cor   = t?.primary_color || '#10b981';

  const itensHtml = p.itens.map((it, idx) => `
    <tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td>${escapeHtml(it.descricao)}</td>
      <td style="text-align:center;">${escapeHtml(it.unidade)}</td>
      <td style="text-align:right;">${it.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
      <td style="text-align:right;">${formatBRL(it.valor_unitario)}</td>
      <td style="text-align:right;">${formatBRL(it.valor_total)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Proposta ${escapeHtml(p.numero)} — ${escapeHtml(p.cliente?.nome || '')}</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#111; font-size:13px; line-height:1.5; max-width:800px; margin:0 auto; padding:20px; }
  .romatec-header { text-align:center; border-bottom:3px solid ${cor}; padding-bottom:14px; margin-bottom:18px; }
  .romatec-header img { max-height:90px; max-width:80%; }
  h1 { font-size:18px; margin:14px 0 4px; text-align:center; letter-spacing:1px; }
  h2 { font-size:14px; margin:18px 0 8px; color:${cor}; border-bottom:1px solid #ddd; padding-bottom:4px; }
  table { width:100%; border-collapse: collapse; margin-top:8px; }
  th, td { padding:6px 8px; border-bottom:1px solid #e5e5e5; vertical-align:top; }
  th { background:#f3f4f6; text-align:left; font-size:12px; }
  .label { color:#666; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
  .total-box { margin-top:14px; padding:12px 16px; background:#f9fafb; border-left:4px solid ${cor}; display:flex; justify-content:space-between; font-weight:600; font-size:15px; }
  .obs { margin-top:14px; padding:10px 12px; background:#fffbeb; border-left:3px solid #f59e0b; font-size:12px; }
  .footer { margin-top:30px; padding-top:14px; border-top:1px solid #ddd; text-align:center; font-size:11px; color:#666; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .badge { display:inline-block; padding:2px 8px; border-radius:4px; background:#e5e7eb; font-size:11px; text-transform:uppercase; }
  @media print { .no-print { display:none; } body { padding:0; } }
</style>
</head><body>
  <div class="romatec-header">
    <img src="${escapeHtml(logo)}" alt="${escapeHtml(brand)}">
  </div>

  <h1>PROPOSTA DE MÃO DE OBRA</h1>
  <p style="text-align:center; margin:0;">
    <strong>Nº ${escapeHtml(p.numero)}</strong>
    &nbsp;·&nbsp; <span class="badge">${escapeHtml(p.status)}</span>
  </p>

  <h2>Cliente</h2>
  <div class="grid2">
    <div>
      <p class="label">Nome</p>
      <p style="margin:0; font-weight:500;">${escapeHtml(p.cliente?.nome || '-')}</p>
    </div>
    <div>
      <p class="label">CPF/CNPJ · Telefone</p>
      <p style="margin:0;">${escapeHtml(p.cliente?.cpf_cnpj || '-')} ${p.cliente?.telefone ? '· ' + escapeHtml(p.cliente.telefone) : ''}</p>
    </div>
    ${p.cliente?.email ? `<div><p class="label">E-mail</p><p style="margin:0;">${escapeHtml(p.cliente.email)}</p></div>` : ''}
    ${p.cliente?.endereco ? `<div><p class="label">Endereço</p><p style="margin:0;">${escapeHtml(p.cliente.endereco)}${p.cliente.cidade ? ', ' + escapeHtml(p.cliente.cidade) : ''}${p.cliente.estado ? '-' + escapeHtml(p.cliente.estado) : ''}</p></div>` : ''}
  </div>

  ${p.endereco_obra ? `
  <h2>Endereço da Obra</h2>
  <p style="margin:0;">${escapeHtml(p.endereco_obra)}</p>
  ` : ''}

  <h2>Itens da Proposta</h2>
  <table>
    <thead>
      <tr>
        <th style="width:30px;">#</th>
        <th>Descrição</th>
        <th style="width:50px;">Un</th>
        <th style="width:70px; text-align:right;">Qtd</th>
        <th style="width:90px; text-align:right;">V. Unit.</th>
        <th style="width:100px; text-align:right;">Subtotal</th>
      </tr>
    </thead>
    <tbody>${itensHtml || '<tr><td colspan="6" style="text-align:center; color:#999; padding:20px;">Sem itens.</td></tr>'}</tbody>
  </table>

  <div class="total-box">
    <span>VALOR TOTAL DA PROPOSTA</span>
    <span>${formatBRL(p.valor_total)}</span>
  </div>

  <div class="grid2" style="margin-top:14px; font-size:12px;">
    <div><span class="label">Data:</span> ${escapeHtml(p.data_proposta)}</div>
    <div><span class="label">Validade:</span> ${p.validade_dias} dias</div>
  </div>

  ${(p.gestor_nome || p.gestor_cargo || p.gestor_telefone) ? `
  <h2>Responsável Técnico / Indicador</h2>
  <div class="grid2">
    ${p.gestor_cargo    ? `<div><p class="label">Cargo</p><p style="margin:0;">${escapeHtml(p.gestor_cargo)}</p></div>` : ''}
    ${p.gestor_nome     ? `<div><p class="label">Nome</p><p style="margin:0; font-weight:500;">${escapeHtml(p.gestor_nome)}</p></div>` : ''}
    ${p.gestor_telefone ? `<div><p class="label">Telefone</p><p style="margin:0;">${escapeHtml(p.gestor_telefone)}</p></div>` : ''}
  </div>
  ` : ''}

  ${p.observacoes ? `<div class="obs"><strong>Observações:</strong><br>${escapeHtml(p.observacoes).replace(/\n/g, '<br>')}</div>` : ''}

  <div class="footer">
    <p>${escapeHtml(brand)}</p>
    <p>Proposta válida por ${p.validade_dias} dias a partir de ${escapeHtml(p.data_proposta)}.</p>
  </div>

  <div class="no-print" style="text-align:center; margin-top:20px;">
    <button onclick="window.print()" style="padding:10px 22px; background:${cor}; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:14px;">Imprimir / Salvar PDF</button>
  </div>
</body></html>`;
}

// ── PDF via PDFKit (binário) ─────────────────────────────────────────────────
export async function gerarPdfProposta(id: string): Promise<Buffer> {
  const p = await buscarProposta(id);
  const t = await getTenantSettings(1).catch(() => null);
  const brand    = t?.brand_name || 'Romatec Consultoria Imobiliária';
  const logoPath = LOGO_RELATORIO; // v1.65.5: logo "tradicional" nos PDFs
  const corHex   = t?.primary_color || '#10b981';

  const doc = new PDFDocument({ size: 'A4', margin: 48, info: {
    Title: `Proposta ${p.numero}`,
    Author: brand,
    Subject: `Proposta de mão de obra para ${p.cliente?.nome || ''}`,
  }});
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // Logo (se o arquivo existir em src/public/)
  const logoFile = path.join(__dirname, '..', 'public', logoPath.replace(/^\//, ''));
  if (fs.existsSync(logoFile)) {
    try { doc.image(logoFile, { fit: [120, 60], align: 'center' }); }
    catch { /* logo opcional */ }
  } else {
    doc.fontSize(16).fillColor(corHex).text(brand, { align: 'center' });
  }
  doc.moveDown(0.5);
  doc.strokeColor(corHex).lineWidth(2).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.8);

  // Título
  doc.fontSize(16).fillColor('#111').text('PROPOSTA DE MÃO DE OBRA', { align: 'center', characterSpacing: 1 });
  doc.fontSize(11).fillColor('#444').text(`Nº ${p.numero}  ·  ${p.status.toUpperCase()}`, { align: 'center' });
  doc.moveDown(1);

  // Cliente
  doc.fontSize(12).fillColor(corHex).text('Cliente');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#111');
  doc.text(`Nome: ${p.cliente?.nome || '-'}`);
  if (p.cliente?.cpf_cnpj || p.cliente?.telefone) {
    doc.text(`${p.cliente?.cpf_cnpj || '-'} ${p.cliente?.telefone ? ' · ' + p.cliente.telefone : ''}`);
  }
  if (p.cliente?.email)    doc.text(`E-mail: ${p.cliente.email}`);
  if (p.cliente?.endereco) {
    const cidEst = [p.cliente.cidade, p.cliente.estado].filter(Boolean).join('-');
    doc.text(`Endereço: ${p.cliente.endereco}${cidEst ? ', ' + cidEst : ''}`);
  }
  doc.moveDown(0.6);

  if (p.endereco_obra) {
    doc.fontSize(12).fillColor(corHex).text('Endereço da Obra');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#111').text(p.endereco_obra);
    doc.moveDown(0.6);
  }

  // Tabela de itens
  doc.fontSize(12).fillColor(corHex).text('Itens da Proposta');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.4);

  const tableTop = doc.y;
  const colX = { idx: 48, desc: 70, un: 320, qtd: 360, vu: 410, sub: 480 };
  const colW = { sub: 67 };
  // Header
  doc.fontSize(9).fillColor('#444').font('Helvetica-Bold');
  doc.text('#',          colX.idx,  tableTop, { width: 16 });
  doc.text('Descrição',  colX.desc, tableTop, { width: 245 });
  doc.text('Un',         colX.un,   tableTop, { width: 30 });
  doc.text('Qtd',        colX.qtd,  tableTop, { width: 45,  align: 'right' });
  doc.text('V.Unit',     colX.vu,   tableTop, { width: 65,  align: 'right' });
  doc.text('Subtotal',   colX.sub,  tableTop, { width: colW.sub, align: 'right' });
  doc.font('Helvetica');
  doc.moveDown(0.3);
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#888').lineWidth(0.5).stroke();
  doc.moveDown(0.2);

  // Linhas
  doc.fontSize(9).fillColor('#111');
  for (let i = 0; i < p.itens.length; i++) {
    const it = p.itens[i];
    const y = doc.y;
    // quebra de página se chegar perto do fim
    if (y > 720) { doc.addPage(); }
    const yy = doc.y;
    doc.text(String(i + 1), colX.idx,  yy, { width: 16 });
    doc.text(it.descricao,  colX.desc, yy, { width: 245 });
    doc.text(it.unidade,    colX.un,   yy, { width: 30 });
    doc.text(it.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), colX.qtd, yy, { width: 45, align: 'right' });
    doc.text(formatBRL(it.valor_unitario).replace('R$', ''), colX.vu, yy, { width: 65, align: 'right' });
    doc.text(formatBRL(it.valor_total).replace('R$', ''),    colX.sub, yy, { width: colW.sub, align: 'right' });
    doc.moveDown(0.4);
  }

  doc.moveDown(0.4);
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor(corHex).lineWidth(1).stroke();
  doc.moveDown(0.4);
  // Total
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#111')
     .text(`VALOR TOTAL: ${formatBRL(p.valor_total)}`, { align: 'right' });
  doc.font('Helvetica');
  doc.moveDown(0.6);

  doc.fontSize(9).fillColor('#444');
  doc.text(`Data: ${p.data_proposta}    ·    Validade: ${p.validade_dias} dias`);
  doc.moveDown(0.4);

  // Responsável técnico / indicador
  if (p.gestor_nome || p.gestor_cargo || p.gestor_telefone) {
    doc.fontSize(11).fillColor(corHex).text('Responsável Técnico / Indicador');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#111');
    const partes: string[] = [];
    if (p.gestor_cargo)    partes.push(p.gestor_cargo);
    if (p.gestor_nome)     partes.push(p.gestor_nome);
    doc.text(partes.join(' — ') || '-');
    if (p.gestor_telefone) doc.text(`Tel: ${p.gestor_telefone}`);
    doc.moveDown(0.4);
  }

  if (p.observacoes) {
    doc.fontSize(10).fillColor(corHex).text('Observações');
    doc.fontSize(9).fillColor('#111').text(p.observacoes, { width: 499 });
    doc.moveDown(0.4);
  }

  // Footer
  const footerY = 800;
  doc.fontSize(8).fillColor('#888')
     .text(`${brand} — Proposta válida por ${p.validade_dias} dias.`, 48, footerY, { width: 499, align: 'center' });

  doc.end();
  await new Promise<void>(resolve => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

// ── Envio Z-API ─────────────────────────────────────────────────────────────
export async function enviarPropostaWhatsApp(input: { id: string; telefone?: string }): Promise<MutationResult & { messageId?: string; phone?: string }> {
  const id = Number(input.id);
  if (!id) throw new Error('id obrigatório');
  const p = await buscarProposta(input.id);
  const tel = (input.telefone?.trim()) || p.cliente?.telefone || '';
  if (!tel) throw new Error('Telefone obrigatório (informe ou cadastre no cliente).');

  const pdfBuf = await gerarPdfProposta(input.id);
  const fileName = `Proposta_${p.numero}_${(p.cliente?.nome || 'cliente').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.pdf`;
  const r = await sendDocument(tel, pdfBuf.toString('base64'), fileName);

  // Marca como enviada (status rascunho → enviada; mantém outros status)
  await pool.execute(
    `UPDATE propostas
        SET enviada_whatsapp = 1,
            enviada_em = CURRENT_TIMESTAMP,
            status = IF(status = 'rascunho', 'enviada', status)
      WHERE id = ?`,
    [id]
  );

  return {
    ok: true,
    message: `Proposta ${p.numero} enviada para ${r.phone} (msgId ${r.messageId || '?'}).`,
    messageId: r.messageId,
    phone: r.phone,
  };
}
