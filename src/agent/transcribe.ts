import OpenAI from 'openai';
import { TranscriptionResult } from '../types';
import fs from 'fs';

function makeClient() {
  if (process.env.GROQ_API_KEY) {
    return new OpenAI({
      apiKey:  process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function transcribeAudio(audioBuffer: Buffer, mimeType = 'audio/webm'): Promise<TranscriptionResult> {
  const client   = makeClient();
  const useGroq  = !!process.env.GROQ_API_KEY;
  const model    = useGroq
    ? (process.env.GROQ_WHISPER_MODEL ?? 'whisper-large-v3-turbo')
    : 'whisper-1';

  const tmpPath = `/tmp/voice_${Date.now()}.webm`;
  fs.writeFileSync(tmpPath, audioBuffer);

  try {
    const transcription = await client.audio.transcriptions.create({
      file:            fs.createReadStream(tmpPath),
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
    fs.unlinkSync(tmpPath);
  }
}
