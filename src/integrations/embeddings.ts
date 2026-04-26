import OpenAI from 'openai';

// OpenAI embeddings — text-embedding-3-small (1536 dim, ~$0.02/1M tokens).
// Lazy init pra não quebrar boot quando OPENAI_API_KEY ausente.
let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Embeddings: OPENAI_API_KEY não configurado.');
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

const MODEL = 'text-embedding-3-small';
const MAX_INPUT_CHARS = 8000; // ~2k tokens, dentro do limite de 8191 do model

export async function embed(text: string): Promise<number[]> {
  const truncated = (text || '').slice(0, MAX_INPUT_CHARS);
  if (!truncated.trim()) throw new Error('Embeddings: texto vazio.');
  const r = await client().embeddings.create({
    model: MODEL,
    input: truncated,
  });
  return r.data[0].embedding;
}

/** Cosine similarity entre dois vetores. Retorna [-1, 1]. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
