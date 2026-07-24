// src/routes/diarioObra.ts
// v3.125.0 — Rotas do módulo "Diário de Obra".
// Prefixo: /api/diarios-obra. Dono = req.user.sub (nunca do body).
//
// Cada entrada = uma visita técnica vinculada a UMA obra, com três campos
// livres (observações / pendências / solicitações do proprietário) + anexos
// (foto / arquivo / desenho) em base64 no MySQL. Inclui /transcrever: transcreve
// áudio SÓ pra texto (reusa o motor da ZAYRA) SEM acionar o assistente.
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import * as repo from '../services/diario/diarioObraRepo';
import * as assinRepo from '../services/diario/diarioAssinaturaRepo';
import { transcribeAudio } from '../agent/transcribe';
import { getBaseUrl } from '../services/reciboPdf';

const router = Router();
// Upload em memória (mesmo padrão da galeria/inventário — Railway sem disco).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 20 } });

function userDe(req: Request): { sub: string | null; role: string | null; equipe_id: number | null; nome: string | null } {
  const u = (req as AuthedRequest).user;
  return {
    sub: u?.sub ? String(u.sub) : null,
    role: u?.role ? String(u.role) : null,
    equipe_id: u?.equipe_id ?? null,
    nome: (u as { nome?: string } | undefined)?.nome ?? null,
  };
}
function intOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}
function txt(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}
function podeEditar(dono: string | null, u: ReturnType<typeof userDe>): boolean {
  if (u.role === 'admin' || u.role === 'owner' || u.role === 'gestor') return true;
  return dono != null && u.sub != null && dono === u.sub;
}
const CAMPOS_VALIDOS: repo.CampoReferencia[] = ['observacoes', 'pendencias', 'solicitacoes_proprietario', 'geral'];
function campoRef(v: unknown): repo.CampoReferencia {
  const s = String(v ?? 'geral') as repo.CampoReferencia;
  return CAMPOS_VALIDOS.includes(s) ? s : 'geral';
}

// Monta os anexos vindos de multipart (arquivos) + desenhos (base64 no body).
function coletarAnexos(req: Request): repo.NovoAnexo[] {
  const anexos: repo.NovoAnexo[] = [];
  const files = ((req as Request & { files?: Array<{ buffer: Buffer; originalname: string; mimetype: string }> }).files) ?? [];
  for (const f of files) {
    const ehImg = /^image\//i.test(f.mimetype || '');
    anexos.push({
      tipo: ehImg ? 'foto' : 'arquivo',
      campo_referencia: 'geral',
      arquivo_b64: f.buffer.toString('base64'),
      nome_original: (f.originalname || '').slice(0, 255) || null,
      mime_type: f.mimetype || 'application/octet-stream',
      tamanho_bytes: f.buffer.length,
    });
  }
  // Desenhos do canvas: JSON no campo `desenhos_json`
  //   [{ base64, campo_referencia, nome? }, ...]
  const raw = req.body?.desenhos_json;
  if (raw) {
    try {
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(arr)) {
        for (const d of arr) {
          const b64 = String(d?.base64 ?? '').replace(/^data:[^,]+,/, '');
          if (!b64) continue;
          anexos.push({
            tipo: 'desenho',
            campo_referencia: campoRef(d?.campo_referencia) === 'geral' ? 'observacoes' : campoRef(d?.campo_referencia),
            arquivo_b64: b64,
            nome_original: (String(d?.nome ?? 'anotacao.png')).slice(0, 255),
            mime_type: 'image/png',
            tamanho_bytes: Math.round(b64.length * 0.75),
          });
        }
      }
    } catch { /* JSON malformado → ignora desenhos */ }
  }
  return anexos;
}

// ── Transcrição pura (ditado por campo — NÃO aciona a ZAYRA) ─────────────────
// Grava áudio via MediaRecorder no front, envia aqui, recebe SÓ o texto.
router.post('/transcrever', requireAuth, upload.single('audio'), async (req: Request, res: Response) => {
  try {
    const f = (req as Request & { file?: { buffer: Buffer; mimetype: string } }).file;
    if (!f || !f.buffer?.length) return res.status(400).json({ error: 'Áudio obrigatório (campo "audio").' });
    const r = await transcribeAudio(f.buffer, f.mimetype);
    res.json({ ok: true, texto: r.text });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Lista (filtros ?obra_id=&data_inicio=&data_fim=) ─────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const diarios = await repo.listarDiarios({
      obra_id: intOrNull(req.query.obra_id),
      data_inicio: req.query.data_inicio ? String(req.query.data_inicio) : null,
      data_fim: req.query.data_fim ? String(req.query.data_fim) : null,
    });
    res.json({ ok: true, diarios });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Detalhe (com anexos) ─────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const diario = await repo.obterDiario(Number(req.params.id));
    if (!diario) return res.status(404).json({ error: 'Entrada não encontrada.' });
    res.json({ ok: true, diario });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Criar (multipart: campos + anexos) ───────────────────────────────────────
router.post('/', requireAuth, upload.array('anexos', 20), async (req: Request, res: Response) => {
  try {
    const u = userDe(req);
    const b = req.body ?? {};
    const obraId = intOrNull(b.obra_id);
    if (!obraId) return res.status(400).json({ error: 'obra_id obrigatório — a entrada precisa estar vinculada a uma obra.' });
    if (!(await repo.obraExiste(obraId))) return res.status(404).json({ error: 'Obra não encontrada.' });

    const observacoes = txt(b.observacoes);
    const pendencias = txt(b.pendencias);
    const solicitacoes = txt(b.solicitacoes_proprietario);
    if (!observacoes && !pendencias && !solicitacoes) {
      return res.status(400).json({ error: 'Preencha ao menos um campo (Observações, Pendências ou Solicitações).' });
    }

    const dataVisita = String(b.data_visita ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataVisita)) return res.status(400).json({ error: 'data_visita (YYYY-MM-DD) obrigatória.' });
    const horaVisita = String(b.hora_visita ?? '').slice(0, 8) || '00:00:00';

    const id = await repo.criarDiario({
      obra_id: obraId,
      user_sub: u.sub,
      colaborador_equipe_id: u.equipe_id,
      colaborador_nome: txt(b.colaborador_nome) ?? u.nome,
      data_visita: dataVisita,
      hora_visita: horaVisita,
      observacoes, pendencias, solicitacoes_proprietario: solicitacoes,
    });

    const anexos = coletarAnexos(req);
    if (anexos.length) await repo.adicionarAnexos(id, anexos);
    res.status(201).json({ ok: true, id, anexos: anexos.length });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Editar campos de texto (dono ou admin/gestor/owner) ──────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const dono = await repo.donoDoDiario(id);
    if (dono === null && !(await repo.obterDiario(id))) return res.status(404).json({ error: 'Entrada não encontrada.' });
    if (!podeEditar(dono, userDe(req))) return res.status(403).json({ error: 'Só o autor do lançamento (ou um admin) pode editar esta entrada.' });

    const b = req.body ?? {};
    // Se todos os 3 campos vierem e todos vazios, barra (mantém a regra de ≥1).
    const temObs = b.observacoes !== undefined, temPend = b.pendencias !== undefined, temSol = b.solicitacoes_proprietario !== undefined;
    if (temObs && temPend && temSol && !txt(b.observacoes) && !txt(b.pendencias) && !txt(b.solicitacoes_proprietario)) {
      return res.status(400).json({ error: 'A entrada precisa manter ao menos um campo preenchido.' });
    }
    await repo.atualizarDiario(id, {
      data_visita: b.data_visita !== undefined ? String(b.data_visita).slice(0, 10) : undefined,
      hora_visita: b.hora_visita !== undefined ? String(b.hora_visita).slice(0, 8) : undefined,
      observacoes: temObs ? txt(b.observacoes) : undefined,
      pendencias: temPend ? txt(b.pendencias) : undefined,
      solicitacoes_proprietario: temSol ? txt(b.solicitacoes_proprietario) : undefined,
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Excluir (dono ou admin/gestor/owner) — anexos em cascata ─────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const dono = await repo.donoDoDiario(id);
    if (dono === null && !(await repo.obterDiario(id))) return res.status(404).json({ error: 'Entrada não encontrada.' });
    if (!podeEditar(dono, userDe(req))) return res.status(403).json({ error: 'Só o autor do lançamento (ou um admin) pode excluir esta entrada.' });
    await repo.excluirDiario(id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Adicionar anexo(s) a uma entrada existente ───────────────────────────────
router.post('/:id/anexos', requireAuth, upload.array('anexos', 20), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const dono = await repo.donoDoDiario(id);
    if (dono === null && !(await repo.obterDiario(id))) return res.status(404).json({ error: 'Entrada não encontrada.' });
    if (!podeEditar(dono, userDe(req))) return res.status(403).json({ error: 'Sem permissão para anexar nesta entrada.' });
    const anexos = coletarAnexos(req);
    if (!anexos.length) return res.status(400).json({ error: 'Nenhum anexo enviado.' });
    const ids = await repo.adicionarAnexos(id, anexos);
    res.status(201).json({ ok: true, ids });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Servir o arquivo de um anexo (foto/arquivo/desenho) ──────────────────────
router.get('/anexos/:anexoId/arquivo', requireAuth, async (req: Request, res: Response) => {
  try {
    const a = await repo.obterAnexoB64(Number(req.params.anexoId));
    if (!a) return res.status(404).json({ error: 'Anexo não encontrado.' });
    const b64 = a.arquivo_b64.replace(/^data:[^,]+,/, '');
    res.setHeader('Content-Type', a.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(a.nome_original || 'anexo').replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(b64, 'base64'));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Remover um anexo específico (dono do diário ou admin) ────────────────────
router.delete('/anexos/:anexoId', requireAuth, async (req: Request, res: Response) => {
  try {
    await repo.excluirAnexo(Number(req.params.anexoId));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ASSINATURA FORMAL (v3.128.0) — proprietário/responsável assina a visita.
// A página pública de verificação vive em /v/diario/:hash (fora da auth).
// ─────────────────────────────────────────────────────────────────────────────
const PAPEIS: assinRepo.PapelSignatario[] = ['proprietario', 'responsavel'];
function papelDe(v: unknown): assinRepo.PapelSignatario {
  return PAPEIS.includes(v as assinRepo.PapelSignatario) ? (v as assinRepo.PapelSignatario) : 'proprietario';
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Lista as assinaturas de uma entrada (metadados, sem a rubrica pesada).
router.get('/:id/assinaturas', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!(await repo.obterDiario(id))) return res.status(404).json({ error: 'Entrada não encontrada.' });
    res.json({ ok: true, assinaturas: await assinRepo.listarAssinaturasDoDiario(id, false) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Coleta uma assinatura. Congela o conteúdo do diário (snapshot) no ato.
router.post('/:id/assinaturas', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const diario = await repo.obterDiario(id);
    if (!diario) return res.status(404).json({ error: 'Entrada não encontrada.' });
    if (!podeEditar(await repo.donoDoDiario(id), userDe(req))) {
      return res.status(403).json({ error: 'Só o autor do lançamento (ou um admin) pode colher assinatura.' });
    }

    const b = req.body ?? {};
    const nome = txt(b.signatario_nome);
    if (!nome) return res.status(400).json({ error: 'Nome do signatário é obrigatório.' });
    const rubrica = String(b.assinatura_b64 ?? '');
    if (!rubrica || assinRepo.apenasBase64(rubrica).length < 100) {
      return res.status(400).json({ error: 'Assinatura (rubrica) é obrigatória — desenhe no campo de assinatura.' });
    }

    const snapshot: assinRepo.SnapshotDiario = {
      diario_id: id,
      obra_id: diario.obra_id ?? null,
      obra_nome: diario.obra_nome ?? null,
      data_visita: diario.data_visita,
      hora_visita: diario.hora_visita,
      observacoes: diario.observacoes ?? null,
      pendencias: diario.pendencias ?? null,
      solicitacoes_proprietario: diario.solicitacoes_proprietario ?? null,
    };

    const ip = (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.ip || null;
    const criada = await assinRepo.criarAssinatura({
      diario_id: id,
      obra_id: diario.obra_id ?? null,
      signatario_nome: nome,
      signatario_cpf: txt(b.signatario_cpf),
      signatario_papel: papelDe(b.signatario_papel),
      assinatura_b64: rubrica,
      snapshot,
      latitude: numOrNull(b.latitude),
      longitude: numOrNull(b.longitude),
      local_texto: txt(b.local_texto),
      ip,
      user_agent: (req.get('user-agent') || '').slice(0, 255) || null,
      criado_por: userDe(req).sub,
    });

    const linkPublico = `${getBaseUrl()}/v/diario/${criada.hash}`;
    res.status(201).json({ ok: true, id: criada.id, hash: criada.hash, assinado_em: criada.assinado_em, link_publico: linkPublico });
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/Duplicate|ER_DUP_ENTRY/i.test(msg)) {
      return res.status(409).json({ error: 'Esta assinatura já foi registrada.' });
    }
    res.status(500).json({ error: msg });
  }
});

// Anula uma assinatura (dono do diário ou admin) — mantém a linha, marca status.
router.post('/assinaturas/:assinaturaId/anular', requireAuth, async (req: Request, res: Response) => {
  try {
    const a = await assinRepo.obterAssinatura(Number(req.params.assinaturaId));
    if (!a) return res.status(404).json({ error: 'Assinatura não encontrada.' });
    if (!podeEditar(await repo.donoDoDiario(a.diario_id), userDe(req))) {
      return res.status(403).json({ error: 'Sem permissão para anular esta assinatura.' });
    }
    await assinRepo.anularAssinatura(a.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// PDF do diário assinado (autenticado — o link público tem sua própria rota).
router.get('/assinaturas/:assinaturaId/pdf', requireAuth, async (req: Request, res: Response) => {
  try {
    const a = await assinRepo.obterAssinatura(Number(req.params.assinaturaId));
    if (!a || !a.snapshot) return res.status(404).json({ error: 'Assinatura não encontrada.' });
    const { gerarAssinaturaPdf } = await import('../services/diario/diarioAssinaturaPdf');
    const pdf = await gerarAssinaturaPdf({
      assinatura: a,
      snapshot: a.snapshot,
      linkPublico: `${getBaseUrl()}/v/diario/${a.hash_validacao}`,
      integro: assinRepo.conferirIntegridade(a),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="diario-assinado-${a.id}.pdf"`);
    res.send(pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Envia o PDF assinado por WhatsApp (Z-API). { telefone }
router.post('/assinaturas/:assinaturaId/enviar', requireAuth, async (req: Request, res: Response) => {
  try {
    const a = await assinRepo.obterAssinatura(Number(req.params.assinaturaId));
    if (!a || !a.snapshot) return res.status(404).json({ error: 'Assinatura não encontrada.' });
    const telefone = txt(req.body?.telefone);
    if (!telefone) return res.status(400).json({ error: 'Telefone de destino é obrigatório.' });

    const { gerarAssinaturaPdf } = await import('../services/diario/diarioAssinaturaPdf');
    const { enviarAssinaturaWhatsapp } = await import('../services/diario/diarioAssinaturaEnvio');
    const pdf = await gerarAssinaturaPdf({
      assinatura: a,
      snapshot: a.snapshot,
      linkPublico: `${getBaseUrl()}/v/diario/${a.hash_validacao}`,
      integro: assinRepo.conferirIntegridade(a),
    });
    const nomeObra = a.snapshot.obra_nome || (a.snapshot.obra_id ? 'Obra ' + a.snapshot.obra_id : 'Diário');
    const r = await enviarAssinaturaWhatsapp({
      telefone,
      pdf,
      nomeArquivo: `diario-assinado-${a.id}.pdf`,
      legenda: `📔 Relatório de visita técnica assinado — ${nomeObra}.\nVerifique a autenticidade em: ${getBaseUrl()}/v/diario/${a.hash_validacao}`,
    });
    res.json({ ok: true, messageId: r.messageId });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

export default router;
