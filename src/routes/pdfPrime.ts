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
  listarFotosDoLaudo,
  getFotoConteudo,
} from '../integrations/laudos';
import { buscarContratante } from '../integrations/contratantes';
import { buscarExecutante } from '../integrations/executantes';
import { gerarCroquiSvg } from '../services/croquiSvg';
import { getBaseUrl } from '../services/reciboPdf';
import { gerarMemorialDescritivo } from '../services/memorialDescritivo';
import { gerarPixBrCode } from '../services/pixBrCode';
import { gerarQrCodeBase64 } from '../pdf/sharedHtml';
import type { LaudoDados } from '../types/templateTypes';
import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';

/** Limite de fotos embarcadas no relatorio fotografico Prime. */
const MAX_FOTOS_PRIME = 12;

// v3.65.0 — helpers de formatação para a seção de arquivos anexos e a caixa ICP.
function fmtTamanhoBytes(bytes: number | null | undefined): string {
  const n = Number(bytes) || 0;
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : i > 0 ? 1 : 0)} ${u[i]}`;
}
function fmtDataCurta(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString('pt-BR');
}
function fmtDataHora(v: unknown): string {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v ?? '');
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

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

    // Memorial descritivo (best-effort) — paragrafo narrativo da poligonal.
    let memorialTexto = '';
    try {
      memorialTexto =
        gerarMemorialDescritivo({ laudo, pontos, lados, contratante }).descricao || '';
    } catch (memErr) {
      console.warn('[pdf-prime:laudo] memorial pulado:', (memErr as Error).message);
      memorialTexto = '';
    }

    // Fotos do relatorio fotografico (best-effort, limitadas).
    let fotos: LaudoDados['fotos'] = [];
    try {
      const metaFotos = await listarFotosDoLaudo(id);
      const selecionadas = metaFotos.slice(0, MAX_FOTOS_PRIME);
      const carregadas = await Promise.all(
        selecionadas.map(async (f) => {
          const c = await getFotoConteudo(f.id);
          if (!c || !c.base64) return null;
          const dataUri = c.base64.startsWith('data:')
            ? c.base64
            : `data:${c.mime};base64,${c.base64}`;
          return { dataUri, legenda: f.legenda || '' };
        }),
      );
      fotos = carregadas.filter((f): f is { dataUri: string; legenda: string } => f !== null);
    } catch (fotoErr) {
      console.warn('[pdf-prime:laudo] fotos puladas:', (fotoErr as Error).message);
      fotos = [];
    }

    // Pagamento PIX (best-effort) — emissor ativo + BR Code "copia e cola".
    let pagamento: LaudoDados['pagamento'];
    try {
      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT pix, banco, agencia, conta, tipo_conta, titular, documento
           FROM dados_pagamento_emissor
          WHERE ativo = 1
          ORDER BY id DESC
          LIMIT 1`,
      );
      const emissor = rows[0];
      if (emissor && emissor.pix) {
        const valorRaw = laudo.valor_final ?? laudo.valor_demarcacao;
        const valor = valorRaw != null ? Number(valorRaw) : 0;
        const titular = String(emissor.titular || 'ROMATEC');
        const txid = (laudo.numero_laudo || `LAUDO${laudo.id}`)
          .replace(/[^a-zA-Z0-9]/g, '')
          .slice(0, 25);
        const brCode = gerarPixBrCode({
          chave: String(emissor.pix),
          nome: titular,
          cidade: 'ACAILANDIA',
          valor: valor > 0 ? valor : null,
          txid,
          descricao: `Laudo ${laudo.numero_laudo || laudo.id}`,
        });
        const qrDataUrl = await gerarQrCodeBase64(brCode);
        const valorFormatado =
          valor > 0
            ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            : undefined;
        pagamento = {
          titular,
          documento: emissor.documento != null ? String(emissor.documento) : undefined,
          pix: String(emissor.pix),
          banco: emissor.banco != null ? String(emissor.banco) : undefined,
          agencia: emissor.agencia != null ? String(emissor.agencia) : undefined,
          conta: emissor.conta != null ? String(emissor.conta) : undefined,
          valorFormatado,
          brCode,
          qrDataUrl,
        };
      }
    } catch (pixErr) {
      console.warn('[pdf-prime:laudo] pagamento pulado:', (pixErr as Error).message);
      pagamento = undefined;
    }

    // v3.65.0 — Arquivos técnicos anexos (DXF/DWG/KML/PDF) com link + QR Code.
    // Espelha a seção do PDF padrão (laudoPdf.ts). Best-effort: falha não derruba o PDF.
    let arquivos: LaudoDados['arquivos'];
    try {
      const av = await import('../services/arquivosVetoriaisService');
      const rows = await av.listarArquivosVetoriais(Number(laudo.id));
      const base = getBaseUrl().replace(/\/$/, '');
      arquivos = await Promise.all(
        rows.map(async (a) => {
          const url = `${base}/d/${a.download_token}`;
          return {
            nome: a.nome_original,
            tipoLabel: `ARQUIVO ${String(a.tipo).toUpperCase()}`,
            tamanho: fmtTamanhoBytes(a.tamanho_bytes),
            url,
            validade: fmtDataCurta(a.download_expira_em),
            qrDataUrl: await gerarQrCodeBase64(url),
          };
        }),
      );
      if (arquivos.length === 0) arquivos = undefined;
    } catch (anexoErr) {
      console.warn('[pdf-prime:laudo] arquivos anexos pulados:', (anexoErr as Error).message);
      arquivos = undefined;
    }

    // v3.65.0 — Caixa ICP-Brasil quando o laudo está assinado. Reconstrói a meta
    // a partir do certificado PJ (mesma fonte usada no /assinar). Best-effort.
    let assinaturaIcp: LaudoDados['assinaturaIcp'];
    if (laudo.assinado_em) {
      try {
        const certsMod = await import('../services/signingCertificates');
        const cert = await certsMod.getCertForSigning('pj');
        assinaturaIcp = {
          signerCn: cert?.meta.subject_cn || executante.nome,
          signerDoc: cert?.meta.subject_doc ?? undefined,
          issuerCn: cert?.meta.issuer_cn ?? undefined,
          validadeAte: fmtDataCurta(cert?.meta.validade_ate),
          dataAssinatura: fmtDataHora(laudo.assinado_em),
        };
      } catch (sigErr) {
        console.warn('[pdf-prime:laudo] assinatura ICP best-effort:', (sigErr as Error).message);
        assinaturaIcp = { signerCn: executante.nome, dataAssinatura: fmtDataHora(laudo.assinado_em) };
      }
    }

    const dados = laudoToLaudoDados(
      laudo,
      contratante,
      executante,
      pontos,
      lados,
      getBaseUrl(),
      { croquiSvg, memorialTexto, pagamento, fotos, assinaturaIcp, arquivos },
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
