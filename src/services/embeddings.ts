// Embeddings via Voyage AI (voyage-3, 1024d) — v1.26.0
// Free tier: 200M tokens/mês. Fallback automático pra OpenAI text-embedding-3-small
// (1536d, mas truncado pra 1024 via Matryoshka) se Voyage falhar 5xx/429/network.

import { VoyageAIClient } from 'voyageai';
import OpenAI from 'openai';

const VOYAGE_MODEL  = process.env.VOYAGE_MODEL || 'voyage-3';
const EMBED_DIM     = 1024;
const VOYAGE_BATCH  = 128; // limite oficial do Voyage por chamada

export type EmbedInputType = 'query' | 'document';

let _voyage: VoyageAIClient | null = null;
function voyage(): VoyageAIClient {
  if (!_voyage) _voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
  return _voyage;
}

let _openai: OpenAI | null = null;
function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function isFallbackable(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; code?: string; message?: string } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.status === 429 || e.statusCode === 429) return true;
  if (typeof e.status     === 'number' && e.status     >= 500) return true;
  if (typeof e.statusCode === 'number' && e.statusCode >= 500) return true;
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED') return true;
  // VoyageAI SDK lança Error com texto "Status code: 429" sem setar e.status.
  // Cobre também outras formas comuns de rate limit / quota / overload.
  if (typeof e.message === 'string' &&
      /status\s*code:?\s*(4(29|03)|5\d\d)|rate\s*limit|too many requests|quota|overloaded/i.test(e.message)) {
    return true;
  }
  return false;
}

// Voyage só aceita até 128 textos por chamada. Quebra em batches.
async function embedViaVoyage(texts: string[], inputType: EmbedInputType): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += VOYAGE_BATCH) {
    const slice = texts.slice(i, i + VOYAGE_BATCH);
    const r = await voyage().embed({
      input:     slice,
      model:     VOYAGE_MODEL,
      inputType: inputType,
    });
    if (!r.data) throw new Error('Voyage retornou data vazio');
    for (const d of r.data) {
      if (!d.embedding) throw new Error('Voyage retornou embedding vazio');
      out.push(d.embedding);
    }
  }
  return out;
}

// Fallback OpenAI — text-embedding-3-small com dimensions=1024 (Matryoshka).
async function embedViaOpenAI(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY ausente — fallback indisponível');
  }
  const r = await openai().embeddings.create({
    model:      'text-embedding-3-small',
    input:      texts,
    dimensions: EMBED_DIM,
  });
  return r.data.map(d => d.embedding);
}

export async function gerarEmbeddings(
  texts: string[],
  inputType: EmbedInputType = 'document',
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (process.env.VOYAGE_API_KEY) {
    try {
      const r = await embedViaVoyage(texts, inputType);
      console.log(`[embeddings] ✅ Voyage ${VOYAGE_MODEL} (${texts.length} textos)`);
      return r;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const fall = isFallbackable(err);
      if (fall && process.env.OPENAI_API_KEY) {
        console.warn(`[embeddings] ⚠️ Voyage falhou (${msg.slice(0, 120)}) — fallback OpenAI text-embedding-3-small`);
        const r = await embedViaOpenAI(texts);
        console.log(`[embeddings] ✅ OpenAI fallback ok (${texts.length} textos)`);
        return r;
      }
      if (fall && !process.env.OPENAI_API_KEY) {
        throw new Error(
          `Voyage 429/5xx e OPENAI_API_KEY ausente — sem fallback disponível. ` +
          `Adicione OPENAI_API_KEY no Railway OU adicione método de pagamento ` +
          `em https://dashboard.voyageai.com (sem custo extra: 200M tokens free continuam). ` +
          `Original: ${msg.slice(0, 200)}`
        );
      }
      throw err;
    }
  }
  console.log(`[embeddings] ✅ OpenAI (sem Voyage configurado, ${texts.length} textos)`);
  return await embedViaOpenAI(texts);
}

export async function gerarEmbeddingUnico(
  text: string,
  inputType: EmbedInputType = 'query',
): Promise<number[]> {
  const r = await gerarEmbeddings([text], inputType);
  return r[0];
}

export const EMBEDDING_DIM = EMBED_DIM;
