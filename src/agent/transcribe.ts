import OpenAI from 'openai';
import { TranscriptionResult } from '../types';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

function makeClient() {
  if (process.env.GROQ_API_KEY) {
    return new OpenAI({
      apiKey:  process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// v3.127.0: a extensão do arquivo temporário PRECISA bater com o formato real.
// Whisper (OpenAI e Groq) valida o container pela extensão do nome enviado —
// até aqui o mimeType chegava e era descartado, e TODO áudio virava ".webm":
// o ogg do Telegram/WhatsApp e o mp4 que o MediaRecorder do iPad gera entravam
// rotulados errado. Só as extensões aceitas pela API entram no mapa; o que não
// estiver mapeado cai em 'webm', o comportamento antigo.
const EXTENSAO_POR_MIME: Readonly<Record<string, string>> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/oga': 'oga',
  'audio/opus': 'ogg',
  'application/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'video/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

/**
 * Extensão do container a partir do mime. Tolera parâmetros ("audio/ogg;
 * codecs=opus" — como o WhatsApp manda) e caixa alta. Puro/testável.
 */
export function extensaoDeMime(mimeType?: string | null): string {
  const base = String(mimeType ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSAO_POR_MIME[base] ?? 'webm';
}

export async function transcribeAudio(audioBuffer: Buffer, mimeType = 'audio/webm'): Promise<TranscriptionResult> {
  const client   = makeClient();
  const useGroq  = !!process.env.GROQ_API_KEY;
  const model    = useGroq
    ? (process.env.GROQ_WHISPER_MODEL ?? 'whisper-large-v3-turbo')
    : 'whisper-1';

  // Usa tmpdir nativo do SO + nome unico (cripto random) — funciona em
  // Linux/Mac/Windows e evita colisão entre requisições simultâneas.
  const ext     = extensaoDeMime(mimeType);
  const tmpPath = path.join(os.tmpdir(), `voice_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`);

  let written = false;
  try {
    await fs.writeFile(tmpPath, audioBuffer);
    written = true;

    const transcription = await client.audio.transcriptions.create({
      file:            createReadStream(tmpPath),
      model,
      language:        'pt',
      response_format: 'verbose_json',
    });

    if (useGroq) {
      console.log(`[Transcribe] Groq Whisper (${model}) — "${transcription.text.substring(0, 40)}..."`);
    }

    return {
      text:     transcription.text,
      language: transcription.language,
      duration: transcription.duration,
    };
  } finally {
    // Cleanup garantido mesmo se a escrita ou a chamada falhar.
    if (written) {
      try { await fs.unlink(tmpPath); }
      catch (e) { console.warn('[Transcribe] cleanup falhou:', (e as Error).message); }
    }
  }
}
