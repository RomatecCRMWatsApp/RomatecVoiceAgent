// v3.63.0 — Croqui de Pontos na Proposta de Demarcação (Fase 1b).
//
// Esquema (decisão: tabelas filhas com FK → propostas(id)):
//   propostas_demarcacao_pontos — vértices importados/digitados na proposta
//   propostas_demarcacao_lados  — lados calculados (De→Para, dist, azimute) +
//                                 flag `alinhar` (1 = cerca deste lado será alinhada)
//   propostas (ALTER)           — campos calculados + extensão/origem do alinhamento
//   laudos_demarcacao_lados (ALTER) — flag `alinhar` pra import Proposta→Laudo (§4.4)
//
// FK aponta pra `propostas(id)` (INT signed — confirmado no schema real; NÃO existe
// tabela `propostas_demarcacao`: demarcação é subtipo_consultoria em `propostas`).
// Idempotente: CREATE IF NOT EXISTS + ALTER tolerando 'Duplicate column/key'.

import pool from './connection';

const CREATE_PONTOS = `
  CREATE TABLE IF NOT EXISTS propostas_demarcacao_pontos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    proposta_id INT NOT NULL,
    ordem SMALLINT UNSIGNED NOT NULL,
    vertice VARCHAR(40) NOT NULL,
    utm_e DECIMAL(12,3) NULL,
    utm_n DECIMAL(13,3) NULL,
    lat DECIMAL(11,8) NULL,
    lng DECIMAL(11,8) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_proposta_ordem (proposta_id, ordem),
    KEY idx_pdp_proposta (proposta_id),
    CONSTRAINT fk_pdp_proposta FOREIGN KEY (proposta_id)
      REFERENCES propostas (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const CREATE_LADOS = `
  CREATE TABLE IF NOT EXISTS propostas_demarcacao_lados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    proposta_id INT NOT NULL,
    ordem SMALLINT UNSIGNED NOT NULL,
    vertice_de VARCHAR(40) NOT NULL,
    vertice_para VARCHAR(40) NOT NULL,
    distancia_m DECIMAL(10,2) NOT NULL,
    azimute DECIMAL(6,2) NULL,
    alinhar TINYINT(1) NOT NULL DEFAULT 0,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_proposta_lado (proposta_id, ordem),
    KEY idx_pdl_proposta (proposta_id),
    CONSTRAINT fk_pdl_proposta FOREIGN KEY (proposta_id)
      REFERENCES propostas (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const ALTERS: Array<{ label: string; sql: string }> = [
  {
    label: 'ALTER propostas area_calculada_m2',
    sql: `ALTER TABLE propostas ADD COLUMN area_calculada_m2 DECIMAL(14,2) NULL`,
  },
  {
    label: 'ALTER propostas perimetro_calculado_m',
    sql: `ALTER TABLE propostas ADD COLUMN perimetro_calculado_m DECIMAL(12,2) NULL`,
  },
  {
    label: 'ALTER propostas alinhamento_extensao_m',
    sql: `ALTER TABLE propostas ADD COLUMN alinhamento_extensao_m DECIMAL(12,2) NULL`,
  },
  {
    label: 'ALTER propostas alinhamento_origem',
    sql: `ALTER TABLE propostas ADD COLUMN alinhamento_origem ENUM('manual','croqui') NOT NULL DEFAULT 'manual'`,
  },
  {
    // §4.4: import Proposta→Laudo copia o flag alinhar; laudo precisa da coluna.
    label: 'ALTER laudos_demarcacao_lados alinhar',
    sql: `ALTER TABLE laudos_demarcacao_lados ADD COLUMN alinhar TINYINT(1) NOT NULL DEFAULT 0`,
  },
];

function logOK(l: string) { console.log(`[proposta-croqui-migrations] OK: ${l}`); }
function logExists(l: string) { console.log(`[proposta-croqui-migrations] ja existe (OK): ${l}`); }
function logFail(l: string, m: string) { console.error(`[proposta-croqui-migrations] FALHA ${l}:`, m.slice(0, 200)); }

export async function runPropostaCroquiMigrations(): Promise<void> {
  const creates: Array<{ label: string; sql: string }> = [
    { label: 'propostas_demarcacao_pontos', sql: CREATE_PONTOS },
    { label: 'propostas_demarcacao_lados', sql: CREATE_LADOS },
  ];
  for (const { label, sql } of creates) {
    try {
      await pool.execute(sql);
      logOK(label);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists/i.test(msg)) logExists(label);
      else logFail(label, msg);
    }
  }
  for (const { label, sql } of ALTERS) {
    try {
      await pool.execute(sql);
      logOK(label);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/Duplicate (column|key)|already exists/i.test(msg)) logExists(label);
      else logFail(label, msg);
    }
  }
}
