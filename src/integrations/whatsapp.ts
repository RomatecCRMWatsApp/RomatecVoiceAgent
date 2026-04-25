import axios from 'axios';
import { transcribeAudio } from '../agent/transcribe';
import { think } from '../agent/think';

const CRM_BASE_URL = process.env.CRM_BASE_URL ?? 'https://romateccrm.com';
const CRM_API_KEY  = process.env.CRM_API_KEY  ?? '';

export interface WaTextMessage  { type: 'text';  from: string; id: string; text:  { body: string }; }
export interface WaAudioMessage { type: 'audio'; from: string; id: string; audio: { id: string; mime_type: string }; }
export type WaMessage = WaTextMessage | WaAudioMessage;

async function downloadAudio(audioId: string): Promise<Buffer> {
  const res = await axios.get<ArrayBuffer>(`${CRM_BASE_URL}/api/media/${audioId}`, {
    headers: { 'x-api-key': CRM_API_KEY },
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  return Buffer.from(res.data);
}

export async function sendReply(to: string, message: string): Promise<void> {
  await axios.post(
    `${CRM_BASE_URL}/api/messages/send`,
    { to, message, type: 'text' },
    { headers: { 'x-api-key': CRM_API_KEY }, timeout: 10000 },
  );
}

export async function processMessage(msg: WaMessage): Promise<string> {
  let userText: string;

  if (msg.type === 'audio') {
    const buf = await downloadAudio(msg.audio.id);
    const tx  = await transcribeAudio(buf, msg.audio.mime_type);
    userText  = tx.text;
  } else {
    userText = msg.text.body;
  }

  const resp = await think(userText);
  return resp.text;
}
