# Validação Manual — Texto Explicativo de Serviço

Pré-requisito: server rodando (`npm run dev`) com Z-API conectada (vars
`ZAPI_INSTANCE_ID_ZAYRA`, `ZAPI_TOKEN_ZAYRA`, `ZAPI_CLIENT_TOKEN_ZAYRA` no .env).
Usar o número do próprio José Romário pra teste (não disparar pra cliente real).

## 1. Avulso — Remembramento
1. Abrir http://localhost:PORT/texto-explicativo.html
2. Selecionar tipo "Remembramento", tipo de imóvel "Urbano"
3. Preencher: cliente "Maria", número (próprio), município "Açailândia", UF "MA", qtd. imóveis 4
4. Clicar **Preview** → confirmar texto montado com nome e números corretos no `textarea`.
5. Clicar **Enviar via WhatsApp** → conferir chegada no WhatsApp.

## 2. Avulso — Desmembramento
1. Mesmo fluxo, mas tipo "Desmembramento", área total 5000, unidade m², qtd. frações 3, tipo de imóvel "Urbano".
2. Confirmar texto correto e envio.

## 3. Com Proposta — toggle ligado
1. Abrir http://localhost:PORT/proposta-remembramento.html
2. Criar proposta de Remembramento com cliente cadastrado e telefone válido (próprio número pra teste).
3. Garantir que o checkbox "Enviar texto explicativo junto com a proposta" está **LIGADO** (Step 5 do wizard).
4. Submeter a proposta (Criar proposta).
5. Conferir que o texto explicativo chega no WhatsApp.
6. Em seguida, no `/painel.html`, disparar o envio do PDF da proposta — conferir que ele chega depois do texto.

## 4. Com Proposta — toggle desligado
1. Mesma proposta, mas DESMARCAR o checkbox no Step 5.
2. Submeter.
3. Conferir que NÃO chega texto explicativo no WhatsApp (só o PDF, quando for disparado do painel).

## 5. Deduplicação
1. Em < 60s do envio anterior, clicar de novo o botão **Enviar somente o texto explicativo** na tela da proposta.
2. Conferir que o UI mostra "⚠️ Já enviado a este número há menos de 60s" e que NÃO chega mensagem duplicada no WhatsApp.
3. Conferir no banco:
   ```sql
   SELECT id, tipo_servico, modo_envio, status, enviado_em
     FROM textos_explicativos_envios
    ORDER BY id DESC LIMIT 5;
   ```
   Deve haver pelo menos 1 linha com `status='duplicado'`.

## 6. Edição de template via API
1. ```bash
   curl -X PUT http://localhost:PORT/api/explicativo/templates/remembramento \
     -H "Content-Type: application/json" \
     -d '{"template_texto":"TESTE EDIT {{cliente_nome}}","titulo":"Editado"}'
   ```
2. ```bash
   curl http://localhost:PORT/api/explicativo/templates
   ```
   Confirmar `template_texto` atualizado para o remembramento.
3. Restaurar o original com outro PUT (copiar de `src/database/migrations-explicativo.ts` `SEED_TEMPLATES`).

## 7. PUT em tipo inexistente — 404
1. ```bash
   curl -X PUT http://localhost:PORT/api/explicativo/templates/inexistente \
     -H "Content-Type: application/json" \
     -d '{"template_texto":"x"}'
   ```
   Conferir 400 com `{erro:"tipo inválido"}`.

## Critérios de aceitação
- [ ] Item 1 (avulso Remembramento) ok
- [ ] Item 2 (avulso Desmembramento) ok
- [ ] Item 3 (com proposta toggle ligado) ok
- [ ] Item 4 (com proposta toggle desligado) ok
- [ ] Item 5 (deduplicação 60s) ok
- [ ] Item 6 (edição via API) ok
- [ ] Item 7 (tipo inválido) ok

Em caso de falha: anotar mensagem de erro, status HTTP, conteúdo do `textos_explicativos_envios.erro_detalhe`, e abrir issue.
