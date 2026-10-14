// v3.142.0 — Migrations do módulo "Gestão de PA / Loteamentos" (pa_*).
//
// Módulo NOVO e independente do `loteamentos` legado (v2.8.0, auto-preenchimento
// de laudo): aqui o foco é a gestão social/financeira de um Projeto de
// Assentamento — lotes, associados, sinal/boletos, documentos e entregas.
//
// Adaptações em relação ao spec (ZAYRA-MODULO-GESTAO-PA-v1):
//   - Railway não tem disco → o binário dos documentos fica em
//     pa_documentos_arquivos (LONGBLOB, 1:1 com pa_documentos). `caminho` guarda o
//     caminho LÓGICO (<projeto>/<LOTE-XX-Nome>/<arquivo>), usado no export ZIP.
//   - pa_lancamentos.parcela é NOT NULL (0 = sinal/à vista) para a chave única
//     (associado, tipo, parcela) funcionar — UNIQUE com NULL não deduplica no MySQL.
//   - pa_pagamentos.seed_chave: idempotência do seed para pagamentos SEM id de
//     transação (espécie). forma ganha 'MISTO' (espécie + Pix no mesmo sinal).
//   - pa_usuarios_perfil: perfil LGPD por usuário (ADMIN/OPERADOR/
//     DIRECAO_ASSOCIACAO); sem linha, o perfil sai do role do JWT.
//   - estado_civil 60 chars ("casada (comunhão parcial de bens)" vem no seed).

import pool from './connection';

const CREATE_PA_PROJETOS = `
  CREATE TABLE IF NOT EXISTS pa_projetos (
    id                     INT AUTO_INCREMENT PRIMARY KEY,
    codigo                 VARCHAR(40)  NOT NULL,
    nome                   VARCHAR(160) NOT NULL,
    municipio              VARCHAR(80)  NOT NULL,
    uf                     CHAR(2)      NOT NULL,
    associacao_nome        VARCHAR(200) NULL,
    associacao_cnpj        VARCHAR(18)  NULL,
    associacao_cnpj_status ENUM('EM_HOMOLOGACAO','ATIVO') DEFAULT 'EM_HOMOLOGACAO',
    presidente_nome        VARCHAR(160) NULL,
    valor_lote             DECIMAL(10,2) NOT NULL,
    sinal_padrao           DECIMAL(10,2) NOT NULL,
    boleto_padrao          DECIMAL(10,2) NOT NULL,
    prazo_sinal            DATE NULL,
    pix_chave              VARCHAR(120) NULL,
    pix_favorecido         VARCHAR(25)  NULL,
    pix_cidade             VARCHAR(15)  NULL,
    rt_nome                VARCHAR(160) NULL,
    rt_registro            VARCHAR(60)  NULL,
    layout_json            JSON NULL,
    criado_em              DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pa_projeto_codigo (codigo)
  ) DEFAULT CHARSET=utf8mb4
`;

const CREATE_PA_LOTES = `
  CREATE TABLE IF NOT EXISTS pa_lotes (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    projeto_id      INT NOT NULL,
    numero          VARCHAR(10) NOT NULL,
    tipo            ENUM('ASSOCIADO','INSTITUCIONAL','VAGO') NOT NULL,
    largura_m       DECIMAL(8,2)  NULL,
    profundidade_m  DECIMAL(8,2)  NULL,
    area_projeto_m2 DECIMAL(12,2) NULL,
    area_medida_m2  DECIMAL(12,2) NULL,
    perimetro_m     DECIMAL(12,2) NULL,
    croqui_xy       JSON NULL,
    geom_sirgas     JSON NULL,
    status_medicao  ENUM('PENDENTE','AGENDADA','MEDIDO','PROCESSADO') DEFAULT 'PENDENTE',
    data_medicao    DATE NULL,
    equipe          VARCHAR(160) NULL,
    base_gnss       VARCHAR(60)  NULL,
    UNIQUE KEY uk_pa_lote (projeto_id, numero),
    CONSTRAINT fk_pa_lote_projeto FOREIGN KEY (projeto_id) REFERENCES pa_projetos(id)
  ) DEFAULT CHARSET=utf8mb4
`;

const CREATE_PA_ASSOCIADOS = `
  CREATE TABLE IF NOT EXISTS pa_associados (
    id                     INT AUTO_INCREMENT PRIMARY KEY,
    projeto_id             INT NOT NULL,
    lote_id                INT NOT NULL,
    numero                 VARCHAR(20)  NOT NULL,
    nome                   VARCHAR(160) NOT NULL,
    cpf                    CHAR(14)     NOT NULL,
    rg                     VARCHAR(80)  NULL,
    nascimento             DATE NULL,
    estado_civil           VARCHAR(60)  NULL,
    conjuge_nome           VARCHAR(160) NULL,
    conjuge_cpf            CHAR(14)     NULL,
    telefone               VARCHAR(60)  NULL,
    telefone_e164          VARCHAR(20)  NULL,
    email                  VARCHAR(160) NULL,
    denominacao_terra      VARCHAR(120) NULL,
    endereco               VARCHAR(255) NULL,
    dia_vencimento         TINYINT NULL,
    contrato_status        ENUM('GERADO','ENVIADO','ASSINADO') DEFAULT 'GERADO',
    contrato_assinado_em   DATETIME NULL,
    carteirinha_emitida_em DATETIME NULL,
    pendencias             TEXT NULL,
    acervo_pasta           VARCHAR(160) NULL,
    ativo                  TINYINT DEFAULT 1,
    criado_em              DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pa_assoc_cpf (projeto_id, cpf),
    UNIQUE KEY uk_pa_assoc_lote (lote_id),
    UNIQUE KEY uk_pa_assoc_num (projeto_id, numero),
    INDEX idx_pa_assoc_tel (telefone_e164),
    CONSTRAINT fk_pa_assoc_lote FOREIGN KEY (lote_id) REFERENCES pa_lotes(id)
  ) DEFAULT CHARSET=utf8mb4
`;

const CREATE_PA_LANCAMENTOS = `
  CREATE TABLE IF NOT EXISTS pa_lancamentos (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    associado_id   INT NOT NULL,
    tipo           ENUM('SINAL','BOLETO','AVISTA','AJUSTE') NOT NULL,
    parcela        TINYINT NOT NULL DEFAULT 0,
    valor          DECIMAL(10,2) NOT NULL,
    vencimento     DATE NULL,
    status         ENUM('A_PAGAR','PARCIAL','PAGO','A_VENCER','VENCIDO','CANCELADO') NOT NULL,
    valor_recebido DECIMAL(10,2) DEFAULT 0,
    descricao      VARCHAR(255) NULL,
    UNIQUE KEY uk_pa_lanc (associado_id, tipo, parcela),
    INDEX idx_pa_lanc_venc (vencimento, status),
    CONSTRAINT fk_pa_lanc_assoc FOREIGN KEY (associado_id) REFERENCES pa_associados(id)
  ) DEFAULT CHARSET=utf8mb4
`;

const CREATE_PA_PAGAMENTOS = `
  CREATE TABLE IF NOT EXISTS pa_pagamentos (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    projeto_id          INT NOT NULL,
    forma               ENUM('PIX','ESPECIE','CARTAO_DEBITO','CARTAO_CREDITO','BOLETO','MISTO') NOT NULL,
    valor               DECIMAL(10,2) NOT NULL,
    pago_em             DATETIME NOT NULL,
    id_transacao        VARCHAR(100) NULL,
    pagador_nome        VARCHAR(160) NULL,
    pagador_cpf_parcial VARCHAR(20)  NULL,
    pagador_instituicao VARCHAR(120) NULL,
    vinculo_pagador     VARCHAR(80)  NULL,
    url_recibo          VARCHAR(400) NULL,
    comprovante_doc_id  INT NULL,
    obs                 TEXT NULL,
    seed_chave          VARCHAR(80) NULL,
    criado_por          VARCHAR(64) NULL,
    criado_em           DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pa_txid (id_transacao),
    UNIQUE KEY uk_pa_pag_seed (seed_chave),
    INDEX idx_pa_pag_proj (projeto_id, pago_em)
  ) DEFAULT CHARSET=utf8mb4
`;

const CREATE_PA_PAGAMENTO_RATEIO = `
  CREATE TABLE IF NOT EXISTS pa_pagamento_rateio (
    pagamento_id  INT NOT NULL,
    lancamento_id INT NOT NULL,
    valor         DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (pagamento_id, lancamento_id),
    INDEX idx_pa_rateio_lanc (lancamento_id)
  ) DEFAULT CHARSET=utf8mb4
`;

const CREATE_PA_DOCUMENTOS = `
  CREATE TABLE IF NOT EXISTS pa_documentos (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    projeto_id       INT NOT NULL,
    lote_id          INT NULL,
    associado_id     INT NULL,
    tipo             ENUM('FOTO_3X4','DOC_IDENTIFICACAO','CERTIDAO','DOC_CONJUGE','COMPROVANTE_SINAL',
                          'PROCESSO_FICHA_CONTRATO','PROCESSO_ASSINADO','CARTEIRINHA','MAPA_LOTE',
                          'MEMORIAL','TRT','RELATORIO','ORIGINAL','OUTRO') NOT NULL,
    versao           INT DEFAULT 1,
    caminho          VARCHAR(400) NOT NULL,
    nome_original    VARCHAR(255) NULL,
    mime             VARCHAR(80)  NULL,
    sha256           CHAR(64)     NULL,
    tamanho          INT NULL,
    arquivo_presente TINYINT NOT NULL DEFAULT 0,
    assinaturas_json JSON NULL,
    criado_em        DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pa_doc_caminho (projeto_id, caminho),
    INDEX idx_pa_doc_assoc (associado_id, tipo),
    INDEX idx_pa_doc_sha (sha256)
  ) DEFAULT CHARSET=utf8mb4
`;

const CREATE_PA_DOCUMENTOS_ARQUIVOS = `
  CREATE TABLE IF NOT EXISTS pa_documentos_arquivos (
    documento_id INT PRIMARY KEY,
    conteudo     LONGBLOB NOT NULL
  )
`;

const CREATE_PA_ENTREGAS = `
  CREATE TABLE IF NOT EXISTS pa_entregas (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    associado_id       INT NOT NULL,
    protocolo          VARCHAR(30) NOT NULL,
    itens_json         JSON NOT NULL,
    entregue_em        DATETIME NULL,
    recebedor_nome     VARCHAR(160) NULL,
    recebedor_cpf      CHAR(14) NULL,
    forma              ENUM('PRESENCIAL','WHATSAPP','EMAIL','GOVBR') NULL,
    comprovante_doc_id INT NULL,
    status             ENUM('PREPARADA','ENTREGUE','RETIDA_PAGAMENTO') DEFAULT 'PREPARADA',
    UNIQUE KEY uk_pa_entrega_prot (protocolo),
    INDEX idx_pa_entrega_assoc (associado_id)
  ) DEFAULT CHARSET=utf8mb4
`;

const CREATE_PA_EVENTOS = `
  CREATE TABLE IF NOT EXISTS pa_eventos (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    projeto_id   INT NULL,
    associado_id INT NULL,
    usuario_id   VARCHAR(64) NULL,
    tipo         VARCHAR(40) NOT NULL,
    dados        JSON NULL,
    criado_em    DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pa_evt_proj (projeto_id, criado_em),
    INDEX idx_pa_evt_assoc (associado_id, criado_em)
  ) DEFAULT CHARSET=utf8mb4
`;

const CREATE_PA_USUARIOS_PERFIL = `
  CREATE TABLE IF NOT EXISTS pa_usuarios_perfil (
    user_sub  VARCHAR(64) PRIMARY KEY,
    perfil    ENUM('ADMIN','OPERADOR','DIRECAO_ASSOCIACAO') NOT NULL,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

// v3.143.0 — Boletos via Asaas (BolePix). Um lançamento pode ter vários boletos
// ao longo do tempo (cancelado → reemitido), mas só UM ativo (PENDENTE/VENCIDO)
// — garantido na aplicação. `externo_id` = id da cobrança no Asaas (pay_…).
const CREATE_PA_BOLETOS = `
  CREATE TABLE IF NOT EXISTS pa_boletos (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    projeto_id      INT NOT NULL,
    associado_id    INT NOT NULL,
    lancamento_id   INT NOT NULL,
    provedor        VARCHAR(20) NOT NULL DEFAULT 'ASAAS',
    externo_id      VARCHAR(40) NOT NULL,
    valor           DECIMAL(10,2) NOT NULL,
    vencimento      DATE NOT NULL,
    status          ENUM('PENDENTE','VENCIDO','PAGO','CANCELADO','ESTORNADO') NOT NULL DEFAULT 'PENDENTE',
    linha_digitavel VARCHAR(80)  NULL,
    nosso_numero    VARCHAR(40)  NULL,
    pix_copia_cola  TEXT NULL,
    url_boleto      VARCHAR(400) NULL,
    url_fatura      VARCHAR(400) NULL,
    pago_em         DATETIME NULL,
    valor_pago      DECIMAL(10,2) NULL,
    pagamento_id    INT NULL,
    enviado_em      DATETIME NULL,
    criado_por      VARCHAR(64) NULL,
    criado_em       DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_pa_boleto_ext (provedor, externo_id),
    INDEX idx_pa_boleto_lanc (lancamento_id, status),
    INDEX idx_pa_boleto_proj (projeto_id, status, vencimento)
  ) DEFAULT CHARSET=utf8mb4
`;

// v3.147.0 — Caixa do PA: movimentos MANUAIS (saídas e entradas avulsas). As
// entradas dos associados vêm de pa_pagamentos — não são duplicadas aqui.
const CREATE_PA_CAIXA_MOVIMENTOS = `
  CREATE TABLE IF NOT EXISTS pa_caixa_movimentos (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    projeto_id    INT NOT NULL,
    tipo          ENUM('ENTRADA','SAIDA') NOT NULL,
    data          DATE NOT NULL,
    categoria     VARCHAR(60)  NOT NULL,
    descricao     VARCHAR(255) NOT NULL,
    valor         DECIMAL(10,2) NOT NULL,
    forma         VARCHAR(20)  NULL,
    favorecido    VARCHAR(160) NULL,
    criado_por    VARCHAR(64)  NULL,
    criado_em     DATETIME DEFAULT CURRENT_TIMESTAMP,
    excluido_em   DATETIME NULL,
    excluido_por  VARCHAR(64)  NULL,
    INDEX idx_pa_caixa_proj (projeto_id, data)
  ) DEFAULT CHARSET=utf8mb4
`;

// v3.143.0 — colunas novas em tabelas já criadas (ALTER idempotente: erro de
// coluna duplicada = já aplicado).
export const PA_ALTERS: ReadonlyArray<{ label: string; sql: string }> = [
  { label: 'pa_projetos.cep_padrao', sql: 'ALTER TABLE pa_projetos ADD COLUMN cep_padrao CHAR(8) NULL' },
  { label: 'pa_projetos.boleto_multa_pct', sql: 'ALTER TABLE pa_projetos ADD COLUMN boleto_multa_pct DECIMAL(5,2) NOT NULL DEFAULT 2.00' },
  { label: 'pa_projetos.boleto_juros_mes_pct', sql: 'ALTER TABLE pa_projetos ADD COLUMN boleto_juros_mes_pct DECIMAL(5,2) NOT NULL DEFAULT 1.00' },
  { label: 'pa_associados.asaas_customer_id', sql: 'ALTER TABLE pa_associados ADD COLUMN asaas_customer_id VARCHAR(40) NULL' },
  { label: 'pa_associados.whatsapp_status', sql: "ALTER TABLE pa_associados ADD COLUMN whatsapp_status ENUM('NAO_VERIFICADO','VALIDO','INEXISTENTE','SEM_TELEFONE') NOT NULL DEFAULT 'NAO_VERIFICADO'" },
  { label: 'pa_associados.whatsapp_numero', sql: 'ALTER TABLE pa_associados ADD COLUMN whatsapp_numero VARCHAR(20) NULL' },
  { label: 'pa_associados.whatsapp_verificado_em', sql: 'ALTER TABLE pa_associados ADD COLUMN whatsapp_verificado_em DATETIME NULL' },
  // v3.144.0: link público do boleto Romatec (/pa/boleto/<token>) — token aleatório, não adivinhável.
  { label: 'pa_boletos.token_publico', sql: 'ALTER TABLE pa_boletos ADD COLUMN token_publico VARCHAR(48) NULL, ADD UNIQUE KEY uk_pa_boleto_token (token_publico)' },
  // v3.144.3: sandbox x produção — ids do Asaas não valem de um ambiente pro outro.
  { label: 'pa_boletos.ambiente', sql: "ALTER TABLE pa_boletos ADD COLUMN ambiente VARCHAR(10) NOT NULL DEFAULT 'sandbox'" },
  { label: 'pa_associados.asaas_ambiente', sql: 'ALTER TABLE pa_associados ADD COLUMN asaas_ambiente VARCHAR(10) NULL' },
  // Tudo emitido até aqui foi no sandbox (única chave usada antes da produção).
  { label: 'asaas_ambiente legado', sql: "UPDATE pa_associados SET asaas_ambiente = 'sandbox' WHERE asaas_customer_id IS NOT NULL AND asaas_ambiente IS NULL" },
  // v3.146.0: perímetro geral do PA (vértices UTM/geográficos, área, memorial).
  { label: 'pa_projetos.perimetro_json', sql: 'ALTER TABLE pa_projetos ADD COLUMN perimetro_json JSON NULL' },
  // CEP geral de Açailândia (zona rural) — confirmado pelo CEO em 13/10/2026.
  { label: 'cep PA Salete Moreno', sql: "UPDATE pa_projetos SET cep_padrao = '65930000' WHERE codigo = 'PA-SALETE-MORENO' AND cep_padrao IS NULL" },
];

export const PA_MIGRATIONS: ReadonlyArray<{ label: string; sql: string }> = [
  { label: 'pa_projetos', sql: CREATE_PA_PROJETOS },
  { label: 'pa_lotes', sql: CREATE_PA_LOTES },
  { label: 'pa_associados', sql: CREATE_PA_ASSOCIADOS },
  { label: 'pa_lancamentos', sql: CREATE_PA_LANCAMENTOS },
  { label: 'pa_pagamentos', sql: CREATE_PA_PAGAMENTOS },
  { label: 'pa_pagamento_rateio', sql: CREATE_PA_PAGAMENTO_RATEIO },
  { label: 'pa_documentos', sql: CREATE_PA_DOCUMENTOS },
  { label: 'pa_documentos_arquivos', sql: CREATE_PA_DOCUMENTOS_ARQUIVOS },
  { label: 'pa_entregas', sql: CREATE_PA_ENTREGAS },
  { label: 'pa_eventos', sql: CREATE_PA_EVENTOS },
  { label: 'pa_usuarios_perfil', sql: CREATE_PA_USUARIOS_PERFIL },
  { label: 'pa_boletos', sql: CREATE_PA_BOLETOS },
  { label: 'pa_caixa_movimentos', sql: CREATE_PA_CAIXA_MOVIMENTOS },
];

export async function runPaMigrations(): Promise<void> {
  for (const { label, sql } of PA_MIGRATIONS) {
    try {
      await pool.execute(sql);
      console.log(`[pa-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate/i.test(msg)) {
        console.log(`[pa-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[pa-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
  for (const { label, sql } of PA_ALTERS) {
    try {
      await pool.execute(sql);
      console.log(`[pa-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/Duplicate column/i.test(msg)) continue;
      console.error(`[pa-migrations] FALHA ${label}:`, msg.slice(0, 200));
    }
  }
}
