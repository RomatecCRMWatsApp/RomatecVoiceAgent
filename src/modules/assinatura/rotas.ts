import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import multer from 'multer';
import type { Pool } from 'mysql2/promise';
import { configAssinatura } from './config.js';
import { POSICOES, type PosicaoCarimbo } from './carimbo.js';
import {
  aprovarEAssinar,
  auditar,
  enfileirarDocumento,
  ErroSenhaCertificado,
  listarDocumentos,
  obterDocumento,
  rejeitar,
  statusCertificado,
  type ContextoRequisicao,
} from './servico.js';

class ErroHttp extends Error {
  constructor(public readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

type Handler = (req: Request, res: Response) => Promise<void>;
const rota = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

const ctx = (req: Request): ContextoRequisicao => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

const digest = (s: string) => createHash('sha256').update(s).digest();
function autenticarRT(req: Request, _res: Response, next: NextFunction): void {
  const cabecalho = req.get('authorization') ?? '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
  if (!token || !timingSafeEqual(digest(token), digest(configAssinatura.tokenRT))) {
    next(new ErroHttp(401, 'Não autorizado'));
    return;
  }
  next();
}

function idsValidos(v: unknown): number[] {
  if (!Array.isArray(v) || v.length === 0) throw new ErroHttp(400, 'Informe "ids" (array de inteiros)');
  const ids = [...new Set(v.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new ErroHttp(400, '"ids" contém valor inválido');
  if (ids.length > configAssinatura.maxDocsPorLote) {
    throw new ErroHttp(400, `Máximo de ${configAssinatura.maxDocsPorLote} documentos por lote`);
  }
  return ids;
}

const nomeArquivo = (titulo: string, sufixo: string) =>
  `${titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(0, 120)}${sufixo}.pdf`;

export function criarRotasAssinatura(pool: Pool): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: configAssinatura.tamanhoMaxMB * 1024 * 1024, files: 1 },
  });
  const bloqueio = { falhas: 0, ate: 0 };

  router.use(express.json({ limit: '1mb' }));
  router.use(autenticarRT);

  router.get('/certificado', rota(async (_req, res) => {
    res.json(await statusCertificado(pool));
  }));

  router.post('/documentos', upload.single('pdf'), rota(async (req, res) => {
    if (!req.file) throw new ErroHttp(400, 'Envie o PDF no campo "pdf" (multipart/form-data)');
    const posicao = (req.body.posicao ?? 'inferior-esquerda') as PosicaoCarimbo;
    if (!POSICOES.includes(posicao)) throw new ErroHttp(400, `"posicao" deve ser: ${POSICOES.join(', ')}`);
    const doc = await enfileirarDocumento(
      pool,
      {
        pdf: req.file.buffer,
        titulo: String(req.body.titulo ?? req.file.originalname.replace(/\.pdf$/i, '')),
        tipo: String(req.body.tipo ?? 'documento'),
        obra: req.body.obra ? String(req.body.obra) : null,
        motivo: req.body.motivo ? String(req.body.motivo) : undefined,
        posicao,
        origem: req.body.origem ? String(req.body.origem) : 'painel',
      },
      ctx(req),
    );
    res.status(201).json({ id: doc.id, codigo: doc.codigo, status: doc.status, hash: doc.hash_original });
  }));

  router.get('/documentos', rota(async (req, res) => {
    const status = String(req.query.status ?? 'pendente');
    if (!['pendente', 'assinado', 'rejeitado', 'erro'].includes(status)) throw new ErroHttp(400, 'status inválido');
    res.json(await listarDocumentos(pool, status, Number(req.query.limite ?? 100)));
  }));

  router.get('/documentos/:id/:versao(original|assinado)', rota(async (req, res) => {
    const doc = await obterDocumento(pool, Number(req.params.id));
    if (!doc) throw new ErroHttp(404, 'Documento não encontrado');
    const assinado = req.params.versao === 'assinado';
    const caminho = assinado ? doc.arquivo_assinado : doc.arquivo_original;
    if (!caminho) throw new ErroHttp(409, 'Documento ainda não assinado');
    const pdf = await readFile(caminho);
    if (!assinado) await auditar(pool, 'visualizado', ctx(req), { documentoId: doc.id, hash: doc.hash_original });
    res
      .type('application/pdf')
      .setHeader(
        'Content-Disposition',
        `${assinado ? 'attachment' : 'inline'}; filename="${nomeArquivo(doc.titulo, assinado ? '-ASSINADO' : '')}"`,
      )
      .send(pdf);
  }));

  router.post('/aprovar', rota(async (req, res) => {
    if (Date.now() < bloqueio.ate) {
      const min = Math.ceil((bloqueio.ate - Date.now()) / 60000);
      throw new ErroHttp(423, `Assinatura bloqueada por tentativas de senha inválidas. Tente em ${min} min`);
    }
    const ids = idsValidos(req.body.ids);
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!senha) throw new ErroHttp(400, 'Informe a senha do certificado');

    try {
      const resultados = await aprovarEAssinar(pool, ids, senha, ctx(req));
      bloqueio.falhas = 0;
      res.json({
        assinados: resultados.filter((r) => r.ok).length,
        falhas: resultados.filter((r) => !r.ok).length,
        resultados,
      });
    } catch (e) {
      if (e instanceof ErroSenhaCertificado) {
        bloqueio.falhas += 1;
        await auditar(pool, 'senha_invalida', ctx(req), { detalhe: `tentativa ${bloqueio.falhas}` });
        if (bloqueio.falhas >= configAssinatura.maxTentativasSenha) {
          bloqueio.ate = Date.now() + configAssinatura.bloqueioMinutos * 60000;
          bloqueio.falhas = 0;
          await auditar(pool, 'bloqueio', ctx(req), { detalhe: `${configAssinatura.bloqueioMinutos} min` });
        }
        throw new ErroHttp(401, 'Senha do certificado incorreta');
      }
      throw e;
    }
  }));

  router.post('/rejeitar', rota(async (req, res) => {
    const ids = idsValidos(req.body.ids);
    const motivo = String(req.body.motivo ?? '').trim();
    if (!motivo) throw new ErroHttp(400, 'Informe o motivo da rejeição');
    res.json({ rejeitados: await rejeitar(pool, ids, motivo, ctx(req)) });
  }));

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ErroHttp) {
      res.status(err.status).json({ erro: err.message });
      return;
    }
    if (err instanceof multer.MulterError) {
      res.status(413).json({ erro: `Upload inválido: ${err.message}` });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[assinatura]', msg);
    res.status(500).json({ erro: msg });
  });

  return router;
}
