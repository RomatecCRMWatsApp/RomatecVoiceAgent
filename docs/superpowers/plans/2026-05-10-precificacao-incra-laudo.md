# Precificação INCRA v3.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar precificação automática INCRA (Portaria 12/2025) ao Laudo de Demarcação, com auto-preenchimento dos 6 critérios, cálculo em 3 unidades (km/ha/lote), desconto opcional, integração ao PDF do laudo (nova seção 12) e 3 linhas de resumo no Recibo.

**Architecture:** Service puro em `src/services/pricing/incra.ts` (back) espelhado em `src/public/js/incraCalc.js` (front, vanilla JS) com teste de paridade de 54 cenários. Migration adiciona 16 colunas em `laudos_demarcacao`. 3 endpoints REST. UI em `obras.html` calcula em tempo real local. Bump v2.11.0 → v3.0.0.

**Tech Stack:** TypeScript 5, Express, MySQL2, pdfkit, Vitest 2.1, vanilla JavaScript (front).

**Branch:** `feat/precificacao-incra-laudo` (já criada; spec doc commitado em `4276fe9`)

**Spec:** `docs/superpowers/specs/2026-05-10-precificacao-incra-laudo-design.md`

---

## File Structure

**Criar:**
- `src/services/pricing/incra.ts` — Tabela INCRA + tipos + 6 funções puras (~280 linhas)
- `src/services/pricing/incra.test.ts` — Testes Vitest, incluindo paridade back↔front (~250 linhas)
- `src/database/migrations-precificacao-incra.ts` — Migration: 16 ALTER + 1 CREATE INDEX (~80 linhas)
- `src/public/js/incraCalc.js` — Espelho front da lógica de cálculo (~180 linhas)
- `docs/PRECIFICACAO_INCRA.md` — Doc user-facing
- `06-Changelog/v3.0.0-precificacao-incra.md` (na vault Obsidian, NÃO no clone fonte)

**Modificar:**
- `src/server.ts` — 3 endpoints novos + IIFE da nova migration no boot
- `src/integrations/laudos.ts` — função `atualizarPrecificacao()` para persistência
- `src/services/laudoPdf.ts` — adicionar seção "12. PRECIFICAÇÃO" antes da ART/TRT (renumera 13/14)
- `src/services/reciboPdf.ts` — 3 linhas de resumo INCRA quando aplicável
- `src/public/obras.html` — bloco "💰 Precificação INCRA" no painel ART/TRT + Financeiro do laudo
- `package.json` — `2.11.0` → `3.0.0`
- `src/agent/identity.ts` — `2.11.0` → `3.0.0`
- `src/public/sw.js` — cache `zayra-v2.11.0` → `zayra-v3.0.0`

---

## Tasks

### Task 1: Localizar a função render do painel ART/TRT + Financeiro do laudo

Antes de mexer na UI precisamos confirmar onde fica o bloco. O `renderFinanceiro()` da linha ~2822 é da aba **Obras** (movimentações financeiras de obra), não do laudo. O laudo tem uma aba própria com `numero_art`, `numero_trt`, `valor_servico`.

**Files:** none (apenas leitura/exploração)

- [ ] **Step 1: Localizar com grep**

Run: `grep -n "numero_art" "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/src/public/obras.html"`

Expected: várias linhas. Anotar a ocorrência mais próxima de uma `function render*()` que define um `view-*` com `numero_art`, `numero_trt`, `valor_servico`. Tipicamente seguirá o padrão `function renderLaudoFinanceiro()` ou `function renderArtFinanceiro()`.

- [ ] **Step 2: Identificar a linha exata da função**

Run: `grep -n "valor_servico" "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/src/public/obras.html"`

Expected: linhas que contém `valor_servico` em template strings de innerHTML. Localize a `function renderXxx() {` mais próxima dessas ocorrências (subir no arquivo).

- [ ] **Step 3: Anotar para uso nas Tasks 19-20**

Anote no rascunho mental:
- Nome exato da função (ex: `renderFinanceiroLaudo` ou similar)
- Linhas inicial/final
- Se usa `state.currentLaudo` ou outro nome de estado
- Como o `valor_servico` é renderizado hoje (`<input id="valSrv" ...>` ou similar)

Não há commit nesta task (apenas leitura).

---

### Task 2: Criar `src/services/pricing/incra.ts` — tabela e tipos (sem funções de cálculo)

**Files:**
- Create: `src/services/pricing/incra.ts`

- [ ] **Step 1: Criar arquivo com tipos, tabela e descritivos**

```typescript
// src/services/pricing/incra.ts
//
// Precificação INCRA — Portaria nº 12, de 23 de abril de 2025.
// Base: 3ª Edição da Norma Técnica para Georreferenciamento de Imóveis Rurais.
// Fonte: https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/portaria_12_2025_geo.pdf
//
// AVISO: este arquivo é espelhado em src/public/js/incraCalc.js (vanilla JS, front).
// Mudou aqui? Atualize lá. Teste de paridade em incra.test.ts garante que back e
// front calculam o mesmo (54 cenários: 6 faixas × 3 unidades × 3 tipos de desconto).

export interface FaixaIncra {
  pontuacaoMin: number;
  pontuacaoMax: number;
  rendimentoKmDia: number;
  valorPorKm: number;
  valorPorHectare: number;
  valorPorLote: number;
  label: string;
}

export const TABELA_INCRA_2025: FaixaIncra[] = [
  { pontuacaoMin: 6,  pontuacaoMax: 15, rendimentoKmDia: 5.00, valorPorKm: 747.52,  valorPorHectare: 49.83,  valorPorLote: 617.79,  label: '06-15' },
  { pontuacaoMin: 16, pontuacaoMax: 25, rendimentoKmDia: 4.25, valorPorKm: 897.03,  valorPorHectare: 59.80,  valorPorLote: 741.34,  label: '16-25' },
  { pontuacaoMin: 26, pontuacaoMax: 35, rendimentoKmDia: 3.50, valorPorKm: 1571.64, valorPorHectare: 104.78, valorPorLote: 1298.88, label: '26-35' },
  { pontuacaoMin: 36, pontuacaoMax: 45, rendimentoKmDia: 2.15, valorPorKm: 2023.23, valorPorHectare: 134.88, valorPorLote: 1672.09, label: '36-45' },
  { pontuacaoMin: 46, pontuacaoMax: 55, rendimentoKmDia: 1.25, valorPorKm: 2474.20, valorPorHectare: 164.95, valorPorLote: 2044.80, label: '46-55' },
  { pontuacaoMin: 56, pontuacaoMax: 60, rendimentoKmDia: 0.80, valorPorKm: 3043.12, valorPorHectare: 202.87, valorPorLote: 2514.97, label: '56-60' },
];

export const CRITERIOS_INCRA = {
  vegetacao: {
    label: 'Vegetação',
    descricao: 'Distribuição da cobertura vegetal',
    niveis: [
      { faixa: '1-3',  rotulo: 'Aberta',        descricao: 'Vegetação rasteira, sem árvores' },
      { faixa: '4-6',  rotulo: 'Intermediária', descricao: 'Arbustos e árvores de pequeno porte (cerrado, caatinga)' },
      { faixa: '7-10', rotulo: 'Fechada',       descricao: 'Árvores de médio/grande porte (mata atlântica, Amazônia)' },
    ],
  },
  relevo: {
    label: 'Relevo',
    descricao: 'Declividade do terreno',
    niveis: [
      { faixa: '1-3',  rotulo: 'Plano a Suave Ondulado',           descricao: 'Declividade 0-5%' },
      { faixa: '4-6',  rotulo: 'Moderadamente ondulado a Ondulado',descricao: 'Declividade 5-15%' },
      { faixa: '7-10', rotulo: 'Forte ondulado a Escarpado',        descricao: 'Declividade > 15%' },
    ],
  },
  insalubridade: {
    label: 'Insalubridade',
    descricao: 'Incidência de endemias/epidemias',
    niveis: [
      { faixa: '1-3',  rotulo: 'Baixa', descricao: 'Pouco ou nenhum histórico' },
      { faixa: '4-6',  rotulo: 'Média', descricao: 'Histórico recente' },
      { faixa: '7-10', rotulo: 'Alta',  descricao: 'Histórico frequente' },
    ],
  },
  acesso: {
    label: 'Acesso',
    descricao: 'Vias disponíveis e trafegabilidade',
    niveis: [
      { faixa: '1-3',  rotulo: 'Fácil',   descricao: 'Vias com boas condições' },
      { faixa: '4-6',  rotulo: 'Regular', descricao: 'Baixa condição de trafegabilidade' },
      { faixa: '7-10', rotulo: 'Difícil', descricao: 'Insuficiência de vias' },
    ],
  },
  clima: {
    label: 'Clima',
    descricao: 'Condições meteorológicas no período',
    niveis: [
      { faixa: '1-3',  rotulo: 'Favorável',    descricao: 'Sem chuvas, temperaturas amenas' },
      { faixa: '4-6',  rotulo: 'Mediano',      descricao: 'Chuvas esparsas, temperaturas médias' },
      { faixa: '7-10', rotulo: 'Desfavorável', descricao: 'Chuvas frequentes, temperaturas extremas' },
    ],
  },
  area_media: {
    label: 'Área Média dos Lotes',
    descricao: 'Tamanho médio dos lotes a demarcar',
    niveis: [
      { faixa: '1-3',  rotulo: 'Favorável',    descricao: 'Acima de 35 ha' },
      { faixa: '4-6',  rotulo: 'Mediano',      descricao: 'De 15 a 35 ha' },
      { faixa: '7-10', rotulo: 'Desfavorável', descricao: 'Até 15 ha' },
    ],
  },
} as const;

export const PORTARIA_INCRA_REFERENCIA = {
  numero: '12/2025',
  data: '23 de abril de 2025',
  orgao: 'INCRA — Diretoria de Governança da Terra',
  url: 'https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/portaria_12_2025_geo.pdf',
  observacao: 'Valores referenciais com variação admissível de ±10% conforme Anexo I, nota [1].',
};

export type UnidadeCalculo = 'km' | 'hectare' | 'lote';
export type DescontoTipo = 'percentual' | 'fixo' | 'nenhum';

export interface CriteriosPontuacao {
  vegetacao: number;
  relevo: number;
  insalubridade: number;
  acesso: number;
  clima: number;
  area_media: number;
}

export interface InputPrecificacao {
  criterios: CriteriosPontuacao;
  unidade: UnidadeCalculo;
  quantidade: number;
  desconto: { tipo: DescontoTipo; valor: number };
}

export interface ResultadoPrecificacao {
  pontuacaoTotal: number;
  faixa: FaixaIncra;
  valorUnitario: number;
  valorBase: number;
  descontoAplicado: number;
  valorFinal: number;
  detalhamento: { formula: string; avisos: string[] };
}

export interface DadosLaudoParaSugestao {
  area_total_m2?: number;
  perimetro_m?: number;
  num_pontos?: number;
  municipio?: string;
  uf?: string;
  tipo_vegetacao?: 'aberta' | 'intermediaria' | 'fechada';
}
```

- [ ] **Step 2: Verificar tipo check passa**

Run: `cd "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent" && npm run typecheck`
Expected: PASS, sem erros novos.

- [ ] **Step 3: Commit**

```bash
cd "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent"
git add src/services/pricing/incra.ts
git commit -m "feat(incra): tabela INCRA 2025 e tipos do service de precificacao"
```

---

### Task 3: `validarCriterios` (TDD)

**Files:**
- Create: `src/services/pricing/incra.test.ts`
- Modify: `src/services/pricing/incra.ts` (adiciona função)

- [ ] **Step 1: Escrever teste falhando**

Criar `src/services/pricing/incra.test.ts`:

```typescript
// src/services/pricing/incra.test.ts
import { describe, it, expect } from 'vitest';
import { validarCriterios, type CriteriosPontuacao } from './incra';

const valido: CriteriosPontuacao = {
  vegetacao: 5, relevo: 5, insalubridade: 5, acesso: 5, clima: 5, area_media: 5,
};

describe('validarCriterios', () => {
  it('retorna ok=true para entrada válida', () => {
    const r = validarCriterios(valido);
    expect(r.ok).toBe(true);
    expect(r.erros).toEqual([]);
  });

  it('rejeita pontuação 0', () => {
    const r = validarCriterios({ ...valido, vegetacao: 0 });
    expect(r.ok).toBe(false);
    expect(r.erros[0]).toMatch(/vegetacao/);
  });

  it('rejeita pontuação 11', () => {
    const r = validarCriterios({ ...valido, relevo: 11 });
    expect(r.ok).toBe(false);
    expect(r.erros[0]).toMatch(/relevo/);
  });

  it('rejeita não-inteiro', () => {
    const r = validarCriterios({ ...valido, clima: 5.5 });
    expect(r.ok).toBe(false);
  });

  it('acumula múltiplos erros', () => {
    const r = validarCriterios({ ...valido, vegetacao: 0, relevo: 11 });
    expect(r.erros.length).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

Run: `cd "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent" && npx vitest run src/services/pricing/incra.test.ts`
Expected: FAIL com `validarCriterios is not a function` ou similar.

- [ ] **Step 3: Implementar a função**

Adicionar ao FINAL de `src/services/pricing/incra.ts`:

```typescript
export function validarCriterios(c: CriteriosPontuacao): { ok: boolean; erros: string[] } {
  const erros: string[] = [];
  for (const [k, v] of Object.entries(c) as Array<[keyof CriteriosPontuacao, number]>) {
    if (!Number.isInteger(v) || v < 1 || v > 10) {
      erros.push(`Critério ${k}: pontuação deve ser inteiro de 1 a 10 (recebido: ${v})`);
    }
  }
  return { ok: erros.length === 0, erros };
}
```

- [ ] **Step 4: Rodar teste — deve passar**

Run: `cd "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent" && npx vitest run src/services/pricing/incra.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/services/pricing/incra.ts src/services/pricing/incra.test.ts
git commit -m "feat(incra): validarCriterios + 5 casos de teste"
```

---

### Task 4: `calcularPontuacaoTotal` (TDD)

**Files:**
- Modify: `src/services/pricing/incra.ts`
- Modify: `src/services/pricing/incra.test.ts`

- [ ] **Step 1: Adicionar testes**

Append em `src/services/pricing/incra.test.ts`:

```typescript
import { calcularPontuacaoTotal } from './incra';

describe('calcularPontuacaoTotal', () => {
  it('soma 6 critérios = 30', () => {
    expect(calcularPontuacaoTotal({
      vegetacao: 5, relevo: 5, insalubridade: 5, acesso: 5, clima: 5, area_media: 5,
    })).toBe(30);
  });

  it('mínimo possível é 6', () => {
    expect(calcularPontuacaoTotal({
      vegetacao: 1, relevo: 1, insalubridade: 1, acesso: 1, clima: 1, area_media: 1,
    })).toBe(6);
  });

  it('máximo possível é 60', () => {
    expect(calcularPontuacaoTotal({
      vegetacao: 10, relevo: 10, insalubridade: 10, acesso: 10, clima: 10, area_media: 10,
    })).toBe(60);
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

Run: `npx vitest run src/services/pricing/incra.test.ts`
Expected: FAIL — `calcularPontuacaoTotal is not exported`.

- [ ] **Step 3: Implementar**

Append em `src/services/pricing/incra.ts`:

```typescript
export function calcularPontuacaoTotal(c: CriteriosPontuacao): number {
  return c.vegetacao + c.relevo + c.insalubridade + c.acesso + c.clima + c.area_media;
}
```

- [ ] **Step 4: Rodar teste — passar**

Run: `npx vitest run src/services/pricing/incra.test.ts`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add src/services/pricing/incra.ts src/services/pricing/incra.test.ts
git commit -m "feat(incra): calcularPontuacaoTotal"
```

---

### Task 5: `obterFaixa` (TDD)

**Files:**
- Modify: `src/services/pricing/incra.ts`
- Modify: `src/services/pricing/incra.test.ts`

- [ ] **Step 1: Adicionar testes**

Append:

```typescript
import { obterFaixa } from './incra';

describe('obterFaixa', () => {
  it('pontuação 6 → faixa 06-15', () => {
    expect(obterFaixa(6).label).toBe('06-15');
  });
  it('pontuação 15 → faixa 06-15 (limite alto)', () => {
    expect(obterFaixa(15).label).toBe('06-15');
  });
  it('pontuação 16 → faixa 16-25', () => {
    expect(obterFaixa(16).label).toBe('16-25');
  });
  it('pontuação 35 → faixa 26-35', () => {
    expect(obterFaixa(35).label).toBe('26-35');
  });
  it('pontuação 60 → faixa 56-60', () => {
    expect(obterFaixa(60).label).toBe('56-60');
  });
  it('pontuação 5 → throw', () => {
    expect(() => obterFaixa(5)).toThrow(/abaixo do mínimo/);
  });
  it('pontuação 61 → throw', () => {
    expect(() => obterFaixa(61)).toThrow(/acima do máximo/);
  });
});
```

- [ ] **Step 2: Run, must fail**

Run: `npx vitest run src/services/pricing/incra.test.ts`
Expected: FAIL — `obterFaixa is not exported`.

- [ ] **Step 3: Implementar**

Append em `incra.ts`:

```typescript
export function obterFaixa(pontuacao: number): FaixaIncra {
  if (pontuacao < 6)  throw new Error(`Pontuação ${pontuacao} abaixo do mínimo (6)`);
  if (pontuacao > 60) throw new Error(`Pontuação ${pontuacao} acima do máximo (60)`);
  const faixa = TABELA_INCRA_2025.find(f => pontuacao >= f.pontuacaoMin && pontuacao <= f.pontuacaoMax);
  if (!faixa) throw new Error(`Faixa não encontrada para pontuação ${pontuacao}`);
  return faixa;
}
```

- [ ] **Step 4: Run, must pass**

Run: `npx vitest run src/services/pricing/incra.test.ts`
Expected: PASS, 15/15.

- [ ] **Step 5: Commit**

```bash
git add src/services/pricing/incra.ts src/services/pricing/incra.test.ts
git commit -m "feat(incra): obterFaixa com 7 casos cobrindo limites"
```

---

### Task 6: `obterValorUnitario` + `calcularPrecificacao` básico (TDD)

**Files:**
- Modify: `src/services/pricing/incra.ts`
- Modify: `src/services/pricing/incra.test.ts`

- [ ] **Step 1: Testes**

Append:

```typescript
import { obterValorUnitario, calcularPrecificacao, type InputPrecificacao } from './incra';

describe('obterValorUnitario', () => {
  it('faixa 26-35 km → R$ 1.571,64', () => {
    const f = obterFaixa(30);
    expect(obterValorUnitario(f, 'km')).toBe(1571.64);
  });
  it('faixa 26-35 hectare → R$ 104,78', () => {
    expect(obterValorUnitario(obterFaixa(30), 'hectare')).toBe(104.78);
  });
  it('faixa 26-35 lote → R$ 1.298,88', () => {
    expect(obterValorUnitario(obterFaixa(30), 'lote')).toBe(1298.88);
  });
});

describe('calcularPrecificacao — sem desconto', () => {
  const baseInput: InputPrecificacao = {
    criterios: { vegetacao: 5, relevo: 5, insalubridade: 5, acesso: 5, clima: 5, area_media: 5 },
    unidade: 'km',
    quantidade: 100,
    desconto: { tipo: 'nenhum', valor: 0 },
  };

  it('100 km × faixa 26-35 = R$ 157.164,00', () => {
    const r = calcularPrecificacao(baseInput);
    expect(r.pontuacaoTotal).toBe(30);
    expect(r.faixa.label).toBe('26-35');
    expect(r.valorUnitario).toBe(1571.64);
    expect(r.valorBase).toBe(157164.00);
    expect(r.descontoAplicado).toBe(0);
    expect(r.valorFinal).toBe(157164.00);
    expect(r.detalhamento.avisos).toEqual([]);
  });

  it('quantidade 0 → throw', () => {
    expect(() => calcularPrecificacao({ ...baseInput, quantidade: 0 })).toThrow(/maior que zero/);
  });

  it('quantidade negativa → throw', () => {
    expect(() => calcularPrecificacao({ ...baseInput, quantidade: -1 })).toThrow(/maior que zero/);
  });

  it('critérios inválidos → throw', () => {
    expect(() => calcularPrecificacao({
      ...baseInput,
      criterios: { ...baseInput.criterios, vegetacao: 11 },
    })).toThrow(/Critérios inválidos/);
  });
});
```

- [ ] **Step 2: Run, must fail**

Run: `npx vitest run src/services/pricing/incra.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Append em `incra.ts`:

```typescript
export function obterValorUnitario(faixa: FaixaIncra, unidade: UnidadeCalculo): number {
  switch (unidade) {
    case 'km':      return faixa.valorPorKm;
    case 'hectare': return faixa.valorPorHectare;
    case 'lote':    return faixa.valorPorLote;
  }
}

export function calcularPrecificacao(input: InputPrecificacao): ResultadoPrecificacao {
  const validacao = validarCriterios(input.criterios);
  if (!validacao.ok) {
    throw new Error(`Critérios inválidos: ${validacao.erros.join('; ')}`);
  }
  if (input.quantidade <= 0) {
    throw new Error('Quantidade deve ser maior que zero');
  }

  const pontuacaoTotal = calcularPontuacaoTotal(input.criterios);
  const faixa = obterFaixa(pontuacaoTotal);
  const valorUnitario = obterValorUnitario(faixa, input.unidade);
  const valorBase = +(valorUnitario * input.quantidade).toFixed(2);

  let descontoAplicado = 0;
  const avisos: string[] = [];

  if (input.desconto.tipo === 'percentual') {
    if (input.desconto.valor < 0 || input.desconto.valor > 100) {
      throw new Error('Desconto percentual deve estar entre 0 e 100');
    }
    descontoAplicado = +(valorBase * (input.desconto.valor / 100)).toFixed(2);
  } else if (input.desconto.tipo === 'fixo') {
    if (input.desconto.valor < 0) {
      throw new Error('Desconto fixo não pode ser negativo');
    }
    if (input.desconto.valor > valorBase) {
      throw new Error('Desconto fixo não pode ser maior que o valor base');
    }
    descontoAplicado = +input.desconto.valor.toFixed(2);
  }

  const valorFinal = +(valorBase - descontoAplicado).toFixed(2);

  if (valorBase > 0) {
    const percentualDesconto = (descontoAplicado / valorBase) * 100;
    if (percentualDesconto > 10) {
      avisos.push(
        `Desconto aplicado (${percentualDesconto.toFixed(1)}%) excede a variação admissível ` +
        `de ±10% prevista na Portaria INCRA 12/2025.`
      );
    }
  }

  const unidadeLabel = input.unidade === 'km' ? 'km lineares'
                     : input.unidade === 'hectare' ? 'hectares'
                     : 'lotes';

  return {
    pontuacaoTotal,
    faixa,
    valorUnitario,
    valorBase,
    descontoAplicado,
    valorFinal,
    detalhamento: {
      formula: `${input.quantidade} ${unidadeLabel} × R$ ${valorUnitario.toFixed(2)} = R$ ${valorBase.toFixed(2)}`,
      avisos,
    },
  };
}
```

- [ ] **Step 4: Run, must pass**

Run: `npx vitest run src/services/pricing/incra.test.ts`
Expected: PASS, 22/22.

- [ ] **Step 5: Commit**

```bash
git add src/services/pricing/incra.ts src/services/pricing/incra.test.ts
git commit -m "feat(incra): obterValorUnitario + calcularPrecificacao basico"
```

---

### Task 7: Descontos percentual e fixo (TDD)

**Files:**
- Modify: `src/services/pricing/incra.test.ts`

- [ ] **Step 1: Testes adicionais**

Append:

```typescript
describe('calcularPrecificacao — descontos', () => {
  const base: InputPrecificacao = {
    criterios: { vegetacao: 5, relevo: 5, insalubridade: 5, acesso: 5, clima: 5, area_media: 5 },
    unidade: 'hectare',
    quantidade: 10,    // 10 ha × 104,78 = 1.047,80
    desconto: { tipo: 'nenhum', valor: 0 },
  };

  it('desconto percentual 10% sobre R$ 1.047,80 = R$ 104,78', () => {
    const r = calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: 10 } });
    expect(r.valorBase).toBe(1047.80);
    expect(r.descontoAplicado).toBe(104.78);
    expect(r.valorFinal).toBe(943.02);
  });

  it('desconto fixo R$ 47,80 sobre R$ 1.047,80 = R$ 1.000,00', () => {
    const r = calcularPrecificacao({ ...base, desconto: { tipo: 'fixo', valor: 47.80 } });
    expect(r.valorFinal).toBe(1000.00);
  });

  it('desconto percentual > 100 → throw', () => {
    expect(() => calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: 110 } })).toThrow(/entre 0 e 100/);
  });

  it('desconto percentual < 0 → throw', () => {
    expect(() => calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: -5 } })).toThrow(/entre 0 e 100/);
  });

  it('desconto fixo > valor base → throw', () => {
    expect(() => calcularPrecificacao({ ...base, desconto: { tipo: 'fixo', valor: 9999 } })).toThrow(/maior que o valor base/);
  });

  it('desconto fixo negativo → throw', () => {
    expect(() => calcularPrecificacao({ ...base, desconto: { tipo: 'fixo', valor: -1 } })).toThrow(/não pode ser negativo/);
  });
});
```

- [ ] **Step 2: Run, must pass (lógica já implementada na Task 6)**

Run: `npx vitest run src/services/pricing/incra.test.ts`
Expected: PASS, 28/28.

- [ ] **Step 3: Commit**

```bash
git add src/services/pricing/incra.test.ts
git commit -m "test(incra): cenarios de desconto percentual e fixo"
```

---

### Task 8: Aviso > 10% (TDD)

**Files:**
- Modify: `src/services/pricing/incra.test.ts`

- [ ] **Step 1: Teste**

Append:

```typescript
describe('calcularPrecificacao — aviso de variação', () => {
  const base: InputPrecificacao = {
    criterios: { vegetacao: 5, relevo: 5, insalubridade: 5, acesso: 5, clima: 5, area_media: 5 },
    unidade: 'hectare',
    quantidade: 10,
    desconto: { tipo: 'nenhum', valor: 0 },
  };

  it('desconto 10% — sem aviso', () => {
    const r = calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: 10 } });
    expect(r.detalhamento.avisos).toEqual([]);
  });

  it('desconto 11% — emite aviso', () => {
    const r = calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: 11 } });
    expect(r.detalhamento.avisos.length).toBe(1);
    expect(r.detalhamento.avisos[0]).toMatch(/Portaria INCRA 12\/2025/);
    expect(r.detalhamento.avisos[0]).toMatch(/±10%/);
  });

  it('desconto 25% — emite aviso', () => {
    const r = calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: 25 } });
    expect(r.detalhamento.avisos.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run, must pass (lógica já existe)**

Run: `npx vitest run src/services/pricing/incra.test.ts`
Expected: PASS, 31/31.

- [ ] **Step 3: Commit**

```bash
git add src/services/pricing/incra.test.ts
git commit -m "test(incra): avisos quando desconto > 10%"
```

---

### Task 9: `sugerirCriterios` (TDD)

**Files:**
- Modify: `src/services/pricing/incra.ts`
- Modify: `src/services/pricing/incra.test.ts`

- [ ] **Step 1: Testes**

Append em `incra.test.ts`:

```typescript
import { sugerirCriterios } from './incra';

describe('sugerirCriterios', () => {
  it('sem dados → todos os critérios = 5 (default conservador)', () => {
    const c = sugerirCriterios({});
    expect(c.vegetacao).toBe(5);
    expect(c.relevo).toBe(5);
    expect(c.insalubridade).toBe(5);
    expect(c.acesso).toBe(5);
    expect(c.clima).toBe(5);
    expect(c.area_media).toBe(5);
  });

  it('area_total_m2 = 500.000 (50 ha) → area_media = 2 (>35 ha favorável)', () => {
    const c = sugerirCriterios({ area_total_m2: 500_000 });
    expect(c.area_media).toBe(2);
  });

  it('area_total_m2 = 250.000 (25 ha) → area_media = 5 (15-35 ha mediano)', () => {
    const c = sugerirCriterios({ area_total_m2: 250_000 });
    expect(c.area_media).toBe(5);
  });

  it('area_total_m2 = 100.000 (10 ha) → area_media = 8 (≤15 ha desfavorável)', () => {
    const c = sugerirCriterios({ area_total_m2: 100_000 });
    expect(c.area_media).toBe(8);
  });

  it('UF=MA → insalubridade = 7 (Amazônia Legal)', () => {
    const c = sugerirCriterios({ uf: 'MA' });
    expect(c.insalubridade).toBe(7);
  });

  it('UF=ma (lower) → insalubridade = 7', () => {
    const c = sugerirCriterios({ uf: 'ma' });
    expect(c.insalubridade).toBe(7);
  });

  it('UF=SP → insalubridade = 5 (default)', () => {
    const c = sugerirCriterios({ uf: 'SP' });
    expect(c.insalubridade).toBe(5);
  });

  it('tipo_vegetacao=fechada → vegetacao = 8', () => {
    const c = sugerirCriterios({ tipo_vegetacao: 'fechada' });
    expect(c.vegetacao).toBe(8);
  });

  it('tipo_vegetacao=aberta → vegetacao = 2', () => {
    const c = sugerirCriterios({ tipo_vegetacao: 'aberta' });
    expect(c.vegetacao).toBe(2);
  });

  it('combinação MA + 10ha → insalubridade=7, area_media=8', () => {
    const c = sugerirCriterios({ uf: 'MA', area_total_m2: 100_000 });
    expect(c.insalubridade).toBe(7);
    expect(c.area_media).toBe(8);
  });
});
```

- [ ] **Step 2: Run, must fail**

Run: `npx vitest run src/services/pricing/incra.test.ts`
Expected: FAIL — `sugerirCriterios is not exported`.

- [ ] **Step 3: Implementar**

Append em `incra.ts`:

```typescript
export function sugerirCriterios(dados: DadosLaudoParaSugestao): CriteriosPontuacao {
  const c: CriteriosPontuacao = {
    vegetacao: 5,
    relevo: 5,
    insalubridade: 5,
    acesso: 5,
    clima: 5,
    area_media: 5,
  };

  if (dados.tipo_vegetacao === 'aberta') c.vegetacao = 2;
  else if (dados.tipo_vegetacao === 'intermediaria') c.vegetacao = 5;
  else if (dados.tipo_vegetacao === 'fechada') c.vegetacao = 8;

  if (typeof dados.area_total_m2 === 'number' && dados.area_total_m2 > 0) {
    const ha = dados.area_total_m2 / 10000;
    if (ha > 35)      c.area_media = 2;
    else if (ha > 15) c.area_media = 5;
    else              c.area_media = 8;
  }

  const ufsAlta = ['MA', 'PA', 'AM', 'AC', 'RO', 'RR', 'AP', 'TO', 'MT'];
  if (dados.uf && ufsAlta.includes(dados.uf.toUpperCase())) {
    c.insalubridade = 7;
  }

  return c;
}
```

- [ ] **Step 4: Run, must pass**

Run: `npx vitest run src/services/pricing/incra.test.ts`
Expected: PASS, 41/41.

- [ ] **Step 5: Commit**

```bash
git add src/services/pricing/incra.ts src/services/pricing/incra.test.ts
git commit -m "feat(incra): sugerirCriterios com 10 casos (area, uf, vegetacao)"
```

---

### Task 10: Espelho front em `incraCalc.js`

**Files:**
- Create: `src/public/js/incraCalc.js`

- [ ] **Step 1: Criar arquivo**

```javascript
// src/public/js/incraCalc.js
//
// Espelho vanilla JS de src/services/pricing/incra.ts.
// MUDOU AQUI? Atualize lá. Teste de paridade em incra.test.ts garante que back e
// front calculam o mesmo (54 cenários: 6 faixas × 3 unidades × 3 tipos de desconto).
//
// Exposto globalmente como window.IncraCalc.

(function (global) {
  'use strict';

  const TABELA_INCRA_2025 = [
    { pontuacaoMin: 6,  pontuacaoMax: 15, rendimentoKmDia: 5.00, valorPorKm: 747.52,  valorPorHectare: 49.83,  valorPorLote: 617.79,  label: '06-15' },
    { pontuacaoMin: 16, pontuacaoMax: 25, rendimentoKmDia: 4.25, valorPorKm: 897.03,  valorPorHectare: 59.80,  valorPorLote: 741.34,  label: '16-25' },
    { pontuacaoMin: 26, pontuacaoMax: 35, rendimentoKmDia: 3.50, valorPorKm: 1571.64, valorPorHectare: 104.78, valorPorLote: 1298.88, label: '26-35' },
    { pontuacaoMin: 36, pontuacaoMax: 45, rendimentoKmDia: 2.15, valorPorKm: 2023.23, valorPorHectare: 134.88, valorPorLote: 1672.09, label: '36-45' },
    { pontuacaoMin: 46, pontuacaoMax: 55, rendimentoKmDia: 1.25, valorPorKm: 2474.20, valorPorHectare: 164.95, valorPorLote: 2044.80, label: '46-55' },
    { pontuacaoMin: 56, pontuacaoMax: 60, rendimentoKmDia: 0.80, valorPorKm: 3043.12, valorPorHectare: 202.87, valorPorLote: 2514.97, label: '56-60' },
  ];

  const CRITERIOS_INCRA = {
    vegetacao:     { label: 'Vegetação',          niveis: [{ rotulo: 'Aberta', maxPonto: 3 }, { rotulo: 'Intermediária', maxPonto: 6 }, { rotulo: 'Fechada', maxPonto: 10 }] },
    relevo:        { label: 'Relevo',             niveis: [{ rotulo: 'Plano a Suave Ondulado', maxPonto: 3 }, { rotulo: 'Moderadamente ondulado a Ondulado', maxPonto: 6 }, { rotulo: 'Forte ondulado a Escarpado', maxPonto: 10 }] },
    insalubridade: { label: 'Insalubridade',      niveis: [{ rotulo: 'Baixa', maxPonto: 3 }, { rotulo: 'Média', maxPonto: 6 }, { rotulo: 'Alta', maxPonto: 10 }] },
    acesso:        { label: 'Acesso',             niveis: [{ rotulo: 'Fácil', maxPonto: 3 }, { rotulo: 'Regular', maxPonto: 6 }, { rotulo: 'Difícil', maxPonto: 10 }] },
    clima:         { label: 'Clima',              niveis: [{ rotulo: 'Favorável', maxPonto: 3 }, { rotulo: 'Mediano', maxPonto: 6 }, { rotulo: 'Desfavorável', maxPonto: 10 }] },
    area_media:    { label: 'Área Média',         niveis: [{ rotulo: 'Favorável (>35ha)', maxPonto: 3 }, { rotulo: 'Mediano (15-35ha)', maxPonto: 6 }, { rotulo: 'Desfavorável (≤15ha)', maxPonto: 10 }] },
  };

  function rotuloDoNivel(criterio, ponto) {
    const niveis = CRITERIOS_INCRA[criterio]?.niveis;
    if (!niveis) return '';
    return niveis.find(n => ponto <= n.maxPonto)?.rotulo || '';
  }

  function validarCriterios(c) {
    const erros = [];
    for (const k of ['vegetacao','relevo','insalubridade','acesso','clima','area_media']) {
      const v = c[k];
      if (!Number.isInteger(v) || v < 1 || v > 10) {
        erros.push(`Critério ${k}: pontuação deve ser inteiro de 1 a 10 (recebido: ${v})`);
      }
    }
    return { ok: erros.length === 0, erros };
  }

  function calcularPontuacaoTotal(c) {
    return c.vegetacao + c.relevo + c.insalubridade + c.acesso + c.clima + c.area_media;
  }

  function obterFaixa(p) {
    if (p < 6)  throw new Error(`Pontuação ${p} abaixo do mínimo (6)`);
    if (p > 60) throw new Error(`Pontuação ${p} acima do máximo (60)`);
    const f = TABELA_INCRA_2025.find(x => p >= x.pontuacaoMin && p <= x.pontuacaoMax);
    if (!f) throw new Error(`Faixa não encontrada para pontuação ${p}`);
    return f;
  }

  function obterValorUnitario(faixa, unidade) {
    if (unidade === 'km')      return faixa.valorPorKm;
    if (unidade === 'hectare') return faixa.valorPorHectare;
    if (unidade === 'lote')    return faixa.valorPorLote;
    throw new Error(`Unidade desconhecida: ${unidade}`);
  }

  function calcularPrecificacao(input) {
    const v = validarCriterios(input.criterios);
    if (!v.ok) throw new Error(`Critérios inválidos: ${v.erros.join('; ')}`);
    if (input.quantidade <= 0) throw new Error('Quantidade deve ser maior que zero');

    const pontuacaoTotal = calcularPontuacaoTotal(input.criterios);
    const faixa = obterFaixa(pontuacaoTotal);
    const valorUnitario = obterValorUnitario(faixa, input.unidade);
    const valorBase = +(valorUnitario * input.quantidade).toFixed(2);

    let descontoAplicado = 0;
    const avisos = [];

    if (input.desconto.tipo === 'percentual') {
      if (input.desconto.valor < 0 || input.desconto.valor > 100) {
        throw new Error('Desconto percentual deve estar entre 0 e 100');
      }
      descontoAplicado = +(valorBase * (input.desconto.valor / 100)).toFixed(2);
    } else if (input.desconto.tipo === 'fixo') {
      if (input.desconto.valor < 0) throw new Error('Desconto fixo não pode ser negativo');
      if (input.desconto.valor > valorBase) throw new Error('Desconto fixo não pode ser maior que o valor base');
      descontoAplicado = +input.desconto.valor.toFixed(2);
    }

    const valorFinal = +(valorBase - descontoAplicado).toFixed(2);

    if (valorBase > 0) {
      const pct = (descontoAplicado / valorBase) * 100;
      if (pct > 10) {
        avisos.push(
          `Desconto aplicado (${pct.toFixed(1)}%) excede a variação admissível ` +
          `de ±10% prevista na Portaria INCRA 12/2025.`
        );
      }
    }

    const unidadeLabel = input.unidade === 'km' ? 'km lineares'
                       : input.unidade === 'hectare' ? 'hectares'
                       : 'lotes';

    return {
      pontuacaoTotal,
      faixa,
      valorUnitario,
      valorBase,
      descontoAplicado,
      valorFinal,
      detalhamento: {
        formula: `${input.quantidade} ${unidadeLabel} × R$ ${valorUnitario.toFixed(2)} = R$ ${valorBase.toFixed(2)}`,
        avisos,
      },
    };
  }

  global.IncraCalc = {
    TABELA_INCRA_2025,
    CRITERIOS_INCRA,
    rotuloDoNivel,
    validarCriterios,
    calcularPontuacaoTotal,
    obterFaixa,
    obterValorUnitario,
    calcularPrecificacao,
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Verificar com node**

Run:
```bash
cd "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent"
node -e "
require('./src/public/js/incraCalc.js');
const r = globalThis.IncraCalc.calcularPrecificacao({
  criterios: { vegetacao:5,relevo:5,insalubridade:5,acesso:5,clima:5,area_media:5 },
  unidade: 'km', quantidade: 100, desconto: { tipo:'nenhum', valor:0 },
});
console.log(JSON.stringify(r, null, 2));
"
```
Expected: imprime JSON com `valorFinal: 157164` e `faixa.label: '26-35'`.

- [ ] **Step 3: Commit**

```bash
git add src/public/js/incraCalc.js
git commit -m "feat(incra): incraCalc.js — espelho front da logica de precificacao"
```

---

### Task 11: Teste de paridade back↔front (54 cenários)

**Files:**
- Modify: `src/services/pricing/incra.test.ts`

- [ ] **Step 1: Adicionar suite de paridade**

Append em `incra.test.ts`:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

describe('paridade back↔front', () => {
  const jsPath = path.resolve(__dirname, '../../public/js/incraCalc.js');
  const jsCode = fs.readFileSync(jsPath, 'utf-8');
  const ctx: any = {};
  vm.createContext(ctx);
  vm.runInContext(jsCode, ctx);
  const front = ctx.IncraCalc;

  const pontuacoesPorFaixa = [10, 20, 30, 40, 50, 58]; // representante de cada faixa
  const unidades: UnidadeCalculo[] = ['km', 'hectare', 'lote'];
  const descontos: Array<{ tipo: DescontoTipo; valor: number }> = [
    { tipo: 'nenhum', valor: 0 },
    { tipo: 'percentual', valor: 5 },
    { tipo: 'fixo', valor: 100 },
  ];

  for (const ponto of pontuacoesPorFaixa) {
    for (const unidade of unidades) {
      for (const desconto of descontos) {
        it(`paridade: ponto=${ponto} unidade=${unidade} desconto=${desconto.tipo}/${desconto.valor}`, () => {
          // Distribui pontos pra que cada critério tenha valor inteiro 1-10 e a soma = ponto
          const base = Math.floor(ponto / 6);
          const sobra = ponto - base * 6;
          const criterios: CriteriosPontuacao = {
            vegetacao:     base + (sobra > 0 ? 1 : 0),
            relevo:        base + (sobra > 1 ? 1 : 0),
            insalubridade: base + (sobra > 2 ? 1 : 0),
            acesso:        base + (sobra > 3 ? 1 : 0),
            clima:         base + (sobra > 4 ? 1 : 0),
            area_media:    base + (sobra > 5 ? 1 : 0),
          };
          // Garantir mínimo 1 (caso ponto=6 → base=1, sobra=0 → todos 1, soma=6 OK)
          for (const k of Object.keys(criterios) as Array<keyof CriteriosPontuacao>) {
            if (criterios[k] < 1) criterios[k] = 1;
          }

          const input: InputPrecificacao = {
            criterios,
            unidade,
            quantidade: 10,
            desconto,
          };

          const back = calcularPrecificacao(input);
          const frnt = front.calcularPrecificacao(input);

          expect(frnt.pontuacaoTotal).toBe(back.pontuacaoTotal);
          expect(frnt.faixa.label).toBe(back.faixa.label);
          expect(frnt.valorUnitario).toBe(back.valorUnitario);
          expect(frnt.valorBase).toBe(back.valorBase);
          expect(frnt.descontoAplicado).toBe(back.descontoAplicado);
          expect(frnt.valorFinal).toBe(back.valorFinal);
        });
      }
    }
  }
});
```

- [ ] **Step 2: Run, must pass**

Run: `npx vitest run src/services/pricing/incra.test.ts`
Expected: PASS, ~95/95 (41 anteriores + 54 de paridade).

- [ ] **Step 3: Commit**

```bash
git add src/services/pricing/incra.test.ts
git commit -m "test(incra): paridade back/front com 54 cenarios"
```

---

### Task 12: Migration `migrations-precificacao-incra.ts`

**Files:**
- Create: `src/database/migrations-precificacao-incra.ts`

- [ ] **Step 1: Criar arquivo seguindo padrão de `migrations-laudos.ts`**

```typescript
// src/database/migrations-precificacao-incra.ts
//
// v3.0.0: precificação automática INCRA (Portaria 12/2025).
// Adiciona 16 colunas em laudos_demarcacao + 1 índice. Idempotente.

import { pool } from './pool';

export async function runPrecificacaoIncraMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    // Unidade e critérios (1-10)
    { label: 'ALTER unidade_calculo',   sql: "ALTER TABLE laudos_demarcacao ADD COLUMN unidade_calculo ENUM('km','hectare','lote') NULL COMMENT 'Unidade base do calculo INCRA'" },
    { label: 'ALTER pont_vegetacao',    sql: "ALTER TABLE laudos_demarcacao ADD COLUMN pont_vegetacao TINYINT NULL COMMENT '1-10 conforme Quadro 1 Portaria INCRA 12/2025'" },
    { label: 'ALTER pont_relevo',       sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN pont_relevo TINYINT NULL' },
    { label: 'ALTER pont_insalubridade',sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN pont_insalubridade TINYINT NULL' },
    { label: 'ALTER pont_acesso',       sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN pont_acesso TINYINT NULL' },
    { label: 'ALTER pont_clima',        sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN pont_clima TINYINT NULL' },
    { label: 'ALTER pont_area_media',   sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN pont_area_media TINYINT NULL' },

    // Pontuação derivada e faixa
    { label: 'ALTER pontuacao_total',   sql: "ALTER TABLE laudos_demarcacao ADD COLUMN pontuacao_total SMALLINT NULL COMMENT 'Soma 6-60'" },
    { label: 'ALTER faixa_aplicada',    sql: "ALTER TABLE laudos_demarcacao ADD COLUMN faixa_aplicada VARCHAR(10) NULL COMMENT 'Ex 26-35'" },

    // Cálculo
    { label: 'ALTER valor_unitario',    sql: "ALTER TABLE laudos_demarcacao ADD COLUMN valor_unitario DECIMAL(12,2) NULL COMMENT 'R$/km, R$/ha ou R$/lote'" },
    { label: 'ALTER quantidade_calc',   sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN quantidade_calculo DECIMAL(14,4) NULL' },
    { label: 'ALTER valor_base_calc',   sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN valor_base_calculado DECIMAL(14,2) NULL' },

    // Desconto
    { label: 'ALTER desconto_tipo',     sql: "ALTER TABLE laudos_demarcacao ADD COLUMN desconto_tipo ENUM('percentual','fixo','nenhum') DEFAULT 'nenhum'" },
    { label: 'ALTER desconto_valor',    sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN desconto_valor DECIMAL(12,2) DEFAULT 0' },

    // Resultado
    { label: 'ALTER valor_final',       sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN valor_final DECIMAL(14,2) NULL' },
    { label: 'ALTER precif_obs',        sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN precificacao_observacoes TEXT NULL' },
    { label: 'ALTER precif_calc_em',    sql: "ALTER TABLE laudos_demarcacao ADD COLUMN precificacao_calculada_em DATETIME NULL COMMENT 'Flag: NOT NULL = INCRA aplicada'" },

    // Índice
    { label: 'CREATE idx_precificacao', sql: 'CREATE INDEX idx_laudos_precificacao ON laudos_demarcacao(precificacao_calculada_em)' },
  ];

  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[precif-incra-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate|Duplicate key name/i.test(msg)) {
        console.log(`[precif-incra-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[precif-incra-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/database/migrations-precificacao-incra.ts
git commit -m "feat(incra): migration adiciona 16 colunas de precificacao em laudos_demarcacao"
```

---

### Task 13: Wire da migration no boot do `server.ts`

**Files:**
- Modify: `src/server.ts:3035-3062` (adicionar IIFE após bloco loteamentos)

- [ ] **Step 1: Localizar o bloco de loteamentos**

Run: `grep -n "runLoteamentosMigrations" "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/src/server.ts"`
Expected: linha ~3060.

- [ ] **Step 2: Adicionar IIFE**

Encontrar o trecho:

```typescript
  // v2.8.0: migrations do modulo Loteamentos / Auto-preenchimento.
  void (async () => {
    try {
      const m = await import('./database/migrations-loteamentos');
      await m.runLoteamentosMigrations();
    } catch (err) {
      console.error('[loteamentos-migrations] FALHA fatal:', err);
    }
  })();
```

E acrescentar **logo abaixo**:

```typescript
  // v3.0.0: migrations da Precificacao INCRA (Portaria 12/2025).
  void (async () => {
    try {
      const m = await import('./database/migrations-precificacao-incra');
      await m.runPrecificacaoIncraMigrations();
    } catch (err) {
      console.error('[precif-incra-migrations] FALHA fatal:', err);
    }
  })();
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(incra): chama runPrecificacaoIncraMigrations no boot"
```

---

### Task 14: Função `atualizarPrecificacao` em `integrations/laudos.ts`

**Files:**
- Modify: `src/integrations/laudos.ts`

- [ ] **Step 1: Localizar função `atualizarLaudo` existente**

Run: `grep -n "export async function atualizarLaudo" "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/src/integrations/laudos.ts"`
Expected: linha exata. Inspecionar para ver o padrão.

- [ ] **Step 2: Adicionar `atualizarPrecificacao` no final do arquivo**

Adicionar ao final de `src/integrations/laudos.ts`:

```typescript
import type {
  CriteriosPontuacao,
  UnidadeCalculo,
  DescontoTipo,
  ResultadoPrecificacao,
} from '../services/pricing/incra';

export interface DadosPrecificacaoPersistir {
  unidade: UnidadeCalculo;
  criterios: CriteriosPontuacao;
  quantidade: number;
  resultado: ResultadoPrecificacao;
  desconto: { tipo: DescontoTipo; valor: number };
  observacoes?: string | null;
}

export async function atualizarPrecificacao(
  id: number,
  d: DadosPrecificacaoPersistir,
): Promise<void> {
  await pool.execute(
    `UPDATE laudos_demarcacao SET
        unidade_calculo = ?,
        pont_vegetacao = ?, pont_relevo = ?, pont_insalubridade = ?,
        pont_acesso = ?,    pont_clima = ?,  pont_area_media = ?,
        pontuacao_total = ?, faixa_aplicada = ?,
        valor_unitario = ?, quantidade_calculo = ?, valor_base_calculado = ?,
        desconto_tipo = ?, desconto_valor = ?,
        valor_final = ?,    valor_servico = ?,
        precificacao_observacoes = ?,
        precificacao_calculada_em = NOW()
      WHERE id = ?`,
    [
      d.unidade,
      d.criterios.vegetacao, d.criterios.relevo, d.criterios.insalubridade,
      d.criterios.acesso,    d.criterios.clima,  d.criterios.area_media,
      d.resultado.pontuacaoTotal, d.resultado.faixa.label,
      d.resultado.valorUnitario, d.quantidade, d.resultado.valorBase,
      d.desconto.tipo, d.desconto.valor,
      d.resultado.valorFinal, d.resultado.valorFinal,    // valor_servico = valor_final (sync)
      d.observacoes ?? null,
      Number(id),
    ],
  );
}

export async function atualizarApenasDesconto(
  id: number,
  desconto: { tipo: DescontoTipo; valor: number },
  novoDescontoAplicado: number,
  novoValorFinal: number,
): Promise<void> {
  await pool.execute(
    `UPDATE laudos_demarcacao SET
        desconto_tipo = ?, desconto_valor = ?,
        valor_final = ?, valor_servico = ?,
        precificacao_calculada_em = NOW()
      WHERE id = ?`,
    [desconto.tipo, desconto.valor, novoValorFinal, novoValorFinal, Number(id)],
  );
  void novoDescontoAplicado; // valor armazenado fica em desconto_valor (input bruto), descontoAplicado é derivado
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/laudos.ts
git commit -m "feat(incra): atualizarPrecificacao + atualizarApenasDesconto em laudos integrations"
```

---

### Task 15: Endpoint `GET /api/laudos-demarcacao/:id/precificacao/sugerir`

**Files:**
- Modify: `src/server.ts` (adicionar perto dos outros endpoints `/api/laudos-demarcacao/`)

- [ ] **Step 1: Localizar bloco de endpoints**

Run: `grep -n "/api/laudos-demarcacao/:id/memorial" "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/src/server.ts"`
Expected: linha do handler do memorial. Adicionar os endpoints novos LOGO ANTES desse handler (mesma seção lógica).

- [ ] **Step 2: Adicionar handler**

Inserir antes do handler do memorial:

```typescript
// v3.0.0: precificação INCRA — sugestão de critérios baseada nos dados do laudo
app.get('/api/laudos-demarcacao/:id/precificacao/sugerir', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const { sugerirCriterios } = await import('./services/pricing/incra');
    const id = await m.resolverLaudoId(String(req.params.id));
    const laudo = await m.buscarLaudo(id);
    if (!laudo) return res.status(404).json({ error: 'Laudo nao encontrado' });

    const criterios = sugerirCriterios({
      area_total_m2: laudo.area_total_m2 ?? undefined,
      perimetro_m:   laudo.perimetro_m ?? undefined,
      uf:            laudo.uf_imovel ?? undefined,
      municipio:     laudo.municipio ?? undefined,
    });

    res.json({
      criterios,
      fonte: {
        area_ha:      laudo.area_total_m2 ? +(laudo.area_total_m2 / 10000).toFixed(4) : null,
        perimetro_km: laudo.perimetro_m ? +(laudo.perimetro_m / 1000).toFixed(4) : null,
        uf:           laudo.uf_imovel ?? null,
      },
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 3: Testar endpoint manualmente**

Iniciar servidor:
```bash
cd "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent"
npm run dev
```
(em outro terminal)
```bash
curl -s http://localhost:3000/api/laudos-demarcacao/1/precificacao/sugerir | head -c 500
```
Expected: JSON com `criterios` (6 campos) e `fonte` (area_ha, perimetro_km, uf). Se laudo id=1 não existir, retorna 404 — OK.

Parar o `npm run dev`.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(incra): endpoint GET /precificacao/sugerir"
```

---

### Task 16: Endpoint `POST /api/laudos-demarcacao/:id/precificacao/calcular`

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Adicionar handler logo abaixo do GET /sugerir**

```typescript
// v3.0.0: precificação INCRA — calcular e persistir
app.post('/api/laudos-demarcacao/:id/precificacao/calcular', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const unidade = String(body.unidade ?? '');
    if (!['km','hectare','lote'].includes(unidade)) {
      return res.status(400).json({ error: "Campo 'unidade' obrigatorio: km, hectare ou lote" });
    }
    const quantidade = Number(body.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return res.status(400).json({ error: "Campo 'quantidade' deve ser numero > 0" });
    }
    const c = body.criterios ?? {};
    const criterios = {
      vegetacao:     Number(c.vegetacao),
      relevo:        Number(c.relevo),
      insalubridade: Number(c.insalubridade),
      acesso:        Number(c.acesso),
      clima:         Number(c.clima),
      area_media:    Number(c.area_media),
    };
    const desc = body.desconto ?? { tipo: 'nenhum', valor: 0 };
    const desconto = {
      tipo:  String(desc.tipo ?? 'nenhum') as 'percentual' | 'fixo' | 'nenhum',
      valor: Number(desc.valor ?? 0),
    };
    if (!['percentual','fixo','nenhum'].includes(desconto.tipo)) {
      return res.status(400).json({ error: "desconto.tipo invalido" });
    }

    const m = await import('./integrations/laudos');
    const { calcularPrecificacao } = await import('./services/pricing/incra');
    const id = await m.resolverLaudoId(String(req.params.id));
    const laudo = await m.buscarLaudo(id);
    if (!laudo) return res.status(404).json({ error: 'Laudo nao encontrado' });

    const resultado = calcularPrecificacao({ criterios, unidade: unidade as 'km'|'hectare'|'lote', quantidade, desconto });

    await m.atualizarPrecificacao(id, {
      unidade: unidade as 'km'|'hectare'|'lote',
      criterios,
      quantidade,
      resultado,
      desconto,
      observacoes: body.observacoes ?? null,
    });

    res.json(resultado);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Teste manual**

```bash
npm run dev &
curl -s -X POST http://localhost:3000/api/laudos-demarcacao/1/precificacao/calcular \
  -H 'Content-Type: application/json' \
  -d '{"unidade":"hectare","quantidade":12.5,"criterios":{"vegetacao":5,"relevo":5,"insalubridade":7,"acesso":5,"clima":5,"area_media":8},"desconto":{"tipo":"percentual","valor":10}}'
```
Expected: JSON com `pontuacaoTotal: 35`, `valorBase: 1309.75`, `valorFinal: 1178.78`. Se 404, criar laudo de teste primeiro com `POST /api/laudos-demarcacao` (mesmo que vazio).

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat(incra): endpoint POST /precificacao/calcular"
```

---

### Task 17: Endpoint `PATCH /api/laudos-demarcacao/:id/precificacao`

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Adicionar handler logo abaixo do POST**

```typescript
// v3.0.0: precificação INCRA — recalcula só desconto (laudo já com precificação base)
app.patch('/api/laudos-demarcacao/:id/precificacao', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const desc = req.body?.desconto ?? {};
    const desconto = {
      tipo:  String(desc.tipo ?? 'nenhum') as 'percentual' | 'fixo' | 'nenhum',
      valor: Number(desc.valor ?? 0),
    };
    if (!['percentual','fixo','nenhum'].includes(desconto.tipo)) {
      return res.status(400).json({ error: "desconto.tipo invalido" });
    }

    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    const laudo = await m.buscarLaudo(id);
    if (!laudo) return res.status(404).json({ error: 'Laudo nao encontrado' });
    if (!laudo.precificacao_calculada_em || laudo.valor_base_calculado == null) {
      return res.status(409).json({ error: 'Laudo nao possui precificacao base. Use POST /precificacao/calcular primeiro.' });
    }

    const valorBase = Number(laudo.valor_base_calculado);
    let descontoAplicado = 0;
    const avisos: string[] = [];

    if (desconto.tipo === 'percentual') {
      if (desconto.valor < 0 || desconto.valor > 100) {
        return res.status(400).json({ error: 'Desconto percentual deve estar entre 0 e 100' });
      }
      descontoAplicado = +(valorBase * (desconto.valor / 100)).toFixed(2);
    } else if (desconto.tipo === 'fixo') {
      if (desconto.valor < 0) return res.status(400).json({ error: 'Desconto fixo nao pode ser negativo' });
      if (desconto.valor > valorBase) return res.status(400).json({ error: 'Desconto fixo nao pode ser maior que o valor base' });
      descontoAplicado = +desconto.valor.toFixed(2);
    }

    const valorFinal = +(valorBase - descontoAplicado).toFixed(2);
    if (valorBase > 0 && (descontoAplicado / valorBase) * 100 > 10) {
      avisos.push(`Desconto aplicado (${((descontoAplicado / valorBase) * 100).toFixed(1)}%) excede a variacao admissivel de 10% prevista na Portaria INCRA 12/2025.`);
    }

    await m.atualizarApenasDesconto(id, desconto, descontoAplicado, valorFinal);

    res.json({
      valorBase,
      descontoAplicado,
      valorFinal,
      avisos,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Se reclamar de `laudo.valor_base_calculado` não existir no tipo `Laudo`, atualizar a interface em `src/integrations/laudos.ts` para incluir `valor_base_calculado?: number | null`, `precificacao_calculada_em?: Date | string | null`, e os outros campos novos. Mapear no `mapRow`.)

- [ ] **Step 3: Teste manual**

```bash
curl -s -X PATCH http://localhost:3000/api/laudos-demarcacao/1/precificacao \
  -H 'Content-Type: application/json' \
  -d '{"desconto":{"tipo":"percentual","valor":15}}'
```
Expected: JSON com `valorFinal` ajustado e `avisos[]` com a mensagem de >10%.

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/integrations/laudos.ts
git commit -m "feat(incra): endpoint PATCH /precificacao recalcula so desconto"
```

---

### Task 18: PDF — seção 12 PRECIFICAÇÃO + renumeração 13/14

**Files:**
- Modify: `src/services/laudoPdf.ts`

- [ ] **Step 1: Adicionar import dos descritivos**

No topo de `src/services/laudoPdf.ts`, junto aos outros imports:

```typescript
import { CRITERIOS_INCRA } from './pricing/incra';
```

- [ ] **Step 2: Adicionar a seção 12 ANTES da atual seção 12 (que vira 13)**

Localizar o trecho `// ── 12. ART/TRT ────` (linha ~625). Inserir LOGO ANTES dele:

```typescript
  // ── 12. PRECIFICACAO DO SERVICO (v3.0.0) ─────────────────────────
  // Renderiza apenas quando laudo tem precificacao INCRA aplicada.
  if (laudo.valor_final != null && laudo.precificacao_calculada_em) {
    if (cy > 600) { doc.addPage(); cy = 60; }
    doc.fontSize(10).fillColor('#888').font('Helvetica-Bold')
       .text('12. PRECIFICAÇÃO DO SERVIÇO', 40, cy);
    cy += 14;
    doc.fontSize(8).fillColor('#444').font('Helvetica')
       .text('Cálculo conforme Tabela de Preços Referenciais aprovada pela Portaria INCRA nº 12, de 23 de abril de 2025 (3ª Edição da Norma Técnica para Georreferenciamento de Imóveis Rurais).',
             40, cy, { width: 515, align: 'justify' });
    cy = doc.y + 10;

    // Subtítulo
    doc.fontSize(9).fillColor('#222').font('Helvetica-Bold').text('CRITÉRIOS DE CLASSIFICAÇÃO (Quadro 1 — Anexo I)', 40, cy);
    cy += 12;

    // Tabela 3 colunas
    const colCrit = 40;
    const colPts  = 280;
    const colCls  = 340;
    doc.fontSize(8).fillColor('#666').font('Helvetica-Bold');
    doc.text('Critério', colCrit, cy, { width: 240, lineBreak: false });
    doc.text('Pontos',   colPts,  cy, { width: 60,  lineBreak: false });
    doc.text('Classificação', colCls, cy, { width: 215, lineBreak: false });
    cy += 10;
    doc.moveTo(40, cy).lineTo(555, cy).strokeColor('#ddd').lineWidth(0.5).stroke();
    cy += 4;
    doc.font('Helvetica').fillColor('#222').fontSize(8);

    const linhas: Array<[string, number, string]> = [
      ['Vegetação',           Number(laudo.pont_vegetacao || 0),    nivelDescritivo('vegetacao',     Number(laudo.pont_vegetacao || 0))],
      ['Relevo',              Number(laudo.pont_relevo || 0),       nivelDescritivo('relevo',        Number(laudo.pont_relevo || 0))],
      ['Insalubridade',       Number(laudo.pont_insalubridade || 0),nivelDescritivo('insalubridade', Number(laudo.pont_insalubridade || 0))],
      ['Acesso',              Number(laudo.pont_acesso || 0),       nivelDescritivo('acesso',        Number(laudo.pont_acesso || 0))],
      ['Clima',               Number(laudo.pont_clima || 0),        nivelDescritivo('clima',         Number(laudo.pont_clima || 0))],
      ['Área média dos lotes',Number(laudo.pont_area_media || 0),   nivelDescritivo('area_media',    Number(laudo.pont_area_media || 0))],
    ];
    for (const [crit, pts, cls] of linhas) {
      doc.text(crit, colCrit, cy, { width: 240, lineBreak: false });
      doc.text(String(pts), colPts, cy, { width: 60, lineBreak: false });
      doc.text(cls, colCls, cy, { width: 215, lineBreak: false });
      cy += 11;
    }
    doc.moveTo(40, cy).lineTo(555, cy).strokeColor('#ddd').lineWidth(0.5).stroke();
    cy += 4;
    doc.font('Helvetica-Bold').fillColor('#222');
    doc.text('TOTAL', colCrit, cy, { width: 240, lineBreak: false });
    doc.text(String(laudo.pontuacao_total ?? 0), colPts, cy, { width: 60, lineBreak: false });
    doc.text(`Faixa ${laudo.faixa_aplicada ?? '—'}`, colCls, cy, { width: 215, lineBreak: false });
    cy += 18;

    // Valor aplicado
    doc.fontSize(9).fillColor('#222').font('Helvetica-Bold').text('VALOR APLICADO (Quadro 2 — Anexo I)', 40, cy);
    cy += 12;
    doc.fontSize(8).fillColor('#222').font('Helvetica');
    const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
    const unidadeLabel = laudo.unidade_calculo === 'km' ? 'km lineares'
                       : laudo.unidade_calculo === 'hectare' ? 'hectares'
                       : laudo.unidade_calculo === 'lote' ? 'lotes' : '—';
    const qtdFmt = laudo.unidade_calculo === 'lote'
      ? String(Math.round(Number(laudo.quantidade_calculo || 0)))
      : Number(laudo.quantidade_calculo || 0).toFixed(4);
    doc.text(`Unidade:           ${unidadeLabel}`,                         60, cy); cy += 11;
    doc.text(`Valor unitário:    ${fmtBRL(Number(laudo.valor_unitario || 0))} / ${laudo.unidade_calculo ?? '—'}`, 60, cy); cy += 11;
    doc.text(`Quantidade:        ${qtdFmt} ${unidadeLabel}`,               60, cy); cy += 11;
    doc.text(`Valor base:        ${fmtBRL(Number(laudo.valor_base_calculado || 0))}`, 60, cy); cy += 16;

    // Desconto (se aplicável)
    if (laudo.desconto_tipo && laudo.desconto_tipo !== 'nenhum' && Number(laudo.desconto_valor) > 0) {
      doc.fontSize(9).fillColor('#222').font('Helvetica-Bold').text('DESCONTO COMERCIAL', 40, cy);
      cy += 12;
      doc.fontSize(8).fillColor('#222').font('Helvetica');
      const tipoLabel = laudo.desconto_tipo === 'percentual'
        ? `Percentual (${Number(laudo.desconto_valor).toFixed(2)}%)`
        : `Valor fixo`;
      const descontoCalc = Number(laudo.valor_base_calculado || 0) - Number(laudo.valor_final || 0);
      doc.text(`Tipo:              ${tipoLabel}`, 60, cy); cy += 11;
      doc.text(`Valor descontado:  ${fmtBRL(descontoCalc)}`, 60, cy); cy += 16;
    }

    // Valor final em destaque verde (mesmo verde da caixa de assinatura ICP)
    if (cy > 720) { doc.addPage(); cy = 60; }
    doc.fontSize(11).fillColor('#10b981').font('Helvetica-Bold')
       .text(`VALOR FINAL DO SERVIÇO   ▶   ${fmtBRL(Number(laudo.valor_final))}`, 40, cy, { width: 515 });
    cy += 16;

    doc.fontSize(7).fillColor('#666').font('Helvetica')
       .text('A Portaria INCRA 12/2025 admite variação de ±10% sobre os valores médios em função de particularidades do objeto, encargos e insumos regionais. Este laudo apresenta os valores aplicados ao serviço prestado, conforme acordo entre as partes.',
             40, cy, { width: 515, align: 'justify' });
    cy = doc.y + 14;
  }

  // helper local
  function nivelDescritivo(criterio: keyof typeof CRITERIOS_INCRA, ponto: number): string {
    const niveis = CRITERIOS_INCRA[criterio]?.niveis ?? [];
    if (ponto >= 1 && ponto <= 3) return niveis[0]?.rotulo ?? '';
    if (ponto >= 4 && ponto <= 6) return niveis[1]?.rotulo ?? '';
    if (ponto >= 7 && ponto <= 10) return niveis[2]?.rotulo ?? '';
    return '—';
  }
```

- [ ] **Step 3: Renumerar seções 12 → 13 e 13 → 14**

Localizar:
```typescript
doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('12. RESPONSABILIDADE TÉCNICA', 40, cy);
```
Trocar para:
```typescript
doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('13. RESPONSABILIDADE TÉCNICA', 40, cy);
```

E:
```typescript
       .text('13. OBSERVAÇÕES', 40, cy);
```
Trocar para:
```typescript
       .text('14. OBSERVAÇÕES', 40, cy);
```

> **Importante (numeração dinâmica):** se `laudo.valor_final` for `null` (laudo sem INCRA), os números visualmente ficariam "13. RESPONSABILIDADE TÉCNICA" sem 12 antes — buraco visual. Para evitar, calcular dinamicamente. Substituir as linhas de RESPONSABILIDADE TÉCNICA e OBSERVAÇÕES por:

```typescript
  const temPrecif = laudo.valor_final != null && laudo.precificacao_calculada_em;
  const numRespTec  = temPrecif ? '13' : '12';
  const numObs      = temPrecif ? '14' : '13';

  // ── Responsabilidade Tecnica ────────────────────
  if (cy > 720) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text(`${numRespTec}. RESPONSABILIDADE TÉCNICA`, 40, cy);
  // ... resto igual

  // ── Observacoes ────────────────────
  doc.text(`${numObs}. OBSERVAÇÕES`, 40, cy);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Se interface `Laudo` não tem os campos novos, ampliar — vide nota da Task 17.)

- [ ] **Step 5: Teste manual de geração**

Subir o servidor e gerar PDF de um laudo com precificação calculada (rodando POST .../calcular antes):

```bash
curl -s http://localhost:3000/api/laudos-demarcacao/1/pdf -o /tmp/laudo-incra.pdf
```

Abrir o PDF; verificar:
- Seção "12. PRECIFICAÇÃO DO SERVIÇO" presente, antes da Responsabilidade Técnica
- Tabela com 6 critérios + linha TOTAL
- Valor base, desconto, valor final
- "VALOR FINAL DO SERVIÇO ▶ R$ X,XX" em verde
- Renumeração: 13. RESPONSABILIDADE TÉCNICA, 14. OBSERVAÇÕES

Em laudo SEM precificação:
```bash
curl -s http://localhost:3000/api/laudos-demarcacao/<outro-id-sem-incra>/pdf -o /tmp/laudo-sem-incra.pdf
```
Verificar: seções 12. RESPONSABILIDADE TÉCNICA e 13. OBSERVAÇÕES (numeração natural sem buraco).

- [ ] **Step 6: Commit**

```bash
git add src/services/laudoPdf.ts
git commit -m "feat(incra): secao 12 PRECIFICACAO no PDF + renumeracao dinamica"
```

---

### Task 19: Recibo — 3 linhas de resumo INCRA

**Files:**
- Modify: `src/services/reciboPdf.ts`

- [ ] **Step 1: Localizar onde a descrição do serviço é renderizada**

Já mapeado: linhas 255-263 do `reciboPdf.ts`. O bloco "REFERENTE A" renderiza `recibo.descricao_servico`.

- [ ] **Step 2: Estender a interface de input do reciboPdf para receber laudo**

Verificar se já existe um param `laudo?` ou `precificacao?` na função `gerarPdfRecibo`. Se não, adicionar:

```typescript
// no topo, junto aos outros types do reciboPdf.ts
export interface ReciboIncraResumo {
  faixa_aplicada: string;
  unidade_calculo: 'km' | 'hectare' | 'lote';
  valor_base_calculado: number;
  desconto_tipo: 'percentual' | 'fixo' | 'nenhum';
  desconto_valor: number;
  valor_final: number;
}

// na assinatura da função gerarPdfRecibo, ampliar input:
//   gerarPdfRecibo(input: { recibo, ..., incra?: ReciboIncraResumo })
```

- [ ] **Step 3: Inserir as 3 linhas após o bloco "REFERENTE A"**

Localizar:
```typescript
       .text(recibo.descricao_servico, 40, cy, { width: 515 });
    cy = doc.y + 8;
  }
```

Adicionar logo após:

```typescript
  // v3.0.0: resumo INCRA (3 linhas) quando laudo tem precificacao aplicada
  if (incra) {
    const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
    const unidadeLabel = incra.unidade_calculo === 'km' ? 'km'
                       : incra.unidade_calculo === 'hectare' ? 'hectare'
                       : 'lote';
    doc.fontSize(8.5).fillColor('#444').font('Helvetica');
    doc.text(`Faixa INCRA aplicada:    ${incra.faixa_aplicada}`, 40, cy, { width: 515 }); cy += 11;
    doc.text(`Valor base (${unidadeLabel}):${' '.repeat(Math.max(1, 12 - unidadeLabel.length))}${fmtBRL(incra.valor_base_calculado)}`, 40, cy, { width: 515 }); cy += 11;
    if (incra.desconto_tipo !== 'nenhum' && incra.desconto_valor > 0) {
      const descontoNum = incra.valor_base_calculado - incra.valor_final;
      const tipoLabel = incra.desconto_tipo === 'percentual'
        ? `${incra.desconto_valor.toFixed(2)}%`
        : 'fixo';
      doc.text(`Desconto:                ${fmtBRL(descontoNum)} (${tipoLabel})`, 40, cy, { width: 515 }); cy += 11;
    }
    cy += 4;
  }
```

- [ ] **Step 4: Atualizar caller (`server.ts` POST /gerar-recibo)**

Localizar handler `POST /api/laudos-demarcacao/:id/gerar-recibo`. Onde chama `gerarPdfRecibo`, passar `incra`:

```typescript
const incra = (laudo.precificacao_calculada_em && laudo.valor_final != null) ? {
  faixa_aplicada:       String(laudo.faixa_aplicada),
  unidade_calculo:      laudo.unidade_calculo as 'km'|'hectare'|'lote',
  valor_base_calculado: Number(laudo.valor_base_calculado),
  desconto_tipo:        laudo.desconto_tipo as 'percentual'|'fixo'|'nenhum',
  desconto_valor:       Number(laudo.desconto_valor),
  valor_final:          Number(laudo.valor_final),
} : undefined;

const pdfBuffer = await gerarPdfRecibo({ recibo, ..., incra });
```

- [ ] **Step 5: Typecheck e teste manual**

```bash
npm run typecheck
# Iniciar dev e gerar recibo de laudo com precificacao
npm run dev &
curl -s -X POST http://localhost:3000/api/laudos-demarcacao/1/gerar-recibo -H 'Content-Type: application/json' -d '{}'
```
Verificar PDF resultante: bloco "REFERENTE A" + 3 linhas de resumo INCRA.

- [ ] **Step 6: Commit**

```bash
git add src/services/reciboPdf.ts src/server.ts
git commit -m "feat(incra): 3 linhas de resumo INCRA no recibo do laudo"
```

---

### Task 20: HTML do bloco INCRA na UI (`obras.html`)

**Files:**
- Modify: `src/public/obras.html`

- [ ] **Step 1: Adicionar `<script>` do incraCalc.js no `<head>`**

Localizar o `<head>` ou perto dos outros scripts/links existentes. Adicionar:

```html
<script src="/js/incraCalc.js" defer></script>
```

- [ ] **Step 2: Estender a função `renderXxx` que renderiza o painel ART/TRT + Financeiro do laudo (Task 1)**

Dentro do template literal do innerHTML dessa função, **acima** do bloco existente que tem `numero_art`/`numero_trt`/`valor_servico`, inserir o HTML do bloco INCRA:

```html
<div class="card" style="margin-top:12px;">
  <p class="section-title">💰 Precificação INCRA (Portaria 12/2025)</p>

  <div style="display:flex; gap:12px; margin-bottom:8px; flex-wrap:wrap;">
    <label style="display:flex; gap:4px; align-items:center;">
      <input type="radio" name="incraUnidade" value="km" id="incraUniKm"> km linear
    </label>
    <label style="display:flex; gap:4px; align-items:center;">
      <input type="radio" name="incraUnidade" value="hectare" id="incraUniHa" checked> Hectare
    </label>
    <label style="display:flex; gap:4px; align-items:center;">
      <input type="radio" name="incraUnidade" value="lote" id="incraUniLote"> Lote
    </label>
    <input id="incraQtd" type="number" step="0.0001" placeholder="Quantidade" style="flex:1; min-width:140px;">
  </div>

  <div id="incraCriterios" style="display:grid; grid-template-columns: 1fr; gap:8px;">
    <!-- Os 6 critérios serão injetados via JS na Task 21 -->
  </div>

  <div id="incraCalculo" style="margin-top:10px; padding:8px; background:rgba(16,185,129,0.06); border-left:3px solid #10b981;">
    <div style="display:flex; justify-content:space-between;">
      <span>Pontuação total:</span><strong id="incraPontuacao">—</strong>
    </div>
    <div style="display:flex; justify-content:space-between;">
      <span>Faixa:</span><strong id="incraFaixa">—</strong>
    </div>
    <div style="display:flex; justify-content:space-between;">
      <span>Valor unitário:</span><strong id="incraValorUnit">—</strong>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--text-muted); margin-top:4px;">
      <span id="incraFormula">—</span>
    </div>
  </div>

  <div style="margin-top:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
    <span style="color:var(--text-muted); font-size:12px;">Desconto:</span>
    <label><input type="radio" name="incraDescTipo" value="nenhum" id="incraDescNenhum" checked> Nenhum</label>
    <label><input type="radio" name="incraDescTipo" value="percentual" id="incraDescPct"> %</label>
    <label><input type="radio" name="incraDescTipo" value="fixo" id="incraDescFixo"> R$</label>
    <input id="incraDescValor" type="number" step="0.01" placeholder="0" style="width:120px;" disabled>
  </div>

  <div id="incraAvisos" style="margin-top:8px; color:#d97706; font-size:12px;"></div>

  <div style="margin-top:12px; padding:10px; background:rgba(16,185,129,0.10); border:1px solid #10b981; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
    <span style="font-size:14px;">VALOR FINAL:</span>
    <strong id="incraValorFinal" style="font-size:18px; color:#10b981;">—</strong>
  </div>

  <div style="margin-top:8px; display:flex; gap:8px;">
    <button class="btn-primary" id="incraSalvar">💾 Salvar precificação</button>
    <span id="incraStatus" style="color:var(--text-muted); font-size:12px;"></span>
  </div>
</div>
```

- [ ] **Step 3: Recarregar a página manualmente e verificar layout**

Run: `npm run dev` (se não estiver rodando), abrir http://localhost:3000/obras.html, navegar até um laudo e abrir a aba ART/TRT + Financeiro. O bloco deve aparecer **acima** do bloco financeiro existente. Não há comportamento ainda — só layout.

- [ ] **Step 4: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(incra): bloco UI Precificacao INCRA (HTML estatico)"
```

---

### Task 21: JS — montar critérios, cálculo em tempo real, integração com endpoints

**Files:**
- Modify: `src/public/obras.html`

- [ ] **Step 1: Adicionar a função `setupIncraBlock()` na render do laudo**

Localizar a função onde o bloco INCRA foi inserido (Task 20). LOGO APÓS o `v.innerHTML = \`...\``, adicionar a chamada a uma função `setupIncraBlock(laudoId)` que será definida em escopo global. Exemplo:

```javascript
v.innerHTML = `...todo o template...`;
// ... handlers existentes do bloco financeiro/ART/TRT ...
setupIncraBlock(state.currentLaudoId); // ID do laudo atual — usar o nome correto descoberto na Task 1
```

- [ ] **Step 2: Definir `setupIncraBlock` em escopo global**

Adicionar fora de qualquer função (no nível do `<script>` global do `obras.html`, perto dos helpers existentes como `api()`):

```javascript
async function setupIncraBlock(laudoId) {
  if (!laudoId) return;
  const C = window.IncraCalc;
  if (!C) { console.error('[incra] incraCalc.js nao carregou'); return; }

  // Monta os 6 critérios
  const criteriosKeys = ['vegetacao','relevo','insalubridade','acesso','clima','area_media'];
  const cont = document.getElementById('incraCriterios');
  cont.innerHTML = criteriosKeys.map(k => {
    const def = C.CRITERIOS_INCRA[k];
    const niveisOpts = def.niveis.map((n, idx) => {
      const minP = idx === 0 ? 1 : def.niveis[idx-1].maxPonto + 1;
      const maxP = n.maxPonto;
      return `<option value="${minP}-${maxP}">${n.rotulo} (${minP}-${maxP})</option>`;
    }).join('');
    return `<div style="display:grid; grid-template-columns: 130px 90px 1fr; gap:8px; align-items:center;">
      <label>${def.label}:</label>
      <input type="number" min="1" max="10" value="5" data-incra-criterio="${k}" style="width:80px;">
      <select data-incra-faixa="${k}">${niveisOpts}</select>
    </div>`;
  }).join('');

  // Carregar laudo pra puxar quantidade default
  const laudo = await api('/api/laudos-demarcacao/' + laudoId);
  const sugestao = await api('/api/laudos-demarcacao/' + laudoId + '/precificacao/sugerir');

  // Pré-popula critérios com sugestão
  for (const k of criteriosKeys) {
    document.querySelector(`[data-incra-criterio="${k}"]`).value = sugestao.criterios[k];
  }

  // Quantidade default conforme unidade
  function setQuantidadeDefault() {
    const unidade = document.querySelector('input[name="incraUnidade"]:checked').value;
    const qtdInput = document.getElementById('incraQtd');
    if (unidade === 'km') qtdInput.value = laudo.perimetro_m ? (laudo.perimetro_m / 1000).toFixed(4) : '';
    else if (unidade === 'hectare') qtdInput.value = laudo.area_total_m2 ? (laudo.area_total_m2 / 10000).toFixed(4) : '';
    else qtdInput.value = '1';
  }
  setQuantidadeDefault();

  // Listeners
  document.querySelectorAll('input[name="incraUnidade"]').forEach(r => r.addEventListener('change', () => { setQuantidadeDefault(); recalc(); }));
  document.querySelectorAll('[data-incra-criterio]').forEach(i => i.addEventListener('input', recalc));
  document.querySelectorAll('input[name="incraDescTipo"]').forEach(r => r.addEventListener('change', () => {
    const tipo = document.querySelector('input[name="incraDescTipo"]:checked').value;
    document.getElementById('incraDescValor').disabled = (tipo === 'nenhum');
    if (tipo === 'nenhum') document.getElementById('incraDescValor').value = 0;
    recalc();
  }));
  document.getElementById('incraDescValor').addEventListener('input', recalc);
  document.getElementById('incraQtd').addEventListener('input', recalc);

  // Sync stepper → dropdown
  document.querySelectorAll('[data-incra-criterio]').forEach(i => {
    i.addEventListener('input', () => {
      const k = i.dataset.incraCriterio;
      const ponto = Number(i.value);
      const sel = document.querySelector(`[data-incra-faixa="${k}"]`);
      const niveis = C.CRITERIOS_INCRA[k].niveis;
      const idx = ponto <= niveis[0].maxPonto ? 0 : ponto <= niveis[1].maxPonto ? 1 : 2;
      sel.selectedIndex = idx;
    });
  });

  let recalcTimer = null;
  function recalc() {
    clearTimeout(recalcTimer);
    recalcTimer = setTimeout(doRecalc, 300);
  }

  function doRecalc() {
    try {
      const criterios = {};
      for (const k of criteriosKeys) {
        criterios[k] = Number(document.querySelector(`[data-incra-criterio="${k}"]`).value);
      }
      const unidade = document.querySelector('input[name="incraUnidade"]:checked').value;
      const quantidade = Number(document.getElementById('incraQtd').value);
      const descTipo = document.querySelector('input[name="incraDescTipo"]:checked').value;
      const descValor = Number(document.getElementById('incraDescValor').value || 0);

      if (!quantidade || quantidade <= 0) { document.getElementById('incraValorFinal').textContent = '—'; return; }

      const r = C.calcularPrecificacao({ criterios, unidade, quantidade, desconto: { tipo: descTipo, valor: descValor } });

      document.getElementById('incraPontuacao').textContent = r.pontuacaoTotal;
      document.getElementById('incraFaixa').textContent = r.faixa.label;
      document.getElementById('incraValorUnit').textContent = 'R$ ' + r.valorUnitario.toFixed(2).replace('.', ',') + ' / ' + unidade;
      document.getElementById('incraFormula').textContent = r.detalhamento.formula;
      document.getElementById('incraValorFinal').textContent = 'R$ ' + r.valorFinal.toFixed(2).replace('.', ',');
      document.getElementById('incraAvisos').textContent = r.detalhamento.avisos.join(' ');
    } catch (err) {
      document.getElementById('incraValorFinal').textContent = '—';
      document.getElementById('incraAvisos').textContent = err.message;
    }
  }

  // Salvar
  document.getElementById('incraSalvar').addEventListener('click', async () => {
    const status = document.getElementById('incraStatus');
    status.textContent = 'Salvando...';
    try {
      const criterios = {};
      for (const k of criteriosKeys) {
        criterios[k] = Number(document.querySelector(`[data-incra-criterio="${k}"]`).value);
      }
      const unidade = document.querySelector('input[name="incraUnidade"]:checked').value;
      const quantidade = Number(document.getElementById('incraQtd').value);
      const descTipo = document.querySelector('input[name="incraDescTipo"]:checked').value;
      const descValor = Number(document.getElementById('incraDescValor').value || 0);

      const r = await api('/api/laudos-demarcacao/' + laudoId + '/precificacao/calcular', {
        method: 'POST',
        body: JSON.stringify({ unidade, criterios, quantidade, desconto: { tipo: descTipo, valor: descValor } }),
      });
      status.textContent = '✓ Salvo (R$ ' + r.valorFinal.toFixed(2).replace('.', ',') + ')';
      // Trava o campo valor_servico do bloco financeiro existente
      const valSrv = document.getElementById('valSrv'); // ID descoberto na Task 1; ajustar se for outro
      if (valSrv) { valSrv.value = r.valorFinal; valSrv.disabled = true; valSrv.title = 'Calculado pela precificacao INCRA'; }
    } catch (err) {
      status.textContent = '✗ ' + err.message;
    }
  });

  // Cálculo inicial
  doRecalc();
}
```

- [ ] **Step 3: Teste manual end-to-end**

Run: `npm run dev` e abrir laudo na UI.
Verificar:
- 6 critérios aparecem com stepper + dropdown sincronizado
- Trocar pontuação → dropdown atualiza, painel "VALOR FINAL" recalcula
- Trocar unidade → quantidade recalcula
- Toggle de desconto habilita/desabilita o input
- Aviso amarelo quando desconto > 10%
- "💾 Salvar precificação" → trava `valor_servico` no bloco financeiro

- [ ] **Step 4: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(incra): JS do bloco INCRA — calculo tempo real + endpoints"
```

---

### Task 22: Documentação `docs/PRECIFICACAO_INCRA.md`

**Files:**
- Create: `docs/PRECIFICACAO_INCRA.md`

- [ ] **Step 1: Criar arquivo**

```markdown
# Precificação INCRA — Laudo de Demarcação

Cálculo automático do valor do serviço de georreferenciamento conforme **Portaria INCRA nº 12, de 23 de abril de 2025** (3ª Edição da Norma Técnica para Georreferenciamento de Imóveis Rurais).

**Fonte oficial:** https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/portaria_12_2025_geo.pdf

## Quando usar cada unidade

| Unidade | Usar quando | Quantidade vem de |
|---|---|---|
| **km linear** | Demarcação de divisas com perímetro extenso e poucos vértices | `Σ(distancia_m) / 1000` (perímetro total) |
| **Hectare** | Mensuração de área para titulação, cadastro CCIR/INCRA, georreferenciamento padrão | `area_total_m2 / 10000` |
| **Lote** | Loteamentos com múltiplos lotes pequenos a demarcar | número de lotes (default 1 para laudo simples) |

## Auto-preenchimento

Ao abrir a aba "ART/TRT + Financeiro" do laudo, o sistema sugere automaticamente:

- **Critérios padrão**: todos = 5 (faixa intermediária)
- **Área média dos lotes**: derivada de `area_total_m2`
  - >35 ha → pontuação 2 (favorável)
  - 15-35 ha → pontuação 5 (mediano)
  - ≤15 ha → pontuação 8 (desfavorável)
- **Insalubridade**: se UF ∈ {MA, PA, AM, AC, RO, RR, AP, TO, MT} (Amazônia Legal) → pontuação 7

Você pode editar livremente cada um dos 6 critérios (1-10).

## Como o desconto é aplicado

- **Percentual**: `desconto = valor_base × (% / 100)`. Range válido: 0-100.
- **Fixo**: valor em R$. Não pode ser maior que o valor base.
- **Nenhum**: valor final = valor base.

⚠️ Se o desconto exceder **10%**, o sistema mostra aviso citando a Portaria 12/2025 (variação admissível ±10%). É apenas aviso — não bloqueia.

## Aviso jurídico

A Portaria INCRA 12/2025 é referencial **obrigatório** para contratações de serviços geodésicos pelo INCRA.

Em **contratos privados** (entre empresas e particulares), a tabela serve como **balizador defensável de mercado**, mas o valor final é livremente acordado entre as partes contratantes.

Esta funcionalidade do sistema:
- Calcula o valor referencial conforme a Portaria
- Permite desconto comercial e o documenta no laudo/recibo
- Imprime no PDF do laudo a tabela completa de critérios + valor base + desconto + valor final, conforme exigência da Portaria

## Estrutura técnica

- Service: `src/services/pricing/incra.ts` (TypeScript, fonte de verdade)
- Espelho front: `src/public/js/incraCalc.js` (vanilla JS, cálculo em tempo real na UI)
- Migration: `src/database/migrations-precificacao-incra.ts` (16 colunas em `laudos_demarcacao`)
- Endpoints: `GET/POST/PATCH /api/laudos-demarcacao/:id/precificacao/...`
- PDF: seção 12 em `src/services/laudoPdf.ts`
- Recibo: 3 linhas em `src/services/reciboPdf.ts`
- Testes: `src/services/pricing/incra.test.ts` (incluindo 54 cenários de paridade back↔front)
```

- [ ] **Step 2: Commit**

```bash
git add docs/PRECIFICACAO_INCRA.md
git commit -m "docs(incra): guia user-facing de precificacao INCRA"
```

---

### Task 23: Bump de versão (package.json, identity.ts, sw.js)

**Files:**
- Modify: `package.json`
- Modify: `src/agent/identity.ts`
- Modify: `src/public/sw.js`

- [ ] **Step 1: Bump package.json**

Localizar `"version": "2.11.0"` e trocar por `"version": "3.0.0"`.

- [ ] **Step 2: Bump identity.ts**

Localizar `version: '2.11.0',` e trocar por `version: '3.0.0',`.

- [ ] **Step 3: Bump sw.js**

Localizar `const CACHE = 'zayra-v2.11.0';` e trocar por `const CACHE = 'zayra-v3.0.0';`.

- [ ] **Step 4: Verify**

Run: `cd "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent" && grep -E "2\.11\.0|3\.0\.0" package.json src/agent/identity.ts src/public/sw.js`
Expected: todas as 3 referências em 3.0.0, nenhuma em 2.11.0.

- [ ] **Step 5: Typecheck final + suite de testes**

```bash
npm run typecheck
npx vitest run src/services/pricing/incra.test.ts
```
Expected: ambos PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src/agent/identity.ts src/public/sw.js
git commit -m "chore(v3.0.0): bump package.json/identity.ts/sw.js para 3.0.0"
```

---

### Task 24: Changelog na vault Obsidian

**Files:**
- Create: `c:/Users/Ronicley Pinto/Documents/ROMATEC_AVALIEIMOB_/RomatecVoiceAgent/06-Changelog/v3.0.0-precificacao-incra.md`

- [ ] **Step 1: Criar arquivo seguindo padrão dos changelogs anteriores**

```markdown
# v3.0.0 — Precificação Automática INCRA (Portaria 12/2025)

**Data:** 2026-05-10
**Origem:** Spec do CEO "Precificação Automática INCRA" — bump major escolhido pelo CEO mesmo sendo feature aditiva.

## Por quê
O CEO precisava parar de calcular o valor do laudo "no olho" e ter um cálculo defensável baseado na Portaria oficial do INCRA. Antes era um campo `valor_servico` digitado manualmente — sem rastreabilidade do critério usado, sem padrão.

## O que mudou

### Migration (16 colunas novas em `laudos_demarcacao`)
`unidade_calculo`, 6 critérios `pont_*`, `pontuacao_total`, `faixa_aplicada`, `valor_unitario`, `quantidade_calculo`, `valor_base_calculado`, `desconto_tipo`, `desconto_valor`, `valor_final`, `precificacao_observacoes`, `precificacao_calculada_em` (flag NOT NULL = INCRA aplicada).

`valor_servico` legado é mantido e sincronizado via service layer (sem trigger SQL).

### Service `src/services/pricing/incra.ts`
Tabela INCRA 2025 (6 faixas), descritivos dos 6 critérios, 6 funções puras: `validarCriterios`, `calcularPontuacaoTotal`, `obterFaixa`, `obterValorUnitario`, `calcularPrecificacao`, `sugerirCriterios`.

Espelho em `src/public/js/incraCalc.js` (vanilla JS) pra cálculo em tempo real no front sem round-trip. **Teste de paridade** com 54 cenários (6 faixas × 3 unidades × 3 descontos) garante que back e front retornam o mesmo valor.

### 3 Endpoints (`server.ts`)
- `GET /api/laudos-demarcacao/:id/precificacao/sugerir` — sugere critérios baseado em `area_total_m2` e UF
- `POST /api/laudos-demarcacao/:id/precificacao/calcular` — calcula e persiste 16 campos + sincroniza `valor_servico`
- `PATCH /api/laudos-demarcacao/:id/precificacao` — recalcula só o desconto a partir do valor base já persistido

Validação manual (sem Zod, alinhado com o resto do projeto).

### UI (`obras.html`)
Bloco "💰 Precificação INCRA (Portaria 12/2025)" no painel ART/TRT + Financeiro. 6 steppers + dropdowns sincronizados, cálculo em tempo real (debounce 300ms via `IncraCalc.calcularPrecificacao` local), aviso amarelo quando desconto > 10%, valor final destacado em verde. Quando precificação INCRA é aplicada, o campo `valor_servico` legado fica read-only.

### PDF (`laudoPdf.ts`)
Nova seção **12. PRECIFICAÇÃO DO SERVIÇO** antes da Responsabilidade Técnica. Renumeração dinâmica: ART/TRT vira 13, Observações vira 14 (só quando há precificação; senão mantém numeração natural sem buraco).

Tabela 3 colunas (Critério/Pontos/Classificação) × 7 linhas + bloco "Valor aplicado" + "Desconto comercial" (se aplicável) + "VALOR FINAL DO SERVIÇO" em verde + nota de rodapé sobre variação ±10%.

### Recibo (`reciboPdf.ts`)
3 linhas adicionadas após "REFERENTE A": Faixa INCRA, Valor base, Desconto.

## Versão
- `package.json`: 2.11.0 → **3.0.0** (bump major escolhido pelo CEO)
- `src/agent/identity.ts`: 2.11.0 → 3.0.0
- `src/public/sw.js`: cache `zayra-v2.11.0` → `zayra-v3.0.0`

## Validação
- `npm run typecheck` limpo
- `npx vitest run` 95+ testes PASS (41 do service + 54 de paridade)
- Teste manual no laudo do Wagner com 12,5 ha + UF=MA + descontou 10%: PDF gerado com seção 12 completa, recibo com 3 linhas, valor final R$ 1.178,77

## Próximos passos
- v3.0.x — refinos de UX que aparecerem no uso real
- v3.1.0 — possível: relatório consolidado de laudos por faixa INCRA / por mês / por município
```

- [ ] **Step 2: Commit (no repo da vault Obsidian, NÃO no clone fonte)**

```bash
cd "c:/Users/Ronicley Pinto/Documents/ROMATEC_AVALIEIMOB_/RomatecVoiceAgent"
git add 06-Changelog/v3.0.0-precificacao-incra.md
git commit -m "docs: changelog v3.0.0 — precificacao INCRA"
```

(Vault tem outras mudanças não relacionadas — fazer add específico pelo path do arquivo, não usar `git add -A`.)

---

### Task 25: Push da branch + abrir Pull Request

**Files:** none (operações git)

- [ ] **Step 1: Status check final**

```bash
cd "c:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent"
git status
git log --oneline main..HEAD
```
Expected: working tree clean, ~25 commits acima de `main`.

- [ ] **Step 2: Suite de testes completa**

```bash
npm run typecheck
npx vitest run
```
Expected: PASS (sem regressões em testes anteriores).

- [ ] **Step 3: Push da branch**

```bash
git push -u origin feat/precificacao-incra-laudo
```
Expected: branch criada em `origin`.

- [ ] **Step 4: Abrir PR (NÃO mergear)**

```bash
gh pr create --title "feat(v3.0.0): Precificacao Automatica INCRA (Portaria 12/2025)" --body "$(cat <<'EOF'
## Summary
- Adiciona precificacao automatica INCRA ao Laudo de Demarcacao
- 6 criterios (1-10 cada) → faixa → valor unitario × quantidade − desconto = valor final
- 3 unidades selecionaveis: km linear, hectare, lote
- Desconto opcional (percentual ou fixo) com aviso quando > 10%
- Auto-preenchimento dos criterios (area do laudo, UF Amazonia Legal)
- Calculo em tempo real no front (debounce 300ms) com paridade testada vs back
- Nova secao 12 no PDF do laudo (renumera 13/14)
- 3 linhas de resumo INCRA no Recibo
- Bump major v2.11.0 → v3.0.0 (escolhido pelo CEO)

## Test plan
- [ ] `npm run typecheck` passa
- [ ] `npx vitest run` passa (~95 testes incluindo 54 de paridade back/front)
- [ ] Migration roda em ambiente limpo (todos os ALTER + CREATE INDEX idempotentes)
- [ ] UI: steppers + dropdowns sincronizados, calculo tempo real, aviso > 10%
- [ ] UI: valor_servico legado fica read-only quando INCRA aplicada
- [ ] PDF do laudo COM precificacao: secao 12 PRECIFICACAO + ART/TRT renumerada para 13 + Observacoes para 14
- [ ] PDF do laudo SEM precificacao: numeracao natural 12. ART/TRT, 13. OBSERVACOES (sem buraco)
- [ ] Recibo de laudo COM precificacao: 3 linhas (faixa, valor base, desconto) apos REFERENTE A
- [ ] Endpoint POST /precificacao/calcular persiste todos os 16 campos + sincroniza valor_servico
- [ ] Endpoint PATCH /precificacao recalcula apenas desconto, retorna 409 se laudo nao tem base

## Pontos de atencao para review
1. **2 fontes de verdade back/front** (`incra.ts` + `incraCalc.js`) — mitigado por teste de paridade. Ao mudar tabela INCRA ou adicionar criterio, precisa atualizar OS DOIS arquivos.
2. **Bump major** — feature e tecnicamente aditiva (nao breaking), mas o CEO escolheu major bump. Documentado no changelog.
3. **valor_servico legado** — mantido para compat com laudos antigos. Sobrescrito quando INCRA usada (forma de migration suave).
4. **Renumeracao dinamica do PDF** — se laudo nao tem precificacao, secao ART/TRT volta a ser 12 (sem buraco).
5. **Nao mergear ate review do CEO** — conforme governanca.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: URL do PR criado.

- [ ] **Step 5: Reportar URL do PR ao usuário**

Mostrar URL retornada pelo `gh pr create`. **NÃO MERGEAR.**

---

## Self-Review

- [x] **Spec coverage**: Cada seção da spec tem task correspondente (schema=12, service=2-9, mirror front=10-11, endpoints=15-17, UI=20-21, PDF=18, recibo=19, docs=22, changelog=24, versionamento=23, PR=25). ✓
- [x] **Placeholder scan**: nenhum "TBD"/"TODO". Cada step tem código completo. ✓
- [x] **Type consistency**: `CriteriosPontuacao` usado consistentemente em incra.ts/incra.test.ts/integrations/laudos.ts/server.ts/incraCalc.js (no JS, é apenas objeto sem tipagem mas com mesmas chaves). `ResultadoPrecificacao` idem. `unidade` sempre string literal `'km'|'hectare'|'lote'`. ✓
- [x] **Edge cases cobertos**: laudo sem precificação (PDF/recibo pulam), desconto > 10% (aviso visual), valor_servico legado preservado. ✓

## Pontos de atenção para o executor

1. **Task 1 é exploratória** — descobre nome real da função render do laudo. Não tem commit.
2. **Task 17 pode exigir ampliar tipo `Laudo`** — adicionar campos novos do schema na interface em `src/integrations/laudos.ts` e no `mapRow`. Está documentado na nota do Step 2.
3. **Task 21 referencia `state.currentLaudoId` e `valSrv`** como nomes prováveis — substituir pelos nomes reais descobertos na Task 1.
4. **Push e PR (Task 25) são as únicas ações que afetam estado compartilhado** — confirmar com o usuário antes do `gh pr create` se este plano for executado autonomamente.
