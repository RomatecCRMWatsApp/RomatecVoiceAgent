# v3.3.0 Mobile Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar `src/public/obras.html` totalmente operacional em viewports mobile (≤768px) através de CSS utility classes + safety net, sem mexer em backend.

**Architecture:** Três camadas: (1) utility classes `.lp-grid-2/3/4/5/auto` que colapsam para 1 coluna em ≤768px e para 2 colunas em 769-900px para grids de 4-5; (2) refactor incremental de inline grids para essas classes, view por view; (3) safety net global `[style*="grid-template-columns"]:not([data-keep-grid])` que força 1 coluna para qualquer inline grid não migrado. Calendário e tabelas legítimas multi-coluna usam opt-out `data-keep-grid`.

**Tech Stack:** Vanilla HTML/CSS dentro de `obras.html` (~16k linhas), Service Worker (`sw.js`) para cache-busting, sem novas dependências.

**Estratégia de PRs:** 3 PRs sequenciais (PR1 foundation, PR2 refactor view-by-view, PR3 modais + patches). **Ordem dos commits do PR1 é crítica** — bump de CACHE em `sw.js` é o ÚLTIMO commit, garantindo que CSS novo já está nos arquivos antes de invalidar o cache.

**Spec:** [docs/superpowers/specs/2026-05-10-mobile-foundation-design.md](../specs/2026-05-10-mobile-foundation-design.md)

---

## File Structure

**Modified files (apenas frontend, zero backend):**
- `src/public/obras.html` — adiciona `<style>` foundation + refactora inline grids view-a-view
- `src/public/sw.js` — bump de `CACHE` constant
- `package.json` — bump version
- `src/agent/identity.ts` — bump version (sincroniza com package.json)

**No new files.** No tests files (sem testes automatizados — validação visual em viewports).

---

## DOR (Definition of Ready) — Antes de começar

- [ ] Branch criada: `git checkout -b feat/mobile-foundation-v3.3.0` a partir de `main` atualizado
- [ ] `npm run typecheck` passa em `main` antes do trabalho começar
- [ ] Chrome DevTools aberto com Device Toolbar (Ctrl+Shift+M) — vai ser usado em todas as tasks

---

## DOD (Definition of Done) — Critério universal de cada task de refactor visual

**TODA task que mexe em layout DEVE terminar com este teste manual:**

1. Abrir `http://localhost:PORT/obras` no Chrome
2. Abrir DevTools → Device Toolbar → escolher **Pixel 7** (412×915) → percorrer a view modificada → confirmar **sem scroll horizontal**
3. Trocar viewport para **iPhone SE / Galaxy A** equivalente (360×800) → repetir → confirmar **sem scroll horizontal**
4. Trocar viewport para **Desktop** (1280×800) → confirmar que **nada quebrou acima do breakpoint**

**Se aparecer scroll horizontal em qualquer um dos dois viewports mobile → task NÃO está done.** Investigar (provavelmente sobrou inline grid não-migrado OU input com width fixo OU tabela sem overflow).

---

# PR1 — Foundation (ordem dos commits é crítica)

**Objetivo:** estabelecer base CSS + bump de versão SEM invalidar cache enquanto código novo não está completo no arquivo. Bump do `CACHE` em `sw.js` é o **último** commit.

**Branch:** `feat/mobile-foundation-v3.3.0` (continua no PR2 e PR3 também, ou abre PRs separados — decisão de governança).

**Tempo estimado:** ~30min

---

### Task 1.1: Adicionar utility classes ao `<style>` global

**Files:**
- Modify: `src/public/obras.html` — após linha 105 (após `@media (max-width:600px) { .form-grid... }`)

- [ ] **Step 1: Localizar âncora de inserção**

Run: usar Grep com pattern `@media \(max-width: 600px\) { \.form-grid` em `obras.html`.
Expected: deve achar linha ~105.

- [ ] **Step 2: Inserir bloco de utility classes após linha 105**

Adicionar este bloco logo após `@media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }`:

```css
  /* === LP-GRID: utility classes responsivas (v3.3.0) === */
  .lp-grid-auto {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
  }
  .lp-grid-2 { display: grid; grid-template-columns: 1fr 1fr;        gap: 8px; }
  .lp-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr;    gap: 8px; }
  .lp-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .lp-grid-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }

  @media (max-width: 768px) {
    .lp-grid-auto, .lp-grid-2, .lp-grid-3, .lp-grid-4, .lp-grid-5 {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 900px) and (min-width: 769px) {
    .lp-grid-4, .lp-grid-5 { grid-template-columns: 1fr 1fr; }
  }
```

- [ ] **Step 3: Verificar typecheck e que página carrega**

Run: `npm run typecheck` (não toca em TS, mas confirma que nada quebrou).
Expected: PASS.

Abrir `http://localhost:PORT/obras` no Chrome → confirmar que a página carrega normalmente em desktop. Nada usa as classes novas ainda, então não deve haver mudança visual.

- [ ] **Step 4: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): add lp-grid utility classes for responsive layout"
```

---

### Task 1.2: Adicionar safety net catch-all

**Files:**
- Modify: `src/public/obras.html` — após o bloco da Task 1.1

- [ ] **Step 1: Inserir safety net logo após as utility classes**

Adicionar este bloco imediatamente após o `@media (max-width: 900px)` da Task 1.1:

```css
  /* === SAFETY NET: força 1 coluna em qualquer inline grid não migrado === */
  @media (max-width: 768px) {
    [style*="grid-template-columns"]:not([data-keep-grid]) {
      grid-template-columns: 1fr !important;
    }
  }
```

- [ ] **Step 2: Smoke test em 360×800 — DEVE quebrar visivelmente em vários lugares e funcionar em outros**

Abrir `http://localhost:PORT/obras` no Chrome, DevTools → Device Toolbar → Pixel 5/Galaxy A (360×800).

Percorrer Painel, Obras, Despesas: a maioria dos grids inline agora deve estar empilhada em 1 coluna. Pode haver problemas estéticos (gap inconsistente, alinhamentos esquisitos) — **isso é esperado** e será resolvido no PR2 com a migração para utility classes. O que importa neste smoke test é:

- ✅ Scroll horizontal sumiu na maioria das telas
- ✅ Nenhum elemento ficou totalmente quebrado/invisível
- ✅ Calendário (se acessar) provavelmente quebrou — vai ser fixado com `data-keep-grid` no PR3 Task 3.7

**Se aparecer crash de JS ou tela totalmente em branco → safety net está atingindo algo que não devia. Revisar seletor.**

- [ ] **Step 3: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): add safety net forcing 1-col grid below 768px"
```

---

### Task 1.3: Bump de versão em `package.json` e `identity.ts`

**Files:**
- Modify: `package.json:3` (version field)
- Modify: `src/agent/identity.ts:4` (version field)

- [ ] **Step 1: Bumpar package.json**

Editar `package.json` linha 3, trocar `"version": "3.2.0"` por `"version": "3.3.0"`.

- [ ] **Step 2: Bumpar identity.ts**

Editar `src/agent/identity.ts` linha 4, trocar `version: '3.2.0',` por `version: '3.3.0',`.

- [ ] **Step 3: Verificar consistência**

Run:
```bash
grep -E "3\.[23]\.0" package.json src/agent/identity.ts src/public/sw.js
```
Expected:
- `package.json: "version": "3.3.0"`
- `identity.ts: version: '3.3.0',`
- `sw.js: const CACHE = 'zayra-v3.2.0';` (ainda 3.2.0 — será bumpado no último commit do PR1)

- [ ] **Step 4: Commit**

```bash
git add package.json src/agent/identity.ts
git commit -m "chore(v3.3.0): bump package.json and identity.ts to 3.3.0"
```

---

### Task 1.4: Bump do `CACHE` em `sw.js` — ÚLTIMO COMMIT DO PR1

**⚠️ ORDEM CRÍTICA:** Este commit é o ÚLTIMO do PR1. Razão: o bump de CACHE força clients abertos a baixar HTML/CSS novo. Se este commit for antes dos commits 1.1-1.3, clients que abrirem entre commits pegam uma versão inconsistente (CSS novo sem utility classes ainda definidas, ou versão bumpada com SW ainda apontando pra cache antigo).

**Files:**
- Modify: `src/public/sw.js:4`

- [ ] **Step 1: Bumpar constante CACHE**

Editar `src/public/sw.js` linha 4, trocar `const CACHE = 'zayra-v3.2.0';` por `const CACHE = 'zayra-v3.3.0';`.

- [ ] **Step 2: Verificar que SW continua íntegro**

Abrir `src/public/sw.js` e confirmar visualmente que:
- Linha 4: `const CACHE = 'zayra-v3.3.0';`
- Linha 33: ainda tem `.then(() => self.skipWaiting())` no install
- Linha 42: ainda tem `await self.clients.claim();` no activate
- Linha 86-99: ainda tem o bloco network-first para HTML

Nenhum outro código no SW muda. Apenas a constante.

- [ ] **Step 3: Commit**

```bash
git add src/public/sw.js
git commit -m "chore(v3.3.0): bump SW cache to zayra-v3.3.0 (last commit of PR1)"
```

- [ ] **Step 4: Push branch e abrir PR1**

```bash
git push -u origin feat/mobile-foundation-v3.3.0
gh pr create --title "v3.3.0 PR1: Mobile foundation (utility classes + safety net + cache bump)" --body "$(cat <<'EOF'
## Summary
- Adiciona utility classes `.lp-grid-auto`/`.lp-grid-2/3/4/5` para grids responsivos
- Adiciona safety net que força 1-col em qualquer inline grid em viewport ≤768px (opt-out via `data-keep-grid`)
- Bump 3.2.0 → 3.3.0 em package.json, identity.ts e sw.js (CACHE)

**Ordem dos commits crítica:** CACHE bump em sw.js é o ÚLTIMO commit — garante que utility classes + safety net já estão no HTML antes de invalidar cache.

PRs seguintes (PR2 view-by-view refactor, PR3 modais + patches) continuam o trabalho.

Spec: docs/superpowers/specs/2026-05-10-mobile-foundation-design.md

## Test plan
- [x] `npm run typecheck` passa
- [x] Smoke test em 360×800: safety net colapsa grids visivelmente, sem crashes
- [x] Smoke test em desktop: nada quebrou acima do breakpoint

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# PR2 — Refactor View-by-View (uma task por área navegacional)

**Objetivo:** substituir inline grids por utility classes view por view. Tasks **agrupadas por área navegacional** (não por tipo de mudança) — isso permite testar incrementalmente em viewport ao terminar cada task.

**Branch:** continua em `feat/mobile-foundation-v3.3.0` OU abre branch separada `feat/mobile-pr2-views` (governança do CEO decide).

**Tempo estimado:** ~7-10h total. Cada task ~20-45min.

**Padrão de mapeamento (consultar em todas as tasks):**

| Inline atual | Classe |
|---|---|
| `display:grid; grid-template-columns:1fr 1fr` | `class="lp-grid-2"` |
| `display:grid; grid-template-columns:1fr 1fr 1fr` ou `repeat(3,1fr)` | `class="lp-grid-3"` |
| `display:grid; grid-template-columns:repeat(4,1fr)` | `class="lp-grid-4"` |
| `display:grid; grid-template-columns:repeat(5,1fr)` | `class="lp-grid-5"` |
| `display:grid; grid-template-columns:1fr 2fr` (e outros proporcionais) | `class="lp-grid-auto"` |
| `display:grid; grid-template-columns:repeat(auto-fit, minmax(...))` | **MANTER inline** — já é responsivo |
| Calendário, tabelas que devem permanecer grid em mobile | Adicionar `data-keep-grid` ao elemento |

**Preservar:** `gap`, `margin-top`, `margin-bottom`, `align-items`, `padding` e outras propriedades inline que não sejam relacionadas a `grid-template-columns`/`display:grid`. Exemplo de transformação:

Antes:
```html
<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:6px;">
```

Depois:
```html
<div class="lp-grid-2" style="margin-top:6px;">
```

(o `gap:8px` está incluído na classe; outras propriedades inline preservadas)

---

### Task 2.1: Refatorar Painel (área header + cards de obra ativa)

**Files:**
- Modify: `src/public/obras.html` linhas ~1700-1818 (região do Painel — entre header global e `function renderObras()`)

- [ ] **Step 1: Listar inline grids no range 1700-1818**

Run: usar Grep `grid-template-columns` em `obras.html` com `-n` true, filtrar manualmente linhas 1700-1818.

Linhas esperadas (verificar exatamente quais aparecem):
- Linha ~1707: `repeat(auto-fit, minmax(280px, 1fr))` — **MANTER** (já responsivo)

Se não houver outros, esta task é trivial.

- [ ] **Step 2: Aplicar mapeamento (se houver não-auto-fit)**

Para cada grid não-auto-fit encontrado, aplicar a tabela de mapeamento acima.

- [ ] **Step 3: Validar em 360×800 (DOD)**

Chrome DevTools → Device Toolbar → 360×800 → abrir Painel.
- ✅ Cards de obra ativa empilhados verticalmente
- ✅ Sem scroll horizontal
- ✅ Botões com ≥44px de altura tocável

- [ ] **Step 4: Validar em 412×915 (DOD)**

Trocar viewport para 412×915 → repetir checklist do step 3.

- [ ] **Step 5: Validar em desktop 1280×800**

Confirmar que nada quebrou acima do breakpoint.

- [ ] **Step 6: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor Painel view to lp-grid utility classes"
```

---

### Task 2.2: Refatorar `renderObras()` (lista de obras + form)

**Files:**
- Modify: `src/public/obras.html` — função `renderObras()` em ~linha 1819 até início de `renderFinanceiro()` em ~2823

- [ ] **Step 1: Listar inline grids no range 1819-2823**

Run: Grep `grid-template-columns` em `obras.html` filtrando linhas 1819-2823.

- [ ] **Step 2: Aplicar mapeamento conforme tabela**

Para cada grid encontrado, aplicar transformação. Casos especiais:
- Se encontrar `grid-template-columns:repeat(auto-fit, minmax(Npx, 1fr))` com N ≥ 200 → MANTER inline (já é responsivo, e o minmax garante que vira 1-col em mobile naturalmente)
- Se encontrar `1fr 70px 100px 30px` ou similar (tabelas inline) → **NÃO converter** — adicionar `data-keep-grid` SE for legítimo manter grid em mobile, caso contrário deixar a safety net colapsar

- [ ] **Step 3: Validar em 360×800 (DOD)**

DevTools 360×800 → percorrer lista de Obras → criar/editar uma obra → confirmar:
- ✅ Sem scroll horizontal
- ✅ Form de cadastro completável
- ✅ Botões tocáveis

- [ ] **Step 4: Validar em 412×915 (DOD)**

Trocar viewport, repetir.

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderObras to lp-grid utility classes"
```

---

### Task 2.3: Refatorar `renderFinanceiro()`

**Files:**
- Modify: `src/public/obras.html` — `renderFinanceiro()` em ~linha 2824 até início de `renderEquipe()` em ~2951

- [ ] **Step 1: Listar inline grids no range 2824-2951**

Run: Grep filtrando essas linhas.

- [ ] **Step 2: Aplicar mapeamento**

- [ ] **Step 3: Validar em 360×800 (DOD)**

DevTools 360×800 → aba Financeiro → confirmar sem scroll horizontal. Atenção a tabelas/cards de receita/despesa que tendem a ter colunas fixas.

- [ ] **Step 4: Validar em 412×915 (DOD)**

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderFinanceiro to lp-grid utility classes"
```

---

### Task 2.4: Refatorar `renderEquipe()`

**Files:**
- Modify: `src/public/obras.html` — `renderEquipe()` em ~linha 2952 até início de `renderDespesasExtras()` em ~3161

- [ ] **Step 1: Listar inline grids no range 2952-3161**

- [ ] **Step 2: Aplicar mapeamento**

- [ ] **Step 3: Validar em 360×800 (DOD)** — aba Equipe → confirmar listagem de membros legível, ações tocáveis

- [ ] **Step 4: Validar em 412×915 (DOD)**

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderEquipe to lp-grid utility classes"
```

---

### Task 2.5: Refatorar `renderDespesasExtras()`

**Files:**
- Modify: `src/public/obras.html` — `renderDespesasExtras()` em ~linha 3162 até início de `renderMateriais()` em ~3769

- [ ] **Step 1: Listar inline grids no range 3162-3769**

Pelo Grep prévio, sei que linhas 3259, 3465, 3473, 3492, 3534 têm grids. Conferir e mapear cada uma.

Notar especialmente linhas 3492 e 3534 que têm `1fr 70px 100px 30px` — provável tabela inline. Avaliar se deve virar `data-keep-grid` ou deixar a safety net colapsar (decisão depende se a leitura em 1-col faz sentido).

- [ ] **Step 2: Aplicar mapeamento**

- [ ] **Step 3: Validar em 360×800 (DOD)** — aba Despesas Extras → adicionar despesa, listar despesas, confirmar sem scroll horizontal

- [ ] **Step 4: Validar em 412×915 (DOD)**

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderDespesasExtras to lp-grid utility classes"
```

---

### Task 2.6: Refatorar `renderMateriais()`

**Files:**
- Modify: `src/public/obras.html` — `renderMateriais()` em ~linha 3770 até `renderMarcarDias()` em ~3945

- [ ] **Step 1: Listar inline grids no range 3770-3945**
- [ ] **Step 2: Aplicar mapeamento**
- [ ] **Step 3: Validar em 360×800 (DOD)** — aba Materiais
- [ ] **Step 4: Validar em 412×915 (DOD)**
- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderMateriais to lp-grid utility classes"
```

---

### Task 2.7: Refatorar `renderMarcarDias()` + `renderFolha()` + `renderFolhaSaldoHTML()`

**Files:**
- Modify: `src/public/obras.html` — linhas ~3946 a ~4613 (três funções correlatas — agendamento e folha mensal)

- [ ] **Step 1: Listar inline grids no range 3946-4613**

- [ ] **Step 2: Aplicar mapeamento**

⚠️ **Atenção especial ao Calendário:** se houver grid `repeat(7, 1fr)` para dias da semana → **NÃO converter**, **adicionar `data-keep-grid`** ao elemento. Calendário deve permanecer 7 colunas mesmo em mobile (UX padrão de calendário).

- [ ] **Step 3: Validar em 360×800 (DOD)** — Marcar Dias + Folha Mensal → calendário continua 7-col, listas de horários empilhadas

- [ ] **Step 4: Validar em 412×915 (DOD)**

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor MarcarDias/Folha views to lp-grid utility classes"
```

---

### Task 2.8: Refatorar `renderVto()`

**Files:**
- Modify: `src/public/obras.html` — `renderVto()` em ~linha 4614 até `renderPropostasLista()` em ~4935

- [ ] **Step 1: Listar inline grids no range 4614-4935**
- [ ] **Step 2: Aplicar mapeamento**
- [ ] **Step 3: Validar em 360×800 (DOD)** — Vistoria → form de vistoria, checklist, fotos
- [ ] **Step 4: Validar em 412×915 (DOD)**
- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderVto to lp-grid utility classes"
```

---

### Task 2.9: Refatorar `renderPropostasLista()` + `renderPropostaEditor()`

**Files:**
- Modify: `src/public/obras.html` — linhas ~4936 a ~9099 (duas funções grandes do módulo Proposta; ~4000 linhas no total)

⚠️ **Esta é a maior task do PR2.** Considerar dividir em 2 sub-commits: lista primeiro, editor depois.

- [ ] **Step 1a: Listar inline grids no range 4936-7292 (Lista)**

Pelo Grep prévio, sei que há ~10 grids entre 5346 e 5947. Mapear cada.

- [ ] **Step 2a: Aplicar mapeamento (Lista)**

- [ ] **Step 3a: Validar em 360×800 (DOD) - Lista** — abrir aba Propostas, ver lista de propostas existentes

- [ ] **Step 4a: Commit intermediário**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderPropostasLista to lp-grid utility classes"
```

- [ ] **Step 1b: Listar inline grids no range 7293-9099 (Editor)**

Há ~15+ grids entre 7118 e 8058. Mapear cada.

- [ ] **Step 2b: Aplicar mapeamento (Editor)**

- [ ] **Step 3b: Validar em 360×800 (DOD) - Editor** — criar/editar uma proposta, percorrer todas as seções do editor

- [ ] **Step 4b: Validar em 412×915 (DOD) - Editor**

- [ ] **Step 5b: Commit final da task**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderPropostaEditor to lp-grid utility classes"
```

---

### Task 2.10: Refatorar `renderRecibos()`

**Files:**
- Modify: `src/public/obras.html` — `renderRecibos()` em ~linha 9100 até `renderNotas()` em ~10670

- [ ] **Step 1: Listar inline grids no range 9100-10670**

Pelo Grep prévio, sei das linhas 9196, 9521, 9543, 9561, 9572. Mapear.

- [ ] **Step 2: Aplicar mapeamento**

⚠️ Linha 9521 tem `minmax(0, 3fr) minmax(0, 2fr)` — é o split do editor de recibo. Avaliar se em mobile faz sentido empilhar (provavelmente sim — o painel de preview do PDF abaixo do form é mais usável que lado-a-lado em mobile).

- [ ] **Step 3: Validar em 360×800 (DOD)** — aba Recibos → criar recibo, gerar PDF, enviar WhatsApp

- [ ] **Step 4: Validar em 412×915 (DOD)**

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderRecibos to lp-grid utility classes"
```

---

### Task 2.11: Refatorar `renderNotas()`

**Files:**
- Modify: `src/public/obras.html` — `renderNotas()` em ~linha 10671 até `renderCalculos()` em ~11109

- [ ] **Step 1: Listar inline grids no range 10671-11109**
- [ ] **Step 2: Aplicar mapeamento**
- [ ] **Step 3: Validar em 360×800 (DOD)** — aba Notas Fiscais → emitir nota, listar notas
- [ ] **Step 4: Validar em 412×915 (DOD)**
- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderNotas to lp-grid utility classes"
```

---

### Task 2.12: Refatorar `renderCalculos()`

**Files:**
- Modify: `src/public/obras.html` — `renderCalculos()` em ~linha 11110 até `renderLaudoTabCadastros()` em ~14095

⚠️ **Range grande (~3000 linhas)** — pode ter calculadoras múltiplas (ITBI, IPTU, comissão, etc). Considerar dividir em sub-commits por calculadora.

- [ ] **Step 1: Listar inline grids no range 11110-14095**

- [ ] **Step 2: Aplicar mapeamento**

- [ ] **Step 3: Validar em 360×800 (DOD)** — aba Cálculos → percorrer cada calculadora disponível, preencher inputs, verificar resultado

- [ ] **Step 4: Validar em 412×915 (DOD)**

- [ ] **Step 5: Commit (ou múltiplos commits se dividir por calculadora)**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderCalculos to lp-grid utility classes"
```

---

### Task 2.13: Refatorar `renderLaudoTabCadastros()` (aba "Cadastros" do laudo, ≈ Registral do spec)

**Files:**
- Modify: `src/public/obras.html` — `renderLaudoTabCadastros()` em ~linha 14096 até `renderLaudoTabDados()` em ~14361

- [ ] **Step 1: Listar inline grids no range 14096-14361**
- [ ] **Step 2: Aplicar mapeamento**
- [ ] **Step 3: Validar em 360×800 (DOD)** — abrir um laudo → aba Cadastros → preencher campos do cabeçalho/registral
- [ ] **Step 4: Validar em 412×915 (DOD)**
- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor laudo tab Cadastros to lp-grid utility classes"
```

---

### Task 2.14: Refatorar `renderLaudoTabDados()` (aba "Dados" do laudo)

**Files:**
- Modify: `src/public/obras.html` — `renderLaudoTabDados()` em ~linha 14362 até `renderLaudoTabPontos()` em ~14655

⚠️ **Esta é a aba que o CEO mostrou nos screenshots — é o caso de uso primário.** Atenção redobrada à grid de Medida/Confrontante (era a que estava cortando "Confro...").

- [ ] **Step 1: Listar inline grids no range 14362-14655**

- [ ] **Step 2: Aplicar mapeamento**

Especificamente:
- Linha ~15081: `grid-template-columns: 1fr 2fr` (Medida/Confrontante) → `class="lp-grid-auto"` (vai virar 1-col em mobile naturalmente)

- [ ] **Step 3: Validar em 360×800 (DOD)** — abrir laudo → aba Dados → confirmar que **"Confrontante" aparece completo** sem ser cortado, **"Medida (m)" tem largura adequada**

- [ ] **Step 4: Validar em 412×915 (DOD)** — repetir com Pixel 7

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor laudo tab Dados to lp-grid utility classes"
```

---

### Task 2.15: Refatorar `renderLaudoTabPontos()` (aba "Pontos" — vértices e medidas)

**Files:**
- Modify: `src/public/obras.html` — `renderLaudoTabPontos()` em ~linha 14656 até `renderLaudoTabCroqui()` em ~15879

⚠️ **TAMBÉM é uma aba que o CEO usa em campo no rugged GNSS.** Atenção especial ao grid de vértices (linha ~15005):

```html
<div style="display:grid; grid-template-columns: repeat(${cols}, 1fr); gap:6px; margin-top:6px;">
```

Esse `${cols}` é dinâmico (2 ou 3 dependendo de UTM+LatLng). A safety net JÁ vai colapsar isso em mobile (porque é inline). Mesmo assim, vale converter para `class="lp-grid-auto"` (preservando o `gap:6px; margin-top:6px;` inline) para consistência.

- [ ] **Step 1: Listar inline grids no range 14656-15879**

- [ ] **Step 2: Aplicar mapeamento**

Cuidados:
- Grids de pontos UTM/LatLng (vértices) → `class="lp-grid-auto"` (substituir o `repeat(${cols}, 1fr)`)
- Grid Medida/Confrontante por lado → `class="lp-grid-auto"`

- [ ] **Step 3: Validar em 360×800 (DOD)** — abrir laudo → aba Pontos → confirmar que cada ponto (P1, P2, P3, P4) e cada lado (Frente, Lateral Direita, etc) ficam empilhados verticalmente, sem corte

- [ ] **Step 4: Validar em 412×915 (DOD)** — repetir com Pixel 7

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor laudo tab Pontos to lp-grid utility classes"
```

---

### Task 2.16: Refatorar `renderLaudoTabCroqui()`

**Files:**
- Modify: `src/public/obras.html` — `renderLaudoTabCroqui()` em ~linha 15880 até `renderLaudoTabFotos()` em ~15943

- [ ] **Step 1: Listar inline grids no range 15880-15943**
- [ ] **Step 2: Aplicar mapeamento**
- [ ] **Step 3: Validar em 360×800 (DOD)** — aba Croqui → preview do croqui legível, controles tocáveis
- [ ] **Step 4: Validar em 412×915 (DOD)**
- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor laudo tab Croqui to lp-grid utility classes"
```

---

### Task 2.17: Refatorar `renderLaudoTabFotos()`

**Files:**
- Modify: `src/public/obras.html` — `renderLaudoTabFotos()` em ~linha 15944 até `renderLaudoTabArt()` em ~16079

- [ ] **Step 1: Listar inline grids no range 15944-16079**

- [ ] **Step 2: Aplicar mapeamento**

Atenção: galeria de fotos provavelmente usa `repeat(auto-fit, minmax(150px, 1fr))` ou similar — MANTER se for o caso.

- [ ] **Step 3: Validar em 360×800 (DOD)** — aba Fotos → upload, galeria, edição de legenda

- [ ] **Step 4: Validar em 412×915 (DOD)**

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor laudo tab Fotos to lp-grid utility classes"
```

---

### Task 2.18: Refatorar `renderLaudoTabArt()` (aba ART + Precificação INCRA + Assinatura)

**Files:**
- Modify: `src/public/obras.html` — `renderLaudoTabArt()` em ~linha 16080 até `renderLoteamentos()` em ~16434

⚠️ Esta aba contém o bloco grande de Precificação INCRA (v3.0.0) + ART/TRT + Responsabilidade Técnica + Assinatura. Atenção a:
- 6 steppers de critérios INCRA — provavelmente `grid-template-columns:repeat(6,1fr)` ou similar
- Bloco "Valor aplicado" + "Desconto" + "VALOR FINAL"
- Caixa de assinatura

- [ ] **Step 1: Listar inline grids no range 16080-16434**

- [ ] **Step 2: Aplicar mapeamento**

- [ ] **Step 3: Validar em 360×800 (DOD)** — aba ART → preencher critérios INCRA, ver valor calculado, área de assinatura tocável

- [ ] **Step 4: Validar em 412×915 (DOD)**

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor laudo tab Art to lp-grid utility classes"
```

---

### Task 2.19: Refatorar `renderLoteamentos()`

**Files:**
- Modify: `src/public/obras.html` — `renderLoteamentos()` em ~linha 16435 até fim do bloco de funções de render

- [ ] **Step 1: Listar inline grids no range 16435-EOF (das funções de render)**

- [ ] **Step 2: Aplicar mapeamento**

⚠️ Loteamentos tem autocompletes encadeados (Loteamento→Quadra→Lote). Verificar se grids do autocomplete são `repeat(auto-fit, minmax(...))` (manter) ou fixos.

- [ ] **Step 3: Validar em 360×800 (DOD)** — aba Loteamentos → autocomplete Loteamento → Quadra → Lote → preencher dados de lote

- [ ] **Step 4: Validar em 412×915 (DOD)**

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor renderLoteamentos to lp-grid utility classes"
```

---

### Task 2.20: Push PR2

- [ ] **Step 1: Conferir que todas as 19 tasks acima estão concluídas e validadas**

Rodar checagem manual: `git log --oneline feat/mobile-foundation-v3.3.0..HEAD` — deve listar ~19 commits de refactor (mais os 4 do PR1 se PR2 está na mesma branch).

- [ ] **Step 2: QA spot-check em 360×800 e 412×915 — viewport mobile primário**

Abrir cada view (Painel, Obras, Financeiro, Equipe, Despesas, Materiais, MarcarDias, Folha, Vto, Propostas, Recibos, Notas, Calculos, Laudo todas abas, Loteamentos) em 360×800 → confirmar **nenhuma** tem scroll horizontal.

- [ ] **Step 3: Push e abrir PR2**

```bash
git push origin feat/mobile-foundation-v3.3.0
gh pr create --title "v3.3.0 PR2: Refactor view-by-view (inline grids → lp-grid classes)" --body "$(cat <<'EOF'
## Summary
Substitui inline grids (`style="display:grid; grid-template-columns: ..."`) por utility classes (`class="lp-grid-X"`) em todas as 17+ views principais.

Tasks executadas (uma por área navegacional, conforme governança):
- Painel, Obras, Financeiro, Equipe, Despesas Extras, Materiais
- Marcar Dias + Folha, Vto
- Propostas (Lista + Editor)
- Recibos, Notas, Cálculos
- Laudo: Cadastros, Dados, Pontos, Croqui, Fotos, Art
- Loteamentos

Cada commit corresponde a uma view completa — permite rollback granular se necessário.

## Test plan
Validado em 360×800 (Galaxy A baseline) e 412×915 (Pixel 7) para CADA view:
- [x] Sem scroll horizontal
- [x] Botões tocáveis ≥44px
- [x] Formulários completam normalmente
- [x] Nada quebrou em desktop 1280×800

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# PR3 — Modais + Patches Secundários

**Objetivo:** fechar gaps remanescentes — modais (que muitas vezes têm CSS isolado), inputs/botões com problemas específicos, tabelas problemáticas.

**Tempo estimado:** ~2-3h

---

### Task 3.1: Refatorar modal "Editar Obra" (`#editModal`)

**Files:**
- Modify: `src/public/obras.html` — bloco do `#editModal` em ~linha 687-855

- [ ] **Step 1: Listar inline grids no range 687-855**

Já sei que linha 864 tem `<div style="display:grid; grid-template-columns:1fr 2fr; gap:10px;">` — converter para `class="lp-grid-auto"`.

- [ ] **Step 2: Aplicar mapeamento**

- [ ] **Step 3: Validar em 360×800 (DOD)** — clicar em editar uma obra → modal abre, form usável

- [ ] **Step 4: Validar em 412×915 (DOD)**

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor modal Editar Obra to lp-grid utility classes"
```

---

### Task 3.2: Refatorar modal Calendário (`.cal-modal`) — com `data-keep-grid`

**Files:**
- Modify: `src/public/obras.html` — bloco do calendário, especialmente `<div class="cal-grid">` em região ~242-249 (CSS) e ~3946+ (uso)

- [ ] **Step 1: Verificar onde o `.cal-grid` é renderizado e adicionar `data-keep-grid`**

Localizar o elemento `<div class="cal-grid">` (provavelmente dentro de `renderMarcarDias()` ou função do calendário).

Adicionar atributo `data-keep-grid`:
```html
<div class="cal-grid" data-keep-grid>
```

⚠️ A classe `.cal-grid` já define `grid-template-columns: repeat(7, ...)` no CSS global (linha 243) — não é inline. Mas a safety net não atinge classes do CSS global, apenas inline. Então o `data-keep-grid` aqui é DEFENSIVO — caso alguém futuramente migre essa classe para inline ou adicione inline override.

**Alternativa:** adicionar regra explícita no CSS para manter o calendário em 7 colunas mesmo em mobile (mais robusta):

```css
@media (max-width: 768px) {
  .cal-grid { grid-template-columns: repeat(7, minmax(0, 1fr)) !important; }
}
```

Adicionar isso no `<style>` global, no bloco `@media (max-width: 768px)` existente perto da linha 327.

- [ ] **Step 2: Validar em 360×800 (DOD)** — abrir calendário → confirmar 7 colunas de dias da semana mantidas, dias clicáveis tocáveis (≥44px)

- [ ] **Step 3: Validar em 412×915 (DOD)**

- [ ] **Step 4: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): preserve calendar 7-col grid in mobile via explicit rule"
```

---

### Task 3.3: Refatorar modal Cartão de Visitas (`#cartaoModal` ou similar)

**Files:**
- Modify: `src/public/obras.html` — bloco do cartão (procurar por "cartao" ou `Z-CARD`)

- [ ] **Step 1: Localizar bloco do cartão**

Run: Grep `data-cartao|cartaoModal|#cartao` em `obras.html`.

- [ ] **Step 2: Listar inline grids no bloco encontrado**

- [ ] **Step 3: Aplicar mapeamento**

- [ ] **Step 4: Validar em 360×800 (DOD)** — abrir modal cartão → preview do cartão legível, form usável

- [ ] **Step 5: Validar em 412×915 (DOD)**

- [ ] **Step 6: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor cartao modal to lp-grid utility classes"
```

---

### Task 3.4: Refatorar painel ZAYRA chat (`.zayra-modal`)

**Files:**
- Modify: `src/public/obras.html` — bloco do chat ZAYRA em ~linha 175-212 (CSS) e em qualquer uso inline

- [ ] **Step 1: Verificar CSS já existente do `.zayra-modal`**

Já tem `@media (max-width: 600px)` na linha 172 que ajusta o `.zayra-cam-fab`. Conferir se o `.zayra-modal` também tem ajuste mobile (parece ter na linha 396 `.zayra-modal { bottom: 80px; right: 16px; left: 16px; max-height: 60vh; }`).

- [ ] **Step 2: Listar inline grids dentro do modal ZAYRA (se houver)**

Run: Grep dentro do bloco do chat.

- [ ] **Step 3: Aplicar mapeamento (se houver)**

- [ ] **Step 4: Validar em 360×800 (DOD)** — clicar no FAB ZAYRA → modal abre, input acessível com teclado mobile

- [ ] **Step 5: Validar em 412×915 (DOD)**

- [ ] **Step 6: Commit (se houver mudança)**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor ZAYRA chat modal to lp-grid utility classes"
```

---

### Task 3.5: Refatorar autocomplete cartórios (v3.2.0)

**Files:**
- Modify: `src/public/obras.html` — dropdown do autocomplete cartórios em `setupCartorioAutocomplete()`

- [ ] **Step 1: Localizar dropdown do autocomplete**

Run: Grep `setupCartorioAutocomplete|ld-cartorio-sugestoes` em `obras.html`.

- [ ] **Step 2: Verificar layout dos itens do dropdown**

Cada item provavelmente tem `denominação + cidade/UF + CNS + responsável` — verificar se está usando inline grid ou flex column.

- [ ] **Step 3: Aplicar mapeamento se necessário**

- [ ] **Step 4: Validar em 360×800 (DOD)** — abrir laudo → campo Cartório → digitar 3+ letras → dropdown abre, itens legíveis, clicáveis

- [ ] **Step 5: Validar em 412×915 (DOD)**

- [ ] **Step 6: Commit (se houver mudança)**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): adjust cartorio autocomplete dropdown for mobile"
```

---

### Task 3.6: Refatorar modal de Clonagem de Laudo (v3.1.0)

**Files:**
- Modify: `src/public/obras.html` — bloco do modal de clonagem (procurar por "clonar" ou "clonagem")

- [ ] **Step 1: Localizar modal de clonagem**

Run: Grep `clonar|clonagem|data-clone` em `obras.html`.

- [ ] **Step 2: Listar inline grids no bloco**

- [ ] **Step 3: Aplicar mapeamento**

- [ ] **Step 4: Validar em 360×800 (DOD)** — abrir laudo → clonar → modal/fluxo de clonagem usável

- [ ] **Step 5: Validar em 412×915 (DOD)**

- [ ] **Step 6: Commit (se houver mudança)**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): refactor laudo clone modal to lp-grid utility classes"
```

---

### Task 3.7: Fix inputs com `width: 170px` (e similares)

**Files:**
- Modify: `src/public/obras.html` — qualquer inline `style="width: 170px"`, `width: 200px`, etc

- [ ] **Step 1: Listar todos os inputs com width fixo**

Run: Grep `style="[^"]*width: ?[0-9]+px` em `obras.html` (sem `max-`).

Notar: a regra de não confundir com `max-width: 170px` (que já está OK).

- [ ] **Step 2: Para cada um, decidir se converter**

Critério:
- ✅ Converter se for input/select de form (largura inadequada em mobile)
- ❌ NÃO converter se for ícone fixo, imagem com dimensão exata, ou contexto onde 170px é OK

Conversão:
```html
<!-- Antes -->
<input style="width: 170px">
<!-- Depois -->
<input style="width: 100%; max-width: 170px">
```

- [ ] **Step 3: Validar em 360×800 (DOD)** — inputs convertidos esticam até o pai sem ultrapassar 170px no desktop

- [ ] **Step 4: Validar em desktop 1280×800** — inputs convertidos continuam aparentando 170px (porque o pai é mais largo)

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): convert fixed-width inputs to width:100%/max-width pattern"
```

---

### Task 3.8: Fix botões com padding < 44px

**Files:**
- Modify: `src/public/obras.html` — botões com `padding: 2px 8px`, `padding: 3px 6px`, etc

- [ ] **Step 1: Listar botões com padding pequeno**

Run: Grep `<button[^>]*style="[^"]*padding: ?[12345]px` em `obras.html`.

- [ ] **Step 2: Avaliar cada um**

Botões inline com padding pequeno tendem a ser ações secundárias (lixeira, fechar, ícone). A regra global `@media (max-width: 768px) { button { min-height: 44px } }` já força 44px mesmo com padding pequeno — então essa task pode ser **bem pequena ou nula** se a regra global está pegando todos.

**Verificar primeiro no DevTools 360×800:** se algum botão visualmente está < 44px de altura, INVESTIGAR por que a regra global não está pegando (provavelmente specificity de inline `min-height` ou similar).

- [ ] **Step 3: Aplicar fix nos casos identificados**

- [ ] **Step 4: Validar em 360×800 (DOD)** — todos os botões da app tocáveis (44×44px mínimo)

- [ ] **Step 5: Commit (se houver mudança)**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): ensure all buttons reach 44px touch target"
```

---

### Task 3.9: Fix tabelas que extrapolam viewport

**Files:**
- Modify: `src/public/obras.html` — `<table>` que estouram em mobile

- [ ] **Step 1: Identificar tabelas problemáticas**

Run: Grep `<table` em `obras.html`. Pra cada uma encontrada, conferir em DevTools 360×800 se causa scroll horizontal.

- [ ] **Step 2: Para cada tabela problemática, envolver em wrapper**

```html
<!-- Antes -->
<table>...</table>

<!-- Depois -->
<div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
  <table>...</table>
</div>
```

Já existe regra `@media (max-width:768px) { .card table, .cal-modal table { font-size: 11px; }` (linha 422) que reduz tamanho da fonte. O wrapper de overflow é complementar — garante que o usuário pode rolar horizontalmente DENTRO da tabela sem afetar o resto da página.

- [ ] **Step 3: Validar em 360×800 (DOD)** — cada tabela acessível, sem fazer a página inteira rolar horizontal

- [ ] **Step 4: Validar em 412×915 (DOD)**

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(mobile): wrap wide tables in overflow-x scroll containers"
```

---

### Task 3.10: QA completo final + push PR3

- [ ] **Step 1: Roteiro completo de QA em 7 viewports**

Abrir Chrome DevTools → Device Toolbar. Para cada viewport abaixo, percorrer o roteiro completo:

| Viewport | Modo |
|---|---|
| 360 × 800 | Portrait |
| 412 × 915 | Portrait |
| 414 × 896 | Portrait |
| 768 × 1024 | Portrait (breakpoint exato) |
| 915 × 412 | **Landscape** |
| 1024 × 600 | **Landscape** |
| 1280 × 800 | Desktop |

Roteiro em cada viewport:
1. Login + Painel
2. Lista de Obras → criar obra
3. Despesas Extras + Materiais
4. Financeiro
5. Recibos → criar recibo → gerar PDF
6. Notas Fiscais
7. Equipe + Folha
8. Cálculos
9. **Laudo completo:** criar → preencher Cadastros, Dados, Pontos, Croqui, Fotos, ART → clonar → gerar PDF
10. Loteamentos: autocomplete encadeado
11. Modais: editar obra, calendário, cartão, ZAYRA chat, autocomplete cartórios

Checklist por viewport (marcar):
- [ ] 360 × 800 OK
- [ ] 412 × 915 OK
- [ ] 414 × 896 OK
- [ ] 768 × 1024 OK
- [ ] 915 × 412 (landscape) OK
- [ ] 1024 × 600 (landscape) OK
- [ ] 1280 × 800 (desktop) OK

- [ ] **Step 2: Push branch e abrir PR3**

```bash
git push origin feat/mobile-foundation-v3.3.0
gh pr create --title "v3.3.0 PR3: Modais + patches secundários (inputs/botões/tabelas)" --body "$(cat <<'EOF'
## Summary
Finaliza v3.3.0 com:
- Modais: Editar Obra, Calendário (preservado 7-col com regra explícita), Cartão, ZAYRA chat, Autocomplete cartórios, Clonagem de laudo
- Inputs com `width:170px` fixo → `width:100%; max-width:170px`
- Botões com padding < 44px → ajustados para target tátil
- Tabelas problemáticas → wrapper com `overflow-x: auto`

QA completo em 7 viewports (incluindo 2 landscape).

## Test plan
- [x] 360×800 OK em todas as views
- [x] 412×915 OK em todas as views
- [x] 414×896 OK em todas as views
- [x] 768×1024 OK (transição do breakpoint)
- [x] 915×412 landscape OK
- [x] 1024×600 landscape OK
- [x] 1280×800 desktop sem regressão

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# Pós-Merge — Validação em Campo (Métrica de Sucesso da v3.3.0)

**Após mergear PR3:**

- [ ] **Step 1: Confirmar deploy do Railway**

Verificar no painel do Railway que v3.3.0 fez deploy com sucesso. Conferir logs:
- ✅ `ZAYRA v3.3.0 rodando`
- ✅ Cache do SW rotacionou para `zayra-v3.3.0`

- [ ] **Step 2: Validação com técnico em campo**

Pedir pro técnico (ou o próprio CEO) abrir o app no rugged GNSS / celular pessoal e executar:

1. Login
2. Selecionar uma obra
3. Abrir laudo → preencher Dados → Pontos → tirar foto → assinar
4. Gerar PDF do laudo
5. Enviar via WhatsApp

Checklist da métrica de sucesso (do spec):
- [ ] Executou fluxo completo de laudo sem scroll horizontal?
- [ ] Tocou todos os botões de primeira (sem dedo escorregar)?
- [ ] Carrossel de fotos navegável?
- [ ] Inputs aceitam teclado mobile sem travar?

**Se sim para todas → v3.3.0 está pronta, atualizar changelog Obsidian.**
**Se aparecerem regressões → criar branch `fix/mobile-v3.3.1` e patchear imediato.**

- [ ] **Step 3: Atualizar changelog Obsidian (memória do projeto)**

Criar arquivo `06-Changelog/v3.3.0-mobile-foundation.md` no vault Obsidian (mesma estrutura dos changelogs anteriores como v3.0.0-precificacao-incra.md e v3.2.0-cartorios-nacional.md).
