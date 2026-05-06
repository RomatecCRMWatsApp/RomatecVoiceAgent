// v1.67.0: Despesas Extras — gastos avulsos por obra (fora do orcamento de empreita).
// Foto do cupom em LONGTEXT base64 (mesmo padrao dos anexos de Proposta).
// Soft delete via deleted_at. Soma valor_total no Consumo da obra (Financeiro).

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';

export type Categoria = 'ferramenta' | 'aluguel' | 'material' | 'outros';
export type FormaPagamento = 'pix' | 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'boleto';
const CATEGORIAS: Categoria[] = ['ferramenta', 'aluguel', 'material', 'outros'];
const FORMAS: FormaPagamento[] = ['pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'boleto'];
// v1.67.3: aceita PDF tambem (cupom em PDF e comum em ferragens/lojas online)
const MIMES_FOTO = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
const FOTO_MAX_BYTES = 8 * 1024 * 1024; // 8MB (PDF tende a ser maior que JPG)

export interface ItemInput { descricao: string; valor: number; quantidade?: number; ordem?: number }

export async function listarDespesasExtras(input: { obra_id?: string; from?: string; to?: string; limite?: number } = {}) {
  const limite = Math.min(Math.max(Number(input.limite) || 100, 1), 500);
  const params: (string | number)[] = [];
  let sql = `SELECT d.*, o.nome AS obra_nome
               FROM despesas_extras d
               LEFT JOIN romatec_obras o ON o.id = d.obra_id
              WHERE d.deleted_at IS NULL`;
  if (input.obra_id) { sql += ' AND d.obra_id = ?'; params.push(Number(input.obra_id)); }
  if (input.from)    { sql += ' AND d.data >= ?'; params.push(input.from); }
  if (input.to)      { sql += ' AND d.data <= ?'; params.push(input.to); }
  sql += ` ORDER BY d.data DESC, d.id DESC LIMIT ${limite}`;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  // Carrega itens em uma query
  const ids = rows.map(r => Number(r.id));
  const itensPorDespesa: Record<number, Array<{ id: number; descricao: string; valor: number; quantidade: number; ordem: number }>> = {};
  if (ids.length > 0) {
    const ph = ids.map(() => '?').join(',');
    const [itens] = await pool.execute<RowDataPacket[]>(
      `SELECT id, despesa_id, descricao, valor, quantidade, ordem FROM despesas_extras_itens
        WHERE despesa_id IN (${ph}) ORDER BY despesa_id, ordem`, ids
    );
    for (const it of itens) {
      const pid = Number(it.despesa_id);
      if (!itensPorDespesa[pid]) itensPorDespesa[pid] = [];
      itensPorDespesa[pid].push({
        id: Number(it.id), descricao: String(it.descricao),
        valor: Number(it.valor),
        quantidade: Number(it.quantidade ?? 1),
        ordem: Number(it.ordem),
      });
    }
  }
  return {
    total: rows.length,
    items: rows.map(r => ({
      id: String(r.id),
      obra_id: String(r.obra_id),
      obra_nome: r.obra_nome ?? null,
      data: r.data,
      loja: r.loja,
      categoria: r.categoria,
      forma_pagamento: r.forma_pagamento,
      tem_foto: !!r.foto_b64,
      foto_mimetype: r.foto_mimetype ?? null,
      observacoes: r.observacoes,
      desconto: Number(r.desconto || 0),
      valor_total: Number(r.valor_total),
      created_by: r.created_by,
      created_at: r.created_at,
      itens: itensPorDespesa[Number(r.id)] || [],
    })),
  };
}

export async function buscarDespesaExtra(id: string) {
  const idN = Number(id);
  if (!idN) throw new Error('id invalido');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT d.*, o.nome AS obra_nome
       FROM despesas_extras d LEFT JOIN romatec_obras o ON o.id = d.obra_id
      WHERE d.id = ? AND d.deleted_at IS NULL`, [idN]
  );
  if (rows.length === 0) throw new Error('Despesa nao encontrada');
  const r = rows[0];
  const [itens] = await pool.execute<RowDataPacket[]>(
    `SELECT id, descricao, valor, quantidade, ordem FROM despesas_extras_itens
      WHERE despesa_id = ? ORDER BY ordem`, [idN]
  );
  return {
    id: String(r.id),
    obra_id: String(r.obra_id),
    obra_nome: r.obra_nome ?? null,
    data: r.data,
    loja: r.loja,
    categoria: r.categoria,
    forma_pagamento: r.forma_pagamento,
    foto_b64: r.foto_b64 ?? null,
    foto_mimetype: r.foto_mimetype ?? null,
    tem_foto: !!r.foto_b64,
    observacoes: r.observacoes,
    desconto: Number(r.desconto || 0),
    valor_total: Number(r.valor_total),
    created_by: r.created_by,
    created_at: r.created_at,
    itens: (itens as RowDataPacket[]).map(it => ({
      id: Number(it.id), descricao: String(it.descricao),
      valor: Number(it.valor),
      quantidade: Number(it.quantidade ?? 1),
      ordem: Number(it.ordem),
    })),
  };
}

// v1.67.4: self-heal — em prod a migration ALTER TABLE pode nao ter rodado
// (boot anterior falhou silencioso, lock, etc). Se INSERT/UPDATE der "Unknown
// column 'desconto'" ou 'quantidade', roda ALTER inline e retenta.
let _schemaChecked = false;
async function ensureSchemaUpToDate(): Promise<void> {
  if (_schemaChecked) return;
  try {
    // Checa colunas existentes
    const [cols] = await pool.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('despesas_extras', 'despesas_extras_itens')`
    );
    const set = new Set(cols.map(c => String(c.COLUMN_NAME).toLowerCase()));
    if (!set.has('desconto')) {
      console.log('[despesas-self-heal] adicionando coluna desconto...');
      await pool.execute(
        `ALTER TABLE despesas_extras ADD COLUMN desconto DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER valor_total`
      ).catch(e => console.warn('[despesas-self-heal] alter desconto:', (e as Error).message));
    }
    if (!set.has('quantidade')) {
      console.log('[despesas-self-heal] adicionando coluna quantidade...');
      await pool.execute(
        `ALTER TABLE despesas_extras_itens ADD COLUMN quantidade DECIMAL(10,3) NOT NULL DEFAULT 1 AFTER valor`
      ).catch(e => console.warn('[despesas-self-heal] alter quantidade:', (e as Error).message));
    }
    _schemaChecked = true;
    console.log('[despesas-self-heal] schema OK');
  } catch (err) {
    console.warn('[despesas-self-heal] checagem falhou:', (err as Error).message);
  }
}

// v1.67.2: itens agora tem quantidade. Subtotal do item = qtd × valor unitario.
function validarItens(itens: ItemInput[]): number {
  if (!Array.isArray(itens) || itens.length === 0) throw new Error('Pelo menos 1 item obrigatorio');
  let total = 0;
  for (const it of itens) {
    if (!it.descricao || !String(it.descricao).trim()) throw new Error('Item sem descricao');
    const v = Number(it.valor);
    if (!Number.isFinite(v) || v <= 0) throw new Error(`Valor invalido para "${it.descricao}"`);
    const q = Number(it.quantidade);
    const qtd = (Number.isFinite(q) && q > 0) ? q : 1;
    total += v * qtd;
  }
  return Math.round(total * 100) / 100;
}

function validarFoto(foto_b64?: string | null, mimetype?: string | null): { b64: string | null; mime: string | null } {
  if (!foto_b64) return { b64: null, mime: null };
  if (!mimetype || !MIMES_FOTO.includes(mimetype)) {
    throw new Error(`Mimetype invalido: ${mimetype}. Aceito: jpg, png, webp, pdf.`);
  }
  const tamanho = Math.floor((foto_b64.length * 3) / 4);
  if (tamanho > FOTO_MAX_BYTES) {
    throw new Error(`Arquivo excede limite de 8MB (atual: ${(tamanho / 1024 / 1024).toFixed(1)}MB).`);
  }
  return { b64: foto_b64, mime: mimetype };
}

export async function criarDespesaExtra(input: {
  obra_id: string;
  data: string; // YYYY-MM-DD
  loja: string;
  categoria: Categoria;
  forma_pagamento: FormaPagamento;
  itens: ItemInput[];
  foto_b64?: string;
  foto_mimetype?: string;
  observacoes?: string;
  desconto?: number;
  created_by?: string;
  _retried?: boolean; // v1.67.4: previne loop infinito no self-heal
}) {
  // v1.67.4: garante schema atualizado (self-heal)
  await ensureSchemaUpToDate();
  const obraId = Number(input.obra_id);
  if (!obraId) throw new Error('obra_id obrigatorio');
  if (!input.data || !/^\d{4}-\d{2}-\d{2}$/.test(input.data)) throw new Error('Data invalida (use YYYY-MM-DD)');
  if (input.data > new Date().toISOString().slice(0, 10)) throw new Error('Data nao pode ser futura');
  if (!input.loja?.trim()) throw new Error('Loja obrigatoria');
  if (!CATEGORIAS.includes(input.categoria)) throw new Error('Categoria invalida');
  if (!FORMAS.includes(input.forma_pagamento)) throw new Error('Forma de pagamento invalida');
  const subtotal = validarItens(input.itens);
  const desconto = Math.max(0, Math.round(Number(input.desconto || 0) * 100) / 100);
  if (desconto > subtotal) throw new Error(`Desconto (R$ ${desconto.toFixed(2)}) nao pode ser maior que o subtotal (R$ ${subtotal.toFixed(2)})`);
  const valor_total = Math.round((subtotal - desconto) * 100) / 100;
  const foto = validarFoto(input.foto_b64, input.foto_mimetype);

  console.log(`[despesas] criar obra=${obraId} loja="${input.loja}" subtotal=${subtotal} desconto=${desconto} total=${valor_total} itens=${input.itens.length}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute<ResultSetHeader>(
      `INSERT INTO despesas_extras
         (obra_id, data, loja, categoria, forma_pagamento, foto_b64, foto_mimetype, observacoes, valor_total, desconto, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [obraId, input.data, input.loja.trim(), input.categoria, input.forma_pagamento,
       foto.b64, foto.mime, input.observacoes ?? null, valor_total, desconto, input.created_by ?? null]
    );
    const despesaId = r.insertId;
    for (let i = 0; i < input.itens.length; i++) {
      const it = input.itens[i];
      const qtd = Number(it.quantidade);
      const qtdFinal = (Number.isFinite(qtd) && qtd > 0) ? qtd : 1;
      await conn.execute(
        `INSERT INTO despesas_extras_itens (despesa_id, descricao, valor, quantidade, ordem) VALUES (?,?,?,?,?)`,
        [despesaId, String(it.descricao).trim().slice(0, 200), Number(it.valor), qtdFinal, it.ordem ?? i]
      );
    }
    await conn.commit();
    console.log(`[despesas] OK criada #${despesaId}`);
    return {
      ok: true as const, insertId: despesaId, valor_total, desconto,
      message: `Despesa #${despesaId} criada (R$ ${valor_total.toFixed(2)}${desconto > 0 ? ` com desconto de R$ ${desconto.toFixed(2)}` : ''}).`,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    conn.release();
    const msg = (err as Error).message;
    console.error('[despesas] FALHA criar:', msg);
    // Self-heal pra Unknown column: roda alter e retenta uma vez
    if (/Unknown column/i.test(msg) && !input._retried) {
      console.log('[despesas] tentando self-heal e retry...');
      _schemaChecked = false;
      await ensureSchemaUpToDate();
      return criarDespesaExtra({ ...input, _retried: true });
    }
    throw err;
  }
}

export async function atualizarDespesaExtra(input: {
  id: string;
  obra_id?: string;
  data?: string;
  loja?: string;
  categoria?: Categoria;
  forma_pagamento?: FormaPagamento;
  itens?: ItemInput[];
  foto_b64?: string | null;
  foto_mimetype?: string | null;
  observacoes?: string | null;
  desconto?: number;
}) {
  const id = Number(input.id);
  if (!id) throw new Error('id obrigatorio');
  const atual = await buscarDespesaExtra(input.id);

  const obra_id = input.obra_id ? Number(input.obra_id) : Number(atual.obra_id);
  const data    = input.data ?? atual.data;
  const loja    = input.loja ?? atual.loja;
  const categoria = input.categoria ?? atual.categoria;
  const forma_pagamento = input.forma_pagamento ?? atual.forma_pagamento;
  const observacoes = input.observacoes !== undefined ? input.observacoes : atual.observacoes;
  if (input.data && input.data > new Date().toISOString().slice(0, 10)) throw new Error('Data nao pode ser futura');
  if (input.categoria && !CATEGORIAS.includes(input.categoria)) throw new Error('Categoria invalida');
  if (input.forma_pagamento && !FORMAS.includes(input.forma_pagamento)) throw new Error('Forma de pagamento invalida');

  // Foto: undefined = mantem; null = remove; string = troca
  let foto_b64: string | null = atual.foto_b64;
  let foto_mime: string | null = atual.foto_mimetype;
  if (input.foto_b64 === null) { foto_b64 = null; foto_mime = null; }
  else if (input.foto_b64) {
    const f = validarFoto(input.foto_b64, input.foto_mimetype);
    foto_b64 = f.b64; foto_mime = f.mime;
  }

  const itens = input.itens ?? atual.itens.map(i => ({
    descricao: i.descricao, valor: i.valor, quantidade: i.quantidade, ordem: i.ordem
  }));
  const subtotal = validarItens(itens);
  const desconto = input.desconto !== undefined
    ? Math.max(0, Math.round(Number(input.desconto) * 100) / 100)
    : Number(atual.desconto || 0);
  if (desconto > subtotal) throw new Error(`Desconto (R$ ${desconto.toFixed(2)}) nao pode ser maior que o subtotal (R$ ${subtotal.toFixed(2)})`);
  const valor_total = Math.round((subtotal - desconto) * 100) / 100;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE despesas_extras SET
         obra_id = ?, data = ?, loja = ?, categoria = ?, forma_pagamento = ?,
         foto_b64 = ?, foto_mimetype = ?, observacoes = ?, valor_total = ?, desconto = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [obra_id, data, loja, categoria, forma_pagamento, foto_b64, foto_mime,
       observacoes, valor_total, desconto, id]
    );
    if (input.itens) {
      // Substitui itens
      await conn.execute(`DELETE FROM despesas_extras_itens WHERE despesa_id = ?`, [id]);
      for (let i = 0; i < input.itens.length; i++) {
        const it = input.itens[i];
        const qtd = Number(it.quantidade);
        const qtdFinal = (Number.isFinite(qtd) && qtd > 0) ? qtd : 1;
        await conn.execute(
          `INSERT INTO despesas_extras_itens (despesa_id, descricao, valor, quantidade, ordem) VALUES (?,?,?,?,?)`,
          [id, String(it.descricao).trim().slice(0, 200), Number(it.valor), qtdFinal, it.ordem ?? i]
        );
      }
    }
    await conn.commit();
    return { ok: true as const, valor_total, desconto, message: `Despesa #${id} atualizada.` };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function apagarDespesaExtra(input: { id: string }) {
  const id = Number(input.id);
  if (!id) throw new Error('id invalido');
  await pool.execute(
    `UPDATE despesas_extras SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`, [id]
  );
  return { ok: true as const, message: `Despesa #${id} removida (soft delete).` };
}

export async function resumoDespesasExtras(input: { obra_id?: string; from?: string; to?: string } = {}) {
  const params: (string | number)[] = [];
  let sql = `SELECT
               COUNT(*) AS qtd_notas,
               COALESCE(SUM(valor_total), 0) AS total,
               categoria,
               COUNT(*) AS qtd_categoria,
               COALESCE(SUM(valor_total), 0) AS total_categoria
             FROM despesas_extras
             WHERE deleted_at IS NULL`;
  if (input.obra_id) { sql += ' AND obra_id = ?'; params.push(Number(input.obra_id)); }
  if (input.from)    { sql += ' AND data >= ?'; params.push(input.from); }
  if (input.to)      { sql += ' AND data <= ?'; params.push(input.to); }
  sql += ' GROUP BY categoria';
  const [byCat] = await pool.execute<RowDataPacket[]>(sql, params);

  const por_categoria: Record<string, { qtd: number; total: number }> = {};
  let total = 0; let qtd_notas = 0;
  for (const r of byCat) {
    const c = String(r.categoria);
    const t = Number(r.total_categoria);
    const q = Number(r.qtd_categoria);
    por_categoria[c] = { qtd: q, total: t };
    total += t; qtd_notas += q;
  }
  return { qtd_notas, total: Math.round(total * 100) / 100, por_categoria };
}

// Helper pra integracao com Financeiro (somar no Consumo da obra)
export async function somaDespesasExtrasObra(obra_id: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(valor_total), 0) AS total
       FROM despesas_extras
      WHERE obra_id = ? AND deleted_at IS NULL`, [obra_id]
  );
  return Number(rows[0]?.total || 0);
}
