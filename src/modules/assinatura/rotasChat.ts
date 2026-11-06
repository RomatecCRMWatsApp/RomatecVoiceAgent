// src/modules/assinatura/rotasChat.ts
// v3.152.0 — Rotas /api/assinatura/chat (Claude → ZAYRA), auth própria por
// Bearer ASSINATURA_UPLOAD_TOKEN (escopo restrito: só envia e consulta/baixa
// documentos com origem='claude-chat'; NÃO aprova, NÃO lista a fila geral, NÃO
// lê certificado). Rate limit: chatReqPorMin/min + chatDocsPorHora docs/hora.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express, { type NextFunction, type Request, type Response, Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import type { Pool } from 'mysql2/promise';
import { getBaseUrl } from '../../services/reciboPdf.js';
import { configAssinatura } from './config.js';
import { POSICOES, type PosicaoCarimbo } from './carimbo.js';
import { criarLote, documentoAssinadoChat, statusLotePorId } from './chatLotes.js';
import { notificarAprovacao } from './notificar.js';

class ErroHttp extends Error {
  constructor(public readonly status: number, mensagem: string) {
    super(mensagem);
  }
}

type Handler = (req: Request, res: Response) => Promise<void>;
const rota = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

const ctx = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });
const digest = (s: string) => createHash('sha256').update(s).digest();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Bearer ASSINATURA_UPLOAD_TOKEN; 503 se o token não estiver configurado. */
function autenticarUpload(req: Request, _res: Response, next: NextFunction): void {
  let esperado: string;
  try {
    esperado = configAssinatura.uploadToken;
  } catch {
    next(new ErroHttp(503, 'Envio pelo chat indisponível: ASSINATURA_UPLOAD_TOKEN não configurado'));
    return;
  }
  const cabecalho = req.get('authorization') ?? '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
  if (!token || !timingSafeEqual(digest(token), digest(esperado))) {
    next(new ErroHttp(401, 'Não autorizado'));
    return;
  }
  next();
}

export function criarRotasAssinaturaChat(pool: Pool): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: configAssinatura.tamanhoMaxMB * 1024 * 1024, files: configAssinatura.loteMaxDocs },
  });

  // Limite de docs/hora por token (em memória; 1 token = 1 balde).
  const envios: number[] = [];
  const podeEnviar = (qtd: number): boolean => {
    const agora = Date.now();
    while (envios.length && agora - envios[0] > 3_600_000) envios.shift();
    return envios.length + qtd <= configAssinatura.chatDocsPorHora;
  };
  const registrarEnvios = (qtd: number): void => {
    const t = Date.now();
    for (let i = 0; i < qtd; i++) envios.push(t);
  };

  router.use(
    rateLimit({
      windowMs: 60_000,
      max: configAssinatura.chatReqPorMin,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: () => 'assinatura-chat', // 1 token = 1 balde
      message: { erro: 'Muitas requisições. Tente novamente em instantes.' },
    }),
  );
  router.use(autenticarUpload);

  // POST /documentos — multipart, até loteMaxDocs arquivos no campo "pdf".
  router.post('/documentos', upload.array('pdf', configAssinatura.loteMaxDocs), rota(async (req, res) => {
    const arquivos = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (arquivos.length === 0) throw new ErroHttp(400, 'Envie ao menos um PDF no campo "pdf" (multipart/form-data)');
    if (!podeEnviar(arquivos.length)) {
      throw new ErroHttp(429, `Limite de ${configAssinatura.chatDocsPorHora} documentos/hora atingido`);
    }

    const posicao = (req.body.posicao ?? 'inferior-esquerda') as PosicaoCarimbo;
    if (!POSICOES.includes(posicao)) throw new ErroHttp(400, `"posicao" deve ser: ${POSICOES.join(', ')}`);

    const lote = await criarLote(
      pool,
      {
        tituloLote: String(req.body.titulo_lote ?? req.body.tituloLote ?? 'Lote de assinatura'),
        tipo: String(req.body.tipo ?? 'documento'),
        obra: req.body.obra ? String(req.body.obra) : null,
        motivo: req.body.motivo ? String(req.body.motivo) : undefined,
        posicao,
        arquivos: arquivos.map((f) => ({ pdf: f.buffer, titulo: f.originalname.replace(/\.pdf$/i, '') })),
      },
      ctx(req),
    );
    registrarEnvios(arquivos.length);

    const linkAprovacao = `${getBaseUrl().replace(/\/$/, '')}/assinatura/aprovar/${lote.token}`;
    const notif = await notificarAprovacao({
      tituloLote: lote.documentos.length === 1 ? lote.documentos[0].titulo : `Lote: ${arquivos.length} documento(s)`,
      documentos: lote.documentos,
      linkAprovacao,
      expiraMinutos: configAssinatura.loteExpiraMinutos,
    });

    res.status(201).json({
      loteId: lote.loteId,
      expiraEm: lote.expiraEm,
      documentos: lote.documentos.map((d) => ({ id: d.id, codigo: d.codigo, titulo: d.titulo, hash: d.hash })),
      linkAprovacao,
      notificacao: notif.canal,
    });
  }));

  // GET /lotes/:loteId?aguardar=60 — long-poll até o status sair de "aguardando".
  router.get('/lotes/:loteId', rota(async (req, res) => {
    const aguardar = Math.min(Math.max(Number(req.query.aguardar) || 0, 0), 60);
    const deadline = Date.now() + aguardar * 1000;
    for (;;) {
      const st = await statusLotePorId(pool, String(req.params.loteId));
      if (!st) throw new ErroHttp(404, 'Lote não encontrado');
      if (st.status !== 'aguardando' || Date.now() >= deadline) {
        res.json({ status: st.status, expiraEm: st.expiraEm, documentos: st.documentos });
        return;
      }
      await sleep(2000);
    }
  }));

  // GET /documentos/:id/assinado — PDF assinado (só origem='claude-chat').
  router.get('/documentos/:id/assinado', rota(async (req, res) => {
    const doc = await documentoAssinadoChat(pool, Number(req.params.id));
    if (!doc || !doc.arquivo_assinado) throw new ErroHttp(404, 'Documento assinado não encontrado');
    const pdf = await readFile(doc.arquivo_assinado);
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${doc.codigo}-ASSINADO.pdf"`)
      .send(pdf);
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
    console.error('[assinatura-chat]', msg);
    res.status(500).json({ erro: msg });
  });

  return router;
}
