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

export async function transcribeAudio(audioBuffer: Buffer, _mimeType = 'audio/webm'): Promise<TranscriptionResult> {
  const client   = makeClient();
  const useGroq  = !!process.env.GROQ_API_KEY;
  const model    = useGroq
    ? (process.env.GROQ_WHISPER_MODEL ?? 'whisper-large-v3-turbo')
    : 'whisper-1';

  // Usa tmpdir nativo do SO + nome unico (cripto random) — funciona em
  // Linux/Mac/Windows e evita colisão entre requisições simultâneas.
  const tmpPath = path.join(os.tmpdir(), `voice_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.webm`);

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
