// src/routes/obrasEntrega.ts
// v3.81.0 — Rotas do módulo "Entrega de Obra" (Relatório de Entrega / RE).
// Prefixo: /api/gestao-obra/entrega. Dono = req.user.sub (nunca do body).
// Submódulo de Gestão de Obras — CRUD + PDF + envio Z-API. Sem tools de agente.
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { getBaseUrl } from '../services/reciboPdf';
import {
  criarDaProposta, criarExterna, snapshotProposta, buscar, listar, atualizar,
  adicionarFoto, removerFoto, substituirMateriais, adicionarMaterial,
  atualizarMaterial, removerMaterial, definirNotaFiscal,
  definirResponsavel, snapshotResponsavelEquipe, definirStatus, marcarEntregue,
} from '../services/obrasEntregaRepo';
import { sincronizarSobrasDaEntrega } from '../services/inventario/sobraEntregaSync'; // v3.97.0 — sobras → inventário
import { gerarEntregaPdf } from '../services/obrasEntregaPdf';
import { enviarEntregaWhatsapp } from '../services/obrasEntregaEnvio';
import { ENTREGA_STATUS, ENTREGA_FOTO_TIPOS, PROPOSTA_ORIGENS } from '../types/obrasEntrega';
import type { EntregaFotoTipo, EntregaStatus, EntregaMaterialSobra, PropostaOrigem } from '../types/obrasEntrega';

const router = Router();
// Upload em memória (mesmo padrão da galeria/relatório fotográfico).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function donoDe(req: Request): string | null {
  const sub = (req as AuthedRequest).user?.sub;
  return sub ? String(sub) : null;
}

// v3.97.0: toda mutação de sobra reflete no inventário da obra vinculada.
// Best-effort: falha do sync NUNCA derruba a resposta da entrega (só loga).
async function syncInventario(entregaId: number): Promise<void> {
  try { await sincronizarSobrasDaEntrega(entregaId); }
  catch (err) { console.error('[entrega→inventario sync]', (err as Error).message); }
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Lê o arquivo enviado por multer.single('foto'). */
function fileDe(req: Request): { buffer: Buffer; originalname: string } | null {
  const f = (req as Request & { file?: { buffer: Buffer; originalname: string } }).file;
  return f && f.buffer && f.buffer.length ? f : null;
}

/** Aplica o overlay técnico (GPS/UTM/carimbo) — mesmo serviço da galeria. */
async function overlayDe(buffer: Buffer, b: Record<string, unknown>, colaboradorFallback: string) {
  const { aplicarOverlayFoto } = await import('../services/overlayService');
  const horario = (b.horario_captura as string) || new Date().toISOString();
  const colaborador = (b.colaborador ? String(b.colaborador).trim() : '') || colaboradorFallback;
  const municipio = b.municipio ? String(b.municipio) : '';
  return aplicarOverlayFoto({
    imageBuffer: buffer,
    latitude: numOrNull(b.latitude),
    longitude: numOrNull(b.longitude),
    altitude_m: numOrNull(b.altitude_m),
    utm_zona: (b.utm_zona as string) ?? '',
    utm_e: numOrNull(b.utm_e),
    utm_n: numOrNull(b.utm_n),
    datum: (b.datum as string) ?? 'SIRGAS 2000',
    municipio,
    logradouro: (b.logradouro as string) ?? '',
    horario_captura: horario,
    colaborador,
  });
}

/** Monta os campos de foto de um material (overlay se veio arquivo; base64 se JSON). */
async function fotoMaterial(req: Request, b: Record<string, unknown>, dono: string): Promise<Partial<EntregaMaterialSobra>> {
  const file = fileDe(req);
  if (file) {
    const overlay = await overlayDe(file.buffer, b, dono);
    return {
      foto_mime: 'image/jpeg', foto_base64: overlay.base64,
      latitude: numOrNull(b.latitude), longitude: numOrNull(b.longitude),
    };
  }
  if (b.foto_base64) {
    return {
      foto_mime: b.foto_mime != null ? String(b.foto_mime) : 'image/jpeg',
      foto_base64: String(b.foto_base64),
      latitude: numOrNull(b.latitude), longitude: numOrNull(b.longitude),
    };
  }
  return {};
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

// POST / — cria a entrega. Duas origens:
//  - interna (default): body.proposta_id → puxa dados da proposta do sistema.
//  - externa: body.proposta_origem='externa' + PDF (base64) + campos manuais.
// PDF/foto trafegam como base64 (padrão do módulo: LONGTEXT, Railway efêmero).
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const origem = (b.proposta_origem != null ? String(b.proposta_origem) : 'interna') as PropostaOrigem;
    if (!PROPOSTA_ORIGENS.includes(origem)) {
      return res.status(400).json({ error: 'proposta_origem inválida (use "interna" ou "externa").' });
    }

    if (origem === 'externa') {
      const pdfBase64 = String((b.pdf_base64 ?? (b.pdf as Record<string, unknown>)?.base64) ?? '');
      if (!pdfBase64) return res.status(400).json({ error: 'Proposta externa exige o PDF (campo "pdf_base64").' });
      const doc = await criarExterna(dono, {
        titulo: b.titulo != null ? String(b.titulo) : null,
        escopo: b.escopo != null ? String(b.escopo) : null,
        valor_orcado: b.valor_orcado != null && b.valor_orcado !== '' ? Number(b.valor_orcado) : null,
        cliente: b.cliente != null ? String(b.cliente) : null,
        cliente_telefone: b.cliente_telefone != null ? String(b.cliente_telefone) : null,
        pdf: {
          nome: String(b.pdf_nome ?? (b.pdf as Record<string, unknown>)?.nome ?? 'proposta-externa.pdf'),
          mime: String(b.pdf_mime ?? (b.pdf as Record<string, unknown>)?.mime ?? 'application/pdf'),
          base64: pdfBase64,
        },
      });
      return res.status(201).json({ entrega: doc });
    }

    // interna
    const propostaId = Number(b.proposta_id);
    if (!Number.isFinite(propostaId) || propostaId <= 0) {
      return res.status(400).json({ error: 'Proposta interna exige "proposta_id".' });
    }
    const doc = await criarDaProposta(dono, propostaId);
    res.status(201).json({ entrega: doc });
  } catch (err) {
    const msg = (err as Error).message;
    if (/não encontrada|obrigatóri/i.test(msg)) return res.status(400).json({ error: msg });
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

// POST /:id/fotos — upload multipart (campo "foto") + overlay técnico com GPS
// (mesmo padrão da galeria/relatório fotográfico). Também aceita fallback JSON
// base64 (campo data_base64) pra compatibilidade. tipo: antes|execucao|depois|sobra_material.
router.post('/:id(\\d+)/fotos', requireAuth, upload.single('foto'), async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const tipo = String(b.tipo ?? 'execucao') as EntregaFotoTipo;
    if (!ENTREGA_FOTO_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de foto inválido.' });

    const file = fileDe(req);
    let mime = String(b.mime ?? 'image/jpeg');
    let dataB64: string;
    const geo: Record<string, unknown> = {};

    if (file) {
      // Caminho principal: aplica o overlay técnico (resize + carimbo de coordenadas).
      const overlay = await overlayDe(file.buffer, b, dono);
      dataB64 = overlay.base64; // "data:image/jpeg;base64,..."; o repo tira o prefixo
      mime = 'image/jpeg';
      Object.assign(geo, {
        latitude: numOrNull(b.latitude), longitude: numOrNull(b.longitude), altitude_m: numOrNull(b.altitude_m),
        utm_zona: b.utm_zona ?? null, utm_e: numOrNull(b.utm_e), utm_n: numOrNull(b.utm_n),
        datum: b.datum ?? 'SIRGAS 2000', municipio: b.municipio ?? null, logradouro: b.logradouro ?? null,
        horario_captura: (b.horario_captura as string) || new Date().toISOString(),
        colaborador: (b.colaborador && String(b.colaborador).trim()) || null,
      });
    } else if (b.data_base64) {
      // Fallback JSON (sem overlay) — mantém compatibilidade.
      dataB64 = String(b.data_base64);
    } else {
      return res.status(400).json({ error: 'Envie o arquivo "foto" (multipart) ou "data_base64".' });
    }

    const r = await adicionarFoto(Number(req.params.id), dono, {
      tipo, mime, data_base64: dataB64,
      legenda: b.legenda != null ? String(b.legenda).slice(0, 255) : null,
      ordem: Number(b.ordem) || 0,
      ...geo,
    });
    if (!r) return res.status(404).json({ error: 'Entrega não encontrada.' });
    res.status(201).json({ id: r.id, base64_overlay: file ? dataB64 : undefined });
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
    await syncInventario(Number(req.params.id)); // v3.97.0
    res.json({ ok: true, total: lista.length });
  } catch (err) {
    console.error('[entrega PUT /:id/materiais]', err);
    res.status(500).json({ error: 'Falha ao salvar materiais.' });
  }
});

// POST /:id/materiais — adiciona UM material. Foto opcional via multipart (campo
// "foto"): passa pelo MESMO overlay técnico das fotos (GPS/UTM/carimbo). Também
// aceita foto_base64 (JSON) como fallback.
router.post('/:id(\\d+)/materiais', requireAuth, upload.single('foto'), async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!String(b.material ?? '').trim()) return res.status(400).json({ error: 'Campo "material" é obrigatório.' });
    const foto = await fotoMaterial(req, b, dono);
    const r = await adicionarMaterial(Number(req.params.id), dono, {
      material: String(b.material),
      quantidade: b.quantidade != null && b.quantidade !== '' ? Number(b.quantidade) : null,
      unidade: b.unidade != null ? String(b.unidade) : null,
      observacao: b.observacao != null ? String(b.observacao) : null,
      ...foto,
      ordem: Number(b.ordem) || 0,
    });
    if (!r) return res.status(404).json({ error: 'Entrega não encontrada.' });
    await syncInventario(Number(req.params.id)); // v3.97.0
    res.status(201).json({ id: r.id });
  } catch (err) {
    console.error('[entrega POST /:id/materiais]', err);
    res.status(500).json({ error: (err as Error).message || 'Falha ao adicionar material.' });
  }
});

// PUT /:id/materiais/:materialId — atualiza UM material (foto opcional substitui, com overlay).
router.put('/:id(\\d+)/materiais/:materialId(\\d+)', requireAuth, upload.single('foto'), async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const foto = await fotoMaterial(req, b, dono);
    const ok = await atualizarMaterial(Number(req.params.id), dono, Number(req.params.materialId), {
      material: b.material != null ? String(b.material) : undefined,
      quantidade: b.quantidade != null && b.quantidade !== '' ? Number(b.quantidade) : null,
      unidade: b.unidade != null ? String(b.unidade) : null,
      observacao: b.observacao != null ? String(b.observacao) : null,
      ...foto,
    });
    if (!ok) return res.status(404).json({ error: 'Material não encontrado.' });
    await syncInventario(Number(req.params.id)); // v3.97.0
    res.json({ ok: true });
  } catch (err) {
    console.error('[entrega PUT /:id/materiais/:materialId]', err);
    res.status(500).json({ error: 'Falha ao atualizar material.' });
  }
});

// DELETE /:id/materiais/:materialId — remove UM material.
router.delete('/:id(\\d+)/materiais/:materialId(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const dono = donoDe(req);
    if (!dono) return res.status(401).json({ error: 'Não autenticado.' });
    const ok = await removerMaterial(Number(req.params.id), dono, Number(req.params.materialId));
    if (!ok) return res.status(404).json({ error: 'Material não encontrado.' });
    await syncInventario(Number(req.params.id)); // v3.97.0
    res.json({ ok: true });
  } catch (err) {
    console.error('[entrega DELETE /:id/materiais/:materialId]', err);
    res.status(500).json({ error: 'Falha ao remover material.' });
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
