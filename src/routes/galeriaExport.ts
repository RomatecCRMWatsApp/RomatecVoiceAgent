// v3.61.x — Exportação da Galeria de fotos de campo para o AvalieImob (Feature 04).
// Auth: service-to-service via X-API-Key (requireApiKey), NÃO o JWT de usuário.
//
// Modelo real (migrations-relatorio-fotografico.ts):
//   relatorios_fotograficos (id, colaborador, municipio, ...)
//   fotos_vistoria (id, relatorio_id, base64_overlay, latitude, longitude,
//                   logradouro, municipio, horario_captura, descricao, colaborador, ordem)
//   → a imagem é o base64_overlay (já com GPS/data carimbados no overlay técnico).
//
// O dono da foto é o `colaborador` (nome). O AvalieImob envia o NOME do avaliador
// na query `colaborador` (ou `user`), e casamos por LIKE.
import { Router, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireApiKey } from '../middleware/requireApiKey';

const router = Router();

async function db() {
  const m = await import('../database/connection');
  return m.default;
}

/**
 * GET /api/galeria/export
 * Headers: X-API-Key
 * Query:
 *   colaborador | user  (nome do avaliador; filtra por LIKE; opcional)
 *   limit  (default 50, max 200)
 *   offset (default 0)
 *   desde  (ISO date — só fotos com horario_captura/criado_em após isso)
 */
router.get('/export', requireApiKey, async (req: Request, res: Response) => {
  try {
    const colaborador = ((req.query.colaborador as string) || (req.query.user as string) || '').trim();
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);
    const desde = (req.query.desde as string | undefined)?.trim();

    // PRIVACIDADE: colaborador é OBRIGATÓRIO. Sem ele, não devolve nada — evita
    // que um chamador liste fotos de todos os avaliadores.
    if (!colaborador) {
      res.json({ fotos: [], total: 0, limit, offset });
      return;
    }

    // Match EXATO (collation utf8mb4 já ignora acento/maiúscula) — evita que o
    // nome de um avaliador como substring vaze fotos de outro.
    const where: string[] = ['f.colaborador = ?'];
    const params: unknown[] = [colaborador];
    if (desde) {
      where.push('(f.horario_captura >= ? OR f.criado_em >= ?)');
      params.push(desde, desde);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const pool = await db();
    // LIMIT/OFFSET inline (sanitizados) — evita a peculiaridade do mysql2 com
    // placeholders em LIMIT. Demais valores seguem parametrizados.
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT f.id, f.relatorio_id, f.latitude, f.longitude, f.logradouro, f.municipio,
              f.horario_captura, f.descricao, f.ordem, f.colaborador
         FROM fotos_vistoria f
         ${whereSql}
         ORDER BY f.horario_captura DESC, f.id DESC
         LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const fotos = (rows as RowDataPacket[]).map((r) => ({
      id: r.id,
      numero: r.id,
      url: `/api/galeria/foto/${r.id}`,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
      endereco: r.logradouro || r.municipio || '',
      data_hora: r.horario_captura,
      legenda: r.descricao || '',
      colaborador: r.colaborador || '',
      relatorio_id: r.relatorio_id,
    }));

    res.json({ fotos, total: fotos.length, limit, offset });
  } catch (err) {
    console.error('[galeriaExport] erro export:', err);
    res.status(500).json({ error: 'falha ao exportar galeria' });
  }
});

/**
 * GET /api/galeria/foto/:id
 * Headers: X-API-Key
 * Decodifica o base64_overlay e devolve os bytes da imagem (o AvalieImob baixa
 * por aqui na hora de importar a foto selecionada).
 */
router.get('/foto/:id(\\d+)', requireApiKey, async (req: Request, res: Response) => {
  try {
    // PRIVACIDADE: a foto só é servida se o `colaborador` informado for o dono.
    // O AvalieImob injeta SEMPRE o nome do avaliador logado (derivado no servidor),
    // então um usuário nunca alcança a foto de outro mesmo adivinhando o id.
    const colaborador = ((req.query.colaborador as string) || '').trim();
    if (!colaborador) {
      res.status(400).json({ error: 'colaborador obrigatório' });
      return;
    }
    const pool = await db();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT base64_overlay FROM fotos_vistoria WHERE id = ? AND colaborador = ? LIMIT 1',
      [req.params.id, colaborador],
    );
    const raw = rows.length ? (rows[0].base64_overlay as string | null) : null;
    if (!raw) {
      res.status(404).json({ error: 'foto não encontrada' });
      return;
    }

    // Aceita tanto data URL ("data:image/jpeg;base64,...") quanto base64 cru.
    let mime = 'image/jpeg';
    let b64 = raw;
    const m = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(raw);
    if (m) {
      mime = m[1];
      b64 = m[2];
    }
    const buf = Buffer.from(b64, 'base64');
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buf);
  } catch (err) {
    console.error('[galeriaExport] erro foto:', err);
    res.status(500).json({ error: 'falha ao servir foto' });
  }
});

export default router;
