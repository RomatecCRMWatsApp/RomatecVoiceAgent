/**
 * Importa o certificado A1 (.pfx/.p12) para o cofre da ZAYRA.
 * Uso: npx tsx scripts/importar-certificado.ts "C:\caminho\191f26031059e68a.pfx"
 * A senha é pedida no terminal, usada só para validar e NÃO é gravada.
 */
import { readFile } from 'node:fs/promises';
import readline from 'node:readline';
import { criarPool } from './db-env.js';
import { abrirPfx, descartar } from '../src/modules/assinatura/certificado.js';
import { cifrar } from '../src/modules/assinatura/cofre.js';
import { configAssinatura } from '../src/modules/assinatura/config.js';
import { salvarCertificado } from '../src/modules/assinatura/servico.js';

function perguntarOculto(pergunta: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const interno = rl as unknown as { _writeToOutput: (s: string) => void };
    let oculto = false;
    interno._writeToOutput = (s: string) => {
      if (!oculto) process.stdout.write(s);
      else if (/[\r\n]/.test(s)) process.stdout.write('\n');
      else process.stdout.write('*'.repeat(s.length));
    };
    rl.question(pergunta, (resposta) => {
      rl.close();
      resolve(resposta);
    });
    oculto = true;
  });
}

async function main(): Promise<void> {
  const caminho = process.argv[2];
  if (!caminho) throw new Error('Informe o caminho do arquivo .pfx');
  const pfx = await readFile(caminho);
  const senha = await perguntarOculto('Senha do certificado: ');

  const cert = abrirPfx(pfx, senha);
  try {
    if (!cert.icpBrasil) throw new Error('O certificado não pertence à cadeia ICP-Brasil');
    if (new Date() > cert.validoAte) throw new Error(`Certificado vencido em ${cert.validoAte.toLocaleDateString('pt-BR')}`);

    const pool = criarPool();
    try {
      await salvarCertificado(pool, pfx, cert, cifrar(pfx, configAssinatura.masterKey));
    } finally {
      await pool.end();
    }

    console.log('\nCertificado importado com sucesso');
    console.log(`  Titular : ${cert.titular}`);
    console.log(`  AC      : ${cert.emissor}`);
    console.log(`  Serial  : ${cert.serial}`);
    console.log(`  Validade: ${cert.validoDe.toLocaleDateString('pt-BR')} a ${cert.validoAte.toLocaleDateString('pt-BR')}`);
    console.log(`  Cadeia  : ${cert.cadeiaDer.length} certificado(s) intermediário(s)`);
  } finally {
    descartar(cert);
    pfx.fill(0);
  }
}

main().catch((e) => {
  console.error(`\nErro: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
