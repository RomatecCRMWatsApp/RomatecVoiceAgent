// v3.125.0 — Repositório do módulo "Diário de Obra".
//
// Entrada de diário = uma visita técnica vinculada a UMA obra, com os três
// campos livres (observações / pendências / solicitações do proprietário) e
// anexos (foto / arquivo / desenho) gravados como base64 no MySQL. A cascata
// dos anexos ao excluir o diário é feita aqui na aplicação (sem FK dura, na
// convenção do projeto — ver migrations-diario-obra.ts).

import pool from '../../database/connection';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// ── Tipos ────────────────────────────────────────────────────────────────────
export type CampoReferencia = 'observacoes' | 'pendencias' | 'solicitacoes_proprietario' | 'geral';
export type TipoAnexo = 'foto' | 'arquivo' | 'desenho';

export interface AnexoResumo {
  id: number; diario_id: number; tipo: TipoAnexo; campo_referencia: CampoReferencia;
  nome_original: string | null; mime_type: string | null; tamanho_bytes: number | null;
  created_at: string;
}

export interface DiarioObra {
  id: number; obra_id: number; obra_nome: string | null;
  colaborador_nome: string | null; user_sub: string | null; colaborador_equipe_id: number | null;
  data_visita: string; hora_visita: string;
  observacoes: string | null; pendencias: string | null; solicitacoes_proprietario: string | null;
  created_at: string; updated_at: string;
  anexos_count?: number;
  anexos?: AnexoResumo[];
}

export interface NovoDiario {
  obra_id: number;
  user_sub?: string | null;
  colaborador_equipe_id?: number | null;
  colaborador_nome?: string | null;
  data_visita: string;   // YYYY-MM-DD
  hora_visita: string;   // HH:MM ou HH:MM:SS
  observacoes?: string | null;
  pendencias?: string | null;
  solicitacoes_proprietario?: string | null;
}

export interface NovoAnexo {
  tipo: TipoAnexo;
  campo_referencia?: CampoReferencia;
  arquivo_b64: string;   // sem prefixo data:
  nome_original?: string | null;
  mime_type?: string | null;
  tamanho_bytes?: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function toIsoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}
function toTime(v: unknown): string {
  const s = String(v ?? '');
  return s.length >= 5 ? s.slice(0, 8) : s;
}

// ── Leitura ──────────────────────────────────────────────────────────────────
// Lista entradas com filtros opcionais (obra_id / data_inicio / data_fim),
// mais recentes primeiro, com contagem de anexos e nome da obra.
export async function listarDiarios(filtros: {
  obra_id?: number | null; data_inicio?: string | null; data_fim?: string | null;
} = {}): Promise<DiarioObra[]> {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filtros.obra_id != null) { where.push('d.obra_id = ?'); params.push(filtros.obra_id); }
  if (filtros.data_inicio) { where.push('d.data_visita >= ?'); params.push(String(filtros.data_inicio).slice(0, 10)); }
  if (filtros.data_fim) { where.push('d.data_visita <= ?'); params.push(String(filtros.data_fim).slice(0, 10)); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT d.*, o.nome AS obra_nome,
            (SELECT COUNT(*) FROM diarios_obra_anexos a WHERE a.diario_id = d.id) AS anexos_count
       FROM diarios_obra d
       LEFT JOIN romatec_obras o ON o.id = d.obra_id
       ${clause}
      ORDER BY d.data_visita DESC, d.hora_visita DESC, d.id DESC
      LIMIT 500`,
    params,
  );
  return rows.map(mapDiario);
}

// Entradas de UMA obra (para a aba dentro da obra).
export async function listarDiariosDaObra(obraId: number): Promise<DiarioObra[]> {
  return listarDiarios({ obra_id: obraId });
}

// Detalhe completo: entrada + anexos (metadados, sem o base64).
export async function obterDiario(id: number): Promise<DiarioObra | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT d.*, o.nome AS obra_nome
       FROM diarios_obra d
       LEFT JOIN romatec_obras o ON o.id = d.obra_id
      WHERE d.id = ? LIMIT 1`,
    [id],
  );
  if (!rows.length) return null;
  const diario = mapDiario(rows[0]);
  diario.anexos = await listarAnexos(id);
  return diario;
}

export async function listarAnexos(diarioId: number): Promise<AnexoResumo[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, diario_id, tipo, campo_referencia, nome_original, mime_type, tamanho_bytes, created_at
       FROM diarios_obra_anexos WHERE diario_id = ? ORDER BY id ASC`,
    [diarioId],
  );
  return rows as unknown as AnexoResumo[];
}

// Dono do lançamento (pra checar permissão de edição/exclusão).
export async function donoDoDiario(id: number): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT user_sub FROM diarios_obra WHERE id = ? LIMIT 1`, [id],
  );
  return rows.length ? (rows[0].user_sub ?? null) : null;
}

// Bytes de um anexo (pra servir foto/arquivo/desenho).
export async function obterAnexoB64(anexoId: number): Promise<{ arquivo_b64: string; mime_type: string | null; nome_original: string | null } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT arquivo_b64, mime_type, nome_original FROM diarios_obra_anexos WHERE id = ? LIMIT 1`,
    [anexoId],
  );
  if (!rows.length) return null;
  return {
    arquivo_b64: String(rows[0].arquivo_b64 ?? ''),
    mime_type: rows[0].mime_type ?? null,
    nome_original: rows[0].nome_original ?? null,
  };
}

// ── Escrita ──────────────────────────────────────────────────────────────────
export async function criarDiario(input: NovoDiario): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO diarios_obra
       (obra_id, user_sub, colaborador_equipe_id, colaborador_nome,
        data_visita, hora_visita, observacoes, pendencias, solicitacoes_proprietario)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.obra_id,
      input.user_sub ?? null,
      input.colaborador_equipe_id ?? null,
      input.colaborador_nome ?? null,
      String(input.data_visita).slice(0, 10),
      toTime(input.hora_visita) || '00:00:00',
      input.observacoes ?? null,
      input.pendencias ?? null,
      input.solicitacoes_proprietario ?? null,
    ],
  );
  return r.insertId;
}

// Atualiza só os campos passados (undefined = não mexe).
export async function atualizarDiario(id: number, campos: {
  data_visita?: string; hora_visita?: string;
  observacoes?: string | null; pendencias?: string | null; solicitacoes_proprietario?: string | null;
}): Promise<void> {
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  if (campos.data_visita !== undefined) { sets.push('data_visita = ?'); vals.push(String(campos.data_visita).slice(0, 10)); }
  if (campos.hora_visita !== undefined) { sets.push('hora_visita = ?'); vals.push(toTime(campos.hora_visita) || '00:00:00'); }
  if (campos.observacoes !== undefined) { sets.push('observacoes = ?'); vals.push(campos.observacoes); }
  if (campos.pendencias !== undefined) { sets.push('pendencias = ?'); vals.push(campos.pendencias); }
  if (campos.solicitacoes_proprietario !== undefined) { sets.push('solicitacoes_proprietario = ?'); vals.push(campos.solicitacoes_proprietario); }
  if (!sets.length) return;
  vals.push(id);
  await pool.execute(`UPDATE diarios_obra SET ${sets.join(', ')} WHERE id = ?`, vals);
}

// Exclui a entrada e, em cascata (aplicação), todos os anexos e assinaturas.
// v3.128.0: as assinaturas formais (diario_obra_assinaturas) caem junto — a
// tabela é do mesmo módulo e não tem FK dura (convenção do Diário de Obra).
export async function excluirDiario(id: number): Promise<void> {
  await pool.execute(`DELETE FROM diarios_obra_anexos WHERE diario_id = ?`, [id]);
  await pool.execute(`DELETE FROM diario_obra_assinaturas WHERE diario_id = ?`, [id]);
  await pool.execute(`DELETE FROM diarios_obra WHERE id = ?`, [id]);
}

export async function adicionarAnexos(diarioId: number, anexos: NovoAnexo[]): Promise<number[]> {
  const ids: number[] = [];
  for (const a of anexos) {
    const [r] = await pool.execute<ResultSetHeader>(
      `INSERT INTO diarios_obra_anexos
         (diario_id, tipo, campo_referencia, arquivo_b64, nome_original, mime_type, tamanho_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        diarioId, a.tipo, a.campo_referencia ?? 'geral',
        a.arquivo_b64.replace(/^data:[^,]+,/, ''),
        a.nome_original ?? null, a.mime_type ?? null, a.tamanho_bytes ?? null,
      ],
    );
    ids.push(r.insertId);
  }
  return ids;
}

export async function excluirAnexo(anexoId: number): Promise<void> {
  await pool.execute(`DELETE FROM diarios_obra_anexos WHERE id = ?`, [anexoId]);
}

// Existe a obra? (valida vínculo obrigatório antes de criar)
export async function obraExiste(obraId: number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM romatec_obras WHERE id = ? LIMIT 1`, [obraId],
  );
  return rows.length > 0;
}

// ── Mapeamento ───────────────────────────────────────────────────────────────
function mapDiario(r: RowDataPacket): DiarioObra {
  return {
    id: Number(r.id),
    obra_id: Number(r.obra_id),
    obra_nome: r.obra_nome ?? null,
    colaborador_nome: r.colaborador_nome ?? null,
    user_sub: r.user_sub ?? null,
    colaborador_equipe_id: r.colaborador_equipe_id != null ? Number(r.colaborador_equipe_id) : null,
    data_visita: toIsoDate(r.data_visita),
    hora_visita: toTime(r.hora_visita),
    observacoes: r.observacoes ?? null,
    pendencias: r.pendencias ?? null,
    solicitacoes_proprietario: r.solicitacoes_proprietario ?? null,
    created_at: String(r.created_at ?? ''),
    updated_at: String(r.updated_at ?? ''),
    anexos_count: r.anexos_count != null ? Number(r.anexos_count) : undefined,
  };
}
