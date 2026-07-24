// src/routes/prontuario.ts
// v3.126.0 — Rotas do "Prontuário do Escritório (Multi-Serviços)".
// Prefixo: /api/prontuarios. Autenticação pelo gate global de /api
// (middleware/apiAuthGate) + requireAuth explícito, que é quem popula req.user.
//
// ORDEM DAS ROTAS IMPORTA: /templates, /etapas/* e /documentos/* precisam vir
// ANTES de /:id — senão o Express casa "templates" como se fosse um id.

import { Router, type Request, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import * as repo from '../services/prontuario/prontuarioRepo';
import {
  listarCategorias,
  etapasDoTemplate,
  rotuloServico,
  normalizarAtualizacaoEtapa,
  ehStatusDocumento,
} from '../services/prontuario/prontuarioTemplates';

const router = Router();

function userDe(req: Request): { sub: string | null; nome: string | null } {
  const u = (req as AuthedRequest).user;
  return {
    sub: u?.sub ? String(u.sub) : null,
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
function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}
const STATUS_PRONTUARIO = ['em_andamento', 'concluido', 'cancelado'] as const;

// ── Catálogo de templates (alimenta os selects da tela) ──────────────────────
// ?categoria=&sub_tipo= devolve também a prévia das etapas que serão geradas.
router.get('/templates', requireAuth, (req: Request, res: Response) => {
  try {
    const categoria = txt(req.query.categoria);
    const subTipo = txt(req.query.sub_tipo);
    const body: Record<string, unknown> = { ok: true, categorias: listarCategorias() };
    if (categoria) {
      const etapas = etapasDoTemplate(categoria, subTipo);
      if (!etapas.length) {
        return res.status(404).json({ error: `Sem roteiro para "${categoria}"${subTipo ? ` / "${subTipo}"` : ''}.` });
      }
      body.previa = { categoria, sub_tipo: subTipo, servico_nome: rotuloServico(categoria, subTipo), etapas };
    }
    res.json(body);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Etapa: status / data de conclusão / responsável / observações ────────────
router.put('/etapas/:etapaId', requireAuth, async (req: Request, res: Response) => {
  try {
    const etapaId = Number(req.params.etapaId);
    if (!Number.isFinite(etapaId)) return res.status(400).json({ error: 'Etapa inválida.' });
    const prontuarioId = await repo.prontuarioDaEtapa(etapaId);
    if (prontuarioId == null) return res.status(404).json({ error: 'Etapa não encontrada.' });

    const b = req.body ?? {};
    // Sem responsável informado, assume quem está logado ao CONCLUIR — é o dado
    // que o escritório cobra depois ("quem deu baixa nessa etapa?").
    if (b.status === 'concluido' && b.responsavel === undefined) {
      const u = userDe(req);
      if (u.nome) b.responsavel = u.nome;
    }

    let campos;
    try {
      campos = normalizarAtualizacaoEtapa(b, hojeIso());
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
    await repo.atualizarEtapa(etapaId, campos);

    const prontuario = await repo.obterProntuario(prontuarioId);
    res.json({ ok: true, prontuario });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Checklist: adicionar documento numa etapa ────────────────────────────────
router.post('/etapas/:etapaId/documentos', requireAuth, async (req: Request, res: Response) => {
  try {
    const etapaId = Number(req.params.etapaId);
    const prontuarioId = await repo.prontuarioDaEtapa(etapaId);
    if (prontuarioId == null) return res.status(404).json({ error: 'Etapa não encontrada.' });
    const doc = txt(req.body?.doc);
    if (!doc) return res.status(400).json({ error: 'Informe o nome do documento (campo "doc").' });
    const id = await repo.adicionarDocumento(etapaId, prontuarioId, doc);
    res.status(201).json({ ok: true, id, prontuario: await repo.obterProntuario(prontuarioId) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Checklist: marcar documento ok/pendente ─────────────────────────────────
router.put('/documentos/:docId', requireAuth, async (req: Request, res: Response) => {
  try {
    const docId = Number(req.params.docId);
    const ref = await repo.prontuarioDoDocumento(docId);
    if (!ref) return res.status(404).json({ error: 'Documento não encontrado.' });

    const b = req.body ?? {};
    if (b.status !== undefined && !ehStatusDocumento(b.status)) {
      return res.status(400).json({ error: 'Status do documento deve ser "ok" ou "pendente".' });
    }
    await repo.atualizarDocumento(docId, {
      status: b.status !== undefined ? b.status : undefined,
      observacao: b.observacao !== undefined ? txt(b.observacao) : undefined,
    });
    res.json({ ok: true, prontuario: await repo.obterProntuario(ref.prontuario_id) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

router.delete('/documentos/:docId', requireAuth, async (req: Request, res: Response) => {
  try {
    const docId = Number(req.params.docId);
    const ref = await repo.prontuarioDoDocumento(docId);
    if (!ref) return res.status(404).json({ error: 'Documento não encontrado.' });
    await repo.excluirDocumento(docId);
    res.json({ ok: true, prontuario: await repo.obterProntuario(ref.prontuario_id) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Lista (?cliente=&categoria=&status=&obra_id=) ────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const prontuarios = await repo.listarProntuarios({
      cliente: txt(req.query.cliente),
      categoria: txt(req.query.categoria),
      status: txt(req.query.status),
      obra_id: intOrNull(req.query.obra_id),
    });
    res.json({ ok: true, prontuarios });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Criar (cliente + serviço → etapas geradas do template) ───────────────────
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    // Aceita tanto o formato plano quanto o aninhado da spec
    // ({ cliente: {...}, servico_contratado: {...} }) — a tela usa o plano.
    const cliente = (b.cliente ?? {}) as Record<string, unknown>;
    const servico = (b.servico_contratado ?? {}) as Record<string, unknown>;

    const clienteNome = txt(b.cliente_nome ?? cliente.nome);
    if (!clienteNome) return res.status(400).json({ error: 'Nome do cliente é obrigatório.' });

    const categoria = txt(b.categoria ?? servico.categoria);
    if (!categoria) return res.status(400).json({ error: 'Categoria do serviço é obrigatória.' });
    const subTipo = txt(b.sub_tipo ?? servico.sub_tipo);

    const u = userDe(req);
    const criado = await repo.criarProntuario({
      cliente_nome: clienteNome,
      cliente_cpf_cnpj: txt(b.cliente_cpf_cnpj ?? cliente.cpf_cnpj),
      cliente_telefone: txt(b.cliente_telefone ?? cliente.telefone),
      categoria,
      sub_tipo: subTipo,
      data_contratacao: txt(b.data_contratacao ?? servico.data_contratacao),
      previsao_conclusao: txt(b.previsao_conclusao ?? servico.previsao_conclusao),
      responsavel: txt(b.responsavel) ?? u.nome,
      observacoes: txt(b.observacoes),
      obra_id: intOrNull(b.obra_id),
      user_sub: u.sub,
    });

    res.status(201).json({ ok: true, ...criado, prontuario: await repo.obterProntuario(criado.id) });
  } catch (err) {
    if (err instanceof repo.TemplateDesconhecidoError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Detalhe (aceita id numérico OU número PRN-AAAA-NNN) ──────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = String(req.params.id);
    const prontuario = /^\d+$/.test(raw)
      ? await repo.obterProntuario(Number(raw))
      : await repo.obterProntuarioPorNumero(raw);
    if (!prontuario) return res.status(404).json({ error: 'Prontuário não encontrado.' });
    res.json({ ok: true, prontuario });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Atualizar cabeçalho ──────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!(await repo.obterProntuario(id))) return res.status(404).json({ error: 'Prontuário não encontrado.' });

    const b = req.body ?? {};
    if (b.status !== undefined && !(STATUS_PRONTUARIO as readonly string[]).includes(String(b.status))) {
      return res.status(400).json({ error: `Status inválido: use ${STATUS_PRONTUARIO.join(', ')}.` });
    }
    await repo.atualizarProntuario(id, {
      cliente_nome: b.cliente_nome !== undefined ? txt(b.cliente_nome) : undefined,
      cliente_cpf_cnpj: b.cliente_cpf_cnpj !== undefined ? txt(b.cliente_cpf_cnpj) : undefined,
      cliente_telefone: b.cliente_telefone !== undefined ? txt(b.cliente_telefone) : undefined,
      data_contratacao: b.data_contratacao !== undefined ? txt(b.data_contratacao) : undefined,
      previsao_conclusao: b.previsao_conclusao !== undefined ? txt(b.previsao_conclusao) : undefined,
      status: b.status !== undefined ? b.status : undefined,
      responsavel: b.responsavel !== undefined ? txt(b.responsavel) : undefined,
      observacoes: b.observacoes !== undefined ? txt(b.observacoes) : undefined,
      obra_id: b.obra_id !== undefined ? intOrNull(b.obra_id) : undefined,
    });
    res.json({ ok: true, prontuario: await repo.obterProntuario(id) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ── Excluir (etapas e documentos caem por CASCADE) ───────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!(await repo.obterProntuario(id))) return res.status(404).json({ error: 'Prontuário não encontrado.' });
    await repo.excluirProntuario(id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

export default router;
