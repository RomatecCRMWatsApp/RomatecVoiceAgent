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

import { Router, type Request, type Response } from 'express';
import { parseTemplateId, isTemplatePrime } from '../types/templateTypes';
import { gerarPropostaPdf } from '../pdf/propostaPdfRouter';
import { gerarReciboPdf } from '../pdf/reciboPdfRouter';
import { gerarLaudoPdf } from '../pdf/laudoPdfRouter';
import {
  propostaConsultoriaToPropostaDados,
  reciboToReciboDados,
  laudoToLaudoDados,
  type PropostaConsultoriaView,
} from '../pdf/mappers';
import { buscarPropostaConsultoria } from '../integrations/propostasConsultoria';
import { buscarReciboPorId } from '../integrations/recibos';
import {
  buscarLaudo,
  listarPontosDoLaudo,
  listarLadosDoLaudo,
} from '../integrations/laudos';
import { buscarContratante } from '../integrations/contratantes';
import { buscarExecutante } from '../integrations/executantes';
import { gerarCroquiSvg } from '../services/croquiSvg';
import { getBaseUrl } from '../services/reciboPdf';

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
    const buffer = await gerarPropostaPdf(dados, templateId);
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

/** GET /laudo/:id?template=prime1|prime2 */
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
    const laudo = await buscarLaudo(id);
    if (!laudo) {
      res.status(404).json({ error: 'laudo nao encontrado' });
      return;
    }
    const [contratante, executante, pontos, lados] = await Promise.all([
      buscarContratante(laudo.contratante_id),
      buscarExecutante(laudo.executante_id),
      listarPontosDoLaudo(id),
      listarLadosDoLaudo(id),
    ]);
    if (!contratante || !executante) {
      res.status(500).json({ error: 'Contratante/Executante associado nao encontrado' });
      return;
    }

    // Croqui SVG (best-effort): gera a poligonal a partir dos pontos UTM.
    // Se a geometria nao permitir (poucos pontos, sem UTM) ou der erro,
    // segue sem croqui — o template trata a ausencia.
    let croquiSvg: string | undefined;
    try {
      const pontosFiltrados = pontos.filter((p) => p.utm_e != null && p.utm_n != null);
      if (pontosFiltrados.length >= 2) {
        const pontosSvg = pontosFiltrados.map((p) => ({
          rotulo: p.rotulo,
          e: p.utm_e as number,
          n: p.utm_n as number,
        }));
        const ladosSvg = lados.map((l) => ({
          i_idx: pontos.findIndex((p) => p.id === l.ponto_inicio_id),
          f_idx: pontos.findIndex((p) => p.id === l.ponto_fim_id),
          distancia_m: l.distancia_m ?? 0,
        }));
        croquiSvg = gerarCroquiSvg(pontosSvg, ladosSvg, {
          tipoImovel: laudo.tipo_imovel,
          areaTotalM2: laudo.area_total_m2 != null ? Number(laudo.area_total_m2) : undefined,
          utmZona: pontosFiltrados[0]?.utm_zona ? Number(pontosFiltrados[0].utm_zona) : undefined,
          utmHemisferio: pontosFiltrados[0]?.utm_hemisferio || 'S',
        });
      }
    } catch (croquiErr) {
      console.warn('[pdf-prime:laudo] croqui pulado:', (croquiErr as Error).message);
      croquiSvg = undefined;
    }

    const dados = laudoToLaudoDados(
      laudo,
      contratante,
      executante,
      pontos,
      lados,
      getBaseUrl(),
      croquiSvg,
    );
    const buffer = await gerarLaudoPdf(dados, templateId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="LAUDO-${id}-${templateId}.pdf"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default pdfPrimeRouter;
