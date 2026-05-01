// Sync de contatos do CRM → memória da ZAYRA (v1.39.1)
//
// Lê todos os leads (leadQualifications) e contatos (contacts) do CRM e grava
// na zayra_memory como type='fact' pra ZAYRA poder responder "quem é Karoliny?",
// "qual o telefone do Danny?", etc, mesmo sem o CRM estar online no momento.
//
// Idempotente: usa marker único `[crm:lead:ID]` ou `[crm:contact:ID]` no início
// do content pra detectar registros existentes. Atualiza se nome/score mudou,
// não duplica.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';

interface LeadRow extends RowDataPacket {
  id:                 number;
  phone:              string | null;
  nome:               string | null;
  score:              string | null;
  stage:              string | null;
  campanhaOrigem:     string | null;
  // Schema CRM (Drizzle) usa camelCase. Antes da v1.61.1 estava 'created_at'
  // (snake_case) e quebrava com ER_BAD_FIELD_ERROR. Mesmo bug do PR #4.
  createdAt:          Date | null;
}

interface ContactRow extends RowDataPacket {
  id:    number;
  name:  string | null;
  phone: string | null;
  email: string | null;
}

interface MemoryRow extends RowDataPacket {
  id:      number;
  content: string;
}

function formatPhone(phone: string | null): string {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} ${d.slice(2,4)} ${d.slice(4,8)}-${d.slice(8)}`;
  if (d.length === 11) return `${d.slice(0,2)} ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0,2)} ${d.slice(2,6)}-${d.slice(6)}`;
  return d;
}

function leadToContent(lead: LeadRow): string {
  const partes: string[] = [];
  partes.push(`[crm:lead:${lead.id}] Lead CRM: ${lead.nome || '(sem nome)'}`);
  if (lead.phone) partes.push(`Telefone: ${formatPhone(lead.phone)}`);
  if (lead.score) partes.push(`Score: ${lead.score}`);
  if (lead.stage) partes.push(`Estágio: ${lead.stage}`);
  if (lead.campanhaOrigem) partes.push(`Origem: ${lead.campanhaOrigem}`);
  if (lead.createdAt) partes.push(`Cadastrado em: ${new Date(lead.createdAt).toLocaleDateString('pt-BR')}`);
  return partes.join(' · ');
}

function contactToContent(c: ContactRow): string {
  const partes: string[] = [];
  partes.push(`[crm:contact:${c.id}] Contato CRM: ${c.name || '(sem nome)'}`);
  if (c.phone) partes.push(`Telefone: ${formatPhone(c.phone)}`);
  if (c.email) partes.push(`Email: ${c.email}`);
  return partes.join(' · ');
}

function leadToTags(lead: LeadRow): string {
  const tags: string[] = ['crm', 'lead'];
  if (lead.nome) tags.push(lead.nome);
  if (lead.phone) tags.push(lead.phone.replace(/\D/g, ''));
  if (lead.score) tags.push(lead.score);
  return tags.join(', ');
}

function contactToTags(c: ContactRow): string {
  const tags: string[] = ['crm', 'contato'];
  if (c.name) tags.push(c.name);
  if (c.phone) tags.push(c.phone.replace(/\D/g, ''));
  if (c.email) tags.push(c.email);
  return tags.join(', ');
}

export interface SyncResult {
  leads_lidos:        number;
  leads_inseridos:    number;
  leads_atualizados:  number;
  contatos_lidos:     number;
  contatos_inseridos: number;
  contatos_atualizados: number;
  total_memoria:      number;
  duracao_ms:         number;
}

export async function sincronizarContatosCRM(): Promise<SyncResult> {
  const t0 = Date.now();
  const result: SyncResult = {
    leads_lidos: 0, leads_inseridos: 0, leads_atualizados: 0,
    contatos_lidos: 0, contatos_inseridos: 0, contatos_atualizados: 0,
    total_memoria: 0, duracao_ms: 0,
  };

  // ── 1. Leads ────────────────────────────────────────────────────────────
  let leads: LeadRow[] = [];
  try {
    const [rows] = await pool.execute<LeadRow[]>(
      `SELECT id, phone, nome, score, stage, campanhaOrigem, createdAt
       FROM leadQualifications
       ORDER BY id DESC LIMIT 5000`,
    );
    leads = rows;
    result.leads_lidos = leads.length;
  } catch (err) {
    console.warn('[syncContatos] tabela leadQualifications não acessível:', (err as Error).message);
  }

  for (const lead of leads) {
    if (!lead.nome && !lead.phone) continue;
    const marker = `[crm:lead:${lead.id}]`;
    const content = leadToContent(lead);
    const tags    = leadToTags(lead);

    // Verifica se já existe pelo marker
    const [existing] = await pool.execute<MemoryRow[]>(
      "SELECT id, content FROM zayra_memory WHERE content LIKE ? LIMIT 1",
      [`${marker}%`],
    );

    if (existing.length === 0) {
      await pool.execute<ResultSetHeader>(
        'INSERT INTO zayra_memory (type, content, relevance_tags) VALUES (?,?,?)',
        ['fact', content, tags],
      );
      result.leads_inseridos++;
    } else if (existing[0].content !== content) {
      await pool.execute<ResultSetHeader>(
        'UPDATE zayra_memory SET content = ?, relevance_tags = ?, updated_at = NOW() WHERE id = ?',
        [content, tags, existing[0].id],
      );
      result.leads_atualizados++;
    }
  }

  // ── 2. Contatos (tabela `contacts`) ─────────────────────────────────────
  let contatos: ContactRow[] = [];
  try {
    const [rows] = await pool.execute<ContactRow[]>(
      'SELECT id, name, phone, email FROM contacts ORDER BY id DESC LIMIT 5000',
    );
    contatos = rows;
    result.contatos_lidos = contatos.length;
  } catch (err) {
    console.warn('[syncContatos] tabela contacts não acessível:', (err as Error).message);
  }

  for (const c of contatos) {
    if (!c.name && !c.phone) continue;
    const marker = `[crm:contact:${c.id}]`;
    const content = contactToContent(c);
    const tags    = contactToTags(c);

    const [existing] = await pool.execute<MemoryRow[]>(
      "SELECT id, content FROM zayra_memory WHERE content LIKE ? LIMIT 1",
      [`${marker}%`],
    );

    if (existing.length === 0) {
      await pool.execute<ResultSetHeader>(
        'INSERT INTO zayra_memory (type, content, relevance_tags) VALUES (?,?,?)',
        ['fact', content, tags],
      );
      result.contatos_inseridos++;
    } else if (existing[0].content !== content) {
      await pool.execute<ResultSetHeader>(
        'UPDATE zayra_memory SET content = ?, relevance_tags = ?, updated_at = NOW() WHERE id = ?',
        [content, tags, existing[0].id],
      );
      result.contatos_atualizados++;
    }
  }

  // Total da memória após sync
  const [tot] = await pool.execute<MemoryRow[]>(
    "SELECT COUNT(*) as id, '' as content FROM zayra_memory WHERE content LIKE '[crm:%]'",
  );
  result.total_memoria = Number((tot[0] as { id: number }).id);
  result.duracao_ms = Date.now() - t0;

  console.log(`[syncContatos] ✅ ${result.leads_lidos} leads (${result.leads_inseridos} novos, ${result.leads_atualizados} atualizados) + ${result.contatos_lidos} contatos (${result.contatos_inseridos} novos, ${result.contatos_atualizados} atualizados) em ${result.duracao_ms}ms`);
  return result;
}

// Busca contato por nome ou telefone (sem precisar consultar CRM).
// ZAYRA usa pra responder "qual o telefone do X?" mesmo se CRM tiver fora.
export async function buscarContatoMemoria(query: string): Promise<Array<{
  id: string; tipo: 'lead' | 'contato'; nome: string; telefone: string; resumo: string; cadastrado_em: string;
}>> {
  const q = query.trim();
  if (!q) return [];

  const like = `%${q.replace(/\D/g, '') || q}%`;

  const [rows] = await pool.execute<MemoryRow[]>(
    `SELECT id, content FROM zayra_memory
     WHERE (content LIKE ? OR content LIKE ? OR relevance_tags LIKE ?)
       AND content LIKE '[crm:%'
     ORDER BY updated_at DESC LIMIT 30`,
    [`%${q}%`, like, `%${q}%`],
  );

  return rows.map(r => {
    const m = r.content.match(/^\[crm:(lead|contact):(\d+)\]\s*(?:Lead CRM|Contato CRM):\s*([^·]+)/);
    const tipo = (m?.[1] === 'lead' ? 'lead' : 'contato') as 'lead' | 'contato';
    const nome = m?.[3]?.trim() || '(sem nome)';
    const phoneMatch = r.content.match(/Telefone:\s*([^·]+)/);
    const telefone = phoneMatch?.[1]?.trim() || '';
    const dataMatch = r.content.match(/Cadastrado em:\s*([^·]+)/);
    return {
      id:            String(r.id),
      tipo,
      nome,
      telefone,
      resumo:        r.content,
      cadastrado_em: dataMatch?.[1]?.trim() || '',
    };
  });
}
