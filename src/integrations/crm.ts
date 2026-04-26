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
  const params: unknown[] = [];
  let sql = `SELECT id, phone, nome, score, stage, campanhaOrigem,
                    lastActivityAt, blockedUntil, discardReason, createdAt, updatedAt
             FROM leadQualifications`;
  if (filtros?.score) { sql += ' WHERE score = ?'; params.push(filtros.score); }
  sql += ' ORDER BY createdAt DESC LIMIT ?';
  params.push(limit);

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
