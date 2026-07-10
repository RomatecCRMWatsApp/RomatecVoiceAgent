// v1.99.16 — Rotas de exportacao PDF nos templates Prime I / Prime II.
//
// Modulo PARALELO: nao altera nenhuma rota existente. O template Padrao continua
// servido pelos endpoints atuais (/pdf-assinado, /preview-pdf etc.). Aqui so
// tratamos prime1 / prime2, mapeando os dados do banco e roteando pro gerador
// puppeteer correto.
//
// Namespace: montado em /api/pdf-prime (ver server.ts):
//   GET /api/pdf-prime/proposta/:id?template=prime1|prime2
//   GET /api/pdf-prime/recibo/:id?template=prime1|prime2
//   GET /api/pdf-prime/laudo/:id?template=prime1|prime2
//
// v3.65.0 — o /laudo agora delega a montagem do LaudoDados pro service
// laudoPrimeDados (reusado tambem pela assinatura). O export rapido aqui e
// PREVIEW: NAO passa a caixa ICP (so o PDF realmente PAdES-assinado a exibe).

import { Router, type Request, type Response } from 'express';
import { parseTemplateId, isTemplatePrime } from '../types/templateTypes';
import { gerarPropostaPdf } from '../pdf/propostaPdfRouter';
import { gerarReciboPdf } from '../pdf/reciboPdfRouter';
import { gerarLaudoPdf } from '../pdf/laudoPdfRouter';
import {
  propostaConsultoriaToPropostaDados,
  reciboToReciboDados,
  type PropostaConsultoriaView,
} from '../pdf/mappers';
import { buscarPropostaConsultoria, mesclarAnexosProposta } from '../integrations/propostasConsultoria';
import { buscarReciboPorId } from '../integrations/recibos';
import { getBaseUrl } from '../services/reciboPdf';
import { construirLaudoDadosPrime } from '../services/laudoPrimeDados';

export const pdfPrimeRouter = Router();

/** GET /proposta/:id?template=prime1|prime2 */
pdfPrimeRouter.get('/proposta/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const templateId = parseTemplateId(req.query.template);
    if (!isTemplatePrime(templateId)) {
      res.status(400).json({
        error: 'Template invalido para este endpoint. Use ?template=prime1 ou prime2. ' +
          'O template Padrao e servido pelos endpoints existentes.',
      });
      return;
    }
    const proposta = await buscarPropostaConsultoria(id);
    const dados = propostaConsultoriaToPropostaDados(
      proposta as unknown as PropostaConsultoriaView,
    );
    const primePdf = await gerarPropostaPdf(dados, templateId);
    // v3.93.1: o export do Prime agora também mescla os anexos (croqui/plantas/
    // imagens/PDFs) da proposta — antes só o PDF assinado os incluía.
    const buffer = await mesclarAnexosProposta(primePdf, Number(id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="proposta-${id}-${templateId}.pdf"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /recibo/:id?template=prime1|prime2 */
pdfPrimeRouter.get('/recibo/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const templateId = parseTemplateId(req.query.template);
    if (!isTemplatePrime(templateId)) {
      res.status(400).json({
        error: 'Template invalido para este endpoint. Use ?template=prime1 ou prime2. ' +
          'O template Padrao e servido pelos endpoints existentes.',
      });
      return;
    }
    const recibo = await buscarReciboPorId(id);
    const dados = reciboToReciboDados(recibo, getBaseUrl());
    const buffer = await gerarReciboPdf(dados, templateId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="recibo-${id}-${templateId}.pdf"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /laudo/:id?template=prime1|prime2 — PREVIEW de export rápido.
 * Sem caixa ICP (não passa assinaturaIcp): só o PDF assinado de verdade a exibe.
 */
pdfPrimeRouter.get('/laudo/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const templateId = parseTemplateId(req.query.template);
    if (!isTemplatePrime(templateId)) {
      res.status(400).json({
        error: 'Template invalido para este endpoint. Use ?template=prime1 ou prime2. ' +
          'O template Padrao e servido pelos endpoints existentes.',
      });
      return;
    }
    const dados = await construirLaudoDadosPrime(id);
    const buffer = await gerarLaudoPdf(dados, templateId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="LAUDO-${id}-${templateId}.pdf"`);
    res.send(buffer);
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e?.statusCode ?? 500).json({ error: e?.message ?? 'Erro ao gerar PDF Prime' });
  }
});

export default pdfPrimeRouter;
