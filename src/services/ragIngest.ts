// RAG ingest — v1.26.0
// Recebe PDF, divide em chunks de 1000 chars (overlap 200, prefere fim de frase),
// gera embeddings via Voyage, salva em Supabase rag_documentos + rag_chunks.
// Deduplicação via SHA-256: PDF identico não eh re-ingerido.

import crypto from 'crypto';
import { PDFParse } from 'pdf-parse';
import { supabase } from './supabase';
import { gerarEmbeddings } from './embeddings';

const CHUNK_SIZE    = 1000;
const CHUNK_OVERLAP = 200;

export interface IngestInput {
  pdfBuffer:   Buffer;
  titulo:      string;
  fonte:       string;          // 'whatsapp' | 'telegram' | 'web' | 'cli' | etc.
  categoria?:  string;          // 'norma' | 'laudo' | 'contrato' | 'manual' | 'outro'
  arquivoNome?: string;
  metadata?:   Record<string, unknown>;
}

export interface IngestResult {
  ja_existia:        boolean;
  documento_id:      string;
  titulo:            string;
  chunks_inseridos:  number;
  paginas:           number;
}

interface Chunk {
  index:    number;
  conteudo: string;
  pagina:   number;
}

// Quebra texto em chunks de ~CHUNK_SIZE chars com overlap, preferindo quebra
// em fim de frase (.!?\n) pra não cortar argumentos no meio.
function chunkear(texto: string): { conteudo: string; aproxPagina: number }[] {
  const out: { conteudo: string; aproxPagina: number }[] = [];
  // Aproximar páginas: pdf-parse retorna texto contínuo. Usamos quebras
  // \f (form-feed) ou contagem grosseira de chars/3000 = 1 página.
  const pages = texto.split('\f');
  let cursor = 0;

  if (pages.length > 1) {
    // Tem form-feed — chunkear por página, respeitando size
    pages.forEach((pageText, pageIdx) => {
      const pageNum = pageIdx + 1;
      let i = 0;
      while (i < pageText.length) {
        const end = Math.min(i + CHUNK_SIZE, pageText.length);
        // tenta cortar em fim de frase no último 30% do chunk
        let cut = end;
        if (end < pageText.length) {
          const tail = pageText.slice(i + Math.floor(CHUNK_SIZE * 0.7), end);
          const sentenceEnd = tail.search(/[.!?]\s|\n\n/);
          if (sentenceEnd > -1) cut = i + Math.floor(CHUNK_SIZE * 0.7) + sentenceEnd + 1;
        }
        const piece = pageText.slice(i, cut).trim();
        if (piece.length > 50) out.push({ conteudo: piece, aproxPagina: pageNum });
        i = cut - CHUNK_OVERLAP;
        if (i <= 0 || i >= pageText.length) break;
      }
    });
  } else {
    // Sem form-feed — chunkear linear, calcular página aproximada
    while (cursor < texto.length) {
      const end = Math.min(cursor + CHUNK_SIZE, texto.length);
      let cut = end;
      if (end < texto.length) {
        const tail = texto.slice(cursor + Math.floor(CHUNK_SIZE * 0.7), end);
        const sentenceEnd = tail.search(/[.!?]\s|\n\n/);
        if (sentenceEnd > -1) cut = cursor + Math.floor(CHUNK_SIZE * 0.7) + sentenceEnd + 1;
      }
      const piece = texto.slice(cursor, cut).trim();
      if (piece.length > 50) {
        const aproxPagina = Math.max(1, Math.floor(cursor / 3000) + 1);
        out.push({ conteudo: piece, aproxPagina });
      }
      cursor = cut - CHUNK_OVERLAP;
      if (cursor <= 0 || cursor >= texto.length) break;
    }
  }
  return out;
}

export async function ingerirPdf(input: IngestInput): Promise<IngestResult> {
  const t0   = Date.now();
  const tag  = `[rag] ${input.titulo.slice(0, 40)}`;
  const sb   = supabase();
  const hash = crypto.createHash('sha256').update(input.pdfBuffer).digest('hex');
  console.log(`${tag} ▶ start fonte=${input.fonte} ${(input.pdfBuffer.length/1024).toFixed(1)}KB hash=${hash.slice(0,12)}`);

  // Dedup
  const existing = await sb
    .from('rag_documentos')
    .select('id, titulo, total_chunks')
    .eq('hash_sha256', hash)
    .maybeSingle();

  if (existing.data) {
    console.log(`${tag} ↩ duplicado (já existe id=${existing.data.id})`);
    return {
      ja_existia:       true,
      documento_id:     existing.data.id as string,
      titulo:           existing.data.titulo as string,
      chunks_inseridos: 0,
      paginas:          0,
    };
  }

  // Extrai texto do PDF — pdf-parse v2 API
  const parser = new PDFParse({ data: input.pdfBuffer });
  let texto = '';
  let paginas = 0;
  try {
    const result = await parser.getText();
    texto   = result.text || '';
    paginas = result.total || 0;
  } catch (err) {
    throw new Error(`PDFParse falhou: ${(err as Error).message}`);
  } finally {
    await parser.destroy().catch(() => {});
  }
  console.log(`${tag} 📄 parsed ${paginas} pgs, ${texto.length} chars (+${Date.now()-t0}ms)`);
  if (!texto || texto.trim().length < 20) {
    throw new Error('PDF sem texto extraível (pode ser imagem escaneada — precisa OCR)');
  }

  const chunks = chunkear(texto);
  console.log(`${tag} ✂ chunks=${chunks.length} (+${Date.now()-t0}ms)`);
  if (chunks.length === 0) throw new Error('Nenhum chunk gerado a partir do PDF');

  // Embeddings em batch ANTES de inserir doc (se Voyage falhar, não deixa doc órfão)
  let embeddings: number[][];
  try {
    embeddings = await gerarEmbeddings(chunks.map(c => c.conteudo), 'document');
    console.log(`${tag} 🧠 embeddings=${embeddings.length} (+${Date.now()-t0}ms)`);
  } catch (err) {
    throw new Error(`Embeddings falharam: ${(err as Error).message}`);
  }

  // Insere documento
  const docInsert = await sb
    .from('rag_documentos')
    .insert({
      titulo:       input.titulo,
      fonte:        input.fonte,
      categoria:    input.categoria || 'outro',
      arquivo_nome: input.arquivoNome || null,
      hash_sha256:  hash,
      total_chunks: chunks.length,
      metadata:     input.metadata || {},
    })
    .select('id')
    .single();

  if (docInsert.error || !docInsert.data) {
    throw new Error(`Falha ao inserir documento: ${docInsert.error?.message}`);
  }
  const documentoId = docInsert.data.id as string;
  console.log(`${tag} 💾 doc inserido id=${documentoId.slice(0,8)} (+${Date.now()-t0}ms)`);

  const insertRows = chunks.map((c, i) => ({
    documento_id: documentoId,
    chunk_index:  i,
    conteudo:     c.conteudo,
    pagina:       c.aproxPagina,
    embedding:    embeddings[i],
  }));

  // Insere chunks em batches de 100 (limite gentil pra payload Supabase)
  const BATCH = 100;
  for (let i = 0; i < insertRows.length; i += BATCH) {
    const slice = insertRows.slice(i, i + BATCH);
    const ins = await sb.from('rag_chunks').insert(slice);
    if (ins.error) {
      console.error(`${tag} ❌ chunk insert ${i}-${i+slice.length}: ${ins.error.message}`);
      // rollback documento pra não deixar lixo
      await sb.from('rag_documentos').delete().eq('id', documentoId);
      throw new Error(`Falha ao inserir chunks: ${ins.error.message}`);
    }
  }
  console.log(`${tag} ✅ ok ${chunks.length} chunks gravados em ${Date.now()-t0}ms`);

  return {
    ja_existia:       false,
    documento_id:     documentoId,
    titulo:           input.titulo,
    chunks_inseridos: chunks.length,
    paginas,
  };
}

export async function listarDocumentos() {
  const sb = supabase();
  const r = await sb
    .from('rag_documentos')
    .select('id, titulo, fonte, categoria, arquivo_nome, total_chunks, criado_em')
    .order('criado_em', { ascending: false })
    .limit(500);
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export async function apagarDocumento(id: string) {
  const sb = supabase();
  const r = await sb.from('rag_documentos').delete().eq('id', id);
  if (r.error) throw new Error(r.error.message);
  return { id, removed: true };
}

export function detectarCategoria(nome: string): string {
  const n = nome.toLowerCase();
  if (/\b(nbr|abnt|norma)\b/.test(n))             return 'norma';
  if (/\b(laudo|ptam|avalia)\w*/.test(n))         return 'laudo';
  if (/\b(contrato|termo)\b/.test(n))             return 'contrato';
  if (/\b(manual|guia|tutorial|handbook)\b/.test(n)) return 'manual';
  return 'outro';
}
