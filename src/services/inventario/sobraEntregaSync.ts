// v3.97.0 — Ponte SOBRAS da Entrega de Obra → Inventário de Materiais.
//
// A fase 1 da Entrega (v3.81.0) registrou as sobras só como documento
// (obras_entregas_materiais_sobra — "não movimenta estoque nesta fase").
// Esta é a fase 2: cada sobra vira ITEM do inventário da obra (origem
// 'sobra_entrega'), com rastro entrega_id/entrega_sobra_id e reaproveitando
// a foto + coordenadas GPS já capturadas na entrega.
//
// Reconciliação IDEMPOTENTE (pode rodar em toda mutação de sobra):
//   - sobra nova      → cria item (quantidade NULL assume 1, anotado) + copia foto;
//   - sobra editada   → atualiza descrição/unidade/quantidade do item
//                       (nunca abaixo do já utilizado — clampa e anota);
//   - sobra removida  → apaga o item se nada foi utilizado; senão mantém e anota;
//   - entrega sem obra_id → no-op (retorna null). O vínculo entrega↔obra é feito
//                       pela tela do inventário (vincularEntregaAObra).

import pool from '../../database/connection';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { adicionarFoto, statusPorSaldo } from './inventarioObraRepo';

const EPS = 0.0005; // mesma tolerância DECIMAL(12,3) do inventarioObraRepo

export interface SobraSyncResultado {
  obra_id: number;
  criados: number;
  atualizados: number;
  removidos: number;
  mantidos_com_uso: number; // sobra sumiu da entrega mas o item já tinha utilização
}

interface SobraRow extends RowDataPacket {
  id: number; material: string; quantidade: string | number | null; unidade: string | null;
  foto_mime: string | null; foto_base64: string | null; observacao: string | null;
  latitude: string | number | null; longitude: string | number | null;
}

const n = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/**
 * Reconcilia as sobras da entrega com o inventário da obra vinculada.
 * Retorna null quando a entrega não existe ou ainda não tem obra_id
 * (nada a sincronizar — o chamador trata como no-op, nunca como erro).
 */
export async function sincronizarSobrasDaEntrega(entregaId: number): Promise<SobraSyncResultado | null> {
  const [entRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, obra_id, numero, colaborador_id FROM obras_entregas WHERE id = ? LIMIT 1',
    [entregaId],
  );
  if (!entRows.length || entRows[0].obra_id == null) return null;
  const obraId = Number(entRows[0].obra_id);
  const numero = entRows[0].numero ? String(entRows[0].numero) : `#${entregaId}`;
  const colaboradorId = entRows[0].colaborador_id ? String(entRows[0].colaborador_id) : null;

  const [sobras] = await pool.execute<SobraRow[]>(
    `SELECT id, material, quantidade, unidade, foto_mime, foto_base64, observacao, latitude, longitude
       FROM obras_entregas_materiais_sobra WHERE entrega_id = ? ORDER BY ordem, id`,
    [entregaId],
  );

  const [itens] = await pool.execute<RowDataPacket[]>(
    `SELECT id, entrega_sobra_id, quantidade_comprada, quantidade_utilizada
       FROM obra_inventario_itens WHERE entrega_id = ? AND origem = 'sobra_entrega'`,
    [entregaId],
  );
  const itemPorSobra = new Map<number, { id: number; comprada: number; utilizada: number }>();
  for (const it of itens) {
    if (it.entrega_sobra_id == null) continue;
    itemPorSobra.set(Number(it.entrega_sobra_id), {
      id: Number(it.id),
      comprada: Number(it.quantidade_comprada),
      utilizada: Number(it.quantidade_utilizada),
    });
  }

  const resultado: SobraSyncResultado = {
    obra_id: obraId, criados: 0, atualizados: 0, removidos: 0, mantidos_com_uso: 0,
  };
  const sobrasVivas = new Set<number>();

  for (const s of sobras) {
    const sobraId = Number(s.id);
    sobrasVivas.add(sobraId);
    const qtdInformada = n(s.quantidade);
    const semQtd = qtdInformada == null || qtdInformada <= 0;
    const qtd = semQtd ? 1 : (qtdInformada as number);
    const descricao = String(s.material).trim().slice(0, 300);
    const unidade = (s.unidade || 'UN').toUpperCase().slice(0, 10);
    const existente = itemPorSobra.get(sobraId);

    if (!existente) {
      // sobra nova → item novo no inventário (rastro completo da entrega)
      const obs = [
        `Sobra da Entrega ${numero} (entrega_id ${entregaId})`,
        semQtd ? 'quantidade não informada na entrega — assumido 1' : null,
        s.observacao ? String(s.observacao) : null,
      ].filter(Boolean).join(' · ');
      const [r] = await pool.execute<ResultSetHeader>(
        `INSERT INTO obra_inventario_itens
           (obra_id, descricao, unidade_medida, quantidade_comprada, origem,
            observacoes, entrega_id, entrega_sobra_id, colaborador_id)
         VALUES (?, ?, ?, ?, 'sobra_entrega', ?, ?, ?, ?)`,
        [obraId, descricao, unidade, qtd, obs, entregaId, sobraId, colaboradorId],
      );
      resultado.criados += 1;
      // reaproveita a foto GPS da sobra como foto de "entrega" do item
      if (s.foto_base64) {
        await adicionarFoto(r.insertId, {
          tipo_foto: 'entrega',
          data_base64: String(s.foto_base64),
          mime: s.foto_mime || 'image/jpeg',
          legenda: `Sobra registrada na Entrega ${numero}`,
          latitude: n(s.latitude), longitude: n(s.longitude),
          colaborador_id: colaboradorId,
        });
      }
    } else {
      // sobra editada → espelha no item, sem furar o já utilizado
      const clampado = qtd < existente.utilizada - EPS;
      const novaComprada = clampado ? existente.utilizada : qtd;
      const obsClamp = clampado
        ? ` · sobra reduzida na entrega abaixo do já utilizado (${existente.utilizada}) — quantidade mantida no utilizado`
        : '';
      await pool.execute(
        `UPDATE obra_inventario_itens
            SET descricao = ?, unidade_medida = ?, quantidade_comprada = ?, status_utilizacao = ?
                ${obsClamp ? `, observacoes = CONCAT(COALESCE(observacoes, ''), ?)` : ''}
          WHERE id = ?`,
        obsClamp
          ? [descricao, unidade, novaComprada, statusPorSaldo(novaComprada, existente.utilizada), obsClamp, existente.id]
          : [descricao, unidade, novaComprada, statusPorSaldo(novaComprada, existente.utilizada), existente.id],
      );
      resultado.atualizados += 1;
      // foto adicionada à sobra DEPOIS da 1ª sincronização → copia se o item não tem nenhuma
      if (s.foto_base64) {
        const [fRows] = await pool.execute<RowDataPacket[]>(
          'SELECT COUNT(*) AS total FROM obra_inventario_fotos WHERE item_id = ?', [existente.id],
        );
        if (Number(fRows[0]?.total ?? 0) === 0) {
          await adicionarFoto(existente.id, {
            tipo_foto: 'entrega',
            data_base64: String(s.foto_base64),
            mime: s.foto_mime || 'image/jpeg',
            legenda: `Sobra registrada na Entrega ${numero}`,
            latitude: n(s.latitude), longitude: n(s.longitude),
            colaborador_id: colaboradorId,
          });
        }
      }
    }
  }

  // sobras que sumiram da entrega (removidas ou substituídas no PUT em lote)
  for (const it of itens) {
    const sobraId = it.entrega_sobra_id == null ? null : Number(it.entrega_sobra_id);
    if (sobraId != null && sobrasVivas.has(sobraId)) continue;
    if (Number(it.quantidade_utilizada) <= EPS) {
      // nada foi utilizado — remove o espelho (fotos caem por CASCADE)
      await pool.execute('DELETE FROM obra_inventario_itens WHERE id = ?', [Number(it.id)]);
      resultado.removidos += 1;
    } else {
      // já houve utilização — histórico é imutável, mantém e anota
      await pool.execute(
        `UPDATE obra_inventario_itens
            SET observacoes = CONCAT(COALESCE(observacoes, ''), ' · sobra removida da Entrega — item mantido (já houve utilização)'),
                entrega_sobra_id = NULL
          WHERE id = ?`,
        [Number(it.id)],
      );
      resultado.mantidos_com_uso += 1;
    }
  }

  return resultado;
}

/**
 * Entregas do colaborador que têm sobras registradas e podem alimentar ESTA obra
 * (ainda sem vínculo, ou já vinculadas a ela). Alimenta o modal de importação.
 */
export async function listarEntregasComSobras(colaboradorId: string, obraId: number): Promise<Array<{
  id: number; numero: string | null; titulo: string | null; cliente: string | null;
  status: string; obra_id: number | null; sobras_count: number; itens_importados: number;
}>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT e.id, e.numero, e.titulo, e.cliente, e.status, e.obra_id,
            COUNT(m.id) AS sobras_count,
            (SELECT COUNT(*) FROM obra_inventario_itens i
              WHERE i.entrega_id = e.id AND i.origem = 'sobra_entrega') AS itens_importados
       FROM obras_entregas e
       JOIN obras_entregas_materiais_sobra m ON m.entrega_id = e.id
      WHERE e.colaborador_id = ? AND (e.obra_id IS NULL OR e.obra_id = ?)
      GROUP BY e.id
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 100`,
    [colaboradorId, obraId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    numero: r.numero != null ? String(r.numero) : null,
    titulo: r.titulo != null ? String(r.titulo) : null,
    cliente: r.cliente != null ? String(r.cliente) : null,
    status: String(r.status),
    obra_id: r.obra_id == null ? null : Number(r.obra_id),
    sobras_count: Number(r.sobras_count),
    itens_importados: Number(r.itens_importados),
  }));
}

/**
 * Vincula a entrega à obra (obras_entregas.obra_id nasce NULL — não há FK
 * proposta→obra) e roda a sincronização. Posse validada pelo colaborador_id.
 * A partir do vínculo, toda edição de sobra sincroniza automaticamente.
 */
export async function vincularEntregaAObra(
  entregaId: number, colaboradorId: string, obraId: number,
): Promise<SobraSyncResultado> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT obra_id FROM obras_entregas WHERE id = ? AND colaborador_id = ? LIMIT 1',
    [entregaId, colaboradorId],
  );
  if (!rows.length) throw new Error('Entrega não encontrada (ou não pertence a você).');
  const atual = rows[0].obra_id == null ? null : Number(rows[0].obra_id);
  if (atual != null && atual !== obraId) {
    throw new Error(`Entrega já vinculada a outra obra (id ${atual}).`);
  }
  if (atual == null) {
    await pool.execute('UPDATE obras_entregas SET obra_id = ? WHERE id = ?', [obraId, entregaId]);
  }
  const r = await sincronizarSobrasDaEntrega(entregaId);
  if (!r) throw new Error('Falha ao sincronizar as sobras após o vínculo.');
  return r;
}
