# Dívida técnica — tabelas `users` duplicadas

**Status:** registrado em v3.24.0 (PR A Auth Foundation). Resolução planejada para v4.x.

## Contexto

O schema do projeto contém **duas tabelas chamadas `users`**, criadas em momentos diferentes da evolução do código.

### `users` linha 517 (LEGACY — OAuth)
Schema com `openId`, `loginMethod`, `role ENUM('user','admin')`. Origem: identidades OAuth de Telegram/Google/Spotify. **Uso atual:** virtualmente nenhum — rotas `/auth/telegram/setup`, `/auth/google/callback`, `/auth/spotify/callback` (server.ts:644-723) existem mas o código não popula essa tabela mais.

### `users` linha 1447 (SaaS NOVA — usada pela PR A)
Schema com `email`, `password_hash`, `failed_login_attempts`, `locked_until`, `mfa_secret/enabled`, `last_login_ip`. **Propósito atual:** auth de aplicação. PR A v3.24.0 usa essa.

## Por que MySQL aceita duas tabelas com mesmo nome

A `runMigrations()` em `migrations.ts` faz `CREATE TABLE IF NOT EXISTS users (...)` na linha 517 e DE NOVO na linha 1447. A segunda chamada é **no-op** se a tabela já existe (independente do schema).

**Comportamento real em prod:**
- Se a tabela `users` foi criada pela linha 517 PRIMEIRO → schema é o legacy (sem `password_hash`). A linha 1447 não cria nada.
- Se a linha 1447 rodou primeiro → schema é o SaaS. Linha 517 não cria nada.

Ordem real depende da versão que rodou primeiro no DB. **Não há garantia formal de qual schema está em prod.**

## Diretiva pra código novo

1. **Não tocar na linha 517.** Não drop, não rename, não migration que altere estrutura.
2. **Auth nova usa a 1447** (`password_hash`, `email`, etc).
3. **Antes do deploy de v3.24.0 em prod:** rodar manualmente no Railway DB:
   ```sql
   SHOW CREATE TABLE users;
   SELECT COUNT(*) FROM users;
   ```
   - Se mostrar schema legacy (com `openId`, `loginMethod`): **drop + recriar com schema 1447**. Antes verificar se `COUNT(*) > 0` e exportar pra backup.
   - Se schema é o SaaS (linha 1447): tudo certo, segue.

## Plano de resolução (v4.x)

- [x] **v3.24.0:** deixar a duplicação documentada (esta dívida) e PR A usa apenas a 1447
- [ ] **v3.25.x:** remover rotas OAuth obsoletas (`/auth/telegram/setup`, `/auth/google/callback`, `/auth/spotify/callback`) se confirmado que não há clientes externos usando
- [ ] **v4.0:** rename da legacy pra `users_oauth_legacy` (ou drop total se vazia). Migration de cleanup. Refactor de todos os lugares que referenciam.

## Risco de não resolver

- **Confusão futura:** dev novo lê `CREATE TABLE users` na linha 517 e tenta usar `openId` em código novo de auth — vai dar `Unknown column 'password_hash'`.
- **Migrations idempotentes incertas:** se alguém escrever `ALTER TABLE users ADD COLUMN X`, vai alterar QUAL das duas? A que existir em prod. Sem comportamento previsível.
- **Comentário SQL na tabela** (`ALTER TABLE users COMMENT = ...`) só atinge UMA delas — a que existir.

## Decisão registrada

Deixa duplicado em v3.24.0 pra não atrasar a PR A. Risco aceito porque:
1. Provavelmente prod tem `users` (1447) já — Railway era SaaS desde v2.x
2. A migration nova não toca em estrutura de `users`
3. Dívida visível neste doc + comentário SQL inline (`ALTER TABLE users COMMENT`) na migration auth
