// v3.80.1 — Guarda de regressão: a tela "Saldo em Aberto" deve contar apenas
// dias e vales REALMENTE em aberto (fechamento_id IS NULL). Sem esse filtro, o
// que já foi pago via "Fechar Folha" reaparecia como aberto e inflava o saldo /
// duplicava o desconto de vale. Como a função é 100% SQL (sem harness de DB no
// projeto), este teste protege a presença do filtro na fonte.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'integrations', 'obras.ts'), 'utf8');

// Isola o corpo da função relatorioSaldoEmAbertoEquipe (até o próximo export).
const ini = src.indexOf('export async function relatorioSaldoEmAbertoEquipe');
const fim = src.indexOf('\nexport ', ini + 10);
const corpo = ini >= 0 ? src.slice(ini, fim > ini ? fim : ini + 12000) : '';

describe('relatorioSaldoEmAbertoEquipe — filtro de fechamento (v3.80.1)', () => {
  it('a query de DIAS filtra fechamento_id IS NULL', () => {
    const q = corpo.indexOf('romatec_obra_funcionario_dias');
    expect(q).toBeGreaterThan(-1);
    const trecho = corpo.slice(q, q + 400);
    expect(trecho).toMatch(/fechamento_id\s+IS\s+NULL/i);
  });

  it('a query de VALES (recibos_ajustes) filtra fechamento_id IS NULL', () => {
    const q = corpo.indexOf("tipo = 'adiantamento'");
    expect(q).toBeGreaterThan(-1);
    const trecho = corpo.slice(q - 200, q + 400);
    expect(trecho).toMatch(/fechamento_id\s+IS\s+NULL/i);
  });
});
