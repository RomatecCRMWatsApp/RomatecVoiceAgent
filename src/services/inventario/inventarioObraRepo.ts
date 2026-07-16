// v3.97.0 — Repositório do Inventário de Materiais por Obra.
//
// Regra central: saldo = quantidade_comprada - quantidade_utilizada (coluna
// GERADA no MySQL). A utilização roda em TRANSAÇÃO com SELECT ... FOR UPDATE:
// dois lançamentos simultâneos não furam o saldo — o segundo espera o lock e
// valida contra o saldo já abatido. Utilização é IMUTÁVEL (estorno fica pra v2).
// Padrão de transação espelha obrasEntregaRepo.criarDaProposta.

import pool from '../../database/connection';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// ── Tipos ────────────────────────────────────────────────────────────────────
export interface EtapaInventario {
  id: number; obra_id: number; titulo: string; descricao: string | null;
  ordem: number; status: 'planejada' | 'em_andamento' | 'concluida';
  disciplina_vto_ordem: number | null;
}

export interface ItemInventario {
  id: number; obra_id: number; etapa_id: number | null; nota_id: number | null;
  descricao: string; codigo_produto: string | null; unidade_medida: string;
  quantidade_comprada: number; valor_unitario: number | null; valor_total: number | null;
  quantidade_utilizada: number; quantidade_saldo: number;
  status_utilizacao: 'nao_utilizado' | 'parcial' | 'total';
  origem: 'nota_fiscal' | 'manual'; confianca_baixa: 0 | 1;
  observacoes: string | null;
}

export interface NovoItem {
  etapa_id?: number | null; nota_id?: number | null;
  descricao: string; codigo_produto?: string | null; unidade_medida?: string;
  quantidade_comprada: number; valor_unitario?: number | null; valor_total?: number | null;
  origem?: 'nota_fiscal' | 'manual'; confianca_baixa?: boolean;
  observacoes?: string | null;
}

const EPS = 0.0005; // tolerância de comparação p/ DECIMAL(12,3)

// exportado p/ sobraEntregaSync (ponte Entrega de Obra → inventário)
export function statusPorSaldo(comprada: number, utilizada: number): 'nao_utilizado' | 'parcial' | 'total' {
  if (utilizada <= EPS) return 'nao_utilizado';
  if (comprada - utilizada <= EPS) return 'total';
  return 'parcial';
}

// ── Etapas ───────────────────────────────────────────────────────────────────
export async function criarEtapa(obraId: number, input: {
  titulo: string; descricao?: string | null; ordem?: number;
  disciplina_vto_ordem?: number | null; colaborador_id?: string | null;
}): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO obra_inventario_etapas (obra_id, titulo, descricao, ordem, disciplina_vto_ordem, colaborador_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [obraId, input.titulo.trim(), input.descricao ?? null, input.ordem ?? 0,
     input.disciplina_vto_ordem ?? null, input.colaborador_id ?? null],
  );
  return r.insertId;
}

export async function atualizarEtapa(id: number, input: {
  titulo?: string; descricao?: string | null; ordem?: number;
  status?: 'planejada' | 'em_andamento' | 'concluida'; disciplina_vto_ordem?: number | null;
}): Promise<void> {
  const sets: string[] = []; const vals: Array<string | number | null> = [];
  if (input.titulo != null) { sets.push('titulo = ?'); vals.push(input.titulo.trim()); }
  if (input.descricao !== undefined) { sets.push('descricao = ?'); vals.push(input.descricao); }
  if (input.ordem != null) { sets.push('ordem = ?'); vals.push(input.ordem); }
  if (input.status != null) { sets.push('status = ?'); vals.push(input.status); }
  if (input.disciplina_vto_ordem !== undefined) { sets.push('disciplina_vto_ordem = ?'); vals.push(input.disciplina_vto_ordem); }
  if (!sets.length) return;
  vals.push(id);
  await pool.execute(`UPDATE obra_inventario_etapas SET ${sets.join(', ')} WHERE id = ?`, vals);
}

/** Etapas da obra com agregados (nº itens, % consumido, valores). */
export async function listarEtapas(obraId: number): Promise<Array<EtapaInventario & {
  itens_count: number; valor_comprado: number; valor_utilizado: number; valor_saldo: number; pct_utilizado: number;
}>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT e.id, e.obra_id, e.titulo, e.descricao, e.ordem, e.status, e.disciplina_vto_ordem,
            COUNT(i.id) AS itens_count,
            COALESCE(SUM(i.quantidade_comprada * COALESCE(i.valor_unitario, 0)), 0) AS valor_comprado,
            COALESCE(SUM(i.quantidade_utilizada * COALESCE(i.valor_unitario, 0)), 0) AS valor_utilizado,
            COALESCE(SUM(i.quantidade_saldo * COALESCE(i.valor_unitario, 0)), 0) AS valor_saldo,
            COALESCE(SUM(i.quantidade_comprada), 0) AS qt_comprada,
            COALESCE(SUM(i.quantidade_utilizada), 0) AS qt_utilizada
       FROM obra_inventario_etapas e
       LEFT JOIN obra_inventario_itens i ON i.etapa_id = e.id
      WHERE e.obra_id = ?
      GROUP BY e.id
      ORDER BY e.ordem, e.id`,
    [obraId],
  );
  return rows.map((r) => ({
    id: Number(r.id), obra_id: Number(r.obra_id), titulo: String(r.titulo),
    descricao: r.descricao != null ? String(r.descricao) : null,
    ordem: Number(r.ordem), status: r.status,
    disciplina_vto_ordem: r.disciplina_vto_ordem != null ? Number(r.disciplina_vto_ordem) : null,
    itens_count: Number(r.itens_count),
    valor_comprado: Number(r.valor_comprado), valor_utilizado: Number(r.valor_utilizado),
    valor_saldo: Number(r.valor_saldo),
    pct_utilizado: Number(r.qt_comprada) > 0
      ? Math.round((Number(r.qt_utilizada) / Number(r.qt_comprada)) * 100) : 0,
  }));
}

// ── Notas ────────────────────────────────────────────────────────────────────
export async function criarNota(obraId: number, input: {
  etapa_id?: number | null;
  arquivo_nome: string; arquivo_mime: string; arquivo_b64: string;
  arquivo_tipo: 'xml_nfe' | 'pdf_danfe' | 'imagem';
  colaborador_id?: string | null;
}): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO obra_inventario_notas
       (obra_id, etapa_id, arquivo_nome, arquivo_mime, arquivo_b64, arquivo_tipo, status_processamento, colaborador_id)
     VALUES (?, ?, ?, ?, ?, ?, 'processando', ?)`,
    [obraId, input.etapa_id ?? null, input.arquivo_nome, input.arquivo_mime,
     input.arquivo_b64, input.arquivo_tipo, input.colaborador_id ?? null],
  );
  return r.insertId;
}

export async function marcarNotaProcessada(notaId: number, input: {
  numero_nota?: string | null; chave_acesso?: string | null;
  fornecedor_nome?: string | null; fornecedor_cnpj?: string | null;
  data_emissao?: string | null; valor_total?: number | null;
  status: 'processado' | 'revisao_manual' | 'erro';
  erro?: string | null; confianca?: number | null;
}): Promise<void> {
  await pool.execute(
    `UPDATE obra_inventario_notas
        SET numero_nota = ?, chave_acesso = ?, fornecedor_nome = ?, fornecedor_cnpj = ?,
            data_emissao = ?, valor_total = ?, status_processamento = ?, erro_processamento = ?, confianca = ?
      WHERE id = ?`,
    [input.numero_nota ?? null, input.chave_acesso ?? null, input.fornecedor_nome ?? null,
     input.fornecedor_cnpj ?? null, input.data_emissao ?? null, input.valor_total ?? null,
     input.status, input.erro ?? null, input.confianca ?? null, notaId],
  );
}

export async function listarNotas(obraId: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, obra_id, etapa_id, numero_nota, chave_acesso, fornecedor_nome, fornecedor_cnpj,
            data_emissao, valor_total, arquivo_nome, arquivo_mime, arquivo_tipo,
            status_processamento, erro_processamento, confianca, criado_em
       FROM obra_inventario_notas WHERE obra_id = ? ORDER BY id DESC`,
    [obraId],
  );
  return rows;
}

export async function obterNota(notaId: number, comArquivo = false): Promise<(RowDataPacket & { itens: RowDataPacket[] }) | null> {
  const cols = comArquivo ? '*' : `id, obra_id, etapa_id, numero_nota, chave_acesso, fornecedor_nome,
    fornecedor_cnpj, data_emissao, valor_total, arquivo_nome, arquivo_mime, arquivo_tipo,
    status_processamento, erro_processamento, confianca, criado_em`;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${cols} FROM obra_inventario_notas WHERE id = ?`, [notaId],
  );
  if (!rows.length) return null;
  const [itens] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM obra_inventario_itens WHERE nota_id = ? ORDER BY id`, [notaId],
  );
  return Object.assign(rows[0], { itens }) as RowDataPacket & { itens: RowDataPacket[] };
}

// ── Itens ────────────────────────────────────────────────────────────────────
/** Insere N itens (bulk da nota ou 1 manual) numa transação. Retorna os ids. */
export async function criarItens(obraId: number, itens: NovoItem[], colaboradorId?: string | null): Promise<number[]> {
  if (!itens.length) return [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ids: number[] = [];
    for (const it of itens) {
      const qtd = Number(it.quantidade_comprada);
      if (!it.descricao?.trim() || !Number.isFinite(qtd) || qtd <= 0) {
        throw new Error(`Item invalido: descricao/quantidade obrigatorias (${it.descricao ?? 'sem descricao'})`);
      }
      const [r] = await conn.execute<ResultSetHeader>(
        `INSERT INTO obra_inventario_itens
           (obra_id, etapa_id, nota_id, descricao, codigo_produto, unidade_medida,
            quantidade_comprada, valor_unitario, valor_total, origem, confianca_baixa, observacoes, colaborador_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [obraId, it.etapa_id ?? null, it.nota_id ?? null, it.descricao.trim().slice(0, 300),
         it.codigo_produto ?? null, (it.unidade_medida || 'UN').toUpperCase().slice(0, 10),
         qtd, it.valor_unitario ?? null, it.valor_total ?? null,
         it.origem ?? 'manual', it.confianca_baixa ? 1 : 0, it.observacoes ?? null, colaboradorId ?? null],
      );
      ids.push(r.insertId);
    }
    await conn.commit();
    return ids;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

export async function listarItens(obraId: number, filtro: { etapa_id?: number; status?: string } = {}): Promise<ItemInventario[]> {
  let sql = `SELECT i.*,
      (SELECT COUNT(*) FROM obra_inventario_fotos f WHERE f.item_id = i.id) AS fotos_count
    FROM obra_inventario_itens i WHERE i.obra_id = ?`;
  const vals: Array<string | number | null> = [obraId];
  if (filtro.etapa_id != null) { sql += ' AND i.etapa_id = ?'; vals.push(filtro.etapa_id); }
  if (filtro.status) { sql += ' AND i.status_utilizacao = ?'; vals.push(filtro.status); }
  sql += ' ORDER BY i.id DESC';
  const [rows] = await pool.execute<RowDataPacket[]>(sql, vals);
  return rows as unknown as ItemInventario[];
}

export async function obterItem(itemId: number): Promise<ItemInventario | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM obra_inventario_itens WHERE id = ?`, [itemId],
  );
  return rows.length ? (rows[0] as unknown as ItemInventario) : null;
}

/** Move item de etapa (histórico de uso/fotos preservado — só muda o vínculo). */
export async function moverItemEtapa(itemId: number, etapaId: number | null): Promise<void> {
  await pool.execute(`UPDATE obra_inventario_itens SET etapa_id = ? WHERE id = ?`, [etapaId, itemId]);
}

/** Edita item MANUAL (regra: origem nota_fiscal não permite editar o comprado). */
export async function atualizarItemManual(itemId: number, input: {
  descricao?: string; codigo_produto?: string | null; unidade_medida?: string;
  quantidade_comprada?: number; valor_unitario?: number | null; observacoes?: string | null;
}): Promise<void> {
  const item = await obterItem(itemId);
  if (!item) throw new Error('Item nao encontrado');
  const mudaComprado = input.quantidade_comprada != null;
  if (mudaComprado && item.origem === 'nota_fiscal') {
    throw new Error('Item de nota fiscal: a quantidade comprada vem da nota e nao pode ser editada.');
  }
  if (mudaComprado && Number(input.quantidade_comprada) < Number(item.quantidade_utilizada) - EPS) {
    throw new Error(`Quantidade comprada (${input.quantidade_comprada}) nao pode ficar menor que a ja utilizada (${item.quantidade_utilizada}).`);
  }
  const sets: string[] = []; const vals: Array<string | number | null> = [];
  if (input.descricao != null) { sets.push('descricao = ?'); vals.push(input.descricao.trim().slice(0, 300)); }
  if (input.codigo_produto !== undefined) { sets.push('codigo_produto = ?'); vals.push(input.codigo_produto); }
  if (input.unidade_medida != null) { sets.push('unidade_medida = ?'); vals.push(input.unidade_medida.toUpperCase().slice(0, 10)); }
  if (mudaComprado) {
    sets.push('quantidade_comprada = ?'); vals.push(Number(input.quantidade_comprada));
    sets.push('status_utilizacao = ?'); vals.push(statusPorSaldo(Number(input.quantidade_comprada), Number(item.quantidade_utilizada)));
  }
  if (input.valor_unitario !== undefined) { sets.push('valor_unitario = ?'); vals.push(input.valor_unitario); }
  if (input.observacoes !== undefined) { sets.push('observacoes = ?'); vals.push(input.observacoes); }
  if (!sets.length) return;
  vals.push(itemId);
  await pool.execute(`UPDATE obra_inventario_itens SET ${sets.join(', ')} WHERE id = ?`, vals);
}

/**
 * Revisão de item extraído com baixa confiança (fluxo revisao_manual da nota).
 * Diferente do atualizarItemManual: permite corrigir quantidade mesmo em item de
 * nota fiscal (é a correção da EXTRAÇÃO, antes do uso), mas ainda protege contra
 * ficar abaixo do já utilizado. Zera confianca_baixa.
 */
export async function atualizarItemRevisao(itemId: number, notaId: number, input: {
  descricao?: string; codigo_produto?: string | null; unidade_medida?: string;
  quantidade_comprada?: number; valor_unitario?: number | null;
}): Promise<void> {
  const item = await obterItem(itemId);
  if (!item) throw new Error(`Item ${itemId} nao encontrado`);
  if (Number(item.nota_id) !== Number(notaId)) throw new Error(`Item ${itemId} nao pertence a nota ${notaId}`);
  if (input.quantidade_comprada != null &&
      Number(input.quantidade_comprada) < Number(item.quantidade_utilizada) - EPS) {
    throw new Error(`Quantidade comprada nao pode ficar menor que a ja utilizada (${item.quantidade_utilizada}).`);
  }
  const sets: string[] = ['confianca_baixa = 0'];
  const vals: Array<string | number | null> = [];
  if (input.descricao != null) { sets.push('descricao = ?'); vals.push(input.descricao.trim().slice(0, 300)); }
  if (input.codigo_produto !== undefined) { sets.push('codigo_produto = ?'); vals.push(input.codigo_produto); }
  if (input.unidade_medida != null) { sets.push('unidade_medida = ?'); vals.push(input.unidade_medida.toUpperCase().slice(0, 10)); }
  if (input.quantidade_comprada != null) {
    sets.push('quantidade_comprada = ?'); vals.push(Number(input.quantidade_comprada));
    sets.push('status_utilizacao = ?'); vals.push(statusPorSaldo(Number(input.quantidade_comprada), Number(item.quantidade_utilizada)));
  }
  if (input.valor_unitario !== undefined) { sets.push('valor_unitario = ?'); vals.push(input.valor_unitario); }
  vals.push(itemId);
  await pool.execute(`UPDATE obra_inventario_itens SET ${sets.join(', ')} WHERE id = ?`, vals);
}

/** Consolida a nota após revisão: itens deixam de ser baixa-confiança. */
export async function marcarNotaRevisada(notaId: number): Promise<void> {
  await pool.execute(`UPDATE obra_inventario_itens SET confianca_baixa = 0 WHERE nota_id = ?`, [notaId]);
  await pool.execute(
    `UPDATE obra_inventario_notas SET status_processamento = 'processado', erro_processamento = NULL WHERE id = ?`,
    [notaId],
  );
}

// ── Utilização (transação + FOR UPDATE — saldo NUNCA negativo) ───────────────
export class SaldoInsuficienteError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SaldoInsuficienteError'; }
}

export async function registrarUtilizacao(itemId: number, input: {
  tipo_utilizacao: 'total' | 'parcial';
  quantidade_utilizada?: number;
  data_utilizacao: string;              // YYYY-MM-DD
  etapa_execucao_id?: number | null;
  observacoes?: string | null;
  colaborador_id?: string | null;
}): Promise<{ utilizacao_id: number; quantidade: number; saldo_novo: number; status: string }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Trava a linha do item: lançamentos concorrentes esperam e validam o saldo real.
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT quantidade_comprada, quantidade_utilizada FROM obra_inventario_itens WHERE id = ? FOR UPDATE`,
      [itemId],
    );
    if (!rows.length) throw new Error('Item nao encontrado');
    const comprada = Number(rows[0].quantidade_comprada);
    const utilizadaAtual = Number(rows[0].quantidade_utilizada);
    const saldoAtual = comprada - utilizadaAtual;

    let qtd: number;
    if (input.tipo_utilizacao === 'total') {
      qtd = saldoAtual; // preenchimento automático — consome o que resta
      if (qtd <= EPS) throw new SaldoInsuficienteError('Item ja esta com saldo zerado.');
    } else {
      qtd = Number(input.quantidade_utilizada);
      if (!Number.isFinite(qtd) || qtd <= 0) {
        throw new Error('quantidade_utilizada deve ser um numero > 0 no lancamento parcial.');
      }
      if (qtd > saldoAtual + EPS) {
        throw new SaldoInsuficienteError(
          `Saldo insuficiente: disponivel ${saldoAtual.toFixed(3)}, solicitado ${qtd.toFixed(3)}.`,
        );
      }
    }

    const [r] = await conn.execute<ResultSetHeader>(
      `INSERT INTO obra_inventario_utilizacoes
         (item_id, tipo_utilizacao, quantidade_utilizada, data_utilizacao, etapa_execucao_id, observacoes, colaborador_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [itemId, input.tipo_utilizacao, qtd, input.data_utilizacao,
       input.etapa_execucao_id ?? null, input.observacoes ?? null, input.colaborador_id ?? null],
    );

    const novaUtilizada = utilizadaAtual + qtd;
    const novoStatus = statusPorSaldo(comprada, novaUtilizada);
    await conn.execute(
      `UPDATE obra_inventario_itens SET quantidade_utilizada = ?, status_utilizacao = ? WHERE id = ?`,
      [novaUtilizada, novoStatus, itemId],
    );

    await conn.commit();
    return { utilizacao_id: r.insertId, quantidade: qtd, saldo_novo: comprada - novaUtilizada, status: novoStatus };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

export async function listarUtilizacoes(itemId: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.*, e.titulo AS etapa_execucao_titulo
       FROM obra_inventario_utilizacoes u
       LEFT JOIN obra_inventario_etapas e ON e.id = u.etapa_execucao_id
      WHERE u.item_id = ? ORDER BY u.id DESC`,
    [itemId],
  );
  return rows;
}

// ── Fotos ────────────────────────────────────────────────────────────────────
export async function adicionarFoto(itemId: number, input: {
  utilizacao_id?: number | null;
  tipo_foto: 'entrega' | 'instalacao' | 'avaria' | 'outro';
  data_base64: string; mime?: string; legenda?: string | null;
  latitude?: number | null; longitude?: number | null;
  colaborador_id?: string | null;
}): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO obra_inventario_fotos
       (item_id, utilizacao_id, tipo_foto, data_base64, mime, legenda, latitude, longitude, colaborador_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [itemId, input.utilizacao_id ?? null, input.tipo_foto, input.data_base64,
     input.mime ?? 'image/jpeg', input.legenda ?? null,
     input.latitude ?? null, input.longitude ?? null, input.colaborador_id ?? null],
  );
  return r.insertId;
}

export async function listarFotos(itemId: number): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, item_id, utilizacao_id, tipo_foto, mime, legenda, latitude, longitude, criado_em
       FROM obra_inventario_fotos WHERE item_id = ? ORDER BY id`,
    [itemId],
  );
  return rows;
}

export async function obterFotoComB64(fotoId: number): Promise<RowDataPacket | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM obra_inventario_fotos WHERE id = ?`, [fotoId],
  );
  return rows.length ? rows[0] : null;
}

export async function apagarFoto(fotoId: number): Promise<void> {
  await pool.execute(`DELETE FROM obra_inventario_fotos WHERE id = ?`, [fotoId]);
}

// ── Cabeçalho / número do inventário (v3.100.0) ──────────────────────────────
/** INV-AAAA-NNNN (mesmo espírito do RE-AAAA-NNNN das entregas). Puro/testável. */
export function formatarNumeroInventario(id: number, ano: number): string {
  return `INV-${ano}-${String(id).padStart(4, '0')}`;
}

/**
 * Devolve o cabeçalho do inventário da obra, criando (com número automático)
 * na primeira abertura. 1 por obra (UNIQUE obra_id); corrida entre duas
 * requisições cai no ER_DUP_ENTRY e re-seleciona.
 */
export async function obterOuCriarCabecalho(obraId: number, colaboradorId?: string | null): Promise<{
  id: number; numero: string; criado_em: unknown;
}> {
  const sel = async () => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, numero, criado_em FROM obra_inventario_cabecalho WHERE obra_id = ?`, [obraId],
    );
    return rows.length ? { id: Number(rows[0].id), numero: String(rows[0].numero ?? ''), criado_em: rows[0].criado_em } : null;
  };
  const existente = await sel();
  if (existente) return existente;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute<ResultSetHeader>(
      `INSERT INTO obra_inventario_cabecalho (obra_id, colaborador_id) VALUES (?, ?)`,
      [obraId, colaboradorId ?? null],
    );
    const numero = formatarNumeroInventario(r.insertId, new Date().getFullYear());
    await conn.execute(`UPDATE obra_inventario_cabecalho SET numero = ? WHERE id = ?`, [numero, r.insertId]);
    await conn.commit();
    return { id: r.insertId, numero, criado_em: new Date() };
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    const e = err as { code?: string };
    if (e.code === 'ER_DUP_ENTRY') {
      const dup = await sel();
      if (dup) return dup;
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * v3.100.1 — Lista de TODOS os inventários criados (aba Inventário do painel):
 * número + obra + KPIs agregados, mais recente primeiro.
 */
export async function listarInventarios(): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT c.id, c.obra_id, c.numero, c.criado_em, o.nome AS obra_nome,
            COUNT(i.id) AS itens_count,
            COALESCE(SUM(i.quantidade_comprada * COALESCE(i.valor_unitario, 0)), 0) AS valor_comprado,
            COALESCE(SUM(i.quantidade_utilizada * COALESCE(i.valor_unitario, 0)), 0) AS valor_utilizado,
            COALESCE(SUM(i.quantidade_saldo * COALESCE(i.valor_unitario, 0)), 0) AS valor_saldo,
            COALESCE(SUM(i.quantidade_comprada), 0) AS qt_c,
            COALESCE(SUM(i.quantidade_utilizada), 0) AS qt_u,
            (SELECT COUNT(*) FROM obra_inventario_notas n WHERE n.obra_id = c.obra_id) AS notas_count
       FROM obra_inventario_cabecalho c
       LEFT JOIN romatec_obras o ON o.id = c.obra_id
       LEFT JOIN obra_inventario_itens i ON i.obra_id = c.obra_id
      GROUP BY c.id, c.obra_id, c.numero, c.criado_em, o.nome
      ORDER BY c.id DESC`,
  );
  return rows.map((r) => Object.assign(r, {
    pct_utilizado: Number(r.qt_c) > 0 ? Math.round((Number(r.qt_u) / Number(r.qt_c)) * 100) : 0,
  }));
}

/** Notas COM o arquivo original (base64) — pros anexos enumerados do relatório. */
export async function listarNotasComArquivo(obraId: number, etapaId?: number): Promise<RowDataPacket[]> {
  let sql = `SELECT id, etapa_id, numero_nota, chave_acesso, fornecedor_nome, fornecedor_cnpj,
                    data_emissao, valor_total, arquivo_nome, arquivo_mime, arquivo_b64, arquivo_tipo,
                    status_processamento, criado_em
               FROM obra_inventario_notas WHERE obra_id = ?`;
  const vals: Array<string | number> = [obraId];
  if (etapaId != null) { sql += ' AND etapa_id = ?'; vals.push(etapaId); }
  sql += ' ORDER BY id'; // ordem de inserção = ordem dos anexos
  const [rows] = await pool.execute<RowDataPacket[]>(sql, vals);
  return rows;
}

// ── Resumo / dados do relatório ──────────────────────────────────────────────
export async function resumoObra(obraId: number): Promise<{
  itens_count: number; valor_comprado: number; valor_utilizado: number; valor_saldo: number; pct_utilizado: number;
}> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(id) AS itens_count,
            COALESCE(SUM(quantidade_comprada * COALESCE(valor_unitario, 0)), 0) AS valor_comprado,
            COALESCE(SUM(quantidade_utilizada * COALESCE(valor_unitario, 0)), 0) AS valor_utilizado,
            COALESCE(SUM(quantidade_saldo * COALESCE(valor_unitario, 0)), 0) AS valor_saldo,
            COALESCE(SUM(quantidade_comprada), 0) AS qt_c, COALESCE(SUM(quantidade_utilizada), 0) AS qt_u
       FROM obra_inventario_itens WHERE obra_id = ?`,
    [obraId],
  );
  const r = rows[0];
  return {
    itens_count: Number(r.itens_count),
    valor_comprado: Number(r.valor_comprado), valor_utilizado: Number(r.valor_utilizado),
    valor_saldo: Number(r.valor_saldo),
    pct_utilizado: Number(r.qt_c) > 0 ? Math.round((Number(r.qt_u) / Number(r.qt_c)) * 100) : 0,
  };
}

/** Estado COMPLETO pro relatório (sem cache — prestação de contas formal). */
export async function dadosRelatorio(obraId: number, etapaId?: number): Promise<{
  obra: RowDataPacket | null;
  numero_inventario: string;
  etapas: Array<RowDataPacket & { itens: Array<RowDataPacket & { fotos: RowDataPacket[] }> }>;
  sem_etapa: Array<RowDataPacket & { fotos: RowDataPacket[] }>;
  resumo: Awaited<ReturnType<typeof resumoObra>>;
  notas: RowDataPacket[];
}> {
  const [obraRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, nome, cliente, endereco, cidade, responsavel_tecnico FROM romatec_obras WHERE id = ?`,
    [obraId],
  );
  const etapas = await listarEtapas(obraId);
  const etapasFiltradas = etapaId != null ? etapas.filter((e) => e.id === etapaId) : etapas;

  const itens = await listarItens(obraId, etapaId != null ? { etapa_id: etapaId } : {});
  const fotosPorItem = new Map<number, RowDataPacket[]>();
  for (const it of itens) {
    const [fotos] = await pool.execute<RowDataPacket[]>(
      `SELECT id, tipo_foto, mime, legenda, criado_em, data_base64
         FROM obra_inventario_fotos WHERE item_id = ? ORDER BY tipo_foto, id LIMIT 8`,
      [(it as unknown as { id: number }).id],
    );
    fotosPorItem.set((it as unknown as { id: number }).id, fotos);
  }
  const anexaFotos = (arr: unknown[]): Array<RowDataPacket & { fotos: RowDataPacket[] }> =>
    (arr as Array<RowDataPacket & { id: number }>).map((i) =>
      Object.assign(i, { fotos: fotosPorItem.get(i.id) ?? [] }));

  const porEtapa = etapasFiltradas.map((e) => Object.assign(e as unknown as RowDataPacket, {
    itens: anexaFotos(itens.filter((i) => i.etapa_id === e.id)),
  })) as Array<RowDataPacket & { itens: Array<RowDataPacket & { fotos: RowDataPacket[] }> }>;

  const semEtapa = etapaId != null ? [] : anexaFotos(itens.filter((i) => i.etapa_id == null));

  // v3.100.0: número do inventário + notas fiscais (anexos enumerados do PDF).
  const cabecalho = await obterOuCriarCabecalho(obraId);
  const notas = await listarNotasComArquivo(obraId, etapaId);

  return {
    obra: obraRows[0] ?? null,
    numero_inventario: cabecalho.numero,
    etapas: porEtapa,
    sem_etapa: semEtapa,
    resumo: await resumoObra(obraId),
    notas,
  };
}
