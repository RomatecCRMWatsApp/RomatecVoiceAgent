# Laudo de Demarcação v3.5.0 — BCI + Modal PDF + Telegram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar 3 features ao módulo de Laudo de Demarcação: 14 campos BCI opcionais (Prefeitura), modal fullscreen do PDF Assinado com 3 ações, envio via Telegram.

**Architecture:** Schema expandido (14 colunas `bci_*` em `laudos_demarcacao`); CRUD propagado em `laudos.ts`; novo bloco condicional no PDF; função `enviarLaudoTelegram` replicando padrão de `enviarVistoriaTelegram`; UI com card colapsável + modal fullscreen + botão paralelo ao WhatsApp.

**Tech Stack:** Node + TypeScript + Express + MySQL2 (raw pool), PDFKit, vanilla JS em `obras.html`, Telegram via `src/integrations/telegram.ts`.

**Branch:** `feat/laudo-bci-modal-telegram-v3.5.0` a partir de `main` atualizado.

**Spec:** [docs/superpowers/specs/2026-05-11-laudo-bci-modal-telegram-design.md](../specs/2026-05-11-laudo-bci-modal-telegram-design.md)

**DOD universal por commit:**
- `npm run typecheck` verde.
- Para tasks de UI: validação visual em viewports 360x800 e 412x915 sem scroll horizontal.

**Commits do PR (9 commits):**

1. feat: migration 14 colunas BCI em laudos_demarcacao
2. feat: tipos + CRUD para BCI em laudos.ts
3. feat: seção 'Dados do BCI' no PDF de laudo
4. feat: backend enviarLaudoTelegram + endpoint /enviar-telegram
5. feat: UI card BCI colapsável com persistência localStorage
6. feat: modal fullscreen do PDF Assinado com Baixar/Telegram/WhatsApp
7. feat: botão Telegram no card do laudo (paralelo ao WhatsApp)
8. chore: bump package.json + identity.ts para 3.5.0
9. chore: bump SW cache to zayra-v3.5.0 (ÚLTIMO commit)

---

## Setup

### Task 0: Criar branch a partir de main atualizado

- [ ] **Step 1: Sincronizar main e criar branch**

```bash
git checkout main
git pull origin main
git checkout -b feat/laudo-bci-modal-telegram-v3.5.0
```

Expected: `Switched to a new branch 'feat/laudo-bci-modal-telegram-v3.5.0'`

---

## Task 1: Migration — 14 colunas BCI

**Files:**
- Modify: `src/database/migrations-laudos.ts` (adicionar bloco idempotente no final do arquivo, antes do export final ou onde já tem outros ALTER TABLEs)

- [ ] **Step 1: Localizar o ponto de inserção da migration**

Run: `grep -n "v3.0.0\|v3.2.0\|v3.4.0\|ALTER TABLE laudos_demarcacao" src/database/migrations-laudos.ts | head -10`

Identifique a função de migration de laudos (provavelmente `migrateLaudos()` ou similar) e o último bloco `ALTER TABLE laudos_demarcacao` que existe. A nova migration v3.5.0 deve vir DEPOIS do último bloco existente.

- [ ] **Step 2: Adicionar migration idempotente v3.5.0**

Insira o bloco abaixo no final da função de migration de laudos (mesmo padrão dos outros ALTER TABLE idempotentes):

```typescript
  // v3.5.0: 14 campos BCI (Boletim do Cadastro Imobiliario - Prefeitura) opcionais
  for (const sql of [
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_cod_imovel VARCHAR(20) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_loc_cartografica VARCHAR(50) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_distrito VARCHAR(10) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_setor VARCHAR(10) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_quadra VARCHAR(10) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_lote VARCHAR(10) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_unidade VARCHAR(10) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_situacao VARCHAR(30) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_natureza VARCHAR(50) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_logradouro_tipo VARCHAR(20) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_logradouro_nome VARCHAR(150) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_numero VARCHAR(20) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_cep VARCHAR(10) NULL`,
    `ALTER TABLE laudos_demarcacao ADD COLUMN bci_complemento VARCHAR(100) NULL`,
  ]) {
    try {
      await pool.execute(sql);
      console.log('[migrations:bci-v3.5.0] OK:', sql.slice(0, 70));
    } catch (err) {
      const msg = (err as Error).message;
      if (!/Duplicate column|already exists/i.test(msg)) {
        console.error('[migrations:bci-v3.5.0] FAIL:', sql, msg);
        throw err;
      }
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (sem erros)

- [ ] **Step 4: Commit**

```bash
git add src/database/migrations-laudos.ts
git commit -m "feat(laudo-v3.5.0): migration adiciona 14 campos BCI em laudos_demarcacao

14 colunas opcionais (todas NULL) prefixadas bci_* para dados do Boletim
do Cadastro Imobiliario da Prefeitura: cod_imovel, loc_cartografica,
distrito, setor, quadra, lote, unidade, situacao, natureza, logradouro_
tipo, logradouro_nome, numero, cep, complemento.

Migration idempotente seguindo padrao try/catch que ignora 'Duplicate
column' para permitir re-run no Railway.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Tipos + CRUD em laudos.ts

**Files:**
- Modify: `src/integrations/laudos.ts`

- [ ] **Step 1: Adicionar 14 campos em `LaudoRow`**

Localizar `interface LaudoRow` (~linha 30). Adicionar 14 propriedades no final da interface, antes do `}`:

```typescript
  // v3.5.0: BCI (Boletim do Cadastro Imobiliario - Prefeitura) - todos opcionais
  bci_cod_imovel: string | null;
  bci_loc_cartografica: string | null;
  bci_distrito: string | null;
  bci_setor: string | null;
  bci_quadra: string | null;
  bci_lote: string | null;
  bci_unidade: string | null;
  bci_situacao: string | null;
  bci_natureza: string | null;
  bci_logradouro_tipo: string | null;
  bci_logradouro_nome: string | null;
  bci_numero: string | null;
  bci_cep: string | null;
  bci_complemento: string | null;
```

- [ ] **Step 2: Adicionar 14 campos em `LaudoDetalhe`**

Localizar `interface LaudoDetalhe` (~linha 120). Adicionar EXATAMENTE as mesmas 14 propriedades (cole o mesmo bloco do Step 1).

- [ ] **Step 3: Mapear campos em `mapLaudoDetalhe` (ou equivalente que copia `r.*`)**

Localizar a função que mapeia row do DB para `LaudoDetalhe` (~linha 217, próximo a `matricula: r.matricula ?? null`). Adicionar no final do objeto retornado:

```typescript
    // v3.5.0: BCI
    bci_cod_imovel:        r.bci_cod_imovel        ?? null,
    bci_loc_cartografica:  r.bci_loc_cartografica  ?? null,
    bci_distrito:          r.bci_distrito          ?? null,
    bci_setor:             r.bci_setor             ?? null,
    bci_quadra:            r.bci_quadra            ?? null,
    bci_lote:              r.bci_lote              ?? null,
    bci_unidade:           r.bci_unidade           ?? null,
    bci_situacao:          r.bci_situacao          ?? null,
    bci_natureza:          r.bci_natureza          ?? null,
    bci_logradouro_tipo:   r.bci_logradouro_tipo   ?? null,
    bci_logradouro_nome:   r.bci_logradouro_nome   ?? null,
    bci_numero:            r.bci_numero            ?? null,
    bci_cep:               r.bci_cep               ?? null,
    bci_complemento:       r.bci_complemento       ?? null,
```

- [ ] **Step 4: Adicionar 14 campos em `AtualizarLaudoInput`**

Localizar `interface AtualizarLaudoInput` (~linha 469). Adicionar:

```typescript
  // v3.5.0: BCI (opcionais)
  bci_cod_imovel?: string | null;
  bci_loc_cartografica?: string | null;
  bci_distrito?: string | null;
  bci_setor?: string | null;
  bci_quadra?: string | null;
  bci_lote?: string | null;
  bci_unidade?: string | null;
  bci_situacao?: string | null;
  bci_natureza?: string | null;
  bci_logradouro_tipo?: string | null;
  bci_logradouro_nome?: string | null;
  bci_numero?: string | null;
  bci_cep?: string | null;
  bci_complemento?: string | null;
```

- [ ] **Step 5: Adicionar 14 chamadas de `set()` em `atualizarLaudo`**

Localizar a função `atualizarLaudo()` e o bloco com `set('matricula', input.matricula)` (~linha 529). Adicionar logo após:

```typescript
  // v3.5.0: BCI
  set('bci_cod_imovel',        input.bci_cod_imovel);
  set('bci_loc_cartografica',  input.bci_loc_cartografica);
  set('bci_distrito',          input.bci_distrito);
  set('bci_setor',             input.bci_setor);
  set('bci_quadra',            input.bci_quadra);
  set('bci_lote',              input.bci_lote);
  set('bci_unidade',           input.bci_unidade);
  set('bci_situacao',          input.bci_situacao);
  set('bci_natureza',          input.bci_natureza);
  set('bci_logradouro_tipo',   input.bci_logradouro_tipo);
  set('bci_logradouro_nome',   input.bci_logradouro_nome);
  set('bci_numero',            input.bci_numero);
  set('bci_cep',                input.bci_cep);
  set('bci_complemento',       input.bci_complemento);
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS (sem erros)

- [ ] **Step 7: Commit**

```bash
git add src/integrations/laudos.ts
git commit -m "feat(laudo-v3.5.0): tipos + CRUD para 14 campos BCI em laudos.ts

Propaga campos bci_* em LaudoRow, LaudoDetalhe, mapeamento de row do DB,
AtualizarLaudoInput e set helpers de atualizarLaudo(). Todos os campos
opcionais (string | null) e ignorados se nao enviados no body do PUT.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Seção "Dados do BCI" no PDF

**Files:**
- Modify: `src/services/laudoPdf.ts:~304-306` (entre bloco Dados Registrais e bloco Confrontantes)

- [ ] **Step 1: Localizar ponto de inserção no PDF**

Run: `grep -n "temRegistrais\|Confrontante" src/services/laudoPdf.ts | head -8`

Identifique o final do bloco "Dados Registrais" (após `if (temRegistrais) { ... }`) e o início do bloco "Confrontantes" (geralmente em torno da linha 305-308). O novo bloco BCI vai ENTRE eles.

- [ ] **Step 2: Adicionar bloco BCI condicional**

Após o `if (temRegistrais) { ... }` e ANTES da linha que checa confrontantes, inserir:

```typescript
  // v3.5.0: Dados do BCI (Boletim do Cadastro Imobiliario)
  const temBci = laudo.bci_cod_imovel || laudo.bci_loc_cartografica || laudo.bci_distrito
    || laudo.bci_setor || laudo.bci_quadra || laudo.bci_lote || laudo.bci_unidade
    || laudo.bci_situacao || laudo.bci_natureza || laudo.bci_logradouro_tipo
    || laudo.bci_logradouro_nome || laudo.bci_numero || laudo.bci_cep || laudo.bci_complemento;
  if (temBci) {
    doc.fontSize(9).fillColor('#888').font('Helvetica-Bold').text('Dados do BCI (Prefeitura Municipal):', 40, cy);
    cy += 12;
    doc.font('Helvetica').fillColor('#222');

    // Linha 1: Cod imovel + Loc Cartografica
    if (laudo.bci_cod_imovel || laudo.bci_loc_cartografica) {
      const partes: string[] = [];
      if (laudo.bci_cod_imovel) partes.push(`Cod: ${laudo.bci_cod_imovel}`);
      if (laudo.bci_loc_cartografica) partes.push(`Loc. Cartografica: ${laudo.bci_loc_cartografica}`);
      doc.text(partes.join('   ·   '), 40, cy, { width: 515 });
      cy += 12;
    }

    // Linha 2: Distrito/Setor/Quadra/Lote/Unidade (compacto)
    if (laudo.bci_distrito || laudo.bci_setor || laudo.bci_quadra || laudo.bci_lote || laudo.bci_unidade) {
      const partes: string[] = [];
      if (laudo.bci_distrito) partes.push(`Distrito ${laudo.bci_distrito}`);
      if (laudo.bci_setor)    partes.push(`Setor ${laudo.bci_setor}`);
      if (laudo.bci_quadra)   partes.push(`Quadra ${laudo.bci_quadra}`);
      if (laudo.bci_lote)     partes.push(`Lote ${laudo.bci_lote}`);
      if (laudo.bci_unidade)  partes.push(`Unidade ${laudo.bci_unidade}`);
      doc.text(partes.join('   ·   '), 40, cy, { width: 515 });
      cy += 12;
    }

    // Linha 3: Situacao + Natureza
    if (laudo.bci_situacao || laudo.bci_natureza) {
      const partes: string[] = [];
      if (laudo.bci_situacao) partes.push(`Situacao: ${laudo.bci_situacao}`);
      if (laudo.bci_natureza) partes.push(`Natureza: ${laudo.bci_natureza}`);
      doc.text(partes.join('   ·   '), 40, cy, { width: 515 });
      cy += 12;
    }

    // Linha 4: Logradouro completo (tipo + nome + numero + complemento)
    const logradouroPartes: string[] = [];
    if (laudo.bci_logradouro_tipo) logradouroPartes.push(laudo.bci_logradouro_tipo);
    if (laudo.bci_logradouro_nome) logradouroPartes.push(laudo.bci_logradouro_nome);
    let logradouroLinha = logradouroPartes.join(' ');
    if (laudo.bci_numero) logradouroLinha += `, ${laudo.bci_numero}`;
    if (laudo.bci_complemento) logradouroLinha += ` — ${laudo.bci_complemento}`;
    if (logradouroLinha.trim()) {
      doc.text(`Logradouro: ${logradouroLinha}`, 40, cy, { width: 515 });
      cy += 12;
    }

    // Linha 5: CEP formatado
    if (laudo.bci_cep) {
      const cepLimpo = String(laudo.bci_cep).replace(/\D/g, '');
      const cepFmt = cepLimpo.length === 8
        ? `${cepLimpo.slice(0, 2)}.${cepLimpo.slice(2, 5)}-${cepLimpo.slice(5)}`
        : laudo.bci_cep;
      doc.text(`CEP: ${cepFmt}`, 40, cy, { width: 515 });
      cy += 12;
    }

    cy += 6; // espaco antes do proximo bloco
  }
```

> **Atenção:** `cy` é a variável Y-cursor usada no resto do arquivo. Se ela tiver nome diferente (ex: `currentY`, `y`), use o nome correto que estiver em vigor no escopo.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Validação manual do PDF**

```bash
# rode o dev server
npm run dev
```

No browser, abra um laudo existente, preencha alguns campos BCI temporariamente via SQL (ou aguarde Task 5 que cria a UI). Por enquanto, validar via SQL direto:

```sql
UPDATE laudos_demarcacao SET
  bci_cod_imovel = '0000004830',
  bci_loc_cartografica = '01.01.114.0249.00001',
  bci_distrito = '01',
  bci_setor = '1',
  bci_quadra = '0114',
  bci_lote = '0249',
  bci_unidade = '00001',
  bci_situacao = 'Ativo',
  bci_natureza = 'Predio',
  bci_logradouro_tipo = 'RUA',
  bci_logradouro_nome = 'SAO LUIS',
  bci_numero = '134',
  bci_cep = '65930000',
  bci_complemento = 'QUADRA: 114'
WHERE id = 1 LIMIT 1;
```

Gere o PDF: confirmar que aparece a seção "Dados do BCI (Prefeitura Municipal)" entre Dados Registrais e Confrontantes. CEP formatado como `65.930-000`.

- [ ] **Step 5: Commit**

```bash
git add src/services/laudoPdf.ts
git commit -m "feat(laudo-v3.5.0): seção 'Dados do BCI' no PDF de laudo

Renderiza bloco condicional (so se >=1 campo BCI preenchido) entre Dados
Registrais e Confrontantes. Formato compacto em 5 linhas: identificadores,
codigos cartograficos, situacao/natureza, logradouro completo, CEP
formatado xx.xxx-xxx.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Backend `enviarLaudoTelegram` + endpoint

**Files:**
- Modify: `src/integrations/laudos.ts` (adicionar função no final, antes do export ou após `getPdfAssinado`)
- Modify: `src/server.ts` (adicionar endpoint após `/api/laudos-demarcacao/:id/enviar-zapi` ~linha 2363)

- [ ] **Step 1: Adicionar `enviarLaudoTelegram` em `laudos.ts`**

Após a função `getPdfAssinado` (linha ~1067), adicionar:

```typescript
// v3.5.0: envia laudo assinado via Telegram. Replica padrao de enviarVistoriaTelegram.
// chatId opcional → default TELEGRAM_LEAD_CHAT_ID (CEO) ou primeiro de
// TELEGRAM_AUTHORIZED_USER_IDS (CSV).
export async function enviarLaudoTelegram(input: { id: string | number; chatId?: string }) {
  const id = Number(input.id);
  const laudo = await buscarLaudo(id);
  if (!laudo) throw new Error('Laudo nao encontrado.');

  const chatId = (input.chatId || '').trim()
    || (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
    || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  if (!chatId) throw new Error('chatId Telegram obrigatorio (TELEGRAM_LEAD_CHAT_ID ou TELEGRAM_AUTHORIZED_USER_IDS).');

  const pdfData = await getPdfAssinado(id);
  if (!pdfData) throw new Error('Laudo ainda nao foi assinado — assine antes de enviar.');
  const pdfBuf = pdfData.pdf;
  if (pdfBuf.length > 50 * 1024 * 1024) {
    throw new Error(`PDF tem ${(pdfBuf.length / 1024 / 1024).toFixed(1)}MB e Telegram aceita ate 50MB.`);
  }

  const imovelCurto = (laudo.denominacao_imovel || laudo.endereco_imovel || 'imovel')
    .replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  const fileName = `Laudo_${pdfData.numero}_${imovelCurto}.pdf`;
  const caption = `Laudo #${pdfData.numero} — ${laudo.denominacao_imovel || laudo.endereco_imovel || ''}`;

  const { sendDocument: sendTelegramDocument } = await import('./telegram');
  try {
    await sendTelegramDocument(chatId, pdfBuf, fileName, caption);
  } catch (err) {
    const e = err as Error & { response?: { data?: { description?: string; error_code?: number } } };
    const desc = e.response?.data?.description || e.message;
    const code = e.response?.data?.error_code;
    throw new Error(`Telegram rejeitou: ${desc}${code ? ` (code ${code})` : ''}`);
  }
  return {
    ok: true as const,
    message: `Laudo #${pdfData.numero} enviado via Telegram (chat ${chatId}, ${(pdfBuf.length / 1024).toFixed(0)} KB).`,
    chat_id: chatId,
  };
}
```

- [ ] **Step 2: Adicionar endpoint em `server.ts`**

Após o endpoint `/api/laudos-demarcacao/:id/enviar-zapi` (linha ~2363, no final do handler ou logo após `});`), inserir:

```typescript
// v3.5.0: envio do laudo assinado via Telegram. chatId opcional no body.
app.post('/api/laudos-demarcacao/:id/enviar-telegram', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const chatIdOverride = typeof req.body?.chat_id === 'string' ? req.body.chat_id : undefined;
    const m = await import('./integrations/laudos');
    const result = await m.enviarLaudoTelegram({ id, chatId: chatIdOverride });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Validação manual do endpoint**

```bash
# rode dev server
npm run dev

# em outro terminal (use um laudo ja assinado, ex: id=1)
curl -X POST http://localhost:3000/api/laudos-demarcacao/1/enviar-telegram \
  -H "Content-Type: application/json" \
  -H "Cookie: ceo_session=SEU_TOKEN_AQUI" \
  -d '{}'
```

Expected: `{"ok":true,"message":"Laudo #LAUDO-2026-... enviado via Telegram (chat XXX, NNN KB).","chat_id":"XXX"}` + PDF chega no Telegram do CEO.

Se laudo não tiver `pdf_assinado_blob`: `{"error":"Laudo ainda nao foi assinado — assine antes de enviar."}`

- [ ] **Step 5: Commit**

```bash
git add src/integrations/laudos.ts src/server.ts
git commit -m "feat(laudo-v3.5.0): backend enviarLaudoTelegram + endpoint /enviar-telegram

Replica padrao de enviarVistoriaTelegram (vistorias.ts:585): default
chatId via TELEGRAM_LEAD_CHAT_ID, override via body, valida tamanho 50MB,
trata erros do bot Telegram, retorna message com KB transmitidos.

Endpoint POST /api/laudos-demarcacao/:id/enviar-telegram com requireCeoToken.
Body opcional: { chat_id: string }.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: UI Card BCI colapsável

**Files:**
- Modify: `src/public/obras.html` em `renderLaudoTabDados()` (após card "Dados Registrais" ~linha 14595, antes do card "Confrontantes")

- [ ] **Step 1: Localizar pontos exatos no obras.html**

Run: `grep -n "Dados Registrais (Cartório)\|Confrontantes\|ld-salvar" src/public/obras.html | head -10`

Identifique:
- Linha onde fecha o card "Dados Registrais" (`</div>` que fecha o card antes do card Confrontantes).
- Linha do handler `document.getElementById('ld-salvar').onclick` que constroi o `body` do PUT.

- [ ] **Step 2: Inserir HTML do card BCI no template literal**

Antes do `<div class="card">` que contém `<h3>Confrontantes</h3>`, adicionar:

```html
    <div class="card">
      <div id="ld-bci-header" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; user-select:none;">
        <h3 style="margin:0;">🏛️ BCI (Boletim do Cadastro Imobiliário)</h3>
        <span id="ld-bci-chevron" style="font-size:14px;">▼</span>
      </div>
      <div id="ld-bci-body" style="display:none; margin-top:12px;">
        <p style="font-size:11px; color:var(--text-muted); margin:0 0 8px;">
          ℹ️ Opcional — preencha o que tiver. Dados extraídos do BCI da Prefeitura.
        </p>
        <div class="lp-grid-2">
          <input id="ld-bci-cod-imovel" placeholder="Cód. Imóvel (ex: 0000004830)" value="${escape(l.bci_cod_imovel||'')}">
          <input id="ld-bci-loc-cart" placeholder="Loc. Cartográfica (ex: 01.01.114.0249.00001)" value="${escape(l.bci_loc_cartografica||'')}">
        </div>
        <div class="lp-grid-5" style="margin-top:8px;">
          <input id="ld-bci-distrito" placeholder="Distrito" value="${escape(l.bci_distrito||'')}">
          <input id="ld-bci-setor"    placeholder="Setor"    value="${escape(l.bci_setor||'')}">
          <input id="ld-bci-quadra"   placeholder="Quadra"   value="${escape(l.bci_quadra||'')}">
          <input id="ld-bci-lote"     placeholder="Lote"     value="${escape(l.bci_lote||'')}">
          <input id="ld-bci-unidade"  placeholder="Unidade"  value="${escape(l.bci_unidade||'')}">
        </div>
        <div class="lp-grid-2" style="margin-top:8px;">
          <input id="ld-bci-situacao" placeholder="Situação (ex: Ativo)"   value="${escape(l.bci_situacao||'')}">
          <input id="ld-bci-natureza" placeholder="Natureza (ex: Prédio)"   value="${escape(l.bci_natureza||'')}">
        </div>
        <div class="lp-grid-2" style="margin-top:8px;">
          <input id="ld-bci-logr-tipo" placeholder="Logradouro Tipo (ex: RUA)" value="${escape(l.bci_logradouro_tipo||'')}">
          <input id="ld-bci-logr-nome" placeholder="Nome do logradouro"        value="${escape(l.bci_logradouro_nome||'')}">
        </div>
        <div class="lp-grid-3" style="margin-top:8px;">
          <input id="ld-bci-numero"      placeholder="Número"   value="${escape(l.bci_numero||'')}">
          <input id="ld-bci-cep"         placeholder="CEP (8 dígitos)" maxlength="9" value="${escape(l.bci_cep||'')}">
          <input id="ld-bci-complemento" placeholder="Complemento" value="${escape(l.bci_complemento||'')}">
        </div>
      </div>
    </div>
```

- [ ] **Step 3: Adicionar JS de toggle (logo após o setupCartorioAutocomplete que já existe)**

Localizar onde `setupCartorioAutocomplete()` é chamado (no final do `renderLaudoTabDados` antes de outros handlers). Logo após, adicionar:

```javascript
  // v3.5.0: toggle do card BCI + persistencia em localStorage
  (() => {
    const header = document.getElementById('ld-bci-header');
    const body = document.getElementById('ld-bci-body');
    const chev = document.getElementById('ld-bci-chevron');
    if (!header || !body || !chev) return;
    const expandido = localStorage.getItem('ld_bci_expanded') === '1';
    if (expandido) { body.style.display = 'block'; chev.textContent = '▲'; }
    header.onclick = () => {
      const aberto = body.style.display !== 'none';
      body.style.display = aberto ? 'none' : 'block';
      chev.textContent = aberto ? '▼' : '▲';
      localStorage.setItem('ld_bci_expanded', aberto ? '0' : '1');
    };
  })();
```

- [ ] **Step 4: Adicionar 14 campos no body do PUT em `ld-salvar`**

Localizar o handler `document.getElementById('ld-salvar').onclick` e o objeto `body` que monta os dados pro PUT. Adicionar antes do `try { await api(...) }`:

```javascript
      // v3.5.0: BCI
      bci_cod_imovel:        document.getElementById('ld-bci-cod-imovel')?.value.trim() || null,
      bci_loc_cartografica:  document.getElementById('ld-bci-loc-cart')?.value.trim() || null,
      bci_distrito:          document.getElementById('ld-bci-distrito')?.value.trim() || null,
      bci_setor:             document.getElementById('ld-bci-setor')?.value.trim() || null,
      bci_quadra:            document.getElementById('ld-bci-quadra')?.value.trim() || null,
      bci_lote:              document.getElementById('ld-bci-lote')?.value.trim() || null,
      bci_unidade:           document.getElementById('ld-bci-unidade')?.value.trim() || null,
      bci_situacao:          document.getElementById('ld-bci-situacao')?.value.trim() || null,
      bci_natureza:          document.getElementById('ld-bci-natureza')?.value.trim() || null,
      bci_logradouro_tipo:   document.getElementById('ld-bci-logr-tipo')?.value.trim() || null,
      bci_logradouro_nome:   document.getElementById('ld-bci-logr-nome')?.value.trim() || null,
      bci_numero:            document.getElementById('ld-bci-numero')?.value.trim() || null,
      bci_cep:               document.getElementById('ld-bci-cep')?.value.trim().replace(/\D/g, '') || null,
      bci_complemento:       document.getElementById('ld-bci-complemento')?.value.trim() || null,
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Validação visual desktop + mobile**

```bash
npm run dev
```

Browser:
1. Abrir laudo existente em http://localhost:3000/obras → aba Laudo Demarcação → Abrir um laudo.
2. Confirmar que card "🏛️ BCI (Boletim do Cadastro Imobiliário)" aparece FECHADO por padrão entre Dados Registrais e Confrontantes.
3. Click no header → expande com chevron ▲ → 14 inputs visíveis.
4. Recarregar página → estado expandido persiste.
5. Preencher 3 campos (ex: Cód. Imóvel, Quadra, CEP) → Salvar → re-abrir → valores persistidos.
6. DevTools → modo mobile 360x800 → cards BCI sem scroll horizontal, 14 inputs respeitam layout 1-coluna.
7. Mobile 412x915 → idem.

- [ ] **Step 7: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(laudo-v3.5.0): UI card BCI colapsável com 14 inputs + persistência localStorage

Card '🏛️ BCI (Boletim do Cadastro Imobiliário)' inserido entre Dados
Registrais e Confrontantes. Fechado por padrão pra reduzir poluicao
visual. Estado aberto/fechado salvo em localStorage 'ld_bci_expanded'.

14 inputs distribuidos em grids:
- lp-grid-2: cod_imovel + loc_cartografica
- lp-grid-5: distrito/setor/quadra/lote/unidade
- lp-grid-2: situacao + natureza
- lp-grid-2: logradouro_tipo + logradouro_nome
- lp-grid-3: numero + cep + complemento

Save handler propaga 14 campos no body do PUT (com CEP limpo via replace
\\D). Em mobile (≤768px) o reset de grid da v3.4.x faz tudo virar 1 coluna.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Modal fullscreen do PDF Assinado

**Files:**
- Modify: `src/public/obras.html` (substituir handler de `data-laudo-pdf-sig` em ~linha 13675)

- [ ] **Step 1: Localizar handler atual**

Run: `grep -n "data-laudo-pdf-sig\|laudoPdfSig" src/public/obras.html | head -5`

Identifique o handler `v.querySelectorAll('[data-laudo-pdf-sig]')...` que provavelmente faz `window.open(...)`.

- [ ] **Step 2: Substituir handler por abertura do modal**

Localize o handler atual e SUBSTITUA-O completamente por:

```javascript
  // v3.5.0: modal fullscreen do PDF Assinado com botoes Baixar/Telegram/WhatsApp
  v.querySelectorAll('[data-laudo-pdf-sig]').forEach(b => b.onclick = () => {
    abrirModalPdfLaudoAssinado(b.dataset.laudoPdfSig);
  });
```

- [ ] **Step 3: Adicionar função `abrirModalPdfLaudoAssinado` no escopo do arquivo**

Em uma posição apropriada (próximo a outras funções relacionadas a laudo, ex: depois de `renderLaudosList` ou similar), adicionar:

```javascript
// v3.5.0: modal fullscreen do PDF Assinado de laudo com botoes Baixar/Telegram/WhatsApp
function abrirModalPdfLaudoAssinado(laudoId) {
  // remove modal existente (se houver)
  const existente = document.getElementById('ld-pdf-modal');
  if (existente) existente.remove();

  const url = `/api/laudos-demarcacao/${laudoId}/pdf-assinado`;
  const modal = document.createElement('div');
  modal.id = 'ld-pdf-modal';
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:9999; display:flex; flex-direction:column;';
  modal.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 16px; background:var(--surface); border-bottom:1px solid var(--gold-dim);">
      <strong style="color:var(--gold);">🔏 PDF Assinado — Laudo #${escape(laudoId)}</strong>
      <button id="ld-pdf-modal-close" style="background:transparent; border:none; color:var(--text-muted); font-size:24px; cursor:pointer; padding:4px 12px;">✕</button>
    </div>
    <iframe id="ld-pdf-iframe" src="${url}" style="flex:1; width:100%; border:0; background:#222;"></iframe>
    <div style="display:flex; gap:8px; padding:10px 16px; background:var(--surface); border-top:1px solid var(--gold-dim); justify-content:center; flex-wrap:wrap;">
      <button id="ld-pdf-baixar" style="background:var(--gold); color:#06120a; border-color:var(--gold);">💾 Baixar PDF</button>
      <button id="ld-pdf-telegram" style="background:#0088cc22; color:#0088cc; border:1px solid #0088cc55;">✈️ Telegram</button>
      <button id="ld-pdf-whatsapp" style="background:#25d36622; color:#25d366; border:1px solid #25d36655;">📱 WhatsApp</button>
    </div>
  `;
  document.body.appendChild(modal);

  const fechar = () => modal.remove();
  document.getElementById('ld-pdf-modal-close').onclick = fechar;

  // ESC fecha modal
  const escHandler = (e) => {
    if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  // Botao Baixar: forca download via blob (evita abrir inline em mobile)
  document.getElementById('ld-pdf-baixar').onclick = async () => {
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Falha ao baixar PDF: ' + resp.status);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Laudo_${laudoId}_assinado.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (err) { alert('Erro ao baixar: ' + err.message); }
  };

  // Botao Telegram: prompt opcional de chat_id, default CEO
  document.getElementById('ld-pdf-telegram').onclick = async () => {
    const chatId = prompt('Chat ID Telegram (vazio = CEO):') || '';
    try {
      const r = await api('/api/laudos-demarcacao/' + laudoId + '/enviar-telegram', {
        method: 'POST',
        body: JSON.stringify(chatId ? { chat_id: chatId } : {}),
        headers: { 'Content-Type': 'application/json' },
      });
      alert('✅ ' + r.message);
    } catch (err) { alert('Erro Telegram: ' + err.message); }
  };

  // Botao WhatsApp: prompt telefone, reaproveita endpoint /enviar-zapi
  document.getElementById('ld-pdf-whatsapp').onclick = async () => {
    const tel = prompt('WhatsApp do destinatário (DDD+número):');
    if (!tel) return;
    try {
      const r = await api('/api/laudos-demarcacao/' + laudoId + '/enviar-zapi', {
        method: 'POST',
        body: JSON.stringify({ telefone: tel }),
        headers: { 'Content-Type': 'application/json' },
      });
      alert('✅ Enviado! ' + (r.message_id ? 'ID: ' + r.message_id : ''));
    } catch (err) { alert('Erro Z-API: ' + err.message); }
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Validação visual**

```bash
npm run dev
```

Browser:
1. Abrir um laudo JÁ ASSINADO no painel.
2. Click no botão `🔏 Assinado` → modal fullscreen abre com iframe do PDF.
3. Tecla ESC → modal fecha.
4. Reabrir → click no ✕ → modal fecha.
5. Reabrir → click "💾 Baixar PDF" → arquivo `Laudo_<id>_assinado.pdf` baixa pro disco (NÃO abre inline).
6. Click "✈️ Telegram" → prompt → cancelar/vazio → manda pro CEO → PDF chega no Telegram do CEO.
7. Click "📱 WhatsApp" → prompt → digitar número de teste → PDF enviado via Z-API.
8. Mobile 360x800: modal cobre 100% da tela, iframe scrollável, 3 botões no footer (podem quebrar em 2 linhas com flex-wrap).

- [ ] **Step 6: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(laudo-v3.5.0): modal fullscreen do PDF Assinado com Baixar/Telegram/WhatsApp

Substitui window.open() do botao '🔏 Assinado' por modal cobrindo viewport
inteiro com 3 partes:
- Header: titulo + botao fechar (✕ ou ESC)
- Body: <iframe> embedded do PDF (/api/laudos-demarcacao/:id/pdf-assinado)
- Footer: 3 botoes — Baixar (blob+download forcado), Telegram (default CEO),
  WhatsApp (reaproveita endpoint /enviar-zapi)

Vantagem em mobile: PDF visualizado sem depender da toolbar nativa do
browser (coletor industrial), e botao Baixar forca download em vez de
abrir inline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Botão Telegram no card do laudo

**Files:**
- Modify: `src/public/obras.html` (~linha 13682, no bloco condicional `${l.assinado_em ? ... : ''}`)

- [ ] **Step 1: Adicionar botão Telegram paralelo ao WhatsApp no card**

Localizar a linha 13683 com `<button data-laudo-zapi=...>📱 Enviar WhatsApp</button>`. SUBSTITUIR a linha do bloco condicional `${l.assinado_em ? '<div ...>... WhatsApp ...</div>' : ''}` por:

```html
          ${l.assinado_em ? `<div style="display:flex; gap:4px; flex-wrap:wrap;">
            <button data-laudo-zapi="${l.id}" title="Enviar pelo WhatsApp (Z-API)" style="flex:1; background:#25d36622; color:#25d366; border-color:#25d36655;">📱 WhatsApp</button>
            <button data-laudo-telegram="${l.id}" title="Enviar pelo Telegram" style="flex:1; background:#0088cc22; color:#0088cc; border:1px solid #0088cc55;">✈️ Telegram</button>
          </div>` : ''}
```

(Observe a renomeação `Enviar WhatsApp` → `WhatsApp` pra dar espaço pro botão Telegram lado a lado em mobile.)

- [ ] **Step 2: Adicionar handler `data-laudo-telegram`**

Localizar a linha com `v.querySelectorAll('[data-laudo-zapi]').forEach(b => b.onclick = async () => {...})` (~linha 13810). Logo após esse `});`, adicionar:

```javascript
  // v3.5.0: enviar laudo via Telegram (default CEO, override via prompt)
  v.querySelectorAll('[data-laudo-telegram]').forEach(b => b.onclick = async () => {
    const chatId = prompt('Chat ID Telegram (vazio = CEO):') || '';
    try {
      const r = await api('/api/laudos-demarcacao/' + b.dataset.laudoTelegram + '/enviar-telegram', {
        method: 'POST',
        body: JSON.stringify(chatId ? { chat_id: chatId } : {}),
        headers: { 'Content-Type': 'application/json' },
      });
      alert('✅ ' + r.message);
      await render();
    } catch (err) { alert('Erro Telegram: ' + err.message); }
  });
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Validação visual desktop + mobile**

```bash
npm run dev
```

Browser:
1. Abrir aba Laudo Demarcação no painel.
2. Localizar um laudo já assinado.
3. Confirmar que botão `✈️ Telegram` aparece ao lado de `📱 WhatsApp` (azul claro ao lado de verde).
4. Click `✈️ Telegram` → prompt → cancelar/vazio → manda pro CEO.
5. Mobile 360x800: 2 botões respeitam flex-wrap, podem ficar lado-a-lado ou quebrar pra 2 linhas dependendo do card.
6. Mobile 412x915: idem.

- [ ] **Step 5: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(laudo-v3.5.0): botão Telegram no card do laudo (paralelo ao WhatsApp)

Adiciona '✈️ Telegram' ao lado do '📱 WhatsApp' no card de laudos
assinados. Mesmo padrao de UX do WhatsApp: prompt opcional de chat_id
(vazio = default CEO via TELEGRAM_LEAD_CHAT_ID).

Renomeia 'Enviar WhatsApp' → 'WhatsApp' pra economizar espaco horizontal
e permitir os 2 botoes ficarem lado a lado em mobile.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Bump version 3.4.6 → 3.5.0

**Files:**
- Modify: `package.json:3` (campo `version`)
- Modify: `src/agent/identity.ts:4` (campo `version`)

- [ ] **Step 1: Bump package.json**

Edit `package.json`: substituir `"version": "3.4.6"` por `"version": "3.5.0"`.

- [ ] **Step 2: Bump identity.ts**

Edit `src/agent/identity.ts`: substituir `version: '3.4.6'` por `version: '3.5.0'`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add package.json src/agent/identity.ts
git commit -m "chore(v3.5.0): bump package.json + identity.ts para 3.5.0

Feature minor: 3 features novas no modulo Laudo de Demarcacao (BCI,
modal PDF assinado, envio Telegram).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: CACHE bump em sw.js (ÚLTIMO COMMIT — regra crítica do CEO)

**Files:**
- Modify: `src/public/sw.js:4` (constante `CACHE`)

> **ATENÇÃO:** Este DEVE ser o ÚLTIMO commit do PR. Regra crítica do CEO José Romário documentada em todos os PRs anteriores (v3.3.0, v3.4.0..v3.4.6).

- [ ] **Step 1: Bump SW cache**

Edit `src/public/sw.js`: substituir `const CACHE = 'zayra-v3.4.6';` por `const CACHE = 'zayra-v3.5.0';`.

- [ ] **Step 2: Commit (ÚLTIMO)**

```bash
git add src/public/sw.js
git commit -m "chore(v3.5.0): bump SW cache to zayra-v3.5.0 (ÚLTIMO commit do PR)

Forca rotacao de cache pos-deploy para todos os clients abertos. Sem
isso, PWA standalone continua com JS antigo ate refresh manual.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Push e abrir PR**

```bash
git push -u origin feat/laudo-bci-modal-telegram-v3.5.0
```

Expected: link de PR retornado pelo GitHub.

Abrir PR via link: `https://github.com/RomatecCRMWatsApp/RomatecVoiceAgent/pull/new/feat/laudo-bci-modal-telegram-v3.5.0`

Título sugerido: `feat(v3.5.0): Laudo Demarcação — BCI + Modal PDF Assinado + Envio Telegram`

---

## Validação final pós-merge (DOD)

Após mergear o PR e Railway deployar:

- [ ] Logs do Railway mostram `[migrations:bci-v3.5.0] OK:` para 14 ALTER TABLE.
- [ ] Abrir laudo existente → card BCI aparece colapsado entre Dados Registrais e Confrontantes.
- [ ] Preencher 5 campos BCI parciais (cod_imovel, quadra, cep, logradouro_nome, complemento) → Salvar → re-abrir → persistido.
- [ ] Re-assinar laudo com BCI preenchido → baixar PDF → seção "Dados do BCI (Prefeitura Municipal):" aparece entre Dados Registrais e Confrontantes com CEP formatado.
- [ ] Click `🔏 Assinado` no card de laudo → modal fullscreen abre com iframe.
- [ ] Click "💾 Baixar PDF" no modal → arquivo baixa pro disco com nome `Laudo_<id>_assinado.pdf`.
- [ ] Click "✈️ Telegram" no modal → vazio no prompt → PDF chega no Telegram do CEO.
- [ ] Click "📱 WhatsApp" no modal → digitar número de teste → PDF chega no WhatsApp.
- [ ] Click `✈️ Telegram` direto no card (sem abrir modal) → PDF chega no Telegram do CEO.
- [ ] Mobile 360x800: card BCI sem scroll horizontal, modal cobre tela inteira, 3 botões respeitam flex-wrap.
- [ ] Mobile 412x915: idem.

---

## Notas finais

- **Pular Task 5 ou 6 não é opção** — Task 5 (UI BCI) precisa pra preencher os campos que Task 3 (PDF) renderiza. Task 6 (modal) é a feature de UX principal do CEO.
- **Não modificar `getPdfAssinado()`** — função já existe e funciona. Task 4 só consome.
- **Não criar tabela separada `laudo_bci`** — decisão arquitetural (spec §2.1).
- **Não validar formato CEP/cod_imovel no backend** — explicitamente fora do escopo (spec §7).
