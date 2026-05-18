// v1.99.17: tabela `configuracoes` — chaves/valores globais editáveis (precificação default,
// salário mínimo vigente, etc.). Service src/services/configuracoes.ts faz cache em memória.
// Idempotente: re-execução ignora "already exists".

import pool from './connection';

export async function runConfiguracoesMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'CREATE TABLE configuracoes',
      sql: `CREATE TABLE configuracoes (
        chave VARCHAR(80) NOT NULL,
        valor VARCHAR(255) NOT NULL,
        descricao VARCHAR(500) NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (chave)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` },
  ];

  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[configuracoes-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate|Duplicate key name/i.test(msg)) {
        console.log(`[configuracoes-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[configuracoes-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }

  // Seed dos defaults — INSERT IGNORE pra não sobrescrever valores já editados em produção
  const seeds: Array<[string, string, string]> = [
    ['PRECO_DEFAULT_DESDOBRO_URBANO', '450.00', 'Valor default por lote em desdobro urbano (BRL)'],
    ['PRECO_DEFAULT_DESMEMBRAMENTO_RURAL', '450.00', 'Valor default por gleba em desmembramento rural (BRL)'],
    ['SALARIO_MINIMO_VIGENTE', '1518.00', 'Salário mínimo nacional vigente para default de assessoria jurídica (BRL)'],
  ];
  for (const [chave, valor, descricao] of seeds) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO configuracoes (chave, valor, descricao) VALUES (?, ?, ?)`,
        [chave, valor, descricao]
      );
    } catch (err) {
      console.error(`[configuracoes-seed] FALHA ${chave}:`, (err as Error).message);
    }
  }
}
