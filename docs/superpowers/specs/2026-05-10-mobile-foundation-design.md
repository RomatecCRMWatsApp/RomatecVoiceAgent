# v3.3.0 — Mobile Foundation (Responsividade do `obras.html`)

**Data:** 2026-05-10
**Tipo:** Feature aditiva (sem breaking changes)
**Escopo:** `src/public/obras.html` apenas (frontend, zero backend)
**Bump de versão:** 3.2.0 → 3.3.0 (minor)

---

## 1. Contexto e Motivação

O `src/public/obras.html` (~16k linhas) acumulou ao longo do tempo muitos grids inline (`style="display:grid; grid-template-columns: ..."`) que **não respeitam viewports mobile**. Em telas de 360-414px (celulares dos técnicos em campo, incluindo aparelhos rugged GNSS), o conteúdo extrapola horizontalmente, força scroll lateral e quebra a UX de campo.

**Tipologia do problema identificado:**
- Grids inline com 2-5 colunas que não colapsam em mobile
- Formulários com proporções `1fr 2fr` que apertam o segundo campo
- Inputs com `width: 170px` fixo (em vez de `max-width: 170px`)
- Botões com `padding: 2px 8px` que driblam a regra global de `min-height: 44px`
- Modais que extrapolam viewport

**Constatação que motivou o trabalho:** screenshot do CEO em campo, aparelho rugged GNSS abrindo o painel via Chrome PWA — coluna "Confrontante" cortada em "Confro…", impossibilitando leitura do conteúdo durante demarcação real.

**Objetivo:** estabelecer uma **fundação responsiva** (CSS utility classes + safety net) que resolva o problema sistemicamente, sem precisar varrer 16k linhas de uma vez. A safety net garante que mesmo grids não-migrados se comportem em mobile.

---

## 2. Arquitetura em 3 Camadas

A estratégia é **progressiva**: cada camada já entrega valor sozinha, e camadas seguintes potencializam as anteriores.

### Camada 1 — Utility classes (CSS foundation)

Adicionar no `<style>` global do `obras.html` 5 classes utilitárias responsivas:

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

/* Mobile (≤768px): todos colapsam para 1 coluna */
@media (max-width: 768px) {
  .lp-grid-auto,
  .lp-grid-2,
  .lp-grid-3,
  .lp-grid-4,
  .lp-grid-5 {
    grid-template-columns: 1fr;
  }
}

/* Tablet pequeno (769-900px): grids de 4 e 5 colapsam para 2 colunas
   (transição suave — evita quebra abrupta) */
@media (max-width: 900px) and (min-width: 769px) {
  .lp-grid-4, .lp-grid-5 {
    grid-template-columns: 1fr 1fr;
  }
}
```

**Notas de design:**
- `minmax(140px, 1fr)` (em vez de 160px) é mais permissivo, evita órfãos em viewports intermediários
- `.lp-grid-4` / `.lp-grid-5` explícitas para painéis de estatísticas e dashboards
- Faixa 769-900px evita salto brusco de 4-col → 1-col em tablets

### Camada 2 — Refactor de inline grids (incremental, view-by-view)

Substituir progressivamente `style="display:grid; grid-template-columns: ..."` por `class="lp-grid-X"`. **Mapeamento de padrões:**

| Padrão inline atual | Classe equivalente |
|---|---|
| `repeat(2, 1fr)` ou `1fr 1fr` | `.lp-grid-2` |
| `repeat(3, 1fr)` ou `1fr 1fr 1fr` | `.lp-grid-3` |
| `repeat(4, 1fr)` | `.lp-grid-4` |
| `repeat(5, 1fr)` | `.lp-grid-5` |
| `1fr 2fr`, `2fr 1fr`, `1fr 1fr 2fr` (proporcionais) | `.lp-grid-auto` (uniformiza) |
| `repeat(auto-fit, minmax(...))` (já responsivo) | Manter inline (já está OK) |

**Casos especiais — NÃO converter:**
Grids legítimos que devem permanecer multi-coluna mesmo em mobile:
- Calendário mensal (7 colunas fixas)
- Tabelas de horários
- Qualquer grid onde a versão 1-coluna **piora** a UX

Marcar esses com atributo `data-keep-grid` (ver Camada 3).

### Camada 3 — Safety net (catch-all)

Regra global de defesa para qualquer inline grid que sobre após o refactor ou apareça no futuro:

```css
@media (max-width: 768px) {
  /* Catch-all: força 1 coluna em qualquer elemento com inline grid,
     EXCETO os marcados explicitamente como "manter grid em mobile". */
  [style*="grid-template-columns"]:not([data-keep-grid]) {
    grid-template-columns: 1fr !important;
  }
}
```

**Opt-out explícito** via `data-keep-grid`:
```html
<div data-keep-grid style="display:grid; grid-template-columns: repeat(7, 1fr)">
  <!-- Calendário mensal, 7 colunas fixas mesmo em mobile -->
</div>
```

**Por que `!important` é justificado:** inline style sobrescreve qualquer CSS externo SEM `!important`. Como a safety net é a última linha de defesa para HTML que ainda não foi migrado, ela precisa ganhar do inline.

---

## 3. Patches Secundários (não-grid)

Detectados na auditoria, aplicar conforme aparecerem durante o refactor da Camada 2:

### Inputs com largura fixa
- ❌ `style="width: 170px"` — quebra em viewport menor que 170px
- ✅ `style="width: 100%; max-width: 170px"` — desktop fica 170px, mobile estica
- 🔍 Se já estiver `max-width: 170px` (sem `width` fixo): está OK, não mexer

### Botões fora do padrão tátil
- ❌ `style="padding: 2px 8px"` (ou similar < 4px vertical) — driblam regra global de `min-height: 44px` (Material Design / iOS HIG)
- ✅ `style="padding: 8px 12px; min-height: 44px"` — atinge target tátil mínimo

### Tabelas que extrapolam viewport
Wrapper com scroll horizontal:
```html
<div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">
  <table>...</table>
</div>
```

---

## 4. Service Worker (`sw.js`)

**O SW atual (v3.2.0) já está corretamente configurado** para esta feature. Confirmação de funcionalidades existentes em `src/public/sw.js`:

| Funcionalidade | Status | Linha (aprox) |
|---|---|---|
| Network-first para HTML | ✅ já existe | 86-99 |
| `skipWaiting()` no install | ✅ já existe | 33 |
| `clients.claim()` no activate | ✅ já existe | 42 |
| Cleanup de caches antigos | ✅ já existe | 41 |
| Broadcast `SW_UPDATED` aos clients | ✅ já existe | 46-48 |
| Suporte a `SKIP_WAITING` postMessage | ✅ já existe | 121 |

**Ação única no SW para v3.3.0:**

```javascript
// src/public/sw.js, linha 4
const CACHE = 'zayra-v3.3.0';  // bump de v3.2.0
```

Isso é tudo. O versionamento do cache garante rotação automática em todos os clients — o resto da máquina (network-first, claim, cleanup) já está em produção e validada nos ciclos v3.0-v3.2.

---

## 5. Escopo de Mudanças

**Apenas `src/public/obras.html`** + bump em `sw.js`/`package.json`/`identity.ts`. **Zero backend.**

### Vistas principais a auditar e refatorar:
- [ ] Painel
- [ ] Obras (lista + form de cadastro/edição)
- [ ] Despesas Extras
- [ ] Materiais
- [ ] Financeiro
- [ ] Recibos
- [ ] Notas Fiscais
- [ ] Equipe
- [ ] Marcar Dias
- [ ] Folha Mensal
- [ ] Vistoria (VTO)

### Submódulos do Laudo de Demarcação (6 abas):
- [ ] Aba Dados
- [ ] Aba Registral
- [ ] Aba Croqui
- [ ] Aba ART
- [ ] Aba Fotos
- [ ] Aba Assinatura

### Outros módulos:
- [ ] Loteamentos (autocomplete, dropdowns encadeados)
- [ ] Proposta
- [ ] Cálculos

### Modais:
- [ ] Calendário (manter com `data-keep-grid`)
- [ ] Editar Obra
- [ ] Cartão (cadastro/edição)
- [ ] ZAYRA chat
- [ ] Autocomplete cartórios (integração CNJ da v3.2.0)
- [ ] Confirmação genérica (delete, etc)
- [ ] Modal de clonagem de laudo (v3.1.0)

---

## 6. Estratégia de Deploy — 3 PRs Independentes

Mudança grande em arquivo de 16k linhas. Dividir em 3 PRs sequenciais e independentes:

### PR1 — Foundation (~30min, baixo risco)
- Adicionar Camada 1 (utility classes) no `<style>` global
- Adicionar Camada 3 (safety net com `:not([data-keep-grid])`)
- Bump SW: `CACHE = 'zayra-v3.3.0'`
- Bump versão: `package.json` + `identity.ts` para 3.3.0
- Smoke test em 1 viewport mobile (360×800) só confirmando que nada quebrou

**Por que isolar:** se aparecer regressão em campo após PR1, o SW novo + safety net já protegem enquanto investiga. PRs grandes ficam reféns de rollback completa.

### PR2 — Refactor de vistas + laudo (~7-10h)
- 11 vistas principais
- 6 abas do laudo + modal de clonagem
- Loteamentos + Proposta + Cálculos

### PR3 — Modais + patches secundários (~2-3h)
- Modais (calendário, editar obra, cartão, ZAYRA, autocomplete cartórios, confirmação)
- Inputs com `width` fixo → trocar para `width: 100%; max-width: ...`
- Botões com padding < 44px → ajustar para target tátil
- Tabelas problemáticas → wrapper com `overflow-x: auto`

---

## 7. Validação Manual (Sem Testes Automatizados)

**ROI baixo** em snapshot tests, **zero** em unit tests para layout responsivo. Validação 100% manual via Chrome DevTools.

### Viewports obrigatórios (portrait):

| Viewport | Por que testar |
|---|---|
| **360 × 800** | Android baratos (Galaxy A-series) — base instalada brasileira |
| **412 × 915** | Pixel 7 (referência mobile moderna) |
| **414 × 896** | iPhone 11 (referência iOS) |
| **768 × 1024** | iPad mini — confirmar transição exata no breakpoint |
| **1024 × 768+** | Desktop — confirmar que nada quebra acima do breakpoint |

### Viewports landscape (ponto cego clássico):

| Viewport | Por que testar |
|---|---|
| **915 × 412** | Pixel 7 deitado — técnico vira o celular para coordenadas |
| **1024 × 600** | Tablet barato em modo paisagem |

> **Observação:** em landscape 915×412 o layout cai no modo desktop (915 > 768). Confirmar que essa transição faz sentido na UX, especialmente nas telas do laudo onde mais espaço horizontal é útil.

### Roteiro de teste em cada viewport:

1. Login + Painel — sem scroll horizontal
2. Listar Obras — cards legíveis, ações tocáveis
3. Cadastrar Obra — formulário usável
4. Despesas Extras + Materiais + Financeiro — grids responsivos
5. Equipe + Folha Mensal — listagens não quebram
6. **Laudo de Demarcação (ciclo completo):**
   - Criar laudo novo
   - Preencher Dados → Registral → Croqui → ART → Fotos → Assinatura
   - Clonar (testar v3.1.0)
   - Gerar PDF
   - Enviar WhatsApp
7. Loteamentos — autocomplete + dropdowns encadeados
8. Modais — abrir cada, fechar com X e clique fora
9. ZAYRA chat — janela responsiva, input com teclado mobile aberto

### Checklist por tela:
- [ ] Sem scroll horizontal
- [ ] Botões com target tátil ≥44×44px
- [ ] Texto legível (≥14px body, 16px em inputs para evitar zoom do iOS)
- [ ] Formulários completam sem dificuldade
- [ ] Modais não extrapolam viewport
- [ ] Tabelas com `overflow-x` quando necessário

---

## 8. Cuidados Importantes

### 8.1 `data-keep-grid` é uma TODO list embutida
Durante o refactor, se encontrar um inline grid que não tem tempo/contexto pra converter, **marca com `data-keep-grid` SOMENTE se ele realmente deve ficar multi-coluna em mobile**. Caso contrário, deixa sem o atributo — a safety net força 1 coluna até alguém converter para classe utility depois.

### 8.2 NÃO usar `data-keep-grid` como "deixa pra depois"
Se um grid **deveria** virar 1 coluna em mobile mas não foi convertido ainda → **deixar sem `data-keep-grid`**. A safety net cobre. O atributo é apenas para casos legítimos (calendário, tabelas compactas que precisam manter formato).

### 8.3 Service Worker pode levar 1 reload pra atualizar
Mesmo com `skipWaiting()`, alguns navegadores precisam de 1 reload completo pra ativar o SW novo. **Avisar os técnicos:** "Após o deploy, feche e abra o app uma vez". O `SW_UPDATED` postMessage do SW atual já permite mostrar toast no front (já implementado).

### 8.4 PDF templates ficam intocados (nota arquitetural)
**Estado atual:** Os PDFs do laudo, recibo, etc são gerados server-side via PDFKit em `src/services/laudoPdf.ts` e similares. Os templates HTML inline em `obras.html` (linha 2092+ etc) que parecem "modelos de PDF" são na verdade páginas standalone que renderizam em janela separada com `<style>` próprio dentro de template string — **não são alcançados pelo CSS global** do `obras.html` nem pelas regras `@media` adicionadas em v3.3.0.

**Sem ação necessária agora.** Nota para o futuro: se alguém migrar geração de PDF para renderização inline (com html2canvas, jsPDF, etc), precisa lembrar que as regras de v3.3.0 vão aplicar — provavelmente OK, mas conferir.

### 8.5 Breakpoint 768px não muda
Padrão de facto (Bootstrap, Tailwind `md:`, Material Design). Mudar agora cria inconsistência futura. Se precisar de breakpoint adicional (ex: 1024px para tablets grandes), **adicionar** em vez de substituir.

### 8.6 Bilateral PR review obrigatório
Mudança em arquivo de 16k linhas exige branch + PR + review explícito antes de merge. **Não fazer push direto pra main.** Já refletido na estratégia de 3 PRs (seção 6).

---

## 9. Versionamento

```
package.json:    3.2.0 → 3.3.0
identity.ts:     bump correspondente
sw.js:           CACHE: 'zayra-v3.2.0' → 'zayra-v3.3.0'
```

**Tipo de bump:** minor (3.x.0). Feature aditiva sem breaking changes. Inline grids existentes continuam funcionando — refactor da Camada 2 é progressivo e a safety net captura qualquer um que sobre.

---

## 10. Critérios de Aceite

- [ ] Utility classes `.lp-grid-auto`, `.lp-grid-2/3/4/5` definidas no `<style>` global
- [ ] Safety net `[style*="grid-template-columns"]:not([data-keep-grid])` ativa em ≤768px
- [ ] Faixa de transição 769-900px para `.lp-grid-4` e `.lp-grid-5` (2 colunas)
- [ ] `sw.js` com `CACHE = 'zayra-v3.3.0'`
- [ ] `package.json`, `identity.ts` em 3.3.0
- [ ] 11 vistas principais auditadas e refatoradas
- [ ] 6 abas do laudo + Loteamentos + Proposta + Cálculos refatorados
- [ ] Modais responsivos em todos os 7 viewports testados
- [ ] Sem scroll horizontal em nenhuma tela em viewports 360-768px
- [ ] Botões com target tátil ≥44×44px
- [ ] Inputs com largura fixa convertidos para `width:100%; max-width:Xpx`
- [ ] Tabelas problemáticas com wrapper `overflow-x: auto`
- [ ] PDF do laudo inalterado (templates standalone preservados)
- [ ] 3 PRs criados, revisados e mergeados em sequência

---

## 11. Métrica de Sucesso

Após deploy completo (3 PRs mergeados), validar com 1 técnico em campo real:

- Consegue executar fluxo completo de laudo em celular sem scroll horizontal?
- Consegue tocar todos os botões de primeira (sem dedo escorregar)?
- Carrossel de fotos é navegável?
- Inputs aceitam teclado mobile sem travar?

**Se sim para todas → v3.3.0 está pronta.**
**Se aparecerem regressões → patch v3.3.1 imediato.**

---

## 12. Próximos Passos (pós-v3.3.0)

Fora do escopo desta versão, mas habilitados por ela:

- **v3.4.0+** — usar classes `.lp-grid-*` em features novas como padrão (sem inline grid)
- **Eventual** — extrair `<style>` global pra arquivo CSS dedicado se passar de ~500 linhas (hoje está OK inline)
- **Eventual** — considerar PWA install prompt customizado (botão "Instalar app") em vez de depender do menu nativo do Chrome
