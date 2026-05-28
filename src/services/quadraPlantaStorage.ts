// v3.31.0: storage de plantas individuais por quadra. Filesystem local com
// hierarquia `./storage/loteamentos/{lotId}/quadras/{quadraId}/`.
//
// Decisoes:
//   - Pasta absoluta derivada de process.cwd() + STORAGE_ROOT env override.
//   - Hash SHA-256 calculado por buffer (anti-replay + integridade).
//   - Naming padronizado: planta.{ext}. Arquivo anterior vai pra
//     _backup_{timestamp}.{ext} (retencao informal 7 dias — janitor e' follow-up).
//   - Validacao por MAGIC BYTES (nao confiar em extensao):
//       DXF: header "0\nSECTION" (ASCII) OU bytes do DXF binario (AC10*).
//       DWG: AC10\d{2} (formato Autodesk).
//       PDF: %PDF-.
//
// Servico standalone — sem deps de mysql/pdfkit. Inje├p├p├o de fs via opts.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type FormatoPlanta = 'dxf' | 'dwg' | 'pdf';

export const LIMITES_BYTES: Record<FormatoPlanta, number> = {
  dxf: 50 * 1024 * 1024,
  dwg: 80 * 1024 * 1024,
  pdf: 30 * 1024 * 1024,
};

export function storageRoot(): string {
  return process.env.STORAGE_ROOT || path.join(process.cwd(), 'storage');
}

export function caminhoDir(loteamentoId: number, quadraId: number): string {
  return path.join(storageRoot(), 'loteamentos', String(loteamentoId), 'quadras', String(quadraId));
}

export function caminhoArquivo(loteamentoId: number, quadraId: number, formato: FormatoPlanta): string {
  return path.join(caminhoDir(loteamentoId, quadraId), `planta.${formato}`);
}

export function caminhoRelativo(loteamentoId: number, quadraId: number, formato: FormatoPlanta): string {
  // Caminho RELATIVO ao storage root — guardado no DB (permite migrar storage no futuro).
  return path.join('loteamentos', String(loteamentoId), 'quadras', String(quadraId), `planta.${formato}`).replace(/\\/g, '/');
}

export function calcularSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Validacao de magic bytes. Lanca Error com mensagem clara se invalido.
export function validarMagicBytes(buffer: Buffer, formato: FormatoPlanta): void {
  if (formato === 'pdf') {
    const head = buffer.subarray(0, 5).toString('ascii');
    if (head !== '%PDF-') throw new Error('PDF invalido: header %PDF- ausente');
    return;
  }
  if (formato === 'dxf') {
    // DXF ASCII: comeca com "0\r?\nSECTION" (ou variacoes). Tolerar BOM.
    const head = buffer.subarray(0, 256).toString('utf8');
    if (!/^﻿?\s*0\r?\nSECTION/i.test(head) && !/AutoCAD/i.test(head)) {
      throw new Error('DXF invalido: header "0/SECTION" nao encontrado');
    }
    return;
  }
  if (formato === 'dwg') {
    // DWG binario: bytes 0-5 sao AC10XX onde XX e' a versao.
    const magic = buffer.subarray(0, 6).toString('ascii');
    if (!/^AC10\d{2}$/.test(magic)) {
      throw new Error('DWG invalido: magic bytes AC10XX ausentes');
    }
    return;
  }
  throw new Error(`Formato desconhecido: ${formato}`);
}

export function validarTamanho(buffer: Buffer, formato: FormatoPlanta): void {
  const limite = LIMITES_BYTES[formato];
  if (buffer.length > limite) {
    throw new Error(`${formato.toUpperCase()} excede ${(limite / 1024 / 1024).toFixed(0)} MB (atual: ${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
  }
}

export interface SalvarPlantaResultado {
  caminho_absoluto: string;
  caminho_relativo: string;
  size_bytes: number;
  hash_sha256: string;
  backup_anterior_path?: string;
}

export async function salvarPlanta(
  loteamentoId: number,
  quadraId: number,
  formato: FormatoPlanta,
  buffer: Buffer,
): Promise<SalvarPlantaResultado> {
  validarTamanho(buffer, formato);
  validarMagicBytes(buffer, formato);

  const dir = caminhoDir(loteamentoId, quadraId);
  await fs.promises.mkdir(dir, { recursive: true });

  const arquivoFinal = caminhoArquivo(loteamentoId, quadraId, formato);

  // Backup do anterior (se houver)
  let backupPath: string | undefined;
  try {
    await fs.promises.access(arquivoFinal);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    backupPath = path.join(dir, `_backup_${ts}.${formato}`);
    await fs.promises.rename(arquivoFinal, backupPath);
  } catch {
    // Nao existia — sem backup
  }

  await fs.promises.writeFile(arquivoFinal, buffer);
  const hash = calcularSha256(buffer);

  return {
    caminho_absoluto: arquivoFinal,
    caminho_relativo: caminhoRelativo(loteamentoId, quadraId, formato),
    size_bytes: buffer.length,
    hash_sha256: hash,
    backup_anterior_path: backupPath,
  };
}

export async function lerPlanta(loteamentoId: number, quadraId: number, formato: FormatoPlanta): Promise<Buffer> {
  return fs.promises.readFile(caminhoArquivo(loteamentoId, quadraId, formato));
}

export async function removerPlanta(loteamentoId: number, quadraId: number, formato: FormatoPlanta): Promise<boolean> {
  const arquivo = caminhoArquivo(loteamentoId, quadraId, formato);
  try {
    // Backup antes de remover (politica idempotente — mesma janela de 7 dias do replace)
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = caminhoDir(loteamentoId, quadraId);
    const bak = path.join(dir, `_backup_delete_${ts}.${formato}`);
    await fs.promises.rename(arquivo, bak);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
