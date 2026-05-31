// v3.49.2: rotas do Memorial Hidraulico (NBR 5626) — modulo Memoriais &
// Quantitativos. Montado em /api/memoriais (coexiste com as rotas inline
// legadas do server.ts; os paths /hidraulico/* abaixo sao novos, sem colisao).
//
// Endpoints:
//   POST /hidraulico/calcular-consumo   (puro)
//   POST /hidraulico/calcular-resumo    (puro)
//   POST /hidraulico/identificar-item   (heuristica de transicao PVC)
//   POST /hidraulico/gerar              (calcula + gera 2 PDFs + persiste)
//   GET  /hidraulico                    (listagem disciplina=hidraulico)
//   GET  /hidraulico/:id/memorial.pdf
//   GET  /hidraulico/:id/quantitativo.pdf
//   POST /hidraulico/:id/enviar-whatsapp
//   POST /hidraulico/:id/enviar-telegram

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
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
import { memoriaisRepo } from '../repositories/memoriaisRepo';
import { memoriaisArtefatosRepo } from '../repositories/memoriaisArtefatosRepo';

const router = Router();

const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');
const userId = (req: Request): number | null => {
  const u = (req as Request & { user?: { id?: number } }).user;
  return typeof u?.id === 'number' ? u.id : null;
};

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
    const items = await memoriaisRepo.listar({ disciplina: 'hidraulico', limite });
    res.json({ data: items, total: items.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Download dos PDFs ───────────────────────────────────────────────────────
async function servirPdf(req: Request, res: Response, tipo: 'memorial' | 'quantitativo') {
  try {
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

export default router;
