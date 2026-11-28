---
name: apresentacao-narrada
description: Gera apresentação narrada (slides + voz da ZAYRA em pt-BR) como vídeo MP4 ou áudio para WhatsApp, usando Edge TTS (pt-BR-FranciscaNeural) e ffmpeg; também orienta apresentação em PPTX. Usar para "apresentação", "vídeo explicativo narrado", "áudio explicando", "briefing em vídeo".
---

# Apresentação narrada

## Passo a passo
1. Roteiro: 1 frase de narração por slide, até 30 palavras, linguagem falada ("reais", não "R$"; sem siglas soltas).
2. Narração por slide com Edge TTS (mesma voz da ZAYRA):
   ```bash
   pip install edge-tts
   edge-tts --voice pt-BR-FranciscaNeural --rate=+0% --text "Texto do slide 1" --write-media n01.mp3
   ```
   No Node (RomatecVoiceAgent) use `speak()` de `src/agent/speak.ts`.
3. Duração de cada slide = duração do áudio + 0,6 s: `ffprobe -v error -show_entries format=duration -of csv=p=0 n01.mp3`.
4. Monte o vídeo de cada slide e junte:
   ```bash
   ffmpeg -y -loop 1 -framerate 30 -i s01.jpg -i n01.mp3 -c:v libx264 -tune stillimage -pix_fmt yuv420p -c:a aac -af apad=pad_dur=0.6 -shortest p01.mp4
   printf "file 'p01.mp4'\nfile 'p02.mp4'\n" > lista.txt
   ffmpeg -y -f concat -safe 0 -i lista.txt -c copy apresentacao.mp4
   ```
5. Música opcional por baixo (skill **musica-de-fundo**, volume 0.15).
6. Versão só áudio para WhatsApp: junte os MP3 e converta para OGG/Opus mono (skill **zayra-voz-whatsapp**, passo 2).
7. Para arquivo PowerPoint editável, use a skill `pptx` (anthropic-skills) e coloque o roteiro nas notas do apresentador.

## Verificação
- [ ] ouvir o início e o fim de 2 narrações (nome de lugar e número falados certo)
- [ ] vídeo sem tela preta entre slides; duração ≈ soma dos áudios
- [ ] nenhum dado inventado (preço, área, prazo só os confirmados)
