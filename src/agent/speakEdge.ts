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
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const audioStream = tts.toStream(text, { rate: RATE, pitch: PITCH });

  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    audioStream.on('end',  () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
    setTimeout(() => reject(new Error('Edge TTS timeout (15s)')), 15_000);
  });
}
