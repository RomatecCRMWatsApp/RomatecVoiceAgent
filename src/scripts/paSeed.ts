// v3.142.0 — Carga inicial do módulo PA pela linha de comando.
//
//   npm run pa:seed -- <seed.json> [pasta-do-acervo | acervo.zip] [--dry-run]
//
// --dry-run só planeja (não toca no banco): mostra contagens, avisos e erros.
// Em produção: `railway run --service <app> npm run pa:seed -- ...` (o .env local
// aponta pro banco LEGADO/CRM — nunca rodar sem conferir o DATABASE_URL).
import 'dotenv/config';
import { readFileSync, statSync } from 'node:fs';
import { planejarSeed, type SeedJson } from '../services/pa/seedPlan';

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const [seedPath, acervoPath] = args.filter((a) => !a.startsWith('--'));
  if (!seedPath) {
    console.error('uso: npm run pa:seed -- <seed.json> [pasta-acervo|acervo.zip] [--dry-run]');
    process.exit(2);
  }
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedJson;
  const plano = planejarSeed(seed);
  const total = (xs: Array<{ valor: number }>) => xs.reduce((s, x) => s + x.valor, 0);
  console.log(`[pa:seed] projeto ${plano.projeto.codigo}: ${plano.lotes.length} lotes, ${plano.associados.length} associados, ` +
    `${plano.lancamentos.length} lançamentos, ${plano.pagamentos.length} pagamentos, ${plano.documentos.length} documentos`);
  console.log(`[pa:seed] contratado R$ ${total(plano.lancamentos).toFixed(2)} · recebido R$ ${total(plano.pagamentos).toFixed(2)}`);
  plano.avisos.forEach((a) => console.log(`  aviso: ${a}`));
  plano.erros.forEach((e) => console.log(`  ERRO:  ${e}`));
  if (dry) return;

  const { executarSeed, leitorPasta, leitorZip, contagemProjeto } = await import('../services/pa/seedRun');
  const { runPaMigrations } = await import('../database/migrations-pa');
  await runPaMigrations();
  let leitor = null;
  if (acervoPath) leitor = statSync(acervoPath).isDirectory() ? leitorPasta(acervoPath) : leitorZip(acervoPath);
  const rel = await executarSeed(plano, leitor, 'cli:pa-seed');
  console.log('[pa:seed] inseridos  ', rel.inseridos);
  console.log('[pa:seed] atualizados', rel.atualizados);
  console.log('[pa:seed] ignorados  ', rel.ignorados);
  console.log('[pa:seed] arquivos   ', rel.arquivos);
  rel.erros.slice(plano.erros.length).forEach((e) => console.log(`  ERRO:  ${e}`));
  rel.avisos.slice(plano.avisos.length).forEach((a) => console.log(`  aviso: ${a}`));
  console.log('[pa:seed] banco agora:', await contagemProjeto(rel.projeto_id));
  const { default: pool } = await import('../database/connection');
  await pool.end();
}

main().catch((err) => {
  console.error('[pa:seed] falhou:', err);
  process.exit(1);
});
