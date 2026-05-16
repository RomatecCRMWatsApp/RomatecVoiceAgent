// Módulo de gestão de obras Romatec (v1.16).
// Tabelas: romatec_obras, romatec_obra_etapas, romatec_obra_transacoes,
// romatec_obra_equipe, romatec_obra_materiais, romatec_obra_diario.
// Padrão confirm-before-execute igual ao CRM em mutações destrutivas.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { formatBR, formatBRDate } from '../util/format';
import { broadcastParcelaEvent, type ParcelaEventKind } from '../agent/proactive';

function emitParcela(kind: ParcelaEventKind, obra_id: string | number, parcela_id?: string | number, status_cobranca?: string): void {
  try {
    broadcastParcelaEvent({
      kind,
      obra_id: String(obra_id),
      parcela_id: parcela_id != null ? String(parcela_id) : undefined,
      status_cobranca,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[sse:parcela] broadcast falhou:', (err as Error).message);
  }
}

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
  return rows.map((r: ObraRow & {
    valor_contrato?: string | number | null;
    prazo_dias?: number | null;
    prazo_dias_uteis?: number | null;
  }) => ({
    id: String(r.id),
    nome: r.nome, tipo: r.tipo, status: r.status,
    cliente: r.cliente,
    cliente_telefone: r.cliente_telefone,  // v1.65.45: nome correto do campo
    telefone: r.cliente_telefone,           // alias backward compat
    endereco: r.endereco, cidade: r.cidade,
    area_m2: num(r.area_m2),
    orcamento: num(r.orcamento),
    valor_contrato: r.valor_contrato != null ? Number(r.valor_contrato) : 0,  // v1.65.45
    responsavel: r.responsavel_tecnico,
    responsavel_tecnico: r.responsavel_tecnico,
    data_inicio:  r.data_inicio ? toIsoDate(r.data_inicio) : null,
    data_previsao: r.data_previsao ? toIsoDate(r.data_previsao) : null,
    prazo_dias: r.prazo_dias != null ? Number(r.prazo_dias) : null,        // v1.65.45
    prazo_dias_uteis: r.prazo_dias_uteis != null ? Number(r.prazo_dias_uteis) : null, // v1.65.45
    observacoes: (r as { observacoes?: string | null }).observacoes ?? null,
    created_at: formatBR(r.created_at),
    updated_at: formatBR(r.updated_at),
  }));
}

// v1.65.45: helper pra converter Date/string em YYYY-MM-DD (formato do <input type="date">)
function toIsoDate(d: Date | string): string {
  if (typeof d === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const dd = new Date(d);
  return `${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,'0')}-${String(dd.getDate()).padStart(2,'0')}`;
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
  valor_contrato?: number;
  status?: string; responsavel_tecnico?: string;
  data_inicio?: string; data_previsao?: string;
  prazo_dias?: number; prazo_dias_uteis?: number;
  observacoes?: string;
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
       orcamento, valor_contrato, status, responsavel_tecnico,
       data_inicio, data_previsao, prazo_dias, prazo_dias_uteis, observacoes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.nome,
      input.tipo ?? 'residencial',
      input.cliente ?? null,
      input.cliente_telefone ?? null,
      input.endereco ?? null,
      input.cidade ?? null,
      input.area_m2 ?? null,
      input.orcamento ?? null,
      input.valor_contrato ?? null,
      input.status ?? 'planejamento',
      input.responsavel_tecnico ?? null,
      input.data_inicio ?? null,
      input.data_previsao ?? null,
      input.prazo_dias ?? null,
      input.prazo_dias_uteis ?? null,
      input.observacoes ?? null,
    ],
  );
  return { ok: true, insertId: r.insertId, affected: r.affectedRows, message: `Obra "${input.nome}" criada com ID ${r.insertId}.` };
}

export async function atualizarObra(input: {
  id: string;
  nome?: string; tipo?: string; cliente?: string; cliente_telefone?: string;
  endereco?: string; cidade?: string; area_m2?: number; orcamento?: number;
  valor_contrato?: number;
  status?: string; responsavel_tecnico?: string;
  data_inicio?: string; data_previsao?: string;
  prazo_dias?: number; prazo_dias_uteis?: number;
  observacoes?: string;
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatório');
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  const map: Record<string, string> = {
    nome: 'nome', tipo: 'tipo', cliente: 'cliente', cliente_telefone: 'cliente_telefone',
    endereco: 'endereco', cidade: 'cidade', area_m2: 'area_m2', orcamento: 'orcamento',
    valor_contrato: 'valor_contrato',
    status: 'status', responsavel_tecnico: 'responsavel_tecnico',
    data_inicio: 'data_inicio', data_previsao: 'data_previsao',
    prazo_dias: 'prazo_dias', prazo_dias_uteis: 'prazo_dias_uteis',
    observacoes: 'observacoes',
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

  // v1.77.0: trigger recibo automatico se etapa virou 'concluido'
  if (input.status === 'concluido') {
    void import('../services/recibosTriggers')
      .then(m => m.gerarReciboEtapaConcluida(Number(input.id)))
      .catch(err => console.warn('[trigger etapa_concluida]', (err as Error).message));
  }

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
  // v1.62.0: filtra soft-deleted. Inclui condição "OR deleted_at IS NULL" pra
  // sobreviver ao caso onde a coluna ainda não foi adicionada (banco antigo).
  const [rows] = await pool.execute<TransacaoRow[]>(
    `SELECT * FROM romatec_obra_transacoes
      WHERE obra_id = ?
        AND deleted_at IS NULL
      ORDER BY data DESC LIMIT ${limit}`,
    [input.obra_id],
  );
  return rows.map(r => ({
    id: String(r.id), tipo: r.tipo, descricao: r.descricao,
    categoria: r.categoria, valor: num(r.valor),
    data: formatBRDate(r.data), fornecedor: r.fornecedor,
    nota_fiscal: r.nota_fiscal, forma_pagamento: r.forma_pagamento,
  }));
}

// v1.62.0: edição e soft-delete de transações financeiras.
// Soft delete (deleted_at) preserva histórico, evita perda acidental.
// updated_by/deleted_by são VARCHAR — aceita 'CEO' ou identificador qualquer.
export async function atualizarTransacaoObra(input: {
  id:               string;
  tipo?:            'entrada' | 'saida';
  categoria?:       string | null;
  descricao?:       string;
  valor?:           number;
  data?:            string;
  fornecedor?:      string | null;
  nota_fiscal?:     string | null;
  forma_pagamento?: string;
  updated_by?:      string;
  confirm?:         boolean;
}): Promise<MutationResult> {
  const numId = Number(input.id);
  if (!Number.isFinite(numId)) throw new Error(`ID inválido: ${input.id}`);

  // Coleta apenas campos que vieram (não atualiza com null silencioso)
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const k of ['tipo','categoria','descricao','valor','data','fornecedor','nota_fiscal','forma_pagamento'] as const) {
    if (input[k] !== undefined) {
      sets.push(`${k} = ?`);
      params.push(input[k] as string | number | null);
    }
  }
  if (sets.length === 0) {
    return { preview: true, message: '[PREVIEW] Nenhum campo pra atualizar.' };
  }
  if (input.updated_by) {
    sets.push('updated_by = ?');
    params.push(input.updated_by);
  }
  // updated_at é auto via ON UPDATE CURRENT_TIMESTAMP

  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] Atualizar transação ${numId}: ${sets.length} campo(s) (${sets.map(s=>s.split(' = ')[0]).join(', ')}). Reenvie com confirm:true.`,
    };
  }

  params.push(numId);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE romatec_obra_transacoes
        SET ${sets.join(', ')}
      WHERE id = ? AND deleted_at IS NULL`,
    params,
  );
  if (r.affectedRows === 0) {
    throw new Error(`Transação ${numId} não encontrada ou já foi excluída.`);
  }
  return { ok: true, affected: r.affectedRows, message: `Transação ${numId} atualizada.` };
}

export async function apagarTransacaoObra(input: {
  id:         string;
  deleted_by?: string;
  confirm?:   boolean;
}): Promise<MutationResult> {
  const numId = Number(input.id);
  if (!Number.isFinite(numId)) throw new Error(`ID inválido: ${input.id}`);

  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] Soft-delete da transação ${numId} (registro mantido em histórico, sai da lista). Reenvie com confirm:true.`,
    };
  }

  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE romatec_obra_transacoes
        SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [input.deleted_by ?? 'sistema', numId],
  );
  if (r.affectedRows === 0) {
    throw new Error(`Transação ${numId} não encontrada ou já estava excluída.`);
  }
  return { ok: true, affected: r.affectedRows, message: `Transação ${numId} excluída (soft delete).` };
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
    // v1.65.55: status do colaborador (ativo/ausente/doente/ferias/afastado/transferido/desligado)
    status: ((r as unknown as { status?: string }).status as string) || 'ativo',
  }));
}

export async function atualizarMembroEquipe(input: {
  id: string;
  nome?: string; funcao?: string; tipo_contrato?: string;
  cpf?: string; rg?: string; telefone?: string; email?: string;
  valor_dia?: number;
  especialidade?: string; observacoes?: string;
  data_admissao?: string;
  endereco_rua?: string; endereco_numero?: string; endereco_bairro?: string;
  endereco_cidade?: string; endereco_estado?: string; endereco_cep?: string;
  foto_url?: string;
  obra_id?: string | null; ativo?: boolean;
  status?: 'ativo'|'ausente'|'doente'|'ferias'|'afastado'|'transferido'|'desligado';
  // v3.10.2: PIX
  chave_pix?: string | null;
  tipo_chave_pix?: 'cpf'|'cnpj'|'email'|'telefone'|'aleatoria' | null;
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatório');
  const fields: string[] = []; const params: (string | number | null)[] = [];
  // v1.63.0: aceita 9 colunas novas (RG, email, data_admissao, endereço, foto)
  const map: Record<string, string> = {
    nome: 'nome', funcao: 'funcao', tipo_contrato: 'tipo_contrato',
    cpf: 'cpf', rg: 'rg', telefone: 'telefone', email: 'email',
    valor_dia: 'valor_dia',
    especialidade: 'especialidade', observacoes: 'observacoes',
    data_admissao: 'data_admissao',
    endereco_rua: 'endereco_rua', endereco_numero: 'endereco_numero',
    endereco_bairro: 'endereco_bairro', endereco_cidade: 'endereco_cidade',
    endereco_estado: 'endereco_estado', endereco_cep: 'endereco_cep',
    foto_url: 'foto_url',
    status: 'status',
    // v3.10.2: PIX
    chave_pix: 'chave_pix',
    tipo_chave_pix: 'tipo_chave_pix',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (input as Record<string, unknown>)[k];
    if (v !== undefined) { fields.push(`${col} = ?`); params.push(v as string | number); }
  }
  if (input.obra_id !== undefined) {
    fields.push('obra_id = ?');
    params.push(input.obra_id ? Number(input.obra_id) : null);
  }
  if (input.ativo !== undefined) {
    fields.push('ativo = ?');
    params.push(input.ativo ? 1 : 0);
  }
  if (fields.length === 0) throw new Error('nada pra atualizar');
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Atualizar membro ${input.id}: ${fields.length} campo(s). Reenvie com confirm:true.` };
  }
  params.push(input.id);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE romatec_obra_equipe SET ${fields.join(', ')} WHERE id = ?`, params,
  );
  // v1.65.10: re-sync após edição (cargo/telefone/email/ativo podem ter mudado)
  void import('../services/syncEquipeMembro')
    .then(s => s.syncEquipeMembro(Number(input.id)))
    .catch(err => console.warn('[syncEquipe] falhou após atualizar:', (err as Error).message));
  return { ok: true, affected: r.affectedRows, message: `Membro ${input.id} atualizado.` };
}

export async function atualizarMaterial(input: {
  id: string;
  nome?: string; categoria?: string; unidade?: string;
  estoque?: number; estoque_minimo?: number; valor_unitario?: number;
  fornecedor_principal?: string; local_armazenamento?: string;
  obra_id?: string | null; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatório');
  const fields: string[] = []; const params: (string | number | null)[] = [];
  const map: Record<string, string> = {
    nome: 'nome', categoria: 'categoria', unidade: 'unidade',
    estoque: 'estoque', estoque_minimo: 'estoque_minimo',
    valor_unitario: 'valor_unitario',
    fornecedor_principal: 'fornecedor_principal',
    local_armazenamento: 'local_armazenamento',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (input as Record<string, unknown>)[k];
    if (v !== undefined) { fields.push(`${col} = ?`); params.push(v as string | number); }
  }
  if (input.obra_id !== undefined) {
    fields.push('obra_id = ?');
    params.push(input.obra_id ? Number(input.obra_id) : null);
  }
  if (fields.length === 0) throw new Error('nada pra atualizar');
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Atualizar material ${input.id}: ${fields.join(', ')}. Reenvie com confirm:true.` };
  }
  params.push(input.id);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE romatec_obra_materiais SET ${fields.join(', ')} WHERE id = ?`, params,
  );
  return { ok: true, affected: r.affectedRows, message: `Material ${input.id} atualizado.` };
}

export async function apagarMembroEquipe(input: {
  id: string; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatório');
  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] APAGAR membro ${input.id} + todas as marcações de dias trabalhados dele. IRREVERSÍVEL. Reenvie com confirm:true.`,
    };
  }
  await pool.execute('DELETE FROM romatec_obra_funcionario_dias WHERE funcionario_id = ?', [input.id]);
  const [r] = await pool.execute<ResultSetHeader>(
    'DELETE FROM romatec_obra_equipe WHERE id = ?', [input.id],
  );
  // v1.65.10: limpa memória ZAYRA do colaborador apagado.
  // Não toca em contacts — o registro pode ser referenciado em outros lugares
  // (cliente/fornecedor noutro fluxo); só deslinkar é mais seguro.
  void pool.execute(
    `DELETE FROM zayra_memory WHERE relevance_tags LIKE ?`,
    [`%equipe_membro_id_${input.id}%`]
  ).then(() => import('../agent/memory').then(m => m.invalidateContextCache?.()))
   .catch(err => console.warn('[syncEquipe] limpeza memória falhou:', (err as Error).message));
  return { ok: true, affected: r.affectedRows, message: `Membro ${input.id} removido.` };
}

export async function apagarMaterial(input: {
  id: string; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatório');
  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] APAGAR material ${input.id}. IRREVERSÍVEL. Reenvie com confirm:true.`,
    };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    'DELETE FROM romatec_obra_materiais WHERE id = ?', [input.id],
  );
  return { ok: true, affected: r.affectedRows, message: `Material ${input.id} removido.` };
}

export async function criarMembroEquipe(input: {
  nome: string; funcao?: string; tipo_contrato?: string;
  cpf?: string; rg?: string; telefone?: string; email?: string;
  valor_dia?: number;
  especialidade?: string; observacoes?: string;
  data_admissao?: string;
  endereco_rua?: string; endereco_numero?: string; endereco_bairro?: string;
  endereco_cidade?: string; endereco_estado?: string; endereco_cep?: string;
  foto_url?: string;
  status?: 'ativo'|'ausente'|'doente'|'ferias'|'afastado'|'transferido'|'desligado';
  // v3.10.2: PIX
  chave_pix?: string | null;
  tipo_chave_pix?: 'cpf'|'cnpj'|'email'|'telefone'|'aleatoria' | null;
  obras_ids?: string[]; obra_id?: string; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.nome) throw new Error('nome obrigatório');
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Criar ${input.nome} na equipe${input.obra_id ? ` (obra ${input.obra_id})` : ' (geral)'}. Reenvie com confirm:true.` };
  }
  // v1.65.55: insert com 19 colunas (+ status). Default 'ativo'.
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obra_equipe
      (nome, funcao, tipo_contrato, cpf, rg, telefone, email, valor_dia,
       especialidade, observacoes, data_admissao,
       endereco_rua, endereco_numero, endereco_bairro, endereco_cidade,
       endereco_estado, endereco_cep, foto_url, obras_ids, obra_id, status,
       chave_pix, tipo_chave_pix, chave_pix_atualizada_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.nome, input.funcao ?? null, input.tipo_contrato ?? 'diarista',
      input.cpf ?? null, input.rg ?? null,
      input.telefone ?? null, input.email ?? null,
      input.valor_dia ?? null, input.especialidade ?? null,
      input.observacoes ?? null, input.data_admissao ?? null,
      input.endereco_rua ?? null, input.endereco_numero ?? null,
      input.endereco_bairro ?? null, input.endereco_cidade ?? null,
      input.endereco_estado ?? null, input.endereco_cep ?? null,
      input.foto_url ?? null,
      (input.obras_ids ?? []).join(','),
      input.obra_id ? Number(input.obra_id) : null,
      input.status ?? 'ativo',
      // v3.10.2: PIX
      input.chave_pix ?? null,
      input.tipo_chave_pix ?? null,
      input.chave_pix ? new Date() : null,
    ],
  );
  // v1.65.10: sync Equipe → contacts → zayra_memory (fire-and-forget,
  // não bloqueia retorno; falha não derruba criação)
  void import('../services/syncEquipeMembro')
    .then(s => s.syncEquipeMembro(r.insertId))
    .catch(err => console.warn('[syncEquipe] falhou após criar:', (err as Error).message));
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
  /** v3.9.0 — Quando true (default), exclui dias já cobertos por recibos
   * quinzenais PAGOS. Cada funcionário tem seu próprio "data_limite" baseado
   * em MAX(periodo_fim) dos recibos_envios com status='pago'. Dias com
   * data > data_limite entram na folha; dias <= data_limite são considerados
   * já pagos e SAEM do contador. Se 'apenas_em_aberto=false' (passar
   * explicitamente), retorna o histórico completo do mês. */
  apenas_em_aberto?: boolean;
}) {
  const apenasEmAberto = input.apenas_em_aberto !== false;

  // v3.9.7 — Volta pra NOT EXISTS BETWEEN — confiando que `periodo_fim` do
  // recibo reflete o ÚLTIMO DIA REAL coberto pelo pagamento (não a janela
  // padrão da quinzena). Se o sistema gerou com janela errada (01-15 quando
  // a quinzena real é 27/04-10/05), o user precisa corrigir manualmente o
  // periodo_fim dos recibos (UPDATE) — depois a Folha respeita.
  // Subquery limite (pra UI mostrar "Pago até DD/MM"): MAX(periodo_fim).
  const subqueryLimite = `
    (SELECT MAX(l2.periodo_fim)
       FROM recibos_envios e2
       JOIN recibos_envios_lotes l2 ON l2.id = e2.lote_id
      WHERE e2.membro_id = d.funcionario_id
        AND e2.status = 'pago')
  `;

  const filtroEmAberto = apenasEmAberto
    ? `AND NOT EXISTS (
         SELECT 1
           FROM recibos_envios e3
           JOIN recibos_envios_lotes l3 ON l3.id = e3.lote_id
          WHERE e3.membro_id = d.funcionario_id
            AND e3.status = 'pago'
            AND d.data BETWEEN l3.periodo_inicio AND l3.periodo_fim
       )`
    : '';

  const params: (string | number)[] = [input.ano, input.mes];
  // v3.10.0: filtra dias já consolidados em fechamentos de folha.
  // (Coluna `fechamento_id` é adicionada pela migration de Fechamento de Folha.)
  let sql = `
    SELECT d.funcionario_id, e.nome, e.funcao, e.valor_dia, e.telefone,
           COUNT(CASE WHEN d.periodo = 'integral' THEN 1 END) AS integral,
           COUNT(CASE WHEN d.periodo = 'manha'    THEN 1 END) AS manha,
           COUNT(CASE WHEN d.periodo = 'tarde'    THEN 1 END) AS tarde,
           COALESCE(SUM(d.valor), 0) AS total_pagar,
           ${subqueryLimite} AS data_ultimo_recibo_pago
    FROM romatec_obra_funcionario_dias d
    JOIN romatec_obra_equipe e ON e.id = d.funcionario_id
    WHERE YEAR(d.data) = ? AND MONTH(d.data) = ?
      AND d.fechamento_id IS NULL
    ${filtroEmAberto}`;
  if (input.obra_id) { sql += ' AND d.obra_id = ?'; params.push(input.obra_id); }
  sql += ' GROUP BY d.funcionario_id, e.nome, e.funcao, e.valor_dia, e.telefone ORDER BY e.nome ASC';

  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  const lista = rows.map(r => ({
    funcionario_id: String(r.funcionario_id),
    nome: r.nome as string,
    funcao: r.funcao as string | null,
    telefone: (r.telefone as string | null) ?? null,
    valor_dia: num((r.valor_dia as string) ?? '0'),
    integral: Number(r.integral),
    manha:    Number(r.manha),
    tarde:    Number(r.tarde),
    total_dias_equivalente: Number(r.integral) + (Number(r.manha) + Number(r.tarde)) * 0.5,
    total_pagar: num(String(r.total_pagar ?? '0')),
    // v3.9.0 — Pra UI mostrar "Contador zerado após pagamento de DD/MM"
    data_ultimo_recibo_pago: r.data_ultimo_recibo_pago
      ? String(r.data_ultimo_recibo_pago).slice(0, 10)
      : null,
  }));
  const total_geral = lista.reduce((s, l) => s + l.total_pagar, 0);
  return {
    periodo: `${String(input.mes).padStart(2,'0')}/${input.ano}`,
    obra_id: input.obra_id ?? null,
    total_funcionarios: lista.length,
    total_geral,
    apenas_em_aberto: apenasEmAberto,
    funcionarios: lista,
  };
}

// v1.99.16: Saldo Consolidado em Aberto (cross-month)
// Cobre o caso "obra que comeca no meio de uma quinzena e termina no meio
// da proxima" — a UI mensal da Folha nao representa isso bem.
//
// Logica de "em aberto":
//   - Calcula data_limite = fim do periodo do ULTIMO recibo quinzenal
//     EMITIDO pra cada membro (em recibos_quinzena_emitidos)
//   - Se nunca foi emitido recibo quinzenal pro membro, data_limite = '1900-01-01'
//   - dias_em_aberto = todos os dias trabalhados com data > data_limite
//   - vales_em_aberto = ajustes tipo 'adiantamento' criados apos data_limite
//                       (heuristica simples: usa criado_em do ajuste)
//
// Periodo corrente (pra eventual passagem de vale a partir desta vista):
//   - Se hoje <= dia 15 -> periodo = 'YYYY-MM-1'
//   - Senao             -> periodo = 'YYYY-MM-2'
export async function relatorioSaldoEmAbertoEquipe(input: {
  obra_id?: string;
  /** v1.99.23: data inicial override (YYYY-MM-DD). Se nao passar, usa data_limite (auto). */
  data_inicio?: string;
  /** v1.99.23: data final override (YYYY-MM-DD). Se nao passar, conta ate hoje. */
  data_fim?: string;
} = {}) {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const q = hoje.getDate() <= 15 ? 1 : 2;
  const periodoCorrente = `${ano}-${mes}-${q}`;
  // v1.99.23: filtros opcionais de intervalo (sobrescreve data_limite e/ou hoje)
  const dataInicioOverride = (input.data_inicio && /^\d{4}-\d{2}-\d{2}$/.test(input.data_inicio))
    ? input.data_inicio : null;
  const dataFimOverride = (input.data_fim && /^\d{4}-\d{2}-\d{2}$/.test(input.data_fim))
    ? input.data_fim : null;

  // 1) Lista membros ativos (mesmo filtro de listarEquipe)
  const params: (string | number)[] = [];
  let sqlMembros = `
    SELECT id, nome, funcao, valor_dia, telefone
      FROM romatec_obra_equipe
     WHERE ativo = 1`;
  if (input.obra_id) {
    sqlMembros += ' AND (obra_id = ? OR obra_id IS NULL OR FIND_IN_SET(?, obras_ids) > 0)';
    params.push(input.obra_id, input.obra_id);
  }
  sqlMembros += ' ORDER BY nome ASC';
  const [membros] = await pool.execute<RowDataPacket[]>(sqlMembros, params);

  if (membros.length === 0) {
    return {
      periodo_corrente: periodoCorrente,
      obra_id: input.obra_id ?? null,
      total_funcionarios: 0,
      total_dias: 0,
      total_bruto: 0,
      total_vales: 0,
      total_liquido: 0,
      funcionarios: [] as Array<Record<string, unknown>>,
    };
  }

  // 2) Pra cada membro, calcula data_limite + dias_em_aberto + vales_em_aberto
  // Faz query agregada pra todos de uma vez (evita N+1)
  const ids = membros.map(m => Number(m.id));
  const placeholders = ids.map(() => '?').join(',');

  // v1.99.19: data_limite agora vem de recibos_envios.status='pago' (efetivo),
  // NAO mais de recibos_quinzena_emitidos (snapshot de geracao de PDF, que pode
  // existir sem pagamento real).
  // Bug anterior: snapshot de '2026-04-2' fazia obra que comecou 27/04 perder
  // os 4 dias de abril (sistema achava que ja tinham sido pagos no recibo
  // quinzenal — mas nunca foi pago).
  // Agora: se nao tem recibos_envios.status='pago' pro membro, data_limite
  // fica null e TODOS os dias trabalhados entram como em aberto.
  const [limites] = await pool.execute<RowDataPacket[]>(
    `SELECT e.membro_id, MAX(l.periodo_fim) AS data_limite
       FROM recibos_envios e
       JOIN recibos_envios_lotes l ON l.id = e.lote_id
      WHERE e.membro_id IN (${placeholders})
        AND e.status = 'pago'
      GROUP BY e.membro_id`,
    ids
  );
  const limitePorMembro = new Map<number, Date>();
  for (const r of limites) {
    if (r.data_limite) {
      limitePorMembro.set(Number(r.membro_id), new Date(r.data_limite as string));
    }
  }

  // Dias em aberto: SUM por membro APOS data_limite (ou todos se nao tem limite)
  // Como cada membro pode ter limite diferente, faz query por membro com inline.
  // Pra equipes pequenas (5-15) e aceitavel; otimiza depois se virar bottleneck.
  type SaldoFuncionario = {
    funcionario_id: string;
    nome: string;
    funcao: string | null;
    telefone: string | null;
    valor_dia: number;
    data_limite: string | null;       // ISO date OR null
    data_inicio_efetiva: string;      // v1.99.23: data efetivamente usada (apos override)
    data_fim_efetiva: string;         // v1.99.23: idem
    dias_em_aberto: number;
    bruto: number;
    vales: Array<{ id: number; valor: number; descricao: string | null; criado_em: string }>;
    total_vales: number;
    saldo_liquido: number;
  };
  const lista: SaldoFuncionario[] = [];

  for (const m of membros) {
    const membroId = Number(m.id);
    const valorDia = num((m.valor_dia as string) ?? '0');
    const limite = limitePorMembro.get(membroId) ?? new Date('1900-01-01');
    const limiteIso = limite.toISOString().slice(0, 10);

    // v1.99.23: data_inicio efetiva — usa override SE depois de data_limite,
    // senao mantem data_limite (nao deixa user "voltar" antes de recibo pago)
    const dataInicioEfetiva = (dataInicioOverride && dataInicioOverride > limiteIso)
      ? dataInicioOverride
      : limiteIso;
    const dataFimEfetiva = dataFimOverride || hoje.toISOString().slice(0, 10);

    // Dias em aberto entre dataInicioEfetiva (exclusivo) e dataFimEfetiva (inclusivo)
    const [diasRows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN periodo='integral' THEN 1 ELSE 0.5 END), 0) AS dias,
         COALESCE(SUM(valor), 0) AS bruto
         FROM romatec_obra_funcionario_dias
        WHERE funcionario_id = ?
          AND data > ?
          AND data <= ?`,
      [membroId, dataInicioEfetiva, dataFimEfetiva]
    );
    const diasEmAberto = Number(diasRows[0]?.dias ?? 0);
    const bruto = num(String(diasRows[0]?.bruto ?? '0'));

    // Vales em aberto (criados apos data_inicio_efetiva ate data_fim+1d)
    const [valesRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, valor, descricao, criado_em
         FROM recibos_ajustes
        WHERE membro_id = ?
          AND tipo = 'adiantamento'
          AND criado_em > ?
          AND criado_em <= DATE_ADD(?, INTERVAL 1 DAY)
        ORDER BY criado_em DESC`,
      [membroId, dataInicioEfetiva, dataFimEfetiva]
    );
    const vales = valesRows.map(v => ({
      id: Number(v.id),
      valor: num(String(v.valor)),
      descricao: (v.descricao as string | null) ?? null,
      criado_em: v.criado_em instanceof Date
        ? v.criado_em.toISOString()
        : String(v.criado_em),
    }));
    const totalVales = vales.reduce((s, v) => s + v.valor, 0);

    const saldoLiquido = bruto - totalVales;

    // Filtra: so aparece se tem dias em aberto OU vales (membros zerados nao aparecem)
    if (diasEmAberto === 0 && vales.length === 0) continue;

    lista.push({
      funcionario_id: String(membroId),
      nome: m.nome as string,
      funcao: (m.funcao as string | null) ?? null,
      telefone: (m.telefone as string | null) ?? null,
      valor_dia: valorDia,
      data_limite: limitePorMembro.has(membroId) ? limiteIso : null,
      data_inicio_efetiva: dataInicioEfetiva,  // v1.99.23
      data_fim_efetiva: dataFimEfetiva,        // v1.99.23
      dias_em_aberto: diasEmAberto,
      bruto,
      vales,
      total_vales: totalVales,
      saldo_liquido: saldoLiquido,
    });
  }

  const totalDias = lista.reduce((s, l) => s + l.dias_em_aberto, 0);
  const totalBruto = lista.reduce((s, l) => s + l.bruto, 0);
  const totalVales = lista.reduce((s, l) => s + l.total_vales, 0);
  const totalLiquido = totalBruto - totalVales;

  return {
    periodo_corrente: periodoCorrente,
    obra_id: input.obra_id ?? null,
    total_funcionarios: lista.length,
    total_dias: totalDias,
    total_bruto: totalBruto,
    total_vales: totalVales,
    total_liquido: totalLiquido,
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

// ── Parcelas de pagamento do cliente (v1.65.40) ──────────────────────────────
// Receita da Romatec por obra. Diferente dos recibos quinzenais (que sao
// pagamento dos trabalhadores). ZAYRA pode usar pra criar evento Calendar
// + lembrete de NF.

export async function listarParcelasObra(obraId: string) {
  // v3.12.0: inclui status_cobranca + cliente_resposta_*
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, obra_id, numero, valor, vencimento, prazo_dias,
            quinzena_inicio, quinzena_fim, pago, pago_em,
            observacoes, calendar_event_id, nf_numero, nf_emitida_em,
            status_cobranca, cobranca_enviada_em, cobranca_msg_id,
            cliente_resposta_em, cliente_resposta_texto,
            created_at, updated_at
       FROM romatec_obra_parcelas
      WHERE obra_id = ?
      ORDER BY numero ASC, vencimento ASC`,
    [obraId]
  );
  return rows.map((r: RowDataPacket) => ({
    id: String(r.id),
    obra_id: String(r.obra_id),
    numero: Number(r.numero),
    valor: num(r.valor),
    vencimento: r.vencimento ? formatBRDate(r.vencimento as Date) : null,
    vencimento_iso: r.vencimento ? new Date(r.vencimento as Date).toISOString().slice(0,10) : null,
    prazo_dias: r.prazo_dias != null ? Number(r.prazo_dias) : null,
    quinzena_inicio: r.quinzena_inicio ? new Date(r.quinzena_inicio as Date).toISOString().slice(0,10) : null,
    quinzena_fim:    r.quinzena_fim    ? new Date(r.quinzena_fim    as Date).toISOString().slice(0,10) : null,
    pago: !!r.pago,
    pago_em: r.pago_em as Date | null,
    observacoes: r.observacoes as string | null,
    calendar_event_id: r.calendar_event_id as string | null,
    nf_numero: r.nf_numero as string | null,
    nf_emitida_em: r.nf_emitida_em as Date | null,
    // v3.12.0
    status_cobranca: (r.status_cobranca as string | null) || 'pendente',
    cobranca_enviada_em: r.cobranca_enviada_em as Date | null,
    cobranca_msg_id: r.cobranca_msg_id as string | null,
    cliente_resposta_em: r.cliente_resposta_em as Date | null,
    cliente_resposta_texto: r.cliente_resposta_texto as string | null,
  }));
}

export async function criarParcela(input: {
  obra_id: string;
  numero?: number;
  valor: number;
  vencimento: string;       // YYYY-MM-DD
  prazo_dias?: number;
  observacoes?: string;
}): Promise<MutationResult> {
  if (!input.obra_id) throw new Error('obra_id obrigatorio');
  if (!input.valor || input.valor <= 0) throw new Error('valor invalido');
  if (!input.vencimento) throw new Error('vencimento obrigatorio');

  // Auto-numera se nao passou
  let numero = input.numero;
  if (!numero) {
    const [c] = await pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM romatec_obra_parcelas WHERE obra_id = ?`,
      [input.obra_id]
    );
    numero = Number((c[0] as { proximo: number }).proximo);
  }

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obra_parcelas
       (obra_id, numero, valor, vencimento, prazo_dias, observacoes)
     VALUES (?,?,?,?,?,?)`,
    [
      input.obra_id, numero, input.valor, input.vencimento,
      input.prazo_dias ?? null, input.observacoes ?? null,
    ]
  );
  emitParcela('created', input.obra_id, r.insertId);
  return { ok: true, insertId: r.insertId, affected: r.affectedRows, message: `Parcela ${numero} criada (id ${r.insertId}).` };
}

export async function atualizarParcela(input: {
  id: string;
  numero?: number; valor?: number; vencimento?: string;
  prazo_dias?: number; pago?: boolean; observacoes?: string;
  quinzena_inicio?: string; quinzena_fim?: string;
  calendar_event_id?: string; nf_numero?: string;
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatorio');
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  const map: Record<string, string> = {
    numero: 'numero', valor: 'valor', vencimento: 'vencimento',
    prazo_dias: 'prazo_dias', observacoes: 'observacoes',
    quinzena_inicio: 'quinzena_inicio', quinzena_fim: 'quinzena_fim',
    calendar_event_id: 'calendar_event_id', nf_numero: 'nf_numero',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (input as Record<string, unknown>)[k];
    if (v !== undefined) { fields.push(`${col} = ?`); params.push(v as string | number); }
  }
  if (input.pago !== undefined) {
    fields.push('pago = ?');
    params.push(input.pago ? 1 : 0);
    if (input.pago) {
      fields.push('pago_em = COALESCE(pago_em, NOW())');
    } else {
      fields.push('pago_em = NULL');
    }
  }
  if (fields.length === 0) throw new Error('Nenhum campo pra atualizar');
  params.push(input.id);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE romatec_obra_parcelas SET ${fields.join(', ')} WHERE id = ?`, params,
  );

  // v1.73.0: dispara trigger de recibo automatico se transicionou pra pago.
  // Async, fire-and-forget — falha nao bloqueia o UPDATE.
  if (input.pago === true) {
    void import('../services/recibosTriggers')
      .then(m => m.gerarReciboParcelaPaga(Number(input.id)))
      .catch(err => console.warn('[trigger parcela_paga]', (err as Error).message));
  }

  // SSE: notifica modal aberto pra refresh ao vivo. Busca obra_id da parcela.
  try {
    const [orow] = await pool.execute<RowDataPacket[]>(
      'SELECT obra_id FROM romatec_obra_parcelas WHERE id = ? LIMIT 1', [input.id]
    );
    const obraId = (orow[0] as { obra_id: number } | undefined)?.obra_id;
    if (obraId != null) {
      const kind: ParcelaEventKind =
        input.pago === true ? 'paid' : input.pago === false ? 'unpaid' : 'updated';
      emitParcela(kind, obraId, input.id);
    }
  } catch { /* nao bloqueia mutacao */ }

  return { ok: true, affected: r.affectedRows, message: `Parcela ${input.id} atualizada.` };
}

export async function apagarParcela(input: { id: string }): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatorio');
  // Pega obra_id antes do delete pra emitir evento SSE.
  const [orow] = await pool.execute<RowDataPacket[]>(
    'SELECT obra_id FROM romatec_obra_parcelas WHERE id = ? LIMIT 1', [input.id]
  );
  const obraId = (orow[0] as { obra_id: number } | undefined)?.obra_id;
  const [r] = await pool.execute<ResultSetHeader>(
    `DELETE FROM romatec_obra_parcelas WHERE id = ?`, [input.id]
  );
  if (obraId != null) emitParcela('deleted', obraId, input.id);
  return { ok: true, affected: r.affectedRows, message: `Parcela ${input.id} apagada.` };
}

// Auto-gera N parcelas quinzenais a partir da data_inicio da obra.
// Apaga as parcelas existentes (nao pagas) antes de criar — recriacao limpa.
export async function gerarParcelasAutomaticas(input: {
  obra_id: string;
  qtd_parcelas: number;
  valor_total: number;
  data_inicio: string;       // YYYY-MM-DD
  intervalo_dias?: number;   // default 14 (quinzenal)
  primeiro_vencimento_em?: number;  // default 14 dias apos data_inicio
}): Promise<{ ok: true; parcelas_criadas: number; valor_parcela: number }> {
  if (!input.obra_id) throw new Error('obra_id obrigatorio');
  if (!input.qtd_parcelas || input.qtd_parcelas < 1) throw new Error('qtd_parcelas deve ser >= 1');
  if (!input.valor_total || input.valor_total <= 0) throw new Error('valor_total invalido');
  if (!input.data_inicio) throw new Error('data_inicio obrigatoria');

  const intervalo = input.intervalo_dias ?? 14;
  const primeiroVenc = input.primeiro_vencimento_em ?? intervalo;
  const valorParcela = Math.round((input.valor_total / input.qtd_parcelas) * 100) / 100;

  // Apaga parcelas existentes nao pagas (preserva pagas)
  await pool.execute(
    `DELETE FROM romatec_obra_parcelas WHERE obra_id = ? AND pago = 0`,
    [input.obra_id]
  );

  // v1.65.41: calcula intervalo da quinzena pra cada parcela (editavel)
  const inicio = new Date(input.data_inicio + 'T00:00:00');
  for (let i = 0; i < input.qtd_parcelas; i++) {
    const qIni = new Date(inicio);
    qIni.setDate(qIni.getDate() + (i * intervalo));
    const qFim = new Date(qIni);
    qFim.setDate(qFim.getDate() + intervalo - 1);

    const venc = new Date(inicio);
    venc.setDate(venc.getDate() + primeiroVenc + (i * intervalo));
    const vencIso = venc.toISOString().slice(0, 10);
    const prazoDias = primeiroVenc + (i * intervalo);
    await pool.execute(
      `INSERT INTO romatec_obra_parcelas
         (obra_id, numero, valor, vencimento, prazo_dias, quinzena_inicio, quinzena_fim)
       VALUES (?,?,?,?,?,?,?)`,
      [input.obra_id, i + 1, valorParcela.toFixed(2), vencIso, prazoDias,
       qIni.toISOString().slice(0,10), qFim.toISOString().slice(0,10)]
    );
  }

  emitParcela('auto-gerado', input.obra_id);
  return { ok: true, parcelas_criadas: input.qtd_parcelas, valor_parcela: valorParcela };
}

// Retorna parcelas vencendo nos proximos N dias (default 7) — uso da ZAYRA
// pra lembrete proativo + criacao de evento Google Calendar.
export async function parcelasVencendo(diasAFrente = 7) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.id, p.obra_id, p.numero, p.valor, p.vencimento, p.pago,
            o.nome AS obra_nome, o.cliente, o.cliente_telefone
       FROM romatec_obra_parcelas p
       JOIN romatec_obras o ON o.id = p.obra_id
      WHERE p.pago = 0
        AND p.vencimento >= CURDATE()
        AND p.vencimento <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
      ORDER BY p.vencimento ASC`,
    [diasAFrente]
  );
  return rows.map((r: RowDataPacket) => ({
    id: String(r.id),
    obra_id: String(r.obra_id),
    obra_nome: String(r.obra_nome),
    cliente: r.cliente as string | null,
    cliente_telefone: r.cliente_telefone as string | null,
    numero: Number(r.numero),
    valor: num(r.valor),
    vencimento: formatBRDate(r.vencimento as Date),
    vencimento_iso: new Date(r.vencimento as Date).toISOString().slice(0,10),
  }));
}

// v1.67.17: envio de resumo da obra via Telegram Bot API (mesmo padrao
// de despesa/vistoria/proposta). Default: envia pro chat do CEO. Aceita
// chatId opcional pra enviar pra outras pessoas/grupos.
import { sendMessage as sendTelegramMessage } from './telegram';

export async function enviarObraTelegram(input: { id: string; chatId?: string }) {
  const det = await buscarObra(input.id);
  if (!det || !det.obra) throw new Error('Obra nao encontrada');
  const o = det.obra as Record<string, unknown>;

  // Busca parcelas pra incluir
  const [parcelasRows] = await pool.execute<RowDataPacket[]>(
    `SELECT numero, valor, vencimento, pago FROM romatec_obra_parcelas
      WHERE obra_id = ? ORDER BY numero ASC`, [Number(input.id)]
  );

  const fmtData = (s: unknown): string => {
    if (!s) return '-';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    if (s instanceof Date && !isNaN(s.getTime())) {
      return `${String(s.getDate()).padStart(2,'0')}/${String(s.getMonth()+1).padStart(2,'0')}/${s.getFullYear()}`;
    }
    return String(s);
  };
  const fmtBRL = (n: unknown) => 'R$ ' + Number(n||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const linhas: string[] = [
    `🏗️ *Obra: ${o.nome}*`,
    ``,
    `Olá, ${o.cliente || ''}! Segue o resumo da obra:`,
    ``,
    `📍 *Endereço:* ${o.endereco || '-'}, ${o.cidade || '-'}`,
    `📅 *Início:* ${fmtData(o.data_inicio)}`,
    `📅 *Conclusão prevista:* ${fmtData(o.data_previsao)}`,
  ];
  if (o.prazo_dias) linhas.push(`⏱️ *Prazo:* ${o.prazo_dias} dias corridos${o.prazo_dias_uteis ? ` (${o.prazo_dias_uteis} úteis)` : ''}`);
  if (o.valor_contrato) linhas.push(`💰 *Valor do contrato:* ${fmtBRL(o.valor_contrato)}`);

  if (parcelasRows.length > 0) {
    linhas.push('', '*💳 Parcelas:*');
    for (const p of parcelasRows) {
      const status = p.pago ? '✅ PAGO' : '⏳ Pendente';
      linhas.push(`• ${p.numero}ª — ${fmtBRL(p.valor)} — venc. ${fmtData(p.vencimento)} — ${status}`);
    }
  }
  linhas.push('', '_Romatec Consultoria Total_', 'Engenharia e Agrimensura');

  const chatId = input.chatId?.trim()
    || (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
    || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  if (!chatId) throw new Error('chatId Telegram obrigatorio (configure TELEGRAM_LEAD_CHAT_ID).');

  await sendTelegramMessage(chatId, linhas.join('\n'));
  return { ok: true as const, message: `Resumo da obra "${o.nome}" enviado via Telegram${input.chatId ? ` para chat ${chatId}` : ' (CEO)'}.` };
}
