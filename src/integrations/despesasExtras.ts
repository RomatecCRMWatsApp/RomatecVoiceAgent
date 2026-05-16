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
      destinatario: r.destinatario ?? null,
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
    destinatario: r.destinatario ?? null,
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
    let allOk = true;
    const tryAlter = async (label: string, sql: string) => {
      console.log(`[despesas-self-heal] adicionando coluna ${label}...`);
      try { await pool.execute(sql); console.log(`[despesas-self-heal] OK: ${label}`); }
      catch (e) {
        const msg = (e as Error).message || '';
        if (/Duplicate column|already exists/i.test(msg)) return; // ja existe, ok
        console.error(`[despesas-self-heal] FALHA alter ${label}:`, msg);
        allOk = false;
      }
    };
    if (!set.has('desconto'))      await tryAlter('desconto',     `ALTER TABLE despesas_extras ADD COLUMN desconto DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER valor_total`);
    if (!set.has('quantidade'))    await tryAlter('quantidade',   `ALTER TABLE despesas_extras_itens ADD COLUMN quantidade DECIMAL(10,3) NOT NULL DEFAULT 1 AFTER valor`);
    if (!set.has('destinatario')) await tryAlter('destinatario', `ALTER TABLE despesas_extras ADD COLUMN destinatario VARCHAR(120) NULL AFTER loja`);
    if (allOk) { _schemaChecked = true; console.log('[despesas-self-heal] schema OK'); }
    else { console.warn('[despesas-self-heal] alguns ALTERs falharam — vai retentar na proxima chamada'); }
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
  destinatario?: string | null;
  categoria: Categoria;
  forma_pagamento: FormaPagamento;
  itens: ItemInput[];
  foto_b64?: string;
  foto_mimetype?: string;
  observacoes?: string;
  desconto?: number;
  created_by?: string;
  uuid_local?: string;
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
    const destinatario = input.destinatario?.trim()?.slice(0, 120) || null;
    const [r] = await conn.execute<ResultSetHeader>(
      `INSERT INTO despesas_extras
         (obra_id, data, loja, destinatario, categoria, forma_pagamento, foto_b64, foto_mimetype, observacoes, valor_total, desconto, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [obraId, input.data, input.loja.trim(), destinatario, input.categoria, input.forma_pagamento,
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

    // v1.80.0: trigger automatico — notifica CEO via Telegram se config ligada
    void import('../services/recibosTriggers')
      .then(m => m.notificarDespesaCriada(despesaId))
      .catch(err => console.warn('[trigger despesa_criada]', (err as Error).message));

    return {
      ok: true as const, insertId: despesaId, valor_total, desconto,
      uuid_local: input.uuid_local,
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
  destinatario?: string | null;
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
  const destinatario = input.destinatario !== undefined
    ? (input.destinatario?.toString().trim().slice(0, 120) || null)
    : (atual.destinatario ?? null);
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
         obra_id = ?, data = ?, loja = ?, destinatario = ?, categoria = ?, forma_pagamento = ?,
         foto_b64 = ?, foto_mimetype = ?, observacoes = ?, valor_total = ?, desconto = ?
       WHERE id = ? AND deleted_at IS NULL`,
      [obra_id, data, loja, destinatario, categoria, forma_pagamento, foto_b64, foto_mime,
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

// ── v1.67.10: PDF individual + consolidado + envio WhatsApp/Telegram ──
import PDFDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import path from 'path';
import fs from 'fs';
import { sendDocument as sendWhatsAppDocument } from './whatsapp';
import { sendDocument as sendTelegramDocument } from './telegram';
import { getTenantSettings } from '../services/tenantSettings';

const FORMA_LABEL: Record<string, string> = {
  pix: 'PIX', dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de Crédito', cartao_debito: 'Cartão de Débito', boleto: 'Boleto',
};
const CAT_LABEL: Record<string, string> = {
  ferramenta: 'Ferramenta', aluguel: 'Aluguel', material: 'Material', outros: 'Outros',
};
const fmtBRL = (n: number) => 'R$ ' + Number(n||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (d: Date | string): string => {
  if (!d) return '-';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
};

// Renderiza UMA despesa em um PDFKit document. Retorna apos terminar
// (sem fechar o doc — pra suportar relatorio consolidado).
function renderDespesaNaPagina(doc: PDFKit.PDFDocument, d: Awaited<ReturnType<typeof buscarDespesaExtra>>, corHex: string) {
  doc.fontSize(12).fillColor(corHex).font('Helvetica-Bold')
     .text(`Despesa #${String(d.id).padStart(3, '0')} — ${d.loja}`);
  doc.font('Helvetica').fontSize(10).fillColor('#444');
  doc.text(`Obra: ${d.obra_nome || '-'}`);
  if (d.destinatario) doc.text(`Destinatário: ${d.destinatario}`);
  doc.text(`Data: ${fmtData(d.data)} · ${CAT_LABEL[String(d.categoria)] || d.categoria} · ${FORMA_LABEL[String(d.forma_pagamento)] || d.forma_pagamento}`);
  doc.moveDown(0.4);

  // Tabela de itens
  doc.fontSize(10).fillColor('#111').font('Helvetica-Bold');
  const colX = { idx: 48, desc: 75, qtd: 380, vu: 430, sub: 495 };
  const colW = { idx: 22, desc: 300, qtd: 45, vu: 60, sub: 55 };
  const yH = doc.y;
  doc.text('#', colX.idx, yH, { width: colW.idx });
  doc.text('Descrição', colX.desc, yH, { width: colW.desc });
  doc.text('Qtd', colX.qtd, yH, { width: colW.qtd, align: 'right' });
  doc.text('V.Unit', colX.vu, yH, { width: colW.vu, align: 'right' });
  doc.text('Subtotal', colX.sub, yH, { width: colW.sub, align: 'right' });
  doc.font('Helvetica');
  let cursorY = doc.y + 4;
  doc.moveTo(48, cursorY).lineTo(547, cursorY).strokeColor('#888').lineWidth(0.5).stroke();
  cursorY += 4;

  doc.fontSize(9).fillColor('#111');
  for (let i = 0; i < d.itens.length; i++) {
    const it = d.itens[i];
    const qtd = Number(it.quantidade || 1);
    const subtotal = Number(it.valor) * qtd;
    const hDesc = doc.heightOfString(it.descricao, { width: colW.desc });
    const lineH = Math.max(hDesc, 12);
    if (cursorY + lineH > 760) { doc.addPage(); cursorY = 60; }
    doc.text(String(i + 1), colX.idx, cursorY, { width: colW.idx });
    doc.text(it.descricao, colX.desc, cursorY, { width: colW.desc });
    doc.text(qtd.toLocaleString('pt-BR'), colX.qtd, cursorY, { width: colW.qtd, align: 'right' });
    doc.text(fmtBRL(it.valor).replace('R$ ', ''), colX.vu, cursorY, { width: colW.vu, align: 'right' });
    doc.text(fmtBRL(subtotal).replace('R$ ', ''), colX.sub, cursorY, { width: colW.sub, align: 'right' });
    cursorY += lineH + 4;
  }

  doc.moveTo(48, cursorY).lineTo(547, cursorY).strokeColor('#ccc').lineWidth(0.5).stroke();
  cursorY += 6;

  // Subtotal/Desconto/Total
  const subtotal = d.itens.reduce((s, i) => s + (Number(i.valor) * Number(i.quantidade || 1)), 0);
  const desconto = Number(d.desconto || 0);
  doc.fontSize(9).fillColor('#444')
     .text(`Subtotal: ${fmtBRL(subtotal)}`, 48, cursorY, { width: 499, align: 'right' });
  cursorY += 12;
  if (desconto > 0) {
    doc.fillColor('#dc2626').text(`Desconto: − ${fmtBRL(desconto)}`, 48, cursorY, { width: 499, align: 'right' });
    cursorY += 12;
  }
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold')
     .text(`TOTAL: ${fmtBRL(d.valor_total)}`, 48, cursorY, { width: 499, align: 'right' });
  doc.font('Helvetica');
  cursorY += 18;

  if (d.observacoes) {
    doc.fontSize(9).fillColor('#666').text(`Obs: ${d.observacoes}`, 48, cursorY, { width: 499 });
    cursorY += 14;
  }
  doc.x = 48; doc.y = cursorY;
}

// PDF individual de UMA despesa + anexo do cupom mergeado
export async function gerarPdfDespesaExtra(id: string): Promise<Buffer> {
  const d = await buscarDespesaExtra(id);
  const t = await getTenantSettings(1).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliaria';
  const corHex = t?.primary_color || '#10b981';
  const logoFile = path.join(__dirname, '..', 'public', 'romatec-logo-removebg-preview.png');

  const doc = new PDFDocument({ size: 'A4', margin: 48, info: {
    Title: `Despesa #${d.id} - ${d.loja}`, Author: brand,
  }});
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // Header
  if (fs.existsSync(logoFile)) {
    try { doc.image(logoFile, { fit: [120, 60], align: 'center' }); } catch { /* opcional */ }
  } else {
    doc.fontSize(16).fillColor(corHex).text(brand, { align: 'center' });
  }
  doc.moveDown(0.3);
  doc.strokeColor(corHex).lineWidth(2).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.5);
  doc.fontSize(15).fillColor('#111').text('NOTA DE DESPESA EXTRA', { align: 'center' });
  doc.moveDown(0.6);

  renderDespesaNaPagina(doc, d, corHex);

  doc.fontSize(8).fillColor('#888').text(
    `${brand} — Documento gerado em ${new Date().toLocaleString('pt-BR')}.`,
    48, 800, { width: 499, align: 'center' }
  );
  doc.end();
  await new Promise<void>(r => doc.on('end', () => r()));

  const principal = Buffer.concat(chunks);

  // Mergeia anexo do cupom (se houver)
  if (!d.foto_b64 || !d.foto_mimetype) return principal;
  return mergePrincipalComAnexo(principal, d.foto_b64, d.foto_mimetype, `Cupom #${d.id} — ${d.loja}`);
}

// PDF consolidado de varias despesas + anexos
export async function gerarPdfRelatorioDespesas(ids: string[], opts?: { obra_nome?: string }): Promise<Buffer> {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Pelo menos 1 id obrigatorio');
  const despesas = await Promise.all(ids.map(id => buscarDespesaExtra(id)));
  const t = await getTenantSettings(1).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliaria';
  const corHex = t?.primary_color || '#10b981';
  const logoFile = path.join(__dirname, '..', 'public', 'romatec-logo-removebg-preview.png');

  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
    Title: `Relatorio Despesas Extras (${ids.length} notas)`, Author: brand,
  }});
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // Capa
  if (fs.existsSync(logoFile)) {
    try { doc.image(logoFile, { fit: [120, 60], align: 'center' }); } catch { /* opt */ }
  }
  doc.moveDown(0.3);
  doc.strokeColor(corHex).lineWidth(2).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.5);
  doc.fontSize(18).fillColor('#111').font('Helvetica-Bold')
     .text('RELATÓRIO DE DESPESAS EXTRAS', { align: 'center' });
  doc.font('Helvetica').fontSize(11).fillColor('#444')
     .text(`${despesas.length} nota(s) consolidada(s) — gerado em ${new Date().toLocaleString('pt-BR')}`, { align: 'center' });
  if (opts?.obra_nome) doc.text(`Obra: ${opts.obra_nome}`, { align: 'center' });
  doc.moveDown(0.8);

  // Resumo: tabela com #, loja, data, total, desconto
  const totalGeral = despesas.reduce((s, d) => s + Number(d.valor_total || 0), 0);
  const descontoGeral = despesas.reduce((s, d) => s + Number(d.desconto || 0), 0);

  doc.fontSize(11).fillColor(corHex).text('Resumo das Notas');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);

  doc.fontSize(9).fillColor('#444').font('Helvetica-Bold');
  let cy = doc.y;
  // Colunas: # (28) | Loja (165) | Destinatário (95) | Data (55) | Categoria (65) | Total (89)
  // lineBreak:false + ellipsis evitam que texto longo quebre linha e sobreponha o proximo row
  const cellOpts = { lineBreak: false as const, ellipsis: true as const };
  doc.text('#', 48, cy, { width: 28, ...cellOpts });
  doc.text('Loja', 76, cy, { width: 165, ...cellOpts });
  doc.text('Destinatário', 241, cy, { width: 95, ...cellOpts });
  doc.text('Data', 336, cy, { width: 55, ...cellOpts });
  doc.text('Categoria', 391, cy, { width: 65, ...cellOpts });
  doc.text('Total', 456, cy, { width: 91, align: 'right', ...cellOpts });
  doc.font('Helvetica');
  cy = doc.y + 4;
  doc.moveTo(48, cy).lineTo(547, cy).strokeColor('#888').lineWidth(0.5).stroke();
  cy += 4;
  doc.fontSize(9).fillColor('#111');
  for (const d of despesas) {
    if (cy > 730) { doc.addPage(); cy = 60; }
    doc.text(`#${String(d.id).padStart(3,'0')}`, 48, cy, { width: 28, ...cellOpts });
    doc.text(d.loja, 76, cy, { width: 165, ...cellOpts });
    doc.text(d.destinatario || '-', 241, cy, { width: 95, ...cellOpts });
    doc.text(fmtData(d.data), 336, cy, { width: 55, ...cellOpts });
    doc.text(CAT_LABEL[String(d.categoria)] || String(d.categoria), 391, cy, { width: 65, ...cellOpts });
    doc.text(fmtBRL(d.valor_total), 456, cy, { width: 91, align: 'right', ...cellOpts });
    cy += 14;
  }
  doc.moveTo(48, cy).lineTo(547, cy).strokeColor(corHex).lineWidth(1).stroke();
  cy += 6;
  if (descontoGeral > 0) {
    doc.fontSize(9).fillColor('#dc2626')
       .text(`Total descontos: − ${fmtBRL(descontoGeral)}`, 48, cy, { width: 499, align: 'right' });
    cy += 12;
  }
  doc.fontSize(13).fillColor(corHex).font('Helvetica-Bold')
     .text(`TOTAL CONSOLIDADO: ${fmtBRL(totalGeral)}`, 48, cy, { width: 499, align: 'right' });
  doc.font('Helvetica');

  // Detalhes de cada despesa em pagina propria
  for (const d of despesas) {
    doc.addPage();
    doc.fontSize(8).fillColor('#888').text(`Nota ${despesas.indexOf(d) + 1}/${despesas.length}`, 48, 30);
    doc.moveDown(0.5);
    renderDespesaNaPagina(doc, d, corHex);
  }

  // Footer: escreve em CADA pagina ja existente (sem criar pagina nova vazia).
  // bufferPages: true permite iterar e voltar com switchToPage.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fontSize(8).fillColor('#888').text(
      `${brand} — Relatório consolidado · Pág. ${i + 1}/${range.count}`,
      48, 815, { width: 499, align: 'center', lineBreak: false }
    );
  }
  doc.flushPages();
  doc.end();
  await new Promise<void>(r => doc.on('end', () => r()));
  let principal: Buffer = Buffer.concat(chunks);

  // Mergeia todos os anexos (cupons) sequencialmente
  for (const d of despesas) {
    if (d.foto_b64 && d.foto_mimetype) {
      const merged = await mergePrincipalComAnexo(
        principal, d.foto_b64, d.foto_mimetype, `Cupom #${d.id} — ${d.loja}`
      );
      principal = merged as Buffer;
    }
  }
  return principal;
}

// Mergeia 1 anexo (PDF ou imagem) ao final de um PDF principal
async function mergePrincipalComAnexo(principalBuf: Buffer, anexoB64: string, mimetype: string, legenda: string): Promise<Buffer> {
  try {
    const merged = await PDFLibDocument.create();
    const principalDoc = await PDFLibDocument.load(principalBuf);
    const principalPages = await merged.copyPages(principalDoc, principalDoc.getPageIndices());
    principalPages.forEach(p => merged.addPage(p));

    const anexoBuf = Buffer.from(anexoB64, 'base64');
    if (mimetype === 'application/pdf') {
      const anexoDoc = await PDFLibDocument.load(anexoBuf);
      const anexoPages = await merged.copyPages(anexoDoc, anexoDoc.getPageIndices());
      anexoPages.forEach(p => merged.addPage(p));
    } else if (mimetype.startsWith('image/')) {
      const img = mimetype === 'image/png'
        ? await merged.embedPng(anexoBuf)
        : await merged.embedJpg(anexoBuf);
      const A4_W = 595.28, A4_H = 841.89, M = 30;
      const maxW = A4_W - 2 * M, maxH = A4_H - 2 * M - 30;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale, h = img.height * scale;
      const page = merged.addPage([A4_W, A4_H]);
      page.drawImage(img, { x: (A4_W - w) / 2, y: (A4_H - h) / 2 - 15, width: w, height: h });
      page.drawText(legenda, { x: M, y: 20, size: 9 });
    }
    const out = await merged.save();
    return Buffer.from(out);
  } catch (err) {
    console.warn(`[despesas-merge] falha ao mergear anexo: ${(err as Error).message}`);
    return principalBuf;
  }
}

export async function enviarDespesaWhatsApp(input: { id: string; telefone?: string }) {
  if (!input.telefone?.trim()) throw new Error('Telefone obrigatorio.');
  const d = await buscarDespesaExtra(input.id);
  const pdfBuf = await gerarPdfDespesaExtra(input.id);
  const fileName = `Despesa_${String(d.id).padStart(3,'0')}_${d.loja.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.pdf`;
  const r = await sendWhatsAppDocument(input.telefone.trim(), pdfBuf.toString('base64'), fileName);
  return { ok: true as const, message: `Despesa #${d.id} enviada para ${r.phone}.`, messageId: r.messageId, phone: r.phone };
}

export async function enviarDespesaTelegram(input: { id: string; chatId?: string }) {
  const d = await buscarDespesaExtra(input.id);
  const chatId = input.chatId
    || (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
    || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  if (!chatId) throw new Error('chatId Telegram obrigatorio.');
  const pdfBuf = await gerarPdfDespesaExtra(input.id);
  if (pdfBuf.length > 50 * 1024 * 1024) throw new Error(`PDF tem ${(pdfBuf.length/1024/1024).toFixed(1)}MB e Telegram aceita ate 50MB.`);
  const fileName = `Despesa_${String(d.id).padStart(3,'0')}_${d.loja.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.pdf`;
  await sendTelegramDocument(chatId, pdfBuf, fileName, `Despesa #${d.id} — ${d.loja}`);
  return { ok: true as const, message: `Despesa #${d.id} enviada via Telegram (${(pdfBuf.length/1024).toFixed(0)} KB).` };
}

export async function enviarRelatorioDespesasWhatsApp(input: { ids: string[]; telefone?: string; obra_nome?: string }) {
  if (!input.telefone?.trim()) throw new Error('Telefone obrigatorio.');
  if (!input.ids?.length) throw new Error('Pelo menos 1 despesa obrigatoria.');
  const pdfBuf = await gerarPdfRelatorioDespesas(input.ids, { obra_nome: input.obra_nome });
  const fileName = `Relatorio_Despesas_${input.ids.length}_notas.pdf`;
  const r = await sendWhatsAppDocument(input.telefone.trim(), pdfBuf.toString('base64'), fileName);
  return { ok: true as const, message: `Relatório com ${input.ids.length} despesas enviado para ${r.phone}.`, messageId: r.messageId };
}

export async function enviarRelatorioDespesasTelegram(input: { ids: string[]; chatId?: string; obra_nome?: string }) {
  const chatId = input.chatId
    || (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
    || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  if (!chatId) throw new Error('chatId Telegram obrigatorio.');
  if (!input.ids?.length) throw new Error('Pelo menos 1 despesa obrigatoria.');
  const pdfBuf = await gerarPdfRelatorioDespesas(input.ids, { obra_nome: input.obra_nome });
  if (pdfBuf.length > 50 * 1024 * 1024) throw new Error(`PDF tem ${(pdfBuf.length/1024/1024).toFixed(1)}MB e Telegram aceita ate 50MB.`);
  const fileName = `Relatorio_Despesas_${input.ids.length}_notas.pdf`;
  await sendTelegramDocument(chatId, pdfBuf, fileName, `Relatório de Despesas Extras — ${input.ids.length} nota(s)`);
  return { ok: true as const, message: `Relatório enviado via Telegram (${(pdfBuf.length/1024).toFixed(0)} KB).` };
}
