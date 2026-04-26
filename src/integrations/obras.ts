// Módulo de gestão de obras Romatec (v1.16).
// Tabelas: romatec_obras, romatec_obra_etapas, romatec_obra_transacoes,
// romatec_obra_equipe, romatec_obra_materiais, romatec_obra_diario.
// Padrão confirm-before-execute igual ao CRM em mutações destrutivas.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { formatBR, formatBRDate } from '../util/format';

// ── Types ────────────────────────────────────────────────────────────────────
type ObraRow = RowDataPacket & {
  id: number; nome: string; tipo: string;
  cliente: string | null; cliente_telefone: string | null;
  endereco: string | null; cidade: string | null;
  area_m2: string | null; orcamento: string | null;
  status: string;
  responsavel_tecnico: string | null;
  data_inicio: Date | null; data_previsao: Date | null;
  observacoes: string | null;
  created_at: Date; updated_at: Date;
};

type EtapaRow = RowDataPacket & {
  id: number; obra_id: number; nome: string;
  responsavel: string | null;
  data_inicio: Date | null; data_fim: Date | null;
  descricao: string | null;
  status: 'pendente' | 'em_andamento' | 'concluido' | 'atrasado';
  ordem: number;
};

type TransacaoRow = RowDataPacket & {
  id: number; obra_id: number;
  tipo: 'entrada' | 'saida';
  categoria: string | null; descricao: string;
  valor: string;
  data: Date;
  fornecedor: string | null; nota_fiscal: string | null;
  forma_pagamento: string;
};

type EquipeRow = RowDataPacket & {
  id: number; nome: string; funcao: string | null;
  tipo_contrato: string; cpf: string | null;
  telefone: string | null;
  valor_dia: string | null;
  especialidade: string | null;
  observacoes: string | null;
  ativo: number;
  obras_ids: string | null;
  obra_id: number | null;
};

type MaterialRow = RowDataPacket & {
  id: number; nome: string; categoria: string | null;
  unidade: string;
  estoque: string; estoque_minimo: string;
  valor_unitario: string | null;
  fornecedor_principal: string | null;
  local_armazenamento: string | null;
  obra_id: number | null;
};

type DiarioRow = RowDataPacket & {
  id: number; obra_id: number; data: Date; clima: string;
  horario_inicio: string | null; horario_fim: string | null;
  quantidade_trabalhadores: number | null;
  visitas: string | null; atividades: string;
  equipe_presente: string | null; ocorrencias: string | null;
  fotos_urls: string | null;
};

export interface MutationResult {
  preview?: boolean;
  ok?:      true;
  affected?: number;
  insertId?: number;
  message:  string;
  query?:   string;
}

const num = (v: string | null): number => v ? Number(v) : 0;

// ── Obras ────────────────────────────────────────────────────────────────────
export async function listarObras(input: { status?: string; limite?: number } = {}) {
  const limit = Math.min(Math.max(Number(input.limite) || 50, 1), 500);
  const params: (string | number)[] = [];
  let sql = 'SELECT * FROM romatec_obras';
  if (input.status) { sql += ' WHERE status = ?'; params.push(input.status); }
  sql += ` ORDER BY updated_at DESC LIMIT ${limit}`;
  const [rows] = await pool.execute<ObraRow[]>(sql, params);
  return rows.map(r => ({
    id: String(r.id),
    nome: r.nome, tipo: r.tipo, status: r.status,
    cliente: r.cliente, telefone: r.cliente_telefone,
    endereco: r.endereco, cidade: r.cidade,
    area_m2: num(r.area_m2),
    orcamento: num(r.orcamento),
    responsavel: r.responsavel_tecnico,
    data_inicio:  r.data_inicio ? formatBRDate(r.data_inicio) : null,
    data_previsao: r.data_previsao ? formatBRDate(r.data_previsao) : null,
    created_at: formatBR(r.created_at),
    updated_at: formatBR(r.updated_at),
  }));
}

export async function buscarObra(id: string) {
  const [rows] = await pool.execute<ObraRow[]>('SELECT * FROM romatec_obras WHERE id = ?', [id]);
  if (rows.length === 0) throw new Error(`Obra ${id} não encontrada`);
  const r = rows[0];

  const [etapas] = await pool.execute<EtapaRow[]>(
    'SELECT * FROM romatec_obra_etapas WHERE obra_id = ? ORDER BY ordem ASC', [id],
  );
  const [trans] = await pool.execute<TransacaoRow[]>(
    'SELECT * FROM romatec_obra_transacoes WHERE obra_id = ? ORDER BY data DESC LIMIT 30', [id],
  );
  const [diario] = await pool.execute<DiarioRow[]>(
    'SELECT * FROM romatec_obra_diario WHERE obra_id = ? ORDER BY data DESC LIMIT 10', [id],
  );

  const concluidas = etapas.filter(e => e.status === 'concluido').length;
  const progresso  = etapas.length > 0 ? Math.round((concluidas / etapas.length) * 100) : 0;
  const entradas = trans.filter(t => t.tipo === 'entrada').reduce((s, t) => s + num(t.valor), 0);
  const saidas   = trans.filter(t => t.tipo === 'saida').reduce((s, t) => s + num(t.valor), 0);
  const orcamento = num(r.orcamento);
  const consumo_pct = orcamento > 0 ? Math.round((saidas / orcamento) * 100) : 0;

  return {
    obra: {
      id: String(r.id), nome: r.nome, tipo: r.tipo, status: r.status,
      cliente: r.cliente, telefone: r.cliente_telefone,
      endereco: r.endereco, cidade: r.cidade,
      area_m2: num(r.area_m2), orcamento,
      responsavel: r.responsavel_tecnico,
      data_inicio:  r.data_inicio  ? formatBRDate(r.data_inicio)  : null,
      data_previsao: r.data_previsao ? formatBRDate(r.data_previsao) : null,
      observacoes: r.observacoes,
    },
    progresso: { etapas_total: etapas.length, etapas_concluidas: concluidas, progresso_pct: progresso },
    financeiro: { entradas, saidas, saldo: entradas - saidas, consumo_orcamento_pct: consumo_pct },
    etapas: etapas.map(e => ({
      id: String(e.id), nome: e.nome, status: e.status,
      ordem: e.ordem, responsavel: e.responsavel,
      data_inicio: e.data_inicio ? formatBRDate(e.data_inicio) : null,
      data_fim:    e.data_fim    ? formatBRDate(e.data_fim)    : null,
    })),
    transacoes_recentes: trans.map(t => ({
      id: String(t.id), tipo: t.tipo, descricao: t.descricao,
      valor: num(t.valor), data: formatBRDate(t.data),
      categoria: t.categoria, fornecedor: t.fornecedor,
    })),
    diario_recente: diario.map(d => ({
      data: formatBRDate(d.data), clima: d.clima,
      atividades: d.atividades, ocorrencias: d.ocorrencias,
    })),
  };
}

export async function criarObra(input: {
  nome: string; tipo?: string; cliente?: string; cliente_telefone?: string;
  endereco?: string; cidade?: string; area_m2?: number; orcamento?: number;
  status?: string; responsavel_tecnico?: string;
  data_inicio?: string; data_previsao?: string; observacoes?: string;
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.nome) throw new Error('Nome da obra é obrigatório');

  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] Criar obra "${input.nome}" (${input.tipo ?? 'residencial'}, cliente: ${input.cliente ?? '-'}, orçamento: ${input.orcamento ?? 0}). Reenvie com confirm:true após autorização do CEO.`,
    };
  }

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obras
      (nome, tipo, cliente, cliente_telefone, endereco, cidade, area_m2,
       orcamento, status, responsavel_tecnico, data_inicio, data_previsao, observacoes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.nome,
      input.tipo ?? 'residencial',
      input.cliente ?? null,
      input.cliente_telefone ?? null,
      input.endereco ?? null,
      input.cidade ?? null,
      input.area_m2 ?? null,
      input.orcamento ?? null,
      input.status ?? 'planejamento',
      input.responsavel_tecnico ?? null,
      input.data_inicio ?? null,
      input.data_previsao ?? null,
      input.observacoes ?? null,
    ],
  );
  return { ok: true, insertId: r.insertId, affected: r.affectedRows, message: `Obra "${input.nome}" criada com ID ${r.insertId}.` };
}

export async function atualizarObra(input: {
  id: string;
  nome?: string; tipo?: string; cliente?: string; cliente_telefone?: string;
  endereco?: string; cidade?: string; area_m2?: number; orcamento?: number;
  status?: string; responsavel_tecnico?: string;
  data_inicio?: string; data_previsao?: string; observacoes?: string;
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatório');
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  const map: Record<string, string> = {
    nome: 'nome', tipo: 'tipo', cliente: 'cliente', cliente_telefone: 'cliente_telefone',
    endereco: 'endereco', cidade: 'cidade', area_m2: 'area_m2', orcamento: 'orcamento',
    status: 'status', responsavel_tecnico: 'responsavel_tecnico',
    data_inicio: 'data_inicio', data_previsao: 'data_previsao', observacoes: 'observacoes',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (input as Record<string, unknown>)[k];
    if (v !== undefined) { fields.push(`${col} = ?`); params.push(v as string | number); }
  }
  if (fields.length === 0) throw new Error('Nenhum campo pra atualizar');

  if (!input.confirm) {
    return {
      preview: true,
      query: `UPDATE romatec_obras SET ${fields.join(', ')} WHERE id = ${input.id}`,
      message: `[PREVIEW] Atualizar obra ${input.id}: ${fields.join(', ')}. Reenvie com confirm:true.`,
    };
  }

  params.push(input.id);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE romatec_obras SET ${fields.join(', ')} WHERE id = ?`, params,
  );
  return { ok: true, affected: r.affectedRows, message: `Obra ${input.id} atualizada (${r.affectedRows} linha).` };
}

export async function apagarObra(input: { id: string; confirm?: boolean }): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatório');
  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] APAGAR obra ${input.id} + todas as etapas/transações/diário relacionados. AÇÃO IRREVERSÍVEL. Reenvie com confirm:true APÓS confirmação verbal.`,
    };
  }
  await pool.execute('DELETE FROM romatec_obra_etapas WHERE obra_id = ?', [input.id]);
  await pool.execute('DELETE FROM romatec_obra_transacoes WHERE obra_id = ?', [input.id]);
  await pool.execute('DELETE FROM romatec_obra_diario WHERE obra_id = ?', [input.id]);
  const [r] = await pool.execute<ResultSetHeader>('DELETE FROM romatec_obras WHERE id = ?', [input.id]);
  return { ok: true, affected: r.affectedRows, message: `Obra ${input.id} apagada com tudo relacionado.` };
}

// ── Etapas ───────────────────────────────────────────────────────────────────
export async function listarEtapasObra(obraId: string) {
  const [rows] = await pool.execute<EtapaRow[]>(
    'SELECT * FROM romatec_obra_etapas WHERE obra_id = ? ORDER BY ordem ASC, id ASC', [obraId],
  );
  return rows.map(r => ({
    id: String(r.id), nome: r.nome, status: r.status, ordem: r.ordem,
    responsavel: r.responsavel,
    data_inicio: r.data_inicio ? formatBRDate(r.data_inicio) : null,
    data_fim:    r.data_fim    ? formatBRDate(r.data_fim)    : null,
    descricao:   r.descricao,
  }));
}

export async function criarEtapa(input: {
  obra_id: string; nome: string; responsavel?: string;
  data_inicio?: string; data_fim?: string; descricao?: string;
  ordem?: number; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.obra_id || !input.nome) throw new Error('obra_id e nome obrigatórios');
  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] Criar etapa "${input.nome}" na obra ${input.obra_id}. Reenvie com confirm:true.`,
    };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obra_etapas (obra_id, nome, responsavel, data_inicio, data_fim, descricao, ordem)
     VALUES (?,?,?,?,?,?,?)`,
    [
      input.obra_id, input.nome,
      input.responsavel ?? null,
      input.data_inicio ?? null, input.data_fim ?? null,
      input.descricao ?? null,
      input.ordem ?? 0,
    ],
  );
  return { ok: true, insertId: r.insertId, message: `Etapa "${input.nome}" criada (ID ${r.insertId}).` };
}

export async function atualizarEtapa(input: {
  id: string; status?: 'pendente' | 'em_andamento' | 'concluido' | 'atrasado';
  nome?: string; responsavel?: string;
  data_inicio?: string; data_fim?: string;
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatório');
  const fields: string[] = []; const params: (string | number | null)[] = [];
  const map: Record<string, string> = {
    status: 'status', nome: 'nome', responsavel: 'responsavel',
    data_inicio: 'data_inicio', data_fim: 'data_fim',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (input as Record<string, unknown>)[k];
    if (v !== undefined) { fields.push(`${col} = ?`); params.push(v as string | number); }
  }
  if (fields.length === 0) throw new Error('Nenhum campo pra atualizar');
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Atualizar etapa ${input.id}: ${fields.join(', ')}. Reenvie com confirm:true.` };
  }
  params.push(input.id);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE romatec_obra_etapas SET ${fields.join(', ')} WHERE id = ?`, params,
  );
  return { ok: true, affected: r.affectedRows, message: `Etapa ${input.id} atualizada.` };
}

export async function apagarEtapa(input: { id: string; confirm?: boolean }): Promise<MutationResult> {
  if (!input.confirm) return { preview: true, message: `[PREVIEW] APAGAR etapa ${input.id}. Reenvie com confirm:true.` };
  const [r] = await pool.execute<ResultSetHeader>('DELETE FROM romatec_obra_etapas WHERE id = ?', [input.id]);
  return { ok: true, affected: r.affectedRows, message: `Etapa ${input.id} apagada.` };
}

// ── Transações Financeiras ───────────────────────────────────────────────────
export async function listarTransacoesObra(input: { obra_id: string; limite?: number }) {
  const limit = Math.min(Math.max(Number(input.limite) || 50, 1), 500);
  const [rows] = await pool.execute<TransacaoRow[]>(
    `SELECT * FROM romatec_obra_transacoes WHERE obra_id = ? ORDER BY data DESC LIMIT ${limit}`,
    [input.obra_id],
  );
  return rows.map(r => ({
    id: String(r.id), tipo: r.tipo, descricao: r.descricao,
    categoria: r.categoria, valor: num(r.valor),
    data: formatBRDate(r.data), fornecedor: r.fornecedor,
    nota_fiscal: r.nota_fiscal, forma_pagamento: r.forma_pagamento,
  }));
}

export async function criarTransacaoObra(input: {
  obra_id: string; tipo: 'entrada' | 'saida';
  descricao: string; valor: number;
  data?: string; categoria?: string;
  fornecedor?: string; nota_fiscal?: string;
  forma_pagamento?: string; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.obra_id || !input.tipo || !input.descricao || !input.valor) {
    throw new Error('obra_id, tipo, descricao e valor obrigatórios');
  }
  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] Registrar ${input.tipo} de R$ ${input.valor.toFixed(2)} ("${input.descricao}") na obra ${input.obra_id}. Reenvie com confirm:true.`,
    };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obra_transacoes
      (obra_id, tipo, categoria, descricao, valor, data, fornecedor, nota_fiscal, forma_pagamento)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      input.obra_id, input.tipo,
      input.categoria ?? null, input.descricao, input.valor,
      input.data ?? new Date().toISOString().slice(0, 10),
      input.fornecedor ?? null, input.nota_fiscal ?? null,
      input.forma_pagamento ?? 'pix',
    ],
  );
  return { ok: true, insertId: r.insertId, message: `Transação registrada (ID ${r.insertId}).` };
}

// ── Equipe ───────────────────────────────────────────────────────────────────
export async function listarEquipe(input: { obra_id?: string; somente_geral?: boolean } = {}) {
  let sql = 'SELECT * FROM romatec_obra_equipe WHERE ativo = 1';
  const params: (string | number)[] = [];
  if (input.somente_geral) {
    sql += ' AND obra_id IS NULL';
  } else if (input.obra_id) {
    // Mostra membros dessa obra OU sem obra (geral, alocáveis em qualquer)
    sql += ' AND (obra_id = ? OR obra_id IS NULL OR FIND_IN_SET(?, obras_ids) > 0)';
    params.push(input.obra_id, input.obra_id);
  }
  sql += ' ORDER BY (obra_id IS NULL) ASC, nome ASC';
  const [rows] = await pool.execute<EquipeRow[]>(sql, params);
  return rows.map(r => ({
    id: String(r.id), nome: r.nome, funcao: r.funcao,
    tipo_contrato: r.tipo_contrato, telefone: r.telefone,
    valor_dia: num(r.valor_dia), especialidade: r.especialidade,
    obra_id: r.obra_id ? String(r.obra_id) : null,
    obras_ids: (r.obras_ids ?? '').split(',').filter(Boolean),
  }));
}

export async function criarMembroEquipe(input: {
  nome: string; funcao?: string; tipo_contrato?: string;
  cpf?: string; telefone?: string; valor_dia?: number;
  especialidade?: string; observacoes?: string;
  obras_ids?: string[]; obra_id?: string; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.nome) throw new Error('nome obrigatório');
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Criar ${input.nome} na equipe${input.obra_id ? ` (obra ${input.obra_id})` : ' (geral)'}. Reenvie com confirm:true.` };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obra_equipe
      (nome, funcao, tipo_contrato, cpf, telefone, valor_dia, especialidade, observacoes, obras_ids, obra_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      input.nome, input.funcao ?? null, input.tipo_contrato ?? 'diarista',
      input.cpf ?? null, input.telefone ?? null,
      input.valor_dia ?? null, input.especialidade ?? null,
      input.observacoes ?? null,
      (input.obras_ids ?? []).join(','),
      input.obra_id ? Number(input.obra_id) : null,
    ],
  );
  return { ok: true, insertId: r.insertId, message: `${input.nome} adicionado${input.obra_id ? ` à obra ${input.obra_id}` : ' à equipe geral'} (ID ${r.insertId}).` };
}

// ── Materiais ────────────────────────────────────────────────────────────────
export async function listarMateriais(input: {
  apenas_baixos?: boolean; obra_id?: string; somente_geral?: boolean;
} = {}) {
  let sql = 'SELECT * FROM romatec_obra_materiais';
  const params: (string | number)[] = [];
  const where: string[] = [];
  if (input.apenas_baixos) where.push('estoque <= estoque_minimo');
  if (input.somente_geral) {
    where.push('obra_id IS NULL');
  } else if (input.obra_id) {
    where.push('(obra_id = ? OR obra_id IS NULL)');
    params.push(input.obra_id);
  }
  if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY (obra_id IS NULL) ASC, nome ASC';
  const [rows] = await pool.execute<MaterialRow[]>(sql, params);
  return rows.map(r => ({
    id: String(r.id), nome: r.nome, categoria: r.categoria,
    unidade: r.unidade, estoque: num(r.estoque),
    estoque_minimo: num(r.estoque_minimo),
    valor_unitario: num(r.valor_unitario),
    estoque_baixo: num(r.estoque) <= num(r.estoque_minimo),
    fornecedor: r.fornecedor_principal, local: r.local_armazenamento,
    obra_id: r.obra_id ? String(r.obra_id) : null,
  }));
}

export async function criarMaterial(input: {
  nome: string; categoria?: string; unidade?: string;
  estoque?: number; estoque_minimo?: number; valor_unitario?: number;
  fornecedor_principal?: string; local_armazenamento?: string;
  obra_id?: string; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.nome) throw new Error('nome obrigatório');
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Criar material "${input.nome}"${input.obra_id ? ` na obra ${input.obra_id}` : ' (estoque geral)'}. Reenvie com confirm:true.` };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obra_materiais
      (nome, categoria, unidade, estoque, estoque_minimo, valor_unitario, fornecedor_principal, local_armazenamento, obra_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      input.nome, input.categoria ?? null, input.unidade ?? 'un',
      input.estoque ?? 0, input.estoque_minimo ?? 0,
      input.valor_unitario ?? null,
      input.fornecedor_principal ?? null, input.local_armazenamento ?? null,
      input.obra_id ? Number(input.obra_id) : null,
    ],
  );
  return { ok: true, insertId: r.insertId, message: `Material "${input.nome}" criado${input.obra_id ? ` na obra ${input.obra_id}` : ' (estoque geral)'} (ID ${r.insertId}).` };
}

export async function ajustarEstoqueMaterial(input: {
  id: string; delta: number;  // positivo = adiciona, negativo = consome
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.id || !input.delta) throw new Error('id e delta obrigatórios');
  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] ${input.delta >= 0 ? 'Adicionar' : 'Consumir'} ${Math.abs(input.delta)} do estoque do material ${input.id}. Reenvie com confirm:true.`,
    };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    'UPDATE romatec_obra_materiais SET estoque = GREATEST(0, estoque + ?) WHERE id = ?',
    [input.delta, input.id],
  );
  return { ok: true, affected: r.affectedRows, message: `Estoque do material ${input.id} ajustado em ${input.delta}.` };
}

// ── Diário de Obra ───────────────────────────────────────────────────────────
export async function listarDiarioObra(input: { obra_id: string; limite?: number }) {
  const limit = Math.min(Math.max(Number(input.limite) || 30, 1), 200);
  const [rows] = await pool.execute<DiarioRow[]>(
    `SELECT * FROM romatec_obra_diario WHERE obra_id = ? ORDER BY data DESC LIMIT ${limit}`,
    [input.obra_id],
  );
  return rows.map(r => ({
    id: String(r.id), data: formatBRDate(r.data), clima: r.clima,
    horario_inicio: r.horario_inicio, horario_fim: r.horario_fim,
    qtd_trabalhadores: r.quantidade_trabalhadores,
    visitas: r.visitas, atividades: r.atividades,
    equipe_presente: r.equipe_presente, ocorrencias: r.ocorrencias,
  }));
}

export async function registrarDiarioObra(input: {
  obra_id: string; atividades: string;
  data?: string; clima?: string;
  horario_inicio?: string; horario_fim?: string;
  quantidade_trabalhadores?: number; visitas?: string;
  equipe_presente?: string; ocorrencias?: string;
  fotos_urls?: string[]; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.obra_id || !input.atividades) throw new Error('obra_id e atividades obrigatórios');
  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] Registrar diário de ${input.data ?? 'hoje'} na obra ${input.obra_id}: "${input.atividades.slice(0, 80)}...". Reenvie com confirm:true.`,
    };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obra_diario
      (obra_id, data, clima, horario_inicio, horario_fim, quantidade_trabalhadores,
       visitas, atividades, equipe_presente, ocorrencias, fotos_urls)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.obra_id,
      input.data ?? new Date().toISOString().slice(0, 10),
      input.clima ?? 'sol',
      input.horario_inicio ?? null, input.horario_fim ?? null,
      input.quantidade_trabalhadores ?? null,
      input.visitas ?? null, input.atividades,
      input.equipe_presente ?? null, input.ocorrencias ?? null,
      (input.fotos_urls ?? []).join('\n'),
    ],
  );
  return { ok: true, insertId: r.insertId, message: `Diário registrado (ID ${r.insertId}).` };
}

// ── Catálogo de profissões ───────────────────────────────────────────────────
type ProfissaoRow = RowDataPacket & {
  id: number; nome: string; categoria: string | null;
  valor_dia_referencia: string | null;
  salario_mensal_referencia: string | null;
  descricao: string | null;
};

export async function listarProfissoesCatalogo() {
  const [rows] = await pool.execute<ProfissaoRow[]>(
    'SELECT * FROM romatec_obra_profissoes_catalogo ORDER BY categoria ASC, nome ASC',
  );
  return rows.map(r => ({
    id: String(r.id), nome: r.nome, categoria: r.categoria,
    valor_dia_referencia: num(r.valor_dia_referencia),
    salario_mensal_referencia: num(r.salario_mensal_referencia),
    descricao: r.descricao,
  }));
}

export async function atualizarProfissaoCatalogo(input: {
  id: string; valor_dia_referencia?: number; salario_mensal_referencia?: number;
  descricao?: string; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatório');
  const fields: string[] = []; const params: (string | number | null)[] = [];
  if (input.valor_dia_referencia !== undefined) { fields.push('valor_dia_referencia = ?'); params.push(input.valor_dia_referencia); }
  if (input.salario_mensal_referencia !== undefined) { fields.push('salario_mensal_referencia = ?'); params.push(input.salario_mensal_referencia); }
  if (input.descricao !== undefined) { fields.push('descricao = ?'); params.push(input.descricao); }
  if (fields.length === 0) throw new Error('nada pra atualizar');
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Atualizar profissão ${input.id}: ${fields.join(', ')}. Reenvie com confirm:true.` };
  }
  params.push(input.id);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE romatec_obra_profissoes_catalogo SET ${fields.join(', ')} WHERE id = ?`, params,
  );
  return { ok: true, affected: r.affectedRows, message: `Profissão ${input.id} atualizada.` };
}

// ── Dias trabalhados (integral / manhã / tarde) ──────────────────────────────
type DiaRow = RowDataPacket & {
  id: number; funcionario_id: number; obra_id: number | null;
  data: Date; periodo: 'integral' | 'manha' | 'tarde';
  valor: string | null; observacoes: string | null;
};

export async function marcarDiaTrabalhado(input: {
  funcionario_id: string; data: string;
  periodo?: 'integral' | 'manha' | 'tarde';
  obra_id?: string; observacoes?: string;
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.funcionario_id || !input.data) throw new Error('funcionario_id e data obrigatórios');
  const periodo = input.periodo ?? 'integral';

  // Pega valor diária do funcionário pra calcular o valor proporcional
  const [funcs] = await pool.execute<EquipeRow[]>(
    'SELECT * FROM romatec_obra_equipe WHERE id = ?', [input.funcionario_id],
  );
  if (funcs.length === 0) throw new Error(`Funcionário ${input.funcionario_id} não encontrado`);
  const valor_dia = num(funcs[0].valor_dia);
  const valor_calc = periodo === 'integral' ? valor_dia : valor_dia / 2;

  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] Marcar ${funcs[0].nome} em ${input.data} (${periodo}, R$ ${valor_calc.toFixed(2)}). Reenvie com confirm:true.`,
    };
  }

  // ON DUPLICATE KEY UPDATE pra permitir re-marcar (atualiza obra_id/observacoes)
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obra_funcionario_dias
       (funcionario_id, obra_id, data, periodo, valor, observacoes)
     VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       obra_id = VALUES(obra_id),
       valor = VALUES(valor),
       observacoes = VALUES(observacoes)`,
    [
      input.funcionario_id,
      input.obra_id ?? null,
      input.data, periodo, valor_calc,
      input.observacoes ?? null,
    ],
  );
  return { ok: true, insertId: r.insertId, message: `${funcs[0].nome} marcado em ${input.data} (${periodo}) — R$ ${valor_calc.toFixed(2)}.` };
}

export async function desmarcarDiaTrabalhado(input: {
  funcionario_id: string; data: string;
  periodo?: 'integral' | 'manha' | 'tarde';
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.funcionario_id || !input.data) throw new Error('funcionario_id e data obrigatórios');
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Desmarcar funcionário ${input.funcionario_id} em ${input.data}${input.periodo ? ' ('+input.periodo+')' : ' (todos os períodos)'}. Reenvie com confirm:true.` };
  }
  let sql = 'DELETE FROM romatec_obra_funcionario_dias WHERE funcionario_id = ? AND data = ?';
  const params: (string | number)[] = [input.funcionario_id, input.data];
  if (input.periodo) { sql += ' AND periodo = ?'; params.push(input.periodo); }
  const [r] = await pool.execute<ResultSetHeader>(sql, params);
  return { ok: true, affected: r.affectedRows, message: `${r.affectedRows} marcação(ões) removida(s).` };
}

export async function listarDiasFuncionario(input: {
  funcionario_id: string;
  ano?: number; mes?: number;
}) {
  if (!input.funcionario_id) throw new Error('funcionario_id obrigatório');
  const params: (string | number)[] = [input.funcionario_id];
  let sql = 'SELECT * FROM romatec_obra_funcionario_dias WHERE funcionario_id = ?';
  if (input.ano && input.mes) {
    sql += ' AND YEAR(data) = ? AND MONTH(data) = ?';
    params.push(input.ano, input.mes);
  }
  sql += ' ORDER BY data ASC';
  const [rows] = await pool.execute<DiaRow[]>(sql, params);
  return rows.map(r => ({
    id: String(r.id),
    data: r.data instanceof Date ? r.data.toISOString().slice(0, 10) : String(r.data),
    periodo: r.periodo,
    valor: num(r.valor),
    obra_id: r.obra_id ? String(r.obra_id) : null,
    observacoes: r.observacoes,
  }));
}

export async function relatorioMensalFuncionario(input: {
  funcionario_id: string; ano: number; mes: number;
}) {
  const dias = await listarDiasFuncionario(input);
  const integral = dias.filter(d => d.periodo === 'integral').length;
  const manha    = dias.filter(d => d.periodo === 'manha').length;
  const tarde    = dias.filter(d => d.periodo === 'tarde').length;
  const total_dias_equivalente = integral + (manha + tarde) * 0.5;
  const total_pagar = dias.reduce((s, d) => s + d.valor, 0);

  const [funcs] = await pool.execute<EquipeRow[]>(
    'SELECT nome, funcao, valor_dia FROM romatec_obra_equipe WHERE id = ?',
    [input.funcionario_id],
  );
  const f = funcs[0];

  return {
    funcionario: f ? { nome: f.nome, funcao: f.funcao, valor_dia: num(f.valor_dia) } : null,
    periodo: `${String(input.mes).padStart(2,'0')}/${input.ano}`,
    integral, manha, tarde,
    total_dias_equivalente,
    total_pagar,
    dias,
  };
}

export async function relatorioMensalEquipe(input: {
  ano: number; mes: number; obra_id?: string;
}) {
  const params: (string | number)[] = [input.ano, input.mes];
  let sql = `
    SELECT d.funcionario_id, e.nome, e.funcao, e.valor_dia,
           COUNT(CASE WHEN d.periodo = 'integral' THEN 1 END) AS integral,
           COUNT(CASE WHEN d.periodo = 'manha'    THEN 1 END) AS manha,
           COUNT(CASE WHEN d.periodo = 'tarde'    THEN 1 END) AS tarde,
           COALESCE(SUM(d.valor), 0) AS total_pagar
    FROM romatec_obra_funcionario_dias d
    JOIN romatec_obra_equipe e ON e.id = d.funcionario_id
    WHERE YEAR(d.data) = ? AND MONTH(d.data) = ?`;
  if (input.obra_id) { sql += ' AND d.obra_id = ?'; params.push(input.obra_id); }
  sql += ' GROUP BY d.funcionario_id, e.nome, e.funcao, e.valor_dia ORDER BY e.nome ASC';

  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  const lista = rows.map(r => ({
    funcionario_id: String(r.funcionario_id),
    nome: r.nome as string,
    funcao: r.funcao as string | null,
    valor_dia: num((r.valor_dia as string) ?? '0'),
    integral: Number(r.integral),
    manha:    Number(r.manha),
    tarde:    Number(r.tarde),
    total_dias_equivalente: Number(r.integral) + (Number(r.manha) + Number(r.tarde)) * 0.5,
    total_pagar: num(String(r.total_pagar ?? '0')),
  }));
  const total_geral = lista.reduce((s, l) => s + l.total_pagar, 0);
  return {
    periodo: `${String(input.mes).padStart(2,'0')}/${input.ano}`,
    obra_id: input.obra_id ?? null,
    total_funcionarios: lista.length,
    total_geral,
    funcionarios: lista,
  };
}

// ── Resumo Geral ─────────────────────────────────────────────────────────────
export async function resumoObras() {
  const [obras] = await pool.execute<ObraRow[]>('SELECT * FROM romatec_obras');
  const [trans] = await pool.execute<TransacaoRow[]>('SELECT obra_id, tipo, valor FROM romatec_obra_transacoes');
  const [etapas] = await pool.execute<EtapaRow[]>('SELECT obra_id, status FROM romatec_obra_etapas');
  const [matsBaixos] = await pool.execute<MaterialRow[]>(
    'SELECT * FROM romatec_obra_materiais WHERE estoque <= estoque_minimo'
  );

  const ent = trans.filter(t => t.tipo === 'entrada').reduce((s, t) => s + num(t.valor), 0);
  const sai = trans.filter(t => t.tipo === 'saida').reduce((s, t) => s + num(t.valor), 0);
  const orcamento_total = obras.reduce((s, o) => s + num(o.orcamento), 0);

  return {
    total_obras: obras.length,
    em_andamento: obras.filter(o => o.status === 'em_andamento').length,
    concluidas:   obras.filter(o => o.status === 'concluida').length,
    paralisadas:  obras.filter(o => o.status === 'paralisada').length,
    orcamento_total,
    entradas: ent, saidas: sai, saldo: ent - sai,
    total_etapas: etapas.length,
    etapas_atrasadas: etapas.filter(e => e.status === 'atrasado').length,
    materiais_baixos: matsBaixos.length,
    obras_ativas: obras
      .filter(o => o.status === 'em_andamento')
      .map(o => ({ id: String(o.id), nome: o.nome, orcamento: num(o.orcamento) })),
  };
}
