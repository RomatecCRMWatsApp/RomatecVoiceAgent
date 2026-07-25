// v3.129.0 — Persistência dos cálculos de Dutching / Arbitragem da ZAYRA.
//
// Escopo SEMPRE restrito ao user_sub da sessão (o `sub` do JWT). Persistência é
// acessória: a rota /calcular trata falha de INSERT devolvendo o cálculo com
// id: null (ver arbitragem.ts). Sem FK dura, na convenção do projeto.
import pool from '../database/connection';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { ResultadoArbitragem } from './arbitragemService';

export interface RegistroArbitragem {
  id: number;
  evento: string | null;
  modo: 'capital' | 'lucro_alvo';
  capital: number;
  lucro_alvo: number | null;
  soma_implicita: number;
  margem_percentual: number;
  arbitragem: boolean;
  lucro_minimo: number;
  roi_percentual: number;
  entradas: unknown;
  alocacoes: unknown;
  criado_em: string;
}

// Grava um cálculo. `lucroAlvo` só é informado no fluxo /por-lucro.
export async function registrar(
  userSub: string,
  resultado: ResultadoArbitragem,
  lucroAlvo: number | null = null,
): Promise<number> {
  const modo: 'capital' | 'lucro_alvo' = lucroAlvo != null ? 'lucro_alvo' : 'capital';
  const entradas = resultado.alocacoes.map((a) => ({ rotulo: a.rotulo, odd: a.odd, casa: a.casa }));

  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO zayra_arbitragem_calculos
       (user_sub, evento, modo, capital, lucro_alvo, soma_implicita, margem_percentual,
        arbitragem, lucro_minimo, roi_percentual, entradas_json, alocacoes_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userSub,
      resultado.evento,
      modo,
      resultado.capital,
      lucroAlvo,
      resultado.somaImplicita,
      resultado.margemPercentual,
      resultado.arbitragem ? 1 : 0,
      resultado.lucroMinimo,
      resultado.roiPercentual,
      JSON.stringify(entradas),
      JSON.stringify(resultado.alocacoes),
    ],
  );
  return res.insertId;
}

function parseJson(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v; // mysql2 pode já devolver objeto pra colunas JSON
}

export async function listar(
  userSub: string,
  limite = 30,
  offset = 0,
): Promise<RegistroArbitragem[]> {
  const lim = Math.min(200, Math.max(1, Math.trunc(limite) || 30));
  const off = Math.max(0, Math.trunc(offset) || 0);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, evento, modo, capital, lucro_alvo, soma_implicita, margem_percentual,
            arbitragem, lucro_minimo, roi_percentual, entradas_json, alocacoes_json, criado_em
       FROM zayra_arbitragem_calculos
      WHERE user_sub = ?
      ORDER BY criado_em DESC, id DESC
      LIMIT ? OFFSET ?`,
    [userSub, lim, off],
  );
  return rows.map((r) => ({
    id: r.id,
    evento: r.evento,
    modo: r.modo,
    capital: Number(r.capital),
    lucro_alvo: r.lucro_alvo != null ? Number(r.lucro_alvo) : null,
    soma_implicita: Number(r.soma_implicita),
    margem_percentual: Number(r.margem_percentual),
    arbitragem: !!r.arbitragem,
    lucro_minimo: Number(r.lucro_minimo),
    roi_percentual: Number(r.roi_percentual),
    entradas: parseJson(r.entradas_json),
    alocacoes: parseJson(r.alocacoes_json),
    criado_em: String(r.criado_em),
  }));
}

// Exclui só se pertencer ao usuário. Retorna false se não achou/não é dele.
export async function excluir(userSub: string, id: number): Promise<boolean> {
  const [res] = await pool.execute<ResultSetHeader>(
    `DELETE FROM zayra_arbitragem_calculos WHERE id = ? AND user_sub = ?`,
    [id, userSub],
  );
  return res.affectedRows > 0;
}
