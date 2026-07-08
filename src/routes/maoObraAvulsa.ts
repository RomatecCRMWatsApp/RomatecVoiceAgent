// src/routes/maoObraAvulsa.ts
// v3.92.0 — Pagamento a Mão de Obra Avulsa. Prefixo: /api/mao-obra-avulsa.
// Reusa o RECIBO UNIVERSAL (criarRecibo) pro hash/QR/status/confirmação; o PDF
// próprio (maoObraAvulsaPdf) é assinado (PAdES ICP-Brasil, mesmo do vale) e
// enviado por WhatsApp (+comprovante) e Telegram (cópia CEO).
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { requireCeoToken } from '../middleware/auth';
import { getBaseUrl } from '../services/reciboPdf';
import { getCertForSigning } from '../services/signingCertificates';
import {
  criar, buscar, listar, definirComprovante, vincularRecibo, comprovanteB64,
  resolverObraIdPorNome, FORMAS_AVULSA, type FormaPagamentoAvulsa,
} from '../integrations/maoObraAvulsa';
import { criarRecibo, marcarEvento, type FormaPagamento } from '../integrations/recibos';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/** Mapeia a forma da avulsa (tem 'outro') pro enum do recibo universal. */
function formaRecibo(f: FormaPagamentoAvulsa): FormaPagamento {
  return f === 'outro' ? 'transferencia' : (f as FormaPagamento);
}

// POST / — cadastra o pagamento avulso (rascunho, sem recibo ainda).
router.post('/', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const nome = String(b.nome_prestador ?? '').trim();
    const telefone = String(b.telefone_whatsapp ?? '').replace(/\D/g, '');
    const tipoServico = String(b.tipo_servico ?? '').trim();
    const valor = Number(b.valor_pago);
    const dataPag = String(b.data_pagamento ?? '').slice(0, 10);
    if (!nome) return res.status(400).json({ error: 'nome_prestador é obrigatório.' });
    if (!telefone || telefone.length < 10) return res.status(400).json({ error: 'telefone_whatsapp é obrigatório (55+DDD+número).' });
    if (!tipoServico) return res.status(400).json({ error: 'tipo_servico é obrigatório.' });
    if (!Number.isFinite(valor) || valor <= 0) return res.status(400).json({ error: 'valor_pago inválido.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPag)) return res.status(400).json({ error: 'data_pagamento inválida (YYYY-MM-DD).' });
    const forma = FORMAS_AVULSA.includes(b.forma_pagamento as FormaPagamentoAvulsa) ? (b.forma_pagamento as FormaPagamentoAvulsa) : 'pix';
    // v3.92.3: obra por id OU por nome livre (combobox) — cria se não existir.
    let obraId: number | null = b.obra_id != null && b.obra_id !== '' ? Number(b.obra_id) : null;
    if (!obraId && b.obra_nome != null && String(b.obra_nome).trim()) {
      obraId = await resolverObraIdPorNome(String(b.obra_nome));
    }
    const r = await criar({
      obra_id: obraId,
      nome_prestador: nome,
      telefone_whatsapp: telefone,
      cpf: b.cpf != null ? String(b.cpf) : null,
      tipo_servico: tipoServico,
      descricao_servico: b.descricao_servico != null ? String(b.descricao_servico) : null,
      valor_pago: valor,
      forma_pagamento: forma,
      data_pagamento: dataPag,
    });
    const doc = await buscar(r.id);
    res.status(201).json({ mao_obra: doc });
  } catch (err) {
    console.error('[mao-obra POST /]', err);
    res.status(500).json({ error: 'Falha ao cadastrar pagamento avulso.' });
  }
});

// GET / — lista (por obra/status).
router.get('/', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const itens = await listar({
      obra_id: req.query.obra_id ? Number(req.query.obra_id) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ pagamentos: itens });
  } catch (err) {
    console.error('[mao-obra GET /]', err);
    res.status(500).json({ error: 'Falha ao listar.' });
  }
});

// GET /:id — consulta.
router.get('/:id(\\d+)', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const doc = await buscar(Number(req.params.id));
    if (!doc) return res.status(404).json({ error: 'Registro não encontrado.' });
    res.json({ mao_obra: doc });
  } catch (err) {
    console.error('[mao-obra GET /:id]', err);
    res.status(500).json({ error: 'Falha ao buscar.' });
  }
});

// POST /:id/comprovante — anexa comprovante (multipart "comprovante" OU base64 JSON).
router.post('/:id(\\d+)/comprovante', requireCeoToken, upload.single('comprovante'), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!(await buscar(id))) return res.status(404).json({ error: 'Registro não encontrado.' });
    const file = (req as Request & { file?: { buffer: Buffer; originalname: string; mimetype: string } }).file;
    const b = (req.body ?? {}) as Record<string, unknown>;
    let nf: { nome: string; mime: string; base64: string } | null = null;
    if (file && file.buffer?.length) {
      nf = { nome: file.originalname || 'comprovante', mime: file.mimetype || 'application/octet-stream', base64: file.buffer.toString('base64') };
    } else if (b.base64) {
      nf = { nome: String(b.nome ?? 'comprovante'), mime: String(b.mime ?? 'application/octet-stream'), base64: String(b.base64) };
    }
    if (!nf) return res.status(400).json({ error: 'Envie o arquivo "comprovante" (multipart) ou base64.' });
    await definirComprovante(id, nf);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[mao-obra POST /:id/comprovante]', err);
    res.status(500).json({ error: (err as Error).message || 'Falha ao anexar comprovante.' });
  }
});

// POST /:id/enviar — cria o recibo universal, gera+assina o PDF e envia (WA + TG).
router.post('/:id(\\d+)/enviar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const det = await buscar(id);
    if (!det) return res.status(404).json({ error: 'Registro não encontrado.' });

    // 1) Recibo universal (idempotente: se já tem recibo_id, reusa)
    let reciboId = det.recibo_id;
    if (!reciboId) {
      const recibo = await criarRecibo({
        tenant_id: 1,
        tipo: 'mao_obra_avulsa',
        resource_type: 'mao_obra_avulsa',
        resource_id: String(det.id),
        destinatario_nome: det.nome_prestador,
        destinatario_doc: det.cpf,
        destinatario_phone: det.telefone_whatsapp,
        valor: det.valor_pago,
        forma_pagamento: formaRecibo(det.forma_pagamento),
        descricao_servico: det.descricao_servico ? `${det.tipo_servico} — ${det.descricao_servico}` : det.tipo_servico,
        categoria_servico: 'mao_obra_avulsa',
        categoria_grupo: 'MAO',
        emitente_perfil: 'romatec_pj',
        expira_em_dias: 30,
      });
      reciboId = recibo.id;
      await vincularRecibo(id, reciboId);
    }
    const doc = await buscar(id); // recarrega com recibo vinculado
    const { buscarReciboPorId } = await import('../integrations/recibos');
    const recibo = await buscarReciboPorId(reciboId!);
    if (!recibo || !doc) return res.status(500).json({ error: 'Falha ao carregar recibo.' });

    // 2) PDF + assinatura PAdES (best-effort, igual ao vale)
    const base = getBaseUrl();
    const link = `${base}/v/${recibo.hash_validacao}`;
    const comp = await comprovanteB64(id);
    const { gerarPdfMaoObraAvulsa } = await import('../services/maoObraAvulsaPdf');
    let pdf = await gerarPdfMaoObraAvulsa(recibo, doc, { comprovante: comp });
    let assinado = false;
    try {
      const cert = await getCertForSigning('pj');
      if (cert) {
        const { signPdfBuffer } = await import('../services/pdfSigner');
        pdf = await signPdfBuffer(pdf, cert.pfx, cert.senha, {
          name: cert.meta.subject_cn ?? 'ROMATEC CONSULTORIA TOTAL',
          reason: `Recibo Mão de Obra Avulsa ${recibo.numero}`,
          location: 'Açailândia/MA',
          contactInfo: cert.meta.subject_doc ?? '',
        });
        assinado = true;
      }
    } catch (e) { console.warn('[mao-obra assinatura] falhou (envia sem assinar):', (e as Error).message); }

    // 3) Envio WhatsApp (recibo + comprovante) + Telegram (CEO)
    const wa = await import('../integrations/whatsapp');
    const caption = `🧾 *Recibo de Pagamento* — ${recibo.numero}\n\n` +
      `${det.nome_prestador}, confirma o recebimento de *${det.valor_pago.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}* ` +
      `referente a ${det.tipo_servico}${doc.obra_nome ? ` na obra ${doc.obra_nome}` : ''}?\n\n` +
      `Responda *CONFIRMAR* pra dar o aceite.\n\n— Romatec Consultoria Total`;
    let messageId: string | undefined;
    try {
      const rep = await wa.sendReply(det.telefone_whatsapp, caption);
      messageId = rep.messageId;
      await wa.sendDocument(det.telefone_whatsapp, pdf.toString('base64'), `Recibo-${recibo.numero}.pdf`);
      if (comp) {
        if ((comp.mime || '').startsWith('image/')) await wa.sendImage(det.telefone_whatsapp, `data:${comp.mime};base64,${comp.base64}`, `📎 Comprovante — ${recibo.numero}`);
        else await wa.sendDocument(det.telefone_whatsapp, comp.base64, comp.nome);
      }
      if (messageId) await marcarEvento(reciboId!, 'enviado', messageId).catch(() => undefined);
    } catch (e) {
      console.error('[mao-obra enviar] WhatsApp falhou:', e);
      return res.status(502).json({ error: `Recibo criado, mas o envio falhou: ${(e as Error).message}`, recibo_id: reciboId, hash: recibo.hash_validacao, link, assinado });
    }

    // Telegram (cópia CEO) — best-effort
    try {
      const { sendDocument: sendTg } = await import('../integrations/telegram');
      const chatId = process.env.TELEGRAM_CEO_CHAT_ID || process.env.TELEGRAM_CHAT_ID
        || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
      if (chatId) await sendTg(chatId, pdf, `Recibo-${recibo.numero}.pdf`, `🧾 Mão de obra avulsa — ${det.nome_prestador} — ${det.valor_pago.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n🔗 ${link}`);
    } catch (e) { console.warn('[mao-obra telegram] falhou:', (e as Error).message); }

    res.json({ ok: true, recibo_id: reciboId, numero: recibo.numero, hash: recibo.hash_validacao, link, assinado, messageId });
  } catch (err) {
    console.error('[mao-obra POST /:id/enviar]', err);
    res.status(500).json({ error: (err as Error).message || 'Falha ao enviar recibo.' });
  }
});

export default router;
