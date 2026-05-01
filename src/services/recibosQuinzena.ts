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
       : t === 'adiantamento'  ? 'Adiantamento'
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
