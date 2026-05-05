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
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
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
  // v1.66.8: override opcional dos custos (UI permite editar valores no preview)
  custos_override?: CustosCalculados;
  // v1.66.9: anexos enviados junto na criacao (Planta/Mapa em PDF/PNG/JPEG)
  anexos?: Array<{ filename: string; mimetype: string; conteudo_b64: string }>;
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

  // v1.66.8: aplica override se a UI editou valores no preview.
  // Recalcula secao_5_total a partir das secoes 2+3 do override (defesa contra
  // payload inconsistente do client).
  if (input.custos_override) {
    const ov = input.custos_override;
    const tot = (ov.secao_2_taxas || []).reduce((s, i) => s + Number(i.valor || 0), 0)
              + (ov.secao_3_honorarios || []).reduce((s, i) => s + Number(i.valor || 0), 0);
    resultado = {
      custos: { ...ov, secao_5_total: tot },
      fontes: { ...resultado.fontes, override_aplicado: true } as typeof resultado.fontes,
    };
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

  // v1.66.9: persiste anexos enviados junto (se houver)
  let anexosCriados = 0;
  if (input.anexos && input.anexos.length > 0) {
    for (const anexo of input.anexos) {
      try {
        await criarAnexoProposta({
          proposta_id: String(r.insertId),
          filename: anexo.filename,
          mimetype: anexo.mimetype,
          conteudo_b64: anexo.conteudo_b64,
        });
        anexosCriados++;
      } catch (err) {
        console.warn(`[anexos] Falha ao salvar ${anexo.filename}: ${(err as Error).message}`);
      }
    }
  }

  return {
    ok: true as const,
    insertId: r.insertId,
    numero,
    subtipo,
    valor_total: resultado.custos.secao_5_total,
    custos_calculados: resultado.custos,
    fontes_consulta: resultado.fontes,
    anexos_criados: anexosCriados,
    message: `Proposta de Consultoria ${numero} (${subtipo}) criada. Valor R$ ${resultado.custos.secao_5_total.toFixed(2)}.${anexosCriados > 0 ? ` ${anexosCriados} anexo(s) salvos.` : ''}`,
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
    dados_imovel: parseJsonCol(row.dados_imovel),
    custos_calculados: parseJsonCol<CustosCalculados>(row.custos_calculados),
    fontes_consulta: parseJsonCol<FontesConsulta>(row.fontes_consulta),
  };
}

// MySQL2 retorna colunas tipo JSON ja parseadas em alguns ambientes,
// e como string em outros. Esta funcao trata os dois casos.
function parseJsonCol<T = unknown>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as T;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return null;
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
  doc.moveDown(0.15);
  // v1.66.5: aviso destacado de aproximacao Receita/Cartorio
  const avisoY = doc.y;
  doc.rect(48, avisoY, 499, 26).fillAndStroke('#fff7ed', '#fb923c');
  doc.fontSize(8).fillColor('#9a3412').font('Helvetica-Bold')
     .text('ATENCAO: Os valores de Cartorio e Receita Federal sao APROXIMADOS (tabelas oficiais TJMA Res. 143/2025 e IN RFB 2021/2021). Valores definitivos podem variar conforme apuracao real no cartorio e portal SERO/e-CAC no momento do pagamento.',
       52, avisoY + 4, { width: 491 });
  doc.font('Helvetica').fillColor('#111');
  doc.y = avisoY + 30;
  desenharTabelaCustos(doc, custos.secao_2_taxas, corHex);
  doc.moveDown(0.5);

  // ── Secao 3: Honorarios Romatec ────────────────────────────────────────
  doc.fontSize(11).fillColor(corHex).text('3. Honorarios Tecnicos Romatec');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  desenharTabelaCustos(doc, custos.secao_3_honorarios, corHex);
  doc.moveDown(0.4);

  // v1.66.11: Condicoes de Pagamento (logo abaixo dos Honorarios)
  if (custos.condicoes_pagamento && custos.condicoes_pagamento.length > 0) {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(10.5).fillColor(corHex).text('Condicoes de Pagamento dos Honorarios');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    custos.condicoes_pagamento.forEach((cp, i) => {
      doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold').text(`${i + 1}. ${cp.rotulo}`, { indent: 8 });
      doc.font('Helvetica').fontSize(8.5).fillColor('#444').text(cp.descricao, { indent: 16, width: 480 });
      doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold').text(`Valor: ${formatBRL(cp.valor)}`, { indent: 16 });
      doc.font('Helvetica');
      doc.moveDown(0.15);
    });
    doc.moveDown(0.4);
  }

  // v1.66.11: Base de Calculo da Receita Federal (transparencia ao cliente)
  if (custos.base_calculo && custos.base_calculo.length > 0) {
    if (doc.y > 680) doc.addPage();
    doc.fontSize(10.5).fillColor(corHex).text('Base de Calculo — Receita Federal (INSS/SERO)');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    custos.base_calculo.forEach((bc) => {
      const isTotal = bc.rotulo.startsWith('TOTAL');
      doc.fontSize(9).fillColor(isTotal ? corHex : '#111')
         .font(isTotal ? 'Helvetica-Bold' : 'Helvetica-Bold')
         .text(`${bc.rotulo}:  ${formatBRL(bc.valor_resultado)}`, { indent: 8 });
      doc.font('Helvetica').fontSize(8).fillColor('#666')
         .text(bc.formula, { indent: 16, width: 480 });
      doc.moveDown(0.1);
    });
    doc.fontSize(8).fillColor('#666').font('Helvetica-Oblique')
       .text('Fonte: IN RFB 2021/2021 — afericao indireta. Valor definitivo apenas via portal e-CAC.', { indent: 8 });
    doc.font('Helvetica');
    doc.moveDown(0.4);
  }

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

  const pdfBuf = await gerarPdfPropostaConsultoriaCompleto(input.id);
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

  // v1.66.14: log + try/catch detalhado pra diagnosticar falhas no 2o envio
  console.log(`[telegram-consultoria] iniciando envio proposta=${p.numero} chat=${chatId}`);
  let pdfBuf: Buffer;
  try {
    pdfBuf = await gerarPdfPropostaConsultoriaCompleto(input.id);
    console.log(`[telegram-consultoria] PDF gerado: ${(pdfBuf.length / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('[telegram-consultoria] erro ao gerar PDF:', (err as Error).message);
    throw new Error(`Falha ao gerar PDF: ${(err as Error).message}`);
  }

  // Telegram limita arquivos a 50MB. Se passar, aborta com mensagem clara.
  if (pdfBuf.length > 50 * 1024 * 1024) {
    throw new Error(`PDF tem ${(pdfBuf.length / 1024 / 1024).toFixed(1)} MB e o Telegram aceita ate 50 MB. Reduza o tamanho dos anexos da proposta.`);
  }

  const fileName = `Proposta_${p.numero}_${(p.cliente?.nome || 'cliente').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.pdf`;
  try {
    await sendTelegramDocument(chatId, pdfBuf, fileName, `Proposta ${p.numero} — ${SUBTIPO_LABEL[p.subtipo || ''] || p.subtipo}`);
    console.log(`[telegram-consultoria] envio OK proposta=${p.numero}`);
  } catch (err) {
    const e = err as Error & { response?: { data?: { description?: string; error_code?: number } } };
    const desc = e.response?.data?.description || e.message || 'erro desconhecido';
    const code = e.response?.data?.error_code;
    console.error(`[telegram-consultoria] envio FALHOU proposta=${p.numero} code=${code} desc=${desc}`);
    throw new Error(`Telegram rejeitou: ${desc}${code ? ` (code ${code})` : ''}`);
  }

  await pool.execute(
    `UPDATE propostas
        SET status = IF(status = 'rascunho', 'enviada', status)
      WHERE id = ?`,
    [idNum]
  );

  return {
    ok: true as const,
    message: `Proposta ${p.numero} enviada via Telegram (chat ${chatId}, ${(pdfBuf.length / 1024).toFixed(0)} KB).`,
  };
}

// v1.66.13: atualiza Proposta de Consultoria existente (mesmos dados que
// criar — recalcula custos via engine OU usa custos_override se vier).
// NAO mexe em numero, cliente_id, criado_em.
export async function atualizarPropostaConsultoria(input: {
  id: string;
  endereco_imovel?: string;
  observacoes?: string;
  gestor_cargo?: string;
  gestor_nome?: string;
  gestor_telefone?: string;
  dados_imovel?: Record<string, unknown>;
  custos_override?: CustosCalculados;
}) {
  const id = Number(input.id);
  if (!id) throw new Error('id obrigatorio');

  // Busca proposta atual (precisa do subtipo + dados_imovel pra recalcular se nao vier override)
  const atual = await buscarPropostaConsultoria(input.id);
  if (atual.tipo !== 'consultoria') throw new Error('Proposta nao e de consultoria');

  // Determina dados_imovel a usar (novo ou existente)
  const dadosFinal = (input.dados_imovel as InputAverbacao | undefined) ?? (atual.dados_imovel as InputAverbacao);

  // Recalcula via engine se nao vier override
  let custosFinal: CustosCalculados;
  if (input.custos_override) {
    const ov = input.custos_override;
    const tot = (ov.secao_2_taxas || []).reduce((s, i) => s + Number(i.valor || 0), 0)
              + (ov.secao_3_honorarios || []).reduce((s, i) => s + Number(i.valor || 0), 0);
    custosFinal = { ...ov, secao_5_total: tot };
  } else {
    const subtipo = atual.subtipo as SubtipoConsultoria;
    if (subtipo !== 'averbacao_residencial' && subtipo !== 'averbacao_comercial') {
      throw new Error(`Subtipo ${subtipo} nao suportado para edicao nesta fase.`);
    }
    const r = await calcularConsultoria({ subtipo, dados: dadosFinal });
    custosFinal = r.custos;
  }

  await pool.execute(
    `UPDATE propostas SET
       endereco_obra = COALESCE(?, endereco_obra),
       observacoes = COALESCE(?, observacoes),
       gestor_cargo = COALESCE(?, gestor_cargo),
       gestor_nome = COALESCE(?, gestor_nome),
       gestor_telefone = COALESCE(?, gestor_telefone),
       dados_imovel = ?,
       custos_calculados = ?,
       valor_total = ?,
       atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL`,
    [
      input.endereco_imovel ?? null,
      input.observacoes ?? null,
      input.gestor_cargo ?? null,
      input.gestor_nome ?? null,
      input.gestor_telefone ?? null,
      JSON.stringify(dadosFinal),
      JSON.stringify(custosFinal),
      custosFinal.secao_5_total,
      id,
    ]
  );

  return {
    ok: true as const,
    id: input.id,
    valor_total: custosFinal.secao_5_total,
    message: `Proposta ${atual.numero} atualizada. Novo total: R$ ${custosFinal.secao_5_total.toFixed(2)}.`,
  };
}

// ── Anexos da Proposta (v1.66.9) ───────────────────────────────────────────

const ANEXO_MIMES_VALIDOS = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
const ANEXO_TAMANHO_MAX_BYTES = 15 * 1024 * 1024; // 15MB por arquivo

export async function criarAnexoProposta(input: {
  proposta_id: string;
  filename: string;
  mimetype: string;
  conteudo_b64: string;
}) {
  const propId = Number(input.proposta_id);
  if (!propId) throw new Error('proposta_id obrigatorio');
  if (!input.filename) throw new Error('filename obrigatorio');
  if (!ANEXO_MIMES_VALIDOS.includes(input.mimetype)) {
    throw new Error(`Mimetype nao suportado: ${input.mimetype}. Aceito: PDF, PNG, JPEG.`);
  }
  const tamanho = Math.floor((input.conteudo_b64.length * 3) / 4);
  if (tamanho > ANEXO_TAMANHO_MAX_BYTES) {
    throw new Error(`Arquivo excede limite de 15MB (atual: ${(tamanho / 1024 / 1024).toFixed(1)}MB).`);
  }

  const [maxRow] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(ordem), 0) AS ord FROM proposta_anexos WHERE proposta_id = ?`,
    [propId]
  );
  const proxOrdem = Number(maxRow[0]?.ord || 0) + 1;

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO proposta_anexos (proposta_id, filename, mimetype, tamanho_bytes, conteudo_b64, ordem)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [propId, input.filename, input.mimetype, tamanho, input.conteudo_b64, proxOrdem]
  );
  return {
    ok: true as const,
    insertId: r.insertId,
    filename: input.filename,
    tamanho_bytes: tamanho,
    ordem: proxOrdem,
    message: `Anexo "${input.filename}" enviado (${(tamanho / 1024).toFixed(1)} KB).`,
  };
}

export async function listarAnexosProposta(input: { proposta_id: string }) {
  const propId = Number(input.proposta_id);
  if (!propId) throw new Error('proposta_id obrigatorio');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, filename, mimetype, tamanho_bytes, ordem, criado_em
       FROM proposta_anexos WHERE proposta_id = ? ORDER BY ordem`,
    [propId]
  );
  return {
    total: rows.length,
    items: rows.map(r => ({
      id: String(r.id),
      filename: r.filename,
      mimetype: r.mimetype,
      tamanho_bytes: Number(r.tamanho_bytes),
      ordem: Number(r.ordem),
      criado_em: r.criado_em,
    })),
  };
}

export async function removerAnexoProposta(input: { id: string }) {
  const id = Number(input.id);
  if (!id) throw new Error('id invalido');
  const [r] = await pool.execute<ResultSetHeader>(
    `DELETE FROM proposta_anexos WHERE id = ?`, [id]
  );
  return { ok: true as const, affected: r.affectedRows, message: 'Anexo removido.' };
}

async function carregarAnexosProposta(propId: number): Promise<Array<{ filename: string; mimetype: string; buffer: Buffer }>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT filename, mimetype, conteudo_b64 FROM proposta_anexos
      WHERE proposta_id = ? ORDER BY ordem`,
    [propId]
  );
  return rows.map(r => ({
    filename: String(r.filename),
    mimetype: String(r.mimetype),
    buffer: Buffer.from(String(r.conteudo_b64), 'base64'),
  }));
}

// v1.66.9: gera PDF da proposta com anexos mergeados ao final.
// Imagens (PNG/JPG) viram pagina propria do PDF. PDFs anexos sao mergeados
// pagina por pagina. Usa pdf-lib pra concatenacao real.
export async function gerarPdfPropostaConsultoriaCompleto(id: string): Promise<Buffer> {
  const propostaPdf = await gerarPdfPropostaConsultoria(id);
  const anexos = await carregarAnexosProposta(Number(id));
  if (anexos.length === 0) return propostaPdf;

  const merged = await PDFLibDocument.create();
  // Importa proposta principal
  const principalDoc = await PDFLibDocument.load(propostaPdf);
  const principalPages = await merged.copyPages(principalDoc, principalDoc.getPageIndices());
  principalPages.forEach(p => merged.addPage(p));

  for (const anexo of anexos) {
    try {
      if (anexo.mimetype === 'application/pdf') {
        const anexoDoc = await PDFLibDocument.load(anexo.buffer);
        const anexoPages = await merged.copyPages(anexoDoc, anexoDoc.getPageIndices());
        anexoPages.forEach(p => merged.addPage(p));
      } else if (anexo.mimetype === 'image/png' || anexo.mimetype === 'image/jpeg' || anexo.mimetype === 'image/jpg') {
        const img = anexo.mimetype === 'image/png'
          ? await merged.embedPng(anexo.buffer)
          : await merged.embedJpg(anexo.buffer);
        // Pagina A4 com imagem ajustada mantendo aspecto
        const A4_W = 595.28, A4_H = 841.89;
        const margem = 30;
        const maxW = A4_W - 2 * margem, maxH = A4_H - 2 * margem - 30;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        const page = merged.addPage([A4_W, A4_H]);
        page.drawImage(img, {
          x: (A4_W - w) / 2,
          y: (A4_H - h) / 2 - 15,
          width: w,
          height: h,
        });
        page.drawText(`Anexo: ${anexo.filename}`, {
          x: margem, y: 20, size: 9,
        });
      }
    } catch (err) {
      console.warn(`[anexos] Falha ao mergear ${anexo.filename}: ${(err as Error).message}`);
    }
  }
  const out = await merged.save();
  return Buffer.from(out);
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
