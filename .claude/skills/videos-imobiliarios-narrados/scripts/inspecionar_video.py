#!/usr/bin/env python3
"""Inspecionar streams e extrair quadros locais, sem modificar o vídeo.

Uso: python3 inspecionar_video.py --input final.mp4 --output-dir checagem
     --times 1,10,33,36 --require-audio [--overwrite]
Dependências externas: ffprobe; ffmpeg somente para extrair quadros.
A presença de áudio não comprova inteligibilidade nem aprovação da mixagem.
"""
from pathlib import Path
import argparse
import json
import math
import shutil
import subprocess
import sys


def parse_times(value):
    if value is None:
        return []
    try:
        values = [float(item.strip()) for item in value.split(',') if item.strip()]
    except ValueError as exc:
        raise ValueError('Informar segundos separados por vírgulas: 1,10,33.5') from exc
    if any(not math.isfinite(t) or t < 0 for t in values):
        raise ValueError('Os tempos devem ser números finitos e não negativos.')
    return values


def run(args):
    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        raise ValueError(f'Vídeo não encontrado: {source}')
    ffprobe = shutil.which('ffprobe')
    if not ffprobe:
        raise ValueError('ffprobe ausente. Instalar FFmpeg/ffprobe no ambiente de execução.')
    result = subprocess.run(
        [ffprobe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(source)],
        check=True, capture_output=True, text=True,
    )
    metadata = json.loads(result.stdout)
    videos = [s for s in metadata.get('streams', []) if s.get('codec_type') == 'video']
    audios = [s for s in metadata.get('streams', []) if s.get('codec_type') == 'audio']
    errors = []
    try:
        duration = float(metadata.get('format', {}).get('duration', 'nan'))
    except (TypeError, ValueError):
        duration = float('nan')
    if not math.isfinite(duration) or duration <= 0:
        errors.append('Duração ausente ou inválida.')
    if not videos:
        errors.append('Nenhum stream de vídeo encontrado.')
    if args.require_audio and not audios:
        errors.append('Áudio exigido, mas nenhum stream de áudio foi encontrado.')
    for stream in videos:
        if args.expected_width and stream.get('width') != args.expected_width:
            errors.append(f'Largura diferente da esperada: {stream.get("width")} != {args.expected_width}')
        if args.expected_height and stream.get('height') != args.expected_height:
            errors.append(f'Altura diferente da esperada: {stream.get("height")} != {args.expected_height}')
    times = parse_times(args.times)
    if times and not args.output_dir:
        raise ValueError('Usar --output-dir ao solicitar quadros com --times.')
    if times and (not math.isfinite(duration) or any(t >= duration for t in times)):
        raise ValueError('Cada tempo deve estar dentro da duração do vídeo.')
    frames = []
    report_path = None
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else None
    if output_dir:
        report_path = output_dir / 'inspecao.json'
        frame_paths = [output_dir / f'quadro_{i:02d}_{round(t*1000)}ms.png' for i, t in enumerate(times, 1)]
        conflicts = [p for p in [report_path] + frame_paths if p.exists()]
        if conflicts and not args.overwrite:
            raise ValueError('Saída já existe; escolher outra pasta ou usar --overwrite: ' + ', '.join(map(str, conflicts)))
        output_dir.mkdir(parents=True, exist_ok=True)
        if times:
            ffmpeg = shutil.which('ffmpeg')
            if not ffmpeg:
                raise ValueError('ffmpeg ausente; necessário para extrair quadros.')
            for t, target in zip(times, frame_paths):
                subprocess.run(
                    [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y' if args.overwrite else '-n',
                     '-ss', str(t), '-i', str(source), '-frames:v', '1', '-an', str(target)],
                    check=True, capture_output=True, text=True,
                )
                if not target.is_file() or target.stat().st_size == 0:
                    errors.append(f'Quadro não gerado: {target}')
                frames.append({'tempo_s': t, 'arquivo': str(target)})
    def summarize(stream):
        keys = ('index', 'codec_type', 'codec_name', 'width', 'height', 'r_frame_rate', 'sample_rate', 'channels')
        data = {key: stream[key] for key in keys if key in stream}
        if stream.get('side_data_list'):
            data['side_data_list'] = stream['side_data_list']
        if stream.get('tags', {}).get('rotate'):
            data['rotate_tag'] = stream['tags']['rotate']
        return data
    report = {
        'arquivo': str(source),
        'duracao_s': duration if math.isfinite(duration) else None,
        'tamanho_bytes': source.stat().st_size,
        'streams': [summarize(s) for s in videos + audios],
        'audio_presente': bool(audios),
        'audio_ouvido': False,
        'observacao': 'Parâmetros e quadros não substituem ouvir a mixagem ou conferir alegações comerciais.',
        'quadros': frames,
        'erros': errors,
        'ok_tecnico': not errors,
    }
    encoded = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
    if report_path:
        report_path.write_text(encoded + '\n', encoding='utf-8')
    print(encoded)
    return 1 if errors else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--input', required=True, help='Arquivo de vídeo local.')
    parser.add_argument('--output-dir', help='Pasta de relatório e quadros; não usar a pasta da habilidade.')
    parser.add_argument('--times', help='Tempos de quadros em segundos, separados por vírgulas.')
    parser.add_argument('--require-audio', action='store_true', help='Falhar se não houver stream de áudio.')
    parser.add_argument('--expected-width', type=int)
    parser.add_argument('--expected-height', type=int)
    parser.add_argument('--overwrite', action='store_true', help='Permitir substituir apenas as saídas da conferência.')
    args = parser.parse_args()
    if any(value is not None and value <= 0 for value in (args.expected_width, args.expected_height)):
        parser.error('Dimensões esperadas devem ser positivas.')
    try:
        return run(args)
    except (ValueError, OSError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        message = str(exc)
        if isinstance(exc, subprocess.CalledProcessError):
            message = (exc.stderr or message).strip()
        print(json.dumps({'ok_tecnico': False, 'erro': message}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
