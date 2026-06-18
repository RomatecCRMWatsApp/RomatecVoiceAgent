// src/routes/reformaPiso.ts
// v3.67.0: rotas da Proposta de Reforma — Piso Sobreposto.
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { calcular, mesclarConfig } from '../services/reformaPiso/reformaPisoCalc';
import { gerarPdf, mesclarPlantasPdf, type ExtrasPdf } from '../services/reformaPiso/reformaPisoPdf';
import {
  salvar, listar, buscarPorId, marcarEnviada, atualizar,
  adicionarFoto, listarFotos, fotoRaw, removerFoto, carregarFotosBase64,
  adicionarAnexoPlanta, listarAnexos, anexoRaw, removerAnexo, carregarPlantasImagens,
} from '../services/reformaPiso/reformaPisoRepo';
import { DadosProposta, TemaProposta } from '../services/reformaPiso/reformaPisoTypes';

const router = Router();
// v3.68.0: uploads em memória (base64/BLOB no banco — Railway é efêmero). 25MB/arquivo.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/** Carrega fotos + plantas de uma proposta. Retorna os extras do PDF + os
 *  buffers das plantas em PDF (para mesclar ao final do documento). */
async function montarExtras(propostaId: number): Promise<{ extras: ExtrasPdf; plantasPdfBuffers: Buffer[] }> {
  const [fotos, plantasImagens, anexos] = await Promise.all([
    carregarFotosBase64(propostaId),
    carregarPlantasImagens(propostaId),
    listarAnexos(propostaId),
  ]);
  const naoImagem = anexos.filter((a) => !a.is_imagem);
  const ehPdf = (a: { mime_type: string; nome_original: string }) =>
    /pdf/i.test(a.mime_type) || /\.pdf$/i.test(a.nome_original);
  const plantasPdfBuffers: Buffer[] = [];
  for (const a of naoImagem.filter(ehPdf)) {
    const raw = await anexoRaw(a.id);
    if (raw) plantasPdfBuffers.push(raw.buffer);
  }
  const plantasArquivos = naoImagem.map((a) => ({ nome: a.nome_original, anexado: ehPdf(a) }));
  return { extras: { fotos, plantasImagens, plantasArquivos }, plantasPdfBuffers };
}

const TEMAS_VALIDOS: TemaProposta[] = ['tradicional', 'prime1', 'prime2'];

function validar(body: unknown): DadosProposta {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') throw new Error('Payload inválido.');
  if (!b.contratanteNome) throw new Error('Campo "contratanteNome" é obrigatório.');
  if (!Array.isArray(b.ambientes) || b.ambientes.length === 0) {
    throw new Error('Informe ao menos um ambiente em "ambientes".');
  }
  if (b.tema && !TEMAS_VALIDOS.includes(b.tema as TemaProposta)) {
    throw new Error(`Tema inválido. Use: ${TEMAS_VALIDOS.join(', ')}.`);
  }
  return b as unknown as DadosProposta;
}

/** GET /api/propostas/reforma-piso  → lista as propostas */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await listar(Number(req.query.limite) || 100);
    return res.json({ ok: true, total: rows.length, propostas: rows });
  } catch (err) {
    return res.status(400).json({ ok: false, erro: (err as Error).message });
  }
});

/** GET /api/propostas/reforma-piso/:id  → detalhe (sem blobs) */
router.get('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = await buscarPorId(Number(req.params.id));
    if (!p) return res.status(404).json({ ok: false, erro: 'Proposta não encontrada.' });
    return res.json({ ok: true, proposta: p });
  } catch (err) {
    return res.status(400).json({ ok: false, erro: (err as Error).message });
  }
});

/** PUT /api/propostas/reforma-piso/:id  → edita (recalcula + atualiza) */
router.put('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existente = await buscarPorId(id);
    if (!existente) return res.status(404).json({ ok: false, erro: 'Proposta não encontrada.' });
    const dados = validar(req.body);
    const cfg = mesclarConfig(dados.config);
    const resultado = calcular(dados.ambientes, dados.config, dados.comRemocao, dados.rodapeEmbutido);
    const tema = (dados.tema ?? 'tradicional') as TemaProposta;
    await atualizar(id, dados, cfg, resultado, tema);
    return res.json({ ok: true, id, numero: (existente as Record<string, unknown>).numero, resultado });
  } catch (err) {
    return res.status(400).json({ ok: false, erro: (err as Error).message });
  }
});

/** POST /api/propostas/reforma-piso/calcular  → preview (não persiste) */
router.post('/calcular', requireAuth, (req: Request, res: Response) => {
  try {
    const dados = validar(req.body);
    const cfg = mesclarConfig(dados.config);
    const resultado = calcular(dados.ambientes, dados.config, dados.comRemocao, dados.rodapeEmbutido);
    return res.json({ ok: true, config: cfg, resultado });
  } catch (err) {
    return res.status(400).json({ ok: false, erro: (err as Error).message });
  }
});

/** POST /api/propostas/reforma-piso  → calcula + persiste */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const dados = validar(req.body);
    const cfg = mesclarConfig(dados.config);
    const resultado = calcular(dados.ambientes, dados.config, dados.comRemocao, dados.rodapeEmbutido);
    const tema = (dados.tema ?? 'tradicional') as TemaProposta;
    const salva = await salvar(dados, cfg, resultado, tema);
    return res.status(201).json({ ok: true, id: salva.id, numero: salva.numero, resultado });
  } catch (err) {
    return res.status(400).json({ ok: false, erro: (err as Error).message });
  }
});

/** GET /api/propostas/reforma-piso/:id/pdf?tema=prime1  → stream do PDF */
router.get('/:id/pdf', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error('ID inválido.');
    const p = await buscarPorId(id) as Record<string, unknown> | null;
    if (!p) return res.status(404).json({ ok: false, erro: 'Proposta não encontrada.' });

    const tema = (TEMAS_VALIDOS.includes(req.query.tema as TemaProposta)
      ? (req.query.tema as TemaProposta) : (p.tema as TemaProposta));

    const resultado = typeof p.resultado_json === 'string'
      ? JSON.parse(p.resultado_json) : p.resultado_json;

    const { extras, plantasPdfBuffers } = await montarExtras(id);
    let buffer = await gerarPdf(tema, {
      numero: String(p.numero),
      contratanteNome: String(p.contratante_nome),
      contratanteDoc: (p.contratante_doc as string) ?? undefined,
      obraEndereco: (p.obra_endereco as string) ?? undefined,
      cidade: String(p.cidade),
      uf: String(p.uf),
      validadeDias: Number(p.validade_dias),
      comRemocao: !!p.com_remocao,
    }, resultado, extras);
    buffer = await mesclarPlantasPdf(buffer, plantasPdfBuffers);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${String(p.numero)}-${tema}.pdf"`);
    return res.end(buffer);
  } catch (err) {
    return res.status(400).json({ ok: false, erro: (err as Error).message });
  }
});

/**
 * POST /api/propostas/reforma-piso/:id/enviar
 * Reusa o envio Z-API já existente (sendDocument do whatsapp) — não duplica webhook.
 */
router.post('/:id/enviar', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const p = await buscarPorId(id) as Record<string, unknown> | null;
    if (!p) return res.status(404).json({ ok: false, erro: 'Proposta não encontrada.' });
    const fone = String((req.body as { telefone?: string } | undefined)?.telefone || p.contratante_fone || '').trim();
    if (!fone) throw new Error('Telefone não informado (cadastre no contratante ou envie no corpo).');

    const resultado = typeof p.resultado_json === 'string'
      ? JSON.parse(p.resultado_json) : p.resultado_json;
    const { extras, plantasPdfBuffers } = await montarExtras(id);
    let buffer = await gerarPdf(p.tema as TemaProposta, {
      numero: String(p.numero), contratanteNome: String(p.contratante_nome),
      contratanteDoc: (p.contratante_doc as string) ?? undefined,
      obraEndereco: (p.obra_endereco as string) ?? undefined,
      cidade: String(p.cidade), uf: String(p.uf),
      validadeDias: Number(p.validade_dias), comRemocao: !!p.com_remocao,
    }, resultado, extras);
    buffer = await mesclarPlantasPdf(buffer, plantasPdfBuffers);

    const { sendDocument } = await import('../integrations/whatsapp');
    const env = await sendDocument(fone, buffer.toString('base64'), `${String(p.numero)}.pdf`);

    // v3.73.0: plantas-imagem vão embutidas e plantas-PDF já foram mescladas no
    // documento; só os demais formatos (DWG/DXF) seguem como documentos à parte.
    const anexos = await listarAnexos(id);
    const enviadosExtra: string[] = [];
    const ehPdf = (x: { mime_type: string; nome_original: string }) =>
      /pdf/i.test(x.mime_type) || /\.pdf$/i.test(x.nome_original);
    for (const a of anexos.filter((x) => !x.is_imagem && !ehPdf(x))) {
      const raw = await anexoRaw(a.id);
      if (!raw) continue;
      try {
        await sendDocument(fone, raw.buffer.toString('base64'), raw.nome);
        enviadosExtra.push(raw.nome);
      } catch (e) { console.warn('[reforma-piso] envio planta falhou:', (e as Error).message); }
    }

    await marcarEnviada(id);
    return res.json({ ok: true, numero: p.numero, bytes: buffer.length, status: 'enviada', messageId: env.messageId, phone: env.phone, plantasEnviadas: enviadosExtra });
  } catch (err) {
    return res.status(400).json({ ok: false, erro: (err as Error).message });
  }
});

// ── v3.68.0: Relatório fotográfico ──────────────────────────────────────────
/** POST /:id/fotos  (multipart, campo "fotos" — 1..N imagens) */
router.post('/:id/fotos', requireAuth, upload.array('fotos', 30), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const p = await buscarPorId(id);
    if (!p) return res.status(404).json({ ok: false, erro: 'Proposta não encontrada.' });
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new Error('Envie ao menos 1 imagem no campo "fotos".');
    const criadas: number[] = [];
    for (const f of files) {
      if (!/^image\//i.test(f.mimetype)) continue;
      const r = await adicionarFoto(id, f.mimetype, f.buffer.toString('base64'), null);
      criadas.push(r.id);
    }
    return res.status(201).json({ ok: true, adicionadas: criadas.length, ids: criadas });
  } catch (err) {
    return res.status(400).json({ ok: false, erro: (err as Error).message });
  }
});

/** GET /:id/fotos  (metadados) */
router.get('/:id/fotos', requireAuth, async (req: Request, res: Response) => {
  try {
    const fotos = await listarFotos(Number(req.params.id));
    return res.json({ ok: true, total: fotos.length, fotos });
  } catch (err) { return res.status(400).json({ ok: false, erro: (err as Error).message }); }
});

/** GET /:id/fotos/:fotoId/raw  (imagem) */
router.get('/:id/fotos/:fotoId/raw', async (req: Request, res: Response) => {
  try {
    const f = await fotoRaw(Number(req.params.fotoId));
    if (!f) return res.status(404).end();
    res.setHeader('Content-Type', f.mime);
    return res.end(f.buffer);
  } catch (err) { return res.status(400).json({ ok: false, erro: (err as Error).message }); }
});

/** DELETE /:id/fotos/:fotoId */
router.delete('/:id/fotos/:fotoId', requireAuth, async (req: Request, res: Response) => {
  try {
    const n = await removerFoto(Number(req.params.id), Number(req.params.fotoId));
    return res.json({ ok: n > 0 });
  } catch (err) { return res.status(400).json({ ok: false, erro: (err as Error).message }); }
});

// ── v3.68.0: Anexos de plantas ──────────────────────────────────────────────
/** POST /:id/plantas  (multipart, campo "plantas" — PDF/DWG/DXF/imagem) */
router.post('/:id/plantas', requireAuth, upload.array('plantas', 10), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const p = await buscarPorId(id);
    if (!p) return res.status(404).json({ ok: false, erro: 'Proposta não encontrada.' });
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new Error('Envie ao menos 1 arquivo no campo "plantas".');
    const criados: Array<{ id: number; nome: string }> = [];
    for (const f of files) {
      const r = await adicionarAnexoPlanta(id, f.originalname, f.mimetype || 'application/octet-stream', f.buffer);
      criados.push({ id: r.id, nome: f.originalname });
    }
    return res.status(201).json({ ok: true, adicionados: criados.length, anexos: criados });
  } catch (err) {
    return res.status(400).json({ ok: false, erro: (err as Error).message });
  }
});

/** GET /:id/plantas  (metadados) */
router.get('/:id/plantas', requireAuth, async (req: Request, res: Response) => {
  try {
    const anexos = await listarAnexos(Number(req.params.id));
    return res.json({ ok: true, total: anexos.length, anexos });
  } catch (err) { return res.status(400).json({ ok: false, erro: (err as Error).message }); }
});

/** GET /:id/plantas/:anexoId/download */
router.get('/:id/plantas/:anexoId/download', requireAuth, async (req: Request, res: Response) => {
  try {
    const a = await anexoRaw(Number(req.params.anexoId));
    if (!a) return res.status(404).end();
    res.setHeader('Content-Type', a.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${a.nome.replace(/"/g, '')}"`);
    return res.end(a.buffer);
  } catch (err) { return res.status(400).json({ ok: false, erro: (err as Error).message }); }
});

/** DELETE /:id/plantas/:anexoId */
router.delete('/:id/plantas/:anexoId', requireAuth, async (req: Request, res: Response) => {
  try {
    const n = await removerAnexo(Number(req.params.id), Number(req.params.anexoId));
    return res.json({ ok: n > 0 });
  } catch (err) { return res.status(400).json({ ok: false, erro: (err as Error).message }); }
});

export default router;
