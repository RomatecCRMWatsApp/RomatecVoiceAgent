# 🚀 IMPLEMENTAÇÃO · Proposta de Demarcação de Lotes (Urbana e Rural) · ZAYRA v3.27.0

> Inclui codificação automática de marcos com credencial FQNS (Adendo integrado).

---

## CABEÇALHO DE CONTEXTO

```
Projeto: RomatecVoiceAgent (ZAYRA)
Repo: RomatecCRMWatsApp/RomatecVoiceAgent
Versão atual: v3.23.5  →  alvo: v3.27.0
Branch base: main (NÃO existe `develop`)
Branch de trabalho: feature/proposta-demarcacao-lotes-v3.27.0
Diretório: C:\Users\Ronicley Pinto\Documents\RomatecVoiceAgent\
Stack: Node.js 22 · TypeScript strict · Express · MySQL2 · EJS · pdfkit
Hosting: Railway
Referência de padrão: v3.23.5 (Georreferenciamento Rural — PROP-2026-0011-R1)

Autor / Responsável Técnico: José Romário Pinto Bezerra
Empresa: Romatec Consultoria Total — Açailândia/MA
Registros (rodapé de PDF + bloco de responsabilidade técnica):
  - Téc. em Agrimensura — CFT/BR nº 0120918536-9
  - CFT/MA nº 01209185369
  - INCRA FQNS (prefixo de credencial usado em codificação de marcos)
  - CNAI nº 031161
  - CRECI/MA nº 4.705
  - Foro: Açailândia/MA
```

---

## 0. REGRA ZERO — LEIA ANTES DE COMEÇAR

Este módulo espelha 1:1 o padrão da v3.23.5. **Princípios não-negociáveis:**

1. **ZERO ALTER TABLE em `propostas`** — campos novos vão em `dados_imovel` JSON e `custos_calculados` JSON da tabela `propostas` existente.
2. **ZERO endpoint novo** — reusa `/api/propostas-consultoria/*` (poliglotas), discriminando por `subtipo_consultoria`.
3. **Migration permitida APENAS em `usuarios`** — para o contador vitalício FQNS (área de metadado do técnico, fora do domínio Proposta).
4. **PDF:** novo helper `renderDemarcacaoLotesBody()` invocado SÓ quando `p.subtipo ∈ {'demarcacao_urbana','demarcacao_rural'}`. Outros subtipos seguem inalterados.
5. **Numeração:** reusa helpers existentes (`gerarNumeroProposta`, `parseRevisao`, `bumpRevisao`). Formato `PROP-AAAA-NNNN-R{N}`.
6. **Nomenclatura técnica:** TRT/CFT (chave `trt_cft` já em `pricing-params.json`, valor R$ 93,40). NUNCA ART/CREA — autor é Téc. Agrimensura CFT, não Engenheiro.

**Arquivos PROIBIDOS de modificar:**
- `src/agent/tools.ts`
- `src/agent/think.ts`
- `src/services/aiCascade.ts`
- `src/services/pricing/georreferenciamento.ts` (só importar `round2`, sem alterar lógica)

**Limite OpenAI:** `npm run check:tools` → tool count < 128. Não expor novas tools ao agente.

---

## 🎯 OBJETIVO

Implementar geração de proposta comercial para serviço de **Demarcação de Lotes** (urbano e rural), espelhando o layout aprovado pelo CEO em PROP-2026-0011-R1 (Georref Rural v3.23.5), com:

- Engine de cálculo dedicada, mas reusando blocos comuns (TRT/CFT, mínimo garantido 2 SM, parcelas 40/30/30, opcionais não-somáveis, guard de fechamento).
- **Codificação automática de marcos** com credencial INCRA FQNS do técnico (rastreabilidade vitalícia perante INCRA/MPF).
- Aviso DRL obrigatório adaptado para demarcação.
- PDF com layout de 11 seções (10 do Georref + bloco extra de marcos discriminados + bloco de identificação FQNS).

---

## 📋 ESCOPO

### Entregáveis

1. Tipos TypeScript em `src/services/pricing/types.ts` (extensão).
2. Engine de cálculo standalone: `src/services/pricing/demarcacaoLotes.ts`.
3. Mint atômico de códigos FQNS: `src/services/pricing/mintCodigosDemarcacao.ts`.
4. Aviso DRL adaptado: extensão de `src/integrations/avisoDRL.ts`.
5. Helper de PDF: `renderDemarcacaoLotesBody()` em `src/integrations/propostasConsultoria.ts`.
6. Parâmetros em `config/pricing-params.json` (bloco `demarcacao_lotes_2026`).
7. Migration runtime idempotente para `usuarios` (FQNS counters): `migrations-usuarios-credencial-incra.ts`.
8. Frontend: 2 cards novos + função `renderConsultoriaFormDemarcacao()` em `src/public/obras.html`.
9. Página pública `/v/:hash`: detector dos novos subtipos em `src/public/recibo-validar.html`.
10. Suite de testes Vitest: 38 testes novos (22 cálculo + 8 DRL + 8 mint). Total esperado pós-merge: **492 passing**.

---

## 🗂️ ESTRUTURA DE ARQUIVOS

```
src/
├── services/
│   └── pricing/
│       ├── types.ts                         ← EDITAR (adicionar tipos)
│       ├── demarcacaoLotes.ts               ← NOVO (engine)
│       ├── demarcacaoLotes.test.ts          ← NOVO (22 testes)
│       ├── mintCodigosDemarcacao.ts         ← NOVO (mint atômico FQNS)
│       └── mintCodigosDemarcacao.test.ts    ← NOVO (8 testes)
├── integrations/
│   ├── propostasConsultoria.ts              ← EDITAR (novo helper)
│   ├── avisoDRL.ts                          ← EDITAR (suportar finalidades demarcação)
│   └── avisoDRL.demarcacao.test.ts          ← NOVO (8 testes)
├── public/
│   ├── obras.html                           ← EDITAR (2 cards + form)
│   └── recibo-validar.html                  ← EDITAR (detectar subtipos)
└── migrations-usuarios-credencial-incra.ts  ← NOVO (idempotente, boot)

config/
└── pricing-params.json                      ← EDITAR (bloco demarcacao_lotes_2026)
```

---

## 🧱 PARTE 1 · TIPOS (`src/services/pricing/types.ts`)

Adicionar ao final do arquivo (sem remover/alterar tipos existentes):

```typescript
// ============================================================
// DEMARCAÇÃO DE LOTES (v3.27.0)
// ============================================================

export type SubtipoDemarcacao = 'demarcacao_urbana' | 'demarcacao_rural';

export type MaterialMarco = 'concreto' | 'madeira' | 'tubo_galvanizado';

export type FinalidadeDemarcacao =
  | 'demarcacao_inicial'
  | 'redemarcacao'
  | 'subdivisao_lote'
  | 'piqueteamento_apenas';

export interface MarcoDiscriminado {
  tipo: MaterialMarco;
  quantidade: number;
  valor_unitario_congelado: number; // injetado no submit a partir de pricing-params
}

export interface OpcionaisDemarcacao {
  laudo_tecnico?: { contratado: boolean; valor_unitario_sm_multiplicador: number };
  alinhamento_cerca?: { contratado: boolean; metros: number; valor_unitario: number };
  croqui_assinado?: { contratado: boolean; valor_unitario: number };
  acompanhamento_obra?: { contratado: boolean; diarias: number; valor_unitario: number };
  consultoria_juridica?: { contratado: boolean; valor: 'sob_orcamento' };
}

export interface InputDemarcacaoLotes {
  subtipo: SubtipoDemarcacao;
  finalidade: FinalidadeDemarcacao;

  // Identificação do imóvel
  municipio: string;
  uf: string;
  matricula?: string;
  cri?: string;

  // Urbana
  loteamento_nome?: string;
  quadra?: string;
  lote?: string;
  area_m2?: number;

  // Rural
  denominacao_imovel?: string;
  ccir?: string;
  area_hectares?: number;

  perimetro_m?: number;

  // Técnico
  num_vertices: number;
  servico_piqueteamento: boolean;
  marcos: MarcoDiscriminado[];

  // Logística
  diarias_equipe: number;
  km_deslocamento: number;
  complexidade: 'simples' | 'media' | 'alta';

  // Negociação
  valor_unitario_area?: number;
  desconto_pct?: number;
  validade_dias?: number;

  opcionais?: OpcionaisDemarcacao;
}

export interface CodigosMintadosFQNS {
  prefixo: string;                  // ex: 'FQNS'
  mintado_em: string;               // ISO 8601
  vertices: string[];               // ['FQNS-V-024', ...]
  marcos_por_tipo: {
    concreto: string[];             // ['FQNS-M-0142-CC', ...]
    tubo_galvanizado: string[];     // ['FQNS-M-0089-TG', ...]
    madeira: string[];              // ['FQNS-P-0067-MD', ...]
  };
}

export interface DemarcacaoLotesOutput {
  honorarios_romatec: {
    trt_cft: number;
    tecnicos_campo: number;
    marcos_discriminados: { tipo: MaterialMarco; qtd: number; subtotal: number }[];
    marcos_subtotal: number;
    deslocamento: number;
    area_servico: number;
    complexidade_multiplicador: number;
    subtotal_apos_complexidade: number;
    assessoria: number;
    desconto_valor: number;
    total: number;
  };
  secao_opcionais_demarcacao: {
    linhas: { rotulo: string; valor: number | 'sob_orcamento'; contratado: boolean }[];
    subtotal: number;
  };
  parcelas: { numero: 1 | 2 | 3; rotulo: string; valor: number; percentual: number }[];
  validade_dias: number;
  salario_minimo_usado: number;
  codigos_mintados?: CodigosMintadosFQNS;
  historico_revisoes?: { revisao: string; timestamp: string; autor: string; motivo?: string }[];
}
```

---

## 🧱 PARTE 2 · MIGRATION IDEMPOTENTE (`migrations-usuarios-credencial-incra.ts`)

Roda no boot do server (espelho de `migrations-propostas-revisao.ts`).

```typescript
// Comportamento esperado:
// 1. Verifica se colunas existem (INFORMATION_SCHEMA.COLUMNS).
// 2. Se não existem, executa:
//    ALTER TABLE usuarios
//      ADD COLUMN credencial_incra_prefixo VARCHAR(20) NULL,
//      ADD COLUMN credencial_contadores JSON NULL;
// 3. Verifica se usuário CEO já tem prefixo seedado.
//    Critério: WHERE email LIKE '%romario%' OR cpf = '<CPF_DO_CEO>' (parametrizar)
//    Se NÃO tem: UPDATE com prefixo 'FQNS' + contadores zerados:
//      JSON_OBJECT('V', 0, 'M_CC', 0, 'M_TG', 0, 'P', 0)
// 4. Idempotente: rodar 100x não duplica nem reseta.
// 5. Logar com prefixo [MigrationUsuariosCredencial].
```

**Justificativa para esse ALTER:** o prompt promete zero ALTER em **`propostas`**. Este é em **`usuarios`** (metadado do técnico). Promessa preservada.

---

## 🧱 PARTE 3 · PARÂMETROS (`config/pricing-params.json`)

Adicionar bloco no nível raiz do JSON:

```json
"demarcacao_lotes_2026": {
  "valor_m2_urbano_default": 1.50,
  "valor_hectare_rural_default": 80.00,
  "fator_diaria_tecnico": 0.42,
  "fator_diaria_tecnico_fonte": "CFT-MA Resolução nº 12/2025 art. 4º",
  "valor_km_deslocamento": 3.50,
  "marcos": {
    "concreto":         { "valor_unitario": 120.00, "rotulo": "Marco de Concreto Padrão INCRA", "codigo_funcao": "M", "codigo_material": "CC", "largura_numero": 4 },
    "madeira":          { "valor_unitario":  35.00, "rotulo": "Marco de Madeira de Lei",        "codigo_funcao": "P", "codigo_material": "MD", "largura_numero": 3 },
    "tubo_galvanizado": { "valor_unitario":  85.00, "rotulo": "Marco em Tubo Galvanizado",      "codigo_funcao": "M", "codigo_material": "TG", "largura_numero": 4 }
  },
  "vertices": {
    "codigo_funcao": "V",
    "largura_numero": 3
  },
  "opcionais": {
    "laudo_tecnico":         { "rotulo": "Laudo Técnico de Demarcação", "valor_unitario_sm_multiplicador": 1.0 },
    "alinhamento_cerca":     { "rotulo": "Alinhamento de Cerca", "valor_unitario": 4.50, "unidade": "metro" },
    "croqui_assinado":       { "rotulo": "Croqui Assinado em Cartório", "valor_unitario": 180.00 },
    "acompanhamento_obra":   { "rotulo": "Acompanhamento de Obra", "valor_unitario": 350.00, "unidade": "diaria" },
    "consultoria_juridica":  { "rotulo": "Consultoria Jurídica", "valor": "sob_orcamento" }
  },
  "minimo_garantido_sm": 2,
  "complexidade_multiplicadores": { "simples": 1.0, "media": 1.3, "alta": 1.6 },
  "assessoria_pct": 0.05,
  "desconto_max_pct": 30,
  "parcelas": [
    { "numero": 1, "rotulo": "Assinatura do contrato",      "percentual": 40 },
    { "numero": 2, "rotulo": "Entrega do trabalho de campo", "percentual": 30 },
    { "numero": 3, "rotulo": "Entrega final + TRT/CFT",      "percentual": 30 }
  ],
  "validade_dias_default": 15
}
```

**Polimento aplicado:** `laudo_tecnico.valor_unitario_sm_multiplicador: 1.0` (number) em vez de string `"1 SM"` — engine lê e multiplica por SALARIO_MINIMO_VIGENTE em runtime.

---

## 🧱 PARTE 4 · ENGINE DE CÁLCULO (`src/services/pricing/demarcacaoLotes.ts`)

Módulo standalone (sem deps de pdfkit/mysql/voyageai — espelho de `avisoDRL.ts`). Importa apenas `round2` de `./georreferenciamento.ts`.

### 4.1 Fórmula

```
SM = lerSalarioMinimoVigenteRuntime()   // sem cache

// 1. TRT/CFT — tabela 2026 (chave trt_cft já existente em pricing-params)
trt_cft = pricing-params.anotacao_tecnica_2026.trt_cft.valor   // = 93.40

// 2. Técnicos de campo (justificativa documental inline na config)
tecnicos_campo = diarias_equipe × SM × pricing-params.demarcacao_lotes_2026.fator_diaria_tecnico

// 3. Marcos discriminados (valor unitário CONGELADO por linha)
marcos_subtotal = Σ (marco.quantidade × marco.valor_unitario_congelado)
// servico_piqueteamento=false → marcos pode ser [] e subtotal = 0

// 4. Deslocamento
deslocamento = km_deslocamento × pricing-params.demarcacao_lotes_2026.valor_km_deslocamento

// 5. Área × valor unitário (override opcional no input)
area_servico = subtipo === 'demarcacao_urbana'
  ? area_m2 × (valor_unitario_area ?? params.valor_m2_urbano_default)
  : area_hectares × (valor_unitario_area ?? params.valor_hectare_rural_default)

// 6. Subtotal bruto
subtotal_bruto = trt_cft + tecnicos_campo + marcos_subtotal + deslocamento + area_servico

// 7. Complexidade
multiplicador = params.complexidade_multiplicadores[complexidade]
subtotal_apos_complexidade = round2(subtotal_bruto × multiplicador)

// 8. Assessoria
assessoria = round2(subtotal_apos_complexidade × params.assessoria_pct)

// 9. Desconto
base_desconto = subtotal_apos_complexidade + assessoria
desconto_valor = round2(base_desconto × (desconto_pct ?? 0) / 100)

// 10. Total Romatec
total = round2(base_desconto - desconto_valor)

// 11. Mínimo garantido (2 SM)
if (total < params.minimo_garantido_sm × SM) {
  total = round2(params.minimo_garantido_sm × SM)
}
```

### 4.2 Opcionais (NÃO somam ao total Romatec)

5 linhas SEMPRE renderizadas, subtotal próprio. Espelho do bloco `secao_opcionais_georref` da v3.23.5.

- `laudo_tecnico.valor` = `valor_unitario_sm_multiplicador × SM` (resolvido em runtime).
- `alinhamento_cerca.valor` = `metros × valor_unitario` (R$ 4,50/m default).
- `consultoria_juridica.valor` = `'sob_orcamento'` (string literal — nunca número).

### 4.3 Parcelas

3 parcelas: 40% / 30% / 30% (assinatura / entrega de campo / entrega final + TRT/CFT).

### 4.4 Validações (lançar `Error` descritivo)

1. `subtipo='demarcacao_urbana'` → `area_m2 > 0` obrigatório, `area_hectares` deve ser undefined/null.
2. `subtipo='demarcacao_rural'` → `area_hectares > 0` obrigatório, `area_m2` deve ser undefined/null.
3. `num_vertices >= 3`.
4. `servico_piqueteamento=true` → `Σ marco.quantidade === num_vertices`.
5. `servico_piqueteamento=false` → `marcos` pode estar vazio OU ter valores (sem validação de soma).
6. `complexidade ∈ {simples, media, alta}`.
7. `desconto_pct ∈ [0, 30]`.
8. `diarias_equipe >= 1`, `km_deslocamento >= 0`.

### 4.5 Guard de fechamento

Recalcula final pela cadeia e compara com `total` (lançado em complexidade simples/média/alta nos testes).

```typescript
const recalc = trt_cft + tecnicos_campo + marcos_subtotal + deslocamento + area_servico;
const apos = round2(recalc * multiplicador);
const com_assess = round2(apos + assessoria);
const final = round2(com_assess - desconto_valor);
if (final < minimo_garantido) {
  if (round2(total) !== round2(minimo_garantido)) throw new Error(`Guard mínimo: ${total} ≠ ${minimo_garantido}`);
} else {
  if (round2(final) !== round2(total)) throw new Error(`Guard fechamento: esperado ${final}, obtido ${total}`);
}
```

---

## 🧱 PARTE 5 · MINT ATÔMICO FQNS (`src/services/pricing/mintCodigosDemarcacao.ts`)

```typescript
import { PoolConnection, RowDataPacket, OkPacket } from 'mysql2/promise';
import { MarcoDiscriminado, CodigosMintadosFQNS } from './types';

interface ContadoresFQNS {
  V: number;
  M_CC: number;
  M_TG: number;
  P: number;
}

export async function mintarCodigosDemarcacao(
  conn: PoolConnection,
  userId: number,
  input: {
    num_vertices: number;
    marcos: MarcoDiscriminado[];
  }
): Promise<CodigosMintadosFQNS> {
  await conn.beginTransaction();
  try {
    // 1. Lock pessimista no row do usuário
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT credencial_incra_prefixo, credencial_contadores FROM usuarios WHERE id = ? FOR UPDATE',
      [userId]
    );
    if (!rows.length) throw new Error(`Usuário ${userId} não encontrado`);
    const prefixo: string = rows[0].credencial_incra_prefixo;
    if (!prefixo) throw new Error(`Usuário ${userId} sem credencial INCRA configurada`);

    const contadores: ContadoresFQNS = typeof rows[0].credencial_contadores === 'string'
      ? JSON.parse(rows[0].credencial_contadores)
      : rows[0].credencial_contadores;

    // 2. Calcular quantidades por sufixo
    const qtdConcreto = input.marcos.filter(m => m.tipo === 'concreto').reduce((s, m) => s + m.quantidade, 0);
    const qtdTubo     = input.marcos.filter(m => m.tipo === 'tubo_galvanizado').reduce((s, m) => s + m.quantidade, 0);
    const qtdMadeira  = input.marcos.filter(m => m.tipo === 'madeira').reduce((s, m) => s + m.quantidade, 0);

    // 3. Gerar listas
    const vertices = gerarLista(prefixo, 'V', contadores.V + 1, input.num_vertices, 3);
    const concreto = gerarListaComSufixo(prefixo, 'M', contadores.M_CC + 1, qtdConcreto, 4, 'CC');
    const tubo     = gerarListaComSufixo(prefixo, 'M', contadores.M_TG + 1, qtdTubo,     4, 'TG');
    const madeira  = gerarListaComSufixo(prefixo, 'P', contadores.P + 1,    qtdMadeira,  3, 'MD');

    // 4. Atualizar contadores
    const novosContadores: ContadoresFQNS = {
      V:    contadores.V    + input.num_vertices,
      M_CC: contadores.M_CC + qtdConcreto,
      M_TG: contadores.M_TG + qtdTubo,
      P:    contadores.P    + qtdMadeira,
    };
    await conn.query<OkPacket>(
      'UPDATE usuarios SET credencial_contadores = ? WHERE id = ?',
      [JSON.stringify(novosContadores), userId]
    );

    await conn.commit();
    return {
      prefixo,
      mintado_em: new Date().toISOString(),
      vertices,
      marcos_por_tipo: {
        concreto,
        tubo_galvanizado: tubo,
        madeira,
      },
    };
  } catch (err) {
    await conn.rollback();
    console.error('[MintFQNS]', err);
    throw err;
  }
}

function gerarLista(prefixo: string, funcao: string, inicio: number, qtd: number, largura: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < qtd; i++) {
    out.push(`${prefixo}-${funcao}-${String(inicio + i).padStart(largura, '0')}`);
  }
  return out;
}

function gerarListaComSufixo(prefixo: string, funcao: string, inicio: number, qtd: number, largura: number, sufixo: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < qtd; i++) {
    out.push(`${prefixo}-${funcao}-${String(inicio + i).padStart(largura, '0')}-${sufixo}`);
  }
  return out;
}
```

### 5.1 Quando mintar

Invocado dentro de `atualizarPropostaConsultoria()` (já existente, do v3.23.5) quando:

- `subtipo ∈ {demarcacao_urbana, demarcacao_rural}`
- `status_anterior === 'RASCUNHO'`
- `status_novo === 'ENVIADA'`
- `dados_imovel.codigos_mintados` NÃO existe ainda (anti-replay)

**Persistência:** resultado vai em `dados_imovel.codigos_mintados` (snapshot eterno — nunca re-mintar).

### 5.2 Delta-mint em revisão

Se PUT chega com proposta em status `ENVIADA` (revisão R2+) e quantidade de marcos foi alterada:

- Marcos pré-existentes mantêm códigos.
- Apenas o **delta adicional** consome contador.
- Log em `custos_calculados.historico_revisoes` com motivo `"+N marcos concreto adicionados em R2"`.

---

## 🧱 PARTE 6 · AVISO DRL ADAPTADO (`src/integrations/avisoDRL.ts`)

Atualizar signature para aceitar união de finalidades:

```typescript
import { FinalidadeGeorref } from '../services/pricing/types';
import { FinalidadeDemarcacao } from '../services/pricing/types';

export function montarAvisoDRL(
  finalidade: FinalidadeGeorref | FinalidadeDemarcacao
): AvisoDRL { /* ... */ }
```

### 6.1 Texto para Demarcação

**Base (3 parágrafos para todas as finalidades):**

1. *"Em qualquer trabalho de demarcação física de lote, a coleta de Declarações de Respeito de Limite (DRLs) dos confrontantes é **OBRIGAÇÃO LEGAL E EXCLUSIVA** do proprietário, conforme Lei nº 10.267/2001, NTGIR 3ª Ed. (INCRA) e Provimento CNJ nº 65/2017."*

2. *"A Romatec **gera** os documentos técnicos (planta, memorial, croqui), mas **NÃO COLETA** as DRLs nem reconhece firma — esse é ato pessoal do proprietário perante cartório."*

3. *"Sem DRL com **RECONHECIMENTO DE FIRMA EM CARTÓRIO** de todos os confrontantes, o cartório de imóveis **NÃO AVERBA** a demarcação na matrícula, mesmo após instalação física dos marcos."*

**Reforço SÓ para `subdivisao_lote`:** parágrafo adicional `reforco: true` em vermelho destacado:

> *"**ATENÇÃO REFORÇADA — SUBDIVISÃO DE LOTE:** ausência de DRL impede a abertura de novas matrículas para as frações resultantes, mesmo que o desmembramento tenha sido aprovado pela Prefeitura."*

**Sem reforço** para `demarcacao_inicial`, `redemarcacao`, `piqueteamento_apenas` (texto base já cobre).

---

## 🧱 PARTE 7 · PDF (`src/integrations/propostasConsultoria.ts`)

### 7.1 Invocação

```typescript
// Dentro do gerador de body principal, adicionar APÓS o ramo do Georref:
if (p.subtipo === 'demarcacao_urbana' || p.subtipo === 'demarcacao_rural') {
  return renderDemarcacaoLotesBody(doc, p);
}
// outros subtipos seguem o body genérico antigo (zero risco de regressão)
```

### 7.2 Layout (11 seções)

| # | Seção | Conteúdo |
|---|---|---|
| 1 | Identificação do Imóvel | Município/UF · Matrícula · CRI · Área · Vértices · Perímetro · (urbano: Loteamento/Quadra/Lote · rural: Denominação/CCIR) |
| 2 | **BOX DOURADO FINALIDADE** | Texto dinâmico por `finalidade` (tabela 7.3) |
| 3 | Escopo do Serviço | 8 itens fixos (RTK GNSS, marcos, croqui, TRT/CFT, etc.) |
| 4 | Honorários Romatec | Tabela: TRT/CFT · Técnicos campo (memória de cálculo) · Deslocamento · Área × valor unit · Complexidade × mult · Assessoria · Desconto · **Total** |
| **4-bis** | **Marcos Discriminados** | Tabela por tipo: linha para cada `MarcoDiscriminado` com tipo · qtd · valor_unit · subtotal. **Total marcos** em destaque |
| **4-ter** | **Identificação dos Marcos (FQNS)** | Lista dos códigos mintados: vértices, marcos concreto, marcos tubo, piquetes madeira. Em rascunho: placeholder `FQNS-V-XXX (será atribuído ao enviar)` |
| 5 | **BOX VERDE TOTAL ROMATEC** | Soma + nota "custos de terceiros não inclusos" |
| 6 | Condições de Pagamento | 3 parcelas 40/30/30 |
| 7 | **BOX CREME CUSTOS DE TERCEIROS** | **Renderizado APENAS se `secao_2_taxas.linhas.length > 0`** (espelho exato do Georref — evita box vazio). Texto urbano: emolumentos do CRI competente; texto rural: SIGEF/INCRA/cartório quando aplicável |
| 8 | Serviços Adicionais Opcionais | 5 linhas (checkbox + valor) — espelho do Georref |
| 9 | Documentos a Serem Fornecidos | Checklist granular por subtipo+finalidade (matriz 7.4) com `[IMPRESCINDÍVEL]` em vermelho |
| 10 | Avisos e Condições Técnicas | Parágrafos justificados |
| **10-bis** | **BOX VERMELHO AVISO DRL** | Renderizado via `renderAvisoDRL(doc, finalidade, colX, colW)` adaptado. Pré-calcula altura, `addPage` se não couber |

### 7.3 Texto da BOX DOURADO por finalidade

| Finalidade | Texto |
|---|---|
| `demarcacao_inicial` | "Levantamento topográfico de campo para implantação física dos vértices definidos em projeto e materialização da poligonal do imóvel no terreno." |
| `redemarcacao` | "Repiqueteamento de vértices perdidos/deteriorados, restabelecendo a poligonal original conforme matrícula e levantamento anterior." |
| `subdivisao_lote` | "Demarcação física das frações resultantes de desmembramento/remembramento aprovado, com implantação de marcos nas novas divisas." |
| `piqueteamento_apenas` | "Implantação de marcos físicos em vértices previamente calculados em escritório (sem novo levantamento de campo)." |

### 7.4 Matriz de Documentos por Subtipo + Finalidade

| Subtipo / Finalidade | Documentos `[IMPRESCINDÍVEL]` |
|---|---|
| Urbana / `demarcacao_inicial` | Escritura ou matrícula atual · IPTU 2026 · RG/CPF · Projeto aprovado pela Prefeitura |
| Urbana / `subdivisao_lote` | Escritura · Memorial do desmembramento aprovado · Planta carimbada pela Prefeitura |
| Rural / `demarcacao_inicial` | Matrícula atual · CCIR vigente · ITR último exercício · RG/CPF |
| Rural / `subdivisao_lote` | Matrícula · Georref de origem certificado pelo INCRA · Memorial das frações |
| Qualquer / `redemarcacao` | Levantamento topográfico anterior ou matrícula com descritivo · RG/CPF |
| Qualquer / `piqueteamento_apenas` | Coordenadas dos vértices em arquivo .csv/.kml · Matrícula · RG/CPF |

### 7.5 Layout da seção 4-ter (Identificação dos Marcos FQNS)

```
┌──────────────────────────────────────────────────────────┐
│ 4.3 IDENTIFICAÇÃO DOS MARCOS                             │
├──────────────────────────────────────────────────────────┤
│ Os marcos a serem implantados em campo recebem           │
│ codificação INCRA padrão do técnico responsável,         │
│ conforme NTGIR 3ª Edição:                                │
│                                                          │
│ ▸ Vértices da poligonal (8 total):                       │
│     FQNS-V-024 a FQNS-V-031                              │
│                                                          │
│ ▸ Marcos de concreto (6 total):                          │
│     FQNS-M-0142-CC a FQNS-M-0147-CC                      │
│                                                          │
│ ▸ Marcos de tubo galvanizado (2 total):                  │
│     FQNS-M-0089-TG, FQNS-M-0090-TG                       │
│                                                          │
│ ▸ Piquetes de madeira (0 total): —                       │
│                                                          │
│ Cada marco é gravado/etiquetado fisicamente com seu      │
│ código único para rastreabilidade e responsabilidade     │
│ técnica perante INCRA/MPF.                               │
└──────────────────────────────────────────────────────────┘
```

**Em rascunho:** trocar listas concretas por `"FQNS-V-XXX (códigos serão atribuídos no envio da proposta)"`.

---

## 🧱 PARTE 8 · FRONTEND (`src/public/obras.html`)

### 8.1 Cards no menu Proposta

2 cards novos, posicionados **imediatamente após Georreferenciamento Rural** (agrupamento visual dos serviços de campo):

```
🌆 Demarcação Urbana        → subtipo='demarcacao_urbana'
🌾 Demarcação Rural         → subtipo='demarcacao_rural'
```

### 8.2 `renderConsultoriaFormDemarcacao(subtipo)`

Campos:

- Subtipo (hidden, vem do card clicado)
- Município / UF (autocomplete via endpoint existente)
- Matrícula (opcional) · CRI (autocomplete via `GET /api/cartorios/autocomplete` introduzido em v3.22.0; default dinâmico "CRI de {Município}/{UF}")
- **Se urbano:** Loteamento, Quadra, Lote, Área (m²)
- **Se rural:** Denominação, CCIR, Área (ha)
- Perímetro (m, opcional)
- Nº Vértices (min 3) · Complexidade (select 3 opções) · Finalidade (select 4 opções)
- Checkbox "Serviço de Piqueteamento"
- **Se piqueteamento marcado:** tabela editável de marcos (linha = tipo + qtd) com **validação live `Σ qtd === num_vertices`** (mensagem de erro inline em `#ff3366` se diferente)
- Diárias equipe · Km deslocamento
- Valor unitário (override, opcional) · Desconto % (0..30) · Validade dias (default 15)
- **Bloco Opcionais** (5 checkboxes com inputs condicionais)
- **Preview FQNS** (caixa cinza informativa):
  > *"Esta proposta receberá ~8 códigos FQNS-V, ~6 FQNS-M-CC, ~2 FQNS-M-TG ao ser enviada. Códigos definitivos aparecerão no PDF após envio."*
- Botão **Calcular Preview** → chama engine via endpoint poliglota → renderiza tabela igual ao Georref
- Botão **Submeter** → handler responsável por:
  1. Ler `pricing-params.demarcacao_lotes_2026.marcos[tipo].valor_unitario` no momento do submit
  2. Injetar em cada `MarcoDiscriminado.valor_unitario_congelado`
  3. Empacotar tudo em `dados_imovel.marcos` + `dados_imovel.opcionais` + `dados_imovel.finalidade`

### 8.3 Bloco pós-envio (códigos mintados)

Após resposta de submit confirmando status=ENVIADA, renderizar bloco verde:

```
✅ Proposta enviada · PROP-2026-0042-R1
Códigos FQNS atribuídos (vitalícios):
  Vértices: FQNS-V-024 a FQNS-V-031
  Concreto: FQNS-M-0142-CC a FQNS-M-0147-CC
  ...
[📋 Copiar lista] [🖨️ Imprimir etiquetas]   ← "Imprimir etiquetas" é follow-up, pode ficar desabilitado
```

### 8.4 Acessibilidade

- `prefers-reduced-motion: reduce` desabilita scroll animado
- `aria-expanded`, `aria-controls`, `aria-live="polite"` no container
- Foco programático opcional via `?autofocus=1` (NÃO default)
- `tabindex` correto em todos os inputs novos

### 8.5 Cache de form (volta do preview)

Restaurar TODOS os campos, incluindo: marcos[], opcionais{}, finalidade, perimetro_m, validade_dias.

---

## 🧱 PARTE 9 · PÁGINA PÚBLICA (`src/public/recibo-validar.html`)

Detector atual já reconhece `payload.tipo === 'proposta'` (corrigido em v3.23.5). Adicionar dentro:

```javascript
if (payload.subtipo === 'demarcacao_urbana' || payload.subtipo === 'demarcacao_rural') {
  // Renderizar:
  // - Número, status, cliente, valor, validade
  // - Box dourado FINALIDADE
  // - Bloco "Marcos a implantar" (tabela qtd × tipo)
  // - Bloco "Códigos FQNS atribuídos" (quando codigos_mintados existir)
  // - Lista de opcionais contratados (quando há algum)
  // - Box vermelho DRL via avisoDRLHtml(finalidade)
  // - Link pra baixar PDF
  // - Hash de autenticidade
}
```

CSS: reusar classes existentes (`.aviso-drl`, `.box-dourado`, etc).

---

## 🧪 PARTE 10 · TESTES VITEST

### 10.1 `src/services/pricing/demarcacaoLotes.test.ts` (22 testes)

1. ✅ Urbana válida (area_m2 preenchida, area_hectares undefined).
2. ✅ Rural válida (area_hectares preenchida, area_m2 undefined).
3. ❌ Ambas áreas preenchidas → throw.
4. ❌ Rural sem area_hectares → throw.
5. ✅ piqueteamento=true + Σmarcos=num_vertices → aceita.
6. ❌ piqueteamento=true + Σmarcos ≠ num_vertices → throw.
7. ✅ piqueteamento=false + marcos=[] → aceita.
8. ✅ piqueteamento=false + marcos.length>0 com Σ ≠ vértices → aceita.
9. ✅ Marcos discriminados: 3 tipos diferentes → subtotais separados, soma correta.
10. ✅ Cenário canônico urbano: 500 m² · 8 vértices · 8 concreto · 2 diárias · 30 km · média · 10% desc → bate ao centavo.
11. ✅ Cenário canônico rural: 5 ha · 12 vértices · 8 concreto + 4 madeira · alta complexidade → bate ao centavo.
12. ✅ Guard de fechamento em simples/média/alta.
13. ✅ Mínimo garantido (2 SM) aplicado quando cálculo fica abaixo.
14. ✅ Desconto 0% não altera valor.
15. ❌ Desconto 31% → throw.
16. ✅ Override de valor_unitario_area substitui o default.
17. ✅ R$/km lido de pricing-params, não hardcoded.
18. ✅ Opcionais: 5 linhas sempre, mesmo com nenhum contratado.
19. ✅ Opcional alinhamento_cerca com metros=120 → subtotal = 120 × 4.50.
20. ✅ Opcional consultoria_juridica = 'sob_orcamento' (string literal).
21. ✅ Opcionais NÃO somam ao total Romatec.
22. ✅ SALARIO_MINIMO_VIGENTE mudado em runtime → novo cálculo reflete.

### 10.2 `src/integrations/avisoDRL.demarcacao.test.ts` (8 testes)

1. ✅ `demarcacao_inicial` → base de 3 parágrafos, sem reforço.
2. ✅ `redemarcacao` → base, sem reforço.
3. ✅ `piqueteamento_apenas` → base, sem reforço.
4. ✅ `subdivisao_lote` → base + reforço marcado `reforco: true`.
5. ✅ Texto base cita "DRL" e "RECONHECIMENTO DE FIRMA EM CARTÓRIO".
6. ✅ Reforço subdivisão menciona "abertura de novas matrículas".
7. ✅ Estrutura `{ titulo, paragrafos[] }` consistente entre finalidades.
8. ✅ Sem deps externas (importável standalone).

### 10.3 `src/services/pricing/mintCodigosDemarcacao.test.ts` (8 testes)

Usar `mysql2/promise` mock + `vi.fn()`:

1. ✅ Vértices: 8 vértices, contador zerado → gera V-001 a V-008 com padding 3 dígitos.
2. ✅ Marcos concreto: 6 marcos → gera M-0001-CC a M-0006-CC; M_TG NÃO incrementa.
3. ✅ Marcos mistos: 4 concreto + 2 tubo + 3 madeira → 3 contadores avançam independentemente, V-codes sem sufixo material.
4. ✅ Contador vitalício: proposta 1 mintada com M_CC=0001..0008, proposta 2 começa em M_CC=0009.
5. ✅ Anti-replay externo: chamar mintar duas vezes na mesma proposta (via `atualizarPropostaConsultoria`) NÃO duplica (verificar `dados_imovel.codigos_mintados` já existe).
6. ✅ Delta-mint: proposta original tinha 4 concreto, revisão R2 com 6 → mintar SÓ +2 adicionais, preservar os 4 originais por código exato.
7. ✅ Usuário sem `credencial_incra_prefixo` → throw com mensagem clara.
8. ✅ Lock atômico: 2 chamadas concorrentes do mesmo usuário não colidem (mockar transação + verificar ordem).

### 10.4 Total esperado

```
454 (atuais v3.23.5) + 38 (novos) = 492 passing, 1 skipped, 0 failures
```

Cobertura ≥ 95% em `demarcacaoLotes.ts` e `mintCodigosDemarcacao.ts`.

---

## ✅ CHECKLIST DE ENTREGA (DEFINITION OF DONE)

- [ ] Branch `feature/proposta-demarcacao-lotes-v3.27.0` criada a partir de `main`
- [ ] Migration `migrations-usuarios-credencial-incra.ts` rodando idempotente no boot
- [ ] Seed do CEO (José Romário) com prefixo `FQNS` e contadores zerados
- [ ] Tipos novos em `src/services/pricing/types.ts` (InputDemarcacaoLotes, MarcoDiscriminado, CodigosMintadosFQNS, etc.)
- [ ] Bloco `demarcacao_lotes_2026` em `pricing-params.json` com fator 0.42 documentado inline
- [ ] `laudo_tecnico.valor_unitario_sm_multiplicador: 1.0` (number, não string)
- [ ] Engine `demarcacaoLotes.ts` criada, cobertura ≥ 95%
- [ ] Mint `mintCodigosDemarcacao.ts` criado com lock pessimista
- [ ] Anti-replay e delta-mint funcionais
- [ ] Aviso DRL estendido para 4 finalidades de Demarcação
- [ ] 22 testes de cálculo passando
- [ ] 8 testes de aviso DRL passando
- [ ] 8 testes de mint passando
- [ ] **Total geral: 492 passing, 1 skipped, 0 failures**
- [ ] `renderDemarcacaoLotesBody()` invocado SÓ para os 2 subtipos
- [ ] Seção 4-bis (Marcos Discriminados) renderizada entre 4 e 5
- [ ] Seção 4-ter (Identificação FQNS) renderizada com placeholder em rascunho
- [ ] Seção 7 (BOX CREME) renderizada SÓ quando `secao_2_taxas.linhas.length > 0`
- [ ] Seção 9 (Documentos) granular por subtipo+finalidade conforme matriz
- [ ] Box vermelho DRL renderizado no fim do body com `addPage` se não couber
- [ ] `recibo-validar.html` renderiza ambos subtipos em `/v/:hash`
- [ ] 2 cards no menu Proposta (Urbana + Rural), agrupados após Georref Rural
- [ ] Form com validação live `Σ marcos === num_vertices` em piqueteamento=true
- [ ] Cache de form restaura todos os campos novos (marcos, opcionais, finalidade)
- [ ] Preview FQNS exibido em rascunho; bloco verde de códigos exibido pós-envio
- [ ] CRI usa autocomplete `/api/cartorios/autocomplete` (introduzido em v3.22.0)
- [ ] Handler do submit injeta `valor_unitario_congelado` lendo de pricing-params
- [ ] `prefers-reduced-motion` + `aria-expanded` + `aria-controls` + `aria-live` corretos
- [ ] `npm run typecheck` ✅
- [ ] `npm run check:tools` → tool count < 128
- [ ] `git diff main -- 'migrations*propostas*'` vazio (zero ALTER em propostas)
- [ ] `git diff main -- 'src/routes/*'` mostra SÓ edições de rotas existentes (zero rota nova)
- [ ] `git diff main -- src/services/pricing/georreferenciamento.ts` vazio
- [ ] PDF de teste manual gerado e validado visualmente (urbano + rural, todas 4 finalidades, com e sem piqueteamento)
- [ ] Bump de versão em `package.json`: v3.23.5 → v3.27.0
- [ ] Entry em `06-Changelog/v3.27.0-proposta-demarcacao-lotes.md`
- [ ] PR aberto contra `main` com este checklist preenchido

---

## 📝 OBSERVAÇÕES TÉCNICAS

1. **Coluna do CEO em `usuarios`** — confirmar nome exato (`id`, `email`, `cpf`) antes de seedar prefixo FQNS. Critério sugerido: `WHERE email LIKE '%romario%' LIMIT 1`. Se houver doubt, pedir ao José Romário para confirmar `SELECT id, email FROM usuarios WHERE id IN (1,2,3) LIMIT 5`.

2. **Performance do FOR UPDATE** — lock pessimista no row do usuário é OK pra Romatec (volume baixo, 1-5 propostas/dia). Se escalar pra dezenas de técnicos concorrentes, considerar migrar contador pra Redis com `INCRBY`.

3. **Auditoria dos códigos mintados** — `dados_imovel.codigos_mintados.mintado_em` é a única fonte de verdade do "quando esse marco foi atribuído". Se a proposta for cancelada DEPOIS de ENVIADA, os códigos JÁ FORAM CONSUMIDOS do contador (não há rollback automático). É um trade-off: integridade da numeração > eficiência do contador.

4. **Cliente solicita re-edição após envio** — fluxo já existente (PUT + bump `R2`). Códigos antigos preservados. Apenas o delta de novos marcos consome contador adicional.

5. **Outros técnicos** — arquitetura suporta múltiplos prefixos (cada usuário tem o seu). Se José Romário contratar Eng. agrimensor com ART/CREA no futuro, vale ajustar pra usar `art_crea` em vez de `trt_cft` no PDF — fora deste escopo.

6. **Imprimir etiquetas físicas dos marcos com QR code** — follow-up declarado. Não bloqueia merge.

7. **Z-API template** — ajustar pra incluir preview "Marcos: 6 concreto + 2 tubo + 0 madeira" no preview da mensagem WhatsApp. Follow-up. Hoje a Z-API só envia link + texto curto.

8. **Cobertura geral** — meta ≥ 95% nos 2 services novos. O resto do código (helper de PDF, render do form) cobertura best-effort via testes de integração.

---

## 📌 ORDEM DE EXECUÇÃO SUGERIDA

1. `git switch -c feature/proposta-demarcacao-lotes-v3.27.0`
2. Adicionar tipos em `pricing/types.ts`
3. Adicionar bloco `demarcacao_lotes_2026` em `pricing-params.json`
4. Criar `pricing/demarcacaoLotes.ts` + 22 testes (TDD vermelho → verde)
5. Estender `avisoDRL.ts` + 8 testes
6. Criar migration `migrations-usuarios-credencial-incra.ts`
7. Criar `pricing/mintCodigosDemarcacao.ts` + 8 testes (com mock de Pool)
8. Criar `renderDemarcacaoLotesBody()` em `propostasConsultoria.ts`
9. Estender `recibo-validar.html`
10. Implementar `renderConsultoriaFormDemarcacao()` em `obras.html` (2 cards + form completo)
11. `npm run typecheck` ✅
12. `npm test` → **492 passing**
13. `npm run check:tools` → < 128
14. Geração manual de PDF de teste (4 cenários: urbano c/ piquet, urbano s/ piquet, rural c/ piquet, rural s/ piquet)
15. Bump versão + entrada changelog
16. Commit semântico: `feat(proposta): demarcação de lotes urbana e rural com codificação FQNS (v3.27.0)`
17. `gh pr create --base main --title "v3.27.0 — Proposta de Demarcação de Lotes"` com checklist preenchido

---

## 🚀 ENTREGA AO CODE

Cola este documento inteiro no Claude Code (ou Cursor) com a instrução:

> "Implementa exatamente o que está descrito. Branch é `feature/proposta-demarcacao-lotes-v3.27.0` contra `main`. Roda tudo, testes verdes (492 passing), abre PR. NÃO toca em `tools.ts`, `think.ts`, `aiCascade.ts` nem `pricing/georreferenciamento.ts`. NÃO cria endpoint novo. NÃO altera tabela `propostas` — só migra `usuarios`."

---

**Versão alvo após merge:** v3.27.0
**Responsável técnico:** José Romário Pinto Bezerra — TRT/CFT MA · CFT/MA nº 01209185369 · INCRA FQNS · CNAI nº 031161 · CRECI/MA nº 4.705
**Foro:** Açailândia/MA
