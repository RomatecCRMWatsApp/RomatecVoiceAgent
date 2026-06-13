// v3.64.0 — Agregador READ-ONLY de anexos de um Laudo de Demarcação.
//
// NÃO cria tabela nem armazena nada: apenas COMPÕE numa lista única as fontes
// que já existem no módulo de laudos. Por isso respeita o modelo de storage do
// projeto (LONGBLOB/base64 no banco — Railway tem containers efêmeros, ver
// migrations-laudos-arquivos.ts) e não usa filesystem.
//
// Fontes agregadas:
//   1. PDF do laudo            → /api/laudos-demarcacao/:id/pdf-assinado | /pdf
//   2. Croqui As-Built         → /api/laudos-demarcacao/:id/croqui
//   3. Recibo de honorários    → /api/recibos/:reciboId/pdf            (via laudo.recibo_id)
//   4. Relatórios fotográficos → /api/relatorio-fotografico/:id/pdf    (relatorios_fotograficos.laudo_id)
//   5. Fotos do laudo          → /api/laudos-demarcacao/foto/:fotoId   (laudos_demarcacao_fotos)
//   6. Arquivos avulsos        → /d/:token  (laudos_demarcacao_arquivos — DXF/DWG/KML/PDF; únicos com Excluir)
//
// Excluir só é exposto para os arquivos avulsos (origem 'upload'), reusando a
// rota DELETE /api/laudos-demarcacao/:id/arquivos/:arquivoId já existente. As
// demais fontes são geradas/gerenciadas em seus próprios módulos.

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { buscarLaudo, listarFotosDoLaudo } from '../integrations/laudos';
import { listarArquivosVetoriais } from './arquivosVetoriaisService';

export type CategoriaAnexo =
  | 'pdf_laudo'
  | 'croqui'
  | 'recibo'
  | 'relatorio_fotografico'
  | 'foto'
  | 'dxf'
  | 'dwg'
  | 'kml'
  | 'documento'
  | 'outro';

export interface AnexoLaudo {
  id: string;                  // chave estável p/ a UI: 'pdf:12' | 'foto:45' | 'arquivo:7' ...
  laudoId: number;
  categoria: CategoriaAnexo;
  rotulo: string;              // texto amigável p/ UI
  nomeArquivo: string;
  url: string;                 // rota de visualização/download
  mimeType: string;
  tamanhoBytes: number;        // 0 quando o tamanho não é conhecido sem carregar o blob
  origem: 'gerado' | 'upload';
  podeExcluir: boolean;        // true só para arquivos avulsos
  excluirUrl: string | null;   // rota DELETE quando podeExcluir (decopla o front da regra de origem)
  criadoEm: string | null;
}

const ROTULO_ARQUIVO: Record<string, string> = {
  dxf: 'Arquivo CAD (DXF)',
  dwg: 'Arquivo CAD (DWG)',
  kml: 'Arquivo Google Earth (KML)',
  pdf: 'Documento PDF',
};

function isoOuNull(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function extDeMime(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('svg')) return 'svg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('pdf')) return 'pdf';
  return 'jpg';
}

/** Conta os vértices do laudo (pra decidir se vale incluir o croqui AUTO_SVG). */
async function contarPontos(laudoId: number): Promise<number> {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS c FROM laudos_demarcacao_pontos WHERE laudo_id = ?',
      [laudoId],
    );
    return rows.length ? Number(rows[0].c) || 0 : 0;
  } catch {
    return 0;
  }
}

/** MIME do croqui quando é UPLOAD (sem carregar o blob inteiro). */
async function croquiUploadMime(laudoId: number): Promise<string> {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT croqui_mime FROM laudos_demarcacao WHERE id = ? LIMIT 1',
      [laudoId],
    );
    return rows.length && rows[0].croqui_mime ? String(rows[0].croqui_mime) : 'image/png';
  } catch {
    return 'image/png';
  }
}

/**
 * Monta a lista completa de anexos de um laudo de demarcação.
 * Recebe o ID NUMÉRICO já resolvido (use resolverLaudoId() na rota).
 * Lança { statusCode: 404 } se o laudo não existir.
 */
export async function listarAnexosDoLaudo(laudoId: number): Promise<AnexoLaudo[]> {
  const laudo = await buscarLaudo(laudoId);
  if (!laudo) {
    const err: Error & { statusCode?: number } = new Error('Laudo não encontrado');
    err.statusCode = 404;
    throw err;
  }
  const id = laudo.id;
  const anexos: AnexoLaudo[] = [];

  // 1) PDF do laudo — assinado se houver, senão a prévia gerada sob demanda.
  if (laudo.assinado_em) {
    anexos.push({
      id: `pdf:${id}`,
      laudoId: id,
      categoria: 'pdf_laudo',
      rotulo: 'PDF do Laudo (assinado)',
      nomeArquivo: `Laudo-${laudo.numero_laudo}-assinado.pdf`,
      url: `/api/laudos-demarcacao/${id}/pdf-assinado`,
      mimeType: 'application/pdf',
      tamanhoBytes: 0,
      origem: 'gerado',
      podeExcluir: false,
      excluirUrl: null,
      criadoEm: isoOuNull(laudo.assinado_em),
    });
  } else {
    anexos.push({
      id: `pdf:${id}`,
      laudoId: id,
      categoria: 'pdf_laudo',
      rotulo: 'PDF do Laudo (prévia)',
      nomeArquivo: `Laudo-${laudo.numero_laudo}.pdf`,
      url: `/api/laudos-demarcacao/${id}/pdf`,
      mimeType: 'application/pdf',
      tamanhoBytes: 0,
      origem: 'gerado',
      podeExcluir: false,
      excluirUrl: null,
      criadoEm: null,
    });
  }

  // 2) Croqui As-Built — UPLOAD (tem blob) ou AUTO_SVG (precisa de >= 2 pontos pra desenhar).
  const ehUpload = laudo.croqui_tipo === 'UPLOAD';
  if (ehUpload || (await contarPontos(id)) >= 2) {
    const mime = ehUpload ? await croquiUploadMime(id) : 'image/svg+xml';
    anexos.push({
      id: `croqui:${id}`,
      laudoId: id,
      categoria: 'croqui',
      rotulo: 'Croqui As-Built',
      nomeArquivo: `croqui-${id}.${extDeMime(mime)}`,
      url: `/api/laudos-demarcacao/${id}/croqui`,
      mimeType: mime,
      tamanhoBytes: 0,
      origem: 'gerado',
      podeExcluir: false,
      excluirUrl: null,
      criadoEm: null,
    });
  }

  // 3) Recibo de honorários — via FK laudo.recibo_id.
  if (laudo.recibo_id) {
    anexos.push({
      id: `recibo:${laudo.recibo_id}`,
      laudoId: id,
      categoria: 'recibo',
      rotulo: 'Recibo de Honorários',
      nomeArquivo: `Recibo-${laudo.recibo_id}.pdf`,
      url: `/api/recibos/${laudo.recibo_id}/pdf`,
      mimeType: 'application/pdf',
      tamanhoBytes: 0,
      origem: 'gerado',
      podeExcluir: false,
      excluirUrl: null,
      criadoEm: null,
    });
  }

  // 4) Relatórios fotográficos vinculados (0..N). Tolera DB antigo sem a tabela.
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, titulo, assinado_em, created_at
         FROM relatorios_fotograficos
        WHERE laudo_id = ?
        ORDER BY id ASC`,
      [id],
    );
    for (const r of rows) {
      const assinado = !!r.assinado_em;
      anexos.push({
        id: `relfoto:${Number(r.id)}`,
        laudoId: id,
        categoria: 'relatorio_fotografico',
        rotulo: r.titulo ? `Relatório Fotográfico — ${String(r.titulo)}` : 'Relatório Fotográfico',
        nomeArquivo: `relatorio-fotografico-${Number(r.id)}.pdf`,
        url: `/api/relatorio-fotografico/${Number(r.id)}/pdf${assinado ? '-assinado' : ''}`,
        mimeType: 'application/pdf',
        tamanhoBytes: 0,
        origem: 'gerado',
        podeExcluir: false,
        excluirUrl: null,
        criadoEm: isoOuNull(r.created_at),
      });
    }
  } catch {
    /* tabela relatorios_fotograficos ausente (DB anterior à v3.51.0) — ignora */
  }

  // 5) Fotos do laudo (laudos_demarcacao_fotos). Gerenciadas na aba de fotos → sem Excluir aqui.
  const fotos = await listarFotosDoLaudo(id);
  for (const f of fotos) {
    anexos.push({
      id: `foto:${f.id}`,
      laudoId: id,
      categoria: 'foto',
      rotulo: f.legenda || (f.ponto_id ? `Foto do ponto #${f.ponto_id}` : 'Foto'),
      nomeArquivo: `foto-${f.id}.${extDeMime(f.mime)}`,
      url: `/api/laudos-demarcacao/foto/${f.id}`,
      mimeType: f.mime,
      tamanhoBytes: 0,
      origem: 'upload',
      podeExcluir: false,
      excluirUrl: null,
      criadoEm: f.created_at ?? null,
    });
  }

  // 6) Arquivos avulsos (DXF/DWG/KML/PDF) — únicos com Excluir, reusando a rota existente.
  const arquivos = await listarArquivosVetoriais(id);
  for (const a of arquivos) {
    const cat = (['dxf', 'dwg', 'kml'].includes(a.tipo) ? a.tipo : 'documento') as CategoriaAnexo;
    anexos.push({
      id: `arquivo:${a.id}`,
      laudoId: id,
      categoria: cat,
      rotulo: ROTULO_ARQUIVO[a.tipo] || 'Documento',
      nomeArquivo: a.nome_original,
      url: `/d/${a.download_token}`,
      mimeType: a.mime_type,
      tamanhoBytes: Number(a.tamanho_bytes) || 0,
      origem: 'upload',
      podeExcluir: true,
      excluirUrl: `/api/laudos-demarcacao/${id}/arquivos/${a.id}`,
      criadoEm: a.created_at ?? null,
    });
  }

  return anexos;
}
