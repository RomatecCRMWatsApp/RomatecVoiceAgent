// v3.49.2: rotas do Memorial Hidraulico (NBR 5626) — modulo Memoriais &
// Quantitativos. Montado em /api/memoriais (coexiste com as rotas inline
// legadas do server.ts; os paths /hidraulico/* abaixo sao novos, sem colisao).
//
// IMPORTANTE (boot-safe): os repositorios que tocam o MySQL sao carregados via
// import() dinamico DENTRO dos handlers — mesmo padrao das demais rotas de
// memoriais no server.ts. Assim o import deste router NAO inicializa a conexao
// no boot (database/connection lanca se DATABASE_URL faltar). Calc e PDF sao
// modulos puros (sem DB), entao ficam em import estatico.

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import {
  calcularConsumoDiario,
  dimensionarReservatorio,
  calcularResumo,
  type DadosUso,
  type EntradaResumo,
} from '../services/memoriais/hidraulicoCalculo';
import { gerarPdfMemorialHidraulico } from '../services/memoriais/hidraulicoPdfMemorial';
import { gerarPdfQuantitativoHidraulico, type ConexaoItem } from '../services/memoriais/hidraulicoPdfQuantitativo';
import { calcularResumoEletrico } from '../services/memoriais/eletricoCalculo';
import { gerarPdfMemorialEletrico } from '../services/memoriais/eletricoPdfMemorial';
import { gerarPdfQuantitativoEletrico } from '../services/memoriais/eletricoPdfQuantitativo';
import { calcularResumoSanitario } from '../services/memoriais/sanitarioCalculo';
import { gerarPdfMemorialSanitario } from '../services/memoriais/sanitarioPdfMemorial';
import { gerarPdfQuantitativoSanitario } from '../services/memoriais/sanitarioPdfQuantitativo';
import { calcularResumoEstrutural } from '../services/memoriais/estruturalCalculo';
import { gerarPdfMemorialEstrutural } from '../services/memoriais/estruturalPdfMemorial';
import { gerarPdfQuantitativoEstrutural } from '../services/memoriais/estruturalPdfQuantitativo';
import { calcularResumoArquitetonico } from '../services/memoriais/arquitetonicoCalculo';
import { gerarPdfMemorialArquitetonico } from '../services/memoriais/arquitetonicoPdfMemorial';
import { gerarPdfQuantitativoArquitetonico } from '../services/memoriais/arquitetonicoPdfQuantitativo';

const router = Router();

// v3.66.0: upload do PDF da prancha (PE) para extração elétrica (memória, 25MB).
const uploadEletrico = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');
const userId = (req: Request): number | null => {
  const u = (req as Request & { user?: { id?: number } }).user;
  return typeof u?.id === 'number' ? u.id : null;
};

// Carrega os repositorios sob demanda (boot-safe — nao inicializa DB no import).
async function getRepos() {
  const [{ memoriaisRepo }, { memoriaisArtefatosRepo }] = await Promise.all([
    import('../repositories/memoriaisRepo'),
    import('../repositories/memoriaisArtefatosRepo'),
  ]);
  return { memoriaisRepo, memoriaisArtefatosRepo };
}

// ── Passo 3: consumo em tempo real ──────────────────────────────────────────
router.post('/hidraulico/calcular-consumo', requireAuth, (req: Request, res: Response) => {
  try {
    const dados = req.body as DadosUso;
    const consumoDiario = calcularConsumoDiario(dados);
    const volumeReservatorio = dimensionarReservatorio(consumoDiario);
    res.json({ consumoDiario, volumeReservatorio });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── Passo 4: sugestao de item inexistente (transicao PVC) ───────────────────
router.post('/hidraulico/identificar-item', requireAuth, (req: Request, res: Response) => {
  const e = Number(req.body?.dnEntrada);
  const s = Number(req.body?.dnSaida);
  let sugestao = 'Conexao soldavel PVC (especificar DN)';
  let confianca = 0.3;
  if (Number.isFinite(e) && Number.isFinite(s)) {
    if (e === s) {
      sugestao = `Luva soldavel DN ${e} mm (PVC Soldavel TIGRE)`;
      confianca = 0.7;
    } else {
      const maior = Math.max(e, s);
      const menor = Math.min(e, s);
      sugestao = `Bucha de reducao soldavel DN ${maior} x ${menor} mm (PVC Soldavel TIGRE)`;
      confianca = 0.85;
    }
  }
  res.json({ sugestao, confianca });
});

// ── Passo 5: resumo completo ────────────────────────────────────────────────
router.post('/hidraulico/calcular-resumo', requireAuth, (req: Request, res: Response) => {
  try {
    res.json(calcularResumo(req.body as EntradaResumo));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── Geracao dos 2 PDFs + persistencia ───────────────────────────────────────
router.post('/hidraulico/gerar', requireAuth, async (req: Request, res: Response) => {
  try {
    const entrada = req.body as EntradaResumo;
    const r = calcularResumo(entrada);
    const data = new Date();

    const pdfA = await gerarPdfMemorialHidraulico(r, { data });
    const conexoes: ConexaoItem[] = (entrada.conexoes ?? []).map((c) => ({
      descricao: c.descricao ?? 'Conexao soldavel PVC',
      dn_mm: c.dn_mm,
      qtd: c.qtd,
    }));
    const pdfB = await gerarPdfQuantitativoHidraulico(r, { data, conexoes });

    const { memoriaisRepo, memoriaisArtefatosRepo } = await getRepos();
    const o = r.dadosObra;
    const { id, codigo } = await memoriaisRepo.criar({
      disciplina: 'hidraulico',
      user_id: userId(req),
      obra_titulo: o.titulo,
      obra_uso: r.dadosUso.tipoUso === 'residencial' ? 'Residencial unifamiliar' : 'Comercial',
      obra_endereco: o.endereco,
      obra_municipio: o.municipio,
      obra_uf: o.uf,
      proprietario_nome: o.proprietario,
      proprietario_cpf_cnpj: o.cpfCnpj,
      area_lote_m2: o.areaLoteM2 ?? null,
      area_construida_m2: o.areaM2,
      num_pavimentos: o.nPavimentos,
      wizard_responses: r,
      prancha_codigo: o.prancha,
      trt_numero: o.trtNumero ?? null,
    });

    await memoriaisArtefatosRepo.salvar(id, {
      memorialBuf: pdfA.buffer,
      memorialNome: pdfA.filename,
      memorialHash: sha256(pdfA.buffer),
      quantBuf: pdfB.buffer,
      quantNome: pdfB.filename,
      quantHash: sha256(pdfB.buffer),
      dadosCalculo: r,
    });
    await memoriaisRepo.atualizarStatus(id, 'finalizado');

    res.json({
      id,
      codigo,
      urlMemorial: `/api/memoriais/hidraulico/${id}/memorial.pdf`,
      urlQuantitativo: `/api/memoriais/hidraulico/${id}/quantitativo.pdf`,
      statusNormativo: r.statusNormativo,
      alertas: r.alertas,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── Listagem ────────────────────────────────────────────────────────────────
router.get('/hidraulico', requireAuth, async (req: Request, res: Response) => {
  try {
    const limite = Math.min(Number(req.query.limite) || 50, 500);
    const { memoriaisRepo } = await getRepos();
    const items = await memoriaisRepo.listar({ disciplina: 'hidraulico', limite });
    res.json({ data: items, total: items.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Download dos PDFs ───────────────────────────────────────────────────────
async function servirPdf(req: Request, res: Response, tipo: 'memorial' | 'quantitativo') {
  try {
    const { memoriaisArtefatosRepo } = await getRepos();
    const art = await memoriaisArtefatosRepo.ler(Number(req.params.id), tipo);
    if (!art) {
      res.status(404).json({ error: 'PDF nao encontrado' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${art.filename}"`);
    res.send(art.buffer);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
router.get('/hidraulico/:id(\\d+)/memorial.pdf', requireAuth, (req, res) => servirPdf(req, res, 'memorial'));
router.get('/hidraulico/:id(\\d+)/quantitativo.pdf', requireAuth, (req, res) => servirPdf(req, res, 'quantitativo'));

// ── Envio WhatsApp (Z-API) ──────────────────────────────────────────────────
router.post('/hidraulico/:id(\\d+)/enviar-whatsapp', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const telefone = String(req.body?.telefone || '').trim();
    if (!telefone) {
      res.status(400).json({ error: 'telefone obrigatorio' });
      return;
    }
    const { memoriaisRepo, memoriaisArtefatosRepo } = await getRepos();
    const mem = await memoriaisArtefatosRepo.ler(id, 'memorial');
    const qnt = await memoriaisArtefatosRepo.ler(id, 'quantitativo');
    if (!mem || !qnt) {
      res.status(404).json({ error: 'PDFs nao encontrados' });
      return;
    }
    const { sendDocument } = await import('../integrations/whatsapp');
    await sendDocument(telefone, mem.buffer.toString('base64'), mem.filename);
    await sendDocument(telefone, qnt.buffer.toString('base64'), qnt.filename);
    await memoriaisRepo.atualizarStatus(id, 'enviado');
    res.json({ ok: true, enviados: 2, telefone });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// ── Envio Telegram ──────────────────────────────────────────────────────────
router.post('/hidraulico/:id(\\d+)/enviar-telegram', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const chatId = String(req.body?.chatId || process.env.TELEGRAM_CHAT_ID || '').trim();
    if (!chatId) {
      res.status(400).json({ error: 'chatId obrigatorio (ou defina TELEGRAM_CHAT_ID)' });
      return;
    }
    const { memoriaisRepo, memoriaisArtefatosRepo } = await getRepos();
    const mem = await memoriaisArtefatosRepo.ler(id, 'memorial');
    const qnt = await memoriaisArtefatosRepo.ler(id, 'quantitativo');
    if (!mem || !qnt) {
      res.status(404).json({ error: 'PDFs nao encontrados' });
      return;
    }
    const { sendDocument } = await import('../integrations/telegram');
    await sendDocument(chatId, mem.buffer, mem.filename);
    await sendDocument(chatId, qnt.buffer, qnt.filename);
    await memoriaisRepo.atualizarStatus(id, 'enviado');
    res.json({ ok: true, enviados: 2, chatId });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// ── Excluir (soft delete) ────────────────────────────────────────────────────
router.delete('/hidraulico/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const { memoriaisRepo } = await getRepos();
    await memoriaisRepo.softDelete(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Dados de um memorial (para reabrir/editar no wizard) ──────────────────────
router.get('/hidraulico/:id(\\d+)/dados', requireAuth, async (req: Request, res: Response) => {
  try {
    const { memoriaisRepo } = await getRepos();
    const row = await memoriaisRepo.buscarPorId(Number(req.params.id));
    if (!row) {
      res.status(404).json({ error: 'memorial nao encontrado' });
      return;
    }
    res.json({ dados: row.wizard_responses ?? null, codigo: row.codigo, status: row.status });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});


// v3.66.0: extrai dados elétricos de um PDF de prancha (PE).
export async function handleExtrairPdfEletrico(req: Request, res: Response): Promise<void> {
  try {
    const file = (req as Request & { file?: { buffer: Buffer } }).file;
    if (!file?.buffer) { res.status(400).json({ error: 'Envie o PDF da prancha no campo "arquivo".' }); return; }
    const { extrairEletricaCompleta } = await import('../services/memoriais/eletricoExtracao');
    const extracao = await extrairEletricaCompleta(file.buffer);
    res.json({ ok: true, extracao });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Falha na extração do PDF' });
  }
}

router.post('/eletrico/extrair-pdf', requireAuth, uploadEletrico.single('arquivo'), handleExtrairPdfEletrico);

// ── Dispatch generico por disciplina (eletrico, sanitario, estrutural, ...) ──
interface ResultadoComum {
  dadosObra: { titulo: string; endereco: string; municipio: string; uf: string; proprietario: string; cpfCnpj: string; areaM2: number; areaLoteM2?: number; nPavimentos: number; prancha: string; trtNumero?: string };
  dadosUso?: { tipoUso?: string };
  statusNormativo?: unknown;
  alertas?: string[];
}
type GenPdf = (r: ResultadoComum, o?: { data?: Date }) => Promise<{ buffer: Buffer; filename: string }>;
interface DiscReg { calc: (e: unknown) => ResultadoComum; pdfMem: GenPdf; pdfQua: GenPdf; }

const REGISTRY: Record<string, DiscReg> = {
  eletrico: {
    calc: calcularResumoEletrico as unknown as DiscReg['calc'],
    pdfMem: gerarPdfMemorialEletrico as unknown as GenPdf,
    pdfQua: gerarPdfQuantitativoEletrico as unknown as GenPdf,
  },
  sanitario: {
    calc: calcularResumoSanitario as unknown as DiscReg['calc'],
    pdfMem: gerarPdfMemorialSanitario as unknown as GenPdf,
    pdfQua: gerarPdfQuantitativoSanitario as unknown as GenPdf,
  },
  estrutural: {
    calc: calcularResumoEstrutural as unknown as DiscReg['calc'],
    pdfMem: gerarPdfMemorialEstrutural as unknown as GenPdf,
    pdfQua: gerarPdfQuantitativoEstrutural as unknown as GenPdf,
  },
  arquitetonico: {
    calc: calcularResumoArquitetonico as unknown as DiscReg['calc'],
    pdfMem: gerarPdfMemorialArquitetonico as unknown as GenPdf,
    pdfQua: gerarPdfQuantitativoArquitetonico as unknown as GenPdf,
  },
};
const DISC = '(eletrico|sanitario|estrutural|arquitetonico)';

router.post('/:disc' + DISC + '/calcular-resumo', requireAuth, (req: Request, res: Response) => {
  try {
    const reg = REGISTRY[String(req.params.disc)];
    if (!reg) { res.status(501).json({ error: 'disciplina nao disponivel: ' + req.params.disc }); return; }
    res.json(reg.calc(req.body));
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/:disc' + DISC + '/gerar', requireAuth, async (req: Request, res: Response) => {
  try {
    const disc = String(req.params.disc);
    const reg = REGISTRY[disc];
    if (!reg) { res.status(501).json({ error: 'disciplina nao disponivel: ' + disc }); return; }
    const r = reg.calc(req.body);
    const data = new Date();
    const pdfA = await reg.pdfMem(r, { data });
    const pdfB = await reg.pdfQua(r, { data });
    const { memoriaisRepo, memoriaisArtefatosRepo } = await getRepos();
    const o = r.dadosObra;
    const tipoUso = r.dadosUso?.tipoUso;
    const { id, codigo } = await memoriaisRepo.criar({
      disciplina: disc as 'eletrico' | 'sanitario' | 'estrutural' | 'arquitetonico',
      user_id: userId(req),
      obra_titulo: o.titulo,
      obra_uso: tipoUso === 'comercial' ? 'Comercial' : 'Residencial unifamiliar',
      obra_endereco: o.endereco, obra_municipio: o.municipio, obra_uf: o.uf,
      proprietario_nome: o.proprietario, proprietario_cpf_cnpj: o.cpfCnpj,
      area_lote_m2: o.areaLoteM2 ?? null, area_construida_m2: o.areaM2, num_pavimentos: o.nPavimentos,
      wizard_responses: r, prancha_codigo: o.prancha, trt_numero: o.trtNumero ?? null,
    });
    await memoriaisArtefatosRepo.salvar(id, {
      memorialBuf: pdfA.buffer, memorialNome: pdfA.filename, memorialHash: sha256(pdfA.buffer),
      quantBuf: pdfB.buffer, quantNome: pdfB.filename, quantHash: sha256(pdfB.buffer), dadosCalculo: r,
    });
    await memoriaisRepo.atualizarStatus(id, 'finalizado');
    res.json({ id, codigo, urlMemorial: `/api/memoriais/${disc}/${id}/memorial.pdf`, urlQuantitativo: `/api/memoriais/${disc}/${id}/quantitativo.pdf`, statusNormativo: r.statusNormativo, alertas: r.alertas });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.get('/:disc' + DISC, requireAuth, async (req: Request, res: Response) => {
  try {
    const limite = Math.min(Number(req.query.limite) || 50, 500);
    const { memoriaisRepo } = await getRepos();
    const items = await memoriaisRepo.listar({ disciplina: String(req.params.disc) as 'eletrico' | 'sanitario' | 'estrutural' | 'arquitetonico', limite });
    res.json({ data: items, total: items.length });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.get('/:disc' + DISC + '/:id(\\d+)/memorial.pdf', requireAuth, (req, res) => servirPdf(req, res, 'memorial'));
router.get('/:disc' + DISC + '/:id(\\d+)/quantitativo.pdf', requireAuth, (req, res) => servirPdf(req, res, 'quantitativo'));

router.get('/:disc' + DISC + '/:id(\\d+)/dados', requireAuth, async (req: Request, res: Response) => {
  try {
    const { memoriaisRepo } = await getRepos();
    const row = await memoriaisRepo.buscarPorId(Number(req.params.id));
    if (!row) { res.status(404).json({ error: 'memorial nao encontrado' }); return; }
    res.json({ dados: row.wizard_responses ?? null, codigo: row.codigo, status: row.status });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.delete('/:disc' + DISC + '/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const { memoriaisRepo } = await getRepos();
    await memoriaisRepo.softDelete(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.post('/:disc' + DISC + '/:id(\\d+)/enviar-whatsapp', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const telefone = String(req.body?.telefone || '').trim();
    if (!telefone) { res.status(400).json({ error: 'telefone obrigatorio' }); return; }
    const { memoriaisRepo, memoriaisArtefatosRepo } = await getRepos();
    const mem = await memoriaisArtefatosRepo.ler(id, 'memorial');
    const qnt = await memoriaisArtefatosRepo.ler(id, 'quantitativo');
    if (!mem || !qnt) { res.status(404).json({ error: 'PDFs nao encontrados' }); return; }
    const { sendDocument } = await import('../integrations/whatsapp');
    await sendDocument(telefone, mem.buffer.toString('base64'), mem.filename);
    await sendDocument(telefone, qnt.buffer.toString('base64'), qnt.filename);
    await memoriaisRepo.atualizarStatus(id, 'enviado');
    res.json({ ok: true, enviados: 2, telefone });
  } catch (err) { res.status(502).json({ error: (err as Error).message }); }
});

router.post('/:disc' + DISC + '/:id(\\d+)/enviar-telegram', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const chatId = String(req.body?.chatId || process.env.TELEGRAM_CHAT_ID || '').trim();
    if (!chatId) { res.status(400).json({ error: 'chatId obrigatorio' }); return; }
    const { memoriaisRepo, memoriaisArtefatosRepo } = await getRepos();
    const mem = await memoriaisArtefatosRepo.ler(id, 'memorial');
    const qnt = await memoriaisArtefatosRepo.ler(id, 'quantitativo');
    if (!mem || !qnt) { res.status(404).json({ error: 'PDFs nao encontrados' }); return; }
    const { sendDocument } = await import('../integrations/telegram');
    await sendDocument(chatId, mem.buffer, mem.filename);
    await sendDocument(chatId, qnt.buffer, qnt.filename);
    await memoriaisRepo.atualizarStatus(id, 'enviado');
    res.json({ ok: true, enviados: 2, chatId });
  } catch (err) { res.status(502).json({ error: (err as Error).message }); }
});

export default router;
