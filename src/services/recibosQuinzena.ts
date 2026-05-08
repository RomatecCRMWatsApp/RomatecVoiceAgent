// v1.65.12 — PR B.1: gerador de recibo quinzenal (PDF) + ajustes + assinatura
// digital via QR-code. Não envia nada — só monta o documento e disponibiliza
// pra preview/download. PR B.2 plugará isso no fluxo de envio em massa via
// ZAYRA + Z-API.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import pool from '../database/connection';
import { formatBRL } from '../util/format';
import { getTenantSettings } from './tenantSettings';
import { sendDocument, sendReply, sendButtonActions } from '../integrations/whatsapp';

const LOGO_RELATORIO = '/romatec-logo.jpg';

// ── Período: "YYYY-MM-1" (dias 1-15) ou "YYYY-MM-2" (dias 16-fim) ───────────
export interface Periodo {
  ano: number;
  mes: number;            // 1-12
  quinzena: 1 | 2;
  dataInicio: string;     // "YYYY-MM-DD"
  dataFim: string;        // "YYYY-MM-DD"
  label: string;          // "1ª quinzena de Maio/2026"
  codigo: string;         // "2026-05-1"
}

const NOMES_MES = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export function parsePeriodo(codigo: string): Periodo {
  const m = /^(\d{4})-(\d{2})-([12])$/.exec(codigo);
  if (!m) throw new Error(`período inválido: "${codigo}" (formato esperado YYYY-MM-1 ou YYYY-MM-2)`);
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const quinzena = Number(m[3]) as 1 | 2;
  const ultimoDiaMes = new Date(ano, mes, 0).getDate();
  const dataInicio = quinzena === 1
    ? `${ano}-${String(mes).padStart(2, '0')}-01`
    : `${ano}-${String(mes).padStart(2, '0')}-16`;
  const dataFim = quinzena === 1
    ? `${ano}-${String(mes).padStart(2, '0')}-15`
    : `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDiaMes).padStart(2, '0')}`;
  return {
    ano, mes, quinzena, dataInicio, dataFim,
    codigo,
    label: `${quinzena}ª quinzena de ${NOMES_MES[mes]}/${ano}`,
  };
}

export function calcularPeriodoAtual(now: Date = new Date()): Periodo {
  const ano = now.getFullYear();
  const mes = now.getMonth() + 1;
  const dia = now.getDate();
  const quinzena = dia <= 15 ? 1 : 2;
  return parsePeriodo(`${ano}-${String(mes).padStart(2, '0')}-${quinzena}`);
}

// ── CRUD Ajustes ────────────────────────────────────────────────────────────
export type TipoAjuste = 'desconto' | 'adiantamento' | 'bonus' | 'horas_extras';

interface AjusteRow extends RowDataPacket {
  id: number;
  membro_id: number;
  periodo: string;
  tipo: TipoAjuste;
  valor: string;
  descricao: string | null;
  criado_em: Date;
  criado_por: string | null;
}

export interface Ajuste {
  id: string;
  membro_id: string;
  periodo: string;
  tipo: TipoAjuste;
  valor: number;
  descricao: string | null;
  criado_em: Date;
  criado_por: string | null;
}

export async function listarAjustes(input: { membro_id: string; periodo?: string }): Promise<Ajuste[]> {
  const params: (string | number)[] = [Number(input.membro_id)];
  let sql = 'SELECT * FROM recibos_ajustes WHERE membro_id = ?';
  if (input.periodo) { sql += ' AND periodo = ?'; params.push(input.periodo); }
  sql += ' ORDER BY criado_em DESC';
  const [rows] = await pool.execute<AjusteRow[]>(sql, params);
  return rows.map(r => ({
    id: String(r.id),
    membro_id: String(r.membro_id),
    periodo: r.periodo,
    tipo: r.tipo,
    valor: Number(r.valor),
    descricao: r.descricao,
    criado_em: r.criado_em,
    criado_por: r.criado_por,
  }));
}

export async function criarAjuste(input: {
  membro_id: string; periodo: string; tipo: TipoAjuste;
  valor: number; descricao?: string; criado_por?: string;
}): Promise<{ ok: true; insertId: number; message: string }> {
  if (!input.membro_id) throw new Error('membro_id obrigatório');
  parsePeriodo(input.periodo); // valida formato
  if (!['desconto', 'adiantamento', 'bonus', 'horas_extras'].includes(input.tipo)) {
    throw new Error(`tipo inválido: ${input.tipo}`);
  }
  const valor = Number(input.valor);
  if (!isFinite(valor) || valor <= 0) throw new Error('valor deve ser > 0 (sinal vem do tipo)');

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO recibos_ajustes (membro_id, periodo, tipo, valor, descricao, criado_por)
     VALUES (?,?,?,?,?,?)`,
    [Number(input.membro_id), input.periodo, input.tipo, valor.toFixed(2),
     input.descricao ?? null, input.criado_por ?? null]
  );
  return { ok: true, insertId: r.insertId, message: `Ajuste ${input.tipo} de ${formatBRL(valor)} adicionado.` };
}

export async function removerAjuste(input: { id: string }): Promise<{ ok: true; affected: number }> {
  const [r] = await pool.execute<ResultSetHeader>(
    'DELETE FROM recibos_ajustes WHERE id = ?', [Number(input.id)]
  );
  return { ok: true, affected: r.affectedRows };
}

// ── Coleta consolidada do recibo ────────────────────────────────────────────
interface MembroRow extends RowDataPacket {
  id: number; nome: string; funcao: string | null; cpf: string | null;
  tipo_contrato: string | null; valor_dia: string | null;
  endereco_rua: string | null; endereco_cidade: string | null; endereco_estado: string | null;
}

interface DiaRow extends RowDataPacket {
  id: number; data: Date; periodo: 'integral' | 'manha' | 'tarde';
  valor: string | null; obra_id: number | null; obra_nome: string | null;
  observacoes: string | null;
}

interface ReciboData {
  membro: {
    id: string; nome: string; cpf: string | null; cargo: string | null;
    vinculo: string | null; valor_dia: number;
    cidade: string | null; estado: string | null;
  };
  periodo: Periodo;
  dias: Array<{
    data: string;            // dd/MM/yyyy
    iso: string;              // YYYY-MM-DD
    tipo: 'integral' | 'manha' | 'tarde';
    fracao: number;           // 1.0 ou 0.5
    valor: number;
    obra_id: string | null;
    obra_nome: string | null;
    observacoes: string | null;
  }>;
  obras: Array<{ id: string; nome: string }>;
  ajustes: Ajuste[];
  totais: {
    qtd_dias: number;         // soma de frações (3 integrais + 1 meia = 3.5)
    valor_diarias: number;
    descontos: number;        // soma absoluta
    adiantamentos: number;    // soma absoluta
    bonus: number;
    horas_extras: number;
    total_ajustes: number;    // bonus + horas_extras − descontos − adiantamentos (sinal)
    total_liquido: number;    // valor_diarias + total_ajustes
  };
}

export async function coletarDadosRecibo(membroId: string, periodoCodigo: string): Promise<ReciboData> {
  const periodo = parsePeriodo(periodoCodigo);
  const [mRows] = await pool.execute<MembroRow[]>(
    `SELECT id, nome, funcao, cpf, tipo_contrato, valor_dia,
            endereco_cidade, endereco_estado
       FROM romatec_obra_equipe WHERE id = ?`,
    [Number(membroId)]
  );
  if (!mRows.length) throw new Error(`membro ${membroId} não encontrado`);
  const m = mRows[0];

  const [dRows] = await pool.execute<DiaRow[]>(
    `SELECT d.id, d.data, d.periodo, d.valor, d.obra_id, d.observacoes,
            o.nome AS obra_nome
       FROM romatec_obra_funcionario_dias d
       LEFT JOIN romatec_obras o ON o.id = d.obra_id
      WHERE d.funcionario_id = ?
        AND d.data BETWEEN ? AND ?
      ORDER BY d.data ASC, d.periodo ASC`,
    [Number(membroId), periodo.dataInicio, periodo.dataFim]
  );

  const valorDia = m.valor_dia ? Number(m.valor_dia) : 0;
  const dias = dRows.map(r => {
    const fracao = r.periodo === 'integral' ? 1 : 0.5;
    const valor = r.valor != null ? Number(r.valor) : valorDia * fracao;
    const isoData = (r.data instanceof Date)
      ? r.data.toISOString().slice(0, 10)
      : String(r.data).slice(0, 10);
    return {
      data: isoData.split('-').reverse().join('/'),
      iso: isoData,
      tipo: r.periodo,
      fracao,
      valor,
      obra_id: r.obra_id ? String(r.obra_id) : null,
      obra_nome: r.obra_nome,
      observacoes: r.observacoes,
    };
  });

  // Obras únicas trabalhadas
  const obrasMap = new Map<string, string>();
  for (const d of dias) {
    if (d.obra_id && d.obra_nome) obrasMap.set(d.obra_id, d.obra_nome);
  }
  const obras = Array.from(obrasMap.entries()).map(([id, nome]) => ({ id, nome }));

  const ajustes = await listarAjustes({ membro_id: membroId, periodo: periodo.codigo });

  // Totais
  const qtd_dias       = dias.reduce((s, d) => s + d.fracao, 0);
  const valor_diarias  = dias.reduce((s, d) => s + d.valor, 0);
  const descontos      = ajustes.filter(a => a.tipo === 'desconto').reduce((s, a) => s + a.valor, 0);
  const adiantamentos  = ajustes.filter(a => a.tipo === 'adiantamento').reduce((s, a) => s + a.valor, 0);
  const bonus          = ajustes.filter(a => a.tipo === 'bonus').reduce((s, a) => s + a.valor, 0);
  const horas_extras   = ajustes.filter(a => a.tipo === 'horas_extras').reduce((s, a) => s + a.valor, 0);
  const total_ajustes  = bonus + horas_extras - descontos - adiantamentos;
  const total_liquido  = valor_diarias + total_ajustes;

  return {
    membro: {
      id: String(m.id), nome: m.nome, cpf: m.cpf,
      cargo: m.funcao, vinculo: m.tipo_contrato,
      valor_dia: valorDia,
      cidade: m.endereco_cidade, estado: m.endereco_estado,
    },
    periodo,
    dias,
    obras,
    ajustes,
    totais: {
      qtd_dias, valor_diarias,
      descontos, adiantamentos, bonus, horas_extras,
      total_ajustes, total_liquido,
    },
  };
}

// ── Snapshot persistido + hash ──────────────────────────────────────────────
function gerarHash(payload: object): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

interface EmitidoRow extends RowDataPacket {
  hash: string;
  membro_id: number; periodo: string;
  total_dias: string; valor_diarias: string; total_ajustes: string; total_liquido: string;
  snapshot_json: string | object;
  emitido_em: Date;
}

async function persistirSnapshot(data: ReciboData): Promise<{ hash: string; emitidoEm: Date }> {
  // Snapshot sem timestamp dinâmico pra hash ser estável quando dados não mudam
  const snapshot = {
    v: 1,
    membro_id: data.membro.id,
    periodo: data.periodo.codigo,
    membro: data.membro,
    dias: data.dias,
    obras: data.obras,
    ajustes: data.ajustes.map(a => ({
      id: a.id, tipo: a.tipo, valor: a.valor, descricao: a.descricao,
    })),
    totais: data.totais,
  };
  const hash = gerarHash(snapshot);

  // Se já existe emissão com mesmo hash, retorna ela (idempotente)
  const [existe] = await pool.execute<EmitidoRow[]>(
    'SELECT * FROM recibos_quinzena_emitidos WHERE hash = ? LIMIT 1', [hash]
  );
  if (existe.length) return { hash, emitidoEm: existe[0].emitido_em };

  await pool.execute<ResultSetHeader>(
    `INSERT INTO recibos_quinzena_emitidos
       (hash, membro_id, periodo, total_dias, valor_diarias, total_ajustes, total_liquido, snapshot_json)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      hash, Number(data.membro.id), data.periodo.codigo,
      data.totais.qtd_dias.toFixed(1),
      data.totais.valor_diarias.toFixed(2),
      data.totais.total_ajustes.toFixed(2),
      data.totais.total_liquido.toFixed(2),
      JSON.stringify(snapshot),
    ]
  );
  return { hash, emitidoEm: new Date() };
}

export async function buscarReciboPorHash(hash: string): Promise<ReciboData | null> {
  const [rows] = await pool.execute<EmitidoRow[]>(
    'SELECT * FROM recibos_quinzena_emitidos WHERE hash = ? LIMIT 1', [hash]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const snap = typeof r.snapshot_json === 'string' ? JSON.parse(r.snapshot_json) : r.snapshot_json;
  return {
    ...snap,
    periodo: parsePeriodo(snap.periodo),
  } as ReciboData;
}

// ── PDF ────────────────────────────────────────────────────────────────────
export async function gerarReciboQuinzenalPdf(input: {
  membro_id: string; periodo: string; baseUrl?: string;
}): Promise<{ buffer: Buffer; hash: string; data: ReciboData }> {
  const data = await coletarDadosRecibo(input.membro_id, input.periodo);
  const { hash } = await persistirSnapshot(data);

  const t = await getTenantSettings(1).catch(() => null);
  const brand   = t?.brand_name || 'Romatec Consultoria Imobiliária';
  const corHex  = t?.primary_color || '#10b981';

  const doc = new PDFDocument({ size: 'A4', margin: 48, info: {
    Title: `Recibo Quinzenal — ${data.membro.nome} — ${data.periodo.label}`,
    Author: brand,
    Subject: `Recibo de pagamento ${data.periodo.label}`,
  }});
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // Logo
  const logoFile = path.join(__dirname, '..', 'public', LOGO_RELATORIO.replace(/^\//, ''));
  if (fs.existsSync(logoFile)) {
    try { doc.image(logoFile, { fit: [120, 60], align: 'center' }); }
    catch { /* ignore */ }
  } else {
    doc.fontSize(16).fillColor(corHex).text(brand, { align: 'center' });
  }
  doc.moveDown(0.5);
  doc.strokeColor(corHex).lineWidth(2).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.6);

  // Título
  doc.fontSize(15).fillColor('#111').text('RECIBO DE PAGAMENTO QUINZENAL', { align: 'center', characterSpacing: 1 });
  doc.fontSize(10).fillColor('#444').text(data.periodo.label, { align: 'center' });
  doc.fontSize(9).fillColor('#666').text(
    `Período: ${data.periodo.dataInicio.split('-').reverse().join('/')} a ${data.periodo.dataFim.split('-').reverse().join('/')}`,
    { align: 'center' }
  );
  doc.moveDown(0.8);

  // Identificação
  doc.fontSize(11).fillColor(corHex).text('Identificação do Colaborador');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#111');
  doc.text(`Nome: ${data.membro.nome}`);
  if (data.membro.cpf)    doc.text(`CPF: ${data.membro.cpf}`);
  if (data.membro.cargo)  doc.text(`Cargo: ${data.membro.cargo}`);
  if (data.membro.vinculo) doc.text(`Vínculo: ${data.membro.vinculo}`);
  doc.text(`Valor diária: ${formatBRL(data.membro.valor_dia)}`);
  doc.moveDown(0.5);

  // Obras trabalhadas
  if (data.obras.length) {
    doc.fontSize(11).fillColor(corHex).text('Obras na Quinzena');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#111');
    for (const o of data.obras) doc.text(`• ${o.nome}`);
    doc.moveDown(0.5);
  }

  // Tabela dia-a-dia
  doc.fontSize(11).fillColor(corHex).text('Detalhamento Dia-a-Dia');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);

  const colDia = { data: 48, tipo: 130, obra: 200, valor: 480 };
  const headerY = doc.y;
  doc.fontSize(9).fillColor('#444').font('Helvetica-Bold');
  doc.text('Data',  colDia.data,  headerY, { width: 80 });
  doc.text('Tipo',  colDia.tipo,  headerY, { width: 65 });
  doc.text('Obra',  colDia.obra,  headerY, { width: 270 });
  doc.text('Valor', colDia.valor, headerY, { width: 67, align: 'right' });
  doc.font('Helvetica');
  doc.moveDown(0.3);
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#888').lineWidth(0.5).stroke();
  doc.moveDown(0.2);

  let cursorY = doc.y;
  doc.fontSize(9).fillColor('#111');
  if (!data.dias.length) {
    doc.text('Sem dias trabalhados na quinzena.', 48, cursorY, { width: 499, align: 'center' });
    cursorY += 20;
  } else {
    for (const d of data.dias) {
      const lineHeight = 14;
      if (cursorY + lineHeight > 760) {
        doc.addPage();
        cursorY = doc.y;
      }
      const tipoLabel = d.tipo === 'integral' ? 'Integral' : d.tipo === 'manha' ? 'Manhã' : 'Tarde';
      doc.text(d.data,                colDia.data,  cursorY, { width: 80 });
      doc.text(tipoLabel,             colDia.tipo,  cursorY, { width: 65 });
      doc.text(d.obra_nome ?? '-',    colDia.obra,  cursorY, { width: 270 });
      doc.text(formatBRL(d.valor),    colDia.valor, cursorY, { width: 67, align: 'right' });
      cursorY += lineHeight;
    }
  }
  doc.moveTo(48, cursorY + 2).lineTo(547, cursorY + 2).strokeColor('#888').lineWidth(0.5).stroke();
  cursorY += 8;
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#111')
     .text(`Subtotal diárias (${data.totais.qtd_dias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dia[s]): ${formatBRL(data.totais.valor_diarias)}`,
            48, cursorY, { width: 499, align: 'right' });
  doc.font('Helvetica');
  cursorY += 20;
  doc.x = 48; doc.y = cursorY;

  // Ajustes
  if (data.ajustes.length) {
    doc.fontSize(11).fillColor(corHex).text('Ajustes');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#111');
    for (const a of data.ajustes) {
      const sinal = (a.tipo === 'desconto' || a.tipo === 'adiantamento') ? '−' : '+';
      const cor   = (a.tipo === 'desconto' || a.tipo === 'adiantamento') ? '#b91c1c' : '#15803d';
      doc.fillColor('#444').text(`${tipoAjusteLabel(a.tipo)}${a.descricao ? ' — ' + a.descricao : ''}`, { continued: true, width: 400 });
      doc.fillColor(cor).text(`  ${sinal} ${formatBRL(a.valor)}`, { align: 'right' });
    }
    doc.fillColor('#111');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica-Bold')
       .text(`Total ajustes: ${data.totais.total_ajustes >= 0 ? '+ ' : '− '}${formatBRL(Math.abs(data.totais.total_ajustes))}`, { align: 'right' });
    doc.font('Helvetica');
    doc.moveDown(0.5);
  }

  // Total líquido
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor(corHex).lineWidth(1).stroke();
  doc.moveDown(0.4);
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#111')
     .text(`TOTAL LÍQUIDO: ${formatBRL(data.totais.total_liquido)}`, 48, doc.y, { width: 499, align: 'right' });
  doc.font('Helvetica');
  doc.moveDown(0.6);

  doc.fontSize(9).fillColor('#444').text('Forma de pagamento: PIX (chave informada após confirmação).');
  doc.moveDown(1.5);

  // Assinatura + QR
  const sigY = doc.y > 680 ? (doc.addPage(), doc.y) : doc.y;
  // Linha pra assinatura
  doc.fontSize(9).fillColor('#111');
  doc.moveTo(48, sigY + 30).lineTo(360, sigY + 30).strokeColor('#666').lineWidth(0.6).stroke();
  doc.text(data.membro.nome, 48, sigY + 34, { width: 312 });
  if (data.membro.cpf) doc.fillColor('#666').text(`CPF: ${data.membro.cpf}`, 48, sigY + 47);
  doc.fillColor('#111');

  // QR-code com link de validação
  const baseUrl = (input.baseUrl || '').replace(/\/$/, '');
  const validateUrl = `${baseUrl}/recibos/validar/${hash}`;
  try {
    const qrBuf = await QRCode.toBuffer(validateUrl, { width: 110, margin: 0 });
    doc.image(qrBuf, 440, sigY, { fit: [105, 105] });
    doc.fontSize(7).fillColor('#666')
       .text('Validar autenticidade:', 405, sigY + 110, { width: 140, align: 'center' });
    doc.fontSize(6.5).fillColor('#888')
       .text(hash.slice(0, 16) + '...', 405, sigY + 121, { width: 140, align: 'center' });
  } catch (err) {
    console.warn('[recibo-pdf] gerar QR-code falhou:', (err as Error).message);
  }

  // Footer
  doc.fontSize(8).fillColor('#888')
     .text(`Recibo gerado por ZAYRA — ${brand}`, 48, 800, { width: 499, align: 'center' });
  doc.fontSize(7).fillColor('#aaa')
     .text(`Hash de validação (SHA-256): ${hash}`, 48, 812, { width: 499, align: 'center' });

  doc.end();
  await new Promise<void>(resolve => doc.on('end', () => resolve()));
  return { buffer: Buffer.concat(chunks), hash, data };
}

function tipoAjusteLabel(t: TipoAjuste): string {
  return t === 'desconto'      ? 'Desconto'
       : t === 'adiantamento'  ? 'Vale (adiantamento)'
       : t === 'bonus'         ? 'Bônus'
       :                         'Horas extras';
}

// ── Página HTML pública de validação (mostra dados do snapshot) ─────────────
export async function gerarHtmlValidacao(hash: string): Promise<string> {
  const data = await buscarReciboPorHash(hash);
  if (!data) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recibo não encontrado</title></head>
<body style="font-family:sans-serif; text-align:center; padding:40px; color:#b91c1c;">
<h1>⚠️ Recibo não encontrado</h1>
<p>O hash informado não corresponde a nenhum recibo emitido.</p>
</body></html>`;
  }

  const t = await getTenantSettings(1).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliária';
  const cor   = t?.primary_color || '#10b981';

  const diasRows = data.dias.map(d => `
    <tr>
      <td>${d.data}</td>
      <td>${d.tipo === 'integral' ? 'Integral' : d.tipo === 'manha' ? 'Manhã' : 'Tarde'}</td>
      <td>${d.obra_nome ?? '-'}</td>
      <td style="text-align:right;">${formatBRL(d.valor)}</td>
    </tr>
  `).join('');

  const ajustesRows = data.ajustes.map(a => {
    const sinal = (a.tipo === 'desconto' || a.tipo === 'adiantamento') ? '−' : '+';
    const cor   = (a.tipo === 'desconto' || a.tipo === 'adiantamento') ? '#b91c1c' : '#15803d';
    return `<tr>
      <td>${tipoAjusteLabel(a.tipo)}${a.descricao ? ' — ' + a.descricao : ''}</td>
      <td style="text-align:right; color:${cor};">${sinal} ${formatBRL(a.valor)}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Validação — ${data.membro.nome} — ${data.periodo.label}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width:760px; margin:0 auto; padding:24px; color:#111; line-height:1.5; }
  .header { text-align:center; border-bottom:3px solid ${cor}; padding-bottom:14px; margin-bottom:18px; }
  .badge-ok { display:inline-block; background:#dcfce7; color:#15803d; padding:6px 14px; border-radius:20px; font-weight:600; font-size:13px; }
  h1 { font-size:18px; margin:14px 0 8px; }
  h2 { font-size:14px; color:${cor}; border-bottom:1px solid #ddd; padding-bottom:4px; margin-top:18px; }
  table { width:100%; border-collapse:collapse; margin-top:8px; font-size:13px; }
  th, td { padding:6px 8px; border-bottom:1px solid #e5e5e5; }
  th { background:#f3f4f6; text-align:left; font-size:12px; }
  .total-box { margin-top:14px; padding:12px 16px; background:#f9fafb; border-left:4px solid ${cor};
               display:flex; justify-content:space-between; font-weight:600; font-size:15px; }
  .hash { font-family:monospace; font-size:10px; color:#888; word-break:break-all; }
</style>
</head><body>
  <div class="header">
    <p class="badge-ok">✓ Recibo autêntico</p>
    <h1>${brand}</h1>
    <p style="margin:4px 0; color:#666;">Validação de Recibo Quinzenal</p>
  </div>

  <h2>Colaborador</h2>
  <p><strong>${data.membro.nome}</strong>${data.membro.cpf ? ' · CPF ' + data.membro.cpf : ''}<br>
  ${data.membro.cargo ?? ''}${data.membro.vinculo ? ' · ' + data.membro.vinculo : ''}</p>

  <h2>Período</h2>
  <p>${data.periodo.label}<br>
  ${data.periodo.dataInicio.split('-').reverse().join('/')} a ${data.periodo.dataFim.split('-').reverse().join('/')}</p>

  ${data.obras.length ? `<h2>Obras</h2><ul>${data.obras.map(o => `<li>${o.nome}</li>`).join('')}</ul>` : ''}

  <h2>Detalhamento Dia-a-Dia</h2>
  <table>
    <thead><tr><th>Data</th><th>Tipo</th><th>Obra</th><th style="text-align:right;">Valor</th></tr></thead>
    <tbody>${diasRows || '<tr><td colspan="4" style="text-align:center; color:#999;">Sem dias.</td></tr>'}</tbody>
  </table>
  <p style="text-align:right; margin-top:8px;"><strong>Subtotal diárias (${data.totais.qtd_dias} dia[s]):</strong> ${formatBRL(data.totais.valor_diarias)}</p>

  ${data.ajustes.length ? `
    <h2>Ajustes</h2>
    <table><tbody>${ajustesRows}</tbody></table>
    <p style="text-align:right; margin-top:8px;"><strong>Total ajustes:</strong> ${data.totais.total_ajustes >= 0 ? '+' : '−'} ${formatBRL(Math.abs(data.totais.total_ajustes))}</p>
  ` : ''}

  <div class="total-box">
    <span>TOTAL LÍQUIDO</span>
    <span>${formatBRL(data.totais.total_liquido)}</span>
  </div>

  <h2>Autenticidade</h2>
  <p style="font-size:12px; color:#666;">Este recibo foi gerado pela ZAYRA e o hash abaixo corresponde a um snapshot imutável armazenado no banco da Romatec.</p>
  <p class="hash">${hash}</p>

  <hr style="margin-top:30px; border:none; border-top:1px solid #ddd;">
  <p style="text-align:center; font-size:11px; color:#888;">${brand} — gerado por ZAYRA</p>
</body></html>`;
}

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║ PR B.2 — LOTES DE ENVIO QUINZENAL VIA Z-API                              ║
// ║ Estado: rascunho → aguardando_confirmacao_ceo → enviando → concluido    ║
// ║ Uma quinzena = um lote ativo. Re-disparar mesma quinzena com lote ativo  ║
// ║ é detectado e bloqueado (a menos de force=true).                         ║
// ╚═════════════════════════════════════════════════════════════════════════╝

interface LoteRow extends RowDataPacket {
  id: number; numero: string; periodo: string;
  periodo_inicio: Date; periodo_fim: Date;
  total_colaboradores: number; total_valor: string;
  status: 'rascunho' | 'aguardando_confirmacao_ceo' | 'enviando' | 'concluido' | 'cancelado';
  criado_por: string | null;
  criado_em: Date; confirmado_em: Date | null; concluido_em: Date | null;
  observacoes: string | null;
}

interface CandidatoRow extends RowDataPacket {
  id: number; nome: string; funcao: string | null;
  telefone: string | null; tipo_contrato: string | null;
  valor_dia: string | null;
  tratamento: string | null;  // do contacts
  tom: string | null;          // do contacts
}

interface PreviewItem {
  membro_id: string;
  nome: string;
  funcao: string | null;
  tratamento: string | null;
  telefone: string | null;
  total_liquido: number;
  qtd_dias: number;
  status_preview: 'ok' | 'sem_telefone' | 'telefone_invalido' | 'sem_dias_e_sem_ajustes';
  // v1.65.14: avisos informativos. CEO confirmou que tanto cargos de gestão
  // quanto operacionais podem ter múltiplos cadastros legítimos (operacional
  // pode iniciar quinzena na obra A e terminar na B). Não é erro, não
  // bloqueia. Cada cadastro envia seu próprio recibo filtrado pelos dias
  // daquela obra (comportamento atual do coletarDadosRecibo).
  multi_cadastro_ids?: string[]; // outros membro_ids com mesmo nome+telefone
  // Conflito real: 2 cadastros do mesmo colaborador (mesmo nome+telefone)
  // marcaram o MESMO dia + período (integral/manha/tarde) em obras diferentes.
  // Operacionalmente impossível — alguém errou ao marcar dias.
  conflitos_datas?: Array<{ data: string; periodo: string; obras: string[] }>;
}

export interface PreviewLote {
  periodo: Periodo;
  numero: string;
  ja_existe_lote_ativo: { id: string; numero: string; status: string } | null;
  itens: PreviewItem[];
  total_valor: number;
  total_colaboradores_validos: number;     // só status_preview='ok'
  total_pulados_sem_telefone: number;
  total_telefone_invalido: number;
  total_sem_atividade: number;
  duplicacoes_detectadas: Array<{
    chave: string;            // "nome|telefone" normalizado
    membro_ids: string[];     // todos os IDs com a mesma chave
    nome: string;
    telefone: string | null;
  }>;
}

// v1.65.14: telefone válido = ao menos 10 dígitos numéricos (DDD 2 + 8 dígitos
// mínimo). Antes da fix, "99" sozinho passava a validação porque continha
// algum dígito; isso quebrava no Z-API depois.
function normalizarTelefone(t: string | null | undefined): string {
  return (t || '').replace(/\D/g, '');
}
function isTelefoneValido(t: string | null | undefined): boolean {
  return normalizarTelefone(t).length >= 10;
}
// Chave de duplicação: nome canônico (lowercase, sem múltiplos espaços) + sufixo
// 9 dígitos do telefone (cobre variações 5598... vs 98...). Sem telefone, só nome.
function chaveDuplicacao(nome: string, telefone: string | null | undefined): string {
  const nomeCanon = String(nome).toLowerCase().replace(/\s+/g, ' ').trim();
  const telDigits = normalizarTelefone(telefone);
  const telKey = telDigits.length >= 9 ? telDigits.slice(-9) : '';
  return `${nomeCanon}|${telKey}`;
}

// v1.65.17: cargos de gestão podem legitimamente estar marcados integral em
// múltiplas obras no mesmo dia (cada obra paga sua diária pelo serviço de
// gestão — o profissional supervisiona/visita as duas, divide o tempo, mas
// cada uma reconhece o dia integral). Para esses, "conflito" não bloqueia.
// Operacionais (pedreiro/servente/etc) NÃO podem — fisicamente impossível —
// e o conflito continua sendo bloqueio.
const CARGOS_GESTAO_PADRAO = [
  'engenheir', 'arquitet', 'mestre', 'técnico', 'tecnico',
  'encarregado', 'coordenador', 'supervisor', 'gestor', 'fiscal',
];
function isCargoGestao(funcao: string | null): boolean {
  if (!funcao) return false;
  const f = funcao.toLowerCase();
  return CARGOS_GESTAO_PADRAO.some(c => f.includes(c));
}

function gerarNumeroLote(periodo: Periodo): string {
  return `QUINZ-${periodo.ano}-${String(periodo.mes).padStart(2, '0')}-${periodo.quinzena}`;
}

// Lista colaboradores ativos com dias OU ajustes na quinzena.
// Junta info de contacts (tratamento + tom) via romatec_obra_equipe.contact_id.
async function listarCandidatosLote(periodo: Periodo): Promise<CandidatoRow[]> {
  const [rows] = await pool.execute<CandidatoRow[]>(
    `SELECT DISTINCT
            e.id, e.nome, e.funcao, e.telefone, e.tipo_contrato, e.valor_dia,
            c.tratamento, c.tom
       FROM romatec_obra_equipe e
       LEFT JOIN contacts c ON c.id = e.contact_id
      WHERE e.ativo = 1
        AND (
          EXISTS (
            SELECT 1 FROM romatec_obra_funcionario_dias d
             WHERE d.funcionario_id = e.id
               AND d.data BETWEEN ? AND ?
          )
          OR EXISTS (
            SELECT 1 FROM recibos_ajustes a
             WHERE a.membro_id = e.id AND a.periodo = ?
          )
        )
      ORDER BY e.nome ASC`,
    [periodo.dataInicio, periodo.dataFim, periodo.codigo]
  );
  return rows;
}

// Verifica se já existe lote ativo (não cancelado, não concluído) pra esse período
async function buscarLoteAtivo(periodoCodigo: string): Promise<LoteRow | null> {
  const [rows] = await pool.execute<LoteRow[]>(
    `SELECT * FROM recibos_envios_lotes
      WHERE periodo = ?
        AND status IN ('rascunho','aguardando_confirmacao_ceo','enviando')
      ORDER BY criado_em DESC LIMIT 1`,
    [periodoCodigo]
  );
  return rows[0] ?? null;
}

// Calcula o total_liquido de cada candidato (sem persistir snapshot ainda — preview)
async function calcularTotalLiquido(membroId: string, periodo: Periodo): Promise<{ total: number; qtdDias: number }> {
  const data = await coletarDadosRecibo(membroId, periodo.codigo);
  return { total: data.totais.total_liquido, qtdDias: data.totais.qtd_dias };
}

export async function previewLoteQuinzena(input: { periodo?: string } = {}): Promise<PreviewLote> {
  const periodo = input.periodo ? parsePeriodo(input.periodo) : calcularPeriodoAtual();
  const numero  = gerarNumeroLote(periodo);

  const loteAtivo = await buscarLoteAtivo(periodo.codigo);
  const candidatos = await listarCandidatosLote(periodo);

  const itens: PreviewItem[] = [];
  let totalValor = 0;
  let pulados = 0;
  let invalidos = 0;
  let semAtividade = 0;

  // 1ª passada: classifica por dias/telefone e calcula totais
  for (const c of candidatos) {
    const r = await calcularTotalLiquido(String(c.id), periodo);
    const semDiasESemAjustes = r.qtdDias === 0 && r.total === 0;

    let statusPreview: PreviewItem['status_preview'] = 'ok';
    if (semDiasESemAjustes) {
      statusPreview = 'sem_dias_e_sem_ajustes';
      semAtividade++;
    } else if (!c.telefone || normalizarTelefone(c.telefone).length === 0) {
      statusPreview = 'sem_telefone';
      pulados++;
    } else if (!isTelefoneValido(c.telefone)) {
      // Tem algo no telefone mas é inválido (ex: "99" sozinho, ou só
      // formatação sem dígitos suficientes). Não dispara — bug do cadastro.
      statusPreview = 'telefone_invalido';
      invalidos++;
    } else {
      totalValor += r.total;
    }

    itens.push({
      membro_id: String(c.id),
      nome: c.nome,
      funcao: c.funcao,
      tratamento: c.tratamento,
      telefone: c.telefone,
      total_liquido: r.total,
      qtd_dias: r.qtdDias,
      status_preview: statusPreview,
    });
  }

  // 2ª passada: detecta múltiplos cadastros por (nome canônico + sufixo do
  // telefone). NÃO bloqueia — só informa. CEO confirmou que é caso legítimo
  // tanto pra gestão (Eng./Mestre/Téc. atuando em várias frentes) quanto
  // operacional (Pedreiro inicia quinzena numa obra e termina em outra).
  const grupos = new Map<string, PreviewItem[]>();
  for (const it of itens) {
    if (it.status_preview === 'sem_dias_e_sem_ajustes') continue;
    const k = chaveDuplicacao(it.nome, it.telefone);
    if (!k.startsWith('|')) {  // só agrupa se tem nome
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k)!.push(it);
    }
  }
  const duplicacoes: PreviewLote['duplicacoes_detectadas'] = [];
  for (const [chave, group] of grupos) {
    if (group.length < 2) continue;
    const ids = group.map(g => g.membro_id);
    // Marca cada item com lista de cadastros gêmeos (informativo)
    for (const it of group) {
      it.multi_cadastro_ids = ids.filter(id => id !== it.membro_id);
    }
    duplicacoes.push({
      chave, membro_ids: ids,
      nome: group[0].nome, telefone: group[0].telefone,
    });

    // 3ª passada: detecta CONFLITO real — mesmo colaborador (vários
    // cadastros) marcou o mesmo dia + periodo em obras diferentes.
    // Para OPERACIONAIS é impossível e bloqueia. Para cargos de GESTÃO
    // (Mestre/Eng./Téc./Encarregado) é prática legítima — cada obra paga
    // sua diária pelo serviço de supervisão; pulamos a detecção.
    const todosGestao = group.every(g => isCargoGestao(g.funcao));
    if (todosGestao) {
      // só log, não cria conflito_datas no item, não bloqueia disparo
      continue;
    }
    const memberIds = ids.map(Number);
    const [diasRows] = await pool.execute<RowDataPacket[]>(
      `SELECT d.funcionario_id, d.data, d.periodo, d.obra_id, o.nome AS obra_nome
         FROM romatec_obra_funcionario_dias d
         LEFT JOIN romatec_obras o ON o.id = d.obra_id
        WHERE d.funcionario_id IN (${memberIds.map(() => '?').join(',')})
          AND d.data BETWEEN ? AND ?
        ORDER BY d.data, d.periodo`,
      [...memberIds, periodo.dataInicio, periodo.dataFim]
    );
    type Hit = { data: string; periodo: string; obras: Map<string, string>; funcs: Set<number> };
    const hits = new Map<string, Hit>();
    for (const r of diasRows) {
      const isoData = (r.data instanceof Date)
        ? r.data.toISOString().slice(0, 10)
        : String(r.data).slice(0, 10);
      const key = `${isoData}|${r.periodo}`;
      if (!hits.has(key)) hits.set(key, {
        data: isoData, periodo: String(r.periodo),
        obras: new Map(), funcs: new Set(),
      });
      const h = hits.get(key)!;
      h.funcs.add(Number(r.funcionario_id));
      if (r.obra_id != null) h.obras.set(String(r.obra_id), String(r.obra_nome ?? '?'));
    }
    const conflitos: NonNullable<PreviewItem['conflitos_datas']> = [];
    for (const h of hits.values()) {
      // Conflito = mesmo dia/periodo aparece em 2+ funcionarios distintos
      // (cadastros gêmeos do mesmo colaborador real)
      if (h.funcs.size >= 2) {
        conflitos.push({
          data: h.data.split('-').reverse().join('/'),
          periodo: h.periodo,
          obras: Array.from(h.obras.values()),
        });
      }
    }
    if (conflitos.length) {
      for (const it of group) it.conflitos_datas = conflitos;
    }
  }

  return {
    periodo,
    numero,
    ja_existe_lote_ativo: loteAtivo
      ? { id: String(loteAtivo.id), numero: loteAtivo.numero, status: loteAtivo.status }
      : null,
    itens,
    total_valor: totalValor,
    // status 'ok' (inclui multi-cadastro, que segue como ok agora) conta como válido
    total_colaboradores_validos: itens.filter(i => i.status_preview === 'ok').length,
    total_pulados_sem_telefone: pulados,
    total_telefone_invalido: invalidos,
    total_sem_atividade: semAtividade,
    duplicacoes_detectadas: duplicacoes,
  };
}

// Saudação por horário (Fortaleza). Não personalizada — texto base.
function saudacaoBR(d: Date = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza', hour: '2-digit', hour12: false,
  }).format(d));
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// v1.65.21: cabeçalho enxuto pra mensagem com botões nativos
// (sem o bloco de opções 1/2 — botões substituem).
function montarCabecalhoMensagem(input: {
  nome: string; tratamento: string | null;
  periodo: Periodo; valor: number;
}): string {
  const saud = saudacaoBR();
  const tratNome = input.tratamento ? `${input.tratamento} ${input.nome.split(' ')[0]}` : input.nome.split(' ')[0];
  return (
    `${saud}, ${tratNome}.\n\n` +
    `Segue seu recibo da ${input.periodo.label}.\n` +
    `Período: ${input.periodo.dataInicio.split('-').reverse().join('/')} a ${input.periodo.dataFim.split('-').reverse().join('/')}.\n` +
    `Valor: ${formatBRL(input.valor)}\n\n` +
    `Toque em um dos botões abaixo:`
  );
}

function montarMensagemEnvio(input: {
  nome: string; tratamento: string | null; tom: string | null;
  periodo: Periodo; valor: number;
  linkConfirmacao?: string;   // v1.65.19: link clicável (vira botão no WhatsApp)
}): string {
  const saud = saudacaoBR();
  const tratNome = input.tratamento ? `${input.tratamento} ${input.nome.split(' ')[0]}` : input.nome.split(' ')[0];
  const cabecalho =
    `${saud}, ${tratNome}.\n\n` +
    `Segue seu recibo da ${input.periodo.label}.\n` +
    `Período: ${input.periodo.dataInicio.split('-').reverse().join('/')} a ${input.periodo.dataFim.split('-').reverse().join('/')}.\n` +
    `Valor: ${formatBRL(input.valor)}`;

  if (input.linkConfirmacao) {
    return (
      cabecalho + '\n\n' +
      `Confirme tocando no link abaixo:\n` +
      `${input.linkConfirmacao}\n\n` +
      `Ou responda por aqui:\n` +
      `*1* — Confirmo, está tudo certo\n` +
      `*2* — Não está correto`
    );
  }
  return (
    cabecalho + '\n\n' +
    `Confirme o recebimento e a conformidade do valor:\n\n` +
    `*1* — Confirmo, está tudo certo\n` +
    `*2* — Não está correto\n\n` +
    `(responda apenas com o número da opção)`
  );
}

// v1.65.19: gera UUID v4 simples (sem dependência externa).
function gerarToken(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// v1.65.21: envia mensagem de confirmação. Estratégia em 2 camadas:
//   1. SEMPRE manda o texto+link (sendReply) — garante que o colaborador
//      receba a instrução, mesmo se a instância Z-API for free/limitada.
//   2. Adicionalmente, se RECIBOS_USE_BUTTONS=true, tenta enviar botões
//      nativos via send-button-actions. Funciona como UX bônus em
//      instâncias business; se falhar, ignora (texto já chegou).
// Em v1.65.21 inicial, eu tentava botões PRIMEIRO e fallback texto, mas
// algumas instâncias Z-API retornam 200 OK silencioso mesmo sem entregar
// — o colaborador ficava sem texto. Inverter prioridade resolve.
export async function enviarMensagemConfirmacao(input: {
  telefone: string;
  cabecalho: string;
  linkConfirmacao?: string;
  textoFallback: string;
}): Promise<{ messageId?: string; viaBotoes: boolean }> {
  // 1. SEMPRE manda o texto (essencial pra colaborador entender o que fazer)
  const r = await sendReply(input.telefone, input.textoFallback);

  // 2. Tenta botões nativos se opt-in via env var (UX bônus)
  if (process.env.RECIBOS_USE_BUTTONS === 'true' || process.env.RECIBOS_USE_BUTTONS === '1') {
    const buttons: ZapiButtonInput[] = [
      { id: 'recibo-confirma', label: '1️⃣ Confirmo', type: 'REPLY' },
      { id: 'recibo-contesta', label: '2️⃣ Não confere', type: 'REPLY' },
    ];
    if (input.linkConfirmacao) {
      buttons.push({ id: 'recibo-detalhes', label: '🔗 Ver detalhes', type: 'URL', url: input.linkConfirmacao });
    }
    try {
      await sendButtonActions(input.telefone, input.cabecalho, buttons);
      console.log('[recibos] botões nativos enviados (bônus além do texto)');
      return { messageId: r.messageId, viaBotoes: true };
    } catch (err) {
      console.warn('[recibos] botões nativos falharam (texto já foi):', (err as Error).message.slice(0, 100));
    }
  }
  return { messageId: r.messageId, viaBotoes: false };
}

// Tipo local pra evitar import duplo de whatsapp (já importamos sendButtonActions)
type ZapiButtonInput = {
  id: string; label: string;
  type: 'REPLY' | 'URL' | 'CALL';
  url?: string; phone?: string;
};

// Cria o lote (status 'aguardando_confirmacao_ceo') sem disparar nada.
// Posterior chamada com confirm:true muda pra 'enviando' + dispara cada envio.
export async function criarLoteRecibos(input: {
  periodo?: string; criado_por?: string; force?: boolean;
}): Promise<{
  ok: true; lote_id: string; numero: string; preview: PreviewLote;
  message: string;
}> {
  const preview = await previewLoteQuinzena({ periodo: input.periodo });
  if (preview.ja_existe_lote_ativo && !input.force) {
    throw new Error(
      `Já existe lote ativo pra ${preview.periodo.label}: ` +
      `${preview.ja_existe_lote_ativo.numero} (status ${preview.ja_existe_lote_ativo.status}). ` +
      `Use force:true pra criar um lote paralelo (não recomendado).`
    );
  }
  if (preview.total_colaboradores_validos === 0) {
    throw new Error(
      `Nenhum colaborador válido pra ${preview.periodo.label}. ` +
      `(${preview.total_pulados_sem_telefone} sem telefone, ${preview.total_telefone_invalido} com telefone inválido, ${preview.total_sem_atividade} sem atividade.)`
    );
  }
  // v1.65.14: conflito de datas (mesmo colaborador marcado no mesmo dia+periodo
  // em obras diferentes) bloqueia disparo a menos de force:true. CEO precisa
  // limpar a marcação antes de disparar — caso contrário o colaborador recebe
  // recibos "inflados".
  const itensComConflito = preview.itens.filter(i => i.conflitos_datas && i.conflitos_datas.length);
  if (itensComConflito.length > 0 && !input.force) {
    const detalhes = itensComConflito.map(i => {
      const dias = (i.conflitos_datas ?? [])
        .map(c => `${c.data}/${c.periodo} em [${c.obras.join(' + ')}]`)
        .join(', ');
      return `${i.nome} (ID ${i.membro_id}): ${dias}`;
    }).join('; ');
    throw new Error(
      `Conflito de datas detectado em ${itensComConflito.length / 2} colaborador(es) — ` +
      `mesmo dia+período marcado em obras diferentes. Corrija na aba "Marcar Dias" antes de disparar, ` +
      `OU passe force:true pra ignorar. Detalhes: ${detalhes}.`
    );
  }

  // Ajusta numero pra evitar colisão se force=true (lote paralelo na mesma quinzena)
  let numero = preview.numero;
  if (preview.ja_existe_lote_ativo) {
    numero = `${preview.numero}-R${Date.now().toString(36).slice(-4)}`;
  }

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO recibos_envios_lotes
       (numero, periodo, periodo_inicio, periodo_fim,
        total_colaboradores, total_valor, status, criado_por)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      numero, preview.periodo.codigo,
      preview.periodo.dataInicio, preview.periodo.dataFim,
      preview.total_colaboradores_validos,
      preview.total_valor.toFixed(2),
      'aguardando_confirmacao_ceo',
      input.criado_por ?? null,
    ]
  );
  const loteId = r.insertId;

  // Cria envio pendente pra cada candidato (mesmo os pulados ficam registrados
  // como pulado_sem_telefone / falha_envio — útil pra trilha de auditoria do
  // que foi descartado neste lote)
  for (const it of preview.itens) {
    if (it.status_preview === 'sem_dias_e_sem_ajustes') continue; // não cria envio
    let st: 'pendente_envio' | 'pulado_sem_telefone' | 'falha_envio' = 'pendente_envio';
    if (it.status_preview === 'sem_telefone')         st = 'pulado_sem_telefone';
    if (it.status_preview === 'telefone_invalido')    st = 'pulado_sem_telefone';
    // duplicado_provavel: se chegou aqui é porque force=true. Cria normalmente
    // e CEO assume o risco de duplicidade.
    // v1.65.18: normaliza telefone pra só dígitos antes do INSERT — assim
    // o lookup posterior (no webhook) bate com qualquer formato de cadastro
    // (com ou sem parênteses/hífens/espaços).
    const telNorm = it.telefone ? it.telefone.replace(/\D/g, '') : null;
    await pool.execute<ResultSetHeader>(
      `INSERT INTO recibos_envios (lote_id, membro_id, telefone, valor, status, ultimo_erro)
       VALUES (?,?,?,?,?,?)`,
      [
        loteId, Number(it.membro_id), telNorm, it.total_liquido.toFixed(2), st,
        it.status_preview === 'telefone_invalido'
          ? `Telefone inválido (menos de 10 dígitos): "${it.telefone}"`
          : null,
      ]
    );
  }

  return {
    ok: true,
    lote_id: String(loteId),
    numero,
    preview,
    message: `Lote ${numero} criado com ${preview.total_colaboradores_validos} envio(s) pendente(s) (${preview.total_pulados_sem_telefone} pulados sem tel). Aguardando confirmação do CEO.`,
  };
}

interface EnvioRow extends RowDataPacket {
  id: number; lote_id: number; membro_id: number;
  telefone: string | null; valor: string;
  status: string; tentativas_envio: number;
}

// Dispara todos os envios pendentes do lote — gera PDF de cada um, manda
// via Z-API (PDF + texto separados, na ordem PDF → texto), atualiza status.
export async function dispararLote(input: {
  lote_id: string; baseUrl?: string;
}): Promise<{
  ok: true;
  total: number; sucesso: number; falhas: number; pulados: number;
  mensagens: string[];
}> {
  const loteId = Number(input.lote_id);
  if (!loteId) throw new Error('lote_id inválido');

  const [loteRows] = await pool.execute<LoteRow[]>(
    `SELECT * FROM recibos_envios_lotes WHERE id = ?`, [loteId]
  );
  if (!loteRows.length) throw new Error(`lote ${loteId} não encontrado`);
  const lote = loteRows[0];
  if (!['aguardando_confirmacao_ceo','enviando'].includes(lote.status)) {
    throw new Error(`lote ${loteId} está em status "${lote.status}" — não pode disparar`);
  }

  await pool.execute(
    `UPDATE recibos_envios_lotes SET status = 'enviando', confirmado_em = COALESCE(confirmado_em, NOW()) WHERE id = ?`,
    [loteId]
  );

  const periodo = parsePeriodo(lote.periodo);

  const [envios] = await pool.execute<EnvioRow[]>(
    `SELECT * FROM recibos_envios WHERE lote_id = ? AND status = 'pendente_envio' ORDER BY id ASC`,
    [loteId]
  );

  const tenant = await getTenantSettings(1).catch(() => null);
  const brand  = tenant?.brand_name || 'Romatec';

  let sucesso = 0, falhas = 0, pulados = 0;
  const mensagens: string[] = [];

  for (const e of envios) {
    if (!e.telefone) {
      pulados++;
      await pool.execute(
        `UPDATE recibos_envios SET status = 'pulado_sem_telefone' WHERE id = ?`, [e.id]
      );
      continue;
    }

    try {
      // 1. Gera PDF + persiste snapshot (idempotente — re-uso de hash se existe)
      const pdf = await gerarReciboQuinzenalPdf({
        membro_id: String(e.membro_id),
        periodo: periodo.codigo,
        baseUrl: input.baseUrl,
      });

      // 2. Pega dados do membro pra mensagem (tratamento/tom via contacts)
      const [mRows] = await pool.execute<RowDataPacket[]>(
        `SELECT e.nome, c.tratamento, c.tom
           FROM romatec_obra_equipe e
           LEFT JOIN contacts c ON c.id = e.contact_id
          WHERE e.id = ?`,
        [e.membro_id]
      );
      const m = mRows[0] || { nome: 'Colaborador', tratamento: null, tom: null };

      // 3. Gera token único de confirmação web (link clicável que vira
      // botão no WhatsApp) — só se ainda não tem
      let token: string;
      const [exTok] = await pool.execute<RowDataPacket[]>(
        `SELECT token_confirmacao FROM recibos_envios WHERE id = ?`, [e.id]
      );
      if (exTok[0]?.token_confirmacao) {
        token = String(exTok[0].token_confirmacao);
      } else {
        token = gerarToken();
        await pool.execute(`UPDATE recibos_envios SET token_confirmacao = ? WHERE id = ?`, [token, e.id]);
      }
      const linkConfirmacao = input.baseUrl
        ? `${input.baseUrl.replace(/\/$/, '')}/recibos/confirmar/${token}`
        : undefined;

      // 4. Manda PDF (ZAPI send-document, que não suporta caption)
      const fileName = `Recibo_${String(m.nome).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}_${periodo.codigo}.pdf`;
      const docRes = await sendDocument(e.telefone, pdf.buffer.toString('base64'), fileName);

      // 5. Manda texto com botões nativos (fallback texto+link se Z-API recusar)
      const cabecalho = montarCabecalhoMensagem({
        nome: String(m.nome),
        tratamento: m.tratamento as string | null,
        periodo,
        valor: Number(e.valor),
      });
      const txtFallback = montarMensagemEnvio({
        nome: String(m.nome),
        tratamento: m.tratamento as string | null,
        tom: m.tom as string | null,
        periodo,
        valor: Number(e.valor),
        linkConfirmacao,
      });
      const txtRes = await enviarMensagemConfirmacao({
        telefone: e.telefone,
        cabecalho,
        linkConfirmacao,
        textoFallback: txtFallback,
      });

      // 6. Atualiza envio pra "enviado_aguardando_confirmacao"
      await pool.execute(
        `UPDATE recibos_envios
            SET status = 'enviado_aguardando_confirmacao',
                enviado_em = NOW(),
                tentativas_envio = tentativas_envio + 1,
                recibo_hash = ?,
                ultimo_erro = NULL
          WHERE id = ?`,
        [pdf.hash, e.id]
      );

      // 6. Auditoria
      await pool.execute(
        `INSERT INTO recibos_envios_mensagens (envio_id, direcao, tipo, conteudo, message_id_zapi)
         VALUES (?, 'saida', 'pdf_recibo', ?, ?)`,
        [e.id, fileName, docRes.messageId ?? null]
      );
      await pool.execute(
        `INSERT INTO recibos_envios_mensagens (envio_id, direcao, tipo, conteudo, message_id_zapi)
         VALUES (?, 'saida', 'solicitacao_confirmacao', ?, ?)`,
        [e.id, txtRes.viaBotoes ? `[BOTÕES] ${cabecalho}` : txtFallback, txtRes.messageId ?? null]
      );

      sucesso++;
      mensagens.push(`✅ ${m.nome} (${e.telefone}) — ${formatBRL(Number(e.valor))}`);
    } catch (err) {
      falhas++;
      const errMsg = (err as Error).message ?? String(err);
      await pool.execute(
        `UPDATE recibos_envios
            SET status = 'falha_envio',
                tentativas_envio = tentativas_envio + 1,
                ultimo_erro = ?
          WHERE id = ?`,
        [errMsg.slice(0, 1000), e.id]
      );
      mensagens.push(`❌ envio ${e.id}: ${errMsg.slice(0, 80)}`);
      console.warn(`[recibos] disparo falhou pro envio ${e.id}:`, errMsg);
    }
  }

  // Lote vai pra concluido quando não há mais nada pendente E já houve disparo
  await pool.execute(
    `UPDATE recibos_envios_lotes
        SET status = 'concluido', concluido_em = NOW()
      WHERE id = ?`,
    [loteId]
  );

  return {
    ok: true,
    total: envios.length,
    sucesso, falhas, pulados,
    mensagens,
  };
}

// Helper de alto nível: prepara preview ou dispara em uma única chamada.
// É a interface que a tool da ZAYRA usa.
export async function dispararRecibosQuinzena(input: {
  periodo?: string; confirm?: boolean; force?: boolean;
  criado_por?: string; baseUrl?: string;
}): Promise<{
  modo: 'preview' | 'criado' | 'disparado';
  preview?: PreviewLote;
  lote_id?: string; numero?: string;
  total?: number; sucesso?: number; falhas?: number; pulados?: number;
  message: string;
}> {
  // Sem confirm → só preview, não cria nada
  if (!input.confirm) {
    const preview = await previewLoteQuinzena({ periodo: input.periodo });
    const linhas = preview.itens
      .filter(i => i.status_preview !== 'sem_dias_e_sem_ajustes')
      .map(i => {
        const tags: string[] = [];
        if (i.status_preview === 'sem_telefone')        tags.push('⚠️ sem WhatsApp');
        if (i.status_preview === 'telefone_invalido')   tags.push(`⚠️ telefone inválido ("${i.telefone}")`);
        if (i.multi_cadastro_ids?.length)               tags.push(`👥 multi-cadastro (junto com ${i.multi_cadastro_ids.join(', ')})`);
        if (i.conflitos_datas?.length)                  tags.push(`🔴 ${i.conflitos_datas.length} conflito(s) de data`);
        const trat = i.tratamento ? `${i.tratamento} ` : '';
        return `• [${i.membro_id}] ${trat}${i.nome}${i.funcao ? ' ('+i.funcao+')' : ''} — ${formatBRL(i.total_liquido)} ${tags.join(' ')}`;
      })
      .join('\n');

    const avisoLote = preview.ja_existe_lote_ativo
      ? `\n⚠️ Já existe lote ativo pra ${preview.periodo.label}: ${preview.ja_existe_lote_ativo.numero} (${preview.ja_existe_lote_ativo.status}). Use force:true pra criar paralelo.`
      : '';
    const avisoMulti = preview.duplicacoes_detectadas.length > 0
      ? `\n\n👥 ${preview.duplicacoes_detectadas.length} colaborador(es) com múltiplos cadastros (frentes diferentes):\n` +
        preview.duplicacoes_detectadas.map(d =>
          `  - ${d.nome} (IDs ${d.membro_ids.join(', ')})`
        ).join('\n') +
        `\n  → cada cadastro recebe seu próprio recibo (cada obra tem seus dias).`
      : '';
    const itensConflito = preview.itens.filter(i => i.conflitos_datas?.length);
    const avisoConflito = itensConflito.length
      ? `\n\n🔴 CONFLITO de datas detectado: o mesmo colaborador foi marcado no MESMO dia+período em obras diferentes (operacionalmente impossível):\n` +
        itensConflito.map(i =>
          `  - ${i.nome} [ID ${i.membro_id}]: ` +
          (i.conflitos_datas ?? []).map(c => `${c.data}/${c.periodo} em [${c.obras.join(' + ')}]`).join('; ')
        ).join('\n') +
        `\n\nCorrija na aba "Marcar Dias" ANTES de disparar (ou use force:true pra ignorar — não recomendado).`
      : '';
    const aviso = avisoLote + avisoMulti + avisoConflito;

    return {
      modo: 'preview',
      preview,
      message:
        `[PREVIEW LOTE ${preview.numero}] ${preview.periodo.label}\n\n` +
        `${preview.total_colaboradores_validos} envio(s) válido(s)` +
        (preview.total_pulados_sem_telefone ? `, ${preview.total_pulados_sem_telefone} sem WhatsApp` : '') +
        (preview.total_telefone_invalido ? `, ${preview.total_telefone_invalido} telefone inválido` : '') +
        (preview.total_sem_atividade ? `, ${preview.total_sem_atividade} sem atividade` : '') + '.\n\n' +
        linhas + '\n\n' +
        `Total a pagar (válidos): ${formatBRL(preview.total_valor)}` +
        aviso +
        (itensConflito.length === 0
          ? `\n\nConfirma o disparo? Reenvie com confirm:true.`
          : `\n\n🔴 Disparo bloqueado por conflito de datas. Corrija a marcação primeiro.`),
    };
  }

  // Com confirm:true → cria lote + dispara
  const criado = await criarLoteRecibos({
    periodo: input.periodo,
    criado_por: input.criado_por,
    force: input.force,
  });
  const disparo = await dispararLote({ lote_id: criado.lote_id, baseUrl: input.baseUrl });

  return {
    modo: 'disparado',
    lote_id: criado.lote_id,
    numero: criado.numero,
    total: disparo.total,
    sucesso: disparo.sucesso,
    falhas: disparo.falhas,
    pulados: disparo.pulados,
    message:
      `Lote ${criado.numero} disparado.\n` +
      `✅ Sucesso: ${disparo.sucesso}\n` +
      (disparo.falhas ? `❌ Falhas: ${disparo.falhas}\n` : '') +
      (disparo.pulados ? `⏭ Pulados (sem tel): ${disparo.pulados}\n` : '') +
      `\nDetalhes:\n${disparo.mensagens.slice(0, 30).join('\n')}`,
  };
}

// Status consolidado de um lote (pra comando "como tá a quinzena?")
export async function statusLote(input: { lote_id?: string; periodo?: string }): Promise<{
  lote: {
    id: string; numero: string; periodo: string; status: string;
    total_colaboradores: number; total_valor: number;
    criado_em: string; confirmado_em: string | null; concluido_em: string | null;
  };
  por_status: Record<string, number>;
  envios: Array<{
    id: string; membro: string; telefone: string | null;
    valor: number; status: string;
    enviado_em: string | null; confirmado_em: string | null;
    pix_recebido_em: string | null; pago_em: string | null;
    tentativas: number; ultimo_erro: string | null;
  }>;
}> {
  let loteRow: LoteRow | undefined;
  if (input.lote_id) {
    const [r] = await pool.execute<LoteRow[]>(
      `SELECT * FROM recibos_envios_lotes WHERE id = ?`, [Number(input.lote_id)]
    );
    loteRow = r[0];
  } else {
    const periodo = input.periodo ? parsePeriodo(input.periodo) : calcularPeriodoAtual();
    const [r] = await pool.execute<LoteRow[]>(
      `SELECT * FROM recibos_envios_lotes WHERE periodo = ? ORDER BY criado_em DESC LIMIT 1`,
      [periodo.codigo]
    );
    loteRow = r[0];
  }
  if (!loteRow) throw new Error('lote não encontrado');

  const [enviosRows] = await pool.execute<RowDataPacket[]>(
    `SELECT v.id, e.nome AS membro, v.telefone, v.valor, v.status,
            v.enviado_em, v.confirmado_em, v.pix_recebido_em, v.pago_em,
            v.tentativas_envio, v.ultimo_erro
       FROM recibos_envios v
       LEFT JOIN romatec_obra_equipe e ON e.id = v.membro_id
      WHERE v.lote_id = ?
      ORDER BY v.id ASC`,
    [loteRow.id]
  );

  const porStatus: Record<string, number> = {};
  for (const e of enviosRows) porStatus[String(e.status)] = (porStatus[String(e.status)] ?? 0) + 1;

  const fmtTs = (d: Date | null): string | null =>
    d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) : null;

  return {
    lote: {
      id: String(loteRow.id),
      numero: loteRow.numero,
      periodo: loteRow.periodo,
      status: loteRow.status,
      total_colaboradores: loteRow.total_colaboradores,
      total_valor: Number(loteRow.total_valor),
      criado_em: fmtTs(loteRow.criado_em) ?? '',
      confirmado_em: fmtTs(loteRow.confirmado_em),
      concluido_em: fmtTs(loteRow.concluido_em),
    },
    por_status: porStatus,
    envios: enviosRows.map(r => ({
      id: String(r.id),
      membro: String(r.membro ?? '(removido)'),
      telefone: r.telefone as string | null,
      valor: Number(r.valor),
      status: String(r.status),
      enviado_em: fmtTs(r.enviado_em as Date | null),
      confirmado_em: fmtTs(r.confirmado_em as Date | null),
      pix_recebido_em: fmtTs(r.pix_recebido_em as Date | null),
      pago_em: fmtTs(r.pago_em as Date | null),
      tentativas: Number(r.tentativas_envio ?? 0),
      ultimo_erro: r.ultimo_erro as string | null,
    })),
  };
}

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║ PR B.3 — WEBHOOK HANDLER DE RESPOSTAS                                    ║
// ║ Processa respostas inbound dos colaboradores no WhatsApp:                ║
// ║   - "1"/sim/ok → confirma → dispara mensagem 2 pedindo PIX               ║
// ║   - "2"/não/errado → contesta → repassa pro CEO em silêncio              ║
// ║   - chave PIX → registra → manda agradecimento                           ║
// ║   - ambíguo → repassa pro CEO sem responder colaborador                  ║
// ╚═════════════════════════════════════════════════════════════════════════╝

// v1.65.21: regex tolerante pra aceitar labels de botões nativos do WhatsApp
// (ex: "1️⃣ Confirmo", "2️⃣ Não confere") + emojis + texto livre.
// Estratégia: testa CONTESTA primeiro (palavras "não", "errado", etc) — se
// matchar, é contesta. Senão testa CONFIRMA. Mais fácil de manter que regex
// gigante.
const REGEX_CONTESTA = /^\s*(2[\.\)\s️⃣]*\s*(n[ãa]o|errado|incorreto|n[ãa]o\s*confere)?|n[ãa]o(\s+(confere|est[áa]\s*certo|confir|t[áa]\s*certo))?|incorret\w*|errad\w*|valor\s*errad\w*|❌)\s*\.?\s*$/i;
const REGEX_CONFIRMA = /^\s*(1[\.\)\s️⃣]*\s*(confirmo|sim|ok)?|sim|ok+|confirm\w*|de\s*acordo|t[au]\s*certo|tudo\s*certo|certo|👍|✅|de\s*acordo)\s*\.?\s*$/i;

export type TipoChavePix = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';

export function detectarTipoPix(raw: string): {
  tipo: TipoChavePix | null;
  chave: string;       // chave normalizada
  ambiguo: boolean;
} {
  const trim = raw.trim();
  if (!trim) return { tipo: null, chave: '', ambiguo: true };

  // E-mail
  if (/^[\w._%+-]+@[\w.-]+\.[a-z]{2,}$/i.test(trim)) {
    return { tipo: 'email', chave: trim.toLowerCase(), ambiguo: false };
  }
  // Aleatória (UUID v4 padrão Bacen)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trim)) {
    return { tipo: 'aleatoria', chave: trim.toLowerCase(), ambiguo: false };
  }
  // Numérico — pode ser CPF (11), CNPJ (14), telefone (10-13)
  const digits = trim.replace(/\D/g, '');
  if (digits.length === 11) {
    // Pode ser CPF ou celular com 9 (sem DDI). Heurística: se tem formatação
    // típica de CPF (XXX.XXX.XXX-XX) → CPF; se tem (XX) ou + → telefone;
    // ambíguo puro → assume CPF (mais comum para pessoa física como chave).
    if (/[()+\s-]/.test(trim) && /\(\d{2}\)/.test(trim)) {
      return { tipo: 'telefone', chave: digits, ambiguo: false };
    }
    if (/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(trim)) {
      return { tipo: 'cpf', chave: digits, ambiguo: false };
    }
    // 11 dígitos puros: provavelmente celular (DDD + 9 dígitos). Mas pode ser
    // CPF sem formatação. Assume CPF (chave PIX mais comum para pessoa física).
    // Marca ambíguo pra avisar o CEO se necessário, mas aceita CPF.
    return { tipo: 'cpf', chave: digits, ambiguo: false };
  }
  if (digits.length === 14) {
    return { tipo: 'cnpj', chave: digits, ambiguo: false };
  }
  if (digits.length >= 10 && digits.length <= 13) {
    return { tipo: 'telefone', chave: digits, ambiguo: false };
  }
  return { tipo: null, chave: trim, ambiguo: true };
}

interface EnvioPendenteRow extends RowDataPacket {
  id: number; lote_id: number; membro_id: number;
  telefone: string | null; valor: string;
  status: string; recibo_hash: string | null;
}

// v1.65.18: identifica se o phone do remetente é de um colaborador ativo
// da Equipe. Usado pra BLOQUEAR ZAYRA de responder mensagens de colaboradores
// — se for, ou processamos como resposta de recibo, ou repassamos ao CEO.
// Em hipótese nenhuma a ZAYRA conversa livremente com colaborador.
export async function isPhoneDeColaborador(phone: string): Promise<{
  membroId: string; nome: string; funcao: string | null;
} | null> {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const sufixo = digits.slice(-10);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, nome, funcao
       FROM romatec_obra_equipe
      WHERE ativo = 1
        AND telefone IS NOT NULL
        AND REGEXP_REPLACE(telefone, '[^0-9]', '') LIKE ?
      LIMIT 1`,
    [`%${sufixo}`]
  );
  if (!rows.length) return null;
  return {
    membroId: String(rows[0].id),
    nome: String(rows[0].nome),
    funcao: rows[0].funcao as string | null,
  };
}

// v1.65.18: notifica CEO quando colaborador manda mensagem que não bate
// com nenhum fluxo conhecido de recibo. ZAYRA não responde — CEO decide.
export async function notificarCeoMensagemColaborador(input: {
  phone: string; text: string;
  membroId: string; nome: string; funcao: string | null;
}): Promise<void> {
  await notificarCeo(
    `🔔 Mensagem de colaborador (sem fluxo ativo)\n\n` +
    `${input.nome}${input.funcao ? ' ('+input.funcao+')' : ''}\n` +
    `${input.phone}\n\n` +
    `Disse: "${input.text.slice(0, 400)}"\n\n` +
    `_(Não respondi — você decide.)_`
  );
}

async function buscarEnvioPendentePorPhone(phone: string): Promise<EnvioPendenteRow | null> {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) {
    console.warn(`[recibos] phone inválido pra lookup: "${phone}" (${digits.length} dígitos)`);
    return null;
  }
  const sufixo = digits.slice(-10);
  // v1.65.18: usa REGEXP_REPLACE pra extrair só os dígitos do telefone
  // armazenado em recibos_envios. Antes usávamos REPLACE encadeado removendo
  // '+', '-', ' ', '(' — mas faltava o ')', causando mismatch quando
  // o cadastro tinha "(99) 99180-2135". Com REGEXP_REPLACE qualquer formato
  // funciona. MySQL 8.0+ tem REGEXP_REPLACE; Railway usa 9.4, OK.
  const [rows] = await pool.execute<EnvioPendenteRow[]>(
    `SELECT *
       FROM recibos_envios
      WHERE status IN ('enviado_aguardando_confirmacao', 'confirmado_aguardando_pix')
        AND telefone IS NOT NULL
        AND REGEXP_REPLACE(telefone, '[^0-9]', '') LIKE ?
      ORDER BY enviado_em DESC LIMIT 1`,
    [`%${sufixo}`]
  );
  if (!rows.length) {
    console.warn(`[recibos] lookup sem match — phone=${phone} digits=${digits} sufixo=${sufixo}`);
  } else {
    console.log(`[recibos] lookup match — phone=${phone} → envio=${rows[0].id} status=${rows[0].status}`);
  }
  return rows[0] ?? null;
}

async function logarMensagemEnvio(
  envioId: number, direcao: 'saida' | 'entrada',
  tipo: 'pdf_recibo'|'solicitacao_confirmacao'|'solicitacao_pix'|'confirmacao'|'pix'|'contestacao'|'aviso'|'outro',
  conteudo: string, messageIdZapi?: string | null,
): Promise<void> {
  await pool.execute(
    `INSERT INTO recibos_envios_mensagens (envio_id, direcao, tipo, conteudo, message_id_zapi)
     VALUES (?,?,?,?,?)`,
    [envioId, direcao, tipo, conteudo.slice(0, 4000), messageIdZapi ?? null]
  );
}

// Notifica o CEO via WhatsApp (CEO_WHATSAPP_PHONE).
// Silencioso se a env var não estiver configurada — apenas loga warn.
async function notificarCeo(texto: string): Promise<void> {
  const ceoPhone = process.env.CEO_WHATSAPP_PHONE;
  if (!ceoPhone) {
    console.warn('[recibos] CEO_WHATSAPP_PHONE não configurado — mensagem perdida:', texto.slice(0, 80));
    return;
  }
  try {
    await sendReply(ceoPhone, texto);
  } catch (err) {
    console.warn('[recibos] notificarCeo falhou:', (err as Error).message);
  }
}

export interface RespostaProcessada {
  handled: boolean;
  acao?:
    | 'confirmou' | 'contestou' | 'pix_registrado' | 'ambiguo'
    // v1.99.17: acoes especificas de vale
    | 'confirmou_vale' | 'contestou_vale' | 'ja_confirmado_vale' | 'ambigua_vale';
  envio_id?: string;
  vale_id?: string;
  detalhe?: string;
}

// v1.99.17: REGEX especifico de vale — mais permissivo que recibo quinzenal
// (cobre "ok recebi", "recebi sim", "sim recebi", "tudo certo recebi", etc).
// Diferente do REGEX_CONFIRMA do quinzenal que e estrito ^...$.
const REGEX_CONFIRMA_VALE = /(^|\s)(confirm\w*|sim|ok|recebi(do|do\s|\s|$)?|ta\s*ok|tudo\s*certo|de\s*acordo|certo|👍|✅)(\s|$|[.\!])/i;
const REGEX_CONTESTA_VALE = /(n[ãa]o\s*recebi|nao\s*chegou|n[ãa]o\s*confir|errad\w*|incorret\w*|valor\s*errad\w*|❌|n[ãa]o\s*concordo|contest)/i;

import type { Recibo } from '../integrations/recibos';

/**
 * v1.99.17: Processa resposta de funcionario a um vale pendente.
 * Fluxo:
 *   - REGEX_CONFIRMA_VALE → status='confirmado' + regenera PDF com selo + reenvia
 *   - REGEX_CONTESTA_VALE → status='contestado' + notifica CEO
 *   - Texto ambiguo → notifica CEO sem responder colaborador
 */
async function processarRespostaVale(input: {
  vale: Recibo;
  text: string;
  phone: string;
  messageId?: string;
}): Promise<RespostaProcessada> {
  const { vale, text, phone, messageId } = input;

  // Normalizacao igual ao quinzenal (remove emojis variation, etc)
  const textNorm = text.replace(/[️⃣]/g, '').replace(/^\s*[\p{Emoji}\s]+/u, '').trim();

  const recibosMod = await import('../integrations/recibos');
  const wa = await import('../integrations/whatsapp');
  const reciboPdfMod = await import('./reciboPdf');
  const baseUrl = reciboPdfMod.getBaseUrl();
  const linkValidacao = `${baseUrl}/v/${vale.hash_validacao}`;

  // ── CONFIRMA ──────────────────────────────────────────────────────────
  if (REGEX_CONFIRMA_VALE.test(textNorm)) {
    console.log(`[vale:confirmacao] vale=${vale.numero} phone=${phone} text="${text.slice(0, 60)}"`);

    try {
      // 1. Atualiza status via funcao existente
      await recibosMod.responderRecibo({
        token: vale.token,
        acao: 'confirma',
        ip: phone,
        user_agent: 'whatsapp-confirmo',
        obs: text.slice(0, 500),
      });

      // 2. Re-busca recibo atualizado (status='confirmado')
      const valeAtualizado = await recibosMod.buscarReciboPorId(vale.id);
      if (!valeAtualizado) throw new Error('Recibo recem confirmado nao encontrado');

      // 3. Regenera PDF (com selo CONFIRMADO, sem bloco de saldo)
      const valePdfMod = await import('./valePdf');
      const pdfAssinado = await valePdfMod.gerarPdfVale({
        membro_nome: valeAtualizado.destinatario_nome,
        membro_cpf: valeAtualizado.destinatario_doc,
        valor: valeAtualizado.valor ?? 0,
        descricao: valeAtualizado.descricao_servico,
        // periodo nao temos persistido — usa quinzena atual como aproximacao
        periodo: (() => {
          const d = new Date();
          const a = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const q = d.getDate() <= 15 ? 1 : 2;
          return `${a}-${m}-${q}`;
        })(),
        saldo_anterior: 0,             // omitido pelo flag abaixo
        omitirBlocoSaldo: true,        // v1.99.17: PDF reassinado nao mostra saldo
        numero: valeAtualizado.numero,
        recibo: valeAtualizado,        // status='confirmado' -> selo aplicado
      });

      // 4. Reenvia via WhatsApp
      const msg =
        `✅ Recibo de vale ${valeAtualizado.numero} confirmado e assinado digitalmente.\n` +
        `Guarde como comprovante oficial.\n\n` +
        `🔗 Verificar autenticidade: ${linkValidacao}\n\n— Romatec`;
      await wa.sendReply(phone, msg);
      await wa.sendDocument(phone, pdfAssinado.toString('base64'), `Vale-${valeAtualizado.numero}-assinado.pdf`);

      console.log(`[vale:contra-recibo] vale=${valeAtualizado.numero} reenviado pra ${phone}`);

      // 5. Notifica CEO (Telegram)
      try {
        const tgMod = await import('../integrations/telegram');
        const chatId = process.env.TELEGRAM_CEO_CHAT_ID
          || process.env.TELEGRAM_CHAT_ID
          || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
        if (chatId) {
          await tgMod.sendMessage(chatId,
            `✅ Vale ${valeAtualizado.numero} CONFIRMADO\n\n` +
            `Por: ${valeAtualizado.destinatario_nome} (${phone})\n` +
            `Valor: R$ ${(valeAtualizado.valor ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n` +
            `🔗 ${linkValidacao}`
          ).catch(err => console.warn('[vale:notif-ceo]', (err as Error).message));
        }
      } catch (err) {
        console.warn('[vale:telegram-ceo]', (err as Error).message);
      }

      return {
        handled: true,
        acao: 'confirmou_vale',
        vale_id: String(valeAtualizado.id),
      };
    } catch (err) {
      console.error('[vale:processar-confirmar] falha:', (err as Error).message);
      // Status pode ja ter mudado pra confirmado mas envio do contra-recibo falhou.
      // Notifica CEO pra reenviar manualmente. Nao volta status atras.
      try {
        const tgMod = await import('../integrations/telegram');
        const chatId = process.env.TELEGRAM_CEO_CHAT_ID
          || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
        if (chatId) {
          await tgMod.sendMessage(chatId,
            `⚠️ Vale ${vale.numero} CONFIRMADO mas falha no contra-recibo: ${(err as Error).message.slice(0, 200)}`
          ).catch(() => {});
        }
      } catch {}
      return { handled: true, acao: 'confirmou_vale', detalhe: (err as Error).message };
    }
  }

  // ── CONTESTA ──────────────────────────────────────────────────────────
  if (REGEX_CONTESTA_VALE.test(textNorm)) {
    console.log(`[vale:contestacao] vale=${vale.numero} phone=${phone} text="${text.slice(0, 60)}"`);
    try {
      await recibosMod.responderRecibo({
        token: vale.token,
        acao: 'contesta',
        obs: text.slice(0, 1000),
        ip: phone,
        user_agent: 'whatsapp-contesta',
      });
      await wa.sendReply(phone,
        `⚠️ Vale ${vale.numero} marcado como contestado.\nO CEO foi notificado e entrará em contato.\n\n— Romatec`
      );
      try {
        const tgMod = await import('../integrations/telegram');
        const chatId = process.env.TELEGRAM_CEO_CHAT_ID
          || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
        if (chatId) {
          await tgMod.sendMessage(chatId,
            `⚠️ Vale ${vale.numero} CONTESTADO\n\n` +
            `Por: ${vale.destinatario_nome} (${phone})\n` +
            `Mensagem: "${text.slice(0, 400)}"\n\n` +
            `Aguardando sua decisão.`
          ).catch(() => {});
        }
      } catch {}
      return { handled: true, acao: 'contestou_vale', vale_id: String(vale.id) };
    } catch (err) {
      console.error('[vale:processar-contestar] falha:', (err as Error).message);
      return { handled: true, acao: 'contestou_vale', detalhe: (err as Error).message };
    }
  }

  // ── AMBIGUO ───────────────────────────────────────────────────────────
  // Texto que nao bate em CONFIRMA nem CONTESTA. Notifica CEO sem responder
  // colaborador (ZAYRA fica calada — handled=true).
  console.log(`[vale:ambiguo] vale=${vale.numero} phone=${phone} text="${text.slice(0, 60)}"`);
  try {
    const tgMod = await import('../integrations/telegram');
    const chatId = process.env.TELEGRAM_CEO_CHAT_ID
      || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
    if (chatId) {
      await tgMod.sendMessage(chatId,
        `🔔 Resposta inesperada sobre vale ${vale.numero}\n\n` +
        `De: ${vale.destinatario_nome} (${phone})\n` +
        `Mensagem: "${text.slice(0, 400)}"\n\n` +
        `(Não bateu CONFIRMO nem contestação — verifique manualmente.)`
      ).catch(() => {});
    }
  } catch {}
  return { handled: true, acao: 'ambigua_vale', vale_id: String(vale.id) };
}

export async function processarRespostaRecibo(input: {
  phone: string; text: string; messageId?: string;
}): Promise<RespostaProcessada> {
  const phone = input.phone || '';
  const text = (input.text || '').trim();
  if (!text) return { handled: false };

  // v1.99.17: VALE TEM PRIORIDADE sobre quinzenal.
  // Vales sao criados sob demanda (qualquer momento); quinzenal e ciclico.
  // Se ha vale pendente pra esse phone, processa ele e RETORNA.
  // Idempotencia: se vale ja confirmado nas ultimas 24h, responde "ja confirmado".
  try {
    const m = await import('../integrations/recibos');
    const valePendente = await m.buscarValePendentePorPhone(phone);
    if (valePendente) {
      const r = await processarRespostaVale({
        vale: valePendente,
        text,
        phone,
        messageId: input.messageId,
      });
      return r;
    }
    // Sem vale pendente: verifica se ha vale recente CONFIRMADO (idempotencia 24h)
    const valeRecente = await m.buscarValeConfirmadoRecentePorPhone(phone);
    if (valeRecente) {
      const textNormQuick = text.toLowerCase().replace(/[^\w\s]/g, '').trim();
      // So responde "ja confirmado" se o texto parecer ser tentativa de confirmar de novo
      if (/confirm|recebi|sim|ok/.test(textNormQuick)) {
        const baseUrl = (await import('./reciboPdf')).getBaseUrl();
        const link = `${baseUrl}/v/${valeRecente.hash_validacao}`;
        const wa = await import('../integrations/whatsapp');
        await wa.sendReply(phone,
          `✅ ${valeRecente.numero} já foi confirmado anteriormente.\n` +
          `O recibo assinado está com você.\n\n` +
          `🔗 Verificar: ${link}`
        ).catch(err => console.warn('[vale:idempotente]', err.message));
        return { handled: true, acao: 'ja_confirmado_vale' as RespostaProcessada['acao'] };
      }
    }
  } catch (err) {
    console.warn('[vale:roteamento] falha — caindo no fluxo quinzenal:', (err as Error).message);
  }

  const envio = await buscarEnvioPendentePorPhone(phone);
  if (!envio) return { handled: false };

  // Sempre registra a mensagem inbound na trilha de auditoria
  await logarMensagemEnvio(envio.id, 'entrada', 'outro', text, input.messageId);

  // Buscar dados do membro pra mensagens personalizadas
  const [mRows] = await pool.execute<RowDataPacket[]>(
    `SELECT e.nome, e.contact_id, c.tratamento
       FROM romatec_obra_equipe e
       LEFT JOIN contacts c ON c.id = e.contact_id
      WHERE e.id = ?`,
    [envio.membro_id]
  );
  const m = mRows[0] ?? { nome: 'Colaborador', tratamento: null };
  const primeiroNome = String(m.nome).split(' ')[0];
  const tratNome = m.tratamento ? `${m.tratamento} ${primeiroNome}` : primeiroNome;

  // Buscar info do lote pra mensagem ao CEO se necessário
  const [loteRows] = await pool.execute<LoteRow[]>(
    `SELECT * FROM recibos_envios_lotes WHERE id = ?`, [envio.lote_id]
  );
  const lote = loteRows[0];
  const numeroLote = lote?.numero ?? `lote#${envio.lote_id}`;

  // v1.65.21: normaliza emojis tipo 1️⃣ 2️⃣ ✅ ❌ pros regex baterem.
  // Remove variation selector + keycap combiner que aparecem em "1️⃣"
  // (sequência U+0031 U+FE0F U+20E3). Também remove emojis genéricos pra
  // sobrar só palavras + dígitos.
  const textNorm = text.replace(/[️⃣]/g, '').replace(/^\s*[\p{Emoji}\s]+/u, '').trim();

  // Testa CONTESTA antes de CONFIRMA pra "não confirmo"/"não confere" caírem corretos
  // ── ESTADO 1: enviado_aguardando_confirmacao → espera 1/2 ──
  if (envio.status === 'enviado_aguardando_confirmacao') {
    if (REGEX_CONTESTA.test(textNorm) || /errad|incorret|valor\s*err|n[ãa]o\s*confer|t[au]\s*err|n[ãa]o\s*est[áa]\s*certo|n[ãa]o\s*confir/i.test(textNorm)) {
      await pool.execute(
        `UPDATE recibos_envios
            SET status = 'contestado',
                contestacao_motivo = ?,
                contestacao_repassada_ceo_em = NOW()
          WHERE id = ?`,
        [text.slice(0, 1000), envio.id]
      );
      await logarMensagemEnvio(envio.id, 'entrada', 'contestacao', text, input.messageId);
      await notificarCeo(
        `⚠️ CONTESTAÇÃO de recibo\n\n` +
        `Colaborador: ${m.nome} (${phone})\n` +
        `Lote: ${numeroLote}\n` +
        `Valor enviado: ${formatBRL(Number(envio.valor))}\n` +
        `Resposta dele: "${text.slice(0, 400)}"\n\n` +
        `Aguardando sua decisão.`
      );
      return { handled: true, acao: 'contestou', envio_id: String(envio.id) };
    }

    if (REGEX_CONFIRMA.test(textNorm)) {
      await pool.execute(
        `UPDATE recibos_envios
            SET status = 'confirmado_aguardando_pix',
                confirmado_em = NOW(),
                confirmacao_resposta = ?,
                confirmacao_numero_origem = ?,
                confirmacao_message_id = ?
          WHERE id = ?`,
        [text.slice(0, 1000), phone, input.messageId ?? null, envio.id]
      );
      const msg2 = (
        `Perfeito, ${tratNome}. Confirmação registrada. ✅\n\n` +
        `Para finalizar:\n\n` +
        `🅰️ *Se ainda NÃO recebeu o pagamento*: me envie sua chave PIX (CPF / Telefone / E-mail / Chave aleatória).\n\n` +
        `🅱️ *Se JÁ recebeu o pagamento*: responda *"recebi"* que registramos como pago.`
      );
      const r = await sendReply(phone, msg2);
      await logarMensagemEnvio(envio.id, 'saida', 'solicitacao_pix', msg2, r.messageId);
      return { handled: true, acao: 'confirmou', envio_id: String(envio.id) };
    }

    // Ambíguo: repassa ao CEO mas NÃO responde colaborador (evita engessar
    // num caminho errado). CEO decide o que fazer.
    await notificarCeo(
      `🔔 Resposta inesperada sobre recibo\n\n` +
      `Colaborador: ${m.nome} (${phone})\n` +
      `Lote: ${numeroLote}\n` +
      `Valor: ${formatBRL(Number(envio.valor))}\n` +
      `Esperando confirmação 1/2 — recebi: "${text.slice(0, 400)}"\n\n` +
      `Eu não respondi. Você decide.`
    );
    return { handled: true, acao: 'ambiguo', envio_id: String(envio.id), detalhe: 'aguardando_confirmacao_resposta_inesperada' };
  }

  // ── ESTADO 2: confirmado_aguardando_pix → espera chave PIX OU "já recebi" ──
  if (envio.status === 'confirmado_aguardando_pix') {
    // v1.65.19: opção "já recebi" pula PIX e marca como pago direto
    if (/^\s*(recebi|j[áa]\s*recebi|recebido|pago|já\s*pago|paguei|👌|ok\s*recebi)\s*\.?\s*$/i.test(text)) {
      await pool.execute(
        `UPDATE recibos_envios
            SET status = 'pago', pago_em = NOW(),
                pix_recebido_em = COALESCE(pix_recebido_em, NOW()),
                chave_pix = COALESCE(chave_pix, 'recebido_sem_pix_informado')
          WHERE id = ?`,
        [envio.id]
      );
      const msgFinal2 = (
        `Show, ${tratNome}! ✅\n\n` +
        `Recebimento confirmado por você. Marquei como pago.\n\n` +
        `Obrigado!`
      );
      const r = await sendReply(phone, msgFinal2);
      await logarMensagemEnvio(envio.id, 'entrada', 'pix', `[CONFIRMOU JÁ RECEBIDO] ${text}`, input.messageId);
      await logarMensagemEnvio(envio.id, 'saida', 'aviso', msgFinal2, r.messageId);
      await notificarCeo(
        `✅ ${m.nome} confirmou que JÁ RECEBEU\n\n` +
        `Lote: ${numeroLote}\n` +
        `Valor: ${formatBRL(Number(envio.valor))}\n\n` +
        `Status: pago. _(Sem chave PIX — pagamento prévio.)_`
      );
      return { handled: true, acao: 'pix_registrado', envio_id: String(envio.id), detalhe: 'pago_sem_pix' };
    }

    const det = detectarTipoPix(text);
    if (det.tipo && !det.ambiguo) {
      await pool.execute(
        `UPDATE recibos_envios
            SET status = 'pix_recebido',
                pix_recebido_em = NOW(),
                chave_pix = ?,
                tipo_chave_pix = ?
          WHERE id = ?`,
        [det.chave.slice(0, 150), det.tipo, envio.id]
      );
      // Atualiza histórico no membro (chave atual + timestamp)
      await pool.execute(
        `UPDATE romatec_obra_equipe
            SET chave_pix = ?, chave_pix_atualizada_em = NOW()
          WHERE id = ?`,
        [det.chave.slice(0, 150), envio.membro_id]
      );
      const msgFinal = (
        `Recebido, ${tratNome}. Chave PIX confirmada. ✅\n\n` +
        `Seu pagamento de ${formatBRL(Number(envio.valor))} será efetuado em breve.\n\n` +
        `Obrigado!`
      );
      const r = await sendReply(phone, msgFinal);
      await logarMensagemEnvio(envio.id, 'entrada', 'pix', `${det.tipo}: ${det.chave}`, input.messageId);
      await logarMensagemEnvio(envio.id, 'saida', 'aviso', msgFinal, r.messageId);
      // Notifica CEO pra ele saber que tem PIX pronto pra pagar
      await notificarCeo(
        `💳 PIX confirmado\n\n` +
        `Colaborador: ${m.nome}\n` +
        `Lote: ${numeroLote}\n` +
        `Valor: ${formatBRL(Number(envio.valor))}\n` +
        `Tipo: ${det.tipo}\n` +
        `Chave: ${det.chave}\n\n` +
        `Pronto pra pagar.`
      );
      return { handled: true, acao: 'pix_registrado', envio_id: String(envio.id) };
    }

    // Ambíguo: repassa ao CEO + pergunta confirmação suave ao colaborador
    const msgConfirma = (
      `${tratNome}, recebi: "${text.slice(0, 100)}"\n\n` +
      `Não consegui identificar como chave PIX. Pode reenviar no formato:\n` +
      `CPF (só números) / Telefone com DDD / E-mail / Chave aleatória?`
    );
    const r = await sendReply(phone, msgConfirma);
    await logarMensagemEnvio(envio.id, 'saida', 'aviso', msgConfirma, r.messageId);
    await notificarCeo(
      `🔔 Chave PIX ambígua de ${m.nome}\n\n` +
      `Lote: ${numeroLote}\n` +
      `Recebi: "${text.slice(0, 200)}"\n\n` +
      `Pedi pra ele reenviar formatado. Acompanha.`
    );
    return { handled: true, acao: 'ambiguo', envio_id: String(envio.id), detalhe: 'pix_ambiguo' };
  }

  // Status inesperado — não toca, deixa fluxo normal seguir
  return { handled: false };
}

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║ v1.65.19 — CONFIRMAÇÃO WEB (link clicável que vira botão no WhatsApp)    ║
// ║ Página pública /recibos/confirmar/:token mostra dados + botões objetivos.║
// ║ Mesma state machine do webhook texto: enviado → confirmado → pix → pago. ║
// ╚═════════════════════════════════════════════════════════════════════════╝

interface EnvioConfirmacaoRow extends RowDataPacket {
  id: number; lote_id: number; membro_id: number;
  telefone: string | null; valor: string;
  status: string; recibo_hash: string | null;
  token_confirmacao: string;
  enviado_em: Date | null; confirmado_em: Date | null; pago_em: Date | null;
}

async function buscarEnvioPorToken(token: string): Promise<EnvioConfirmacaoRow | null> {
  if (!token || token.length < 10) return null;
  const [rows] = await pool.execute<EnvioConfirmacaoRow[]>(
    `SELECT * FROM recibos_envios WHERE token_confirmacao = ? LIMIT 1`, [token]
  );
  return rows[0] ?? null;
}

export async function gerarHtmlConfirmacaoWeb(token: string, mensagemFlash?: { tipo: 'ok'|'erro'; texto: string }): Promise<string> {
  const envio = await buscarEnvioPorToken(token);
  if (!envio) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recibo não encontrado</title>
<style>body{font-family:sans-serif;text-align:center;padding:40px;background:#0a1a0f;color:#e5e7eb;}h1{color:#ef4444;}</style>
</head><body><h1>⚠️ Link inválido ou expirado</h1>
<p>Esse link de confirmação não corresponde a nenhum recibo. Procure o seu administrador.</p>
</body></html>`;
  }
  const [mRows] = await pool.execute<RowDataPacket[]>(
    `SELECT e.nome, e.cpf, e.funcao, c.tratamento
       FROM romatec_obra_equipe e
       LEFT JOIN contacts c ON c.id = e.contact_id
      WHERE e.id = ?`, [envio.membro_id]
  );
  const m = mRows[0] ?? { nome: 'Colaborador', cpf: null, funcao: null, tratamento: null };
  const [loteRows] = await pool.execute<LoteRow[]>(`SELECT * FROM recibos_envios_lotes WHERE id = ?`, [envio.lote_id]);
  const lote = loteRows[0];
  const periodo = parsePeriodo(lote.periodo);
  const t = await getTenantSettings(1).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliária';
  const cor   = t?.primary_color || '#10b981';
  const trat  = m.tratamento ? `${m.tratamento} ` : '';
  const nomeCheio = `${trat}${m.nome}`;
  const valor = Number(envio.valor);

  const flash = mensagemFlash
    ? `<div style="background:${mensagemFlash.tipo === 'ok' ? '#dcfce7' : '#fee2e2'};color:${mensagemFlash.tipo === 'ok' ? '#15803d' : '#b91c1c'};padding:12px;border-radius:8px;margin-bottom:16px;text-align:center;font-weight:600;">${mensagemFlash.texto}</div>`
    : '';

  // Conteúdo varia por estado
  let conteudo: string;
  if (envio.status === 'enviado_aguardando_confirmacao') {
    conteudo = `
      <p style="font-size:15px; line-height:1.6;">Olá, <strong>${nomeCheio}</strong>.</p>
      <p style="font-size:15px; line-height:1.6;">Recibo da <strong>${periodo.label}</strong>, no valor de <strong style="color:${cor};">${formatBRL(valor)}</strong>.</p>
      <p style="font-size:14px; color:#666; line-height:1.5;">Confirme se está tudo certo:</p>
      <form method="POST" action="/recibos/confirmar/${token}/confirma" style="margin:18px 0;">
        <button type="submit" style="width:100%; padding:18px; background:${cor}; color:#fff; border:0; border-radius:10px; font-size:16px; font-weight:600; cursor:pointer;">✅ Confirmo, está tudo certo</button>
      </form>
      <form method="POST" action="/recibos/confirmar/${token}/contesta" onsubmit="return confirm('Tem certeza que o valor está incorreto? O administrador será avisado.');">
        <button type="submit" style="width:100%; padding:14px; background:#fff; color:#b91c1c; border:2px solid #b91c1c; border-radius:10px; font-size:14px; font-weight:600; cursor:pointer;">⚠️ Não está correto</button>
      </form>
    `;
  } else if (envio.status === 'confirmado_aguardando_pix') {
    conteudo = `
      <p style="font-size:15px; line-height:1.6;">Olá, <strong>${nomeCheio}</strong>. Confirmação registrada ✅</p>
      <p style="font-size:15px; line-height:1.6;">Valor: <strong style="color:${cor};">${formatBRL(valor)}</strong></p>
      <hr style="margin:18px 0; border:none; border-top:1px solid #374151;">
      <h3 style="color:${cor}; margin:0 0 8px;">🅱️ Já recebeu o pagamento?</h3>
      <form method="POST" action="/recibos/confirmar/${token}/recebido" style="margin-bottom:18px;">
        <button type="submit" style="width:100%; padding:14px; background:#15803d; color:#fff; border:0; border-radius:10px; font-size:15px; font-weight:600; cursor:pointer;">✅ Sim, já recebi — registrar como pago</button>
      </form>
      <hr style="margin:18px 0; border:none; border-top:1px solid #374151;">
      <h3 style="color:${cor}; margin:0 0 8px;">🅰️ Ainda NÃO recebeu? Envie sua chave PIX:</h3>
      <form method="POST" action="/recibos/confirmar/${token}/pix">
        <select name="tipo_chave_pix" required style="width:100%; padding:12px; margin-bottom:8px; border-radius:8px; background:#1f2937; color:#fff; border:1px solid #374151;">
          <option value="">— Tipo da chave —</option>
          <option value="cpf">CPF</option>
          <option value="cnpj">CNPJ</option>
          <option value="email">E-mail</option>
          <option value="telefone">Telefone</option>
          <option value="aleatoria">Chave aleatória (UUID)</option>
        </select>
        <input name="chave_pix" required placeholder="Chave PIX" style="width:100%; padding:12px; margin-bottom:8px; border-radius:8px; background:#1f2937; color:#fff; border:1px solid #374151; font-size:15px;">
        <button type="submit" style="width:100%; padding:16px; background:${cor}; color:#fff; border:0; border-radius:10px; font-size:16px; font-weight:600; cursor:pointer;">Enviar PIX</button>
      </form>
    `;
  } else if (envio.status === 'pix_recebido' || envio.status === 'pago') {
    const labelStatus = envio.status === 'pago' ? 'PAGO ✅' : 'PIX recebido — pagamento em curso ⏳';
    conteudo = `
      <p style="font-size:15px; line-height:1.6;">Olá, <strong>${nomeCheio}</strong>.</p>
      <div style="background:#dcfce7; color:#15803d; padding:18px; border-radius:10px; text-align:center; font-weight:600; font-size:17px; margin:18px 0;">${labelStatus}</div>
      <p style="font-size:14px; color:#888;">Valor: <strong>${formatBRL(valor)}</strong> · ${periodo.label}</p>
      <p style="font-size:13px; color:#666; margin-top:18px;">Se houver alguma divergência, fale direto com o administrador.</p>
    `;
  } else if (envio.status === 'contestado') {
    conteudo = `
      <p style="font-size:15px; line-height:1.6;">Olá, <strong>${nomeCheio}</strong>.</p>
      <div style="background:#fef3c7; color:#92400e; padding:18px; border-radius:10px; text-align:center; font-weight:600; font-size:15px; margin:18px 0;">⚠️ Sua contestação foi registrada.</div>
      <p style="font-size:14px; color:#888;">O administrador vai entrar em contato para resolver.</p>
    `;
  } else {
    conteudo = `<p style="font-size:14px; color:#888;">Status atual: <code>${envio.status}</code>. Sem ação disponível neste momento.</p>`;
  }

  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recibo — ${nomeCheio} — ${periodo.label}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a1a0f;color:#e5e7eb;margin:0;padding:0;min-height:100vh;}
  .wrap{max-width:480px;margin:0 auto;padding:24px;}
  .header{text-align:center;border-bottom:3px solid ${cor};padding-bottom:16px;margin-bottom:20px;}
  .header h1{margin:8px 0 4px;font-size:18px;color:${cor};}
  .header p{margin:0;font-size:12px;color:#888;}
  .card{background:#0f1f15;border:1px solid #1e3a2a;border-radius:12px;padding:20px;margin-bottom:16px;}
  button:hover{opacity:0.92;}
  input,select{font-family:inherit;}
  a{color:${cor};}
</style>
</head><body><div class="wrap">
  <div class="header">
    <h1>${brand}</h1>
    <p>Confirmação de Recibo</p>
  </div>
  ${flash}
  <div class="card">${conteudo}</div>
  <p style="text-align:center;font-size:11px;color:#555;margin-top:18px;">Gerado por ZAYRA</p>
</div></body></html>`;
}

// Processadores das ações via web (POST). Reutilizam a state machine
// do webhook texto pra manter comportamento consistente.
export async function confirmarRecibosViaWeb(input: {
  token: string; acao: 'confirma' | 'contesta' | 'pix' | 'recebido';
  chave_pix?: string; tipo_chave_pix?: TipoChavePix;
  ip?: string; userAgent?: string;
}): Promise<{ ok: boolean; status: string; mensagem: string; novoStatus?: string }> {
  const envio = await buscarEnvioPorToken(input.token);
  if (!envio) return { ok: false, status: 'token_invalido', mensagem: 'Link inválido ou expirado.' };

  const audit = `web (${input.ip ?? '?'} | ${(input.userAgent ?? '').slice(0, 80)})`;

  // Buscar dados membro/lote pra notificações
  const [mRows] = await pool.execute<RowDataPacket[]>(
    `SELECT e.nome, c.tratamento FROM romatec_obra_equipe e
       LEFT JOIN contacts c ON c.id = e.contact_id WHERE e.id = ?`, [envio.membro_id]
  );
  const m = mRows[0] ?? { nome: 'Colaborador', tratamento: null };
  const [loteRows] = await pool.execute<LoteRow[]>(`SELECT numero FROM recibos_envios_lotes WHERE id = ?`, [envio.lote_id]);
  const numeroLote = loteRows[0]?.numero ?? `lote#${envio.lote_id}`;
  const valorBR = formatBRL(Number(envio.valor));

  if (input.acao === 'confirma') {
    if (envio.status !== 'enviado_aguardando_confirmacao') {
      return { ok: false, status: envio.status, mensagem: 'Já confirmado anteriormente.' };
    }
    await pool.execute(
      `UPDATE recibos_envios
          SET status = 'confirmado_aguardando_pix', confirmado_em = NOW(),
              confirmacao_resposta = ?, confirmacao_numero_origem = ?
        WHERE id = ?`,
      [`[WEB] ${audit}`, envio.telefone ?? null, envio.id]
    );
    await logarMensagemEnvio(envio.id, 'entrada', 'confirmacao', `[WEB] confirmou via link — ${audit}`, null);
    return { ok: true, status: 'confirmado_aguardando_pix', mensagem: 'Confirmação registrada.', novoStatus: 'confirmado_aguardando_pix' };
  }

  if (input.acao === 'contesta') {
    if (envio.status !== 'enviado_aguardando_confirmacao') {
      return { ok: false, status: envio.status, mensagem: 'Status já alterado anteriormente.' };
    }
    await pool.execute(
      `UPDATE recibos_envios
          SET status = 'contestado',
              contestacao_motivo = ?, contestacao_repassada_ceo_em = NOW()
        WHERE id = ?`,
      [`[WEB] contestado via link — ${audit}`, envio.id]
    );
    await logarMensagemEnvio(envio.id, 'entrada', 'contestacao', `[WEB] contestou via link — ${audit}`, null);
    await notificarCeo(
      `⚠️ CONTESTAÇÃO via link\n\n${m.nome}\nLote: ${numeroLote}\nValor: ${valorBR}\n\n_(Marcou "Não está correto" no link.)_`
    );
    return { ok: true, status: 'contestado', mensagem: 'Sua contestação foi registrada. O administrador vai te procurar.', novoStatus: 'contestado' };
  }

  if (input.acao === 'recebido') {
    if (!['enviado_aguardando_confirmacao', 'confirmado_aguardando_pix'].includes(envio.status)) {
      return { ok: false, status: envio.status, mensagem: 'Esta etapa já foi finalizada.' };
    }
    await pool.execute(
      `UPDATE recibos_envios
          SET status = 'pago', pago_em = NOW(),
              pix_recebido_em = COALESCE(pix_recebido_em, NOW()),
              chave_pix = COALESCE(chave_pix, 'recebido_sem_pix_informado'),
              confirmado_em = COALESCE(confirmado_em, NOW())
        WHERE id = ?`,
      [envio.id]
    );
    await logarMensagemEnvio(envio.id, 'entrada', 'pix', `[WEB] confirmou já recebido — ${audit}`, null);
    await notificarCeo(
      `✅ ${m.nome} marcou JÁ RECEBIDO via link\n\nLote: ${numeroLote}\nValor: ${valorBR}\nStatus: pago. _(Sem chave PIX — pagamento prévio.)_`
    );
    return { ok: true, status: 'pago', mensagem: 'Recebimento confirmado. Marcado como pago.', novoStatus: 'pago' };
  }

  if (input.acao === 'pix') {
    if (envio.status !== 'confirmado_aguardando_pix') {
      return { ok: false, status: envio.status, mensagem: 'Para enviar PIX, primeiro confirme o recibo.' };
    }
    const chave = (input.chave_pix ?? '').trim();
    const tipo  = input.tipo_chave_pix;
    if (!chave || !tipo) {
      return { ok: false, status: envio.status, mensagem: 'Tipo e chave PIX são obrigatórios.' };
    }
    await pool.execute(
      `UPDATE recibos_envios
          SET status = 'pix_recebido', pix_recebido_em = NOW(),
              chave_pix = ?, tipo_chave_pix = ?
        WHERE id = ?`,
      [chave.slice(0, 150), tipo, envio.id]
    );
    await pool.execute(
      `UPDATE romatec_obra_equipe SET chave_pix = ?, chave_pix_atualizada_em = NOW() WHERE id = ?`,
      [chave.slice(0, 150), envio.membro_id]
    );
    await logarMensagemEnvio(envio.id, 'entrada', 'pix', `[WEB] ${tipo}: ${chave} — ${audit}`, null);
    await notificarCeo(
      `💳 PIX recebido via link\n\n${m.nome}\nLote: ${numeroLote}\nValor: ${valorBR}\nTipo: ${tipo}\nChave: ${chave}\n\nPronto pra pagar.`
    );
    return { ok: true, status: 'pix_recebido', mensagem: 'Chave PIX registrada. Pagamento será efetuado em breve.', novoStatus: 'pix_recebido' };
  }

  return { ok: false, status: envio.status, mensagem: 'Ação inválida.' };
}

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║ PR B.4 — COMANDOS DO CEO (gerenciar lote em curso)                       ║
// ║   - marcar_recibo_pago: status pix_recebido → pago                       ║
// ║   - reenviar_recibos_lote: refaz disparo dos pendentes / expirados       ║
// ║   - expirar_recibos_antigos: status → expirado se mais de N horas sem    ║
// ║     resposta (também roda em ticker automático a cada 6h)                ║
// ╚═════════════════════════════════════════════════════════════════════════╝

interface MarcarPagoInput {
  envio_id?: string;          // marca apenas 1
  lote_id?: string;           // todos pix_recebidos do lote
  todos_pix_recebidos?: boolean; // todos pix_recebidos sem filtro de lote (cuidado!)
  pago_por?: string;          // ex: 'CEO Romário via WhatsApp'
}
export async function marcarReciboPago(input: MarcarPagoInput): Promise<{
  ok: true; total: number; envios: Array<{ id: string; nome: string; valor: number }>; message: string;
}> {
  let where = '';
  const params: (string | number)[] = [];

  if (input.envio_id) {
    where = 'id = ?';
    params.push(Number(input.envio_id));
  } else if (input.lote_id) {
    where = "lote_id = ? AND status = 'pix_recebido'";
    params.push(Number(input.lote_id));
  } else if (input.todos_pix_recebidos) {
    where = "status = 'pix_recebido'";
  } else {
    throw new Error('informe envio_id, lote_id ou todos_pix_recebidos:true');
  }

  // Lista os envios afetados antes do UPDATE pra retornar nomes
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT v.id, v.valor, e.nome
       FROM recibos_envios v
       LEFT JOIN romatec_obra_equipe e ON e.id = v.membro_id
      WHERE ${where}
        AND v.status IN ('pix_recebido', 'pago')`,
    params
  );
  if (!rows.length) {
    return { ok: true, total: 0, envios: [], message: 'Nenhum envio elegível encontrado (precisa estar em pix_recebido ou pago).' };
  }

  await pool.execute(
    `UPDATE recibos_envios
        SET status = 'pago',
            pago_em = COALESCE(pago_em, NOW())
      WHERE ${where}
        AND status = 'pix_recebido'`,
    params
  );

  const envios = rows.map(r => ({
    id: String(r.id), nome: String(r.nome ?? '(removido)'), valor: Number(r.valor),
  }));

  // Auditoria: registra "pago" como mensagem do tipo aviso
  for (const e of envios) {
    await logarMensagemEnvio(Number(e.id), 'saida', 'aviso',
      `Marcado como pago${input.pago_por ? ' por ' + input.pago_por : ''}`, null);
  }

  return {
    ok: true,
    total: envios.length,
    envios,
    message: `${envios.length} envio(s) marcado(s) como pago.`,
  };
}

// Re-dispara recibos pendentes (sem confirmação) ou expirados.
// Por padrão pega os com status enviado_aguardando_confirmacao há mais de 24h.
// CEO pode forçar status_alvo específico ou horas mínimas customizadas.
interface ReenviarInput {
  lote_id?: string;
  status_alvo?: 'enviado_aguardando_confirmacao' | 'confirmado_aguardando_pix' | 'falha_envio' | 'expirado';
  horas_minimas?: number;
  baseUrl?: string;
  confirm?: boolean;          // sem confirm → preview
}
export async function reenviarRecibos(input: ReenviarInput): Promise<{
  modo: 'preview' | 'reenviado';
  candidatos?: Array<{ id: string; nome: string; status: string; tentativas: number; horas_desde_envio: number }>;
  total?: number; sucesso?: number; falhas?: number;
  message: string;
}> {
  const status = input.status_alvo || 'enviado_aguardando_confirmacao';
  // v1.65.20: se CEO especificou lote_id, ele já escolheu — sem proteção anti-spam.
  // Default 24h só vale pra reenvio "geral" (sem lote). Filtrado por lote → 0h.
  const defaultHoras = (status === 'enviado_aguardando_confirmacao' && !input.lote_id) ? 24 : 0;
  const horas = Number(input.horas_minimas ?? defaultHoras);

  let where = `v.status = ?`;
  const params: (string | number)[] = [status];
  if (input.lote_id) {
    where += ` AND v.lote_id = ?`;
    params.push(Number(input.lote_id));
  }
  if (horas > 0) {
    where += ` AND v.enviado_em IS NOT NULL AND v.enviado_em < (NOW() - INTERVAL ? HOUR)`;
    params.push(horas);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT v.id, v.lote_id, v.membro_id, v.telefone, v.valor, v.status,
            v.tentativas_envio, v.enviado_em, e.nome,
            TIMESTAMPDIFF(HOUR, v.enviado_em, NOW()) AS horas_desde_envio
       FROM recibos_envios v
       LEFT JOIN romatec_obra_equipe e ON e.id = v.membro_id
      WHERE ${where}
      ORDER BY v.enviado_em ASC`,
    params
  );

  const candidatos = rows.map(r => ({
    id: String(r.id),
    nome: String(r.nome ?? '(removido)'),
    status: String(r.status),
    tentativas: Number(r.tentativas_envio ?? 0),
    horas_desde_envio: Number(r.horas_desde_envio ?? 0),
  }));

  if (!input.confirm) {
    return {
      modo: 'preview',
      candidatos,
      message: candidatos.length === 0
        ? `Nenhum envio elegível para reenvio (status=${status}${horas ? `, parado há mais de ${horas}h` : ''}).`
        : `[PREVIEW REENVIO] ${candidatos.length} envio(s) candidato(s):\n` +
          candidatos.slice(0, 30).map(c => `• ${c.nome} — status ${c.status} há ${c.horas_desde_envio}h (${c.tentativas} tentativa[s])`).join('\n') +
          `\n\nReenvie com confirm:true pra disparar de novo.`,
    };
  }

  // Re-dispara: gera PDF + manda novamente. Reusa lógica de dispararLote
  // mas iterando manualmente porque dispararLote pega só status='pendente_envio'.
  let sucesso = 0, falhas = 0;
  for (const c of candidatos) {
    try {
      const [vRows] = await pool.execute<EnvioRow[]>(
        `SELECT * FROM recibos_envios WHERE id = ?`, [Number(c.id)]
      );
      const v = vRows[0];
      if (!v?.telefone) { falhas++; continue; }

      const [loteRows] = await pool.execute<LoteRow[]>(
        `SELECT * FROM recibos_envios_lotes WHERE id = ?`, [v.lote_id]
      );
      const lote = loteRows[0];
      const periodo = parsePeriodo(lote.periodo);

      const pdf = await gerarReciboQuinzenalPdf({
        membro_id: String(v.membro_id), periodo: periodo.codigo, baseUrl: input.baseUrl,
      });

      const [mRows2] = await pool.execute<RowDataPacket[]>(
        `SELECT e.nome, c.tratamento, c.tom
           FROM romatec_obra_equipe e
           LEFT JOIN contacts c ON c.id = e.contact_id
          WHERE e.id = ?`, [v.membro_id]
      );
      const m = mRows2[0] || { nome: 'Colaborador', tratamento: null, tom: null };

      // Reusa token existente ou gera novo (se foi um envio inicial sem token)
      let token: string;
      if (v.recibo_hash && (v as unknown as { token_confirmacao?: string }).token_confirmacao) {
        token = String((v as unknown as { token_confirmacao: string }).token_confirmacao);
      } else {
        const [tokRows] = await pool.execute<RowDataPacket[]>(
          `SELECT token_confirmacao FROM recibos_envios WHERE id = ?`, [v.id]
        );
        if (tokRows[0]?.token_confirmacao) {
          token = String(tokRows[0].token_confirmacao);
        } else {
          token = gerarToken();
          await pool.execute(`UPDATE recibos_envios SET token_confirmacao = ? WHERE id = ?`, [token, v.id]);
        }
      }
      const linkConfirmacao = input.baseUrl
        ? `${input.baseUrl.replace(/\/$/, '')}/recibos/confirmar/${token}`
        : undefined;

      const fileName = `Recibo_${String(m.nome).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}_${periodo.codigo}.pdf`;
      const docRes = await sendDocument(v.telefone, pdf.buffer.toString('base64'), fileName);
      const cabecalho = montarCabecalhoMensagem({
        nome: String(m.nome),
        tratamento: m.tratamento as string | null,
        periodo,
        valor: Number(v.valor),
      }) + `\n\n_(reenvio — caso já tenha respondido, ignore)_`;
      const txt = montarMensagemEnvio({
        nome: String(m.nome),
        tratamento: m.tratamento as string | null,
        tom: m.tom as string | null,
        periodo,
        valor: Number(v.valor),
        linkConfirmacao,
      }) + `\n\n_(reenvio — caso já tenha respondido, ignore)_`;
      const txtRes = await enviarMensagemConfirmacao({
        telefone: v.telefone,
        cabecalho,
        linkConfirmacao,
        textoFallback: txt,
      });

      await pool.execute(
        `UPDATE recibos_envios
            SET status = 'enviado_aguardando_confirmacao',
                enviado_em = NOW(),
                tentativas_envio = tentativas_envio + 1,
                recibo_hash = ?,
                ultimo_erro = NULL
          WHERE id = ?`,
        [pdf.hash, v.id]
      );
      await logarMensagemEnvio(v.id, 'saida', 'pdf_recibo', `[REENVIO] ${fileName}`, docRes.messageId ?? null);
      await logarMensagemEnvio(v.id, 'saida', 'solicitacao_confirmacao', txt, txtRes.messageId ?? null);
      sucesso++;
    } catch (err) {
      falhas++;
      console.warn(`[recibos] reenvio falhou pro envio ${c.id}:`, (err as Error).message);
    }
  }

  return {
    modo: 'reenviado',
    candidatos,
    total: candidatos.length,
    sucesso, falhas,
    message: `Reenvio concluído: ${sucesso} sucesso(s), ${falhas} falha(s) de ${candidatos.length} candidato(s).`,
  };
}

// Marca como expirado quem está em enviado_aguardando_confirmacao há mais
// de N horas (default 48) e notifica o CEO. Roda manualmente ou via ticker.
export async function expirarRecibosAntigos(input: { horas?: number; notificar_ceo?: boolean } = {}): Promise<{
  ok: true; total_expirados: number;
  expirados: Array<{ id: string; nome: string; valor: number; horas: number; lote_numero: string }>;
}> {
  const horas = Number(input.horas ?? 48);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT v.id, v.valor, v.lote_id,
            TIMESTAMPDIFF(HOUR, v.enviado_em, NOW()) AS horas,
            e.nome, l.numero AS lote_numero
       FROM recibos_envios v
       LEFT JOIN romatec_obra_equipe e ON e.id = v.membro_id
       LEFT JOIN recibos_envios_lotes l ON l.id = v.lote_id
      WHERE v.status = 'enviado_aguardando_confirmacao'
        AND v.enviado_em IS NOT NULL
        AND v.enviado_em < (NOW() - INTERVAL ? HOUR)
      ORDER BY v.enviado_em ASC`,
    [horas]
  );
  if (!rows.length) return { ok: true, total_expirados: 0, expirados: [] };

  const expirados = rows.map(r => ({
    id: String(r.id),
    nome: String(r.nome ?? '(removido)'),
    valor: Number(r.valor),
    horas: Number(r.horas),
    lote_numero: String(r.lote_numero ?? '?'),
  }));

  await pool.execute(
    `UPDATE recibos_envios
        SET status = 'expirado'
      WHERE status = 'enviado_aguardando_confirmacao'
        AND enviado_em IS NOT NULL
        AND enviado_em < (NOW() - INTERVAL ? HOUR)`,
    [horas]
  );

  for (const e of expirados) {
    await logarMensagemEnvio(Number(e.id), 'saida', 'aviso',
      `Expirado automaticamente após ${e.horas}h sem confirmação`, null);
  }

  if (input.notificar_ceo !== false) {
    await notificarCeo(
      `⏰ ${expirados.length} recibo(s) expirado(s) sem resposta após ${horas}h:\n\n` +
      expirados.slice(0, 30).map(e =>
        `• ${e.nome} — ${formatBRL(e.valor)} (lote ${e.lote_numero}, ${e.horas}h sem resposta)`
      ).join('\n') +
      `\n\nQuer que eu reenvie? Diga "ZAYRA, reenvia os recibos expirados".`
    );
  }

  return { ok: true, total_expirados: expirados.length, expirados };
}

// Ticker automático: roda a cada 6h e expira recibos com mais de 48h.
// Iniciado em src/server.ts no boot. Silencioso em DEV (sem CEO_WHATSAPP_PHONE).
let _expiracaoTickerStarted = false;
export function startExpiracaoRecibosTicker(): void {
  if (_expiracaoTickerStarted) return;
  _expiracaoTickerStarted = true;
  const HOURS = 6;
  const ms = HOURS * 60 * 60 * 1000;
  console.log(`[recibos] ticker de expiração iniciado (a cada ${HOURS}h, limite 48h sem resposta)`);
  setInterval(() => {
    expirarRecibosAntigos({ horas: 48 })
      .then(r => {
        if (r.total_expirados > 0) {
          console.log(`[recibos] ${r.total_expirados} envio(s) expirado(s) automaticamente`);
        }
      })
      .catch(err => console.warn('[recibos] ticker expiração falhou:', (err as Error).message));
  }, ms);
}

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║ v1.65.20 — Controle MANUAL individual no modal Recibo (CEO)              ║
// ║ Endpoints pra:                                                            ║
// ║   1) buscar status do envio mais recente desse colaborador no período    ║
// ║   2) disparar mini-lote só pra UM colaborador (sem precisar quinzena    ║
// ║      inteira)                                                             ║
// ║   3) avançar status manualmente sem passar pelo fluxo do colaborador      ║
// ╚═════════════════════════════════════════════════════════════════════════╝

interface EnvioStatusRow extends RowDataPacket {
  id: number; lote_id: number; lote_numero: string;
  membro_id: number; telefone: string | null;
  valor: string; status: string;
  enviado_em: Date | null; confirmado_em: Date | null;
  pix_recebido_em: Date | null; pago_em: Date | null;
  chave_pix: string | null; tipo_chave_pix: string | null;
  contestacao_motivo: string | null;
  tentativas_envio: number; ultimo_erro: string | null;
  recibo_hash: string | null; token_confirmacao: string | null;
}

export async function buscarStatusEnvioColaborador(input: {
  membro_id: string; periodo: string;
}): Promise<{ envio: EnvioStatusRow | null; mensagens: Array<{ direcao: string; tipo: string; conteudo: string; enviado_em: Date }> }> {
  const [rows] = await pool.execute<EnvioStatusRow[]>(
    `SELECT v.*, l.numero AS lote_numero
       FROM recibos_envios v
       JOIN recibos_envios_lotes l ON l.id = v.lote_id
      WHERE v.membro_id = ? AND l.periodo = ?
      ORDER BY v.criado_em DESC LIMIT 1`,
    [Number(input.membro_id), input.periodo]
  );
  const envio = rows[0] ?? null;
  if (!envio) return { envio: null, mensagens: [] };

  const [msgs] = await pool.execute<RowDataPacket[]>(
    `SELECT direcao, tipo, conteudo, enviado_em
       FROM recibos_envios_mensagens
      WHERE envio_id = ? ORDER BY enviado_em ASC LIMIT 30`,
    [envio.id]
  );
  return {
    envio,
    mensagens: msgs.map(r => ({
      direcao: String(r.direcao), tipo: String(r.tipo),
      conteudo: String(r.conteudo ?? ''), enviado_em: r.enviado_em as Date,
    })),
  };
}

// Cria mini-lote de 1 colaborador e dispara (sem preview prévio).
// Útil pro CEO mandar recibo individual de quem ele quiser.
export async function dispararEnvioIndividual(input: {
  membro_id: string; periodo: string;
  telefone_override?: string;  // se quiser usar outro número que não o cadastrado
  baseUrl?: string;
  criado_por?: string;
}): Promise<{
  ok: true; lote_id: string; envio_id: string; status: string; message: string;
}> {
  const periodo = parsePeriodo(input.periodo);

  // Coleta dados (valida que tem dias/ajustes no período)
  const data = await coletarDadosRecibo(input.membro_id, periodo.codigo);
  if (data.totais.qtd_dias === 0 && data.totais.total_ajustes === 0) {
    throw new Error('Colaborador sem dias trabalhados ou ajustes no período — nada pra cobrar.');
  }

  // Telefone: usa override se passou, senão valor_dia do cadastro
  const [memRows] = await pool.execute<RowDataPacket[]>(
    `SELECT telefone FROM romatec_obra_equipe WHERE id = ?`, [Number(input.membro_id)]
  );
  const telefoneRaw = input.telefone_override || (memRows[0]?.telefone as string | undefined) || '';
  const telefoneNorm = telefoneRaw.replace(/\D/g, '');
  if (telefoneNorm.length < 10) {
    throw new Error(`Telefone inválido: "${telefoneRaw}". Cadastre o telefone do colaborador ou informe um override.`);
  }

  // Cria lote dedicado (numero com sufixo "IND-" + timestamp)
  const numeroLote = `QUINZ-${periodo.ano}-${String(periodo.mes).padStart(2, '0')}-${periodo.quinzena}-IND-${Date.now().toString(36).slice(-5)}`;
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO recibos_envios_lotes
       (numero, periodo, periodo_inicio, periodo_fim, total_colaboradores, total_valor, status, criado_por)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      numeroLote, periodo.codigo, periodo.dataInicio, periodo.dataFim,
      1, data.totais.total_liquido.toFixed(2),
      'aguardando_confirmacao_ceo', input.criado_por ?? 'envio-individual',
    ]
  );
  const loteId = r.insertId;

  const token = gerarToken();
  const [r2] = await pool.execute<ResultSetHeader>(
    `INSERT INTO recibos_envios (lote_id, membro_id, telefone, valor, status, token_confirmacao)
     VALUES (?,?,?,?,?,?)`,
    [loteId, Number(input.membro_id), telefoneNorm, data.totais.total_liquido.toFixed(2),
     'pendente_envio', token]
  );
  const envioId = r2.insertId;

  // Dispara (gera PDF + manda WhatsApp + atualiza status)
  await dispararLote({ lote_id: String(loteId), baseUrl: input.baseUrl });

  // Re-lê status final
  const [vRows] = await pool.execute<RowDataPacket[]>(
    `SELECT status FROM recibos_envios WHERE id = ?`, [envioId]
  );
  const finalStatus = String(vRows[0]?.status ?? '?');

  return {
    ok: true,
    lote_id: String(loteId),
    envio_id: String(envioId),
    status: finalStatus,
    message: finalStatus === 'enviado_aguardando_confirmacao'
      ? `Recibo enviado pra ${telefoneNorm}. Aguardando confirmação.`
      : `Disparo concluído com status ${finalStatus}.`,
  };
}

// v1.65.32: marcar PAGO direto sem enviar WhatsApp.
// Caso de uso: pagamento foi em maos / via banco, CEO so quer registrar
// que ja pagou. Cria o recibo (mesmo que nunca tenha sido disparado),
// gera PDF/snapshot pra historico, mas NAO manda mensagem nenhuma.
export async function marcarPagoOffline(input: {
  membro_id: string;
  periodo: string;
  observacao?: string;
  marcador?: string;
}): Promise<{
  ok: true; lote_id: string; envio_id: string; message: string;
}> {
  const periodo = parsePeriodo(input.periodo);

  // Verifica se ja existe envio nesse periodo pra evitar duplicar
  const [existRows] = await pool.execute<RowDataPacket[]>(
    `SELECT v.id, v.lote_id, v.status FROM recibos_envios v
       JOIN recibos_envios_lotes l ON l.id = v.lote_id
      WHERE v.membro_id = ? AND l.periodo = ?
      ORDER BY v.id DESC LIMIT 1`,
    [Number(input.membro_id), periodo.codigo]
  );
  if (existRows.length > 0) {
    const existing = existRows[0] as { id: number; lote_id: number; status: string };
    if (existing.status === 'pago') {
      return {
        ok: true,
        lote_id: String(existing.lote_id),
        envio_id: String(existing.id),
        message: `Ja estava marcado como PAGO no envio ${existing.id}. Nada feito.`,
      };
    }
    // Atualiza pra pago direto
    await pool.execute(
      `UPDATE recibos_envios SET
         status = 'pago',
         confirmado_em = COALESCE(confirmado_em, NOW()),
         pix_recebido_em = COALESCE(pix_recebido_em, NOW()),
         pago_em = COALESCE(pago_em, NOW())
       WHERE id = ?`,
      [existing.id]
    );
    await logarMensagemEnvio(existing.id, 'saida', 'aviso',
      `[OFFLINE] marcado como PAGO sem envio de WhatsApp${input.observacao ? ' — ' + input.observacao : ''}${input.marcador ? ' por ' + input.marcador : ''}`,
      null);
    return {
      ok: true,
      lote_id: String(existing.lote_id),
      envio_id: String(existing.id),
      message: `Envio ${existing.id} atualizado pra PAGO sem envio de mensagem.`,
    };
  }

  // Coleta dados (valida que tem dias/ajustes no periodo)
  const data = await coletarDadosRecibo(input.membro_id, periodo.codigo);
  if (data.totais.qtd_dias === 0 && data.totais.total_ajustes === 0) {
    throw new Error('Colaborador sem dias trabalhados ou ajustes no periodo — nao da pra registrar pagamento.');
  }

  // Telefone (so pra registro — nao envia)
  const [memRows] = await pool.execute<RowDataPacket[]>(
    `SELECT telefone FROM romatec_obra_equipe WHERE id = ?`, [Number(input.membro_id)]
  );
  const telefoneNorm = String(memRows[0]?.telefone ?? '').replace(/\D/g, '') || null;

  // Lote dedicado com sufixo OFFLINE
  const numeroLote = `QUINZ-${periodo.ano}-${String(periodo.mes).padStart(2, '0')}-${periodo.quinzena}-OFFLINE-${Date.now().toString(36).slice(-5)}`;
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO recibos_envios_lotes
       (numero, periodo, periodo_inicio, periodo_fim, total_colaboradores, total_valor, status, criado_por)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      numeroLote, periodo.codigo, periodo.dataInicio, periodo.dataFim,
      1, data.totais.total_liquido.toFixed(2),
      'concluido', input.marcador ?? 'pago-offline',
    ]
  );
  const loteId = r.insertId;

  const token = gerarToken();
  const [r2] = await pool.execute<ResultSetHeader>(
    `INSERT INTO recibos_envios
       (lote_id, membro_id, telefone, valor, status, token_confirmacao,
        confirmado_em, pix_recebido_em, pago_em)
     VALUES (?,?,?,?,?,?,NOW(),NOW(),NOW())`,
    [loteId, Number(input.membro_id), telefoneNorm, data.totais.total_liquido.toFixed(2),
     'pago', token]
  );
  const envioId = r2.insertId;

  await logarMensagemEnvio(envioId, 'saida', 'aviso',
    `[OFFLINE] recibo registrado como PAGO direto, sem envio de WhatsApp${input.observacao ? ' — ' + input.observacao : ''}${input.marcador ? ' por ' + input.marcador : ''}`,
    null);

  return {
    ok: true,
    lote_id: String(loteId),
    envio_id: String(envioId),
    message: `Pagamento offline registrado pra ${data.membro.nome}. Lote ${numeroLote}.`,
  };
}

// Avança status manualmente (CEO marca direto, sem passar pelo fluxo do colaborador)
type StatusManual =
  | 'enviado_aguardando_confirmacao'
  | 'confirmado_aguardando_pix'
  | 'pix_recebido'
  | 'pago'
  | 'contestado'
  | 'expirado';

export async function alterarStatusManual(input: {
  envio_id: string;
  status: StatusManual;
  motivo?: string;
  marcador?: string;
  notificar_ceo?: boolean;
}): Promise<{ ok: true; status: string; message: string }> {
  const id = Number(input.envio_id);
  if (!id) throw new Error('envio_id inválido');

  const [rows] = await pool.execute<EnvioStatusRow[]>(
    `SELECT v.*, l.numero AS lote_numero, e.nome
       FROM recibos_envios v
       LEFT JOIN recibos_envios_lotes l ON l.id = v.lote_id
       LEFT JOIN romatec_obra_equipe e ON e.id = v.membro_id
      WHERE v.id = ?`, [id]
  );
  const envio = rows[0];
  if (!envio) throw new Error(`envio ${id} não encontrado`);

  // Monta SET dinâmico — preserva timestamps + adiciona o novo
  const sets: string[] = ['status = ?'];
  const params: (string | number | null)[] = [input.status];
  if (input.status === 'confirmado_aguardando_pix') {
    sets.push("confirmado_em = COALESCE(confirmado_em, NOW())");
    sets.push("confirmacao_resposta = COALESCE(confirmacao_resposta, ?)");
    params.push(`[MANUAL] ${input.marcador ?? 'CEO'} marcou via UI`);
  }
  if (input.status === 'pix_recebido') {
    sets.push("confirmado_em = COALESCE(confirmado_em, NOW())");
    sets.push("pix_recebido_em = COALESCE(pix_recebido_em, NOW())");
  }
  if (input.status === 'pago') {
    sets.push("confirmado_em = COALESCE(confirmado_em, NOW())");
    sets.push("pix_recebido_em = COALESCE(pix_recebido_em, NOW())");
    sets.push("pago_em = COALESCE(pago_em, NOW())");
  }
  if (input.status === 'contestado') {
    sets.push("contestacao_motivo = COALESCE(contestacao_motivo, ?)");
    params.push(input.motivo ?? '[MANUAL] marcado pelo CEO');
    sets.push("contestacao_repassada_ceo_em = COALESCE(contestacao_repassada_ceo_em, NOW())");
  }
  params.push(id);

  await pool.execute(
    `UPDATE recibos_envios SET ${sets.join(', ')} WHERE id = ?`, params
  );

  await logarMensagemEnvio(id, 'saida', 'aviso',
    `[MANUAL] status alterado para "${input.status}"${input.motivo ? ' — motivo: ' + input.motivo : ''}${input.marcador ? ' por ' + input.marcador : ''}`,
    null);

  if (input.notificar_ceo === false) {
    // ignore
  } else {
    // Não re-notifica CEO (foi ele mesmo que marcou)
  }

  return {
    ok: true,
    status: input.status,
    message: `Envio ${id} (${envio.nome}): status atualizado para ${input.status}.`,
  };
}

// v1.65.36: lista todos os envios de um membro (todos os periodos).
// Util pra debug: "marquei Abril como PAGO mas sumiu, cade?"
export async function historicoEnviosMembro(membroId: string): Promise<{
  membro_id: string;
  envios: Array<{
    envio_id: string;
    lote_id: string;
    lote_numero: string;
    periodo: string;
    status: string;
    valor: number;
    enviado_em: Date | null;
    pago_em: Date | null;
    criado_em: Date;
  }>;
}> {
  const id = Number(membroId);
  if (!id) throw new Error('membro_id invalido');

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT v.id AS envio_id, v.lote_id, l.numero AS lote_numero,
            l.periodo, v.status, v.valor, v.enviado_em, v.pago_em, v.criado_em
       FROM recibos_envios v
       LEFT JOIN recibos_envios_lotes l ON l.id = v.lote_id
      WHERE v.membro_id = ?
      ORDER BY l.periodo DESC, v.criado_em DESC`,
    [id]
  );

  return {
    membro_id: membroId,
    envios: rows.map(r => ({
      envio_id: String(r.envio_id),
      lote_id: String(r.lote_id),
      lote_numero: String(r.lote_numero ?? '?'),
      periodo: String(r.periodo ?? '?'),
      status: String(r.status),
      valor: Number(r.valor),
      enviado_em: r.enviado_em as Date | null,
      pago_em: r.pago_em as Date | null,
      criado_em: r.criado_em as Date,
    })),
  };
}

// v1.65.35: apagar envio (e suas mensagens) — caso de uso: lote disparado
// errado / em testes que precisa ser limpo pra quinzena voltar a ABERTA.
// Se o lote ficar sem envios, tambem apaga o lote vazio (cleanup).
// NAO mexe em recibos_quinzena_emitidos (snapshot historico imutavel).
export async function apagarEnvio(input: {
  envio_id: string;
  marcador?: string;
}): Promise<{ ok: true; deleted_envio_id: string; deleted_lote_id: string | null; message: string }> {
  const id = Number(input.envio_id);
  if (!id) throw new Error('envio_id invalido');

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT v.lote_id, v.status, v.membro_id, l.numero AS lote_numero, e.nome
       FROM recibos_envios v
       LEFT JOIN recibos_envios_lotes l ON l.id = v.lote_id
       LEFT JOIN romatec_obra_equipe e ON e.id = v.membro_id
      WHERE v.id = ?`, [id]
  );
  if (rows.length === 0) throw new Error(`envio ${id} nao encontrado`);
  const row = rows[0] as { lote_id: number; status: string; membro_id: number; lote_numero: string; nome: string };
  const loteId = row.lote_id;

  // Apaga as mensagens primeiro (FK)
  await pool.execute(`DELETE FROM recibos_envios_mensagens WHERE envio_id = ?`, [id]);
  // Apaga o envio
  await pool.execute(`DELETE FROM recibos_envios WHERE id = ?`, [id]);

  // Se lote ficou vazio, apaga ele tambem
  let loteApagado: number | null = null;
  if (loteId) {
    const [restantes] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM recibos_envios WHERE lote_id = ?`, [loteId]
    );
    const n = Number((restantes[0] as { n: number }).n);
    if (n === 0) {
      await pool.execute(`DELETE FROM recibos_envios_lotes WHERE id = ?`, [loteId]);
      loteApagado = loteId;
    }
  }

  console.log(`[recibos] envio ${id} (${row.nome}, lote ${row.lote_numero}, status era "${row.status}") apagado por ${input.marcador ?? '?'}${loteApagado ? ` — lote vazio ${loteApagado} tambem apagado` : ''}`);

  return {
    ok: true,
    deleted_envio_id: String(id),
    deleted_lote_id: loteApagado ? String(loteApagado) : null,
    message: `Envio ${id} apagado${loteApagado ? ` (lote ${loteApagado} ficou vazio e tambem foi apagado)` : ''}. Quinzena volta pra ABERTA.`,
  };
}
