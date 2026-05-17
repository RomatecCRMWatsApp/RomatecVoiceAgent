# Offline-first P0 — Smoke Test Checklist

Validacao manual final do plano `2026-05-16-offline-first-p0.md`. Roda no browser real (Chrome, iPhone Safari PWA, Android Chrome PWA).

**Como rodar:** abra `/obras` no aparelho, ative o DevTools (F12 no desktop), siga cada cenario.

**Pre-requisitos:**
- Build deployado com Phases A → E mergeadas.
- Usuario logado, com ao menos 1 obra existente e 1 colaborador na equipe.
- IndexedDB inspector aberto: DevTools → Application → IndexedDB (desktop) ou Safari Inspector → Storage.

---

## Cenario 1 — Criacao pura offline

**Goal:** garantir que mutacoes offline sao enfileiradas e replayadas sem perda.

- [ ] Online: open `/obras`, aguarda modal de full sync inicial fechar.
- [ ] DevTools → Network → Offline. Badge bottom-left fica vermelho `OFFLINE`.
- [ ] Cria obra `Smoke 1` via UI. Toast: "alteracoes ficam salvas localmente".
- [ ] DevTools → Application → IndexedDB → `romatec_offline_v1` → `pending_requests`: aparece 1 item `POST /api/obras` com `body` contendo `uuid_local`.
- [ ] Aba Obras na nav top mostra pill `1` amarela.
- [ ] Painel admin (Ctrl+Shift+O) lista o request pendente.
- [ ] Network → Online. Badge fica laranja `1 sincronizando` e em ~1s vira verde (some).
- [ ] Pill da aba some. Lista de obras mostra `Smoke 1` com `id` real.
- [ ] `idMap` do IndexedDB tem entrada do `uuid_local → id_real`.

## Cenario 2 — Cascata (parcela criada offline antes da obra subir)

**Goal:** confirmar que cascade replay traduz `obra_uuid_local` antes de enviar parcela.

- [ ] Online → ativa Offline.
- [ ] Cria obra `Smoke 2`. Anota o `uuid_local` no `pending_requests`.
- [ ] Sem reconectar: cria parcela na obra `Smoke 2`. Inspeciona request — body tem `obra_uuid_local: <uuid>` e `uuid_local: <novo>`.
- [ ] Network → Online. Console mostra `[offline] sincronizando 2 requests pendentes`.
- [ ] POST de obra roda primeiro (response tem `id`). PUT/POST de parcela traduz `obra_uuid_local → obra_id` antes do fetch.
- [ ] Em logs do server: `criarParcela` recebe `obra_id` numerico, nao string UUID.

## Cenario 3 — Anexo offline (foto + comprovante)

**Goal:** validar Phase D — blobs enfileirados sobem apos reconectar.

- [ ] Network → Offline.
- [ ] **Foto colaborador:** abre Editar membro → anexa foto. Toast "salva no aparelho". Preview circular aparece (FileReader).
- [ ] IndexedDB → `romatec_blobs` → `pending_blobs`: registro com `endpointTemplate: /api/equipe/:id/foto`, `uploaded: 0`, `blob: File`.
- [ ] **Comprovante:** abre fechamento aberto → anexa comprovante em algum item. Toast "salvo no aparelho".
- [ ] Outro registro em `pending_blobs` com `endpointTemplate: /api/folha/item/:id/upload-comprovante`.
- [ ] Aba Galeria mostra pill `📎2` roxa.
- [ ] Network → Online. Console: `[offline-blobs] drenando 2 anexos pendentes`. Toast: "2 anexos sincronizados".
- [ ] `pending_blobs`: registros com `uploaded: 1` (ficam no DB pra audit).
- [ ] Servidor: foto aparece no card do colaborador, recibo PDF do fechamento mostra foto + comprovante anexado no item.

## Cenario 4 — Crash do app no meio (recuperacao)

**Goal:** dados pendentes sobrevivem a `location.reload` e crash de aba.

- [ ] Offline. Cria 3 obras + 1 parcela.
- [ ] Mata o app (fecha aba, ou simula crash via DevTools → Memory → reload sem cache, ou Force Quit no PWA).
- [ ] Reabre `/obras`. Badge OFFLINE com count correto (4 pendentes).
- [ ] Network → Online. Replay roda. Tudo sobe na ordem `obras` → `parcelas` (cascade preservada).
- [ ] Nenhuma duplicacao: server log nao mostra POSTs duplicados pro mesmo `uuid_local`.

## Cenario 5 — Dead queue (item que falha 5x para de tentar)

**Goal:** item com erro persistente nao bloqueia replay dos outros.

- [ ] Offline → cria obra com nome vazio (vai dar 400 no server).
- [ ] Cria mais 2 obras normais.
- [ ] Online → replay. A obra vazia da 5x HTTP 400. Console mostra `tent 5`. Painel admin (Ctrl+Shift+O) mostra ela com `ultimoErro: HTTP 400`. As outras 2 obras subiram normal.
- [ ] Apos 5a tentativa, engine para de tentar (`tentativas >= 5 continue`). Fila nao fica em loop.
- [ ] Manual: usuario abre o painel, ve o erro, deleta a fila (botao Limpar Cache Local) OU edita manualmente o registro corrigindo o nome.

---

## Pos-validacao

- [ ] **TypeCheck:** `npm run typecheck` sem erros (jsdom resolvido apos `npm install`).
- [ ] **Testes Vitest:** `npx vitest run src/test/offline-p0.test.ts` — 50/50 verdes.
- [ ] **Railway logs (2 semanas):** olhar 1x por dia procurando:
  - Erros relacionados a `uuid_local` (campo desconhecido em INSERT)
  - Spike de POSTs duplicados (sync repetindo)
  - HTTP 500 em rotas P0
  - Se aparecer algo recorrente, abrir issue de fix antes de P1.

## Definicao de pronto da P0

Todos os 5 cenarios ✅ + bateria Vitest verde + 0 issues abertos referentes a offline-first em 2 semanas de prod.
