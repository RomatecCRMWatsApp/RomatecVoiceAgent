// v1.65.10 — PR A: sincronização Equipe ↔ contacts ↔ memória ZAYRA.
// Quando um membro de romatec_obra_equipe é criado/atualizado/apagado/inativado,
// este service atualiza o registro correspondente em contacts (CRM) e o fato
// estruturado em zayra_memory. Idempotente: roda 2x não duplica.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';

interface MembroRow extends RowDataPacket {
  id: number;
  nome: string;
  funcao: string | null;
  tipo_contrato: string | null;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  valor_dia: string | null;
  ativo: number;
  contact_id: number | null;
  observacoes: string | null;
}

interface ContactRow extends RowDataPacket {
  id: number;
  phone: string;
}

// Infere tratamento ("Eng.", "Arq.", etc) a partir do cargo. Conservador:
// só aplica quando cargo é claro. Caso contrário deixa null (saudação genérica).
function inferirTratamento(funcao: string | null): string | null {
  if (!funcao) return null;
  const f = funcao.toLowerCase();
  if (f.includes('engenheir')) return 'Eng.';
  if (f.includes('arquitet'))  return 'Arq.';
  if (f.includes('mestre'))    return 'Mestre';
  if (f.includes('técnico') || f.includes('tecnico')) return 'Téc.';
  if (f.includes('doutor'))    return 'Dr.';
  return null;
}

interface SyncResult {
  ok: boolean;
  contactId: number | null;
  memoryId: number | null;
  skipped?: 'sem_telefone' | 'membro_nao_encontrado';
  message: string;
}

export async function syncEquipeMembro(membroId: number): Promise<SyncResult> {
  // 1) Lê o membro
  const [rows] = await pool.execute<MembroRow[]>(
    `SELECT id, nome, funcao, tipo_contrato, cpf, telefone, email,
            valor_dia, ativo, contact_id, observacoes
       FROM romatec_obra_equipe WHERE id = ?`,
    [membroId]
  );
  if (!rows.length) {
    return { ok: false, contactId: null, memoryId: null, skipped: 'membro_nao_encontrado', message: `membro ${membroId} não encontrado` };
  }
  const m = rows[0];

  // 2) Sem telefone → não dá pra sincronizar com contacts (UNIQUE phone)
  // Memória ainda assim é gravada (útil pra ZAYRA mesmo sem contato).
  const phone = (m.telefone || '').replace(/\D/g, '');
  let contactId: number | null = null;

  if (phone) {
    // Phone normalizado pra match: contacts.phone tem formato variado, fazemos
    // lookup por sufixo de 10 dígitos (DDD + número) pra cobrir 5598... vs 98...
    const sufixo10 = phone.slice(-11); // 9-dígitos + DDD = 11 (BR celular)
    const tratamento = inferirTratamento(m.funcao);
    const tom = m.tipo_contrato === 'pj' || tratamento === 'Eng.' || tratamento === 'Arq.' || tratamento === 'Dr.'
      ? 'formal' : 'informal';
    const tipo = 'colaborador';
    const tags = JSON.stringify(['equipe_romatec', `cargo_${(m.funcao || 'sem_cargo').toLowerCase().replace(/\s+/g, '_')}`]);

    // Busca contact existente via:
    //   a) já vinculado (contact_id na equipe)
    //   b) phone exato
    //   c) phone com mesmo sufixo de 10 dígitos
    let existingId: number | null = null;
    if (m.contact_id) {
      const [c] = await pool.execute<ContactRow[]>('SELECT id, phone FROM contacts WHERE id = ?', [m.contact_id]);
      if (c.length) existingId = c[0].id;
    }
    if (!existingId) {
      const [c] = await pool.execute<ContactRow[]>(
        `SELECT id, phone FROM contacts
          WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), ' ', '') LIKE ?
          ORDER BY id ASC LIMIT 1`,
        [`%${sufixo10}`]
      );
      if (c.length) existingId = c[0].id;
    }

    if (existingId) {
      contactId = existingId;
      await pool.execute(
        `UPDATE contacts
            SET name = ?, email = COALESCE(?, email),
                tratamento = ?, tipo = ?,
                tom = COALESCE(tom, ?),
                tags = ?
          WHERE id = ?`,
        [m.nome, m.email, tratamento, tipo, tom, tags, existingId]
      );
    } else {
      const [r] = await pool.execute<ResultSetHeader>(
        `INSERT INTO contacts (name, phone, email, tratamento, tipo, tom, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [m.nome, phone, m.email, tratamento, tipo, tom, tags]
      );
      contactId = r.insertId;
    }

    // Vincula no membro se ainda não vinculado
    if (m.contact_id !== contactId) {
      await pool.execute(
        `UPDATE romatec_obra_equipe SET contact_id = ? WHERE id = ?`,
        [contactId, membroId]
      );
    }
  }

  // 3) Sync zayra_memory — idempotência via tag única `equipe_membro_id_<id>`
  const tagUnica = `equipe_membro_id_${membroId}`;
  const tags = `colaborador,${tagUnica}`;
  const conteudo = m.ativo
    ? `${m.nome} é colaborador da Romatec` +
      (m.funcao        ? `, cargo ${m.funcao}` : '') +
      (m.tipo_contrato ? `, vínculo ${m.tipo_contrato}` : '') +
      (m.telefone      ? `, telefone ${m.telefone}` : '') +
      (m.cpf           ? `, CPF ${m.cpf}` : '') + '.'
    : `${m.nome} foi colaborador da Romatec, atualmente inativo` +
      (m.funcao ? ` (cargo: ${m.funcao})` : '') + '.';

  const [memRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM zayra_memory WHERE relevance_tags LIKE ? LIMIT 1`,
    [`%${tagUnica}%`]
  );
  let memoryId: number;
  if (memRows.length) {
    memoryId = Number(memRows[0].id);
    await pool.execute(
      `UPDATE zayra_memory SET content = ?, relevance_tags = ?, updated_at = NOW() WHERE id = ?`,
      [conteudo, tags, memoryId]
    );
  } else {
    const [r] = await pool.execute<ResultSetHeader>(
      `INSERT INTO zayra_memory (type, content, relevance_tags) VALUES ('fact', ?, ?)`,
      [conteudo, tags]
    );
    memoryId = r.insertId;
  }

  // Invalida cache de contexto da memória (usa import dinâmico pra evitar
  // dependência circular entre services e agent/memory)
  void import('../agent/memory').then(m => m.invalidateContextCache?.()).catch(() => {});

  console.log(`[SYNC] equipe.id=${membroId} → contacts.id=${contactId ?? 'pulado(sem-tel)'} → zayra_memory.id=${memoryId}`);

  return {
    ok: true,
    contactId,
    memoryId,
    skipped: contactId === null ? 'sem_telefone' : undefined,
    message: contactId
      ? `Sync ok: contact #${contactId}, memória #${memoryId}.`
      : `Sync parcial: sem telefone — só memória #${memoryId} foi gravada.`,
  };
}

// Helper: re-sincroniza TODA a equipe (útil pra backfill após esta migração).
// Não chamado automaticamente — disparado manualmente por endpoint /api/equipe/sync-all.
export async function syncTodaEquipe(): Promise<{ total: number; sucesso: number; pulados: number; falhas: number }> {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT id FROM romatec_obra_equipe ORDER BY id ASC`);
  let sucesso = 0, pulados = 0, falhas = 0;
  for (const r of rows) {
    try {
      const res = await syncEquipeMembro(Number(r.id));
      if (res.skipped === 'sem_telefone') pulados++;
      else if (res.ok) sucesso++;
      else falhas++;
    } catch (err) {
      console.warn(`[SYNC] falhou para equipe.id=${r.id}:`, (err as Error).message);
      falhas++;
    }
  }
  return { total: rows.length, sucesso, pulados, falhas };
}
