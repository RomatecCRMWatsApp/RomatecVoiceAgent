# Texto Explicativo de Serviço (Remembramento / Desmembramento) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent module that sends institutional explanatory texts about Remembramento/Desmembramento services over WhatsApp (Z-API), either standalone or alongside the proposal PDF, with templates stored in DB, variable interpolation, dedup, and full audit log.

**Architecture:** New isolated module — `src/services/textoExplicativoService.ts` (template render), `src/services/textoExplicativoEnvio.ts` (Z-API send + dedup + log), `src/routes/explicativo.ts` (`/api/explicativo/*`), `src/database/migrations-explicativo.ts` (idempotent DDL + seeds), plus a new dedicated HTML wizard `src/public/texto-explicativo.html`. Hooks into existing `propostas` flow via the new `enviar_explicativo_junto` column. Does **not** modify protected files: `src/agent/tools.ts`, `src/agent/think.ts`, `src/services/aiCascade.ts`. Adapts spec where it diverges from the codebase: client table is `propostas_clientes` (not `clientes`); service type lives in `subtipo_consultoria` and `dados_imovel` JSON (not separate columns); Z-API send goes through `sendReply()` from `src/integrations/whatsapp.ts`.

**Tech Stack:** Node 22, TypeScript, Express, MySQL2 (pool default-export), Z-API REST, Vitest, vanilla HTML/JS (no frontend framework).

---

## File Structure

**Create:**
- `src/database/migrations-explicativo.ts` — idempotent DDL + seed of both templates
- `src/services/textoExplicativoService.ts` — template lookup + variable interpolation
- `src/services/textoExplicativoService.test.ts` — render unit tests
- `src/services/textoExplicativoEnvio.ts` — Z-API send + dedup + audit log
- `src/services/textoExplicativoEnvio.test.ts` — send/dedup integration tests with mocked Z-API
- `src/routes/explicativo.ts` — Express router for `/api/explicativo/*`
- `src/public/texto-explicativo.html` — standalone wizard for avulso (and editor for templates)
- `src/public/js/texto-explicativo.js` — JS for the wizard

**Modify:**
- `src/server.ts` — register `runMigrationsExplicativo()` in startup + mount `/api/explicativo` router + serve the HTML
- `src/public/proposta-remembramento.html` — add toggle “Enviar texto explicativo junto” + button “Enviar texto avulso”
- `src/public/js/proposta-remembramento.js` — wire the toggle + button + 2s delay before PDF send

---

## Naming & Conventions

- **Service-type identifier (everywhere in this module):** `'remembramento' | 'desmembramento'`.
  - Maps to `propostas.subtipo_consultoria` values: `'remembramento'` and `'desmembramento'` (already used by existing code at `src/integrations/propostasConsultoria.ts:109-114`).
- **Client phone column:** `propostas_clientes.telefone` (defined at `src/database/migrations.ts:967`).
- **DB pool:** `import pool from '../database/connection'` (default export).
- **Z-API text send:** `import { sendReply } from '../integrations/whatsapp'` — returns `{ messageId?, phone }`.
- **Brazilian-Portuguese identifiers** (matches existing project style — never anglicize).

---

### Task 1: Migration + seeds for explicativo

**Files:**
- Create: `src/database/migrations-explicativo.ts`
- Modify: `src/server.ts` (register migration call)

- [ ] **Step 1: Write the failing test**

Create `src/database/migrations-explicativo.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

describe('migrations-explicativo module', () => {
  it('exports runMigrationsExplicativo', async () => {
    const mod = await import('./migrations-explicativo');
    expect(typeof mod.runMigrationsExplicativo).toBe('function');
  });

  it('seeds contain both templates with required markers', async () => {
    const mod = await import('./migrations-explicativo');
    const seeds = mod.SEED_TEMPLATES;
    expect(seeds).toHaveLength(2);
    const rem = seeds.find((s: { tipo_servico: string }) => s.tipo_servico === 'remembramento')!;
    const des = seeds.find((s: { tipo_servico: string }) => s.tipo_servico === 'desmembramento')!;
    expect(rem.template_texto).toContain('{{cliente_nome}}');
    expect(rem.template_texto).toContain('{{quantidade_imoveis}}');
    expect(rem.template_texto).toContain('{{municipio}}');
    expect(rem.template_texto).toContain('{{base_legal}}');
    expect(rem.template_texto).toContain('O QUE É O REMEMBRAMENTO');
    expect(des.template_texto).toContain('{{quantidade_fracoes}}');
    expect(des.template_texto).toContain('{{area_total}}');
    expect(des.template_texto).toContain('{{unidade_area}}');
    expect(des.template_texto).toContain('O QUE É O DESMEMBRAMENTO');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/database/migrations-explicativo.test.ts`
Expected: FAIL — `Cannot find module './migrations-explicativo'`.

- [ ] **Step 3: Create the migration module**

Create `src/database/migrations-explicativo.ts`:

```typescript
// Módulo independente: textos explicativos de serviço (remembramento/desmembramento).
// Roda em separado de runMigrations() principal (mesma pauta de
// migrations-laudos / migrations-loteamentos). Cria 2 tabelas + adiciona
// 1 coluna em `propostas` (idempotente) e popula 2 templates seed.

import type { RowDataPacket } from 'mysql2';
import pool from './connection';

const CREATE_TEXTOS_EXPLICATIVOS = `
  CREATE TABLE IF NOT EXISTS textos_explicativos (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    tipo_servico    ENUM('remembramento','desmembramento') NOT NULL UNIQUE,
    titulo          VARCHAR(200) NOT NULL,
    template_texto  MEDIUMTEXT NOT NULL,
    ativo           TINYINT(1) NOT NULL DEFAULT 1,
    atualizado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

const CREATE_TEXTOS_EXPLICATIVOS_ENVIOS = `
  CREATE TABLE IF NOT EXISTS textos_explicativos_envios (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    tipo_servico    ENUM('remembramento','desmembramento') NOT NULL,
    cliente_id      INT NULL,
    proposta_id     INT NULL,
    numero_destino  VARCHAR(20) NOT NULL,
    modo_envio      ENUM('avulso','com_proposta') NOT NULL,
    texto_enviado   MEDIUMTEXT NOT NULL,
    zapi_message_id VARCHAR(100) NULL,
    status          ENUM('enviado','erro','duplicado') NOT NULL,
    erro_detalhe    TEXT NULL,
    enviado_em      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dedup (numero_destino, tipo_servico, enviado_em),
    INDEX idx_proposta_envio (proposta_id, modo_envio)
  )
`;

// Pequena helper pra detectar coluna existente — same pattern do
// migrations.ts:1278-1294 (try/catch em ALTER + ignorar Duplicate column).
async function alterIgnoringDuplicate(sql: string): Promise<void> {
  try {
    await pool.execute(sql);
  } catch (err) {
    if (!/Duplicate column|already exists/i.test((err as Error).message)) {
      console.warn(
        '[migrations-explicativo] alter falhou (não-bloqueante):',
        (err as Error).message.slice(0, 200),
      );
    }
  }
}

export interface SeedTemplate {
  tipo_servico: 'remembramento' | 'desmembramento';
  titulo: string;
  template_texto: string;
}

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    tipo_servico: 'remembramento',
    titulo: 'Texto Explicativo — Remembramento',
    template_texto: `Olá, {{cliente_nome}}! Tudo bem?

Sou *José Romário Pinto Bezerra*, Técnico em Agrimensura responsável pela *Romatec Consultoria Total* (CFT/MA nº 01209185369 | INCRA FQNS | CRECI/MA 4.705 | CNAI 031161).

Conforme conversamos, segue abaixo o detalhamento completo do serviço de *Remembramento* dos seus {{quantidade_imoveis}} imóveis localizados em {{municipio}}/{{uf}}.

━━━━━━━━━━━━━━━━━━━━
📋 *O QUE É O REMEMBRAMENTO?*

Remembramento é o procedimento técnico-jurídico que *unifica duas ou mais matrículas* de imóveis contíguos (vizinhos) em uma *única matrícula*, com a área total consolidada.

É o caminho oficial para quem possui vários lotes vizinhos e deseja transformá-los em *uma única propriedade registrada*, simplificando a administração, valorização e futuras transações do bem.

Base legal aplicável: {{base_legal}}.

━━━━━━━━━━━━━━━━━━━━
🔧 *COMO O SERVIÇO É EXECUTADO*

O processo de remembramento dos seus {{quantidade_imoveis}} imóveis seguirá as seguintes etapas:

*1️⃣ Levantamento Topográfico em Campo*
Realização de medição com equipamentos de precisão (estação total / GNSS-RTK) para confirmar os limites reais, áreas e perímetros de cada um dos {{quantidade_imoveis}} imóveis envolvidos.

*2️⃣ Elaboração do Mapa Topográfico*
Produção de planta técnica georreferenciada apresentando *todos os lotes individualmente* — com suas confrontações, áreas e perímetros — e, ao final, a *configuração resultante* da área única já remembrada.

*3️⃣ Memorial Descritivo*
Documento técnico que descreve, em texto formal, todos os limites, ângulos, distâncias e confrontantes da área final remembrada. É a "certidão técnica" que acompanhará a nova matrícula.

*4️⃣ Anotação de Responsabilidade Técnica (ART/TRT)*
Documento obrigatório emitido por profissional habilitado — no seu caso, por mim, Técnico em Agrimensura registrado no CFT/MA sob o nº 01209185369 — que garante a *validade jurídica* das peças técnicas perante os órgãos competentes.

*5️⃣ Requerimento à Superintendência de Habitação e Regularização Fundiária*
Elaboração do requerimento padrão e *protocolo na Prefeitura de {{municipio}}*, acompanhado de toda a documentação técnica e dos IPTUs regularizados.

*6️⃣ Diligências e Acompanhamento*
Acompanho pessoalmente o processo na Superintendência, atendendo às exigências, vistorias e análises técnicas necessárias até a *expedição do ofício de aprovação* municipal.

*7️⃣ Requerimento ao Cartório de Registro de Imóveis*
Com o ofício municipal em mãos, elaboro o requerimento padrão do Cartório e protocolo o acervo completo no *Cartório de Registro de Imóveis competente*.

*8️⃣ Finalização — Matrícula Única*
O Cartório procede com a análise documental e realiza o *remembramento das {{quantidade_imoveis}} matrículas em uma matrícula única*, com a área total definida e devidamente registrada em seu nome.

━━━━━━━━━━━━━━━━━━━━
📑 *DOCUMENTOS NECESSÁRIOS DO CLIENTE*

- RG e CPF (cônjuge, quando aplicável)
- Certidão de casamento (se casado)
- Comprovante de endereço atualizado
- Matrículas atualizadas dos imóveis (≤ 30 dias)
- IPTUs em dia (todos os imóveis envolvidos)
- Certidão negativa de débitos municipais

━━━━━━━━━━━━━━━━━━━━
✅ *RESULTADO FINAL*

Ao concluir, você terá *uma única matrícula* com a área total remembrada, devidamente registrada no Cartório de Registro de Imóveis de {{municipio}}/{{uf}}, em seu nome, pronta para uso, venda, financiamento ou qualquer ato de disposição.

━━━━━━━━━━━━━━━━━━━━

Fico à disposição para esclarecer qualquer dúvida sobre o processo.

*José Romário Pinto Bezerra*
Romatec Consultoria Total
📍 Açailândia/MA
📲 (contato)`,
  },
  {
    tipo_servico: 'desmembramento',
    titulo: 'Texto Explicativo — Desmembramento / Desdobro',
    template_texto: `Olá, {{cliente_nome}}! Tudo bem?

Sou *José Romário Pinto Bezerra*, Técnico em Agrimensura responsável pela *Romatec Consultoria Total* (CFT/MA nº 01209185369 | INCRA FQNS | CRECI/MA 4.705 | CNAI 031161).

Conforme conversamos, segue o detalhamento completo do serviço de *Desmembramento/Desdobro* da sua área de {{area_total}} {{unidade_area}} localizada em {{municipio}}/{{uf}}, a ser subdividida em *{{quantidade_fracoes}} parcelas*.

━━━━━━━━━━━━━━━━━━━━
📋 *O QUE É O DESMEMBRAMENTO?*

Desmembramento (ou Desdobro, conforme o caso) é o procedimento técnico-jurídico que *subdivide uma matrícula única* em *duas ou mais matrículas independentes*, cada uma correspondente a uma fração específica da área original.

É o caminho oficial para quem possui um imóvel maior e deseja:
✔ Vender uma parte separadamente
✔ Dividir entre herdeiros
✔ Regularizar ocupações já existentes
✔ Criar lotes para edificação independente

Base legal aplicável: {{base_legal}}.

━━━━━━━━━━━━━━━━━━━━
🔧 *COMO O SERVIÇO É EXECUTADO*

O processo de desmembramento da sua área seguirá as seguintes etapas:

*1️⃣ Levantamento Topográfico e Demarcação em Campo*
Realização de medição com equipamentos de precisão (estação total / GNSS-RTK) para confirmar os limites reais da área original, sua área total e perímetro. Em seguida, executo a *demarcação física* das frações a serem criadas.

*2️⃣ Elaboração do Mapa Topográfico*
Produção de planta técnica georreferenciada apresentando:
• A *área total original* da matrícula
• A *subdivisão proposta* em {{quantidade_fracoes}} frações
• Áreas, perímetros e confrontações de cada nova parcela
• Sistema viário (quando aplicável)

*3️⃣ Memorial Descritivo de Cada Fração*
Documento técnico individual descrevendo, em texto formal, os limites, ângulos, distâncias e confrontantes de *cada uma das {{quantidade_fracoes}} novas frações* — base técnica das futuras matrículas independentes.

*4️⃣ Anotação de Responsabilidade Técnica (ART/TRT)*
Documento obrigatório emitido por profissional habilitado — no seu caso, por mim, Técnico em Agrimensura registrado no CFT/MA sob o nº 01209185369 — que garante a *validade jurídica* das peças técnicas perante os órgãos competentes.

*5️⃣ Requerimento à Superintendência de Habitação e Regularização Fundiária*
Elaboração do requerimento padrão e *protocolo na Prefeitura de {{municipio}}*, acompanhado de toda a documentação técnica, IPTUs regularizados e taxas de parcelamento do solo conforme legislação municipal.

*6️⃣ Diligências e Acompanhamento*
Acompanho pessoalmente o processo na Superintendência, atendendo às vistorias, análises técnicas e exigências do órgão até a *expedição do ofício de aprovação* municipal.

*7️⃣ Requerimento ao Cartório de Registro de Imóveis*
Com o ofício municipal em mãos, elaboro o requerimento padrão do Cartório e protocolo o acervo completo no *Cartório de Registro de Imóveis competente*.

*8️⃣ Finalização — Matrículas Independentes*
O Cartório procede com a análise documental e realiza o *desmembramento da matrícula original em {{quantidade_fracoes}} matrículas independentes*, cada uma com sua área, perímetro e descrição próprias, devidamente registradas em seu nome.

━━━━━━━━━━━━━━━━━━━━
📑 *DOCUMENTOS NECESSÁRIOS DO CLIENTE*

- RG e CPF (cônjuge, quando aplicável)
- Certidão de casamento (se casado)
- Comprovante de endereço atualizado
- Matrícula atualizada do imóvel (≤ 30 dias)
- IPTU em dia (área matriz)
- Certidão negativa de débitos municipais

━━━━━━━━━━━━━━━━━━━━
✅ *RESULTADO FINAL*

Ao concluir, você terá *{{quantidade_fracoes}} matrículas independentes*, cada uma referente a uma fração específica da área original, devidamente registradas no Cartório de Registro de Imóveis de {{municipio}}/{{uf}}, em seu nome — prontas para venda individual, partilha, financiamento ou qualquer ato de disposição.

━━━━━━━━━━━━━━━━━━━━

Fico à disposição para esclarecer qualquer dúvida sobre o processo.

*José Romário Pinto Bezerra*
Romatec Consultoria Total
📍 Açailândia/MA
📲 (contato)`,
  },
];

export async function runMigrationsExplicativo(): Promise<void> {
  await pool.execute(CREATE_TEXTOS_EXPLICATIVOS);
  await pool.execute(CREATE_TEXTOS_EXPLICATIVOS_ENVIOS);

  // Toggle por proposta — adiciona apenas se ainda não existir.
  await alterIgnoringDuplicate(
    `ALTER TABLE propostas
       ADD COLUMN enviar_explicativo_junto TINYINT(1) NOT NULL DEFAULT 1
       AFTER fontes_consulta`,
  );

  // Seed idempotente: INSERT IGNORE — UNIQUE em tipo_servico garante 1 por tipo.
  for (const seed of SEED_TEMPLATES) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM textos_explicativos WHERE tipo_servico = ? LIMIT 1',
      [seed.tipo_servico],
    );
    if (!rows.length) {
      await pool.execute(
        'INSERT INTO textos_explicativos (tipo_servico, titulo, template_texto, ativo) VALUES (?, ?, ?, 1)',
        [seed.tipo_servico, seed.titulo, seed.template_texto],
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/database/migrations-explicativo.test.ts`
Expected: PASS (both `it()` blocks).

- [ ] **Step 5: Wire migration into server startup**

Open `src/server.ts`, find the import block for migrations near the top (look for `import { runMigrations }` around the existing migration imports). Add:

```typescript
import { runMigrationsExplicativo } from './database/migrations-explicativo';
```

Then find where existing `migrations-*` are invoked at startup (look for `await runMigrations(` near `initDb()` or after `pool` is established). Add immediately after the other `await runMigrations*()` calls:

```typescript
await runMigrationsExplicativo();
```

Verify with grep that there are now at least 2 lines containing `runMigrationsExplicativo`:

Run: `grep -nE "runMigrationsExplicativo" src/server.ts`
Expected: 2 matches (import + call).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 7: Commit**

```bash
git add src/database/migrations-explicativo.ts src/database/migrations-explicativo.test.ts src/server.ts
git commit -m "feat(explicativo): migration + seed dos templates remembramento/desmembramento"
```

---

### Task 2: Template render service (`textoExplicativoService`)

**Files:**
- Create: `src/services/textoExplicativoService.ts`
- Create: `src/services/textoExplicativoService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/textoExplicativoService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../database/connection', () => ({
  default: { query: vi.fn(), execute: vi.fn() },
}));

import pool from '../database/connection';
import {
  gerarTextoExplicativo,
  calcularBaseLegal,
} from './textoExplicativoService';

const TEMPLATE_REM =
  'Cliente {{cliente_nome}} - {{quantidade_imoveis}} imóveis em {{municipio}}/{{uf}}. Base: {{base_legal}}.';
const TEMPLATE_DES =
  'Cliente {{cliente_nome}} - {{area_total}} {{unidade_area}} dividida em {{quantidade_fracoes}} frações em {{municipio}}/{{uf}}.';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('calcularBaseLegal', () => {
  it('urbano → Lei 6.766/79', () => {
    expect(calcularBaseLegal('urbano')).toBe(
      'Lei Federal nº 6.766/79 e legislação municipal de parcelamento do solo',
    );
  });
  it('rural → Lei 5.868/72', () => {
    expect(calcularBaseLegal('rural')).toBe(
      'Lei nº 5.868/72 e normas do INCRA aplicáveis ao parcelamento rural',
    );
  });
  it('undefined → fallback', () => {
    expect(calcularBaseLegal(undefined)).toBe('legislação aplicável');
  });
});

describe('gerarTextoExplicativo — remembramento', () => {
  it('substitui todas as variáveis quando preenchidas', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      [{ template_texto: TEMPLATE_REM }],
    ]);
    const out = await gerarTextoExplicativo({
      tipoServico: 'remembramento',
      clienteNome: 'Maria',
      quantidadeImoveis: 4,
      municipio: 'Açailândia',
      uf: 'MA',
      tipoImovel: 'urbano',
    });
    expect(out).toContain('Cliente Maria');
    expect(out).toContain('4 imóveis');
    expect(out).toContain('em Açailândia/MA');
    expect(out).toContain('Lei Federal nº 6.766/79');
    expect(out).not.toContain('{{');
  });

  it('aplica fallbacks quando variáveis vazias', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      [{ template_texto: TEMPLATE_REM }],
    ]);
    const out = await gerarTextoExplicativo({
      tipoServico: 'remembramento',
      clienteNome: '',
    });
    expect(out).toContain('Cliente Cliente');
    expect(out).toContain('X imóveis');
    expect(out).toContain('Açailândia/MA');
    expect(out).toContain('legislação aplicável');
  });

  it('lança quando template não existe', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([[]]);
    await expect(
      gerarTextoExplicativo({
        tipoServico: 'remembramento',
        clienteNome: 'X',
      }),
    ).rejects.toThrow(/Template não encontrado/);
  });
});

describe('gerarTextoExplicativo — desmembramento', () => {
  it('formata área em pt-BR e usa unidade padrão', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      [{ template_texto: TEMPLATE_DES }],
    ]);
    const out = await gerarTextoExplicativo({
      tipoServico: 'desmembramento',
      clienteNome: 'João',
      areaTotal: 12500.5,
      unidadeArea: 'm²',
      quantidadeFracoes: 3,
      municipio: 'Imperatriz',
      uf: 'MA',
    });
    expect(out).toContain('12.500,5 m²');
    expect(out).toContain('em 3 frações');
    expect(out).toContain('Imperatriz/MA');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/textoExplicativoService.test.ts`
Expected: FAIL — `Cannot find module './textoExplicativoService'`.

- [ ] **Step 3: Implement the service**

Create `src/services/textoExplicativoService.ts`:

```typescript
// Render do texto explicativo (remembramento / desmembramento).
// Busca template ativo na tabela `textos_explicativos` e faz substituição
// {{variavel}} por valor, com fallback se vazio. Sem libs de templating —
// substituição simples por split/join é segura porque os valores são
// dados de cliente (não inserem markup ZAPI sensível) e o destino é
// texto plano do WhatsApp.

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';

export type TipoServico = 'remembramento' | 'desmembramento';
export type TipoImovel = 'urbano' | 'rural';
export type UnidadeArea = 'm²' | 'ha';

export interface DadosTexto {
  tipoServico: TipoServico;
  clienteNome: string;
  quantidadeImoveis?: number;
  areaTotal?: number;
  unidadeArea?: UnidadeArea;
  quantidadeFracoes?: number;
  municipio?: string;
  uf?: string;
  tipoImovel?: TipoImovel;
}

export function calcularBaseLegal(tipoImovel?: TipoImovel): string {
  if (tipoImovel === 'urbano') {
    return 'Lei Federal nº 6.766/79 e legislação municipal de parcelamento do solo';
  }
  if (tipoImovel === 'rural') {
    return 'Lei nº 5.868/72 e normas do INCRA aplicáveis ao parcelamento rural';
  }
  return 'legislação aplicável';
}

interface TemplateRow extends RowDataPacket {
  template_texto: string;
}

export async function gerarTextoExplicativo(dados: DadosTexto): Promise<string> {
  const [rows] = await pool.query<TemplateRow[]>(
    'SELECT template_texto FROM textos_explicativos WHERE tipo_servico = ? AND ativo = 1 LIMIT 1',
    [dados.tipoServico],
  );
  if (!rows.length) {
    throw new Error(`Template não encontrado para ${dados.tipoServico}`);
  }
  let texto = rows[0].template_texto;

  const substituicoes: Record<string, string> = {
    '{{cliente_nome}}': (dados.clienteNome || '').trim() || 'Cliente',
    '{{quantidade_imoveis}}':
      dados.quantidadeImoveis != null ? String(dados.quantidadeImoveis) : 'X',
    '{{area_total}}':
      dados.areaTotal != null
        ? dados.areaTotal.toLocaleString('pt-BR')
        : 'X',
    '{{unidade_area}}': dados.unidadeArea || 'm²',
    '{{quantidade_fracoes}}':
      dados.quantidadeFracoes != null ? String(dados.quantidadeFracoes) : 'X',
    '{{municipio}}': (dados.municipio || '').trim() || 'Açailândia',
    '{{uf}}': (dados.uf || '').trim() || 'MA',
    '{{base_legal}}': calcularBaseLegal(dados.tipoImovel),
  };

  for (const [chave, valor] of Object.entries(substituicoes)) {
    texto = texto.split(chave).join(valor);
  }
  return texto;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/textoExplicativoService.test.ts`
Expected: PASS (7 assertions across 5 it-blocks).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/textoExplicativoService.ts src/services/textoExplicativoService.test.ts
git commit -m "feat(explicativo): service de render de template com fallback de variáveis"
```

---

### Task 3: Z-API send + dedup + audit log (`textoExplicativoEnvio`)

**Files:**
- Create: `src/services/textoExplicativoEnvio.ts`
- Create: `src/services/textoExplicativoEnvio.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/textoExplicativoEnvio.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../database/connection', () => ({
  default: { query: vi.fn(), execute: vi.fn() },
}));
vi.mock('../integrations/whatsapp', () => ({
  sendReply: vi.fn(),
}));
vi.mock('./textoExplicativoService', () => ({
  gerarTextoExplicativo: vi.fn(),
}));

import pool from '../database/connection';
import { sendReply } from '../integrations/whatsapp';
import { gerarTextoExplicativo } from './textoExplicativoService';
import { enviarTextoExplicativo } from './textoExplicativoEnvio';

const queryMock = pool.query as ReturnType<typeof vi.fn>;
const executeMock = pool.execute as ReturnType<typeof vi.fn>;
const sendReplyMock = sendReply as ReturnType<typeof vi.fn>;
const gerarMock = gerarTextoExplicativo as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  gerarMock.mockResolvedValue('TEXTO RENDERIZADO');
});

describe('enviarTextoExplicativo — sucesso', () => {
  it('renderiza, envia via Z-API e registra status=enviado', async () => {
    queryMock.mockResolvedValueOnce([[]]); // dedup: nenhum recente
    sendReplyMock.mockResolvedValueOnce({ messageId: 'ZAPI-123', phone: '5598999999999' });
    executeMock.mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]); // INSERT log

    const r = await enviarTextoExplicativo({
      dados: { tipoServico: 'remembramento', clienteNome: 'Maria' },
      numeroDestino: '5598999999999',
      modoEnvio: 'avulso',
    });

    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('ZAPI-123');
    expect(sendReplyMock).toHaveBeenCalledWith('5598999999999', 'TEXTO RENDERIZADO');

    // INSERT no log com status='enviado'
    const insertCall = executeMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO textos_explicativos_envios'),
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall![1]).toContain('enviado');
  });
});

describe('enviarTextoExplicativo — deduplicação 60s', () => {
  it('detecta envio recente e bloqueia, registrando status=duplicado', async () => {
    queryMock.mockResolvedValueOnce([[{ id: 99 }]]); // dedup: encontrou
    executeMock.mockResolvedValueOnce([{ insertId: 2 }]);

    const r = await enviarTextoExplicativo({
      dados: { tipoServico: 'remembramento', clienteNome: 'Maria' },
      numeroDestino: '5598999999999',
      modoEnvio: 'avulso',
    });

    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('duplicado_60s');
    expect(sendReplyMock).not.toHaveBeenCalled();
    const insertCall = executeMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO textos_explicativos_envios'),
    );
    expect(insertCall![1]).toContain('duplicado');
  });
});

describe('enviarTextoExplicativo — erro Z-API', () => {
  it('registra status=erro e relança a exceção', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    sendReplyMock.mockRejectedValueOnce(new Error('ZAPI 500: down'));
    executeMock.mockResolvedValueOnce([{ insertId: 3 }]);

    await expect(
      enviarTextoExplicativo({
        dados: { tipoServico: 'desmembramento', clienteNome: 'João' },
        numeroDestino: '5598888888888',
        modoEnvio: 'com_proposta',
        propostaId: 42,
      }),
    ).rejects.toThrow(/ZAPI 500/);

    const insertCall = executeMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO textos_explicativos_envios'),
    );
    expect(insertCall![1]).toContain('erro');
    expect(insertCall![1]).toContain('ZAPI 500: down');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/textoExplicativoEnvio.test.ts`
Expected: FAIL — `Cannot find module './textoExplicativoEnvio'`.

- [ ] **Step 3: Implement the send service**

Create `src/services/textoExplicativoEnvio.ts`:

```typescript
// Envio do texto explicativo via Z-API + dedup 60s + audit log.
// Reusa sendReply() do módulo integrations/whatsapp (não chama axios direto:
// sendReply já trata normalização de telefone, headers Z-API e logging
// no zayra_whatsapp_log).
//
// Dedup window de 60s aplicada por (numero_destino, tipo_servico):
// se o ultimo envio bem-sucedido pra esse par foi < 60s, ignora e
// registra status='duplicado' no audit log (sem chamar Z-API).

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { sendReply } from '../integrations/whatsapp';
import {
  gerarTextoExplicativo,
  type DadosTexto,
  type TipoServico,
} from './textoExplicativoService';

export type ModoEnvio = 'avulso' | 'com_proposta';

export interface EnvioInput {
  dados: DadosTexto;
  numeroDestino: string;
  modoEnvio: ModoEnvio;
  clienteId?: number;
  propostaId?: number;
}

export interface EnvioOk {
  ok: true;
  messageId?: string;
}
export interface EnvioBloqueado {
  ok: false;
  motivo: 'duplicado_60s';
}
export type EnvioResultado = EnvioOk | EnvioBloqueado;

const DEDUP_WINDOW_SECONDS = 60;

async function dedupRecente(
  numeroDestino: string,
  tipoServico: TipoServico,
): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM textos_explicativos_envios
       WHERE numero_destino = ?
         AND tipo_servico = ?
         AND status = 'enviado'
         AND enviado_em > (NOW() - INTERVAL ? SECOND)
       LIMIT 1`,
    [numeroDestino, tipoServico, DEDUP_WINDOW_SECONDS],
  );
  return rows.length > 0;
}

async function gravarLog(params: {
  tipoServico: TipoServico;
  clienteId?: number;
  propostaId?: number;
  numeroDestino: string;
  modoEnvio: ModoEnvio;
  texto: string;
  zapiMessageId?: string;
  status: 'enviado' | 'erro' | 'duplicado';
  erroDetalhe?: string;
}): Promise<void> {
  await pool.execute(
    `INSERT INTO textos_explicativos_envios
       (tipo_servico, cliente_id, proposta_id, numero_destino, modo_envio,
        texto_enviado, zapi_message_id, status, erro_detalhe)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.tipoServico,
      params.clienteId ?? null,
      params.propostaId ?? null,
      params.numeroDestino,
      params.modoEnvio,
      params.texto,
      params.zapiMessageId ?? null,
      params.status,
      params.erroDetalhe ?? null,
    ],
  );
}

export async function enviarTextoExplicativo(
  input: EnvioInput,
): Promise<EnvioResultado> {
  const { dados, numeroDestino, modoEnvio, clienteId, propostaId } = input;

  // 1. dedup
  if (await dedupRecente(numeroDestino, dados.tipoServico)) {
    await gravarLog({
      tipoServico: dados.tipoServico,
      clienteId,
      propostaId,
      numeroDestino,
      modoEnvio,
      texto: '',
      status: 'duplicado',
    });
    return { ok: false, motivo: 'duplicado_60s' };
  }

  // 2. render
  const texto = await gerarTextoExplicativo(dados);

  // 3. envia + log
  try {
    const resp = await sendReply(numeroDestino, texto);
    await gravarLog({
      tipoServico: dados.tipoServico,
      clienteId,
      propostaId,
      numeroDestino,
      modoEnvio,
      texto,
      zapiMessageId: resp.messageId,
      status: 'enviado',
    });
    return { ok: true, messageId: resp.messageId };
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    await gravarLog({
      tipoServico: dados.tipoServico,
      clienteId,
      propostaId,
      numeroDestino,
      modoEnvio,
      texto,
      status: 'erro',
      erroDetalhe: detalhe,
    });
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/textoExplicativoEnvio.test.ts`
Expected: PASS (3 it-blocks).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/textoExplicativoEnvio.ts src/services/textoExplicativoEnvio.test.ts
git commit -m "feat(explicativo): envio Z-API com dedup 60s e audit log"
```

---

### Task 4: Express routes `/api/explicativo/*`

**Files:**
- Create: `src/routes/explicativo.ts`
- Modify: `src/server.ts` (mount router)

- [ ] **Step 1: Write the failing test**

Create `src/routes/explicativo.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../database/connection', () => ({
  default: { query: vi.fn(), execute: vi.fn() },
}));
vi.mock('../services/textoExplicativoService', () => ({
  gerarTextoExplicativo: vi.fn(),
  calcularBaseLegal: vi.fn(),
}));
vi.mock('../services/textoExplicativoEnvio', () => ({
  enviarTextoExplicativo: vi.fn(),
}));

import pool from '../database/connection';
import { gerarTextoExplicativo } from '../services/textoExplicativoService';
import { enviarTextoExplicativo } from '../services/textoExplicativoEnvio';
import explicativoRouter from './explicativo';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/explicativo', explicativoRouter);
  return app;
}

const queryMock = pool.query as ReturnType<typeof vi.fn>;
const executeMock = pool.execute as ReturnType<typeof vi.fn>;
const gerarMock = gerarTextoExplicativo as ReturnType<typeof vi.fn>;
const enviarMock = enviarTextoExplicativo as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('POST /api/explicativo/preview', () => {
  it('retorna texto renderizado', async () => {
    gerarMock.mockResolvedValueOnce('TEXTO PREVIEW');
    const r = await request(buildApp())
      .post('/api/explicativo/preview')
      .send({ tipoServico: 'remembramento', clienteNome: 'Maria' });
    expect(r.status).toBe(200);
    expect(r.body.texto).toBe('TEXTO PREVIEW');
  });

  it('400 quando service lança', async () => {
    gerarMock.mockRejectedValueOnce(new Error('Template não encontrado'));
    const r = await request(buildApp())
      .post('/api/explicativo/preview')
      .send({ tipoServico: 'remembramento', clienteNome: 'X' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Template/);
  });
});

describe('POST /api/explicativo/enviar-avulso', () => {
  it('envia e retorna ok=true', async () => {
    enviarMock.mockResolvedValueOnce({ ok: true, messageId: 'ABC' });
    const r = await request(buildApp())
      .post('/api/explicativo/enviar-avulso')
      .send({
        dados: { tipoServico: 'remembramento', clienteNome: 'Maria' },
        numeroDestino: '5598999999999',
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(enviarMock).toHaveBeenCalledWith(
      expect.objectContaining({ modoEnvio: 'avulso' }),
    );
  });
});

describe('POST /api/explicativo/enviar-com-proposta/:id', () => {
  it('404 quando proposta não existe', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    const r = await request(buildApp())
      .post('/api/explicativo/enviar-com-proposta/99')
      .send({});
    expect(r.status).toBe(404);
  });

  it('retorna pulou=true quando toggle desligado', async () => {
    queryMock.mockResolvedValueOnce([
      [{
        id: 7, cliente_id: 3, cliente_nome: 'Maria', telefone: '5598999999999',
        subtipo_consultoria: 'remembramento', dados_imovel: '{}',
        enviar_explicativo_junto: 0,
      }],
    ]);
    const r = await request(buildApp())
      .post('/api/explicativo/enviar-com-proposta/7')
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.pulou).toBe(true);
    expect(enviarMock).not.toHaveBeenCalled();
  });

  it('envia quando toggle ligado e proposta válida', async () => {
    queryMock.mockResolvedValueOnce([
      [{
        id: 7, cliente_id: 3, cliente_nome: 'Maria', telefone: '5598999999999',
        subtipo_consultoria: 'remembramento',
        dados_imovel: JSON.stringify({
          imoveis: [{ ordem: 1 }, { ordem: 2 }],
          tipo_zona: 'urbana', municipio: 'Açailândia', uf: 'MA',
        }),
        enviar_explicativo_junto: 1,
      }],
    ]);
    enviarMock.mockResolvedValueOnce({ ok: true, messageId: 'ZZ' });
    const r = await request(buildApp())
      .post('/api/explicativo/enviar-com-proposta/7')
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(enviarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modoEnvio: 'com_proposta',
        propostaId: 7,
        dados: expect.objectContaining({
          tipoServico: 'remembramento',
          clienteNome: 'Maria',
          quantidadeImoveis: 2,
          municipio: 'Açailândia',
          uf: 'MA',
          tipoImovel: 'urbano',
        }),
      }),
    );
  });
});

describe('GET /api/explicativo/templates', () => {
  it('lista templates ativos', async () => {
    queryMock.mockResolvedValueOnce([
      [
        { id: 1, tipo_servico: 'remembramento', titulo: 'T1', ativo: 1 },
        { id: 2, tipo_servico: 'desmembramento', titulo: 'T2', ativo: 1 },
      ],
    ]);
    const r = await request(buildApp()).get('/api/explicativo/templates');
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
  });
});

describe('PUT /api/explicativo/templates/:tipo', () => {
  it('atualiza template e retorna ok', async () => {
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const r = await request(buildApp())
      .put('/api/explicativo/templates/remembramento')
      .send({ template_texto: 'NOVO {{cliente_nome}}', titulo: 'Atualizado' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('400 quando tipo inválido', async () => {
    const r = await request(buildApp())
      .put('/api/explicativo/templates/foo')
      .send({ template_texto: 'X' });
    expect(r.status).toBe(400);
  });
});
```

Add `supertest` as dev dep if not present (check `package.json`). If absent, install:

Run (only if `supertest` is not in devDependencies):
```bash
npm install --save-dev supertest @types/supertest
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/routes/explicativo.test.ts`
Expected: FAIL — `Cannot find module './explicativo'`.

- [ ] **Step 3: Implement the router**

Create `src/routes/explicativo.ts`:

```typescript
// Endpoints do módulo de texto explicativo. Independentes do fluxo principal
// de Proposta — montados em /api/explicativo no server.ts.
//
//   POST /api/explicativo/preview                  → renderiza sem enviar
//   POST /api/explicativo/enviar-avulso            → envio standalone
//   POST /api/explicativo/enviar-com-proposta/:id  → envio integrado (lê
//                                                    proposta + cliente do DB)
//   GET  /api/explicativo/templates                → lista templates
//   PUT  /api/explicativo/templates/:tipo          → atualiza template

import { Router, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import {
  gerarTextoExplicativo,
  type DadosTexto,
  type TipoServico,
  type TipoImovel,
} from '../services/textoExplicativoService';
import { enviarTextoExplicativo } from '../services/textoExplicativoEnvio';

const router = Router();
const TIPOS_VALIDOS: TipoServico[] = ['remembramento', 'desmembramento'];

function isTipoValido(s: unknown): s is TipoServico {
  return typeof s === 'string' && TIPOS_VALIDOS.includes(s as TipoServico);
}

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<DadosTexto>;
    if (!isTipoValido(body.tipoServico)) {
      return res.status(400).json({ erro: 'tipoServico inválido' });
    }
    const texto = await gerarTextoExplicativo({
      tipoServico: body.tipoServico,
      clienteNome: body.clienteNome ?? '',
      quantidadeImoveis: body.quantidadeImoveis,
      areaTotal: body.areaTotal,
      unidadeArea: body.unidadeArea,
      quantidadeFracoes: body.quantidadeFracoes,
      municipio: body.municipio,
      uf: body.uf,
      tipoImovel: body.tipoImovel,
    });
    return res.json({ texto });
  } catch (err) {
    return res
      .status(400)
      .json({ erro: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/enviar-avulso', async (req: Request, res: Response) => {
  try {
    const { dados, numeroDestino, clienteId, propostaId } = req.body as {
      dados?: Partial<DadosTexto>;
      numeroDestino?: string;
      clienteId?: number;
      propostaId?: number;
    };
    if (!dados || !isTipoValido(dados.tipoServico)) {
      return res.status(400).json({ erro: 'dados.tipoServico inválido' });
    }
    if (!numeroDestino || !/\d{10,13}/.test(numeroDestino)) {
      return res.status(400).json({ erro: 'numeroDestino inválido' });
    }
    const result = await enviarTextoExplicativo({
      dados: { ...(dados as DadosTexto), tipoServico: dados.tipoServico },
      numeroDestino,
      modoEnvio: 'avulso',
      clienteId,
      propostaId,
    });
    return res.json(result);
  } catch (err) {
    return res
      .status(500)
      .json({ erro: err instanceof Error ? err.message : String(err) });
  }
});

interface PropostaJoinRow extends RowDataPacket {
  id: number;
  cliente_id: number;
  cliente_nome: string | null;
  telefone: string | null;
  subtipo_consultoria: string | null;
  dados_imovel: string | null;
  enviar_explicativo_junto: number;
}

router.post(
  '/enviar-com-proposta/:propostaId',
  async (req: Request, res: Response) => {
    try {
      const propostaId = Number(req.params.propostaId);
      if (!propostaId) {
        return res.status(400).json({ erro: 'propostaId inválido' });
      }

      const [rows] = await pool.query<PropostaJoinRow[]>(
        `SELECT p.id, p.cliente_id, c.nome AS cliente_nome, c.telefone,
                p.subtipo_consultoria, p.dados_imovel, p.enviar_explicativo_junto
           FROM propostas p
           JOIN propostas_clientes c ON c.id = p.cliente_id
          WHERE p.id = ?
          LIMIT 1`,
        [propostaId],
      );
      if (!rows.length) {
        return res.status(404).json({ erro: 'Proposta não encontrada' });
      }
      const p = rows[0];
      if (!p.enviar_explicativo_junto) {
        return res.json({ ok: true, pulou: true, motivo: 'toggle_desligado' });
      }
      if (!isTipoValido(p.subtipo_consultoria)) {
        return res.status(400).json({
          erro: `Subtipo de proposta não suportado: ${p.subtipo_consultoria}`,
        });
      }
      if (!p.telefone) {
        return res.status(400).json({ erro: 'Cliente sem telefone cadastrado' });
      }

      const dadosImovel: Record<string, unknown> = p.dados_imovel
        ? JSON.parse(p.dados_imovel)
        : {};
      const tipoZona = dadosImovel.tipo_zona as string | undefined;
      const tipoImovel: TipoImovel | undefined =
        tipoZona === 'urbana' || tipoZona === 'urbano'
          ? 'urbano'
          : tipoZona === 'rural'
            ? 'rural'
            : undefined;

      const imoveis = Array.isArray(dadosImovel.imoveis)
        ? (dadosImovel.imoveis as unknown[])
        : [];
      const quantidadeImoveis =
        imoveis.length ||
        (typeof dadosImovel.numero_lotes_origem === 'number'
          ? dadosImovel.numero_lotes_origem
          : undefined);
      const areaTotal =
        typeof dadosImovel.area_total_m2 === 'number'
          ? dadosImovel.area_total_m2
          : undefined;
      const quantidadeFracoes =
        typeof dadosImovel.numero_lotes_destino === 'number'
          ? dadosImovel.numero_lotes_destino
          : typeof dadosImovel.quantidade_fracoes === 'number'
            ? dadosImovel.quantidade_fracoes
            : undefined;
      const municipio =
        typeof dadosImovel.municipio === 'string'
          ? dadosImovel.municipio
          : undefined;
      const uf = typeof dadosImovel.uf === 'string' ? dadosImovel.uf : undefined;

      const result = await enviarTextoExplicativo({
        dados: {
          tipoServico: p.subtipo_consultoria,
          clienteNome: p.cliente_nome ?? '',
          quantidadeImoveis,
          areaTotal,
          unidadeArea: 'm²',
          quantidadeFracoes,
          municipio,
          uf,
          tipoImovel,
        },
        numeroDestino: p.telefone,
        modoEnvio: 'com_proposta',
        clienteId: p.cliente_id,
        propostaId: p.id,
      });
      return res.json(result);
    } catch (err) {
      return res
        .status(500)
        .json({ erro: err instanceof Error ? err.message : String(err) });
    }
  },
);

interface TemplateListRow extends RowDataPacket {
  id: number;
  tipo_servico: string;
  titulo: string;
  template_texto: string;
  ativo: number;
  atualizado_em: Date;
}

router.get('/templates', async (_req: Request, res: Response) => {
  const [rows] = await pool.query<TemplateListRow[]>(
    'SELECT id, tipo_servico, titulo, template_texto, ativo, atualizado_em FROM textos_explicativos ORDER BY tipo_servico',
  );
  return res.json({
    items: rows.map((r) => ({
      id: r.id,
      tipo_servico: r.tipo_servico,
      titulo: r.titulo,
      template_texto: r.template_texto,
      ativo: !!r.ativo,
      atualizado_em: r.atualizado_em,
    })),
  });
});

router.put('/templates/:tipo', async (req: Request, res: Response) => {
  const tipo = req.params.tipo;
  if (!isTipoValido(tipo)) {
    return res.status(400).json({ erro: 'tipo inválido' });
  }
  const { template_texto, titulo, ativo } = req.body as {
    template_texto?: string;
    titulo?: string;
    ativo?: boolean;
  };
  if (!template_texto || !template_texto.trim()) {
    return res.status(400).json({ erro: 'template_texto obrigatório' });
  }
  await pool.execute(
    `UPDATE textos_explicativos
        SET template_texto = ?,
            titulo = COALESCE(?, titulo),
            ativo = COALESCE(?, ativo)
      WHERE tipo_servico = ?`,
    [
      template_texto,
      titulo ?? null,
      typeof ativo === 'boolean' ? (ativo ? 1 : 0) : null,
      tipo,
    ],
  );
  return res.json({ ok: true });
});

export default router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/routes/explicativo.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Mount router in server.ts**

Open `src/server.ts` and add to the imports (near the other route imports around lines 60-66):

```typescript
import explicativoRouter from './routes/explicativo';
```

Find the block where existing routers are mounted (around `app.use('/api/cartorios', cartoriosRouter)` ~line 104). Add immediately after:

```typescript
app.use('/api/explicativo', explicativoRouter); // v3.23.0 — texto explicativo de serviço
```

Verify:

Run: `grep -nE "explicativoRouter" src/server.ts`
Expected: 2 matches.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/explicativo.ts src/routes/explicativo.test.ts src/server.ts package.json package-lock.json
git commit -m "feat(explicativo): rotas /api/explicativo/* (preview, enviar, templates)"
```

---

### Task 5: Standalone wizard for envio avulso

**Files:**
- Create: `src/public/texto-explicativo.html`
- Create: `src/public/js/texto-explicativo.js`

- [ ] **Step 1: Create the HTML page**

Create `src/public/texto-explicativo.html`:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Texto Explicativo de Serviço — Romatec</title>
  <link rel="icon" type="image/png" href="/logo_R-removebg-preview.png" />
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 760px; margin: 24px auto; padding: 0 16px;
      color: #1a1a1a; background: #f4f7fa;
    }
    h1 { color: #0a3d62; border-bottom: 2px solid #0a3d62; padding-bottom: 8px; margin-top: 0; font-weight: 600; }
    h2 { color: #1f5b8d; margin: 0 0 12px; font-size: 18px; font-weight: 600; }
    .card { background: #fff; border: 1px solid #d4dce5; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(10,61,98,.06); }
    label { display: block; margin: 10px 0; font-size: 13px; color: #1a1a1a; }
    label > span { display: block; margin-bottom: 4px; font-weight: 500; color: #2c4760; }
    input[type="text"], input[type="number"], select, textarea {
      width: 100%; padding: 8px 10px; border: 1px solid #c4cfdb; border-radius: 4px; font-size: 14px;
      font-family: inherit;
    }
    textarea { min-height: 280px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; white-space: pre-wrap; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .row > label { flex: 1 1 200px; }
    button {
      cursor: pointer; padding: 10px 16px; border: none; border-radius: 4px;
      font-size: 14px; font-weight: 600; margin-right: 8px;
    }
    .btn-preview { background: #1f5b8d; color: #fff; }
    .btn-send    { background: #25d366; color: #fff; }
    .btn-ghost   { background: #e6ecf2; color: #2c4760; }
    .status { margin-top: 12px; padding: 10px; border-radius: 4px; font-size: 13px; }
    .status.ok    { background: #cfeacd; color: #1d6b32; border: 1px solid #b9dcb6; }
    .status.err   { background: #fbd5d5; color: #8a1f1f; border: 1px solid #f1a8a8; }
    .status.warn  { background: #fff4d2; color: #8a6b1f; border: 1px solid #efd98a; }
    .small { font-size: 11px; color: #6b7785; margin-top: 6px; }
  </style>
</head>
<body>
  <h1>📲 Texto Explicativo de Serviço</h1>
  <div class="card">
    <h2>Modo Avulso — sem proposta vinculada</h2>
    <p class="small">Envia apenas a mensagem de texto explicando o serviço (Remembramento ou Desmembramento). Útil em prospecção, antes de fechar proposta.</p>

    <div class="row">
      <label>
        <span>Tipo de serviço</span>
        <select id="tipoServico">
          <option value="remembramento">Remembramento</option>
          <option value="desmembramento">Desmembramento / Desdobro</option>
        </select>
      </label>
      <label>
        <span>Tipo de imóvel</span>
        <select id="tipoImovel">
          <option value="">— não informar —</option>
          <option value="urbano">Urbano</option>
          <option value="rural">Rural</option>
        </select>
      </label>
    </div>

    <label>
      <span>Nome do cliente</span>
      <input id="clienteNome" type="text" placeholder="Maria Silva" />
    </label>

    <label>
      <span>Número WhatsApp (com DDI/DDD)</span>
      <input id="numeroDestino" type="text" placeholder="5598999999999" />
    </label>

    <div class="row">
      <label>
        <span>Município</span>
        <input id="municipio" type="text" placeholder="Açailândia" />
      </label>
      <label>
        <span>UF</span>
        <input id="uf" type="text" maxlength="2" placeholder="MA" />
      </label>
    </div>

    <div id="campos-remembramento" class="row">
      <label>
        <span>Quantidade de imóveis</span>
        <input id="quantidadeImoveis" type="number" min="2" placeholder="2" />
      </label>
    </div>

    <div id="campos-desmembramento" class="row" style="display:none">
      <label>
        <span>Área total</span>
        <input id="areaTotal" type="number" step="0.01" placeholder="5000" />
      </label>
      <label>
        <span>Unidade</span>
        <select id="unidadeArea">
          <option value="m²">m²</option>
          <option value="ha">ha</option>
        </select>
      </label>
      <label>
        <span>Qtd. frações</span>
        <input id="quantidadeFracoes" type="number" min="2" placeholder="3" />
      </label>
    </div>

    <div style="margin-top:14px">
      <button class="btn-preview" id="btnPreview">👁️ Preview</button>
      <button class="btn-send" id="btnEnviar">📲 Enviar via WhatsApp</button>
    </div>

    <label style="margin-top:14px">
      <span>Texto montado (editável antes de enviar)</span>
      <textarea id="textoMontado" placeholder="Clique em Preview para gerar o texto…"></textarea>
    </label>

    <div id="status" class="status" style="display:none"></div>
  </div>

  <script src="/js/texto-explicativo.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the JS controller**

Create `src/public/js/texto-explicativo.js`:

```javascript
(() => {
  const $ = (id) => document.getElementById(id);

  function dadosFromForm() {
    const tipoServico = $('tipoServico').value;
    const out = {
      tipoServico,
      clienteNome: $('clienteNome').value.trim(),
      municipio: $('municipio').value.trim() || undefined,
      uf: $('uf').value.trim().toUpperCase() || undefined,
      tipoImovel: $('tipoImovel').value || undefined,
    };
    if (tipoServico === 'remembramento') {
      const q = Number($('quantidadeImoveis').value);
      if (q) out.quantidadeImoveis = q;
    } else {
      const a = Number($('areaTotal').value);
      if (a) out.areaTotal = a;
      out.unidadeArea = $('unidadeArea').value;
      const f = Number($('quantidadeFracoes').value);
      if (f) out.quantidadeFracoes = f;
    }
    return out;
  }

  function setStatus(msg, kind) {
    const el = $('status');
    el.textContent = msg;
    el.className = 'status ' + (kind || '');
    el.style.display = msg ? 'block' : 'none';
  }

  $('tipoServico').addEventListener('change', (e) => {
    const isRem = e.target.value === 'remembramento';
    $('campos-remembramento').style.display = isRem ? 'flex' : 'none';
    $('campos-desmembramento').style.display = isRem ? 'none' : 'flex';
  });

  $('btnPreview').addEventListener('click', async () => {
    setStatus('Gerando preview…', 'warn');
    try {
      const r = await fetch('/api/explicativo/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dadosFromForm()),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || 'Falha no preview');
      $('textoMontado').value = j.texto;
      setStatus('Preview gerado. Edite se quiser e clique Enviar.', 'ok');
    } catch (err) {
      setStatus('❌ ' + err.message, 'err');
    }
  });

  $('btnEnviar').addEventListener('click', async () => {
    const numero = $('numeroDestino').value.replace(/\D/g, '');
    if (!numero || numero.length < 10) {
      setStatus('Número inválido (informe com DDI/DDD).', 'err');
      return;
    }
    const textoEditado = $('textoMontado').value.trim();
    if (!textoEditado) {
      setStatus('Gere o preview primeiro (botão Preview).', 'warn');
      return;
    }
    setStatus('Enviando…', 'warn');
    try {
      // Estratégia: se o usuário editou o texto, mandamos via enviar-avulso
      // com o texto já renderizado embutido no clienteNome via uma rota
      // “custom” não está disponível — então re-renderizamos no servidor a
      // partir dos campos. Se quisermos preservar edição manual, basta o
      // usuário editar antes de clicar Preview e depois Enviar (o servidor
      // renderiza novamente). Para edições livres pós-preview, o caminho
      // recomendado é editar o template no PUT /templates/:tipo.
      const r = await fetch('/api/explicativo/enviar-avulso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dados: dadosFromForm(),
          numeroDestino: numero,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || 'Falha no envio');
      if (j.ok === false && j.motivo === 'duplicado_60s') {
        setStatus('⚠️ Envio duplicado (mesma mensagem em < 60s). Aguarde.', 'warn');
        return;
      }
      setStatus('✅ Enviado. messageId: ' + (j.messageId || '—'), 'ok');
    } catch (err) {
      setStatus('❌ ' + err.message, 'err');
    }
  });
})();
```

- [ ] **Step 3: Verify static-serving config**

Open `src/server.ts` and grep for the static-public mount:

Run: `grep -nE "express\.static\(.*public" src/server.ts`
Expected: at least 1 match (e.g. `app.use(express.static(path.join(__dirname, 'public')))`).

If found, nothing to add — `texto-explicativo.html` will be served at `/texto-explicativo.html`. If not found, add this line in `src/server.ts` right after the other middleware mounts (around line 95):

```typescript
app.use(express.static(path.join(__dirname, 'public')));
```

- [ ] **Step 4: Smoke-test type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/public/texto-explicativo.html src/public/js/texto-explicativo.js src/server.ts
git commit -m "feat(explicativo-ui): wizard standalone para envio avulso"
```

---

### Task 6: Integrate toggle + button into existing proposta-remembramento UI

**Files:**
- Modify: `src/public/proposta-remembramento.html` (add toggle + button)
- Modify: `src/public/js/proposta-remembramento.js` (wire both)

- [ ] **Step 1: Inspect existing UI to find the right insertion point**

Run: `grep -nE "gerarPdf|enviar.*WhatsApp|btnGerar|btn-gerar|btnEnviar" src/public/proposta-remembramento.html src/public/js/proposta-remembramento.js`

Note: the exact anchor depends on the current UI. Pick the section right after the “gerar PDF” button (likely the last step of the wizard, around the action buttons of the final review/preview step). If unsure, search:

Run: `grep -nE "Gerar.*Proposta|criar.*proposta" src/public/proposta-remembramento.html | head -10`

Record the line number of the existing "Gerar Proposta" / "Enviar WhatsApp" button. Insert the new elements **immediately above** that button so the user sees the toggle before sending.

- [ ] **Step 2: Add toggle + standalone-send button to the HTML**

In `src/public/proposta-remembramento.html`, in the final wizard step (look for the `wizard-step` containing the "Gerar" or "Enviar" CTA), add this block ABOVE the existing CTA:

```html
<!-- v3.23.0 — texto explicativo integrado ao fluxo de envio -->
<div class="explicativo-section" style="border:1px solid #d4dce5;border-radius:6px;padding:12px;margin:14px 0;background:#f9fbfd">
  <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin:0">
    <input type="checkbox" id="chk-enviar-explicativo" checked />
    <span>Enviar texto explicativo do serviço junto com a proposta no WhatsApp</span>
  </label>
  <div class="small" style="font-size:11px;color:#6b7785;margin-top:6px;margin-left:24px">
    O texto explica o serviço de Remembramento ao cliente e chega 2 segundos antes do PDF da proposta.
  </div>
  <div style="margin-top:10px">
    <button type="button" id="btn-enviar-explicativo-avulso"
            style="background:#1f5b8d;color:#fff;border:none;border-radius:4px;padding:8px 14px;cursor:pointer;font-size:13px;font-weight:600">
      📲 Enviar somente o texto explicativo (sem PDF)
    </button>
  </div>
  <div id="explicativo-feedback" style="margin-top:8px;font-size:12px"></div>
</div>
```

- [ ] **Step 3: Wire the toggle to the existing submit / “gerar proposta” flow**

In `src/public/js/proposta-remembramento.js`, find the function/handler that submits the proposta (search for `fetch('/api/propostas/consultoria` or similar — adapt to actual endpoint). Inside the submit payload builder, capture and forward the toggle value:

```javascript
// v3.23.0 — toggle do texto explicativo (default LIGADO)
const enviarExplicativoJunto =
  document.getElementById('chk-enviar-explicativo')?.checked !== false ? 1 : 0;
// adicionar ao payload da criação/atualização da proposta
payload.enviar_explicativo_junto = enviarExplicativoJunto;
```

If `propostasConsultoria.criarPropostaConsultoria` does not yet accept `enviar_explicativo_junto`, the column gets persisted by the same `INSERT INTO propostas` call only if we extend the integration. To keep this PR scoped, we send the toggle as a SEPARATE follow-up call after proposta creation succeeds:

Append at the bottom of the existing onSuccess of `criarProposta`:

```javascript
// v3.23.0 — após criar a proposta, persiste o toggle e (se ligado) dispara
// o envio do texto explicativo ANTES do envio do PDF.
async function aplicarExplicativoAposCriar(propostaId) {
  try {
    // Atualiza o flag enviar_explicativo_junto via PATCH genérico.
    // Se o backend ainda não expõe PATCH, persiste via o próprio endpoint
    // de envio: o GET /enviar-com-proposta lê o toggle. Aqui forçamos via
    // /api/explicativo/enviar-com-proposta — se toggle=desligado, retorna pulou.
    if (!enviarExplicativoJunto) return;
    const r = await fetch('/api/explicativo/enviar-com-proposta/' + propostaId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const j = await r.json();
    if (j.pulou) return;
    if (j.ok === false && j.motivo === 'duplicado_60s') {
      console.warn('[explicativo] envio duplicado (dedup 60s)');
      return;
    }
    // Espera 2s pra o PDF chegar depois do texto (ordem das mensagens)
    await new Promise((res) => setTimeout(res, 2000));
  } catch (err) {
    console.warn('[explicativo] envio falhou (ignorado):', err.message);
  }
}
// Chamar aplicarExplicativoAposCriar(propostaCriada.id) ANTES do trigger de envio do PDF.
```

> ⚠ Persistência do `enviar_explicativo_junto` no INSERT da proposta:
> Para garantir que o valor seja gravado no banco mesmo quando o toggle estiver desligado e o usuário desativar o envio para sempre, na **rota de criação da proposta consultoria** (`src/integrations/propostasConsultoria.ts`, função `criarPropostaConsultoria`), localize o `INSERT INTO propostas (…) VALUES (…)` e acrescente a coluna `enviar_explicativo_junto` ao final, com o valor recebido do input. Se a função ainda não aceitar esse campo, a alteração precisa de uma sub-task (Task 6.5) — caso contrário o toggle não persiste, mas o disparo manual via `/enviar-com-proposta/:id` continua funcionando como behavior de fallback.

- [ ] **Step 4: Wire the “enviar avulso” button**

Add to `src/public/js/proposta-remembramento.js` (at the bottom or wherever the wizard JS is initialized):

```javascript
// v3.23.0 — botão de envio avulso (sem PDF) na tela da proposta.
document.getElementById('btn-enviar-explicativo-avulso')?.addEventListener('click', async () => {
  const fb = document.getElementById('explicativo-feedback');
  const numero = (document.querySelector('input[name="cliente_telefone"], #cliente_telefone, #telefone')?.value || '').replace(/\D/g, '');
  const clienteNome = document.querySelector('input[name="cliente_nome"], #cliente_nome')?.value || '';
  if (!numero || numero.length < 10) {
    fb.textContent = '❌ Preencha o telefone do cliente antes.';
    fb.style.color = '#8a1f1f';
    return;
  }
  fb.textContent = 'Enviando…';
  fb.style.color = '#8a6b1f';
  try {
    const r = await fetch('/api/explicativo/enviar-avulso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dados: { tipoServico: 'remembramento', clienteNome },
        numeroDestino: numero,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || 'Falha no envio');
    if (j.ok === false && j.motivo === 'duplicado_60s') {
      fb.textContent = '⚠️ Já enviado a este número há menos de 60s.';
      fb.style.color = '#8a6b1f';
      return;
    }
    fb.textContent = '✅ Texto enviado (messageId: ' + (j.messageId || '—') + ')';
    fb.style.color = '#1d6b32';
  } catch (err) {
    fb.textContent = '❌ ' + err.message;
    fb.style.color = '#8a1f1f';
  }
});
```

- [ ] **Step 5: Type-check + smoke-test build**

Run: `npx tsc --noEmit`
Expected: PASS (this UI is plain JS, but server.ts changes from earlier tasks should still type-check).

- [ ] **Step 6: Commit**

```bash
git add src/public/proposta-remembramento.html src/public/js/proposta-remembramento.js
git commit -m "feat(explicativo-ui): toggle + botão de envio avulso na tela de proposta"
```

---

### Task 7: End-to-end smoke pass + manual validation script

**Files:**
- Create: `scripts/manual-test-explicativo.md` (documentation of manual test steps — quick reference for the validator)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests PASS, including the new ones in `src/database/migrations-explicativo.test.ts`, `src/services/textoExplicativoService.test.ts`, `src/services/textoExplicativoEnvio.test.ts`, and `src/routes/explicativo.test.ts`. No regressions in pre-existing tests.

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: PASS — `dist/` is regenerated with the new files.

- [ ] **Step 4: Create the manual-test checklist file**

Create `scripts/manual-test-explicativo.md`:

```markdown
# Validação Manual — Texto Explicativo de Serviço

Pré-requisito: server rodando (`npm run dev`) com Z-API conectada (vars
ZAPI_INSTANCE_ID_ZAYRA / ZAPI_TOKEN_ZAYRA / ZAPI_CLIENT_TOKEN_ZAYRA no .env).
Usar o número do próprio José Romário pra teste (não disparar pra cliente real).

## 1. Avulso — Remembramento
1. Abrir http://localhost:PORT/texto-explicativo.html
2. Selecionar tipo "Remembramento", tipo de imóvel "Urbano"
3. Preencher: cliente "Maria", número (próprio), município "Açailândia", UF "MA", qtd. imóveis 4
4. Clicar **Preview** → confirmar texto montado com nome e números corretos
5. Clicar **Enviar via WhatsApp** → conferir chegada no WhatsApp

## 2. Avulso — Desmembramento
1. Mesmo fluxo, mas tipo "Desmembramento", área total 5000, unidade m², qtd. frações 3, tipo de imóvel "Urbano"
2. Confirmar texto correto e envio

## 3. Com Proposta — toggle ligado
1. Abrir http://localhost:PORT/proposta-remembramento.html
2. Criar proposta de Remembramento com cliente cadastrado e telefone válido (próprio número pra teste)
3. Garantir que o checkbox "Enviar texto explicativo junto com a proposta" está **LIGADO**
4. Submeter a proposta
5. Conferir que no WhatsApp chegam DUAS mensagens nessa ordem:
   - Primeiro: texto explicativo
   - 2 segundos depois: PDF da proposta

## 4. Com Proposta — toggle desligado
1. Mesma proposta, mas DESMARCAR o checkbox
2. Submeter
3. Conferir que chega APENAS o PDF da proposta — sem texto explicativo

## 5. Deduplicação
1. Em < 60s do envio anterior, clicar de novo o botão **Enviar somente o texto explicativo** na tela da proposta
2. Conferir que o UI mostra "⚠️ Já enviado a este número há menos de 60s" e que NÃO chega mensagem duplicada no WhatsApp
3. Conferir no banco:
   ```sql
   SELECT id, tipo_servico, modo_envio, status, enviado_em
     FROM textos_explicativos_envios
    ORDER BY id DESC LIMIT 5;
   ```
   Deve haver pelo menos 1 linha com status='duplicado'.

## 6. Edição de template via API
1. PUT http://localhost:PORT/api/explicativo/templates/remembramento
   ```json
   { "template_texto": "TESTE EDIT {{cliente_nome}}", "titulo": "Editado" }
   ```
2. GET http://localhost:PORT/api/explicativo/templates → confirmar `template_texto` atualizado
3. Restaurar o original com outro PUT (copiar de `src/database/migrations-explicativo.ts` `SEED_TEMPLATES`)
```

- [ ] **Step 5: Commit**

```bash
git add scripts/manual-test-explicativo.md
git commit -m "docs(explicativo): checklist de validação manual end-to-end"
```

- [ ] **Step 6: Final verification**

Run: `npx vitest run && npx tsc --noEmit`
Expected: BOTH pass.

Report to the user:
- All 6 tasks completed
- New endpoints: `/api/explicativo/preview`, `/enviar-avulso`, `/enviar-com-proposta/:id`, `/templates`, `/templates/:tipo`
- New UI: `/texto-explicativo.html`
- Toggle + button added to proposta-remembramento UI
- Manual test checklist at `scripts/manual-test-explicativo.md`
- Z-API integration via existing `sendReply()` (no axios direct calls; dedup 60s via DB query)
- Templates editable at runtime (no deploy) via PUT `/templates/:tipo`

---

## Self-Review Summary

**Spec coverage** — every section of the spec has a task:
- Schema (`textos_explicativos`, `textos_explicativos_envios`, ALTER on `propostas`) → Task 1
- Seed of both templates → Task 1
- Variable interpolation + base_legal → Task 2
- Z-API send + dedup 60s + audit log → Task 3
- Routes (`/preview`, `/enviar-avulso`, `/enviar-com-proposta/:id`, `/templates` GET+PUT) → Task 4
- UI standalone (envio avulso) → Task 5
- UI integrada (toggle + botão na tela de proposta) → Task 6
- Vitest cobrindo todos os cenários listados na spec → Tasks 2, 3, 4
- Validação manual → Task 7

**Spec adaptations (intentional, documented):**
- `clientes` → `propostas_clientes` (real table name in this repo, see `src/database/migrations.ts:963`).
- `tipo_servico` column in `propostas` → reuse existing `subtipo_consultoria` (added in `src/database/migrations.ts:1283`). New column added is only `enviar_explicativo_junto`.
- `quantidade_imoveis` / `area_total` / `municipio` / `uf` / `tipo_imovel` → derived from existing `dados_imovel` JSON in `propostas` (no new columns).
- `enviarMensagemTextoZapi` (from spec) → `sendReply()` from `src/integrations/whatsapp.ts` (real function name).
- Tests live next to `.ts` files (Vitest config: `src/**/*.test.ts`), not in `tests/`.
- Pool import is default export (`import pool from '../database/connection'`).
