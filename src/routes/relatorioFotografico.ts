// v3.51.0 — VTA Relatorio Fotografico (Modulo B): CRUD + upload foto c/ overlay + envio Z-API.
// Boot-safe: pool e overlayService importados de forma lazy.
import { Router, type Request, type Response } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import multer from 'multer';
import { requireAuth, requireCeoToken } from '../middleware/auth';
import { sendImage } from '../integrations/whatsapp';
import type { RelatorioFotograficoMeta, FotoVistoriaPdf } from '../services/relatorioFotograficoPdf';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function db() {
  const m = await import('../database/connection');
  return m.default;
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// POST / — criar relatorio
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.titulo || !String(b.titulo).trim()) { res.status(400).json({ error: 'titulo obrigatorio' }); return; }
    if (!b.colaborador || !String(b.colaborador).trim()) { res.status(400).json({ error: 'colaborador obrigatorio' }); return; }
    const pool = await db();
    const [r] = await pool.execute<ResultSetHeader>(
      `INSERT INTO relatorios_fotograficos (titulo, laudo_id, proposta_id, colaborador, municipio, data_vistoria, observacoes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [String(b.titulo).trim(), b.laudo_id ?? null, b.proposta_id ?? null, String(b.colaborador).trim(),
       b.municipio ?? null, b.data_vistoria ?? null, b.observacoes ?? null],
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// GET /:id — relatorio + fotos
router.get('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await db();
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM relatorios_fotograficos WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'relatorio nao encontrado' }); return; }
    const [fotos] = await pool.execute<RowDataPacket[]>('SELECT * FROM fotos_vistoria WHERE relatorio_id = ? ORDER BY ordem, id', [req.params.id]);
    res.json({ relatorio: rows[0], fotos });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// PUT /:id — atualizar dados
router.put('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    const pool = await db();
    const [r] = await pool.execute<ResultSetHeader>(
      `UPDATE relatorios_fotograficos SET titulo = COALESCE(?, titulo), colaborador = COALESCE(?, colaborador),
       municipio = COALESCE(?, municipio), data_vistoria = COALESCE(?, data_vistoria),
       observacoes = COALESCE(?, observacoes), status = COALESCE(?, status) WHERE id = ?`,
      [b.titulo ?? null, b.colaborador ?? null, b.municipio ?? null, b.data_vistoria ?? null,
       b.observacoes ?? null, ['rascunho', 'finalizado', 'enviado'].includes(b.status) ? b.status : null, req.params.id],
    );
    if (!r.affectedRows) { res.status(404).json({ error: 'relatorio nao encontrado' }); return; }
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// DELETE /:id
router.delete('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await db();
    const [r] = await pool.execute<ResultSetHeader>('DELETE FROM relatorios_fotograficos WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) { res.status(404).json({ error: 'relatorio nao encontrado' }); return; }
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// POST /:id/fotos — upload foto + aplicar overlay tecnico
router.post('/:id(\\d+)/fotos', requireAuth, upload.single('foto'), async (req: Request, res: Response) => {
  try {
    const file = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
    if (!file || !file.buffer || !file.buffer.length) { res.status(400).json({ error: 'arquivo (foto) obrigatorio' }); return; }
    const pool = await db();
    const [rel] = await pool.execute<RowDataPacket[]>('SELECT * FROM relatorios_fotograficos WHERE id = ?', [req.params.id]);
    if (!rel.length) { res.status(404).json({ error: 'relatorio nao encontrado' }); return; }
    const b = req.body || {};
    const colaborador = (b.colaborador && String(b.colaborador).trim()) || rel[0].colaborador;
    const municipio = (b.municipio && String(b.municipio).trim()) || rel[0].municipio || '';
    const horario = b.horario_captura || new Date().toISOString();

    const { aplicarOverlayFoto } = await import('../services/overlayService');
    const overlay = await aplicarOverlayFoto({
      imageBuffer: file.buffer,
      latitude: numOrNull(b.latitude),
      longitude: numOrNull(b.longitude),
      altitude_m: numOrNull(b.altitude_m),
      utm_zona: b.utm_zona ?? '',
      utm_e: numOrNull(b.utm_e),
      utm_n: numOrNull(b.utm_n),
      datum: b.datum ?? 'SIRGAS 2000',
      municipio,
      logradouro: b.logradouro ?? '',
      horario_captura: horario,
      colaborador,
    });

    const [r] = await pool.execute<ResultSetHeader>(
      `INSERT INTO fotos_vistoria (relatorio_id, filename_original, base64_overlay, latitude, longitude, altitude_m,
        utm_zona, utm_e, utm_n, datum, municipio, logradouro, horario_captura, colaborador, descricao, ordem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, file.originalname ?? null, overlay.base64, numOrNull(b.latitude), numOrNull(b.longitude),
       numOrNull(b.altitude_m), b.utm_zona ?? null, numOrNull(b.utm_e), numOrNull(b.utm_n), b.datum ?? 'SIRGAS 2000',
       municipio || null, b.logradouro ?? null, new Date(horario), colaborador, b.descricao ?? null, parseInt(b.ordem, 10) || 0],
    );
    res.status(201).json({ id: r.insertId, base64_overlay: overlay.base64, largura: overlay.largura, altura: overlay.altura });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// PUT /:id/fotos/:fId — atualizar descricao/colaborador/ordem
router.put('/:id(\\d+)/fotos/:fId(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    const pool = await db();
    const [r] = await pool.execute<ResultSetHeader>(
      `UPDATE fotos_vistoria SET descricao = COALESCE(?, descricao), colaborador = COALESCE(?, colaborador), ordem = COALESCE(?, ordem)
       WHERE id = ? AND relatorio_id = ?`,
      [b.descricao ?? null, b.colaborador ?? null, b.ordem != null ? parseInt(b.ordem, 10) : null, req.params.fId, req.params.id],
    );
    if (!r.affectedRows) { res.status(404).json({ error: 'foto nao encontrada' }); return; }
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// DELETE /:id/fotos/:fId
router.delete('/:id(\\d+)/fotos/:fId(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await db();
    const [r] = await pool.execute<ResultSetHeader>('DELETE FROM fotos_vistoria WHERE id = ? AND relatorio_id = ?', [req.params.fId, req.params.id]);
    if (!r.affectedRows) { res.status(404).json({ error: 'foto nao encontrada' }); return; }
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// POST /:id/enviar-whatsapp — envia todas as fotos com overlay via Z-API
router.post('/:id(\\d+)/enviar-whatsapp', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.telefone || !String(b.telefone).trim()) { res.status(400).json({ error: 'telefone obrigatorio' }); return; }
    const pool = await db();
    const [fotos] = await pool.execute<RowDataPacket[]>('SELECT * FROM fotos_vistoria WHERE relatorio_id = ? ORDER BY ordem, id', [req.params.id]);
    if (!fotos.length) { res.status(404).json({ error: 'nenhuma foto no relatorio' }); return; }
    let enviados = 0;
    for (const f of fotos) {
      const img = f.base64_overlay || f.path_overlay;
      if (!img) continue;
      await sendImage(String(b.telefone).trim(), String(img), f.descricao || 'Romatec Consultoria Total');
      enviados++;
    }
    await pool.execute('UPDATE relatorios_fotograficos SET status = ? WHERE id = ?', ['enviado', req.params.id]);
    res.json({ ok: true, enviados });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.53.0 (Task 3): POST /:id/enviar-telegram — manda o PDF técnico como documento
router.post('/:id(\\d+)/enviar-telegram', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.chat_id || !String(b.chat_id).trim()) { res.status(400).json({ error: 'chat_id obrigatorio' }); return; }
    const dados = await carregarRelatorioEFotos(String(req.params.id));
    if (!dados) { res.status(404).json({ error: 'relatorio nao encontrado' }); return; }
    const { gerarPdfRelatorioFotografico } = await import('../services/relatorioFotograficoPdf');
    const pdf = await gerarPdfRelatorioFotografico({
      relatorio: dados.relatorio as unknown as RelatorioFotograficoMeta,
      fotos: dados.fotos as unknown as FotoVistoriaPdf[],
    });
    const { sendDocument } = await import('../integrations/telegram');
    await sendDocument(
      String(b.chat_id).trim(), pdf, `RelatorioFotografico-${req.params.id}.pdf`,
      dados.relatorio.titulo || 'Relatório Fotográfico — Romatec Consultoria Total');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── v3.53.0 (Task 2): PDF técnico + assinatura ICP-Brasil ───────────────────
async function carregarRelatorioEFotos(id: string) {
  const pool = await db();
  const [rel] = await pool.execute<RowDataPacket[]>('SELECT * FROM relatorios_fotograficos WHERE id = ?', [id]);
  if (!rel.length) return null;
  const [fotos] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM fotos_vistoria WHERE relatorio_id = ? ORDER BY ordem, id', [id]);
  return { relatorio: rel[0], fotos };
}

// GET /:id/pdf — gera o PDF técnico do relatório (sem assinatura)
router.get('/:id(\\d+)/pdf', requireAuth, async (req: Request, res: Response) => {
  try {
    const dados = await carregarRelatorioEFotos(String(req.params.id));
    if (!dados) { res.status(404).json({ error: 'relatorio nao encontrado' }); return; }
    const { gerarPdfRelatorioFotografico } = await import('../services/relatorioFotograficoPdf');
    const pdf = await gerarPdfRelatorioFotografico({
      relatorio: dados.relatorio as unknown as RelatorioFotograficoMeta,
      fotos: dados.fotos as unknown as FotoVistoriaPdf[],
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="RelatorioFotografico-${req.params.id}.pdf"`);
    res.send(pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// POST /:id/assinar — assina o PDF com PAdES ICP-Brasil e persiste
router.post('/:id(\\d+)/assinar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const dados = await carregarRelatorioEFotos(String(req.params.id));
    if (!dados) { res.status(404).json({ error: 'relatorio nao encontrado' }); return; }
    const perfil = (req.body?.perfil === 'pf' ? 'pf' : 'pj') as 'pj' | 'pf';
    const certsMod = await import('../services/signingCertificates');
    const cert = await certsMod.getCertForSigning(perfil);
    if (!cert) { res.status(400).json({ error: `Certificado ${perfil.toUpperCase()} nao cadastrado em /obras → Certs` }); return; }

    const agora = new Date();
    const signatureMeta = {
      signer_cn: cert.meta.subject_cn ?? 'Romatec',
      signer_doc: cert.meta.subject_doc,
      issuer_cn: cert.meta.issuer_cn,
      validade_ate: cert.meta.validade_ate == null ? null : String(cert.meta.validade_ate),
      data_assinatura: agora,
      thumbprint: cert.meta.thumbprint,
    };
    const { gerarPdfRelatorioFotografico } = await import('../services/relatorioFotograficoPdf');
    const pdfBase = await gerarPdfRelatorioFotografico({
      relatorio: dados.relatorio as unknown as RelatorioFotograficoMeta,
      fotos: dados.fotos as unknown as FotoVistoriaPdf[],
      signatureMeta,
    });
    const pdfSignerMod = await import('../services/pdfSigner');
    const pdfAssinado = await pdfSignerMod.signPdfBuffer(pdfBase, cert.pfx, cert.senha, {
      name: cert.meta.subject_cn || 'Romatec',
      reason: `Relatorio Fotografico #${req.params.id}`,
      location: `${dados.relatorio.municipio || 'Açailândia'}/MA`,
      contactInfo: cert.meta.subject_doc || '',
    });
    const pool = await db();
    await pool.execute<ResultSetHeader>(
      'UPDATE relatorios_fotograficos SET pdf_assinado = ?, assinado_em = ?, status = ? WHERE id = ?',
      [pdfAssinado, agora, 'finalizado', req.params.id]);
    res.json({
      ok: true, assinado_por: cert.meta.subject_cn,
      cert_validade: cert.meta.validade_ate, pdf_size_bytes: pdfAssinado.length,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// GET /:id/pdf-assinado — serve o PDF assinado salvo (404 se ainda não assinado)
router.get('/:id(\\d+)/pdf-assinado', requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await db();
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT pdf_assinado FROM relatorios_fotograficos WHERE id = ?', [req.params.id]);
    const buf = rows.length ? (rows[0].pdf_assinado as Buffer | null) : null;
    if (!buf) { res.status(404).json({ error: 'relatorio nao assinado ainda' }); return; }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="RelatorioFotografico-${req.params.id}-assinado.pdf"`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

export default router;
