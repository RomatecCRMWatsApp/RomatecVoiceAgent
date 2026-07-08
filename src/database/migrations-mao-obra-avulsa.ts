// src/database/migrations-mao-obra-avulsa.ts
// v3.92.0 — Pagamento a Mão de Obra Avulsa/Informal (diarista, pedreiro solto,
// pintor avulso etc). Reusa o RECIBO UNIVERSAL (recibos) pro hash/QR/webhook/
// selo/assinatura — aqui só a tabela-detalhe com os campos do prestador/serviço/
// obra, ligada ao recibo por resource_id (resource_type='mao_obra_avulsa') e por
// recibo_id (back-link de conveniência).
//
// Adaptações à realidade do repo: comprovante em BASE64 (LONGTEXT), não path em
// disco (Railway efêmero); obra = romatec_obras, sem FK cross-table (INT+índice).
import pool from './connection';

export async function runMaoObraAvulsaMigrations(): Promise<void> {
  // 1) Adiciona 'mao_obra_avulsa' ao ENUM recibos.tipo (idempotente — re-MODIFY
  //    pro mesmo enum é no-op).
  try {
    await pool.execute(
      "ALTER TABLE recibos MODIFY COLUMN tipo ENUM('funcionario','parcela','despesa','proposta','vistoria','etapa','chaves','custom','vale','mao_obra_avulsa') NOT NULL",
    );
    console.log('[mao-obra-avulsa-migrations] OK: enum recibos.tipo +mao_obra_avulsa');
  } catch (err) {
    console.warn('[mao-obra-avulsa-migrations] aviso (enum tipo):', (err as Error).message.slice(0, 160));
  }

  // 2) Tabela-detalhe.
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS mao_obra_avulsa (
        id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
        obra_id            INT NULL,
        recibo_id          INT NULL,
        nome_prestador     VARCHAR(150) NOT NULL,
        telefone_whatsapp  VARCHAR(20)  NOT NULL,
        cpf                VARCHAR(20)  NULL,
        tipo_servico       VARCHAR(255) NOT NULL,
        descricao_servico  TEXT NULL,
        valor_pago         DECIMAL(12,2) NOT NULL,
        forma_pagamento    ENUM('pix','dinheiro','transferencia','outro') NOT NULL DEFAULT 'pix',
        data_pagamento     DATE NOT NULL,
        comprovante_nome   VARCHAR(255) NULL,
        comprovante_mime   VARCHAR(80)  NULL,
        comprovante_b64    LONGTEXT     NULL,
        created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_mao_obra (obra_id),
        KEY idx_mao_recibo (recibo_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[mao-obra-avulsa-migrations] OK: CREATE mao_obra_avulsa');
  } catch (err) {
    console.warn('[mao-obra-avulsa-migrations] aviso (CREATE tabela):', (err as Error).message.slice(0, 160));
  }
}
