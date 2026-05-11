# v3.4.0 VTO Assinatura ICP-Brasil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar assinatura digital ICP-Brasil (PF default) + campo hora + 2 fotos/página no PDF + preview maior com lightbox ao módulo de Vistoria Técnica de Obra (VTO).

**Architecture:** Reusa infraestrutura ICP-Brasil existente (`signPdfBuffer`, `getCertForSigning`) seguindo padrão idêntico de `recibosAssinatura.ts`. Migration adiciona 4 colunas a `romatec_obra_vistorias`. Novo módulo `vistoriasAssinatura.ts` orquestra fluxo: busca → gera PDF base → assina via PAdES → salva blob no banco. UI ganha input hora + thumbnails 200×200 + lightbox modal + botões Assinar/PDF Assinado.

**Tech Stack:** Node + TypeScript + Express + MySQL2 + PDFKit + `@signpdf/signpdf` + `@signpdf/signer-p12` + vanilla JS (front em `obras.html`).

**Estratégia de commits:** PR único v3.4.0 (mesma branch). **Ordem crítica:** CACHE bump em `sw.js` é o **ÚLTIMO commit** — garante que utility classes/endpoints novos já estão no HTML antes do cache rotacionar nos clients.

**Spec:** [docs/superpowers/specs/2026-05-10-vto-assinatura-icp-brasil-design.md](../specs/2026-05-10-vto-assinatura-icp-brasil-design.md)

---

## File Structure

**Created:**
- `src/integrations/vistoriasAssinatura.ts` — orquestração de assinatura (paralelo a `recibosAssinatura.ts`)

**Modified:**
- `src/database/migrations.ts` — bloco de migration idempotente p/ 4 colunas novas
- `src/integrations/vistorias.ts` — types incluem hora + status assinatura; `gerarPdfVistoria` aceita `signatureVisualMeta?` + 2 fotos/página
- `src/server.ts` — 2 endpoints novos + update CRUD pra aceitar `hora`
- `src/public/obras.html` — input hora + thumbnails 200×200 + lightbox + botão Assinar + badge
- `package.json` — bump version
- `src/agent/identity.ts` — bump version
- `src/public/sw.js` — bump CACHE (último commit)

---

## DOR (Definition of Ready)

- [ ] Branch `feat/vto-assinatura-v3.4.0` criada a partir de `main` atualizado
- [ ] `npm run typecheck` passa em `main` antes do trabalho começar
- [ ] **Cert PF (.pfx do José Romário) cadastrado no /obras admin** (pré-condição — sem isso a assinatura falha com erro claro)
- [ ] Chrome DevTools pronto (Device Toolbar) pra QA visual em viewports

---

## DOD (Definition of Done) — Critério universal por task

**Toda task DEVE terminar com:**
1. `npm run typecheck` passa
2. Mudanças visuais validadas em **360×800 (Galaxy A baseline)** + **412×915 (Pixel 7 = rugged GNSS)**
3. Smoke test funcional do fluxo modificado

**Critério adicional pra task de assinatura:** PDF assinado validável em https://validar.iti.gov.br/validar como **VÁLIDO** padrão ICP-Brasil.

---

## Task 1: Migration — adicionar 4 colunas a `romatec_obra_vistorias`

**Files:**
- Modify: `src/database/migrations.ts` — após linha ~340 (depois do CREATE TABLE de `romatec_obra_vistoria_fotos`)

- [ ] **Step 1: Localizar âncora**

Run: Grep `CREATE TABLE IF NOT EXISTS romatec_obra_vistoria_fotos` em `src/database/migrations.ts`.
Expected: linha ~330.

- [ ] **Step 2: Adicionar bloco de migration idempotente**

Após o `CREATE TABLE` de `romatec_obra_vistoria_fotos` (e seu fechamento `);`), adicionar este bloco (segue o padrão de `migrations-cartorios.ts` e `migrations-clonagem-laudo.ts` — try/catch ignorando "Duplicate column"):

```typescript
  // v3.4.0: assinatura ICP-Brasil + hora explicita em vistorias
  for (const sql of [
    `ALTER TABLE romatec_obra_vistorias ADD COLUMN hora TIME NULL AFTER data`,
    `ALTER TABLE romatec_obra_vistorias ADD COLUMN pdf_assinado LONGBLOB NULL`,
    `ALTER TABLE romatec_obra_vistorias ADD COLUMN assinatura_meta JSON NULL`,
    `ALTER TABLE romatec_obra_vistorias ADD COLUMN assinado_em DATETIME NULL`,
    `ALTER TABLE romatec_obra_vistorias ADD COLUMN assinado_por_cert_id INT NULL`,
  ]) {
    try {
      await pool.execute(sql);
      console.log('[migrations:vto-v3.4.0] OK:', sql.slice(0, 70));
    } catch (err) {
      const msg = (err as Error).message;
      if (!/Duplicate column|already exists/i.test(msg)) {
        console.error('[migrations:vto-v3.4.0] FAIL:', sql, msg);
        throw err;
      }
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS sem erros.

- [ ] **Step 4: Smoke test idempotência (local)**

Se tiver DB local, rodar `npm run dev` duas vezes em sequência. Conferir nos logs:
- 1ª run: `[migrations:vto-v3.4.0] OK: ALTER TABLE romatec_obra_vistorias ADD COLUMN hora TIME ...` (5 vezes)
- 2ª run: zero erros (Duplicate column silenciado)

Se não tiver DB local, deixar a validação real pro deploy no Railway.

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations.ts
git commit -m "feat(vto-v3.4.0): migration adiciona hora + colunas de assinatura ICP-Brasil"
```

---

## Task 2: Update `vistorias.ts` types + buscarVistoria SELECT

**Files:**
- Modify: `src/integrations/vistorias.ts:8-17` (VistoriaRow type)
- Modify: `src/integrations/vistorias.ts:62-90` (buscarVistoria SELECT + return)
- Modify: `src/integrations/vistorias.ts:36-60` (listarVistorias return — adicionar `assinado` boolean)

- [ ] **Step 1: Adicionar campos novos ao type VistoriaRow**

Em `src/integrations/vistorias.ts` no `type VistoriaRow` (linha ~8), adicionar campos:

```typescript
type VistoriaRow = RowDataPacket & {
  id: number; obra_id: number;
  data: Date; hora: string | null;       // v3.4.0
  titulo: string | null;
  vistoriador: string | null;
  descricao: string;
  observacoes: string | null;
  pendencias: string | null;
  status_obra: 'regular' | 'atencao' | 'critica';
  // v3.4.0: campos de assinatura ICP-Brasil
  pdf_assinado: Buffer | null;
  assinatura_meta: string | Record<string, unknown> | null;
  assinado_em: Date | string | null;
  assinado_por_cert_id: number | null;
  created_at: Date; updated_at: Date;
};
```

- [ ] **Step 2: Atualizar buscarVistoria return pra incluir hora + status assinado**

Em `buscarVistoria` (linha ~62), o return atual:

```typescript
return {
  id: String(r.id), obra_id: String(r.obra_id),
  data: formatBRDate(r.data), titulo: r.titulo,
  vistoriador: r.vistoriador, descricao: r.descricao,
  observacoes: r.observacoes, pendencias: r.pendencias,
  status_obra: r.status_obra,
  fotos: fotos.map(...),
  ...
};
```

Modificar pra adicionar campos novos:

```typescript
const assinatura_meta = r.assinatura_meta == null
  ? null
  : (typeof r.assinatura_meta === 'string' ? JSON.parse(r.assinatura_meta) : r.assinatura_meta);
const assinadoEmIso = r.assinado_em
  ? (r.assinado_em instanceof Date ? r.assinado_em.toISOString() : String(r.assinado_em))
  : null;

return {
  id: String(r.id), obra_id: String(r.obra_id),
  data: formatBRDate(r.data),
  hora: r.hora,  // v3.4.0: TIME format "HH:MM:SS" ou null
  titulo: r.titulo,
  vistoriador: r.vistoriador, descricao: r.descricao,
  observacoes: r.observacoes, pendencias: r.pendencias,
  status_obra: r.status_obra,
  // v3.4.0: status de assinatura (sem o blob, payload pequeno)
  assinado: !!r.pdf_assinado,
  assinado_em: assinadoEmIso,
  assinatura_meta,
  fotos: fotos.map(f => ({
    id: String(f.id), legenda: f.legenda,
    mime: f.mime, ordem: f.ordem,
  })),
};
```

- [ ] **Step 3: Atualizar listarVistorias pra incluir flag de assinado**

Em `listarVistorias` (linha ~36), modificar o SQL SELECT pra puxar `CASE WHEN v.pdf_assinado IS NULL THEN 0 ELSE 1 END AS assinado` e o map de retorno pra incluir `assinado: !!r.assinado` + `assinado_em`:

```typescript
let sql = `
  SELECT v.*,
         COUNT(f.id) AS qtd_fotos,
         CASE WHEN v.pdf_assinado IS NULL THEN 0 ELSE 1 END AS assinado
  FROM romatec_obra_vistorias v
  LEFT JOIN romatec_obra_vistoria_fotos f ON f.vistoria_id = v.id
`;
```

E no `.map(r => ({...}))`:

```typescript
return rows.map(r => ({
  id:           String(r.id),
  obra_id:      String(r.obra_id),
  data:         formatBRDate(r.data as Date),
  hora:         r.hora as string | null,       // v3.4.0
  titulo:       r.titulo as string | null,
  vistoriador:  r.vistoriador as string | null,
  descricao:    r.descricao as string,
  observacoes:  r.observacoes as string | null,
  pendencias:   r.pendencias as string | null,
  status_obra:  r.status_obra as string,
  qtd_fotos:    Number(r.qtd_fotos ?? 0),
  // v3.4.0: status assinatura
  assinado:     !!r.assinado,
  assinado_em:  r.assinado_em
    ? ((r.assinado_em as Date) instanceof Date
        ? (r.assinado_em as Date).toISOString()
        : String(r.assinado_em))
    : null,
  created_at:   formatBR(r.created_at as Date),
}));
```

- [ ] **Step 4: Atualizar criarVistoria + atualizarVistoria pra aceitar hora**

Localizar funções `criarVistoria` e `atualizarVistoria` em `src/integrations/vistorias.ts`. Adicionar `hora` no input type + no SQL INSERT/UPDATE:

```typescript
// Em criarVistoria input type:
export async function criarVistoria(input: {
  obra_id: string;
  data: string;
  hora?: string | null;  // v3.4.0 — formato "HH:MM" ou "HH:MM:SS"
  titulo?: string | null;
  vistoriador?: string | null;
  descricao: string;
  observacoes?: string | null;
  pendencias?: string | null;
  status_obra?: 'regular' | 'atencao' | 'critica';
  fotos?: Array<{ legenda?: string; mime: string; data_base64: string }>;
}): Promise<MutationResult> {
  // ... validacao existente ...
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obra_vistorias
       (obra_id, data, hora, titulo, vistoriador, descricao, observacoes, pendencias, status_obra)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.obra_id, input.data, input.hora ?? null, input.titulo ?? null,
     input.vistoriador ?? null, input.descricao,
     input.observacoes ?? null, input.pendencias ?? null,
     input.status_obra ?? 'regular']
  );
  // ... resto igual ...
}
```

E em `atualizarVistoria`, adicionar `hora` no UPDATE (mesma linha do `data`):

```typescript
const sets: string[] = [];
const vals: (string | number | null)[] = [];
if (input.data !== undefined) { sets.push('data = ?'); vals.push(input.data); }
if (input.hora !== undefined) { sets.push('hora = ?'); vals.push(input.hora ?? null); }
// ... resto igual ...
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/vistorias.ts
git commit -m "feat(vto-v3.4.0): types+SELECT incluem hora + status assinatura"
```

---

## Task 3: Criar `vistoriasAssinatura.ts` (paralelo a `recibosAssinatura.ts`)

**Files:**
- Create: `src/integrations/vistoriasAssinatura.ts`

- [ ] **Step 1: Criar o arquivo completo**

Conteúdo (paralelo direto a `recibosAssinatura.ts`, adaptado para vistorias):

```typescript
// v3.4.0 — Orquestracao de assinatura digital ICP-Brasil de vistorias.
//
// Diferente de recibos (PJ default), vistoria assina como PF por padrao
// (e ato tecnico do profissional, nao da empresa). Override via opts.perfil.

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { buscarVistoria, gerarPdfVistoria } from './vistorias';
import {
  getCertForSigning,
  type Perfil,
} from '../services/signingCertificates';
import { signPdfBuffer } from '../services/pdfSigner';
import type { SignatureVisualMeta } from './vistorias';

export interface AssinarVistoriaResult {
  vistoria_id: number;
  assinado_em: string;
  perfil: Perfil;
  cert: {
    id: number;
    label: string;
    subject_cn: string | null;
    subject_doc: string | null;
    issuer_cn: string | null;
    thumbprint: string | null;
    validade_ate: string | null;
  };
  pdf_size_bytes: number;
}

export interface AssinarVistoriaOpts {
  /** Perfil do certificado. Default: 'pf' (RT como profissional tecnico). */
  perfil?: Perfil;
}

export async function assinarVistoria(
  vistoriaId: number | string,
  opts: AssinarVistoriaOpts = {}
): Promise<AssinarVistoriaResult> {
  const vistoria = await buscarVistoria(String(vistoriaId));
  if (!vistoria) throw new Error('Vistoria nao encontrada');

  const perfil: Perfil = opts.perfil ?? 'pf';  // v3.4.0: PF default

  const certData = await getCertForSigning(perfil);
  if (!certData) {
    throw new Error(
      `Nenhum certificado digital ${perfil.toUpperCase()} cadastrado. ` +
      `Cadastre um .pfx em /obras admin antes de assinar.`
    );
  }

  if (certData.meta.expirado) {
    console.warn(`[vto:assinatura] cert ${certData.meta.id} VENCIDO em ${certData.meta.validade_ate}`);
  }

  // Monta metadata visual ANTES de gerar o PDF
  const agora = new Date();
  const signatureVisualMeta: SignatureVisualMeta = {
    signer_cn: certData.meta.subject_cn ?? `Vistoria #${vistoria.id}`,
    signer_doc: certData.meta.subject_doc,
    issuer_cn: certData.meta.issuer_cn,
    validade_ate: certData.meta.validade_ate,
    data_assinatura: agora,
    thumbprint: certData.meta.thumbprint,
  };

  // Gera PDF JA COM bloco visual de assinatura
  const pdfBuffer = await gerarPdfVistoria(vistoria.id, signatureVisualMeta);

  const signMeta = {
    name: certData.meta.subject_cn ?? `Vistoria ${vistoria.id}`,
    reason: `Vistoria #${vistoria.id} — ${vistoria.titulo || 'Sem titulo'}`,
    location: 'Acailandia/MA',
    contactInfo: certData.meta.subject_doc ?? '',
  };

  const pdfAssinado = await signPdfBuffer(
    pdfBuffer,
    certData.pfx,
    certData.senha,
    signMeta,
  );

  const meta = {
    perfil,
    cert_id: certData.meta.id,
    cert_label: certData.meta.label,
    subject_cn: certData.meta.subject_cn,
    subject_doc: certData.meta.subject_doc,
    issuer_cn: certData.meta.issuer_cn,
    thumbprint: certData.meta.thumbprint,
    validade_ate: certData.meta.validade_ate,
    assinado_em: agora.toISOString(),
    sign_reason: signMeta.reason,
    sign_location: signMeta.location,
  };

  await pool.execute<ResultSetHeader>(
    `UPDATE romatec_obra_vistorias
     SET pdf_assinado = ?,
         assinado_em = ?,
         assinado_por_cert_id = ?,
         assinatura_meta = ?
     WHERE id = ?`,
    [pdfAssinado, agora, certData.meta.id, JSON.stringify(meta), vistoria.id]
  );

  return {
    vistoria_id: Number(vistoria.id),
    assinado_em: agora.toISOString(),
    perfil,
    cert: {
      id: certData.meta.id,
      label: certData.meta.label,
      subject_cn: certData.meta.subject_cn,
      subject_doc: certData.meta.subject_doc,
      issuer_cn: certData.meta.issuer_cn,
      thumbprint: certData.meta.thumbprint,
      validade_ate: certData.meta.validade_ate,
    },
    pdf_size_bytes: pdfAssinado.length,
  };
}

interface VistoriaAssinadaRow extends RowDataPacket {
  id: number;
  pdf_assinado: Buffer | null;
  assinado_em: Date | string | null;
  assinatura_meta: string | Record<string, unknown> | null;
}

/** Retorna PDF assinado. null se nao foi assinado ainda. */
export async function getVistoriaPdfAssinado(vistoriaId: number | string): Promise<{
  pdf: Buffer;
  assinado_em: string;
  meta: Record<string, unknown>;
} | null> {
  const [rows] = await pool.execute<VistoriaAssinadaRow[]>(
    `SELECT id, pdf_assinado, assinado_em, assinatura_meta
     FROM romatec_obra_vistorias WHERE id = ? LIMIT 1`,
    [vistoriaId]
  );
  if (!rows.length || !rows[0].pdf_assinado) return null;
  const r = rows[0];
  const meta = typeof r.assinatura_meta === 'string'
    ? JSON.parse(r.assinatura_meta)
    : (r.assinatura_meta ?? {});
  const assinadoEm = r.assinado_em
    ? (r.assinado_em instanceof Date ? r.assinado_em.toISOString() : String(r.assinado_em))
    : '';
  return { pdf: r.pdf_assinado as Buffer, assinado_em: assinadoEm, meta };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (vai falhar até a Task 4 expor `SignatureVisualMeta` e modificar `gerarPdfVistoria` — sequencia obrigatória).

**IMPORTANTE:** Se typecheck falhar com "Module has no exported member 'SignatureVisualMeta'" ou "Expected 1 arguments, but got 2" — é esperado. Será resolvido na Task 4. **Não commitar até Task 4 estar pronta.**

- [ ] **Step 3: NÃO commitar ainda — aguardar Task 4**

(Combinar Task 3 + Task 4 num único commit pra manter typecheck verde a cada commit do histórico.)

---

## Task 4: Modificar `gerarPdfVistoria` (header + 2 fotos/página + bloco assinatura visual)

**Files:**
- Modify: `src/integrations/vistorias.ts:328-450` (`gerarPdfVistoria` function)
- Modify: `src/integrations/vistorias.ts` exports — adicionar `SignatureVisualMeta` type

- [ ] **Step 1: Adicionar type `SignatureVisualMeta` exportado**

Antes da função `gerarPdfVistoria` (linha ~325), adicionar:

```typescript
// v3.4.0: meta visual de assinatura — renderiza bloco "Assinado Digitalmente" no PDF
export interface SignatureVisualMeta {
  signer_cn: string;
  signer_doc: string | null;
  issuer_cn: string | null;
  validade_ate: string | null;
  data_assinatura: Date;
  thumbprint: string | null;
}
```

- [ ] **Step 2: Mudar signature de `gerarPdfVistoria` pra aceitar `signatureVisualMeta?`**

Modificar a linha 328:

```typescript
// ANTES
export async function gerarPdfVistoria(vistoriaId: string): Promise<Buffer> {

// DEPOIS
export async function gerarPdfVistoria(
  vistoriaId: string | number,
  signatureVisualMeta?: SignatureVisualMeta,
): Promise<Buffer> {
```

- [ ] **Step 3: Reformatar header — adicionar Local (cidade) + Data e Hora**

Localizar o bloco que renderiza o cabeçalho (~linha 358-370). Substituir:

```typescript
// ANTES (linhas ~358-370):
doc.fontSize(15).fillColor('#111').text('RELATÓRIO DE VISTORIA TÉCNICA', { align: 'center' });
doc.fontSize(11).fillColor('#444').text(`${v.titulo || 'Vistoria #' + v.id}  ·  ${formatBRDate(v.data)}`, { align: 'center' });
doc.moveDown(0.8);

doc.fontSize(11).fillColor(corHex).text('Obra');
doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
doc.moveDown(0.2);
doc.fontSize(10).fillColor('#111');
doc.text(`${obra.nome}${obra.cliente ? ' — ' + obra.cliente : ''}`);
if (obra.endereco) doc.text(`${obra.endereco}${obra.cidade ? ', ' + obra.cidade : ''}`);
if (v.vistoriador) doc.text(`Vistoriador: ${v.vistoriador}`);
doc.text(`Status: ${v.status_obra.toUpperCase()}`);
doc.moveDown(0.6);
```

Por:

```typescript
// DEPOIS:
doc.fontSize(15).fillColor('#111').text('RELATÓRIO DE VISTORIA TÉCNICA', { align: 'center' });

// Subtitulo com numero da vistoria + data
const subtitulo = `${v.titulo || 'Vistoria #' + v.id}`;
doc.fontSize(11).fillColor('#444').text(subtitulo, { align: 'center' });
doc.moveDown(0.8);

// Bloco "Dados da Vistoria" — formato tabular
doc.fontSize(11).fillColor(corHex).text('Dados da Vistoria');
doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
doc.moveDown(0.2);
doc.fontSize(10).fillColor('#111');

// Data e Hora juntos (formato brasileiro)
const dataHoraStr = v.hora
  ? `${formatBRDate(v.data)} as ${String(v.hora).slice(0, 5)}`  // "12/05/2026 as 14:32"
  : formatBRDate(v.data);
doc.text(`Data e Hora: ${dataHoraStr}`);

// Local (cidade explicita)
const localStr = obra.cidade ? String(obra.cidade) : '—';
doc.text(`Local: ${localStr}`);

doc.text(`Obra: ${obra.nome}${obra.cliente ? ' — ' + obra.cliente : ''}`);
if (obra.endereco) doc.text(`Endereco: ${obra.endereco}`);
if (v.vistoriador) doc.text(`Vistoriador: ${v.vistoriador}`);
doc.text(`Status: ${v.status_obra.toUpperCase()}`);
doc.moveDown(0.6);
```

- [ ] **Step 4: Refatorar bloco de fotos — 2 por página**

Localizar o bloco atual (~linha 394-404):

```typescript
// ANTES:
for (const f of fotos) {
  doc.addPage();
  doc.fontSize(11).fillColor(corHex).text(`Foto ${f.ordem + 1}${f.legenda ? ' — ' + f.legenda : ''}`);
  doc.moveDown(0.4);
  try {
    const buf = Buffer.from(f.data_base64, 'base64');
    doc.image(buf, { fit: [499, 650], align: 'center' });
  } catch (err) {
    doc.fontSize(9).fillColor('#999').text(`(falha ao renderizar foto: ${(err as Error).message})`);
  }
}
```

Substituir por:

```typescript
// DEPOIS: 2 fotos por pagina
function renderFotoNoPdf(d: typeof doc, foto: typeof fotos[0], indice: number) {
  const caption = `Foto ${indice}${foto.legenda ? ' — ' + foto.legenda : ''}`;
  d.fontSize(11).fillColor(corHex).text(caption, { width: 499 });
  d.moveDown(0.3);
  try {
    const buf = Buffer.from(foto.data_base64, 'base64');
    d.image(buf, { fit: [499, 310], align: 'center' });
  } catch (err) {
    d.fontSize(9).fillColor('#999').text(`(falha ao renderizar foto: ${(err as Error).message})`);
  }
}

// Itera em pares: (0,1), (2,3), (4,5)...
for (let i = 0; i < fotos.length; i += 2) {
  doc.addPage();

  // Cabecalho da pagina de fotos
  doc.fontSize(12).fillColor(corHex).text('Relatorio Fotografico', { align: 'left' });
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.4);

  // Foto 1 da pagina (sempre existe)
  renderFotoNoPdf(doc, fotos[i], i + 1);

  // Foto 2 da pagina (pode nao existir se quantidade impar)
  if (fotos[i + 1]) {
    doc.moveDown(0.8);
    renderFotoNoPdf(doc, fotos[i + 1], i + 2);
  }
}
```

- [ ] **Step 5: Adicionar bloco visual de assinatura no fim do PDF**

Localizar o final da função antes do footer (~linha 406+). Inserir antes do footer existente:

```typescript
// v3.4.0: bloco visual de assinatura ICP-Brasil (renderiza so quando signatureVisualMeta presente)
if (signatureVisualMeta) {
  doc.addPage();
  doc.fontSize(13).fillColor(corHex).text('ASSINATURA DIGITAL', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#444').text('Padrao ICP-Brasil (MP 2.200-2 / 2001)', { align: 'center' });
  doc.moveDown(0.8);

  doc.strokeColor(corHex).lineWidth(1).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.5);

  const m = signatureVisualMeta;
  doc.fontSize(10).fillColor('#111');

  doc.font('Helvetica-Bold').text('Signatario: ', { continued: true })
     .font('Helvetica').text(m.signer_cn);

  if (m.signer_doc) {
    doc.font('Helvetica-Bold').text('CPF/CNPJ: ', { continued: true })
       .font('Helvetica').text(m.signer_doc);
  }
  if (m.issuer_cn) {
    doc.font('Helvetica-Bold').text('Emissor: ', { continued: true })
       .font('Helvetica').text(m.issuer_cn);
  }
  if (m.validade_ate) {
    doc.font('Helvetica-Bold').text('Validade do certificado: ate ', { continued: true })
       .font('Helvetica').text(String(m.validade_ate).slice(0, 10));
  }

  const dataAssStr = m.data_assinatura.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  doc.font('Helvetica-Bold').text('Data da assinatura: ', { continued: true })
     .font('Helvetica').text(`${dataAssStr} (UTC-3 / Brasilia)`);

  if (m.thumbprint) {
    doc.font('Helvetica-Bold').text('Thumbprint SHA-1: ', { continued: true })
       .font('Helvetica').fontSize(8).text(m.thumbprint, { width: 400 });
    doc.fontSize(10);
  }

  doc.moveDown(0.8);
  doc.strokeColor(corHex).lineWidth(1).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.5);

  doc.fontSize(9).fillColor('#666').text(
    'Documento assinado digitalmente conforme MP 2.200-2/2001 (ICP-Brasil). ' +
    'Validavel em https://validar.iti.gov.br/validar e no painel "Assinaturas" do Adobe Acrobat Reader.',
    { align: 'center', width: 499 }
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS (incluindo a Task 3 que agora resolve `SignatureVisualMeta` e a assinatura modificada de `gerarPdfVistoria`).

- [ ] **Step 7: Commit (Tasks 3+4 juntas pra manter typecheck verde no histórico)**

```bash
git add src/integrations/vistorias.ts src/integrations/vistoriasAssinatura.ts
git commit -m "feat(vto-v3.4.0): modulo vistoriasAssinatura + PDF com hora/cidade/2-fotos-por-pagina/bloco-assinatura"
```

---

## Task 5: Adicionar endpoints no `server.ts`

**Files:**
- Modify: `src/server.ts` — adicionar 2 endpoints novos após o bloco de endpoints de vistorias (~linha 3082)

- [ ] **Step 1: Localizar âncora**

Run: Grep `app.post.*recibos/:id/assinar` em `src/server.ts`.
Expected: linha ~2617.

Run: Grep `app.get.*vistorias/:id/pdf` em `src/server.ts`.
Expected: linha ~3081.

- [ ] **Step 2: Adicionar imports**

No topo de `src/server.ts`, junto aos imports existentes de assinatura, adicionar:

```typescript
import {
  assinarVistoria,
  getVistoriaPdfAssinado,
} from './integrations/vistoriasAssinatura';
```

- [ ] **Step 3: Adicionar 2 endpoints após o `/api/vistorias/:id/pdf` existente (~linha 3081)**

```typescript
// v3.4.0: assinatura ICP-Brasil de vistorias (PF default)
app.post('/api/vistorias/:id/assinar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const perfilOverride = req.body?.perfil as 'pj' | 'pf' | undefined;
    const result = await assinarVistoria(String(req.params.id), { perfil: perfilOverride });
    res.json(result);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.4.0: baixa PDF assinado da vistoria (inline pra abrir no browser)
app.get('/api/vistorias/:id/pdf-assinado', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const data = await getVistoriaPdfAssinado(id);
    if (!data) {
      res.status(404).json({ error: 'Vistoria ainda nao foi assinada' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="vistoria-${id}-assinada.pdf"`);
    res.send(data.pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat(vto-v3.4.0): endpoints POST /vistorias/:id/assinar + GET /pdf-assinado"
```

---

## Task 6: UI — input `hora` no formulário

**Files:**
- Modify: `src/public/obras.html:4702-4711` (form-grid em `renderVto`)
- Modify: `src/public/obras.html:4733-4738` (auto-fill de data) — adicionar auto-fill de hora
- Modify: `src/public/obras.html` (~linha 4870) `addVto` handler — incluir hora no body

- [ ] **Step 1: Adicionar input hora no form-grid**

Localizar (~linha 4702):

```html
<!-- ANTES -->
<div class="form-grid">
  <input id="vData" type="date" value="...">
  <input id="vTitulo" placeholder="Título (opcional)" value="...">
  <input id="vVistoriador" placeholder="Vistoriador (engenheiro/arquiteto)" value="...">
  <select id="vStatus">...</select>
</div>
```

Substituir por:

```html
<!-- DEPOIS: form-grid com input vHora ao lado de vData -->
<div class="form-grid">
  <input id="vData" type="date" value="${editandoData ? (editandoData.data instanceof Date ? editandoData.data.toISOString().slice(0,10) : String(editandoData.data).slice(0,10)) : ''}">
  <input id="vHora" type="time" value="${editandoData?.hora ? String(editandoData.hora).slice(0,5) : ''}">
  <input id="vTitulo" placeholder="Título (opcional)" value="${escape(editandoData?.titulo || '')}">
  <input id="vVistoriador" placeholder="Vistoriador (engenheiro/arquiteto)" value="${escape(editandoData?.vistoriador || '')}">
  <select id="vStatus">
    <option value="regular" ${editandoData?.status_obra === 'regular' ? 'selected' : ''}>Status: Regular</option>
    <option value="atencao" ${editandoData?.status_obra === 'atencao' ? 'selected' : ''}>Status: Atenção</option>
    <option value="critica" ${editandoData?.status_obra === 'critica' ? 'selected' : ''}>Status: Crítica</option>
  </select>
</div>
```

- [ ] **Step 2: Auto-preencher hora ao criar nova vistoria**

Localizar (~linha 4733):

```javascript
// ANTES
if (!editandoId) document.getElementById('vData').value = today();
```

Adicionar logo após:

```javascript
// v3.4.0: auto-preenche hora atual ao criar nova vistoria
if (!editandoId) {
  document.getElementById('vData').value = today();
  const agora = new Date();
  document.getElementById('vHora').value =
    String(agora.getHours()).padStart(2,'0') + ':' + String(agora.getMinutes()).padStart(2,'0');
}
```

- [ ] **Step 3: Incluir hora no body do POST/PUT**

Localizar o handler `addVto` (~linha 4870). Encontrar onde `body` é montado pra POST/PUT. Procurar por `body.data` ou `data: document.getElementById('vData').value`.

No objeto `body`, adicionar a linha `hora`:

```javascript
const body = {
  obra_id: state.currentObra,
  data: document.getElementById('vData').value,
  hora: document.getElementById('vHora').value || null,  // v3.4.0
  titulo: document.getElementById('vTitulo').value || null,
  vistoriador: document.getElementById('vVistoriador').value || null,
  descricao: document.getElementById('vDesc').value,
  observacoes: document.getElementById('vObs').value || null,
  pendencias: document.getElementById('vPend').value || null,
  status_obra: document.getElementById('vStatus').value,
};
// ...
```

- [ ] **Step 4: Smoke test funcional**

Localmente (ou após deploy):
- Criar vistoria nova → confirmar input hora aparece preenchido com hora atual (HH:MM)
- Salvar → conferir no MySQL que coluna `hora` foi populada
- Editar vistoria existente → confirmar hora reaparece corretamente preenchida

- [ ] **Step 5: Validação viewport (DOD)**

Chrome DevTools → 360×800: input hora visível no form-grid, sem clipping.
Trocar para 412×915: idem.

- [ ] **Step 6: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(vto-v3.4.0): UI input hora com auto-fill + persiste no POST/PUT"
```

---

## Task 7: UI — thumbnails 200×200 com grid responsivo

**Files:**
- Modify: `src/public/obras.html:4683-4689` (bloco `fotosPreview`)

- [ ] **Step 1: Substituir fotosPreview por versão maior**

Localizar (linha ~4683):

```javascript
// ANTES
const fotosPreview = state.vtoFotos.map((f, i) => `
  <div style="position:relative; display:inline-block; margin:4px;">
    <img src="data:${f.mime};base64,${f.data_base64}" style="width:80px; height:80px; object-fit:cover; border-radius:4px; border:1px solid var(--border-strong);">
    <input data-leg="${i}" placeholder="Legenda" value="${escape(f.legenda||'')}" style="display:block; width:80px; font-size:10px; padding:2px 4px; margin-top:2px;">
    <button data-rm-foto="${i}" style="position:absolute; top:-6px; right:-6px; width:18px; height:18px; padding:0; border-radius:50%; background:var(--danger); color:white; border:none; cursor:pointer; font-size:10px;">×</button>
  </div>
`).join('');
```

Substituir por:

```javascript
// DEPOIS: thumbnails 200x200 em grid responsivo, click abre lightbox
const fotosPreview = state.vtoFotos.map((f, i) => `
  <div style="position:relative;">
    <img src="data:${f.mime};base64,${f.data_base64}"
         data-foto-zoom="${i}"
         style="width:100%; height:200px; object-fit:cover; border-radius:6px; border:1px solid var(--border-strong); cursor:zoom-in;">
    <input data-leg="${i}" placeholder="Legenda da foto" value="${escape(f.legenda||'')}"
           style="display:block; width:100%; font-size:11px; padding:4px 6px; margin-top:4px;">
    <button data-rm-foto="${i}"
            style="position:absolute; top:6px; right:6px; width:24px; height:24px; padding:0; border-radius:50%; background:var(--danger); color:white; border:none; cursor:pointer; font-size:14px; line-height:1;">×</button>
  </div>
`).join('');
```

- [ ] **Step 2: Trocar wrapper do fotosPreview pra usar grid responsivo**

Localizar (linha ~4723):

```javascript
// ANTES
${state.vtoFotos.length > 0 ? `<div style="margin-bottom:12px;">${fotosPreview}</div>` : ''}
```

Substituir por:

```javascript
// DEPOIS: grid responsivo da v3.3.0 (.lp-grid-auto)
${state.vtoFotos.length > 0 ? `<div class="lp-grid-auto" style="margin-bottom:12px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">${fotosPreview}</div>` : ''}
```

(Override do grid-template-columns inline pra usar 200px minmax — `.lp-grid-auto` default usa 140px, mas pra fotos 200px fica melhor.)

- [ ] **Step 3: Validação viewport (DOD)**

DevTools 360×800 + 412×915 + 1280×800 (desktop):
- Thumbnails de 200×200 visíveis
- Grid colapsa pra 1 col em mobile (lp-grid-auto + safety net v3.3.0)
- Botão X (24×24) tocável (≥44px com hit area)
- Legenda input abaixo do thumbnail

- [ ] **Step 4: Commit (parcial — lightbox vem na Task 8)**

Não commitar ainda — combinar com Task 8 (lightbox) pra entregar a feature completa.

---

## Task 8: UI — lightbox modal com navegação

**Files:**
- Modify: `src/public/obras.html` — adicionar HTML do lightbox no fim de `renderVto`
- Modify: `src/public/obras.html` — adicionar JS handlers para zoom + navegação + close

- [ ] **Step 1: Adicionar HTML do lightbox modal**

No fim do template literal de `renderVto` (depois do botão Salvar, antes do `</section>` ou similar — buscar `'<p class="section-title">Vistorias da obra'`), adicionar:

```javascript
// Antes da linha `<p class="section-title" style="margin-top:16px;">Vistorias da obra...`
${state.vtoFotos.length > 0 ? `
  <div id="vto-lightbox" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:1000; align-items:center; justify-content:center; flex-direction:column; padding:20px;">
    <button id="vto-lightbox-close" style="position:absolute; top:16px; right:16px; width:44px; height:44px; padding:0; background:rgba(255,255,255,0.1); color:white; border:none; border-radius:50%; cursor:pointer; font-size:22px; line-height:1;">×</button>
    <button id="vto-lightbox-prev" style="position:absolute; left:16px; top:50%; transform:translateY(-50%); width:44px; height:44px; padding:0; background:rgba(255,255,255,0.1); color:white; border:none; border-radius:50%; cursor:pointer; font-size:22px;">‹</button>
    <button id="vto-lightbox-next" style="position:absolute; right:16px; top:50%; transform:translateY(-50%); width:44px; height:44px; padding:0; background:rgba(255,255,255,0.1); color:white; border:none; border-radius:50%; cursor:pointer; font-size:22px;">›</button>
    <img id="vto-lightbox-img" src="" style="max-width:90vw; max-height:80vh; object-fit:contain; touch-action:pinch-zoom;">
    <div id="vto-lightbox-caption" style="color:white; font-size:13px; margin-top:12px; text-align:center; max-width:90vw;"></div>
  </div>
` : ''}
```

- [ ] **Step 2: Adicionar JS handlers**

No final do `renderVto` (depois do `attachSel()` e handlers existentes, antes do fechamento da função), adicionar:

```javascript
// v3.4.0: Lightbox handlers
(function setupLightbox() {
  const lb = document.getElementById('vto-lightbox');
  if (!lb) return;

  let idxAtual = 0;

  function abrir(idx) {
    if (!state.vtoFotos[idx]) return;
    idxAtual = idx;
    const f = state.vtoFotos[idx];
    document.getElementById('vto-lightbox-img').src = `data:${f.mime};base64,${f.data_base64}`;
    document.getElementById('vto-lightbox-caption').textContent =
      `Foto ${idx + 1} de ${state.vtoFotos.length}${f.legenda ? ' — ' + f.legenda : ''}`;
    lb.style.display = 'flex';
  }

  function fechar() {
    lb.style.display = 'none';
  }

  function navegar(delta) {
    const novoIdx = (idxAtual + delta + state.vtoFotos.length) % state.vtoFotos.length;
    abrir(novoIdx);
  }

  // Click no thumbnail abre lightbox
  document.querySelectorAll('[data-foto-zoom]').forEach(img => {
    img.onclick = () => abrir(parseInt(img.dataset.fotoZoom));
  });

  // Botões do lightbox
  document.getElementById('vto-lightbox-close').onclick = fechar;
  document.getElementById('vto-lightbox-prev').onclick = () => navegar(-1);
  document.getElementById('vto-lightbox-next').onclick = () => navegar(1);

  // Click no overlay (fora da imagem) fecha
  lb.onclick = e => { if (e.target === lb) fechar(); };

  // ESC fecha
  function onKey(e) {
    if (lb.style.display === 'none') return;
    if (e.key === 'Escape') fechar();
    else if (e.key === 'ArrowLeft') navegar(-1);
    else if (e.key === 'ArrowRight') navegar(1);
  }
  document.addEventListener('keydown', onKey);
})();
```

- [ ] **Step 3: Validação funcional**

Localmente:
- Capturar 2-3 fotos via "📷 Adicionar fotos" (em DevTools mobile com mock GPS, ou em produção depois do deploy)
- Click numa thumbnail → lightbox abre com foto grande
- Click em ‹ ou › → navega para foto anterior/próxima
- ESC → fecha
- Click fora da imagem (no overlay preto) → fecha
- Click no X → fecha
- Carimbo GPS embutido legível na imagem grande

- [ ] **Step 4: Validação viewport (DOD)**

DevTools 360×800 + 412×915:
- Lightbox cobre viewport todo
- Imagem ≤90vw / 80vh (cabe na tela)
- Botões ‹ × › têm 44×44px (tocáveis)

- [ ] **Step 5: Commit Tasks 7+8 juntas**

```bash
git add src/public/obras.html
git commit -m "feat(vto-v3.4.0): thumbnails 200x200 em grid responsivo + lightbox modal com navegacao"
```

---

## Task 9: UI — botão Assinar + badge Assinada + botão PDF Assinado

**Files:**
- Modify: `src/public/obras.html:4655-4680` (card de vistoria na lista)
- Modify: `src/public/obras.html` (handlers de botões — adicionar `data-assinar-vto` e `data-pdf-assinado-vto`)

- [ ] **Step 1: Modificar render do card pra exibir status assinado + botões**

Localizar (linha ~4655) o map de `state.vistorias`:

```javascript
// ANTES
const lista = state.vistorias.map(vis => {
  const sb = { regular:'badge-success', atencao:'badge-warning', critica:'badge-danger' }[vis.status_obra] || 'badge-info';
  return `<div class="card">
    <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start; flex-wrap:wrap;">
      <div style="flex:1; min-width:200px;">
        ...
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; min-width:230px;">
        <input data-tel-vto="${vis.id}" placeholder="WhatsApp...">
        <div style="display:flex; gap:4px; flex-wrap:wrap;">
          <button data-view-vto="${vis.id}">👁 Ver</button>
          <button data-pdf-vto="${vis.id}">📄 PDF</button>
          <button data-send-vto="${vis.id}">📱 Enviar</button>
        </div>
        <div style="display:flex; gap:4px;">
          <button data-tele-vto="${vis.id}">✈️ Telegram</button>
          <button data-edit-vto="${vis.id}">✏️ Editar</button>
          <button class="btn-danger" data-del-vto="${vis.id}">Excluir</button>
        </div>
      </div>
    </div>
  </div>`;
}).join('');
```

Modificar pra incluir status de assinatura + botões Assinar / PDF Assinado:

```javascript
// DEPOIS
const lista = state.vistorias.map(vis => {
  const sb = { regular:'badge-success', atencao:'badge-warning', critica:'badge-danger' }[vis.status_obra] || 'badge-info';
  const assinada = !!vis.assinado;
  const dataAssStr = vis.assinado_em
    ? new Date(vis.assinado_em).toLocaleDateString('pt-BR')
    : null;

  // Botao principal: Assinar (1a vez) ou Re-assinar (substitui)
  const btnAssinarLabel = assinada ? '🔄 Re-assinar' : '🔏 Assinar';

  // Badge de status assinatura (mostra so quando ja assinada)
  const badgeAssinada = assinada
    ? `<span class="badge badge-success" style="font-size:10px;">✅ Assinada em ${dataAssStr}</span>`
    : '';

  return `<div class="card">
    <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start; flex-wrap:wrap;">
      <div style="flex:1; min-width:200px;">
        <p style="margin:0; font-weight:600;">${escape(vis.titulo || 'Vistoria #' + vis.id)}</p>
        <p style="margin:4px 0; font-size:12px; color:var(--text-muted);">
          ${escape(vis.data)}${vis.hora ? ' as ' + String(vis.hora).slice(0,5) : ''} · ${escape(vis.vistoriador||'-')}
          ${vis.qtd_fotos > 0 ? ` · 📷 ${vis.qtd_fotos} foto${vis.qtd_fotos>1?'s':''}` : ''}
        </p>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <span class="badge ${sb}">${escape(vis.status_obra)}</span>
          ${badgeAssinada}
        </div>
        <p style="margin:6px 0 0; font-size:12px; color:var(--text-muted);">${escape((vis.descricao||'').slice(0,150))}${(vis.descricao||'').length>150?'…':''}</p>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; min-width:230px;">
        <input data-tel-vto="${vis.id}" placeholder="WhatsApp (ex: 5598...)" value="${escape(obraTel)}" style="font-size:12px; padding:6px 8px;">
        <div style="display:flex; gap:4px; flex-wrap:wrap;">
          <button data-view-vto="${vis.id}" title="Visualizar HTML" style="flex:1; min-width:70px;">👁 Ver</button>
          <button data-pdf-vto="${vis.id}" title="Baixar PDF (rascunho, sem assinatura)" style="flex:1; min-width:70px;">📄 PDF</button>
          ${assinada ? `<button data-pdf-assinado-vto="${vis.id}" title="Baixar PDF assinado ICP-Brasil" style="flex:1; min-width:90px; background:#10b981; color:#fff; border-color:#10b981;">🔏 PDF Assinado</button>` : ''}
          <button data-send-vto="${vis.id}" title="Enviar WhatsApp" style="flex:1; min-width:80px; background:var(--success); color:#fff; border-color:var(--success);">📱 Enviar</button>
        </div>
        <div style="display:flex; gap:4px; flex-wrap:wrap;">
          <button data-assinar-vto="${vis.id}" title="${assinada ? 'Re-assinar com cert atual' : 'Assinar digitalmente ICP-Brasil PF'}" style="flex:1; min-width:90px; background:${assinada ? '#f59e0b' : '#16a34a'}; color:#fff; border-color:${assinada ? '#f59e0b' : '#16a34a'};">${btnAssinarLabel}</button>
          <button data-tele-vto="${vis.id}" style="flex:1;">✈️ Telegram</button>
          <button data-edit-vto="${vis.id}" style="flex:1;">✏️ Editar</button>
          <button class="btn-danger" data-del-vto="${vis.id}" style="flex:1;">Excluir</button>
        </div>
      </div>
    </div>
  </div>`;
}).join('');
```

- [ ] **Step 2: Adicionar handlers JS para os 2 botões novos**

No final do `renderVto`, junto aos outros handlers `document.querySelectorAll('[data-...]').forEach(...)`, adicionar:

```javascript
// v3.4.0: Assinar / Re-assinar vistoria
document.querySelectorAll('[data-assinar-vto]').forEach(b => b.onclick = async () => {
  const id = b.dataset.assinarVto;
  if (!confirm(`Assinar vistoria #${id} digitalmente (cert PF padrao)?`)) return;
  const lbl = b.textContent;
  b.textContent = '⏳ Assinando...';
  b.disabled = true;
  try {
    const r = await fetch(`/api/vistorias/${id}/assinar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),  // perfil opcional — omite usa 'pf' default
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Falha na assinatura');
    alert(`✅ Vistoria assinada por ${data.cert.subject_cn} em ${new Date(data.assinado_em).toLocaleString('pt-BR')}`);
    await carregarVistorias();
    renderVto();
  } catch (err) {
    alert(`❌ Erro: ${err.message}`);
    b.textContent = lbl;
    b.disabled = false;
  }
});

// v3.4.0: Baixar PDF assinado
document.querySelectorAll('[data-pdf-assinado-vto]').forEach(b => b.onclick = () => {
  const id = b.dataset.pdfAssinadoVto;
  window.open(`/api/vistorias/${id}/pdf-assinado`, '_blank');
});
```

(`carregarVistorias()` é a função que repopula `state.vistorias` — buscar o nome real no código se for diferente.)

- [ ] **Step 3: Verificar nome real da função de recarga**

Run: Grep `state.vistorias = ` em `src/public/obras.html`.
Expected: encontra função tipo `loadVistorias()` ou similar.

Substituir `carregarVistorias()` no step anterior pelo nome real.

- [ ] **Step 4: Validação funcional**

Localmente ou em produção (após deploy):
- Clicar 🔏 Assinar → confirm modal → request POST → toast/alert sucesso → card atualiza com badge ✅
- Clicar 🔏 PDF Assinado → abre PDF assinado em nova aba
- Após 1ª assinatura: botão troca para 🔄 Re-assinar (laranja)
- Clicar Re-assinar → repete fluxo, sobrescreve `pdf_assinado`

- [ ] **Step 5: Validação viewport (DOD)**

DevTools 360×800 + 412×915:
- Card de vistoria com botões empilhados (lp-grid já cobre via flex-wrap)
- Badge ✅ Assinada visível e legível
- Botões com altura ≥44px (touch target)

- [ ] **Step 6: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(vto-v3.4.0): UI botao Assinar + badge Assinada + botao PDF Assinado no card"
```

---

## Task 10: Bump version em `package.json` + `identity.ts`

**Files:**
- Modify: `package.json:3`
- Modify: `src/agent/identity.ts:4`

- [ ] **Step 1: Bumpar package.json**

Editar `package.json` linha 3:
```json
"version": "3.4.0",
```

- [ ] **Step 2: Bumpar identity.ts**

Editar `src/agent/identity.ts` linha 4:
```typescript
version: '3.4.0',
```

- [ ] **Step 3: Verificar consistência intermediária**

Run:
```bash
grep -E "(\"version\":|version:|const CACHE)" package.json src/agent/identity.ts src/public/sw.js
```
Expected:
- `package.json:  "version": "3.4.0",`
- `src/agent/identity.ts:  version: '3.4.0',`
- `src/public/sw.js:const CACHE = 'zayra-v3.3.0';` ← ainda 3.3.0, será bumpado no próximo task (Task 11 — ÚLTIMO commit)

- [ ] **Step 4: Commit**

```bash
git add package.json src/agent/identity.ts
git commit -m "chore(v3.4.0): bump package.json + identity.ts para 3.4.0"
```

---

## Task 11: Bump `CACHE` em `sw.js` — ÚLTIMO COMMIT

**⚠️ ORDEM CRÍTICA:** Este commit é o ÚLTIMO. Mesma razão da v3.3.0: o bump de CACHE força clients abertos a baixar HTML/CSS/JS novo. Se este commit fosse antes dos commits 1-10, clients que abrirem entre commits pegariam HTML novo apontando para endpoints/funções que ainda não existem.

**Files:**
- Modify: `src/public/sw.js:4`

- [ ] **Step 1: Bumpar constante CACHE**

Editar `src/public/sw.js` linha 4:
```javascript
const CACHE = 'zayra-v3.4.0';
```

- [ ] **Step 2: Verificar integridade do SW**

Abrir `src/public/sw.js` e confirmar visualmente:
- Linha 4: `const CACHE = 'zayra-v3.4.0';`
- Linha 33: ainda tem `.then(() => self.skipWaiting())` no install
- Linha 42: ainda tem `await self.clients.claim();` no activate
- Linha 86-99: ainda tem o bloco network-first para HTML

Nenhum outro código no SW muda.

- [ ] **Step 3: Commit (ÚLTIMO do PR)**

```bash
git add src/public/sw.js
git commit -m "chore(v3.4.0): bump SW cache to zayra-v3.4.0 (ULTIMO commit do PR)"
```

- [ ] **Step 4: Push branch + abrir PR**

```bash
git push -u origin feat/vto-assinatura-v3.4.0
```

`gh` CLI não está disponível neste ambiente. Fornecer ao CEO:

**URL pra abrir PR:** `https://github.com/RomatecCRMWatsApp/RomatecVoiceAgent/pull/new/feat/vto-assinatura-v3.4.0`

**Título:** `v3.4.0: VTO Assinatura Digital ICP-Brasil + hora/cidade/2-fotos-por-pagina + preview lightbox`

**Body sugerido:**

```markdown
## Summary

v3.4.0 — Adiciona assinatura digital ICP-Brasil ao módulo VTO (Vistoria Técnica de Obra), seguindo padrão idêntico de Recibos/Propostas. Outras melhorias entregues no mesmo PR:

- Coluna `hora TIME` + input no form (auto-fill com hora atual)
- PDF reformatado: header com "Data e Hora", "Local" (cidade explícita); fotos passam de 1 → 2 por página (carimbo GPS preservado)
- Preview de fotos no formulário: thumbnails passam de 80×80 → 200×200, click abre lightbox modal com navegação ‹ ›
- Botões 🔏 Assinar / 🔏 PDF Assinado / 🔄 Re-assinar no card de vistoria
- Badge ✅ Assinada em DD/MM/AAAA quando vistoria já tem `pdf_assinado`

## Decisão importante: cert PF como default (não PJ)

Diferente de Recibos (PJ default — ato comercial da empresa), VTO usa cert PF (José Romário) como default — vistoria técnica é ato do profissional, mesmo padrão de ART. Override possível via body `{ perfil: 'pj' }`.

## Ordem dos commits do PR (crítica)

1. Migration (4 colunas: hora, pdf_assinado, assinatura_meta, assinado_em, assinado_por_cert_id)
2. Types + SELECT do vistorias.ts incluem hora + status assinatura
3. Módulo vistoriasAssinatura.ts + PDF com hora/cidade/2-fotos/bloco-assinatura
4. Endpoints POST /assinar + GET /pdf-assinado
5. UI input hora
6. UI thumbnails 200×200 + lightbox modal
7. UI botão Assinar + badge + botão PDF Assinado
8. Bump package.json + identity.ts
9. **Bump CACHE em sw.js (ÚLTIMO commit)**

Bump CACHE por último garante que clients abertos entre commits não peguem versão inconsistente (mesmo padrão da v3.3.0).

## Spec + Plan

- Spec: docs/superpowers/specs/2026-05-10-vto-assinatura-icp-brasil-design.md
- Plan: docs/superpowers/plans/2026-05-10-vto-assinatura-icp-brasil.md

## Test plan

### Automatizado
- [x] `npm run typecheck` passa após cada commit

### Manual (DOD — validar APÓS merge + deploy)
- [ ] Criar VTO nova → confirmar input hora auto-preenchido
- [ ] Capturar foto → confirmar thumbnail 200×200 + click abre lightbox
- [ ] Clicar 🔏 Assinar → confirmar badge ✅ aparece em ≤5s
- [ ] Baixar PDF Assinado → abrir no Adobe Reader → confirmar painel "Assinaturas" mostra **José Romário (PF)** como signatário válido
- [ ] Upload em https://validar.iti.gov.br/validar → confirmar status **VÁLIDO** padrão ICP-Brasil
- [ ] PDF renderiza 2 fotos por página (vistoria com 4 fotos = ~3 páginas: capa + assinatura + 2 fotos × 2 pgs)
- [ ] Viewport 360×800 + 412×915: layout do form, lightbox, card de vistoria, sem scroll horizontal
```

---

## Task 12: Pós-merge — validação em campo + changelog Obsidian

**Esta task NÃO tem commits no repo do código. É a finalização do ciclo.**

- [ ] **Step 1: Confirmar deploy do Railway**

Verificar no painel do Railway que v3.4.0 fez deploy com sucesso. Conferir logs:
- `[migrations:vto-v3.4.0] OK: ALTER TABLE romatec_obra_vistorias ADD COLUMN hora TIME ...` (5 colunas adicionadas)
- `ZAYRA v3.4.0 rodando`

- [ ] **Step 2: Smoke test produção pelo CEO**

CEO testa fluxo completo no rugged GNSS ou navegador:
1. Criar VTO nova com pelo menos 2 fotos
2. Confirmar campo Hora preenchido
3. Confirmar thumbnails 200×200 + lightbox funciona
4. Salvar vistoria
5. Clicar 🔏 Assinar
6. Aguardar ~3-5s
7. Confirmar badge ✅ Assinada
8. Clicar 🔏 PDF Assinado → abrir PDF
9. Conferir bloco "ASSINATURA DIGITAL" no fim do PDF
10. Conferir 2 fotos por página

- [ ] **Step 3: Validação ICP-Brasil**

Upload do PDF assinado em https://validar.iti.gov.br/validar:
- Resultado esperado: **VÁLIDO**
- Signatário: José Romário (PF)
- Issuer: cadeia AC RAIZ Brasileira (provavelmente AC SOLUTI ou similar)

Adobe Acrobat Reader:
- Abrir o PDF
- Painel lateral "Assinaturas"
- Status: "Assinatura válida"
- Detalhes do certificado conferem com o .pfx PF cadastrado

- [ ] **Step 4: Criar changelog Obsidian**

Criar arquivo `c:\Users\Ronicley Pinto\Documents\ROMATEC_AVALIEIMOB_\RomatecVoiceAgent\06-Changelog\v3.4.0-vto-assinatura-icp-brasil.md` seguindo padrão de `v3.3.0-mobile-foundation.md`. Conteúdo:

- Resumo (data, branch, PR, número de commits)
- Por quê (necessidade de assinatura digital nas vistorias)
- O que mudou (migration, módulo novo, PDF, UI)
- Decisões (PF default, blob no banco, re-assinar destrutivo)
- Validação (ICP-Brasil em validar.iti.gov.br, viewports 360/412)
- Versão

- [ ] **Step 5: Marcar ciclo como entregue**

v3.4.0 oficialmente em produção.

---

## Resumo de Commits do PR (9 commits)

1. `feat(vto-v3.4.0): migration adiciona hora + colunas de assinatura ICP-Brasil`
2. `feat(vto-v3.4.0): types+SELECT incluem hora + status assinatura`
3. `feat(vto-v3.4.0): modulo vistoriasAssinatura + PDF com hora/cidade/2-fotos-por-pagina/bloco-assinatura`
4. `feat(vto-v3.4.0): endpoints POST /vistorias/:id/assinar + GET /pdf-assinado`
5. `feat(vto-v3.4.0): UI input hora com auto-fill + persiste no POST/PUT`
6. `feat(vto-v3.4.0): thumbnails 200x200 em grid responsivo + lightbox modal com navegacao`
7. `feat(vto-v3.4.0): UI botao Assinar + badge Assinada + botao PDF Assinado no card`
8. `chore(v3.4.0): bump package.json + identity.ts para 3.4.0`
9. `chore(v3.4.0): bump SW cache to zayra-v3.4.0 (ULTIMO commit do PR)`

---

## Self-Review

**1. Spec coverage:** Cada requisito do spec mapeia pra task(s):
- Migration → Task 1 ✓
- Módulo vistoriasAssinatura → Task 3 ✓
- PDF (header + 2 fotos/pag + bloco assinatura) → Task 4 ✓
- 2 endpoints + update CRUD → Tasks 5 + 2 ✓
- UI hora → Task 6 ✓
- UI thumbnails 200×200 → Task 7 ✓
- UI lightbox → Task 8 ✓
- UI botão Assinar + badge → Task 9 ✓
- Bump versão (CACHE último) → Tasks 10 + 11 ✓
- Validação campo + ICP-Brasil + Obsidian → Task 12 ✓

**2. Placeholder scan:** Sem TBD/TODO. Steps têm código completo. Não tem "implement later" ou "add appropriate X".

**3. Type consistency:**
- `SignatureVisualMeta` exportada de `vistorias.ts` (Task 4) e importada por `vistoriasAssinatura.ts` (Task 3) — consistente
- `assinarVistoria()` retorna `AssinarVistoriaResult` em Task 3, mesmo nome usado em Task 5 endpoint
- `getVistoriaPdfAssinado()` em Task 3 idem usada em Task 5
- Coluna `hora TIME` consistente entre Task 1 (migration), Task 2 (SELECT), Task 6 (UI)
- `assinado_por_cert_id INT NULL` consistente entre Task 1 (migration) e Task 3 (UPDATE)

Plano consistente. Pronto pra execução.
