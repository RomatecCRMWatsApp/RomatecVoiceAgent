// v1.66.0: Proposta de Consultoria (averbacao, georref, desm, retif, ptam).
// Reaproveita: numeracao gerarNumeroProposta() compartilhada em propostas.ts,
// tabela MySQL `propostas` (mesmas colunas + dados_imovel/custos_calculados/
// fontes_consulta JSON), envio WhatsApp Z-API e Telegram. PDF tem template
// proprio com 5 secoes (este arquivo) — visual herdado da Mao de Obra
// (header, cores, footer).
//
// Fase 1: implementa apenas averbacao_residencial e averbacao_comercial.
// Demais subtipos vem na Fase 3.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { sendDocument as sendWhatsAppDocument } from './whatsapp';
import { sendDocument as sendTelegramDocument } from './telegram';
import { getTenantSettings } from '../services/tenantSettings';
import { formatBRL } from '../util/format';
import { calcularConsultoria } from '../services/pricing';
import type {
  SubtipoConsultoria, CustosCalculados, FontesConsulta, InputAverbacao,
} from '../services/pricing/types';

const LOGO_RELATORIO = '/romatec-logo-removebg-preview.png';

// ── Numeracao compartilhada (delega a propostas.ts) ────────────────────────
async function gerarNumeroProposta(): Promise<string> {
  const ano = new Date().getFullYear();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT numero FROM propostas
      WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`,
    [`PROP-${ano}-%`]
  );
  let seq = 1;
  if (rows.length > 0) {
    const m = String(rows[0].numero).match(/PROP-\d{4}-(\d+)/);
    if (m) seq = Number(m[1]) + 1;
  }
  return `PROP-${ano}-${String(seq).padStart(4, '0')}`;
}

// ── Tipos de input/output ──────────────────────────────────────────────────
export interface CriarPropostaConsultoriaInput {
  subtipo: SubtipoConsultoria;
  cliente_id: string;
  endereco_imovel?: string;
  data_proposta?: string;
  validade_dias?: number;
  observacoes?: string;
  criada_por?: string;
  gestor_cargo?: string;
  gestor_nome?: string;
  gestor_telefone?: string;
  dados_imovel: Record<string, unknown>;
}

export interface PropostaConsultoriaRow extends RowDataPacket {
  id: number;
  numero: string;
  tipo: 'mao_de_obra' | 'consultoria';
  subtipo_consultoria: string | null;
  cliente_id: number;
  endereco_obra: string | null;
  data_proposta: Date;
  validade_dias: number;
  valor_total: string;
  observacoes: string | null;
  status: string;
  dados_imovel: string | null;
  custos_calculados: string | null;
  fontes_consulta: string | null;
  gestor_cargo: string | null;
  gestor_nome: string | null;
  gestor_telefone: string | null;
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function criarPropostaConsultoria(input: CriarPropostaConsultoriaInput) {
  const cliId = Number(input.cliente_id);
  if (!cliId) throw new Error('cliente_id obrigatorio');
  if (!input.subtipo) throw new Error('subtipo obrigatorio');

  const subtipo = input.subtipo;
  let resultado;
  if (subtipo === 'averbacao_residencial' || subtipo === 'averbacao_comercial') {
    resultado = await calcularConsultoria({
      subtipo,
      dados: input.dados_imovel as unknown as InputAverbacao,
    });
  } else {
    throw new Error(`Subtipo ${subtipo} nao implementado nesta fase. Apenas averbacao_residencial e averbacao_comercial estao disponiveis.`);
  }

  const numero = await gerarNumeroProposta();
  const data = input.data_proposta && /^\d{4}-\d{2}-\d{2}$/.test(input.data_proposta)
    ? input.data_proposta
    : new Date().toISOString().slice(0, 10);

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO propostas
       (numero, tipo, subtipo_consultoria, cliente_id, endereco_obra,
        data_proposta, validade_dias, valor_total, observacoes, criada_por,
        gestor_cargo, gestor_nome, gestor_telefone,
        dados_imovel, custos_calculados, fontes_consulta)
     VALUES (?, 'consultoria', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      numero, subtipo, cliId,
      input.endereco_imovel ?? null,
      data,
      Number(input.validade_dias) || 15,
      resultado.custos.secao_5_total,
      input.observacoes ?? null,
      input.criada_por ?? null,
      input.gestor_cargo ?? null,
      input.gestor_nome ?? null,
      input.gestor_telefone ?? null,
      JSON.stringify(input.dados_imovel),
      JSON.stringify(resultado.custos),
      JSON.stringify(resultado.fontes),
    ]
  );

  return {
    ok: true as const,
    insertId: r.insertId,
    numero,
    subtipo,
    valor_total: resultado.custos.secao_5_total,
    custos_calculados: resultado.custos,
    fontes_consulta: resultado.fontes,
    message: `Proposta de Consultoria ${numero} (${subtipo}) criada. Valor R$ ${resultado.custos.secao_5_total.toFixed(2)}.`,
  };
}

export async function previewCustoConsultoria(input: {
  subtipo: SubtipoConsultoria;
  dados_imovel: Record<string, unknown>;
}) {
  const { subtipo, dados_imovel } = input;
  if (subtipo === 'averbacao_residencial' || subtipo === 'averbacao_comercial') {
    const resultado = await calcularConsultoria({
      subtipo,
      dados: dados_imovel as unknown as InputAverbacao,
    });
    return {
      ok: true as const,
      subtipo,
      valor_total: resultado.custos.secao_5_total,
      custos: resultado.custos,
      fontes: resultado.fontes,
    };
  }
  throw new Error(`Subtipo ${subtipo} nao disponivel na Fase 1.`);
}

export async function buscarPropostaConsultoria(id: string) {
  const idNum = Number(id);
  if (!idNum) throw new Error('id invalido');
  const [rows] = await pool.execute<PropostaConsultoriaRow[]>(
    `SELECT p.*, c.nome AS cliente_nome, c.cpf_cnpj AS cliente_cpf_cnpj,
            c.telefone AS cliente_telefone, c.email AS cliente_email,
            c.endereco AS cliente_endereco, c.cidade AS cliente_cidade,
            c.estado AS cliente_estado
       FROM propostas p
       LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
      WHERE p.id = ? AND p.deleted_at IS NULL`,
    [idNum]
  );
  if (rows.length === 0) throw new Error('Proposta nao encontrada');
  const row = rows[0] as PropostaConsultoriaRow & {
    cliente_nome?: string; cliente_cpf_cnpj?: string;
    cliente_telefone?: string; cliente_email?: string;
    cliente_endereco?: string; cliente_cidade?: string; cliente_estado?: string;
  };
  return {
    id: String(row.id),
    numero: row.numero,
    tipo: row.tipo,
    subtipo: row.subtipo_consultoria,
    cliente: {
      id: row.cliente_id,
      nome: row.cliente_nome,
      cpf_cnpj: row.cliente_cpf_cnpj,
      telefone: row.cliente_telefone,
      email: row.cliente_email,
      endereco: row.cliente_endereco,
      cidade: row.cliente_cidade,
      estado: row.cliente_estado,
    },
    endereco_imovel: row.endereco_obra,
    data_proposta: row.data_proposta,
    validade_dias: row.validade_dias,
    valor_total: Number(row.valor_total),
    status: row.status,
    observacoes: row.observacoes,
    gestor_cargo: row.gestor_cargo,
    gestor_nome: row.gestor_nome,
    gestor_telefone: row.gestor_telefone,
    dados_imovel: row.dados_imovel ? JSON.parse(row.dados_imovel) : null,
    custos_calculados: (row.custos_calculados ? JSON.parse(row.custos_calculados) : null) as CustosCalculados | null,
    fontes_consulta: (row.fontes_consulta ? JSON.parse(row.fontes_consulta) : null) as FontesConsulta | null,
  };
}

// ── PDF de 5 secoes ────────────────────────────────────────────────────────

const SUBTIPO_LABEL: Record<string, string> = {
  averbacao_residencial: 'AVERBACAO RESIDENCIAL',
  averbacao_comercial: 'AVERBACAO COMERCIAL',
  georreferenciamento_rural: 'GEORREFERENCIAMENTO RURAL',
  desmembramento: 'DESMEMBRAMENTO',
  remembramento: 'REMEMBRAMENTO',
  retificacao_area: 'RETIFICACAO DE AREA',
  avaliacao_ptam: 'AVALIACAO DE IMOVEIS (PTAM)',
};

export async function gerarPdfPropostaConsultoria(id: string): Promise<Buffer> {
  const p = await buscarPropostaConsultoria(id);
  if (p.tipo !== 'consultoria') throw new Error('Proposta nao e de consultoria');
  const custos = p.custos_calculados;
  if (!custos) throw new Error('Custos nao calculados');

  const t = await getTenantSettings(1).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliaria';
  const logoFile = path.join(__dirname, '..', 'public', LOGO_RELATORIO.replace(/^\//, ''));
  const corHex = t?.primary_color || '#10b981';
  const corVermelho = '#dc2626';

  const subtipoLabel = SUBTIPO_LABEL[p.subtipo || ''] || (p.subtipo || '').toUpperCase();
  const isDesmRem = p.subtipo === 'desmembramento' || p.subtipo === 'remembramento';

  const doc = new PDFDocument({ size: 'A4', margin: 48, info: {
    Title: `Proposta Consultoria ${p.numero}`,
    Author: brand,
    Subject: `Proposta de Consultoria — ${subtipoLabel} para ${p.cliente?.nome || ''}`,
  }});
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // Header
  if (fs.existsSync(logoFile)) {
    try { doc.image(logoFile, { fit: [120, 60], align: 'center' }); }
    catch { /* opcional */ }
  } else {
    doc.fontSize(16).fillColor(corHex).text(brand, { align: 'center' });
  }
  doc.moveDown(0.5);
  doc.strokeColor(corHex).lineWidth(2).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.8);

  doc.fontSize(15).fillColor('#111').text(`PROPOSTA DE CONSULTORIA — ${subtipoLabel}`, { align: 'center', characterSpacing: 0.5 });
  doc.fontSize(10).fillColor('#444').text(`No ${p.numero}  ·  ${String(p.status).toUpperCase()}`, { align: 'center' });
  doc.moveDown(0.8);

  // Cliente
  doc.fontSize(11).fillColor(corHex).text('Cliente');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#111');
  doc.text(`Nome: ${p.cliente?.nome || '-'}`);
  if (p.cliente?.cpf_cnpj || p.cliente?.telefone) {
    doc.text(`${p.cliente?.cpf_cnpj || ''}${p.cliente?.telefone ? '  ·  ' + p.cliente.telefone : ''}`);
  }
  if (p.cliente?.email)    doc.text(`E-mail: ${p.cliente.email}`);
  if (p.endereco_imovel)   doc.text(`Imovel: ${p.endereco_imovel}`);
  doc.moveDown(0.6);

  // ── Secao 1: Projetos ───────────────────────────────────────────────────
  doc.fontSize(11).fillColor(corHex).text('1. Documentos de Projeto a Serem Confeccionados');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#111');
  custos.secao_1_projetos.forEach((p1, i) => {
    doc.text(`${i + 1}. ${p1}`, { indent: 8 });
  });
  doc.moveDown(0.5);

  // ── Secao 2: Taxas e Emolumentos de Terceiros ──────────────────────────
  doc.fontSize(11).fillColor(corHex).text('2. Taxas e Emolumentos de Terceiros');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  desenharTabelaCustos(doc, custos.secao_2_taxas, corHex);
  doc.moveDown(0.5);

  // ── Secao 3: Honorarios Romatec ────────────────────────────────────────
  doc.fontSize(11).fillColor(corHex).text('3. Honorarios Tecnicos Romatec');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  desenharTabelaCustos(doc, custos.secao_3_honorarios, corHex);
  doc.moveDown(0.5);

  // ── Secao 4: Checklist de Documentos do Cliente ────────────────────────
  if (doc.y > 680) doc.addPage();
  doc.fontSize(11).fillColor(corHex).text('4. Documentos que o Cliente Deve Fornecer');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5);
  custos.secao_4_checklist.forEach(d => {
    const isImp = d.imprescindivel && isDesmRem;
    if (isImp) {
      doc.fillColor(corVermelho).font('Helvetica-Bold')
         .text(`☐ [IMPRESCINDIVEL] ${d.texto}`, { indent: 8 });
      doc.font('Helvetica');
    } else {
      doc.fillColor('#111').text(`☐ ${d.texto}${d.obrigatorio ? '' : '  (opcional)'}`, { indent: 8 });
    }
  });
  doc.moveDown(0.5);

  // ── Secao 5: Total ─────────────────────────────────────────────────────
  if (doc.y > 720) doc.addPage();
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor(corHex).lineWidth(1).stroke();
  doc.moveDown(0.4);
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#111')
     .text(`5. VALOR TOTAL DA PROPOSTA: ${formatBRL(custos.secao_5_total)}`, 48, doc.y, { width: 499, align: 'right' });
  doc.font('Helvetica');
  doc.moveDown(0.4);
  doc.fontSize(8.5).fillColor('#666')
     .text(`Soma das Secoes 2 (Taxas) + 3 (Honorarios). Secoes 1 e 4 sao informativas.`, { align: 'right' });
  doc.moveDown(0.6);

  // Avisos
  if (custos.avisos && custos.avisos.length > 0) {
    doc.fontSize(9).fillColor('#444').font('Helvetica-Oblique').text('Avisos:');
    custos.avisos.forEach(a => doc.fontSize(8).text(`• ${a}`, { indent: 8 }));
    doc.font('Helvetica');
    doc.moveDown(0.4);
  }

  doc.fontSize(9).fillColor('#444')
     .text(`Data: ${formatDataBR(p.data_proposta)}    ·    Validade: ${p.validade_dias} dias`, { width: 499 });
  doc.moveDown(0.4);

  // Responsavel tecnico
  if (p.gestor_nome || p.gestor_cargo || p.gestor_telefone) {
    doc.fontSize(10).fillColor(corHex).text('Responsavel Tecnico');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(9.5).fillColor('#111');
    const partes: string[] = [];
    if (p.gestor_cargo) partes.push(p.gestor_cargo);
    if (p.gestor_nome)  partes.push(p.gestor_nome);
    doc.text(partes.join(' — ') || '-');
    if (p.gestor_telefone) doc.text(`Tel: ${p.gestor_telefone}`);
    doc.moveDown(0.4);
  }

  // Footer
  const footerY = 800;
  doc.fontSize(8).fillColor('#888')
     .text(`${brand} — Proposta valida por ${p.validade_dias} dias.`, 48, footerY, { width: 499, align: 'center' });

  doc.end();
  await new Promise<void>(resolve => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

function desenharTabelaCustos(doc: PDFKit.PDFDocument, items: CustosCalculados['secao_2_taxas'], corHex: string) {
  const colX = { idx: 48, desc: 72, sub: 470 };
  const colW = { idx: 22, desc: 396, sub: 80 };

  // Header
  doc.fontSize(8.5).fillColor('#444').font('Helvetica-Bold');
  doc.text('#', colX.idx, doc.y, { width: colW.idx });
  const hY = doc.y;
  doc.text('Descricao', colX.desc, hY, { width: colW.desc, continued: false });
  doc.text('Subtotal', colX.sub, hY, { width: colW.sub, align: 'right' });
  doc.font('Helvetica');
  let cursorY = doc.y + 4;
  doc.moveTo(48, cursorY).lineTo(547, cursorY).strokeColor('#888').lineWidth(0.5).stroke();
  cursorY += 4;

  doc.fontSize(8.5).fillColor('#111');
  for (const it of items) {
    const descTxt = it.descricao + (it.observacao ? `\n   ${it.observacao}` : '');
    const hDesc = doc.heightOfString(descTxt, { width: colW.desc });
    const lineHeight = Math.max(hDesc, 12);
    if (cursorY + lineHeight > 760) {
      doc.addPage();
      cursorY = 60;
    }
    doc.text(String(it.ordem), colX.idx, cursorY, { width: colW.idx });
    doc.text(descTxt, colX.desc, cursorY, { width: colW.desc });
    const valorStr = it.pendente ? 'A confirmar' : formatBRL(it.valor);
    doc.fillColor(it.pendente ? '#b45309' : '#111')
       .text(valorStr, colX.sub, cursorY, { width: colW.sub, align: 'right' });
    doc.fillColor('#111');
    cursorY += lineHeight + 4;
  }
  doc.x = 48;
  doc.y = cursorY;
}

function formatDataBR(d: Date | string): string {
  if (!d) return '-';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

// ── Envio ──────────────────────────────────────────────────────────────────

export async function enviarPropostaConsultoriaWhatsApp(input: { id: string; telefone?: string }) {
  const idNum = Number(input.id);
  if (!idNum) throw new Error('id obrigatorio');
  const p = await buscarPropostaConsultoria(input.id);
  const tel = (input.telefone?.trim()) || p.cliente?.telefone || '';
  if (!tel) throw new Error('Telefone obrigatorio (informe ou cadastre no cliente).');

  const pdfBuf = await gerarPdfPropostaConsultoria(input.id);
  const fileName = `Proposta_${p.numero}_${(p.cliente?.nome || 'cliente').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.pdf`;
  const r = await sendWhatsAppDocument(tel, pdfBuf.toString('base64'), fileName);

  await pool.execute(
    `UPDATE propostas
        SET enviada_whatsapp = 1,
            enviada_em = CURRENT_TIMESTAMP,
            status = IF(status = 'rascunho', 'enviada', status)
      WHERE id = ?`,
    [idNum]
  );

  return {
    ok: true as const,
    message: `Proposta ${p.numero} enviada via WhatsApp para ${r.phone} (msgId ${r.messageId || '?'}).`,
    messageId: r.messageId,
    phone: r.phone,
  };
}

export async function enviarPropostaConsultoriaTelegram(input: { id: string; chatId?: string }) {
  const idNum = Number(input.id);
  if (!idNum) throw new Error('id obrigatorio');
  const p = await buscarPropostaConsultoria(input.id);

  const chatId = input.chatId
    || (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
    || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  if (!chatId) throw new Error('chatId Telegram obrigatorio (defina TELEGRAM_LEAD_CHAT_ID ou TELEGRAM_AUTHORIZED_USER_IDS, ou passe explicit).');

  const pdfBuf = await gerarPdfPropostaConsultoria(input.id);
  const fileName = `Proposta_${p.numero}_${(p.cliente?.nome || 'cliente').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.pdf`;
  await sendTelegramDocument(chatId, pdfBuf, fileName, `Proposta ${p.numero} — ${SUBTIPO_LABEL[p.subtipo || ''] || p.subtipo}`);

  await pool.execute(
    `UPDATE propostas
        SET status = IF(status = 'rascunho', 'enviada', status)
      WHERE id = ?`,
    [idNum]
  );

  return {
    ok: true as const,
    message: `Proposta ${p.numero} enviada via Telegram (chat ${chatId}).`,
  };
}

// Lista filtrada por tipo (mao_de_obra ou consultoria)
export async function listarPropostasPorTipo(input: { tipo?: 'mao_de_obra' | 'consultoria'; limite?: number } = {}) {
  const limit = Math.min(Math.max(Number(input.limite) || 100, 1), 500);
  const params: (string | number)[] = [];
  let sql = `SELECT p.id, p.numero, p.tipo, p.subtipo_consultoria, p.cliente_id,
                    c.nome AS cliente_nome, p.endereco_obra, p.data_proposta,
                    p.validade_dias, p.valor_total, p.status, p.enviada_whatsapp,
                    p.criado_em
               FROM propostas p
               LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
              WHERE p.deleted_at IS NULL`;
  if (input.tipo) {
    sql += ' AND p.tipo = ?';
    params.push(input.tipo);
  }
  sql += ` ORDER BY p.id DESC LIMIT ${limit}`;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return {
    total: rows.length,
    items: rows.map(r => ({
      id: String(r.id),
      numero: r.numero,
      tipo: r.tipo,
      subtipo: r.subtipo_consultoria,
      cliente_id: String(r.cliente_id),
      cliente_nome: r.cliente_nome,
      endereco_obra: r.endereco_obra,
      data_proposta: r.data_proposta,
      validade_dias: r.validade_dias,
      valor_total: Number(r.valor_total),
      status: r.status,
      enviada_whatsapp: !!r.enviada_whatsapp,
      criado_em: r.criado_em,
    })),
  };
}
