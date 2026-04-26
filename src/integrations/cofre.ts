// Cofre Obsidian — espelha memórias do MySQL pra arquivos .md navegáveis (v1.20).
// Mirror unidirecional: MySQL é a fonte autoritativa. Vault é pra leitura humana.

import { promises as fs } from 'fs';
import * as path from 'path';
import pool from '../database/connection';
import type { RowDataPacket } from 'mysql2';

type MemoryRow = RowDataPacket & {
  id:             number;
  type:           'fact' | 'preference' | 'decision' | 'context' | 'reminder';
  content:        string;
  relevance_tags: string | null;
  created_at:     Date;
  updated_at:     Date;
  expires_at:     Date | null;
};

const TIPO_PASTA: Record<MemoryRow['type'], string> = {
  fact:       '00-Fatos',
  preference: '01-Preferencias',
  decision:   '02-Decisoes',
  context:    '03-Contexto',
  reminder:   '04-Lembretes',
};

function vaultRoot(): string {
  // Em modo local, escreve direto em ObsidianVaults; em Railway, em /app
  return process.env.ZAYRA_VAULT_PATH
      ?? (process.platform === 'win32'
          ? 'c:\\Users\\Ronicley Pinto\\Documents\\ObsidianVaults\\ZAYRA_Memoria'
          : path.join(process.cwd(), 'zayra_memoria_vault'));
}

function slugify(s: string, maxLen = 60): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen) || 'sem_titulo';
}

function fmtIso(d: Date | null): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

function escapeYaml(s: string): string {
  // Frontmatter YAML: campos string que podem ter ":" precisam de aspas
  if (/[:#"\[\]{},&*?!|<>'%@`]/.test(s) || /^\s|\s$/.test(s)) {
    return '"' + s.replace(/"/g, '\\"') + '"';
  }
  return s;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function memoryToMd(m: MemoryRow): { filename: string; content: string } {
  const tags = (m.relevance_tags ?? '')
    .split(',').map(t => t.trim()).filter(Boolean);
  const titulo = m.content.split('\n')[0].slice(0, 80);
  const filename = `${String(m.id).padStart(4, '0')}_${slugify(titulo)}.md`;

  const front = [
    '---',
    `id: ${m.id}`,
    `type: ${m.type}`,
    `tags: [${tags.map(t => escapeYaml(t)).join(', ')}]`,
    `created: ${fmtIso(m.created_at)}`,
    `updated: ${fmtIso(m.updated_at)}`,
    ...(m.expires_at ? [`expires: ${fmtIso(m.expires_at)}`] : []),
    '---',
    '',
  ].join('\n');

  const body = `# ${titulo}\n\n${m.content}\n`;
  return { filename, content: front + body };
}

export interface SyncResult {
  vault_path:  string;
  total:       number;
  por_tipo:    Record<string, number>;
  index_path:  string;
}

export async function sincronizarCofreMemoria(): Promise<SyncResult> {
  const root = vaultRoot();
  await ensureDir(root);

  const [rows] = await pool.execute<MemoryRow[]>(
    'SELECT * FROM zayra_memory ORDER BY type ASC, id ASC',
  );

  // Agrupa por tipo, garante pasta, escreve cada
  const porTipo: Record<string, number> = {};
  const linksPorTipo: Record<string, string[]> = {};

  for (const tipo of Object.keys(TIPO_PASTA) as MemoryRow['type'][]) {
    const dir = path.join(root, TIPO_PASTA[tipo]);
    await ensureDir(dir);
    porTipo[tipo] = 0;
    linksPorTipo[tipo] = [];
  }

  for (const m of rows) {
    const { filename, content } = memoryToMd(m);
    const dir = path.join(root, TIPO_PASTA[m.type]);
    const full = path.join(dir, filename);
    await fs.writeFile(full, content, 'utf8');
    porTipo[m.type]++;
    linksPorTipo[m.type].push(`- [[${TIPO_PASTA[m.type]}/${filename.replace(/\.md$/, '')}|${filename.replace(/^\d+_/, '').replace(/_/g, ' ').replace(/\.md$/, '')}]]`);
  }

  // Index principal
  const indexPath = path.join(root, '_index.md');
  const indexLines = [
    '---',
    'name: Cofre de Memórias da ZAYRA',
    `gerado_em: ${new Date().toISOString()}`,
    `total: ${rows.length}`,
    '---',
    '',
    '# Cofre de Memórias da ZAYRA',
    '',
    `_Espelho do MySQL Romatec. Última sincronização: ${new Date().toLocaleString('pt-BR')}._`,
    '',
    '## Resumo',
    '',
    `- **Fatos**: ${porTipo.fact}`,
    `- **Preferências**: ${porTipo.preference}`,
    `- **Decisões**: ${porTipo.decision}`,
    `- **Contexto**: ${porTipo.context}`,
    `- **Lembretes**: ${porTipo.reminder}`,
    '',
    '## Categorias',
    '',
    ...Object.entries(TIPO_PASTA).map(([tipo, pasta]) => {
      const links = linksPorTipo[tipo].join('\n');
      return `### ${pasta}\n\n${links || '_(vazio)_'}\n`;
    }),
    '',
    '---',
    '',
    '> ⚠️ **Não edite manualmente.** Estes arquivos são regerados pela ZAYRA toda vez que ela salva uma memória nova. Pra editar/remover memórias, peça à ZAYRA: "atualiza a memória X" ou "deleta a memória Y".',
  ];
  await fs.writeFile(indexPath, indexLines.join('\n'), 'utf8');

  return {
    vault_path: root,
    total:      rows.length,
    por_tipo:   porTipo,
    index_path: indexPath,
  };
}

// Auto-sync silencioso (chamado fire-and-forget após saveMemory/extractMemoryAuto)
let _autoSyncCooldown = 0;
export async function autoSyncCofre(): Promise<void> {
  // Cooldown de 30s pra não escrever dúzia de vezes em rajada
  if (Date.now() < _autoSyncCooldown) return;
  _autoSyncCooldown = Date.now() + 30_000;
  try { await sincronizarCofreMemoria(); }
  catch (e) { console.warn('[cofre] autoSync falhou:', (e as Error).message); }
}

// Cria um zip do vault pra download em Railway (filesystem efêmero)
export async function exportarVaultZip(): Promise<{ path: string; size: number }> {
  const root = vaultRoot();
  await sincronizarCofreMemoria();

  // Lista todos os arquivos recursivamente e empacota num tar simples (sem dep externa)
  // Pra simplicidade, vamos gerar um único arquivo de export concatenado em vez de zip:
  const exportFile = path.join(root, '..', `zayra_memoria_export_${Date.now()}.md`);
  const blocks: string[] = [];

  async function walk(dir: string): Promise<void> {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) await walk(full);
      else if (it.isFile() && it.name.endsWith('.md')) {
        const content = await fs.readFile(full, 'utf8');
        const rel = path.relative(root, full).replace(/\\/g, '/');
        blocks.push(`\n\n<!-- ===== ${rel} ===== -->\n\n${content}`);
      }
    }
  }
  await walk(root);

  await fs.writeFile(exportFile, blocks.join('\n---\n'), 'utf8');
  const stat = await fs.stat(exportFile);
  return { path: exportFile, size: stat.size };
}
