// src/routes/inventarioObra.ts
// v3.97.0 — Rotas do módulo "Inventário de Materiais por Obra".
// Prefixo: /api/gestao-obra/inventario. Dono = req.user.sub (nunca do body).
// Etapas + upload de NF (XML determinístico / PDF·foto via IA) + itens +
// utilização (saldo travado em transação) + fotos + relatório PDF + Z-API.
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import * as repo from '../services/inventario/inventarioObraRepo';
import { parseNfeXml } from '../services/inventario/nfeXmlParser';

const router = Router();
// Upload em memória (mesmo padrão da galeria/entrega — Railway sem disco).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function donoDe(req: Request): string | null {
  const sub = (req as AuthedRequest).user?.sub;
  return sub ? String(sub) : null;
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
function intOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}
function fileDe(req: Request): { buffer: Buffer; originalname: string; mimetype: string } | null {
  const f = (req as Request & { file?: { buffer: Buffer; originalname: string; mimetype: string } }).file;
  return f && f.buffer && f.buffer.length ? f : null;
}

// ── Etapas ───────────────────────────────────────────────────────────────────
router.post('/:obraId/etapas', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const titulo = String(req.body?.titulo ?? '').trim();
    if (!titulo) return res.status(400).json({ error: 'titulo obrigatório.' });
    const id = await repo.criarEtapa(Number(req.params.obraId), {
      titulo,
      descricao: req.body?.descricao ?? null,
      ordem: intOrNull(req.body?.ordem) ?? 0,
      disciplina_vto_ordem: intOrNull(req.body?.disciplina_vto_ordem),
      colaborador_id: dono,
    });
    res.status(201).json({ ok: true, id });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/:obraId/etapas', requireAuth, async (req: Request, res: Response) => {
  try {
    res.json({ ok: true, etapas: await repo.listarEtapas(Number(req.params.obraId)) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.put('/etapas/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    await repo.atualizarEtapa(Number(req.params.id), {
      titulo: req.body?.titulo, descricao: req.body?.descricao,
      ordem: intOrNull(req.body?.ordem) ?? undefined,
      status: req.body?.status,
      disciplina_vto_ordem: req.body?.disciplina_vto_ordem !== undefined
        ? intOrNull(req.body?.disciplina_vto_ordem) : undefined,
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Upload de nota fiscal (XML NFe / PDF DANFE / foto) ──────────────────────
router.post('/:obraId/notas/upload', requireAuth, upload.single('arquivo'), async (req: Request, res: Response) => {
  const dono = donoDe(req);
  if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
  const obraId = Number(req.params.obraId);
  const file = fileDe(req);
  if (!file) return res.status(400).json({ error: 'Arquivo obrigatório (campo "arquivo").' });
  const etapaId = intOrNull(req.body?.etapa_id);

  // Detecta o tipo: XML (por mime ou conteúdo), PDF, imagem.
  const mime = (file.mimetype || '').toLowerCase();
  const inicio = file.buffer.subarray(0, 512).toString('utf8');
  const ehXml = /xml/.test(mime) || /^\s*<\?xml|<nfeProc|<NFe[\s>]/i.test(inicio) || /\.xml$/i.test(file.originalname);
  const ehPdf = mime === 'application/pdf' || file.buffer.subarray(0, 4).toString() === '%PDF';
  const ehImg = /^image\//.test(mime);
  if (!ehXml && !ehPdf && !ehImg) {
    return res.status(400).json({ error: `Formato não suportado (${mime || file.originalname}). Envie XML da NFe, PDF do DANFE ou foto da nota.` });
  }
  const tipo: 'xml_nfe' | 'pdf_danfe' | 'imagem' = ehXml ? 'xml_nfe' : ehPdf ? 'pdf_danfe' : 'imagem';

  let notaId = 0;
  try {
    notaId = await repo.criarNota(obraId, {
      etapa_id: etapaId,
      arquivo_nome: file.originalname.slice(0, 255),
      arquivo_mime: mime || (ehXml ? 'application/xml' : 'application/octet-stream'),
      arquivo_b64: file.buffer.toString('base64'),
      arquivo_tipo: tipo,
      colaborador_id: dono,
    });

    let cab: { numero_nota?: string | null; chave_acesso?: string | null; fornecedor_nome?: string | null;
      fornecedor_cnpj?: string | null; data_emissao?: string | null; valor_total?: number | null };
    let itens: repo.NovoItem[];
    let status: 'processado' | 'revisao_manual' = 'processado';
    let confianca: number | null = null;

    if (ehXml) {
      // XML: parser determinístico próprio — sempre preferido.
      const nfe = parseNfeXml(file.buffer.toString('utf8'));
      if (!nfe) throw new Error('XML não parece uma NFe válida (sem <infNFe>/<det>).');
      cab = nfe;
      itens = nfe.itens.map((i) => ({
        etapa_id: etapaId, nota_id: notaId, descricao: i.descricao, codigo_produto: i.codigo ?? null,
        unidade_medida: i.unidade, quantidade_comprada: i.quantidade,
        valor_unitario: i.valor_unitario ?? null, valor_total: i.valor_total ?? null,
        origem: 'nota_fiscal', confianca_baixa: false,
      }));
      confianca = 1;
    } else {
      // PDF/foto: extração via IA (Claude) — reusa a infra do cupomOcr.
      const { extrairNotaFiscal } = await import('../services/inventario/notaFiscalOcr');
      const ocr = await extrairNotaFiscal({
        arquivo_b64: file.buffer.toString('base64'),
        mimetype: ehPdf ? 'application/pdf' : mime,
      });
      cab = ocr;
      const baixa = ocr.confianca !== 'alta';
      if (baixa) status = 'revisao_manual';
      confianca = ocr.confianca === 'alta' ? 0.95 : ocr.confianca === 'media' ? 0.7 : 0.4;
      itens = (ocr.itens ?? []).map((i) => ({
        etapa_id: etapaId, nota_id: notaId, descricao: i.descricao, codigo_produto: i.codigo ?? null,
        unidade_medida: i.unidade || 'UN', quantidade_comprada: Number(i.quantidade),
        valor_unitario: i.valor_unitario ?? null, valor_total: i.valor_total ?? null,
        origem: 'nota_fiscal', confianca_baixa: baixa,
      }));
    }

    const ids = await repo.criarItens(obraId, itens, dono);
    await repo.marcarNotaProcessada(notaId, {
      numero_nota: cab.numero_nota ?? null, chave_acesso: cab.chave_acesso ?? null,
      fornecedor_nome: cab.fornecedor_nome ?? null, fornecedor_cnpj: cab.fornecedor_cnpj ?? null,
      data_emissao: cab.data_emissao ?? null, valor_total: cab.valor_total ?? null,
      status, confianca,
    });
    res.status(201).json({ ok: true, nota_id: notaId, itens_ids: ids, status, itens_count: ids.length });
  } catch (err) {
    if (notaId) {
      await repo.marcarNotaProcessada(notaId, { status: 'erro', erro: (err as Error).message }).catch(() => undefined);
    }
    res.status(422).json({ error: (err as Error).message, nota_id: notaId || undefined });
  }
});

router.get('/:obraId/notas', requireAuth, async (req: Request, res: Response) => {
  try { res.json({ ok: true, notas: await repo.listarNotas(Number(req.params.obraId)) }); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/notas/:notaId', requireAuth, async (req: Request, res: Response) => {
  try {
    const nota = await repo.obterNota(Number(req.params.notaId));
    if (!nota) return res.status(404).json({ error: 'Nota não encontrada.' });
    res.json({ ok: true, nota });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Corrigir itens extraídos com baixa confiança e consolidar a nota.
router.patch('/notas/:notaId/revisar', requireAuth, async (req: Request, res: Response) => {
  try {
    const notaId = Number(req.params.notaId);
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
    for (const it of itens) {
      const id = intOrNull(it?.id);
      if (!id) continue;
      await repo.atualizarItemRevisao(id, notaId, {
        descricao: it.descricao, codigo_produto: it.codigo_produto,
        unidade_medida: it.unidade_medida,
        quantidade_comprada: numOrNull(it.quantidade_comprada) ?? undefined,
        valor_unitario: it.valor_unitario !== undefined ? numOrNull(it.valor_unitario) : undefined,
      });
    }
    await repo.marcarNotaRevisada(notaId);
    res.json({ ok: true });
  } catch (err) { res.status(422).json({ error: (err as Error).message }); }
});

// ── Itens ────────────────────────────────────────────────────────────────────
router.post('/:obraId/itens', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const b = req.body ?? {};
    const qtd = numOrNull(b.quantidade_comprada);
    if (!String(b.descricao ?? '').trim() || !qtd || qtd <= 0) {
      return res.status(400).json({ error: 'descricao e quantidade_comprada (>0) obrigatórias.' });
    }
    const [id] = await repo.criarItens(Number(req.params.obraId), [{
      etapa_id: intOrNull(b.etapa_id), descricao: String(b.descricao),
      codigo_produto: b.codigo_produto ?? null, unidade_medida: b.unidade_medida || 'UN',
      quantidade_comprada: qtd, valor_unitario: numOrNull(b.valor_unitario),
      valor_total: numOrNull(b.valor_total) ?? (numOrNull(b.valor_unitario) != null ? +(qtd * Number(b.valor_unitario)).toFixed(2) : null),
      origem: 'manual', observacoes: b.observacoes ?? null,
    }], dono);
    res.status(201).json({ ok: true, id });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/:obraId/itens', requireAuth, async (req: Request, res: Response) => {
  try {
    const itens = await repo.listarItens(Number(req.params.obraId), {
      etapa_id: intOrNull(req.query.etapa_id) ?? undefined,
      status: req.query.status ? String(req.query.status) : undefined,
    });
    res.json({ ok: true, itens });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.patch('/itens/:itemId', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    await repo.atualizarItemManual(Number(req.params.itemId), {
      descricao: b.descricao, codigo_produto: b.codigo_produto, unidade_medida: b.unidade_medida,
      quantidade_comprada: numOrNull(b.quantidade_comprada) ?? undefined,
      valor_unitario: b.valor_unitario !== undefined ? numOrNull(b.valor_unitario) : undefined,
      observacoes: b.observacoes,
    });
    res.json({ ok: true });
  } catch (err) { res.status(422).json({ error: (err as Error).message }); }
});

// Mover item entre etapas (histórico preservado).
router.patch('/itens/:itemId/etapa', requireAuth, async (req: Request, res: Response) => {
  try {
    await repo.moverItemEtapa(Number(req.params.itemId), intOrNull(req.body?.etapa_id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Utilização (saldo travado — nunca negativo) ──────────────────────────────
router.post('/itens/:itemId/utilizacao', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const b = req.body ?? {};
    const tipo = b.tipo_utilizacao === 'total' ? 'total' : b.tipo_utilizacao === 'parcial' ? 'parcial' : null;
    if (!tipo) return res.status(400).json({ error: "tipo_utilizacao deve ser 'total' ou 'parcial'." });
    const data = String(b.data_utilizacao ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: 'data_utilizacao (YYYY-MM-DD) obrigatória.' });
    const r = await repo.registrarUtilizacao(Number(req.params.itemId), {
      tipo_utilizacao: tipo,
      quantidade_utilizada: numOrNull(b.quantidade_utilizada) ?? undefined,
      data_utilizacao: data,
      etapa_execucao_id: intOrNull(b.etapa_execucao_id),
      observacoes: b.observacoes ?? null,
      colaborador_id: dono,
    });
    res.status(201).json({ ok: true, ...r });
  } catch (err) {
    const code = err instanceof repo.SaldoInsuficienteError ? 422 : 400;
    res.status(code).json({ error: (err as Error).message });
  }
});

router.get('/itens/:itemId/utilizacoes', requireAuth, async (req: Request, res: Response) => {
  try { res.json({ ok: true, utilizacoes: await repo.listarUtilizacoes(Number(req.params.itemId)) }); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Fotos (entrega / instalação) ─────────────────────────────────────────────
router.post('/itens/:itemId/fotos', requireAuth, upload.array('fotos', 10), async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const itemId = Number(req.params.itemId);
    const b = req.body ?? {};
    const tipos = ['entrega', 'instalacao', 'avaria', 'outro'];
    const tipoFoto = tipos.includes(String(b.tipo_foto)) ? String(b.tipo_foto) as 'entrega' | 'instalacao' | 'avaria' | 'outro' : 'entrega';
    const files = ((req as Request & { files?: Array<{ buffer: Buffer; mimetype: string }> }).files) ?? [];
    if (!files.length && !b.data_base64) {
      return res.status(400).json({ error: 'Envie fotos (multipart "fotos") ou data_base64.' });
    }
    const lat = numOrNull(b.latitude);
    const lng = numOrNull(b.longitude);
    const ids: number[] = [];

    const gravar = async (base64: string, mime: string) => {
      ids.push(await repo.adicionarFoto(itemId, {
        utilizacao_id: intOrNull(b.utilizacao_id),
        tipo_foto: tipoFoto, data_base64: base64, mime,
        legenda: b.legenda ?? null, latitude: lat, longitude: lng, colaborador_id: dono,
      }));
    };

    for (const f of files) {
      // Overlay GPS quando há coordenadas (mesmo carimbo técnico da galeria/entrega);
      // qualquer falha do overlay cai na foto crua — nunca bloqueia o registro.
      if (lat != null && lng != null) {
        try {
          const { aplicarOverlayFoto } = await import('../services/overlayService');
          const ov = await aplicarOverlayFoto({
            imageBuffer: f.buffer, latitude: lat, longitude: lng,
            altitude_m: numOrNull(b.altitude_m), utm_zona: String(b.utm_zona ?? ''),
            utm_e: numOrNull(b.utm_e), utm_n: numOrNull(b.utm_n),
            datum: String(b.datum ?? 'SIRGAS 2000'), municipio: String(b.municipio ?? ''),
            logradouro: String(b.logradouro ?? ''),
            horario_captura: String(b.horario_captura ?? new Date().toISOString()),
            colaborador: String(b.colaborador ?? ''),
          });
          await gravar(ov.base64.replace(/^data:[^,]+,/, ''), 'image/jpeg');
          continue;
        } catch { /* cai na foto crua */ }
      }
      await gravar(f.buffer.toString('base64'), f.mimetype || 'image/jpeg');
    }
    if (!files.length && b.data_base64) {
      await gravar(String(b.data_base64).replace(/^data:[^,]+,/, ''), String(b.mime ?? 'image/jpeg'));
    }
    res.status(201).json({ ok: true, ids });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/itens/:itemId/fotos', requireAuth, async (req: Request, res: Response) => {
  try { res.json({ ok: true, fotos: await repo.listarFotos(Number(req.params.itemId)) }); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/fotos/:fotoId/arquivo', requireAuth, async (req: Request, res: Response) => {
  try {
    const foto = await repo.obterFotoComB64(Number(req.params.fotoId));
    if (!foto) return res.status(404).json({ error: 'Foto não encontrada.' });
    const b64 = String(foto.data_base64).replace(/^data:[^,]+,/, '');
    res.setHeader('Content-Type', String(foto.mime || 'image/jpeg'));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(b64, 'base64'));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.delete('/fotos/:fotoId', requireAuth, async (req: Request, res: Response) => {
  try { await repo.apagarFoto(Number(req.params.fotoId)); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Sobras da Entrega de Obra → inventário (v3.97.0, fase 2) ─────────────────
// Entregas do colaborador com sobras registradas, elegíveis pra esta obra
// (sem vínculo ainda, ou já vinculadas a ela). Alimenta o modal de importação.
router.get('/:obraId/entregas-sobras', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const { listarEntregasComSobras } = await import('../services/inventario/sobraEntregaSync');
    res.json({ ok: true, entregas: await listarEntregasComSobras(dono, Number(req.params.obraId)) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Vincula a entrega à obra (obra_id nasce NULL) e importa as sobras como itens.
// Depois do vínculo, toda edição de sobra na Entrega sincroniza automaticamente.
router.post('/:obraId/entregas/:entregaId/importar-sobras', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const { vincularEntregaAObra } = await import('../services/inventario/sobraEntregaSync');
    const r = await vincularEntregaAObra(Number(req.params.entregaId), dono, Number(req.params.obraId));
    res.json({ ok: true, ...r });
  } catch (err) { res.status(422).json({ error: (err as Error).message }); }
});

// ── Resumo + relatório ───────────────────────────────────────────────────────
router.get('/:obraId/resumo', requireAuth, async (req: Request, res: Response) => {
  try {
    const obraId = Number(req.params.obraId);
    res.json({ ok: true, resumo: await repo.resumoObra(obraId), etapas: await repo.listarEtapas(obraId) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/:obraId/relatorio', requireAuth, async (req: Request, res: Response) => {
  try {
    const obraId = Number(req.params.obraId);
    const etapaId = intOrNull(req.query.etapa_id) ?? undefined;
    const dados = await repo.dadosRelatorio(obraId, etapaId);
    if (String(req.query.formato ?? 'pdf') === 'json') return res.json({ ok: true, ...dados });
    const { gerarInventarioPdf } = await import('../services/inventario/inventarioObraPdf');
    const pdf = await gerarInventarioPdf(dados);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Inventario_Obra_${obraId}.pdf"`);
    res.send(pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/:obraId/relatorio/enviar-whatsapp', requireAuth, async (req: Request, res: Response) => {
  try {
    const obraId = Number(req.params.obraId);
    const telefone = String(req.body?.telefone ?? '').replace(/\D/g, '');
    if (telefone.length < 10) return res.status(400).json({ error: 'Telefone inválido.' });
    const etapaId = intOrNull(req.body?.etapa_id) ?? undefined;
    const dados = await repo.dadosRelatorio(obraId, etapaId);
    const { gerarInventarioPdf } = await import('../services/inventario/inventarioObraPdf');
    const pdf = await gerarInventarioPdf(dados);
    const { sendDocument, sendReply } = await import('../integrations/whatsapp');
    const nomeObra = dados.obra ? String(dados.obra.nome) : `Obra ${obraId}`;
    await sendDocument(telefone, pdf.toString('base64'), `Inventario_${nomeObra.replace(/\s+/g, '_')}.pdf`, 'pdf');
    await sendReply(telefone,
      `📦 *Inventário de Materiais — ${nomeObra}*\n` +
      `Comprado: R$ ${dados.resumo.valor_comprado.toFixed(2)} · Utilizado: R$ ${dados.resumo.valor_utilizado.toFixed(2)} · Em obra: R$ ${dados.resumo.valor_saldo.toFixed(2)}\n` +
      `_Romatec Consultoria Total_`);
    res.json({ ok: true });
  } catch (err) { res.status(502).json({ error: (err as Error).message }); }
});

export default router;
