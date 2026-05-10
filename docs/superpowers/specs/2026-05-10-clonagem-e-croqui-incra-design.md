# Spec — Clonagem de Laudo + Croqui modelo INCRA (v3.1.0)

**Data:** 2026-05-10
**Versão alvo:** v3.1.0 (bump minor a partir de v3.0.5)
**Branch:** `feat/clonagem-laudo-e-croqui-incra`
**Escopo:** 1 PR único cobrindo 2 features ortogonais que serão entregues juntas. Sem merge automático — aguarda review do CEO.

---

## 1. Objetivo

Duas features no módulo Laudo de Demarcação:

**A) Clonagem de Laudo** — botão "📋 Clonar" em cada card de laudo da listagem, que cria uma cópia editável do laudo original com pontos GNSS, fotos e número do lote zerados. Usado quando o agrimensor faz múltiplas demarcações no mesmo loteamento/fazenda.

**B) Croqui modelo INCRA** — adiciona ao croqui (na UI e no PDF, urbano e rural):
- Área total renderizada no **centro do polígono**
- **Tarjeta** no canto inferior direito com SIRGAS 2000 / UTM Zona XXS / MC -XX°

## 2. Decisões arquiteturais (do brainstorming)

| Tópico | Decisão | Motivo |
|---|---|---|
| Versão | **v3.1.0** | Minor bump (feature aditiva, endpoint novo + UI) |
| Categoria do laudo | Reusar `tipo_levantamento` ENUM('URBANO_4P','URBANO_5P','URBANO_NP','RURAL') | Coluna já existe; sem migration desnecessária |
| Foco rural ao abrir clone | `denominacao_imovel` (input `la-denominacao`) | Faz sentido pra fazenda/sub-área; campo já existe |
| Visibilidade do botão Clonar | Sempre (qualquer status) | Permite clonar até rascunho como template |
| FK do clone | Sem FK formal, só índice | Padrão das migrations existentes; rastreabilidade funciona |
| Audit log | Registrar `action='laudo:clonar'` | Tabela já existe; custo zero |
| Tarjeta SIRGAS | **Mínima** — 3 linhas (SIRGAS 2000, UTM Zona, MC) | Estilo INCRA simples, urbano + rural |
| Área no centro | Sempre aparece | Sem decisão de UI complexa |
| Tempo da base no clone | Mantido + aviso amarelo + botão Resetar | Cobre os 2 cenários (mesma sessão de campo / sessão nova) |

## 3. Schema do banco

**Arquivo novo:** `src/database/migrations-clonagem-laudo.ts`

Segue o padrão das migrations existentes (`pool.execute()` em try/catch idempotente, ignorando "already exists"). Roda no boot via `runClonagemLaudoMigrations()` chamada pelo `server.ts` em IIFE paralela.

Adiciona em `laudos_demarcacao`:

```sql
ALTER TABLE laudos_demarcacao
  ADD COLUMN clonado_de_id INT NULL
    COMMENT 'ID do laudo original que foi clonado';

ALTER TABLE laudos_demarcacao
  ADD COLUMN clonado_em DATETIME NULL
    COMMENT 'Quando este laudo foi criado por clonagem';

CREATE INDEX idx_laudos_clonado_de
  ON laudos_demarcacao(clonado_de_id);
```

Sem FK formal — segue o padrão do repo (vide `migrations-laudos.ts`, `migrations-loteamentos.ts`, etc).

## 4. Service de clonagem

**Arquivo:** `src/integrations/laudos.ts` (modify — append funções no final)

### `clonarLaudo(originalId: number): Promise<Laudo>`

Transação atômica:

```typescript
export async function clonarLaudo(originalId: number): Promise<Laudo> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Carrega original (com lock pessimista pra evitar race em numero_laudo)
    const [orig] = await conn.execute<LaudoRow[]>(
      `SELECT * FROM laudos_demarcacao WHERE id = ? AND ativo = 1 FOR UPDATE`,
      [Number(originalId)],
    );
    if (!orig.length) throw new Error('Laudo nao encontrado ou inativo');
    const o = orig[0];

    // 2. Próximo numero_laudo (mesma função usada pelo POST /api/laudos-demarcacao)
    const novoNumero = await gerarNumeroLaudoComConn(conn);
    const novoUuid = crypto.randomUUID();

    // 3. INSERT com colunas selecionadas — copia tudo exceto identidade/estado
    const camposCopiar = [
      'tipo_imovel', 'tipo_lote_urbano', 'tipo_levantamento',
      'contratante_id', 'executante_id',
      'quadra', 'loteamento', 'numero_contrato',
      'denominacao_imovel', 'nirf', 'ccir',
      'endereco_imovel', 'municipio', 'uf_imovel', 'comarca',
      'descricao_area', // contratante (copia)
      'confrontante_frente', 'confrontante_lat_dir', 'confrontante_lat_esq',
      'confrontante_fundo', 'confrontante_extra',
      'croqui_tipo', 'croqui_path', 'croqui_b64', 'croqui_mime', 'escala',
      'usa_art', 'numero_art', 'usa_trt', 'numero_trt',
      'sistema_coord', 'azimute_manual',
      'base_nome', 'base_inicio_rastreio', 'base_fim_rastreio', 'base_observacoes',
      'rover_nome', 'coletor_nome',
      'matricula', 'livro', 'folhas', 'cartorio_nome', 'cartorio_cns',
      'lote_loteamento_id',
      // Precificação INCRA (v3.0.0) — também copia
      'unidade_calculo', 'pont_vegetacao', 'pont_relevo', 'pont_insalubridade',
      'pont_acesso', 'pont_clima', 'pont_area_media',
      'pontuacao_total', 'faixa_aplicada',
      'valor_unitario', 'quantidade_calculo', 'valor_base_calculado',
      'desconto_tipo', 'desconto_valor', 'valor_final',
      'precificacao_observacoes', 'precificacao_calculada_em',
      'valor_servico', 'forma_pagamento',
    ];

    // Constrói SQL dinamicamente com base em camposCopiar
    const placeholders = camposCopiar.map(() => '?').join(',');
    const values = camposCopiar.map(c => o[c] ?? null);

    const [insertResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO laudos_demarcacao
         (numero_laudo, token_uuid, status, ${camposCopiar.join(',')},
          numero_lote, area_total_m2, perimetro_m,
          clonado_de_id, clonado_em,
          ativo, created_at, updated_at)
       VALUES (?, ?, 'PREENCHIDO', ${placeholders},
          NULL, NULL, NULL,
          ?, NOW(),
          1, NOW(), NOW())`,
      [novoNumero, novoUuid, ...values, Number(originalId)],
    );
    const cloneId = insertResult.insertId;

    // 4. Pontos zerados conforme tipo_levantamento
    const pontos = construirPontosZerados(String(o.tipo_levantamento), cloneId);
    if (pontos.length > 0) {
      const ph = pontos.map(() => '(?, ?, ?)').join(',');
      const flat = pontos.flatMap(p => [p.laudo_id, p.ordem, p.rotulo]);
      await conn.execute(
        `INSERT INTO laudos_demarcacao_pontos (laudo_id, ordem, rotulo) VALUES ${ph}`,
        flat,
      );
    }

    // 5. Lados pré-preenchidos com confrontantes do lote (se houver)
    if (o.lote_loteamento_id != null) {
      const lados = await prePopularLadosDoLote(conn, Number(o.lote_loteamento_id), cloneId);
      if (lados.length > 0) {
        const ph = lados.map(() => '(?, ?, ?, ?, ?)').join(',');
        const flat = lados.flatMap(l =>
          [l.laudo_id, l.ordem, l.rotulo, l.confrontante_nome, l.nome_lado]);
        await conn.execute(
          `INSERT INTO laudos_demarcacao_lados
             (laudo_id, ordem, rotulo, confrontante_nome, nome_lado)
           VALUES ${ph}`,
          flat,
        );
      }
    }

    // 6. Audit log
    await conn.execute(
      `INSERT INTO audit_log (action, resource_type, resource_id, payload)
       VALUES ('laudo:clonar', 'laudo', ?, ?)`,
      [String(originalId), JSON.stringify({
        novo_id: cloneId,
        novo_numero: novoNumero,
        tipo_levantamento: o.tipo_levantamento,
      })],
    );

    await conn.commit();

    // Carrega o clone completo pra retornar
    const clone = await buscarLaudo(cloneId);
    if (!clone) throw new Error('Erro ao carregar clone recem-criado');
    return clone;
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}
```

### Helpers

```typescript
function construirPontosZerados(
  tipo: string,
  laudoId: number,
): Array<{ laudo_id: number; ordem: number; rotulo: string }> {
  switch (tipo) {
    case 'URBANO_4P':
      return [1,2,3,4].map(n => ({ laudo_id: laudoId, ordem: n, rotulo: `V${n}` }));
    case 'URBANO_5P':
      return [1,2,3,4,5].map(n => ({ laudo_id: laudoId, ordem: n, rotulo: `V${n}` }));
    case 'URBANO_NP':
    case 'RURAL':
      return [{ laudo_id: laudoId, ordem: 1, rotulo: 'V1' }]; // incremental
    default:
      return [];
  }
}

async function prePopularLadosDoLote(
  conn: PoolConnection,
  loteId: number,
  novoLaudoId: number,
): Promise<Array<{ laudo_id: number; ordem: number; rotulo: string;
                  confrontante_nome: string | null; nome_lado: string | null }>> {
  // Busca o lote no loteamento, com FKs resolvidas dos confrontantes
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT conf_frente_texto, conf_fundo_texto, conf_lateral_dir_texto, conf_lateral_esq_texto,
            conf_frente_lote_id, conf_fundo_lote_id, conf_lateral_dir_lote_id, conf_lateral_esq_lote_id
       FROM loteamento_lotes WHERE id = ? LIMIT 1`,
    [Number(loteId)],
  );
  if (!rows.length) return [];
  const r = rows[0];

  // Resolve FKs em texto (busca o numero_lote do confrontante referenciado)
  const resolverFk = async (fkId: number | null): Promise<string | null> => {
    if (!fkId) return null;
    const [r2] = await conn.execute<RowDataPacket[]>(
      `SELECT numero_lote FROM loteamento_lotes WHERE id = ? LIMIT 1`, [fkId],
    );
    return r2.length ? `Lote ${r2[0].numero_lote}` : null;
  };

  const conf_frente = r.conf_frente_texto || (await resolverFk(r.conf_frente_lote_id));
  const conf_fundo = r.conf_fundo_texto || (await resolverFk(r.conf_fundo_lote_id));
  const conf_lat_dir = r.conf_lateral_dir_texto || (await resolverFk(r.conf_lateral_dir_lote_id));
  const conf_lat_esq = r.conf_lateral_esq_texto || (await resolverFk(r.conf_lateral_esq_lote_id));

  return [
    { laudo_id: novoLaudoId, ordem: 1, rotulo: 'V1-V2', nome_lado: 'Frente',     confrontante_nome: conf_frente },
    { laudo_id: novoLaudoId, ordem: 2, rotulo: 'V2-V3', nome_lado: 'Lateral Dir', confrontante_nome: conf_lat_dir },
    { laudo_id: novoLaudoId, ordem: 3, rotulo: 'V3-V4', nome_lado: 'Fundo',      confrontante_nome: conf_fundo },
    { laudo_id: novoLaudoId, ordem: 4, rotulo: 'V4-V1', nome_lado: 'Lateral Esq', confrontante_nome: conf_lat_esq },
  ];
}
```

`gerarNumeroLaudoComConn(conn)` é variante de `gerarNumeroLaudo()` que usa a conexão da transação (pra respeitar o lock pessimista). Implementação espelha a existente, apenas trocando `pool.execute` por `conn.execute`.

## 5. Endpoint REST

**Arquivo:** `src/server.ts` (modify — adicionar perto dos outros endpoints `/api/laudos-demarcacao/*`)

```typescript
// v3.1.0: clonagem de laudo
app.post('/api/laudos-demarcacao/:id/clonar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    const clone = await m.clonarLaudo(id);
    res.json(clone);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
```

E IIFE no boot pra rodar a migration:

```typescript
// v3.1.0: migrations da clonagem (clonado_de_id + clonado_em)
void (async () => {
  try {
    const m = await import('./database/migrations-clonagem-laudo');
    await m.runClonagemLaudoMigrations();
  } catch (err) {
    console.error('[clonagem-laudo-migrations] FALHA fatal:', err);
  }
})();
```

Inserir após o IIFE de `runPrecificacaoIncraMigrations()` (v3.0.0).

## 6. UI — `obras.html`

### 6.1 Botão "📋 Clonar" no card

Em `renderLaudosLista` (linha ~13409), adicionar terceira linha de botões com Clonar:

```javascript
<div style="display:flex; gap:4px; flex-wrap:wrap;">
  <button data-laudo-clonar="${l.id}" title="Criar uma cópia editável deste laudo (zera pontos, fotos e número do lote)"
          style="flex:1; background:transparent; color:var(--gold); border:1px dashed var(--gold);">
    📋 Clonar
  </button>
</div>
```

Posição: entre o bloco de PDF/Assinar e o bloco de Recibo (sempre visível).

Handler:

```javascript
v.querySelectorAll('[data-laudo-clonar]').forEach(b => b.onclick = async () => {
  if (!confirm(`Clonar este laudo?\n\n✓ Cliente, loteamento, equipamentos, técnico copiados\n✗ Número do lote ficará vazio (preencher do novo lote)\n✗ Pontos GNSS zerados (rastrear novamente)\n✗ Fotos não copiadas\n⚠️ Tempo da base virá copiado — confirme em campo se é a mesma sessão`)) return;
  try {
    const clone = await api('/api/laudos-demarcacao/' + b.dataset.laudoClonar + '/clonar', {
      method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
    });
    alert('✓ Laudo clonado de ' + (state.laudosLista?.find(x => String(x.id) === b.dataset.laudoClonar)?.numero_laudo || '?') + '\nNovo: ' + clone.numero_laudo);
    await loadLaudoDetalhe(clone.id);
    state.laudosView = 'editor';
    state.laudoEditorTab = 'dados';
    renderLaudos();
    setTimeout(() => {
      const targetId = clone.tipo_imovel === 'RURAL' ? 'la-denominacao' : 'la-numero-lote';
      const el = document.getElementById(targetId);
      if (el) { el.focus(); el.select?.(); }
    }, 200);
  } catch (err) { alert('Erro ao clonar: ' + err.message); }
});
```

### 6.2 Aviso "tempo da base herdado" no clone

Em `renderLaudoTabDados()` (ou onde aparece o card "Base GNSS"), adicionar quando `l.clonado_de_id != null && l.base_inicio_rastreio`:

```html
<div style="background:rgba(217,119,6,0.08); border-left:3px solid #d97706; padding:8px 12px; border-radius:4px; margin:8px 0; font-size:12px;">
  <strong style="color:#d97706;">⚠️ Tempo da base herdado do laudo original.</strong>
  <p style="margin:4px 0 8px;">
    Confirme se a base está sendo reaproveitada da mesma sessão de campo.
    Caso contrário, clique em "Resetar tempo da base" para iniciar novo cronômetro.
  </p>
  <button id="lb-reset-base" style="font-size:11px; padding:4px 10px;">↺ Resetar tempo da base</button>
</div>
```

Handler do botão:

```javascript
document.getElementById('lb-reset-base')?.addEventListener('click', async () => {
  if (!confirm('Resetar tempo da base? (zera inicio_rastreio e fim_rastreio)')) return;
  try {
    await api('/api/laudos-demarcacao/' + l.id, {
      method: 'PUT',
      body: JSON.stringify({
        base_inicio_rastreio: null,
        base_fim_rastreio: null,
        base_observacoes: null,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    await loadLaudoDetalhe(l.id);
    alert('✓ Tempo da base resetado');
    renderLaudos();
  } catch (err) { alert('Erro: ' + err.message); }
});
```

(`PUT /api/laudos-demarcacao/:id` já existe e aceita esses campos.)

## 7. Croqui modelo INCRA

### 7.1 Cálculo do centroide

Para um polígono fechado de N vértices, o centroide é a média aritmética de (X, Y):

```typescript
function calcularCentroide(pontos: Array<{ utm_e: number; utm_n: number }>): { x: number; y: number } {
  const n = pontos.length;
  if (n === 0) return { x: 0, y: 0 };
  const sumX = pontos.reduce((s, p) => s + p.utm_e, 0);
  const sumY = pontos.reduce((s, p) => s + p.utm_n, 0);
  return { x: sumX / n, y: sumY / n };
}
```

(Centroide aritmético é suficiente pra polígono convexo regular. Para polígono irregular pode haver pequeno desvio, mas pra fins visuais é OK.)

### 7.2 Formato da área

```typescript
function formatarAreaParaCentro(area_m2: number, tipo_imovel: 'URBANO' | 'RURAL'): string {
  if (tipo_imovel === 'RURAL') {
    const ha = area_m2 / 10000;
    return ha.toFixed(4).replace('.', ',') + ' ha';
  }
  // URBANO: m²
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(area_m2) + ' m²';
}
```

### 7.3 Cálculo da Zona UTM e MC

A zona UTM já fica armazenada em `pontos[0].utm_zona` (coluna existente em `laudos_demarcacao_pontos`). MC (meridiano central) deriva da zona:

```typescript
// MC = -180 + (zona × 6) - 3
// Zona 23 → -180 + 138 - 3 = -45° (correto pra Açailândia)
// Zona 22 → -51°, Zona 24 → -39°, etc.
function calcularMC(zona: number): number {
  return -180 + zona * 6 - 3;
}
```

Hemisfério (N/S) também já existe em `pontos[0].utm_hemisferio`. Saída: `"UTM Zona 23S"`.

### 7.4 Renderização (front E back, mesma lógica)

**Front (`obras.html` → `gerarCroquiSvgClient`):**

Após renderizar polígono + vértices + label "Escala aprox", adicionar:

```javascript
// Área no centro
const cent = calcularCentroideSvg(pts); // converte UTM pra coords SVG
const areaTxt = formatarAreaParaCentro(area_m2, tipo_imovel);
svgFragments.push(`<text x="${cent.x}" y="${cent.y}" text-anchor="middle" dominant-baseline="middle"
  font-family="Arial, sans-serif" font-size="14" font-weight="600" fill="#222">${areaTxt}</text>`);
svgFragments.push(`<text x="${cent.x}" y="${cent.y + 16}" text-anchor="middle"
  font-family="Arial, sans-serif" font-size="9" fill="#888">ÁREA TOTAL</text>`);

// Tarjeta SIRGAS no canto inf direito
const tarjetaX = larguraPx - 110;
const tarjetaY = alturaPx - 50;
svgFragments.push(`<g>
  <rect x="${tarjetaX}" y="${tarjetaY}" width="100" height="40" fill="#fff" stroke="#888" stroke-width="0.5"/>
  <text x="${tarjetaX + 6}" y="${tarjetaY + 12}" font-family="Arial" font-size="8" font-weight="bold" fill="#222">SIRGAS 2000</text>
  <text x="${tarjetaX + 6}" y="${tarjetaY + 24}" font-family="Arial" font-size="7" fill="#444">UTM Zona ${zona}${hemisferio}</text>
  <text x="${tarjetaX + 6}" y="${tarjetaY + 34}" font-family="Arial" font-size="7" fill="#444">MC ${mc}°</text>
</g>`);
```

**Back (`src/services/croquiSvg.ts`):**

Mesmo conceito, exportando função similar. Como o PDFKit consome esse SVG via `SVGtoPDF` (ou direto), as mudanças no `croquiSvg.ts` se propagam pro `laudoPdf.ts` automaticamente. **Não precisa mexer em `laudoPdf.ts`** se ele só chama `gerarCroquiSvg(pontos, lados)` do server.

Verificação: ler `src/services/croquiSvg.ts` no início da implementação pra confirmar a interface real e replicar a função de centroide/tarjeta lá. Se houver divergência, criar arquivo helper `src/services/croquiHelpers.ts` com `calcularCentroide`, `formatarAreaParaCentro`, `calcularMC` — funções puras importáveis pelos dois lados.

## 8. Versionamento

- `package.json`: `3.0.5` → **`3.1.0`**
- `src/agent/identity.ts`: `3.0.5` → `3.1.0`
- `src/public/sw.js`: cache `zayra-v3.0.5` → `zayra-v3.1.0`

## 9. Testes Vitest

**Arquivo novo:** `src/integrations/laudos.test.ts` (ou modify se já existir; verificar)

Testes mínimos:

1. **Clone copia campos descritivos** mas zera `numero_lote`, `area_total_m2`, `perimetro_m`, `hash_validacao`, `pdf_assinado_blob`, etc
2. **Status do clone = `'PREENCHIDO'`** mesmo se original for `'ASSINADO'`
3. **`clonado_de_id` populado** com ID do original; `clonado_em` setado com NOW()
4. **`numero_laudo` é novo** (próximo da sequência, formato `LAUDO-YYYY-NNNN`)
5. **`tipo_levantamento='URBANO_4P'`** → 4 pontos zerados (V1..V4); `'URBANO_5P'` → 5 pontos; `'URBANO_NP'` e `'RURAL'` → só V1
6. **Pontos zerados** têm `utm_e`, `utm_n` NULL e `tempo_rastreio_seg` NULL
7. **`tempo_base` herdado** — `base_inicio_rastreio`, `base_fim_rastreio`, `base_observacoes` copiados
8. **`lote_loteamento_id` preservado**; `numero_lote` zerado (FK + identidade)
9. **Fotos NÃO copiadas** — query em `laudos_demarcacao_fotos WHERE laudo_id = clone.id` retorna 0
10. **Pré-popula lados com confrontantes** — se `lote_loteamento_id` existe e o lote tem `conf_*_texto` ou `conf_*_lote_id`, o clone tem 4 lados criados com `confrontante_nome` populado e `distancia_m` NULL
11. **Audit log** — registro com `action='laudo:clonar'`, `resource_id=originalId`, `payload.novo_id=cloneId`

Para o croqui, testes de helper puro:

12. **`calcularCentroide`** retorna média aritmética correta de pontos
13. **`formatarAreaParaCentro(195300, 'RURAL')`** = `"19,5300 ha"`
14. **`formatarAreaParaCentro(1500, 'URBANO')`** = `"1.500,00 m²"`
15. **`calcularMC(23)`** = `-45`; `calcularMC(22)` = `-51`

Comando: `npx vitest run src/integrations/laudos.test.ts` deve passar.

## 10. Critérios de aceite

- [ ] Migration roda em ambiente limpo, idempotente (re-execução sem erros)
- [ ] Botão "📋 Clonar" aparece em **todos** os cards da listagem (qualquer status)
- [ ] `confirm()` antes de clonar com mensagem clara do que copia/zera
- [ ] Após clone: redireciona pra editor + foco em `la-numero-lote` (urbano) ou `la-denominacao` (rural)
- [ ] Status do clone = `'PREENCHIDO'`
- [ ] Pontos do clone zerados conforme `tipo_levantamento`
- [ ] Lados do clone pré-preenchidos com confrontantes (se `lote_loteamento_id` existir)
- [ ] Aviso amarelo "tempo da base herdado" só aparece se `clonado_de_id != null`
- [ ] Botão "Resetar tempo da base" funciona (zera 3 campos via PUT)
- [ ] Audit log registra cada clonagem
- [ ] Croqui mostra área no centro do polígono — formato `19,5300 ha` (rural) ou `1.500,00 m²` (urbano)
- [ ] Tarjeta SIRGAS no canto inf direito do croqui — 3 linhas (SIRGAS 2000 / UTM Zona XXS / MC -XX°)
- [ ] Mudanças visuais no croqui aparecem **tanto na UI quanto no PDF** (front + back consistentes)
- [ ] `npm run typecheck` limpo
- [ ] `npx vitest run` 100% passing
- [ ] PR aberto, **NÃO mergeado**

## 11. Pontos de atenção

1. **`gerarNumeroLaudoComConn`** — se a função existente `gerarNumeroLaudo()` já aceita conn opcional, reusar. Senão, criar variante.
2. **Audit log payload JSON** — o repo usa `tenant_id` em `audit_log`. Se houver default ou for nullable, OK. Verificar na implementação.
3. **`crypto.randomUUID()`** está disponível no Node 22 (versão do projeto). OK.
4. **Pré-popular lados** — função busca confrontantes do `loteamento_lotes`. Se o lote não existir mais (apagado), fail silently (return [] em vez de throw).
5. **Croqui front/back consistente** — risco de drift TS↔JS similar à v3.0.0 INCRA. Considerar extrair helpers puros (`calcularCentroide`, `formatarAreaParaCentro`, `calcularMC`) num único arquivo TS importável pelo back, e duplicar manualmente no JS do front com teste de paridade — OU mexer só em `croquiSvg.ts` (back) e `gerarCroquiSvgClient` (front, em `obras.html`) garantindo lógica espelhada e testando manualmente. **Decisão:** sem teste de paridade nesta rodada — o croqui é tarefa visual, não cálculo crítico. Inspeção visual (PDF gerado vs UI) é suficiente.
6. **Foto da base** — feature pendente, não-bloqueante. Quando implementada, NÃO clonar (mesma motivação dos pontos GNSS).
7. **Soft delete do original** — se `ativo=0`, o clone permanece independente. `clonado_de_id` aponta pra registro inativo, mas isso é OK pra rastreabilidade.
