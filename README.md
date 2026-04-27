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

## Alarmes nativos no iPhone (v1.24.0+)

ZAYRA pode disparar alarmes nativos do iPhone via **ntfy.sh + Atalhos**.

### Configurar UMA vez (no iPhone do CEO)

1. **Definir tópico secreto** no Railway:
   ```env
   IOS_NTFY_TOPIC=zayra-romatec-XXXXXXXX   # string difícil de adivinhar
   IOS_NTFY_BASE=https://ntfy.sh
   ```
2. Instalar o app **ntfy** (App Store, grátis) → assinar o mesmo tópico do passo 1.
3. Criar Atalho **ZAYRA-Alarme** no app *Atalhos*:
   - Obter texto da entrada
   - Obter dicionário do texto
   - Obter valor da chave: `datetime`
   - Obter data formatada (do ISO 8601)
   - Criar alarme: horário = data acima, etiqueta = chave `titulo`
4. No app **ntfy** → tópico → ativar **"Abrir Click ao tocar"**.

A partir daí ZAYRA usa a tool `alarme_ios_criar` e o Atalho cria o alarme nativo automaticamente.

---

## Tools de expertise técnica (v1.24.0+)

ZAYRA passou a consultar APIs públicas gratuitas para responder com dados reais
em avaliação imobiliária, georreferenciamento e registro:

| Tool | Fonte |
|---|---|
| `cep_buscar` | ViaCEP |
| `bcb_indice` | Banco Central — SGS (IPCA, INCC, IGP-M, Selic, CUB) |
| `ibge_municipio` | IBGE Localidades |
| `geocodificar` | OpenStreetMap Nominatim |
| `norma_buscar` | DuckDuckGo Instant Answer (ABNT NBR, IT Bombeiros, INCRA) |
| `sigef_consulta_url` | SIGEF/INCRA |
| `sicar_consulta_url` | CAR/SICAR |

---

CEO: José Romário — Romatec Consultoria Imobiliária
# RomatecVoiceAgent
