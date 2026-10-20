/** Cria as tabelas do módulo de assinatura sem precisar do cliente mysql no PATH.
 *  Uso (na raiz do projeto): npx tsx scripts/migrar-assinatura.ts */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { criarPool, opcoesConexao } from './db-env.js';

async function main(): Promise<void> {
  const sql = await readFile(path.resolve('sql/2026_10_20_assinatura_digital.sql'), 'utf8');
  const { host, database } = opcoesConexao();
  const pool = criarPool({ multipleStatements: true });
  try {
    await pool.query(sql);
    const [rows] = await pool.query("SHOW TABLES LIKE 'assinatura\\_%'");
    console.log(`Banco ${database} @ ${host}`);
    for (const r of rows as Record<string, string>[]) console.log(`  OK  ${Object.values(r)[0]}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`Erro: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
