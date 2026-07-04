// v3.87.0 — Guarda de regressão: a Folha Mensal deve somar apenas os VALES
// (recibos_ajustes tipo='adiantamento') REALMENTE em aberto — `fechamento_id IS
// NULL`. Sem esse filtro, vales já baixados num fechamento (ou legados
// conciliados com sentinela fechamento_id=0) eram descontados de novo e
// apareciam em funcionários sem vale aberto na quinzena (bug reportado pelo CEO:
// só Cícero e Francisco tinham vale, mas 4 apareciam). Mesma regra da aba
// "Saldo em Aberto". Como a função é 100% SQL (sem harness de DB no projeto),
// este teste protege a presença do filtro na fonte.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'integrations', 'obras.ts'), 'utf8');

// Isola o corpo da função relatorioMensalEquipe (até o próximo export).
const ini = src.indexOf('export async function relatorioMensalEquipe');
const fim = src.indexOf('\nexport ', ini + 10);
const corpo = ini >= 0 ? src.slice(ini, fim > ini ? fim : ini + 12000) : '';

describe('relatorioMensalEquipe — vales em aberto (v3.87.0)', () => {
  it('a função existe', () => {
    expect(ini).toBeGreaterThan(-1);
  });

  it('a query de VALES (recibos_ajustes) filtra fechamento_id IS NULL', () => {
    // Ancora no predicado da SQL (só existe na query, não nos comentários).
    const q = corpo.indexOf("tipo = 'adiantamento'");
    expect(q).toBeGreaterThan(-1);
    const trecho = corpo.slice(q - 120, q + 200);
    expect(trecho).toMatch(/recibos_ajustes/);
    expect(trecho).toMatch(/fechamento_id\s+IS\s+NULL/i);
  });

  it('expõe vales_periodo e saldo por funcionário + totais', () => {
    expect(corpo).toMatch(/vales_periodo/);
    expect(corpo).toMatch(/saldo:\s*Math\.max\(0,\s*l\.total_pagar\s*-\s*vales\)/);
    expect(corpo).toMatch(/total_vales/);
    expect(corpo).toMatch(/total_saldo/);
  });

  // v3.88.0 — filtro de intervalo manual (data_inicio/data_fim)
  it('aceita intervalo manual e filtra dias por BETWEEN quando definido', () => {
    expect(corpo).toMatch(/usarIntervalo/);
    expect(corpo).toMatch(/d\.data BETWEEN \? AND \?/);
  });

  it('no intervalo, escopa vales por criado_em (mesma lógica da Saldo em Aberto)', () => {
    const q = corpo.indexOf('usarIntervalo');
    expect(q).toBeGreaterThan(-1);
    // A query de vales com intervalo usa criado_em >= ? ... < DATE_ADD(?, INTERVAL 1 DAY)
    expect(corpo).toMatch(/criado_em\s*>=\s*\?[\s\S]*?criado_em\s*<\s*DATE_ADD\(\?,\s*INTERVAL 1 DAY\)/);
  });
});
