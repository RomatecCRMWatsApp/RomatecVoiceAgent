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

## Memória vetorial RAG (v1.26.0+)

ZAYRA aprende com PDFs do Chefe (laudos, normas, contratos, manuais) e cita
trechos exatos com fonte. Stack: **Supabase pgvector + Voyage AI embeddings**.

### Setup inicial (uma vez)

1. **Criar projeto Supabase** (https://supabase.com): grátis até 500MB.
2. **Rodar SQL** no SQL Editor do Supabase:

```sql
create extension if not exists vector;

create table if not exists rag_documentos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  fonte text not null,
  categoria text,
  arquivo_nome text,
  hash_sha256 text unique,
  total_chunks int default 0,
  metadata jsonb default '{}'::jsonb,
  criado_em timestamptz default now()
);

create table if not exists rag_chunks (
  id bigserial primary key,
  documento_id uuid references rag_documentos(id) on delete cascade,
  chunk_index int not null,
  conteudo text not null,
  pagina int,
  embedding vector(1024) not null,
  criado_em timestamptz default now()
);

create index if not exists rag_chunks_embedding_idx
  on rag_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists rag_chunks_doc_idx on rag_chunks(documento_id);
create index if not exists rag_documentos_categoria_idx on rag_documentos(categoria);

create or replace function rag_buscar(
  query_embedding vector(1024),
  similarity_threshold float default 0.70,
  match_count int default 5,
  filtro_categoria text default null
)
returns table (
  chunk_id bigint, documento_id uuid, titulo text, categoria text,
  pagina int, conteudo text, similarity float
)
language sql stable
as $$
  select c.id, c.documento_id, d.titulo, d.categoria, c.pagina, c.conteudo,
         1 - (c.embedding <=> query_embedding) as similarity
  from rag_chunks c
  join rag_documentos d on d.id = c.documento_id
  where 1 - (c.embedding <=> query_embedding) > similarity_threshold
    and (filtro_categoria is null or d.categoria = filtro_categoria)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
```

3. **Variáveis no Railway**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
   `VOYAGE_API_KEY` (https://voyageai.com — 200M tokens/mês grátis).

### Como usar

| Forma | Como |
|---|---|
| **Web** | Acesse `/upload.html` na interface, faça upload do PDF |
| **WhatsApp** | Envie o PDF como anexo pra ZAYRA |
| **Telegram** | Envie o PDF como documento pra ZAYRA |
| **CLI (lote)** | `npm run rag:ingest-folder ./knowledge-pdfs` |

ZAYRA passa a buscar em RAG antes de responder qualquer pergunta técnica via
tool `memoria_buscar` (ver `tools.ts`). Quando encontra trecho com >70% de
relevância, cita com fonte e página.

---

## Geração de contratos com IA — Fase 1: indexação (v1.27.1+)

Sistema de IA jurídica que aprende com contratos modelo. Esta primeira fase
**indexa** contratos PDF/DOCX no banco vetorial — segmentando em cláusulas
autônomas reutilizáveis. Geração (Fases 2+) virá depois de a base estar boa.

### SQL adicional no Supabase (rodar UMA vez no SQL Editor)

```sql
create table if not exists contratos_indexados (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  tipo text,
  fonte text not null,
  arquivo_nome text,
  hash_sha256 text unique,
  texto_completo text not null,
  resumo text,
  resumo_embedding vector(1024) not null,
  total_clausulas int default 0,
  metadata jsonb default '{}'::jsonb,
  criado_em timestamptz default now()
);

create table if not exists clausulas_juridicas (
  id bigserial primary key,
  contrato_id uuid references contratos_indexados(id) on delete cascade,
  ordem int not null,
  secao text,
  titulo_clausula text,
  texto text not null,
  embedding vector(1024) not null,
  metadata jsonb default '{}'::jsonb,
  criado_em timestamptz default now()
);

create index if not exists clausulas_emb_idx
  on clausulas_juridicas using hnsw (embedding vector_cosine_ops);
create index if not exists clausulas_secao_idx on clausulas_juridicas(secao);
create index if not exists clausulas_contrato_idx on clausulas_juridicas(contrato_id);
create index if not exists contratos_resumo_emb_idx
  on contratos_indexados using hnsw (resumo_embedding vector_cosine_ops);
create index if not exists contratos_tipo_idx on contratos_indexados(tipo);

-- RLS off (mesmo padrão do RAG geral)
alter table contratos_indexados disable row level security;
alter table clausulas_juridicas disable row level security;

-- RPC pra busca de cláusulas por similaridade (uso futuro na Fase 2)
create or replace function contratos_buscar_clausulas(
  query_embedding vector(1024),
  similarity_threshold float default 0.55,
  match_count int default 8,
  filtro_secao text default null,
  filtro_tipo  text default null
)
returns table (
  clausula_id bigint, contrato_id uuid, contrato_titulo text, contrato_tipo text,
  ordem int, secao text, titulo_clausula text, texto text, similarity float
)
language sql stable
as $$
  select c.id, c.contrato_id, ci.titulo, ci.tipo,
         c.ordem, c.secao, c.titulo_clausula, c.texto,
         1 - (c.embedding <=> query_embedding) as similarity
  from clausulas_juridicas c
  join contratos_indexados ci on ci.id = c.contrato_id
  where 1 - (c.embedding <=> query_embedding) > similarity_threshold
    and (filtro_secao is null or c.secao = filtro_secao)
    and (filtro_tipo  is null or ci.tipo = filtro_tipo)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
```

### Endpoints

| Método | Rota | Função |
|---|---|---|
| POST | `/contracts/index` | Indexa PDF/DOCX (multipart `arquivo`) ou JSON `{texto, titulo}` |
| GET | `/contracts/indexados` | Lista contratos modelo |
| DELETE | `/contracts/indexados/:id` | Remove contrato modelo |

### CLI

```bash
# Aceita PDF ou DOCX. Usa o servidor remoto (sem credenciais Supabase locais).
npm run contracts:ingest "C:/path/contrato.pdf"
npm run contracts:ingest "C:/path/contrato.docx" "Compra e venda Lote 14"
```

Pipeline: extract texto (pdf-parse ou mammoth) → sanitize → valida qualidade →
**Claude Sonnet segmenta em cláusulas + extrai tipo + resumo** → Voyage gera
embeddings (resumo + cada cláusula) → Supabase salva tudo. Dedup via SHA-256.

---

CEO: José Romário — Romatec Consultoria Imobiliária
# RomatecVoiceAgent
