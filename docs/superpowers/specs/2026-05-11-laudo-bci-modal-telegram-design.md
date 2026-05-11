# Laudo de Demarcação — BCI + Modal PDF Assinado + Envio Telegram (v3.5.0)

**Status:** Design aprovado pelo CEO José Romário em 2026-05-11. Pronto para escrita de plano de implementação.

**Goal:** Adicionar 3 features ao módulo de Laudo de Demarcação: (1) 14 campos opcionais do BCI da Prefeitura, (2) modal de visualização do PDF Assinado com ação de download, (3) envio do laudo via Telegram (paralelo ao WhatsApp Z-API já existente).

**Tech Stack:** Node + TypeScript + Express + MySQL2 (raw pool), PDFKit pra PDF, frontend vanilla JS em `obras.html`, Telegram via `src/integrations/telegram.ts` (já existente).

---

## 1. Contexto

O módulo de Laudo Técnico de Demarcação (`/obras` → aba "Laudo Demarcação") tem hoje:
- Card "Dados Registrais (Cartório)" com 5 campos: `matricula`, `livro`, `folhas`, `cartorio_nome`, `cartorio_cns`.
- Botão "🔏 Assinado" no card de laudo que faz `window.open('/api/laudos-demarcacao/:id/pdf-assinado')` — abre PDF no navegador.
- Botão "📱 Enviar WhatsApp" via Z-API (só aparece quando `assinado_em` existe).

Faltam:
- Campos do BCI (Boletim do Cadastro Imobiliário Municipal), conforme padrão da Prefeitura de Açailândia.
- UX clara pra baixar o PDF assinado (botão atual abre inline, não força download).
- Envio via Telegram (já existe a infra em `telegram.ts`, basta replicar padrão de `enviarVistoriaTelegram`).

---

## 2. Decisões Arquiteturais

| # | Decisão | Alternativa rejeitada | Motivo |
|---|---|---|---|
| 1 | 14 colunas `bci_*` direto em `romatec_laudos_demarcacao` | Tabela separada `romatec_laudo_bci` (1:1) | Mais simples, segue padrão atual de matricula/livro/folhas. Relação 1:1 não justifica JOIN. |
| 2 | Card BCI colapsável (fechado por padrão) | Sub-seção dentro do card Dados Registrais; ou card sempre aberto | Reduz poluição visual — só abre se for usar. Estado salvo em `localStorage`. |
| 3 | Modal fullscreen com `<iframe>` + botão Baixar | Renomear botão atual; viewer nativo do navegador | UX consistente entre dispositivos (incluindo coletores industriais sem toolbar nativa de PDF). Botões Telegram/WhatsApp dentro do modal concentram ações de envio. |
| 4 | Telegram replicando padrão `enviarVistoriaTelegram` | Refatorar pra serviço genérico `sendDocumentToTelegram` | Padrão já estabelecido no projeto (memory rule). Refator pode vir em versão futura se múltiplos módulos divergirem. |
| 5 | Bloco BCI no PDF só renderiza se ≥1 campo preenchido | Sempre renderizar bloco (mesmo vazio); nunca renderizar | Comportamento consistente com bloco "Dados Registrais" existente (`temRegistrais`). |
| 6 | Default `chatId` Telegram: `TELEGRAM_LEAD_CHAT_ID` env var; override via prompt opcional | Sempre pergunta; sempre manda pro CEO sem perguntar | Padrão de memory do projeto (project_zayra_telegram_pattern.md). |

---

## 3. Schema (Migration v3.5.0)

Adicionar 14 colunas em `romatec_laudos_demarcacao` via migration idempotente em [src/database/migrations.ts](../../src/database/migrations.ts) (segue padrão try/catch ignorando "Duplicate column"):

| Coluna | Tipo | Exemplo (Açailândia) |
|---|---|---|
| `bci_cod_imovel` | VARCHAR(20) NULL | `"0000004830"` |
| `bci_loc_cartografica` | VARCHAR(50) NULL | `"01.01.114.0249.00001"` |
| `bci_distrito` | VARCHAR(10) NULL | `"01"` |
| `bci_setor` | VARCHAR(10) NULL | `"1"` |
| `bci_quadra` | VARCHAR(10) NULL | `"0114"` (distinto da coluna `quadra` existente — BCI é zero-padded) |
| `bci_lote` | VARCHAR(10) NULL | `"0249"` |
| `bci_unidade` | VARCHAR(10) NULL | `"00001"` |
| `bci_situacao` | VARCHAR(30) NULL | `"Ativo"` |
| `bci_natureza` | VARCHAR(50) NULL | `"Prédio"` |
| `bci_logradouro_tipo` | VARCHAR(20) NULL | `"10061"` ou `"RUA"` |
| `bci_logradouro_nome` | VARCHAR(150) NULL | `"SÃO LUIS"` |
| `bci_numero` | VARCHAR(20) NULL | `"134"` |
| `bci_cep` | VARCHAR(10) NULL | `"65930000"` (sem máscara, validação no frontend opcional) |
| `bci_complemento` | VARCHAR(100) NULL | `"QUADRA: 114"` |

Todas NULL/opcionais. Sem CHECK constraints. Salvamento parcial é OK.

---

## 4. Backend

### 4.1 Tipos e CRUD ([src/integrations/laudos.ts](../../src/integrations/laudos.ts))

Adicionar os 14 campos `bci_*` em:
- `interface LaudoRow` (linha ~30) — todos `string | null`.
- `interface LaudoDetalhe` (linha ~120) — idem.
- `mapLaudoDetalhe()` ou equivalente que copia campos de `r.*` (linha ~217) — `bci_cod_imovel: r.bci_cod_imovel ?? null` × 14.
- `interface AtualizarLaudoInput` (linha ~469) — campos opcionais `bci_*?: string | null`.
- `atualizarLaudo()` set helpers (linha ~529) — `set('bci_cod_imovel', input.bci_cod_imovel)` × 14.

### 4.2 PDF — Seção "Dados do BCI" ([src/services/laudoPdf.ts](../../src/services/laudoPdf.ts))

Inserir bloco depois de Dados Registrais (linha ~304) e antes de Confrontantes (linha ~306):

```ts
const temBci = laudo.bci_cod_imovel || laudo.bci_loc_cartografica || laudo.bci_distrito
  || laudo.bci_setor || laudo.bci_quadra || laudo.bci_lote || laudo.bci_unidade
  || laudo.bci_situacao || laudo.bci_natureza || laudo.bci_logradouro_tipo
  || laudo.bci_logradouro_nome || laudo.bci_numero || laudo.bci_cep || laudo.bci_complemento;
if (temBci) {
  // Título da seção
  doc.fontSize(9).fillColor('#888').font('Helvetica-Bold')
     .text('Dados do BCI (Prefeitura Municipal):', 40, cy);
  // Linha 1: Cód imóvel + Loc Cartográfica
  // Linha 2: Distrito/Setor/Quadra/Lote/Unidade (compacto)
  // Linha 3: Situação + Natureza
  // Linha 4: Logradouro completo (tipo + nome + número + complemento)
  // Linha 5: CEP
  // Pula linhas pra mover cy adiante
}
```

Formatação:
- CEP renderizado como `65.930-000` (com máscara).
- Logradouro concatenado: `"RUA SÃO LUIS, 134, QUADRA: 114"`.
- Campos vazios não aparecem (skip linha inteira se todos vazios).

### 4.3 Endpoint Telegram ([src/server.ts](../../src/server.ts))

Novo endpoint, seguindo padrão de [`/api/vistorias/:id/enviar-telegram`](../../src/server.ts) (já existente):

```ts
app.post('/api/laudos-demarcacao/:id/enviar-telegram', requireCeoToken, async (req, res) => {
  try {
    const m = await import('./integrations/laudos');
    const result = await m.enviarLaudoTelegram({
      id: String(req.params.id),
      chatId: req.body?.chat_id,  // optional override
    });
    res.json(result);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
```

### 4.4 Função `enviarLaudoTelegram` ([src/integrations/laudos.ts](../../src/integrations/laudos.ts))

Padrão idêntico a `enviarVistoriaTelegram` em [vistorias.ts:585](../../src/integrations/vistorias.ts#L585):

```ts
export async function enviarLaudoTelegram(input: { id: string; chatId?: string }) {
  const l = await buscarLaudo(input.id);
  const chatId = input.chatId
    || (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
    || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  if (!chatId) throw new Error('chatId Telegram obrigatorio (TELEGRAM_LEAD_CHAT_ID ou TELEGRAM_AUTHORIZED_USER_IDS).');

  // Busca PDF assinado do DB (LONGBLOB)
  const pdfBuf = await getLaudoPdfAssinado(input.id);
  if (!pdfBuf) throw new Error('Laudo ainda nao foi assinado — assine antes de enviar.');
  if (pdfBuf.length > 50 * 1024 * 1024) {
    throw new Error(`PDF tem ${(pdfBuf.length / 1024 / 1024).toFixed(1)}MB e Telegram aceita ate 50MB.`);
  }

  const imovelCurto = (l.denominacao_imovel || l.endereco_imovel || 'imovel').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  const fileName = `Laudo_${l.numero_laudo}_${imovelCurto}.pdf`;
  const caption = `Laudo #${l.numero_laudo} — ${l.denominacao_imovel || l.endereco_imovel || ''}`;

  const { sendDocument: sendTelegramDocument } = await import('./telegram');
  try {
    await sendTelegramDocument(chatId, pdfBuf, fileName, caption);
  } catch (err) {
    const e = err as Error & { response?: { data?: { description?: string; error_code?: number } } };
    const desc = e.response?.data?.description || e.message;
    const code = e.response?.data?.error_code;
    throw new Error(`Telegram rejeitou: ${desc}${code ? ` (code ${code})` : ''}`);
  }
  return { ok: true as const, message: `Laudo #${l.numero_laudo} enviado via Telegram (chat ${chatId}, ${(pdfBuf.length / 1024).toFixed(0)} KB).` };
}
```

---

## 5. Frontend

### 5.1 Card BCI colapsável ([renderLaudoTabDados](../../src/public/obras.html#L14508))

Inserir novo card após card "Dados Registrais" (linha ~14595) e antes de card "Confrontantes":

```html
<div class="card">
  <div id="ld-bci-header" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
    <h3 style="margin:0;">🏛️ BCI (Boletim do Cadastro Imobiliário)</h3>
    <span id="ld-bci-chevron" style="font-size:14px;">▼</span>
  </div>
  <div id="ld-bci-body" style="display:none; margin-top:12px;">
    <p style="font-size:11px; color:var(--text-muted); margin:0 0 8px;">
      ℹ️ Opcional. Dados extraídos do BCI da Prefeitura — preencha o que tiver.
    </p>
    <div class="lp-grid-2">
      <input id="ld-bci-cod-imovel" placeholder="Cód. Imóvel" value="${escape(l.bci_cod_imovel||'')}">
      <input id="ld-bci-loc-cart" placeholder="Loc. Cartográfica (ex: 01.01.114.0249.00001)" value="${escape(l.bci_loc_cartografica||'')}">
    </div>
    <div class="lp-grid-5" style="margin-top:8px;">
      <input id="ld-bci-distrito" placeholder="Distrito" value="${escape(l.bci_distrito||'')}">
      <input id="ld-bci-setor" placeholder="Setor" value="${escape(l.bci_setor||'')}">
      <input id="ld-bci-quadra" placeholder="Quadra" value="${escape(l.bci_quadra||'')}">
      <input id="ld-bci-lote" placeholder="Lote" value="${escape(l.bci_lote||'')}">
      <input id="ld-bci-unidade" placeholder="Unidade" value="${escape(l.bci_unidade||'')}">
    </div>
    <div class="lp-grid-2" style="margin-top:8px;">
      <input id="ld-bci-situacao" placeholder="Situação (ex: Ativo)" value="${escape(l.bci_situacao||'')}">
      <input id="ld-bci-natureza" placeholder="Natureza (ex: Prédio, Terreno)" value="${escape(l.bci_natureza||'')}">
    </div>
    <div class="lp-grid-2" style="margin-top:8px;">
      <input id="ld-bci-logr-tipo" placeholder="Logradouro Tipo (ex: RUA)" value="${escape(l.bci_logradouro_tipo||'')}">
      <input id="ld-bci-logr-nome" placeholder="Nome do logradouro" value="${escape(l.bci_logradouro_nome||'')}">
    </div>
    <div class="lp-grid-3" style="margin-top:8px;">
      <input id="ld-bci-numero" placeholder="Número" value="${escape(l.bci_numero||'')}">
      <input id="ld-bci-cep" placeholder="CEP (8 dígitos)" maxlength="9" value="${escape(l.bci_cep||'')}">
      <input id="ld-bci-complemento" placeholder="Complemento" value="${escape(l.bci_complemento||'')}">
    </div>
  </div>
</div>
```

JS:
```js
// Estado lembrado em localStorage
const bciExpanded = localStorage.getItem('ld_bci_expanded') === '1';
if (bciExpanded) {
  document.getElementById('ld-bci-body').style.display = 'block';
  document.getElementById('ld-bci-chevron').textContent = '▲';
}
document.getElementById('ld-bci-header').onclick = () => {
  const body = document.getElementById('ld-bci-body');
  const chev = document.getElementById('ld-bci-chevron');
  const aberto = body.style.display !== 'none';
  body.style.display = aberto ? 'none' : 'block';
  chev.textContent = aberto ? '▼' : '▲';
  localStorage.setItem('ld_bci_expanded', aberto ? '0' : '1');
};
```

Adicionar os 14 campos ao `body` do handler `ld-salvar` existente.

### 5.2 Modal PDF Assinado

Substituir o handler atual de `data-laudo-pdf-sig` (que usa `window.open()`) por modal fullscreen:

```html
<!-- Modal injetado no body via JS quando clica em 🔏 Assinado -->
<div id="ld-pdf-modal" style="position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:9999; display:flex; flex-direction:column;">
  <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 16px; background:var(--surface); border-bottom:1px solid var(--gold-dim);">
    <strong style="color:var(--gold);">🔏 PDF Assinado — LAUDO-${escape(numero)}</strong>
    <button id="ld-pdf-modal-close" style="background:transparent; border:none; color:var(--text-muted); font-size:24px; cursor:pointer;">✕</button>
  </div>
  <iframe id="ld-pdf-iframe" src="/api/laudos-demarcacao/${id}/pdf-assinado" style="flex:1; width:100%; border:0;"></iframe>
  <div style="display:flex; gap:8px; padding:10px 16px; background:var(--surface); border-top:1px solid var(--gold-dim); justify-content:center; flex-wrap:wrap;">
    <button id="ld-pdf-baixar" style="background:var(--gold); color:#06120a; border-color:var(--gold);">💾 Baixar PDF</button>
    <button id="ld-pdf-telegram" style="background:#0088cc22; color:#0088cc; border:1px solid #0088cc55;">✈️ Telegram</button>
    <button id="ld-pdf-whatsapp" style="background:#25d36622; color:#25d366; border:1px solid #25d36655;">📱 WhatsApp</button>
  </div>
</div>
```

Botões:
- **Baixar**: `fetch + blob + a.download = filename + a.click()` (força download, não abre inline).
- **Telegram**: prompt opcional de chat_id (vazio = default CEO) + POST pra novo endpoint.
- **WhatsApp**: reaproveita handler `data-laudo-zapi` existente.
- **Fechar (✕ ou ESC)**: remove modal do DOM.

### 5.3 Botão Telegram no card (paralelo ao WhatsApp)

No card do laudo ([linha 13682](../../src/public/obras.html#L13682)):

```html
${l.assinado_em ? `<div style="display:flex; gap:4px; flex-wrap:wrap;">
  <button data-laudo-zapi="${l.id}" title="..." style="flex:1; background:#25d36622; color:#25d366; border-color:#25d36655;">📱 WhatsApp</button>
  <button data-laudo-telegram="${l.id}" title="Enviar pelo Telegram" style="flex:1; background:#0088cc22; color:#0088cc; border:1px solid #0088cc55;">✈️ Telegram</button>
</div>` : ''}
```

Handler `data-laudo-telegram`:
```js
v.querySelectorAll('[data-laudo-telegram]').forEach(b => b.onclick = async () => {
  const chatId = prompt('Chat ID Telegram (vazio = CEO):') || '';
  try {
    const r = await api('/api/laudos-demarcacao/' + b.dataset.laudoTelegram + '/enviar-telegram', {
      method: 'POST',
      body: JSON.stringify(chatId ? { chat_id: chatId } : {}),
      headers: { 'Content-Type': 'application/json' },
    });
    alert('✅ ' + r.message);
  } catch (err) { alert('Erro Telegram: ' + err.message); }
});
```

---

## 6. Versionamento e Deploy

Versão: **v3.5.0** (nova feature, não hotfix).

Ordem de commits (segue regra CEO — CACHE em sw.js é sempre o último):

1. `feat(laudo-v3.5.0): migration adiciona 14 campos BCI em romatec_laudos_demarcacao`
2. `feat(laudo-v3.5.0): tipos + CRUD para campos BCI em laudos.ts`
3. `feat(laudo-v3.5.0): seção 'Dados do BCI' no PDF de laudo`
4. `feat(laudo-v3.5.0): backend enviarLaudoTelegram + endpoint /enviar-telegram`
5. `feat(laudo-v3.5.0): UI card BCI colapsável com 14 campos + persistência`
6. `feat(laudo-v3.5.0): modal de visualização PDF Assinado com botões Baixar/Telegram/WhatsApp`
7. `feat(laudo-v3.5.0): botão Telegram no card do laudo (paralelo ao WhatsApp)`
8. `chore(v3.5.0): bump package.json + identity.ts para 3.5.0`
9. `chore(v3.5.0): bump SW cache to zayra-v3.5.0 (ÚLTIMO commit do PR)`

DOD universal de cada commit:
- `npm run typecheck` verde.
- Validação visual em viewports 360x800 e 412x915 quando UI muda (regra v3.3.0 mobile foundation).

DOD final pós-merge:
- Migration aplicada com sucesso no Railway (logs `[migrations:bci-v3.5.0] OK`).
- Criar laudo novo → preencher BCI parcial → salvar → re-abrir → BCI persistido.
- Re-assinar laudo com BCI → baixar PDF → bloco "Dados do BCI" aparece entre Registrais e Confrontantes.
- Click em "🔏 Assinado" → modal abre com iframe → botão Baixar funciona → botão Telegram funciona (PDF chega no chat do CEO) → botão WhatsApp funciona.
- Click em "✈️ Telegram" direto no card → PDF chega no Telegram do CEO.

---

## 7. Não-objetivos (v3.5.0)

Para evitar escopo creep, estes itens **NÃO** entram nesta versão:
- Auto-preenchimento BCI a partir do `endereco_imovel` (parser de logradouro/número).
- Importação em lote de BCI via XLSX/CSV.
- Validação de formato CEP no backend.
- Catálogo de tipos de logradouro (RUA, AVENIDA, etc) — texto livre por enquanto.
- Editor inline do PDF dentro do modal.
- Histórico de envios Telegram/WhatsApp (já existe log básico no `romatec_telegram_log`).
- Reaproveitar modal pra outros módulos (vistoria, recibo, proposta) — espelhar manualmente se necessário.

---

## 8. Riscos e Mitigação

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Iframe do PDF não renderiza em coletor industrial (sem PDF viewer) | Média | Fallback: se `<iframe>` falhar a carregar em 3s, mostra mensagem "Seu dispositivo não exibe PDF inline — clique em Baixar". |
| `TELEGRAM_LEAD_CHAT_ID` não configurado no Railway | Baixa (já está configurado em produção) | Endpoint retorna erro claro: "chatId Telegram obrigatorio...". Frontend mostra alert. |
| Migration falha em Railway (espaço, lock) | Muito baixa | Idempotente — try/catch ignora "Duplicate column". Se falhar por outro motivo, falha o boot e a versão anterior continua rodando. |
| PDF > 50MB rejeitado pelo Telegram | Baixa (laudo típico <2MB) | Erro tratado: "PDF tem X MB e Telegram aceita até 50MB". |
| Re-assinar laudo antigo SEM dados BCI ainda preenchidos | Esperado | Bloco BCI não aparece (já tratado por `temBci`). Cliente preenche BCI → re-assina → PDF atualizado. |

---

## 9. Estimativa

- **Migration + Backend:** ~2h (rotina, padrão estabelecido).
- **PDF seção BCI:** ~1.5h (PDFKit posicionamento manual).
- **UI card BCI:** ~1.5h (HTML + JS de toggle + localStorage).
- **Modal PDF Assinado:** ~2h (iframe + 3 botões + handlers).
- **Botão Telegram no card + handler:** ~30min.
- **Testes manuais multi-viewport:** ~1h.

**Total: ~8.5h** distribuído em 9 commits.
