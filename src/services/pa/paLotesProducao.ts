// v3.188.0 — Lotes de produção (LT-NN) e capa do dossiê técnico do lote (Incremento v1.1).
// O lote de produção nasce da subdivisão (parcela LT-NN ligada ao associado por pa_associados.parcela)
// e da medição de campo (pa_campo_lotes). pa_lotes_producao guarda o cadastro do lote com o que é
// próprio dele (denominação, área oficial, geometria SIRGAS, status da medição); o que estiver vazio
// cai no que o sistema já sabe — nada é digitado duas vezes.
import type { Writable } from 'node:stream';
import type { Archiver } from 'archiver';
import { PaErro } from './erros';
import { pool, rows, one, exec, transacao, num, registrarEvento } from './paDb';
import { buscarProjeto } from './paRepo';
import { sha256 } from './paDocumentos';
import { ASSOCIACAO_PADRAO, nomeArquivoCapa, pdfCapaDossie, type DadosCapa } from './paCapaDossie';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver') as (formato: 'zip', opcoes?: { zlib?: { level?: number } }) => Archiver;

export const STATUS_MEDICAO = ['PENDENTE', 'PROGRAMADO', 'EM_MEDICAO', 'MEDIDO', 'GEORREFERENCIADO'] as const;
export type StatusMedicao = (typeof STATUS_MEDICAO)[number];

export interface LoteProducao {
  id: number; projeto_id: number; codigo: string; parcela: string;
  associado_id: number | null; associado_nome: string | null; associado_numero: string | null; lote_vila: string | null;
  denominacao: string | null; area_ha: number | null; area_origem: 'CADASTRO' | 'CAMPO' | null;
  status_medicao: StatusMedicao; tem_geometria: boolean; capa_versao: number | null; capa_em: string | null;
}

/** "5", "05", "LT-05", "lt 5" → { codigo: "LT-05", parcela: "05" }. Pura — testável. */
export function normalizarCodigo(v: unknown): { codigo: string; parcela: string } {
  const m = /^\s*(?:LT[\s-]*)?(\d{1,4})([A-Z]?)\s*$/i.exec(String(v ?? ''));
  if (!m) throw new PaErro('CAMPO_INVALIDO', 'Código do lote inválido (use LT-05)', 400);
  const parcela = m[1].padStart(2, '0') + m[2].toUpperCase();
  return { codigo: `LT-${parcela}`, parcela };
}

const dec = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Garante uma linha por parcela da subdivisão/vínculo (INSERT IGNORE) e devolve o cadastro consolidado. */
export async function listarLotesProducao(projetoId: number): Promise<LoteProducao[]> {
  await buscarProjeto(projetoId);
  const parcelas = await rows(pool, `SELECT parcela FROM pa_associados WHERE projeto_id = ? AND ativo = 1 AND parcela IS NOT NULL
    UNION SELECT lote FROM pa_campo_lotes WHERE projeto_id = ?`, [projetoId, projetoId]);
  for (const p of parcelas) {
    const { codigo } = normalizarCodigo(p.parcela);
    await exec(pool, 'INSERT IGNORE INTO pa_lotes_producao (projeto_id, codigo) VALUES (?, ?)', [projetoId, codigo]);
  }
  const r = await rows(pool, `
    SELECT lp.*, a.id a_id, a.nome a_nome, a.numero a_numero, a.denominacao_terra, lt.numero lote_vila,
           cl.area_ha campo_area, cl.concluido_em,
           (SELECT MAX(d.versao) FROM pa_documentos d WHERE d.projeto_id = lp.projeto_id AND d.tipo = 'CAPA_DOSSIE_LOTE' AND d.caminho LIKE CONCAT('%/capa-dossie-', lp.codigo, '-v%')) capa_versao,
           (SELECT MAX(d.criado_em) FROM pa_documentos d WHERE d.projeto_id = lp.projeto_id AND d.tipo = 'CAPA_DOSSIE_LOTE' AND d.caminho LIKE CONCAT('%/capa-dossie-', lp.codigo, '-v%')) capa_em
    FROM pa_lotes_producao lp
    LEFT JOIN pa_associados a ON a.id = COALESCE(lp.associado_id, (SELECT x.id FROM pa_associados x WHERE x.projeto_id = lp.projeto_id AND x.ativo = 1 AND x.parcela = SUBSTRING(lp.codigo, 4) LIMIT 1))
    LEFT JOIN pa_lotes lt ON lt.id = a.lote_id
    LEFT JOIN pa_campo_lotes cl ON cl.projeto_id = lp.projeto_id AND cl.lote = SUBSTRING(lp.codigo, 4)
    WHERE lp.projeto_id = ? ORDER BY CAST(SUBSTRING(lp.codigo, 4) AS UNSIGNED), lp.codigo`, [projetoId]);
  return r.map((x) => {
    const areaCad = dec(x.area_ha), areaCampo = dec(x.campo_area);
    const st = String(x.status_medicao ?? 'PENDENTE') as StatusMedicao;
    return {
      id: num(x.id), projeto_id: num(x.projeto_id), codigo: String(x.codigo), parcela: String(x.codigo).slice(3),
      associado_id: x.a_id != null ? num(x.a_id) : null, associado_nome: (x.a_nome as string) ?? null, associado_numero: (x.a_numero as string) ?? null,
      lote_vila: x.lote_vila != null ? String(x.lote_vila) : null,
      denominacao: (x.denominacao as string) || (x.denominacao_terra as string) || null,
      area_ha: areaCad ?? areaCampo, area_origem: areaCad != null ? 'CADASTRO' : areaCampo != null ? 'CAMPO' : null,
      status_medicao: st === 'PENDENTE' && x.concluido_em ? 'MEDIDO' : st,
      tem_geometria: !!x.geom_sirgas, capa_versao: x.capa_versao != null ? num(x.capa_versao) : null,
      capa_em: x.capa_em ? new Date(x.capa_em as string).toISOString() : null,
    };
  });
}

export async function buscarLoteProducao(projetoId: number, codigoRaw: unknown): Promise<LoteProducao> {
  const { codigo } = normalizarCodigo(codigoRaw);
  const l = (await listarLotesProducao(projetoId)).find((x) => x.codigo === codigo);
  if (!l) throw new PaErro('LOTE_NAO_ENCONTRADO', `${codigo} não está cadastrado neste projeto`, 404);
  return l;
}
async function porId(lid: number): Promise<LoteProducao> {
  const r = await one(pool, 'SELECT projeto_id, codigo FROM pa_lotes_producao WHERE id = ?', [lid]);
  if (!r) throw new PaErro('LOTE_NAO_ENCONTRADO', 'Lote de produção não encontrado', 404);
  return buscarLoteProducao(num(r.projeto_id), r.codigo);
}

/** POST (cria) / PATCH (altera): denominação, área oficial, associado, status da medição e geometria SIRGAS (GeoJSON). */
export async function salvarLoteProducao(projetoId: number, codigoRaw: unknown, body: Record<string, unknown>, usuario: string | null, criar: boolean): Promise<LoteProducao> {
  await buscarProjeto(projetoId);
  const { codigo } = normalizarCodigo(codigoRaw);
  const existe = await one(pool, 'SELECT id FROM pa_lotes_producao WHERE projeto_id = ? AND codigo = ?', [projetoId, codigo]);
  if (criar && existe) throw new PaErro('LOTE_DUPLICADO', `${codigo} já está cadastrado`, 409);
  if (!criar && !existe) throw new PaErro('LOTE_NAO_ENCONTRADO', `${codigo} não está cadastrado neste projeto`, 404);

  const sets: string[] = []; const vals: unknown[] = [];
  if ('denominacao' in body) { const d = String(body.denominacao ?? '').replace(/[“”"]/g, '').trim().slice(0, 160); sets.push('denominacao = ?'); vals.push(d || null); }
  if ('area_ha' in body) {
    const a = dec(body.area_ha);
    if (body.area_ha != null && body.area_ha !== '' && (a == null || a <= 0 || a > 100000)) throw new PaErro('CAMPO_INVALIDO', 'Área (ha) inválida', 400);
    sets.push('area_ha = ?'); vals.push(a);
  }
  if ('status_medicao' in body) {
    const s = String(body.status_medicao ?? '').toUpperCase();
    if (!STATUS_MEDICAO.includes(s as StatusMedicao)) throw new PaErro('CAMPO_INVALIDO', `status_medicao deve ser ${STATUS_MEDICAO.join(', ')}`, 400);
    sets.push('status_medicao = ?'); vals.push(s);
  }
  if ('associado_id' in body) {
    const aid = body.associado_id == null || body.associado_id === '' ? null : num(body.associado_id);
    if (aid != null && !(await one(pool, 'SELECT id FROM pa_associados WHERE id = ? AND projeto_id = ? AND ativo = 1', [aid, projetoId])))
      throw new PaErro('ASSOCIADO_NAO_ENCONTRADO', 'Associado não encontrado neste projeto', 404);
    sets.push('associado_id = ?'); vals.push(aid);
  }
  if ('geom_sirgas' in body) {
    let g: string | null = null;
    if (body.geom_sirgas != null && body.geom_sirgas !== '') {
      const o = typeof body.geom_sirgas === 'string' ? (() => { try { return JSON.parse(body.geom_sirgas as string); } catch { return null; } })() : body.geom_sirgas;
      if (!o || typeof o !== 'object' || !/Polygon$/.test(String((o as { type?: unknown }).type ?? ''))) throw new PaErro('CAMPO_INVALIDO', 'geom_sirgas deve ser GeoJSON Polygon/MultiPolygon (SIRGAS 2000)', 400);
      g = JSON.stringify(o);
    }
    sets.push('geom_sirgas = ?'); vals.push(g);
  }
  await transacao(async (c) => {
    if (!existe) await exec(c, 'INSERT INTO pa_lotes_producao (projeto_id, codigo) VALUES (?, ?)', [projetoId, codigo]);
    if (sets.length) await exec(c, `UPDATE pa_lotes_producao SET ${sets.join(', ')} WHERE projeto_id = ? AND codigo = ?`, [...vals, projetoId, codigo]);
    await registrarEvento(c, { projeto_id: projetoId, associado_id: null, usuario, tipo: criar ? 'LOTE_PRODUCAO_CRIADO' : 'LOTE_PRODUCAO_ALTERADO', dados: { codigo, campos: Object.keys(body).filter((k) => k !== 'geom_sirgas'), geometria: 'geom_sirgas' in body } });
  });
  return buscarLoteProducao(projetoId, codigo);
}

/** Dados da capa a partir do cadastro (JSON do gerador de referência). */
export async function dadosCapaLote(projetoId: number, l: LoteProducao, emissao?: string | null): Promise<DadosCapa> {
  if (!l.associado_id || !l.associado_nome) throw new PaErro('LOTE_SEM_ASSOCIADO', `${l.codigo} não tem associado vinculado`, 404);
  const p = await buscarProjeto(projetoId);
  return {
    lote: l.codigo, associado: l.associado_nome, numero: l.associado_numero ?? '', lote_vila: l.lote_vila,
    denominacao: l.denominacao, area_ha: l.area_ha, municipio: `${p.municipio}/${p.uf}`,
    associacao: p.associacao_nome || ASSOCIACAO_PADRAO, emissao: emissao ?? null,
  };
}

export async function pdfCapaLote(projetoId: number, codigoRaw: unknown): Promise<{ pdf: Buffer; nome: string }> {
  const l = await buscarLoteProducao(projetoId, codigoRaw);
  const d = await dadosCapaLote(projetoId, l);
  return { pdf: await pdfCapaDossie(d), nome: nomeArquivoCapa(d) };
}

/** POST /lotes-producao/:lid/gerar/capa — gera e arquiva em pa_documentos (CAPA_DOSSIE_LOTE, versão +1). */
export async function gerarCapaLote(lid: number, usuario: string | null) {
  const l = await porId(lid);
  const p = await buscarProjeto(l.projeto_id);
  const d = await dadosCapaLote(l.projeto_id, l);
  const pdf = await pdfCapaDossie(d);
  const nome = nomeArquivoCapa(d);
  const hash = sha256(pdf);
  const a = await one(pool, 'SELECT id, lote_id, acervo_pasta, nome FROM pa_associados WHERE id = ?', [l.associado_id]);
  const pasta = (a?.acervo_pasta as string) || `LOTE-${l.parcela}-${String(a?.nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  return transacao(async (c) => {
    const v = await one(c, "SELECT COALESCE(MAX(versao), 0) v FROM pa_documentos WHERE projeto_id = ? AND tipo = 'CAPA_DOSSIE_LOTE' AND caminho LIKE ? FOR UPDATE", [l.projeto_id, `%/capa-dossie-${l.codigo}-v%`]);
    const versao = num(v?.v) + 1;
    const caminho = `${p.codigo}/${pasta}/capa-dossie-${l.codigo}-v${versao}-${nome}`.slice(0, 400);
    const ins = await exec(c, `INSERT INTO pa_documentos (projeto_id, lote_id, associado_id, tipo, versao, caminho, nome_original, mime, sha256, tamanho, arquivo_presente)
      VALUES (?, ?, ?, 'CAPA_DOSSIE_LOTE', ?, ?, ?, 'application/pdf', ?, ?, 1)`, [l.projeto_id, a?.lote_id ?? null, l.associado_id, versao, caminho, nome.slice(0, 255), hash, pdf.length]);
    await exec(c, 'INSERT INTO pa_documentos_arquivos (documento_id, conteudo) VALUES (?, ?)', [ins.insertId, pdf]);
    await registrarEvento(c, { projeto_id: l.projeto_id, associado_id: l.associado_id, usuario, tipo: 'CAPA_DOSSIE_GERADA', dados: { documento_id: ins.insertId, codigo: l.codigo, versao, sha256: hash } });
    return { documento_id: ins.insertId, codigo: l.codigo, versao, nome, tamanho: pdf.length };
  });
}

/** POST /projetos/:id/gerar/capas-dossie — ZIP com uma capa por lote que tem associado (filtro opcional de códigos). */
export async function zipCapasDossie(projetoId: number, codigos: unknown, destino: Writable, usuario: string | null): Promise<{ capas: number }> {
  const filtro = Array.isArray(codigos) && codigos.length ? new Set(codigos.map((c) => normalizarCodigo(c).codigo)) : null;
  const lotes = (await listarLotesProducao(projetoId)).filter((l) => l.associado_id && (!filtro || filtro.has(l.codigo)));
  if (!lotes.length) throw new PaErro('SEM_LOTES', 'Nenhum lote com associado para gerar capa', 404);
  // gera tudo antes de abrir o ZIP: erro vira JSON, não um ZIP pela metade
  const pdfs: Array<{ nome: string; pdf: Buffer }> = [];
  for (const l of lotes) { const d = await dadosCapaLote(projetoId, l); pdfs.push({ nome: nomeArquivoCapa(d), pdf: await pdfCapaDossie(d) }); }
  await registrarEvento(pool, { projeto_id: projetoId, associado_id: null, usuario, tipo: 'CAPAS_DOSSIE_ZIP', dados: { capas: pdfs.length, codigos: lotes.map((l) => l.codigo) } });
  const zip = archiver('zip', { zlib: { level: 6 } });
  const fim = new Promise<void>((resolve, reject) => { destino.on('close', () => resolve()); destino.on('finish', () => resolve()); zip.on('error', reject); });
  zip.pipe(destino);
  for (const x of pdfs) zip.append(x.pdf, { name: x.nome });
  await zip.finalize();
  await fim;
  return { capas: pdfs.length };
}
