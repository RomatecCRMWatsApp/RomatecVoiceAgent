// CLI pra ingerir uma pasta inteira de PDFs no RAG.
// Uso: npm run rag:ingest-folder ./knowledge-pdfs
//      npm run rag:ingest-folder ./knowledge-pdfs norma   ← força categoria

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { ingerirPdf, detectarCategoria } from '../services/ragIngest';

async function main() {
  const folder = process.argv[2];
  const forceCategoria = process.argv[3];
  if (!folder) {
    console.error('Uso: npm run rag:ingest-folder <pasta> [categoria-forcada]');
    process.exit(1);
  }

  const abs = path.resolve(folder);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isDirectory()) {
    console.error(`✖ Pasta não encontrada: ${abs}`);
    process.exit(1);
  }

  const all = await fs.readdir(abs);
  const pdfs = all.filter(f => f.toLowerCase().endsWith('.pdf'));
  if (pdfs.length === 0) {
    console.log('Nenhum PDF na pasta.');
    return;
  }

  console.log(`📂 ${abs}\n📄 ${pdfs.length} PDFs encontrados\n`);

  let ok = 0, dup = 0, err = 0;
  for (const file of pdfs) {
    const full = path.join(abs, file);
    process.stdout.write(`  ${file} … `);
    try {
      const buf = await fs.readFile(full);
      const r = await ingerirPdf({
        pdfBuffer:   buf,
        titulo:      file.replace(/\.pdf$/i, ''),
        fonte:       'cli',
        categoria:   forceCategoria || detectarCategoria(file),
        arquivoNome: file,
      });
      if (r.ja_existia) { console.log('📚 já existia'); dup++; }
      else { console.log(`✅ ${r.chunks_inseridos} chunks, ${r.paginas} páginas`); ok++; }
    } catch (e) {
      console.log(`❌ ${(e as Error).message}`);
      err++;
    }
  }
  console.log(`\n📊 Total: ${ok} novos | ${dup} duplicados | ${err} erros`);
}

main().catch(e => { console.error(e); process.exit(1); });
