#!/usr/bin/env python3
"""Renderize a comparação geométrica parametrizada da skill.

Uso exato::

    python3 scripts/render_geometria.py --config caminho/config.json --output saida.mp4
    python3 scripts/render_geometria.py --config caminho/config.json --output saida.mp4 \
        --preview-dir pasta/previews [--overwrite]

O HTML, as fontes e o restante dos recursos são descobertos a partir de
``Path(__file__)``; nenhum caminho da sessão de desenvolvimento é necessário.
O script valida o contrato com ``auditar_geometria.py`` antes de abrir o
Playwright. Playwright/Chromium e FFmpeg são dependências opcionais do ambiente
do usuário e, quando ausentes, o erro informa como instalá-las.

Campos opcionais aceitos além do contrato principal:

* ``subtitulo``: substitui a linha auxiliar sob o título;
* ``mostrar_dimensoes``, ``mostrar_areas`` e ``mostrar_badge``: booleanos;
* ``badge_texto``: texto opcional do badge; por padrão, quando a relação
  calculada é maior que 10, o texto gerado é ``Mais de 10× a área``.

As formas são sempre retângulos. A escala de pixels por metro é calculada uma
vez para as duas formas e as áreas exibidas vêm do JSON auditado. O
``preco_texto`` é desenhado literalmente, sem preço embutido ou atualização
inventada.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright
except ImportError as exc:  # pragma: no cover - exercised on dependency failure
    PlaywrightError = RuntimeError  # type: ignore[assignment,misc]
    sync_playwright = None  # type: ignore[assignment]
    _PLAYWRIGHT_IMPORT_ERROR = exc
else:
    _PLAYWRIGHT_IMPORT_ERROR = None

try:
    from auditar_geometria import ConfigError, audit_config, load_config
except ImportError as exc:  # pragma: no cover - only if moved outside scripts/
    raise SystemExit(f"Não foi possível carregar o auditor portátil: {exc}") from exc


SKILL_DIR = Path(__file__).resolve().parents[1]
HTML_PATH = SKILL_DIR / "templates" / "geometria.html"
FONT_PATHS = (
    SKILL_DIR / "templates" / "fonts" / "DejaVuSans.ttf",
    SKILL_DIR / "templates" / "fonts" / "DejaVuSans-Bold.ttf",
)
WIDTH = 1080
HEIGHT = 1920


class RenderError(RuntimeError):
    """Erro operacional que deve ser mostrado com orientação acionável."""


def _json_report(report: dict[str, Any]) -> str:
    return json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2)


def _validate_optional_fields(config: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if "subtitulo" in config and (not isinstance(config["subtitulo"], str) or not config["subtitulo"].strip()):
        errors.append("subtitulo: esperado texto não vazio")
    for field in ("mostrar_dimensoes", "mostrar_areas", "mostrar_badge"):
        if field in config and not isinstance(config[field], bool):
            errors.append(f"{field}: esperado booleano")
    if "badge_texto" in config and (not isinstance(config["badge_texto"], str) or not config["badge_texto"].strip()):
        errors.append("badge_texto: esperado texto não vazio")
    return errors


def _check_dependencies() -> tuple[str, str]:
    if _PLAYWRIGHT_IMPORT_ERROR is not None:
        raise RenderError(
            "dependência ausente: Playwright Python. Instale com "
            "'python3 -m pip install playwright' e depois "
            "'python3 -m playwright install chromium'."
        )
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RenderError("dependência ausente: FFmpeg (comando 'ffmpeg'). Instale FFmpeg e tente novamente.")
    missing = [str(path) for path in (HTML_PATH, *FONT_PATHS) if not path.is_file()]
    if missing:
        raise RenderError("recurso local ausente: " + ", ".join(missing))
    return ffmpeg, str(HTML_PATH)


def _png_from_canvas(page: Any, frame: int) -> bytes:
    page.evaluate("frame => window.renderFrame(frame)", frame)
    data_url = page.evaluate("() => document.getElementById('canvas').toDataURL('image/png')")
    prefix = "data:image/png;base64,"
    if not isinstance(data_url, str) or not data_url.startswith(prefix):
        raise RenderError("Canvas não devolveu um PNG data URL")
    try:
        data = base64.b64decode(data_url[len(prefix) :], validate=True)
    except Exception as exc:  # pragma: no cover - browser output should be valid
        raise RenderError(f"PNG data URL inválido: {exc}") from exc
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RenderError("Canvas devolveu bytes que não são PNG")
    return data


def _encode(ffmpeg: str, frame_dir: Path, frame_count: int, fps: int, encoded: Path) -> None:
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        str(fps),
        "-start_number",
        "0",
        "-i",
        str(frame_dir / "%06d.png"),
        "-frames:v",
        str(frame_count),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "17",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
        str(encoded),
    ]
    try:
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip()
        raise RenderError(f"FFmpeg falhou{': ' + detail[-1200:] if detail else ''}") from exc


def _render_frames(config: dict[str, Any], frame_dir: Path) -> tuple[int, int, dict[int, bytes]]:
    fps = int(config["fps"])
    duration = float(config["duracao_s"])
    frame_count = max(1, int(round(duration * fps)))
    preview_frames = sorted({0, frame_count // 2, frame_count - 1})
    previews: dict[int, bytes] = {}

    assert sync_playwright is not None
    try:
        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(
                    headless=True,
                    args=["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--font-render-hinting=none"],
                )
            except Exception as exc:
                raise RenderError(
                    "Chromium do Playwright não pôde iniciar. Instale-o com "
                    "'python3 -m playwright install chromium' e verifique as dependências do sistema. "
                    f"Detalhe: {exc}"
                ) from exc
            try:
                page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1)
                page.goto(HTML_PATH.as_uri(), wait_until="load")
                page.evaluate("config => window.setConfig(config)", config)
                page.evaluate("document.fonts.ready")
                page.wait_for_timeout(100)
                for frame in range(frame_count):
                    png_bytes = _png_from_canvas(page, frame)
                    (frame_dir / f"{frame:06d}.png").write_bytes(png_bytes)
                    if frame in preview_frames:
                        previews[frame] = png_bytes
                    if frame == 0 or (frame + 1) % max(1, fps) == 0 or frame == frame_count - 1:
                        print(f"frames: {frame + 1}/{frame_count}", file=sys.stderr, flush=True)
            finally:
                browser.close()
    except RenderError:
        raise
    except PlaywrightError as exc:
        raise RenderError(f"Playwright falhou durante a renderização: {exc}") from exc
    except Exception as exc:
        raise RenderError(f"falha ao renderizar frames Canvas: {exc}") from exc
    return frame_count, fps, previews


def _write_previews(preview_dir: Path, previews: dict[int, bytes]) -> list[str]:
    preview_dir.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []
    for frame, png_bytes in sorted(previews.items()):
        path = preview_dir / f"frame_{frame:06d}.png"
        path.write_bytes(png_bytes)
        paths.append(str(path))
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Renderiza geometria retangular parametrizada em MP4 vertical.")
    parser.add_argument("--config", required=True, type=Path, help="caminho para o JSON de configuração")
    parser.add_argument("--output", required=True, type=Path, help="caminho do MP4 de saída")
    parser.add_argument("--preview-dir", type=Path, help="diretório opcional para três frames PNG de inspeção")
    parser.add_argument("--overwrite", action="store_true", help="permite substituir um MP4 de saída existente")
    args = parser.parse_args(argv)

    try:
        config = load_config(args.config)
        report = audit_config(config)
        optional_errors = _validate_optional_fields(config)
        if optional_errors:
            report = dict(report)
            report["correto"] = False
            report["erros"] = [*report.get("erros", []), *optional_errors]
        if not report["correto"]:
            print(_json_report(report), file=sys.stderr)
            raise RenderError("configuração rejeitada pela auditoria; nenhum frame foi renderizado")
        if args.output.exists() and not args.overwrite:
            raise RenderError(f"saída já existe: {args.output}; use --overwrite para substituir")
        ffmpeg, _ = _check_dependencies()
        args.output.parent.mkdir(parents=True, exist_ok=True)

        with tempfile.TemporaryDirectory(prefix="geometria_render_") as temporary:
            temporary_dir = Path(temporary)
            frame_dir = temporary_dir / "frames"
            frame_dir.mkdir()
            encoded = temporary_dir / "encoded.mp4"
            frame_count, fps, previews = _render_frames(config, frame_dir)
            _encode(ffmpeg, frame_dir, frame_count, fps, encoded)
            if not encoded.is_file() or encoded.stat().st_size <= 0:
                raise RenderError("FFmpeg não produziu um MP4 não vazio")
            os.replace(encoded, args.output)
            preview_paths = _write_previews(args.preview_dir, previews) if args.preview_dir else []

        result = {
            "output": str(args.output),
            "resolution": f"{WIDTH}x{HEIGHT}",
            "fps": fps,
            "frames": frame_count,
            "duration_rendered_s": frame_count / fps,
            "audio": False,
            "previews": preview_paths,
        }
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
        return 0
    except (ConfigError, OSError, RenderError) as exc:
        print(f"render_geometria: erro: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
