// v3.61.0: Controller do Captive Portal / Captacao de Leads Wi-Fi.
//
// Adaptado as convencoes reais do ZAYRA:
//   - pool MySQL2 default export em src/database/connection.ts
//   - disparo Z-API via service wifiBemVindo (que reusa sendReply do whatsapp)
//   - sem dependencias novas (CSV montado a mao com node built-ins)
//
// Endpoints (montados em /api/wifi via wifiLeadRoutes):
//   POST /lead          -> registrarLead   (publico — captive portal)
//   GET  /leads         -> listarLeads      (protegido — painel)
//   GET  /leads/export  -> exportarLeadsCSV (protegido — painel)

import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { enviarBoasVindasWifi } from '../services/wifiBemVindo';

type Origem = 'escritorio' | 'carro' | 'starlink' | 'outro';
const ORIGENS_VALIDAS: ReadonlySet<Origem> = new Set(['escritorio', 'carro', 'starlink', 'outro']);

interface WifiLeadBody {
  nome?: unknown;
  whatsapp?: unknown;
  email?: unknown;
  origem?: unknown;
  mac_address?: unknown;
}

interface WifiLeadRow extends RowDataPacket {
  id: number;
  nome: string;
  whatsapp: string;
  email: string | null;
  origem: Origem;
  ip_cliente: string;
  mac_address: string | null;
  user_agent: string | null;
  boas_vindas: number;
  criado_em: Date;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Sanitiza WhatsApp pro formato 55DDDNUMERO (so digitos). Retorna null se invalido.
function sanitizarWhatsapp(bruto: string): string | null {
  const d = bruto.replace(/\D/g, '');
  if (d.length === 12 || d.length === 13) return d;          // ja com DDI 55
  if (d.length === 10 || d.length === 11) return '55' + d;   // sem DDI -> prefixa
  return null;
}

function normalizarOrigem(v: unknown): Origem {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return ORIGENS_VALIDAS.has(s as Origem) ? (s as Origem) : 'outro';
}

// Valida MAC (XX:XX:XX:XX:XX:XX ou com hifen). Retorna normalizado upper ou null.
function sanitizarMac(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().toUpperCase();
  if (!m) return null;
  return /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/.test(m) ? m.replace(/-/g, ':') : null;
}

function ipDoCliente(req: Request): string {
  // trust proxy=1 ja setado no server.ts -> req.ip respeita x-forwarded-for
  return (req.ip || req.socket?.remoteAddress || '0.0.0.0').replace(/^::ffff:/, '');
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── POST /api/wifi/lead — publico ────────────────────────────────────────────
export async function registrarLead(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as WifiLeadBody;
    const nome = typeof body.nome === 'string' ? body.nome.trim() : '';
    const whatsappBruto = typeof body.whatsapp === 'string' ? body.whatsapp.trim() : '';
    const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;

    // 1. Validacao
    if (!nome) {
      res.status(400).json({ ok: false, erro: 'Nome obrigatorio.' });
      return;
    }
    const whatsapp = sanitizarWhatsapp(whatsappBruto);
    if (!whatsapp) {
      res.status(400).json({ ok: false, erro: 'WhatsApp invalido — informe com DDD.' });
      return;
    }

    const origem = normalizarOrigem(body.origem);
    const mac = sanitizarMac(body.mac_address);
    const ip = ipDoCliente(req);
    const userAgent = (req.headers['user-agent'] || '').toString().slice(0, 1000) || null;

    // 2. Dedup — mesmo whatsapp nas ultimas 24h
    const [dup] = await pool.execute<WifiLeadRow[]>(
      `SELECT id FROM wifi_leads
        WHERE whatsapp = ? AND criado_em > (NOW() - INTERVAL 24 HOUR)
        LIMIT 1`,
      [whatsapp],
    );
    if (dup.length > 0) {
      res.status(200).json({ ok: true, duplicado: true, lead_id: dup[0].id });
      return;
    }

    // 3. INSERT
    const [ins] = await pool.execute<ResultSetHeader>(
      `INSERT INTO wifi_leads (nome, whatsapp, email, origem, ip_cliente, mac_address, user_agent)
       VALUES (?,?,?,?,?,?,?)`,
      [nome.slice(0, 120), whatsapp, email ? email.slice(0, 120) : null, origem, ip, mac, userAgent],
    );
    const leadId = ins.insertId;

    // 4. Boas-vindas Z-API — async, nao bloqueia a resposta. Se enviar, marca flag.
    void (async () => {
      const ok = await enviarBoasVindasWifi(nome, whatsapp);
      if (ok) {
        try {
          await pool.execute('UPDATE wifi_leads SET boas_vindas = 1 WHERE id = ?', [leadId]);
        } catch (err) {
          console.warn('[wifiLead] falha marcando boas_vindas:', (err as Error).message);
        }
      }
    })();

    res.status(201).json({ ok: true, lead_id: leadId });
  } catch (err) {
    console.error('[wifiLead registrarLead] erro:', err);
    res.status(500).json({ ok: false, erro: 'Falha ao registrar lead.' });
  }
}

// ── GET /api/wifi/leads — protegido ──────────────────────────────────────────
export async function listarLeads(req: Request, res: Response): Promise<void> {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: (string | number)[] = [];

    const origemQ = typeof req.query.origem === 'string' ? req.query.origem.trim().toLowerCase() : '';
    if (origemQ && ORIGENS_VALIDAS.has(origemQ as Origem)) {
      where.push('origem = ?');
      params.push(origemQ);
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      where.push('(nome LIKE ? OR whatsapp LIKE ?)');
      const like = `%${search}%`;
      params.push(like, `%${search.replace(/\D/g, '')}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [totalRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM wifi_leads ${whereSql}`,
      params,
    );
    const total = Number(totalRows[0]?.total ?? 0);
    const pages = Math.max(1, Math.ceil(total / limit));

    // LIMIT/OFFSET interpolados (numeros ja sanitizados) — mysql2 nao aceita
    // placeholder em LIMIT no modo execute/prepared de forma confiavel.
    const [rows] = await pool.execute<WifiLeadRow[]>(
      `SELECT id, nome, whatsapp, email, origem, ip_cliente, mac_address,
              boas_vindas, criado_em
         FROM wifi_leads
         ${whereSql}
        ORDER BY criado_em DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const leads = rows.map((r) => ({
      id: Number(r.id),
      nome: r.nome,
      whatsapp: r.whatsapp,
      email: r.email,
      origem: r.origem,
      ip_cliente: r.ip_cliente,
      mac_address: r.mac_address,
      boas_vindas: Number(r.boas_vindas) === 1,
      criado_em: r.criado_em,
    }));

    res.status(200).json({ ok: true, leads, total, page, pages });
  } catch (err) {
    console.error('[wifiLead listarLeads] erro:', err);
    res.status(500).json({ ok: false, erro: 'Falha ao listar leads.' });
  }
}

// ── GET /api/wifi/leads/export — protegido ───────────────────────────────────
export async function exportarLeadsCSV(req: Request, res: Response): Promise<void> {
  try {
    const where: string[] = [];
    const params: (string | number)[] = [];

    const origemQ = typeof req.query.origem === 'string' ? req.query.origem.trim().toLowerCase() : '';
    if (origemQ && ORIGENS_VALIDAS.has(origemQ as Origem)) {
      where.push('origem = ?');
      params.push(origemQ);
    }

    const de = typeof req.query.de === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.de) ? req.query.de : '';
    const ate = typeof req.query.ate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.ate) ? req.query.ate : '';
    if (de) { where.push('criado_em >= ?'); params.push(`${de} 00:00:00`); }
    if (ate) { where.push('criado_em <= ?'); params.push(`${ate} 23:59:59`); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.execute<WifiLeadRow[]>(
      `SELECT id, nome, whatsapp, email, origem, ip_cliente, mac_address,
              boas_vindas, criado_em
         FROM wifi_leads
         ${whereSql}
        ORDER BY criado_em DESC`,
      params,
    );

    const header = ['id', 'nome', 'whatsapp', 'email', 'origem', 'ip_cliente', 'mac_address', 'boas_vindas', 'criado_em'];
    const linhas = [header.join(';')];
    for (const r of rows) {
      linhas.push([
        csvCell(r.id),
        csvCell(r.nome),
        csvCell(r.whatsapp),
        csvCell(r.email),
        csvCell(r.origem),
        csvCell(r.ip_cliente),
        csvCell(r.mac_address),
        csvCell(Number(r.boas_vindas) === 1 ? 'sim' : 'nao'),
        csvCell(r.criado_em instanceof Date ? r.criado_em.toISOString() : r.criado_em),
      ].join(';'));
    }
    // BOM pra Excel reconhecer UTF-8 (acentos)
    const csv = '﻿' + linhas.join('\r\n');

    const hoje = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_wifi_${hoje}.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    console.error('[wifiLead exportarLeadsCSV] erro:', err);
    res.status(500).json({ ok: false, erro: 'Falha ao exportar CSV.' });
  }
}
