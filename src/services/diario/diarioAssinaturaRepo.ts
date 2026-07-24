// src/services/diario/diarioAssinaturaRepo.ts
// v3.128.0 — Assinatura formal do Diário de Obra (persistência + hash).
//
// Um registro = um ato de assinatura de UMA entrada de diário. O hash SHA-256
// sela o conteúdo assinado (mesmo padrão do vale/recibo/entrega —
// createHash('sha256')): entra a identificação do diário, o texto CONGELADO no
// momento, a qualificação do signatário, o carimbo temporal e a impressão da
// própria rubrica. Assim, editar o diário depois não "valida" retroativamente
// uma assinatura antiga, e a página pública confere o hash contra o snapshot.

import pool from '../../database/connection';
import { createHash } from 'crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export type PapelSignatario = 'proprietario' | 'responsavel';
export type StatusAssinatura = 'assinado' | 'anulado';

/** Conteúdo do diário congelado no instante da assinatura. */
export interface SnapshotDiario {
  diario_id: number;
  obra_id: number | null;
  obra_nome: string | null;
  data_visita: string;
  hora_visita: string;
  observacoes: string | null;
  pendencias: string | null;
  solicitacoes_proprietario: string | null;
}

export interface NovaAssinatura {
  diario_id: number;
  obra_id?: number | null;
  signatario_nome: string;
  signatario_cpf?: string | null;
  signatario_papel: PapelSignatario;
  assinatura_b64: string;      // PNG base64 (com ou sem prefixo data:)
  snapshot: SnapshotDiario;
  assinado_em?: string | null; // ISO; default = agora
  latitude?: number | null;
  longitude?: number | null;
  local_texto?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  criado_por?: string | null;
}

export interface Assinatura {
  id: number;
  diario_id: number;
  obra_id: number | null;
  signatario_nome: string;
  signatario_cpf: string | null;
  signatario_papel: PapelSignatario;
  assinatura_b64: string;
  hash_validacao: string;
  snapshot: SnapshotDiario | null;
  assinado_em: string;
  latitude: number | null;
  longitude: number | null;
  local_texto: string | null;
  status: StatusAssinatura;
  criado_por: string | null;
  criado_em: string;
}

// ── Hash ─────────────────────────────────────────────────────────────────────
/** Remove o prefixo `data:...;base64,` se vier — guardamos só o base64 puro. */
export function apenasBase64(s?: string | null): string {
  if (!s) return '';
  const m = /^data:[^;]+;base64,(.*)$/s.exec(s);
  return m ? m[1] : s;
}

export interface PayloadHash {
  diario_id: number;
  obra_id: number | null;
  data_visita: string;
  hora_visita: string;
  observacoes: string | null;
  pendencias: string | null;
  solicitacoes_proprietario: string | null;
  signatario_nome: string;
  signatario_cpf: string | null;
  signatario_papel: PapelSignatario;
  assinado_em: string;      // ISO canônico (segundos + Z) — ver canonicalizarInstante
  assinatura_b64: string;   // rubrica (com ou sem prefixo data:)
}

/**
 * Normaliza um instante em DUAS formas que casam 1:1 ao voltar do MySQL:
 *   - iso: 'YYYY-MM-DDTHH:MM:SSZ' (segundos, UTC) — entra no hash;
 *   - sql: 'YYYY-MM-DD HH:MM:SS'  — literal inserido na coluna DATETIME.
 * A leitura reconstrói o iso via DATE_FORMAT(..., '%Y-%m-%dT%H:%i:%sZ'), sem
 * conversão de fuso (o mesmo wall-clock que foi gravado), então o hash sempre
 * reconfere. Sem isto, o Date que o mysql2 devolve traria .000 e o fuso do
 * processo, e conferirIntegridade falharia fora do container UTC.
 */
export function canonicalizarInstante(iso?: string | null): { iso: string; sql: string } {
  const d = iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const mo = p(d.getUTCMonth() + 1);
  const da = p(d.getUTCDate());
  const h = p(d.getUTCHours());
  const mi = p(d.getUTCMinutes());
  const se = p(d.getUTCSeconds());
  return { iso: `${y}-${mo}-${da}T${h}:${mi}:${se}Z`, sql: `${y}-${mo}-${da} ${h}:${mi}:${se}` };
}

/**
 * SHA-256 hex do documento assinado. String canônica com separador `|` — a
 * mesma entrada gera sempre o mesmo hash (determinístico e testável), e a
 * rubrica entra pela sua impressão SHA-256, não crua, pra não inchar o payload.
 */
export function gerarHashAssinatura(p: PayloadHash): string {
  const rubricaHash = createHash('sha256').update(apenasBase64(p.assinatura_b64)).digest('hex');
  const base = [
    'DIARIO-OBRA-ASSINATURA-V1',
    p.diario_id,
    p.obra_id ?? '',
    p.data_visita,
    p.hora_visita,
    p.observacoes ?? '',
    p.pendencias ?? '',
    p.solicitacoes_proprietario ?? '',
    p.signatario_nome.trim(),
    (p.signatario_cpf ?? '').replace(/\D/g, ''),
    p.signatario_papel,
    p.assinado_em,
    rubricaHash,
  ].join('|');
  return createHash('sha256').update(base).digest('hex');
}

/** Máscara de CPF (11 díg.) ou CNPJ (14). Não-documento passa intacto. */
export function formatarDocumento(doc?: string | null): string {
  const d = String(doc ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return String(doc ?? '').trim();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v ?? '');
}
function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Escrita ──────────────────────────────────────────────────────────────────
/**
 * Cria a assinatura: calcula o hash sobre o snapshot congelado e insere. Se por
 * corrida dois hashes iguais colidirem (mesmo diário + mesma rubrica + mesmo
 * instante), o UNIQUE barra — improvável, mas a rota traduz para 409.
 */
export async function criarAssinatura(input: NovaAssinatura): Promise<{ id: number; hash: string; assinado_em: string }> {
  const ts = canonicalizarInstante(input.assinado_em);

  const hash = gerarHashAssinatura({
    diario_id: input.diario_id,
    obra_id: input.obra_id ?? null,
    data_visita: input.snapshot.data_visita,
    hora_visita: input.snapshot.hora_visita,
    observacoes: input.snapshot.observacoes,
    pendencias: input.snapshot.pendencias,
    solicitacoes_proprietario: input.snapshot.solicitacoes_proprietario,
    signatario_nome: input.signatario_nome,
    signatario_cpf: input.signatario_cpf ?? null,
    signatario_papel: input.signatario_papel,
    assinado_em: ts.iso,
    assinatura_b64: input.assinatura_b64,
  });

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO diario_obra_assinaturas
       (diario_id, obra_id, signatario_nome, signatario_cpf, signatario_papel,
        assinatura_b64, hash_validacao, snapshot_json, assinado_em,
        latitude, longitude, local_texto, ip, user_agent, criado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.diario_id,
      input.obra_id ?? null,
      input.signatario_nome.trim().slice(0, 255),
      input.signatario_cpf ? String(input.signatario_cpf).slice(0, 24) : null,
      input.signatario_papel,
      apenasBase64(input.assinatura_b64),
      hash,
      JSON.stringify(input.snapshot),
      ts.sql,
      num(input.latitude),
      num(input.longitude),
      input.local_texto ? String(input.local_texto).slice(0, 255) : null,
      input.ip ? String(input.ip).slice(0, 64) : null,
      input.user_agent ? String(input.user_agent).slice(0, 255) : null,
      input.criado_por ? String(input.criado_por).slice(0, 64) : null,
    ],
  );
  return { id: r.insertId, hash, assinado_em: ts.iso };
}

export async function anularAssinatura(id: number): Promise<void> {
  await pool.execute(`UPDATE diario_obra_assinaturas SET status = 'anulado' WHERE id = ?`, [id]);
}

/** Cascata de assinaturas ao excluir o diário (chamada por excluirDiario). */
export async function excluirAssinaturasDoDiario(diarioId: number): Promise<void> {
  await pool.execute(`DELETE FROM diario_obra_assinaturas WHERE diario_id = ?`, [diarioId]);
}

// ── Leitura ──────────────────────────────────────────────────────────────────
function mapRow(r: RowDataPacket, comRubrica = true): Assinatura {
  let snapshot: SnapshotDiario | null = null;
  if (r.snapshot_json) {
    try { snapshot = JSON.parse(String(r.snapshot_json)); } catch { snapshot = null; }
  }
  return {
    id: Number(r.id),
    diario_id: Number(r.diario_id),
    obra_id: r.obra_id != null ? Number(r.obra_id) : null,
    signatario_nome: String(r.signatario_nome ?? ''),
    signatario_cpf: r.signatario_cpf ?? null,
    signatario_papel: (r.signatario_papel ?? 'proprietario') as PapelSignatario,
    assinatura_b64: comRubrica ? String(r.assinatura_b64 ?? '') : '',
    hash_validacao: String(r.hash_validacao ?? ''),
    snapshot,
    // assinado_em_iso vem do DATE_FORMAT (mesmo wall-clock gravado, rótulo Z) —
    // é a forma que reconfere o hash. Fallback pro Date cru só por robustez.
    assinado_em: r.assinado_em_iso ? String(r.assinado_em_iso) : toIso(r.assinado_em),
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    local_texto: r.local_texto ?? null,
    status: (r.status ?? 'assinado') as StatusAssinatura,
    criado_por: r.criado_por ?? null,
    criado_em: toIso(r.criado_em),
  };
}

/** Assinaturas de uma entrada (metadados, sem a rubrica pesada por padrão). */
const ISO_FMT = `DATE_FORMAT(assinado_em, '%Y-%m-%dT%H:%i:%sZ') AS assinado_em_iso`;

export async function listarAssinaturasDoDiario(diarioId: number, comRubrica = false): Promise<Assinatura[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT *, ${ISO_FMT} FROM diario_obra_assinaturas WHERE diario_id = ? ORDER BY assinado_em ASC, id ASC`,
    [diarioId],
  );
  return rows.map((r) => mapRow(r, comRubrica));
}

/** Resolve UMA assinatura pelo hash público (página /v/diario/:hash). */
export async function buscarPorHash(hash: string): Promise<Assinatura | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT *, ${ISO_FMT} FROM diario_obra_assinaturas WHERE hash_validacao = ? LIMIT 1`,
    [String(hash).trim().toLowerCase()],
  );
  return rows.length ? mapRow(rows[0], true) : null;
}

export async function obterAssinatura(id: number): Promise<Assinatura | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT *, ${ISO_FMT} FROM diario_obra_assinaturas WHERE id = ? LIMIT 1`, [id],
  );
  return rows.length ? mapRow(rows[0], true) : null;
}

/** Reconfere o hash de uma assinatura contra o snapshot gravado. */
export function conferirIntegridade(a: Assinatura): boolean {
  if (!a.snapshot) return false;
  const recomputado = gerarHashAssinatura({
    diario_id: a.snapshot.diario_id,
    obra_id: a.snapshot.obra_id,
    data_visita: a.snapshot.data_visita,
    hora_visita: a.snapshot.hora_visita,
    observacoes: a.snapshot.observacoes,
    pendencias: a.snapshot.pendencias,
    solicitacoes_proprietario: a.snapshot.solicitacoes_proprietario,
    signatario_nome: a.signatario_nome,
    signatario_cpf: a.signatario_cpf,
    signatario_papel: a.signatario_papel,
    assinado_em: a.assinado_em,
    assinatura_b64: a.assinatura_b64,
  });
  return recomputado === a.hash_validacao;
}
