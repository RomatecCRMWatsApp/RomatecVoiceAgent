// v3.42.0: 4 fixes na renderização da proposta de Demarcação.
//
// BUG A — Box vermelho DRL + bullet aparecia em demarcação. DRL e' obrigacao
//         do proprietario apenas em Georref Rural (Lei 10.267/2001 / NTGIR).
//         Demarcacao simples e' so' materializacao fisica das divisas.
// BUG B — "Edição não disponível para subtipo demarcacao_rural" — frontend nao
//         tinha demarcacao_* em SUBTIPOS_EDITAVEIS, embora o form exista desde v3.27.0.
// BUG C — Edicao recalculava sem injetar adicional_campo_pct, perdendo a contribuicao
//         da insalubridade na base.
// BUG D — Parcelas R$ 0,00 e/ou opcionais sem valor em propostas legadas/corrompidas.
//         Aplicada defesa runtime no PDF render (recompute via percentual / metros×R$).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { calcularDemarcacaoLotes } from '../services/pricing/demarcacaoLotes';
import type { InputDemarcacaoLotes } from '../services/pricing/types';

const OBRAS_HTML = fs.readFileSync(path.join(process.cwd(), 'src', 'public', 'obras.html'), 'utf-8');
const PROPOSTAS_CONS_TS = fs.readFileSync(
  path.join(process.cwd(), 'src', 'integrations', 'propostasConsultoria.ts'),
  'utf-8',
);

describe('HOTFIX v3.42.0 — BUG A: DRL removido de demarcação', () => {
  it('1. avisosDem nao contem mais o bullet sobre DRL/Declaracoes de Respeito de Limite', () => {
    // localiza o array avisosDem do renderDemarcacaoLotesBody
    const trecho = PROPOSTAS_CONS_TS.match(/const avisosDem = \[[\s\S]*?\];/);
    expect(trecho).not.toBeNull();
    expect(trecho![0]).not.toMatch(/Declaracoes de Respeito de Limite/);
    expect(trecho![0]).not.toMatch(/DRLs/);
    // Mas mantem os 2 bullets originais (gold standard 0028-R1)
    expect(trecho![0]).toMatch(/A demarcacao consiste na materializacao fisica/);
    expect(trecho![0]).toMatch(/codigos INCRA dos marcos sao vitalicios/);
  });

  it('2. renderAvisoDRL nao e mais chamado dentro de renderDemarcacaoLotesBody', () => {
    // Procura pelo comentario explicativo + ausencia da chamada no bloco onde estava
    expect(PROPOSTAS_CONS_TS).toMatch(/v3\.42\.0: renderAvisoDRL REMOVIDO/);
    // Conta ocorrencias: deve haver apenas 1 (a do georref), nao 2 (georref + demarcacao)
    const ocorrencias = (PROPOSTAS_CONS_TS.match(/renderAvisoDRL\(doc,\s*finalidade/g) || []).length;
    expect(ocorrencias).toBeLessThanOrEqual(1);
  });

  it('3. renderAvisoDRL CONTINUA usado em georreferenciamento (regressao)', () => {
    // Linha ~1554-1555: renderAvisoDRL(doc, finalidadeDRL, COL_X_INI, COL_W);
    expect(PROPOSTAS_CONS_TS).toMatch(/renderAvisoDRL\(doc, finalidadeDRL,/);
  });
});

describe('HOTFIX v3.42.0 — BUG B: Edicao habilitada pra demarcação', () => {
  it('4. SUBTIPOS_EDITAVEIS contem demarcacao_urbana e demarcacao_rural', () => {
    const m = OBRAS_HTML.match(/SUBTIPOS_EDITAVEIS = new Set\(\[([\s\S]*?)\]\)/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/'demarcacao_urbana'/);
    expect(m![1]).toMatch(/'demarcacao_rural'/);
  });
});

describe('HOTFIX v3.42.0 — BUG C: Edicao preserva adicional_campo via injecao do pct', () => {
  it('5. atualizarPropostaConsultoria injeta adicional_campo_pct quando snapshot existe', () => {
    // Pattern matches the local block where we inject pct, no need to span from function declaration
    expect(PROPOSTAS_CONS_TS).toMatch(/dadosInjetados\.adicional_campo_pct = adicionalSnap\.percentual/);
  });

  it('6. atualizarPropostaConsultoria preserva snapshot adicional_campo no custos atualizado', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/\.adicional_campo = adicionalSnap;/);
  });
});

describe('HOTFIX v3.42.0 — BUG D: defesa runtime parcelas R$ 0,00', () => {
  it('7. PDF render detecta parcelas com valor=0 e recompute via percentual', () => {
    // Garante que o codigo de fallback existe
    expect(PROPOSTAS_CONS_TS).toMatch(/algumZero = parcelas\.some/);
    expect(PROPOSTAS_CONS_TS).toMatch(/totalReal > 0/);
  });

  it('8. Recompute le percentual da descricao "X% do total" via regex', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/match\(\/\(\\d\+\(\?:\[\.,\]\\d\+\)\?\)\\s\*%\//);
  });

  it('9. Ultima parcela absorve o residuo de arredondamento', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/i === arr\.length - 1/);
  });
});

describe('HOTFIX v3.42.0 — BUG D: defesa runtime opcionais valor=0', () => {
  it('10. Engine expoe metros e valor_unitario na linha de alinhamento (forward compat)', () => {
    const r = calcularDemarcacaoLotes({
      subtipo: 'demarcacao_rural',
      finalidade: 'demarcacao_inicial',
      municipio: 'X', uf: 'MA',
      area_hectares: 29.04,
      perimetro_m: 2190.78,
      num_vertices: 4,
      servico_piqueteamento: false,
      marcos: [],
      diarias_equipe: 1, km_deslocamento: 0,
      complexidade: 'media',
      opcionais: { alinhamento_cerca: { contratado: true, metros: 2190.78, valor_unitario: 0.42 } },
    } as InputDemarcacaoLotes);
    const linha = r.secao_opcionais_demarcacao.linhas.find(l => /Alinhamento/i.test(l.rotulo));
    expect(linha).toBeDefined();
    const lExt = linha as { metros?: number; valor_unitario?: number };
    expect(lExt.metros).toBe(2190.78);
    expect(lExt.valor_unitario).toBe(0.42);
    expect(linha!.valor).toBeCloseTo(920.13, 1);
  });

  it('11. PDF render recompute opcional se contratado=true mas valor=0 e tem metros×vUnit', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/v3\.42\.0 DEFESA[\s\S]{0,500}?contratado.*valorRender.*sob_orcamento/);
    expect(PROPOSTAS_CONS_TS).toMatch(/Math\.round\(lExt\.metros \* lExt\.valor_unitario \* 100\) \/ 100/);
  });
});
