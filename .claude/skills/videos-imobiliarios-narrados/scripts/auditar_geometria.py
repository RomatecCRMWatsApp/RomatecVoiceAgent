#!/usr/bin/env python3
"""Audite a geometria retangular recebida por JSON.

Uso exato::

    python3 scripts/auditar_geometria.py --config caminho/config.json

O contrato exige ``lote`` e ``chacara`` com ``largura_m``, ``comprimento_m``
e ``area_anunciada_m2`` positivos e finitos. A área é sempre calculada como
largura × comprimento; a ferramenta não infere dimensões definitivas de uma
unidade apenas a partir de uma área anunciada. ``preco_texto`` é apenas texto
copiado sem normalização e pode ser ``null``.

Campos opcionais aceitos pelo renderizador (documentados também no script de
renderização) não alteram a auditoria: ``subtitulo``, ``mostrar_dimensoes``,
``mostrar_areas``, ``mostrar_badge`` e ``badge_texto``.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any


REQUIRED_TOP_LEVEL = ("marca", "titulo", "duracao_s", "fps", "rodape")
SECTIONS = ("lote", "chacara")


class ConfigError(ValueError):
    """Erro de contrato de configuração, reportável em JSON."""


def _reject_json_constant(value: str) -> None:
    raise ConfigError(f"valor JSON não finito não permitido: {value}")


def load_config(path: Path) -> dict[str, Any]:
    """Leia um JSON UTF-8 e recuse NaN/Infinity antes da validação."""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError(f"não foi possível ler config: {exc}") from exc
    try:
        value = json.loads(raw, parse_constant=_reject_json_constant)
    except ConfigError:
        raise
    except json.JSONDecodeError as exc:
        raise ConfigError(f"JSON inválido na linha {exc.lineno}, coluna {exc.colno}: {exc.msg}") from exc
    if not isinstance(value, dict):
        raise ConfigError("a configuração JSON deve ser um objeto")
    return value


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _finite_positive(value: Any, field: str, errors: list[str]) -> float | None:
    if not _is_number(value):
        errors.append(f"{field}: esperado número finito positivo")
        return None
    number = float(value)
    if not math.isfinite(number):
        errors.append(f"{field}: NaN/Infinity não permitido")
        return None
    if number <= 0:
        errors.append(f"{field}: deve ser maior que zero")
        return None
    return number


def _finite_nonnegative(value: Any, field: str, errors: list[str]) -> float | None:
    if not _is_number(value):
        errors.append(f"{field}: esperado número finito positivo")
        return None
    number = float(value)
    if not math.isfinite(number):
        errors.append(f"{field}: NaN/Infinity não permitido")
        return None
    if number <= 0:
        errors.append(f"{field}: deve ser maior que zero")
        return None
    return number


def _string(value: Any, field: str, errors: list[str], *, allow_empty: bool = False) -> str | None:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        errors.append(f"{field}: esperado texto não vazio")
        return None
    return value


def _validate_optional_price(section: dict[str, Any], field: str, errors: list[str]) -> None:
    if field in section and section[field] is not None and not isinstance(section[field], str):
        errors.append(f"{field}: esperado texto ou null")


def audit_config(config: dict[str, Any]) -> dict[str, Any]:
    """Retorne um relatório determinístico, sem lançar para erros de contrato."""
    errors: list[str] = []
    calculated: dict[str, float | None] = {}
    evidence: list[dict[str, Any]] = []

    for field in REQUIRED_TOP_LEVEL:
        if field not in config:
            errors.append(f"{field}: campo obrigatório ausente")

    for field in ("marca", "titulo", "rodape"):
        if field in config:
            _string(config[field], field, errors)

    duration = _finite_positive(config.get("duracao_s"), "duracao_s", errors) if "duracao_s" in config else None
    fps = _finite_positive(config.get("fps"), "fps", errors) if "fps" in config else None
    if fps is not None and not fps.is_integer():
        errors.append("fps: deve ser um número inteiro positivo")

    for section_name in SECTIONS:
        section = config.get(section_name)
        if not isinstance(section, dict):
            errors.append(f"{section_name}: objeto obrigatório")
            calculated[section_name] = None
            evidence.append({
                "secao": section_name,
                "correto": False,
                "erro": "objeto ausente ou inválido",
            })
            continue

        _string(section.get("rotulo"), f"{section_name}.rotulo", errors)
        width = _finite_positive(section.get("largura_m"), f"{section_name}.largura_m", errors)
        length = _finite_positive(section.get("comprimento_m"), f"{section_name}.comprimento_m", errors)
        announced = _finite_nonnegative(section.get("area_anunciada_m2"), f"{section_name}.area_anunciada_m2", errors)
        _validate_optional_price(section, f"{section_name}.preco_texto", errors)

        area: float | None = None
        if width is not None and length is not None:
            area = width * length
            if not math.isfinite(area) or area <= 0:
                errors.append(f"{section_name}: área calculada não finita ou não positiva")
                area = None
        calculated[section_name] = area

        matches = False
        difference: float | None = None
        if area is not None and announced is not None:
            difference = announced - area
            matches = math.isclose(announced, area, rel_tol=1e-9, abs_tol=1e-6)
            if not matches:
                errors.append(
                    f"{section_name}.area_anunciada_m2: mismatch; anunciada={announced:g}, calculada={area:g}"
                )
        else:
            errors.append(f"{section_name}: impossível comparar área anunciada e calculada")

        evidence.append({
            "secao": section_name,
            "campo": f"{section_name}.area_anunciada_m2",
            "largura_m": width,
            "comprimento_m": length,
            "area_anunciada_m2": announced,
            "area_calculada_m2": area,
            "diferenca_m2": difference,
            "correto": matches,
            "regra": "area_calculada_m2 = largura_m × comprimento_m",
        })

    ratio: float | None = None
    if calculated["lote"] is not None and calculated["chacara"] is not None:
        ratio = calculated["chacara"] / calculated["lote"]
        if not math.isfinite(ratio) or ratio <= 0:
            errors.append("relacao_areas: resultado não finito ou não positivo")
            ratio = None

    # Include the key facts even when invalid so callers receive useful JSON.
    report: dict[str, Any] = {
        "correto": not errors,
        "areas_calculadas_m2": calculated,
        "relacao_areas": ratio,
        "evidencias": evidence,
    }
    if duration is not None:
        report["duracao_s"] = duration
    if fps is not None:
        report["fps"] = int(fps) if fps.is_integer() else fps
    if errors:
        report["erros"] = errors
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audita áreas retangulares de uma configuração JSON.")
    parser.add_argument("--config", required=True, type=Path, help="caminho para o JSON de configuração")
    args = parser.parse_args(argv)

    try:
        config = load_config(args.config)
        report = audit_config(config)
    except ConfigError as exc:
        report = {
            "correto": False,
            "areas_calculadas_m2": {"lote": None, "chacara": None},
            "relacao_areas": None,
            "evidencias": [],
            "erros": [str(exc)],
        }

    print(json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2))
    return 0 if report["correto"] else 1


if __name__ == "__main__":
    sys.exit(main())
