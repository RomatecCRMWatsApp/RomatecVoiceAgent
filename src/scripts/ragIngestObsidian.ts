// Ingestão recursiva de um vault Obsidian no RAG via HTTP.
// Usa o endpoint POST /rag/ingest-text da ZAYRA em produção, então NÃO precisa
// das credenciais Supabase/Voyage no .env local — só o URL da ZAYRA.
//
// Uso:  npm run rag:ingest-obsidian "C:/path/vault"
//       npm run rag:ingest-obsidian "C:/path/vault" "categoria-forcada"
//       ZAYRA_BASE_URL=https://romatecvoiceagent-production.up.railway.app npm run rag:ingest-obsidian "C:/path/vault"

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';

const BASE_URL = process.env.ZAYRA_BASE_URL || 'https://romatecvoiceagent-production.up.railway.app';
const IGNORE_DIRS = new Set(['.obsidian', '.trash', 'node_modules', '.git', '.vscode']);

async function listarMdRecursivo(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      out.push(...await listarMdRecursivo(path.join(dir, e.name)));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function removerFrontmatter(conteudo: string): string {
  if (!conteudo.startsWith('---\n') && !conteudo.startsWith('---\r\n')) return conteudo;
  const fim = conteudo.indexOf('\n---', 4);
  if (fim < 0) return conteudo;
  return conteudo.slice(fim + 4).replace(/^[\r\n]+/, '');
}

function detectarCategoriaObsidian(filePath: string, vaultRoot: string): string {
  const rel = path.relative(vaultRoot, filePath).toLowerCase();
  const joined = rel.split(path.sep).join(' ');
  if (/\b(norma|nbr|abnt|incra)\b/.test(joined))      return 'norma';
  if (/\b(laudo|ptam|avalia)\w*/.test(joined))        return 'laudo';
  if (/\b(contrato|termo)\b/.test(joined))            return 'contrato';
  if (/\b(manual|guia|tutorial)\b/.test(joined))      return 'manual';
  if (/\b(roadmap|backend|frontend|arquitetura|integra)/.test(joined)) return 'projeto';
  if (/\b(decisão|decisoes|decisões|adr)\b/.test(joined))              return 'decisao';
  return 'outro';
}

async function main() {
  const vault = process.argv[2];
  const forceCat = process.argv[3];
  if (!vault) {
    console.error('Uso: npm run rag:ingest-obsidian <vault-path> [categoria-forcada]');
    console.error('Ex:  npm run rag:ingest-obsidian "C:/Users/Ronicley Pinto/Documents/RomatecVoiceAgent_Vault"');
    process.exit(1);
  }
  const abs = path.resolve(vault);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isDirectory()) {
    console.error(`✖ Vault não encontrado: ${abs}`);
    process.exit(1);
  }

  const files = await listarMdRecursivo(abs);
  if (files.length === 0) {
    console.log('Nenhum .md no vault.');
    return;
  }
  console.log(`📂 vault: ${abs}\n🌐 server: ${BASE_URL}\n📄 ${files.length} arquivos .md encontrados\n`);

  let ok = 0, dup = 0, err = 0;
  for (const file of files) {
    const rel = path.relative(abs, file).replace(/\\/g, '/');
    const titulo = path.basename(file, '.md');
    const categoria = forceCat || detectarCategoriaObsidian(file, abs);
    process.stdout.write(`  ${rel} (${categoria}) … `);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const texto = removerFrontmatter(raw).trim();
      if (texto.length < 50) { console.log('⊘ vazio (<50 chars)'); continue; }

      const r = await axios.post<{ ja_existia: boolean; chunks_inseridos: number; titulo: string }>(
        `${BASE_URL}/rag/ingest-text`,
        {
          texto,
          titulo,
          fonte:        'obsidian',
          categoria,
          arquivo_nome: rel,
          metadata:     { vault_path: rel },
        },
        { timeout: 120000, headers: { 'Content-Type': 'application/json' } },
      );
      if (r.data.ja_existia) { console.log('📚 já existia'); dup++; }
      else { console.log(`✅ ${r.data.chunks_inseridos} chunks`); ok++; }
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } }; message?: string };
      const msg = ax.response?.data?.error ?? ax.message ?? String(e);
      console.log(`❌ ${msg.slice(0, 100)}`);
      err++;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`\n📊 Total: ${ok} novos | ${dup} duplicados | ${err} erros`);
}

main().catch(e => { console.error(e); process.exit(1); });
