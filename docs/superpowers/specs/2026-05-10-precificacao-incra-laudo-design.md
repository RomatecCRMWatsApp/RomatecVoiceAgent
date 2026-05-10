# Spec — Precificação Automática INCRA para Laudo de Demarcação

**Data:** 2026-05-10
**Versão alvo:** v3.0.0 (bump major a partir de v2.11.0)
**Branch:** `feat/precificacao-incra-laudo`
**Módulo:** Laudo Técnico de Demarcação de Lotes
**Escopo:** 1 PR único (schema + service + endpoints + UI + PDF + testes), sem merge — aguarda review do CEO.

---

## 1. Objetivo

Implementar precificação automática de laudos de demarcação de imóveis rurais com base na **Portaria INCRA nº 12, de 23 de abril de 2025** (3ª Edição da Norma Técnica para Georreferenciamento de Imóveis Rurais), com:

- Auto-preenchimento dos 6 critérios de pontuação a partir dos dados já cadastrados no laudo (com edição manual permitida)
- Cálculo do valor base por 3 unidades selecionáveis (km linear, hectare, lote)
- Aplicação de desconto (percentual OU valor fixo, à escolha do usuário)
- Seção dedicada no PDF do laudo mostrando critérios, faixa, valor base, desconto e valor final, com referência à Portaria
- 3 linhas de resumo INCRA também no Recibo associado

## 2. Decisões arquiteturais

Resolvidas no brainstorming antes de codar:

| Decisão | Escolha | Razão |
|---|---|---|
| Versão | **v3.0.0** | CEO escolheu major bump |
| Validação de input | **Manual em TS** | Zod não está no projeto; padrão atual é manual |
| Sharing front/back | **2 arquivos paralelos** (`incra.ts` no back + `incraCalc.js` no front) | Front é vanilla JS sem bundler; cálculo precisa ser local pra UX |
| Mitigação de drift back/front | **Teste de paridade** com 54 cenários | Garante TS e JS calculam o mesmo |
| `valor_servico` legado | **INCRA sobrescreve quando usada**; read-only no form quando aplicada | Mantém compat com laudos antigos sem precificação INCRA |
| Recibo | **3 linhas de resumo INCRA** (faixa + valor base + desconto) | Justifica valor sem virar memorial técnico |
| Organização | **`src/services/pricing/incra.ts`** | Repo já tem `pricing/averbacao.test.ts` |
| Entrega | **1 PR único** | Feature coesa; review como conjunto |

## 3. Schema do banco

**Arquivo novo:** `src/database/migrations-precificacao-incra.ts`

Segue o padrão de `migrations-laudos.ts` (`pool.execute()` em try/catch individual, idempotente). Roda no boot via `runPrecificacaoIncraMigrations()` chamada pelo `server.ts`, paralela a `runLoteamentosMigrations`.

Adiciona em `laudos_demarcacao` (todas NULLABLE):

```sql
ALTER TABLE laudos_demarcacao
  ADD COLUMN unidade_calculo ENUM('km','hectare','lote') NULL
    COMMENT 'Unidade base do cálculo INCRA',
  ADD COLUMN pont_vegetacao TINYINT NULL
    COMMENT '1-10 conforme Quadro 1 Portaria INCRA 12/2025',
  ADD COLUMN pont_relevo TINYINT NULL,
  ADD COLUMN pont_insalubridade TINYINT NULL,
  ADD COLUMN pont_acesso TINYINT NULL,
  ADD COLUMN pont_clima TINYINT NULL,
  ADD COLUMN pont_area_media TINYINT NULL,
  ADD COLUMN pontuacao_total SMALLINT NULL
    COMMENT 'Soma dos 6 critérios (6 a 60)',
  ADD COLUMN faixa_aplicada VARCHAR(10) NULL
    COMMENT 'Ex: "26-35"',
  ADD COLUMN valor_unitario DECIMAL(12,2) NULL
    COMMENT 'R$/km, R$/ha ou R$/lote conforme unidade',
  ADD COLUMN quantidade_calculo DECIMAL(14,4) NULL
    COMMENT 'km, ha ou nº lotes',
  ADD COLUMN valor_base_calculado DECIMAL(14,2) NULL,
  ADD COLUMN desconto_tipo ENUM('percentual','fixo','nenhum') DEFAULT 'nenhum',
  ADD COLUMN desconto_valor DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN valor_final DECIMAL(14,2) NULL,
  ADD COLUMN precificacao_observacoes TEXT NULL,
  ADD COLUMN precificacao_calculada_em DATETIME NULL
    COMMENT 'Flag: NOT NULL = INCRA aplicada';

CREATE INDEX idx_laudos_precificacao
  ON laudos_demarcacao(precificacao_calculada_em);
```

Coluna existente `valor_servico` é mantida e sincronizada via service layer (sem trigger SQL).

## 4. Constantes e service (back)

**Arquivo:** `src/services/pricing/incra.ts` (~250 linhas, fonte única de verdade no back)

Exporta:

```ts
// Tabela e descritivos
export interface FaixaIncra { /* pontuacaoMin, Max, rendimentoKmDia, valorPorKm, ...PorHectare, ...PorLote, label */ }
export const TABELA_INCRA_2025: FaixaIncra[]; // 6 faixas
export const CRITERIOS_INCRA: { vegetacao, relevo, insalubridade, acesso, clima, area_media }; // descritivos
export const PORTARIA_INCRA_REFERENCIA: { numero, data, orgao, url, observacao };

// Tipos
export type UnidadeCalculo = 'km' | 'hectare' | 'lote';
export type DescontoTipo = 'percentual' | 'fixo' | 'nenhum';
export interface CriteriosPontuacao { vegetacao, relevo, insalubridade, acesso, clima, area_media: number }
export interface InputPrecificacao { criterios, unidade, quantidade, desconto: { tipo, valor } }
export interface ResultadoPrecificacao { pontuacaoTotal, faixa, valorUnitario, valorBase, descontoAplicado, valorFinal, detalhamento: { formula, avisos } }
export interface DadosLaudoParaSugestao { area_total_m2?, perimetro_m?, num_pontos?, municipio?, uf?, tipo_vegetacao? }

// Funções puras
export function validarCriterios(c: CriteriosPontuacao): { ok, erros }
export function calcularPontuacaoTotal(c: CriteriosPontuacao): number
export function obterFaixa(pontuacao: number): FaixaIncra
export function obterValorUnitario(faixa: FaixaIncra, unidade: UnidadeCalculo): number
export function calcularPrecificacao(input: InputPrecificacao): ResultadoPrecificacao
export function sugerirCriterios(dados: DadosLaudoParaSugestao): CriteriosPontuacao
```

**Conversões importantes:**
- `area_total_m2` → ha: `dados.area_total_m2 / 10000`
- Sugestão por área (em ha): >35 → pont=2; 15-35 → pont=5; ≤15 → pont=8
- Sugestão por UF: lista `['MA','PA','AM','AC','RO','RR','AP','TO','MT']` → insalubridade=7

**Aviso de variação ±10%:** quando `descontoAplicado / valorBase > 0.10`, retorna em `detalhamento.avisos[]` mensagem citando "variação admissível de ±10% prevista na Portaria INCRA 12/2025".

**Validação:**
- Cada critério: inteiro 1-10
- Pontuação total: 6-60
- Quantidade: > 0
- Desconto percentual: 0-100
- Desconto fixo: 0 ≤ valor ≤ valor_base

Toda saída numérica monetária passa por `+(x).toFixed(2)` antes de retornar/persistir.

## 5. Script front (cálculo local)

**Arquivo:** `src/public/js/incraCalc.js` (~180 linhas, vanilla JS)

Espelho do `incra.ts`: mesma `TABELA_INCRA_2025`, mesma função `calcularPrecificacao(input)`. Sem dependências. Carregado no `obras.html` via `<script src="/js/incraCalc.js"></script>`.

Expõe globalmente:
```js
window.IncraCalc = {
  TABELA_INCRA_2025,
  CRITERIOS_INCRA,
  calcularPrecificacao,
  validarCriterios,
  obterFaixa,
};
```

**2 fontes de verdade — mitigação:** teste de paridade em `incra.test.ts` carrega o `.js` via `vm.runInNewContext()` e compara cada cenário (6 faixas × 3 unidades × 3 tipos de desconto = 54 cenários) com o resultado do TS. Falha o build se divergirem.

Header de cada arquivo carrega comentário de aviso:
```ts
// AVISO: este arquivo é espelhado em src/public/js/incraCalc.js (vanilla JS).
// Mudou aqui? Atualize lá. Teste de paridade em incra.test.ts garante.
```

## 6. Endpoints REST

Adicionados em `src/server.ts` no bloco dos `/api/laudos-demarcacao/*` (linhas ~1564-2313, perto do `PUT /:id`):

### `GET /api/laudos-demarcacao/:id/precificacao/sugerir`

Carrega o laudo, monta `DadosLaudoParaSugestao` (area_total_m2, perimetro_m, uf_imovel, municipio), retorna `CriteriosPontuacao` da função `sugerirCriterios()`.

**Resposta:** `200 { criterios: CriteriosPontuacao, fonte: { area_ha, uf, perimetro_km } }`

### `POST /api/laudos-demarcacao/:id/precificacao/calcular`

**Body:**
```ts
{
  unidade: 'km'|'hectare'|'lote',
  criterios: CriteriosPontuacao,
  quantidade: number,
  desconto: { tipo: 'percentual'|'fixo'|'nenhum', valor: number }
}
```

Validação manual de tudo (range 1-10 por critério, quantidade > 0, etc). Chama `calcularPrecificacao()`. Persiste **todos** os 16 campos novos + `valor_servico = valor_final` num único UPDATE. Grava `precificacao_calculada_em = NOW()`.

**Resposta:** `200 ResultadoPrecificacao`

**Erro de validação:** `400 { error: string, detalhes?: string[] }`

### `PATCH /api/laudos-demarcacao/:id/precificacao`

**Body:** `{ desconto: { tipo, valor } }` — só desconto.

Lê `valor_base_calculado` já persistido, recalcula só o desconto, atualiza `desconto_tipo`, `desconto_valor`, `valor_final`, `valor_servico`, `precificacao_calculada_em = NOW()`.

**Resposta:** `200 { valor_base, descontoAplicado, valorFinal, avisos }`

**Pré-condição:** `precificacao_calculada_em IS NOT NULL` (laudo já tem cálculo). Senão `409 Conflict`.

## 7. UI — `obras.html`

Em `renderFinanceiro()` (linha ~2822 atual), adicionar **bloco "💰 Precificação INCRA"** acima do bloco "Financeiro" atual.

**Layout** (mockup detalhado da spec original mantido):
- Radio group "Unidade de cálculo" (km / hectare / lote)
- Campo "Quantidade" pré-preenchido conforme unidade:
  - km → `Σ(distancia_m) / 1000` (perímetro)
  - hectare → `area_total_m2 / 10000`
  - lote → `1` (default)
- Bloco "Critérios (1-10 cada)":
  - 6 linhas, cada uma com: rótulo + stepper [-N+] + dropdown sincronizado mostrando o nível textual + descrição abaixo
- Painel "Cálculo em tempo real" (debounce 300ms via `IncraCalc.calcularPrecificacao`):
  - Pontuação total + faixa
  - Valor unitário + fórmula textual (ex: "12,5 ha × R$ 104,78 = R$ 1.309,75")
- Bloco "Desconto" com radio (nenhum/percentual/fixo) + campo numérico + texto "Desconto aplicado: R$ X"
- Caixa destacada "VALOR FINAL: R$ Y" + botões [🔄 Recalcular] [💾 Salvar precificação]
- Aviso amarelo `⚠️` quando desconto > 10% (texto da Portaria)

**Comportamento:**
- Ao montar a aba Financeiro: chama `GET .../sugerir`, pré-popula os 6 steppers + valor `unidade_calculo` se já existir
- Cada interação no stepper/dropdown/radio dispara `IncraCalc.calcularPrecificacao` local (debounce 300ms) e atualiza o painel
- Trocar unidade re-puxa quantidade conforme regra acima
- "💾 Salvar precificação" → `POST .../calcular`, mostra toast de sucesso, marca o bloco Financeiro como "INCRA aplicada"
- Quando `precificacao_calculada_em IS NOT NULL`: campo "Valor do serviço (R$)" do bloco Financeiro fica `disabled` com tooltip "Calculado pela precificação INCRA — para alterar, recalcule acima"

**Comunicação:** usa o helper `api()` existente.

## 8. PDF do laudo

Em `src/services/laudoPdf.ts`, adicionar **seção "12. PRECIFICAÇÃO DO SERVIÇO"** **antes** da seção atual de Responsabilidade Técnica (ART/TRT) — conforme pedido na spec original. Renumeração:

| Antes (v2.11.0) | Depois (v3.0.0) |
|---|---|
| 12. RESPONSABILIDADE TÉCNICA | **12. PRECIFICAÇÃO DO SERVIÇO** *(nova)* |
| 13. OBSERVAÇÕES | 13. RESPONSABILIDADE TÉCNICA *(renumerada)* |
| (Local/data/assinatura sem número) | 14. OBSERVAÇÕES *(renumerada)* |
|  | (Local/data/assinatura sem número, igual antes) |

A renumeração afeta apenas os rótulos textuais "12.", "13.", "14." renderizados no PDF — o conteúdo de cada seção não muda.

Renderiza a seção 12 (PRECIFICAÇÃO) apenas quando `laudo.valor_final IS NOT NULL` — laudos sem INCRA mantém só ART/TRT (que aí volta a ser numerada como 12 visualmente, sem buraco). Implementação: numerar as seções dinamicamente conforme presença/ausência da precificação.

Conteúdo da nova seção:
1. Cabeçalho `12. PRECIFICAÇÃO DO SERVIÇO` no estilo das outras seções (Helvetica-Bold 10pt, cor #888)
2. Texto introdutório: "Cálculo conforme Tabela de Preços Referenciais aprovada pela Portaria INCRA nº 12, de 23 de abril de 2025 (3ª Edição da Norma Técnica para Georreferenciamento de Imóveis Rurais)."
3. Subtítulo "CRITÉRIOS DE CLASSIFICAÇÃO (Quadro 1 — Anexo I)"
4. Tabela 3 colunas (Critério / Pontos / Classificação) × 7 linhas (6 critérios + linha TOTAL com faixa)
5. Subtítulo "VALOR APLICADO (Quadro 2 — Anexo I)"
6. 4 linhas: Unidade, Valor unitário, Quantidade, Valor base
7. Subtítulo "DESCONTO COMERCIAL" (omitido se `desconto_tipo='nenhum'`)
8. 2-3 linhas: tipo + percentual (se aplicável) + valor descontado
9. Linha "VALOR FINAL DO SERVIÇO ▶ R$ Y" em destaque (mesmo verde #10b981 da caixa de assinatura ICP-Brasil)
10. Nota de rodapé: "A Portaria INCRA 12/2025 admite variação de ±10% sobre os valores médios em função de particularidades do objeto, encargos e insumos regionais."

**Formatação:**
- Valores: `Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(x)`
- Quantidade: 4 casas decimais para km/ha (`.toFixed(4)`), inteiro para lote
- Tabela: largura 515pt total, mesma fonte/cor das outras tabelas do laudo, `lineBreak: false` em todas as células

**Compat:** se algum campo do bloco INCRA estiver NULL no laudo (caso impossível em runtime, mas defensivo), pula a seção sem quebrar.

## 9. Recibo

Em `src/services/reciboPdf.ts`, no fluxo de gerar recibo de laudo (`/api/laudos-demarcacao/:id/gerar-recibo`):

Se `laudo.precificacao_calculada_em IS NOT NULL`, adicionar **3 linhas** logo abaixo da descrição do serviço, antes do valor:

```
Faixa INCRA aplicada:    {laudo.faixa_aplicada}
Valor base ({unidade}):  {Intl.format(laudo.valor_base_calculado)}
Desconto:                {Intl.format(desconto_valor)} ({tipo}{percentual_se_aplicavel})
```

Se `desconto_tipo='nenhum'`, suprimir a 3ª linha.

Mudança mínima — não muda layout do recibo.

## 10. Testes

**Arquivo:** `src/services/pricing/incra.test.ts` (Vitest, padrão do repo)

Cobre:

1. **Faixas** — pontuação 6, 15, 16, 25, 26, 35, 36, 45, 46, 55, 56, 60 retorna faixa correta + valor unitário correto para cada unidade (km/ha/lote)
2. **Erros de pontuação** — total 5 e 61 → throw
3. **Critério inválido** — pontuação 0 ou 11 em qualquer critério → `validarCriterios.ok=false`
4. **Quantidade** — 0 ou negativa → throw
5. **Cálculo conhecido** — 100 km × R$ 1.571,64 (faixa 26-35) = R$ 157.164,00 (verifica `.toFixed(2)`)
6. **Desconto percentual** — 10% sobre R$ 1.000 = R$ 900
7. **Desconto fixo** — R$ 200 sobre R$ 1.000 = R$ 800
8. **Desconto fixo > base** — throw
9. **Desconto percentual fora 0-100** → throw
10. **Aviso > 10%** — desconto 15% gera `avisos[]` com mensagem da Portaria
11. **`sugerirCriterios`** — área 50ha → area_media=2; 25ha → 5; 10ha → 8
12. **`sugerirCriterios`** — UF=MA → insalubridade=7; UF=SP → insalubridade=5 (default)
13. **Paridade back↔front** — para cada combinação de (faixa, unidade, desconto): carrega `incraCalc.js` via `vm.runInNewContext()`, executa o mesmo input no TS e no JS, compara `valorFinal` numérico. 54 cenários.

**Comando:** `npm test -- pricing/incra` deve passar 100%.

## 11. Documentação

**`docs/PRECIFICACAO_INCRA.md`** (novo):
- Origem dos valores (Portaria 12/2025, link, data)
- Quando usar cada unidade (km, ha, lote)
- Como funciona o auto-preenchimento (heurísticas implementadas)
- Como o desconto é aplicado
- Aviso jurídico: "A Portaria 12/2025 é referencial obrigatório para contratações pelo INCRA. Em contratos privados, serve como balizador defensável de mercado, mas o valor final é livremente acordado entre as partes contratantes."

**Changelog `06-Changelog/v3.0.0-precificacao-incra.md`** (na vault Obsidian, separado do clone fonte): segue o padrão dos changelogs anteriores (Por quê, O que mudou, Endpoints, UI, PDF, Versão, Próximos passos).

## 12. Versionamento

Bump ao final, após todos os testes passarem:
- `package.json`: `2.11.0` → **`3.0.0`**
- `src/agent/identity.ts`: `2.11.0` → `3.0.0`
- `src/public/sw.js`: cache `zayra-v2.11.0` → `zayra-v3.0.0`

## 13. Critérios de aceite

- [ ] `runPrecificacaoIncraMigrations()` roda em ambiente limpo sem erros (idempotente)
- [ ] 3 endpoints respondem com payloads validados (manual)
- [ ] UI calcula em tempo real (≤300ms) e mostra os 6 critérios com rótulos sincronizados
- [ ] Auto-preenchimento funciona quando `area_total_m2` e `uf_imovel` estão preenchidos
- [ ] Trocar unidade (km/ha/lote) recalcula quantidade automaticamente
- [ ] Toggle de desconto altera dinamicamente o input
- [ ] PDF mostra a nova seção 12 (PRECIFICAÇÃO DO SERVIÇO) com tabela de critérios + valor base + desconto + valor final, posicionada antes de ART/TRT, com renumeração correta das seções seguintes
- [ ] Recibo mostra 3 linhas de resumo INCRA quando aplicável
- [ ] `npm test` passa (incluindo paridade back↔front com 54 cenários)
- [ ] PR aberto, **NÃO mergeado**, com descrição apontando os pontos de atenção
- [ ] Changelog atualizado, versões bumpadas para v3.0.0

## 14. Pontos de atenção / risco

1. **Drift TS↔JS** — 2 fontes de verdade. Mitigado pelo teste de paridade, mas atualizações precisam tocar 2 arquivos. Comentário de aviso no header de cada um.
2. **Laudos antigos** — `precificacao_calculada_em IS NULL` em todos. PDF/Recibo pulam a seção corretamente. Form mostra `valor_servico` editável como antes.
3. **`area_total_m2` ausente** — sugestão usa default conservador `area_media=5`. UF ausente → insalubridade=5.
4. **Variação de ±10%** — não é hard limit. Apenas aviso visual + texto na Portaria. Não bloqueia salvar.
5. **Bump major v3.0.0** — não é tecnicamente "breaking change" (feature aditiva), mas o CEO escolheu o bump. Deixar claro no changelog.
6. **Vault Obsidian** — changelog vai na vault de docs (`ROMATEC_AVALIEIMOB_/RomatecVoiceAgent/06-Changelog/`), separado do clone fonte. Sem conflito de git.
