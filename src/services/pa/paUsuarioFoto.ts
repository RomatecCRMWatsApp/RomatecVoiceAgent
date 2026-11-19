// v3.192.0 — Foto do usuário (avatar no menu da Gestão de PA). O navegador recorta e reduz a imagem
// (320×320) antes de enviar; aqui só valida tipo/tamanho/assinatura e grava (uma foto por usuário).
import { PaErro } from './erros';
import { pool, one, exec } from './paDb';

const MAX_BYTES = 600 * 1024;
const TIPOS: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** "data:image/jpeg;base64,..." → { mime, buf } validado (pura — testável). */
export function lerImagemDataUrl(v: unknown): { mime: string; buf: Buffer } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(v ?? ''));
  if (!m) throw new PaErro('CAMPO_INVALIDO', 'Envie uma imagem JPG, PNG ou WebP', 400);
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new PaErro('ARQUIVO_VAZIO', 'Imagem vazia', 400);
  if (buf.length > MAX_BYTES) throw new PaErro('ARQUIVO_GRANDE', 'Imagem muito grande (máx. 600 KB)', 413);
  if (!TIPOS[m[1]](buf)) throw new PaErro('TIPO_ARQUIVO', 'O conteúdo não é uma imagem válida', 415);
  return { mime: m[1], buf };
}

export async function salvarFotoUsuario(usuarioId: string | null, imagem: unknown) {
  if (!usuarioId) throw new PaErro('SEM_USUARIO', 'Usuário não identificado', 401);
  const { mime, buf } = lerImagemDataUrl(imagem);
  await exec(pool, 'INSERT INTO pa_usuarios_foto (usuario_id, mime, conteudo) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE mime = VALUES(mime), conteudo = VALUES(conteudo), atualizado_em = NOW()', [usuarioId, mime, buf]);
  return { ok: true, tamanho: buf.length };
}
export async function fotoUsuario(usuarioId: string | null): Promise<{ mime: string; conteudo: Buffer } | null> {
  if (!usuarioId) return null;
  const r = await one<{ mime: string; conteudo: Buffer }>(pool, 'SELECT mime, conteudo FROM pa_usuarios_foto WHERE usuario_id = ?', [usuarioId]);
  return r?.conteudo ? r : null;
}
export async function removerFotoUsuario(usuarioId: string | null) {
  if (!usuarioId) throw new PaErro('SEM_USUARIO', 'Usuário não identificado', 401);
  await exec(pool, 'DELETE FROM pa_usuarios_foto WHERE usuario_id = ?', [usuarioId]);
  return { ok: true };
}
