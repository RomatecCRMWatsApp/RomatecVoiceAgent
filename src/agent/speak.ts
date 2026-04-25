import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

export async function speak(text: string): Promise<Buffer> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB';

  const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
    text,
    modelId: 'eleven_multilingual_v2',
    voiceSettings: {
      stability: 0.5,
      similarityBoost: 0.75,
    },
  });

  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
