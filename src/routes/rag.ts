// Endpoints HTTP do RAG — v1.26.0
// POST /rag/ingest, GET /rag/documentos, DELETE /rag/documentos/:id, GET /rag/buscar

import { Router, Request, Response } from 'express';
import multer from 'multer';
import {
  ingerirPdf, ingerirTexto, listarDocumentos, apagarDocumento, detectarCategoria,
} from '../services/ragIngest';
import { buscarMemoria } from '../services/ragSearch';
import { supabaseConfigurado } from '../services/supabase';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use((_req, res, next) => {
  if (!supabaseConfigurado()) {
    return res.status(503).json({ error: 'RAG indisponível: Supabase não configurado no servidor.' });
  }
  next();
});

router.post('/ingest', upload.single('pdf'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie o PDF no campo "pdf" (multipart/form-data).' });
    if (!req.file.mimetype.includes('pdf')) {
      return res.status(400).json({ error: 'Apenas PDF é aceito (recebido: ' + req.file.mimetype + ')' });
    }
    const titulo    = (req.body?.titulo as string | undefined) || req.file.originalname.replace(/\.pdf$/i, '');
    const categoria = (req.body?.categoria as string | undefined) || detectarCategoria(req.file.originalname);
    const fonte     = (req.body?.fonte as string | undefined) || 'web';

    const r = await ingerirPdf({
      pdfBuffer:   req.file.buffer,
      titulo,
      fonte,
      categoria,
      arquivoNome: req.file.originalname,
    });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// v1.27.0: ingest de texto puro (Markdown, transcrições, notas).
// Body JSON: { texto, titulo, fonte?, categoria?, arquivo_nome?, metadata? }
router.post('/ingest-text', async (req: Request, res: Response) => {
  try {
    const b = (req.body ?? {}) as {
      texto?: string; titulo?: string; fonte?: string;
      categoria?: string; arquivo_nome?: string;
      metadata?: Record<string, unknown>;
    };
    if (!b.texto || !b.titulo) {
      return res.status(400).json({ error: 'Campos obrigatórios: "texto" e "titulo".' });
    }
    const r = await ingerirTexto({
      texto:       b.texto,
      titulo:      b.titulo,
      fonte:       b.fonte || 'api',
      categoria:   b.categoria || detectarCategoria(b.titulo),
      arquivoNome: b.arquivo_nome,
      metadata:    b.metadata,
    });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/documentos', async (_req: Request, res: Response) => {
  try {
    res.json(await listarDocumentos());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete('/documentos/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    res.json(await apagarDocumento(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/buscar', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string | undefined) || '';
    if (!q) return res.status(400).json({ error: 'Parâmetro "q" obrigatório.' });
    const resultados = await buscarMemoria(q, {
      categoria: req.query.categoria as string | undefined,
      top_k:     req.query.top_k ? parseInt(req.query.top_k as string, 10) : undefined,
      min_sim:   req.query.min_sim ? parseFloat(req.query.min_sim as string) : undefined,
    });
    res.json({ query: q, resultados });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
