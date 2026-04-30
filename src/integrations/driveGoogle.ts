// v1.46.0 — Google Drive integrado.
// Compartilha o mesmo OAuth do Calendar (GOOGLE_REFRESH_TOKEN). Se o refresh
// token foi gerado SÓ com scope calendar, o Chefe precisa reautorizar incluindo
// o scope drive.file. A função getAuthUrl() já inclui ambos abaixo.
//
// Uso típico:
//   await uploadArquivo({ buffer, filename: 'PTAM-Joao.docx', pasta: 'Romatec/Avaliacoes' })
//   → cria pasta se não existir, sobe o arquivo, retorna { id, webViewLink, downloadUrl }

import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { Readable } from 'stream';

const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

function makeClient(): OAuth2Client {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/auth/google/callback',
  );
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  }
  return client;
}

function driveClient() {
  return google.drive({ version: 'v3', auth: makeClient() });
}

// URL de autorização incluindo Calendar + Drive (chamada uma vez).
export function getDriveAuthUrl(): string {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/auth/google/callback',
  );
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar', ...DRIVE_SCOPES],
    prompt: 'consent',
  });
}

// ── Pasta: cria/encontra recursivamente ─────────────────────────────────────
// Caminhos com "/" → cria árvore (Romatec/Avaliacoes → cria Romatec, depois Avaliacoes dentro).
export async function ensurePasta(caminho: string, parentId?: string): Promise<string> {
  const drive = driveClient();
  const partes = caminho.split('/').map(p => p.trim()).filter(Boolean);
  let parent = parentId ?? 'root';
  for (const nome of partes) {
    const q = `name='${nome.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
    const r = await drive.files.list({ q, fields: 'files(id,name)', pageSize: 1 });
    if (r.data.files && r.data.files.length > 0) {
      parent = r.data.files[0].id!;
      continue;
    }
    const created = await drive.files.create({
      requestBody: {
        name: nome,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parent],
      },
      fields: 'id',
    });
    parent = created.data.id!;
  }
  return parent;
}

// ── Upload ──────────────────────────────────────────────────────────────────
export interface DriveFile {
  id:           string;
  name:         string;
  mimeType:     string;
  webViewLink?: string;
  webContentLink?: string;
  size?:        string;
  createdTime?: string;
  pasta?:       string;
}

export async function uploadArquivo(input: {
  buffer:    Buffer;
  filename:  string;
  pasta?:    string;     // ex: 'Romatec/Avaliacoes' (default: raiz)
  mimeType?: string;     // detectado por extensão se omitido
  publico?:  boolean;    // se true, gera link público
}): Promise<DriveFile> {
  if (!input.buffer || input.buffer.length === 0) throw new Error('Drive: buffer vazio.');
  if (!input.filename) throw new Error('Drive: filename obrigatório.');

  const drive = driveClient();
  const parents = input.pasta ? [await ensurePasta(input.pasta)] : undefined;
  const mime = input.mimeType ?? guessMime(input.filename);

  const r = await drive.files.create({
    requestBody: { name: input.filename, parents },
    media: { mimeType: mime, body: Readable.from(input.buffer) },
    fields: 'id,name,mimeType,webViewLink,webContentLink,size,createdTime',
  });

  if (input.publico) {
    await drive.permissions.create({
      fileId: r.data.id!,
      requestBody: { role: 'reader', type: 'anyone' },
    });
    // Refetch pra pegar webViewLink atualizado
    const r2 = await drive.files.get({
      fileId: r.data.id!,
      fields: 'id,name,mimeType,webViewLink,webContentLink,size,createdTime',
    });
    return mapFile(r2.data, input.pasta);
  }

  return mapFile(r.data, input.pasta);
}

// ── Listar / buscar ─────────────────────────────────────────────────────────
export async function listarArquivos(opts?: {
  pasta?:  string;
  query?:  string;
  limite?: number;
}): Promise<DriveFile[]> {
  const drive = driveClient();
  const limit = opts?.limite ?? 30;

  const filtros: string[] = ['trashed=false'];
  if (opts?.pasta) {
    const folderId = await ensurePasta(opts.pasta);
    filtros.push(`'${folderId}' in parents`);
  }
  if (opts?.query) {
    const q = opts.query.replace(/'/g, "\\'");
    filtros.push(`(name contains '${q}' or fullText contains '${q}')`);
  }

  const r = await drive.files.list({
    q: filtros.join(' and '),
    fields: 'files(id,name,mimeType,webViewLink,webContentLink,size,createdTime,parents)',
    pageSize: limit,
    orderBy: 'createdTime desc',
  });

  return (r.data.files ?? []).map(f => mapFile(f, opts?.pasta));
}

export async function buscarPorNome(nome: string, limite = 10): Promise<DriveFile[]> {
  return listarArquivos({ query: nome, limite });
}

// ── Download ────────────────────────────────────────────────────────────────
export async function baixarArquivo(fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const drive = driveClient();
  const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType' });
  const r = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  return {
    buffer:   Buffer.from(r.data as ArrayBuffer),
    mimeType: meta.data.mimeType ?? 'application/octet-stream',
    name:     meta.data.name ?? fileId,
  };
}

// ── Apagar ──────────────────────────────────────────────────────────────────
export async function apagarArquivo(fileId: string): Promise<{ id: string; apagado: boolean }> {
  const drive = driveClient();
  await drive.files.delete({ fileId });
  return { id: fileId, apagado: true };
}

// ── Compartilhar (link público ou e-mail específico) ────────────────────────
export async function compartilharArquivo(input: {
  fileId: string;
  email?: string; // se omitido, gera link "anyone with link"
  role?:  'reader' | 'writer' | 'commenter';
}): Promise<{ link?: string; permissionId: string }> {
  const drive = driveClient();
  const role = input.role ?? 'reader';

  const perm = await drive.permissions.create({
    fileId: input.fileId,
    requestBody: input.email
      ? { type: 'user', role, emailAddress: input.email }
      : { type: 'anyone', role },
    sendNotificationEmail: !!input.email,
  });

  const meta = await drive.files.get({ fileId: input.fileId, fields: 'webViewLink' });
  return { link: meta.data.webViewLink ?? undefined, permissionId: perm.data.id ?? '' };
}

// ── Status / quota ──────────────────────────────────────────────────────────
export async function statusDrive(): Promise<{
  online:        boolean;
  email?:        string;
  quotaTotal?:   string;
  quotaUsada?:   string;
  arquivosCount?: number;
}> {
  try {
    const drive = driveClient();
    const about = await drive.about.get({ fields: 'user(emailAddress),storageQuota(limit,usage)' });
    return {
      online:     true,
      email:      about.data.user?.emailAddress ?? undefined,
      quotaTotal: about.data.storageQuota?.limit ?? undefined,
      quotaUsada: about.data.storageQuota?.usage ?? undefined,
    };
  } catch (err) {
    console.warn('[drive.status]', (err as Error).message);
    return { online: false };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function mapFile(f: import('googleapis').drive_v3.Schema$File, pasta?: string): DriveFile {
  return {
    id:             f.id ?? '',
    name:           f.name ?? '',
    mimeType:       f.mimeType ?? '',
    webViewLink:    f.webViewLink ?? undefined,
    webContentLink: f.webContentLink ?? undefined,
    size:           f.size ?? undefined,
    createdTime:    f.createdTime ?? undefined,
    pasta,
  };
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    pdf:  'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc:  'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls:  'application/vnd.ms-excel',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt:  'text/plain',
    md:   'text/markdown',
    csv:  'text/csv',
    json: 'application/json',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    mp3:  'audio/mpeg',
    mp4:  'video/mp4',
    zip:  'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}
