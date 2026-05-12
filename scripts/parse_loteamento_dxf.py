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


def label_proximo(centroide, textos: list, categoria: str = '') -> str:
    """Texto mais próximo do centroide.

    Se `categoria` ('quadra'|'lote') é dado, filtra textos pelo layer
    compatível — evita colar label de quadra em lote (e vice-versa)
    quando os centroides coincidem.
    """
    if not textos:
        return ''
    filtrados = textos
    if categoria == 'quadra':
        filtrados = [t for t in textos if eh_layer_quadra(t['layer'])]
    elif categoria == 'lote':
        filtrados = [t for t in textos if eh_layer_lote(t['layer'])]
    if not filtrados:
        filtrados = textos
    cx, cy = centroide
    melhor = min(filtrados, key=lambda t: (t['x'] - cx) ** 2 + (t['y'] - cy) ** 2)
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
        if eh_layer_quadra(p['layer']):
            categoria = 'quadra'
        elif eh_layer_lote(p['layer']):
            categoria = 'lote'
        elif p['area_m2'] >= 500:
            categoria = 'quadra'
        else:
            categoria = 'lote'
        label = label_proximo(p['centroide'], textos, categoria)
        if categoria == 'quadra':
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
