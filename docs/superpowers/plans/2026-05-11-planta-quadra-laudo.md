# Planta da Quadra no Laudo — Implementation Plan (v3.6.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embutir automaticamente a planta da quadra com o lote-objeto destacado em laudos de demarcação urbana, a partir de DXF do loteamento importado uma única vez e mapeado a quadras/lotes já cadastrados.

**Architecture:** DXF → Python `ezdxf` extrai polígonos (BLOCK/HATCH/LWPOLYLINE) → Node wrapper recebe JSON → serviço puro casa com `loteamento_quadras`/`loteamento_lotes` existentes → técnico aprova via UI → grava GeoJSON em colunas novas → `laudoPdf.ts` chama renderer SVG puro com guarda tripla (`URBANO` + `lote_id` + geometria) → nova seção embutida no PDF.

**Tech Stack:** Node 22 + TypeScript + Express 4 + MySQL2 + multer + vitest. Python 3 + ezdxf + shapely (subprocess server-side). proj4 já presente para reprojeção. Sem deps novas no Node.

**Branch:** `feat/planta-quadra-laudo-v3.6.0` (já criada)

**Spec:** `docs/superpowers/specs/2026-05-11-planta-quadra-laudo-design.md`

---

## File Structure

**Criar:**
- `scripts/parse_loteamento_dxf.py` — parser standalone Python (ezdxf + shapely)
- `scripts/test_parse_loteamento_dxf.py` — pytest do parser
- `scripts/fixtures/colina-mini.dxf` — fixture DXF (1 quadra + 3 lotes) gerada com ezdxf
- `src/services/parserDxfPython.ts` — wrapper Node do subprocess Python
- `src/services/parserDxfPython.test.ts` — vitest com mock de child_process
- `src/services/mapearDxfQuadras.ts` — pura, match heurístico DXF↔cadastro
- `src/services/mapearDxfQuadras.test.ts` — vitest, 6 casos
- `src/services/plantaQuadraSvg.ts` — render SVG puro (bbox, escala, destaque)
- `src/services/plantaQuadraSvg.test.ts` — vitest, snapshot

**Modificar:**
- `src/database/migrations-loteamentos.ts` — 2 ALTER TABLE ADD COLUMN
- `src/integrations/loteamentos.ts` — 3 funções novas + tipos
- `src/server.ts` — 2 endpoints novos
- `src/services/laudoPdf.ts` — nova seção após o croqui atual, com guarda tripla
- `src/services/laudoPdf.test.ts` — adicionar/criar testes da guarda (se arquivo não existe, criar)
- `src/public/obras.html` — modal "Vincular DXF" na tela de detalhe do loteamento
- `package.json` — bump 3.5.4 → 3.6.0
- `src/agent/identity.ts` — bump versão
- `src/public/sw.js` — bump cache `zayra-v3.5.4` → `zayra-v3.6.0`

**Vault Obsidian (último commit do PR):**
- `C:/Users/Ronicley Pinto/Documents/ROMATEC_AVALIEIMOB_/RomatecVoiceAgent/06-Changelog/v3.6.0-planta-quadra-laudo.md`

---

## Task 1: Migração — colunas `geometria_geojson`

**Files:**
- Modify: `src/database/migrations-loteamentos.ts:118-126` (adicionar ops no array)

- [ ] **Step 1: Adicionar 2 ALTER TABLE no array de migrations**

Editar `src/database/migrations-loteamentos.ts`, dentro de `runLoteamentosMigrations()`, adicionar dois itens ao final do `ops` array antes do `for`:

```typescript
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'loteamentos', sql: CREATE_LOTEAMENTOS },
    { label: 'loteamento_ruas', sql: CREATE_LOTEAMENTO_RUAS },
    { label: 'loteamento_quadras', sql: CREATE_LOTEAMENTO_QUADRAS },
    { label: 'loteamento_lotes', sql: CREATE_LOTEAMENTO_LOTES },
    { label: 'configuracoes_demarcacao', sql: CREATE_CONFIGURACOES_DEMARCACAO },
    { label: 'seed: config global default', sql: SEED_CONFIG },
    { label: 'ALTER quadra geometria_geojson', sql: 'ALTER TABLE loteamento_quadras ADD COLUMN geometria_geojson TEXT NULL' },
    { label: 'ALTER lote geometria_geojson', sql: 'ALTER TABLE loteamento_lotes ADD COLUMN geometria_geojson TEXT NULL' },
  ];
```

O catch existente já trata `Duplicate column` graciosamente — re-runs são idempotentes.

- [ ] **Step 2: Type-check**

Run: `cd "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent" && npm run typecheck`
Expected: PASS sem erros.

- [ ] **Step 3: Rodar dev server pra confirmar migração aplicou**

Run: `cd "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent" && npm run dev` (deixa subir, observa log)
Expected: `[loteamentos-migrations] OK: ALTER quadra geometria_geojson` e `[loteamentos-migrations] OK: ALTER lote geometria_geojson`. Ctrl+C depois de confirmar.

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent"
git add src/database/migrations-loteamentos.ts
git commit -m "feat(planta-quadra-v3.6.0): migration adiciona geometria_geojson em quadra/lote"
```

---

## Task 2: CRUD helpers e tipos em `loteamentos.ts`

**Files:**
- Modify: `src/integrations/loteamentos.ts` (adicionar 3 funções + atualizar tipos `Quadra` e `Lote`)

- [ ] **Step 1: Localizar tipos `Quadra` e `Lote` existentes**

Run: `grep -n "interface Quadra\|interface Lote\|type Quadra\|type Lote" "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/src/integrations/loteamentos.ts"`
Anotar números de linha. Adicionar campo `geometria_geojson?: string | null` em ambos os tipos.

- [ ] **Step 2: Adicionar funções novas no final do arquivo `loteamentos.ts`**

```typescript
/** Atualiza geometria de uma quadra (idempotente). geojson é o Polygon serializado. */
export async function salvarGeometriaQuadra(id: number, geojson: string | null): Promise<void> {
  await pool.execute(
    'UPDATE loteamento_quadras SET geometria_geojson = ? WHERE id = ?',
    [geojson, id],
  );
}

/** Atualiza geometria de um lote (idempotente). */
export async function salvarGeometriaLote(id: number, geojson: string | null): Promise<void> {
  await pool.execute(
    'UPDATE loteamento_lotes SET geometria_geojson = ? WHERE id = ?',
    [geojson, id],
  );
}

/**
 * Helper para o PDF: dado um lote_id, retorna geometria do lote + da quadra
 * + lista de lotes irmãos (mesma quadra) com geometria. Retorna null se
 * qualquer parte essencial faltar (lote sem geo OU quadra sem geo).
 */
export async function carregarPlantaQuadra(loteId: number): Promise<{
  lote: { id: number; numero_lote: string; geojson: string };
  quadra: { id: number; nome: string; geojson: string };
  vizinhos: Array<{ id: number; numero_lote: string; geojson: string }>;
} | null> {
  const [loteRows] = await pool.execute(
    `SELECT l.id, l.numero_lote, l.geometria_geojson, l.quadra_id
       FROM loteamento_lotes l
      WHERE l.id = ?`,
    [loteId],
  );
  const lote = (loteRows as any[])[0];
  if (!lote || !lote.geometria_geojson) return null;

  const [quadraRows] = await pool.execute(
    `SELECT id, nome, geometria_geojson
       FROM loteamento_quadras
      WHERE id = ?`,
    [lote.quadra_id],
  );
  const quadra = (quadraRows as any[])[0];
  if (!quadra || !quadra.geometria_geojson) return null;

  const [vizRows] = await pool.execute(
    `SELECT id, numero_lote, geometria_geojson
       FROM loteamento_lotes
      WHERE quadra_id = ? AND id <> ? AND geometria_geojson IS NOT NULL`,
    [lote.quadra_id, loteId],
  );

  return {
    lote: { id: lote.id, numero_lote: lote.numero_lote, geojson: lote.geometria_geojson },
    quadra: { id: quadra.id, nome: quadra.nome, geojson: quadra.geometria_geojson },
    vizinhos: (vizRows as any[]).map(r => ({
      id: r.id,
      numero_lote: r.numero_lote,
      geojson: r.geometria_geojson,
    })),
  };
}
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/loteamentos.ts
git commit -m "feat(planta-quadra-v3.6.0): CRUD helpers para geometria + carregarPlantaQuadra"
```

---

## Task 3: Parser Python standalone

**Files:**
- Create: `scripts/parse_loteamento_dxf.py`
- Create: `scripts/test_parse_loteamento_dxf.py`
- Create: `scripts/requirements-dxf.txt`

- [ ] **Step 1: Documentar deps Python**

Criar `scripts/requirements-dxf.txt`:

```
ezdxf>=1.3
shapely>=2.0
```

Run: `pip install -r "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/scripts/requirements-dxf.txt"`
Expected: instalação OK; verificar `python -c "import ezdxf, shapely; print('ok')"`.

- [ ] **Step 2: Escrever pytest com fixture (vai falhar — script não existe)**

Criar `scripts/test_parse_loteamento_dxf.py`:

```python
"""
Testa o parser de loteamento. Gera fixture DXF em memória com ezdxf
(1 quadra retangular contendo 3 lotes lado a lado) e roda o parser.
"""
import json
import subprocess
import sys
import os
from pathlib import Path

import ezdxf
import pytest

SCRIPT = Path(__file__).parent / 'parse_loteamento_dxf.py'


def gerar_fixture(path: Path) -> None:
    """3 lotes (10x20m) lado a lado dentro de quadra (30x20m)."""
    doc = ezdxf.new('R2018')
    msp = doc.modelspace()
    # Quadra: retangulo externo no layer QUADRAS
    doc.layers.add('QUADRAS')
    doc.layers.add('LOTES')
    msp.add_lwpolyline(
        [(0, 0), (30, 0), (30, 20), (0, 20)],
        close=True,
        dxfattribs={'layer': 'QUADRAS'},
    )
    msp.add_text('Q-01', dxfattribs={'layer': 'QUADRAS', 'insert': (15, 10)})
    for i in range(3):
        x0 = i * 10
        msp.add_lwpolyline(
            [(x0, 0), (x0 + 10, 0), (x0 + 10, 20), (x0, 20)],
            close=True,
            dxfattribs={'layer': 'LOTES'},
        )
        msp.add_text(str(i + 1), dxfattribs={'layer': 'LOTES', 'insert': (x0 + 5, 10)})
    doc.saveas(str(path))


@pytest.fixture
def dxf_path(tmp_path):
    p = tmp_path / 'colina-mini.dxf'
    gerar_fixture(p)
    return p


def rodar_parser(dxf: Path) -> dict:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(dxf)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def test_extrai_uma_quadra(dxf_path):
    out = rodar_parser(dxf_path)
    assert len(out['quadras']) == 1
    assert out['quadras'][0]['label'] == 'Q-01'


def test_extrai_tres_lotes(dxf_path):
    out = rodar_parser(dxf_path)
    assert len(out['lotes']) == 3
    labels = sorted(l['label'] for l in out['lotes'])
    assert labels == ['1', '2', '3']


def test_lotes_dentro_da_quadra(dxf_path):
    out = rodar_parser(dxf_path)
    for lote in out['lotes']:
        assert lote['quadra_label'] == 'Q-01', (
            f"lote {lote['label']} deveria estar dentro de Q-01, veio {lote['quadra_label']}"
        )


def test_areas_aproximadas(dxf_path):
    out = rodar_parser(dxf_path)
    quadra = out['quadras'][0]
    assert abs(quadra['area_m2'] - 600.0) < 0.01
    for lote in out['lotes']:
        assert abs(lote['area_m2'] - 200.0) < 0.01
```

- [ ] **Step 3: Rodar pytest pra ver falha**

Run: `cd "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent" && python -m pytest scripts/test_parse_loteamento_dxf.py -v`
Expected: FAIL — script `parse_loteamento_dxf.py` ainda não existe.

- [ ] **Step 4: Implementar `parse_loteamento_dxf.py`**

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parse_loteamento_dxf.py — Parser DXF de loteamento (server-side).

Lê DXF ASCII e extrai polígonos de quadras e lotes. Cada polígono recebe
label (a partir de TEXT/MTEXT próximo), layer, centroide UTM, area_m2 e
quadra_label inferida (lotes herdam o label do polígono externo que os
contém).

Saída: JSON em stdout com schema:
  {
    "formato": "DXF",
    "unidade": "metros",
    "quadras": [
      { "dxf_id": "Q-01", "label": "Q-01", "layer": "QUADRAS",
        "coords": [[x,y], ...], "area_m2": 600.0,
        "centroide": {"x": 15, "y": 10} }
    ],
    "lotes": [
      { "dxf_id": "L-Q-01-1", "label": "1", "layer": "LOTES",
        "quadra_label": "Q-01",
        "coords": [[x,y], ...], "area_m2": 200.0,
        "centroide": {"x": 5, "y": 10} }
    ],
    "avisos": []
  }
"""
import json
import sys
from pathlib import Path
from typing import Any

try:
    import ezdxf
    from shapely.geometry import Polygon, Point
except ImportError as e:
    print(json.dumps({
        'erro': 'dependencia_ausente',
        'detalhe': str(e),
        'pip': 'pip install ezdxf shapely',
    }), file=sys.stderr)
    sys.exit(2)

# Layers reconhecidos por convenção (case-insensitive, contains)
PADROES_QUADRA = ('quadra', 'block', 'qd')
PADROES_LOTE = ('lote', 'lot')


def eh_layer_quadra(name: str) -> bool:
    n = name.lower()
    return any(p in n for p in PADROES_QUADRA)


def eh_layer_lote(name: str) -> bool:
    n = name.lower()
    return any(p in n for p in PADROES_LOTE)


def coletar_textos(msp) -> list[dict]:
    """Retorna lista de textos com posição e conteúdo."""
    out = []
    for ent in msp.query('TEXT MTEXT'):
        try:
            insert = ent.dxf.insert
            txt = ent.plain_text() if hasattr(ent, 'plain_text') else ent.dxf.text
            out.append({'x': float(insert.x), 'y': float(insert.y), 'texto': str(txt).strip()})
        except (AttributeError, ValueError):
            continue
    return out


def label_proximo(centroide: tuple[float, float], textos: list[dict]) -> str:
    """Texto mais próximo do centroide dentro do raio (estimado por bbox global)."""
    if not textos:
        return ''
    cx, cy = centroide
    melhor = min(textos, key=lambda t: (t['x'] - cx) ** 2 + (t['y'] - cy) ** 2)
    return melhor['texto']


def extrair_poligonos(msp) -> list[dict]:
    """Lê LWPOLYLINE fechadas e (futuramente) HATCH/BLOCK."""
    polys = []
    for ent in msp.query('LWPOLYLINE'):
        if not ent.closed:
            continue
        pts = [(float(p[0]), float(p[1])) for p in ent.get_points()]
        if len(pts) < 3:
            continue
        try:
            shp = Polygon(pts)
            if not shp.is_valid or shp.area < 1e-6:
                continue
            polys.append({
                'layer': ent.dxf.layer,
                'coords': pts,
                'shapely': shp,
                'area_m2': float(shp.area),
                'centroide': (float(shp.centroid.x), float(shp.centroid.y)),
            })
        except Exception:
            continue
    return polys


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(json.dumps({'erro': 'uso', 'detalhe': 'parse_loteamento_dxf.py <arquivo.dxf>'}), file=sys.stderr)
        return 64

    dxf_file = Path(argv[1])
    if not dxf_file.exists():
        print(json.dumps({'erro': 'arquivo_nao_existe', 'path': str(dxf_file)}), file=sys.stderr)
        return 66

    try:
        doc = ezdxf.readfile(str(dxf_file))
    except ezdxf.DXFStructureError as e:
        print(json.dumps({'erro': 'dxf_invalido', 'detalhe': str(e)}), file=sys.stderr)
        return 65

    msp = doc.modelspace()
    polys = extrair_poligonos(msp)
    textos = coletar_textos(msp)

    quadras_raw = []
    lotes_raw = []
    for p in polys:
        label = label_proximo(p['centroide'], textos)
        if eh_layer_quadra(p['layer']):
            quadras_raw.append({**p, 'label': label})
        elif eh_layer_lote(p['layer']):
            lotes_raw.append({**p, 'label': label})
        else:
            # heurística fallback: poligonos grandes (>500m²) viram quadra;
            # menores viram lote
            if p['area_m2'] >= 500:
                quadras_raw.append({**p, 'label': label})
            else:
                lotes_raw.append({**p, 'label': label})

    # Para cada lote, inferir quadra-pai via ponto-em-polígono
    quadras_shapely = [(q, q['shapely']) for q in quadras_raw]
    for l in lotes_raw:
        cx, cy = l['centroide']
        pt = Point(cx, cy)
        l['quadra_label'] = ''
        for q, shp in quadras_shapely:
            if shp.contains(pt) or shp.touches(pt):
                l['quadra_label'] = q['label']
                break

    def serializa(item: dict, prefix: str, idx: int) -> dict:
        return {
            'dxf_id': f'{prefix}-{item.get("quadra_label", "")}-{item["label"] or idx}'.strip('-'),
            'label': item['label'],
            'layer': item['layer'],
            'coords': [[round(x, 4), round(y, 4)] for x, y in item['coords']],
            'area_m2': round(item['area_m2'], 2),
            'centroide': {
                'x': round(item['centroide'][0], 4),
                'y': round(item['centroide'][1], 4),
            },
            **({'quadra_label': item['quadra_label']} if prefix == 'L' else {}),
        }

    out = {
        'formato': 'DXF',
        'unidade': 'metros',
        'quadras': [serializa(q, 'Q', i) for i, q in enumerate(quadras_raw)],
        'lotes': [serializa(l, 'L', i) for i, l in enumerate(lotes_raw)],
        'avisos': [],
    }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
```

- [ ] **Step 5: Rodar pytest pra ver passar**

Run: `cd "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent" && python -m pytest scripts/test_parse_loteamento_dxf.py -v`
Expected: 4 testes PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/parse_loteamento_dxf.py scripts/test_parse_loteamento_dxf.py scripts/requirements-dxf.txt
git commit -m "feat(planta-quadra-v3.6.0): parser DXF Python com ezdxf+shapely"
```

---

## Task 4: Wrapper Node do parser Python

**Files:**
- Create: `src/services/parserDxfPython.ts`
- Create: `src/services/parserDxfPython.test.ts`

- [ ] **Step 1: Escrever teste falhando**

Criar `src/services/parserDxfPython.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import * as cp from 'node:child_process';
import { parseLoteamentoDxf, DxfParseError } from './parserDxfPython';

vi.mock('node:child_process');

function fakeSpawn(stdoutData: string, stderrData = '', code = 0) {
  const ee = new EventEmitter() as cp.ChildProcess;
  (ee as any).stdout = Readable.from([stdoutData]);
  (ee as any).stderr = Readable.from([stderrData]);
  setImmediate(() => ee.emit('close', code));
  return ee;
}

describe('parseLoteamentoDxf', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna parsed JSON quando Python sai com 0', async () => {
    const payload = { formato: 'DXF', unidade: 'metros', quadras: [], lotes: [], avisos: [] };
    vi.mocked(cp.spawn).mockReturnValue(fakeSpawn(JSON.stringify(payload)));
    const r = await parseLoteamentoDxf('/tmp/foo.dxf');
    expect(r.formato).toBe('DXF');
    expect(r.quadras).toEqual([]);
  });

  it('lanca DxfParseError com codigo dependencia_ausente quando exit=2', async () => {
    const err = JSON.stringify({ erro: 'dependencia_ausente', detalhe: 'No module named ezdxf' });
    vi.mocked(cp.spawn).mockReturnValue(fakeSpawn('', err, 2));
    await expect(parseLoteamentoDxf('/tmp/foo.dxf')).rejects.toMatchObject({
      name: 'DxfParseError',
      codigo: 'dependencia_ausente',
    });
  });

  it('lanca DxfParseError generico quando stdout nao eh JSON', async () => {
    vi.mocked(cp.spawn).mockReturnValue(fakeSpawn('lixo nao-json'));
    await expect(parseLoteamentoDxf('/tmp/foo.dxf')).rejects.toMatchObject({
      name: 'DxfParseError',
      codigo: 'stdout_invalido',
    });
  });
});
```

- [ ] **Step 2: Rodar teste pra ver falhar**

Run: `cd "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent" && npx vitest run src/services/parserDxfPython.test.ts`
Expected: FAIL — arquivo não existe.

- [ ] **Step 3: Implementar `parserDxfPython.ts`**

```typescript
// src/services/parserDxfPython.ts
//
// Wrapper Node do parser DXF em Python. Subprocess one-shot.
// Limitacao: requer python3 + ezdxf + shapely instalados no host.

import { spawn } from 'node:child_process';
import { resolve as pathResolve } from 'node:path';

export interface DxfPoligono {
  dxf_id: string;
  label: string;
  layer: string;
  coords: Array<[number, number]>;
  area_m2: number;
  centroide: { x: number; y: number };
  quadra_label?: string;
}

export interface DxfReport {
  formato: 'DXF';
  unidade: 'metros';
  quadras: DxfPoligono[];
  lotes: DxfPoligono[];
  avisos: string[];
}

export type DxfErroCodigo =
  | 'dependencia_ausente'
  | 'arquivo_nao_existe'
  | 'dxf_invalido'
  | 'stdout_invalido'
  | 'timeout'
  | 'desconhecido';

export class DxfParseError extends Error {
  override name = 'DxfParseError';
  constructor(public codigo: DxfErroCodigo, public detalhe: string) {
    super(`[${codigo}] ${detalhe}`);
  }
}

const SCRIPT = pathResolve(process.cwd(), 'scripts/parse_loteamento_dxf.py');
const PYTHON = process.env.PYTHON_BIN || 'python';
const TIMEOUT_MS = 60_000;

export async function parseLoteamentoDxf(dxfPath: string): Promise<DxfReport> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [SCRIPT, dxfPath]);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new DxfParseError('timeout', `parser excedeu ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout!.on('data', d => (stdout += d.toString()));
    child.stderr!.on('data', d => (stderr += d.toString()));

    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout) as DxfReport);
        } catch {
          reject(new DxfParseError('stdout_invalido', stdout.slice(0, 200)));
        }
        return;
      }
      // tenta extrair codigo de erro do stderr (JSON one-line)
      try {
        const errObj = JSON.parse(stderr.trim().split('\n').pop() || '{}');
        const cod = (errObj.erro || 'desconhecido') as DxfErroCodigo;
        reject(new DxfParseError(cod, errObj.detalhe || stderr.slice(0, 200)));
      } catch {
        reject(new DxfParseError('desconhecido', stderr.slice(0, 200) || `exit ${code}`));
      }
    });
  });
}
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run src/services/parserDxfPython.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/parserDxfPython.ts src/services/parserDxfPython.test.ts
git commit -m "feat(planta-quadra-v3.6.0): wrapper Node do parser Python (subprocess + timeout)"
```

---

## Task 5: Matching service `mapearDxfQuadras`

**Files:**
- Create: `src/services/mapearDxfQuadras.ts`
- Create: `src/services/mapearDxfQuadras.test.ts`

- [ ] **Step 1: Escrever testes falhando**

Criar `src/services/mapearDxfQuadras.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapearDxfQuadras, normalizarLabelQuadra } from './mapearDxfQuadras';
import type { DxfReport } from './parserDxfPython';

const baseReport: DxfReport = {
  formato: 'DXF', unidade: 'metros',
  quadras: [
    { dxf_id: 'Q-1', label: 'Q-01', layer: 'QUADRAS', coords: [[0,0],[30,0],[30,20],[0,20]], area_m2: 600, centroide: { x: 15, y: 10 } },
    { dxf_id: 'Q-2', label: 'Q-99', layer: 'QUADRAS', coords: [[100,0],[130,0],[130,20],[100,20]], area_m2: 600, centroide: { x: 115, y: 10 } },
  ],
  lotes: [
    { dxf_id: 'L-1', label: '1', layer: 'LOTES', coords: [[0,0],[10,0],[10,20],[0,20]], area_m2: 200, centroide: { x: 5, y: 10 }, quadra_label: 'Q-01' },
    { dxf_id: 'L-2', label: '2', layer: 'LOTES', coords: [[10,0],[20,0],[20,20],[10,20]], area_m2: 200, centroide: { x: 15, y: 10 }, quadra_label: 'Q-01' },
  ],
  avisos: [],
};

const quadrasCad = [{ id: 100, nome: 'Q. 01' }, { id: 101, nome: 'Q. 02' }];
const lotesCad = [
  { id: 200, quadra_id: 100, numero_lote: '1' },
  { id: 201, quadra_id: 100, numero_lote: '2' },
];

describe('normalizarLabelQuadra', () => {
  it('Q-01 e Q. 01 e QUADRA 01 produzem mesma normalizacao', () => {
    expect(normalizarLabelQuadra('Q-01')).toBe('Q01');
    expect(normalizarLabelQuadra('Q. 01')).toBe('Q01');
    expect(normalizarLabelQuadra('QUADRA 01')).toBe('Q01');
    expect(normalizarLabelQuadra('  q1  ')).toBe('Q1');
  });
});

describe('mapearDxfQuadras', () => {
  it('casa quadra Q-01 (DXF) com Q. 01 (cadastro)', () => {
    const r = mapearDxfQuadras(baseReport, quadrasCad, lotesCad);
    const q1 = r.quadras.find(q => q.dxf.dxf_id === 'Q-1');
    expect(q1?.match?.id).toBe(100);
  });

  it('Q-99 fica unmapped pq nao tem correspondencia', () => {
    const r = mapearDxfQuadras(baseReport, quadrasCad, lotesCad);
    const q99 = r.quadras.find(q => q.dxf.dxf_id === 'Q-2');
    expect(q99?.match).toBeNull();
  });

  it('lotes 1 e 2 da Q-01 mapeiam aos lotes_cad 200 e 201', () => {
    const r = mapearDxfQuadras(baseReport, quadrasCad, lotesCad);
    const matches = r.lotes.filter(l => l.match !== null).map(l => l.match!.id).sort();
    expect(matches).toEqual([200, 201]);
  });

  it('lote sem quadra_label fica unmapped', () => {
    const reportSemQuadra: DxfReport = {
      ...baseReport,
      lotes: [{ ...baseReport.lotes[0], quadra_label: '' }],
    };
    const r = mapearDxfQuadras(reportSemQuadra, quadrasCad, lotesCad);
    expect(r.lotes[0].match).toBeNull();
    expect(r.lotes[0].motivo_unmapped).toContain('quadra');
  });

  it('lote com quadra cadastrada mas numero_lote nao encontrado fica unmapped', () => {
    const lotesIncompleto = [{ id: 200, quadra_id: 100, numero_lote: '5' }];
    const r = mapearDxfQuadras(baseReport, quadrasCad, lotesIncompleto);
    expect(r.lotes.every(l => l.match === null)).toBe(true);
  });

  it('relatorio agrega contagem', () => {
    const r = mapearDxfQuadras(baseReport, quadrasCad, lotesCad);
    expect(r.relatorio.quadras_matched).toBe(1);
    expect(r.relatorio.quadras_unmapped).toBe(1);
    expect(r.relatorio.lotes_matched).toBe(2);
    expect(r.relatorio.lotes_unmapped).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar testes pra ver falharem**

Run: `npx vitest run src/services/mapearDxfQuadras.test.ts`
Expected: FAIL — arquivo não existe.

- [ ] **Step 3: Implementar `mapearDxfQuadras.ts`**

```typescript
// src/services/mapearDxfQuadras.ts
//
// Casa poligonos extraidos do DXF com registros existentes em
// loteamento_quadras / loteamento_lotes (mesma tabela de v2.8.0).
// Pura. Sem I/O. Sem auto-confirmar — apenas sugere.

import type { DxfPoligono, DxfReport } from './parserDxfPython';

export interface QuadraCadastrada {
  id: number;
  nome: string;
}

export interface LoteCadastrado {
  id: number;
  quadra_id: number;
  numero_lote: string;
}

export interface MatchSugerido<T> {
  dxf: DxfPoligono;
  match: T | null;
  motivo_unmapped?: string;
}

export interface MapeamentoResultado {
  quadras: MatchSugerido<QuadraCadastrada>[];
  lotes: MatchSugerido<LoteCadastrado>[];
  relatorio: {
    quadras_matched: number;
    quadras_unmapped: number;
    lotes_matched: number;
    lotes_unmapped: number;
  };
}

/** Normaliza variantes "Q-01" "Q. 01" "QUADRA 01" "q1" para canonical "Q01". */
export function normalizarLabelQuadra(s: string): string {
  if (!s) return '';
  const cleaned = s
    .toUpperCase()
    .replace(/\bQUADRA\b/g, 'Q')
    .replace(/[^A-Z0-9]/g, '');
  return cleaned;
}

function normalizarNumeroLote(s: string): string {
  return (s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

export function mapearDxfQuadras(
  report: DxfReport,
  quadrasCad: QuadraCadastrada[],
  lotesCad: LoteCadastrado[],
): MapeamentoResultado {
  // Index quadras cadastradas por label normalizado
  const idxQuadra = new Map<string, QuadraCadastrada>();
  for (const q of quadrasCad) idxQuadra.set(normalizarLabelQuadra(q.nome), q);

  const quadras: MatchSugerido<QuadraCadastrada>[] = report.quadras.map(dxf => {
    const norm = normalizarLabelQuadra(dxf.label);
    const m = idxQuadra.get(norm);
    return m
      ? { dxf, match: m }
      : { dxf, match: null, motivo_unmapped: `nenhuma quadra cadastrada com label ${dxf.label}` };
  });

  // Mapa quadra_label_DXF → quadra_id_cadastrado, pra dar lookup rapido nos lotes
  const dxfLabelParaId = new Map<string, number>();
  for (const q of quadras) {
    if (q.match) dxfLabelParaId.set(normalizarLabelQuadra(q.dxf.label), q.match.id);
  }

  // Index lotes cadastrados por (quadra_id, numero_lote_normalizado)
  const idxLote = new Map<string, LoteCadastrado>();
  for (const l of lotesCad) {
    idxLote.set(`${l.quadra_id}::${normalizarNumeroLote(l.numero_lote)}`, l);
  }

  const lotes: MatchSugerido<LoteCadastrado>[] = report.lotes.map(dxf => {
    if (!dxf.quadra_label) {
      return { dxf, match: null, motivo_unmapped: 'lote DXF sem quadra inferida' };
    }
    const qId = dxfLabelParaId.get(normalizarLabelQuadra(dxf.quadra_label));
    if (!qId) {
      return {
        dxf,
        match: null,
        motivo_unmapped: `quadra ${dxf.quadra_label} nao mapeada`,
      };
    }
    const m = idxLote.get(`${qId}::${normalizarNumeroLote(dxf.label)}`);
    return m
      ? { dxf, match: m }
      : { dxf, match: null, motivo_unmapped: `lote ${dxf.label} nao cadastrado na quadra` };
  });

  return {
    quadras,
    lotes,
    relatorio: {
      quadras_matched: quadras.filter(q => q.match).length,
      quadras_unmapped: quadras.filter(q => !q.match).length,
      lotes_matched: lotes.filter(l => l.match).length,
      lotes_unmapped: lotes.filter(l => !l.match).length,
    },
  };
}
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run src/services/mapearDxfQuadras.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/mapearDxfQuadras.ts src/services/mapearDxfQuadras.test.ts
git commit -m "feat(planta-quadra-v3.6.0): matching heuristico DXF<->cadastro (pura, 6 casos)"
```

---

## Task 6: Endpoints `importar-dxf` e `…/confirmar`

**Files:**
- Modify: `src/server.ts` (adicionar 2 rotas perto de outros endpoints de loteamentos, ~linha 1842 onde fica `/api/laudos-demarcacao/import-arquivo`)

- [ ] **Step 1: Localizar bloco de rotas de loteamentos**

Run: `grep -n "/api/loteamentos" "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/src/server.ts"`
Anotar a primeira linha — vamos adicionar antes do bloco de rotas de laudo.

- [ ] **Step 2: Adicionar imports no topo (se faltarem)**

No topo do `server.ts`, garantir que estes existem:

```typescript
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseLoteamentoDxf, DxfParseError } from './services/parserDxfPython';
import { mapearDxfQuadras } from './services/mapearDxfQuadras';
```

Se algum já estiver presente, deixar como está.

- [ ] **Step 3: Adicionar import dos helpers de loteamentos**

Verificar o import existente de `./integrations/loteamentos` e estender pra incluir as novas:

```typescript
import {
  // ... funcoes existentes
  salvarGeometriaQuadra,
  salvarGeometriaLote,
  listarQuadras,
  listarLotesPorQuadra,
} from './integrations/loteamentos';
```

- [ ] **Step 4: Adicionar endpoint de preview (sem persistir)**

Adicionar logo após os endpoints existentes de loteamentos:

```typescript
app.post(
  '/api/loteamentos/:id/importar-dxf',
  requireCeoToken,
  upload.single('arquivo'),
  async (req: Request, res: Response) => {
    const loteamentoId = Number(req.params.id);
    if (!req.file) {
      res.status(400).json({ erro: 'arquivo ausente (multipart field: arquivo)' });
      return;
    }
    // Aceita .dxf (extension check leve — Content-Type DXF varia)
    const nome = req.file.originalname?.toLowerCase() ?? '';
    if (!nome.endsWith('.dxf')) {
      res.status(400).json({ erro: 'apenas .dxf ASCII e suportado (exporte do AutoCAD como DXF)' });
      return;
    }
    const tmpPath = pathJoin(tmpdir(), `dxf-${randomUUID()}.dxf`);
    try {
      await writeFile(tmpPath, req.file.buffer);
      const report = await parseLoteamentoDxf(tmpPath);
      // Carrega cadastro pra matching
      const quadrasCad = await listarQuadras(loteamentoId);
      // listarLotesPorQuadra pega por quadra; precisamos achatar pra todos
      const lotesCadNested = await Promise.all(
        quadrasCad.map(q => listarLotesPorQuadra(q.id).then(ls => ls.map(l => ({ ...l, quadra_id: q.id })))),
      );
      const lotesCad = lotesCadNested.flat();
      const mapping = mapearDxfQuadras(report, quadrasCad, lotesCad);
      res.json({ report, mapping });
    } catch (err) {
      if (err instanceof DxfParseError) {
        const status = err.codigo === 'dependencia_ausente' ? 503 : 400;
        res.status(status).json({ erro: err.codigo, detalhe: err.detalhe });
        return;
      }
      res.status(500).json({ erro: 'falha_interna', detalhe: (err as Error).message });
    } finally {
      await unlink(tmpPath).catch(() => undefined);
    }
  },
);
```

- [ ] **Step 5: Adicionar endpoint de confirmação (persiste GeoJSON)**

```typescript
app.post(
  '/api/loteamentos/:id/importar-dxf/confirmar',
  requireCeoToken,
  async (req: Request, res: Response) => {
    const body = req.body as {
      matches: Array<{
        tipo: 'quadra' | 'lote';
        cadastro_id: number;
        geojson: string; // string JSON com Polygon
      }>;
    };
    if (!Array.isArray(body?.matches)) {
      res.status(400).json({ erro: 'matches[] ausente' });
      return;
    }
    let quadras = 0, lotes = 0;
    for (const m of body.matches) {
      try {
        // Valida que o JSON parse e que tem type Polygon
        const parsed = JSON.parse(m.geojson);
        if (parsed?.type !== 'Polygon' || !Array.isArray(parsed.coordinates)) {
          continue;
        }
      } catch { continue; }
      if (m.tipo === 'quadra') {
        await salvarGeometriaQuadra(m.cadastro_id, m.geojson);
        quadras++;
      } else if (m.tipo === 'lote') {
        await salvarGeometriaLote(m.cadastro_id, m.geojson);
        lotes++;
      }
    }
    res.json({ quadras_atualizadas: quadras, lotes_atualizados: lotes });
  },
);
```

- [ ] **Step 6: Type-check**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Smoke test manual**

Run em terminal separado: `npm run dev`. Em outro terminal:

```bash
curl -X POST http://localhost:3000/api/loteamentos/1/importar-dxf \
  -H "Authorization: Bearer $CEO_TOKEN" \
  -F "arquivo=@scripts/fixtures/colina-mini.dxf"
```

Expected: JSON com `report.quadras[]` e `mapping.relatorio`. (Se loteamento 1 não tem cadastro, mapping.quadras_matched = 0; OK.)

- [ ] **Step 8: Commit**

```bash
git add src/server.ts
git commit -m "feat(planta-quadra-v3.6.0): endpoints importar-dxf preview + confirmar"
```

---

## Task 7: Renderer SVG `plantaQuadraSvg`

**Files:**
- Create: `src/services/plantaQuadraSvg.ts`
- Create: `src/services/plantaQuadraSvg.test.ts`

- [ ] **Step 1: Escrever testes falhando**

Criar `src/services/plantaQuadraSvg.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { plantaQuadraSvg } from './plantaQuadraSvg';

const quadraGeojson = JSON.stringify({
  type: 'Polygon',
  coordinates: [[[0,0],[30,0],[30,20],[0,20],[0,0]]],
});

function loteGj(x0: number): string {
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [[[x0,0],[x0+10,0],[x0+10,20],[x0,20],[x0,0]]],
  });
}

const lotes = [
  { id: 1, numero_lote: '1', geojson: loteGj(0), isObjeto: false },
  { id: 2, numero_lote: '2', geojson: loteGj(10), isObjeto: true },
  { id: 3, numero_lote: '3', geojson: loteGj(20), isObjeto: false },
];

describe('plantaQuadraSvg', () => {
  it('produz string SVG comecando com <svg', () => {
    const svg = plantaQuadraSvg({
      quadraNome: 'Q-01',
      quadraGeojson,
      lotes,
    });
    expect(svg).toMatch(/^<svg/);
    expect(svg).toMatch(/<\/svg>\s*$/);
  });

  it('lote-objeto recebe fill destacado e os outros sao stroke-only', () => {
    const svg = plantaQuadraSvg({ quadraNome: 'Q-01', quadraGeojson, lotes });
    const fillObjeto = svg.match(/data-lote="2"[^>]*fill="([^"]+)"/);
    const fillVizinho = svg.match(/data-lote="1"[^>]*fill="([^"]+)"/);
    expect(fillObjeto?.[1]).not.toBe('none');
    expect(fillVizinho?.[1]).toBe('none');
  });

  it('contem o nome da quadra como titulo', () => {
    const svg = plantaQuadraSvg({ quadraNome: 'Q-01', quadraGeojson, lotes });
    expect(svg).toContain('Q-01');
  });

  it('contem label de cada lote', () => {
    const svg = plantaQuadraSvg({ quadraNome: 'Q-01', quadraGeojson, lotes });
    expect(svg).toMatch(/>1<\/text>/);
    expect(svg).toMatch(/>2<\/text>/);
    expect(svg).toMatch(/>3<\/text>/);
  });

  it('viewBox abrange bbox da quadra com margem', () => {
    const svg = plantaQuadraSvg({ quadraNome: 'Q-01', quadraGeojson, lotes });
    const m = svg.match(/viewBox="([^"]+)"/);
    expect(m).toBeTruthy();
    const [minX, minY, w, h] = m![1].split(/\s+/).map(Number);
    expect(minX).toBeLessThan(0);   // margem expandiu pra esquerda
    expect(minY).toBeLessThan(0);
    expect(w).toBeGreaterThan(30);  // margem cresceu da largura original
    expect(h).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Rodar pra ver falhar**

Run: `npx vitest run src/services/plantaQuadraSvg.test.ts`
Expected: FAIL — arquivo nao existe.

- [ ] **Step 3: Implementar `plantaQuadraSvg.ts`**

```typescript
// src/services/plantaQuadraSvg.ts
//
// Render SVG puro da planta de uma quadra com o lote-objeto destacado.
// Sem deps externas. GeoJSON Polygon em UTM (metros) -> SVG com viewBox
// em mesmas unidades. PdfKit/inline pode embutir direto.

interface LoteInfo {
  id: number;
  numero_lote: string;
  geojson: string;
  isObjeto: boolean;
}

export interface PlantaQuadraInput {
  quadraNome: string;
  quadraGeojson: string;
  lotes: LoteInfo[];
}

type Ring = Array<[number, number]>;
type BBox = { minX: number; minY: number; maxX: number; maxY: number };

function lerPolygonRing(geojsonStr: string): Ring | null {
  try {
    const p = JSON.parse(geojsonStr);
    if (p?.type !== 'Polygon') return null;
    const ring = p.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    return ring as Ring;
  } catch {
    return null;
  }
}

function bboxRings(rings: Ring[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function centroide(ring: Ring): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  const n = Math.max(1, ring.length);
  return { x: sx / n, y: sy / n };
}

/**
 * Importante: SVG tem Y crescendo pra baixo, mas UTM tem Y crescendo pra
 * cima. Convertemos invertendo Y com (maxY - y) dentro da viewBox.
 */
function svgPath(ring: Ring, bb: BBox): string {
  const flip = (y: number) => bb.maxY - y + bb.minY;
  const cmds = ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${flip(y).toFixed(2)}`);
  return cmds.join(' ') + ' Z';
}

export function plantaQuadraSvg(input: PlantaQuadraInput): string {
  const quadraRing = lerPolygonRing(input.quadraGeojson);
  if (!quadraRing) return '';

  const loteRings = input.lotes
    .map(l => ({ info: l, ring: lerPolygonRing(l.geojson) }))
    .filter((x): x is { info: LoteInfo; ring: Ring } => x.ring !== null);

  const bb = bboxRings([quadraRing, ...loteRings.map(l => l.ring)]);
  const margem = Math.max((bb.maxX - bb.minX) * 0.08, 5);
  const vbMinX = bb.minX - margem;
  const vbMinY = bb.minY - margem;
  const vbW = (bb.maxX - bb.minX) + margem * 2;
  const vbH = (bb.maxY - bb.minY) + margem * 2;

  const quadraPath = svgPath(quadraRing, bb);

  const lotesXml = loteRings.map(({ info, ring }) => {
    const fill = info.isObjeto ? '#fbbf24' : 'none';
    const stroke = info.isObjeto ? '#92400e' : '#666';
    const sw = info.isObjeto ? 0.6 : 0.3;
    const c = centroide(ring);
    const flipY = bb.maxY - c.y + bb.minY;
    return [
      `<path data-lote="${info.id}" d="${svgPath(ring, bb)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
      `<text x="${c.x.toFixed(2)}" y="${flipY.toFixed(2)}" font-size="${Math.max(2, margem * 0.5).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#222">${info.numero_lote}</text>`,
    ].join('');
  }).join('');

  const titulo = `<text x="${(vbMinX + vbW / 2).toFixed(2)}" y="${(vbMinY + margem * 0.5).toFixed(2)}" font-size="${(margem * 0.7).toFixed(1)}" text-anchor="middle" font-weight="bold" fill="#111">Planta da Quadra ${escapeXml(input.quadraNome)}</text>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbMinX.toFixed(2)} ${vbMinY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}">`,
    `<path d="${quadraPath}" fill="#f3f4f6" stroke="#111" stroke-width="0.5"/>`,
    lotesXml,
    titulo,
    `</svg>`,
  ].join('');
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
}
```

- [ ] **Step 4: Rodar testes**

Run: `npx vitest run src/services/plantaQuadraSvg.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/plantaQuadraSvg.ts src/services/plantaQuadraSvg.test.ts
git commit -m "feat(planta-quadra-v3.6.0): renderer SVG puro com lote-objeto destacado"
```

---

## Task 8: Integração no PDF do laudo (com guarda tripla)

**Files:**
- Modify: `src/services/laudoPdf.ts` (nova função `secaoPlantaQuadra` + chamada com guarda)

- [ ] **Step 1: Localizar onde o croqui atual é embutido**

Run: `grep -n "croquiSvg\|gerarCroqui" "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/src/services/laudoPdf.ts"`
Anotar a linha onde o SVG do croqui é inserido — vamos adicionar **logo depois**.

- [ ] **Step 2: Adicionar imports no topo de `laudoPdf.ts`**

```typescript
import { carregarPlantaQuadra } from '../integrations/loteamentos';
import { plantaQuadraSvg } from './plantaQuadraSvg';
```

- [ ] **Step 3: Adicionar função `secaoPlantaQuadra` no `laudoPdf.ts`**

Inserir como função de módulo (acima do export principal):

```typescript
/**
 * Embute "Planta da Quadra" no PDF se a guarda tripla bater:
 *   - laudo.tipo_imovel === 'URBANO'
 *   - laudo.lote_id != null
 *   - geometria existe em quadra + lote (verificado por carregarPlantaQuadra)
 *
 * Caso contrário, retorna silenciosamente sem desenhar. Nunca lança.
 */
async function secaoPlantaQuadra(doc: PDFKit.PDFDocument, laudo: any): Promise<void> {
  if (laudo.tipo_imovel !== 'URBANO') return;
  if (!laudo.lote_id) return;
  let data;
  try {
    data = await carregarPlantaQuadra(Number(laudo.lote_id));
  } catch {
    return; // nunca quebra o PDF
  }
  if (!data) return;

  const todosLotes = [
    { id: data.lote.id, numero_lote: data.lote.numero_lote, geojson: data.lote.geojson, isObjeto: true },
    ...data.vizinhos.map(v => ({
      id: v.id, numero_lote: v.numero_lote, geojson: v.geojson, isObjeto: false,
    })),
  ];

  const svg = plantaQuadraSvg({
    quadraNome: data.quadra.nome,
    quadraGeojson: data.quadra.geojson,
    lotes: todosLotes,
  });
  if (!svg) return;

  doc.addPage();
  doc.fontSize(14).fillColor('#111').text(`Planta da Quadra — ${data.quadra.nome}`, 40, 60, {
    width: 515, align: 'center',
  });
  doc.moveDown(0.5);
  // Embute SVG via SVGtoPDF (se já usado em outros pontos) — caso contrário
  // usar svg-to-pdfkit. O projeto já embute SVG do croqui; reusar mesma utility.
  // Convencao no projeto: import SVGtoPDF from 'svg-to-pdfkit';
  // SVGtoPDF(doc, svg, 40, 100, { width: 515, preserveAspectRatio: 'xMidYMid meet' });
  // Para reusar a chamada exata, copiar do bloco do croqui.
  SVGtoPDF(doc, svg, 40, 100, { width: 515, height: 600, preserveAspectRatio: 'xMidYMid meet' });
}
```

> Nota pro implementador: verificar import de `SVGtoPDF` já existente no `laudoPdf.ts` (provavelmente `import SVGtoPDF from 'svg-to-pdfkit'`). Reusar exatamente como o croqui faz. Se o croqui usa outro helper interno (ex: `embedSvg(doc, svg, ...)`), usar o mesmo.

- [ ] **Step 4: Chamar `await secaoPlantaQuadra(doc, laudo)` logo após a seção do croqui**

Localizar no `laudoPdf.ts` o ponto onde o croqui atual termina (depois do `SVGtoPDF` do croqui). Inserir:

```typescript
await secaoPlantaQuadra(doc, laudo);
```

- [ ] **Step 5: Adicionar testes da guarda em `laudoPdf.test.ts`**

Se o arquivo não existir, criar. Se já existir, adicionar describe novo:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock carregarPlantaQuadra antes do import do laudoPdf
const mockCarregar = vi.fn();
vi.mock('../integrations/loteamentos', () => ({
  carregarPlantaQuadra: (id: number) => mockCarregar(id),
}));

describe('guarda tripla da secao Planta da Quadra', () => {
  it('rural pula sem chamar carregarPlantaQuadra', async () => {
    mockCarregar.mockReset();
    const { __testing } = await import('./laudoPdf');
    await __testing.secaoPlantaQuadra({ addPage() {}, fontSize() { return this; }, fillColor() { return this; }, text() {}, moveDown() {} } as any, { tipo_imovel: 'RURAL', lote_id: 5 });
    expect(mockCarregar).not.toHaveBeenCalled();
  });

  it('urbano sem lote_id pula', async () => {
    mockCarregar.mockReset();
    const { __testing } = await import('./laudoPdf');
    await __testing.secaoPlantaQuadra({} as any, { tipo_imovel: 'URBANO', lote_id: null });
    expect(mockCarregar).not.toHaveBeenCalled();
  });

  it('urbano com lote_id mas sem geometria pula (carregar retorna null)', async () => {
    mockCarregar.mockReset();
    mockCarregar.mockResolvedValue(null);
    const { __testing } = await import('./laudoPdf');
    await __testing.secaoPlantaQuadra({ addPage: vi.fn() } as any, { tipo_imovel: 'URBANO', lote_id: 5 });
    expect(mockCarregar).toHaveBeenCalledWith(5);
  });
});
```

> Para isso o `laudoPdf.ts` precisa exportar `secaoPlantaQuadra` via objeto interno `__testing`. Adicionar no final do `laudoPdf.ts`:
> ```typescript
> export const __testing = { secaoPlantaQuadra };
> ```

- [ ] **Step 6: Rodar testes**

Run: `npx vitest run src/services/laudoPdf.test.ts`
Expected: 3 PASS (guarda tripla).

- [ ] **Step 7: Type-check completo**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/laudoPdf.ts src/services/laudoPdf.test.ts
git commit -m "feat(planta-quadra-v3.6.0): secao 'Planta da Quadra' no PDF com guarda tripla"
```

---

## Task 9: UI modal "Vincular DXF" em `obras.html`

**Files:**
- Modify: `src/public/obras.html` (adicionar botão na tela detalhe do loteamento + modal de upload/mapeamento)

- [ ] **Step 1: Localizar tela detalhe do loteamento**

Run: `grep -n "tela-detalhe\|loteamento-detalhe\|🏘️\|Loteamentos" "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/src/public/obras.html" | head -20`
Anotar onde renderiza a lista de quadras da v2.8.0 — vamos adicionar botão "⬆️ Vincular DXF" no header da tela.

- [ ] **Step 2: Adicionar botão no header da tela detalhe**

Procurar o título da tela detalhe ("Loteamento — Colina Park" ou parecido) e adicionar ao lado:

```html
<button id="btn-vincular-dxf" class="lp-btn-secondary"
        onclick="abrirModalVincularDxf()">⬆️ Vincular DXF da Planta</button>
```

- [ ] **Step 3: Adicionar markup do modal (no final do body, antes do </body>)**

```html
<div id="modal-vincular-dxf" class="modal-overlay" style="display:none">
  <div class="modal-card">
    <div class="modal-header">
      <h3>Vincular DXF — Planta do Loteamento</h3>
      <button onclick="fecharModalVincularDxf()">×</button>
    </div>
    <div class="modal-body">
      <p style="font-size:13px;color:#555">
        Envie o <strong>.dxf ASCII</strong> exportado do AutoCAD. O sistema vai
        listar quadras e lotes detectados e pedir confirmação antes de gravar.
        DWG não é suportado direto — exporte como DXF.
      </p>
      <input type="file" id="dxf-file" accept=".dxf">
      <button id="btn-dxf-preview" onclick="enviarDxfPreview()">Analisar DXF</button>
      <div id="dxf-preview-area" style="margin-top:1em"></div>
      <button id="btn-dxf-confirmar" style="display:none" onclick="confirmarDxf()">
        💾 Gravar geometrias
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Adicionar JS handlers**

No bloco `<script>` apropriado:

```javascript
let dxfState = { report: null, mapping: null };

function abrirModalVincularDxf() {
  document.getElementById('modal-vincular-dxf').style.display = 'flex';
}
function fecharModalVincularDxf() {
  document.getElementById('modal-vincular-dxf').style.display = 'none';
  dxfState = { report: null, mapping: null };
  document.getElementById('dxf-preview-area').innerHTML = '';
  document.getElementById('btn-dxf-confirmar').style.display = 'none';
}

async function enviarDxfPreview() {
  const file = document.getElementById('dxf-file').files[0];
  if (!file) return alert('Selecione um arquivo .dxf');
  const loteamentoId = state.loteamentoSelecionadoId;
  if (!loteamentoId) return alert('Selecione um loteamento');
  const fd = new FormData();
  fd.append('arquivo', file);
  const r = await fetch(`/api/loteamentos/${loteamentoId}/importar-dxf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.ceoToken}` },
    body: fd,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    return alert(`Falha: ${e.erro || r.status} ${e.detalhe || ''}`);
  }
  const { report, mapping } = await r.json();
  dxfState = { report, mapping };
  renderPreview(mapping);
}

function renderPreview(mapping) {
  const area = document.getElementById('dxf-preview-area');
  const linhasQ = mapping.quadras.map(q => `
    <li>${q.match ? '✅' : '⚠️'} Quadra <b>${q.dxf.label}</b> (${q.dxf.area_m2} m²)
      → ${q.match ? q.match.nome : '<i>' + (q.motivo_unmapped || 'sem match') + '</i>'}
    </li>`).join('');
  const linhasL = mapping.lotes.map(l => `
    <li>${l.match ? '✅' : '⚠️'} Lote <b>${l.dxf.label}</b> da quadra ${l.dxf.quadra_label || '?'}
      → ${l.match ? `Lote ${l.match.numero_lote} (cadastro)` : '<i>' + (l.motivo_unmapped || 'sem match') + '</i>'}
    </li>`).join('');
  area.innerHTML = `
    <h4>Quadras detectadas (${mapping.relatorio.quadras_matched}/${mapping.relatorio.quadras_matched + mapping.relatorio.quadras_unmapped} mapeadas)</h4>
    <ul>${linhasQ}</ul>
    <h4>Lotes detectados (${mapping.relatorio.lotes_matched}/${mapping.relatorio.lotes_matched + mapping.relatorio.lotes_unmapped} mapeados)</h4>
    <ul>${linhasL}</ul>`;
  document.getElementById('btn-dxf-confirmar').style.display =
    (mapping.relatorio.quadras_matched + mapping.relatorio.lotes_matched) > 0 ? 'inline-block' : 'none';
}

function dxfPolyParaGeojson(coords) {
  // coords vem como [[x,y], ...] sem fechar; fecha se preciso
  const ring = coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]
    ? coords
    : [...coords, coords[0]];
  return JSON.stringify({ type: 'Polygon', coordinates: [ring] });
}

async function confirmarDxf() {
  const matches = [];
  for (const q of dxfState.mapping.quadras) {
    if (q.match) matches.push({ tipo: 'quadra', cadastro_id: q.match.id, geojson: dxfPolyParaGeojson(q.dxf.coords) });
  }
  for (const l of dxfState.mapping.lotes) {
    if (l.match) matches.push({ tipo: 'lote', cadastro_id: l.match.id, geojson: dxfPolyParaGeojson(l.dxf.coords) });
  }
  const loteamentoId = state.loteamentoSelecionadoId;
  const r = await fetch(`/api/loteamentos/${loteamentoId}/importar-dxf/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.ceoToken}` },
    body: JSON.stringify({ matches }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    return alert(`Falha: ${e.erro || r.status}`);
  }
  const out = await r.json();
  alert(`Gravado: ${out.quadras_atualizadas} quadras + ${out.lotes_atualizados} lotes`);
  fecharModalVincularDxf();
}
```

- [ ] **Step 5: Smoke test manual**

Run: `npm run dev`, abrir `http://localhost:3000/obras.html`, ir em Loteamentos → escolher um, clicar "Vincular DXF", subir `scripts/fixtures/colina-mini.dxf`.

Expected: preview mostra a quadra Q-01 e 3 lotes. Mesmo sem match (loteamento de demo provavelmente vazio), o relatório é exibido sem crash. Se houver cadastro real, confirmar grava.

- [ ] **Step 6: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(planta-quadra-v3.6.0): modal de upload DXF + preview de mapeamento"
```

---

## Task 10: Bump de versão + changelog (ÚLTIMO commit do PR)

**Files:**
- Modify: `package.json` (version)
- Modify: `src/agent/identity.ts` (version)
- Modify: `src/public/sw.js` (cache version)
- Create: `C:/Users/Ronicley Pinto/Documents/ROMATEC_AVALIEIMOB_/RomatecVoiceAgent/06-Changelog/v3.6.0-planta-quadra-laudo.md`

- [ ] **Step 1: Bump `package.json`**

Editar `version`: `"3.5.4"` → `"3.6.0"`.

- [ ] **Step 2: Bump `src/agent/identity.ts`**

Run: `grep -n "3.5.4" "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/src/agent/identity.ts"`
Trocar a string `3.5.4` por `3.6.0`.

- [ ] **Step 3: Bump cache do service worker**

Run: `grep -n "zayra-v3.5.4" "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent/src/public/sw.js"`
Trocar todas ocorrências de `zayra-v3.5.4` por `zayra-v3.6.0`.

- [ ] **Step 4: Criar changelog no vault Obsidian**

Criar `C:/Users/Ronicley Pinto/Documents/ROMATEC_AVALIEIMOB_/RomatecVoiceAgent/06-Changelog/v3.6.0-planta-quadra-laudo.md`:

```markdown
# v3.6.0 — Planta da Quadra automática no Laudo de Demarcação

**Data:** [data do merge]
**Origem:** Pedido do CEO — laudo urbano de loteamento cadastrado deve mostrar a planta da quadra com o lote-objeto destacado, sem trabalho manual.

## Por quê
Antes, o técnico tinha que abrir o DWG do loteamento em CAD, recortar a quadra, anexar print. Agora: 1 upload de DXF do loteamento inteiro, mapeia uma vez, e todo laudo daquele loteamento ganha a planta automaticamente.

## O que mudou
- **Parser DXF Python** (`scripts/parse_loteamento_dxf.py`) extrai polígonos de quadras e lotes via ezdxf + shapely
- **Wrapper Node** `src/services/parserDxfPython.ts` chama o subprocess com timeout
- **Match heurístico** `src/services/mapearDxfQuadras.ts` normaliza labels (Q-01 ≡ Q. 01 ≡ QUADRA 01) e sugere o casamento DXF↔cadastro
- **2 endpoints novos**: `POST /api/loteamentos/:id/importar-dxf` (preview) e `…/confirmar` (grava)
- **2 colunas novas**: `loteamento_quadras.geometria_geojson` e `loteamento_lotes.geometria_geojson`
- **Renderer SVG** `src/services/plantaQuadraSvg.ts` com lote-objeto preenchido e vizinhos em stroke
- **Nova seção no PDF do laudo** após o croqui, condicional à **guarda tripla**: `URBANO + lote_id + geometria`
- **Modal UI** em `obras.html` para subir DXF e revisar mapeamento

## Restrição importante
Aplica APENAS a laudos:
1. `tipo_imovel === 'URBANO'`
2. Com `lote_id` setado (lote vinculado a um loteamento cadastrado v2.8.0)
3. Cujo loteamento tem DXF já mapeado

Faltando qualquer condição → seção é omitida silenciosamente. Rural nunca recebe.

## Limitações conhecidas
- DXF binário e DWG nativo não suportados — exporte como DXF ASCII no AutoCAD
- Heurística de detecção: layers que contêm "QUADRA"/"LOTE" no nome funcionam direto; outros caem no fallback por área (>500m² = quadra, menor = lote)
- Sem reprojeção entre zonas UTM — loteamento inteiro deve estar numa única zona
- Requer Python 3 + ezdxf + shapely instalados no host de produção (Railway)

## Versão
- `package.json`: 3.5.4 → **3.6.0**
- `src/agent/identity.ts`: 3.5.4 → 3.6.0
- `src/public/sw.js`: `zayra-v3.5.4` → `zayra-v3.6.0`
- Deps novas Node: nenhuma (puro JS pro SVG)
- Deps Python: `ezdxf>=1.3`, `shapely>=2.0`
```

- [ ] **Step 5: Type-check final**

Run: `npm run typecheck && npx vitest run`
Expected: PASS em tudo.

- [ ] **Step 6: Commit final (ÚLTIMO do PR)**

```bash
git add package.json src/agent/identity.ts src/public/sw.js
git commit -m "chore(v3.6.0): bump versao + cache SW para planta-quadra-laudo"

git add "C:/Users/Ronicley Pinto/Documents/ROMATEC_AVALIEIMOB_/RomatecVoiceAgent/06-Changelog/v3.6.0-planta-quadra-laudo.md"
git commit -m "docs(v3.6.0): changelog Obsidian — planta-quadra-laudo"
```

(O changelog fica em outro repo/vault — o commit separado é só por convenção do projeto.)

---

## Resumo de testes esperados ao final

| Arquivo | Casos |
|---|---|
| `scripts/test_parse_loteamento_dxf.py` | 4 |
| `src/services/parserDxfPython.test.ts` | 3 |
| `src/services/mapearDxfQuadras.test.ts` | 6 |
| `src/services/plantaQuadraSvg.test.ts` | 5 |
| `src/services/laudoPdf.test.ts` (guarda) | 3 |
| **Total novo** | **21** |

Mais smoke tests manuais: upload do DXF de fixture pelo UI, gerar um laudo URBANO com `lote_id` vinculado, verificar que a página "Planta da Quadra" sai no PDF.

---

## Riscos a observar durante execução

1. **Python ausente em Railway** — antes de mergear, validar que o host tem `python3 -c "import ezdxf"` rodando. Sem isso, endpoint cai em 503. Pode ser necessário um Dockerfile com `RUN pip install -r scripts/requirements-dxf.txt`.
2. **Helper de embed SVG no PDFKit** — verificar se o projeto usa `svg-to-pdfkit` import direto ou um wrapper interno. A Task 8 assume `SVGtoPDF(doc, svg, x, y, opts)`; ajustar se a convenção do `laudoPdf.ts` for outra.
3. **DXF do CEO em layers fora do padrão** — primeira fixture real (Colina Park) pode revelar que os polígonos estão em HATCH/BLOCK em vez de LWPOLYLINE. Se sim, estender o parser Python pra ler `INSERT` + `HATCH` (não está no MVP mas é fácil de adicionar — ezdxf cobre).
4. **Lotes com cadastro mas nome desviado** — `LOTE 1A` no DXF vs `1` na tabela. Normalização atual ignora não-alfanumérico mas mantém letras — `1A` ≠ `1`. Se for problema, relaxar via fuzzy match ou pedir CEO pra padronizar nomes na importação CSV inicial.
