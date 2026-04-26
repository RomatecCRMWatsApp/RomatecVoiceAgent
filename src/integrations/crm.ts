import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { Lead, Campanha } from '../types';
import { formatBR } from '../util/format';

// ZAYRA reads the same MySQL the CRM uses (Romatec_CRM_WhatsApp).
// Tables of interest: leadQualifications, campaigns, messages.

type LeadRow = RowDataPacket & {
  id:               number;
  phone:            string;
  nome:             string | null;
  score:            'quente' | 'morno' | 'frio';
  stage:            string | null;
  campanhaOrigem:   string | null;
  lastActivityAt:   Date | null;
  blockedUntil:     Date | null;
  discardReason:    string | null;
  createdAt:        Date;
  updatedAt:        Date;
};

type CampaignRow = RowDataPacket & {
  id:             number;
  propertyId:     number;
  name:           string;
  status:         'draft' | 'scheduled' | 'running' | 'paused' | 'completed';
  totalContacts:  number | null;
  sentCount:      number | null;
  failedCount:    number | null;
  startDate:      Date | null;
  endDate:        Date | null;
  createdAt:      Date;
  updatedAt:      Date;
};

const mapCampaignStatus = (s: CampaignRow['status']): Campanha['status'] => {
  if (s === 'running')   return 'ativa';
  if (s === 'completed') return 'concluida';
  return 'pausada'; // draft, scheduled, paused
};

const rowToLead = (r: LeadRow): Lead => ({
  id:             String(r.id),
  nome:           r.nome ?? '(sem nome)',
  telefone:       r.phone,
  score:          r.score,
  stage:          r.stage ?? null,
  campanha_origem: r.campanhaOrigem ?? null,
  last_activity_at: r.lastActivityAt ? formatBR(r.lastActivityAt) : null,
  created_at:     formatBR(r.createdAt),
});

const rowToCampanha = (r: CampaignRow): Campanha => ({
  id:               String(r.id),
  nome:             r.name,
  status:           mapCampaignStatus(r.status),
  total_contatos:   r.totalContacts ?? 0,
  enviados:         r.sentCount     ?? 0,
  respondidos:      0, // preenchido por statusCampanha quando interessar
});

export async function listarLeads(filtros?: {
  score?:  Lead['score'];
  limite?: number;
}): Promise<Lead[]> {
  const limit = Math.min(Math.max(filtros?.limite ?? 50, 1), 500);
  const params: (string | number | boolean | null)[] = [];
  let sql = `SELECT id, phone, nome, score, stage, campanhaOrigem,
                    lastActivityAt, blockedUntil, discardReason, createdAt, updatedAt
             FROM leadQualifications`;
  if (filtros?.score) { sql += ' WHERE score = ?'; params.push(filtros.score); }
  sql += ` ORDER BY createdAt DESC LIMIT ${limit}`;

  const [rows] = await pool.query<LeadRow[]>(sql, params);
  return rows.map(rowToLead);
}

export async function buscarLead(id: string): Promise<Lead | null> {
  const numId = Number(id);
  if (!Number.isFinite(numId)) throw new Error(`ID inválido: ${id}`);
  const [rows] = await pool.execute<LeadRow[]>(
    `SELECT id, phone, nome, score, stage, campanhaOrigem,
            lastActivityAt, blockedUntil, discardReason, createdAt, updatedAt
     FROM leadQualifications WHERE id = ? LIMIT 1`,
    [numId],
  );
  return rows[0] ? rowToLead(rows[0]) : null;
}

export async function listarCampanhas(): Promise<Campanha[]> {
  const [rows] = await pool.query<CampaignRow[]>(
    `SELECT id, propertyId, name, status, totalContacts, sentCount, failedCount,
            startDate, endDate, createdAt, updatedAt
     FROM campaigns
     ORDER BY createdAt DESC LIMIT 50`,
  );
  return rows.map(rowToCampanha);
}

// ── CRUD escrita (v1.12) — exige confirmação explícita do CEO ──────────────
// Tools que escrevem no MySQL do CRM verificam confirm===true antes de tocar.
// Sem confirm, retornam preview do que seria feito (dry run).

export interface MutationResult {
  preview?: boolean;          // true = simulação (sem confirm)
  ok?:      true;              // true = aplicado
  affected?: number;
  message:  string;
  query?:   string;
}

export async function criarLead(args: {
  phone:      string;
  nome?:      string;
  score?:     'quente' | 'morno' | 'frio';
  campanhaOrigem?: string;
  confirm?:   boolean;
}): Promise<MutationResult> {
  const phone = args.phone.replace(/\D/g, '');
  if (!phone) throw new Error('phone é obrigatório.');
  const score = args.score ?? 'frio';
  const sql = `INSERT INTO leadQualifications (phone, nome, score, campanhaOrigem) VALUES (?,?,?,?)`;
  if (!args.confirm) {
    return {
      preview:  true,
      message:  `Vou criar um lead novo. Confirme com "confirm: true" pra executar.`,
      query:    `${sql}  -- params: [${phone}, ${args.nome ?? null}, ${score}, ${args.campanhaOrigem ?? null}]`,
    };
  }
  const [r] = await pool.execute<import('mysql2').ResultSetHeader>(
    sql, [phone, args.nome ?? null, score, args.campanhaOrigem ?? null],
  );
  return { ok: true, affected: r.affectedRows, message: `Lead ${phone} criado (id=${r.insertId}).` };
}

export async function atualizarLead(args: {
  id:        string;
  nome?:     string;
  score?:    'quente' | 'morno' | 'frio';
  stage?:    string;
  discardReason?: string;
  confirm?:  boolean;
}): Promise<MutationResult> {
  const numId = Number(args.id);
  if (!Number.isFinite(numId) || numId <= 0) throw new Error('id inválido.');

  const sets: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  if (args.nome !== undefined)          { sets.push('nome = ?');          params.push(args.nome); }
  if (args.score !== undefined)         { sets.push('score = ?');         params.push(args.score); }
  if (args.stage !== undefined)         { sets.push('stage = ?');         params.push(args.stage); }
  if (args.discardReason !== undefined) { sets.push('discardReason = ?'); params.push(args.discardReason); }
  if (sets.length === 0) throw new Error('Nada para atualizar — passe ao menos um campo.');
  params.push(numId);

  const sql = `UPDATE leadQualifications SET ${sets.join(', ')} WHERE id = ?`;
  if (!args.confirm) {
    return { preview: true, message: `Vou atualizar lead id=${numId}. Confirme com "confirm: true".`, query: sql };
  }
  const [r] = await pool.execute<import('mysql2').ResultSetHeader>(sql, params);
  return { ok: true, affected: r.affectedRows, message: `Lead id=${numId} atualizado (${r.affectedRows} linha).` };
}

export async function apagarLead(args: { id: string; confirm?: boolean }): Promise<MutationResult> {
  const numId = Number(args.id);
  if (!Number.isFinite(numId) || numId <= 0) throw new Error('id inválido.');
  const sql = `DELETE FROM leadQualifications WHERE id = ?`;
  if (!args.confirm) {
    return {
      preview: true,
      message: `⚠️ AÇÃO DESTRUTIVA. Vou apagar lead id=${numId}. Pra confirmar, repita com "confirm: true".`,
      query:   `${sql}  -- params: [${numId}]`,
    };
  }
  const [r] = await pool.execute<import('mysql2').ResultSetHeader>(sql, [numId]);
  return { ok: true, affected: r.affectedRows, message: `Lead id=${numId} apagado (${r.affectedRows} linha).` };
}

// Contatos
export async function criarContato(args: {
  name: string; phone: string; email?: string; confirm?: boolean;
}): Promise<MutationResult> {
  const phone = args.phone.replace(/\D/g, '');
  if (!phone) throw new Error('phone é obrigatório.');
  if (!args.name) throw new Error('name é obrigatório.');
  const sql = `INSERT INTO contacts (name, phone, email) VALUES (?,?,?)`;
  if (!args.confirm) {
    return { preview: true, message: `Vou criar contato "${args.name}" (${phone}). Confirme com "confirm: true".`, query: sql };
  }
  const [r] = await pool.execute<import('mysql2').ResultSetHeader>(sql, [args.name, phone, args.email ?? null]);
  return { ok: true, affected: r.affectedRows, message: `Contato "${args.name}" criado (id=${r.insertId}).` };
}

export async function atualizarContato(args: {
  id: string; name?: string; phone?: string; email?: string; status?: 'active'|'blocked'|'inactive'; confirm?: boolean;
}): Promise<MutationResult> {
  const numId = Number(args.id);
  if (!Number.isFinite(numId) || numId <= 0) throw new Error('id inválido.');
  const sets: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  if (args.name   !== undefined) { sets.push('name = ?');   params.push(args.name); }
  if (args.phone  !== undefined) { sets.push('phone = ?');  params.push(args.phone.replace(/\D/g, '')); }
  if (args.email  !== undefined) { sets.push('email = ?');  params.push(args.email); }
  if (args.status !== undefined) { sets.push('status = ?'); params.push(args.status); }
  if (sets.length === 0) throw new Error('Nada pra atualizar.');
  params.push(numId);
  const sql = `UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`;
  if (!args.confirm) {
    return { preview: true, message: `Vou atualizar contato id=${numId}. Confirme com "confirm: true".`, query: sql };
  }
  const [r] = await pool.execute<import('mysql2').ResultSetHeader>(sql, params);
  return { ok: true, affected: r.affectedRows, message: `Contato id=${numId} atualizado.` };
}

export async function apagarContato(args: { id: string; confirm?: boolean }): Promise<MutationResult> {
  const numId = Number(args.id);
  if (!Number.isFinite(numId) || numId <= 0) throw new Error('id inválido.');
  if (!args.confirm) {
    return { preview: true, message: `⚠️ DESTRUTIVO. Apagar contato id=${numId}. Confirme com "confirm: true".`, query: 'DELETE FROM contacts WHERE id = ?' };
  }
  const [r] = await pool.execute<import('mysql2').ResultSetHeader>('DELETE FROM contacts WHERE id = ?', [numId]);
  return { ok: true, affected: r.affectedRows, message: `Contato id=${numId} apagado.` };
}

// Campanhas — atualizar status mais comum (start/pause/complete)
export async function atualizarCampanha(args: {
  id: string;
  status?: 'draft'|'scheduled'|'running'|'paused'|'completed';
  name?:   string;
  activeDay?:   boolean;
  activeNight?: boolean;
  confirm?: boolean;
}): Promise<MutationResult> {
  const numId = Number(args.id);
  if (!Number.isFinite(numId) || numId <= 0) throw new Error('id inválido.');
  const sets: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  if (args.status      !== undefined) { sets.push('status = ?');      params.push(args.status); }
  if (args.name        !== undefined) { sets.push('name = ?');        params.push(args.name); }
  if (args.activeDay   !== undefined) { sets.push('activeDay = ?');   params.push(args.activeDay ? 1 : 0); }
  if (args.activeNight !== undefined) { sets.push('activeNight = ?'); params.push(args.activeNight ? 1 : 0); }
  if (sets.length === 0) throw new Error('Nada pra atualizar.');
  params.push(numId);
  const sql = `UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`;
  if (!args.confirm) {
    return { preview: true, message: `Vou atualizar campanha id=${numId}. Confirme com "confirm: true".`, query: sql };
  }
  const [r] = await pool.execute<import('mysql2').ResultSetHeader>(sql, params);
  return { ok: true, affected: r.affectedRows, message: `Campanha id=${numId} atualizada.` };
}

export async function apagarCampanha(args: { id: string; confirm?: boolean }): Promise<MutationResult> {
  const numId = Number(args.id);
  if (!Number.isFinite(numId) || numId <= 0) throw new Error('id inválido.');
  if (!args.confirm) {
    return { preview: true, message: `⚠️ DESTRUTIVO. Apagar campanha id=${numId} (e msgs relacionadas continuam — apenas a campanha sai). Confirme com "confirm: true".`, query: 'DELETE FROM campaigns WHERE id = ?' };
  }
  const [r] = await pool.execute<import('mysql2').ResultSetHeader>('DELETE FROM campaigns WHERE id = ?', [numId]);
  return { ok: true, affected: r.affectedRows, message: `Campanha id=${numId} apagada.` };
}

export async function statusCampanha(id: string): Promise<Campanha & {
  entregues: number;
  falhas:    number;
} | null> {
  const numId = Number(id);
  if (!Number.isFinite(numId)) throw new Error(`ID inválido: ${id}`);

  const [campRows] = await pool.execute<CampaignRow[]>(
    `SELECT id, propertyId, name, status, totalContacts, sentCount, failedCount,
            startDate, endDate, createdAt, updatedAt
     FROM campaigns WHERE id = ? LIMIT 1`,
    [numId],
  );
  if (!campRows[0]) return null;

  const [metricRows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS entregues,
       SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS falhas
     FROM messages WHERE campaignId = ?`,
    [numId],
  );
  const entregues = Number(metricRows[0]?.entregues ?? 0);
  const falhas    = Number(metricRows[0]?.falhas    ?? 0);

  return { ...rowToCampanha(campRows[0]), entregues, falhas };
}
