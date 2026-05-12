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
import time
from pathlib import Path

try:
    import ezdxf
    from shapely.geometry import Polygon, Point
    from shapely.strtree import STRtree
except ImportError as e:
    print(json.dumps({
        'erro': 'dependencia_ausente',
        'detalhe': str(e),
        'pip': 'pip install ezdxf shapely',
    }), file=sys.stderr)
    sys.exit(2)


def log_diag(msg: str) -> None:
    """Diagnóstico no stderr (não compete com stdout do JSON de resposta)."""
    print(f'[parse-dxf] {msg}', file=sys.stderr, flush=True)

# Layers reconhecidos por convenção (case-insensitive, contains)
PADROES_QUADRA = ('quadra', 'block', 'qd')
PADROES_LOTE = ('lote', 'lot')


def eh_layer_quadra(name: str) -> bool:
    n = name.lower()
    return any(p in n for p in PADROES_QUADRA)


def eh_layer_lote(name: str) -> bool:
    n = name.lower()
    return any(p in n for p in PADROES_LOTE)


def coletar_textos(msp) -> list:
    """Retorna lista de textos com posição, layer e conteúdo."""
    out = []
    for ent in msp.query('TEXT MTEXT'):
        try:
            insert = ent.dxf.insert
            txt = ent.plain_text() if hasattr(ent, 'plain_text') else ent.dxf.text
            out.append({
                'x': float(insert.x),
                'y': float(insert.y),
                'texto': str(txt).strip(),
                'layer': ent.dxf.layer,
            })
        except (AttributeError, ValueError):
            continue
    return out


class GridIndexTextos:
    """Index espacial simples (grid-bucket) pra acelerar busca do texto mais
    próximo. Substitui o O(N) linear original — pra DXFs reais com milhares
    de TEXT/MTEXT isso é a diferença entre 60s e <1s.

    Mantém 2 grids: um filtrado por layers de quadra, outro por lotes.
    Fallback pro grid global quando o filtrado está vazio na vizinhança.
    """

    def __init__(self, textos: list, cell_size: float = 30.0):
        self.cell = cell_size
        self.global_buckets = {}
        self.quadra_buckets = {}
        self.lote_buckets = {}
        self.todos = textos
        for t in textos:
            key = (int(t['x'] // cell_size), int(t['y'] // cell_size))
            self.global_buckets.setdefault(key, []).append(t)
            if eh_layer_quadra(t['layer']):
                self.quadra_buckets.setdefault(key, []).append(t)
            elif eh_layer_lote(t['layer']):
                self.lote_buckets.setdefault(key, []).append(t)

    def nearest(self, x: float, y: float, categoria: str = '') -> str:
        if categoria == 'quadra':
            buckets = self.quadra_buckets
        elif categoria == 'lote':
            buckets = self.lote_buckets
        else:
            buckets = self.global_buckets

        # Procura em raio crescente (1 célula, depois 2, depois 3, depois fallback global)
        cx = int(x // self.cell)
        cy = int(y // self.cell)
        for r in (1, 2, 3):
            candidatos = []
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    candidatos.extend(buckets.get((cx + dx, cy + dy), []))
            if candidatos:
                melhor = min(candidatos, key=lambda t: (t['x'] - x) ** 2 + (t['y'] - y) ** 2)
                return melhor['texto']

        # Fallback: se o grid filtrado por categoria não tem nada perto, usa global
        if buckets is not self.global_buckets:
            return self._nearest_no_grid(x, y, self.todos)
        return ''

    @staticmethod
    def _nearest_no_grid(x: float, y: float, textos: list) -> str:
        if not textos:
            return ''
        melhor = min(textos, key=lambda t: (t['x'] - x) ** 2 + (t['y'] - y) ** 2)
        return melhor['texto']


def extrair_poligonos(msp) -> list:
    """Lê LWPOLYLINE fechadas."""
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


def main(argv: list) -> int:
    if len(argv) != 2:
        print(json.dumps({'erro': 'uso', 'detalhe': 'parse_loteamento_dxf.py <arquivo.dxf>'}), file=sys.stderr)
        return 64

    dxf_file = Path(argv[1])
    if not dxf_file.exists():
        print(json.dumps({'erro': 'arquivo_nao_existe', 'path': str(dxf_file)}), file=sys.stderr)
        return 66

    t_inicio = time.time()
    try:
        doc = ezdxf.readfile(str(dxf_file))
    except ezdxf.DXFStructureError as e:
        print(json.dumps({'erro': 'dxf_invalido', 'detalhe': str(e)}), file=sys.stderr)
        return 65
    log_diag(f'DXF lido em {time.time() - t_inicio:.2f}s')

    msp = doc.modelspace()

    t = time.time()
    polys = extrair_poligonos(msp)
    log_diag(f'{len(polys)} poligonos extraidos em {time.time() - t:.2f}s')

    t = time.time()
    textos = coletar_textos(msp)
    log_diag(f'{len(textos)} textos coletados em {time.time() - t:.2f}s')

    t = time.time()
    idx_textos = GridIndexTextos(textos)
    log_diag(f'index espacial montado em {time.time() - t:.2f}s')

    quadras_raw = []
    lotes_raw = []
    t = time.time()
    for p in polys:
        if eh_layer_quadra(p['layer']):
            categoria = 'quadra'
        elif eh_layer_lote(p['layer']):
            categoria = 'lote'
        elif p['area_m2'] >= 500:
            categoria = 'quadra'
        else:
            categoria = 'lote'
        cx, cy = p['centroide']
        label = idx_textos.nearest(cx, cy, categoria)
        if categoria == 'quadra':
            quadras_raw.append({**p, 'label': label})
        else:
            lotes_raw.append({**p, 'label': label})
    log_diag(f'labels pareados ({len(quadras_raw)}Q + {len(lotes_raw)}L) em {time.time() - t:.2f}s')

    # Para cada lote, inferir quadra-pai via ponto-em-polígono usando STRtree
    # (R-tree espacial — query rápida mesmo com 1000+ quadras).
    t = time.time()
    if quadras_raw:
        quadra_shapes = [q['shapely'] for q in quadras_raw]
        tree = STRtree(quadra_shapes)
        # Mapa id(shape) -> quadra_raw, pra recuperar o label depois da query
        idx_para_quadra = {i: q for i, q in enumerate(quadras_raw)}
        for l in lotes_raw:
            cx, cy = l['centroide']
            pt = Point(cx, cy)
            l['quadra_label'] = ''
            # shapely 2.x STRtree.query retorna ndarray de índices
            candidatos_idx = tree.query(pt)
            for idx in candidatos_idx:
                idx_int = int(idx)
                q = idx_para_quadra[idx_int]
                if q['shapely'].contains(pt) or q['shapely'].touches(pt):
                    l['quadra_label'] = q['label']
                    break
    else:
        for l in lotes_raw:
            l['quadra_label'] = ''
    log_diag(f'quadra-pai dos lotes inferida em {time.time() - t:.2f}s')

    def serializa(item, prefix, idx):
        base = {
            'dxf_id': f'{prefix}-{item.get("quadra_label", "")}-{item["label"] or idx}'.strip('-'),
            'label': item['label'],
            'layer': item['layer'],
            'coords': [[round(x, 4), round(y, 4)] for x, y in item['coords']],
            'area_m2': round(item['area_m2'], 2),
            'centroide': {
                'x': round(item['centroide'][0], 4),
                'y': round(item['centroide'][1], 4),
            },
        }
        if prefix == 'L':
            base['quadra_label'] = item['quadra_label']
        return base

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
