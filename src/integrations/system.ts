// Manutenção de sistema (Windows) — limpeza de pastas temporárias e diagnóstico
// de disco. Whitelist hardcoded — NUNCA aceita caminho arbitrário do CEO.
// v1.15: limpeza segura com confirm-before-execute igual fs_escrever/fs_apagar.

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

// ── Whitelist de pastas seguras pra limpar ──────────────────────────────────
// Cada categoria mapeia pra caminhos conhecidos do Windows. Se o caminho não
// existir, é ignorado silenciosamente.

interface CleanTarget {
  label: string;
  paths: string[];
  /** Idade mínima em dias pra considerar "antigo o suficiente" pra apagar.
   *  0 = apaga tudo. Default 1 dia (evita apagar arquivos abertos agora). */
  minAgeDays: number;
}

function userProfile(): string {
  return process.env.USERPROFILE ?? os.homedir();
}
function localAppData(): string {
  return process.env.LOCALAPPDATA ?? path.join(userProfile(), 'AppData', 'Local');
}
function tempDir(): string {
  return process.env.TEMP ?? process.env.TMP ?? path.join(localAppData(), 'Temp');
}

function targets(): Record<string, CleanTarget> {
  const lad = localAppData();
  return {
    temp_usuario: {
      label: 'TEMP do usuário',
      paths: [tempDir()],
      minAgeDays: 1,
    },
    temp_windows: {
      label: 'TEMP do Windows',
      paths: ['C:\\Windows\\Temp'],
      minAgeDays: 1,
    },
    cache_navegador: {
      label: 'Cache de navegadores (Chrome, Edge, Brave, Firefox)',
      paths: [
        path.join(lad, 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
        path.join(lad, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache'),
        path.join(lad, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache'),
        path.join(lad, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Cache'),
        path.join(userProfile(), 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles'),
      ],
      minAgeDays: 0,
    },
    cache_inet: {
      label: 'Internet cache do Windows',
      paths: [
        path.join(lad, 'Microsoft', 'Windows', 'INetCache'),
        path.join(lad, 'Microsoft', 'Windows', 'WebCache'),
      ],
      minAgeDays: 0,
    },
    relatorios_erro: {
      label: 'Relatórios de erro do Windows (WER)',
      paths: [
        path.join(lad, 'Microsoft', 'Windows', 'WER'),
        'C:\\ProgramData\\Microsoft\\Windows\\WER',
      ],
      minAgeDays: 7,
    },
    crashdumps: {
      label: 'Crash dumps',
      paths: [
        path.join(lad, 'CrashDumps'),
      ],
      minAgeDays: 7,
    },
    prefetch: {
      label: 'Windows Prefetch',
      paths: ['C:\\Windows\\Prefetch'],
      minAgeDays: 7,
    },
    delivery_optimization: {
      label: 'Cache do Delivery Optimization',
      paths: ['C:\\Windows\\SoftwareDistribution\\Download'],
      minAgeDays: 7,
    },
    thumbnails: {
      label: 'Thumbnails',
      paths: [path.join(lad, 'Microsoft', 'Windows', 'Explorer')],
      minAgeDays: 0,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function dirSize(dir: string): Promise<{ bytes: number; files: number; eligible: number }> {
  let bytes = 0, files = 0, eligible = 0;
  async function walk(d: string): Promise<void> {
    let dirents: import('fs').Dirent[];
    try { dirents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const dir of dirents) {
      const full = path.join(d, dir.name);
      try {
        if (dir.isDirectory()) {
          await walk(full);
        } else if (dir.isFile()) {
          const st = await fs.stat(full);
          bytes += st.size;
          files++;
          eligible++;
        }
      } catch { /* skip locked */ }
    }
  }
  try { await walk(dir); } catch { /* skip */ }
  return { bytes, files, eligible };
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

async function cleanDir(dir: string, minAgeDays: number): Promise<{
  removidos: number;
  bytes_liberados: number;
  bloqueados: number;
}> {
  const cutoff = Date.now() - minAgeDays * 24 * 60 * 60 * 1000;
  let removidos = 0, bytes_liberados = 0, bloqueados = 0;

  async function walk(d: string, isRoot: boolean): Promise<void> {
    let dirents: import('fs').Dirent[];
    try { dirents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const dir of dirents) {
      const full = path.join(d, dir.name);
      try {
        const st = await fs.stat(full);
        if (st.isDirectory()) {
          await walk(full, false);
          // Tenta remover diretório vazio (não a raiz da target)
          if (!isRoot) {
            try { await fs.rmdir(full); } catch { /* não vazio ou em uso */ }
          }
        } else if (st.isFile()) {
          if (st.mtimeMs > cutoff) continue; // muito recente, possivelmente em uso
          const size = st.size;
          await fs.unlink(full);
          removidos++;
          bytes_liberados += size;
        }
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
          bloqueados++;
        }
      }
    }
  }

  await walk(dir, true);
  return { removidos, bytes_liberados, bloqueados };
}

// ── Tools ────────────────────────────────────────────────────────────────────

export async function discoStatus(): Promise<{
  drives: { letra: string; total: string; livre: string; usado_pct: number }[];
  temp_folders: { categoria: string; label: string; caminho: string; tamanho: string; arquivos: number }[];
  total_pode_liberar: string;
}> {
  // Drive info via PowerShell
  let drives: { letra: string; total: string; livre: string; usado_pct: number }[] = [];
  try {
    const { stdout } = await exec('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } | Select-Object Name, @{N='Total';E={$_.Used + $_.Free}}, Free | ConvertTo-Json -Compress",
    ], { timeout: 10000 });
    const parsed = JSON.parse(stdout) as { Name: string; Total: number; Free: number }[] | { Name: string; Total: number; Free: number };
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    drives = arr.map(d => ({
      letra:     d.Name + ':',
      total:     formatBytes(d.Total),
      livre:     formatBytes(d.Free),
      usado_pct: Math.round(((d.Total - d.Free) / d.Total) * 100),
    }));
  } catch { /* sistema sem PowerShell ou não-Windows */ }

  // Tamanho das pastas temp (whitelist)
  const t = targets();
  const sizes = await Promise.all(
    Object.entries(t).map(async ([cat, def]) => {
      let totalBytes = 0, totalFiles = 0;
      let firstPath = '';
      for (const p of def.paths) {
        if (!firstPath) firstPath = p;
        const r = await dirSize(p);
        totalBytes += r.bytes;
        totalFiles += r.files;
      }
      return {
        categoria: cat,
        label:     def.label,
        caminho:   firstPath,
        tamanho:   formatBytes(totalBytes),
        arquivos:  totalFiles,
        _bytes:    totalBytes,
      };
    }),
  );

  const totalLiberar = sizes.reduce((acc, s) => acc + s._bytes, 0);

  return {
    drives,
    temp_folders: sizes
      .filter(s => s._bytes > 0)
      .sort((a, b) => b._bytes - a._bytes)
      .map(({ _bytes, ...rest }) => rest),
    total_pode_liberar: formatBytes(totalLiberar),
  };
}

export async function limparTemp(input: {
  categoria?: string;  // chave de targets() ou 'tudo'
  confirm?:   boolean;
}): Promise<{
  preview?: boolean;
  ok?:      boolean;
  message:  string;
  total_removido?: number;
  total_bytes?:    string;
  detalhes?:       { categoria: string; removidos: number; bytes: string; bloqueados: number }[];
}> {
  const t = targets();
  const cat = input.categoria ?? 'tudo';
  const cats = cat === 'tudo'
    ? Object.keys(t)
    : [cat].filter(c => c in t);

  if (cats.length === 0) {
    throw new Error(`Categoria inválida: "${cat}". Use uma de: tudo, ${Object.keys(t).join(', ')}`);
  }

  if (!input.confirm) {
    // Preview: roda dirSize, mostra quanto será removido
    const sizes = await Promise.all(
      cats.map(async k => {
        let bytes = 0, files = 0;
        for (const p of t[k].paths) {
          const r = await dirSize(p);
          bytes += r.bytes;
          files += r.files;
        }
        return { categoria: k, label: t[k].label, files, bytes };
      }),
    );
    const totalBytes = sizes.reduce((a, s) => a + s.bytes, 0);
    const totalFiles = sizes.reduce((a, s) => a + s.files, 0);
    const breakdown = sizes
      .filter(s => s.bytes > 0)
      .map(s => `  • ${s.label}: ${formatBytes(s.bytes)} (${s.files} arquivos)`)
      .join('\n');

    return {
      preview: true,
      message:
        `[PREVIEW] Vou apagar ${totalFiles} arquivos = ${formatBytes(totalBytes)}.\n${breakdown}\n\n` +
        `Reenvie com confirm:true após autorização do CEO.`,
    };
  }

  // Execução real
  const detalhes: { categoria: string; removidos: number; bytes: string; bloqueados: number }[] = [];
  let totalRemovidos = 0, totalBytes = 0;

  for (const k of cats) {
    let removidos = 0, bytes = 0, bloqueados = 0;
    for (const p of t[k].paths) {
      const r = await cleanDir(p, t[k].minAgeDays);
      removidos += r.removidos;
      bytes += r.bytes_liberados;
      bloqueados += r.bloqueados;
    }
    detalhes.push({ categoria: k, removidos, bytes: formatBytes(bytes), bloqueados });
    totalRemovidos += removidos;
    totalBytes += bytes;
  }

  return {
    ok: true,
    message: `Limpeza concluída. ${totalRemovidos} arquivos removidos, ${formatBytes(totalBytes)} liberados.`,
    total_removido: totalRemovidos,
    total_bytes:    formatBytes(totalBytes),
    detalhes,
  };
}

export async function limparLixeira(input: { confirm?: boolean }): Promise<{
  preview?: boolean;
  ok?:      boolean;
  message:  string;
}> {
  if (!input.confirm) {
    return {
      preview: true,
      message: '[PREVIEW] Vou esvaziar a Lixeira do Windows. AÇÃO IRREVERSÍVEL. Reenvie com confirm:true.',
    };
  }
  try {
    await exec('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Clear-RecycleBin -Force -ErrorAction SilentlyContinue',
    ], { timeout: 30000 });
    return { ok: true, message: 'Lixeira esvaziada.' };
  } catch (err) {
    throw new Error(`Falha ao esvaziar lixeira: ${(err as Error).message}`);
  }
}

export function listarCategorias(): { categoria: string; label: string; paths: string[]; min_idade_dias: number }[] {
  const t = targets();
  return Object.entries(t).map(([k, v]) => ({
    categoria:      k,
    label:          v.label,
    paths:          v.paths,
    min_idade_dias: v.minAgeDays,
  }));
}
