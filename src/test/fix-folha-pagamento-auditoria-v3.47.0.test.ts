// v3.47.0: hotfix de auditoria pro sintoma "pagar quinzena marca dias de
// outra quinzena". Auditoria do codigo real mostrou que o diagnostico do
// prompt original NAO se aplica:
//   - marcarItemPago usa WHERE id=? (impossivel vazar)
//   - fecharFolha bloqueia dias com data BETWEEN + fechamento_id IS NULL
//     (filtros corretos)
//
// Este patch adiciona:
//   1. Hardening do subselect pago_legado (CASE WHEN fechamento_id IS NULL)
//   2. Endpoint admin de auditoria pra detectar 2 tipos de inconsistencia
//
// Codigo NAO toca em marcarItemPago/fecharFolha — eles ja' estao corretos.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const OBRAS_TS = fs.readFileSync(
  path.join(process.cwd(), 'src', 'integrations', 'obras.ts'),
  'utf-8',
);
const FOLHA_FECHAMENTO_TS = fs.readFileSync(
  path.join(process.cwd(), 'src', 'services', 'folhaFechamento.ts'),
  'utf-8',
);
const SERVER_TS = fs.readFileSync(
  path.join(process.cwd(), 'src', 'server.ts'),
  'utf-8',
);

describe('v3.47.0 — Hardening do subselect pago_legado', () => {
  it('1. listarDiasFuncionario embrulha pago_legado em CASE WHEN fechamento_id IS NULL', () => {
    expect(OBRAS_TS).toMatch(/CASE WHEN d\.fechamento_id IS NOT NULL THEN 0 ELSE \([\s\S]{0,1000}?pago_legado/);
  });

  it('2. Comentario explicando o motivo do hardening v3.47.0', () => {
    expect(OBRAS_TS).toMatch(/v3\.47\.0 HARDENING[\s\S]{0,500}?sistema novo ganha[\s\S]{0,200}?sobre legado/);
  });

  it('3. Subselect interno (recibos_envios) preservado — so embrulhado', () => {
    expect(OBRAS_TS).toMatch(/SELECT 1\s*\n?\s*FROM recibos_envios e/);
    expect(OBRAS_TS).toMatch(/JOIN recibos_envios_lotes l ON l\.id = e\.lote_id/);
    expect(OBRAS_TS).toMatch(/d\.data BETWEEN l\.periodo_inicio AND l\.periodo_fim/);
  });
});

describe('v3.47.0 — Funcao auditarInconsistenciasPagamento', () => {
  it('4. Funcao exportada com tipo DiaInconsistente', () => {
    expect(FOLHA_FECHAMENTO_TS).toMatch(/export async function auditarInconsistenciasPagamento\(obraId: number\)/);
    expect(FOLHA_FECHAMENTO_TS).toMatch(/export interface DiaInconsistente/);
  });

  it('5. Query tipo 1: dias com data FORA do intervalo [data_inicio, data_fim]', () => {
    expect(FOLHA_FECHAMENTO_TS).toMatch(/AND \(d\.data < f\.data_inicio OR d\.data > f\.data_fim\)/);
  });

  it('6. Query tipo 2: lote legado pago cobrindo dia com fechamento novo', () => {
    expect(FOLHA_FECHAMENTO_TS).toMatch(/JOIN recibos_envios re ON re\.membro_id = d\.funcionario_id\s*\n?\s*AND re\.status = 'pago'/);
    expect(FOLHA_FECHAMENTO_TS).toMatch(/d\.data BETWEEN l\.periodo_inicio AND l\.periodo_fim/);
  });

  it('7. Output inclui total + dias_fora_do_periodo + lotes_legados_sobrepostos', () => {
    expect(FOLHA_FECHAMENTO_TS).toMatch(/total: dias_fora_do_periodo\.length \+ lotes_legados_sobrepostos\.length/);
  });

  it('8. Cada inconsistencia tem detalhe legivel', () => {
    expect(FOLHA_FECHAMENTO_TS).toMatch(/tipo_inconsistencia: 'data_fora_do_periodo'/);
    expect(FOLHA_FECHAMENTO_TS).toMatch(/tipo_inconsistencia: 'lote_legado_sobreposto'/);
  });
});

describe('v3.47.0 — Endpoint admin /api/folha/auditar-inconsistencias', () => {
  it('9. Endpoint registrado com requireCeoToken (admin-only)', () => {
    expect(SERVER_TS).toMatch(/app\.get\('\/api\/folha\/auditar-inconsistencias',\s*requireCeoToken/);
  });

  it('10. Valida obraId obrigatorio na query string', () => {
    expect(SERVER_TS).toMatch(/auditar-inconsistencias'[\s\S]{0,800}?obraId obrigatorio/);
  });

  it('11. Chama auditarInconsistenciasPagamento do service', () => {
    expect(SERVER_TS).toMatch(/auditar-inconsistencias'[\s\S]{0,800}?m\.auditarInconsistenciasPagamento\(obraId\)/);
  });
});

describe('v3.47.0 — REGRESSAO: codigo OK do backend NAO foi alterado', () => {
  it('12. marcarItemPago continua usando WHERE id = ? (item especifico)', () => {
    expect(FOLHA_FECHAMENTO_TS).toMatch(/UPDATE folha_fechamento_itens[\s\S]{0,300}?SET status_pagamento = 'paga'[\s\S]{0,200}?WHERE id = \?/);
  });

  it('13. fecharFolha continua filtrando por data BETWEEN + fechamento_id IS NULL', () => {
    expect(FOLHA_FECHAMENTO_TS).toMatch(/UPDATE romatec_obra_funcionario_dias[\s\S]{0,300}?WHERE obra_id = \?\s*\n?\s*AND data BETWEEN \? AND \?\s*\n?\s*AND fechamento_id IS NULL/);
  });

  it('14. JOIN com folha_fechamento_itens preservado (sem mudar logica)', () => {
    expect(OBRAS_TS).toMatch(/LEFT JOIN folha_fechamento_itens fi[\s\S]{0,200}?ON d\.fechamento_id IS NOT NULL[\s\S]{0,150}?AND fi\.fechamento_id = d\.fechamento_id[\s\S]{0,150}?AND fi\.funcionario_id = d\.funcionario_id/);
  });
});
