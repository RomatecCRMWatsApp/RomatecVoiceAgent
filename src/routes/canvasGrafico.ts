// v3.51.0 — VTA Canvas Grafico Infinito (Modulo A): CRUD + prancha tecnica.
// Boot-safe: pool importado de forma lazy (database/connection lanca se faltar DATABASE_URL).
import { Router, type Request, type Response } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { requireAuth } from '../middleware/auth';
import { gerarPranchaSVG } from '../services/canvasService';
import { sendImage } from '../integrations/whatsapp';

const router = Router();

async function db() {
  const m = await import('../database/connection');
  return m.default;
}

const TIPOS = ['croqui', 'planta_baixa', 'cobertura', 'quadra', 'livre'];
const TIPOS_ELEM = ['linha', 'poligono', 'texto', 'seta', 'cota', 'norte', 'circulo', 'retangulo', 'imagem'];

// POST / — criar canvas
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    const tipo = TIPOS.includes(b.tipo) ? b.tipo : 'livre';
    const pool = await db();
    const [r] = await pool.execute<ResultSetHeader>(
      `INSERT INTO canvas_graficos (tipo, titulo, laudo_id, proposta_id, escala_grafica, largura_virtual, altura_virtual, criado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tipo, b.titulo ?? null, b.laudo_id ?? null, b.proposta_id ?? null,
       b.escala_grafica ?? '1:500', b.largura_virtual ?? 2000, b.altura_virtual ?? 2000, b.criado_por ?? null],
    );
    res.status(201).json({ id: r.insertId, tipo });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.52.0 — GET /por-laudo/:laudoId e /por-proposta/:propostaId — canvas mais
// recente vinculado ao registro (permite editar em vez de duplicar). 404 se nenhum.
async function buscarCanvasPorVinculo(
  campo: 'laudo_id' | 'proposta_id', valor: string, res: Response,
): Promise<void> {
  const pool = await db();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, tipo, titulo, dados_svg, dados_json, largura_virtual, altura_virtual, escala_grafica
       FROM canvas_graficos WHERE ${campo} = ? ORDER BY id DESC LIMIT 1`,
    [valor],
  );
  if (!rows.length) { res.status(404).json({ error: 'nenhum canvas vinculado' }); return; }
  res.json({ canvas: rows[0] });
}

router.get('/por-laudo/:laudoId(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try { await buscarCanvasPorVinculo('laudo_id', String(req.params.laudoId), res); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.get('/por-proposta/:propostaId(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try { await buscarCanvasPorVinculo('proposta_id', String(req.params.propostaId), res); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.60.0 — listar TODOS os croquis vinculados (multi-croqui por laudo/proposta).
// Reaproveita canvas_graficos; NAO cria tabela nova. Usado pela aba VTA do /obras.
async function listarCanvasPorVinculo(
  campo: 'laudo_id' | 'proposta_id', valor: string, res: Response,
): Promise<void> {
  const pool = await db();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, tipo, titulo, escala_grafica, criado_em, atualizado_em
       FROM canvas_graficos WHERE ${campo} = ? ORDER BY atualizado_em DESC, id DESC`,
    [valor],
  );
  res.json({ croquis: rows });
}

router.get('/lista/por-laudo/:laudoId(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try { await listarCanvasPorVinculo('laudo_id', String(req.params.laudoId), res); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.get('/lista/por-proposta/:propostaId(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try { await listarCanvasPorVinculo('proposta_id', String(req.params.propostaId), res); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.60.0 — croquis recentes (hub VTA do /obras nao e escopado a um laudo).
router.get('/lista/recentes', requireAuth, async (_req: Request, res: Response) => {
  try {
    const pool = await db();
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, tipo, titulo, escala_grafica, criado_em, atualizado_em
         FROM canvas_graficos WHERE tipo = 'croqui' ORDER BY atualizado_em DESC, id DESC LIMIT 50`,
    );
    res.json({ croquis: rows });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// GET /:id — canvas + elementos
router.get('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await db();
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM canvas_graficos WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'canvas nao encontrado' }); return; }
    const [els] = await pool.execute<RowDataPacket[]>('SELECT * FROM canvas_elementos WHERE canvas_id = ? ORDER BY ordem, id', [req.params.id]);
    res.json({ canvas: rows[0], elementos: els });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// PUT /:id — salvar (svg + json + meta)
router.put('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    const pool = await db();
    const [r] = await pool.execute<ResultSetHeader>(
      `UPDATE canvas_graficos SET titulo = COALESCE(?, titulo), tipo = COALESCE(?, tipo),
       dados_svg = COALESCE(?, dados_svg), dados_json = COALESCE(?, dados_json),
       escala_grafica = COALESCE(?, escala_grafica), largura_virtual = COALESCE(?, largura_virtual),
       altura_virtual = COALESCE(?, altura_virtual) WHERE id = ?`,
      [b.titulo ?? null, TIPOS.includes(b.tipo) ? b.tipo : null, b.dados_svg ?? null,
       b.dados_json != null ? JSON.stringify(b.dados_json) : null,
       b.escala_grafica ?? null, b.largura_virtual ?? null, b.altura_virtual ?? null, req.params.id],
    );
    if (!r.affectedRows) { res.status(404).json({ error: 'canvas nao encontrado' }); return; }
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// DELETE /:id
router.delete('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await db();
    const [r] = await pool.execute<ResultSetHeader>('DELETE FROM canvas_graficos WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) { res.status(404).json({ error: 'canvas nao encontrado' }); return; }
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// POST /:id/elementos
router.post('/:id(\\d+)/elementos', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    if (!TIPOS_ELEM.includes(b.tipo_elemento)) { res.status(400).json({ error: 'tipo_elemento invalido' }); return; }
    if (b.dados_elemento == null) { res.status(400).json({ error: 'dados_elemento obrigatorio' }); return; }
    const pool = await db();
    const [r] = await pool.execute<ResultSetHeader>(
      'INSERT INTO canvas_elementos (canvas_id, tipo_elemento, dados_elemento, camada, ordem) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, b.tipo_elemento, JSON.stringify(b.dados_elemento), b.camada ?? 'padrao', b.ordem ?? 0],
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// PUT /:id/elementos/:elId
router.put('/:id(\\d+)/elementos/:elId(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    const pool = await db();
    const [r] = await pool.execute<ResultSetHeader>(
      `UPDATE canvas_elementos SET dados_elemento = COALESCE(?, dados_elemento), camada = COALESCE(?, camada), ordem = COALESCE(?, ordem)
       WHERE id = ? AND canvas_id = ?`,
      [b.dados_elemento != null ? JSON.stringify(b.dados_elemento) : null, b.camada ?? null, b.ordem ?? null, req.params.elId, req.params.id],
    );
    if (!r.affectedRows) { res.status(404).json({ error: 'elemento nao encontrado' }); return; }
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// DELETE /:id/elementos/:elId
router.delete('/:id(\\d+)/elementos/:elId(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await db();
    const [r] = await pool.execute<ResultSetHeader>('DELETE FROM canvas_elementos WHERE id = ? AND canvas_id = ?', [req.params.elId, req.params.id]);
    if (!r.affectedRows) { res.status(404).json({ error: 'elemento nao encontrado' }); return; }
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// POST /:id/prancha — gera + salva prancha SVG (carimbo automatico)
router.post('/:id(\\d+)/prancha', requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await db();
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM canvas_graficos WHERE id = ?', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'canvas nao encontrado' }); return; }
    const cv = rows[0];
    const b = req.body || {};
    const svg = gerarPranchaSVG({
      tituloObra: b.tituloObra ?? cv.titulo,
      proprietario: b.proprietario,
      endereco: b.endereco,
      municipio: b.municipio,
      tipoObra: b.tipoObra,
      escala: b.escala ?? cv.escala_grafica,
      dataPrancha: b.dataPrancha,
      numeroPrancha: b.numeroPrancha,
      revisao: b.revisao,
      conteudoSvg: cv.dados_svg ?? '',
      larguraVirtual: cv.largura_virtual,
      alturaVirtual: cv.altura_virtual,
    });
    const [r] = await pool.execute<ResultSetHeader>(
      `INSERT INTO pranchas_tecnicas (canvas_id, titulo_obra, proprietario, endereco, municipio, tipo_obra, escala, numero_prancha, revisao, svg_final)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, b.tituloObra ?? cv.titulo ?? null, b.proprietario ?? null, b.endereco ?? null, b.municipio ?? null,
       b.tipoObra ?? null, b.escala ?? cv.escala_grafica ?? null, b.numeroPrancha ?? null, b.revisao ?? 'R00', svg],
    );
    res.json({ pranchaId: r.insertId, svg });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// GET /:id/prancha — ultima prancha salva
router.get('/:id(\\d+)/prancha', requireAuth, async (req: Request, res: Response) => {
  try {
    const pool = await db();
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM pranchas_tecnicas WHERE canvas_id = ? ORDER BY id DESC LIMIT 1', [req.params.id]);
    if (!rows.length) { res.status(404).json({ error: 'prancha nao gerada' }); return; }
    res.json({ prancha: rows[0] });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// POST /:id/exportar-whatsapp — recebe PNG base64 (render do cliente) e envia via Z-API
router.post('/:id(\\d+)/exportar-whatsapp', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.telefone || !String(b.telefone).trim()) { res.status(400).json({ error: 'telefone obrigatorio' }); return; }
    if (!b.imagemBase64 || !String(b.imagemBase64).trim()) { res.status(400).json({ error: 'imagemBase64 obrigatorio' }); return; }
    const r = await sendImage(String(b.telefone).trim(), String(b.imagemBase64), b.legenda || 'Croqui - Romatec Consultoria Total');
    res.json({ ok: true, messageId: r.messageId });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

export default router;
