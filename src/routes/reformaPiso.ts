// src/routes/reformaPiso.ts
// v3.67.0: rotas da Proposta de Reforma — Piso Sobreposto.
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { calcular, mesclarConfig } from '../services/reformaPiso/reformaPisoCalc';
import { gerarPdf } from '../services/reformaPiso/reformaPisoPdf';
import { salvar, buscarPorId, marcarEnviada } from '../services/reformaPiso/reformaPisoRepo';
import { DadosProposta, TemaProposta } from '../services/reformaPiso/reformaPisoTypes';

const router = Router();

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

/** POST /api/propostas/reforma-piso/calcular  → preview (não persiste) */
router.post('/calcular', requireAuth, (req: Request, res: Response) => {
  try {
    const dados = validar(req.body);
    const cfg = mesclarConfig(dados.config);
    const resultado = calcular(dados.ambientes, dados.config);
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
    const resultado = calcular(dados.ambientes, dados.config);
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

    const buffer = await gerarPdf(tema, {
      numero: String(p.numero),
      contratanteNome: String(p.contratante_nome),
      contratanteDoc: (p.contratante_doc as string) ?? undefined,
      obraEndereco: (p.obra_endereco as string) ?? undefined,
      cidade: String(p.cidade),
      uf: String(p.uf),
      validadeDias: Number(p.validade_dias),
      comRemocao: !!p.com_remocao,
    }, resultado);

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
    if (!p.contratante_fone) throw new Error('Contratante sem telefone cadastrado.');

    const resultado = typeof p.resultado_json === 'string'
      ? JSON.parse(p.resultado_json) : p.resultado_json;
    const buffer = await gerarPdf(p.tema as TemaProposta, {
      numero: String(p.numero), contratanteNome: String(p.contratante_nome),
      contratanteDoc: (p.contratante_doc as string) ?? undefined,
      obraEndereco: (p.obra_endereco as string) ?? undefined,
      cidade: String(p.cidade), uf: String(p.uf),
      validadeDias: Number(p.validade_dias), comRemocao: !!p.com_remocao,
    }, resultado);

    const { sendDocument } = await import('../integrations/whatsapp');
    const fileName = `${String(p.numero)}.pdf`;
    const env = await sendDocument(String(p.contratante_fone), buffer.toString('base64'), fileName);

    await marcarEnviada(id);
    return res.json({ ok: true, numero: p.numero, bytes: buffer.length, status: 'enviada', messageId: env.messageId, phone: env.phone });
  } catch (err) {
    return res.status(400).json({ ok: false, erro: (err as Error).message });
  }
});

export default router;
