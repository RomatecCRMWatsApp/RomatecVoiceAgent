// src/services/reformaPiso/reformaPisoRepo.ts
// v3.67.0: persistência MySQL2 da Proposta de Reforma — Piso Sobreposto.
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
