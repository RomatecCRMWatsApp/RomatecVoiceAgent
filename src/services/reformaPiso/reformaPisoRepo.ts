// src/services/reformaPiso/reformaPisoRepo.ts
// v3.67.0: persistência MySQL2 da Proposta de Reforma — Piso Sobreposto.
import { randomBytes } from 'crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool from '../../database/connection';
import { ConfigCalculo, DadosProposta, ResultadoCalculo, TemaProposta } from './reformaPisoTypes';

const ANO = () => new Date().getFullYear();

/**
 * Gera número sequencial PROP-REF-AAAA-NNNN-R1 (escopo: tabela de reforma).
 * Prefixo "REF" evita colisão com a numeração das propostas de consultoria (PROP-AAAA-NNNN).
 */
export async function proximoNumero(): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT numero FROM propostas_reforma_piso
     WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`,
    [`PROP-REF-${ANO()}-%`],
  );
  let seq = 1;
  if (rows.length) {
    const m = /PROP-REF-\d{4}-(\d{4})/.exec(rows[0].numero as string);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `PROP-REF-${ANO()}-${String(seq).padStart(4, '0')}-R1`;
}

export interface PropostaSalva {
  id: number;
  numero: string;
}

export async function salvar(
  dados: DadosProposta,
  cfg: ConfigCalculo,
  r: ResultadoCalculo,
  tema: TemaProposta,
): Promise<PropostaSalva> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const numero = await proximoNumero();

    const [head] = await conn.query<ResultSetHeader>(
      `INSERT INTO propostas_reforma_piso
        (numero, cliente_id, contratante_nome, contratante_doc, contratante_fone,
         obra_endereco, cidade, uf, com_remocao, config_json, resultado_json,
         area_total_m2, prazo_dias_uteis, mao_obra_m2, bdi_pct,
         valor_materiais, valor_mao_obra, valor_final, valor_m2_final,
         validade_dias, tema, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'calculada')`,
      [
        numero, null, dados.contratanteNome, dados.contratanteDoc ?? null,
        dados.contratanteFone ?? null, dados.obraEndereco ?? null,
        dados.cidade ?? 'Açailândia', dados.uf ?? 'MA',
        dados.comRemocao ? 1 : 0, JSON.stringify(cfg), JSON.stringify(r),
        r.areaTotalM2, r.prazoDiasUteis, r.maoObraM2, r.bdiPct,
        r.valorMateriais, r.valorMaoObra, r.valorFinal, r.valorM2Final,
        dados.validadeDias ?? 15, tema,
      ],
    );
    const propostaId = head.insertId;

    for (let i = 0; i < r.ambientes.length; i++) {
      const a = r.ambientes[i];
      await conn.query<ResultSetHeader>(
        `INSERT INTO propostas_reforma_piso_ambientes
          (proposta_id, descricao, comprimento_m, largura_m, area_m2, ordem)
         VALUES (?,?,?,?,?,?)`,
        [propostaId, a.descricao, a.comprimentoM, a.larguraM, a.areaM2, i],
      );
    }

    await conn.commit();
    return { id: propostaId, numero };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function buscarPorId(id: number) {
  const [head] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM propostas_reforma_piso WHERE id = ?`, [id],
  );
  if (!head.length) return null;
  const [amb] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM propostas_reforma_piso_ambientes WHERE proposta_id = ? ORDER BY ordem`, [id],
  );
  return { ...head[0], ambientes: amb };
}

export async function marcarEnviada(id: number) {
  await pool.query(`UPDATE propostas_reforma_piso SET status='enviada' WHERE id=?`, [id]);
}

// ── v3.68.0: Relatório fotográfico (fotos base64) ───────────────────────────
export interface FotoMeta { id: number; legenda: string | null; mime: string; ordem: number; }

export async function adicionarFoto(
  propostaId: number, mime: string, dataBase64: string, legenda?: string | null,
): Promise<{ id: number; ordem: number }> {
  const [c] = await pool.query<RowDataPacket[]>(
    'SELECT COALESCE(MAX(ordem), -1) + 1 AS prox FROM propostas_reforma_piso_fotos WHERE proposta_id = ?',
    [propostaId],
  );
  const ordem = Number((c[0] as { prox: number }).prox);
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO propostas_reforma_piso_fotos (proposta_id, legenda, mime, data_base64, ordem)
     VALUES (?,?,?,?,?)`,
    [propostaId, legenda ?? null, mime, dataBase64, ordem],
  );
  return { id: r.insertId, ordem };
}

export async function listarFotos(propostaId: number): Promise<FotoMeta[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, legenda, mime, ordem FROM propostas_reforma_piso_fotos WHERE proposta_id = ? ORDER BY ordem, id',
    [propostaId],
  );
  return rows.map((r) => ({ id: Number(r.id), legenda: r.legenda as string | null, mime: String(r.mime), ordem: Number(r.ordem) }));
}

/** Fotos com base64 (para embutir no PDF). */
export async function carregarFotosBase64(propostaId: number): Promise<Array<{ mime: string; dataBase64: string; legenda: string | null }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT mime, data_base64, legenda FROM propostas_reforma_piso_fotos WHERE proposta_id = ? ORDER BY ordem, id',
    [propostaId],
  );
  return rows.map((r) => ({ mime: String(r.mime), dataBase64: String(r.data_base64), legenda: r.legenda as string | null }));
}

export async function fotoRaw(fotoId: number): Promise<{ mime: string; buffer: Buffer } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT mime, data_base64 FROM propostas_reforma_piso_fotos WHERE id = ?', [fotoId],
  );
  if (!rows.length) return null;
  return { mime: String(rows[0].mime), buffer: Buffer.from(String(rows[0].data_base64), 'base64') };
}

export async function removerFoto(propostaId: number, fotoId: number): Promise<number> {
  const [r] = await pool.query<ResultSetHeader>(
    'DELETE FROM propostas_reforma_piso_fotos WHERE id = ? AND proposta_id = ?', [fotoId, propostaId],
  );
  return r.affectedRows;
}

// ── v3.68.0: Anexos de plantas (LONGBLOB + token) ───────────────────────────
export interface AnexoMeta {
  id: number; nome_original: string; mime_type: string; tamanho_bytes: number;
  is_imagem: boolean; download_token: string; created_at: string;
}

export async function adicionarAnexoPlanta(
  propostaId: number, nomeOriginal: string, mimeType: string, conteudo: Buffer,
): Promise<{ id: number; token: string }> {
  const token = randomBytes(32).toString('hex');
  const isImagem = /^image\//i.test(mimeType) ? 1 : 0;
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO propostas_reforma_piso_anexos
       (proposta_id, nome_original, mime_type, tamanho_bytes, is_imagem, conteudo_blob, download_token)
     VALUES (?,?,?,?,?,?,?)`,
    [propostaId, nomeOriginal, mimeType, conteudo.length, isImagem, conteudo, token],
  );
  return { id: r.insertId, token };
}

export async function listarAnexos(propostaId: number): Promise<AnexoMeta[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, nome_original, mime_type, tamanho_bytes, is_imagem, download_token, created_at
       FROM propostas_reforma_piso_anexos WHERE proposta_id = ? ORDER BY id`,
    [propostaId],
  );
  return rows.map((r) => ({
    id: Number(r.id), nome_original: String(r.nome_original), mime_type: String(r.mime_type),
    tamanho_bytes: Number(r.tamanho_bytes), is_imagem: !!r.is_imagem,
    download_token: String(r.download_token),
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** Imagens de planta (buffer) para embutir no PDF. */
export async function carregarPlantasImagens(propostaId: number): Promise<Array<{ nome: string; buffer: Buffer }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT nome_original, conteudo_blob FROM propostas_reforma_piso_anexos WHERE proposta_id = ? AND is_imagem = 1 ORDER BY id',
    [propostaId],
  );
  return rows.map((r) => ({ nome: String(r.nome_original), buffer: r.conteudo_blob as Buffer }));
}

export async function anexoRaw(anexoId: number): Promise<{ mime: string; nome: string; buffer: Buffer } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT mime_type, nome_original, conteudo_blob FROM propostas_reforma_piso_anexos WHERE id = ?', [anexoId],
  );
  if (!rows.length) return null;
  return { mime: String(rows[0].mime_type), nome: String(rows[0].nome_original), buffer: rows[0].conteudo_blob as Buffer };
}

export async function anexoPorToken(token: string): Promise<{ mime: string; nome: string; buffer: Buffer } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT mime_type, nome_original, conteudo_blob FROM propostas_reforma_piso_anexos WHERE download_token = ?', [token],
  );
  if (!rows.length) return null;
  return { mime: String(rows[0].mime_type), nome: String(rows[0].nome_original), buffer: rows[0].conteudo_blob as Buffer };
}

export async function removerAnexo(propostaId: number, anexoId: number): Promise<number> {
  const [r] = await pool.query<ResultSetHeader>(
    'DELETE FROM propostas_reforma_piso_anexos WHERE id = ? AND proposta_id = ?', [anexoId, propostaId],
  );
  return r.affectedRows;
}
