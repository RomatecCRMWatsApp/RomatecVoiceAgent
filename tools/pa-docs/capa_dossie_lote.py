#!/usr/bin/env python3
"""Capa padrão do DOSSIÊ TÉCNICO DO LOTE DE PRODUÇÃO – PA Salete Moreno (Romatec).

Reproduz o modelo aprovado (Capa_Dossie_LT-05_Salete_Moreno_Romatec.pdf, 18/11/2026):
A4 retrato, fundo verde em degradê, filetes dourados no topo e no rodapé, logo Romatec
(branco) à esquerda, brasão do PA à direita, título "LOTE LT-XX", vista aérea do PA,
quadro de identificação do lote e bloco Romatec no rodapé.

Uso:
  python3 capa_dossie_lote.py lote.json [saida.pdf]
  python3 capa_dossie_lote.py lotes.json --lote              (lista JSON = uma capa por lote)
JSON (um lote):
  {"lote":"LT-05","associado":"SILVANA DA SILVA GOMES","numero":"PASM-014",
   "lote_vila":"14","denominacao":"Chácara Nosso Lar","area_ha":36.0,
   "municipio":"Açailândia/MA","associacao":"Associação dos Produtores Rurais do PA Salete Moreno",
   "emissao":"2026-11-18","foto":"assets/vista_aerea_pa_salete_moreno.jpg",
   "legenda_foto":"Vista aérea do Projeto de Assentamento Salete Moreno"}
"""
import json, os, sys, datetime
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTDIR = '/usr/share/fonts/truetype/liberation/'
pdfmetrics.registerFont(TTFont('LS', FONTDIR + 'LiberationSans-Regular.ttf'))
pdfmetrics.registerFont(TTFont('LS-B', FONTDIR + 'LiberationSans-Bold.ttf'))

W, H = A4                      # 595.28 x 841.89 pt
M = 45.354                     # margem lateral (16 mm)
GOLD = colors.Color(209/255, 183/255, 103/255)          # #D1B767
BG_TOP = (71, 105, 80); BG_BOT = (16, 62, 43)            # degradê #476950 -> #103E2B
BOX = colors.Color(25/255, 75/255, 54/255)               # #194B36
CREAM = colors.HexColor('#F4F0E3')
SOFT = colors.HexColor('#DCE5DD')
FOOT = colors.HexColor('#C9D3CC')
ASSOC_PADRAO = 'Associação dos Produtores Rurais do PA Salete Moreno'
ALQ = 48400.0                  # alqueire mineiro (padrão regional) em m²
MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']

def br(v, d=4):
    return f'{v:,.{d}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')

def data_ext(s):
    d = datetime.date.fromisoformat(s) if s else datetime.date.today()
    return f'{d.day} de {MESES[d.month-1]} de {d.year}'

def asset(p):
    if os.path.isabs(p): return p
    for base in (HERE, os.path.join(HERE, '..', 'assets', 'capa-dossie'), os.getcwd()):
        for cand in (os.path.join(base, p), os.path.join(base, os.path.basename(p))):
            if os.path.exists(cand): return cand
    raise FileNotFoundError(p)

def Y(top):                    # converte coordenada medida do topo para ReportLab
    return H - top

def spaced(c, x, y, txt, font, size, tracking):
    c.setFont(font, size)
    for ch in txt:
        c.drawString(x, y, ch)
        x += pdfmetrics.stringWidth(ch, font, size) + tracking

def capa(c, L):
    # fundo: degradê vertical (topo -> 195 pt) e verde sólido abaixo
    c.setFillColorRGB(*[v/255 for v in BG_BOT]); c.rect(0, 0, W, H, fill=1, stroke=0)
    n = 120; y0, y1 = 7.2, 200.0
    for i in range(n):
        t = i/(n-1); col = [ (BG_TOP[k] + (BG_BOT[k]-BG_TOP[k])*t)/255 for k in range(3)]
        c.setFillColorRGB(*col)
        top = y0 + (y1-y0)*i/n; c.rect(0, Y(top + (y1-y0)/n + 0.6), W, (y1-y0)/n + 0.6, fill=1, stroke=0)
    c.setFillColorRGB(*[v/255 for v in BG_TOP]); c.rect(0, Y(y0+0.5), W, 1.2, fill=1, stroke=0)
    # filetes dourados
    c.setFillColor(GOLD); c.rect(0, Y(7.2), W, 7.2, fill=1, stroke=0); c.rect(0, 0, W, H-834.15, fill=1, stroke=0)
    # logo Romatec (branco) e brasão do PA
    c.drawImage(ImageReader(asset(L.get('logo', 'assets/logo_romatec_branco.png'))), M, Y(51.7+72.0), 216.0, 72.0, mask='auto')
    c.drawImage(ImageReader(asset(L.get('brasao', 'assets/brasao_pa_salete_moreno.png'))), 464.85, Y(36.45+99.9), 85.04, 99.9)
    # títulos
    c.setFillColor(GOLD); spaced(c, M, Y(157.0), 'DOSSIÊ TÉCNICO DO LOTE DE PRODUÇÃO', 'LS', 9.2, 1.42)
    c.setFillColor(CREAM); c.setFont('LS-B', 31.3); c.drawString(M, Y(183.6), f"LOTE {L['lote']}")
    c.setFillColor(SOFT); c.setFont('LS', 12.3); c.drawString(M, Y(196.5), L.get('subtitulo', 'Projeto de Assentamento Salete Moreno'))
    # vista aérea (recorte proporcional para 504,6 x 283,8 pt)
    fx, fy, fw, fh = M, 210.5, W-2*M, 283.8
    img = ImageReader(asset(L.get('foto', 'assets/vista_aerea_pa_salete_moreno.jpg'))); iw, ih = img.getSize()
    c.saveState(); p = c.beginPath(); p.rect(fx, Y(fy+fh), fw, fh); c.clipPath(p, stroke=0)
    s = max(fw/iw, fh/ih); dw, dh = iw*s, ih*s
    c.drawImage(img, fx-(dw-fw)/2, Y(fy+fh)-(dh-fh)/2, dw, dh); c.restoreState()
    c.setFont('LS', 7.3); c.setFillColor(colors.HexColor('#E6E9E4'))
    c.drawString(M, Y(506.0), L.get('legenda_foto', 'Vista aérea do Projeto de Assentamento Salete Moreno'))
    c.setFillColor(GOLD); c.drawRightString(W-M, Y(506.0), L.get('local', 'AÇAILÂNDIA / MA'))
    # quadro de identificação
    bx, by, bw, bh = M, 522.4, W-2*M, 103.6
    c.setFillColor(BOX); c.setStrokeColor(colors.Color(209/255,183/255,103/255,alpha=0.55)); c.setLineWidth(0.6)
    c.roundRect(bx, Y(by+bh), bw, bh, 6, fill=1, stroke=1)
    area = float(L.get('area_ha') or 0)
    vila = f" · lote da vila {L['lote_vila']}" if L.get('lote_vila') else ''
    rows = [('Associado(a)', L['associado'].upper()),
            ('Nº do associado', f"{L.get('numero','')}{vila}"),
            ('Denominação', f"“{L['denominacao']}”" if L.get('denominacao') else '—'),
            ('Área', f"{br(area)} ha · {br(area*10000/ALQ)} alqueires" if area else 'a definir após o georreferenciamento'),
            ('Município', L.get('municipio', 'Açailândia/MA')),
            ('Associação', L.get('associacao', ASSOC_PADRAO)),
            ('Emissão', data_ext(L.get('emissao')))]
    for i, (k, v) in enumerate(rows):
        y = Y(541.25 + i*12.42)
        c.setFont('LS-B', 9.4); c.setFillColor(GOLD); c.drawString(58.11, y, k)
        c.setFont('LS', 9.4); c.setFillColor(CREAM); c.drawString(162.99, y, v)
    # rodapé Romatec
    c.setStrokeColor(colors.Color(209/255,183/255,103/255,alpha=0.7)); c.setLineWidth(0.5); c.line(M, Y(748.3), W-M, Y(748.3))
    c.setFillColor(GOLD); c.setFont('LS-B', 9.2); c.drawString(M, Y(764.6), 'ROMATEC CONSULTORIA TOTAL')
    c.setFillColor(FOOT); c.setFont('LS', 7.5)
    for i, t in enumerate(['J R P BEZERRA LTDA · CNPJ 17.261.987/0001-09',
                           'Rua São Raimundo, nº 10, Centro · Açailândia/MA · CEP 65.930-000',
                           'Responsável técnico: José Romário Pinto Bezerra · Técnico em Agrimensura',
                           'CFT 01209185369 · INCRA FQNS',
                           '(99) 99181-1246 · contato@consultoriaromatec.com.br · consultoriaromatec.com.br']):
        c.drawString(M, Y(773.9 + i*7.99), t)

def nome_arquivo(L):
    import re, unicodedata
    slug = re.sub(r'[^A-Za-z0-9]+', '_', unicodedata.normalize('NFD', L['associado'].title()).encode('ascii', 'ignore').decode()).strip('_')
    return f"Capa_Dossie_{L['lote']}_{slug}_Salete_Moreno_Romatec.pdf"

def gerar(L, out=None):
    out = out or nome_arquivo(L)
    c = canvas.Canvas(out, pagesize=A4); c.setTitle(f"Capa – Dossiê técnico do lote {L['lote']}")
    capa(c, L); c.save(); return out

if __name__ == '__main__':
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    dest = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else None
    if isinstance(data, list):
        d = dest or '.'; os.makedirs(d, exist_ok=True)
        for L in data: print(gerar(L, os.path.join(d, nome_arquivo(L))))
    else:
        print(gerar(data, dest))
