# Completar Módulos VTA (As-Built) — Implementation Plan (v3.53.0+)

**Goal:** Fechar as lacunas dos módulos VTA após a integração As-Built no laudo
(v3.51.1) e os pontos de entrada vinculados (v3.52.0). Prioridade: dar ao
Relatório Fotográfico (Módulo B) um **PDF técnico autônomo e assinável** — peça
exigida em averbação/REURB à parte do laudo — e depois sanear dívidas técnicas
do Canvas (Módulo A) e do rasterizador.

**Estado atual (feito):**
- Módulo A: editor Konva, prancha A3 com carimbo, export PNG/WhatsApp, vínculo a
  laudo, carga do croqui em modo edição (`/api/canvas/por-laudo`).
- Módulo B: captura com overlay técnico (GPS/UTM/SIRGAS/rosa dos ventos),
  vínculo a laudo, envio WhatsApp.
- Laudo PDF: croqui As-Built (seção 10) + fotos georreferenciadas (11.3) + nota
  NBR 13133/NTGIR (`laudoAnexos.ts`).

## File Structure

```
src/services/relatorioFotograficoPdf.ts      (novo)  — gerador PDF do Módulo B
src/services/relatorioFotograficoPdf.test.ts (novo)  — testes puros (helpers)
src/routes/relatorioFotografico.ts           (alt)   — GET /:id/pdf + /:id/assinar + /:id/enviar-telegram
src/public/vta-relatorio-fotografico.html    (alt)   — botões PDF / Assinar / Telegram
src/public/obras.html                        (alt)   — (já tem botão Relatório no card; sem mudança)
src/routes/canvasGrafico.ts                  (alt)   — DECISÃO canvas_elementos (usar ou remover rotas mortas)
src/public/vta-canvas.html                   (alt)   — re-vínculo de cotas na rehidratação
src/services/laudoAnexos.ts                  (alt)   — log de degradação do rasterizador
Dockerfile / nixpacks.toml                   (alt)   — garantir libs nativas (canvas/sharp) no deploy
```

---

## Task 1: Gerador de PDF do Relatório Fotográfico (Módulo B)

**Objetivo:** documento PDF profissional — capa (timbre Romatec, título, vínculo
ao laudo, colaborador, município, data), grid de fotos com overlay já embutido
(`fotos_vistoria.base64_overlay`) + legenda técnica, e bloco de assinatura
técnica (CFT/CREA/CNAI). Reusa padrão visual de `laudoPdf.ts`/`reciboPdf.ts`.

- [ ] **Step 1: Helpers puros + teste falhando** — `relatorioFotograficoPdf.test.ts`:
  testar `legendaFotoRelatorio(foto)` (descrição + UTM/SIRGAS + colaborador +
  horário) e `paginarFotos(fotos, porPagina)` (grid 2×2). Sem DB. (Pode reusar
  `legendaTecnicaFoto` de `laudoAnexos.ts` — extrair pra módulo comum se preciso.)
- [ ] **Step 2: Rodar teste pra ver falhar** — `npm test -- relatorioFotograficoPdf`.
- [ ] **Step 3: Implementar `relatorioFotograficoPdf.ts`** — `gerarPdfRelatorioFotografico(input)`
  com PDFKit: cabeçalho/timbre, dados da vistoria, grid de fotos (parse do
  data-URI `base64_overlay` → Buffer), legenda, rodapé com assinatura técnica e
  hash de validação. Aceita `signatureMeta?` (mesmo padrão do laudo).
- [ ] **Step 4: Rodar testes pra ver passar.**
- [ ] **Step 5: Type-check** — `npm run typecheck`.
- [ ] **Step 6: Commit** — `feat(vta): gerador de PDF do Relatorio Fotografico (Modulo B)`.

## Task 2: Rotas PDF + Assinatura ICP do Relatório

- [ ] **Step 1: `GET /api/relatorio-fotografico/:id/pdf`** em `relatorioFotografico.ts`
  — carrega relatório + `fotos_vistoria`, chama `gerarPdfRelatorioFotografico`,
  responde `application/pdf` inline.
- [ ] **Step 2: `POST /:id/assinar`** — reusa `signingCertificates.getCertForSigning`
  + `pdfSigner.signPdfBuffer` (PAdES ICP-Brasil), igual ao laudo; persiste PDF
  assinado (coluna nova `pdf_assinado` em `relatorios_fotograficos` via migração
  idempotente).
- [ ] **Step 3: Type-check + smoke manual** (gera PDF de um relatório real).
- [ ] **Step 4: Commit** — `feat(vta): rota PDF + assinatura ICP do Relatorio Fotografico`.

## Task 3: Botões PDF / Assinar / Telegram na UI do Módulo B

- [ ] **Step 1: `vta-relatorio-fotografico.html`** — botões "📄 PDF",
  "🔏 Assinar", "✈️ Telegram" (este reusa o envio que o laudo/Canvas já têm).
- [ ] **Step 2: `POST /:id/enviar-telegram`** na rota (espelha `enviar-whatsapp`,
  usando o sender Telegram já existente em `integrations`).
- [ ] **Step 3: Smoke manual** (abrir relatório vinculado a laudo → PDF/assinar).
- [ ] **Step 4: Commit** — `feat(vta): UI PDF/assinar/telegram no Relatorio Fotografico`.

---

## Task 4: Decisão sobre `canvas_elementos` (dívida técnica)

A tabela `canvas_elementos` + rotas CRUD existem mas a página salva tudo em
`dados_svg`/`dados_json` no registro do canvas — as rotas estão mortas.

- [ ] **Step 1: Decidir** — (a) passar a persistir elementos individuais
  (camadas/edição granular) OU (b) remover as rotas `/:id/elementos*` e marcar a
  tabela como reservada. Default recomendado: **(b)** (YAGNI; `dados_json` já
  basta pra rehidratar).
- [ ] **Step 2: Implementar a decisão** + atualizar comentário da migração.
- [ ] **Step 3: Type-check + Commit.**

## Task 5: Re-vínculo de cotas na rehidratação do croqui

Ao reabrir um croqui salvo, as cotas voltam como texto solto (perdem o vínculo
dinâmico com a linha — editar a linha não atualiza a medida).

- [ ] **Step 1: `vta-canvas.html`** — ao re-hidratar via `Konva.Node.create`,
  reconstruir o mapa `cotaLabels` associando cada `Konva.Line` de cota ao seu
  `Konva.Text` (por `cotaLabelId` salvo no JSON).
- [ ] **Step 2: Teste jsdom** de `carregarVinculado` (mock fetch + Konva) — pelo
  menos: seta `canvasId`, adiciona N nós ao layer. Cobre a lacuna #6 do gap.
- [ ] **Step 3: Smoke manual** (editar linha de cota reabre e recota).
- [ ] **Step 4: Commit.**

## Task 6: Robustez do rasterizador As-Built

`laudoAnexos.rasterizarSvg` depende de sharp/node-canvas; sem binário, o croqui
é omitido em silêncio no PDF.

- [ ] **Step 1: Log explícito** em `laudoAnexos.ts` quando `rasterizarSvg`
  retornar null com SVG presente (`console.warn('[laudoAnexos] rasterizador
  indisponivel — croqui As-Built omitido')`).
- [ ] **Step 2: Garantir libs nativas no deploy** — conferir `Dockerfile`/
  `nixpacks.toml` instalam as deps de `node-canvas` (libcairo/pango/jpeg) e/ou
  `sharp`. Ajustar se faltarem.
- [ ] **Step 3: Commit.**

---

## Verificação final (Definition of Done)
- `npm run typecheck`: 0 erros.
- `npm test`: suíte verde, incluindo novos testes de `relatorioFotograficoPdf` e
  `carregarVinculado`.
- Smoke: a partir de um laudo → Relatório Fotográfico → captura → **PDF assinável**
  gerado; croqui reaberto em modo edição com cotas vinculadas.
- Bump de versão (`package.json`, fonte única) + changelog em `06-Changelog`.

## Prioridade sugerida
Task 1 → 2 → 3 (PDF assinável do Módulo B, maior valor pra regularização) e só
depois 4 → 5 → 6 (dívidas técnicas e robustez).
