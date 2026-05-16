# Smoke Checklist — Offline-first P0 v3.16.0

> Pra cada cenário, marque ✅ ou ❌. Se ❌, abra issue.

## Pré-requisitos

- App rodando localmente OU em produção pós-deploy v3.16.0
- DevTools aberto pra simular offline (Network → Offline)
- 5 entidades P0 com dados de exemplo (criar 1 obra com 2 parcelas antes do teste)

---

## Cenário 1: Criação pura offline

- [ ] Desliga rede (DevTools throttle "Offline")
- [ ] Cria obra "Teste 1" → form fecha sem erro
- [ ] Badge OFFLINE aparece com count 1
- [ ] Cria 3 parcelas da obra Teste 1 (cada uma → count incrementa)
- [ ] Marca 1ª parcela como paga
- [ ] Religa rede
- [ ] Observa banner "🟢 Online — sincronizando…"
- [ ] Após 2-3s badge some
- [ ] Abre lista de obras: "Teste 1" aparece com ID real (não UUID)
- [ ] Abre Teste 1: 3 parcelas listadas, 1 marcada paga
- [ ] DevTools → Application → IndexedDB → romatec_offline_v1 → pending_requests está vazia
- [ ] romatec_offline_v1 → id_map tem mapeamentos pra Teste 1 + 3 parcelas

## Cenário 2: Edição com conflito

- [ ] Em 2 abas: A offline (devtools) + B online
- [ ] Aba A: edita observação da obra Teste 1 → "ABC"
- [ ] Aba B (online): edita mesma obra → "XYZ" + salva
- [ ] Aba A volta online → sincroniza
- [ ] Verifica: server tem "ABC" (cliente venceu)
- [ ] Console mostra log de sobrescrita (se implementado)

## Cenário 3: Anexo offline

> SKIPPED: módulos P0 não usam multipart uploads — todos os anexos são b64-em-JSON e já são cobertos pela fila de mutações. enfileirarBlob existe como infra mas não tem caller P0 nativo.

## Cenário 4: Crash recovery

- [ ] Offline com 10 mutações pendentes
- [ ] Fecha aba do navegador (simula crash)
- [ ] Reabre online
- [ ] Sync automática drena a fila em ~5s
- [ ] Sem perder nenhuma mutação

## Cenário 5: Fila de mortos (dead queue)

- [ ] Manualmente envenena uma mutação (devtools console):
      OfflineEngine.enfileirarOffline({ method: 'POST', path: '/api/obras', body: '{"nome":""}' })
- [ ] Religa rede
- [ ] Mutação dá 400 (nome vazio)
- [ ] Vai pra dead queue (>=5 tentativas)
- [ ] Badge ⚠️ aparece
- [ ] Click → vê detalhes → escolhe "descartar"

## Cenário 6: Painel admin

- [ ] Ctrl+Shift+O abre painel
- [ ] Cache stats mostram counts das 5 entidades
- [ ] Fila pendente listada
- [ ] Botão "Forçar full sync" funciona
- [ ] Botão "Limpar cache local" pede confirmação dupla e reseta

---

**Métricas de sucesso (após 2 semanas de uso):**

- [ ] 0 perdas de dado em campo
- [ ] Sync inicial < 30s pra 500 registros
- [ ] Replay de fila de 20 mutações < 10s
- [ ] Storage local < 30MB no uso médio

## Notas

- Tarefa D2 foi SKIPPED durante a implementação (módulos P0 não usam multipart).
  `enfileirarBlob` está implementado mas sem callers em P0.
- Conflict resolution é silenciosa (client-wins sem prompt).
- 62/62 testes Vitest verdes (incluindo cenários integrados end-to-end).
