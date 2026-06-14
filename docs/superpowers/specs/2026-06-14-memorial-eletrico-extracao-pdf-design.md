# Memorial Elétrico com Extração Automática de PDF (NBR 5410)

**Projeto:** ZAYRA / RomatecVoiceAgent
**Módulo:** Memoriais & Quantitativos → Memorial Elétrico (NBR 5410)
**Data:** 2026-06-14
**Status:** Aprovado para implementação (Fase 1)

## 1. Objetivo

Transformar o Memorial Elétrico de entrada manual para um fluxo que **extrai
automaticamente** os dados de uma planta elétrica (Prancha PE) em PDF, deixa o
usuário **revisar/corrigir**, e gera dois documentos no formato ROMATEC:

1. **Memorial Descritivo e de Cálculo** (NBR 5410:2004)
2. **Lista de Materiais** (quantitativo executivo, condutores por seção)

Hoje as quantidades são **estimadas por área** (`pontosLuz = área/12` em
[eletricoCalculo.ts](../../../src/services/memoriais/eletricoCalculo.ts)). A meta
é substituir essa estimativa por **contagens reais extraídas da planta**, mantendo
o motor NBR 5410 já existente ([eletricoCalc.ts](../../../src/services/memoriais/eletricoCalc.ts)).

### Documentos de referência (formato-alvo da saída)
- `05-01-...Lista_Materiais...REV01.pdf` — modelo da Lista de Materiais.
- `05-02-...Memorial_NBR5410...REV01.pdf` — modelo do Memorial.
- `05-00-...PE...pdf` — exemplo de planta de entrada (Revit, com tabelas/unifilar em texto).

## 2. Escopo

### Fase 1 (este ciclo)
- Uso **residencial e comercial**.
- Alimentação **monofásica, bifásica e trifásica** (127/220/380 V).
- Upload de 1 PDF de planta elétrica (Prancha PE) → extração → revisão → cálculo → 2 PDFs.
- Persistência do PDF enviado + JSON extraído + PDFs gerados; envio WhatsApp/Telegram (como os demais memoriais).

### Fora de escopo (Fase 2+)
- Medição de comprimento real de cabo pelo traçado gráfico (rastreamento de fios + escala).
- Compatibilização multi-prancha / múltiplos quadros (QDFL + QDF secundários).
- Detecção fina de caixas/eletrodutos por trecho geométrico.

## 3. Decisões (do brainstorming)
- **Conteúdo do PDF:** varia por projeto (às vezes tabela, às vezes só desenho) → abordagem híbrida.
- **Cabos por seção:** **calculados por NBR** a partir dos pontos/circuitos, com **comprimento de lance ajustável** pelo usuário na revisão (não medidos do desenho).
- **Motor de extração:** **IA-documento primeiro** (multimodal lê o PDF) + **parser de texto** rodando junto para metadados e cross-check; **sempre** passa por revisão humana.
- **Saída:** espelhar fielmente os 2 modelos ROMATEC.

## 4. Arquitetura e fluxo

```
Upload do PE (PDF, multipart)
   │
   ├── aiDocExtractor (Gemini 2.5 primário; Anthropic fallback) → JSON estruturado
   └── memorialPdfParser (texto: metadados da obra) ───┐
                                                        │ merge + cross-check
   ▼                                                    ▼
ExtracaoEletrica { obra, alimentacao, circuitos[], pontos, eletrodutos[], caixas[], confianca, observacoes[], divergencias[] }
   │
   ▼  Passo de REVISÃO/EDIÇÃO (wizard) — usuário confirma/corrige; ajusta comprimento de lance
   ▼
calcularResumoEletrico(entrada COM circuitos reais)  → demanda, dimensionamento, cabos por seção, materiais
   │
   ├── gerarPdfMemorialEletrico   (formato ROMATEC, 5 seções+)
   └── gerarPdfQuantitativoEletrico (formato ROMATEC, 6 grupos)
   ▼
persistência (memoriaisRepo / artefatos) + envio WhatsApp/Telegram
```

## 5. Componentes

### 5.1 Novos
- **`src/services/memoriais/aiDocExtractor.ts`** — função isolada `extrairEletricaDeDocumento(pdf: Buffer): Promise<ExtracaoIA>`. Envia o PDF (base64) a um provider multimodal com **schema JSON rígido** e prompt de extração elétrica. Gemini 2.5 (`GEMINI_API_KEY`, aceita PDF inline) primário; Anthropic (document block PDF) fallback. **Não importa nem modifica `aiCascade.ts`, `tools.ts`, `think.ts`** — usa os SDKs/keys diretamente, isolado.
- **`src/services/memoriais/eletricoExtracao.ts`** — orquestra: roda `aiDocExtractor` + `memorialPdfParser` (texto), funde resultados, calcula `confianca` e lista `divergencias` (ex.: contagem IA ≠ tabela texto). Retorna `ExtracaoEletrica`.
- **Rota `POST /api/memoriais/eletrico/extrair-pdf`** (multipart `arquivo`) em [memoriais.ts](../../../src/routes/memoriais.ts) → `ExtracaoEletrica`. Erro tratado; limite de tamanho.

### 5.2 Alterados
- **`eletricoCalc.ts` / `eletricoCalculo.ts`** — aceitar `circuitos` reais + `pontos` reais + `eletrodutoM` + `lanceMedioM` ajustável. Quando não houver planta, mantém a estimativa por área (retrocompatível). Suporta mono/bi/trifásico e residencial/comercial (fator de demanda por uso).
- **`eletricoPdfMemorial.ts`** — reescrito para espelhar o modelo: cabeçalho/dados da obra, histórico de revisões, 1.Objeto, 2.Normas, 3.Levantamento de cargas (tabela C1..Cn), 4.Demanda (Pi/fd/Pd/Id/ramal), 5.Dimensionamento (Ip/capacidade/queda/status), 6.Quadro QDFL, 7.IDR, 8.Especificação, 9.Critérios de execução/ensaio, 10.Conclusão, 11.Responsabilidade técnica + assinatura.
- **`eletricoPdfQuantitativo.ts`** — reescrito para os 6 grupos do modelo (Eletrodutos, Caixas, Disjuntores, Quadro+IDR, Interruptores/Tomadas detalhado, Condutores por seção) + resumo consolidado + margem de perdas + critérios + conclusão + assinatura.
- **`memoriais-eletrico-wizard.js`** — novo **Passo 0 "Upload da Planta (PE)"** (chama `extrair-pdf`, mostra barra de confiança) + **Passo de Revisão** editável (pontos, circuitos C1..Cn, eletroduto, lance ajustável, divergências sinalizadas) antes de "Gerar". Mantém o caminho manual (sem upload) como alternativa.

## 6. Contrato de extração (schema JSON)

```jsonc
{
  "obra": {
    "titulo": "Residência Unifamiliar Térrea",
    "endereco": "Rua Local 18, Qd. 43, Lt. 17 — Residencial Colina Park",
    "municipio": "Açailândia", "uf": "MA",
    "proprietario": "Nayara Brito Silva", "cpfCnpj": "614.363.953-13",
    "areaConstruidaM2": 78.69, "areaLoteM2": 220.0, "taxaOcupacaoPct": 35.76,
    "nPavimentos": 1, "prancha": "PE-05", "dataProjeto": "Maio/2026"
  },
  "alimentacao": {
    "tipo": "monofasico|bifasico|trifasico", "tensaoV": 220,
    "ramalSecaoMm2": 10, "disjuntorGeralA": 50,
    "piVA": 9932, "pdVA": 8723          // quando a prancha trouxer; senão null
  },
  "circuitos": [
    { "id": "C6", "descricao": "TUEs — Chuveiro elétrico", "tipo": "ilum|tug|tue",
      "disjuntorA": 20, "polos": 1, "condutorFaseMm2": 6,
      "condutorProtecaoMm2": 4, "potenciaVA": 5500 }
  ],
  "pontos": {
    "iluminacao": 0, "tug10A": 0, "tue20A": 0,
    "interruptorSimples": 0, "interruptorParalelo": 0, "interruptorIntermediario": 0,
    "conjuntos": 0, "tomadasPiso": 0
  },
  "eletrodutos": [ { "tipo": "PVC corrugado antichamas", "diametro": "Ø25", "comprimentoM": 238.68 } ],
  "caixas": [ { "tipo": "4x2", "qtd": 35 }, { "tipo": "4x4", "qtd": 20 }, { "tipo": "octogonal", "qtd": 3 } ],
  "confianca": 0.0,        // 0..1
  "observacoes": [],       // avisos da extração
  "divergencias": []       // ex.: "IA contou 16 tomadas 10A; tabela texto indica 16 (OK)"
}
```
- Campos ausentes na planta → `null` (a revisão obriga o preenchimento dos obrigatórios).
- O parser de texto ([memorialPdfParser.ts](../../../src/services/memoriais/memorialPdfParser.ts)) preenche/valida `obra` e cruza contagens quando houver tabela.

## 7. Cálculo NBR 5410 (a partir dos circuitos confirmados)
- **Potência instalada** Pi = Σ potências dos circuitos.
- **Demanda** Pd = Pi × fd (fd por uso/porte: residencial unifamiliar ≈ 0,60; comercial conforme Anexo da NBR/Creder). Id = Pd / V (V conforme alimentação).
- **Disjuntor geral / ramal**: dimensiona pelo Id; verifica capacidade do condutor de ramal (Tabela 36, método B2).
- **Por circuito**: Ip = P/V; capacidade de condução (Tabela 36); queda de tensão ≤ 4% (item 6.2.7); status ✓/AJUSTAR.
- **Cabos por seção**: para cada circuito, comprimento = `lanceMedioM` (ajustável, default por tipo) × nº de condutores (F+N+T conforme circuito); soma por bitola; + ramal; aplica margem 10%. Bitolas do modelo: 1,5 / 2,5 / 4,0 / 6,0 / 10 mm².
- **Regras NBR refletidas**: chuveiro ≥ 6 mm² (item 5.1.3.2); IDR 30 mA obrigatório (5.1.3.4); DPS conforme alimentação; seção mínima iluminação 1,5 mm², força 2,5 mm².

## 8. PDFs (espelhar os modelos ROMATEC)
- Mesmo cabeçalho/rodapé ROMATEC, faixa de título, tabela de dados da obra, blocos de seção em faixa azul, bloco de assinatura (José Romário — CFT/MA 01209185369), paginação.
- Geração via PDFKit (mesmo stack dos memoriais atuais).
- Mono/bi/trifásico refletido em ramal (F+N / 2F+N / 3F+N), disjuntor geral (1/2/3 polos) e nº de DPS.

## 9. Persistência
- Reusa `memoriaisRepo` + `migrations-memoriais-pdf` (que já guarda PDFs enviados) para o **PDF do PE** e os **2 PDFs** gerados (artefatos).
- Adiciona **migration idempotente** com a coluna `extracao_json` (LONGTEXT NULL) na tabela do memorial elétrico para guardar o JSON extraído (auditoria + permitir re-edição sem novo upload). Migration no padrão try/catch por operação dos demais arquivos `migrations-*.ts`.

## 10. Governança
- **Não** modificar `tools.ts`, `think.ts`, `aiCascade.ts`. A IA de extração é um módulo isolado (`aiDocExtractor.ts`) que consome SDKs/keys diretamente.
- Não adiciona tool de agente (contagem de tools < 128 mantida).
- `npm run typecheck` limpo e `npx vitest run` verde antes do PR.
- Sem placeholders; tratamento de erro em toda rota/serviço. Versionar (`package.json`) junto do deploy.

## 11. Testes (Vitest)
- **Extração:** mock do provider multimodal → valida parse do JSON contra o schema; merge texto×IA; cálculo de `confianca`; `divergencias`.
- **Cálculo:** circuitos do exemplo Nayara (C1..C8) → confere Pi=15.200 VA (instalado), Pd≈9.120 VA, Id≈39,6 A, bitolas por circuito e status ✓ (bate com o modelo).
- **PDFs:** builders puros (sem Chromium/headless) → contêm as seções, grupos e linhas esperadas (ex.: "Condutor flexível #6,0 mm²", "QDFL", "IDR 30 mA").
- **Rota:** `extrair-pdf` com mock → 200 + JSON; erros (sem arquivo, PDF inválido) → 400.

## 12. Critérios de aceite (Fase 1)
- [ ] Upload do PE → extração retorna JSON com obra + circuitos + pontos + eletroduto + confiança.
- [ ] Passo de revisão permite editar tudo e ajustar comprimento de lance; divergências sinalizadas.
- [ ] Residencial e comercial; mono/bi/trifásico.
- [ ] Memorial e Lista de Materiais gerados no formato ROMATEC (seções/tabelas dos modelos), condutores por seção corretos.
- [ ] Persistência + envio WhatsApp/Telegram funcionando.
- [ ] `typecheck` limpo, `vitest` verde, sem tocar em tools/think/aiCascade.
