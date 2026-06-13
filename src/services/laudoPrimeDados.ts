// v3.65.0 — Builder compartilhado do LaudoDados pros templates Prime I/II.
//
// Centraliza a montagem (croqui SVG, memorial, fotos, PIX, arquivos anexos) que
// antes vivia só na rota GET /api/pdf-prime/laudo/:id. Agora é reusado também
// pelo fluxo de ASSINATURA (/assinar?template=prime1|prime2), pra que o layout
// escolhido seja gerado e PAdES-assinado de verdade.
//
// A caixa "ASSINADO DIGITALMENTE — ICP-Brasil" só entra quando o chamador passa
// `opts.assinaturaIcp` (i.e. no fluxo de assinatura). O preview de export rápido
// chama SEM esse campo, então não exibe a caixa (evita parecer assinado sem ser).

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import {
  buscarLaudo,
  listarPontosDoLaudo,
  listarLadosDoLaudo,
  listarFotosDoLaudo,
  getFotoConteudo,
} from '../integrations/laudos';
import { buscarContratante } from '../integrations/contratantes';
import { buscarExecutante } from '../integrations/executantes';
import { gerarCroquiSvg } from './croquiSvg';
import { getBaseUrl } from './reciboPdf';
import { gerarMemorialDescritivo } from './memorialDescritivo';
import { gerarPixBrCode } from './pixBrCode';
import { gerarQrCodeBase64 } from '../pdf/sharedHtml';
import { laudoToLaudoDados } from '../pdf/mappers';
import type { LaudoDados } from '../types/templateTypes';

/** Limite de fotos embarcadas no relatorio fotografico Prime. */
const MAX_FOTOS_PRIME = 12;

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

/** Meta de certificado mínima necessária pra montar a caixa ICP. */
export interface CertMetaParaIcp {
  subject_cn?: string | null;
  subject_doc?: string | null;
  issuer_cn?: string | null;
  validade_ate?: string | Date | null;
}

/**
 * Monta o objeto da caixa verde ICP-Brasil a partir da meta do certificado +
 * data da assinatura. `signerFallback` é usado quando o cert não traz subject_cn.
 */
export function montarAssinaturaIcp(
  certMeta: CertMetaParaIcp | null | undefined,
  assinadoEm: string | Date,
  signerFallback: string,
): LaudoDados['assinaturaIcp'] {
  return {
    signerCn: certMeta?.subject_cn || signerFallback,
    signerDoc: certMeta?.subject_doc ?? undefined,
    issuerCn: certMeta?.issuer_cn ?? undefined,
    validadeAte: fmtDataCurta(certMeta?.validade_ate),
    dataAssinatura: fmtDataHora(assinadoEm),
  };
}

/**
 * Carrega o laudo e monta o LaudoDados completo pros templates Prime.
 * @throws Error com statusCode 404/500 quando laudo/contratante/executante faltam.
 */
export async function construirLaudoDadosPrime(
  id: string | number,
  opts?: { assinaturaIcp?: LaudoDados['assinaturaIcp'] },
): Promise<LaudoDados> {
  const laudo = await buscarLaudo(id);
  if (!laudo) {
    const err: Error & { statusCode?: number } = new Error('laudo nao encontrado');
    err.statusCode = 404;
    throw err;
  }
  const [contratante, executante, pontos, lados] = await Promise.all([
    buscarContratante(laudo.contratante_id),
    buscarExecutante(laudo.executante_id),
    listarPontosDoLaudo(id),
    listarLadosDoLaudo(id),
  ]);
  if (!contratante || !executante) {
    const err: Error & { statusCode?: number } = new Error('Contratante/Executante associado nao encontrado');
    err.statusCode = 500;
    throw err;
  }

  // Croqui SVG (best-effort): poligonal a partir dos pontos UTM.
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
    console.warn('[laudoPrimeDados] croqui pulado:', (croquiErr as Error).message);
    croquiSvg = undefined;
  }

  // Memorial descritivo (best-effort).
  let memorialTexto = '';
  try {
    memorialTexto = gerarMemorialDescritivo({ laudo, pontos, lados, contratante }).descricao || '';
  } catch (memErr) {
    console.warn('[laudoPrimeDados] memorial pulado:', (memErr as Error).message);
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
        const dataUri = c.base64.startsWith('data:') ? c.base64 : `data:${c.mime};base64,${c.base64}`;
        return { dataUri, legenda: f.legenda || '' };
      }),
    );
    fotos = carregadas.filter((f): f is { dataUri: string; legenda: string } => f !== null);
  } catch (fotoErr) {
    console.warn('[laudoPrimeDados] fotos puladas:', (fotoErr as Error).message);
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
      const txid = (laudo.numero_laudo || `LAUDO${laudo.id}`).replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
      const brCode = gerarPixBrCode({
        chave: String(emissor.pix),
        nome: titular,
        cidade: 'ACAILANDIA',
        valor: valor > 0 ? valor : null,
        txid,
        descricao: `Laudo ${laudo.numero_laudo || laudo.id}`,
      });
      const qrDataUrl = await gerarQrCodeBase64(brCode);
      const valorFormatado = valor > 0
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
    console.warn('[laudoPrimeDados] pagamento pulado:', (pixErr as Error).message);
    pagamento = undefined;
  }

  // Arquivos técnicos anexos (DXF/DWG/KML/PDF) com link + QR Code (best-effort).
  let arquivos: LaudoDados['arquivos'];
  try {
    const av = await import('./arquivosVetoriaisService');
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
    console.warn('[laudoPrimeDados] arquivos anexos pulados:', (anexoErr as Error).message);
    arquivos = undefined;
  }

  return laudoToLaudoDados(laudo, contratante, executante, pontos, lados, getBaseUrl(), {
    croquiSvg,
    memorialTexto,
    pagamento,
    fotos,
    arquivos,
    assinaturaIcp: opts?.assinaturaIcp,
  });
}
