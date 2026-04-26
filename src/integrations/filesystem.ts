// Acesso autônomo ao sistema de arquivos pra ZAYRA (v1.14).
// Estilo MCP Filesystem: whitelist de diretórios via env FS_ALLOWED_ROOTS
// (lista separada por ";"). Cada caminho é resolvido + canonicalizado e qualquer
// operação é validada contra essas raízes pra evitar path traversal.
//
// Operações destrutivas (escrever, apagar) usam o mesmo padrão de confirm-before-execute
// das tools do CRM: primeira chamada sem "confirm" retorna preview, segunda com
// "confirm: true" executa.

import { promises as fs } from 'fs';
import * as path from 'path';

const DEFAULT_ROOTS = [
  process.cwd(),
  'c:\\Users\\Ronicley Pinto\\Documents\\RomatecVoiceAgent',
  'c:\\Users\\Ronicley Pinto\\Romatec_CRM_WhatsApp',
  'c:\\Users\\Ronicley Pinto\\Documents\\ROMATEC_AVALIEIMOB_',
  'c:\\Users\\Ronicley Pinto\\Documents\\ObsidianVaults',
];

const MAX_READ_BYTES   = 256 * 1024;  // 256 KB por leitura
const MAX_WRITE_BYTES  = 1024 * 1024; // 1 MB por escrita
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_HITS  = 100;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '.obsidian']);
// Arquivos sensíveis bloqueados em qualquer operação (read/grep/write/delete).
const BLOCKED_FILES = new Set(['.env', '.env.local', '.env.production', '.env.development', '.env.test']);
const TEXT_EXT  = new Set([
  '.txt','.md','.json','.yaml','.yml','.toml','.js','.ts','.tsx','.jsx','.mjs','.cjs',
  '.html','.htm','.css','.scss','.sass','.less','.xml','.svg','.csv','.log',
  '.sh','.bash','.zsh','.ps1','.bat','.cmd','.py','.rb','.go','.rs','.java','.c','.cpp',
  '.h','.hpp','.sql','.gitignore','.dockerignore','.editorconfig','.prettierrc','.eslintrc',
]);

function isBlockedFile(filename: string): boolean {
  const base = path.basename(filename).toLowerCase();
  return BLOCKED_FILES.has(base) || base.startsWith('.env.');
}

function getRoots(): string[] {
  const fromEnv = (process.env.FS_ALLOWED_ROOTS ?? '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
  const list = fromEnv.length > 0 ? fromEnv : DEFAULT_ROOTS;
  return list.map(r => path.resolve(r));
}

async function resolveSafe(rel: string): Promise<string> {
  if (typeof rel !== 'string' || !rel.trim()) {
    throw new Error('Caminho vazio.');
  }

  const roots = getRoots();
  const candidate = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(roots[0], rel);

  // Compara case-insensitive em Windows pra match com C:\ vs c:\
  const norm = process.platform === 'win32' ? candidate.toLowerCase() : candidate;

  const ok = roots.some(r => {
    const rn = process.platform === 'win32' ? r.toLowerCase() : r;
    return norm === rn || norm.startsWith(rn + path.sep);
  });

  if (!ok) {
    throw new Error(`Acesso negado: "${rel}" está fora dos diretórios autorizados. Raízes: ${roots.join(' ; ')}`);
  }
  return candidate;
}

function isProbablyText(filename: string): boolean {
  return TEXT_EXT.has(path.extname(filename).toLowerCase());
}

export interface FsListEntry {
  name:    string;
  type:    'file' | 'dir' | 'other';
  size?:   number;
  mtime?:  string;
}

export async function fsListar(input: { caminho?: string }): Promise<{
  caminho: string;
  total:   number;
  entries: FsListEntry[];
  truncated: boolean;
}> {
  const target = await resolveSafe(input.caminho ?? '.');
  const stat   = await fs.stat(target);
  if (!stat.isDirectory()) {
    throw new Error(`"${target}" não é um diretório.`);
  }
  const dirents = await fs.readdir(target, { withFileTypes: true });
  const truncated = dirents.length > MAX_LIST_ENTRIES;
  const slice = dirents.slice(0, MAX_LIST_ENTRIES);

  const entries: FsListEntry[] = await Promise.all(
    slice.map(async d => {
      const full = path.join(target, d.name);
      let size: number | undefined;
      let mtime: string | undefined;
      try {
        const s = await fs.stat(full);
        size  = s.isFile() ? s.size : undefined;
        mtime = s.mtime.toISOString();
      } catch { /* permission error, just skip stats */ }
      return {
        name: d.name,
        type: d.isFile() ? 'file' : d.isDirectory() ? 'dir' : 'other',
        size,
        mtime,
      };
    }),
  );

  return { caminho: target, total: dirents.length, entries, truncated };
}

export async function fsLer(input: { caminho: string }): Promise<{
  caminho:  string;
  size:     number;
  conteudo: string;
  truncated: boolean;
}> {
  const target = await resolveSafe(input.caminho);
  if (isBlockedFile(target)) {
    throw new Error(`Acesso negado: "${path.basename(target)}" é um arquivo de credenciais e não pode ser lido.`);
  }
  const stat   = await fs.stat(target);
  if (!stat.isFile()) {
    throw new Error(`"${target}" não é um arquivo.`);
  }
  if (stat.size > MAX_READ_BYTES) {
    // Lê apenas os primeiros MAX_READ_BYTES bytes
    const fd = await fs.open(target, 'r');
    try {
      const buf = Buffer.alloc(MAX_READ_BYTES);
      await fd.read(buf, 0, MAX_READ_BYTES, 0);
      return {
        caminho:   target,
        size:      stat.size,
        conteudo:  buf.toString('utf8'),
        truncated: true,
      };
    } finally {
      await fd.close();
    }
  }
  const conteudo = await fs.readFile(target, 'utf8');
  return { caminho: target, size: stat.size, conteudo, truncated: false };
}

export async function fsEscrever(input: {
  caminho:  string;
  conteudo: string;
  modo?:    'criar' | 'sobrescrever' | 'anexar';
  confirm?: boolean;
}): Promise<{
  preview?: boolean;
  ok?:      boolean;
  message:  string;
  caminho?: string;
  bytes?:   number;
}> {
  const target = await resolveSafe(input.caminho);
  if (isBlockedFile(target)) {
    throw new Error(`Acesso negado: arquivos .env são protegidos contra escrita.`);
  }
  const conteudo = input.conteudo ?? '';
  const modo = input.modo ?? 'criar';

  if (Buffer.byteLength(conteudo, 'utf8') > MAX_WRITE_BYTES) {
    throw new Error(`Conteúdo excede limite de ${MAX_WRITE_BYTES} bytes.`);
  }

  let exists = false;
  try { await fs.access(target); exists = true; } catch { exists = false; }

  if (modo === 'criar' && exists) {
    throw new Error(`Arquivo já existe em "${target}". Use modo="sobrescrever" ou modo="anexar".`);
  }

  if (!input.confirm) {
    return {
      preview: true,
      caminho: target,
      bytes:   Buffer.byteLength(conteudo, 'utf8'),
      message: `[PREVIEW] ${modo === 'anexar' ? 'Anexar a' : exists ? 'Sobrescrever' : 'Criar'} "${target}" (${Buffer.byteLength(conteudo, 'utf8')} bytes). Reenvie com confirm:true após autorização do CEO.`,
    };
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  if (modo === 'anexar') {
    await fs.appendFile(target, conteudo, 'utf8');
  } else {
    await fs.writeFile(target, conteudo, 'utf8');
  }
  return {
    ok:      true,
    caminho: target,
    bytes:   Buffer.byteLength(conteudo, 'utf8'),
    message: `Arquivo ${modo === 'anexar' ? 'atualizado (anexo)' : exists ? 'sobrescrito' : 'criado'} com sucesso.`,
  };
}

export async function fsApagar(input: {
  caminho:  string;
  confirm?: boolean;
}): Promise<{ preview?: boolean; ok?: boolean; message: string; caminho?: string }> {
  const target = await resolveSafe(input.caminho);
  if (isBlockedFile(target)) {
    throw new Error(`Acesso negado: arquivos .env são protegidos contra exclusão.`);
  }
  const stat   = await fs.stat(target);

  if (!input.confirm) {
    return {
      preview: true,
      caminho: target,
      message: `[PREVIEW] APAGAR ${stat.isDirectory() ? 'diretório (recursivo)' : 'arquivo'} "${target}". AÇÃO IRREVERSÍVEL. Reenvie com confirm:true após autorização explícita.`,
    };
  }

  if (stat.isDirectory()) {
    await fs.rm(target, { recursive: true, force: true });
  } else {
    await fs.unlink(target);
  }
  return { ok: true, caminho: target, message: 'Removido com sucesso.' };
}

export interface FsSearchHit {
  caminho: string;
  linha:   number;
  trecho:  string;
}

export async function fsBuscar(input: {
  raiz?:    string;
  padrao:   string;
  glob?:    string;       // ex: "*.ts" filtra por extensão
  case_sensitive?: boolean;
}): Promise<{
  total: number;
  hits:  FsSearchHit[];
  truncated: boolean;
}> {
  if (!input.padrao || typeof input.padrao !== 'string') {
    throw new Error('Argumento "padrao" obrigatório.');
  }
  const root = await resolveSafe(input.raiz ?? '.');
  const flags = input.case_sensitive ? '' : 'i';
  let regex: RegExp;
  try {
    regex = new RegExp(input.padrao, flags);
  } catch (e) {
    throw new Error(`Regex inválida: ${(e as Error).message}`);
  }
  const extFilter = input.glob ? input.glob.replace(/^\*\./, '.').toLowerCase() : null;

  const hits: FsSearchHit[] = [];
  let scanned = 0;
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    let dirents: import('fs').Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }

    for (const d of dirents) {
      if (truncated) return;
      if (SKIP_DIRS.has(d.name)) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!d.isFile()) continue;
      if (isBlockedFile(d.name)) continue;
      if (!isProbablyText(d.name)) continue;
      if (extFilter && path.extname(d.name).toLowerCase() !== extFilter) continue;

      scanned++;
      if (scanned > 5000) { truncated = true; return; }

      let text: string;
      try {
        const stat = await fs.stat(full);
        if (stat.size > MAX_READ_BYTES) continue;
        text = await fs.readFile(full, 'utf8');
      } catch { continue; }

      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          hits.push({
            caminho: full,
            linha:   i + 1,
            trecho:  lines[i].slice(0, 200),
          });
          if (hits.length >= MAX_SEARCH_HITS) { truncated = true; return; }
        }
      }
    }
  }

  await walk(root);
  return { total: hits.length, hits, truncated };
}

export function fsRoots(): { roots: string[]; from_env: boolean } {
  const fromEnv = (process.env.FS_ALLOWED_ROOTS ?? '').trim().length > 0;
  return { roots: getRoots(), from_env: fromEnv };
}
