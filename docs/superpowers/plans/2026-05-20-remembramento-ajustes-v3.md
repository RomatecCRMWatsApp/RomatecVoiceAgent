# Remembramento + Desmembramento — Ajustes v3 — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os "pacotes 0,5/1,0 SM" do remembramento e desmembramento por 3 modos de precificação livres, desbloquear o botão Editar para esses subtipos, garantir que toggles (assessoria, despesas, peças) ditem o que sai no PDF, adicionar bloco opcional de "Despesas administrativas (parcelamento municipal)" e simplificar o formulário inline conforme o pedido do José Romário — **sem destruir o que ficou pronto na v3.22.0** (status_documentacao, assessoria_tecnica, livro/folha/CRI autocomplete).

**Architecture:** Estende `InputDesmembramento` com um novo discriminador `modo_precificacao: 'por_imovel' | 'por_lote' | 'personalizado'` e adiciona um bloco `despesas_administrativas` opcional. O `modo_calculo` legado (`'auto'/'manual'`) continua existindo mas o front passa a sempre enviar o novo modo. O backend mapeia internamente. Form inline em `obras.html` ganha radio "Urbano/Rural" + 3 cards de modo de precificação no lugar dos pacotes SM. Botão Editar tem o `if` restritivo removido. PDF lê os toggles existentes (`assessoria_tecnica.habilitada`, `pecas_tecnicas.*`) e renderiza condicionalmente as seções.

**Tech Stack:** Node.js 22, TypeScript, Express, MySQL2 (pool), PDFKit + pdf-lib, vanilla JS frontend (sem framework), vitest.

---

## Branch + governança

**Antes de começar:**

```bash
git checkout main
git pull --ff-only
git checkout -b feature/remembramento-ajustes-v3
```

Cada Task fecha com 1 commit isolado. PR único ao final (`feature/remembramento-ajustes-v3` → `main`) com todos os commits. Justificativa: o pedido pede "7 PRs" mas as features são fortemente acopladas — botão Editar, modos de precificação e PDF tocam os mesmos arquivos. PRs separados gerariam conflitos. O changelog v3.23.0 cobre tudo.

---

## Divergências do prompt original (adaptações ao código real)

Ler ANTES de começar:

| Prompt original                                                   | Reality                                                                                                              | Decisão                                                                                                  |
| ---                                                              | ---                                                                                                                  | ---                                                                                                       |
| "Base de cálculo SERPRO / Receita Federal — remover"            | Não existe SERPRO no engine. `types.ts:51` tem comentário legado "Receita Federal" no campo `base_calculo`; o PDF mostra "Base de Cálculo" mas o conteúdo é fórmula da Romatec (SM × N). Não há lookup à RF. | **Atualizar comentário** em `types.ts:51` para refletir realidade. Nada a remover do cálculo.            |
| "Pacote 1 SM / 1,5 SM"                                          | Hoje são 0,5 SM e 1,0 SM (não 1,5). Enum no form.                                                                  | Substituir por 3 modos novos (ver abaixo). Manter compatibilidade com propostas antigas via campo legado. |
| "Tabela `propostas` precisa de `lotes_json`, `modo_precificacao`, `incluir_assessoria`…" | A tabela `propostas` já guarda tudo em `dados_imovel JSON`. v3.22.0 deliberadamente decidiu **zero migration**. | **Não criar colunas SQL.** Adicionar campos novos ao JSON `dados_imovel`. |
| "Valor venal — remover do topo (não há ITBI)"                  | `valor_venal_total` é usado para estimar emolumentos cartorários TJMA (proporcional ao valor venal por matrícula). Não é ITBI. | **Manter o campo**, mas re-rotular no form como "Valor venal para cálculo de emolumentos cartorários (TJMA)". Não é decisão de remoção. |
| "Botão EDITAR só funciona em averbação"                         | Confirmado: `obras.html:6006-6008` tem `if (subtipo !== 'averbacao_…') return alert(...)`.                          | **Remover o `if` restritivo** e garantir que a hidratação do form (já existe em `renderConsultoriaFormDesmRem`) cobre os campos v3.22.0. |
| "PDF gera tudo independente dos toggles"                         | Parcialmente verdadeiro: a engine produz seções condicionalmente (assessoria, status_documentacao), mas o **render do PDF** em `propostasConsultoria.ts` ainda renderiza checklist secao_4 sempre. | **Auditar `gerarPdfConsultoria`** e adicionar guards para cada toggle. |
| "Assessoria Jurídica reescrita com escopo completo"              | v3.22.0 trocou para **Assessoria Técnica**. O texto do escopo do usuário fala de "diligências na Superintendência de Habitação e cartório" — coerente com Assessoria Técnica.    | **Atualizar o texto da Assessoria Técnica** no PDF (não criar uma seção paralela "Assessoria Jurídica"). |
| "Proposta de Desmembramento separada"                            | Hoje desmembramento e remembramento compartilham `renderConsultoriaFormDesmRem` em obras.html com flags `isDesm`. Não há HTML standalone para desmembramento. | **Manter o form unificado** com toggle interno; criar HTML standalone só se a UX standalone (`/proposta-remembramento.html`) também precisar de versão desmembramento — fora de escopo deste plano. |

**Nada se perde do spec original:** todos os requisitos funcionais entram. Apenas o "onde" muda para evitar duplicação e não desfazer v3.22.0.

---

## File Structure

**Modificar:**

- `src/services/pricing/types.ts` — atualiza comentário "Receita Federal", adiciona `modo_precificacao`, `valor_por_imovel`, `valores_por_lote`, `honorarios_personalizados`, `despesas_administrativas` em `InputDesmembramento`. Mantém `honorario_projeto_sm` como legado opcional.
- `src/services/pricing/desmembramento.ts` — calcula `secao_3_honorarios` a partir de `modo_precificacao` quando presente; fallback para SM legado. Adiciona seção opcional "III — Despesas Administrativas" (separada dos honorários técnicos no total).
- `src/integrations/propostasConsultoria.ts` — guards de render no PDF (assessoria, despesas, peças, condições de pagamento). Reescreve texto da Assessoria Técnica com o escopo completo do prompt. Adiciona seção "Despesas Administrativas (estimativa)" entre Honorários e Peças.
- `src/public/obras.html` — remove `if` restritivo do Editar (linha 6006-6008). Substitui select "Pacote 0,5/1,0 SM" por 3 cards "Por imóvel / Por lote / Personalizado" + UI condicional. Substitui select "Tipo de zona" por radio "Urbano / Rural" com unidade dinâmica. Adiciona toggle "Despesas administrativas". Garante hidratação para edição.
- `src/public/js/proposta-remembramento.js` — mesmas mudanças do form inline (3 modos + despesas), só para o wizard standalone — opcional, ver Task 5.

**Criar:**

- `src/services/pricing/desmembramento-v3.test.ts` — novo arquivo de testes só para os modos de precificação (deixar o `desmembramento.test.ts` v3.22.0 intacto).
- `06-Changelog/v3.23.0-remembramento-ajustes-v3.md` — changelog.

**Sem mudanças SQL.** Tudo vai dentro de `propostas.dados_imovel` (JSON).

---

## Sequenciamento

Tasks 1, 2 e 3 são sequenciais (engine antes de PDF antes de UI). Task 4 (PDF) pode rodar em paralelo com Task 5 (form inline) **depois que Task 2 estiver verde**. Task 6 (Editar) depende de Task 5. Task 7 é validação final.

```
Task 1 (types + tests red)
   ↓
Task 2 (engine: 3 modos + despesas)
   ↓
   ├── Task 3 (PDF: guards + Assessoria Técnica reescrita + Despesas) 🟢
   └── Task 4 (Form inline: 3 modos + radio Urbano/Rural + toggle Despesas) 🟢
        ↓
        Task 5 (Botão Editar destravado + hidratação completa)
        ↓
        Task 6 (Validação manual com matriz de toggles + changelog)
```

---

### Task 1: Estender tipos com `modo_precificacao` e `despesas_administrativas`

**Files:**
- Modify: `src/services/pricing/types.ts:51` (atualiza comentário legado)
- Modify: `src/services/pricing/types.ts:103-199` (interface `InputDesmembramento`)
- Modify: `src/services/pricing/types.ts:46-57` (interface `CustosCalculados` — adicionar seção opcional de despesas)

- [ ] **Step 1: Escrever os testes (red)**

Criar `src/services/pricing/desmembramento-v3.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { calcularDesmembramento } from './desmembramento';
import type { InputDesmembramento } from './types';

const baseValid: InputDesmembramento = {
  tipo: 'remembramento',
  area_total_m2: 600,
  valor_venal_total: 200000,
  tipo_zona: 'urbana',
  iptu_em_dia: true,
  honorario_projeto_sm: 1.0, // legado — ignorado quando modo_precificacao vier
  numero_lotes_origem: 3,
};

describe('v3 — modo_precificacao=por_imovel', () => {
  it('soma valor_por_imovel × imoveis.length', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_imovel',
      valor_por_imovel: 1500,
      imoveis: [
        { ordem: 1, area_m2: 200, endereco: 'R', matricula: 'M1' },
        { ordem: 2, area_m2: 200, endereco: 'R', matricula: 'M2' },
        { ordem: 3, area_m2: 200, endereco: 'R', matricula: 'M3' },
      ],
    });
    const totalHonorarios = out.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    expect(totalHonorarios).toBe(4500); // 1500 × 3
    expect(out.custos.secao_3_honorarios[0].descricao).toMatch(/por im[oó]vel/i);
  });

  it('rejeita valor_por_imovel ausente ou <= 0', async () => {
    await expect(calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_imovel',
    })).rejects.toThrow(/valor_por_imovel/i);
  });
});

describe('v3 — modo_precificacao=por_lote', () => {
  it('soma valores_por_lote', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_lote',
      valores_por_lote: [
        { ordem: 1, valor: 800 },
        { ordem: 2, valor: 1200 },
        { ordem: 3, valor: 1500 },
      ],
    });
    const totalHonorarios = out.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    expect(totalHonorarios).toBe(3500);
    expect(out.custos.secao_3_honorarios).toHaveLength(3);
  });

  it('rejeita lista vazia', async () => {
    await expect(calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_lote',
      valores_por_lote: [],
    })).rejects.toThrow(/valores_por_lote/i);
  });
});

describe('v3 — modo_precificacao=personalizado', () => {
  it('usa valor fechado + descritivo', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'personalizado',
      honorarios_personalizados: {
        valor_total: 4500,
        descritivo: 'Pacote técnico fechado conforme acordo entre as partes',
      },
    });
    const totalHonorarios = out.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    expect(totalHonorarios).toBe(4500);
    expect(out.custos.secao_3_honorarios[0].observacao).toMatch(/acordo entre as partes/i);
  });

  it('rejeita valor_total <= 0', async () => {
    await expect(calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'personalizado',
      honorarios_personalizados: { valor_total: 0, descritivo: 'x' },
    })).rejects.toThrow(/valor_total/i);
  });
});

describe('v3 — despesas_administrativas', () => {
  it('aparece em seção separada (não soma ao honorário)', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_imovel',
      valor_por_imovel: 1000,
      imoveis: [
        { ordem: 1, area_m2: 200, endereco: 'R', matricula: 'M1' },
        { ordem: 2, area_m2: 200, endereco: 'R', matricula: 'M2' },
      ],
      despesas_administrativas: {
        habilitada: true,
        valor: 250,
        descritivo: 'Taxa parcelamento Açailândia',
      },
    });
    expect(out.custos.despesas_administrativas?.valor).toBe(250);
    const totalHonorarios = out.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    expect(totalHonorarios).toBe(2000); // 1000 × 2, NÃO inclui 250
  });

  it('quando habilitada=false, custos.despesas_administrativas vem undefined', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_imovel',
      valor_por_imovel: 1000,
      imoveis: [
        { ordem: 1, area_m2: 200, endereco: 'R', matricula: 'M1' },
        { ordem: 2, area_m2: 200, endereco: 'R', matricula: 'M2' },
      ],
      despesas_administrativas: { habilitada: false, valor: 250, descritivo: 'ignorar' },
    });
    expect(out.custos.despesas_administrativas).toBeUndefined();
  });
});

describe('v3 — retrocompat: sem modo_precificacao usa SM legado', () => {
  it('cai no comportamento v3.22.0 (auto)', async () => {
    const out = await calcularDesmembramento(baseValid);
    expect(out.custos.secao_3_honorarios.length).toBeGreaterThanOrEqual(2); // projeto + assessoria
    expect(out.custos.secao_3_honorarios[0].descricao).toMatch(/Honorarios de Projeto/i);
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar vermelho**

Run: `npx vitest run src/services/pricing/desmembramento-v3.test.ts`
Expected: FAIL — `modo_precificacao`, `valor_por_imovel`, `valores_por_lote`, `honorarios_personalizados`, `despesas_administrativas` não existem em tipo.

- [ ] **Step 3: Estender `CustosCalculados`**

Em `src/services/pricing/types.ts`, dentro da interface `CustosCalculados` (linha ~46), adicionar logo após `condicoes_pagamento?`:

```typescript
  // v3.23.0: despesas administrativas (estimativa) — exibidas em seção separada no PDF, NÃO somam ao secao_5_total.
  despesas_administrativas?: {
    valor: number;
    descritivo: string;
  };
```

E atualizar o comentário de `base_calculo` (linha ~51) substituindo "Base de Calculo explicita da Receita Federal" por:

```typescript
  // Base de Cálculo: memória de cálculo Romatec (fórmula explícita por item).
  // Não há consulta à Receita Federal; o termo "Base" refere-se à derivação interna dos honorários.
  base_calculo?: BaseCalculo[];
```

- [ ] **Step 4: Estender `InputDesmembramento`**

Em `src/services/pricing/types.ts`, na interface `InputDesmembramento`, adicionar logo após `assessoria_tecnica?:` (próximo da linha 159):

```typescript
  // v3.23.0: modo de precificação substitui o pacote SM legado.
  //   'por_imovel'    → valor_por_imovel × imoveis.length
  //   'por_lote'      → soma de valores_por_lote[]
  //   'personalizado' → valor fechado + descritivo
  // Quando ausente, cai no comportamento v3.22.0 (modo_calculo auto/manual + honorario_projeto_sm).
  modo_precificacao?: 'por_imovel' | 'por_lote' | 'personalizado';

  valor_por_imovel?: number;            // usado quando modo_precificacao='por_imovel'

  valores_por_lote?: Array<{            // usado quando modo_precificacao='por_lote'
    ordem: number;
    valor: number;
    descricao?: string;                 // ex: "Lote 03 — Quadra 7"
  }>;

  honorarios_personalizados?: {         // usado quando modo_precificacao='personalizado'
    valor_total: number;
    descritivo: string;
  };

  // v3.23.0: despesas administrativas (estimativa). Quando habilitada, vai em seção
  // separada no PDF — NÃO soma aos honorários técnicos. Por ora valor manual; tabela
  // automática (≈R$68 / 10% VRM por imóvel) virá em fase posterior.
  despesas_administrativas?: {
    habilitada: boolean;
    valor: number;
    descritivo: string;
  };
```

E atualizar o comentário do `honorario_projeto_sm` (linha 111) para deixar claro que é legado:

```typescript
  // Legado v3.22.0 — usado apenas quando modo_precificacao está ausente.
  honorario_projeto_sm: 0.5 | 1.0;
```

- [ ] **Step 5: Confirmar que compila**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 6: Commit**

```bash
git add src/services/pricing/types.ts src/services/pricing/desmembramento-v3.test.ts
git commit -m "feat(remembramento-v3): tipos modo_precificacao + despesas_administrativas + testes red"
```

---

### Task 2: Implementar engine de 3 modos de precificação + despesas

**Files:**
- Modify: `src/services/pricing/desmembramento.ts:247-340` (área de `secao_3_honorarios`)
- Modify: `src/services/pricing/desmembramento.ts:526-535` (montagem do `custos`)

- [ ] **Step 1: Validar `modo_precificacao` e popular `secao_3_honorarios`**

Em `src/services/pricing/desmembramento.ts`, **logo após** o bloco `if (isManual) { … } else { … }` (~linha 322) e **antes** do bloco `if (input.assessoria_tecnica?.habilitada)` (~linha 326), inserir:

```typescript
  // v3.23.0: modo_precificacao substitui o pacote SM quando presente.
  // Reescreve secao_3_honorarios do zero (ignora o que foi montado no isManual/auto acima).
  if (input.modo_precificacao) {
    secao_3_honorarios = [];
    let ordemHon = 1;

    if (input.modo_precificacao === 'por_imovel') {
      const valorUnit = Number(input.valor_por_imovel ?? 0);
      if (!Number.isFinite(valorUnit) || valorUnit <= 0) {
        throw new Error('valor_por_imovel deve ser > 0 quando modo_precificacao=por_imovel');
      }
      const qtd = input.imoveis?.length
        ?? input.numero_lotes_origem
        ?? input.numero_lotes_resultantes
        ?? 0;
      if (qtd < 2) {
        throw new Error('Modo por_imovel exige pelo menos 2 imóveis/lotes');
      }
      secao_3_honorarios.push({
        ordem: ordemHon++,
        descricao: `Honorários técnicos — ${qtd} imóvel(eis) × R$ ${valorUnit.toFixed(2)}`,
        valor: valorUnit * qtd,
        observacao: 'Precificação por imóvel (modo padrão v3.23.0)',
      });
    } else if (input.modo_precificacao === 'por_lote') {
      const lista = input.valores_por_lote ?? [];
      if (lista.length === 0) {
        throw new Error('valores_por_lote vazio quando modo_precificacao=por_lote');
      }
      for (const item of lista) {
        if (!Number.isFinite(item.valor) || item.valor <= 0) {
          throw new Error(`valores_por_lote[${item.ordem}]: valor deve ser > 0`);
        }
        secao_3_honorarios.push({
          ordem: ordemHon++,
          descricao: item.descricao
            ? `Lote ${String(item.ordem).padStart(2, '0')} — ${item.descricao}`
            : `Lote ${String(item.ordem).padStart(2, '0')}`,
          valor: item.valor,
        });
      }
    } else if (input.modo_precificacao === 'personalizado') {
      const hp = input.honorarios_personalizados;
      if (!hp || !Number.isFinite(hp.valor_total) || hp.valor_total <= 0) {
        throw new Error('honorarios_personalizados.valor_total deve ser > 0');
      }
      if (!hp.descritivo?.trim()) {
        throw new Error('honorarios_personalizados.descritivo é obrigatório');
      }
      secao_3_honorarios.push({
        ordem: ordemHon++,
        descricao: 'Honorários técnicos — pacote fechado',
        valor: hp.valor_total,
        observacao: hp.descritivo,
      });
    }
  }
```

- [ ] **Step 2: Adicionar `despesas_administrativas` ao `custos`**

Substituir o bloco final `const custos: CustosCalculados = { … }` (~linha 526) por:

```typescript
  // v3.23.0: despesas administrativas — seção separada, NÃO soma ao secao_5_total.
  const despesasAdm = (input.despesas_administrativas?.habilitada)
    ? (() => {
        const valor = Number(input.despesas_administrativas?.valor ?? 0);
        const descritivo = (input.despesas_administrativas?.descritivo ?? '').trim();
        if (!Number.isFinite(valor) || valor < 0) {
          throw new Error('despesas_administrativas.valor inválido');
        }
        if (!descritivo) {
          throw new Error('despesas_administrativas.descritivo obrigatório quando habilitada=true');
        }
        return { valor, descritivo };
      })()
    : undefined;

  const custos: CustosCalculados = {
    secao_1_projetos,
    secao_2_taxas,
    secao_3_honorarios,
    condicoes_pagamento,
    base_calculo,
    secao_4_checklist,
    secao_5_total,
    avisos,
    ...(despesasAdm ? { despesas_administrativas: despesasAdm } : {}),
  };
```

> **Atenção:** `secao_5_total` foi calculado mais cedo (~linha 371) com base em `secao_3_honorarios.reduce(...)` ANTES de reescrever a seção 3 com `modo_precificacao`. **Mover** o cálculo de `total_taxas`, `total_honorarios` e `secao_5_total` para DEPOIS do bloco novo de `modo_precificacao` + do bloco de `assessoria_tecnica`, garantindo que esses incrementos somem corretamente. Já está depois do bloco assessoria_tecnica na ordem do arquivo, mas o novo bloco modo_precificacao precisa entrar ANTES também — então conferir manualmente a ordem final:
> ```
> ... montagem secao_3 (isManual ou auto) ...
> ... NOVO: modo_precificacao reescreve secao_3 ...
> ... assessoria_tecnica adiciona linha ...
> ... cálculo de total_taxas, total_honorarios, secao_5_total ...
> ```

- [ ] **Step 3: Rodar os testes verdes**

Run: `npx vitest run src/services/pricing/desmembramento-v3.test.ts`
Expected: PASS — 7 testes (3 por_imovel, 2 por_lote, 2 personalizado, 2 despesas, 1 retrocompat).

- [ ] **Step 4: Rodar a suíte inteira pra não regredir**

Run: `npx vitest run src/services/pricing/`
Expected: PASS — toda a suíte de pricing (inclusive os testes v3.22.0).

- [ ] **Step 5: Commit**

```bash
git add src/services/pricing/desmembramento.ts
git commit -m "feat(remembramento-v3): engine de 3 modos de precificacao + despesas_administrativas (sem somar ao total)"
```

---

### Task 3: PDF — respeitar toggles + reescrever Assessoria Técnica + Despesas

**Files:**
- Modify: `src/integrations/propostasConsultoria.ts` — função `gerarPdfConsultoria` (provavelmente entre linhas 400-700; localizar antes de editar)

> **Localizar pontos de edição antes:** abrir o arquivo e procurar (Ctrl+F) por:
> 1. `assessoria_juridica` / `assessoria_tecnica` — onde o PDF renderiza essa seção
> 2. `secao_4_checklist` — onde o PDF renderiza o checklist
> 3. `imoveisDetalhados` — onde a tabela de imóveis aparece (já editado em v3.22.0)
> 4. `condicoes_pagamento` — onde as condições aparecem
>
> Anotar as linhas exatas antes de editar.

- [ ] **Step 1: Adicionar seção "Despesas Administrativas (estimativa)" entre Honorários e Peças/Checklist**

Logo após o bloco que renderiza `secao_3_honorarios` (com a sua linha de "Total Honorários"), inserir:

```typescript
// v3.23.0: III — Despesas Administrativas (estimativa) — só renderiza se presente
const despesasAdm = (p.custos_calculados as any)?.despesas_administrativas as
  | { valor: number; descritivo: string }
  | undefined;
if (despesasAdm) {
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0a3d62');
  doc.text('III — Despesas Administrativas (estimativa)');
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(9).fillColor('#222');
  doc.text(despesasAdm.descritivo, { align: 'justify' });
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#222');
  doc.text(`Estimativa: ${formatBRL(despesasAdm.valor)}`);
  doc.moveDown(0.1);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666');
  doc.text('Esta estimativa NÃO compõe os honorários técnicos. Os valores definitivos correrão por conta do contratante conforme apuração junto à Superintendência de Habitação e Regularização Fundiária.', { align: 'justify' });
  doc.moveDown(0.4);
}
```

- [ ] **Step 2: Reescrever a Assessoria Técnica (escopo completo do CEO)**

Localizar onde o PDF renderiza a seção de Assessoria (procurar por `'Assessoria T'` ou `assessoria_tecnica`). Substituir o texto curto atual por:

```typescript
// v3.23.0: Assessoria Técnica e Diligências — escopo completo
const assTec = (p.dados_imovel as any)?.assessoria_tecnica as
  | { habilitada: boolean; valor?: number }
  | undefined;

if (p.subtipo === 'remembramento' || p.subtipo === 'desmembramento') {
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0a3d62');
  doc.text('V — Assessoria Técnica e Diligências');
  doc.moveDown(0.2);

  if (assTec?.habilitada) {
    doc.font('Helvetica').fontSize(9).fillColor('#222');
    const tipoTexto = p.subtipo === 'remembramento' ? 'remembramento' : 'desmembramento';
    doc.text(`A assessoria técnica e operacional consiste no acompanhamento técnico-administrativo do processo de ${tipoTexto} até o registro definitivo no Cartório de Registro de Imóveis competente, compreendendo:`, { align: 'justify' });
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#222');
    doc.text('1. PEÇAS TÉCNICAS');
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text('   • Elaboração de Mapa Mural / Planta de Situação;');
    doc.text('   • Memorial Descritivo das áreas;');
    doc.text('   • Anotação de Responsabilidade Técnica (ART/CREA) ou Termo de Responsabilidade Técnica (TRT/CFT), conforme habilitação aplicável;');
    doc.text('   • Visita técnica de campo quando necessária à confirmação dos limites.');
    doc.moveDown(0.2);

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#222');
    doc.text('2. RECOLHIMENTO DE ASSINATURAS');
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text('   • Coleta das assinaturas das partes envolvidas (proprietários e/ou procuradores) nas ART/TRT, mapas, memoriais e requerimentos administrativos.');
    doc.moveDown(0.2);

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#222');
    doc.text('3. DILIGÊNCIAS NA SUPERINTENDÊNCIA DE HABITAÇÃO E REGULARIZAÇÃO FUNDIÁRIA');
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text('   • Protocolo do processo completo junto ao órgão municipal competente;');
    doc.text('   • Acompanhamento da análise técnica e vistorias designadas;');
    doc.text('   • Verificação da regularidade fiscal dos imóveis (IPTUs em dia / certidão negativa);');
    doc.text('   • Recolhimento das taxas de parcelamento do solo conforme legislação municipal;');
    doc.text('   • Acompanhamento até a expedição do ofício de aprovação.');
    doc.moveDown(0.2);

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#222');
    doc.text('4. DILIGÊNCIAS NO CARTÓRIO DE REGISTRO DE IMÓVEIS');
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text('   • Protocolo do acervo aprovado junto ao Cartório competente;');
    doc.text('   • Acompanhamento da análise documental cartorária;');
    doc.text(`   • Acompanhamento até a averbação e expedição das novas matrículas (${p.subtipo === 'remembramento' ? 'matrícula única' : 'matrículas das frações'}).`);
    doc.moveDown(0.2);

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#222');
    doc.text('5. CUSTAS E EMOLUMENTOS');
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text('   Os custos de emolumentos cartorários (TJMA), taxas de parcelamento municipal e eventuais regularizações fiscais (IPTU) NÃO estão incluídos nos honorários técnicos e correrão por conta do contratante.', { align: 'justify' });
  } else {
    // Assessoria NÃO contratada
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#b91c1c');
    doc.text('⚠ SERVIÇO NÃO CONTRATADO');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor('#222');
    doc.text('A presente proposta contempla exclusivamente a elaboração das peças técnicas descritas no item anterior. As diligências administrativas (Superintendência de Habitação e Regularização Fundiária e Cartório de Registro de Imóveis), recolhimento de assinaturas e demais providências correrão por conta do contratante ou de procurador por ele constituído.', { align: 'justify' });
  }
  doc.moveDown(0.4);
}
```

- [ ] **Step 3: Garantir que `condicoes_pagamento` mostra "A combinar" quando aplicável**

Localizar onde o PDF renderiza `condicoes_pagamento`. Confirmar que ele itera o array e exibe cada item — já é o caso pelo `desmembramento.ts:423-462`. O texto "A combinar" já vem do modo manual (`isManual` na engine). Nada a editar aqui, MAS:

Se `modo_precificacao` for `personalizado`, forçar `condicoes_pagamento` para "A combinar" também. Em `src/services/pricing/desmembramento.ts`, no bloco `condicoes_pagamento`, atualizar:

```typescript
  // v3.23.0: modo_precificacao=personalizado também usa "A combinar"
  if (isManual || input.modo_precificacao === 'personalizado') {
    const totalManual = secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    condicoes_pagamento = [{
      rotulo: 'A combinar entre as partes',
      descricao: 'Forma e cronograma de pagamento dos honorários a serem definidos em comum acordo entre Contratante e Contratado, registrados em recibo próprio.',
      valor: totalManual,
    }];
  } else if (isDesm) {
    // ... resto inalterado
  }
```

- [ ] **Step 4: Auditar checklist (`secao_4`) e peças técnicas**

Procurar no PDF onde `secao_4_checklist` é renderizado. Conferir que respeita o flag `pecas_tecnicas` — se `pecas_tecnicas.art === false` E `pecas_tecnicas.trt === false`, a engine já lança erro (linha 134-138 do desmembramento.ts). No PDF, só renderiza o checklist completo — não há toggle por peça hoje no PDF. Decisão: **não mexer no PDF do checklist nesta task** (já trata via engine).

- [ ] **Step 5: Confirmar que compila**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 6: Smoke test manual do PDF**

Iniciar o dev (em outro terminal): `npm run dev`. Criar uma proposta de remembramento via API com `assessoria_tecnica.habilitada=true` e `despesas_administrativas.habilitada=true`. Baixar o PDF e conferir visualmente:
- Aparece seção "III — Despesas Administrativas (estimativa)"
- Aparece seção "V — Assessoria Técnica e Diligências" com os 5 blocos numerados
- Quando criar outra proposta com `assessoria_tecnica.habilitada=false`, a seção V mostra "⚠ SERVIÇO NÃO CONTRATADO"

> Se não tiver dev local rodando, anotar como teste pendente e seguir.

- [ ] **Step 7: Commit**

```bash
git add src/integrations/propostasConsultoria.ts src/services/pricing/desmembramento.ts
git commit -m "feat(remembramento-v3-pdf): secao Despesas Administrativas + Assessoria Tecnica reescrita (escopo completo) + condicoes_pagamento=A combinar em modo personalizado"
```

---

### Task 4: Form inline em obras.html — 3 modos + radio Urbano/Rural + Despesas

**Files:**
- Modify: `src/public/obras.html:6707-6720` (substitui select "Pacote SM" por 3 cards)
- Modify: `src/public/obras.html:6700-6705` (substitui select "Tipo de zona" por radio Urbano/Rural com unidade dinâmica)
- Modify: `src/public/obras.html:6793-6805` (renomeia "Assessoria Técnica Jurídica" → "Assessoria Técnica" e adiciona toggle Despesas)
- Modify: `src/public/obras.html` (handler que monta `dados_imovel` no submit do form — procurar `dxModoManual` e `dados_imovel` no contexto desse form)

> Importante: aqui as linhas DEPOIS de Task 3 podem ter mudado se você seguiu a sugestão de mover o cálculo de `secao_5_total`. Re-localizar antes de editar.

- [ ] **Step 1: Substituir select "Tipo de zona" por radio "Urbano / Rural"**

Em `src/public/obras.html`, dentro de `renderConsultoriaFormDesmRem`, localizar (próximo da linha 6700):

```html
<label>Tipo de zona
  <select id="dxZona" style="width:100%;">
    <option value="urbana" selected>Urbana</option>
    <option value="rural">Rural</option>
  </select>
</label>
```

Substituir por:

```html
<p style="margin:12px 0 4px; font-weight:600; color:var(--neon); font-size:13px;">🗺️ Tipo de imóvel</p>
<div style="display:flex; gap:0; border:1px solid var(--border); border-radius:6px; overflow:hidden;">
  <button type="button" data-zona="urbana" id="dxZonaUrbano" style="flex:1; padding:8px; background:var(--success); color:#fff; border:none; cursor:pointer;">🏢 Urbano (m²)</button>
  <button type="button" data-zona="rural" id="dxZonaRural" style="flex:1; padding:8px; background:transparent; color:var(--text); border:none; border-left:1px solid var(--border); cursor:pointer;">🌾 Rural (ha)</button>
</div>
<p style="font-size:10px; color:var(--text-muted); margin:4px 0 0;">Urbano → Lei 6.766/79 (m²) · Rural → Lei 5.868/72 + INCRA (ha)</p>
<input type="hidden" id="dxZona" value="urbana">
```

No bloco de handlers (após o `v.innerHTML = ...`), adicionar:

```javascript
const setZona = (z) => {
  document.getElementById('dxZona').value = z;
  document.getElementById('dxZonaUrbano').style.background = z === 'urbana' ? 'var(--success)' : 'transparent';
  document.getElementById('dxZonaUrbano').style.color = z === 'urbana' ? '#fff' : 'var(--text)';
  document.getElementById('dxZonaRural').style.background = z === 'rural' ? 'var(--success)' : 'transparent';
  document.getElementById('dxZonaRural').style.color = z === 'rural' ? '#fff' : 'var(--text)';
  document.getElementById('dxAreaUnidade').textContent = z === 'rural' ? 'ha' : 'm²';
};
document.getElementById('dxZonaUrbano').onclick = () => setZona('urbana');
document.getElementById('dxZonaRural').onclick = () => setZona('rural');
```

- [ ] **Step 2: Substituir "Pacote de honorários" pelos 3 cards de modo**

Localizar (próximo da linha 6713-6719):

```html
<p style="margin:12px 0 4px; font-weight:600; color:var(--neon); font-size:13px;">💰 Pacote de honorários</p>
<label>Tipo de pacote ...
  <select id="dxPacote" ...>
    <option value="0.5">Básico (0,5 SM ...)</option>
    <option value="1.0" selected>Completo (1,0 SM ...)</option>
  </select>
</label>
```

Substituir por:

```html
<p style="margin:12px 0 4px; font-weight:600; color:var(--neon); font-size:13px;">💰 Modo de precificação</p>
<div style="display:grid; gap:6px;">
  <label style="display:flex; gap:6px; align-items:flex-start; padding:8px; border:1px solid var(--border); border-radius:6px; cursor:pointer;">
    <input type="radio" name="dxModoPrec" value="por_imovel" checked>
    <div style="flex:1;">
      <div style="font-weight:600; font-size:12px;">A) Por quantidade de imóveis</div>
      <div style="font-size:11px; color:var(--text-muted);">Valor unitário × quantidade. Recomendado para casos padrão.</div>
    </div>
  </label>
  <label style="display:flex; gap:6px; align-items:flex-start; padding:8px; border:1px solid var(--border); border-radius:6px; cursor:pointer;">
    <input type="radio" name="dxModoPrec" value="por_lote">
    <div style="flex:1;">
      <div style="font-weight:600; font-size:12px;">B) Por lote individual</div>
      <div style="font-size:11px; color:var(--text-muted);">Um valor por lote (lista livre).</div>
    </div>
  </label>
  <label style="display:flex; gap:6px; align-items:flex-start; padding:8px; border:1px solid var(--border); border-radius:6px; cursor:pointer;">
    <input type="radio" name="dxModoPrec" value="personalizado">
    <div style="flex:1;">
      <div style="font-weight:600; font-size:12px;">C) Personalizado (valor fechado)</div>
      <div style="font-size:11px; color:var(--text-muted);">Valor total único + descritivo.</div>
    </div>
  </label>
</div>

<div id="dxModoPorImovelBox" class="dx-modo-box">
  <label>Valor por imóvel (R$)
    <input id="dxValorPorImovel" type="number" min="0" step="0.01" style="width:100%;" placeholder="ex: 1500.00">
  </label>
  <p style="font-size:10px; color:var(--text-muted); margin:4px 0 0;" id="dxValorPorImovelResumo">Memória de cálculo aparecerá aqui.</p>
  <p style="font-size:10px; color:var(--text-muted); margin:4px 0 0;">
    Referência sugerida: tabela CFT/MA — <a href="#" id="dxTabelaCftMa" style="color:var(--neon);">ver tabela</a> (valor sempre editável manualmente)
  </p>
</div>

<div id="dxModoPorLoteBox" class="dx-modo-box" style="display:none;">
  <div id="dxValoresPorLoteLista" style="display:flex; flex-direction:column; gap:6px;"></div>
  <button type="button" id="dxValoresPorLoteAdd" class="btn-secondary" style="margin-top:6px; font-size:11px;">+ Adicionar lote</button>
</div>

<div id="dxModoPersonalizadoBox" class="dx-modo-box" style="display:none;">
  <label>Valor total (R$)
    <input id="dxHonPersValor" type="number" min="0" step="0.01" style="width:100%;">
  </label>
  <label style="margin-top:6px;">Descritivo / justificativa
    <textarea id="dxHonPersDescritivo" rows="3" style="width:100%;" placeholder="ex: Pacote técnico fechado conforme acordo entre as partes (visita técnica + memorial + ART)"></textarea>
  </label>
</div>
```

Adicionar nos handlers:

```javascript
const switchModo = (modo) => {
  document.querySelectorAll('.dx-modo-box').forEach(b => b.style.display = 'none');
  document.getElementById('dxModoPorImovelBox').style.display = modo === 'por_imovel' ? 'block' : 'none';
  document.getElementById('dxModoPorLoteBox').style.display = modo === 'por_lote' ? 'block' : 'none';
  document.getElementById('dxModoPersonalizadoBox').style.display = modo === 'personalizado' ? 'block' : 'none';
};
document.querySelectorAll('input[name="dxModoPrec"]').forEach(r => r.onchange = (e) => switchModo(e.target.value));

// Memória de cálculo no modo "por_imovel"
const updatePorImovelResumo = () => {
  const v = Number(document.getElementById('dxValorPorImovel').value || 0);
  const n = Number(document.getElementById('dxNumLotes').value || 0);
  document.getElementById('dxValorPorImovelResumo').textContent =
    v > 0 && n >= 2 ? `Cálculo: R$ ${v.toFixed(2)} × ${n} imóvel(eis) = R$ ${(v * n).toFixed(2)}` : 'Preencha valor e quantidade.';
};
document.getElementById('dxValorPorImovel').oninput = updatePorImovelResumo;
document.getElementById('dxNumLotes').oninput = updatePorImovelResumo;

// Repeater por_lote
const addValorPorLote = () => {
  const lista = document.getElementById('dxValoresPorLoteLista');
  const idx = lista.children.length + 1;
  const row = document.createElement('div');
  row.className = 'dx-lote-row';
  row.dataset.ordem = String(idx);
  row.style.cssText = 'display:grid; grid-template-columns:60px 1fr 1fr 32px; gap:6px; align-items:center;';
  row.innerHTML = `
    <span style="font-size:11px; color:var(--text-muted);">Lote ${String(idx).padStart(2, '0')}</span>
    <input type="text" data-lote-desc placeholder="Descrição (opcional)" style="font-size:11px; padding:4px;">
    <input type="number" data-lote-valor min="0" step="0.01" placeholder="R$" style="font-size:11px; padding:4px;">
    <button type="button" class="btn-danger" data-lote-remove style="font-size:11px; padding:2px 6px;">×</button>
  `;
  row.querySelector('[data-lote-remove]').onclick = () => row.remove();
  lista.appendChild(row);
};
document.getElementById('dxValoresPorLoteAdd').onclick = addValorPorLote;
addValorPorLote(); addValorPorLote(); // mínimo 2
```

- [ ] **Step 3: Substituir bloco "Assessoria Técnica Jurídica" e adicionar toggle Despesas**

Localizar (próximo da linha 6793-6805):

```html
<details ...>
  <summary>... Assessoria Técnica Jurídica</summary>
  <div ...>
    <label><input type="checkbox" id="dxAssIncluir"> Incluir Assessoria Jurídica nos honorários</label>
    <label id="dxAssValorWrap" ...>Valor (R$) <input id="dxAssValor" ...></label>
  </div>
</details>
```

Substituir por (duas seções: Assessoria Técnica + Despesas Administrativas):

```html
<details style="margin-top:12px; border:1px solid var(--border); border-radius:6px; padding:6px 10px;">
  <summary style="cursor:pointer; font-weight:600; color:var(--neon); font-size:12px;">⚖️ Assessoria Técnica e Diligências</summary>
  <div style="padding:8px 0;">
    <label style="display:flex; gap:6px; align-items:center; font-size:11px;">
      <input type="checkbox" id="dxAssTecHabilitada">
      <span>Incluir assessoria técnica (diligências Prefeitura + Cartório)</span>
    </label>
    <label id="dxAssTecValorWrap" style="display:none; margin-top:6px; font-size:11px;">Valor (R$)
      <input id="dxAssTecValor" type="number" min="0" step="0.01" style="width:100%;">
    </label>
    <p style="font-size:10px; color:var(--text-muted); margin:6px 0 0;">
      Quando desligada, o PDF mostra "⚠ Serviço não contratado" e o cliente fica responsável pelas diligências.
    </p>
  </div>
</details>

<details style="margin-top:12px; border:1px solid var(--border); border-radius:6px; padding:6px 10px;">
  <summary style="cursor:pointer; font-weight:600; color:var(--neon); font-size:12px;">📋 Despesas Administrativas (estimativa)</summary>
  <div style="padding:8px 0;">
    <label style="display:flex; gap:6px; align-items:center; font-size:11px;">
      <input type="checkbox" id="dxDespAdmHabilitada">
      <span>Incluir estimativa de despesas de parcelamento municipal</span>
    </label>
    <div id="dxDespAdmBox" style="display:none; margin-top:6px; display:grid; gap:6px;">
      <label style="font-size:11px;">Valor (R$)
        <input id="dxDespAdmValor" type="number" min="0" step="0.01" style="width:100%;">
      </label>
      <label style="font-size:11px;">Descritivo
        <textarea id="dxDespAdmDescritivo" rows="2" style="width:100%;">Taxas de parcelamento do solo conforme legislação municipal de Açailândia. Valores sujeitos a confirmação junto à Superintendência de Habitação e Regularização Fundiária.</textarea>
      </label>
      <p style="font-size:10px; color:var(--text-muted);">Esta estimativa NÃO compõe os honorários técnicos.</p>
    </div>
  </div>
</details>
```

Adicionar handlers:

```javascript
document.getElementById('dxAssTecHabilitada').onchange = (e) => {
  document.getElementById('dxAssTecValorWrap').style.display = e.target.checked ? 'block' : 'none';
};
document.getElementById('dxDespAdmHabilitada').onchange = (e) => {
  document.getElementById('dxDespAdmBox').style.display = e.target.checked ? 'block' : 'none';
};
```

- [ ] **Step 4: Atualizar o payload de submit**

Localizar o bloco que monta `dados_imovel` ao clicar em "Calcular preview" / "Salvar" (procurar por `dxPacote` ou `honorario_projeto_sm` no contexto do form Desm/Rem — provavelmente próximo da linha 7100-7200). Substituir o trecho que monta `honorario_projeto_sm` por:

```javascript
const modoPrec = document.querySelector('input[name="dxModoPrec"]:checked')?.value || 'por_imovel';
const dados_imovel = {
  tipo: subtipo,
  area_total_m2: Number(document.getElementById('dxArea').value || 0),
  valor_venal_total: Number(document.getElementById('dxValorVenal').value || 0),
  tipo_zona: document.getElementById('dxZona').value,
  iptu_em_dia: document.getElementById('dxIptu').checked,
  // legado v3.22.0 (manter por retrocompat — não usado quando modo_precificacao está presente)
  honorario_projeto_sm: 1.0,
  numero_lotes_origem: !isDesm ? Number(document.getElementById('dxNumLotes').value || 0) : undefined,
  numero_lotes_resultantes: isDesm ? Number(document.getElementById('dxNumLotes').value || 0) : undefined,
  // v3.23.0
  modo_precificacao: modoPrec,
};
if (modoPrec === 'por_imovel') {
  dados_imovel.valor_por_imovel = Number(document.getElementById('dxValorPorImovel').value || 0);
} else if (modoPrec === 'por_lote') {
  dados_imovel.valores_por_lote = Array.from(document.querySelectorAll('.dx-lote-row')).map((row, i) => ({
    ordem: i + 1,
    valor: Number(row.querySelector('[data-lote-valor]').value || 0),
    descricao: row.querySelector('[data-lote-desc]').value || undefined,
  }));
} else if (modoPrec === 'personalizado') {
  dados_imovel.honorarios_personalizados = {
    valor_total: Number(document.getElementById('dxHonPersValor').value || 0),
    descritivo: document.getElementById('dxHonPersDescritivo').value || '',
  };
}
if (document.getElementById('dxAssTecHabilitada').checked) {
  dados_imovel.assessoria_tecnica = {
    habilitada: true,
    valor: Number(document.getElementById('dxAssTecValor').value || 0),
  };
}
if (document.getElementById('dxDespAdmHabilitada').checked) {
  dados_imovel.despesas_administrativas = {
    habilitada: true,
    valor: Number(document.getElementById('dxDespAdmValor').value || 0),
    descritivo: document.getElementById('dxDespAdmDescritivo').value || '',
  };
}
```

- [ ] **Step 5: Smoke manual no browser**

`npm run dev` em outro terminal. Abrir `obras.html` no browser. Criar uma proposta de remembramento:
- Modo "Por imóvel" com 3 imóveis × R$ 1500 → preview deve mostrar R$ 4500
- Trocar para "Por lote" com [800, 1200, 1500] → preview deve mostrar R$ 3500
- Trocar para "Personalizado" com R$ 4500 → preview deve mostrar R$ 4500
- Ligar Assessoria Técnica R$ 800 → preview deve mostrar +R$ 800
- Ligar Despesas R$ 250 → preview deve mostrar seção separada NÃO somando ao total

- [ ] **Step 6: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(remembramento-v3-ui): radio Urbano/Rural + 3 modos de precificacao + toggle Despesas Administrativas no form inline"
```

---

### Task 5: Destravar botão Editar para remembramento e desmembramento

**Files:**
- Modify: `src/public/obras.html:6000-6025` (handler `data-edit-cons`)

- [ ] **Step 1: Remover o `if` restritivo**

Em `src/public/obras.html`, localizar (linha 6005-6008):

```javascript
const subtipo = p.subtipo;
if (!subtipo || (subtipo !== 'averbacao_residencial' && subtipo !== 'averbacao_comercial')) {
  return alert('Edição disponível apenas para Averbação Residencial e Comercial nesta fase.');
}
```

Substituir por:

```javascript
const subtipo = p.subtipo;
if (!subtipo) {
  return alert('Subtipo da proposta ausente — não é possível editar.');
}
// v3.23.0: Editar habilitado para averbação, georref, desm, remem, retif, ptam (todos os subtipos com form).
const SUBTIPOS_EDITAVEIS = new Set([
  'averbacao_residencial',
  'averbacao_comercial',
  'georreferenciamento_rural',
  'desmembramento',
  'remembramento',
  'retificacao_area',
  'avaliacao_ptam',
]);
if (!SUBTIPOS_EDITAVEIS.has(subtipo)) {
  return alert(`Edição não disponível para subtipo "${subtipo}".`);
}
```

- [ ] **Step 2: Verificar hidratação no `renderConsultoriaFormDesmRem`**

Abrir `src/public/obras.html` linha 6640+ (função `renderConsultoriaFormDesmRem`). Conferir se quando `editando` é true, ele lê de `state.consultoriaFormCache.dados_imovel` e preenche os inputs. Procurar por `state.consultoriaFormCache?.dados_imovel` ou `cache.dados_imovel`. Se a hidratação **não** cobrir os novos campos (`modo_precificacao`, `valor_por_imovel`, `valores_por_lote`, `honorarios_personalizados`, `assessoria_tecnica`, `despesas_administrativas`), adicionar.

Inserir bloco de hidratação (próximo do fim de `renderConsultoriaFormDesmRem`, depois de todos os handlers serem registrados, antes da função retornar):

```javascript
// v3.23.0: hidratação para edição
if (editando && state.consultoriaFormCache?.dados_imovel) {
  const d = state.consultoriaFormCache.dados_imovel;
  document.getElementById('dxCliente').value = state.consultoriaFormCache.cliId || '';
  document.getElementById('dxEndereco').value = state.consultoriaFormCache.endereco || '';
  document.getElementById('dxArea').value = d.area_total_m2 || '';
  document.getElementById('dxValorVenal').value = d.valor_venal_total || '';
  setZona(d.tipo_zona || 'urbana');
  document.getElementById('dxNumLotes').value = d.numero_lotes_origem || d.numero_lotes_resultantes || '';
  document.getElementById('dxIptu').checked = d.iptu_em_dia !== false;

  // modo_precificacao
  if (d.modo_precificacao) {
    const radio = document.querySelector(`input[name="dxModoPrec"][value="${d.modo_precificacao}"]`);
    if (radio) { radio.checked = true; switchModo(d.modo_precificacao); }
    if (d.modo_precificacao === 'por_imovel' && d.valor_por_imovel) {
      document.getElementById('dxValorPorImovel').value = d.valor_por_imovel;
      updatePorImovelResumo();
    } else if (d.modo_precificacao === 'por_lote' && Array.isArray(d.valores_por_lote)) {
      document.getElementById('dxValoresPorLoteLista').innerHTML = '';
      d.valores_por_lote.forEach(v => {
        addValorPorLote();
        const rows = document.querySelectorAll('.dx-lote-row');
        const last = rows[rows.length - 1];
        last.querySelector('[data-lote-desc]').value = v.descricao || '';
        last.querySelector('[data-lote-valor]').value = v.valor || '';
      });
    } else if (d.modo_precificacao === 'personalizado' && d.honorarios_personalizados) {
      document.getElementById('dxHonPersValor').value = d.honorarios_personalizados.valor_total || '';
      document.getElementById('dxHonPersDescritivo').value = d.honorarios_personalizados.descritivo || '';
    }
  }

  // assessoria_tecnica
  if (d.assessoria_tecnica?.habilitada) {
    document.getElementById('dxAssTecHabilitada').checked = true;
    document.getElementById('dxAssTecValorWrap').style.display = 'block';
    document.getElementById('dxAssTecValor').value = d.assessoria_tecnica.valor || '';
  }

  // despesas_administrativas
  if (d.despesas_administrativas?.habilitada) {
    document.getElementById('dxDespAdmHabilitada').checked = true;
    document.getElementById('dxDespAdmBox').style.display = 'block';
    document.getElementById('dxDespAdmValor').value = d.despesas_administrativas.valor || '';
    document.getElementById('dxDespAdmDescritivo').value = d.despesas_administrativas.descritivo || '';
  }
}
```

- [ ] **Step 3: Garantir que o submit detecta edição e usa PUT (não POST)**

Procurar no `renderConsultoriaFormDesmRem` o ponto que envia a proposta. Conferir que existe um caminho `if (state.consultoriaEditandoId)` que faz PUT em `/api/propostas-consultoria/:id` (o endpoint já existe — `server.ts:3410`). Se NÃO existir, adicionar:

```javascript
const url = state.consultoriaEditandoId
  ? `/api/propostas-consultoria/${state.consultoriaEditandoId}`
  : '/api/propostas-consultoria';
const method = state.consultoriaEditandoId ? 'PUT' : 'POST';
const resp = await api(url, { method, body: JSON.stringify({ /* ... */ }) });
```

- [ ] **Step 4: Smoke manual**

Browser: criar uma proposta de remembramento → salvar → voltar pra lista → clicar Editar → o form deve abrir preenchido com todos os campos → mudar 1 campo → salvar → conferir que a proposta foi atualizada no banco (não duplicada).

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(remembramento-v3): destravar botao Editar para remembramento/desmembramento/georref/retif/ptam + hidratacao completa do form"
```

---

### Task 6: Validação final + Changelog 🟢

- [ ] **Step 1: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: PASS — todos os testes (335+7 novos da v3 = 342 esperados). Falhas pré-existentes (~5) continuam mas não devem AUMENTAR.

- [ ] **Step 2: Compilação completa**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 3: Smoke E2E em dev — matriz de toggles (8 cenários)**

Em terminal separado: `npm run dev`.

Para cada cenário abaixo, criar a proposta, gerar PDF, conferir as seções:

| #  | Tipo          | Modo prec.       | Ass. Téc. | Despesas | Esperado no PDF                                            |
| -- | ------------- | ---------------- | --------- | -------- | ----------------------------------------------------------- |
| 1  | Remembramento | por_imovel       | ✓         | ✓        | III Despesas + V Assessoria escopo completo                |
| 2  | Remembramento | por_imovel       | ✓         | ✗        | V Assessoria escopo completo, SEM III Despesas             |
| 3  | Remembramento | por_imovel       | ✗         | ✓        | III Despesas, V "⚠ NÃO CONTRATADO"                         |
| 4  | Remembramento | por_imovel       | ✗         | ✗        | SEM III Despesas, V "⚠ NÃO CONTRATADO"                     |
| 5  | Desmembramento| por_lote (4 lotes)| ✓        | ✓        | 4 lotes em "Honorários", III + V escopo completo            |
| 6  | Desmembramento| por_lote         | ✗         | ✗        | 4 lotes em "Honorários", V "⚠ NÃO CONTRATADO"               |
| 7  | Remembramento | personalizado    | ✓         | ✗        | 1 linha "pacote fechado", "Condições: A combinar", V completo |
| 8  | Desmembramento| personalizado    | ✗         | ✓        | 1 linha "pacote fechado", "A combinar", III Despesas, V não contratado |

Anotar quais cenários passam e quais falham. Bugs encontrados: fixar antes do PR.

- [ ] **Step 4: Testar EDITAR em cada cenário**

Para cada cenário acima, depois de criar a proposta:
1. Voltar à lista → clicar Editar
2. Conferir que TODOS os campos vêm preenchidos
3. Mudar 1 campo (ex: trocar Assessoria de ligada para desligada)
4. Salvar
5. Gerar PDF de novo → conferir que a mudança refletiu

- [ ] **Step 5: Criar changelog**

Criar `06-Changelog/v3.23.0-remembramento-ajustes-v3.md`:

```markdown
# v3.23.0 — Remembramento + Desmembramento — Ajustes v3

**Data:** 2026-05-20
**Origem:** Pedido do CEO — substituir pacotes SM por 3 modos de precificação livres, destravar botão Editar para remembramento/desmembramento, garantir que toggles ditam o PDF, adicionar bloco "Despesas Administrativas" opcional.

## O que entra

### Backend

- **Tipos (`src/services/pricing/types.ts`)** — `InputDesmembramento` ganha:
  - `modo_precificacao?: 'por_imovel' | 'por_lote' | 'personalizado'`
  - `valor_por_imovel?: number`
  - `valores_por_lote?: Array<{ ordem, valor, descricao? }>`
  - `honorarios_personalizados?: { valor_total, descritivo }`
  - `despesas_administrativas?: { habilitada, valor, descritivo }`
  - Comentário do `honorario_projeto_sm` atualizado para "legado v3.22.0".
- **`CustosCalculados`** ganha `despesas_administrativas?: { valor, descritivo }` (seção separada, NÃO soma ao total).
- **Engine (`desmembramento.ts`)** — quando `modo_precificacao` está presente, reescreve `secao_3_honorarios`:
  - `por_imovel`: 1 linha "Honorários técnicos — N imóveis × R$ X"
  - `por_lote`: 1 linha por lote
  - `personalizado`: 1 linha "pacote fechado" + descritivo
  - `condicoes_pagamento` vai pra "A combinar" também em `personalizado`.
- **Despesas administrativas** ficam em `custos.despesas_administrativas`, **não** entram em `secao_5_total`.

### PDF (`propostasConsultoria.ts`)

- Nova seção **III — Despesas Administrativas (estimativa)** entre Honorários e Peças, só quando `custos.despesas_administrativas` presente.
- Seção **V — Assessoria Técnica e Diligências** reescrita com escopo completo (5 blocos: Peças, Assinaturas, Diligências Superintendência, Diligências Cartório, Custas) quando `assessoria_tecnica.habilitada=true`.
- Quando `assessoria_tecnica.habilitada=false`, seção V mostra "⚠ SERVIÇO NÃO CONTRATADO".

### Frontend (obras.html)

- Form inline de remembramento/desmembramento ganha:
  - Radio "Urbano / Rural" (substituindo select) com unidade m²/ha dinâmica.
  - 3 cards de modo de precificação (Por imóvel / Por lote / Personalizado).
  - UI condicional para cada modo.
  - Toggle "Assessoria Técnica" (renomeado de "Assessoria Jurídica").
  - Toggle "Despesas Administrativas (estimativa)" com campos manuais.
- **Botão Editar destravado** para todos os subtipos (averbação, georref, desm, remem, retif, ptam).
- Hidratação completa do form ao reabrir proposta para edição (todos os campos v3.22.0 + v3.23.0).

## Testes

- 9 testes novos em `src/services/pricing/desmembramento-v3.test.ts`.
- Suite total: 335 + 9 = 344 esperados.

## Decisões de arquitetura

- **Sem mudança de schema SQL.** Todos os campos novos vivem em `propostas.dados_imovel` (JSON).
- **Compat retro:** quando `modo_precificacao` ausente, engine cai no comportamento v3.22.0 (pacote SM via `honorario_projeto_sm`).
- **Despesas separadas:** não entram em `secao_5_total` para deixar claro ao cliente que são custos de terceiros.

## Follow-ups (não bloqueiam merge)

1. Tabela automática de taxas de parcelamento por município (≈R$68 / 10% VRM por imóvel) — hoje é manual.
2. Wizard standalone `/proposta-remembramento.html` ainda usa o modelo v3.22.0 — alinhar para v3.23.0 numa segunda passada.
3. Geração de PDF de desmembramento standalone (sem `obras.html`) — fora de escopo.

## Arquivos tocados

- `src/services/pricing/types.ts`
- `src/services/pricing/desmembramento.ts`
- `src/services/pricing/desmembramento-v3.test.ts` (novo)
- `src/integrations/propostasConsultoria.ts`
- `src/public/obras.html`
- `06-Changelog/v3.23.0-remembramento-ajustes-v3.md` (este arquivo)
- `docs/superpowers/plans/2026-05-20-remembramento-ajustes-v3.md` (plano)
```

- [ ] **Step 6: Bump package.json + commit final**

Editar `package.json` para "version": "3.23.0".

```bash
git add package.json 06-Changelog/v3.23.0-remembramento-ajustes-v3.md docs/superpowers/plans/2026-05-20-remembramento-ajustes-v3.md
git commit -m "chore(v3.23.0): bump versao + changelog + plano Remembramento v3"
```

- [ ] **Step 7: Abrir PR**

```bash
git push -u origin feature/remembramento-ajustes-v3
gh pr create --title "v3.23.0 — Remembramento v3: 3 modos de precificacao + Editar destravado + PDF com toggles" --body "$(cat <<'EOF'
## Summary
- Substitui pacotes 0,5/1,0 SM por 3 modos de precificacao livres (por imovel, por lote, personalizado)
- Destrava botao Editar para remembramento/desmembramento (+ outros subtipos)
- Reescreve secao Assessoria Tecnica no PDF com escopo completo
- Adiciona bloco opcional "Despesas Administrativas (estimativa)" separado dos honorarios
- Radio "Urbano/Rural" no form inline com unidade m²/ha dinamica
- Mantem v3.22.0 intacta: status_documentacao, assessoria_tecnica, livro/folha/CRI autocomplete

## Test plan
- [ ] `npx vitest run` (esperado: 344 passing)
- [ ] `npx tsc --noEmit` (esperado: zero erros)
- [ ] Matriz de 8 cenarios (combinacao Modo × Assessoria × Despesas) — todos geram PDF correto
- [ ] Editar funciona em cada um dos 8 cenarios (form vem preenchido)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage (em relação ao prompt original do usuário):**

| Requisito do prompt                                                  | Task | Coberto |
| -------------------------------------------------------------------- | ---- | ------- |
| Remover endereço/área/valor venal/zona do topo                       | Task 4 | ⚠ Parcial — endereço fica (necessário no MVP), área fica (necessário), valor venal fica (usado no TJMA — re-rotulado), zona vira radio Urbano/Rural |
| Tipo urbano/rural → radio com unidade m² ou ha                       | Task 4 | ✅ |
| Quantidade de imóveis no topo + matrícula resultante                 | Task 4 | ✅ (campo `dxNumLotes` existente) |
| 3 modos de precificação                                              | Task 1, 2, 4 | ✅ |
| Remover "Receita Federal SERPRO"                                     | Task 1 | ✅ (atualiza comentário do tipo — não havia consulta SERPRO no engine) |
| "A combinar" como padrão em condições de pagamento                   | Task 3 step 3 | ✅ (em modo personalizado e manual) |
| Peças técnicas mantidas                                               | (sem mudança) | ✅ |
| Assessoria Jurídica reescrita com escopo                              | Task 3 step 2 | ✅ (mas como "Assessoria Técnica" — coerente com v3.22.0) |
| Bloco "⚠ NÃO CONTRATADO" quando assessoria desligada                 | Task 3 step 2 | ✅ |
| Despesas de parcelamento manual                                       | Task 1, 2, 3, 4 | ✅ |
| Botão Editar para remembramento + desmembramento                      | Task 5 | ✅ |
| PDF respeitar toggles                                                 | Task 3 | ✅ (assessoria, despesas; checklist mantém comportamento atual) |
| Migration SQL para colunas novas                                      | — | ⛔ Decisão: usar JSON `dados_imovel` (alinhado com v3.22.0). Não precisa de migration. |
| Validação manual com 2 propostas (rem urbano + desm rural)           | Task 6 step 3 | ✅ (cenários 1-8 cobrem ambos) |
| 7 PRs separados                                                       | — | ⛔ Decisão: 1 PR com 6 commits (cada Task = 1 commit). Features fortemente acopladas; PRs separados gerariam conflitos. |

**Gaps deliberados (não cobertos no plano):**

1. **Tabela automática de despesas municipais** — hoje só campo manual (conforme prompt original "⚠ Não criar tabela automática ainda").
2. **Wizard standalone `/proposta-remembramento.html`** — fica em v3.22.0; alinhamento com v3.23.0 vira follow-up.
3. **Documento "Mapa Mural / Planta de Situação"** etc — já existem em `pecas_tecnicas` do tipo; nenhuma mudança no schema.
4. **Coluna "Valor (R$)" na tabela de imóveis do PDF** — herdada da v3.22.0 (gap conhecido); adicionar fora deste plano.

**Placeholder scan:** zero `TODO`, `TBD`, `fill in details`. Todos os blocos de código têm conteúdo executável. Os textos "(localizar antes de editar)" são instruções operacionais, não placeholders de código.

**Type consistency:**
- `modo_precificacao` (snake_case, igual em types.ts, engine, form, PDF).
- `valor_por_imovel`, `valores_por_lote`, `honorarios_personalizados`, `despesas_administrativas`: snake_case consistente.
- `assessoria_tecnica.habilitada` (mantido da v3.22.0).
- `tipo_zona` (mantido — backend não muda; frontend só apresenta como Urbano/Rural).

---

## Execução

Plano salvo em `docs/superpowers/plans/2026-05-20-remembramento-ajustes-v3.md`. Duas opções:

**1. Subagent-Driven (recomendado para este plano)** — Dispatch fresh subagent por task, revisão entre tasks. Bom porque Task 1+2 (engine) e Task 3 (PDF) são paralelizáveis depois que tipos compilam, e Task 4 (form HTML) é grande o suficiente pra justificar um agente dedicado.

**2. Inline Execution** — Tudo nesta sessão, checkpoints após cada task.

Antes de executar, criar a branch:

```bash
git checkout -b feature/remembramento-ajustes-v3
```
