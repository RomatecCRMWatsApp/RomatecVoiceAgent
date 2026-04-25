import OpenAI from 'openai';
import { TranscriptionResult } from '../types';
import fs from 'fs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function transcribeAudio(audioBuffer: Buffer, mimeType = 'audio/webm'): Promise<TranscriptionResult> {
  const tmpPath = `/tmp/voice_${Date.now()}.webm`;
  fs.writeFileSync(tmpPath, audioBuffer);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-1',
      language: 'pt',
      response_format: 'verbose_json',
    });

    return {
      text: transcription.text,
      language: transcription.language,
      duration: transcription.duration,
    };
  } finally {
    fs.unlinkSync(tmpPath);
  }
}
