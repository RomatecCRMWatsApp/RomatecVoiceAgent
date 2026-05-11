# v3.4.0 — VTO Assinatura Digital ICP-Brasil + Data/Hora/Cidade

**Data:** 2026-05-10
**Tipo:** Feature aditiva (sem breaking changes)
**Escopo:** Adicionar hora + assinatura digital ICP-Brasil às vistorias (paridade com Recibos/Propostas)
**Bump de versão:** 3.3.0 → 3.4.0 (minor)

---

## 1. Contexto e Motivação

A VTO (Vistoria Técnica de Obra) atualmente gera PDF via PDFKit ([`gerarPdfVistoria`](../../../src/integrations/vistorias.ts) em `src/integrations/vistorias.ts:328`), mas:

- **Sem hora:** coluna `data` é `DATE` apenas — perde rastreabilidade do horário da vistoria (vistorias podem ocorrer no mesmo dia)
- **Cidade implícita:** já renderiza `obra.cidade` no endereço, mas sem destaque explícito
- **Sem assinatura digital:** documentos saem como PDF "comum" sem peso jurídico ICP-Brasil

Recibos (v1.99.3+) e Propostas (v2.0+) já têm assinatura ICP-Brasil via `signPdfBuffer()` reusável. **Esta versão reusa o mesmo padrão para VTO** — zero retrabalho de infraestrutura cripto, foco em integração + UI.

**Motivação operacional:** Vistorias com peso jurídico (ex: laudo de andamento de obra para liberação de medição, vistoria de pré-entrega) precisam de comprovação de quando e por quem foram feitas. Assinatura ICP-Brasil resolve isso no padrão MP 2.200-2/2001.

---

## 2. Arquitetura

### 2.1 Reuso do padrão existente

A feature reusa **3 componentes já em produção:**

| Componente | Origem | O que faz |
|---|---|---|
| `signPdfBuffer()` | `src/services/pdfSigner.ts` | Assinatura PAdES via signpdf + p12 |
| `getCertForSigning(perfil)` | `src/services/signingCertificates.ts` | Busca cert .pfx ativo (PJ ou PF) |
| Padrão `recibosAssinatura.ts` | `src/integrations/recibosAssinatura.ts` | Orquestração: buscar → gerar PDF → assinar → salvar |

**Novo módulo `vistoriasAssinatura.ts`** segue exatamente o mesmo formato de `recibosAssinatura.ts`, adaptando apenas:
- Função `buscarVistoria()` em vez de `buscarReciboPorId()`
- **Perfil PF default** (cert pessoal do CEO/RT — vistoria é ato técnico do profissional, não da empresa). Override para PJ se houver `body.perfil = 'pj'` no request
- Salva `pdf_assinado` em `romatec_obra_vistorias` em vez de `romatec_recibos`

### 2.2 Migration

Adicionar 4 colunas a `romatec_obra_vistorias` (idempotente, segue padrão de `migrations-clonagem-laudo.ts`):

```sql
ALTER TABLE romatec_obra_vistorias
  ADD COLUMN hora            TIME       NULL  AFTER data,
  ADD COLUMN pdf_assinado    LONGBLOB   NULL,
  ADD COLUMN assinatura_meta JSON       NULL,
  ADD COLUMN assinado_em     DATETIME   NULL;
```

**Por que `hora` separado em vez de migrar `data` para `DATETIME`:**
- Zero risco de quebrar registros existentes (vistorias antigas têm só DATE)
- Front pode hidratar tranquilamente: `data` → DATE input, `hora` → TIME input
- Backend retorna ambos separadamente; PDF concatena na renderização

### 2.3 Endpoints

**Novos:**
- `POST /api/vistorias/:id/assinar` — dispara assinatura, retorna meta
- `GET /api/vistorias/:id/pdf-assinado` — baixa PDF assinado (Content-Type application/pdf)

**Modificados:**
- `GET /api/vistorias/:id` — return passa a incluir `hora`, `assinado_em` boolean, `assinatura_meta`
- `POST /api/vistorias` + `PUT /api/vistorias/:id` — accept `hora` no body

### 2.4 PDF — modificações em `gerarPdfVistoria`

**Assinatura visual no PDF** segue o padrão `gerarPdfRecibo(recibo, signatureVisualMeta?)`:
- Função aceita parâmetro **opcional** `signatureVisualMeta`
- Quando fornecido, renderiza bloco "Assinado Digitalmente" antes do footer
- Quando ausente, PDF gera normalmente (sem bloco — usado pra preview ou cópia "rascunho")

**Layout de fotos: 2 por página (em vez de 1 por página atual):**

Atualmente cada foto ocupa 1 página inteira (linha 394-404 de `vistorias.ts`). **Novo layout:** 2 fotos por página, cada uma com sua legenda + carimbo GPS preservado (já embutido na imagem JPEG via Canvas durante a captura).

Cálculo de espaço para A4 (595×842pt, margem 48pt → área útil 499×746pt):

```
┌─────────────────────────────────────────────────────┐
│ Relatório Fotográfico — Vistoria #42                │  título: ~25pt
├─────────────────────────────────────────────────────┤
│ Foto 1 — <legenda> · Lat -5.x / Lng -47.x           │  caption: 25pt
│ ┌──────────────────────────────────────────────┐    │
│ │                                              │    │
│ │  [Foto 1 com carimbo GPS embutido]           │    │  imagem: ~310pt
│ │                                              │    │
│ └──────────────────────────────────────────────┘    │
│                                                     │  spacing: 20pt
│ Foto 2 — <legenda> · Lat -5.x / Lng -47.x           │  caption: 25pt
│ ┌──────────────────────────────────────────────┐    │
│ │                                              │    │
│ │  [Foto 2 com carimbo GPS embutido]           │    │  imagem: ~310pt
│ │                                              │    │
│ └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**Pseudo-código da mudança:**
```typescript
// ANTES: 1 foto por página
for (const f of fotos) {
  doc.addPage();
  doc.image(buf, { fit: [499, 650], ... });
}

// DEPOIS: 2 fotos por página, paginação em pares
for (let i = 0; i < fotos.length; i += 2) {
  doc.addPage();
  doc.fontSize(12).fillColor(corHex).text('Relatório Fotográfico', { ... });
  // Foto i (primeira da página)
  renderFoto(doc, fotos[i], i + 1);  // caption + image fit [499, 310]
  doc.moveDown(1);
  // Foto i+1 (segunda, se existir)
  if (fotos[i + 1]) renderFoto(doc, fotos[i + 1], i + 2);
}
```

**Por que 2 por página e não 4:**
- 4 por página ficaria com fotos muito pequenas (~150pt altura) — o carimbo GPS embutido (que já é uma faixa de ~3-4% da altura da imagem) ficaria ilegível
- 2 por página mantém ~310pt altura — carimbo permanece legível, vistoriador consegue conferir detalhes na imagem
- 1 por página (atual) desperdiça papel — vistoria com 10 fotos vira PDF de 14 páginas

**Carimbo GPS preservado:** o carimbo já está **embutido no pixel da imagem JPEG** (Canvas via `desenharCarimboGeo` na captura — v2.4.1+). O PDF apenas renderiza a imagem como está; sem trabalho adicional pra preservar o carimbo.

**Novo header — bloco "Dados da Vistoria" reformatado:**

```
RELATÓRIO DE VISTORIA TÉCNICA
Vistoria #42 · 12/05/2026

┌─────────────────────┬──────────────────────────────────────────┐
│ Data e Hora         │ 12/05/2026 às 14:32                      │
│ Local               │ Açailândia / MA                          │
│ Obra                │ Fazenda Glória — Rio Tigre Empreend.     │
│ Cliente             │ José Romário                             │
│ Endereço            │ Rod. BR-010, km 234, Zona Rural          │
│ Vistoriador         │ Eng. Civil João Silva (CREA-MA 12345)    │
│ Status              │ ATENÇÃO                                  │
└─────────────────────┴──────────────────────────────────────────┘
```

**Novo bloco no fim (só quando assinado):**

```
─────────────────────────────────────────────────────────────────
🔏 ASSINADO DIGITALMENTE — Padrão ICP-Brasil (MP 2.200-2/2001)

Signatário:         JOSE ROMARIO DOS SANTOS XAVIER
CPF:                123.456.789-00
Emissor:            AC SOLUTI SSL EV (cadeia AC RAIZ Brasileira v5)
Validade do cert:   até 15/03/2028
Data da assinatura: 12/05/2026 14:35:08 (UTC-3 / Brasília)
Thumbprint SHA-1:   a1b2c3d4e5f6...

Validável em: validar.iti.gov.br · Adobe Acrobat Reader
─────────────────────────────────────────────────────────────────
```

### 2.5 UI no `obras.html` (`renderVto`)

**Formulário (linha ~4702):**
- Adicionar input `<input id="vHora" type="time">` ao lado de `vData` no form-grid
- Auto-preencher com `new Date().toTimeString().slice(0,5)` quando criar nova vistoria
- Preservar valor ao editar (hidratar do registro)

**Preview de fotos capturadas (linhas ~4683-4689) — UI redesenhada:**

Hoje thumbnails 80×80px são ilegíveis — não dá pra conferir se o carimbo GPS aplicado na captura ficou OK antes de salvar. **Mudança:**

- **Thumbnails passam de 80×80 → 200×200px** com `object-fit: cover` (mantém aspect ratio)
- **Grid responsivo:** usa `.lp-grid-auto` (já existe do v3.3.0) — auto-fit `minmax(200px, 1fr)` no desktop, 1-2 colunas em mobile (~360-414px viewport)
- **Click no thumbnail abre lightbox modal** mostrando a foto em tamanho real (max 90vh / 90vw) — usuário consegue ler o carimbo GPS (lat/lng/UTM/datum/datetime) e confirmar que a foto está usável antes de salvar
- **Lightbox** tem:
  - Botão **×** no canto direito superior pra fechar
  - Setas **‹ ›** pra navegar entre fotos (esc/click fora também fecha)
  - Suporte a gesture pinch-to-zoom em mobile (CSS `touch-action: pinch-zoom`)
- **Botão remover** (×) e **input legenda** continuam abaixo de cada thumbnail
- Layout legenda ainda fica abaixo (não dentro) do thumbnail

**Card de vistoria na lista (linha ~4655):**
- Novo botão **🔏 Assinar** ao lado dos botões PDF/Enviar
- Quando `assinado_em` populado: substituir botão por badge verde **✅ Assinada em DD/MM/AAAA** + botão "Re-assinar" (segue padrão recibo)
- Botão **📄 PDF Assinado** quando `pdf_assinado IS NOT NULL`, separado do PDF normal

---

## 3. Fluxo Completo de Uso

1. Vistoriador em campo: preenche VTO (dados + fotos com carimbo GPS — v2.4.1+)
2. Salva — `data` e `hora` persistidos
3. No painel web (escritório): clica **🔏 Assinar** no card da vistoria
4. Backend: busca cert **PF (José Romário)** → gera PDF com bloco visual de assinatura → assina via signpdf → salva `pdf_assinado` no banco
5. Front recebe meta → atualiza UI com badge ✅
6. Clica **📄 PDF Assinado** → baixa PDF (validável em Adobe Reader / gov.br)

---

## 4. Decisões de Design

### 4.1 PDF assinado salvo no banco vs filesystem
**Decisão:** salvar em `pdf_assinado LONGBLOB` no MySQL (mesmo padrão de recibos).

**Por quê:**
- Railway não tem filesystem persistente entre deploys
- Banco já comporta blobs grandes (LONGBLOB suporta até 4GB)
- PDF de vistoria com fotos médias raramente passa 5MB (compressão JPEG 85% já aplicada)
- Mesmo padrão dos recibos — consistência arquitetural

### 4.2 Re-assinar é destrutivo?
**Decisão:** sim — `pdf_assinado` é sobrescrito ao re-assinar (mesmo padrão recibo).

**Por quê:**
- Não há valor em manter histórico de assinaturas (não é blockchain)
- Re-assinar é raro (só quando cert anterior expira ou foi revogado)
- Quem precisa de auditoria forensic pode usar o `assinatura_meta` JSON que guarda thumbprint + cert id + data

### 4.3 Cert PF default (decisão do CEO)
**Decisão:** assinatura VTO usa cert **PF** (José Romário) como padrão, diferente de Recibos (PJ default).

**Por quê:**
- Vistoria técnica de obra é **ato do profissional técnico**, não da empresa — é o RT que assina como autor do laudo, do mesmo jeito que um engenheiro assina ART
- Cert PF carrega o CPF + CN do profissional, dá peso jurídico ao parecer técnico
- Recibo (que continua PJ) é ato comercial da empresa — diferente natureza

**Override possível** via `POST /api/vistorias/:id/assinar` com body `{ perfil: 'pj' }` caso futuro vistoriador queira assinar como representante PJ. Implementação: aceitar campo opcional no endpoint, default PF se ausente.

### 4.4 Hora opcional vs obrigatória
**Decisão:** `hora TIME NULL` — opcional no DB, auto-preenchida com hora atual no front quando criar nova vistoria.

**Por quê:**
- Compatibilidade com registros antigos
- Vistoria velhinha sem hora ainda funciona, só não renderiza hora no PDF

---

## 5. Validação

### 5.1 Automatizada
- `npm run typecheck` deve passar
- **Sem novos testes Vitest** — padrão existente (recibo assinatura, laudo assinatura) não testa unitariamente; orquestração I/O com cert real

### 5.2 Manual — pós-deploy (assinatura)
1. Criar vistoria nova → confirmar campo Hora aparece auto-preenchido
2. Salvar vistoria → confirmar `hora` persistiu no banco
3. Clicar 🔏 Assinar → aguardar ~2-3s → confirmar badge ✅ "Assinada em..."
4. Clicar 📄 PDF Assinado → baixar PDF
5. Abrir PDF no Adobe Acrobat Reader → painel lateral "Assinaturas":
   - Confirmar **José Romário (CPF)** aparece como signatário (cert PF default)
   - Confirmar status "Assinatura válida" (cadeia ICP-Brasil)
   - Confirmar bloco visual "Assinado Digitalmente" renderiza correto no PDF
6. Validar em https://validar.iti.gov.br/validar → upload do PDF → conferir result "VÁLIDO"

### 5.3 Manual — pós-deploy (preview fotos)
1. Capturar uma foto via "📷 Adicionar fotos" → confirmar carimbo GPS embutido na imagem
2. Confirmar thumbnail no preview agora é **200×200** (não 80×80)
3. Click no thumbnail → confirmar lightbox abre com foto em tamanho real (≤90vh/90vw)
4. Confirmar carimbo GPS (lat/lng/UTM/datum/datetime) **legível** no lightbox em tamanho real
5. Setas ‹ › navegam entre fotos quando há mais de uma
6. ESC + X + click no overlay fecham o lightbox
7. Confirmar funcionamento em viewport 360×800 (Android baseline) e 412×915 (Pixel 7)

---

## 6. Critérios de Aceite

- [ ] Migration roda idempotente no boot (re-execução não falha)
- [ ] Campo `hora` aparece no form, auto-preenche, persiste no banco
- [ ] `obra.cidade` renderiza explícita no header do PDF (linha "Local: Açailândia / MA")
- [ ] Thumbnails de fotos no preview passam de 80×80 → 200×200px (grid responsivo)
- [ ] Click em thumbnail abre lightbox modal mostrando foto em tamanho real
- [ ] Lightbox permite navegar entre fotos com setas + fecha com X / ESC / click fora
- [ ] Carimbo GPS da foto eh legível no lightbox (lat/lng/UTM/datum visíveis)
- [ ] Botão 🔏 Assinar dispara assinatura, retorna meta em <5s
- [ ] PDF assinado validável no Adobe Reader como ICP-Brasil
- [ ] PDF assinado validável em validar.iti.gov.br (status VÁLIDO)
- [ ] Badge ✅ Assinada aparece após assinatura, mostra data
- [ ] Botão "Re-assinar" disponível e funcional
- [ ] PDF "rascunho" (sem assinatura) continua acessível em `/api/vistorias/:id/pdf`
- [ ] PDF renderiza **2 fotos por página** (em vez de 1)
- [ ] Carimbo GPS embutido em cada foto permanece legível no PDF
- [ ] Versão bumpada para 3.4.0 em package.json + identity.ts + sw.js

---

## 7. Versionamento

```
package.json     : 3.3.0 → 3.4.0
identity.ts      : 3.3.0 → 3.4.0
sw.js (CACHE)    : zayra-v3.3.0 → zayra-v3.4.0
```

**Tipo de bump:** minor (feature aditiva, zero breaking changes).

---

## 8. Riscos e Mitigações

| Risco | Mitigação |
|---|---|
| Cert .pfx PF (José Romário) vencer durante uso | `signPdfBuffer` já loga warning de cert vencido (não bloqueia); admin troca pelo painel |
| Cert PF ausente (nenhum .pfx cadastrado) | Erro claro: "Nenhum certificado digital PF cadastrado. Cadastre um .pfx em /obras admin antes de assinar." (mesma mensagem do recibo) |
| PDF muito grande pra LONGBLOB (>16MB) | LONGBLOB suporta 4GB; mas se acontecer (~50 fotos sem compressão), preventivo já existe em `vto:foto` que avisa se total > 50MB |
| Front cacheia versão antiga do `obras.html` após deploy | SW v3.4.0 rotaciona cache automaticamente (network-first p/ HTML) |

---

## 9. Pós-deploy: changelog Obsidian

Criar `06-Changelog/v3.4.0-vto-assinatura-icp-brasil.md` no vault Obsidian após validação em produção, seguindo padrão de `v3.2.0-cartorios-nacional.md` e `v3.3.0-mobile-foundation.md`.
