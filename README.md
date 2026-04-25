# ZAYRA — Zona de Automação e Yield Romatec Agent

Assistente executiva de voz da **Romatec Consultoria Imobiliária**.

ZAYRA recebe comandos por voz ou texto, processa com IA (Claude Sonnet), executa ações nos sistemas CRM e AvalieImob, e responde em voz sintetizada (ElevenLabs).

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 18+ + TypeScript |
| Framework | Express |
| Transcrição | OpenAI Whisper-1 (PT-BR) |
| IA / Decisão | Anthropic Claude Sonnet 4.6 |
| Síntese de voz | ElevenLabs eleven_multilingual_v2 |
| Deploy | Railway (Nixpacks) |

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | /health | Status de ZAYRA |
| POST | /voice | Áudio → ZAYRA processa → áudio |
| POST | /text | Texto → ZAYRA processa → texto ou áudio |
| GET | /briefing | Resumo executivo do dia |

## Setup

```bash
cp .env.example .env
# preencha as API keys no .env

npm install
npm run dev
```

## Testar

```bash
# Health
curl http://localhost:3000/health

# Texto
curl -X POST http://localhost:3000/text \
  -H "Content-Type: application/json" \
  -d '{"message": "Quantos leads novos temos hoje?"}'

# Briefing do dia
curl http://localhost:3000/briefing
```

## Variáveis de ambiente

```env
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
CRM_BASE_URL=https://romateccrm.com
CRM_API_KEY=
AVALIEIMOB_BASE_URL=https://www.romatecavalieimob.com.br
AVALIEIMOB_API_KEY=
PORT=3000
```

## Deploy Railway

```bash
railway login
railway init
railway up
```

---

CEO: José Romário — RomaTec Consultoria Total
