// Edge TTS — voz da ZAYRA via Microsoft Edge (zero custo, sem API key).
// Vozes pt-BR neurais: pt-BR-FranciscaNeural (feminina, default ZAYRA),
// pt-BR-AntonioNeural (masculina), pt-BR-BrendaNeural, pt-BR-LeticiaNeural.
//
// Mais rápido e gratuito vs OpenAI tts-1 ($0.015/1k chars). Mesmo formato
// (MP3) — drop-in replacement no /voice endpoint.

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const VOICE = process.env.EDGE_TTS_VOICE || 'pt-BR-FranciscaNeural';
const RATE  = process.env.EDGE_TTS_RATE  || '0%';   // -50% a +200%
const PITCH = process.env.EDGE_TTS_PITCH || '0Hz';  // -50Hz a +50Hz

export async function speakEdge(text: string): Promise<Buffer> {
  if (!text?.trim()) throw new Error('Edge TTS: texto vazio');

  let tts: MsEdgeTTS;
  try {
    tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  } catch (err) {
    throw new Error(`Edge TTS setMetadata: ${(err as Error)?.message || String(err)}`);
  }

  let audioStream;
  try {
    audioStream = tts.toStream(text, { rate: RATE, pitch: PITCH });
  } catch (err) {
    throw new Error(`Edge TTS toStream: ${(err as Error)?.message || String(err)}`);
  }

  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const safeReject = (err: unknown) => {
      if (timer) clearTimeout(timer);
      // err pode vir undefined em alguns errors do msedge-tts → coage pra Error
      if (err instanceof Error) reject(err);
      else if (typeof err === 'string') reject(new Error(err));
      else reject(new Error(`Edge TTS stream error: ${JSON.stringify(err) || 'desconhecido'}`));
    };
    audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    audioStream.on('end',  () => { if (timer) clearTimeout(timer); resolve(Buffer.concat(chunks)); });
    audioStream.on('error', safeReject);
    timer = setTimeout(() => safeReject(new Error('Edge TTS timeout (15s)')), 15_000);
  });
}
