---
name: carrossel-instagram
description: Cria carrossel de Instagram (1080x1350, até 10 slides) com frases, identidade de marca (cores, fonte, logo) e destaque em palavras-chave, em Pillow. Usar para "gera um carrossel", "posts com essas frases", "artes para o Instagram".
---

# Carrossel de Instagram

## Regras de conteúdo
- Slide 1 = gancho (até 8 palavras). Último = chamada (WhatsApp/@perfil). Meio = 1 ideia por slide, até 25 palavras.
- Nunca inventar número, preço, depoimento ou dado do empreendimento. Preço só com as condições confirmadas pelo dono.
- Destaque com `**palavra**` no texto; o renderizador pinta só esse trecho.

## Renderização (pontos que já deram erro)
- Tamanho 1080x1350 (4:5). Margem lateral 90 px.
- Quebra de linha medindo com `draw.textbbox` (não por nº de caracteres).
- Caixa de destaque: use as métricas da fonte (`font.getmetrics()`) para a altura, senão corta o "g", "p", "q".
- Fonte de título serifada forte (ex.: Playfair Bold) + corpo sans (ex.: Inter); logo da marca no rodapé, ~70 px.
- Salve JPG qualidade 92 e gere uma folha de contato (todas as miniaturas numa imagem) para revisar antes de entregar.

## Esqueleto
```python
from PIL import Image, ImageDraw, ImageFont
W,H=1080,1350
def quebra(draw,txt,font,larg):
    linhas,l=[], ''
    for p in txt.split():
        t=(l+' '+p).strip()
        if draw.textbbox((0,0),t.replace('**',''),font=font)[2]<=larg: l=t
        else: linhas.append(l); l=p
    return linhas+[l]
# para cada linha: separe por '**' e desenhe trechos alternando cor normal / cor de destaque
```
Entrega: zip com os JPG numerados `carrossel-01.jpg`… + a legenda do post em texto.
