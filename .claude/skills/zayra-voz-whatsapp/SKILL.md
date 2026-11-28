---
name: zayra-voz-whatsapp
description: Diagnostica e corrige o envio de áudio com a voz da ZAYRA pelo WhatsApp (Edge TTS → Z-API send-audio ou WhatsApp Cloud API). Usar quando o aviso de voz não chega, chega mudo, chega como arquivo em vez de mensagem de voz, ou o log mostra "Edge TTS", "TTS indisponível", "ZAPI send-audio HTTP", "resposta sem messageId", 403/401/413.
---

# Voz da ZAYRA no WhatsApp

Fluxo atual (RomatecVoiceAgent): `speak()` em `src/agent/speak.ts` → `speakEdge()` (Edge TTS, MP3 24 kHz mono) → fallback OpenAI tts-1 → `sendAudio()` em `src/integrations/whatsapp.ts` → Z-API `POST /send-audio` com `data:audio/mp3;base64,...`. Alto nível: `enviarAudioTTS(to, texto)` (máx. 800 caracteres).

## 1. Ache o erro exato (antes de mexer)
Procure nos logs do Railway estas linhas e siga a linha da tabela:

| Linha no log | Causa | Correção |
|---|---|---|
| `[TTS] ⚠️ Edge falhou: ... 403` ou `Unexpected server response: 403` | Microsoft passou a exigir o token `Sec-MS-GEC`; versão antiga do `msedge-tts` | `npm i msedge-tts@latest`, commit com bump de versão |
| `Edge TTS timeout (15s)` | websocket `speech.platform.bing.com` bloqueado ou lento | subir timeout p/ 30 s; manter `OPENAI_API_KEY` no Railway como fallback |
| `TTS indisponível: Edge falhou ... OpenAI não está configurada` | Edge caiu e não há fallback | configurar `OPENAI_API_KEY` ou `TTS_PROVIDER=openai` |
| `ZAPI send-audio HTTP 401/403` | token/Client-Token da Z-API errado | conferir `ZAPI_*` e o header `Client-Token` |
| `ZAPI send-audio HTTP 413` | base64 grande demais | áudio ≤ 800 caracteres de texto, ou mandar por URL pública |
| `resposta sem messageId` | Z-API recusou em silêncio (instância desconectada ou formato) | `GET /status` da instância; converter para OGG/Opus (passo 2) |
| Chega, mas como arquivo e não como mensagem de voz | MP3 enviado | converter para OGG/Opus mono (passo 2) |

## 2. Formato certo para mensagem de voz
WhatsApp toca como "mensagem de voz" (bolinha azul, onda) só **OGG com codec Opus, mono**. Converta o MP3 antes de enviar:

```ts
// src/agent/toOggOpus.ts — precisa de ffmpeg no container (apt ffmpeg ou pacote ffmpeg-static)
import { spawn } from 'node:child_process';
export function mp3ParaOggOpus(mp3: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn(process.env.FFMPEG_PATH || 'ffmpeg',
      ['-hide_banner','-loglevel','error','-i','pipe:0','-ac','1','-ar','48000','-c:a','libopus','-b:a','32k','-f','ogg','pipe:1']);
    const out: Buffer[] = []; const err: Buffer[] = [];
    ff.stdout.on('data', d => out.push(d)); ff.stderr.on('data', d => err.push(d));
    ff.on('error', reject);
    ff.on('close', c => c === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${c}: ${Buffer.concat(err)}`)));
    ff.stdin.end(mp3);
  });
}
```
Em `enviarAudioTTS`: `const ogg = await mp3ParaOggOpus(audioBuf); sendAudio(to, 'data:audio/ogg;base64,' + ogg.toString('base64'))`. Se o ffmpeg falhar, mande o MP3 mesmo (não derrube o aviso).

- **Z-API**: `POST /send-audio` `{ phone, audio: "data:audio/ogg;base64,...", waveform: true }`.
- **WhatsApp Cloud API**: subir o arquivo em `POST /{phone_id}/media` com `type=audio/ogg` e depois `messages` `{type:"audio", audio:{id}}`. Só OGG/Opus vira mensagem de voz; mp3/aac/amr/mp4 aceitos como arquivo. Máx. 16 MB.

## 3. Regras do aviso (PA e demais)
- Sempre mandar **texto + áudio**: se o áudio falhar, o texto já foi; registre o erro, não repita em loop.
- Número de destino com DDI 55 (`normalizarTelefone`). Envio individual com controle humano; nada de disparo em massa.
- Texto do TTS sem emoji, sem URL longa e sem abreviação (a voz lê "R$" mal: escreva "reais").
- Teste local: `node -e "require('./dist/agent/speak').speak('teste').then(b=>console.log(b.length))"` deve dar > 1000 bytes.

## 4. Verificação antes de entregar
- [ ] linha de erro do log identificada e corrigida
- [ ] `npm run typecheck` e `npm test` da área
- [ ] áudio de teste recebido no WhatsApp do José como mensagem de voz
- [ ] bump de versão no `package.json` no mesmo commit (regra do CLAUDE.md)
