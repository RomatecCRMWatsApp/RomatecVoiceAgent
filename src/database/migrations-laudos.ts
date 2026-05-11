// v1.99.25 — Migrations DEDICADAS do modulo Laudo de Demarcacao.
// Roda INDEPENDENTE de runMigrations principal (que tem bug pre-existente
// no users.password_hash). Try/catch por operacao — uma falha nao aborta
// a cascata.
//
// Cria 6 tabelas:
//   contratantes (PF/PJ, reusavel em outros modulos do sistema)
//   executantes (responsaveis tecnicos, seed Jose Romario)
//   laudos_demarcacao (cabecalho)
//   laudos_demarcacao_pontos (vertices — uso na Fase 2)
//   laudos_demarcacao_lados (calculados — Fase 2)
//   laudos_demarcacao_fotos (LONGBLOB — Fase 3)

import pool from './connection';

const CREATE_CONTRATANTES = `
  CREATE TABLE IF NOT EXISTS contratantes (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    tipo_pessoa     ENUM('PF','PJ') NOT NULL,
    nome            VARCHAR(255) NOT NULL,
    cpf_cnpj        VARCHAR(20) UNIQUE,
    rg_ie           VARCHAR(30),
    nacionalidade   VARCHAR(50),
    estado_civil    VARCHAR(40),
    profissao       VARCHAR(120),
    cep             VARCHAR(10),
    logradouro      VARCHAR(255),
    numero          VARCHAR(20),
    complemento     VARCHAR(120),
    bairro          VARCHAR(120),
    cidade          VARCHAR(120),
    uf              CHAR(2),
    telefone        VARCHAR(20),
    email           VARCHAR(150),
    observacoes     TEXT,
    ativo           BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tipo_ativo (tipo_pessoa, ativo),
    INDEX idx_nome (nome)
  )
`;

const CREATE_EXECUTANTES = `
  CREATE TABLE IF NOT EXISTS executantes (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    nome            VARCHAR(255) NOT NULL,
    qualificacao    VARCHAR(150),
    registro_cft    VARCHAR(50),
    registro_crea   VARCHAR(50),
    cadastro_incra  VARCHAR(50),
    cpf             VARCHAR(20),
    telefone        VARCHAR(20),
    email           VARCHAR(150),
    ativo           BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

const CREATE_LAUDOS = `
  CREATE TABLE IF NOT EXISTS laudos_demarcacao (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    numero_laudo        VARCHAR(30) UNIQUE NOT NULL,
    contratante_id      INT NOT NULL,
    executante_id       INT NOT NULL,
    tipo_imovel         ENUM('URBANO','RURAL') NOT NULL,
    -- Urbano
    tipo_lote_urbano    ENUM('MEIO_QUADRA','ESQUINA') NULL,
    quadra              VARCHAR(50),
    numero_lote         VARCHAR(50),
    loteamento          VARCHAR(255),
    -- Rural
    denominacao_imovel  VARCHAR(255),
    nirf                VARCHAR(30),
    ccir                VARCHAR(30),
    -- Endereco
    endereco_imovel     TEXT,
    municipio           VARCHAR(120),
    uf_imovel           CHAR(2),
    comarca             VARCHAR(120),
    -- Confrontantes
    confrontante_frente   VARCHAR(255),
    confrontante_lat_dir  VARCHAR(255),
    confrontante_lat_esq  VARCHAR(255),
    confrontante_fundo    VARCHAR(255),
    confrontante_extra    VARCHAR(255),
    -- Calculos
    area_total_m2       DECIMAL(15,4),
    perimetro_m         DECIMAL(15,4),
    -- Croqui
    croqui_tipo         ENUM('AUTO_SVG','UPLOAD') DEFAULT 'AUTO_SVG',
    croqui_path         VARCHAR(500),
    escala              VARCHAR(20),
    -- Responsabilidade tecnica
    usa_art             BOOLEAN DEFAULT FALSE,
    numero_art          VARCHAR(50),
    usa_trt             BOOLEAN DEFAULT FALSE,
    numero_trt          VARCHAR(50),
    -- Financeiro
    valor_servico       DECIMAL(12,2),
    forma_pagamento     ENUM('PIX','DINHEIRO','TRANSFERENCIA','BOLETO'),
    data_pagamento      DATE,
    recibo_id           INT NULL,
    -- PDFs e assinatura
    pdf_path            VARCHAR(500),
    pdf_assinado_blob   LONGBLOB NULL,
    hash_validacao      CHAR(64),
    token_uuid          CHAR(36),
    assinado_em         TIMESTAMP NULL,
    -- Z-API
    zapi_message_id     VARCHAR(100),
    zapi_enviado_em     TIMESTAMP NULL,
    zapi_confirmado_em  TIMESTAMP NULL,
    -- Status
    status              ENUM(
                          'RASCUNHO','PREENCHIDO','ASSINADO','RECIBO_GERADO',
                          'ENVIADO','CONFIRMADO','CANCELADO'
                        ) DEFAULT 'RASCUNHO',
    observacoes         TEXT,
    ativo               BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_contratante (contratante_id),
    INDEX idx_executante (executante_id),
    INDEX idx_status_ativo (status, ativo),
    INDEX idx_token (token_uuid),
    INDEX idx_hash (hash_validacao)
  )
`;

const CREATE_LAUDOS_PONTOS = `
  CREATE TABLE IF NOT EXISTS laudos_demarcacao_pontos (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    laudo_id        INT NOT NULL,
    ordem           INT NOT NULL,
    rotulo          VARCHAR(20) NOT NULL,
    -- UTM
    utm_zona        VARCHAR(5),
    utm_hemisferio  CHAR(1),
    utm_e           DECIMAL(15,4),
    utm_n           DECIMAL(15,4),
    -- Geograficas
    lat_decimal     DECIMAL(12,8),
    long_decimal    DECIMAL(12,8),
    lat_gms         VARCHAR(30),
    long_gms        VARCHAR(30),
    altitude        DECIMAL(8,3),
    -- Marco
    descricao_marco VARCHAR(150),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_laudo_ordem (laudo_id, ordem),
    INDEX idx_laudo (laudo_id)
  )
`;

const CREATE_LAUDOS_LADOS = `
  CREATE TABLE IF NOT EXISTS laudos_demarcacao_lados (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    laudo_id        INT NOT NULL,
    ordem           INT NOT NULL,
    ponto_inicio_id INT NOT NULL,
    ponto_fim_id    INT NOT NULL,
    rotulo          VARCHAR(50),
    distancia_m     DECIMAL(10,3),
    azimute         DECIMAL(7,4),
    INDEX idx_laudo (laudo_id)
  )
`;

const CREATE_LAUDOS_FOTOS = `
  CREATE TABLE IF NOT EXISTS laudos_demarcacao_fotos (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    laudo_id        INT NOT NULL,
    ponto_id        INT NULL,
    ordem           INT,
    mime            VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
    conteudo_b64    LONGTEXT NOT NULL,
    legenda         VARCHAR(255),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_laudo (laudo_id),
    INDEX idx_ponto (ponto_id)
  )
`;

// v2.0.2: seed do executante padrao = CEO Jose Romario.
// INSERT IGNORE pra ser idempotente. UPDATE depois corrige o nome se id=1
// ja existia com valor antigo (ex: bancos que rodaram o seed inicial).
const SEED_EXECUTANTE_PADRAO = `
  INSERT IGNORE INTO executantes
    (id, nome, qualificacao, registro_cft, cadastro_incra, cpf, ativo)
  VALUES
    (1, 'José Romário Pinto Bezerra', 'Técnico em Agrimensura',
     '01209185369', 'FQNS', NULL, TRUE)
`;
const FIX_EXECUTANTE_NOME = `
  UPDATE executantes
     SET nome = 'José Romário Pinto Bezerra',
         qualificacao = 'Técnico em Agrimensura',
         registro_cft = '01209185369',
         cadastro_incra = 'FQNS'
   WHERE id = 1 AND nome <> 'José Romário Pinto Bezerra'
`;

export async function runLaudosMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'contratantes', sql: CREATE_CONTRATANTES },
    { label: 'executantes', sql: CREATE_EXECUTANTES },
    { label: 'laudos_demarcacao', sql: CREATE_LAUDOS },
    { label: 'laudos_demarcacao_pontos', sql: CREATE_LAUDOS_PONTOS },
    { label: 'laudos_demarcacao_lados', sql: CREATE_LAUDOS_LADOS },
    { label: 'laudos_demarcacao_fotos', sql: CREATE_LAUDOS_FOTOS },
    { label: 'seed: executante padrao', sql: SEED_EXECUTANTE_PADRAO },
    // v2.0.2: corrige nome do executante id=1 se ja existia com valor antigo
    { label: 'fix: nome executante #1', sql: FIX_EXECUTANTE_NOME },
    // v1.99.27 — Fase 3: croqui upload em LONGTEXT base64 + mime
    { label: 'ALTER croqui_b64', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN croqui_b64 LONGTEXT NULL' },
    { label: 'ALTER croqui_mime', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN croqui_mime VARCHAR(50) NULL' },
    // v2.0.1 — Representante legal (PJ) e CEP/endereco no contratante
    { label: 'ALTER representante_nome', sql: 'ALTER TABLE contratantes ADD COLUMN representante_nome VARCHAR(255) NULL' },
    { label: 'ALTER representante_cpf', sql: 'ALTER TABLE contratantes ADD COLUMN representante_cpf VARCHAR(20) NULL' },
    { label: 'ALTER representante_cargo', sql: 'ALTER TABLE contratantes ADD COLUMN representante_cargo VARCHAR(120) NULL' },
    // v2.1.0 — Levantamento ponto-a-ponto + foto-por-piquete + azimute manual
    // 4 tipos: URBANO_4P (retangular), URBANO_5P (chanfro), URBANO_NP (poligonal), RURAL
    { label: 'ALTER tipo_levantamento', sql: "ALTER TABLE laudos_demarcacao ADD COLUMN tipo_levantamento ENUM('URBANO_4P','URBANO_5P','URBANO_NP','RURAL') NULL" },
    // Sistema de coordenadas escolhido pelo user (display): UTM | LATLNG | AMBOS
    { label: 'ALTER sistema_coord', sql: "ALTER TABLE laudos_demarcacao ADD COLUMN sistema_coord ENUM('UTM','LATLNG','AMBOS') DEFAULT 'AMBOS'" },
    // Azimute opcional manual por ponto (urbano + rural)
    { label: 'ALTER ponto azimute_manual', sql: 'ALTER TABLE laudos_demarcacao_pontos ADD COLUMN azimute_manual VARCHAR(30) NULL' },
    // Lado: medida manual (override do calculado) + confrontante por lado
    { label: 'ALTER lado medida_manual_m', sql: 'ALTER TABLE laudos_demarcacao_lados ADD COLUMN medida_manual_m DECIMAL(10,3) NULL' },
    { label: 'ALTER lado confrontante_nome', sql: 'ALTER TABLE laudos_demarcacao_lados ADD COLUMN confrontante_nome VARCHAR(255) NULL' },
    { label: 'ALTER lado nome_lado', sql: "ALTER TABLE laudos_demarcacao_lados ADD COLUMN nome_lado VARCHAR(50) NULL" },
    // v2.1.1 — Numero de contrato com loteadora (ex: "26/15-0024" do Colina Park)
    // Opcional — PF nao preenche, PJ/loteadora preenche
    { label: 'ALTER numero_contrato', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN numero_contrato VARCHAR(50) NULL' },
    // v2.1.6 — Descricao do loteamento/area de atuacao da PJ
    // (ex: "Loteamento Colina Park - 156 lotes residenciais Acailandia/MA")
    { label: 'ALTER contratante descricao_area', sql: 'ALTER TABLE contratantes ADD COLUMN descricao_area TEXT NULL' },
    // v2.2.1 — Tempo de rastreio GNSS por ponto (segundos) — opcional
    // Usado em laudo rural pra georreferenciamento NTGIR/INCRA certificavel
    { label: 'ALTER ponto tempo_rastreio_seg', sql: 'ALTER TABLE laudos_demarcacao_pontos ADD COLUMN tempo_rastreio_seg INT NULL' },
    // v2.2.2 — Base GNSS (estacao de referencia) — obrigatorio em rural
    // Exigencia NTGIR/INCRA/SIGEF: registrar inicio e fim do rastreio
    // da base pra calcular horas totais de observacao estatica
    { label: 'ALTER laudo base_nome', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN base_nome VARCHAR(120) NULL' },
    { label: 'ALTER laudo base_inicio_rastreio', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN base_inicio_rastreio DATETIME NULL' },
    { label: 'ALTER laudo base_fim_rastreio', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN base_fim_rastreio DATETIME NULL' },
    { label: 'ALTER laudo base_observacoes', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN base_observacoes TEXT NULL' },
    // v2.2.3: equipamento ROVER (receptor movel). Default no front:
    // 'Receptor GNSS RTK T30 Laser Plus' — mas customizavel por laudo
    { label: 'ALTER laudo rover_nome', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN rover_nome VARCHAR(120) NULL' },
    // v2.2.3: coletor de dados (controlador). Default 'Coletor R60'
    { label: 'ALTER laudo coletor_nome', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN coletor_nome VARCHAR(120) NULL' },
    // v2.4.2: uuid_local — identificador gerado pelo cliente pra suportar
    // criacao OFFLINE de laudos. Quando online sincroniza, server resolve
    // uuid_local → id numerico interno. Frontend pode usar uuid em URLs.
    { label: 'ALTER laudo uuid_local', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN uuid_local CHAR(36) NULL' },
    { label: 'INDEX uuid_local UNIQUE', sql: 'ALTER TABLE laudos_demarcacao ADD UNIQUE INDEX idx_uuid_local (uuid_local)' },
    // v2.6.0 — Dados Registrais (Cartorio): rural (fazenda) e urbano podem ter
    // matricula/livro/folhas + nome do cartorio + CNS (Codigo Nacional de Serventia).
    // CNS e o identificador nacional do cartorio mantido pelo CNJ.
    { label: 'ALTER laudo matricula', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN matricula VARCHAR(60) NULL' },
    { label: 'ALTER laudo livro', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN livro VARCHAR(40) NULL' },
    { label: 'ALTER laudo folhas', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN folhas VARCHAR(40) NULL' },
    { label: 'ALTER laudo cartorio_nome', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN cartorio_nome VARCHAR(200) NULL' },
    { label: 'ALTER laudo cartorio_cns', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN cartorio_cns VARCHAR(20) NULL' },
    // v2.9.0 — Vincula laudo a um lote do cadastro de loteamentos (auto-preenchimento).
    // Quando preenchido, o sistema usa medidas teoricas do lote pra comparar com
    // medidas reais e mostra badge de divergencia se exceder a tolerancia.
    { label: 'ALTER laudo lote_loteamento_id', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN lote_loteamento_id INT NULL' },
    { label: 'INDEX lote_loteamento_id', sql: 'ALTER TABLE laudos_demarcacao ADD INDEX idx_lote_loteamento (lote_loteamento_id)' },
    // v3.5.0 — 14 campos BCI (Boletim do Cadastro Imobiliario - Prefeitura) opcionais
    { label: 'ALTER bci_cod_imovel', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_cod_imovel VARCHAR(20) NULL' },
    { label: 'ALTER bci_loc_cartografica', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_loc_cartografica VARCHAR(50) NULL' },
    { label: 'ALTER bci_distrito', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_distrito VARCHAR(10) NULL' },
    { label: 'ALTER bci_setor', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_setor VARCHAR(10) NULL' },
    { label: 'ALTER bci_quadra', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_quadra VARCHAR(10) NULL' },
    { label: 'ALTER bci_lote', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_lote VARCHAR(10) NULL' },
    { label: 'ALTER bci_unidade', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_unidade VARCHAR(10) NULL' },
    { label: 'ALTER bci_situacao', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_situacao VARCHAR(30) NULL' },
    { label: 'ALTER bci_natureza', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_natureza VARCHAR(50) NULL' },
    { label: 'ALTER bci_logradouro_tipo', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_logradouro_tipo VARCHAR(20) NULL' },
    { label: 'ALTER bci_logradouro_nome', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_logradouro_nome VARCHAR(150) NULL' },
    { label: 'ALTER bci_numero', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_numero VARCHAR(20) NULL' },
    { label: 'ALTER bci_cep', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_cep VARCHAR(10) NULL' },
    { label: 'ALTER bci_complemento', sql: 'ALTER TABLE laudos_demarcacao ADD COLUMN bci_complemento VARCHAR(100) NULL' },
  ];
  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[laudos-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate/i.test(msg)) {
        console.log(`[laudos-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[laudos-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
