# ZAYRA / RomatecVoiceAgent — Guia Geral do Sistema

Documento mestre de convenções do projeto. Vale para qualquer pessoa ou agente
que mexa no código. **Leia a seção de release antes de cada `git push origin main`.**

## Identidade

- **Produto:** ZAYRA (Zona de Automação e Yield Romatec Agent) — assistente
  executivo da Romatec Consultoria Total.
- **CEO:** José Romário · **Local:** Açailândia/MA.
- **Stack:** Node.js 22 + TypeScript + Express + MySQL2.
- **Deploy:** Railway, automático a cada push na branch `main`.
- **Versão atual:** ver `package.json` (campo `version`) — fonte única da verdade.

## ⚠️ Regra de release — versionar SEMPRE junto com main/deploy

**Todo push para `main` (que dispara deploy no Railway) DEVE subir com o bump da
versão no mesmo commit.** Sem exceção. Commit que altera código de produção e não
mexe em `package.json` está incompleto.

Por quê: o badge de versão, a barra de status da gestão e o `buildTime` leem a
versão de `package.json`. Se a versão não muda, o time vê "deploy OK no Railway,
mas o app continua na versão antiga" e ninguém sabe se subiu. O Service Worker
também só invalida cache quando a versão muda.

### Fluxo obrigatório a cada deploy

```bash
cd "C:\Users\Ronicley Pinto\Documents\RomatecVoiceAgent"

# 1. Bump da versão (escolha o nível — ver Semver abaixo)
npm version patch --no-git-tag-version      # 3.61.1 -> 3.61.2
# npm version minor --no-git-tag-version    # 3.61.1 -> 3.62.0
# npm version major --no-git-tag-version    # 3.61.1 -> 4.0.0

# 2. Commit do código JUNTO com o package.json
git add -A
git commit -m "vX.Y.Z: descricao curta do que mudou"

# 3. Push -> deploy automatico no Railway
git push origin main
```

> `--no-git-tag-version` evita que o `npm version` crie tag/commit sozinho — o
> bump entra no mesmo commit das mudanças, do nosso jeito.

### Semver (X.Y.Z)

- **patch (Z):** correção de bug, ajuste pequeno, sem mudar comportamento esperado.
- **minor (Y):** funcionalidade nova retrocompatível (nova aba, novo endpoint, etc).
- **major (X):** mudança que quebra compatibilidade (schema, contrato de API, etc).

## Fonte única da versão

`package.json` → `readPackageVersion()` em `src/agent/identity.ts`
(`AGENT_IDENTITY.version`) → exposto em `/health` e `/api/version` (com `buildTime`
= horário do boot/deploy) → consumido pela barra de status (`obras.html`) e pelo
Service Worker. **Nunca** hardcode a versão em outro lugar; sempre puxe de
`package.json`. O teste `src/test/versao-fonte-unica.test.ts` protege isso.

## Padrões de código

- TypeScript estrito, `tsc --noEmit` limpo antes de commitar (`npm run typecheck`).
- Tratamento de erro em toda rota; nada de placeholder em produção.
- Chamadas `fetch` no front que batem em rota protegida usam
  `credentials: 'include'` (cookie httpOnly `zayra_auth`). Em 401, redireciona
  para `/login?next=<origem>`.
- Front estático em `src/public/` — o build copia para `dist/public`
  (`npm run build` = `tsc && cp -r src/public dist/public`).
- Comentários de mudança marcam a versão: `// vX.Y.Z: motivo`.

## Comandos úteis

| Ação | Comando |
|------|---------|
| Dev (watch) | `npm run dev` |
| Build | `npm run build` |
| Start (prod) | `npm start` |
| Typecheck | `npm run typecheck` |
| Testes | `npm test` |

## Checklist antes do push para main

1. `npm run typecheck` limpo.
2. `npm test` passando (ou ao menos os testes da área alterada).
3. **Versão bumpada em `package.json`** (regra acima).
4. Mensagem de commit no formato `vX.Y.Z: ...`.
5. `git push origin main` → acompanhar o build no painel do Railway.
