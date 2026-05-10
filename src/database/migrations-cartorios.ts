// src/database/migrations-cartorios.ts
//
// v3.2.0: tabela `cartorios` para autocomplete nacional. Importada a partir
// do CSV do CNJ (~3.7k cartorios com atribuicao "Registro de Imoveis"),
// disponivel em data/cartorios-cns.csv. O importer roda sob demanda via
// POST /api/admin/cartorios/importar — esta migration apenas garante a
// estrutura. Idempotente: re-execucao ignora "already exists".

import pool from './connection';

export async function runCartoriosMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'CREATE TABLE cartorios',
      sql: `CREATE TABLE cartorios (
        id INT NOT NULL AUTO_INCREMENT,
        cns VARCHAR(20) NOT NULL COMMENT 'Codigo Nacional de Serventia (chave natural)',
        cns_formatado VARCHAR(20) NOT NULL COMMENT 'CNS com pontuacao, ex: 00.007-5',
        denominacao VARCHAR(500) NOT NULL,
        uf CHAR(2) NOT NULL,
        cidade VARCHAR(120) NOT NULL,
        cidade_normalizada VARCHAR(120) NOT NULL COMMENT 'Cidade lowercase sem acento p/ busca',
        responsavel VARCHAR(200) NULL,
        email VARCHAR(200) NULL,
        status VARCHAR(40) NULL COMMENT 'Ativo/Inativo conforme CNJ',
        situacao_juridica VARCHAR(60) NULL COMMENT 'PROVIDO/VAGO/SOB INTERVENCAO/etc',
        atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_cns (cns)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` },
    { label: 'CREATE idx_uf_cidade',
      sql: 'CREATE INDEX idx_cartorios_uf_cidade ON cartorios(uf, cidade_normalizada)' },
    { label: 'CREATE idx_denominacao',
      sql: 'CREATE INDEX idx_cartorios_denominacao ON cartorios(denominacao(120))' },
    { label: 'CREATE idx_responsavel',
      sql: 'CREATE INDEX idx_cartorios_responsavel ON cartorios(responsavel(120))' },
  ];

  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[cartorios-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate|Duplicate key name/i.test(msg)) {
        console.log(`[cartorios-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[cartorios-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
