#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
inspecionar_dxf.py
==================

Ferramenta standalone para AVALIAR a viabilidade de extracao automatica
de dados (lotes, quadras, ruas, areas, confrontantes) de um arquivo DXF
de loteamento.

Uso:
    python inspecionar_dxf.py CAMINHO_DO_ARQUIVO.dxf
    python inspecionar_dxf.py CAMINHO_DO_ARQUIVO.dxf --no-emoji
    python inspecionar_dxf.py CAMINHO_DO_ARQUIVO.dxf --plain

Flags:
    --no-emoji   Remove emojis (compatibilidade com terminais antigos)
    --plain      Remove emojis E cores ANSI (texto puro, ideal para logs)

Saida:
    - Relatorio no terminal com diagnostico das layers
    - Pontuacao de viabilidade (0-100)
    - Recomendacao final: Caminho A (CSV manual) ou B (DXF nativo)

Requisitos:
    pip install ezdxf shapely
"""

import sys
import math
import os
from collections import Counter
from pathlib import Path

# ============================================================
# Configuracao de encoding (Windows precisa de tratamento especial)
# ============================================================
if sys.platform == 'win32':
    # Forca UTF-8 no stdout/stderr no Windows para evitar UnicodeEncodeError
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, Exception):
        pass

    # Tenta habilitar suporte a cores ANSI no cmd.exe moderno (Win10+)
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except Exception:
        pass

# ============================================================
# Detecta flags
# ============================================================
USAR_EMOJI = '--no-emoji' not in sys.argv and '--plain' not in sys.argv
USAR_COR = '--plain' not in sys.argv

# Remove flags da lista de argumentos
sys.argv = [a for a in sys.argv if a not in ('--no-emoji', '--plain')]

# Detecta automaticamente se o terminal suporta UTF-8
def _terminal_suporta_utf8():
    enc = (sys.stdout.encoding or '').lower()
    return 'utf' in enc

if not _terminal_suporta_utf8():
    USAR_EMOJI = False  # forca desativacao se terminal nao suporta

# ============================================================
# Importa dependencias
# ============================================================
try:
    import ezdxf
except ImportError:
    print("[ERRO] Biblioteca 'ezdxf' nao encontrada.")
    print("       Instale com: pip install ezdxf")
    sys.exit(1)

try:
    from shapely.geometry import Polygon, Point
except ImportError:
    print("[ERRO] Biblioteca 'shapely' nao encontrada.")
    print("       Instale com: pip install shapely")
    sys.exit(1)


# ============================================================
# Helpers de formatacao
# ============================================================
def emoji(simbolo, fallback=''):
    """Retorna emoji se suportado, senao o fallback ASCII."""
    return simbolo if USAR_EMOJI else fallback

def cor_ansi(texto, codigo):
    """Adiciona cor ANSI ao texto."""
    if not USAR_COR:
        return texto
    return f"\033[{codigo}m{texto}\033[0m"

def verde(t):    return cor_ansi(t, '92')
def vermelho(t): return cor_ansi(t, '91')
def amarelo(t):  return cor_ansi(t, '93')
def azul(t):     return cor_ansi(t, '94')
def negrito(t):  return cor_ansi(t, '1')

# Marcadores ASCII fallback
CHECK = emoji('✓', '[OK]')
CROSS = emoji('✗', '[XX]')
WARN  = emoji('⚠', '[!!]')
QMARK = emoji('?', '[??]')


# ============================================================
# Configuracao - palavras-chave que indicam cada tipo de layer
# ============================================================
LAYER_KEYWORDS = {
    'lotes':      ['lote', 'lotes', 'parcela', 'parcelas'],
    'quadras':    ['quadra', 'quadras', 'block', 'manzana'],
    'numlotes':   ['numlote', 'num-lote', 'numero_lote', 'numlotes', 'num_lotes'],
    'numquadras': ['numquadra', 'num-quadra', 'numquadras', 'num_quadras'],
    'ruas':       ['rua', 'ruas', 'logradouro', 'street', 'via', 'avenida'],
    'areas':      ['area', 'areas', 'text-area', 'text_area', 'metragem'],
    'app':        ['app', 'preservacao', 'apa', 'reserva'],
    'hidro':      ['hidro', 'rio', 'agua', 'corrego'],
}


def detectar_tipo_layer(nome_layer):
    """Identifica o tipo de uma layer pelo nome."""
    nome_lower = nome_layer.lower().replace('-', '').replace('_', '').replace(' ', '')
    matches = []
    for tipo, palavras in LAYER_KEYWORDS.items():
        for palavra in palavras:
            palavra_clean = palavra.replace('-', '').replace('_', '').replace(' ', '')
            if palavra_clean in nome_lower:
                matches.append(tipo)
                break
    return matches


def main():
    if len(sys.argv) < 2:
        print(negrito("Uso: python inspecionar_dxf.py CAMINHO_DO_ARQUIVO.dxf [--no-emoji] [--plain]"))
        print()
        print("Flags opcionais:")
        print("  --no-emoji   Remove emojis (terminais antigos)")
        print("  --plain      Remove emojis E cores (texto puro, ideal para logs)")
        print()
        print("Exemplos:")
        print("  python inspecionar_dxf.py loteamento.dxf")
        print("  python inspecionar_dxf.py \"C:\\Users\\Voce\\plano.dxf\" --no-emoji")
        print("  python inspecionar_dxf.py /home/user/plano.dxf --plain > relatorio.txt")
        sys.exit(1)

    caminho_dxf = sys.argv[1]

    if not os.path.exists(caminho_dxf):
        print(vermelho(f"[ERRO] Arquivo nao encontrado: {caminho_dxf}"))
        sys.exit(1)

    if not caminho_dxf.lower().endswith('.dxf'):
        print(amarelo(f"[AVISO] O arquivo nao tem extensao .dxf"))
        print("        Se for DWG, converta primeiro para DXF (ODA File Converter, QGIS, AutoCAD).")
        sys.exit(1)

    tamanho_mb = os.path.getsize(caminho_dxf) / (1024 * 1024)

    print()
    print(negrito("=" * 72))
    print(negrito(f"  {emoji('🔍 ', '')}INSPETOR DE DXF - Viabilidade de Extracao Automatica"))
    print(negrito("=" * 72))
    print()
    print(f"{emoji('📁', '[Arquivo]')} {Path(caminho_dxf).name}")
    print(f"{emoji('📦', '[Tamanho]')} {tamanho_mb:.2f} MB")
    print()

    # --------------------------------------------------------
    # 1. CARREGAR DXF
    # --------------------------------------------------------
    print(azul("[1/5] Carregando DXF..."))
    try:
        doc = ezdxf.readfile(caminho_dxf)
    except ezdxf.DXFStructureError as e:
        print(vermelho(f"[ERRO] Arquivo DXF corrompido ou invalido."))
        print(f"       Detalhes: {e}")
        sys.exit(1)
    except UnicodeDecodeError as e:
        print(vermelho(f"[ERRO] Problema de encoding no DXF."))
        print(f"       Tente reabrir e re-salvar o arquivo no AutoCAD/QGIS.")
        print(f"       Detalhes: {e}")
        sys.exit(1)
    except Exception as e:
        print(vermelho(f"[ERRO] Falha ao ler DXF: {e}"))
        sys.exit(1)

    print(f"      {CHECK} Versao DXF: {doc.dxfversion}")
    print(f"      {CHECK} Encoding: {doc.encoding}")

    msp = doc.modelspace()

    # --------------------------------------------------------
    # 2. ANALISAR LAYERS
    # --------------------------------------------------------
    print()
    print(azul("[2/5] Analisando layers..."))
    layers_dxf = list(doc.layers)
    print(f"      Total de layers: {len(layers_dxf)}")

    layer_entities = {}
    for entity in msp:
        layer_name = entity.dxf.layer
        etype = entity.dxftype()
        if layer_name not in layer_entities:
            layer_entities[layer_name] = Counter()
        layer_entities[layer_name][etype] += 1

    # Identifica layers criticas
    layers_identificadas = {
        'lotes':      [],
        'quadras':    [],
        'numlotes':   [],
        'numquadras': [],
        'ruas':       [],
        'areas':      [],
        'app':        [],
        'hidro':      [],
    }

    for layer_name in layer_entities:
        tipos = detectar_tipo_layer(layer_name)
        for tipo in tipos:
            layers_identificadas[tipo].append(layer_name)

    print()
    print(negrito(f"      {emoji('📋 ', '')}Layers identificadas automaticamente:"))
    rotulos = {
        'lotes':      (f"{emoji('🏠 ', '')}LOTES (polylines fechadas)", True),
        'quadras':    (f"{emoji('🏘️  ', '')}QUADRAS (polylines fechadas)", False),
        'numlotes':   (f"{emoji('🔢 ', '')}NUMEROS DE LOTES (textos)", True),
        'numquadras': (f"{emoji('🔢 ', '')}NUMEROS DE QUADRAS (textos)", False),
        'ruas':       (f"{emoji('🛣️  ', '')}NOMES DE RUAS (textos)", False),
        'areas':      (f"{emoji('📐 ', '')}AREAS (textos)", False),
        'app':        (f"{emoji('🌳 ', '')}APP (area de preservacao)", False),
        'hidro':      (f"{emoji('💧 ', '')}HIDROGRAFIA", False),
    }

    for tipo, (label, critico) in rotulos.items():
        layers = layers_identificadas[tipo]
        if layers:
            for ly in layers:
                count = sum(layer_entities[ly].values())
                print(f"         {verde(CHECK)} {label}: '{ly}' ({count} entidades)")
        else:
            marcador = vermelho(CROSS) if critico else amarelo(QMARK)
            tag = vermelho('CRITICO') if critico else amarelo('opcional')
            print(f"         {marcador} {label}: nao identificada [{tag}]")

    # --------------------------------------------------------
    # 3. VALIDAR POLIGONOS DE LOTES
    # --------------------------------------------------------
    print()
    print(azul("[3/5] Validando poligonos de lotes..."))

    lotes_validos = 0
    lotes_invalidos = 0
    lotes_abertos = 0
    lotes_com_4_lados = 0
    lotes_com_5_lados = 0
    lotes_com_outros = 0

    for layer_lotes in layers_identificadas['lotes']:
        for entity in msp.query(f'LWPOLYLINE[layer=="{layer_lotes}"]'):
            points = [(p[0], p[1]) for p in entity.get_points()]
            if len(points) < 3:
                lotes_invalidos += 1
                continue
            fechado = entity.closed or (math.dist(points[0], points[-1]) < 0.5)
            if not fechado:
                lotes_abertos += 1
                continue
            if points[0] == points[-1]:
                points = points[:-1]
            try:
                poly = Polygon(points)
                if poly.is_valid and poly.area > 1:
                    lotes_validos += 1
                    n = len(points)
                    if n == 4:
                        lotes_com_4_lados += 1
                    elif n == 5:
                        lotes_com_5_lados += 1
                    else:
                        lotes_com_outros += 1
                else:
                    lotes_invalidos += 1
            except Exception:
                lotes_invalidos += 1

    print(f"      Lotes validos: {verde(str(lotes_validos))}")
    if lotes_invalidos > 0:
        print(f"      {amarelo('Lotes invalidos:')} {lotes_invalidos}")
    if lotes_abertos > 0:
        print(f"      {amarelo('Lotes com polyline aberta:')} {lotes_abertos}")

    if lotes_validos > 0:
        print(f"      Distribuicao de formato:")
        print(f"         4 lados (retangular padrao): {lotes_com_4_lados} ({100*lotes_com_4_lados/lotes_validos:.0f}%)")
        print(f"         5 lados (com chanfro/esquina): {lotes_com_5_lados} ({100*lotes_com_5_lados/lotes_validos:.0f}%)")
        print(f"         6+ lados (irregular): {lotes_com_outros} ({100*lotes_com_outros/lotes_validos:.0f}%)")

    # --------------------------------------------------------
    # 4. CRUZAMENTO TEXTOS x POLIGONOS
    # --------------------------------------------------------
    print()
    print(azul("[4/5] Validando matching texto x poligono..."))

    # Carrega poligonos
    polys_lotes = []
    for layer_lotes in layers_identificadas['lotes']:
        for entity in msp.query(f'LWPOLYLINE[layer=="{layer_lotes}"]'):
            points = [(p[0], p[1]) for p in entity.get_points()]
            if len(points) < 3:
                continue
            if not entity.closed and math.dist(points[0], points[-1]) < 0.5:
                points.append(points[0])
            try:
                p = Polygon(points)
                if p.is_valid and p.area > 1:
                    polys_lotes.append(p)
            except Exception:
                continue

    # Carrega textos de numeros de lotes
    textos_numlotes = []
    for layer in layers_identificadas['numlotes']:
        for entity in msp.query(f'TEXT[layer=="{layer}"]'):
            try:
                textos_numlotes.append((entity.dxf.insert.x, entity.dxf.insert.y, entity.dxf.text.strip()))
            except Exception:
                continue
        for entity in msp.query(f'MTEXT[layer=="{layer}"]'):
            try:
                textos_numlotes.append((entity.dxf.insert.x, entity.dxf.insert.y, entity.text.strip()))
            except Exception:
                continue

    # Carrega textos de areas
    textos_areas = []
    for layer in layers_identificadas['areas']:
        for entity in msp.query(f'TEXT[layer=="{layer}"]'):
            try:
                textos_areas.append((entity.dxf.insert.x, entity.dxf.insert.y, entity.dxf.text.strip()))
            except Exception:
                continue
        for entity in msp.query(f'MTEXT[layer=="{layer}"]'):
            try:
                textos_areas.append((entity.dxf.insert.x, entity.dxf.insert.y, entity.text.strip()))
            except Exception:
                continue

    # Verifica matching
    taxa_numero = 0
    taxa_area = 0

    if polys_lotes and textos_numlotes:
        amostra = polys_lotes[:200]
        com_numero = 0
        for poly in amostra:
            for x, y, _ in textos_numlotes:
                if poly.contains(Point(x, y)):
                    com_numero += 1
                    break
        taxa_numero = 100 * com_numero / len(amostra) if amostra else 0
        cor_taxa = verde if taxa_numero >= 90 else (amarelo if taxa_numero >= 70 else vermelho)
        print(f"      Lotes com numero identificavel (amostra de {len(amostra)}): {cor_taxa(f'{taxa_numero:.0f}%')}")
    else:
        if not polys_lotes:
            print(f"      {vermelho('Sem poligonos de lotes para validar.')}")
        else:
            print(f"      {amarelo('Sem layer de numeros de lotes detectada.')}")

    if polys_lotes and textos_areas:
        amostra = polys_lotes[:200]
        com_area = 0
        for poly in amostra:
            for x, y, _ in textos_areas:
                if poly.contains(Point(x, y)):
                    com_area += 1
                    break
        taxa_area = 100 * com_area / len(amostra) if amostra else 0
        cor_taxa = verde if taxa_area >= 90 else (amarelo if taxa_area >= 70 else vermelho)
        print(f"      Lotes com area identificavel (amostra de {len(amostra)}): {cor_taxa(f'{taxa_area:.0f}%')}")
    else:
        if polys_lotes:
            print(f"      {amarelo('Sem layer de areas detectada.')}")

    # --------------------------------------------------------
    # 5. PONTUACAO E RECOMENDACAO
    # --------------------------------------------------------
    print()
    print(azul("[5/5] Calculando pontuacao de viabilidade..."))

    pontuacao = 0
    pontos_max = 100
    motivos = []

    if layers_identificadas['lotes']:
        pontuacao += 25
        motivos.append(verde(f"  {CHECK} Layer de LOTES identificada (+25)"))
    else:
        motivos.append(vermelho(f"  {CROSS} Layer de LOTES NAO identificada (0/25)"))

    if layers_identificadas['numlotes']:
        pontuacao += 15
        motivos.append(verde(f"  {CHECK} Layer de NUMEROS DE LOTES identificada (+15)"))
    else:
        motivos.append(vermelho(f"  {CROSS} Layer de NUMEROS DE LOTES NAO identificada (0/15)"))

    if layers_identificadas['areas']:
        pontuacao += 10
        motivos.append(verde(f"  {CHECK} Layer de AREAS identificada (+10)"))
    else:
        motivos.append(amarelo(f"  {QMARK} Layer de AREAS nao identificada (0/10) - opcional"))

    if layers_identificadas['quadras'] or layers_identificadas['numquadras']:
        pontuacao += 10
        motivos.append(verde(f"  {CHECK} Layer de QUADRAS ou NUMQUADRAS identificada (+10)"))
    else:
        motivos.append(amarelo(f"  {QMARK} Layer de QUADRAS nao identificada (0/10) - opcional"))

    if layers_identificadas['ruas']:
        pontuacao += 5
        motivos.append(verde(f"  {CHECK} Layer de RUAS identificada (+5)"))
    else:
        motivos.append(amarelo(f"  {QMARK} Layer de RUAS nao identificada (0/5)"))

    if lotes_validos > 100:
        pontuacao += 15
        motivos.append(verde(f"  {CHECK} {lotes_validos} lotes validos (+15)"))
    elif lotes_validos > 10:
        pontuacao += 10
        motivos.append(amarelo(f"  {WARN} Apenas {lotes_validos} lotes validos (+10)"))
    elif lotes_validos > 0:
        pontuacao += 5
        motivos.append(amarelo(f"  {WARN} Apenas {lotes_validos} lotes validos (+5)"))
    else:
        motivos.append(vermelho(f"  {CROSS} Nenhum lote valido identificado (0/15)"))

    if taxa_numero >= 90 and taxa_area >= 90:
        pontuacao += 20
        motivos.append(verde(f"  {CHECK} Matching texto x poligono >90% para num e area (+20)"))
    elif taxa_numero >= 90:
        pontuacao += 12
        motivos.append(amarelo(f"  {WARN} Matching num ok mas area <90% (+12)"))
    elif taxa_numero >= 70:
        pontuacao += 8
        motivos.append(amarelo(f"  {WARN} Matching num em {taxa_numero:.0f}% (+8)"))
    else:
        motivos.append(vermelho(f"  {CROSS} Matching num em apenas {taxa_numero:.0f}% (0/20)"))

    print()
    for m in motivos:
        print(m)

    # --------------------------------------------------------
    # RECOMENDACAO FINAL
    # --------------------------------------------------------
    print()
    print(negrito("=" * 72))
    print(negrito(f"  {emoji('🎯 ', '')}PONTUACAO FINAL: {pontuacao}/{pontos_max}"))
    print(negrito("=" * 72))
    print()

    if pontuacao >= 80:
        print(verde(negrito(f"  {emoji('🏆 ', '')}RECOMENDACAO: CAMINHO B - DXF NATIVO")))
        print()
        print("  Esse DXF esta OTIMO para extracao automatica.")
        print(f"  {CHECK} Layers organizadas")
        print(f"  {CHECK} Textos posicionados corretamente")
        print(f"  {CHECK} Poligonos validos")
        print()
        print("  Voce pode rodar o script de extracao completa direto.")
        print(f"  Estimativa: {lotes_validos} lotes processados em ~{max(10, lotes_validos // 50)}s")

    elif pontuacao >= 60:
        print(amarelo(negrito(f"  {WARN} RECOMENDACAO: CAMINHO B com REVISAO")))
        print()
        print("  Esse DXF e processavel, mas tem alguns pontos de atencao.")
        print("  Vale rodar a extracao e revisar os casos problematicos.")
        print("  Estimativa: 70-90% dos dados extraidos automaticamente, resto manual.")

    elif pontuacao >= 40:
        print(amarelo(negrito(f"  {WARN} RECOMENDACAO: CAMINHO HIBRIDO")))
        print()
        print("  Layers parcialmente organizadas. Vai precisar de bastante revisao manual.")
        print("  Considere:")
        print("    1. Pedir ao projetista uma versao mais organizada do DXF")
        print("    2. Extrair o que der automaticamente, completar o resto a mao")

    else:
        print(vermelho(negrito(f"  {CROSS} RECOMENDACAO: CAMINHO A - CSV/XLSX MANUAL")))
        print()
        print("  Esse DXF nao tem estrutura suficiente para extracao automatica viavel.")
        print("  Use o memorial descritivo + planta visual como referencia")
        print("  e preencha a planilha CSV/XLSX manualmente.")

    print()
    print("=" * 72)
    print()
    print(negrito(f"{emoji('📊 ', '')}Resumo numerico:"))
    print(f"   Lotes validos: {lotes_validos}")
    print(f"   Distribuicao: 4 lados={lotes_com_4_lados}, 5 lados={lotes_com_5_lados}, irregulares={lotes_com_outros}")
    print(f"   Textos de numeros: {len(textos_numlotes)}")
    print(f"   Textos de areas: {len(textos_areas)}")
    print(f"   Matching num: {taxa_numero:.0f}% | Matching area: {taxa_area:.0f}%")
    print()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInterrompido pelo usuario.")
        sys.exit(0)
    except Exception as e:
        print(vermelho(f"\n[ERRO] Erro inesperado: {e}"))
        import traceback
        traceback.print_exc()
        sys.exit(1)
