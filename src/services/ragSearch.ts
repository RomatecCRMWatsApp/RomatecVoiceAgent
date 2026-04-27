// RAG search — v1.26.0
// Busca semântica nos chunks via RPC rag_buscar() do Supabase (HNSW + cosine).

import { supabase } from './supabase';
import { gerarEmbeddingUnico } from './embeddings';

const DEFAULT_TOP_K     = parseInt(process.env.RAG_TOP_K || '5', 10);
// v1.26.9: 0.70 estava conservador demais — chunks reais em portugues tecnico
// ficam tipicamente em 0.55-0.65. 0.50 captura material relevante sem trazer
// ruido. Testes empiricos: query 'o que é contrato' retorna trechos com sim
// 0.57-0.59 — todos contextualmente certos.
const DEFAULT_THRESHOLD = parseFloat(process.env.RAG_MIN_SIMILARITY || '0.50');

export interface BuscarOpts {
  top_k?:     number;
  min_sim?:   number;
  categoria?: string;
}

export interface ChunkResult {
  chunk_id:     number;
  documento_id: string;
  titulo:       string;
  categoria:    string | null;
  pagina:       number | null;
  conteudo:     string;
  similarity:   number;
}

export async function buscarMemoria(query: string, opts: BuscarOpts = {}): Promise<ChunkResult[]> {
  const top_k     = opts.top_k     ?? DEFAULT_TOP_K;
  const min_sim   = opts.min_sim   ?? DEFAULT_THRESHOLD;
  const categoria = opts.categoria ?? null;

  const embedding = await gerarEmbeddingUnico(query, 'query');

  const sb = supabase();
  const r = await sb.rpc('rag_buscar', {
    query_embedding:      embedding,
    similarity_threshold: min_sim,
    match_count:          top_k,
    filtro_categoria:     categoria,
  });

  if (r.error) throw new Error(`rag_buscar falhou: ${r.error.message}`);
  return (r.data ?? []) as ChunkResult[];
}

export function formatarContexto(resultados: ChunkResult[]): string {
  if (resultados.length === 0) {
    return 'Nada relevante encontrado na memória — responda por conhecimento geral, mas avise o Chefe que não havia nada na biblioteca.';
  }
  const blocos = resultados.map((r, i) => {
    const pct = Math.round(r.similarity * 100);
    const pg  = r.pagina ? `, p.${r.pagina}` : '';
    return `[${i + 1}] ${r.titulo}${pg} (relevância ${pct}%)\n${r.conteudo.trim()}`;
  });
  return blocos.join('\n\n---\n\n');
}
