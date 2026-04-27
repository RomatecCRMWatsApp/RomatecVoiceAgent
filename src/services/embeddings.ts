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
  const e = err as { status?: number; code?: string } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.status === 429) return true;
  if (typeof e.status === 'number' && e.status >= 500) return true;
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED') return true;
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
      return await embedViaVoyage(texts, inputType);
    } catch (err) {
      if (isFallbackable(err) && process.env.OPENAI_API_KEY) {
        console.warn(`[embeddings] Voyage falhou, fallback OpenAI: ${(err as Error).message}`);
        return await embedViaOpenAI(texts);
      }
      throw err;
    }
  }
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
