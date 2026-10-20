-- ZAYRA / RomatecVoiceAgent — Módulo de Assinatura Digital do RT (ICP-Brasil A1)
CREATE TABLE IF NOT EXISTS assinatura_certificados (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  titular       VARCHAR(255) NOT NULL,
  cpf           CHAR(11)     NULL,
  emissor       VARCHAR(255) NOT NULL,
  serial        VARCHAR(80)  NOT NULL,
  valido_de     DATETIME     NOT NULL,
  valido_ate    DATETIME     NOT NULL,
  pfx_cifrado   MEDIUMBLOB   NOT NULL,
  iv            VARBINARY(12) NOT NULL,
  tag           VARBINARY(16) NOT NULL,
  ativo         TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_serial (serial)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assinatura_documentos (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo           CHAR(12)     NOT NULL,
  titulo           VARCHAR(255) NOT NULL,
  tipo             VARCHAR(40)  NOT NULL,
  obra             VARCHAR(120) NULL,
  motivo           VARCHAR(255) NOT NULL,
  carimbo_posicao  ENUM('inferior-esquerda','inferior-direita','superior-esquerda','superior-direita','nenhum')
                   NOT NULL DEFAULT 'inferior-esquerda',
  arquivo_original VARCHAR(500) NOT NULL,
  hash_original    CHAR(64)     NOT NULL,
  arquivo_assinado VARCHAR(500) NULL,
  hash_assinado    CHAR(64)     NULL,
  status           ENUM('pendente','assinado','rejeitado','erro') NOT NULL DEFAULT 'pendente',
  motivo_rejeicao  VARCHAR(500) NULL,
  erro             VARCHAR(1000) NULL,
  certificado_id   INT UNSIGNED NULL,
  origem           VARCHAR(60)  NOT NULL DEFAULT 'zayra',
  criado_em        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assinado_em      DATETIME     NULL,
  UNIQUE KEY uk_codigo (codigo),
  KEY idx_status (status),
  CONSTRAINT fk_assin_doc_cert FOREIGN KEY (certificado_id) REFERENCES assinatura_certificados (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assinatura_auditoria (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  documento_id   INT UNSIGNED NULL,
  acao           ENUM('enfileirado','visualizado','aprovado','assinado','rejeitado','erro',
                      'senha_invalida','bloqueio','certificado_importado') NOT NULL,
  detalhe        VARCHAR(1000) NULL,
  ip             VARCHAR(64)  NULL,
  user_agent     VARCHAR(255) NULL,
  hash_documento CHAR(64)     NULL,
  criado_em      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_aud_doc (documento_id),
  KEY idx_aud_acao (acao, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
