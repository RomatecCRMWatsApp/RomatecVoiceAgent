// v3.10.0 — Calcula o período padrão sugerido para fechamento de folha,
// baseado no ciclo de pagamento da obra e no último fechamento realizado.
//
// Tabelas (v3.9.x): romatec_obras, romatec_obra_funcionario_dias.

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';

export interface PeriodoSugerido {
  dataInicio: string;       // YYYY-MM-DD — sempre = ultima_data_fechada + 1, ou primeira data marcada
  dataFimPrevista: string;  // YYYY-MM-DD — onde TEORICAMENTE deveria fechar (dia_corte_padrao)
  ciclo: 'quinzenal' | 'mensal' | 'semanal' | 'personalizado';
  diaCortePadrao: number | null;
  motivo: string;           // descrição em PT-BR para mostrar no front
}

type Executor = typeof pool | PoolConnection;

/**
 * Calcula o período que o sistema sugere fechar para uma obra.
 *
 * Regras:
 *  - data_inicio = ultima_data_fechada + 1 dia
 *    Se não houver fechamento anterior, usa o primeiro romatec_obra_funcionario_dias da obra.
 *    Se não houver lançamento, usa primeiro dia do mês corrente.
 *  - data_fim_prevista = próximo dia de corte conforme ciclo:
 *      quinzenal → dia_corte_padrao (15) ou último dia do mês (se 15 já passou)
 *      mensal    → último dia do mês corrente
 *      semanal   → 7 dias a partir do início
 *      personalizado → 14 dias a partir do início
 */
export async function calcularPeriodoSugerido(obraId: number, exec: Executor = pool): Promise<PeriodoSugerido> {
  const [obrasRows] = await exec.query<RowDataPacket[]>(
    `SELECT id, ciclo_pagamento, dia_corte_padrao, ultima_data_fechada
       FROM romatec_obras WHERE id = ?`,
    [obraId]
  );
  if (obrasRows.length === 0) throw new Error('Obra não encontrada.');
  const obra = obrasRows[0];

  // 1. data_inicio
  let dataInicio: Date;
  let motivoInicio: string;
  if (obra.ultima_data_fechada) {
    dataInicio = addDays(toDate(obra.ultima_data_fechada), 1);
    motivoInicio = `inicia após último fechamento (${fmt(obra.ultima_data_fechada)})`;
  } else {
    const [md] = await exec.query<RowDataPacket[]>(
      `SELECT MIN(data) AS primeira FROM romatec_obra_funcionario_dias
        WHERE obra_id = ? AND fechamento_id IS NULL`,
      [obraId]
    );
    if (md[0]?.primeira) {
      dataInicio = toDate(md[0].primeira);
      motivoInicio = `inicia no primeiro dia lançado (${fmt(md[0].primeira)})`;
    } else {
      dataInicio = startOfMonth(new Date());
      motivoInicio = 'sem lançamentos — inicia no primeiro dia do mês';
    }
  }

  // 2. data_fim_prevista
  const ciclo = (obra.ciclo_pagamento || 'quinzenal') as PeriodoSugerido['ciclo'];
  const diaCorte: number | null = obra.dia_corte_padrao ?? null;
  let dataFimPrevista: Date;
  let motivoFim: string;

  switch (ciclo) {
    case 'mensal':
      dataFimPrevista = endOfMonth(dataInicio);
      motivoFim = `corte mensal — fim do mês (${fmt(dataFimPrevista)})`;
      break;

    case 'semanal':
      dataFimPrevista = addDays(dataInicio, 6);
      motivoFim = `corte semanal — 7 dias a partir do início`;
      break;

    case 'quinzenal': {
      const dia = diaCorte ?? 15;
      const inicioMes = dataInicio.getUTCMonth();
      const inicioAno = dataInicio.getUTCFullYear();

      let candidato = new Date(Date.UTC(inicioAno, inicioMes, Math.min(dia, daysInMonth(inicioAno, inicioMes))));
      if (candidato < dataInicio) {
        candidato = endOfMonth(dataInicio);
      }
      dataFimPrevista = candidato;
      motivoFim = `corte quinzenal — dia ${dia} (${fmt(dataFimPrevista)})`;
      break;
    }

    case 'personalizado':
    default:
      dataFimPrevista = addDays(dataInicio, 13);
      motivoFim = `corte personalizado — 14 dias`;
      break;
  }

  if (dataFimPrevista < dataInicio) {
    dataFimPrevista = addDays(dataInicio, 13);
  }

  return {
    dataInicio: fmt(dataInicio),
    dataFimPrevista: fmt(dataFimPrevista),
    ciclo,
    diaCortePadrao: diaCorte,
    motivo: `${motivoInicio}; ${motivoFim}`,
  };
}

// ---------- utils de data (UTC para evitar timezone bugs) ----------
function toDate(v: unknown): Date {
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const [y, m, d] = String(v).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
function daysInMonth(year: number, monthIdx: number): number {
  return new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
}
function fmt(d: unknown): string {
  const x = toDate(d);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(x.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
