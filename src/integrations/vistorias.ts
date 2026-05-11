// VTO — Vistoria Técnica de Obra (v1.21).
// Relatório com fotos (base64 no MySQL) + export PDF.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { formatBR, formatBRDate } from '../util/format';

type VistoriaRow = RowDataPacket & {
  id: number; obra_id: number;
  data: Date;
  hora: string | null;  // v3.4.0: formato "HH:MM:SS" do TIME column
  titulo: string | null;
  vistoriador: string | null;
  descricao: string;
  observacoes: string | null;
  pendencias: string | null;
  status_obra: 'regular' | 'atencao' | 'critica';
  // v3.4.0: assinatura digital ICP-Brasil
  pdf_assinado: Buffer | null;
  assinatura_meta: string | Record<string, unknown> | null;
  assinado_em: Date | string | null;
  assinado_por_cert_id: number | null;
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
    SELECT v.*,
           COUNT(f.id) AS qtd_fotos,
           CASE WHEN v.pdf_assinado IS NULL THEN 0 ELSE 1 END AS assinado
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
    hora:         r.hora as string | null,  // v3.4.0
    titulo:       r.titulo as string | null,
    vistoriador:  r.vistoriador as string | null,
    descricao:    r.descricao as string,
    observacoes:  r.observacoes as string | null,
    pendencias:   r.pendencias as string | null,
    status_obra:  r.status_obra as string,
    qtd_fotos:    Number(r.qtd_fotos ?? 0),
    // v3.4.0: status de assinatura ICP-Brasil
    assinado:     !!r.assinado,
    assinado_em:  r.assinado_em
      ? ((r.assinado_em as Date) instanceof Date
          ? (r.assinado_em as Date).toISOString()
          : String(r.assinado_em))
      : null,
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

  // v3.4.0: assinatura ICP-Brasil — parse JSON + format datetime
  const assinatura_meta = r.assinatura_meta == null
    ? null
    : (typeof r.assinatura_meta === 'string' ? JSON.parse(r.assinatura_meta) : r.assinatura_meta);
  const assinadoEmIso = r.assinado_em
    ? (r.assinado_em instanceof Date ? r.assinado_em.toISOString() : String(r.assinado_em))
    : null;

  return {
    id: String(r.id), obra_id: String(r.obra_id),
    data: formatBRDate(r.data),
    hora: r.hora,  // v3.4.0: TIME format "HH:MM:SS" ou null
    titulo: r.titulo,
    vistoriador: r.vistoriador, descricao: r.descricao,
    observacoes: r.observacoes, pendencias: r.pendencias,
    status_obra: r.status_obra,
    // v3.4.0: status de assinatura (sem o blob — payload leve)
    assinado: !!r.pdf_assinado,
    assinado_em: assinadoEmIso,
    assinatura_meta,
    fotos: fotos.map(f => ({
      id: String(f.id), legenda: f.legenda,
      mime: f.mime, ordem: f.ordem,
      url: `/api/vistorias/${id}/fotos/${f.id}/raw`,
    })),
  };
}

export async function criarVistoria(input: {
  obra_id: string; descricao: string;
  data?: string;
  hora?: string | null;  // v3.4.0: "HH:MM" ou "HH:MM:SS"
  titulo?: string;
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
      (obra_id, data, hora, titulo, vistoriador, descricao, observacoes, pendencias, status_obra)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      input.obra_id,
      input.data ?? new Date().toISOString().slice(0, 10),
      input.hora ?? null,  // v3.4.0
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
  hora?: string | null;  // v3.4.0
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
  // v3.4.0: hora separada (DATE+TIME, nao DATETIME — compatibilidade com registros antigos)
  const hora        = input.hora        !== undefined ? input.hora        : atual.hora;
  const descricao   = input.descricao   ?? atual.descricao;
  const observacoes = input.observacoes !== undefined ? input.observacoes : atual.observacoes;
  const pendencias  = input.pendencias  !== undefined ? input.pendencias  : atual.pendencias;
  const status_obra = input.status_obra ?? atual.status_obra;

  await pool.execute(
    `UPDATE romatec_obra_vistorias SET
       titulo = ?, vistoriador = ?, data = ?, hora = ?, descricao = ?,
       observacoes = ?, pendencias = ?, status_obra = ?
     WHERE id = ?`,
    [titulo, vistoriador, data, hora, descricao, observacoes, pendencias, status_obra, id]
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

// v3.4.0: meta visual de assinatura — renderiza bloco "Assinado Digitalmente" no PDF
export interface SignatureVisualMeta {
  signer_cn: string;
  signer_doc: string | null;
  issuer_cn: string | null;
  validade_ate: string | null;
  data_assinatura: Date;
  thumbprint: string | null;
}

export async function gerarPdfVistoria(
  vistoriaId: string | number,
  signatureVisualMeta?: SignatureVisualMeta,
): Promise<Buffer> {
  const v = await buscarVistoria(String(vistoriaId));
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

  // v3.4.1: bufferPages permite desenhar footer em todas as paginas no final,
  // evitando que o footer absoluto em Y=800 dispare auto-page-break e crie
  // pagina em branco extra apos o bloco de assinatura digital.
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
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

  // Subtitulo com numero/titulo da vistoria
  const subtitulo = `${v.titulo || 'Vistoria #' + v.id}`;
  doc.fontSize(11).fillColor('#444').text(subtitulo, { align: 'center' });
  doc.moveDown(0.8);

  // v3.4.0: bloco "Dados da Vistoria" — formato tabular com Data e Hora + Local explicitos
  doc.fontSize(11).fillColor(corHex).text('Dados da Vistoria');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#111');

  // Data e Hora juntos (formato brasileiro). Hora opcional pra compat com registros antigos.
  const dataHoraStr = v.hora
    ? `${formatBRDate(v.data)} as ${String(v.hora).slice(0, 5)}`
    : formatBRDate(v.data);
  doc.text(`Data e Hora: ${dataHoraStr}`);

  // Local: cidade explicita (puxa da obra)
  const localStr = obra.cidade ? String(obra.cidade) : '—';
  doc.text(`Local: ${localStr}`);

  doc.text(`Obra: ${obra.nome}${obra.cliente ? ' — ' + obra.cliente : ''}`);
  if (obra.endereco) doc.text(`Endereco: ${obra.endereco}`);
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

  // v3.4.0: Fotos — 2 por pagina (em vez de 1 por pagina)
  // Carimbo GPS ja embutido no pixel da imagem (Canvas no client v2.4.1+),
  // PDF apenas renderiza como esta.
  const renderFotoNoPdf = (foto: FotoRow, indice: number) => {
    const caption = `Foto ${indice}${foto.legenda ? ' — ' + foto.legenda : ''}`;
    doc.fontSize(11).fillColor(corHex).text(caption, { width: 499 });
    doc.moveDown(0.3);
    try {
      const buf = Buffer.from(foto.data_base64, 'base64');
      doc.image(buf, { fit: [499, 310], align: 'center' });
    } catch (err) {
      doc.fontSize(9).fillColor('#999').text(`(falha ao renderizar foto: ${(err as Error).message})`);
    }
  };

  // Itera em pares: (0,1), (2,3), (4,5)...
  for (let i = 0; i < fotos.length; i += 2) {
    doc.addPage();
    // Cabecalho da pagina de fotos
    doc.fontSize(12).fillColor(corHex).text('Relatorio Fotografico', { align: 'left' });
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.4);

    renderFotoNoPdf(fotos[i], i + 1);

    if (fotos[i + 1]) {
      doc.moveDown(0.8);
      renderFotoNoPdf(fotos[i + 1], i + 2);
    }
  }

  // v3.4.0: bloco visual de assinatura ICP-Brasil (so renderiza se signatureVisualMeta fornecida)
  if (signatureVisualMeta) {
    doc.addPage();
    doc.fontSize(13).fillColor(corHex).text('ASSINATURA DIGITAL', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#444').text('Padrao ICP-Brasil (MP 2.200-2 / 2001)', { align: 'center' });
    doc.moveDown(0.8);

    doc.strokeColor(corHex).lineWidth(1).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
    doc.moveDown(0.5);

    const m = signatureVisualMeta;
    doc.fontSize(10).fillColor('#111');

    doc.font('Helvetica-Bold').text('Signatario: ', { continued: true })
       .font('Helvetica').text(m.signer_cn);

    if (m.signer_doc) {
      doc.font('Helvetica-Bold').text('CPF/CNPJ: ', { continued: true })
         .font('Helvetica').text(m.signer_doc);
    }
    if (m.issuer_cn) {
      doc.font('Helvetica-Bold').text('Emissor: ', { continued: true })
         .font('Helvetica').text(m.issuer_cn);
    }
    if (m.validade_ate) {
      doc.font('Helvetica-Bold').text('Validade do certificado: ate ', { continued: true })
         .font('Helvetica').text(String(m.validade_ate).slice(0, 10));
    }

    const dataAssStr = m.data_assinatura.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    doc.font('Helvetica-Bold').text('Data da assinatura: ', { continued: true })
       .font('Helvetica').text(`${dataAssStr} (UTC-3 / Brasilia)`);

    if (m.thumbprint) {
      doc.font('Helvetica-Bold').text('Thumbprint SHA-1: ', { continued: true })
         .font('Helvetica').fontSize(8).text(m.thumbprint, { width: 400 });
      doc.fontSize(10);
    }

    doc.moveDown(0.8);
    doc.strokeColor(corHex).lineWidth(1).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(9).fillColor('#666').text(
      'Documento assinado digitalmente conforme MP 2.200-2/2001 (ICP-Brasil). ' +
      'Validavel em https://validar.iti.gov.br/validar e no painel "Assinaturas" do Adobe Acrobat Reader.',
      { align: 'center', width: 499 }
    );
  }

  // v3.4.2: itera buffered pages e desenha footer em CADA pagina.
  // CRITICO: footer fica em Y=812 (page.height - 30), que esta ABAIXO da margem
  // inferior padrao (842-48=794). Sem mexer na margem, PDFKit dispara auto-page-
  // break em cada chamada de text() e cria N paginas vazias (uma por pagina
  // original). Setando margins.bottom=0 ao redor do text(), a area usavel se
  // estende ate o fim da pagina e o footer fica abaixo sem disparar break.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const savedBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor('#888').text(
      `${brand} — Relatório gerado eletronicamente.`,
      48, doc.page.height - 30,
      { width: 499, align: 'center', lineBreak: false },
    );
    doc.page.margins.bottom = savedBottomMargin;
  }
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
