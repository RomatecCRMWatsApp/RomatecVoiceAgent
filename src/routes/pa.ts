// src/routes/pa.ts
// v3.142.0 — Módulo "Gestão de PA / Loteamentos". Prefixo /api/pa (o
// apiAuthGate já exige login em todo /api). Fases 1–2 do spec: projetos,
// painel, lotes/mapa, associados, documentos, financeiro (InfinitePay, rateio,
// cobrança), importação do seed/acervo e export ZIP.
//
// Perfil LGPD por requisição (ver services/pa/lgpd.ts): DIRECAO_ASSOCIACAO só
// lê, recebe CPF mascarado e não acessa documentos; exclusão é só ADMIN.
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import os from 'node:os';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import type { AuthedRequest } from '../middleware/auth';
import { PaErro } from '../services/pa/erros';
import { hojeBrasil } from '../services/pa/paDb';
import { perfilPorRole, podeEscrever, podeExcluir, podeVerDocumentos, filtrarPorPerfil, type PerfilPa } from '../services/pa/lgpd';
import * as repo from '../services/pa/paRepo';
import * as fin from '../services/pa/paFinanceiro';
import * as docs from '../services/pa/paDocumentos';
import { planejarSeed, type SeedJson } from '../services/pa/seedPlan';
import { executarSeed, leitorZip, contagemProjeto } from '../services/pa/seedRun';
import { gerarPixCopiaECola } from '../services/pa/pixBrCode';
import { desenhoDoProjeto } from '../services/pa/layoutDesenho';
import { marcaUrls } from '../services/pa/marcaProjeto';
import * as boletos from '../services/pa/paBoletos';
import * as waPa from '../services/pa/paWhatsapp';
import * as boletoPdf from '../services/pa/paBoletoPdf';
import * as mapas from '../services/pa/paMapas';
import * as caixa from '../services/pa/paCaixa';
import * as carteirinha from '../services/pa/paCarteirinha';
import * as ata from '../services/pa/paAta';
import * as concessao from '../services/pa/paConcessao';
import * as ajuste from '../services/pa/paAjusteBoleto';
import { pool, rows, registrarEvento } from '../services/pa/paDb';
import * as pesquisa from '../services/pa/paPesquisa';
import { linkMapaPublico, textoMapaPublico, mensagemMapaIndividual } from './paMapaPublico';
import * as part from '../services/pa/paParticipantes';
import * as relacao from '../services/pa/paRelacaoLotes';
import * as marcos from '../services/pa/paMarcos';
import * as coletora from '../services/pa/paColetora';
import * as equipe from '../services/pa/paEquipe';
import * as campo from '../services/pa/paCampo';
import * as boletim from '../services/pa/paCampoBoletim';
import * as programacao from '../services/pa/paCampoProgramacao';
import * as relatorioCampo from '../services/pa/paCampoRelatorio';
import { fotoUsuario, salvarFotoUsuario, removerFotoUsuario } from '../services/pa/paUsuarioFoto';
import { baseValida } from '../services/pa/mapaTiles';
import * as dossie from '../services/pa/paDossie';
import * as kmlLote from '../services/pa/paKmlLote';
import * as lotesProd from '../services/pa/paLotesProducao';

const router = Router();
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });
// Acervo pode passar de 100 MB → disco temporário (efêmero no Railway, apagado após o import).
const uploadDisco = multer({ dest: os.tmpdir(), limits: { fileSize: 400 * 1024 * 1024, files: 2 } });

interface Ctx { sub: string | null; perfil: PerfilPa; nome: string | null; permissoes: equipe.PermissoesCampo }
type ReqPa = Request & { pa?: Ctx };

async function contexto(req: ReqPa, res: Response, next: NextFunction) {
  try {
    const u = (req as AuthedRequest).user;
    const sub = u?.sub ? String(u.sub) : null;
    const a = await equipe.acessoPa(sub);
    const perfil = a.perfil ?? perfilPorRole(u?.role);
    // v3.180.0: sem cadastro na Equipe, vale o padrão do perfil (do role); com cadastro, o que o ADMIN marcou
    req.pa = { sub, perfil, nome: a.nome ?? (u as { name?: string } | undefined)?.name ?? null, permissoes: a.perfil ? a.permissoes : equipe.lerPermissoes(null, perfil) };
    if (sub) void equipe.registrarAcesso(sub, (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || null, req.headers['user-agent']);
    // permissão por função: bloqueio no servidor (o que não está marcado → 403)
    if (!equipe.rotaPaPermitida(perfil, req.method, req.path, req.pa.permissoes)) {
      const k = equipe.permissaoDaRota(req.method, req.path);
      throw new PaErro('SEM_PERMISSAO', k && k !== '*' ? `Sem permissão: ${equipe.rotuloPermissao(k)}. Peça ao administrador para liberar em Equipe e permissões.` : 'Seu perfil não tem acesso a isto', 403);
    }
    next();
  } catch (err) {
    // v3.176.0: bloqueio de perfil responde 403 em JSON (antes caía no handler padrão do Express → 500)
    if (err instanceof PaErro) { res.status(err.http).json({ erro: err.message, codigo: err.codigo, detalhe: err.detalhe ?? null }); return; }
    next(err);
  }
}
router.use(contexto);

function ctx(req: Request): Ctx {
  return (req as ReqPa).pa ?? { sub: null, perfil: 'DIRECAO_ASSOCIACAO', nome: null, permissoes: equipe.PERMISSOES_PADRAO };
}
function exigirEscrita(req: Request) {
  if (!podeEscrever(ctx(req).perfil)) throw new PaErro('SEM_PERMISSAO', 'Perfil somente leitura (Direção da Associação)', 403);
}
function exigirAdmin(req: Request) {
  if (!podeExcluir(ctx(req).perfil)) throw new PaErro('SEM_PERMISSAO', 'Somente ADMIN', 403);
}
function exigirDocumentos(req: Request) {
  if (!podeVerDocumentos(ctx(req).perfil)) throw new PaErro('SEM_PERMISSAO', 'Seu perfil não acessa documentos (LGPD)', 403);
}
function id(v: unknown, nome = 'id'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new PaErro('CAMPO_INVALIDO', `${nome} inválido`, 400);
  return n;
}

/** Wrapper: erros de regra viram {erro, codigo}; o resto, 500 com log. */
function h(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent && out !== undefined) res.json(out);
    } catch (err) {
      if (err instanceof PaErro) {
        if (res.headersSent) return;
        // v3.191.1: PDF aberto direto numa aba (navegação) → mensagem legível em vez de JSON
        if (req.method === 'GET' && req.accepts(['json', 'html']) === 'html') {
          const m = err.message.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
          res.status(err.http).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aviso</title><body style="font-family:Arial,sans-serif;padding:28px;color:#1C1C18;background:#F7F4EC"><div style="max-width:520px;margin:auto;background:#fff;border:1px solid #C9A84C;border-radius:10px;padding:20px"><h2 style="color:#0C3320;margin-top:0">⚠️ ${m}</h2><p style="color:#555">Feche esta aba e volte para a Gestão de PA.</p></div></body>`);
          return;
        }
        res.status(err.http).json({ erro: err.message, codigo: err.codigo, detalhe: err.detalhe ?? null });
        return;
      }
      console.error(`[pa] ${req.method} ${req.originalUrl}:`, err);
      if (!res.headersSent) res.status(500).json({ erro: 'Erro interno no módulo PA', codigo: 'ERRO_INTERNO' });
    }
  };
}

/** Aplica a visão LGPD em objetos/arrays aninhados (associados, lançamentos, pagamentos). */
function visao<T>(v: T, perfil: PerfilPa): T {
  if (perfil !== 'DIRECAO_ASSOCIACAO') return v;
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const o = filtrarPorPerfil(x as Record<string, unknown>, perfil);
      for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') (o as Record<string, unknown>)[k] = walk(o[k]);
      return o;
    }
    return x;
  };
  return walk(v) as T;
}

// ─── Sessão ───────────────────────────────────────────────────────────────
router.get('/eu', h(async (req) => ({ id: ctx(req).sub, nome: ctx(req).nome, permissoes: ctx(req).permissoes, perfil: ctx(req).perfil, pode_escrever: podeEscrever(ctx(req).perfil), pode_excluir: podeExcluir(ctx(req).perfil), ve_documentos: podeVerDocumentos(ctx(req).perfil) })));
// v3.192.0: foto do usuário (avatar do menu)
router.get('/eu/foto', h(async (req, res) => {
  const f = await fotoUsuario(ctx(req).sub);
  if (!f) { res.status(404).end(); return undefined; }
  res.setHeader('Content-Type', f.mime); res.setHeader('Cache-Control', 'private, max-age=300'); res.end(f.conteudo);
  return undefined;
}));
router.put('/eu/foto', h(async (req) => salvarFotoUsuario(ctx(req).sub, req.body?.imagem)));
router.delete('/eu/foto', h(async (req) => removerFotoUsuario(ctx(req).sub)));

// ─── Projetos ─────────────────────────────────────────────────────────────
router.get('/projetos', h(async () => ({ projetos: await repo.listarProjetos() })));
router.post('/projetos', h(async (req, res) => {
  exigirAdmin(req);
  res.status(201);
  return { projeto: await repo.criarProjeto(req.body ?? {}, ctx(req).sub) };
}));
router.get('/projetos/:id', h(async (req) => ({ projeto: await repo.buscarProjeto(id(req.params.id)) })));
router.get('/projetos/:id/painel', h(async (req) => repo.painel(id(req.params.id))));
router.get('/projetos/:id/pix', h(async (req) => {
  const p = await repo.buscarProjeto(id(req.params.id));
  const valor = req.query.valor ? Number(req.query.valor) : null;
  return { copia_e_cola: gerarPixCopiaECola({ chave: p.pix_chave ?? '', favorecido: p.pix_favorecido ?? '', cidade: p.pix_cidade ?? '', valor }) };
}));

// v3.142.1: elementos do desenho (vias, praça, equipamentos) p/ o mapa igual ao PDF.
router.get('/projetos/:id/desenho', h(async (req) => {
  const p = await repo.buscarProjeto(id(req.params.id));
  return { desenho: desenhoDoProjeto(p.codigo, p.layout_json), marca: marcaUrls(p.codigo) };
}));

// ─── v3.146.0: mapas técnicos (vila + memorial; perímetro geral + memorial) ──
function enviarPdf(res: Response, r: { pdf: Buffer; nome: string }) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(r.pdf);
}
function textoDoArquivo(buf: Buffer): string {
  const utf = buf.toString('utf8');
  // TXT de coletora/planilha costuma vir em Latin-1: se o UTF-8 quebrar, relê.
  return utf.includes('�') ? buf.toString('latin1') : utf;
}
router.get('/projetos/:id/memorial-vila', h(async (req) => ({ memorial: await mapas.memorialDoProjeto(id(req.params.id)) })));
router.get('/projetos/:id/mapa-vila.pdf', h(async (req, res) => { enviarPdf(res, await mapas.pdfMapaVila(id(req.params.id))); return undefined; }));
router.get('/projetos/:id/perimetro', h(async (req) => ({ perimetro: await mapas.buscarPerimetro(id(req.params.id)) })));
router.post('/projetos/:id/perimetro', uploadMem.single('arquivo'), h(async (req) => {
  exigirEscrita(req);
  const f = req.file as Express.Multer.File | undefined;
  if (!f?.buffer?.length) throw new PaErro('ARQUIVO_VAZIO', 'Envie o arquivo do perímetro (TXT, CSV ou DXF) no campo "arquivo"', 400);
  if (!/\.(txt|csv|dxf|xyz|dat)$/i.test(f.originalname)) throw new PaErro('TIPO_ARQUIVO', 'Formatos aceitos: TXT, CSV ou DXF', 415);
  const fuso = req.body?.fuso ? Number(req.body.fuso) : null;
  if (fuso != null && (!Number.isInteger(fuso) || fuso < 18 || fuso > 25)) throw new PaErro('CAMPO_INVALIDO', 'Fuso UTM inválido para o Brasil (18 a 25)', 400);
  const hem = req.body?.hemisferio === 'N' ? 'N' : 'S';
  return { perimetro: await mapas.salvarPerimetro(id(req.params.id), { nome: f.originalname, conteudo: textoDoArquivo(f.buffer) }, { fuso, hemisferio: hem }, ctx(req).sub) };
}));
router.delete('/projetos/:id/perimetro', h(async (req) => { exigirAdmin(req); await mapas.removerPerimetro(id(req.params.id), ctx(req).sub); return { ok: true }; }));
// v3.154.0: perímetro real da vila (DXF da AC-01).
router.get('/projetos/:id/vila-perimetro', h(async (req) => ({ vila: await mapas.buscarVila(id(req.params.id)) })));
router.post('/projetos/:id/vila-perimetro', uploadMem.single('arquivo'), h(async (req) => {
  exigirEscrita(req);
  const f = req.file;
  if (!f) throw new PaErro('ARQUIVO_VAZIO', 'Envie o DXF da vila no campo "arquivo"', 400);
  if (!/\.dxf$/i.test(f.originalname)) throw new PaErro('TIPO_ARQUIVO', 'Envie o DXF do perímetro da vila', 415);
  return { vila: await mapas.salvarVila(id(req.params.id), { nome: f.originalname, conteudo: textoDoArquivo(f.buffer) }, { fuso: Number(req.body?.fuso) || null, hemisferio: req.body?.hemisferio === 'N' ? 'N' : 'S' }, ctx(req).sub) };
}));
router.delete('/projetos/:id/vila-perimetro', h(async (req) => { exigirAdmin(req); await mapas.removerVila(id(req.params.id), ctx(req).sub); return { ok: true }; }));
router.get('/projetos/:id/vila-perimetro.pdf', h(async (req, res) => {
  enviarPdf(res, await mapas.pdfVila(id(req.params.id), req.query.parte === 'nucleo' ? 'nucleo' : 'total', req.query.modelo === 'sigef' ? 'sigef' : 'tradicional'));
  return undefined;
}));
// v3.151.0: subdivisão do PA em lotes (DXF da divisão/marcos).
router.get('/projetos/:id/subdivisao', h(async (req) => {
  const sub = await mapas.buscarSubdivisao(id(req.params.id));
  return { subdivisao: sub ? { ...sub, camadas: undefined, geometria_original: undefined } : null, vinculos: sub ? visao(await mapas.vinculosParcelas(id(req.params.id)), ctx(req).perfil) : {}, municipios: sub ? await mapas.municipiosDosLotes(id(req.params.id)) : null };
}));
router.post('/projetos/:id/subdivisao/vinculo', h(async (req) => {
  exigirEscrita(req);
  const b = req.body ?? {};
  const aid = b.associado_id == null || b.associado_id === '' ? null : id(b.associado_id, 'associado');
  return { vinculos: await mapas.vincularParcela(id(req.params.id), String(b.lote ?? ''), aid, ctx(req).sub) };
}));
router.post('/projetos/:id/subdivisao', uploadMem.single('arquivo'), h(async (req) => {
  exigirEscrita(req);
  const f = req.file;
  if (!f) throw new PaErro('ARQUIVO_VAZIO', 'Envie o DXF no campo "arquivo"', 400);
  const fuso = Number(req.body?.fuso) || null;
  const hem = req.body?.hemisferio === 'N' ? 'N' : 'S';
  const sub = await mapas.salvarSubdivisao(id(req.params.id), { nome: f.originalname, conteudo: textoDoArquivo(f.buffer) }, { fuso, hemisferio: hem }, ctx(req).sub);
  return { subdivisao: { ...sub, camadas: undefined, geometria_original: undefined }, limpeza: sub.limpeza };
}));
router.delete('/projetos/:id/subdivisao', h(async (req) => { exigirAdmin(req); await mapas.removerSubdivisao(id(req.params.id), ctx(req).sub); return { ok: true }; }));
// v3.158.0: limpar poligonais (reprocessa o que está salvo) e baixar o DXF limpo
router.post('/projetos/:id/subdivisao/limpar', h(async (req) => {
  exigirEscrita(req);
  const sub = await mapas.limparSubdivisaoSalva(id(req.params.id), ctx(req).sub);
  return { subdivisao: { ...sub, camadas: undefined, geometria_original: undefined }, limpeza: sub.limpeza };
}));
// v3.160.0: divisa municipal
router.get('/projetos/:id/divisa', h(async (req) => mapas.buscarDivisa(id(req.params.id))));
router.post('/projetos/:id/divisa', uploadMem.single('arquivo'), h(async (req) => {
  exigirEscrita(req);
  const f = req.file;
  if (!f) throw new PaErro('ARQUIVO_VAZIO', 'Envie o DXF no campo "arquivo"', 400);
  const nomes = [req.body?.municipio_a, req.body?.municipio_b].map((x) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 80) : null));
  return mapas.salvarDivisa(id(req.params.id), { nome: f.originalname, conteudo: textoDoArquivo(f.buffer) }, nomes, ctx(req).sub);
}));
router.delete('/projetos/:id/divisa', h(async (req) => { exigirAdmin(req); await mapas.removerDivisa(id(req.params.id), ctx(req).sub); return { ok: true }; }));
router.get('/projetos/:id/divisa.dxf', h(async (req, res) => {
  const { dxf, nome } = await mapas.dxfDivisaProjeto(id(req.params.id));
  res.setHeader('Content-Type', 'application/dxf; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome.replace(/[^\w.\-]+/g, '_')}"`);
  res.end(dxf);
  return undefined;
}));
router.get('/projetos/:id/subdivisao.dxf', h(async (req, res) => {
  const { dxf, nome } = await mapas.dxfSubdivisaoProjeto(id(req.params.id));
  res.setHeader('Content-Type', 'application/dxf; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome.replace(/[^\w.\-]+/g, '_')}"`);
  res.end(dxf);
  return undefined;
}));
router.get('/projetos/:id/subdivisao.svg', h(async (req, res) => {
  const lote = typeof req.query.lote === 'string' && req.query.lote ? req.query.lote : null;
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.end(await mapas.svgSubdivisaoProjeto(id(req.params.id), lote));
  return undefined;
}));
router.get('/projetos/:id/subdivisao.geojson', h(async (req) => visao(await mapas.geojsonSubdivisao(id(req.params.id)), ctx(req).perfil)));
router.get('/projetos/:id/subdivisao/lotes/:lote', h(async (req) => mapas.memorialParcela(id(req.params.id), String(req.params.lote))));
router.get('/projetos/:id/subdivisao.pdf', h(async (req, res) => {
  const q = typeof req.query.lotes === 'string' ? req.query.lotes : '';
  const lotes = q === 'todos' ? null : q.split(',').map((x) => x.trim()).filter(Boolean);
  enviarPdf(res, await mapas.pdfSubdivisao(id(req.params.id), lotes, req.query.geral === '1', req.query.modelo === 'sigef' ? 'sigef' : 'tradicional'));
  return undefined;
}));
router.get('/projetos/:id/mapa-geral.pdf', h(async (req, res) => { enviarPdf(res, await mapas.pdfMapaGeral(id(req.params.id), req.query.modelo === 'sigef' ? 'sigef' : 'tradicional')); return undefined; }));

// ─── Lotes ────────────────────────────────────────────────────────────────
router.get('/projetos/:id/lotes', h(async (req) => {
  const lotes = await repo.listarLotes(id(req.params.id));
  // v3.169.0: funcionário de campo não vê financeiro
  return { lotes: !ctx(req).permissoes.ver_financeiro ? lotes.map((l) => ({ ...l, financeiro: { saldo: 0, situacao: l.associado ? 'EM_DIA' : 'SEM_ASSOCIADO', sinal_status: null } })) : lotes };
}));
router.get('/projetos/:id/lotes/:numero', h(async (req) => {
  const ls = await repo.listarLotes(id(req.params.id));
  const n = String(req.params.numero).padStart(2, '0');
  const l = ls.find((x) => x.numero === n);
  if (!l) throw new PaErro('LOTE_NAO_ENCONTRADO', `Lote ${n} não encontrado`, 404);
  return { lote: l };
}));
router.patch('/projetos/:id/lotes/:numero', h(async (req) => {
  exigirEscrita(req);
  return { lote: await repo.atualizarLote(id(req.params.id), String(req.params.numero).padStart(2, '0'), req.body ?? {}, ctx(req).sub) };
}));

// ─── Associados ───────────────────────────────────────────────────────────
router.get('/projetos/:id/associados', h(async (req) => {
  const lista = await repo.listarAssociados(id(req.params.id), typeof req.query.q === 'string' ? req.query.q : undefined);
  return { associados: visao(lista, ctx(req).perfil) };
}));
router.post('/projetos/:id/associados', h(async (req, res) => {
  exigirEscrita(req);
  const r = await repo.criarAssociado(id(req.params.id), req.body ?? {}, ctx(req).sub);
  res.status(201);
  return r;
}));
router.get('/projetos/:id/associados/:aid', h(async (req) => {
  const d = await repo.detalheAssociado(id(req.params.aid, 'associado'));
  if (d.associado.projeto_id !== id(req.params.id)) throw new PaErro('ASSOCIADO_NAO_ENCONTRADO', 'Associado não pertence ao projeto', 404);
  const perfil = ctx(req).perfil;
  return visao(podeVerDocumentos(perfil) ? d : { ...d, documentos: [] }, perfil);
}));
router.patch('/projetos/:id/associados/:aid', h(async (req) => {
  exigirEscrita(req);
  const aid = id(req.params.aid, 'associado');
  const a = await repo.buscarAssociado(aid);
  if (a.projeto_id !== id(req.params.id)) throw new PaErro('ASSOCIADO_NAO_ENCONTRADO', 'Associado não pertence ao projeto', 404);
  return repo.atualizarAssociado(aid, req.body ?? {}, ctx(req).sub);
}));
router.delete('/projetos/:id/associados/:aid', h(async (req) => {
  exigirAdmin(req);
  const aid = id(req.params.aid, 'associado');
  const a = await repo.buscarAssociado(aid);
  if (a.projeto_id !== id(req.params.id)) throw new PaErro('ASSOCIADO_NAO_ENCONTRADO', 'Associado não pertence ao projeto', 404);
  await repo.desativarAssociado(aid, ctx(req).sub, typeof req.body?.motivo === 'string' ? req.body.motivo.slice(0, 300) : null);
  return { ok: true };
}));
// Regra §5.4 — sinal ≠ padrão: refaz o plano (sinal + boletos).
router.post('/associados/:aid/plano', h(async (req) => {
  exigirEscrita(req);
  return repo.recalcularPlano(id(req.params.aid, 'associado'), req.body?.sinal, ctx(req).sub);
}));

// ─── Documentos ───────────────────────────────────────────────────────────
router.post('/associados/:aid/documentos', uploadMem.array('arquivo', 10), h(async (req, res) => {
  exigirEscrita(req);
  exigirDocumentos(req);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw new PaErro('ARQUIVO_VAZIO', 'Envie ao menos um arquivo no campo "arquivo"', 400);
  const aid = id(req.params.aid, 'associado');
  const enviados = [];
  const falhas = [];
  for (const f of files) {
    try {
      enviados.push(await docs.uploadDocumento(aid, req.body?.tipo, { buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype }, ctx(req).sub));
    } catch (err) {
      if (!(err instanceof PaErro)) throw err;
      falhas.push({ arquivo: f.originalname, erro: err.message, codigo: err.codigo });
    }
  }
  if (!enviados.length && falhas.length) throw new PaErro(falhas[0].codigo, falhas[0].erro, 422, { falhas });
  res.status(201);
  return { documentos: enviados, falhas };
}));
router.get('/documentos/:docId', h(async (req, res) => {
  exigirDocumentos(req);
  const d = await docs.baixarDocumento(id(req.params.docId, 'documento'), ctx(req).sub, req.ip ?? null);
  res.setHeader('Content-Type', d.mime);
  res.setHeader('Content-Length', String(d.conteudo.length));
  res.setHeader('Cache-Control', 'private, no-store');
  const disp = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(d.nome)}`);
  res.end(d.conteudo);
  return undefined;
}));
router.get('/projetos/:id/documentos', h(async (req) => {
  exigirDocumentos(req);
  return { documentos: await docs.listarDocumentosProjeto(id(req.params.id), typeof req.query.tipo === 'string' ? req.query.tipo : null) };
}));

// ─── Financeiro ───────────────────────────────────────────────────────────
// v3.164.0: dividir uma parcela em várias (valores e vencimentos), com boletos novos
router.post('/projetos/:id/lancamentos/:lid/dividir', h(async (req) => {
  exigirEscrita(req);
  const b = req.body ?? {};
  const partes = Array.isArray(b.partes) ? b.partes.map((x: { valor?: unknown; vencimento?: unknown }) => ({ valor: Number(x?.valor), vencimento: String(x?.vencimento ?? '') })) : [];
  return fin.dividirLancamento(id(req.params.id), id(req.params.lid, 'parcela'), partes, { cancelar_boleto: b.cancelar_boleto !== false, emitir_boletos: b.emitir_boletos !== false }, ctx(req).sub);
}));
// v3.162.0: compensar — mover o recebimento para a parcela certa (pagou o boleto do mês errado)
router.post('/projetos/:id/pagamentos/:pid/compensar', h(async (req) => {
  exigirEscrita(req);
  const b = req.body ?? {};
  return fin.compensarPagamento(id(req.params.id), id(req.params.pid, 'pagamento'), id(b.de_lancamento_id, 'parcela de origem'), id(b.para_lancamento_id, 'parcela de destino'), {
    cancelar_boleto: b.cancelar_boleto !== false, emitir_boleto: b.emitir_boleto !== false, avisar: b.avisar === true,
  }, ctx(req).sub);
}));
// v3.161.0: reenviar a confirmação do pagamento (associado + administrador)
router.post('/projetos/:id/pagamentos/:pid/notificar', h(async (req) => {
  exigirEscrita(req);
  const pid = id(req.params.pid, 'pagamento');
  const pg = await fin.buscarPagamento(pid);
  if (pg.projeto_id !== id(req.params.id)) throw new PaErro('PAGAMENTO_NAO_ENCONTRADO', 'Pagamento não encontrado', 404);
  const n = await import('../services/pa/paNotificacoes');
  return { notificacao: await n.notificarPagamento(pid, { forcar: true, usuario: ctx(req).sub }) };
}));
router.post('/projetos/:id/pagamentos/preview', h(async (req) => {
  exigirEscrita(req);
  const url = String(req.body?.url_recibo ?? '');
  if (!url) throw new PaErro('CAMPO_INVALIDO', 'Informe url_recibo', 400);
  return fin.previewRecibo(id(req.params.id), url);
}));
router.post('/projetos/:id/pagamentos', h(async (req, res) => {
  exigirEscrita(req);
  const r = await fin.lancarPagamento(id(req.params.id), fin.lerNovoPagamento(req.body ?? {}), ctx(req).sub);
  res.status(201);
  return r;
}));
router.get('/projetos/:id/pagamentos', h(async (req) => ({
  pagamentos: visao(await fin.listarPagamentos(id(req.params.id), Number(req.query.limite) || 500), ctx(req).perfil),
})));
router.get('/projetos/:id/cobranca', h(async (req, res) => {
  const c = await fin.cobranca(id(req.params.id), typeof req.query.ate === 'string' ? req.query.ate : null);
  if (req.query.formato === 'xlsx') {
    const linhas = c.lista.flatMap((g) => g.itens.map((i) => ({
      Lote: g.lote, 'Nº': g.numero, Associado: g.nome, Telefone: g.telefone ?? '', Lançamento: i.rotulo,
      Vencimento: i.vencimento ? `${i.vencimento.slice(8, 10)}/${i.vencimento.slice(5, 7)}/${i.vencimento.slice(0, 4)}` : '',
      'Valor (R$)': i.valor, 'Recebido (R$)': i.recebido, 'Saldo (R$)': i.saldo, Situação: i.status,
    })));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = [{ wch: 6 }, { wch: 10 }, { wch: 38 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 11 }, { wch: 13 }, { wch: 11 }, { wch: 11 }];
    XLSX.utils.sheet_add_aoa(ws, [[], ['', '', `Total em aberto até ${c.ate}`, '', '', '', '', '', c.total], ['', '', 'Uso interno — Romatec Consultoria Total (LGPD)']], { origin: -1 });
    XLSX.utils.book_append_sheet(wb, ws, 'Cobrança');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="COBRANCA-${c.projeto.codigo}-${c.ate}.xlsx"`);
    res.end(buf);
    return undefined;
  }
  return c;
}));

// ─── v3.148.0: foto do associado e carteirinhas ──────────────────────────
router.get('/associados/:aid/foto', h(async (req, res) => {
  exigirDocumentos(req);
  const f = await carteirinha.fotoAssociado(id(req.params.aid, 'associado'), req.query.tam === 'cart' ? 'cart' : 'mini');
  if (!f) throw new PaErro('SEM_FOTO', 'Associado sem foto 3x4', 404);
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('ETag', `"foto-${f.documento_id}"`);
  res.end(f.jpeg);
  return undefined;
}));
router.get('/projetos/:id/carteirinhas.pdf', h(async (req, res) => {
  exigirDocumentos(req);
  enviarPdf(res, await carteirinha.pdfCarteirinhas(id(req.params.id), carteirinha.lerIds(req.query.ids), ctx(req).sub));
  return undefined;
}));
router.get('/projetos/:id/carteirinhas.html', h(async (req, res) => {
  exigirDocumentos(req);
  const html = await carteirinha.previaCarteirinhas(id(req.params.id), carteirinha.lerIds(req.query.ids));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(html);
  return undefined;
}));

// ─── v3.150.0: participantes do lote e grupo do WhatsApp ──────────────────
router.get('/associados/:aid/participantes', h(async (req) => ({ participantes: visao(await part.listarParticipantes(id(req.params.aid, 'associado')), ctx(req).perfil), vinculos: part.VINCULOS })));
router.post('/associados/:aid/participantes', h(async (req, res) => {
  exigirEscrita(req);
  res.status(201);
  return part.criarParticipante(id(req.params.aid, 'associado'), req.body ?? {}, ctx(req).sub);
}));
router.patch('/participantes/:pid', h(async (req) => { exigirEscrita(req); return part.atualizarParticipante(id(req.params.pid, 'participante'), req.body ?? {}, ctx(req).sub); }));
router.delete('/participantes/:pid', h(async (req) => { exigirEscrita(req); return part.removerParticipante(id(req.params.pid, 'participante'), ctx(req).sub); }));
router.get('/projetos/:id/whatsapp/grupo', h(async (req) => part.situacaoGrupo(id(req.params.id))));
router.get('/whatsapp/grupos', h(async () => {
  const wa = await import('../integrations/whatsapp');
  try { return { grupos: await wa.listarGruposWhatsApp() }; } catch (e) {
    throw new PaErro('ZAPI_INDISPONIVEL', `Não consegui listar os grupos pela Z-API: ${(e as Error).message}`.slice(0, 300), 502);
  }
}));
router.post('/projetos/:id/whatsapp/grupo', h(async (req) => {
  exigirEscrita(req);
  return part.configurarGrupo(id(req.params.id), req.body?.grupo_id ?? null, req.body?.nome ?? null, ctx(req).sub);
}));
router.post('/projetos/:id/whatsapp/grupo/sincronizar', h(async (req) => { exigirEscrita(req); return part.sincronizarGrupo(id(req.params.id), ctx(req).sub); }));
router.post('/whatsapp/grupo/manual', h(async (req) => {
  exigirEscrita(req);
  const b = req.body ?? {};
  const tipo = b.tipo === 'PARTICIPANTE' ? 'PARTICIPANTE' : 'TITULAR';
  const valor = b.valor === 'SIM' || b.valor === 'NAO' ? b.valor : null;
  return part.marcarGrupoManual(tipo, id(b.id), valor, ctx(req).sub);
}));

// ─── v3.149.0: ata da assembleia de aprovação da contratação (padrão INCRA) ─
router.get('/projetos/:id/ata-assembleia.pdf', h(async (req, res) => {
  enviarPdf(res, await ata.pdfAta(id(req.params.id), ata.lerDadosAta(req.query as Record<string, unknown>), ctx(req).sub));
  return undefined;
}));
// v3.182.0: link público do mapa dos lotes (para o grupo dos associados)
// v3.184.0: link do mapa no WhatsApp individual de cada associado (fila com intervalo, como a pesquisa)
async function destinatariosMapa(pid: number) {
  const r = await rows(pool, `SELECT a.id, a.nome, a.parcela, a.denominacao_terra, a.telefone_e164, a.whatsapp_status,
      EXISTS(SELECT 1 FROM pa_eventos e WHERE e.associado_id = a.id AND e.tipo = 'MAPA_PUBLICO_ENVIADO') AS enviado
    FROM pa_associados a WHERE a.projeto_id = ? AND a.ativo = 1 ORDER BY CAST(a.parcela AS UNSIGNED), a.nome`, [pid]);
  return r.map((x) => ({ id: Number(x.id), nome: String(x.nome), lote: x.parcela ? String(x.parcela) : null, chacara: x.denominacao_terra ? String(x.denominacao_terra) : null,
    whatsapp: x.whatsapp_status === 'VALIDO' || !!x.telefone_e164, enviado: Number(x.enviado) === 1 }));
}
router.get('/projetos/:id/mapa-publico/envio', h(async (req) => {
  const d = await destinatariosMapa(id(req.params.id));
  return { total: d.length, com_whatsapp: d.filter((x) => x.whatsapp).length, enviados: d.filter((x) => x.enviado).length, pendentes: d.filter((x) => x.whatsapp && !x.enviado).length };
}));
router.post('/projetos/:id/mapa-publico/enviar', h(async (req) => {
  exigirEscrita(req);
  const pid = id(req.params.id);
  const p = await repo.buscarProjeto(pid);
  const link = linkMapaPublico(pid);
  const alvo = (await destinatariosMapa(pid)).filter((a) => a.whatsapp && (!a.enviado || req.body?.reenviar === true));
  const usuario = ctx(req).sub;
  const por = new Map(alvo.map((a) => [a.id, a]));
  return { fila: waPa.iniciarFila(pid, alvo.map((a) => ({ associado_id: a.id, nome: a.nome, lancamento_ids: [a.id] })), usuario, async (it) => {
    const a = por.get(it.associado_id)!;
    await waPa.enviarWhatsAppAssociado(a.id, mensagemMapaIndividual(a.nome, a.lote, a.chacara, p.nome, link), 'MAPA_PUBLICO', usuario);
    await registrarEvento(pool, { projeto_id: pid, associado_id: a.id, usuario, tipo: 'MAPA_PUBLICO_ENVIADO', dados: { link } });
  }) };
}));
router.get('/projetos/:id/mapa-publico', h(async (req) => { const pid = id(req.params.id); const p = await repo.buscarProjeto(pid); const link = linkMapaPublico(pid); return { link, texto: textoMapaPublico(p.nome, link) }; }));
// v3.181.0: pesquisa de satisfação — resultado, link pessoal e envio pelo WhatsApp (só quem não respondeu)
router.get('/projetos/:id/pesquisa', h(async (req) => pesquisa.resultadoPesquisa(id(req.params.id))));
// v3.193.0: link geral da pesquisa (para o grupo) — cada um escolhe o próprio nome/lote
router.get('/projetos/:id/pesquisa/link-grupo', h(async (req) => { const p = await repo.buscarProjeto(id(req.params.id)); const link = pesquisa.linkGrupoPesquisa(p.id); return { link, mensagem: pesquisa.mensagemGrupoPesquisa(p.nome, link), texto: pesquisa.mensagemGrupoPesquisa(p.nome, link) }; }));
router.get('/projetos/:id/pesquisa/link/:aid', h(async (req) => { const aid = id(req.params.aid, 'associado'); const a = await repo.buscarAssociado(aid); const link = pesquisa.linkPesquisa(aid); const mensagem = pesquisa.mensagemPesquisa(String((a as { nome?: string }).nome ?? ''), link); return { link, mensagem, texto: mensagem }; }));
router.post('/projetos/:id/pesquisa/enviar', h(async (req) => {
  exigirEscrita(req);
  const pid = id(req.params.id);
  const r = await pesquisa.resultadoPesquisa(pid);
  const pedidos = Array.isArray(req.body?.associado_ids) ? new Set((req.body.associado_ids as unknown[]).map(Number)) : null;
  const alvo = r.associados.filter((a) => a.nota == null && a.whatsapp && (pedidos ? pedidos.has(a.id) : !a.enviado || req.body?.reenviar === true));
  const usuario = ctx(req).sub;
  if (alvo.length === 1 && pedidos) { // um só: envia na hora
    const a = alvo[0];
    const res = await waPa.enviarWhatsAppAssociado(a.id, pesquisa.mensagemPesquisa(a.nome, pesquisa.linkPesquisa(a.id)), 'PESQUISA', usuario, req.body?.numero);
    await pesquisa.marcarEnviada(pid, a.id, usuario);
    return { enviados: 1, resultado: res };
  }
  return { fila: waPa.iniciarFila(pid, alvo.map((a) => ({ associado_id: a.id, nome: a.nome, lancamento_ids: [a.id] })), usuario, async (it) => {
    await waPa.enviarWhatsAppAssociado(it.associado_id, pesquisa.mensagemPesquisa(it.nome, pesquisa.linkPesquisa(it.associado_id)), 'PESQUISA', usuario);
    await pesquisa.marcarEnviada(pid, it.associado_id, usuario);
  }) };
}));
// v3.176.0: termo de concessão de uso do lote (titular → outra pessoa, ou o inverso)
router.get('/projetos/:id/concessao/lotes', h(async (req) => { exigirEscrita(req); exigirDocumentos(req); return concessao.opcoesConcessao(id(req.params.id)); }));
router.post('/projetos/:id/concessao.pdf', h(async (req, res) => {
  exigirEscrita(req); exigirDocumentos(req);
  enviarPdf(res, await concessao.pdfConcessao(id(req.params.id), req.body ?? {}, ctx(req).sub));
  return undefined;
}));
// v3.168.0: taxa de marcos de concreto — um boleto por associado, gerar e enviar com um clique
router.get('/projetos/:id/marcos', h(async (req) => ({ valor_padrao: marcos.VALOR_MARCO_PADRAO, associados: visao(await marcos.situacaoMarcos(id(req.params.id)), ctx(req).perfil), job: marcos.estadoJob(), fila: waPa.estadoFila() })));
router.post('/projetos/:id/marcos/:aid/enviar', h(async (req) => { exigirEscrita(req); return marcos.enviarUm(id(req.params.id), id(req.params.aid, 'associado'), ctx(req).sub, req.body?.numero); }));
router.post('/projetos/:id/marcos/gerar', h(async (req) => {
  exigirEscrita(req);
  const b = req.body ?? {};
  const aids = Array.isArray(b.associado_ids) ? b.associado_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : null;
  return { job: await marcos.gerarTaxaMarcos(id(req.params.id), { valor: Number(b.valor ?? marcos.VALOR_MARCO_PADRAO), vencimento: String(b.vencimento ?? ''), associado_ids: aids && aids.length ? aids : null, enviar: b.enviar !== false }, ctx(req).sub) };
}));
// ─── v3.169.0: Equipe do PA (cadastro + login pelo WhatsApp + permissões) ─
router.get('/equipe', h(async (req) => { exigirAdmin(req); return { equipe: await equipe.listarEquipe(), perfis: equipe.PERFIS_EQUIPE, catalogo: equipe.CATALOGO_PERMISSOES, padroes: equipe.PADRAO_POR_PERFIL }; }));
router.get('/equipe/:uid/acessos', h(async (req) => { exigirAdmin(req); return equipe.historicoAcessos(id(req.params.uid, 'usuário')); }));
router.post('/equipe', h(async (req, res) => { exigirAdmin(req); res.status(201); return equipe.cadastrarMembro(req.body ?? {}, ctx(req).sub); }));
router.post('/equipe/:uid/reenviar', h(async (req) => { exigirAdmin(req); return equipe.reenviarAcesso(id(req.params.uid, 'usuário'), ctx(req).sub); }));
router.post('/equipe/:uid/ativo', h(async (req) => { exigirAdmin(req); return equipe.ativarMembro(id(req.params.uid, 'usuário'), req.body?.ativo === true, ctx(req).sub); }));
router.patch('/equipe/:uid', h(async (req) => { exigirAdmin(req); return equipe.atualizarMembro(id(req.params.uid, 'usuário'), req.body ?? {}, ctx(req).sub); }));

// ─── v3.169.0: produção de campo (marcar marco locado; lote fecha sozinho) ─
const usuarioCampo = (req: Request) => ({ id: ctx(req).sub, nome: ctx(req).nome });
router.get('/projetos/:id/campo', h(async (req) => campo.estadoCampo(id(req.params.id))));
// (funcionário de campo não gera o boletim: bloqueado em equipe.rotaPaPermitidaCampo, no contexto acima)
// v3.172.0: boletim de campo (PDF A4 com mapa temático, evolução diária e fila) + texto para o grupo do PA
router.get('/projetos/:id/campo/boletim.pdf', h(async (req, res) => { enviarPdf(res, await boletim.pdfBoletimCampo(id(req.params.id), baseValida(req.query.base))); return undefined; }));
router.get('/projetos/:id/campo/boletim', h(async (req) => boletim.textoBoletimCampo(id(req.params.id))));
// v3.177.0: programação diária (lotes do dia) e confirmação no fim do dia — texto + PDF com mapa para o grupo
router.get('/projetos/:id/campo/programacao', h(async (req) => programacao.buscarProgramacao(id(req.params.id), req.query.dia)));
router.put('/projetos/:id/campo/programacao', h(async (req) => { exigirEscrita(req); return programacao.salvarProgramacao(id(req.params.id), req.body?.dia, req.body?.lotes, ctx(req).sub); }));
router.put('/projetos/:id/campo/programacao/automatico', h(async (req) => { exigirAdmin(req); return programacao.definirAgendaAutomatica(id(req.params.id), req.body?.ligado, ctx(req).sub); })); // v3.190.0
router.post('/projetos/:id/campo/programacao/relocar', h(async (req) => { exigirAdmin(req); return programacao.relocarProgramacao(id(req.params.id), req.body?.dia, ctx(req).sub); })); // v3.189.0
// v3.191.0: relatório do dia de campo (abre às 16 h, fecha às 21 h) — PDF único + texto para o grupo
// v3.191.1: o endereço termina com o nome do arquivo (visualizador do navegador / Acrobat salvam com esse nome)
router.get('/projetos/:id/campo/relatorio.pdf', h(async (req, res) => {
  const p = await repo.buscarProjeto(id(req.params.id));
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dia ?? '')) ? String(req.query.dia) : hojeBrasil();
  const qs = new URLSearchParams({ dia, base: String(baseValida(req.query.base)) }).toString();
  res.redirect(302, `${req.baseUrl}/projetos/${p.id}/campo/relatorio/${encodeURIComponent(relatorioCampo.nomeArq(p.codigo, dia))}?${qs}`);
  return undefined;
}));
router.get('/projetos/:id/campo/relatorio/:arquivo([\\w.\\-]+\\.pdf)', h(async (req, res) => { enviarPdf(res, await relatorioCampo.pdfRelatorioDia(id(req.params.id), req.query.dia, baseValida(req.query.base))); return undefined; }));
router.get('/projetos/:id/campo/relatorio/texto', h(async (req) => relatorioCampo.textoRelatorioDia(id(req.params.id), req.query.dia)));
router.get('/projetos/:id/campo/programacao.pdf', h(async (req, res) => { enviarPdf(res, await programacao.pdfDia(id(req.params.id), req.query.tipo, req.query.dia, baseValida(req.query.base))); return undefined; }));
router.get('/projetos/:id/campo/programacao/texto', h(async (req) => programacao.textoDia(id(req.params.id), req.query.tipo, req.query.dia)));
// v3.188.4: checklist do lote — marca vários vértices de uma vez e fecha a poligonal
router.post('/projetos/:id/campo/pontos/lote', h(async (req) => {
  const p = ctx(req).perfil;
  if (p === 'DIRECAO_ASSOCIACAO' || !(p === 'ADMIN' || ctx(req).permissoes.marcar_campo)) throw new PaErro('SEM_PERMISSAO', 'Sem permissão para marcar pontos', 403);
  const b = req.body ?? {};
  return campo.marcarPontos(id(req.params.id), b.pontos, { obs: b.obs, base: b.base, rover: b.rover }, usuarioCampo(req));
}));
router.post('/projetos/:id/campo/pontos', h(async (req) => {
  const p = ctx(req).perfil;
  if (p === 'DIRECAO_ASSOCIACAO' || !(p === 'ADMIN' || ctx(req).permissoes.marcar_campo)) throw new PaErro('SEM_PERMISSAO', 'Sem permissão para marcar pontos', 403);
  const b = req.body ?? {};
  return campo.marcarPonto(id(req.params.id), String(b.ponto ?? '').slice(0, 40), { gps: b.gps ?? null, obs: b.obs, base: b.base, rover: b.rover }, usuarioCampo(req));
}));
router.post('/projetos/:id/campo/lotes/:lote/aviso', h(async (req) => { exigirAdmin(req); return campo.avisarLoteDemarcado(id(req.params.id), String(req.params.lote).slice(0, 10), true); })); // v3.188.5
router.post('/projetos/:id/campo/lotes/:lote/bloqueio', h(async (req) => { exigirAdmin(req); return campo.bloquearLote(id(req.params.id), req.params.lote, req.body?.bloquear, req.body?.motivo, usuarioCampo(req)); })); // v3.194.0
router.post('/projetos/:id/campo/lotes/:lote/reabrir', h(async (req) => { exigirAdmin(req); return campo.reabrirLote(id(req.params.id), String(req.params.lote).slice(0, 10), usuarioCampo(req)); })); // v3.188.2
router.delete('/projetos/:id/campo/pontos/:ponto', h(async (req) => {
  const p = ctx(req).perfil;
  if (p === 'DIRECAO_ASSOCIACAO') throw new PaErro('SEM_PERMISSAO', 'Perfil somente leitura', 403);
  return campo.desmarcarPonto(id(req.params.id), String(req.params.ponto).slice(0, 40), usuarioCampo(req), p === 'ADMIN');
}));
// ─── v3.169.0: dossiês de pronta entrega ─
router.get('/projetos/:id/dossies', h(async (req) => { exigirEscrita(req); return { dossies: visao(await dossie.listarDossies(id(req.params.id)), ctx(req).perfil) }; }));
router.get('/projetos/:id/dossies/:lote.pdf', h(async (req, res) => { exigirEscrita(req); const r = await dossie.pdfDossie(id(req.params.id), String(req.params.lote).slice(0, 10)); enviarPdf(res, r); return undefined; }));
// v3.193.0: KML do lote (Organic Maps) — baixar, enviar a um associado, reenviar aos já finalizados
router.get('/projetos/:id/dossies/:lote/lote.kml', h(async (req, res) => {
  const k = await kmlLote.kmlLote(id(req.params.id), String(req.params.lote).slice(0, 10));
  res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${k.nome}"`); res.end(k.kml);
  return undefined;
}));
router.post('/projetos/:id/dossies/kml/reenviar', h(async (req) => { exigirAdmin(req); return kmlLote.reenviarKmlFinalizados(id(req.params.id), ctx(req).sub); }));
router.post('/projetos/:id/dossies/:lote/kml', h(async (req) => {
  exigirAdmin(req);
  const pid = id(req.params.id), lote = String(req.params.lote).slice(0, 10);
  const d = (await dossie.listarDossies(pid)).find((x) => x.lote === lote);
  if (!d) throw new PaErro('DOSSIE_NAO_ENCONTRADO', 'Dossiê não encontrado', 404);
  if (!d.whatsapp_valido) throw new PaErro('SEM_WHATSAPP', 'Associado sem WhatsApp válido', 409);
  const a = await rows(pool, 'SELECT whatsapp_numero FROM pa_associados WHERE id = ?', [d.associado_id]);
  return kmlLote.enviarKmlLote(pid, lote, String(a[0]?.whatsapp_numero ?? ''), d.nome, ctx(req).sub);
}));
router.post('/projetos/:id/dossies/:lote/gerar', h(async (req) => { exigirAdmin(req); return dossie.criarDossie(id(req.params.id), String(req.params.lote).slice(0, 10), ctx(req).sub); }));
router.post('/projetos/:id/dossies/kml', h(async (req) => {
  exigirAdmin(req);
  const lotes = Array.isArray(req.body?.lotes) ? req.body.lotes.map((x: unknown) => String(x).slice(0, 10)) : null;
  return { fila: await dossie.enviarKmlDosEnviados(id(req.params.id), lotes && lotes.length ? lotes : null, ctx(req).sub) };
}));
router.post('/projetos/:id/dossies/:lote/enviar', h(async (req) => { exigirAdmin(req); return dossie.enviarDossie(id(req.params.id), String(req.params.lote).slice(0, 10), ctx(req).sub); }));
router.post('/projetos/:id/dossies/:lote/trt', h(async (req) => { exigirEscrita(req); return dossie.registrarTrt(id(req.params.id), String(req.params.lote).slice(0, 10), req.body?.acao, req.body?.numero, ctx(req).sub, ctx(req).nome); })); // v3.170.0
router.post('/projetos/:id/dossies/:lote/entregue', h(async (req) => { exigirEscrita(req); return dossie.marcarEntregue(id(req.params.id), String(req.params.lote).slice(0, 10), req.body?.obs, ctx(req).sub, ctx(req).nome); }));
// v3.188.0: lotes de produção (LT-NN) + capa do dossiê técnico do lote
router.get('/projetos/:id/lotes-producao', h(async (req) => ({ lotes: await lotesProd.listarLotesProducao(id(req.params.id)) })));
router.get('/projetos/:id/lotes-producao/:codigo', h(async (req) => ({ lote: await lotesProd.buscarLoteProducao(id(req.params.id), req.params.codigo) })));
router.get('/projetos/:id/lotes-producao/:codigo/capa.pdf', h(async (req, res) => { enviarPdf(res, await lotesProd.pdfCapaLote(id(req.params.id), req.params.codigo)); return undefined; }));
router.post('/projetos/:id/lotes-producao', h(async (req, res) => { exigirEscrita(req); res.status(201); return { lote: await lotesProd.salvarLoteProducao(id(req.params.id), req.body?.codigo, req.body ?? {}, ctx(req).sub, true) }; }));
router.patch('/projetos/:id/lotes-producao/:codigo', h(async (req) => { exigirEscrita(req); return { lote: await lotesProd.salvarLoteProducao(id(req.params.id), req.params.codigo, req.body ?? {}, ctx(req).sub, false) }; }));
router.post('/lotes-producao/:lid/gerar/capa', h(async (req, res) => { exigirEscrita(req); res.status(201); return lotesProd.gerarCapaLote(id(req.params.lid), ctx(req).sub); }));
router.post('/projetos/:id/gerar/capas-dossie', h(async (req, res) => {
  exigirEscrita(req);
  const pid = id(req.params.id);
  const p = await repo.buscarProjeto(pid);
  // valida antes de abrir o ZIP (sem lote → 404 em JSON)
  if (!(await lotesProd.listarLotesProducao(pid)).some((l) => l.associado_id)) throw new PaErro('SEM_LOTES', 'Nenhum lote com associado para gerar capa', 404);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="Capas_Dossie_${p.codigo}.zip"`);
  await lotesProd.zipCapasDossie(pid, req.body?.codigos, res, ctx(req).sub);
  return undefined;
}));

// v3.169.0: planilha oficial de marcos (QUANTITATIVO-MARCOS-POR-LOTE) → códigos M-001… na coletora/caderneta/campo
router.post('/projetos/:id/marcos-planilha', uploadMem.single('arquivo'), h(async (req) => {
  exigirAdmin(req);
  const f = (req as Request & { file?: { buffer: Buffer } }).file;
  if (!f) throw new PaErro('CAMPO_INVALIDO', 'Envie a planilha (XLSX)', 400);
  return coletora.salvarMarcos(id(req.params.id), f.buffer, ctx(req).sub);
}));

// v3.168.0: pontos para a coletora (CSV, TXT P,E,N,Z,D, DXF) e caderneta de campo (PDF)
router.get('/projetos/:id/coletora.:fmt(csv|txt|dxf|kml)', h(async (req, res) => {
  const r = await coletora.arquivoColetora(id(req.params.id), req.params.fmt as 'csv' | 'txt' | 'dxf' | 'kml');
  res.setHeader('Content-Type', r.tipo);
  res.setHeader('Content-Disposition', `attachment; filename="${r.nome}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(r.conteudo);
  return undefined;
}));
router.get('/projetos/:id/caderneta-campo.pdf', h(async (req, res) => { enviarPdf(res, await coletora.pdfCaderneta(id(req.params.id))); return undefined; }));
// v3.156.0: relação de associados por lote rural (para a diretoria conferir)
router.get('/projetos/:id/relacao-lotes.pdf', h(async (req, res) => {
  enviarPdf(res, await relacao.pdfRelacaoLotes(id(req.params.id), ctx(req).sub));
  return undefined;
}));
router.get('/projetos/:id/ata-assembleia.docx', h(async (req, res) => {
  const r = await ata.docxAta(id(req.params.id), ata.lerDadosAta(req.query as Record<string, unknown>), ctx(req).sub);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${r.nome}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(r.docx);
  return undefined;
}));

// ─── v3.147.0: extrato por associado e fluxo de caixa ─────────────────────
function enviarXlsx(res: Response, nome: string, abas: Array<{ nome: string; linhas: Record<string, unknown>[]; cols?: number[]; rodape?: unknown[][] }>) {
  const wb = XLSX.utils.book_new();
  for (const a of abas) {
    const ws = XLSX.utils.json_to_sheet(a.linhas.length ? a.linhas : [{ '': 'Sem dados no período' }]);
    if (a.cols) ws['!cols'] = a.cols.map((wch) => ({ wch }));
    XLSX.utils.sheet_add_aoa(ws, [[], ...(a.rodape ?? []), ['Uso interno — Romatec Consultoria Total (LGPD)']], { origin: -1 });
    XLSX.utils.book_append_sheet(wb, ws, a.nome.slice(0, 31));
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.end(buf);
}
const dBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const SITUACAO_TXT: Record<string, string> = { QUITADO: 'Quitado', EM_DIA: 'Em dia', EM_ATRASO: 'Em atraso', SEM_PLANO: 'Sem plano' };

// v3.165.0: extrato em PDF (mesmo filtro da tela) e envio pelo WhatsApp do sistema
const filtroExtrato = (q: Record<string, unknown>) => ({
  busca: typeof q.busca === 'string' ? q.busca.slice(0, 80) : null,
  sit: typeof q.sit === 'string' && /^[A-Z_]{0,20}$/.test(q.sit) ? q.sit : null,
  ordem: typeof q.ordem === 'string' && /^[a-z]{0,12}$/.test(q.ordem) ? q.ordem : null,
});
router.get('/projetos/:id/extrato.pdf', h(async (req, res) => {
  const { pdf, nome } = await mapas.pdfExtrato(id(req.params.id), filtroExtrato(req.query as Record<string, unknown>));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
  res.end(pdf);
  return undefined;
}));
router.post('/projetos/:id/extrato/whatsapp', h(async (req) => {
  exigirEscrita(req);
  const b = req.body ?? {};
  const numero = typeof b.numero === 'string' && b.numero.replace(/\D/g, '').length >= 10 ? b.numero : null;
  return mapas.enviarExtratoWhatsApp(id(req.params.id), filtroExtrato(b), numero, ctx(req).sub);
}));
router.get('/projetos/:id/extrato', h(async (req, res) => {
  const e = await caixa.extratoAssociados(id(req.params.id));
  if (req.query.formato === 'xlsx') {
    enviarXlsx(res, `EXTRATO-ASSOCIADOS-${e.projeto.codigo}-${e.posicao_em}.xlsx`, [
      {
        nome: 'Por associado', cols: [6, 38, 14, 18, 14, 14, 16, 80, 26, 14, 14, 8, 12, 14],
        linhas: e.lista.map((x) => ({
          Lote: x.lote, Associado: x.nome, 'Contratado (R$)': x.contratado,
          Sinal: x.sinal ? (x.sinal.estado === 'PAGO' ? 'Pago' : x.sinal.estado === 'PARCIAL' ? `Parcial (falta ${x.sinal.falta.toFixed(2).replace('.', ',')})` : 'Pendente') : '—',
          'Recebido (R$)': x.recebido, 'Em aberto (R$)': x.em_aberto, Divisão: x.divisao,
          Vencimentos: x.boletos.map((b) => `P${b.parcela} ${dBr(b.vencimento)} ${b.valor.toFixed(2).replace('.', ',')}${b.falta <= 0 ? ' pago' : b.recebido > 0 ? ` (falta ${b.falta.toFixed(2).replace('.', ',')})` : ''}${b.falta > 0 ? (b.boleto ? (b.boleto.enviado_em ? ` [enviado ${dBr(b.boleto.enviado_em.slice(0, 10))}]` : ' [gerado, não enviado]') : ' [sem boleto]') : ''}`).join(' | '),
          Envio: x.envio.em_aberto ? `${x.envio.gerados}/${x.envio.em_aberto} gerados · ${x.envio.enviados}/${x.envio.gerados} enviados` : '—',
          'Vencido (R$)': x.vencido, 'A vencer (R$)': x.a_vencer, '% pago': x.pct_pago, Situação: SITUACAO_TXT[x.situacao], 'Último pagamento': dBr(x.ultimo_pagamento),
        })),
        rodape: [['', 'TOTAL', e.totais.contratado, '', e.totais.recebido, e.totais.em_aberto, '', '', '', e.totais.vencido, e.totais.a_vencer]],
      },
      {
        nome: 'Parcelas', cols: [6, 38, 12, 12, 13, 13, 12, 12],
        linhas: e.lista.flatMap((x) => x.parcelas.map((p) => ({
          Lote: x.lote, Associado: x.nome, Lançamento: p.rotulo, Vencimento: dBr(p.vencimento),
          'Valor (R$)': p.valor, 'Recebido (R$)': p.recebido, 'Saldo (R$)': p.saldo, Situação: p.status,
        }))),
      },
    ]);
    return undefined;
  }
  return { ...e, lista: visao(e.lista, ctx(req).perfil) };
}));
router.get('/projetos/:id/caixa', h(async (req, res) => {
  const q = (k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : null);
  const f = await caixa.fluxoCaixa(id(req.params.id), q('de'), q('ate'), q('agrupar') === 'dia' ? 'dia' : 'mes');
  if (req.query.formato === 'xlsx') {
    enviarXlsx(res, `FLUXO-CAIXA-${f.projeto.codigo}-${f.de}-a-${f.ate}.xlsx`, [
      {
        nome: 'Fluxo', cols: [12, 18, 16, 14, 14, 16],
        linhas: f.periodos.map((p) => ({
          Período: p.periodo.length === 7 ? `${p.periodo.slice(5)}/${p.periodo.slice(0, 4)}` : dBr(p.periodo),
          'Entradas associados (R$)': p.entradas_associados, 'Entradas avulsas (R$)': p.entradas_avulsas, 'Saídas (R$)': p.saidas,
          'Saldo do período (R$)': p.saldo_periodo, 'Saldo acumulado (R$)': p.saldo_acumulado,
        })),
        rodape: [['Saldo inicial', f.saldo_inicial], ['Entradas', f.totais.entradas], ['Saídas', f.totais.saidas], ['Saldo final', f.totais.saldo_final]],
      },
      {
        nome: 'Extrato', cols: [11, 9, 22, 50, 14, 13, 14],
        linhas: f.extrato.map((m) => ({
          Data: dBr(m.data), Tipo: m.tipo === 'SAIDA' ? 'Saída' : 'Entrada', Categoria: m.categoria, Descrição: m.descricao,
          Forma: (m.forma ?? '').replace(/_/g, ' '), 'Valor (R$)': m.tipo === 'SAIDA' ? -m.valor : m.valor, 'Saldo (R$)': m.saldo,
        })),
      },
    ]);
    return undefined;
  }
  return f;
}));
router.get('/caixa/categorias', h(async () => ({ saida: caixa.CATEGORIAS_SAIDA, entrada: caixa.CATEGORIAS_ENTRADA })));
router.post('/projetos/:id/caixa', h(async (req, res) => {
  exigirEscrita(req);
  res.status(201);
  return { movimento: await caixa.lancarMovimento(id(req.params.id), req.body ?? {}, ctx(req).sub) };
}));
router.delete('/caixa/:mid', h(async (req) => { exigirEscrita(req); return caixa.excluirMovimento(id(req.params.mid, 'movimento'), ctx(req).sub); }));

// ─── v3.143.0: Boletos (Asaas) ────────────────────────────────────────────
router.get('/asaas/status', h(async () => boletos.statusAsaas()));
router.get('/projetos/:id/boletos', h(async (req) => ({
  boletos: await boletos.listarBoletos(id(req.params.id), typeof req.query.status === 'string' ? req.query.status : null),
})));
router.get('/projetos/:id/boletos/elegiveis', h(async (req) => {
  const tipos = typeof req.query.tipos === 'string' ? req.query.tipos.split(',').map((t) => t.trim().toUpperCase()) : ['BOLETO'];
  return { lancamentos: await boletos.elegiveisParaBoleto(id(req.params.id), typeof req.query.ate === 'string' ? req.query.ate : null, tipos) };
}));
router.post('/lancamentos/:lid/boleto', h(async (req, res) => {
  exigirEscrita(req);
  const b = await boletos.emitirBoleto(id(req.params.lid, 'lançamento'), ctx(req).sub);
  res.status(201);
  return { boleto: b };
}));
router.get('/associados/:aid/boletos', h(async (req) => ({ boletos: await boletos.boletosDoAssociado(id(req.params.aid, 'associado')) })));
// v3.144.5: consulta o Asaas e dá baixa no que já foi pago (independe do webhook).
router.post('/projetos/:id/boletos/sincronizar', h(async (req) => {
  exigirEscrita(req);
  return boletos.sincronizarBoletos(id(req.params.id), ctx(req).sub);
}));
// v3.144.0: boleto com layout Romatec — modelo Carnê (escolhido pelo CEO em 13/10/2026).
router.get('/boletos/:bid/pdf', h(async (req, res) => {
  const bid = id(req.params.bid, 'boleto');
  await boletoPdf.garantirToken(bid);
  const { pdf, nome } = await boletoPdf.gerarPdfBoleto(bid, 'carne');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(pdf);
  return undefined;
}));
router.post('/boletos/:bid/link', h(async (req) => {
  exigirEscrita(req);
  const t = await boletoPdf.garantirToken(id(req.params.bid, 'boleto'));
  return { url_romatec: boletoPdf.urlBoletoRomatec(t) };
}));
// v3.185.0: ajustar boleto em aberto — pago em parte por fora ou novo valor da parcela → cancela e reemite com o saldo
router.post('/boletos/:bid/ajustar', h(async (req) => {
  exigirEscrita(req);
  return ajuste.ajustarBoleto(id(req.params.bid, 'boleto'), ajuste.lerAjuste(req.body ?? {}), ctx(req).sub);
}));
router.delete('/boletos/:bid', h(async (req) => {
  exigirEscrita(req);
  return { boleto: await boletos.cancelarBoleto(id(req.params.bid, 'boleto'), ctx(req).sub) };
}));

// ─── v3.143.0: WhatsApp do sistema (Z-API) ───────────────────────────────
router.get('/whatsapp/status', h(async () => {
  try {
    const s = await (await import('../integrations/whatsapp')).statusInstancia();
    return { conectado: s.connected, celular_conectado: s.smartphoneConnected ?? null };
  } catch (err) {
    return { conectado: false, erro: (err as Error).message.slice(0, 200) };
  }
}));
router.post('/projetos/:id/whatsapp/verificar', h(async (req) => {
  exigirEscrita(req);
  return waPa.verificarWhatsAppsProjeto(id(req.params.id), ctx(req).sub, req.body?.somente_nao_verificados === true);
}));
router.post('/associados/:aid/whatsapp/enviar', h(async (req) => {
  exigirEscrita(req);
  const aid = id(req.params.aid, 'associado');
  const tipo = String(req.body?.tipo || 'COBRANCA').toUpperCase().replace(/[^A-Z_]/g, '').slice(0, 30) || 'COBRANCA';
  const r = await waPa.enviarWhatsAppAssociado(aid, String(req.body?.mensagem ?? ''), tipo, ctx(req).sub);
  const ids = Array.isArray(req.body?.boleto_ids) ? req.body.boleto_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
  for (const b of ids) await boletos.marcarEnviado(b);
  return r;
}));

router.post('/projetos/:id/boletos/zerar-envio', h(async (req) => {
  exigirEscrita(req);
  const ids = Array.isArray(req.body?.lancamento_ids) ? req.body.lancamento_ids.map(Number) : null;
  return boletos.zerarEnviados(id(req.params.id), ids, ctx(req).sub);
}));
// v3.146.1: envio em LOTE pela fila do servidor (devagar, anti-bloqueio).
router.post('/projetos/:id/whatsapp/fila', h(async (req) => {
  exigirEscrita(req);
  const pid = id(req.params.id);
  const itens = (Array.isArray(req.body?.itens) ? req.body.itens : []).map((x: Record<string, unknown>) => ({
    associado_id: Number(x.associado_id), nome: String(x.nome ?? '').slice(0, 160),
    lancamento_ids: Array.isArray(x.lancamento_ids) ? (x.lancamento_ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
  })).filter((x: { associado_id: number }) => Number.isInteger(x.associado_id) && x.associado_id > 0);
  const usuario = ctx(req).sub;
  return waPa.iniciarFila(pid, itens, usuario, async (it) => {
    const m = await fin.mensagemParaLancamentos(it.associado_id, it.lancamento_ids);
    await waPa.enviarWhatsAppAssociado(it.associado_id, m.mensagem, 'COBRANCA', usuario);
    for (const b of m.boleto_ids) await boletos.marcarEnviado(b);
  });
}));
router.get('/whatsapp/fila', h(async () => ({ fila: waPa.estadoFila(), ritmo: { entre_associados_s: waPa.RITMO.entreAssociadosMs.map((x) => x / 1000) } })));
router.post('/whatsapp/fila/parar', h(async (req) => { exigirEscrita(req); return { fila: waPa.pararFila() }; }));

// v3.145.4: cobrança seletiva — só as parcelas marcadas. previa=true devolve o texto sem enviar.
router.post('/associados/:aid/whatsapp/cobranca', h(async (req) => {
  const aid = id(req.params.aid, 'associado');
  const ids = Array.isArray(req.body?.lancamento_ids) ? req.body.lancamento_ids.map(Number) : [];
  const m = await fin.mensagemParaLancamentos(aid, ids);
  if (req.body?.previa === true) return m;
  exigirEscrita(req);
  const r = await waPa.enviarWhatsAppAssociado(aid, m.mensagem, 'COBRANCA', ctx(req).sub, req.body?.numero);
  for (const b of m.boleto_ids) await boletos.marcarEnviado(b);
  return { ...r, total: m.total, itens: m.itens };
}));

// ─── Importação / exportação ──────────────────────────────────────────────
// seed (JSON) obrigatório; acervo (ZIP) opcional — pode vir depois, num segundo
// envio com o mesmo seed (idempotente: só carrega os arquivos que faltam).
router.post('/importar', uploadDisco.fields([{ name: 'seed', maxCount: 1 }, { name: 'acervo', maxCount: 1 }]), h(async (req) => {
  const arquivos = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};
  const temporarios = [...(arquivos.seed ?? []), ...(arquivos.acervo ?? [])].map((f) => f.path);
  try {
    exigirAdmin(req);
    const seedFile = arquivos.seed?.[0];
    if (!seedFile) throw new PaErro('CAMPO_INVALIDO', 'Envie o seed (JSON) no campo "seed"', 400);
    let seed: SeedJson;
    try {
      seed = JSON.parse(fs.readFileSync(seedFile.path, 'utf8')) as SeedJson;
    } catch {
      throw new PaErro('SEED_INVALIDO', 'Arquivo de seed não é um JSON válido', 400);
    }
    const plano = planejarSeed(seed);
    const acervo = arquivos.acervo?.[0];
    let leitor = null;
    if (acervo) {
      try { leitor = leitorZip(acervo.path); } catch { throw new PaErro('ACERVO_INVALIDO', 'Acervo precisa ser um arquivo ZIP válido', 400); }
    }
    const relatorio = await executarSeed(plano, leitor, ctx(req).sub);
    return { relatorio, contagem: await contagemProjeto(relatorio.projeto_id) };
  } finally {
    for (const p of temporarios) fs.promises.unlink(p).catch(() => undefined);
  }
}));
router.get('/projetos/:id/export', h(async (req, res) => {
  exigirAdmin(req);
  const p = await repo.buscarProjeto(id(req.params.id));
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="ACERVO-${p.codigo}.zip"`);
  await docs.exportarAcervo(p.id, res, ctx(req).sub);
  return undefined;
}));

export default router;
