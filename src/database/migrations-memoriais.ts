// v3.35.0 (= v1.99.19a do prompt): memoriais de calculo (Fase 1).
// Tabela core `memoriais_calculo` + tabela auxiliar `sinapi_indices` com seed
// de indices oficiais (NBR 5626 / NBR 8160 / NBR 5410 / TIGRE / SINAPI).
// Cotações e itens ficam pra Fase 3 (cotacao 3 fornecedores).
//
// Padrao do repo: migrations TS idempotentes rodando no boot (nao SQL standalone).

import pool from './connection';
import type { RowDataPacket } from 'mysql2';

async function tableExists(table: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table],
  );
  return rows.length > 0;
}

// Seed minimo de indices SINAPI/Catalogo TIGRE — Fase 1 prioriza Hidraulico
// (NBR 5626). Demais disciplinas seedam suas linhas em PRs posteriores.
const SEED_SINAPI: Array<{ codigo: string; descricao: string; disciplina: string; unidade: string; consumo: number; unidade_consumo: string; fonte: string }> = [
  // Hidraulico — tubos PVC Soldavel Marrom Classe A (NBR 5648)
  { codigo: 'TIGRE-AF-20',  descricao: 'Tubo PVC Soldavel Marrom DN 20 — Classe A',  disciplina: 'hidraulico', unidade: 'm', consumo: 1.0, unidade_consumo: 'm/m', fonte: 'Catalogo TIGRE 2024' },
  { codigo: 'TIGRE-AF-25',  descricao: 'Tubo PVC Soldavel Marrom DN 25 — Classe A',  disciplina: 'hidraulico', unidade: 'm', consumo: 1.0, unidade_consumo: 'm/m', fonte: 'Catalogo TIGRE 2024' },
  { codigo: 'TIGRE-AF-32',  descricao: 'Tubo PVC Soldavel Marrom DN 32 — Classe A',  disciplina: 'hidraulico', unidade: 'm', consumo: 1.0, unidade_consumo: 'm/m', fonte: 'Catalogo TIGRE 2024' },
  { codigo: 'TIGRE-AF-40',  descricao: 'Tubo PVC Soldavel Marrom DN 40 — Classe A',  disciplina: 'hidraulico', unidade: 'm', consumo: 1.0, unidade_consumo: 'm/m', fonte: 'Catalogo TIGRE 2024' },
  { codigo: 'TIGRE-AF-50',  descricao: 'Tubo PVC Soldavel Marrom DN 50 — Classe A',  disciplina: 'hidraulico', unidade: 'm', consumo: 1.0, unidade_consumo: 'm/m', fonte: 'Catalogo TIGRE 2024' },
  // Sanitario — tubos PVC Serie Normal (Esgoto)
  { codigo: 'TIGRE-ESG-40',  descricao: 'Tubo PVC Serie Normal DN 40 — Esgoto',  disciplina: 'sanitario', unidade: 'm', consumo: 1.0, unidade_consumo: 'm/m', fonte: 'Catalogo TIGRE 2024' },
  { codigo: 'TIGRE-ESG-50',  descricao: 'Tubo PVC Serie Normal DN 50 — Esgoto',  disciplina: 'sanitario', unidade: 'm', consumo: 1.0, unidade_consumo: 'm/m', fonte: 'Catalogo TIGRE 2024' },
  { codigo: 'TIGRE-ESG-75',  descricao: 'Tubo PVC Serie Normal DN 75 — Esgoto',  disciplina: 'sanitario', unidade: 'm', consumo: 1.0, unidade_consumo: 'm/m', fonte: 'Catalogo TIGRE 2024' },
  { codigo: 'TIGRE-ESG-100', descricao: 'Tubo PVC Serie Normal DN 100 — Esgoto', disciplina: 'sanitario', unidade: 'm', consumo: 1.0, unidade_consumo: 'm/m', fonte: 'Catalogo TIGRE 2024' },
  // Arquitetonico — tijolos e telhas (referencia rapida; uso real esta no calc engine)
  { codigo: 'SINAPI 73935',   descricao: 'Alvenaria tijolo 8 furos 9x19x19 — traco 1:2:8',  disciplina: 'arquitetonico', unidade: 'm²', consumo: 28.6, unidade_consumo: 'un/m²', fonte: 'SINAPI' },
  { codigo: 'SINAPI 96113',   descricao: 'Forro gesso colado 60x60',                        disciplina: 'arquitetonico', unidade: 'm²', consumo: 2.78, unidade_consumo: 'un/m²', fonte: 'SINAPI' },
  { codigo: 'SINAPI 7173',    descricao: 'Telha colonial/canal/plan/paulista 44-50cm',     disciplina: 'arquitetonico', unidade: 'm²', consumo: 26.0, unidade_consumo: 'un/m²', fonte: 'SINAPI' },
  { codigo: 'SINAPI 7175',    descricao: 'Telha romana/americana/portuguesa/francesa 41cm', disciplina: 'arquitetonico', unidade: 'm²', consumo: 16.0, unidade_consumo: 'un/m²', fonte: 'SINAPI' },
  // Eletrico — eletrodutos
  { codigo: 'NBR5410-PVC-25', descricao: 'Eletroduto PVC corrugado Ø25 antichamas (NBR 15465)', disciplina: 'eletrico', unidade: 'm', consumo: 1.0, unidade_consumo: 'm/m', fonte: 'NBR 15465' },
  { codigo: 'NBR5410-PVC-32', descricao: 'Eletroduto PVC corrugado Ø32 antichamas',          disciplina: 'eletrico', unidade: 'm', consumo: 1.0, unidade_consumo: 'm/m', fonte: 'NBR 15465' },
];

export async function runMigrationsMemoriais(): Promise<void> {
  // 1) Tabela core memoriais_calculo
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS memoriais_calculo (
        id INT PRIMARY KEY AUTO_INCREMENT,
        codigo VARCHAR(40) NOT NULL UNIQUE,
        disciplina ENUM('arquitetonico','eletrico','hidraulico','sanitario','estrutural','pci')
                   NOT NULL,
        revisao INT NOT NULL DEFAULT 1,

        obra_id INT NULL,
        cliente_id INT NULL,
        user_id INT NULL,

        obra_titulo VARCHAR(300) NOT NULL,
        obra_uso VARCHAR(100) NOT NULL DEFAULT 'Residencial unifamiliar',
        obra_endereco VARCHAR(500) NOT NULL,
        obra_municipio VARCHAR(120) NOT NULL DEFAULT 'Acailandia',
        obra_uf CHAR(2) NOT NULL DEFAULT 'MA',
        obra_cep VARCHAR(10) NULL,

        proprietario_nome VARCHAR(200) NOT NULL,
        proprietario_cpf_cnpj VARCHAR(20) NULL,

        area_lote_m2 DECIMAL(12,2) NULL,
        area_construida_m2 DECIMAL(12,2) NOT NULL,
        taxa_ocupacao_pct DECIMAL(5,2) NULL,
        coef_aproveitamento DECIMAL(5,2) NULL,
        num_pavimentos INT NOT NULL DEFAULT 1,

        wizard_responses JSON NULL,
        pdf_extracted_data JSON NULL,
        pdf_filename VARCHAR(255) NULL,
        pdf_path VARCHAR(500) NULL,
        pdf_hash_sha256 CHAR(64) NULL,

        prancha_codigo VARCHAR(20) NULL,
        prancha_titulo VARCHAR(300) NULL,

        memorial_md MEDIUMTEXT NULL,
        memorial_pdf_path VARCHAR(500) NULL,
        memorial_pdf_size_bytes BIGINT NULL,
        memorial_pdf_hash CHAR(64) NULL,

        lista_materiais_json JSON NULL,
        lista_materiais_pdf_path VARCHAR(500) NULL,

        status ENUM('rascunho','extraindo_pdf','aguardando_wizard','gerando_previa',
                    'aguardando_revisao','finalizado','assinado','enviado','arquivado')
               NOT NULL DEFAULT 'rascunho',

        trt_numero VARCHAR(60) NULL,
        trt_data DATE NULL,
        trt_atividade VARCHAR(120) NULL,

        assinado_em TIMESTAMP NULL,
        assinatura_hash CHAR(64) NULL,
        assinatura_certificado_path VARCHAR(500) NULL,

        enviado_whatsapp_em TIMESTAMP NULL,
        enviado_telegram_em TIMESTAMP NULL,

        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,

        INDEX idx_disciplina (disciplina),
        INDEX idx_obra (obra_id),
        INDEX idx_cliente (cliente_id),
        INDEX idx_status (status),
        INDEX idx_created (created_at),
        INDEX idx_deleted (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[memoriais-migrations] OK: memoriais_calculo');
  } catch (err) {
    console.error('[memoriais-migrations] FALHA memoriais_calculo:', (err as Error).message);
  }

  // 2) Tabela auxiliar sinapi_indices
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS sinapi_indices (
        id INT PRIMARY KEY AUTO_INCREMENT,
        codigo VARCHAR(20) NOT NULL UNIQUE,
        descricao VARCHAR(300) NOT NULL,
        disciplina ENUM('arquitetonico','eletrico','hidraulico','sanitario','estrutural','pci')
                   NOT NULL,
        unidade VARCHAR(20) NOT NULL,
        consumo_por_unidade DECIMAL(12,4) NOT NULL,
        unidade_consumo VARCHAR(20) NOT NULL,
        observacao TEXT NULL,
        fonte VARCHAR(120) NULL,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_disciplina (disciplina),
        INDEX idx_ativo (ativo)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[memoriais-migrations] OK: sinapi_indices');
  } catch (err) {
    console.error('[memoriais-migrations] FALHA sinapi_indices:', (err as Error).message);
  }

  // 3) Seed sinapi_indices (idempotente — INSERT IGNORE por UNIQUE codigo)
  if (await tableExists('sinapi_indices')) {
    for (const idx of SEED_SINAPI) {
      try {
        await pool.execute(
          `INSERT IGNORE INTO sinapi_indices
            (codigo, descricao, disciplina, unidade, consumo_por_unidade, unidade_consumo, fonte, ativo)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [idx.codigo, idx.descricao, idx.disciplina, idx.unidade, idx.consumo, idx.unidade_consumo, idx.fonte],
        );
      } catch (err) {
        console.warn(`[memoriais-migrations] seed sinapi_indices falhou em ${idx.codigo}: ${(err as Error).message}`);
      }
    }
    console.log(`[memoriais-migrations] OK: seed sinapi_indices (${SEED_SINAPI.length} indices)`);
  }
}
