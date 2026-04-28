// Pipeline de ingestao de contrato modelo no banco vetorial — v1.27.1
// Aceita PDF (Buffer), DOCX (Buffer) ou texto puro. Para DOCX usa mammoth,
// para PDF reusa a logica do RAG (PDFParse v2). Apos extracao:
//   1) sanitiza texto pra Postgres (NUL, ctrl, surrogates, NFC)
//   2) valida qualidade (rejeita gibberish)
//   3) Claude segmenta em clausulas + extrai tipo + resumo
//   4) Voyage embeddings (resumo + cada clausula) — reusa gerarEmbeddings do RAG
//   5) salva contratos_indexados + clausulas_juridicas com dedup hash SHA-256

import crypto from 'crypto';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { supabase } from './supabase';
import { gerarEmbeddings, gerarEmbeddingUnico } from './embeddings';
import { sanitizarParaPostgres, validarQualidadeTexto } from './textSanitize';
import { segmentarContrato } from './contratosSegmentar';

export type FonteArquivo = 'pdf' | 'docx' | 'texto';

export interface ContratoIngestInput {
  buffer?:      Buffer;          // se PDF/DOCX
  texto?:       string;          // se ja tiver texto puro
  fonteArquivo: FonteArquivo;
  tituloHint?:  string;          // se vier sem titulo, gera default
  arquivoNome?: string;
  fonte?:       string;          // 'cli' | 'web' | 'voz' (default 'web')
  tipoForcado?: string;          // se quiser sobrescrever o tipo detectado pelo Claude
  metadata?:    Record<string, unknown>;
}

export interface ContratoIngestResult {
  ja_existia:       boolean;
  contrato_id:      string;
  titulo:           string;
  tipo:             string;
  resumo:           string;
  total_clausulas:  number;
  secoes:           Record<string, number>;   // contagem por secao
}

async function extrairTexto(input: ContratoIngestInput): Promise<{ texto: string; paginas: number }> {
  if (input.fonteArquivo === 'texto') {
    return { texto: input.texto || '', paginas: 0 };
  }
  if (!input.buffer) throw new Error('Buffer obrigatorio pra fonte ' + input.fonteArquivo);

  if (input.fonteArquivo === 'pdf') {
    const parser = new PDFParse({ data: input.buffer });
    try {
      const r = await parser.getText();
      return { texto: r.text || '', paginas: r.total || 0 };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  if (input.fonteArquivo === 'docx') {
    const r = await mammoth.extractRawText({ buffer: input.buffer });
    return { texto: r.value || '', paginas: 0 };
  }
  throw new Error(`Fonte desconhecida: ${input.fonteArquivo}`);
}

export async function indexarContratoModelo(input: ContratoIngestInput): Promise<ContratoIngestResult> {
  const t0 = Date.now();
  const tituloPreliminar = input.tituloHint || input.arquivoNome || 'Contrato sem título';
  const tag = `[contratos] ${tituloPreliminar.slice(0, 40)}`;
  const sb  = supabase();

  // Hash baseado no buffer (se houver) ou no texto (pra dedup confiavel)
  const hashSrc = input.buffer ?? Buffer.from(input.texto || '', 'utf8');
  const hash    = crypto.createHash('sha256').update(hashSrc).digest('hex');
  console.log(`${tag} ▶ start fonte=${input.fonteArquivo} ${(hashSrc.length/1024).toFixed(1)}KB hash=${hash.slice(0,12)}`);

  // Dedup
  const existing = await sb
    .from('contratos_indexados')
    .select('id, titulo, tipo, resumo, total_clausulas')
    .eq('hash_sha256', hash)
    .maybeSingle();
  if (existing.data) {
    console.log(`${tag} ↩ duplicado (já existe id=${existing.data.id})`);
    return {
      ja_existia:      true,
      contrato_id:     existing.data.id as string,
      titulo:          existing.data.titulo as string,
      tipo:            (existing.data.tipo as string) || 'outro',
      resumo:          (existing.data.resumo as string) || '',
      total_clausulas: existing.data.total_clausulas as number,
      secoes:          {},
    };
  }

  // 1) Extrai texto bruto
  const { texto: textoBruto, paginas } = await extrairTexto(input);
  if (!textoBruto || textoBruto.trim().length < 100) {
    throw new Error('Contrato sem texto extraível suficiente (<100 chars). Pode ser PDF imagem — precisa OCR.');
  }
  console.log(`${tag} 📄 extraido ${paginas} pgs, ${textoBruto.length} chars (+${Date.now()-t0}ms)`);

  // 2) Sanitiza + valida qualidade
  const texto = sanitizarParaPostgres(textoBruto);
  const qual  = validarQualidadeTexto(texto);
  console.log(`${tag} 🔍 qualidade ${(qual.ratio*100).toFixed(0)}% (+${Date.now()-t0}ms)`);
  if (!qual.ok) throw new Error(qual.motivo!);

  // 3) Segmenta via Claude
  const seg = await segmentarContrato(texto);
  console.log(`${tag} ✂ segmentado ${seg.clausulas.length} clausulas (tipo=${seg.tipo}) (+${Date.now()-t0}ms)`);
  if (seg.clausulas.length === 0) throw new Error('Segmentador nao retornou nenhuma clausula');

  // 4) Embeddings: resumo + cada clausula
  const tipoFinal = input.tipoForcado || seg.tipo;
  const resumoEmb = await gerarEmbeddingUnico(seg.resumo || tituloPreliminar, 'document');
  const clauTexts = seg.clausulas.map(c =>
    sanitizarParaPostgres(`[${c.secao}] ${c.titulo_clausula}\n${c.texto}`)
  );
  const clauEmbs  = await gerarEmbeddings(clauTexts, 'document');
  console.log(`${tag} 🧠 embeddings: 1 resumo + ${clauEmbs.length} clausulas (+${Date.now()-t0}ms)`);

  // 5) Insere contrato
  const tituloFinal = input.tituloHint || input.arquivoNome?.replace(/\.(pdf|docx)$/i, '') || `Contrato ${tipoFinal}`;
  const docInsert = await sb
    .from('contratos_indexados')
    .insert({
      titulo:           tituloFinal,
      tipo:             tipoFinal,
      fonte:            input.fonte || 'web',
      arquivo_nome:     input.arquivoNome || null,
      hash_sha256:      hash,
      texto_completo:   texto,
      resumo:           seg.resumo,
      resumo_embedding: resumoEmb,
      total_clausulas:  seg.clausulas.length,
      metadata:         input.metadata || {},
    })
    .select('id')
    .single();
  if (docInsert.error || !docInsert.data) {
    throw new Error(`Falha ao inserir contrato: ${docInsert.error?.message}`);
  }
  const contratoId = docInsert.data.id as string;
  console.log(`${tag} 💾 contrato inserido id=${contratoId.slice(0,8)} (+${Date.now()-t0}ms)`);

  // 5b) Insere clausulas em batches
  const rows = seg.clausulas.map((c, i) => ({
    contrato_id:     contratoId,
    ordem:           c.ordem,
    secao:           c.secao,
    titulo_clausula: c.titulo_clausula,
    texto:           sanitizarParaPostgres(c.texto),
    embedding:       clauEmbs[i],
    metadata:        {},
  }));
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const ins = await sb.from('clausulas_juridicas').insert(slice);
    if (ins.error) {
      console.error(`${tag} ❌ insert clausulas ${i}-${i+slice.length}: ${ins.error.message}`);
      await sb.from('contratos_indexados').delete().eq('id', contratoId);
      throw new Error(`Falha ao inserir clausulas: ${ins.error.message}`);
    }
  }

  // Conta secoes pra retorno
  const secoes: Record<string, number> = {};
  for (const c of seg.clausulas) secoes[c.secao] = (secoes[c.secao] || 0) + 1;

  console.log(`${tag} ✅ ok ${seg.clausulas.length} clausulas em ${Date.now()-t0}ms`);
  return {
    ja_existia:      false,
    contrato_id:     contratoId,
    titulo:          tituloFinal,
    tipo:            tipoFinal,
    resumo:          seg.resumo,
    total_clausulas: seg.clausulas.length,
    secoes,
  };
}

export async function listarContratosIndexados() {
  const sb = supabase();
  const r = await sb
    .from('contratos_indexados')
    .select('id, titulo, tipo, fonte, arquivo_nome, total_clausulas, criado_em')
    .order('criado_em', { ascending: false })
    .limit(500);
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export async function apagarContratoIndexado(id: string) {
  const sb = supabase();
  const r = await sb.from('contratos_indexados').delete().eq('id', id);
  if (r.error) throw new Error(r.error.message);
  return { id, removed: true };
}

export function detectarFonteArquivoPorMime(mime: string): FonteArquivo | null {
  const m = mime.toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('wordprocessingml') || m.includes('officedocument') || m.endsWith('docx')) return 'docx';
  if (m.startsWith('text/')) return 'texto';
  return null;
}
