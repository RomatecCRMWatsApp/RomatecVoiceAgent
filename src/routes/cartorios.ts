// v3.22.0: endpoint de autocomplete sobre a tabela `cartorios` (CNJ).
// Usado pelo wizard de Proposta de Remembramento ao informar o CRI por imóvel.
import { Router, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';

const router = Router();

interface CartorioRow extends RowDataPacket {
  cns: string;
  denominacao: string;
  uf: string;
  cidade: string;
}

router.get('/autocomplete', async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '').trim();
  const uf = String(req.query.uf ?? '').trim().toUpperCase();

  if (q.length < 2) {
    return res.status(400).json({ error: 'Termo de busca exige no mínimo 2 caracteres' });
  }
  if (uf && !/^[A-Z]{2}$/.test(uf)) {
    return res.status(400).json({ error: 'UF inválida (use 2 letras maiúsculas)' });
  }

  // Normalização espelha o pattern da rota admin (server.ts:2041): cidade_normalizada
  // é uma coluna pré-computada (lowercase sem acento) com índice composto (uf, cidade_normalizada).
  // denominacao é buscado bruto (texto oficial do CNJ).
  const qNorm = q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const params: string[] = [`%${qNorm}%`, `%${q}%`];
  let sql = `
    SELECT cns, denominacao, uf, cidade
      FROM cartorios
     WHERE (cidade_normalizada LIKE ? OR denominacao LIKE ?)
  `;
  if (uf) {
    sql += ' AND uf = ?';
    params.push(uf);
  }
  sql += ' ORDER BY denominacao LIMIT 10';

  try {
    const [rows] = await pool.execute<CartorioRow[]>(sql, params);
    // Mapeia para shape explícito (não vaza metadata futura ou colunas extras adicionadas ao SELECT)
    return res.json(rows.map(r => ({
      cns: r.cns,
      denominacao: r.denominacao,
      uf: r.uf,
      cidade: r.cidade,
    })));
  } catch (err) {
    console.error('[cartorios/autocomplete]', (err as Error).message);
    return res.status(500).json({ error: 'Falha na busca de cartórios' });
  }
});

export default router;
