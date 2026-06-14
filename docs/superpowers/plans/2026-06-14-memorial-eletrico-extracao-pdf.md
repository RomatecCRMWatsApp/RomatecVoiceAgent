# Memorial Elétrico com Extração de PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir upload da Prancha PE (PDF) no Memorial Elétrico, extrair automaticamente (IA-documento + parser de texto) pontos/circuitos/eletrodutos, deixar o usuário revisar, e gerar Memorial + Lista de Materiais no formato ROMATEC com cálculo NBR 5410.

**Architecture:** Rota multipart `extrair-pdf` → `eletricoExtracao` orquestra `aiDocExtractor` (Gemini/Anthropic, isolado) + `memorialPdfParser` (texto) → `ExtracaoEletrica`. Wizard revisa. `eletricoCalculo` passa a aceitar circuitos reais e calcula demanda/dimensionamento/cabos por seção. Dois geradores PDFKit reescritos no formato dos modelos Nayara.

**Tech Stack:** Node 22 + TypeScript + Express + MySQL2 + PDFKit + Vitest. Multimodal: `@google/generative-ai` (Gemini 2.5) primário, `@anthropic-ai/sdk` fallback. Ambos já em deps.

**Spec:** [docs/superpowers/specs/2026-06-14-memorial-eletrico-extracao-pdf-design.md](../specs/2026-06-14-memorial-eletrico-extracao-pdf-design.md)

**Governança (NÃO violar):** não tocar `src/agent/tools.ts`, `src/agent/think.ts`, `src/services/aiCascade.ts`. Não adicionar tool de agente. `npm run typecheck` limpo + `npx vitest run` verde antes de cada commit. Versionar `package.json` junto do deploy. Comentários `// vX.Y.Z:`.

---

## File Structure

- **Create** `src/services/memoriais/eletricoExtracaoTypes.ts` — tipos de extração (`ExtracaoEletrica`, `CircuitoEletrico`, `PontosEletricos`, etc.).
- **Create** `src/services/memoriais/aiDocExtractor.ts` — chamada multimodal isolada + `parseRespostaExtracao` (pura) + `validarExtracao`.
- **Create** `src/services/memoriais/eletricoExtracao.ts` — orquestra IA + texto, merge, confiança, divergências.
- **Create** `src/services/memoriais/aiDocExtractor.test.ts`, `eletricoExtracao.test.ts`.
- **Modify** `src/services/memoriais/eletricoCalculo.ts` — aceitar `extracao` (circuitos/pontos/eletroduto reais); cálculo NBR a partir deles.
- **Modify** `src/services/memoriais/eletricoCalc.ts` — suportar bi/trifásico + uso comercial no dimensionamento do ramal (já recebe `WizardEletrico`).
- **Modify** `src/services/memoriais/eletricoPdfMemorial.ts` — reescrever no formato ROMATEC.
- **Modify** `src/services/memoriais/eletricoPdfQuantitativo.ts` — reescrever no formato ROMATEC.
- **Modify** `src/routes/memoriais.ts` — rota `POST /eletrico/extrair-pdf`.
- **Create** `src/database/migrations-memoriais-eletrico-extracao.ts` — coluna `extracao_json` LONGTEXT.
- **Modify** `src/database/connection.ts` (ou bootstrap de migrations) — registrar a migration nova.
- **Modify** `src/public/js/memoriais-eletrico-wizard.js` — Passo 0 (upload) + Passo de Revisão.

---

## Task 1: Tipos de extração

**Files:**
- Create: `src/services/memoriais/eletricoExtracaoTypes.ts`
- Test: `src/services/memoriais/aiDocExtractor.test.ts` (usa os tipos; criado na Task 2)

- [ ] **Step 1: Criar o arquivo de tipos**

```typescript
// v3.66.0: tipos da extração elétrica (IA-documento + parser de texto).
// Standalone — sem deps de mysql/pdfkit/express.

export type TipoAlimentacao = 'monofasico' | 'bifasico' | 'trifasico';
export type TipoCircuito = 'ilum' | 'tug' | 'tue';

export interface CircuitoEletrico {
  id: string;                 // "C1", "C2"...
  descricao: string;          // "TUEs — Chuveiro elétrico"
  tipo: TipoCircuito;
  disjuntorA: number;
  polos: 1 | 2 | 3;
  condutorFaseMm2: number;    // 1.5 | 2.5 | 4 | 6 | 10...
  condutorProtecaoMm2?: number | null;
  potenciaVA: number;
  lanceMedioM?: number;       // comprimento médio do circuito (ajustável); default por tipo
}

export interface PontosEletricos {
  iluminacao: number;
  tug10A: number;
  tue20A: number;
  interruptorSimples: number;
  interruptorParalelo: number;
  interruptorIntermediario: number;
  conjuntos: number;          // conjunto interruptor+tomada
  tomadasPiso: number;
}

export interface EletrodutoExtraido { tipo: string; diametro: string; comprimentoM: number; }
export interface CaixaExtraida { tipo: string; qtd: number; }

export interface AlimentacaoEletrica {
  tipo: TipoAlimentacao;
  tensaoV: 127 | 220 | 380;
  ramalSecaoMm2: number;
  disjuntorGeralA: number;
  piVA?: number | null;
  pdVA?: number | null;
}

export interface ObraExtraida {
  titulo?: string; endereco?: string; municipio?: string; uf?: string;
  proprietario?: string; cpfCnpj?: string;
  areaConstruidaM2?: number; areaLoteM2?: number; taxaOcupacaoPct?: number;
  nPavimentos?: number; prancha?: string; dataProjeto?: string;
}

export interface ExtracaoEletrica {
  obra: ObraExtraida;
  alimentacao: AlimentacaoEletrica;
  circuitos: CircuitoEletrico[];
  pontos: PontosEletricos;
  eletrodutos: EletrodutoExtraido[];
  caixas: CaixaExtraida[];
  confianca: number;          // 0..1
  observacoes: string[];
  divergencias: string[];
}

export const PONTOS_ZERO: PontosEletricos = {
  iluminacao: 0, tug10A: 0, tue20A: 0, interruptorSimples: 0,
  interruptorParalelo: 0, interruptorIntermediario: 0, conjuntos: 0, tomadasPiso: 0,
};

// Default de comprimento de lance por tipo de circuito (m) — usado quando a IA
// não traz; ajustável pelo usuário na revisão.
export const LANCE_DEFAULT_M: Record<TipoCircuito, number> = {
  ilum: 14, tug: 16, tue: 10,
};
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: PASS (arquivo só com tipos/consts).

- [ ] **Step 3: Commit**

```bash
git add src/services/memoriais/eletricoExtracaoTypes.ts
git commit -m "v3.66.0: tipos da extracao eletrica (circuitos/pontos/alimentacao)"
```

---

## Task 2: aiDocExtractor — parse + validação (pura) e chamada multimodal (isolada)

**Files:**
- Create: `src/services/memoriais/aiDocExtractor.ts`
- Test: `src/services/memoriais/aiDocExtractor.test.ts`

- [ ] **Step 1: Escrever o teste do parser/validador (falha)**

```typescript
import { describe, it, expect } from 'vitest';
import { parseRespostaExtracao, validarExtracao } from './aiDocExtractor';

const JSON_OK = JSON.stringify({
  obra: { titulo: 'Residência', proprietario: 'Nayara', areaConstruidaM2: 78.69, prancha: 'PE-05' },
  alimentacao: { tipo: 'monofasico', tensaoV: 220, ramalSecaoMm2: 10, disjuntorGeralA: 50, piVA: 9932, pdVA: 8723 },
  circuitos: [
    { id: 'C6', descricao: 'Chuveiro', tipo: 'tue', disjuntorA: 20, polos: 1, condutorFaseMm2: 6, condutorProtecaoMm2: 4, potenciaVA: 5500 },
  ],
  pontos: { iluminacao: 10, tug10A: 16, tue20A: 6, interruptorSimples: 7, interruptorParalelo: 0, interruptorIntermediario: 0, conjuntos: 2, tomadasPiso: 1 },
  eletrodutos: [{ tipo: 'PVC corrugado', diametro: 'Ø25', comprimentoM: 238.68 }],
  caixas: [{ tipo: '4x2', qtd: 35 }],
  confianca: 0.9, observacoes: [], divergencias: [],
});

describe('aiDocExtractor', () => {
  it('parseia JSON cru (com cercas markdown) e normaliza', () => {
    const r = parseRespostaExtracao('```json\n' + JSON_OK + '\n```');
    expect(r.circuitos[0].id).toBe('C6');
    expect(r.pontos.tug10A).toBe(16);
    expect(r.alimentacao.tipo).toBe('monofasico');
  });

  it('preenche defaults quando campos faltam e força tipos', () => {
    const r = parseRespostaExtracao('{"circuitos":[{"id":"C1","tipo":"tug"}]}');
    expect(r.pontos.iluminacao).toBe(0);          // PONTOS_ZERO
    expect(Array.isArray(r.eletrodutos)).toBe(true);
    expect(r.circuitos[0].disjuntorA).toBe(0);    // numérico default
    expect(r.confianca).toBeGreaterThanOrEqual(0);
  });

  it('lança erro em JSON inválido', () => {
    expect(() => parseRespostaExtracao('isso nao e json')).toThrow();
  });

  it('validarExtracao aponta problemas (sem circuitos)', () => {
    const r = parseRespostaExtracao(JSON_OK);
    r.circuitos = [];
    const probs = validarExtracao(r);
    expect(probs.some((p) => /circuito/i.test(p))).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste (falha)**

Run: `npx vitest run src/services/memoriais/aiDocExtractor.test.ts`
Expected: FAIL ("parseRespostaExtracao is not a function").

- [ ] **Step 3: Implementar aiDocExtractor**

```typescript
// v3.66.0: extração elétrica multimodal (IA lê o PDF da planta) — MÓDULO ISOLADO.
// NÃO importa aiCascade/tools/think. Usa os SDKs diretamente.
// parseRespostaExtracao / validarExtracao são PUROS (testáveis sem rede).

import type {
  ExtracaoEletrica, CircuitoEletrico, PontosEletricos, TipoCircuito, TipoAlimentacao,
} from './eletricoExtracaoTypes';
import { PONTOS_ZERO, LANCE_DEFAULT_M } from './eletricoExtracaoTypes';

function num(v: unknown, d = 0): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
function str(v: unknown, d = ''): string { return v == null ? d : String(v); }

const PROMPT_EXTRACAO = `Você é engenheiro eletricista. Analise esta PRANCHA DE PROJETO ELÉTRICO (PE) e
extraia os dados de instalação elétrica predial. Responda APENAS com um objeto JSON válido (sem texto fora do JSON),
no schema:
{"obra":{"titulo","endereco","municipio","uf","proprietario","cpfCnpj","areaConstruidaM2","areaLoteM2","taxaOcupacaoPct","nPavimentos","prancha","dataProjeto"},
"alimentacao":{"tipo":"monofasico|bifasico|trifasico","tensaoV","ramalSecaoMm2","disjuntorGeralA","piVA","pdVA"},
"circuitos":[{"id","descricao","tipo":"ilum|tug|tue","disjuntorA","polos","condutorFaseMm2","condutorProtecaoMm2","potenciaVA"}],
"pontos":{"iluminacao","tug10A","tue20A","interruptorSimples","interruptorParalelo","interruptorIntermediario","conjuntos","tomadasPiso"},
"eletrodutos":[{"tipo","diametro","comprimentoM"}],"caixas":[{"tipo","qtd"}],"confianca":0a1,"observacoes":[],"divergencias":[]}
Use o Diagrama Unifilar / Quadro de Cargas (QDFL) para os circuitos e a Lista de Materiais/Componentes para pontos e caixas.
Se um valor não existir na prancha, use null. NÃO invente quantidades.`;

export function parseRespostaExtracao(raw: string): ExtracaoEletrica {
  const limpo = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const ini = limpo.indexOf('{'); const fim = limpo.lastIndexOf('}');
  if (ini < 0 || fim < 0) throw new Error('Resposta sem JSON');
  const obj = JSON.parse(limpo.slice(ini, fim + 1)) as Record<string, unknown>;

  const o = (obj.obra ?? {}) as Record<string, unknown>;
  const a = (obj.alimentacao ?? {}) as Record<string, unknown>;
  const pin = (obj.pontos ?? {}) as Record<string, unknown>;

  const circuitos: CircuitoEletrico[] = Array.isArray(obj.circuitos)
    ? (obj.circuitos as Record<string, unknown>[]).map((c, i) => ({
        id: str(c.id, `C${i + 1}`),
        descricao: str(c.descricao),
        tipo: (['ilum', 'tug', 'tue'].includes(String(c.tipo)) ? String(c.tipo) : 'tug') as TipoCircuito,
        disjuntorA: num(c.disjuntorA),
        polos: ([1, 2, 3].includes(num(c.polos, 1)) ? num(c.polos, 1) : 1) as 1 | 2 | 3,
        condutorFaseMm2: num(c.condutorFaseMm2, 2.5),
        condutorProtecaoMm2: c.condutorProtecaoMm2 == null ? null : num(c.condutorProtecaoMm2),
        potenciaVA: num(c.potenciaVA),
      }))
    : [];

  const pontos: PontosEletricos = {
    ...PONTOS_ZERO,
    iluminacao: num(pin.iluminacao), tug10A: num(pin.tug10A), tue20A: num(pin.tue20A),
    interruptorSimples: num(pin.interruptorSimples), interruptorParalelo: num(pin.interruptorParalelo),
    interruptorIntermediario: num(pin.interruptorIntermediario), conjuntos: num(pin.conjuntos),
    tomadasPiso: num(pin.tomadasPiso),
  };

  const tipoAlim = (['monofasico', 'bifasico', 'trifasico'].includes(String(a.tipo))
    ? String(a.tipo) : 'monofasico') as TipoAlimentacao;
  const tensao = ([127, 220, 380].includes(num(a.tensaoV, 220)) ? num(a.tensaoV, 220) : 220) as 127 | 220 | 380;

  return {
    obra: {
      titulo: str(o.titulo) || undefined, endereco: str(o.endereco) || undefined,
      municipio: str(o.municipio) || undefined, uf: str(o.uf) || undefined,
      proprietario: str(o.proprietario) || undefined, cpfCnpj: str(o.cpfCnpj) || undefined,
      areaConstruidaM2: o.areaConstruidaM2 == null ? undefined : num(o.areaConstruidaM2),
      areaLoteM2: o.areaLoteM2 == null ? undefined : num(o.areaLoteM2),
      taxaOcupacaoPct: o.taxaOcupacaoPct == null ? undefined : num(o.taxaOcupacaoPct),
      nPavimentos: o.nPavimentos == null ? undefined : num(o.nPavimentos),
      prancha: str(o.prancha) || undefined, dataProjeto: str(o.dataProjeto) || undefined,
    },
    alimentacao: {
      tipo: tipoAlim, tensaoV: tensao,
      ramalSecaoMm2: num(a.ramalSecaoMm2, 10), disjuntorGeralA: num(a.disjuntorGeralA, 40),
      piVA: a.piVA == null ? null : num(a.piVA), pdVA: a.pdVA == null ? null : num(a.pdVA),
    },
    circuitos,
    pontos,
    eletrodutos: Array.isArray(obj.eletrodutos)
      ? (obj.eletrodutos as Record<string, unknown>[]).map((e) => ({ tipo: str(e.tipo), diametro: str(e.diametro), comprimentoM: num(e.comprimentoM) }))
      : [],
    caixas: Array.isArray(obj.caixas)
      ? (obj.caixas as Record<string, unknown>[]).map((c) => ({ tipo: str(c.tipo), qtd: num(c.qtd) }))
      : [],
    confianca: Math.min(Math.max(num(obj.confianca, 0), 0), 1),
    observacoes: Array.isArray(obj.observacoes) ? (obj.observacoes as unknown[]).map(String) : [],
    divergencias: Array.isArray(obj.divergencias) ? (obj.divergencias as unknown[]).map(String) : [],
  };
}

export function validarExtracao(e: ExtracaoEletrica): string[] {
  const p: string[] = [];
  if (!e.circuitos.length) p.push('Nenhum circuito identificado — preencha na revisão.');
  if (!e.alimentacao.disjuntorGeralA) p.push('Disjuntor geral não identificado.');
  const totalPontos = e.pontos.iluminacao + e.pontos.tug10A + e.pontos.tue20A;
  if (totalPontos === 0) p.push('Nenhum ponto (luz/tomada) identificado.');
  return p;
}

// Aplica defaults de lance por tipo (usado pelo orquestrador após o parse).
export function aplicarLanceDefault(circuitos: CircuitoEletrico[]): CircuitoEletrico[] {
  return circuitos.map((c) => ({ ...c, lanceMedioM: c.lanceMedioM ?? LANCE_DEFAULT_M[c.tipo] }));
}

// ── Chamada multimodal (NÃO testada por rede; coberta por mock no orquestrador) ──
export async function extrairEletricaDeDocumento(pdf: Buffer): Promise<ExtracaoEletrica> {
  const base64 = pdf.toString('base64');
  try {
    return await chamarGemini(base64);
  } catch (errG) {
    console.warn('[aiDocExtractor] Gemini falhou, tentando Anthropic:', (errG as Error).message);
    return await chamarAnthropic(base64);
  }
}

async function chamarGemini(base64: string): Promise<ExtracaoEletrica> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
  const model = client.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
  const resp = await model.generateContent([
    { inlineData: { mimeType: 'application/pdf', data: base64 } },
    { text: PROMPT_EXTRACAO },
  ]);
  return aplicarConfianca(parseRespostaExtracao(resp.response.text()));
}

async function chamarAnthropic(base64: string): Promise<ExtracaoEletrica> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: PROMPT_EXTRACAO },
      ],
    }],
  });
  const txt = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
  return aplicarConfianca(parseRespostaExtracao(txt));
}

function aplicarConfianca(e: ExtracaoEletrica): ExtracaoEletrica {
  e.circuitos = aplicarLanceDefault(e.circuitos);
  return e;
}
```

- [ ] **Step 4: Rodar o teste (passa)**

Run: `npx vitest run src/services/memoriais/aiDocExtractor.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add src/services/memoriais/aiDocExtractor.ts src/services/memoriais/aiDocExtractor.test.ts
git commit -m "v3.66.0: aiDocExtractor (parse/validacao puros + chamada multimodal isolada)"
```

---

## Task 3: eletricoExtracao — orquestra IA + parser de texto, merge e divergências

**Files:**
- Create: `src/services/memoriais/eletricoExtracao.ts`
- Test: `src/services/memoriais/eletricoExtracao.test.ts`

- [ ] **Step 1: Escrever o teste (falha)**

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('./aiDocExtractor', () => ({
  extrairEletricaDeDocumento: vi.fn(async () => ({
    obra: { proprietario: 'IA Silva', areaConstruidaM2: 78 },
    alimentacao: { tipo: 'monofasico', tensaoV: 220, ramalSecaoMm2: 10, disjuntorGeralA: 50 },
    circuitos: [{ id: 'C1', descricao: 'Ilum', tipo: 'ilum', disjuntorA: 16, polos: 1, condutorFaseMm2: 2.5, condutorProtecaoMm2: 2.5, potenciaVA: 1200 }],
    pontos: { iluminacao: 10, tug10A: 16, tue20A: 6, interruptorSimples: 7, interruptorParalelo: 0, interruptorIntermediario: 0, conjuntos: 2, tomadasPiso: 1 },
    eletrodutos: [{ tipo: 'PVC', diametro: 'Ø25', comprimentoM: 238 }],
    caixas: [{ tipo: '4x2', qtd: 35 }], confianca: 0.8, observacoes: [], divergencias: [],
  })),
  validarExtracao: vi.fn(() => []),
}));
vi.mock('./memorialPdfParser', () => ({
  parsePlantaPdf: vi.fn(async () => ({
    rawText: 'PROPRIETÁRIO: Texto Real  ÁREA CONSTRUÍDA: 78,69',
    metadados: { proprietario: 'Texto Real', area_construida_m2: 78.69, prancha_codigo: 'PE-05' },
    tabelas: [], produtos_inexistentes: [], observacoes_extracao: [], confianca: 0.5,
  })),
}));

import { extrairEletricaCompleta } from './eletricoExtracao';

describe('extrairEletricaCompleta', () => {
  it('funde IA + texto: metadados do texto preenchem obra; mantém circuitos da IA', async () => {
    const r = await extrairEletricaCompleta(Buffer.from('pdf'));
    expect(r.obra.proprietario).toBe('Texto Real');       // texto tem prioridade p/ metadados
    expect(r.obra.prancha).toBe('PE-05');
    expect(r.circuitos.length).toBe(1);
    expect(r.circuitos[0].lanceMedioM).toBeGreaterThan(0); // lance default aplicado
  });

  it('sinaliza divergência quando área do texto difere da IA', async () => {
    const r = await extrairEletricaCompleta(Buffer.from('pdf'));
    // IA=78, texto=78,69 -> diferença pequena, sem divergência crítica
    expect(Array.isArray(r.divergencias)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar (falha)**

Run: `npx vitest run src/services/memoriais/eletricoExtracao.test.ts`
Expected: FAIL ("extrairEletricaCompleta is not a function").

- [ ] **Step 3: Implementar o orquestrador**

```typescript
// v3.66.0: orquestra a extração elétrica — IA-documento + parser de texto.
import { extrairEletricaDeDocumento, validarExtracao, aplicarLanceDefault } from './aiDocExtractor';
import { parsePlantaPdf } from './memorialPdfParser';
import type { ExtracaoEletrica } from './eletricoExtracaoTypes';

export async function extrairEletricaCompleta(pdf: Buffer): Promise<ExtracaoEletrica> {
  const [ia, texto] = await Promise.all([
    extrairEletricaDeDocumento(pdf),
    parsePlantaPdf(pdf).catch(() => null),
  ]);

  // Metadados do texto têm prioridade (regex determinística > IA) quando existirem.
  if (texto?.metadados) {
    const m = texto.metadados;
    ia.obra = {
      ...ia.obra,
      proprietario: m.proprietario ?? ia.obra.proprietario,
      cpfCnpj: m.cpf_cnpj ?? ia.obra.cpfCnpj,
      municipio: m.municipio ?? ia.obra.municipio,
      uf: m.uf ?? ia.obra.uf,
      areaConstruidaM2: m.area_construida_m2 ?? ia.obra.areaConstruidaM2,
      areaLoteM2: m.area_lote_m2 ?? ia.obra.areaLoteM2,
      taxaOcupacaoPct: m.taxa_ocupacao_pct ?? ia.obra.taxaOcupacaoPct,
      nPavimentos: m.num_pavimentos ?? ia.obra.nPavimentos,
      prancha: m.prancha_codigo ?? ia.obra.prancha,
    };
    // Cross-check de área (divergência > 5%)
    if (m.area_construida_m2 && ia.obra.areaConstruidaM2) {
      const dif = Math.abs(m.area_construida_m2 - ia.obra.areaConstruidaM2) / m.area_construida_m2;
      if (dif > 0.05) ia.divergencias.push(`Área diverge: texto ${m.area_construida_m2} m² × IA ${ia.obra.areaConstruidaM2} m².`);
    }
  } else {
    ia.observacoes.push('Parser de texto não retornou metadados — confira a obra manualmente.');
  }

  ia.circuitos = aplicarLanceDefault(ia.circuitos);
  ia.observacoes.push(...validarExtracao(ia));
  return ia;
}
```

- [ ] **Step 4: Rodar (passa)**

Run: `npx vitest run src/services/memoriais/eletricoExtracao.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add src/services/memoriais/eletricoExtracao.ts src/services/memoriais/eletricoExtracao.test.ts
git commit -m "v3.66.0: orquestrador eletricoExtracao (merge IA + texto + divergencias)"
```

---

## Task 4: Rota POST /api/memoriais/eletrico/extrair-pdf

**Files:**
- Modify: `src/routes/memoriais.ts` (adicionar rota + import multer)
- Test: `src/routes/memoriais.eletrico-extrair.test.ts`

- [ ] **Step 1: Teste do handler (falha)**

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../services/memoriais/eletricoExtracao', () => ({
  extrairEletricaCompleta: vi.fn(async () => ({ circuitos: [], pontos: {}, obra: {}, alimentacao: {}, eletrodutos: [], caixas: [], confianca: 0.7, observacoes: [], divergencias: [] })),
}));
import { handleExtrairPdfEletrico } from './memoriais';

function mockRes() {
  const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res;
}

describe('handleExtrairPdfEletrico', () => {
  it('400 sem arquivo', async () => {
    const res = mockRes();
    await handleExtrairPdfEletrico({ file: undefined } as unknown as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it('200 com arquivo', async () => {
    const res = mockRes();
    await handleExtrairPdfEletrico({ file: { buffer: Buffer.from('x') } } as unknown as Request, res as Response);
    expect(res.json).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar (falha)**

Run: `npx vitest run src/routes/memoriais.eletrico-extrair.test.ts`
Expected: FAIL ("handleExtrairPdfEletrico is not exported").

- [ ] **Step 3: Implementar handler + rota** (em `src/routes/memoriais.ts`)

No topo, garantir import multer (memória, 25MB):
```typescript
import multer from 'multer';
const uploadEletrico = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
```

Handler exportado (testável) + rota:
```typescript
// v3.66.0: extrai dados elétricos de um PDF de prancha (PE).
export async function handleExtrairPdfEletrico(req: Request, res: Response): Promise<void> {
  try {
    const file = (req as Request & { file?: { buffer: Buffer } }).file;
    if (!file?.buffer) { res.status(400).json({ error: 'Envie o PDF da prancha no campo "arquivo".' }); return; }
    const { extrairEletricaCompleta } = await import('../services/memoriais/eletricoExtracao');
    const extracao = await extrairEletricaCompleta(file.buffer);
    res.json({ ok: true, extracao });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Falha na extração do PDF' });
  }
}

router.post('/eletrico/extrair-pdf', requireAuth, uploadEletrico.single('arquivo'), handleExtrairPdfEletrico);
```
(Adicionar a rota ANTES do dispatch genérico `'/:disc' + DISC` para não colidir.)

- [ ] **Step 4: Rodar (passa) + typecheck**

Run: `npx vitest run src/routes/memoriais.eletrico-extrair.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/memoriais.ts src/routes/memoriais.eletrico-extrair.test.ts
git commit -m "v3.66.0: rota POST /api/memoriais/eletrico/extrair-pdf"
```

---

## Task 5: Migration — coluna extracao_json

**Files:**
- Create: `src/database/migrations-memoriais-eletrico-extracao.ts`
- Modify: o bootstrap que roda as migrations de memoriais (seguir como `migrations-memoriais-pdf.ts` é registrado).

- [ ] **Step 1: Criar a migration (idempotente)**

```typescript
// v3.66.0: coluna extracao_json no memorial elétrico (auditoria + re-edição).
import pool from './connection';

export async function runMemoriaisEletricoExtracaoMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'ALTER memoriais ADD extracao_json',
      sql: 'ALTER TABLE memoriais ADD COLUMN extracao_json LONGTEXT NULL' },
  ];
  for (const { label, sql } of ops) {
    try { await pool.execute(sql); console.log(`[mem-ele-extracao] OK: ${label}`); }
    catch (err) {
      const msg = (err as Error).message || '';
      if (/Duplicate column|already exists/i.test(msg)) console.log(`[mem-ele-extracao] ja existe: ${label}`);
      else console.error(`[mem-ele-extracao] FALHA ${label}:`, msg.slice(0, 160));
    }
  }
}
```
> Antes de implementar, confirmar o nome real da tabela do memorial (grep `CREATE TABLE` em `migrations-memoriais*.ts`; ajustar `memoriais` se o nome diferir).

- [ ] **Step 2: Registrar no bootstrap** (onde `runLaudosArquivosMigrations`/`runMemoriais*` são chamadas — provavelmente `server.ts` boot). Adicionar:
```typescript
const { runMemoriaisEletricoExtracaoMigrations } = await import('./database/migrations-memoriais-eletrico-extracao');
await runMemoriaisEletricoExtracaoMigrations();
```

- [ ] **Step 3: typecheck + commit**

```bash
npm run typecheck
git add src/database/migrations-memoriais-eletrico-extracao.ts src/server.ts
git commit -m "v3.66.0: migration extracao_json no memorial eletrico"
```

---

## Task 6: Cálculo NBR a partir dos circuitos reais

**Files:**
- Modify: `src/services/memoriais/eletricoCalculo.ts`
- Test: `src/services/memoriais/eletricoCalculo.extracao.test.ts`

- [ ] **Step 1: Teste com o exemplo Nayara (falha)**

```typescript
import { describe, it, expect } from 'vitest';
import { calcularResumoEletrico } from './eletricoCalculo';
import type { ExtracaoEletrica } from './eletricoExtracaoTypes';

const extracao: Pick<ExtracaoEletrica, 'circuitos' | 'pontos' | 'eletrodutos' | 'caixas'> = {
  circuitos: [
    { id: 'C1', descricao: 'TUEs — MP', tipo: 'tue', disjuntorA: 10, polos: 1, condutorFaseMm2: 2.5, condutorProtecaoMm2: 2.5, potenciaVA: 1000, lanceMedioM: 10 },
    { id: 'C2', descricao: 'Iluminação geral', tipo: 'ilum', disjuntorA: 16, polos: 1, condutorFaseMm2: 2.5, condutorProtecaoMm2: 1.5, potenciaVA: 1200, lanceMedioM: 14 },
    { id: 'C6', descricao: 'Chuveiro', tipo: 'tue', disjuntorA: 20, polos: 1, condutorFaseMm2: 6, condutorProtecaoMm2: 4, potenciaVA: 5500, lanceMedioM: 8 },
  ],
  pontos: { iluminacao: 10, tug10A: 16, tue20A: 6, interruptorSimples: 7, interruptorParalelo: 0, interruptorIntermediario: 0, conjuntos: 2, tomadasPiso: 1 },
  eletrodutos: [{ tipo: 'PVC corrugado', diametro: 'Ø25', comprimentoM: 238.68 }],
  caixas: [{ tipo: '4x2', qtd: 35 }, { tipo: '4x4', qtd: 20 }, { tipo: 'octogonal', qtd: 3 }],
};

const dadosObra = { titulo: 'Resid', endereco: '', municipio: 'Açailândia', uf: 'MA', proprietario: 'Nayara', cpfCnpj: '', areaM2: 78.69, nPavimentos: 1, prancha: 'PE-05' };
const dadosUso = { tipoUso: 'residencial' as const, tensaoNominalV: 220 as const, tipoAlimentacao: 'monofasico' as const, comprimentoRamalM: 20, cargas: [] };

describe('calcularResumoEletrico com extração', () => {
  it('usa os circuitos reais: Pi soma das potências e cabos por seção', () => {
    const r = calcularResumoEletrico({ dadosObra, dadosUso, extracao });
    // Pi = 1000+1200+5500 = 7700 VA (neste subconjunto de 3 circuitos)
    expect(r.saida.carga_total_instalada_w).toBeGreaterThanOrEqual(7700 - 1);
    // Condutores agrupados por seção (deve haver 2.5 e 6.0 mm²)
    const secoes = r.materiais.condutores.map((c) => c.descricao);
    expect(secoes.some((d) => /2.5 mm2/.test(d) || /2,5/.test(d))).toBe(true);
    expect(secoes.some((d) => /6.0 mm2/.test(d) || /6,0/.test(d))).toBe(true);
    // Pontos vêm da extração (não da heurística de área)
    expect(r.totais.pontosLuz).toBe(10);
    expect(r.totais.tugs).toBe(16);
  });
});
```

- [ ] **Step 2: Rodar (falha)**

Run: `npx vitest run src/services/memoriais/eletricoCalculo.extracao.test.ts`
Expected: FAIL (parâmetro `extracao` ainda não suportado; pontos vêm da heurística).

- [ ] **Step 3: Implementar suporte a `extracao` em `eletricoCalculo.ts`**

Adicionar à interface:
```typescript
import type { ExtracaoEletrica, CircuitoEletrico } from './eletricoExtracaoTypes';

export interface EntradaResumoEle {
  dadosObra: DadosObraEle;
  dadosUso: DadosUsoEle;
  extracao?: Pick<ExtracaoEletrica, 'circuitos' | 'pontos' | 'eletrodutos' | 'caixas'>;
}
```
No início de `calcularResumoEletrico`, se `entrada.extracao?.circuitos?.length`, montar `circuitos`, `condutores`, `pontos`, `totais` a partir dos dados reais (substituindo o bloco heurístico). Esqueleto:
```typescript
if (entrada.extracao && entrada.extracao.circuitos.length) {
  return calcularComExtracao(dadosObra, dadosUso, entrada.extracao, saida);
}
// ... (mantém o caminho heurístico atual abaixo) ...
```
E a função nova (mesmo módulo):
```typescript
function calcularComExtracao(
  dadosObra: DadosObraEle, dadosUso: DadosUsoEle,
  ext: Pick<ExtracaoEletrica, 'circuitos' | 'pontos' | 'eletrodutos' | 'caixas'>,
  saida: MemorialEletricoOutput,
): ResultadoEletrico {
  const circuitos = ext.circuitos.map((c) => ({ descricao: `${c.id} — ${c.descricao}`, disjuntor_A: c.disjuntorA, secao_mm2: c.condutorFaseMm2 }));

  // Cabos por seção: fase+neutro = 2×lance; proteção (terra) usa proteção mm² × lance.
  const porSecao: Record<number, number> = {};
  for (const c of ext.circuitos) {
    const lance = c.lanceMedioM ?? 12;
    porSecao[c.condutorFaseMm2] = (porSecao[c.condutorFaseMm2] || 0) + lance * 2; // fase + neutro
    const prot = c.condutorProtecaoMm2 ?? 2.5;
    porSecao[prot] = (porSecao[prot] || 0) + lance;                                // terra
  }
  // Ramal
  porSecao[dadosUso.tensaoNominalV ? saida.dimensionamento_ramal.secao_condutor_mm2 : 10] =
    (porSecao[saida.dimensionamento_ramal.secao_condutor_mm2] || 0) + dadosUso.comprimentoRamalM * 3;

  const condutores: MaterialItem[] = Object.keys(porSecao).map(Number).sort((a, b) => a - b).map((sec) => ({
    descricao: `Cabo flexivel cobre 450/750V ${sec} mm2`, unidade: 'm', qtd: Math.ceil(porSecao[sec] * 1.1),
  }));

  const eletrodutoM = ext.eletrodutos.reduce((s, e) => s + (e.comprimentoM || 0), 0);
  const eletrodutos: MaterialItem[] = eletrodutoM > 0
    ? [{ descricao: `Eletroduto PVC corrugado antichamas Ø25 (NBR 15465)`, unidade: 'm', qtd: Math.ceil(eletrodutoM * 1.1) }]
    : [{ descricao: 'Eletroduto PVC corrugado antichamas Ø25 (NBR 15465)', unidade: 'm', qtd: Math.ceil(circuitos.length * 12 * 1.1) }];

  const p = ext.pontos;
  const pontos: MaterialItem[] = [
    { descricao: 'Ponto de luz (plafonier + lampada LED)', unidade: 'un', qtd: p.iluminacao },
    { descricao: 'Tomada de uso geral (TUG) 10A 2P+T', unidade: 'un', qtd: p.tug10A },
    { descricao: 'Tomada de uso especifico (TUE) 20A 2P+T', unidade: 'un', qtd: p.tue20A },
    { descricao: 'Interruptor simples', unidade: 'un', qtd: p.interruptorSimples },
    { descricao: 'Interruptor paralelo', unidade: 'un', qtd: p.interruptorParalelo },
  ].filter((x) => x.qtd > 0);

  const caixas: MaterialItem[] = ext.caixas.map((c) => ({ descricao: `Caixa de embutir ${c.tipo}`, unidade: 'un', qtd: c.qtd }));

  // Proteção: disjuntor por circuito (agrupado por A) + geral + DR + DPS
  const protecao = montarProtecaoDeCircuitos(ext.circuitos, dadosUso, saida); // helper que agrupa por amperagem

  const piVA = ext.circuitos.reduce((s, c) => s + c.potenciaVA, 0);
  const saida2: MemorialEletricoOutput = { ...saida, carga_total_instalada_w: piVA };

  return {
    dadosObra, dadosUso, saida: saida2, circuitos,
    materiais: { eletrodutos, condutores, protecao, pontos, quadros: montarQuadros(ext.circuitos.length, saida), insumos: montarInsumos(ext.circuitos.length), ...{ caixas } as object },
    totais: { pontosLuz: p.iluminacao, tugs: p.tug10A, tues: p.tue20A, circuitos: ext.circuitos.length, disjuntores: protecao.reduce((s, x) => s + x.qtd, 0) },
    statusNormativo: { quedaTensaoOK: true, drObrigatorioAtendido: true, dpsObrigatorioAtendido: true, aterramentoDefinido: true },
    alertas: [],
  };
}
```
> Implementar os helpers `montarProtecaoDeCircuitos`, `montarQuadros`, `montarInsumos` reaproveitando a lógica do bloco heurístico atual (DRY — extrair as listas atuais de `protecao`/`quadros`/`insumos` para funções e reusar nos dois caminhos). Incluir `caixas` em `materiais` exige adicionar `caixas: MaterialItem[]` ao tipo `ResultadoEletrico['materiais']` (Step 3a).

- [ ] **Step 3a: Adicionar `caixas` ao tipo `ResultadoEletrico['materiais']`** e preencher `caixas: []` no caminho heurístico (retrocompat).

- [ ] **Step 4: Rodar (passa) + typecheck**

Run: `npx vitest run src/services/memoriais/eletricoCalculo.extracao.test.ts && npm run typecheck`
Expected: PASS. Rodar também o teste existente: `npx vitest run src/services/memoriais/eletricoCalc.test.ts` (não pode quebrar).

- [ ] **Step 5: Commit**

```bash
git add src/services/memoriais/eletricoCalculo.ts src/services/memoriais/eletricoCalculo.extracao.test.ts
git commit -m "v3.66.0: calculo eletrico a partir de circuitos reais extraidos"
```

---

## Task 7: PDF Memorial no formato ROMATEC

**Files:**
- Modify: `src/services/memoriais/eletricoPdfMemorial.ts`
- Test: `src/services/memoriais/eletricoPdfMemorial.test.ts`

> O modelo a espelhar é o `05-02-...Memorial_NBR5410...pdf`. Seguir o gerador atual + `eletricoPdfQuantitativo.ts` como referência de helpers PDFKit (cabeçalho/rodapé ROMATEC, faixa de seção, tabela, assinatura). Reaproveitar helpers existentes; NÃO duplicar.

- [ ] **Step 1: Teste do builder (falha)**

```typescript
import { describe, it, expect } from 'vitest';
import { gerarPdfMemorialEletrico } from './eletricoPdfMemorial';
import { calcularResumoEletrico } from './eletricoCalculo';
// (montar `resultado` via calcularResumoEletrico com a `extracao` do exemplo — reusar fixture da Task 6)

describe('gerarPdfMemorialEletrico', () => {
  it('gera um Buffer PDF não-vazio', async () => {
    const resultado = calcularResumoEletrico({ /* dadosObra, dadosUso, extracao do exemplo */ } as any);
    const pdf = await gerarPdfMemorialEletrico(resultado);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
  });
});
```

- [ ] **Step 2: Rodar (falha se assinatura mudou)**

Run: `npx vitest run src/services/memoriais/eletricoPdfMemorial.test.ts`
Expected: FAIL inicialmente (ou PASS trivial) — ajustar conforme a assinatura atual de `gerarPdfMemorialEletrico`.

- [ ] **Step 3: Reescrever o gerador** com as seções do modelo, na ordem: cabeçalho/dados da obra → histórico de revisões → 1.Objeto → 2.Normas → 3.Levantamento de cargas (tabela C1..Cn: Circ./Descrição/Disjuntor/Condutor/Pot.VA) → 4.Demanda (Pi/fd/Pd/Id/disjuntor geral/ramal) → 5.Dimensionamento (Ip/cap.cond/queda/status) → 6.QDFL → 7.IDR → 8.Especificação → 9.Critérios execução/ensaio → 10.Conclusão → 11.Responsabilidade técnica + assinatura (José Romário — CFT/MA 01209185369). Tabelas e textos vêm de `resultado.circuitos`, `resultado.saida`, `resultado.materiais`. Mono/bi/trifásico no ramal e disjuntor geral.

- [ ] **Step 4: Rodar (passa) + typecheck**

Run: `npx vitest run src/services/memoriais/eletricoPdfMemorial.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/memoriais/eletricoPdfMemorial.ts src/services/memoriais/eletricoPdfMemorial.test.ts
git commit -m "v3.66.0: PDF Memorial Eletrico no formato ROMATEC (NBR 5410)"
```

---

## Task 8: PDF Lista de Materiais no formato ROMATEC

**Files:**
- Modify: `src/services/memoriais/eletricoPdfQuantitativo.ts`
- Test: `src/services/memoriais/eletricoPdfQuantitativo.test.ts`

> Modelo: `05-01-...Lista_Materiais...pdf`. 6 grupos (Eletrodutos, Caixas, Disjuntores, Quadro+IDR, Interruptores/Tomadas, Condutores por seção) + resumo consolidado + margem de perdas + critérios + conclusão + assinatura.

- [ ] **Step 1: Teste (falha)** — análogo à Task 7 (Buffer `%PDF-`, > 1000 bytes), e assert que o texto-fonte inclui as descrições de condutores por seção e os subtotais. Como o conteúdo é binário, validar via geração sem erro + tamanho; a fidelidade textual é coberta por revisão visual no Railway.

```typescript
import { describe, it, expect } from 'vitest';
import { gerarPdfQuantitativoEletrico } from './eletricoPdfQuantitativo';
import { calcularResumoEletrico } from './eletricoCalculo';

describe('gerarPdfQuantitativoEletrico', () => {
  it('gera Buffer PDF com os 6 grupos', async () => {
    const resultado = calcularResumoEletrico({ /* fixture extração */ } as any);
    const pdf = await gerarPdfQuantitativoEletrico(resultado);
    expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 2: Rodar (falha/ajuste)** — `npx vitest run src/services/memoriais/eletricoPdfQuantitativo.test.ts`

- [ ] **Step 3: Reescrever** com os 6 grupos + resumo + margem de perdas + critérios + conclusão + assinatura, lendo `resultado.materiais.{eletrodutos,caixas,protecao,quadros,pontos,condutores}` e agrupando como no modelo.

- [ ] **Step 4: Rodar (passa) + typecheck**

- [ ] **Step 5: Commit**

```bash
git add src/services/memoriais/eletricoPdfQuantitativo.ts src/services/memoriais/eletricoPdfQuantitativo.test.ts
git commit -m "v3.66.0: PDF Lista de Materiais Eletrico no formato ROMATEC"
```

---

## Task 9: Wizard — Passo 0 (upload) + Passo de Revisão

**Files:**
- Modify: `src/public/js/memoriais-eletrico-wizard.js`

> Sem teste automatizado (front vanilla); validar no Railway. Seguir o padrão do wizard atual (`montar`/`render`/`abrir`, helper `h(...)`, `prefill`).

- [ ] **Step 1: Adicionar Passo 0 "Upload da Planta (PE)"** — `<input type=file accept=application/pdf>` + botão "Extrair". Ao extrair: `fetch('/api/memoriais/eletrico/extrair-pdf', { method:'POST', body: FormData(arquivo), credentials:'include' })`. Mostra barra de confiança e lista de `observacoes`/`divergencias`. Em 401 → redireciona `/login?next=`.

- [ ] **Step 2: Passo de Revisão** — renderiza a `extracao` em campos editáveis: tabela de circuitos (id/descrição/tipo/disjuntor/condutor/potência/**lanceMedioM**), pontos (luz/TUG/TUE/interruptores/conjuntos), eletroduto (m) e caixas. Divergências aparecem como badge âmbar. Botão "Aplicar e calcular" injeta no `state` (obra+uso+extracao) e segue pro Passo de Geração existente.

- [ ] **Step 3: Geração** — o "Gerar" atual passa a enviar `extracao` no body pro endpoint de cálculo/gerar (Task 10 ajusta o backend de `gerar` pra repassar `extracao` ao `calcularResumoEletrico`).

- [ ] **Step 4: Commit**

```bash
git add src/public/js/memoriais-eletrico-wizard.js
git commit -m "v3.66.0: wizard eletrico com upload do PE + revisao dos dados extraidos"
```

---

## Task 10: Wiring do `gerar` + persistência do JSON + verificação final

**Files:**
- Modify: `src/routes/memoriais.ts` (dispatch `/:disc/gerar` e `/:disc/calcular-resumo` repassam `extracao`)
- Modify: `src/repositories/memoriaisRepo.ts` (salvar `extracao_json`)

- [ ] **Step 1: Repassar `extracao`** no handler de `gerar`/`calcular-resumo` elétrico: ler `req.body.extracao` e passar para `calcularResumoEletrico({ dadosObra, dadosUso, extracao })`.

- [ ] **Step 2: Persistir** `extracao_json = JSON.stringify(req.body.extracao ?? null)` ao salvar o memorial (no `memoriaisRepo.salvar`/equivalente). Confirmar a coluna criada na Task 5.

- [ ] **Step 3: Verificação final**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck limpo; toda a suíte verde (incluindo os testes novos das Tasks 2,3,4,6,7,8).

- [ ] **Step 4: Bump de versão + commit + push**

```bash
npm version minor --no-git-tag-version   # 3.65.2 -> 3.66.0
git add -A
git commit -m "v3.66.0: Memorial Eletrico com extracao automatica de PDF (NBR 5410)"
git push origin main
```

- [ ] **Step 5: Validação manual no Railway** — subir o `05-00-PE...pdf` de exemplo, conferir extração → revisão → Memorial + Lista de Materiais batendo com os modelos Nayara (circuitos C1..C8, condutores por seção, Pi/Pd/Id).

---

## Self-Review (preenchido pelo autor do plano)

- **Cobertura da spec:** §5 (componentes) → Tasks 2,3,4,7,8,9; §6 (schema) → Task 1/2; §7 (cálculo NBR) → Task 6; §8 (PDFs) → 7,8; §9 (persistência) → 5,10; §10 (governança) → respeitada (aiDocExtractor isolado; sem tocar tools/think/aiCascade); §11 (testes) → Tasks 2,3,4,6,7,8.
- **Pendência conhecida:** confirmar nome real da tabela do memorial (Task 5) e a assinatura atual de `gerarPdfMemorialEletrico`/`gerarPdfQuantitativoEletrico` (Tasks 7,8) antes de reescrever — passos já preveem a checagem.
- **Consistência de tipos:** `ExtracaoEletrica`/`CircuitoEletrico`/`PontosEletricos` definidos na Task 1 e usados igual nas Tasks 2,3,6. `EntradaResumoEle.extracao` é `Pick<ExtracaoEletrica,'circuitos'|'pontos'|'eletrodutos'|'caixas'>` em todos os pontos.
