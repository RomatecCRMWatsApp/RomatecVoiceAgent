# Spec — Planta da Quadra automática no Laudo de Demarcação (v3.6.0)

**Data:** 2026-05-11
**Branch:** `feat/planta-quadra-laudo-v3.6.0`
**Origem:** Pedido do CEO — ao gerar laudo de demarcação para um lote, o PDF deve embutir automaticamente a planta da quadra inteira com o lote-objeto destacado, sem digitação manual.

---

## 1. Contexto e motivação

Hoje o laudo já mostra um croqui do **lote isolado** (polígono com cotas, área no centro, tarjeta SIRGAS — `src/services/croquiSvg.ts`). Quando o lote pertence a um loteamento urbano cadastrado (v2.8.0–v2.9.0), o técnico precisa abrir o DWG/DXF original do loteamento em CAD, capturar print da quadra, recortar, anexar. Manual, demorado e fora do app.

A meta: o técnico sobe o **DXF do loteamento inteiro uma única vez**, o sistema casa cada polígono do desenho com um registro existente em `loteamento_quadras` / `loteamento_lotes`, persiste a geometria, e dali em diante **todo laudo daquele loteamento ganha automaticamente uma página "Planta da Quadra"** com o lote-objeto preenchido em destaque e os lotes vizinhos com contorno + label dos confrontantes.

## 2. Escopo

### Restrição fundamental — escopo do feature
**A planta-da-quadra só é embutida no PDF quando TODAS as condições baterem:**
1. `laudo.tipo_imovel === 'URBANO'` (laudos rurais nunca recebem essa seção)
2. `laudo.lote_id` está setado (o lote foi vinculado a um registro de `loteamento_lotes`)
3. O loteamento ao qual o lote pertence tem geometria cadastrada (DXF já foi importado e mapeado para esse loteamento via fluxo descrito abaixo)

Faltando qualquer uma das três, o PDF sai exatamente como hoje, sem seção e sem warning. Rural fica intocado.

### Dentro
- Importação de DXF ASCII do loteamento (CEO converte DWG no AutoCAD antes)
- Extração de polígonos de quadras e lotes via parser Python `ezdxf` (subprocess server-side)
- UI de **revisão e mapeamento**: técnico aprova/edita o casamento `polígono DXF ↔ registro existente`
- Persistência de geometria em GeoJSON nas tabelas `loteamento_quadras` e `loteamento_lotes`
- Renderização SVG da planta-da-quadra com lote-objeto destacado, gerada on-the-fly no momento do PDF
- Nova seção dedicada **"Planta da Quadra"** no PDF do laudo, condicional à presença de `lote_id` + geometria
- Bump de versão para v3.6.0 (feature visível) com bump de `sw.js` cache, `package.json`, `identity.ts`

### Fora
- **Laudos rurais** — a seção nunca é renderizada, mesmo se hipoteticamente houvesse loteamento rural com DXF
- **Laudos urbanos sem `lote_id`** (imóvel urbano avulso, sem cadastro em loteamento) — seção omitida
- **Loteamentos cadastrados sem DXF importado** — seção omitida silenciosamente até o DXF entrar
- Suporte a DWG nativo (binário) — CEO converte no AutoCAD para DXF ASCII
- Mapa de loteamento inteiro (várias quadras na mesma página) — escopo do croqui é a quadra do lote
- Edição vetorial em-app dos polígonos — se DXF veio errado, técnico corrige no AutoCAD e reimporta
- Importação automática de novos lotes a partir do DXF — DXF só **anexa geometria** a quadras/lotes que **já existem** no schema (criados via CSV/XLSX v2.8.0); polígonos sem match aparecem como "não mapeados" e ficam de fora
- Suporte a sistemas de coordenadas estrangeiros — heurística de detecção UTM/geo do v2.7.0 já cobre BR
- Re-projeção entre zonas UTM dentro do mesmo loteamento — assume loteamento inteiro em uma única zona

## 3. Arquitetura — componentes

```
┌─────────────┐   upload DXF    ┌────────────────────┐
│ obras.html  │ ──────────────▶ │ POST /api/         │
│ (aba        │                  │  loteamentos/:id/  │
│  Loteamentos│                  │  importar-dxf      │
│  → modal    │                  └────────┬───────────┘
│  "Vincular  │                           │ multipart
│  DXF")      │                           ▼
└──────▲──────┘                  ┌────────────────────┐
       │                          │ parserDxfPython.ts │
       │ preview JSON             │ (Node)             │
       │ + relatório              │   subprocess →     │
       │                          │   parse_loteamento │
       │                          │       _dxf.py      │
       │                          │   (ezdxf+shapely)  │
       │                          └────────┬───────────┘
       │                                   │ stdout JSON
       │                                   ▼
       │                          ┌────────────────────┐
       │                          │ mapearDxfQuadras() │
       │                          │ heurística:        │
       │                          │  - layer name      │
       │                          │  - text proximity  │
       │                          │  - lookup nas      │
       │                          │    tabelas v2.8    │
       │                          └────────┬───────────┘
       │                                   │ sugestão de match
       │ user confirma / edita             ▼
       └────────────┐            ┌────────────────────┐
                    │            │ POST .../confirmar │
                    └──────────▶ │ grava geojson nas  │
                                 │ tabelas v2.8       │
                                 └────────────────────┘

                                 ┌────────────────────┐
                  gerar laudo →  │ laudoPdf.ts        │
                                 │  + nova seção:     │
                                 │  plantaQuadraSvg() │
                                 │  (puro JS + SVG)   │
                                 └────────────────────┘
```

Sete unidades isoladas:

1. **`scripts/parse_loteamento_dxf.py`** — Python standalone. Entrada: caminho DXF. Saída: JSON estruturado em stdout com lista de polígonos detectados (quadras e lotes), seus rótulos, layers, centroides UTM, bounding box. Usa `ezdxf` para BLOCK/INSERT/HATCH/LWPOLYLINE/TEXT/MTEXT, `shapely` para validar topologia e calcular contém/intersecta.
2. **`src/services/parserDxfPython.ts`** — wrapper Node. Spawna o Python via `child_process.spawn` com timeout, faz parse do JSON stdout, mapeia erros do stderr. Função única: `parseLoteamentoDxf(filePath): Promise<DxfReport>`.
3. **`src/services/mapearDxfQuadras.ts`** — pura, sem I/O. Recebe `DxfReport` + listas atuais de `quadras`/`lotes` do loteamento, retorna sugestão de match por (a) similaridade de label, (b) número do lote dentro do layer, (c) ponto-em-polígono entre centroide do lote e polígono da quadra. Sem auto-confirmar; apenas sugere.
4. **`src/database/migrations-loteamentos.ts`** — adiciona 2 colunas: `loteamento_quadras.geometria_geojson TEXT NULL` e `loteamento_lotes.geometria_geojson TEXT NULL`. Migration idempotente (`ADD COLUMN IF NOT EXISTS`).
5. **`src/integrations/loteamentos.ts`** — funções novas: `salvarGeometriaQuadra(id, geojson)`, `salvarGeometriaLote(id, geojson)`, `temPlantaQuadra(loteamentoId)` (bool helper para o PDF).
6. **`src/public/obras.html`** — modal "Vincular DXF" disparado dentro da tela de detalhe do loteamento. Upload + preview com cards `Quadra X (DXF) → Quadra Y (cadastrada)` editáveis. Botão único "Confirmar e gravar geometria".
7. **`src/services/plantaQuadraSvg.ts`** — função pura. Entrada: `quadraGeojson`, lista de `lotesGeojson` com flags `{ isObjeto: bool, label: string, confrontante: string }`. Saída: string SVG com viewBox calculado, lote-objeto em fill destacado, vizinhos em stroke fino, labels nos quatro confrontantes da quadra, escala numérica no canto. Reaproveita helpers de `croquiHelpers.ts` (centroide, formatarArea).

## 4. Fluxo de dados

### 4.1 Upload e mapeamento (1× por loteamento)
1. Técnico abre **Loteamentos → [Colina Park] → ⬆️ Vincular DXF**
2. Upload do `.dxf` (limite 25MB, mesmo do v2.7.0)
3. Backend executa Python parser, retorna `DxfReport` com `quadras[]` e `lotes[]` detectados
4. `mapearDxfQuadras()` casa com tabelas existentes; UI mostra:
   ```
   ✅ Quadra Q-02 (DXF, 15 lotes) → Quadra "Q. 02" cadastrada (15 lotes) [trocar]
   ✅ Quadra Q-03 (DXF, 12 lotes) → Quadra "Q. 03" cadastrada (12 lotes) [trocar]
   ⚠️ Quadra Q-99 (DXF) → sem correspondência no cadastro [ignorar | criar]
   ```
5. Técnico confirma → POST `…/confirmar` → backend grava `geometria_geojson` em cada `quadra` e `lote` que teve match
6. Relatório final: `quadras_atualizadas`, `lotes_atualizados`, `nao_mapeados`

### 4.2 Geração do laudo (cada laudo)
1. `laudoPdf.ts` carrega laudo, checa a **guarda tripla**: `tipo_imovel === 'URBANO'` AND `lote_id != null` AND geometria existe em `lote` + `quadra`
2. Se a guarda falha (rural, sem lote, ou sem DXF cadastrado), pula a seção e segue
3. Se passa, carrega `lote.geometria_geojson` + geometria da quadra-pai + todos os lotes vizinhos, chama `plantaQuadraSvg()` e insere uma **nova seção** após o croqui atual:
   - Título: "Planta da Quadra — Q. 02"
   - SVG da quadra inteira com lote-objeto destacado
   - Legenda com confrontantes nos 4 lados
4. Se faltar geometria, **omite silenciosamente** a seção — laudo gera normalmente, sem warnings no PDF

## 5. Schema — diff

```sql
-- migrations-loteamentos.ts (idempotente)
ALTER TABLE loteamento_quadras
  ADD COLUMN IF NOT EXISTS geometria_geojson TEXT NULL;

ALTER TABLE loteamento_lotes
  ADD COLUMN IF NOT EXISTS geometria_geojson TEXT NULL;
```

GeoJSON armazenado como string (TEXT), parseado on-read. Tipo esperado: `Polygon` (singular, anel externo, sem buracos), coordenadas em **UTM SIRGAS 2000** zona da região (mesma do laudo). Sem reprojeção em runtime — economiza CPU no PDF e mantém precisão métrica para o SVG.

## 6. Endpoints novos

| Verbo | Rota | Auth | Função |
|---|---|---|---|
| `POST` | `/api/loteamentos/:id/importar-dxf` | CEO token | Multipart `arquivo`. Retorna `DxfReport` + sugestão de match. Não persiste |
| `POST` | `/api/loteamentos/:id/importar-dxf/confirmar` | CEO token | Body JSON com `matches: [{ dxf_id, quadra_id, lotes: [{dxf_id, lote_id}] }]`. Grava geometrias e retorna relatório |

Ambos no `server.ts` seguindo o padrão dos endpoints v2.8.0.

## 7. Casos de erro e bordas

| Caso | Comportamento |
|---|---|
| DXF binário | 400 "DXF binário não suportado, exporte como ASCII" |
| Python não disponível no host | 503 "Importação de DXF requer Python 3 + ezdxf instalados" — fallback fica fora do MVP |
| DXF muito grande (>25MB) | rejeita no multipart limit (já existe) |
| Polígono com auto-interseção | shapely detecta, marca como inválido no relatório, técnico não pode confirmar esse |
| Lote no DXF sem match na tabela | aparece como "não mapeado", ignorado |
| Quadra no cadastro sem polígono no DXF | fica sem geometria; laudo daquela quadra omite a planta silenciosamente |
| Coordenadas em geo (lon/lat) | parser reprojeta pra UTM antes de devolver (mesma heurística magnitude do v2.7.0) |
| Zonas UTM diferentes no mesmo DXF | erro fatal no parser; loteamento real nunca cruza zona |
| Re-importação do mesmo loteamento | UPSERT — sobrescreve geometria existente sem perguntar (caminho rápido para correção) |
| Lote tem geometria mas quadra não | omite planta — precisa dos dois |
| Laudo rural (`tipo_imovel = 'RURAL'`) | nunca renderiza, mesmo se tabelas tivessem geometria — guarda na entrada do `laudoPdf.ts` |
| Laudo urbano sem `lote_id` | omite — não há quadra de referência |

## 8. Testes

- **`src/services/croquiHelpers.test.ts`** (existente): adicionar helpers de bbox/escala se forem extraídos
- **`src/services/mapearDxfQuadras.test.ts`** (novo): casos `match exato por label`, `match por lookup textual normalizado` (`Q. 02` ≡ `Q-02` ≡ `QUADRA 02`), `múltiplos candidatos resolve por ponto-em-polígono`, `sem candidato retorna unmapped`
- **`src/services/plantaQuadraSvg.test.ts`** (novo): snapshot do SVG gerado para uma quadra fixture com 4 lotes, lote-objeto = 2; validar viewBox, ordem de elementos, fills, labels
- **Guarda tripla no PDF**: teste de `laudoPdf.ts` cobrindo (a) rural pula, (b) urbano sem lote_id pula, (c) urbano com lote mas sem geometria pula, (d) caso completo renderiza
- **`scripts/test_parse_loteamento_dxf.py`** (novo): pytest curto com DXF fixture de 1 quadra + 3 lotes; valida polígonos extraídos e centroides
- **Validação real**: subir o DXF do `Residencial Colina Park` (CEO já tem o cadastro pelo CSV de v2.8.0) e gerar 1 laudo de teste

## 9. Versionamento

- `package.json`: 3.5.4 → **3.6.0**
- `src/agent/identity.ts`: 3.5.4 → 3.6.0
- `src/public/sw.js`: cache `zayra-v3.5.4` → `zayra-v3.6.0`
- Deps novas Node: **nenhuma**. Operações de geometria (bbox, centroide, escala SVG) implementadas em puro JS sobre `Polygon` GeoJSON — escopo é simples demais pra justificar `@turf/turf` (730KB). `proj4` já está nas deps para qualquer reprojeção
- Deps Python (instaladas no host de deploy): `ezdxf>=1.3`, `shapely>=2.0`

## 10. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Python ausente em Railway / ambiente de prod | Documentar requisito no README; preflight check no boot loga warning se `python3 -c "import ezdxf"` falhar; endpoint retorna 503 claro |
| Heurística de match erra muito em DXF fora do padrão | UI obriga revisão humana antes de gravar; sem auto-confirm |
| GeoJSON em TEXT (sem índice geoespacial) | OK pra escala atual (loteamento ≈ 60 quadras × 30 lotes = 1800 linhas/loteamento). Se passar de 50 loteamentos com geometria, migrar pra coluna nativa |
| SVG da quadra muito denso (60 lotes) | viewBox calculado pelo bbox + escala adaptativa; label oculto se lote < 5% da quadra |
| Confrontante textual vs FK | Render usa `conf_*_lote_id` se existir (mostra nº do lote vizinho), senão `conf_*_texto` (rua, APP, etc.) — fallback já existe em v2.8.0 |

## 11. Plano de release

PR único `feat/planta-quadra-laudo-v3.6.0` → `main`, com a sequência canônica do projeto:
1. Migration
2. Parser Python + tests
3. Wrapper Node + tests
4. Endpoints
5. UI modal de vinculação
6. SVG render + tests
7. Integração no PDF
8. Bump de versão (package.json, identity.ts, sw.js) — **último commit do PR**
9. Mudança no changelog `06-Changelog/v3.6.0-planta-quadra-laudo.md` no vault Obsidian
