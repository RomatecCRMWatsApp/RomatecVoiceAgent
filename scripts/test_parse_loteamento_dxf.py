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


def test_decodifica_unicode_escape():
    """\\U+00C7 deve virar 'Ç' no label da quadra."""
    import sys as _sys
    _sys.path.insert(0, str(SCRIPT.parent))
    from parse_loteamento_dxf import decodificar_escape_unicode
    assert decodificar_escape_unicode(r'\U+00C7AILANDIA') == 'ÇAILANDIA'
    assert decodificar_escape_unicode(r'A\U+00C1B') == 'AÁB'
    assert decodificar_escape_unicode('sem escape') == 'sem escape'
    assert decodificar_escape_unicode('') == ''


def test_blacklist_label_quadra():
    """Labels claramente não-quadra devem ser rejeitados."""
    import sys as _sys
    _sys.path.insert(0, str(SCRIPT.parent))
    from parse_loteamento_dxf import eh_label_de_quadra_real
    assert eh_label_de_quadra_real('Q. 01') is True
    assert eh_label_de_quadra_real('QUADRA 5') is True
    assert eh_label_de_quadra_real('Q-15') is True
    assert eh_label_de_quadra_real('PRANCHA:') is False
    assert eh_label_de_quadra_real('RESIDENCIAL AÇAILANDIA') is False
    assert eh_label_de_quadra_real('APM 02') is False
    assert eh_label_de_quadra_real('A.V. 01') is False
    assert eh_label_de_quadra_real('ÁREA DE PRESERVAÇÃO PERMANENTE - APP') is False
    assert eh_label_de_quadra_real('MEIO-FIO') is False


def test_quadra_grande_descartada(tmp_path):
    """Polígono > 50.000 m² (5 ha) não deve virar quadra mesmo no layer QUADRAS."""
    p = tmp_path / 'gigante.dxf'
    doc = ezdxf.new('R2018')
    msp = doc.modelspace()
    doc.layers.add('QUADRAS')
    # Setor de 1km x 1km = 1.000.000 m² (100 ha) — claramente não é quadra
    msp.add_lwpolyline(
        [(0, 0), (1000, 0), (1000, 1000), (0, 1000)],
        close=True,
        dxfattribs={'layer': 'QUADRAS'},
    )
    msp.add_text('SETOR-1', dxfattribs={'layer': 'QUADRAS', 'insert': (500, 500)})
    doc.saveas(str(p))
    out = rodar_parser(p)
    assert len(out['quadras']) == 0, 'polígono gigante não deveria virar quadra'


def test_lote_dentro_de_duas_quadras_pega_menor(tmp_path):
    """Quando lote está dentro de quadra real E de setor maior, escolhe a menor."""
    p = tmp_path / 'aninhado.dxf'
    doc = ezdxf.new('R2018')
    msp = doc.modelspace()
    doc.layers.add('QUADRAS')
    doc.layers.add('LOTES')
    # Setor envolvente — vai ser descartado por área se for grande demais.
    # Aqui forçamos um tamanho intermediário (~ 40k m²) que passa no filtro
    # de área mas é maior que a quadra interna (apenas 600m²).
    msp.add_lwpolyline(
        [(0, 0), (200, 0), (200, 200), (0, 200)],
        close=True,
        dxfattribs={'layer': 'QUADRAS'},
    )
    msp.add_text('SETOR-A', dxfattribs={'layer': 'QUADRAS', 'insert': (100, 195)})
    # Quadra real menor (30x20 = 600m²)
    msp.add_lwpolyline(
        [(50, 50), (80, 50), (80, 70), (50, 70)],
        close=True,
        dxfattribs={'layer': 'QUADRAS'},
    )
    msp.add_text('Q. 01', dxfattribs={'layer': 'QUADRAS', 'insert': (65, 60)})
    # Lote dentro da Q. 01 (consequentemente também dentro do SETOR-A)
    msp.add_lwpolyline(
        [(55, 55), (65, 55), (65, 65), (55, 65)],
        close=True,
        dxfattribs={'layer': 'LOTES'},
    )
    msp.add_text('1', dxfattribs={'layer': 'LOTES', 'insert': (60, 60)})
    doc.saveas(str(p))
    out = rodar_parser(p)
    # 2 quadras detectadas
    assert len(out['quadras']) == 2
    # Lote deve apontar pra Q. 01 (menor), não pra SETOR-A
    assert len(out['lotes']) == 1
    assert out['lotes'][0]['quadra_label'] == 'Q. 01', \
        f"esperava Q. 01, veio {out['lotes'][0]['quadra_label']}"
