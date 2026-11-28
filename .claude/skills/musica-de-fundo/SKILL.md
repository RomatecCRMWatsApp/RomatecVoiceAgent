---
name: musica-de-fundo
description: Gera trilha instrumental de fundo própria (sem direitos autorais) em Python/numpy para Reels, apresentações e vídeos, sem precisar de scipy nem internet. Usar quando o vídeo precisar de música, "trilha", "som de fundo" ou "música calma".
---

# Música de fundo sintetizada

Gera um WAV de pad + arpejo sobre Am–F–C–G, com fade. Nada baixado da internet, então não há risco de direito autoral.

```python
# musica.py  —  python3 musica.py saida.wav 34   (segundos)
import sys, wave, numpy as np
SR=44100; dur=float(sys.argv[2]) if len(sys.argv)>2 else 30
t=np.arange(int(SR*dur))/SR; out=np.zeros_like(t)
acordes=[[57,60,64],[53,57,60],[48,52,55],[55,59,62]]  # Am F C G (MIDI)
f=lambda m:440*2**((m-69)/12); barra=4.0
for i,s in enumerate(np.arange(0,dur,barra)):
    ac=acordes[i%4]; seg=(t>=s)&(t<s+barra); tt=t[seg]-s
    env=np.minimum(1,tt/0.8)*np.minimum(1,(barra-tt)/0.8)
    for m in ac: out[seg]+=0.10*env*np.sin(2*np.pi*f(m-12)*tt)   # pad grave
    for k in range(8):                                             # arpejo
        a=s+k*barra/8; sg=(t>=a)&(t<a+0.45); x=t[sg]-a
        out[sg]+=0.06*np.exp(-x*6)*np.sin(2*np.pi*f(ac[k%3]+12)*x)
y=np.zeros_like(out); a=0.08                                       # passa-baixa simples (sem scipy)
for n in range(1,len(out)): y[n]=y[n-1]+a*(out[n]-y[n-1])
y*=np.minimum(1,t/2)*np.minimum(1,(dur-t)/3); y/=np.abs(y).max()+1e-9; y*=0.6
with wave.open(sys.argv[1],'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((y*32767).astype(np.int16).tobytes())
```
O loop do passa-baixa é lento em Python puro para trilhas longas (>60 s); aceitável até ~1 min.

Mixar com narração (música baixa, abaixa quando a voz fala):
```bash
ffmpeg -i video.mp4 -i narracao.mp3 -i musica.wav -filter_complex \
"[2:a]volume=0.18[m];[m][1:a]sidechaincompress=threshold=0.05:ratio=8[mb];[1:a][mb]amix=inputs=2:duration=first[a]" \
-map 0:v -map "[a]" -c:v copy -c:a aac -b:a 160k -shortest final.mp4
```
