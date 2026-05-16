// v3.12.0 — Adiciona colunas de cobranca automatica em romatec_obra_parcelas.
//
// Status flow:
//   pendente            (default — parcela criada, vencimento futuro)
//   msg_enviada         (enviou cobranca antes do vencimento ou no dia)
//   vencido_msg_enviada (vencimento passou e msg foi enviada)
//   cliente_respondeu   (cliente respondeu via WhatsApp — encaminhado pro CEO)
//   pago                (marcado pago manualmente ou via NF)

import pool from './connection';

export async function runCobrancaParcelasMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    {
      label: 'ALTER romatec_obra_parcelas status_cobranca',
      sql: `ALTER TABLE romatec_obra_parcelas
            ADD COLUMN status_cobranca
              ENUM('pendente','msg_enviada','vencido_msg_enviada','cliente_respondeu','pago')
              NOT NULL DEFAULT 'pendente'`,
    },
    {
      label: 'ALTER romatec_obra_parcelas cobranca_enviada_em',
      sql: `ALTER TABLE romatec_obra_parcelas ADD COLUMN cobranca_enviada_em TIMESTAMP NULL`,
    },
    {
      label: 'ALTER romatec_obra_parcelas cobranca_msg_id',
      sql: `ALTER TABLE romatec_obra_parcelas ADD COLUMN cobranca_msg_id VARCHAR(120) NULL`,
    },
    {
      label: 'ALTER romatec_obra_parcelas cliente_resposta_em',
      sql: `ALTER TABLE romatec_obra_parcelas ADD COLUMN cliente_resposta_em TIMESTAMP NULL`,
    },
    {
      label: 'ALTER romatec_obra_parcelas cliente_resposta_texto',
      sql: `ALTER TABLE romatec_obra_parcelas ADD COLUMN cliente_resposta_texto TEXT NULL`,
    },
  ];
  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[cobranca-parcelas-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/Duplicate (column|key)|already exists/i.test(msg)) {
        console.log(`[cobranca-parcelas-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[cobranca-parcelas-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
