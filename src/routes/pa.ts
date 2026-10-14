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

const router = Router();
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });
// Acervo pode passar de 100 MB → disco temporário (efêmero no Railway, apagado após o import).
const uploadDisco = multer({ dest: os.tmpdir(), limits: { fileSize: 400 * 1024 * 1024, files: 2 } });

interface Ctx { sub: string | null; perfil: PerfilPa }
type ReqPa = Request & { pa?: Ctx };

async function contexto(req: ReqPa, _res: Response, next: NextFunction) {
  try {
    const u = (req as AuthedRequest).user;
    const sub = u?.sub ? String(u.sub) : null;
    req.pa = { sub, perfil: (await repo.perfilOverride(sub)) ?? perfilPorRole(u?.role) };
    next();
  } catch (err) {
    next(err);
  }
}
router.use(contexto);

function ctx(req: Request): Ctx {
  return (req as ReqPa).pa ?? { sub: null, perfil: 'DIRECAO_ASSOCIACAO' };
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
        if (!res.headersSent) res.status(err.http).json({ erro: err.message, codigo: err.codigo, detalhe: err.detalhe ?? null });
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
router.get('/eu', h(async (req) => ({ perfil: ctx(req).perfil, pode_escrever: podeEscrever(ctx(req).perfil), pode_excluir: podeExcluir(ctx(req).perfil), ve_documentos: podeVerDocumentos(ctx(req).perfil) })));

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
router.get('/projetos/:id/mapa-geral.pdf', h(async (req, res) => { enviarPdf(res, await mapas.pdfMapaGeral(id(req.params.id))); return undefined; }));

// ─── Lotes ────────────────────────────────────────────────────────────────
router.get('/projetos/:id/lotes', h(async (req) => ({ lotes: await repo.listarLotes(id(req.params.id)) })));
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
// v3.145.4: cobrança seletiva — só as parcelas marcadas. previa=true devolve o texto sem enviar.
router.post('/associados/:aid/whatsapp/cobranca', h(async (req) => {
  const aid = id(req.params.aid, 'associado');
  const ids = Array.isArray(req.body?.lancamento_ids) ? req.body.lancamento_ids.map(Number) : [];
  const m = await fin.mensagemParaLancamentos(aid, ids);
  if (req.body?.previa === true) return m;
  exigirEscrita(req);
  const r = await waPa.enviarWhatsAppAssociado(aid, m.mensagem, 'COBRANCA', ctx(req).sub);
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
