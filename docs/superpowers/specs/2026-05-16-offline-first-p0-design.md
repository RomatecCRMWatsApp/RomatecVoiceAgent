# Offline-first P0 — Sistema de Gestão de Obras Romatec

**Data:** 2026-05-16
**Versão alvo:** v3.16.0
**Escopo:** Fase P0 (de um plano de 4 fases — P0, P1, P2, P3)

---

## Contexto

O sistema RomatecVoiceAgent é usado pelo CEO José Romário e equipe principalmente em campo de obra — local com conectividade instável. Hoje só **2 módulos** têm suporte offline (laudos-demarcacao + galeria de fotos), via uma fila IndexedDB com replay automático ao reconectar. Os outros **14 módulos** (~95% do sistema) **falham** quando offline.

Este spec formaliza a **Fase P0** — primeira de 4 fases de um roadmap de offline-first total. A escolha foi por uma abordagem **incremental** que estende o padrão existente (que já funciona em produção há tempos) ao invés de adotar bibliotecas novas (Dexie, PouchDB) ou reescrever a arquitetura.

**P0 cobre 5 módulos:** `obras`, `parcelas`, `recibos`, `despesas`, `equipe` — que juntos representam ~70% do uso real em campo. Próximas fases (P1/P2/P3) cobrirão o restante.

---

## Decisões fundamentais (do brainstorm)

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Abordagem | A — estender padrão atual | Reusa infra battle-tested, sem deps novas, entrega rápida |
| Cenário de uso | Misto (criação + edição + cascata) | Confirmado pelo usuário; precisa UUID + reconciliação |
| Anexos offline | Sim, essencial | Comprovantes/fotos enfileiram como Blobs em IndexedDB |
| Conflito | Cliente vence (silencioso) | Time pequeno, conflito raro, evita prompts intrusivos |
| Cache de leitura | Full sync | Usuário precisa ver tudo offline, não só o navegado |

---

## Arquitetura

```
┌─────────────────────────────────────────────────┐
│ UI (obras.html — JS inline)                     │
│   formulários, listas, badges                   │
├─────────────────────────────────────────────────┤
│ Camada de transporte (api() wrapper) ← MUDA     │
│   intercepta TODAS mutations P0; offline → fila │
├─────────────────────────────────────────────────┤
│ Fila offline (IndexedDB romatec_offline_v1)     │
│   pending_requests store (já existe, generaliza)│
├─────────────────────────────────────────────────┤
│ Cache de leitura (IndexedDB cache_v2) ← NOVO    │
│   stores: obras, parcelas, recibos, despesas,   │
│   equipe — full sync, indexes por id/uuid_local │
├─────────────────────────────────────────────────┤
│ Mapa de UUIDs (IndexedDB id_map) ← NOVO         │
│   uuid_local → server_id (preenche pós-sync)    │
├─────────────────────────────────────────────────┤
│ Anexos (IndexedDB romatec_blobs) ← NOVO         │
│   Blob (foto/comprovante) + ref via uuid_local  │
├─────────────────────────────────────────────────┤
│ Sync engine (sincronizarFilaOffline ampliado)   │
│   replay FIFO + reconciliação de IDs em cascata │
├─────────────────────────────────────────────────┤
│ Service Worker (sw.js)                          │
│   network-first com fallback IndexedDB nas GETs │
└─────────────────────────────────────────────────┘
```

**Política em 3 frases:**
1. Toda mutação P0 vai pra IndexedDB primeiro; se online, dispara HTTP imediato; se offline, fica na fila.
2. Toda leitura P0 tenta network primeiro; se falhar/offline, lê do cache IndexedDB.
3. Quando volta online, drena a fila FIFO; se mutação cria coisa nova (POST com `uuid_local`), captura o ID retornado e atualiza todas as mutações filha que referenciam esse `uuid_local`.

---

## Componentes

### 1. Fila de mutações (estende `pending_requests` em `romatec_offline_v1`)

**Schema da entrada:**
```ts
{
  id: number,                    // auto-incremento
  ts: number,                    // Date.now() ao enfileirar
  tentativas: number,            // contador de retries
  method: 'POST'|'PUT'|'DELETE',
  path: string,                  // /api/obras, /api/obras/<uuid:XXX>, /api/parcelas, etc.
  body: object,                  // payload JSON
  headers: object,               // Content-Type etc.
  uuid_local_criado?: string,    // só em POSTs (entidade criada)
  ultimoErro?: string,
  status: 'pending'|'replaying'|'failed_dead'
}
```

**Política de erro:**
- `4xx` → `status = 'failed_dead'`, badge ⚠️ N falhas, user pode "tentar de novo" / "descartar"
- `5xx` ou rede → backoff exponencial: 5s, 30s, 2min, 10min, 1h. Após 5× → `failed_dead`.

### 2. UUID + reconciliação em cascata

**Geração:** ao fazer POST de criação, `api()` injeta `body.uuid_local = crypto.randomUUID()` antes de enfileirar.

**Replay (cenário em campo):**
```
Estado offline:
  fila: [
    {POST /api/obras,     body:{nome:"X", uuid_local:"AAA"}},
    {POST /api/parcelas,  body:{obra_uuid_local:"AAA", uuid_local:"BBB-1", valor:5000}},
    {POST /api/parcelas,  body:{obra_uuid_local:"AAA", uuid_local:"BBB-2", valor:5000}},
    {PUT  /api/parcelas/<uuid:BBB-1>, body:{pago:true}},
  ]

Volta online → drena FIFO:
  1. POST obras   → server retorna {id:42}     → id_map["AAA"] = 42
  2. POST parcelas → traduz body.obra_uuid_local "AAA" → body.obra_id 42 → envia → {id:100} → id_map["BBB-1"] = 100
  3. POST parcelas → mesma traduzida → {id:101} → id_map["BBB-2"] = 101
  4. PUT parcelas/<uuid:BBB-1> → traduz path → PUT /api/parcelas/100 → envia
```

**Schema do `id_map` (IndexedDB):**
```ts
{ uuid_local: string (key), entidade: string, server_id: number, mapped_at: number }
```

### 3. Cache de leitura (novo IndexedDB `cache_v2`)

**Stores (uma por entidade P0):**
- `obras`     — keyPath `id`, indexes: `status`, `uuid_local`
- `parcelas`  — keyPath `id`, indexes: `obra_id`, `vencimento`, `uuid_local`
- `recibos`   — keyPath `id`, indexes: `tipo`, `uuid_local`
- `despesas`  — keyPath `id`, indexes: `categoria`, `data`, `uuid_local`
- `equipe`    — keyPath `id`, indexes: `funcao`, `uuid_local`
- `sync_meta` — keyPath `entidade`, fields: `last_full_sync_at`, `last_delta_sync_at`

**Estratégia de sync (3 momentos):**
1. **Full sync inicial** (1ª vez ou após `Clear site data`): GET de tudo, salva tudo. UI mostra progresso, demora 10-30s.
2. **Delta sync** (cada abertura online): GET `?since=<last_sync>` — só registros modificados. Rápido (1-3s).
3. **Sync incremental ao vivo**: após cada mutação confirmada, atualiza só o registro afetado.

**Tamanho realista:** 5 entidades × ~500 registros × ~2KB ≈ **~5MB**. Bem dentro dos 50MB que browsers permitem sem prompt.

### 4. Anexos (novo IndexedDB `romatec_blobs`)

**Schema:**
```ts
{
  id: auto,
  uuid_local: string,            // referencia o registro pai
  campo: string,                 // 'comprovante', 'foto', etc.
  filename: string,
  mime: string,
  blob: Blob,                    // arquivo em si
  ts: number,
  tentativas: number,
  uploaded: boolean,
  server_url?: string            // após sucesso
}
```

**Replay:** após `id_map` ser atualizado, procura blobs com mesmo `uuid_local`, faz POST multipart pro endpoint correspondente.

**Resiliência:** foto > 10MB alerta + oferece compressão (canvas resize). Falha 5× → fila de mortos.

### 5. UI / Indicadores

**Mantém (já existe):** badge flutuante 🔴/🟡/oculta, toasts, click → modal com pendentes.

**Adiciona:**
- Indicador por aba: `📋 Obras (12) 🟡 3↻` (3 mutações pendentes), `⚠️ 1✕` (1 morta)
- Badge em items não-sincronizados nas listas (pelo `uuid_local` sem `server_id`)
- Modal "Primeira sincronização" bloqueante na 1ª vez (10-30s, com progresso por entidade)
- Modal "Reconectando" não-bloqueante quando volta online com fila gorda
- Painel admin escondido (rota `/offline-status`): cache stats, última sync, fila detalhada, botões "Forçar full sync" / "Limpar cache local"
- Conflito (cliente vence) **silencioso** — sobrescreve, log no console pra auditoria

---

## Mudanças necessárias no Backend

**Pequenas (~1-2 dias dev):**
1. Aceitar `uuid_local` em todos os POST P0 (apenas armazena na resposta, não persiste em coluna nova)
2. Devolver `uuid_local` em todas as respostas de POST
3. Adicionar `?since=<ISO>` em GETs de listagem das 5 entidades P0
4. (Opcional, otimização) `POST /api/sync/batch` — replay em lote de N mutações em uma só request

**Endpoints de upload já cobertos (vi nos endpoints):**
- ✅ POST `/api/despesas-extras/{id}/comprovante`
- ✅ POST `/api/galeria`
- ✅ POST `/api/laudos-demarcacao/{id}/fotos`

**Adicionar pra P0:**
- POST `/api/recibos/{id}/anexo` (verificar se já existe)
- POST `/api/equipe/{id}/foto` (avatar)

---

## Estratégia de testes

**Automatizados (Vitest)** — `src/test/offline-p0.spec.ts`:
- POST offline gera `uuid_local` e enfileira
- POST → resposta → atualiza `id_map`
- PUT/`<uuid:XXX>` traduz pra PUT/`<id_real:42>` antes de enviar
- Cascata: obra (uuid AAA) + parcela (obra_uuid AAA) → ao replay, parcela usa obra_id=42
- Conflito client-wins: PUT offline + GET volta diferente → mutation prevalece
- Backoff: erro 500 enfileira de novo com delay exponencial
- Erro 4xx vai pra fila de mortos
- Blob anexado offline → re-upload pós-sync com FormData multipart

**Smoke manual (checklist):**
1. **Criação pura offline** — desliga rede, cria obra+3 parcelas, marca 1 paga, religa, observa sync, confirma IDs reais.
2. **Conflito** — 2 abas (A offline edita "ABC", B online edita "XYZ"), A volta online, server tem "ABC", console log mostra sobrescrita.
3. **Anexo** — offline cria despesa+foto, preview imediato (URL.createObjectURL), religa, blob vira URL servida.
4. **Crash recovery** — offline com 10 mutações, fecha aba, reabre online, fila drena sem perder nada.
5. **Fila de mortos** — envenena uma mutação (body inválido), religa, vai pra dead queue, badge ⚠️, click → "descartar".

**Métricas de sucesso (após 2 semanas de uso):**
- 0 perdas de dado em campo
- Sync inicial < 30s pra 500 registros
- Replay de fila de 20 mutações < 10s
- Storage local < 30MB no uso médio

**Regressão:** o fluxo atual de laudos offline NÃO pode quebrar — smoke test em laudos a cada release.

---

## Arquivos a modificar / criar

### Frontend (`src/public/`)
- `obras.html` — estender `api()` wrapper, generalizar `ehMutacaoLaudo` → `ehMutacaoP0`, generalizar `getLaudosOfflineLocal` pros 5 módulos, adicionar `loadXxx()` com fallback de cache, criar funções de full/delta sync, adicionar painel admin offline
- `sw.js` — opcionalmente adicionar fallback IndexedDB pras GETs (otimização, não bloqueante)
- (Possivelmente) extrair `offline-engine.js` separado pra organização (~600 linhas previstas), mas pode ficar inline em obras.html se preferir

### Backend (`src/`)
- `server.ts` — adicionar `?since=` aos handlers GET de obras/parcelas/recibos/despesas/equipe
- Aceitar e devolver `uuid_local` nos POSTs P0 (echo no JSON de resposta)
- Possivelmente adicionar `POST /api/sync/batch` (otimização)

### Database
- Nenhuma migration nova obrigatória pro P0
- (Opcional P1+) coluna `uuid_local VARCHAR(36)` nas tabelas pra rastreabilidade

### Testes
- `src/test/offline-p0.spec.ts` (novo)

---

## Estimativa

| Etapa | Dias |
|-------|------|
| Generalizar fila + UUID + cascata | 2 |
| Cache de leitura (full + delta) | 2 |
| Anexos offline (Blobs) | 1 |
| UI indicadores + admin panel | 1 |
| Backend: `uuid_local` echo + `?since=` | 1 |
| Testes Vitest + smoke manual | 1 |
| Buffer / ajustes | 1 |
| **Total** | **~9 dias dev** |

---

## Verificação end-to-end

Após implementar, validar com:

1. `npm run typecheck` — sem erros
2. `npm test` — Vitest passa, incluindo `offline-p0.spec.ts`
3. Deploy em produção (Railway)
4. Executar os 5 cenários smoke manuais documentados acima
5. Monitorar Railway logs por 2 semanas — alertar se aparecer erro inesperado de fila

---

## Próximas fases (não cobertas neste spec)

- **P1 (Operacional):** vistorias + materiais + diário + folha + transações + etapas (~1 semana)
- **P2 (Fiscal/Documentos):** NFs + propostas + contratos. Conflict resolution real (modal merge). Background Sync API. (~2 semanas)
- **P3 (Polish/Resiliência):** sync seletivo, dedup avançado, assinatura digital offline, anexos grandes em chunks. (~2 semanas)

Cada fase terá seu próprio spec + plano de implementação após esta P0 ser entregue e validada em produção.
