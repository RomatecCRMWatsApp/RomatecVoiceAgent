// Endpoints de geracao/indexacao de contratos — v1.27.1 (Fase 1: indexacao)
// Geracao (Fase 2+) ainda nao implementada — por ora so indexa modelo.

import { Router, Request, Response } from 'express';
import multer from 'multer';
import {
  indexarContratoModelo, listarContratosIndexados, apagarContratoIndexado,
  detectarFonteArquivoPorMime, FonteArquivo,
} from '../services/contratosIngest';
import { supabaseConfigurado } from '../services/supabase';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use((_req, res, next) => {
  if (!supabaseConfigurado()) {
    return res.status(503).json({ error: 'Contratos indisponivel: Supabase nao configurado.' });
  }
  next();
});

// POST /contracts/index — recebe PDF/DOCX (multipart) ou JSON com texto puro
router.post('/index', upload.single('arquivo'), async (req: Request, res: Response) => {
  try {
    let fonteArquivo: FonteArquivo;
    let buffer: Buffer | undefined;
    let texto: string | undefined;
    let arquivoNome: string | undefined;

    if (req.file) {
      const detected = detectarFonteArquivoPorMime(req.file.mimetype);
      if (!detected || detected === 'texto') {
        return res.status(400).json({ error: `Mime nao suportado pra arquivo: ${req.file.mimetype} (use PDF ou DOCX)` });
      }
      fonteArquivo = detected;
      buffer = req.file.buffer;
      arquivoNome = req.file.originalname;
    } else if (req.body?.texto) {
      fonteArquivo = 'texto';
      texto = String(req.body.texto);
      arquivoNome = req.body.arquivo_nome;
    } else {
      return res.status(400).json({ error: 'Envie um arquivo (campo "arquivo") OU JSON com "texto".' });
    }

    const r = await indexarContratoModelo({
      buffer,
      texto,
      fonteArquivo,
      tituloHint:  req.body?.titulo,
      arquivoNome,
      fonte:       req.body?.fonte || 'web',
      tipoForcado: req.body?.tipo_forcado,
      metadata:    req.body?.metadata,
    });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /contracts/indexados — lista todos contratos modelo
router.get('/indexados', async (_req: Request, res: Response) => {
  try {
    res.json(await listarContratosIndexados());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// DELETE /contracts/indexados/:id
router.delete('/indexados/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    res.json(await apagarContratoIndexado(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
