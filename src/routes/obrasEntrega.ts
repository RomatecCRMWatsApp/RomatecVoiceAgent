// src/routes/obrasEntrega.ts
// v3.81.0 — Rotas do módulo "Entrega de Obra" (Relatório de Entrega / RE).
// Prefixo: /api/gestao-obra/entrega. Dono = req.user.sub (nunca do body).
// Submódulo de Gestão de Obras — CRUD + PDF + envio Z-API. Sem tools de agente.
import { Router, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { getBaseUrl } from '../services/reciboPdf';
import {
  criarDaProposta, snapshotProposta, buscar, listar, atualizar,
  adicionarFoto, removerFoto, substituirMateriais, definirNotaFiscal,
  definirResponsavel, snapshotResponsavelEquipe, definirStatus, marcarEntregue,
} from '../services/obrasEntregaRepo';
import { gerarEntregaPdf } from '../services/obrasEntregaPdf';
import { enviarEntregaWhatsapp } from '../services/obrasEntregaEnvio';
import { ENTREGA_STATUS, ENTREGA_FOTO_TIPOS } from '../types/obrasEntrega';
import type { EntregaFotoTipo, EntregaStatus, EntregaMaterialSobra } from '../types/obrasEntrega';

const router = Router();

function donoDe(req: Request): string | null {
  const sub = (req as AuthedRequest).user?.sub;
  return sub ? String(sub) : null;
}

// GET /propostas — lista propostas disponíveis pra vincular a RE (picker do wizard).
router.get('/propostas', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!donoDe(req)) return res.status(401).json({ error: 'Não autenticado.' });
    const q = String(req.query.q ?? '').trim();
    const like = `%${q}%`;
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT p.id, p.numero, p.valor_total, p.data_proposta, p.status,
              c.nome AS cliente
         FROM propostas p
         LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
        WHERE p.deleted_at IS NULL
          ${q ? 'AND (p.numero LIKE ? OR c.nome LIKE ?)' : ''}
        ORDER BY p.criado_em DESC, p.id DESC
        LIMIT 50`,
      q ? [like, like] : [],
    );
    res.json({ propostas: rows });
  } catch (err) {
    console.error('[entrega GET /propostas]', err);
    res.status(500).json({ error: 'Falha ao listar propostas.' });
  }
});

// GET /proposta/:id/snapshot — pré-visualiza os dados que a RE puxará.
router.get('/proposta/:id(\\d+)/snapshot', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!donoDe(req)) return res.status(401).json({ error: 'Não autenticado.' });
    const snap = await snapshotProposta(Number(req.params.id));
    if (!snap) return res.status(404).json({ error: 'Proposta não encontrada.' });
    res.json({ snapshot: snap });
  } catch (err) {
    console.error('[entrega GET /proposta/:id/snapshot]', err);
    res.status(500).json({ error: 'Falha ao carregar proposta.' });
  }
});

// GET /equipe — membros ativos pra escolher o responsável (avatar na assinatura).
router.get('/equipe', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!donoDe(req)) return res.status(401).json({ error: 'Não autenticado.' });
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, nome, funcao, foto_url,
              CASE WHEN foto IS NULL THEN 0 ELSE 1 END AS tem_foto
         FROM romatec_obra_equipe
        WHERE ativo = 1
        ORDER BY nome LIMIT 200`,
    );
    res.json({ equipe: rows });
  } catch (err) {
    console.error('[entrega GET /equipe]', err);
    res.status(500).json({ error: 'Falha ao listar equipe.' });
  }
});

// GET / — lista resumida do dono.
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const itens = await listar(dono, { limit: Number(req.query.limit) || 50, offset: Number(req.query.offset) || 0 });
    res.json({ entregas: itens });
  } catch (err) {
    console.error('[entrega GET /]', err);
    res.status(500).json({ error: 'Falha ao listar entregas.' });
  }
});

// POST / — cria a partir de proposta_id (puxa dados da proposta).
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const propostaId = Number(req.body?.proposta_id);
    if (!Number.isFinite(propostaId) || propostaId <= 0) {
      return res.status(400).json({ error: 'Campo "proposta_id" é obrigatório.' });
    }
    const doc = await criarDaProposta(dono, propostaId);
    res.status(201).json({ entrega: doc });
  } catch (err) {
    const msg = (err as Error).message;
    if (/não encontrada/i.test(msg)) return res.status(404).json({ error: msg });
    console.error('[entrega POST /]', err);
    res.status(500).json({ error: 'Falha ao criar entrega.' });
  }
});

// GET /:id — documento completo do dono.
router.get('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const doc = await buscar(Number(req.params.id), dono);
    if (!doc) return res.status(404).json({ error: 'Entrega não encontrada.' });
    res.json({ entrega: doc });
  } catch (err) {
    console.error('[entrega GET /:id]', err);
    res.status(500).json({ error: 'Falha ao buscar entrega.' });
  }
});

// PUT /:id — atualiza campos de conteúdo (descrição, valores, título, status).
router.put('/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (b.status != null && !ENTREGA_STATUS.includes(b.status as EntregaStatus)) {
      return res.status(400).json({ error: `Status inválido "${String(b.status)}".` });
    }
    const ok = await atualizar(Number(req.params.id), dono, {
      titulo: b.titulo as string | undefined,
      cliente: b.cliente as string | undefined,
      cliente_telefone: b.cliente_telefone as string | undefined,
      endereco_obra: b.endereco_obra as string | undefined,
      cidade_uf: b.cidade_uf as string | undefined,
      resumo_proposta: b.resumo_proposta as string | undefined,
      descricao_execucao: b.descricao_execucao as string | undefined,
      valor_orcado: b.valor_orcado as number | undefined,
      valor_receber: b.valor_receber as number | undefined,
      data_execucao: b.data_execucao as string | undefined,
      status: b.status as EntregaStatus | undefined,
    });
    if (!ok) return res.status(404).json({ error: 'Entrega não encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[entrega PUT /:id]', err);
    res.status(500).json({ error: 'Falha ao atualizar entrega.' });
  }
});

// POST /:id/status — muda status (rascunho/em_revisao/concluido).
router.post('/:id(\\d+)/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const status = String(req.body?.status ?? '') as EntregaStatus;
    if (!ENTREGA_STATUS.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
    const ok = await definirStatus(Number(req.params.id), dono, status);
    if (!ok) return res.status(404).json({ error: 'Entrega não encontrada.' });
    res.json({ ok: true, status });
  } catch (err) {
    console.error('[entrega POST /:id/status]', err);
    res.status(500).json({ error: 'Falha ao mudar status.' });
  }
});

// POST /:id/fotos — adiciona foto (base64 JSON). tipo: antes|execucao|depois|sobra_material.
router.post('/:id(\\d+)/fotos', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const tipo = String(b.tipo ?? 'execucao') as EntregaFotoTipo;
    if (!ENTREGA_FOTO_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de foto inválido.' });
    const data_base64 = String(b.data_base64 ?? '');
    if (!data_base64) return res.status(400).json({ error: 'Campo "data_base64" é obrigatório.' });
    const r = await adicionarFoto(Number(req.params.id), dono, {
      tipo,
      mime: String(b.mime ?? 'image/jpeg'),
      data_base64,
      legenda: b.legenda != null ? String(b.legenda).slice(0, 255) : null,
      ordem: Number(b.ordem) || 0,
    });
    if (!r) return res.status(404).json({ error: 'Entrega não encontrada.' });
    res.status(201).json({ id: r.id });
  } catch (err) {
    console.error('[entrega POST /:id/fotos]', err);
    res.status(500).json({ error: (err as Error).message || 'Falha ao adicionar foto.' });
  }
});

// DELETE /:id/fotos/:fotoId — remove foto.
router.delete('/:id(\\d+)/fotos/:fotoId(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const ok = await removerFoto(Number(req.params.id), dono, Number(req.params.fotoId));
    if (!ok) return res.status(404).json({ error: 'Foto não encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[entrega DELETE /:id/fotos/:fotoId]', err);
    res.status(500).json({ error: 'Falha ao remover foto.' });
  }
});

// PUT /:id/materiais — substitui a lista de materiais de sobra (documental).
router.put('/:id(\\d+)/materiais', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const lista = Array.isArray(req.body?.materiais) ? (req.body.materiais as EntregaMaterialSobra[]) : [];
    const ok = await substituirMateriais(Number(req.params.id), dono, lista);
    if (!ok) return res.status(404).json({ error: 'Entrega não encontrada.' });
    res.json({ ok: true, total: lista.length });
  } catch (err) {
    console.error('[entrega PUT /:id/materiais]', err);
    res.status(500).json({ error: 'Falha ao salvar materiais.' });
  }
});

// POST /:id/nota-fiscal — anexa NF (PDF/imagem em base64).
router.post('/:id(\\d+)/nota-fiscal', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const base64 = String(b.base64 ?? '');
    if (!base64) return res.status(400).json({ error: 'Campo "base64" é obrigatório.' });
    const ok = await definirNotaFiscal(Number(req.params.id), dono, {
      nome: String(b.nome ?? 'nota-fiscal'),
      mime: String(b.mime ?? 'application/pdf'),
      base64,
    });
    if (!ok) return res.status(404).json({ error: 'Entrega não encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[entrega POST /:id/nota-fiscal]', err);
    res.status(500).json({ error: (err as Error).message || 'Falha ao anexar NF.' });
  }
});

// PUT /:id/responsavel — define responsável (por equipe_id ou manual).
router.put('/:id(\\d+)/responsavel', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const equipeId = b.equipe_id != null && b.equipe_id !== '' ? Number(b.equipe_id) : null;
    let nome = b.nome != null ? String(b.nome) : '';
    let cargo = b.cargo != null ? String(b.cargo) : null;
    let foto: string | null = b.foto_base64 != null ? String(b.foto_base64) : null;
    if (equipeId) {
      const snap = await snapshotResponsavelEquipe(equipeId);
      if (snap) { nome = nome || snap.nome; cargo = cargo || snap.cargo; foto = foto || snap.foto_base64; }
    }
    if (!nome.trim()) return res.status(400).json({ error: 'Informe o responsável (equipe_id ou nome).' });
    const ok = await definirResponsavel(Number(req.params.id), dono, { equipe_id: equipeId, nome, cargo, foto_base64: foto });
    if (!ok) return res.status(404).json({ error: 'Entrega não encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[entrega PUT /:id/responsavel]', err);
    res.status(500).json({ error: 'Falha ao definir responsável.' });
  }
});

// GET /:id/pdf — gera e responde application/pdf.
router.get('/:id(\\d+)/pdf', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const doc = await buscar(Number(req.params.id), dono);
    if (!doc) return res.status(404).json({ error: 'Entrega não encontrada.' });
    const link = doc.hash_publico ? `${getBaseUrl()}/v/entrega/${doc.hash_publico}` : null;
    const pdf = await gerarEntregaPdf(doc, { linkPublico: link });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.numero || `RE-${doc.id}`}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('[entrega GET /:id/pdf]', err);
    res.status(500).json({ error: 'Falha ao gerar PDF.' });
  }
});

// POST /:id/entregar — marca entregue, gera hash público, envia Z-API + link /v/entrega/:hash.
router.post('/:id(\\d+)/entregar', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const telefone = String(req.body?.telefone ?? '').trim();
    if (!telefone) return res.status(400).json({ error: 'Campo "telefone" é obrigatório.' });

    const id = Number(req.params.id);
    const hash = await marcarEntregue(id, dono);
    if (!hash) return res.status(404).json({ error: 'Entrega não encontrada.' });

    const doc = await buscar(id, dono);
    if (!doc) return res.status(404).json({ error: 'Entrega não encontrada.' });

    const base = getBaseUrl();
    const link = `${base}/v/entrega/${hash}`;
    let pdf: Buffer;
    try { pdf = await gerarEntregaPdf(doc, { linkPublico: link }); }
    catch (e) { return res.status(500).json({ error: `Falha ao gerar PDF: ${(e as Error).message}` }); }

    const legenda = [
      '📦 Relatório de Entrega de Obra',
      `Obra: ${doc.titulo || doc.cliente || doc.numero}`,
      doc.valor_receber != null ? `Valor a receber: ${Number(doc.valor_receber).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : '',
      `Confirme o recebimento: ${link}`,
      '— Romatec Consultoria Total',
    ].filter(Boolean).join('\n');

    try {
      const envio = await enviarEntregaWhatsapp({
        telefone,
        pdf,
        nomeArquivo: `${doc.numero || `RE-${doc.id}`}.pdf`,
        legenda,
      });
      res.json({ ok: true, messageId: envio.messageId, status: 'entregue', hash, link });
    } catch (e) {
      // PDF gerou e status já é 'entregue'; sinaliza falha só no envio.
      console.error('[entrega entregar] Z-API falhou:', e);
      res.status(502).json({ error: `Marcado como entregue, mas o envio falhou: ${(e as Error).message}`, status: 'entregue', hash, link });
    }
  } catch (err) {
    console.error('[entrega POST /:id/entregar]', err);
    res.status(500).json({ error: 'Falha ao entregar.' });
  }
});

export default router;
