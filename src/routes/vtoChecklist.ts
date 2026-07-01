// src/routes/vtoChecklist.ts
// v3.78.0 — Rotas do VTO · Checklist de Atividades (Gestão de Obra).
// Prefixo: /api/gestao-obra/vto-checklist. Dono = req.user.sub (nunca do body).
import { Router, type Request, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { getBaseUrl } from '../services/reciboPdf';
import {
  getCatalogo, criar, buscar, atualizar, listar,
  definirStatusEnviado, definirStatusFinalizado,
} from '../services/vtoChecklistRepo';
import { calcularPercentual } from '../services/vtoChecklistCalc';
import { gerarChecklistPdf } from '../services/vtoChecklistPdf';
import { enviarChecklistWhatsapp } from '../services/vtoChecklistEnvio';
import type { VtoChecklist, VtoChecklistItem, VtoStatus } from '../types/vtoChecklist';

const router = Router();
const STATUS_VALIDOS: VtoStatus[] = ['nao_iniciado', 'iniciado', 'em_andamento', 'concluido'];

function donoDe(req: Request): string | null {
  const sub = (req as AuthedRequest).user?.sub;
  return sub ? String(sub) : null;
}

/** Valida e monta o VtoChecklist a partir do body (injeta o dono). */
function montar(body: unknown, colaboradorId: string): VtoChecklist {
  const b = (body ?? {}) as Record<string, unknown>;
  const obraNome = typeof b.obra_nome === 'string' ? b.obra_nome.trim() : '';
  if (!obraNome) throw new Error('Campo "obra_nome" é obrigatório.');
  if (b.itens != null && !Array.isArray(b.itens)) throw new Error('"itens" deve ser uma lista.');

  const itensRaw = Array.isArray(b.itens) ? b.itens : [];
  const itens: VtoChecklistItem[] = itensRaw.map((raw, idx) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    if (it.status != null && !STATUS_VALIDOS.includes(it.status as VtoStatus)) {
      throw new Error(`Item ${idx + 1}: status inválido "${String(it.status)}".`);
    }
    let m2: number | null = null;
    if (it.metros_quadrados != null && it.metros_quadrados !== '') {
      const n = Number(it.metros_quadrados);
      if (Number.isNaN(n) || n < 0) throw new Error(`Item ${idx + 1}: m² inválido.`);
      m2 = n;
    }
    return {
      disciplina_ordem: Number(it.disciplina_ordem) || 0,
      disciplina_nome: String(it.disciplina_nome ?? '').slice(0, 120),
      atividade: String(it.atividade ?? '').slice(0, 180),
      atividade_ordem: Number(it.atividade_ordem) || 0,
      status: (it.status as VtoStatus) ?? 'nao_iniciado',
      comodo_local: it.comodo_local != null ? String(it.comodo_local).slice(0, 160) : null,
      metros_quadrados: m2,
      observacao: it.observacao != null ? String(it.observacao).slice(0, 400) : null,
    };
  });

  const str = (v: unknown, max: number): string | null =>
    v == null || v === '' ? null : String(v).slice(0, max);

  return {
    colaborador_id: colaboradorId,
    obra_id: b.obra_id != null && b.obra_id !== '' ? Number(b.obra_id) : null,
    numero_vto: str(b.numero_vto, 40),
    obra_nome: obraNome.slice(0, 180),
    cliente: str(b.cliente, 180),
    endereco: str(b.endereco, 240),
    cidade_uf: str(b.cidade_uf, 120),
    data_vistoria: str(b.data_vistoria, 10),
    etapa: str(b.etapa, 120),
    responsavel_tecnico: typeof b.responsavel_tecnico === 'string' ? b.responsavel_tecnico.slice(0, 200) : undefined,
    art_trt: str(b.art_trt, 80),
    observacoes_gerais: b.observacoes_gerais != null ? String(b.observacoes_gerais) : null,
    pendencias: b.pendencias != null ? String(b.pendencias) : null,
    proxima_vistoria: str(b.proxima_vistoria, 120),
    status: (b.status as VtoChecklist['status']) ?? 'rascunho',
    itens,
  };
}

// GET /catalogo — agrupado por disciplina.
router.get('/catalogo', requireAuth, async (_req: Request, res: Response) => {
  try {
    const flat = await getCatalogo();
    const map = new Map<number, { disciplina_ordem: number; disciplina_nome: string; atividades: { atividade: string; atividade_ordem: number }[] }>();
    for (const it of flat) {
      if (!map.has(it.disciplina_ordem)) {
        map.set(it.disciplina_ordem, { disciplina_ordem: it.disciplina_ordem, disciplina_nome: it.disciplina_nome, atividades: [] });
      }
      map.get(it.disciplina_ordem)!.atividades.push({ atividade: it.atividade, atividade_ordem: it.atividade_ordem });
    }
    const disciplinas = [...map.values()].sort((a, b) => a.disciplina_ordem - b.disciplina_ordem);
    res.json({ disciplinas });
  } catch (err) {
    console.error('[vto-checklist GET /catalogo]', err);
    res.status(500).json({ error: 'Falha ao carregar catálogo.' });
  }
});

// GET / — lista resumida do dono.
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const itens = await listar(dono, { limit, offset });
    res.json({ checklists: itens });
  } catch (err) {
    console.error('[vto-checklist GET /]', err);
    res.status(500).json({ error: 'Falha ao listar checklists.' });
  }
});

// POST / — cria.
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    let data: VtoChecklist;
    try { data = montar(req.body, dono); }
    catch (e) { return res.status(400).json({ error: (e as Error).message }); }
    const r = await criar(data);
    res.status(201).json(r);
  } catch (err) {
    console.error('[vto-checklist POST /]', err);
    res.status(500).json({ error: 'Falha ao criar checklist.' });
  }
});

// GET /:id — documento completo do dono.
router.get('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const doc = await buscar(Number(req.params.id), dono);
    if (!doc) return res.status(404).json({ error: 'Checklist não encontrado.' });
    res.json({ checklist: doc });
  } catch (err) {
    console.error('[vto-checklist GET /:id]', err);
    res.status(500).json({ error: 'Falha ao buscar checklist.' });
  }
});

// PUT /:id — atualiza (dono no WHERE).
router.put('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    let data: VtoChecklist;
    try { data = montar(req.body, dono); }
    catch (e) { return res.status(400).json({ error: (e as Error).message }); }
    const ok = await atualizar(Number(req.params.id), dono, data);
    if (!ok) return res.status(404).json({ error: 'Checklist não encontrado.' });
    res.json({ ok: true, percentual_fisico: calcularPercentual(data.itens).geral });
  } catch (err) {
    console.error('[vto-checklist PUT /:id]', err);
    res.status(500).json({ error: 'Falha ao atualizar checklist.' });
  }
});

// GET /:id/pdf — gera e responde application/pdf.
router.get('/:id(\\d+)/pdf', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const doc = await buscar(Number(req.params.id), dono);
    if (!doc) return res.status(404).json({ error: 'Checklist não encontrado.' });
    const pdf = await gerarChecklistPdf(doc, calcularPercentual(doc.itens));
    const nome = `VTO-Checklist-${(doc.numero_vto || doc.id)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
    res.send(pdf);
  } catch (err) {
    console.error('[vto-checklist GET /:id/pdf]', err);
    res.status(500).json({ error: 'Falha ao gerar PDF.' });
  }
});

// POST /:id/enviar — finaliza (se rascunho), gera PDF, envia Z-API, marca enviado.
router.post('/:id(\\d+)/enviar', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const telefone = String((req.body?.telefone ?? '')).trim();
    if (!telefone) return res.status(400).json({ error: 'Campo "telefone" é obrigatório.' });

    const id = Number(req.params.id);
    const doc = await buscar(id, dono);
    if (!doc) return res.status(404).json({ error: 'Checklist não encontrado.' });

    if (doc.status === 'rascunho') { await definirStatusFinalizado(id, dono); doc.status = 'finalizado'; }

    const percent = calcularPercentual(doc.itens);
    let pdf: Buffer;
    try { pdf = await gerarChecklistPdf(doc, percent); }
    catch (e) { return res.status(500).json({ error: `Falha ao gerar PDF: ${(e as Error).message}` }); }

    const base = getBaseUrl();
    const legenda = [
      '📋 VTO — Checklist de Atividades',
      `Obra: ${doc.obra_nome}`,
      `Avanço físico: ${percent.geral}%`,
      doc.hash_validacao ? `Validação: ${base}/v/${doc.hash_validacao}` : '',
      '— Romatec Consultoria Total',
    ].filter(Boolean).join('\n');

    try {
      const envio = await enviarChecklistWhatsapp({
        telefone,
        pdf,
        nomeArquivo: `VTO-Checklist-${doc.numero_vto || doc.id}.pdf`,
        legenda,
      });
      await definirStatusEnviado(id, dono);
      res.json({ ok: true, messageId: envio.messageId, status: 'enviado' });
    } catch (e) {
      // PDF gerou mas envio falhou: mantém o registro (finalizado) e sinaliza 502.
      console.error('[vto-checklist enviar] Z-API falhou:', e);
      res.status(502).json({ error: `PDF gerado, mas o envio falhou: ${(e as Error).message}`, status: doc.status });
    }
  } catch (err) {
    console.error('[vto-checklist POST /:id/enviar]', err);
    res.status(500).json({ error: 'Falha ao enviar checklist.' });
  }
});

export default router;
