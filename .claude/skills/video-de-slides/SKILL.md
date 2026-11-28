---
name: video-de-slides
description: Transforma slides/imagens (carrossel, artes, prints) em vídeo vertical 1080x1920 para Reels/Status do WhatsApp com zoom suave, transição cruzada e música/narração, usando Pillow + ffmpeg. Usar para "faz o vídeo", "transforma em reels", "vídeo do carrossel", "vídeo com as fotos".
---

# Vídeo de slides (Reels 1080x1920)

## Passo a passo
1. Renderize cada slide em PNG/JPG 1080x1920 (Pillow). Mantenha o texto dentro da área segura: 120 px no topo e 300 px na base (a interface do Instagram cobre).
2. Defina a duração de cada slide (4 s texto curto; 6 s texto longo; último slide com contato 6 s).
3. Monte com zoom leve + transição `xfade` de 0,5 s (script abaixo).
4. Adicione música (skill **musica-de-fundo**) e/ou narração (skill **apresentacao-narrada**).
5. Confira: abra 3 quadros (início, meio, fim) e veja se nada foi cortado; duração bate com a soma.

## Montagem (Python chamando ffmpeg)
```python
# montar.py  —  python3 montar.py saida.mp4 slide1.jpg slide2.jpg ...
import sys, subprocess
out, imgs = sys.argv[1], sys.argv[2:]
dur=[4.0]*len(imgs); dur[-1]=6.0; X=0.5; FPS=30
cmd=['ffmpeg','-y']
for im,d in zip(imgs,dur): cmd+=['-framerate',str(FPS),'-loop','1','-t',str(d),'-i',im]   # -framerate evita vídeo com poucos quadros
f=[]
for i,d in enumerate(dur):

    f.append(f"[{i}:v]scale=1080:1920,zoompan=z='min(1+0.00035*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps={FPS},format=yuv420p[v{i}]")
last='v0'; off=dur[0]-X
for i in range(1,len(imgs)):
    f.append(f"[{last}][v{i}]xfade=transition=fade:duration={X}:offset={off:.2f}[x{i}]"); last=f"x{i}"; off+=dur[i]-X
cmd+=['-filter_complex',';'.join(f),'-map',f'[{last}]','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',out]
subprocess.run(cmd,check=True)
```
- `d=1` no zoompan: com entrada em loop a 30 fps, cada quadro gera 1 quadro (d maior multiplica o vídeo e trava).
- Zoom máximo 1.06: mais que isso corta o cabeçalho/rodapé do slide.
- Duração final = soma das durações − 0,5 × (nº de slides − 1).
- Para WhatsApp: ≤ 16 MB; se passar, `-crf 26`.
