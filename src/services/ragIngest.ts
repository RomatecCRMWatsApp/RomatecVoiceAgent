// RAG ingest — v1.26.0
// Recebe PDF, divide em chunks de 1000 chars (overlap 200, prefere fim de frase),
// gera embeddings via Voyage, salva em Supabase rag_documentos + rag_chunks.
// Deduplicação via SHA-256: PDF identico não eh re-ingerido.

import crypto from 'crypto';
import { PDFParse } from 'pdf-parse';
import { supabase } from './supabase';
import { gerarEmbeddings } from './embeddings';
import { sanitizarParaPostgres, validarQualidadeTexto } from './textSanitize';

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
// IMPORTANTE: stride fixo (CHUNK_SIZE - CHUNK_OVERLAP) garante avanço
// monotônico do cursor — antes podia entrar em loop infinito quando o
// sentence-cut empurrava cut pra longe e o overlap voltava pro mesmo lugar.
function chunkearTexto(
  texto: string,
  paginaInicial: (cursor: number) => number,
): { conteudo: string; aproxPagina: number }[] {
  const out: { conteudo: string; aproxPagina: number }[] = [];
  const STRIDE = CHUNK_SIZE - CHUNK_OVERLAP; // avanço mínimo garantido
  if (texto.length === 0) return out;

  let cursor = 0;
  let safety = 100000; // hard cap contra qualquer loop bug
  while (cursor < texto.length && safety-- > 0) {
    const end = Math.min(cursor + CHUNK_SIZE, texto.length);
    let cut = end;
    // Tenta cortar em fim de frase no último 30% (só se tiver mais texto adiante)
    if (end < texto.length) {
      const tailStart = cursor + Math.floor(CHUNK_SIZE * 0.7);
      if (tailStart < end) {
        const tail = texto.slice(tailStart, end);
        const sentenceEnd = tail.search(/[.!?]\s|\n\n/);
        if (sentenceEnd > -1) cut = tailStart + sentenceEnd + 1;
      }
    }
    const piece = texto.slice(cursor, cut).trim();
    if (piece.length > 50) {
      out.push({ conteudo: piece, aproxPagina: paginaInicial(cursor) });
    }
    // Stride fixo — evita oscilação. Para se já cobriu o texto.
    if (cut >= texto.length) break;
    cursor += STRIDE;
  }
  if (safety <= 0) {
    console.warn('[chunkear] safety cap atingido — texto chunkado parcialmente');
  }
  return out;
}

function chunkear(texto: string): { conteudo: string; aproxPagina: number }[] {
  const pages = texto.split('\f');
  if (pages.length > 1) {
    // Tem form-feed — chunkeia por página
    const out: { conteudo: string; aproxPagina: number }[] = [];
    pages.forEach((pageText, pageIdx) => {
      const pageNum = pageIdx + 1;
      out.push(...chunkearTexto(pageText, () => pageNum));
    });
    return out;
  }
  // Sem form-feed — chunkeia linear, estima página por chars/3000
  return chunkearTexto(texto, cursor => Math.max(1, Math.floor(cursor / 3000) + 1));
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

  // Sanitiza texto pra Postgres TEXT (remove NUL, ctrl chars, surrogates,
  // normaliza NFC). Sem isso, PDFs com fontes embedded geram erro
  // 'unsupported Unicode escape sequence' no insert.
  texto = sanitizarParaPostgres(texto);

  // v1.26.8: valida qualidade ANTES de gravar. PDFs com CID fonts, assinatura
  // digital ou scanneados geram texto gibberish que polui a base vetorial.
  const qualidade = validarQualidadeTexto(texto);
  console.log(`${tag} 🔍 qualidade ratio=${(qualidade.ratio * 100).toFixed(0)}% (+${Date.now()-t0}ms)`);
  if (!qualidade.ok) {
    throw new Error(qualidade.motivo!);
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
