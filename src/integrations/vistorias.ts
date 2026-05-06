// VTO — Vistoria Técnica de Obra (v1.21).
// Relatório com fotos (base64 no MySQL) + export PDF.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { formatBR, formatBRDate } from '../util/format';

type VistoriaRow = RowDataPacket & {
  id: number; obra_id: number;
  data: Date; titulo: string | null;
  vistoriador: string | null;
  descricao: string;
  observacoes: string | null;
  pendencias: string | null;
  status_obra: 'regular' | 'atencao' | 'critica';
  created_at: Date; updated_at: Date;
};

type FotoRow = RowDataPacket & {
  id: number; vistoria_id: number;
  legenda: string | null; mime: string;
  data_base64: string; ordem: number;
};

export interface MutationResult {
  preview?: boolean;
  ok?:      true;
  affected?: number;
  insertId?: number;
  message:  string;
}

const num = (v: string | null | undefined): number => v ? Number(v) : 0;

// ── Vistorias ───────────────────────────────────────────────────────────────
export async function listarVistorias(input: { obra_id?: string; limite?: number } = {}) {
  const limit = Math.min(Math.max(Number(input.limite) || 50, 1), 200);
  const params: (string | number)[] = [];
  let sql = `
    SELECT v.*, COUNT(f.id) AS qtd_fotos
    FROM romatec_obra_vistorias v
    LEFT JOIN romatec_obra_vistoria_fotos f ON f.vistoria_id = v.id
  `;
  if (input.obra_id) { sql += ' WHERE v.obra_id = ?'; params.push(input.obra_id); }
  sql += ` GROUP BY v.id ORDER BY v.data DESC, v.id DESC LIMIT ${limit}`;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  return rows.map(r => ({
    id:           String(r.id),
    obra_id:      String(r.obra_id),
    data:         formatBRDate(r.data as Date),
    titulo:       r.titulo as string | null,
    vistoriador:  r.vistoriador as string | null,
    descricao:    r.descricao as string,
    observacoes:  r.observacoes as string | null,
    pendencias:   r.pendencias as string | null,
    status_obra:  r.status_obra as string,
    qtd_fotos:    Number(r.qtd_fotos ?? 0),
    created_at:   formatBR(r.created_at as Date),
  }));
}

export async function buscarVistoria(id: string) {
  const [rows] = await pool.execute<VistoriaRow[]>('SELECT * FROM romatec_obra_vistorias WHERE id = ?', [id]);
  if (rows.length === 0) throw new Error(`Vistoria ${id} não encontrada`);
  const r = rows[0];

  const [fotos] = await pool.execute<FotoRow[]>(
    'SELECT id, legenda, mime, ordem FROM romatec_obra_vistoria_fotos WHERE vistoria_id = ? ORDER BY ordem ASC, id ASC',
    [id],
  );

  return {
    id: String(r.id), obra_id: String(r.obra_id),
    data: formatBRDate(r.data), titulo: r.titulo,
    vistoriador: r.vistoriador, descricao: r.descricao,
    observacoes: r.observacoes, pendencias: r.pendencias,
    status_obra: r.status_obra,
    fotos: fotos.map(f => ({
      id: String(f.id), legenda: f.legenda,
      mime: f.mime, ordem: f.ordem,
      url: `/api/vistorias/${id}/fotos/${f.id}/raw`,
    })),
  };
}

export async function criarVistoria(input: {
  obra_id: string; descricao: string;
  data?: string; titulo?: string;
  vistoriador?: string;
  observacoes?: string; pendencias?: string;
  status_obra?: 'regular' | 'atencao' | 'critica';
  fotos?: { legenda?: string; mime: string; data_base64: string }[];
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.obra_id || !input.descricao) throw new Error('obra_id e descricao obrigatórios');
  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] Criar vistoria na obra ${input.obra_id} (${input.fotos?.length ?? 0} foto(s)). Reenvie com confirm:true.`,
    };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obra_vistorias
      (obra_id, data, titulo, vistoriador, descricao, observacoes, pendencias, status_obra)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      input.obra_id,
      input.data ?? new Date().toISOString().slice(0, 10),
      input.titulo ?? null,
      input.vistoriador ?? null,
      input.descricao,
      input.observacoes ?? null,
      input.pendencias ?? null,
      input.status_obra ?? 'regular',
    ],
  );
  const vistoriaId = r.insertId;

  if (input.fotos && input.fotos.length > 0) {
    for (let i = 0; i < input.fotos.length; i++) {
      const f = input.fotos[i];
      await pool.execute(
        `INSERT INTO romatec_obra_vistoria_fotos (vistoria_id, legenda, mime, data_base64, ordem)
         VALUES (?,?,?,?,?)`,
        [vistoriaId, f.legenda ?? null, f.mime, f.data_base64, i],
      );
    }
  }

  return { ok: true, insertId: vistoriaId, message: `Vistoria criada com ID ${vistoriaId} e ${input.fotos?.length ?? 0} foto(s).` };
}

export async function adicionarFotoVistoria(input: {
  vistoria_id: string; mime: string; data_base64: string;
  legenda?: string; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.vistoria_id || !input.data_base64) throw new Error('vistoria_id e data_base64 obrigatórios');
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Adicionar foto à vistoria ${input.vistoria_id}. Reenvie com confirm:true.` };
  }
  const [c] = await pool.execute<RowDataPacket[]>(
    'SELECT COALESCE(MAX(ordem), -1) + 1 AS prox FROM romatec_obra_vistoria_fotos WHERE vistoria_id = ?',
    [input.vistoria_id],
  );
  const ordem = Number((c[0] as { prox: number }).prox);
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obra_vistoria_fotos (vistoria_id, legenda, mime, data_base64, ordem)
     VALUES (?,?,?,?,?)`,
    [input.vistoria_id, input.legenda ?? null, input.mime, input.data_base64, ordem],
  );
  return { ok: true, insertId: r.insertId, message: `Foto adicionada (ID ${r.insertId}, ordem ${ordem}).` };
}

// v1.67.9: edicao de vistoria (paridade Proposta — modo Editar)
// Atualiza campos basicos. Fotos: se input.fotos vier, SUBSTITUI as existentes
// (caso contrario mantem). NAO mexe em obra_id (vistoria nao migra de obra).
export async function atualizarVistoria(input: {
  id: string;
  titulo?: string | null;
  vistoriador?: string | null;
  data?: string;
  descricao?: string;
  observacoes?: string | null;
  pendencias?: string | null;
  status_obra?: 'regular' | 'atencao' | 'critica';
  fotos?: { legenda?: string; mime: string; data_base64: string }[];
}): Promise<MutationResult> {
  const id = Number(input.id);
  if (!id) throw new Error('id obrigatorio');
  const atual = await buscarVistoria(input.id);

  const titulo      = input.titulo      !== undefined ? input.titulo      : atual.titulo;
  const vistoriador = input.vistoriador !== undefined ? input.vistoriador : atual.vistoriador;
  const data        = input.data        ?? (typeof atual.data === 'object' && atual.data && 'toISOString' in atual.data ? (atual.data as Date).toISOString().slice(0, 10) : String(atual.data).slice(0, 10));
  const descricao   = input.descricao   ?? atual.descricao;
  const observacoes = input.observacoes !== undefined ? input.observacoes : atual.observacoes;
  const pendencias  = input.pendencias  !== undefined ? input.pendencias  : atual.pendencias;
  const status_obra = input.status_obra ?? atual.status_obra;

  await pool.execute(
    `UPDATE romatec_obra_vistorias SET
       titulo = ?, vistoriador = ?, data = ?, descricao = ?,
       observacoes = ?, pendencias = ?, status_obra = ?
     WHERE id = ?`,
    [titulo, vistoriador, data, descricao, observacoes, pendencias, status_obra, id]
  );

  // Se vier array de fotos, substitui as antigas
  if (Array.isArray(input.fotos)) {
    await pool.execute('DELETE FROM romatec_obra_vistoria_fotos WHERE vistoria_id = ?', [id]);
    for (let i = 0; i < input.fotos.length; i++) {
      const f = input.fotos[i];
      // Se a foto vier sem data_base64 (mantida), pula — front so manda novas/mantidas-com-base64
      if (!f.data_base64) continue;
      await pool.execute(
        `INSERT INTO romatec_obra_vistoria_fotos (vistoria_id, legenda, mime, data_base64, ordem) VALUES (?,?,?,?,?)`,
        [id, f.legenda ?? null, f.mime, f.data_base64, i]
      );
    }
  }

  return { ok: true, message: `Vistoria #${id} atualizada.` };
}

export async function apagarVistoria(input: { id: string; confirm?: boolean }): Promise<MutationResult> {
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] APAGAR vistoria ${input.id} + todas as fotos. IRREVERSÍVEL. Reenvie com confirm:true.` };
  }
  await pool.execute('DELETE FROM romatec_obra_vistoria_fotos WHERE vistoria_id = ?', [input.id]);
  const [r] = await pool.execute<ResultSetHeader>('DELETE FROM romatec_obra_vistorias WHERE id = ?', [input.id]);
  return { ok: true, affected: r.affectedRows, message: `Vistoria ${input.id} apagada.` };
}

export async function apagarFotoVistoria(input: { foto_id: string; confirm?: boolean }): Promise<MutationResult> {
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Apagar foto ${input.foto_id}. Reenvie com confirm:true.` };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    'DELETE FROM romatec_obra_vistoria_fotos WHERE id = ?', [input.foto_id],
  );
  return { ok: true, affected: r.affectedRows, message: `Foto ${input.foto_id} apagada.` };
}

export async function fotoRaw(fotoId: string): Promise<{ mime: string; buffer: Buffer } | null> {
  const [rows] = await pool.execute<FotoRow[]>(
    'SELECT mime, data_base64 FROM romatec_obra_vistoria_fotos WHERE id = ?', [fotoId],
  );
  if (rows.length === 0) return null;
  return { mime: rows[0].mime, buffer: Buffer.from(rows[0].data_base64, 'base64') };
}

// HTML pra impressão direto no browser → "salvar como PDF"
export async function gerarHtmlRelatorio(vistoriaId: string): Promise<string> {
  const v = await buscarVistoria(vistoriaId);

  // Busca dados da obra
  const [obras] = await pool.execute<RowDataPacket[]>(
    'SELECT nome, cliente, endereco, cidade, responsavel_tecnico FROM romatec_obras WHERE id = ?',
    [v.obra_id],
  );
  const obra = obras[0] ?? { nome: '—', cliente: null, endereco: null, cidade: null, responsavel_tecnico: null };

  // Busca fotos com base64 inline
  const [fotos] = await pool.execute<FotoRow[]>(
    'SELECT id, legenda, mime, data_base64, ordem FROM romatec_obra_vistoria_fotos WHERE vistoria_id = ? ORDER BY ordem ASC, id ASC',
    [vistoriaId],
  );

  const escapeHtml = (s: string | null | undefined) =>
    String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string));

  const fotosHtml = fotos.map((f, i) => `
    <div class="foto">
      <img src="data:${f.mime};base64,${f.data_base64}" alt="Foto ${i+1}" />
      <p class="legenda">${i + 1}. ${escapeHtml(f.legenda) || '(sem legenda)'}</p>
    </div>
  `).join('');

  const statusLabel = { regular: 'Regular', atencao: 'Atenção', critica: 'Crítica' }[v.status_obra] || '—';
  const statusColor = { regular: '#0f6e56', atencao: '#854f0b', critica: '#a32d2d' }[v.status_obra] || '#666';

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<title>VTO — ${escapeHtml(obra.nome as string)} — ${escapeHtml(v.data)}</title>
<style>
  @page { margin: 18mm 16mm; size: A4; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #222; margin: 0; }
  .header { border-bottom: 3px solid #0a3d2a; padding-bottom: 12px; margin-bottom: 16px; }
  .header h1 { margin: 0; color: #0a3d2a; font-size: 22px; }
  .header p { margin: 4px 0 0; color: #666; font-size: 13px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
  .meta-item { background: #f8f8f5; padding: 10px 12px; border-radius: 4px; border-left: 3px solid #c9a84c; }
  .meta-item .l { font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
  .meta-item .v { font-size: 13px; margin-top: 2px; color: #222; }
  .status-pill { display: inline-block; padding: 3px 10px; border-radius: 12px; color: white; font-size: 11px; font-weight: 600; background: ${statusColor}; }
  h2 { color: #0a3d2a; font-size: 15px; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-top: 22px; }
  .descricao, .observacoes, .pendencias { font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
  .pendencias { background: #fff8e6; padding: 10px 12px; border-radius: 4px; border-left: 3px solid #ff9900; }
  .fotos-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; page-break-inside: auto; }
  .foto { break-inside: avoid; }
  .foto img { width: 100%; height: 180px; object-fit: cover; border: 1px solid #ddd; border-radius: 4px; }
  .foto .legenda { font-size: 11px; color: #555; margin: 4px 0 8px; }
  .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 10px; color: #888; text-align: center; }
  @media print { .no-print { display: none; } }
</style>
</head><body>
  <div class="header">
    <h1>Vistoria Técnica de Obra (VTO)</h1>
    <p>Romatec Consultoria Imobiliária · Relatório nº ${v.id} · Gerado por ZAYRA em ${new Date().toLocaleString('pt-BR')}</p>
  </div>

  <div class="meta">
    <div class="meta-item"><div class="l">Obra</div><div class="v">${escapeHtml(obra.nome as string)}</div></div>
    <div class="meta-item"><div class="l">Data da Vistoria</div><div class="v">${escapeHtml(v.data)}</div></div>
    <div class="meta-item"><div class="l">Cliente</div><div class="v">${escapeHtml(obra.cliente as string) || '—'}</div></div>
    <div class="meta-item"><div class="l">Endereço</div><div class="v">${escapeHtml(obra.endereco as string) || '—'}, ${escapeHtml(obra.cidade as string) || ''}</div></div>
    <div class="meta-item"><div class="l">Vistoriador</div><div class="v">${escapeHtml(v.vistoriador) || escapeHtml(obra.responsavel_tecnico as string) || '—'}</div></div>
    <div class="meta-item"><div class="l">Status da Obra</div><div class="v"><span class="status-pill">${statusLabel}</span></div></div>
  </div>

  ${v.titulo ? `<h2>${escapeHtml(v.titulo)}</h2>` : ''}

  <h2>Descrição da Vistoria</h2>
  <div class="descricao">${escapeHtml(v.descricao)}</div>

  ${v.observacoes ? `<h2>Observações</h2><div class="observacoes">${escapeHtml(v.observacoes)}</div>` : ''}
  ${v.pendencias ? `<h2>Pendências / Não-conformidades</h2><div class="pendencias">${escapeHtml(v.pendencias)}</div>` : ''}

  ${fotos.length > 0 ? `<h2>Relatório Fotográfico (${fotos.length})</h2><div class="fotos-grid">${fotosHtml}</div>` : ''}

  <div class="footer">
    Documento gerado eletronicamente pela ZAYRA — Assistente Executiva da Romatec.
  </div>

  <script>window.onload = () => window.print();</script>
</body></html>`;
}

// v1.67.1: PDF binario via PDFKit + envio WhatsApp/Telegram (paridade Proposta).
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { sendDocument as sendWhatsAppDocument } from './whatsapp';
import { sendDocument as sendTelegramDocument } from './telegram';
import { getTenantSettings } from '../services/tenantSettings';

export async function gerarPdfVistoria(vistoriaId: string): Promise<Buffer> {
  const v = await buscarVistoria(vistoriaId);
  const [obras] = await pool.execute<RowDataPacket[]>(
    'SELECT nome, cliente, endereco, cidade FROM romatec_obras WHERE id = ?', [v.obra_id]
  );
  const obra = obras[0] ?? { nome: '—', cliente: null, endereco: null, cidade: null };
  const [fotos] = await pool.execute<FotoRow[]>(
    'SELECT id, legenda, mime, data_base64, ordem FROM romatec_obra_vistoria_fotos WHERE vistoria_id = ? ORDER BY ordem ASC, id ASC',
    [vistoriaId]
  );
  const t = await getTenantSettings(1).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliaria';
  const corHex = t?.primary_color || '#10b981';
  const logoFile = path.join(__dirname, '..', 'public', 'romatec-logo-removebg-preview.png');

  const doc = new PDFDocument({ size: 'A4', margin: 48, info: {
    Title: `Vistoria ${v.titulo || '#' + v.id}`,
    Author: brand,
  }});
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  if (fs.existsSync(logoFile)) {
    try { doc.image(logoFile, { fit: [120, 60], align: 'center' }); } catch { /* opt */ }
  } else {
    doc.fontSize(16).fillColor(corHex).text(brand, { align: 'center' });
  }
  doc.moveDown(0.5);
  doc.strokeColor(corHex).lineWidth(2).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.8);
  doc.fontSize(15).fillColor('#111').text('RELATÓRIO DE VISTORIA TÉCNICA', { align: 'center' });
  doc.fontSize(11).fillColor('#444').text(`${v.titulo || 'Vistoria #' + v.id}  ·  ${formatBRDate(v.data)}`, { align: 'center' });
  doc.moveDown(0.8);

  doc.fontSize(11).fillColor(corHex).text('Obra');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#111');
  doc.text(`${obra.nome}${obra.cliente ? ' — ' + obra.cliente : ''}`);
  if (obra.endereco) doc.text(`${obra.endereco}${obra.cidade ? ', ' + obra.cidade : ''}`);
  if (v.vistoriador) doc.text(`Vistoriador: ${v.vistoriador}`);
  doc.text(`Status: ${v.status_obra.toUpperCase()}`);
  doc.moveDown(0.6);

  doc.fontSize(11).fillColor(corHex).text('Descrição');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#111').text(v.descricao || '-', { width: 499 });
  doc.moveDown(0.6);

  if (v.observacoes) {
    doc.fontSize(11).fillColor(corHex).text('Observações');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#111').text(v.observacoes, { width: 499 });
    doc.moveDown(0.6);
  }
  if (v.pendencias) {
    doc.fontSize(11).fillColor('#dc2626').text('Pendências / Não-conformidades');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#111').text(v.pendencias, { width: 499 });
    doc.moveDown(0.6);
  }

  // Fotos: cada uma em pagina propria com legenda
  for (const f of fotos) {
    doc.addPage();
    doc.fontSize(11).fillColor(corHex).text(`Foto ${f.ordem + 1}${f.legenda ? ' — ' + f.legenda : ''}`);
    doc.moveDown(0.4);
    try {
      const buf = Buffer.from(f.data_base64, 'base64');
      doc.image(buf, { fit: [499, 650], align: 'center' });
    } catch (err) {
      doc.fontSize(9).fillColor('#999').text(`(falha ao renderizar foto: ${(err as Error).message})`);
    }
  }

  const footerY = 800;
  doc.fontSize(8).fillColor('#888')
     .text(`${brand} — Relatório gerado eletronicamente.`, 48, footerY, { width: 499, align: 'center' });
  doc.end();
  await new Promise<void>(resolve => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

export async function enviarVistoriaWhatsApp(input: { id: string; telefone?: string }) {
  if (!input.telefone?.trim()) throw new Error('Telefone obrigatorio.');
  const v = await buscarVistoria(input.id);
  const pdfBuf = await gerarPdfVistoria(input.id);
  const fileName = `Vistoria_${v.id}_${(v.titulo || 'obra').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.pdf`;
  const r = await sendWhatsAppDocument(input.telefone.trim(), pdfBuf.toString('base64'), fileName);

  // v1.79.0: trigger automatico de recibo de ciencia da vistoria
  void import('../services/recibosTriggers')
    .then(m => m.gerarReciboVistoriaEntregue(Number(input.id), input.telefone!))
    .catch(err => console.warn('[trigger vistoria_entregue]', (err as Error).message));

  return {
    ok: true as const,
    message: `Vistoria #${v.id} enviada para ${r.phone} (msgId ${r.messageId || '?'}).`,
    messageId: r.messageId, phone: r.phone,
  };
}

export async function enviarVistoriaTelegram(input: { id: string; chatId?: string }) {
  const v = await buscarVistoria(input.id);
  const chatId = input.chatId
    || (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
    || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  if (!chatId) throw new Error('chatId Telegram obrigatorio (TELEGRAM_LEAD_CHAT_ID ou TELEGRAM_AUTHORIZED_USER_IDS).');
  const pdfBuf = await gerarPdfVistoria(input.id);
  if (pdfBuf.length > 50 * 1024 * 1024) {
    throw new Error(`PDF tem ${(pdfBuf.length / 1024 / 1024).toFixed(1)}MB e Telegram aceita ate 50MB.`);
  }
  const fileName = `Vistoria_${v.id}_${(v.titulo || 'obra').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.pdf`;
  try {
    await sendTelegramDocument(chatId, pdfBuf, fileName, `Vistoria #${v.id} — ${v.titulo || formatBRDate(v.data)}`);
  } catch (err) {
    const e = err as Error & { response?: { data?: { description?: string; error_code?: number } } };
    const desc = e.response?.data?.description || e.message;
    const code = e.response?.data?.error_code;
    throw new Error(`Telegram rejeitou: ${desc}${code ? ` (code ${code})` : ''}`);
  }
  return { ok: true as const, message: `Vistoria #${v.id} enviada via Telegram (chat ${chatId}, ${(pdfBuf.length / 1024).toFixed(0)} KB).` };
}
