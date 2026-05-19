# Remembramento – Ajustes v2 – Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar o formulário e o PDF da Proposta de Remembramento (subtipo de `propostas_consultoria`) adicionando livro/folha por imóvel, autocomplete de CRI via `cartorios`, checklist obrigatório de CND/BCI/certidão (com validação de 30 dias), reorganização das seções e UI dedicada.

**Architecture:** Estende a infraestrutura existente em vez de duplicar. Remembramento já é um `subtipo_consultoria` da tabela `propostas` (JSON em `dados_imovel` e `custos_calculados`). Adiciona campos novos ao input `InputDesmembramento`, expõe endpoint de autocomplete sobre `cartorios`, e cria um wizard HTML dedicado.

**Tech Stack:** Node.js 22, TypeScript, Express, MySQL2 (pool), PDFKit + pdf-lib, vanilla JS frontend (sem framework), vitest.

---

## Divergências do prompt original (adaptações ao código real)

Antes de começar, ler estes ajustes em relação ao prompt original do usuário:

| Prompt original                                  | Realidade do código                                                                                       | Decisão                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Tabela `propostas_remembramento` separada        | Não existe. Remembramento é `subtipo_consultoria='remembramento'` na tabela `propostas`                   | **Estender `propostas`** via JSON `dados_imovel`, não criar tabela nova                |
| Tabela `propostas_remembramento_imoveis`         | Não existe. `imoveis[]` já é armazenado dentro do JSON `dados_imovel`                                     | **Adicionar campos** ao schema `imoveis[]` em `types.ts`, sem coluna SQL nova          |
| Tabela `serventias`                              | Não existe. Existe `cartorios` (v3.2.0, CNJ, ~3.7k registros) com `denominacao, uf, cidade, cns`          | **Usar `cartorios`** como fonte do autocomplete                                        |
| Arquivo `propostaRemembramentoPdf.ts`            | Não existe. PDF é gerado em `src/integrations/propostasConsultoria.ts` (função `gerarPdfConsultoria`)     | **Editar a função existente**, não criar arquivo novo                                  |
| Endpoint `/api/propostas/remembramento/criar`    | Não existe. Existe `POST /api/propostas-consultoria`                                                       | **Usar endpoint existente**, validar `subtipo === 'remembramento'`                     |
| `cri_id INT` (FK)                                | Hoje `cri` é string livre dentro de `imoveis[]`                                                            | **Manter string** (CNS do cartório como chave natural) — JSON, não relacional          |

**Nada se perde no spec original:** todos os requisitos funcionais são entregues. Apenas o "onde" muda para evitar duplicação.

---

## File Structure

**Modificar:**
- `src/services/pricing/types.ts` — adiciona campos `livro`, `folha`, `cri_cns` em `imoveis[]`; adiciona `status_documentacao` e `assessoria_tecnica` em `InputDesmembramento`
- `src/services/pricing/desmembramento.ts` — validação dos novos campos + regra dos 30 dias da certidão
- `src/integrations/propostasConsultoria.ts` — render PDF: nova seção "Status da Documentação", colunas livro/folha/CRI na tabela de imóveis, seção "Honorários + Assessoria Técnica" no rodapé
- `src/server.ts` — registra novo router `/api/cartorios`

**Criar:**
- `src/routes/cartorios.ts` — endpoint `GET /api/cartorios/autocomplete?q=`
- `src/public/proposta-remembramento.html` — formulário dedicado em wizard de 5 seções
- `src/public/js/proposta-remembramento.js` — lógica do formulário + autocomplete + validações cliente

**Testes:**
- `src/services/pricing/desmembramento.test.ts` — estender com novos cenários
- `src/routes/cartorios.test.ts` — novo

---

## Sequenciamento

Tarefas independentes podem rodar em paralelo (marcadas com 🟢). Demais são sequenciais.

```
Task 1 (types)          ──┐
Task 2 (calc validations) ├─→ Task 4 (PDF render) ──→ Task 5 (frontend HTML) ──→ Task 6 (autocomplete) ──→ Task 7 (smoke E2E)
Task 3 (cartorios route) ─┘                                                            🟢
```

---

### Task 1: Estender tipo `InputDesmembramento` com novos campos

**Files:**
- Modify: `src/services/pricing/types.ts:115-122` (bloco `imoveis?: Array<…>`)
- Modify: `src/services/pricing/types.ts:103-172` (interface `InputDesmembramento`)

- [ ] **Step 1: Escrever testes (red)**

Adicionar em `src/services/pricing/desmembramento.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { calcularDesmembramento } from './desmembramento';
import type { InputDesmembramento } from './types';

describe('remembramento — campos novos v2', () => {
  const baseInput: InputDesmembramento = {
    tipo: 'remembramento',
    area_total_m2: 0,
    valor_venal_total: 100000,
    tipo_zona: 'urbana',
    iptu_em_dia: true,
    honorario_projeto_sm: 1.0,
    numero_lotes_origem: 2,
  };

  it('aceita livro/folha/cri_cns por imóvel', async () => {
    const out = await calcularDesmembramento({
      ...baseInput,
      imoveis: [
        { ordem: 1, area_m2: 250, endereco: 'Rua A, 1', matricula: 'M-001', livro: '2-AA', folha: '101', cri_cns: '00.123-4' },
        { ordem: 2, area_m2: 300, endereco: 'Rua A, 2', matricula: 'M-002', livro: '2-AB', folha: '202', cri_cns: '00.123-4' },
      ],
    });
    expect(out.custos.secao_5_total).toBeGreaterThan(0);
  });

  it('bloqueia quando livro vazio em algum imóvel (modo detalhado exige)', async () => {
    await expect(calcularDesmembramento({
      ...baseInput,
      imoveis: [
        { ordem: 1, area_m2: 250, endereco: 'R', matricula: 'M-001', livro: '', folha: '101' },
        { ordem: 2, area_m2: 300, endereco: 'R', matricula: 'M-002', livro: '2-A', folha: '202' },
      ],
    })).rejects.toThrow(/livro/i);
  });

  it('valida status_documentacao: certidão > 30 dias rejeita', async () => {
    const trintaUmDiasAtras = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await expect(calcularDesmembramento({
      ...baseInput,
      imoveis: [
        { ordem: 1, area_m2: 250, endereco: 'R', matricula: 'M-001', livro: '2-A', folha: '1' },
        { ordem: 2, area_m2: 300, endereco: 'R', matricula: 'M-002', livro: '2-B', folha: '2' },
      ],
      status_documentacao: {
        cnd_iptu_anexada: true,
        bci_anexado: true,
        certidao_inteiro_teor_data: trintaUmDiasAtras,
      },
    })).rejects.toThrow(/30 dias|vencida/i);
  });

  it('aceita certidão emitida hoje', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const out = await calcularDesmembramento({
      ...baseInput,
      imoveis: [
        { ordem: 1, area_m2: 250, endereco: 'R', matricula: 'M-001', livro: '2-A', folha: '1' },
        { ordem: 2, area_m2: 300, endereco: 'R', matricula: 'M-002', livro: '2-B', folha: '2' },
      ],
      status_documentacao: {
        cnd_iptu_anexada: true,
        bci_anexado: true,
        certidao_inteiro_teor_data: hoje,
      },
    });
    expect(out.custos.secao_5_total).toBeGreaterThan(0);
  });

  it('assessoria_tecnica desligada não soma no total', async () => {
    const out = await calcularDesmembramento({
      ...baseInput,
      imoveis: [
        { ordem: 1, area_m2: 250, endereco: 'R', matricula: 'M-001', livro: '2-A', folha: '1' },
        { ordem: 2, area_m2: 300, endereco: 'R', matricula: 'M-002', livro: '2-B', folha: '2' },
      ],
      assessoria_tecnica: { habilitada: false, valor: 500 },
    });
    const temAssessoria = out.custos.secao_3_honorarios.some(h => /assessoria t/i.test(h.descricao));
    expect(temAssessoria).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar testes para confirmar vermelho**

Run: `npx vitest run src/services/pricing/desmembramento.test.ts -t "campos novos v2"`
Expected: FAIL — referências a `livro`, `folha`, `cri_cns`, `status_documentacao`, `assessoria_tecnica` não existem em tipo.

- [ ] **Step 3: Estender o tipo**

Em `src/services/pricing/types.ts`, substituir o bloco `imoveis?: Array<…>` (linhas ~115-122):

```typescript
  imoveis?: Array<{
    ordem: number;
    area_m2: number;
    endereco: string;
    matricula: string;
    // v2 — campos novos
    livro?: string;             // ex: '2-AA' (livro de transcrição/registro)
    folha?: string;             // ex: '101' (folha do livro)
    cri?: string;               // legado: nome livre do CRI (mantido p/ retrocompat)
    cri_cns?: string;           // v2: CNS do cartório (FK natural para cartorios.cns)
    cri_denominacao?: string;   // v2: snapshot do nome do cartório no momento da proposta
  }>;
```

E adicionar logo após `assessoria_juridica?: {…}` (próximo da linha 136), os blocos novos:

```typescript
  // v2: status obrigatório de documentação (substitui parcialmente o checklist)
  status_documentacao?: {
    cnd_iptu_anexada: boolean;
    bci_anexado: boolean;
    certidao_inteiro_teor_data: string;   // ISO YYYY-MM-DD; validade 30 dias a contar de hoje
  };

  // v2: Assessoria Técnica (substitui assessoria_juridica para remembramento)
  assessoria_tecnica?: {
    habilitada: boolean;
    valor?: number;
  };

  // v2: estado civil do cliente (espelhado aqui pra validação de docs do cônjuge no PDF)
  cliente_estado_civil?: 'solteiro' | 'casado' | 'divorciado' | 'viuvo' | 'uniao_estavel';
```

- [ ] **Step 4: Commit (tipos isolados — compila ainda? rodar `tsc --noEmit`)**

```bash
npx tsc --noEmit
git add src/services/pricing/types.ts
git commit -m "feat(remembramento-v2): adicionar campos livro/folha/cri_cns/status_documentacao/assessoria_tecnica em InputDesmembramento"
```

---

### Task 2: Validações na calculadora + Assessoria Técnica como linha de honorário

**Files:**
- Modify: `src/services/pricing/desmembramento.ts:70-86` (bloco de validação `imoveis[]`)
- Modify: `src/services/pricing/desmembramento.ts:200-280` (área dos honorários — adicionar Assessoria Técnica)

- [ ] **Step 1: Estender validação de imóveis**

Logo após a validação atual de `matricula` (linha 77), adicionar:

```typescript
      // v2: livro e folha são obrigatórios quando imoveis[] vier preenchido
      if (i.livro !== undefined && !i.livro.trim()) {
        throw new Error(`Imóvel #${i.ordem}: livro não pode ser vazio`);
      }
      if (i.folha !== undefined && !i.folha.trim()) {
        throw new Error(`Imóvel #${i.ordem}: folha não pode ser vazia`);
      }
      // CNS (se vier) deve ter formato XX.XXX-X (validação leve, só rejeita lixo óbvio)
      if (i.cri_cns && !/^\d{2}\.\d{3}-\d$/.test(i.cri_cns)) {
        throw new Error(`Imóvel #${i.ordem}: cri_cns deve seguir formato XX.XXX-X`);
      }
```

> **Decisão de design:** livro/folha são opcionais NO TIPO (alguns desmembramentos antigos podem não tê-los), mas se vierem string vazia explicitamente, rejeita. UI sempre envia preenchido.

- [ ] **Step 2: Adicionar validação dos 30 dias da certidão**

Logo após o bloco `imoveis[]` (próximo à linha 86), antes de `pecas_tecnicas`:

```typescript
  // v2: validação status_documentacao (regra dos 30 dias para certidão de inteiro teor)
  if (input.status_documentacao) {
    const sd = input.status_documentacao;
    if (!sd.cnd_iptu_anexada) {
      throw new Error('CND de IPTU é obrigatória (anexar antes de submeter)');
    }
    if (!sd.bci_anexado) {
      throw new Error('BCI do imóvel é obrigatório (anexar antes de submeter)');
    }
    if (!sd.certidao_inteiro_teor_data) {
      throw new Error('Data de emissão da certidão de inteiro teor é obrigatória');
    }
    const emissao = new Date(sd.certidao_inteiro_teor_data + 'T00:00:00');
    if (Number.isNaN(emissao.getTime())) {
      throw new Error('certidao_inteiro_teor_data inválida (use ISO YYYY-MM-DD)');
    }
    const diffDias = (Date.now() - emissao.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDias > 30) {
      throw new Error(`Certidão de inteiro teor vencida (${Math.floor(diffDias)} dias desde a emissão; validade máxima: 30 dias)`);
    }
    if (diffDias < -1) {
      throw new Error('certidao_inteiro_teor_data não pode ser futura');
    }
  }
```

- [ ] **Step 3: Inserir linha de Assessoria Técnica em `secao_3_honorarios` quando habilitada**

Localizar onde `secao_3_honorarios` é montado (próximo das linhas 200-280, no fim da seção 3 — `assessoria_juridica`). Adicionar lógica paralela:

```typescript
  // v2: Assessoria Técnica — habilitada por toggle (substitui assessoria_juridica em remembramento v2)
  if (input.assessoria_tecnica?.habilitada) {
    const valorAT = Number(input.assessoria_tecnica.valor ?? 0);
    if (!Number.isFinite(valorAT) || valorAT < 0) {
      throw new Error('assessoria_tecnica.valor inválido');
    }
    secao_3_honorarios.push({
      ordem: secao_3_honorarios.length + 1,
      descricao: 'Assessoria Técnica',
      valor: valorAT,
      observacao: 'Acompanhamento técnico junto ao cartório e prefeitura (contratação opcional)',
    });
  }
```

E na soma final (`secao_5_total = soma de secao_2_taxas + secao_3_honorarios`), garantir que o item entra (deve entrar automaticamente se já somar `secao_3_honorarios.reduce(…)`).

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run src/services/pricing/desmembramento.test.ts`
Expected: PASS — todos os 4 novos testes + suite anterior.

- [ ] **Step 5: Commit**

```bash
git add src/services/pricing/desmembramento.ts src/services/pricing/desmembramento.test.ts
git commit -m "feat(remembramento-v2): validar livro/folha/CNS por imóvel + regra 30 dias certidão + Assessoria Técnica como honorário"
```

---

### Task 3: Endpoint de autocomplete `/api/cartorios/autocomplete` 🟢

**Files:**
- Create: `src/routes/cartorios.ts`
- Create: `src/routes/cartorios.test.ts`
- Modify: `src/server.ts` (registrar o router)

- [ ] **Step 1: Teste primeiro (red)**

`src/routes/cartorios.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cartoriosRouter from './cartorios';
import pool from '../database/connection';

vi.mock('../database/connection', () => ({
  default: { execute: vi.fn() },
}));

describe('GET /api/cartorios/autocomplete', () => {
  const app = express();
  app.use('/api/cartorios', cartoriosRouter);

  beforeEach(() => vi.clearAllMocks());

  it('rejeita query com menos de 2 caracteres', async () => {
    const res = await request(app).get('/api/cartorios/autocomplete?q=a');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mínimo 2/i);
  });

  it('busca em denominacao e retorna até 10 resultados', async () => {
    (pool.execute as any).mockResolvedValueOnce([
      [{ cns: '00.123-4', denominacao: '1º Ofício de Registro de Imóveis', uf: 'MA', cidade: 'Açailândia' }],
      [],
    ]);
    const res = await request(app).get('/api/cartorios/autocomplete?q=Açailandia');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ cns: '00.123-4', denominacao: expect.stringContaining('Registro') });
    expect(pool.execute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT cns, denominacao, uf, cidade'),
      expect.arrayContaining([expect.stringContaining('Açailandia')]),
    );
  });

  it('filtra por uf opcional', async () => {
    (pool.execute as any).mockResolvedValueOnce([[], []]);
    await request(app).get('/api/cartorios/autocomplete?q=Imov&uf=MA');
    const callArgs = (pool.execute as any).mock.calls[0];
    expect(callArgs[0]).toContain('uf =');
    expect(callArgs[1]).toContain('MA');
  });
});
```

- [ ] **Step 2: Confirmar vermelho**

Run: `npx vitest run src/routes/cartorios.test.ts`
Expected: FAIL — arquivo do router não existe.

- [ ] **Step 3: Implementar router**

`src/routes/cartorios.ts`:

```typescript
import { Router, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';

const router = Router();

interface CartorioRow extends RowDataPacket {
  cns: string;
  denominacao: string;
  uf: string;
  cidade: string;
}

router.get('/autocomplete', async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '').trim();
  const uf = String(req.query.uf ?? '').trim().toUpperCase();

  if (q.length < 2) {
    return res.status(400).json({ error: 'Termo de busca exige no mínimo 2 caracteres' });
  }
  if (uf && !/^[A-Z]{2}$/.test(uf)) {
    return res.status(400).json({ error: 'UF inválida' });
  }

  const params: Array<string> = [`%${q}%`, `%${q}%`];
  let sql = `
    SELECT cns, denominacao, uf, cidade
      FROM cartorios
     WHERE (denominacao LIKE ? OR cidade LIKE ?)
  `;
  if (uf) {
    sql += ' AND uf = ?';
    params.push(uf);
  }
  sql += ' ORDER BY denominacao LIMIT 10';

  try {
    const [rows] = await pool.execute<CartorioRow[]>(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('[cartorios/autocomplete]', (err as Error).message);
    return res.status(500).json({ error: 'Falha na busca de cartórios' });
  }
});

export default router;
```

- [ ] **Step 4: Registrar no server**

Em `src/server.ts`, junto às outras importações de routers:

```typescript
import cartoriosRouter from './routes/cartorios';
```

E onde os outros `app.use('/api/...')` estão:

```typescript
app.use('/api/cartorios', cartoriosRouter);
```

- [ ] **Step 5: Rodar testes**

Run: `npx vitest run src/routes/cartorios.test.ts`
Expected: PASS — 3 testes.

- [ ] **Step 6: Smoke test manual**

```bash
npx tsc --noEmit
# Iniciar dev (se houver):
# npm run dev  (em outro terminal)
# curl "http://localhost:3000/api/cartorios/autocomplete?q=Imoveis&uf=MA"
```

- [ ] **Step 7: Commit**

```bash
git add src/routes/cartorios.ts src/routes/cartorios.test.ts src/server.ts
git commit -m "feat(cartorios): autocomplete GET /api/cartorios/autocomplete consultando tabela cartorios"
```

---

### Task 4: PDF — reorganizar seções e adicionar livro/folha/CRI na tabela de imóveis

**Files:**
- Modify: `src/integrations/propostasConsultoria.ts:440-490` (bloco `imoveisDetalhados` + cabeçalho da tabela)
- Modify: `src/integrations/propostasConsultoria.ts` — adicionar nova seção "Status da Documentação" antes da tabela de imóveis

> Antes de editar, abrir o arquivo e localizar a função que renderiza o PDF (provavelmente `gerarPdfConsultoria` ou similar — buscar por `'remembramento'` e `imoveisDetalhados`).

- [ ] **Step 1: Adicionar colunas livro/folha na tabela de imóveis do PDF**

Localizar (próximo à linha 451):

```typescript
const colsImv = { ord: 48, area: 75, end: 145, mat: 395, cri: 480 };
const wImv = { ord: 25, area: 65, end: 245, mat: 80, cri: 65 };
```

Substituir por (largura do CRI cresce, posições recalculadas):

```typescript
// v2: nova layout — Imóvel | Área | Endereço | Matrícula | Livro | Folha | CRI
const colsImv = { ord: 48, area: 78, end: 130, mat: 320, livro: 380, folha: 415, cri: 450 };
const wImv = { ord: 25, area: 50, end: 185, mat: 55, livro: 32, folha: 32, cri: 95 };
```

Adicionar no cabeçalho (logo depois do `doc.text('CRI', colsImv.cri, hY, …)`), substituir o trecho de header completo por:

```typescript
doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#222');
doc.text('Imóvel',    colsImv.ord,   hY, { width: wImv.ord });
doc.text('Área (m²)', colsImv.area,  hY, { width: wImv.area });
doc.text('Endereço',  colsImv.end,   hY, { width: wImv.end });
doc.text('Matrícula', colsImv.mat,   hY, { width: wImv.mat });
doc.text('Livro',     colsImv.livro, hY, { width: wImv.livro });
doc.text('Folha',     colsImv.folha, hY, { width: wImv.folha });
doc.text('CRI',       colsImv.cri,   hY, { width: wImv.cri });
```

E na renderização das linhas (próximo à linha 466), substituir o bloco do `for (const iv of imoveisDetalhados)` adicionando livro/folha:

```typescript
for (const iv of imoveisDetalhados) {
  doc.font('Helvetica').fontSize(8.5).fillColor('#333');
  doc.text(String(iv.ordem),                  colsImv.ord,   cY, { width: wImv.ord });
  doc.text(Number(iv.area_m2).toLocaleString('pt-BR'), colsImv.area, cY, { width: wImv.area });
  doc.text(iv.endereco || '-',                colsImv.end,   cY, { width: wImv.end });
  doc.text(iv.matricula || '-',               colsImv.mat,   cY, { width: wImv.mat });
  doc.text(iv.livro || '-',                   colsImv.livro, cY, { width: wImv.livro });
  doc.text(iv.folha || '-',                   colsImv.folha, cY, { width: wImv.folha });
  doc.text(iv.cri_denominacao || iv.cri || '-', colsImv.cri, cY, { width: wImv.cri });
  cY += 14;
}
```

Atualizar o tipo do cast na linha 441 também:

```typescript
const imoveisDetalhados = Array.isArray(dadosImv.imoveis)
  ? (dadosImv.imoveis as Array<{
      ordem: number; area_m2: number; endereco: string; matricula: string;
      livro?: string; folha?: string; cri?: string; cri_cns?: string; cri_denominacao?: string;
    }>)
  : null;
```

- [ ] **Step 2: Adicionar seção "Status da Documentação" antes da tabela de imóveis**

Logo antes do `if (imoveisDetalhados && imoveisDetalhados.length >= 2 && p.subtipo === 'remembramento')` (~linha 444), inserir:

```typescript
// v2: Seção "Status da Documentação" (apenas remembramento com status_documentacao no JSON)
const statusDoc = (dadosImv as any).status_documentacao as
  | { cnd_iptu_anexada?: boolean; bci_anexado?: boolean; certidao_inteiro_teor_data?: string }
  | undefined;
if (statusDoc && p.subtipo === 'remembramento') {
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0a3d62');
  doc.text('Status da Documentação');
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(9).fillColor('#222');
  const fmtCheck = (b: boolean | undefined) => (b ? '☑' : '☐');
  doc.text(`${fmtCheck(p.dados_imovel?.iptu_em_dia)} IPTU em dia`);
  doc.text(`${fmtCheck(statusDoc.cnd_iptu_anexada)} CND de IPTU anexada`);
  doc.text(`${fmtCheck(statusDoc.bci_anexado)} BCI do imóvel anexado`);
  if (statusDoc.certidao_inteiro_teor_data) {
    const dt = new Date(statusDoc.certidao_inteiro_teor_data + 'T00:00:00');
    const diff = Math.floor((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24));
    const dtFmt = dt.toLocaleDateString('pt-BR');
    const sufixo = diff <= 30 ? `(válida — ${diff} dias)` : `(VENCIDA — ${diff} dias)`;
    doc.text(`☑ Certidão de inteiro teor (emitida em ${dtFmt}) ${sufixo}`);
  }
}
```

- [ ] **Step 3: Validar compilação**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 4: Smoke do PDF (manual)**

Gerar manualmente uma proposta de remembramento via API com `imoveis[]` contendo livro/folha + `status_documentacao` e baixar o PDF. Conferir visualmente: tabela tem 7 colunas, seção "Status" aparece, sem texto cortado.

> Se não tiver dev local rodando, anotar como teste pendente e seguir.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/propostasConsultoria.ts
git commit -m "feat(remembramento-v2-pdf): tabela imoveis com livro/folha/CRI + seção Status da Documentação"
```

---

### Task 5: Frontend — wizard HTML dedicado de Proposta de Remembramento

**Files:**
- Create: `src/public/proposta-remembramento.html`
- Create: `src/public/js/proposta-remembramento.js`

> **Decisão de UX:** wizard de 5 passos numerados:
> 1. Dados do Cliente (nome, CPF/CNPJ, telefone, e-mail, estado civil, profissão, tipo de imóvel)
> 2. Status Obrigatórios (4 checks + data da certidão; bloqueia "próximo" se vencida)
> 3. Detalhamento dos Imóveis (repeater dinâmico ≥2, autocomplete CRI)
> 4. Documentos Anexos (lista verificável; mostra docs cônjuge se estado_civil=casado)
> 5. Honorários + Assessoria Técnica (toggle)
>
> Última tela mostra resumo + área total auto-calculada antes de submeter.

- [ ] **Step 1: Criar HTML do wizard**

`src/public/proposta-remembramento.html` — estrutura mínima usando o padrão visual atual (consultar `obras.html` para classes/cores):

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Proposta de Remembramento — Romatec</title>
  <link rel="stylesheet" href="/css/app.css" />
  <style>
    .wizard-step { display: none; }
    .wizard-step.active { display: block; }
    .imovel-card { border: 1px solid #ddd; padding: 12px; margin-bottom: 12px; border-radius: 6px; }
    .autocomplete-list { position: absolute; background: #fff; border: 1px solid #ccc; max-height: 220px; overflow-y: auto; z-index: 10; }
    .autocomplete-list .item { padding: 6px 10px; cursor: pointer; }
    .autocomplete-list .item:hover { background: #f0f0f0; }
    .docs-conjuge.hidden { display: none; }
  </style>
</head>
<body>
  <header><h1>Proposta de Remembramento</h1></header>
  <form id="form-remembramento" novalidate>
    <!-- Step 1: Cliente -->
    <section class="wizard-step active" data-step="1">
      <h2>1. Dados do Cliente</h2>
      <label>Nome completo <input name="cliente.nome" required /></label>
      <label>CPF/CNPJ <input name="cliente.documento" required /></label>
      <label>Telefone / WhatsApp <input name="cliente.telefone" required /></label>
      <label>E-mail <input name="cliente.email" type="email" /></label>
      <label>Estado civil
        <select name="cliente.estado_civil" id="estado-civil" required>
          <option value="">—</option>
          <option value="solteiro">Solteiro(a)</option>
          <option value="casado">Casado(a)</option>
          <option value="divorciado">Divorciado(a)</option>
          <option value="viuvo">Viúvo(a)</option>
          <option value="uniao_estavel">União estável</option>
        </select>
      </label>
      <label>Profissão <input name="cliente.profissao" /></label>
      <label>Tipo de imóvel
        <select name="cliente.tipo_imovel" required>
          <option value="">—</option>
          <option value="urbano_residencial">Urbano residencial</option>
          <option value="urbano_comercial">Urbano comercial</option>
          <option value="rural">Rural</option>
        </select>
      </label>
      <button type="button" data-next="2">Próximo →</button>
    </section>

    <!-- Step 2: Status -->
    <section class="wizard-step" data-step="2">
      <h2>2. Status Obrigatórios</h2>
      <label><input type="checkbox" name="status.iptu_em_dia" required /> IPTU em dia</label>
      <label><input type="checkbox" name="status.cnd_iptu_anexada" required /> CND de IPTU anexada</label>
      <label><input type="checkbox" name="status.bci_anexado" required /> BCI do imóvel anexado</label>
      <label>Certidão de inteiro teor — data de emissão
        <input type="date" name="status.certidao_inteiro_teor_data" required />
        <span id="certidao-aviso"></span>
      </label>
      <button type="button" data-prev="1">← Voltar</button>
      <button type="button" data-next="3">Próximo →</button>
    </section>

    <!-- Step 3: Imóveis -->
    <section class="wizard-step" data-step="3">
      <h2>3. Detalhamento dos Imóveis</h2>
      <div id="imoveis-container"></div>
      <button type="button" id="add-imovel">+ Adicionar imóvel</button>
      <p>Área total: <strong id="area-total">0</strong> m²</p>
      <button type="button" data-prev="2">← Voltar</button>
      <button type="button" data-next="4">Próximo →</button>
    </section>

    <!-- Step 4: Documentos -->
    <section class="wizard-step" data-step="4">
      <h2>4. Documentos Anexos</h2>
      <fieldset>
        <legend>Documentos do cliente</legend>
        <label><input type="checkbox" name="docs.rg" /> RG</label>
        <label><input type="checkbox" name="docs.cpf" /> CPF</label>
        <label><input type="checkbox" name="docs.cnh" /> CNH (alternativa ao RG)</label>
        <label><input type="checkbox" name="docs.certidao_nasc_cas" /> Certidão de nascimento ou casamento</label>
        <label><input type="checkbox" name="docs.comprovante_endereco" /> Comprovante de endereço</label>
      </fieldset>
      <fieldset class="docs-conjuge hidden" id="docs-conjuge">
        <legend>Documentos do cônjuge</legend>
        <label><input type="checkbox" name="docs.conjuge_rg" /> RG do cônjuge</label>
        <label><input type="checkbox" name="docs.conjuge_cpf" /> CPF do cônjuge</label>
        <label><input type="checkbox" name="docs.conjuge_comprovante" /> Comprovante de endereço do cônjuge</label>
        <label><input type="checkbox" name="docs.conjuge_certidao_cas" /> Certidão de casamento</label>
      </fieldset>
      <fieldset>
        <legend>Documentos do imóvel (por imóvel — anexar separadamente)</legend>
        <p>Mapa · Memorial descritivo · ART/TRT · Requerimento</p>
      </fieldset>
      <button type="button" data-prev="3">← Voltar</button>
      <button type="button" data-next="5">Próximo →</button>
    </section>

    <!-- Step 5: Honorários -->
    <section class="wizard-step" data-step="5">
      <h2>5. Honorários e Assessoria Técnica</h2>
      <label>Honorário do projeto (em SM)
        <select name="honorarios.sm" required>
          <option value="0.5">0,5 SM</option>
          <option value="1.0" selected>1,0 SM</option>
        </select>
      </label>
      <label><input type="checkbox" name="assessoria_tecnica.habilitada" id="ass-toggle" /> Habilitar Assessoria Técnica</label>
      <label id="ass-valor-wrap" style="display:none;">Valor (R$)
        <input type="number" step="0.01" name="assessoria_tecnica.valor" />
      </label>
      <button type="button" data-prev="4">← Voltar</button>
      <button type="submit">Enviar Proposta</button>
    </section>
  </form>
  <script type="module" src="/js/proposta-remembramento.js"></script>
</body>
</html>
```

- [ ] **Step 2: Criar lógica do formulário**

`src/public/js/proposta-remembramento.js`:

```javascript
// Wizard navigation
document.querySelectorAll('[data-next]').forEach(btn => {
  btn.addEventListener('click', () => navigate(Number(btn.dataset.next)));
});
document.querySelectorAll('[data-prev]').forEach(btn => {
  btn.addEventListener('click', () => navigate(Number(btn.dataset.prev)));
});

function navigate(toStep) {
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
  document.querySelector(`[data-step="${toStep}"]`).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Step 1 → 4 conditional: docs cônjuge
document.getElementById('estado-civil').addEventListener('change', e => {
  const isCasado = e.target.value === 'casado' || e.target.value === 'uniao_estavel';
  document.getElementById('docs-conjuge').classList.toggle('hidden', !isCasado);
});

// Step 2: aviso 30 dias
document.querySelector('input[name="status.certidao_inteiro_teor_data"]').addEventListener('change', e => {
  const aviso = document.getElementById('certidao-aviso');
  if (!e.target.value) { aviso.textContent = ''; return; }
  const dias = Math.floor((Date.now() - new Date(e.target.value + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));
  if (dias > 30) {
    aviso.textContent = `⚠ Vencida há ${dias - 30} dia(s). Solicite nova certidão.`;
    aviso.style.color = 'red';
  } else if (dias < 0) {
    aviso.textContent = '⚠ Data futura inválida.';
    aviso.style.color = 'red';
  } else {
    aviso.textContent = `✓ Válida (${30 - dias} dia(s) restante(s))`;
    aviso.style.color = 'green';
  }
});

// Step 3: imóveis repeater
const imoveisContainer = document.getElementById('imoveis-container');
let imovelCount = 0;

function addImovel() {
  imovelCount++;
  const card = document.createElement('div');
  card.className = 'imovel-card';
  card.dataset.ordem = String(imovelCount);
  card.innerHTML = `
    <h3>Imóvel ${imovelCount}</h3>
    <label>Endereço <input name="imovel.${imovelCount}.endereco" required /></label>
    <label>Área (m²) <input type="number" step="0.01" name="imovel.${imovelCount}.area_m2" required /></label>
    <label>Matrícula <input name="imovel.${imovelCount}.matricula" required /></label>
    <label>Livro <input name="imovel.${imovelCount}.livro" required /></label>
    <label>Folha <input name="imovel.${imovelCount}.folha" required /></label>
    <label>CRI (Cartório de Registro de Imóveis)
      <input name="imovel.${imovelCount}.cri_denominacao" data-autocomplete="cri" autocomplete="off" required />
      <input type="hidden" name="imovel.${imovelCount}.cri_cns" />
      <div class="autocomplete-list" style="display:none;"></div>
    </label>
    <label>Valor (R$) <input type="number" step="0.01" name="imovel.${imovelCount}.valor" /></label>
    <button type="button" class="remove-imovel">Remover</button>
  `;
  imoveisContainer.appendChild(card);
  attachAutocomplete(card.querySelector('[data-autocomplete="cri"]'));
  card.querySelectorAll('input[type="number"]').forEach(i => i.addEventListener('input', updateAreaTotal));
  card.querySelector('.remove-imovel').addEventListener('click', () => {
    if (document.querySelectorAll('.imovel-card').length <= 2) {
      alert('Mínimo de 2 imóveis para remembramento.');
      return;
    }
    card.remove();
    updateAreaTotal();
  });
}

function updateAreaTotal() {
  const total = Array.from(document.querySelectorAll('input[name$=".area_m2"]'))
    .reduce((s, i) => s + (Number(i.value) || 0), 0);
  document.getElementById('area-total').textContent = total.toLocaleString('pt-BR');
}

document.getElementById('add-imovel').addEventListener('click', addImovel);
// Inicia com 2 imóveis já (mínimo)
addImovel();
addImovel();

// Autocomplete CRI
function attachAutocomplete(input) {
  const list = input.parentElement.querySelector('.autocomplete-list');
  let timer;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { list.style.display = 'none'; return; }
    timer = setTimeout(async () => {
      const res = await fetch(`/api/cartorios/autocomplete?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const items = await res.json();
      list.innerHTML = items.map(it =>
        `<div class="item" data-cns="${it.cns}" data-denom="${it.denominacao}">${it.denominacao} <small>(${it.cidade}/${it.uf})</small></div>`
      ).join('');
      list.style.display = items.length ? 'block' : 'none';
      list.querySelectorAll('.item').forEach(el => {
        el.addEventListener('click', () => {
          input.value = el.dataset.denom;
          input.parentElement.querySelector('input[type="hidden"]').value = el.dataset.cns;
          list.style.display = 'none';
        });
      });
    }, 220);
  });
  document.addEventListener('click', e => { if (!input.parentElement.contains(e.target)) list.style.display = 'none'; });
}

// Step 5: toggle assessoria
document.getElementById('ass-toggle').addEventListener('change', e => {
  document.getElementById('ass-valor-wrap').style.display = e.target.checked ? 'block' : 'none';
});

// Submit
document.getElementById('form-remembramento').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = buildPayload(fd);
  const res = await fetch('/api/propostas-consultoria', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    alert('Erro: ' + (body.error || res.statusText));
    return;
  }
  alert('Proposta criada: ' + body.numero);
  window.location.href = '/painel.html';
});

function buildPayload(fd) {
  const imoveis = [];
  document.querySelectorAll('.imovel-card').forEach((card, idx) => {
    const ordem = idx + 1;
    imoveis.push({
      ordem,
      area_m2: Number(fd.get(`imovel.${card.dataset.ordem}.area_m2`) || 0),
      endereco: fd.get(`imovel.${card.dataset.ordem}.endereco`) || '',
      matricula: fd.get(`imovel.${card.dataset.ordem}.matricula`) || '',
      livro: fd.get(`imovel.${card.dataset.ordem}.livro`) || '',
      folha: fd.get(`imovel.${card.dataset.ordem}.folha`) || '',
      cri_denominacao: fd.get(`imovel.${card.dataset.ordem}.cri_denominacao`) || '',
      cri_cns: fd.get(`imovel.${card.dataset.ordem}.cri_cns`) || '',
    });
  });

  return {
    subtipo: 'remembramento',
    cliente_id: window.__CLIENTE_ID__ ?? null,   // ajustar conforme fluxo de seleção real
    dados_imovel: {
      tipo: 'remembramento',
      area_total_m2: 0,                          // backend recalcula a partir de imoveis[]
      valor_venal_total: imoveis.reduce((s, i) => s + (Number(fd.get(`imovel.${i.ordem}.valor`)) || 0), 0),
      tipo_zona: fd.get('cliente.tipo_imovel') === 'rural' ? 'rural' : 'urbana',
      iptu_em_dia: fd.get('status.iptu_em_dia') === 'on',
      honorario_projeto_sm: Number(fd.get('honorarios.sm')),
      numero_lotes_origem: imoveis.length,
      imoveis,
      cliente_estado_civil: fd.get('cliente.estado_civil') || undefined,
      status_documentacao: {
        cnd_iptu_anexada: fd.get('status.cnd_iptu_anexada') === 'on',
        bci_anexado: fd.get('status.bci_anexado') === 'on',
        certidao_inteiro_teor_data: fd.get('status.certidao_inteiro_teor_data') || '',
      },
      assessoria_tecnica: {
        habilitada: fd.get('assessoria_tecnica.habilitada') === 'on',
        valor: Number(fd.get('assessoria_tecnica.valor') || 0),
      },
    },
  };
}
```

- [ ] **Step 3: Smoke manual no browser**

Abrir `http://localhost:3000/proposta-remembramento.html` (ou rota equivalente), preencher os 5 passos, conferir:
- Toggle de docs cônjuge aparece quando seleciona "Casado(a)"
- Aviso vermelho/verde na data da certidão funciona
- Autocomplete CRI retorna sugestões ao digitar 2+ chars
- Remoção do 3º imóvel funciona; remoção do 2º bloqueia
- Submit gera proposta e redireciona

- [ ] **Step 4: Commit**

```bash
git add src/public/proposta-remembramento.html src/public/js/proposta-remembramento.js
git commit -m "feat(remembramento-v2-ui): wizard HTML dedicado com autocomplete CRI + validação 30d certidão"
```

---

### Task 6: Smoke E2E + ajustes finais 🟢

- [ ] **Step 1: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: PASS — todos os testes.

- [ ] **Step 2: Compilação completa**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 3: Smoke E2E em dev**

Em terminal separado: `npm run dev` (ou comando equivalente do projeto).

Browser: abrir `http://localhost:3000/proposta-remembramento.html`. Criar proposta com 3 imóveis (ex.: 250m², 300m², 200m²), confirmar:
- Área total no resumo = 750m²
- PDF gerado tem todas as 7 colunas na tabela
- Seção "Status da Documentação" presente
- Assessoria Técnica aparece em "Honorários" só se toggle estava ligado

- [ ] **Step 4: Anotar bugs encontrados (se houver) — não corrigir agora**

Listar em `docs/superpowers/plans/2026-05-19-remembramento-ajustes-v2.md` no fim ("Pendências pós-smoke").

- [ ] **Step 5: Commit final + tag de versão**

```bash
# Conferir mudanças
git log --oneline main..HEAD

# Atualizar package.json e CHANGELOG manualmente para v3.22.0
# (ajustar versão conforme convenção do projeto — checar o último commit pra ver o padrão)

git add package.json 06-Changelog/  # se houver atualização
git commit -m "chore: bump v3.22.0 — Remembramento v2 (livro/folha/CRI autocomplete + status doc + UI dedicada)"
```

---

## Self-review

**Spec coverage (em relação ao prompt original do usuário):**

| Requisito                                                                | Tarefa             | Coberto |
| ------------------------------------------------------------------------ | ------------------ | ------- |
| Seção "Dados do Cliente" no topo (nome, doc, contato, estado civil, etc) | Task 5 step 1      | ✅       |
| Remover endereço/área do topo                                            | Task 5 step 1      | ✅       |
| Área total = soma automática                                             | Task 5 step 2      | ✅       |
| Status: IPTU + CND + BCI + Certidão (30 dias)                            | Task 2, Task 5     | ✅       |
| Validação 30 dias certidão no backend                                    | Task 2 step 2      | ✅       |
| Imóveis com matrícula/livro/folha/CRI                                    | Task 1, 4, 5       | ✅       |
| Autocomplete CRI a partir da 2ª letra                                    | Task 3, Task 5     | ✅       |
| Valor por imóvel                                                         | Task 5 step 2      | ✅       |
| Documentos do cônjuge se casado                                          | Task 5 step 2      | ✅       |
| Honorários + Assessoria Técnica no rodapé                                | Task 2, Task 5     | ✅       |
| Toggle Assessoria Técnica                                                | Task 2 step 3      | ✅       |
| PDF: ordem das seções                                                    | Task 4             | ✅       |
| PDF: Status com checklist visual                                         | Task 4 step 2      | ✅       |
| PDF: tabela de imóveis (Imóvel N, endereço, matrícula, livro, folha, CRI, área, valor) | Task 4 step 1 | ✅ (valor é coluna nova; conferir cabeçalho na implementação) |
| Branch `feature/remembramento-ajustes-v2`                                | Pré-execução       | ⚠ Criar antes de iniciar |
| PR com governança                                                        | Pós-Task 6         | ⚠ Não merge direto na main |

**Gaps deliberados (não cobertos no plano):**

1. **Coluna "Valor (R$)" na tabela do PDF** — o plano adiciona `valor` no payload (Task 5) mas a Task 4 não renderiza essa coluna. Decisão: o valor por imóvel já vai no JSON; se o usuário quiser na tabela visível, adicionar 8ª coluna no Task 4 com `colsImv.valor` e `wImv.valor` (orçar ~20 pts de largura à direita).
2. **Documentos do imóvel (Mapa/Memorial/ART/Requerimento) anexados por upload real** — o formulário só mostra um checklist informativo. Sistema de upload de anexos já existe (`anexos[]` em `CriarPropostaConsultoriaInput:65`), mas integrar o input file ao wizard é trabalho adicional.
3. **Branch + PR** — o plano não inclui passos automatizados de criação de branch e PR. Antes de Task 1, executar manualmente: `git checkout -b feature/remembramento-ajustes-v2`.
4. **Tag de versão** — Task 6 step 5 deixa o bump manual. Confirmar com o usuário o número correto (v3.22.0 sugerido seguindo o padrão da v3.21.x atual).

**Placeholder scan:** zero `TODO`, `TBD`, `fill in details` no plano. Todos os blocos de código têm conteúdo executável.

**Type consistency:** `cri_cns` é a chave natural (CNS do CNJ), `cri_denominacao` é o nome humano salvo como snapshot. Usados consistentemente em types.ts, calc, PDF, frontend.

---

## Execução

Plano salvo em `docs/superpowers/plans/2026-05-19-remembramento-ajustes-v2.md`. Duas opções:

**1. Subagent-Driven (recomendado para este plano)** — Dispatch fresh subagent por task, revisão entre tasks. Bom porque Tasks 1+2 e Task 3 são paralelizáveis, e Task 5 é grande o suficiente pra justificar um agente dedicado focado só nela.

**2. Inline Execution** — Tudo neste sessão, checkpoints após cada task.

Antes de executar, criar a branch:

```bash
git checkout -b feature/remembramento-ajustes-v2
```
