"""
Testa o parser de loteamento. Gera fixture DXF em memória com ezdxf
(1 quadra retangular contendo 3 lotes lado a lado) e roda o parser.
"""
import json
import subprocess
import sys
from pathlib import Path

import ezdxf
import pytest

SCRIPT = Path(__file__).parent / 'parse_loteamento_dxf.py'


def gerar_fixture(path: Path) -> None:
    """3 lotes (10x20m) lado a lado dentro de quadra (30x20m)."""
    doc = ezdxf.new('R2018')
    msp = doc.modelspace()
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
