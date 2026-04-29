// TTS da ZAYRA — cascata: Edge TTS (gratuito, default) → OpenAI tts-1 (fallback).
// Edge TTS retorna MP3 24kHz 48kbps mono — formato leve, ideal pra streaming.
// Set TTS_PROVIDER=openai pra forçar OpenAI (caso queira voz nova/echo/etc).

import OpenAI from 'openai';
import { speakEdge } from './speakEdge';

const PROVIDER = (process.env.TTS_PROVIDER || 'edge').toLowerCase();
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

async function speakOpenAI(text: string): Promise<Buffer> {
  if (!openai) throw new Error('OPENAI_API_KEY não configurada');
  const mp3 = await openai.audio.speech.create({
    model: 'tts-1',
    voice: (process.env.OPENAI_TTS_VOICE as 'nova' | 'alloy' | 'echo' | 'fable' | 'onyx' | 'shimmer') || 'nova',
    input: text,
  });
  return Buffer.from(await mp3.arrayBuffer());
}

export async function speak(text: string): Promise<Buffer> {
  if (PROVIDER === 'openai') return speakOpenAI(text);

  try {
    const buf = await speakEdge(text);
    if (buf.length < 100) throw new Error('Edge TTS retornou áudio vazio');
    return buf;
  } catch (err) {
    console.warn('[TTS] Edge falhou, fallback OpenAI:', (err as Error).message);
    return speakOpenAI(text);
  }
}
