// Ingere um contrato modelo (PDF/DOCX) na base via HTTP.
// Nao precisa das envs Supabase/Voyage local — usa o servidor remoto.
//
// Uso:  npm run contracts:ingest "C:/path/contrato.pdf"
//       npm run contracts:ingest "C:/path/contrato.docx" "Compra e venda Lote 14"
//       ZAYRA_BASE_URL=https://... npm run contracts:ingest "...pdf"

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';

const BASE_URL = process.env.ZAYRA_BASE_URL || 'https://romatecvoiceagent-production.up.railway.app';

async function main() {
  const filePath = process.argv[2];
  const tituloHint = process.argv[3];
  if (!filePath) {
    console.error('Uso: npm run contracts:ingest <arquivo.pdf|.docx> [titulo]');
    process.exit(1);
  }
  const abs = path.resolve(filePath);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isFile()) {
    console.error(`✖ Arquivo nao encontrado: ${abs}`);
    process.exit(1);
  }

  const ext = path.extname(abs).toLowerCase();
  if (!['.pdf', '.docx'].includes(ext)) {
    console.error(`✖ Extensao nao suportada (${ext}) — use .pdf ou .docx`);
    process.exit(1);
  }
  const mime = ext === '.pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  console.log(`📄 ${path.basename(abs)} (${(stat.size/1024).toFixed(1)}KB)`);
  console.log(`🌐 ${BASE_URL}/contracts/index`);
  console.log(`⏳ enviando + segmentando + embeddings...`);

  const buf = await fs.readFile(abs);
  const fd  = new FormData();
  fd.append('arquivo', buf, { filename: path.basename(abs), contentType: mime });
  if (tituloHint) fd.append('titulo', tituloHint);
  fd.append('fonte', 'cli');

  try {
    const r = await axios.post(`${BASE_URL}/contracts/index`, fd, {
      headers:  fd.getHeaders(),
      timeout:  600000,                        // 10min — segmentacao via Claude pode demorar
      maxContentLength: 60 * 1024 * 1024,
      maxBodyLength:    60 * 1024 * 1024,
    });
    const d = r.data as {
      ja_existia: boolean; titulo: string; tipo: string;
      total_clausulas: number; resumo: string; secoes: Record<string, number>;
    };
    if (d.ja_existia) {
      console.log(`📚 ja existia: ${d.titulo} (${d.total_clausulas} clausulas)`);
    } else {
      console.log(`✅ ${d.titulo}`);
      console.log(`   tipo: ${d.tipo}`);
      console.log(`   clausulas: ${d.total_clausulas}`);
      console.log(`   secoes:    ${Object.entries(d.secoes).map(([k,v]) => `${k}=${v}`).join(' | ')}`);
      console.log(`   resumo:    ${d.resumo.slice(0, 200)}${d.resumo.length>200?'...':''}`);
    }
  } catch (err) {
    const ax = err as { response?: { data?: { error?: string } }; message?: string };
    console.error(`❌ ${ax.response?.data?.error ?? ax.message ?? String(err)}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
