// v3.10.0 — Service de Fechamento de Folha (período flexível por obra).
//
// Tabelas (v3.9.x):
//   romatec_obras                       — obra (com ciclo_pagamento, dia_corte_padrao, ultima_data_fechada)
//   romatec_obra_equipe                 — funcionário (valor_dia, funcao, nome)
//   romatec_obra_funcionario_dias       — lançamentos diários (periodo, valor, fechamento_id)
//   folha_fechamentos                   — cabeçalho do fechamento
//   folha_fechamento_itens              — snapshot por funcionário
//   folha_pagamentos_log                — auditoria
//
// Nota: na v1 NÃO buscamos vales/adiantamentos automaticamente da tabela `recibos`
// (o schema mudou bastante desde a v1.99.15 — recibos agora usa resource_type/resource_id
// em vez de funcionario_id/obra_id). valor_vales = 0 nessa versão; quando precisar
// integrar com recibos_quinzena/adiantamentos, basta evoluir calcularItens().

import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import pool from '../database/connection';

export interface FecharFolhaInput {
  obraId: number;
  dataInicio: string;        // YYYY-MM-DD
  dataFim: string;           // YYYY-MM-DD — data REAL do fechamento (editável)
  dataFimPrevista?: string;  // YYYY-MM-DD — opcional, para registro
  rotulo?: string;
  fechadoPor?: string;
  observacoes?: string;
}

export interface MarcarPagoInput {
  itemId: number;
  formaPagamento: 'pix' | 'dinheiro' | 'transferencia' | 'cheque' | 'outro';
  usuario?: string;
  observacao?: string;
}

export interface PreviewItem {
  funcionario_id: number;
  nome: string;
  funcao: string | null;
  diaria: number;
  dias_integral: number;
  dias_manha: number;
  dias_tarde: number;
  dias_equivalente: number;
  valor_total: number;
  valor_vales: number;
  valor_liquido: number;
}

type Executor = typeof pool | PoolConnection;

// ===== PREVIEW =====
export async function previewFolha(obraId: number, dataInicio: string, dataFim: string): Promise<{
  itens: PreviewItem[];
  totalValor: number;
  totalVales: number;
  totalLiquido: number;
}> {
  if (new Date(dataFim) < new Date(dataInicio)) {
    throw new Error('Data fim anterior à data início.');
  }
  const itens = await calcularItens(pool, obraId, dataInicio, dataFim);
  const totalValor = +itens.reduce((s, i) => s + i.valor_total, 0).toFixed(2);
  const totalVales = +itens.reduce((s, i) => s + i.valor_vales, 0).toFixed(2);
  const totalLiquido = +(totalValor - totalVales).toFixed(2);
  return { itens, totalValor, totalVales, totalLiquido };
}

// ===== FECHAR =====
export async function fecharFolha(input: FecharFolhaInput): Promise<{
  fechamentoId: number;
  totalFuncionarios: number;
  totalValor: number;
  totalLiquido: number;
}> {
  if (new Date(input.dataFim) < new Date(input.dataInicio)) {
    throw new Error('Data fim anterior à data início.');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Sobreposição com fechamento ativo
    const [overlap] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM folha_fechamentos
        WHERE obra_id = ?
          AND status IN ('aberta','parcialmente_paga')
          AND NOT (data_fim < ? OR data_inicio > ?)
        LIMIT 1`,
      [input.obraId, input.dataInicio, input.dataFim]
    );
    if (overlap.length > 0) {
      throw new Error(`Período sobreposto ao fechamento id=${overlap[0].id}. Quite ou cancele antes.`);
    }

    // 2. Itens (já dentro da transação)
    const itens = await calcularItens(conn, input.obraId, input.dataInicio, input.dataFim);
    if (itens.length === 0) {
      throw new Error('Nenhum dia lançado nesse período para essa obra.');
    }

    const totalValor = +itens.reduce((s, i) => s + i.valor_total, 0).toFixed(2);
    const totalVales = +itens.reduce((s, i) => s + i.valor_vales, 0).toFixed(2);
    const totalLiquido = +(totalValor - totalVales).toFixed(2);

    // 3. Cabeçalho
    const [head] = await conn.execute<ResultSetHeader>(
      `INSERT INTO folha_fechamentos
         (obra_id, data_inicio, data_fim, data_fim_prevista, rotulo, total_funcionarios,
          total_valor, total_vales, total_liquido, status, observacoes, fechado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?)`,
      [
        input.obraId, input.dataInicio, input.dataFim,
        input.dataFimPrevista ?? null,
        input.rotulo ?? null, itens.length,
        totalValor, totalVales, totalLiquido,
        input.observacoes ?? null, input.fechadoPor ?? 'Sistema',
      ]
    );
    const fechamentoId = head.insertId;

    // 4. Itens snapshot
    for (const it of itens) {
      await conn.execute(
        `INSERT INTO folha_fechamento_itens
           (fechamento_id, funcionario_id, funcionario_nome, funcao, diaria,
            dias_integral, dias_manha, dias_tarde, dias_equivalente,
            valor_total, valor_vales, valor_liquido, status_pagamento)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberta')`,
        [
          fechamentoId, it.funcionario_id, it.nome, it.funcao, it.diaria,
          it.dias_integral, it.dias_manha, it.dias_tarde, it.dias_equivalente,
          it.valor_total, it.valor_vales, it.valor_liquido,
        ]
      );
    }

    // 5. Bloqueia romatec_obra_funcionario_dias do período
    await conn.execute(
      `UPDATE romatec_obra_funcionario_dias
          SET fechamento_id = ?, bloqueado_em = NOW()
        WHERE obra_id = ?
          AND data BETWEEN ? AND ?
          AND fechamento_id IS NULL`,
      [fechamentoId, input.obraId, input.dataInicio, input.dataFim]
    );

    // 6. Atualiza ultima_data_fechada da obra (PRÓXIMO ciclo começa em dataFim + 1)
    await conn.execute(
      `UPDATE romatec_obras SET ultima_data_fechada = ? WHERE id = ?`,
      [input.dataFim, input.obraId]
    );

    await conn.commit();
    return { fechamentoId, totalFuncionarios: itens.length, totalValor, totalLiquido };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ===== MARCAR ITEM PAGO =====
export async function marcarItemPago(input: MarcarPagoInput): Promise<{ fechamentoStatus: string }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, fechamento_id, status_pagamento, valor_liquido
         FROM folha_fechamento_itens WHERE id = ? FOR UPDATE`,
      [input.itemId]
    );
    if (rows.length === 0) throw new Error('Item não encontrado.');
    if (rows[0].status_pagamento === 'paga') throw new Error('Item já está pago.');
    if (rows[0].status_pagamento === 'cancelada') throw new Error('Item cancelado.');

    const fechamentoId = rows[0].fechamento_id;
    const usuario = input.usuario ?? 'Sistema';

    await conn.execute(
      `UPDATE folha_fechamento_itens
          SET status_pagamento = 'paga',
              data_pagamento  = NOW(),
              forma_pagamento = ?,
              observacoes     = COALESCE(?, observacoes)
        WHERE id = ?`,
      [input.formaPagamento, input.observacao ?? null, input.itemId]
    );

    await conn.execute(
      `INSERT INTO folha_pagamentos_log
         (fechamento_item_id, acao, valor, forma_pagamento, usuario, observacao)
       VALUES (?, 'marcou_pago', ?, ?, ?, ?)`,
      [input.itemId, rows[0].valor_liquido, input.formaPagamento, usuario, input.observacao ?? null]
    );

    // Reavalia status do fechamento
    const [agg] = await conn.query<RowDataPacket[]>(
      `SELECT
          SUM(status_pagamento = 'paga')   AS pagas,
          SUM(status_pagamento = 'aberta') AS abertas,
          COUNT(*) AS total
         FROM folha_fechamento_itens
        WHERE fechamento_id = ?`,
      [fechamentoId]
    );
    const pagas = Number(agg[0].pagas);
    const abertas = Number(agg[0].abertas);
    const total = Number(agg[0].total);

    let novoStatus: 'aberta' | 'parcialmente_paga' | 'quitada' = 'aberta';
    if (pagas === total) novoStatus = 'quitada';
    else if (pagas > 0 && abertas > 0) novoStatus = 'parcialmente_paga';

    await conn.execute(
      `UPDATE folha_fechamentos SET status = ? WHERE id = ?`,
      [novoStatus, fechamentoId]
    );

    await conn.commit();
    return { fechamentoStatus: novoStatus };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ===== REVERTER PAGAMENTO =====
export async function reverterPagamento(itemId: number, usuario?: string, motivo?: string): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT fechamento_id, status_pagamento, valor_liquido
         FROM folha_fechamento_itens WHERE id = ? FOR UPDATE`,
      [itemId]
    );
    if (rows.length === 0) throw new Error('Item não encontrado.');
    if (rows[0].status_pagamento !== 'paga') throw new Error('Item não está pago.');

    await conn.execute(
      `UPDATE folha_fechamento_itens
          SET status_pagamento = 'aberta', data_pagamento = NULL, forma_pagamento = NULL
        WHERE id = ?`,
      [itemId]
    );
    await conn.execute(
      `INSERT INTO folha_pagamentos_log (fechamento_item_id, acao, valor, usuario, observacao)
       VALUES (?, 'reverteu', ?, ?, ?)`,
      [itemId, rows[0].valor_liquido, usuario ?? 'Sistema', motivo ?? null]
    );
    await conn.execute(
      `UPDATE folha_fechamentos SET status = 'parcialmente_paga'
        WHERE id = ? AND status = 'quitada'`,
      [rows[0].fechamento_id]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ===== LISTAGENS =====
export async function listarPorObra(obraId: number, status?: string) {
  const params: (string | number)[] = [obraId];
  let sql = `SELECT * FROM folha_fechamentos WHERE obra_id = ?`;
  if (status) { sql += ` AND status = ?`; params.push(status); }
  sql += ` ORDER BY data_fim DESC, id DESC`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows;
}

export async function obterDetalhe(fechamentoId: number) {
  const [head] = await pool.query<RowDataPacket[]>(
    `SELECT f.*, o.nome AS obra_nome
       FROM folha_fechamentos f
       JOIN romatec_obras o ON o.id = f.obra_id
      WHERE f.id = ?`,
    [fechamentoId]
  );
  if (head.length === 0) return null;
  // v3.15.17: NAO inclui comprovante_arquivo (LONGBLOB) na listagem — arrasta MB
  // por item em cada render do painel.
  const SELECT_ITENS_BASE = `
    SELECT fi.id, fi.fechamento_id, fi.funcionario_id, fi.funcionario_nome, fi.funcao,
           fi.diaria, fi.dias_integral, fi.dias_manha, fi.dias_tarde, fi.dias_equivalente,
           fi.valor_total, fi.valor_vales, fi.valor_liquido,
           fi.status_pagamento, fi.data_pagamento, fi.recibo_id, fi.forma_pagamento,
           fi.observacoes, fi.created_at, fi.updated_at,
           fi.comprovante_mime, fi.comprovante_filename,
           fi.comprovante_extraido, fi.comprovante_uploaded_em,
           fi.comprovante_enviado_whatsapp
      FROM folha_fechamento_itens fi
     WHERE fi.fechamento_id = ?
     ORDER BY fi.funcionario_nome`;

  // Carrega itens base (sem o join de recibos primeiro — garantido funcionar)
  const [itensBase] = await pool.query<RowDataPacket[]>(SELECT_ITENS_BASE, [fechamentoId]);
  if (itensBase.length === 0) return { ...head[0], itens: [] };

  // v3.15.20: enriquecimento opcional com recibo Romatec (status + token + datas).
  // Roda em query separada pra nao quebrar o detalhe se a tabela recibos tiver
  // algum problema (colacao de resource_id, falta de indice, etc). Se falhar,
  // segue sem o badge — UI mostra "Sem recibo" e o painel continua funcional.
  const ids = itensBase.map(it => Number(it.id));
  let reciboByItem: Map<number, RowDataPacket> = new Map();
  try {
    const placeholders = ids.map(() => '?').join(',');
    const [recibosRows] = await pool.query<RowDataPacket[]>(
      `SELECT id AS recibo_link_id, numero AS recibo_numero,
              status AS recibo_status, token AS recibo_token,
              enviado_em AS recibo_enviado_em, lido_em AS recibo_lido_em,
              respondido_em AS recibo_respondido_em,
              resposta_acao AS recibo_resposta_acao,
              resource_id
         FROM recibos
        WHERE resource_type = 'folha_fechamento_item'
          AND resource_id IN (${placeholders})
          AND id = (
            SELECT MAX(r2.id) FROM recibos r2
             WHERE r2.resource_type = 'folha_fechamento_item'
               AND r2.resource_id = recibos.resource_id
          )`,
      ids.map(String)
    );
    for (const r of recibosRows) {
      reciboByItem.set(Number(r.resource_id), r);
    }
  } catch (err) {
    console.warn('[obterDetalhe] enriquecimento de recibo falhou:', (err as Error).message);
  }
  const itens = itensBase.map(it => {
    const rec = reciboByItem.get(Number(it.id));
    if (!rec) return it;
    return {
      ...it,
      recibo_link_id: rec.recibo_link_id,
      recibo_numero: rec.recibo_numero,
      recibo_status: rec.recibo_status,
      recibo_token: rec.recibo_token,
      recibo_enviado_em: rec.recibo_enviado_em,
      recibo_lido_em: rec.recibo_lido_em,
      recibo_respondido_em: rec.recibo_respondido_em,
      recibo_resposta_acao: rec.recibo_resposta_acao,
    };
  });
  return { ...head[0], itens };
}

// ===== CÁLCULO INTERNO =====
async function calcularItens(exec: Executor, obraId: number, dataInicio: string, dataFim: string): Promise<PreviewItem[]> {
  const [linhas] = await exec.query<RowDataPacket[]>(
    `SELECT
        e.id AS funcionario_id,
        e.nome,
        e.funcao,
        e.valor_dia AS diaria,
        COALESCE(SUM(CASE WHEN d.periodo = 'integral' THEN 1 ELSE 0 END), 0) AS dias_integral,
        COALESCE(SUM(CASE WHEN d.periodo = 'manha'    THEN 1 ELSE 0 END), 0) AS dias_manha,
        COALESCE(SUM(CASE WHEN d.periodo = 'tarde'    THEN 1 ELSE 0 END), 0) AS dias_tarde,
        COALESCE(SUM(d.valor), 0) AS soma_valor_lancado
      FROM romatec_obra_equipe e
      INNER JOIN romatec_obra_funcionario_dias d ON d.funcionario_id = e.id
     WHERE d.obra_id = ?
       AND d.data BETWEEN ? AND ?
       AND d.fechamento_id IS NULL
     GROUP BY e.id, e.nome, e.funcao, e.valor_dia
    HAVING (dias_integral + dias_manha + dias_tarde) > 0
     ORDER BY e.nome`,
    [obraId, dataInicio, dataFim]
  );
  if (linhas.length === 0) return [];

  return linhas.map(l => {
    const diaria = Number(l.diaria) || 0;
    const dInt = Number(l.dias_integral);
    const dMan = Number(l.dias_manha);
    const dTar = Number(l.dias_tarde);
    const equivalente = +(dInt + (dMan + dTar) * 0.5).toFixed(2);
    // Se a obra usar lançamentos com `valor` por dia (override individual), usa
    // a soma como valor_total (mais preciso). Senão calcula equivalente * diaria.
    const valorLancado = Number(l.soma_valor_lancado) || 0;
    const valor_total = valorLancado > 0
      ? +valorLancado.toFixed(2)
      : +(equivalente * diaria).toFixed(2);
    const valor_vales = 0; // TODO: integrar com recibos_quinzena/adiantamentos quando schema estiver claro
    const valor_liquido = +(valor_total - valor_vales).toFixed(2);
    return {
      funcionario_id: Number(l.funcionario_id),
      nome: String(l.nome),
      funcao: l.funcao as string | null,
      diaria,
      dias_integral: dInt,
      dias_manha: dMan,
      dias_tarde: dTar,
      dias_equivalente: equivalente,
      valor_total,
      valor_vales,
      valor_liquido,
    };
  });
}
