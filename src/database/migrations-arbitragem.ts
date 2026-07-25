// v3.129.0 — Migration da Calculadora de Divisão de Capital (Dutching / Arbitragem).
//
// Histórico dos cálculos feitos pela ZAYRA, isolado por usuário. Vínculo LÓGICO
// com o usuário via user_sub (o `sub` do JWT — VARCHAR, NÃO um id numérico de
// FK), mesma convenção do Diário/Inventário: sem FK dura, cascata na aplicação,
// pra não travar rollback. Persistência é acessória: se falhar, o cálculo ainda
// volta pro usuário (id: null).
import pool from './connection';

const CREATE_ARBITRAGEM = `
  CREATE TABLE IF NOT EXISTS zayra_arbitragem_calculos (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    user_sub         VARCHAR(64) NOT NULL,
    evento           VARCHAR(255) NULL,
    modo             ENUM('capital','lucro_alvo') NOT NULL DEFAULT 'capital',
    capital          DECIMAL(14,2) NOT NULL,
    lucro_alvo       DECIMAL(14,2) NULL,
    soma_implicita   DECIMAL(12,8) NOT NULL,
    margem_percentual DECIMAL(8,4) NOT NULL,
    arbitragem       TINYINT(1) NOT NULL DEFAULT 0,
    lucro_minimo     DECIMAL(14,2) NOT NULL,
    roi_percentual   DECIMAL(8,4) NOT NULL,
    entradas_json    JSON NOT NULL,
    alocacoes_json   JSON NOT NULL,
    criado_em        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_arb_user_data (user_sub, criado_em),
    INDEX idx_arb_arbitragem (arbitragem)
  )
`;

export async function runArbitragemMigrations(): Promise<void> {
  try {
    await pool.execute(CREATE_ARBITRAGEM);
    console.log('[arbitragem-migrations] OK: zayra_arbitragem_calculos');
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/already exists|Duplicate/i.test(msg)) {
      console.log('[arbitragem-migrations] ja existe (OK): zayra_arbitragem_calculos');
    } else {
      console.error('[arbitragem-migrations] FALHA:', msg.slice(0, 200));
    }
  }
}
