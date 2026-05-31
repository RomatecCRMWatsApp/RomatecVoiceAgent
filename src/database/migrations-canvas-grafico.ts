// v3.51.0 — VTA Canvas Grafico Infinito (Modulo A).
// Idempotente (CREATE TABLE IF NOT EXISTS). Roda no boot.
import pool from './connection';

async function exec(sql: string, tag: string): Promise<void> {
  try {
    await pool.execute(sql);
    console.log(`[canvas-grafico-migrations] OK: ${tag}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException & { code?: string }).code;
    if (code === 'ER_TABLE_EXISTS_ERROR' || code === 'ER_DUP_FIELDNAME' || code === 'ER_DUP_KEYNAME') {
      console.log(`[canvas-grafico-migrations] ja existe (OK): ${tag}`);
    } else {
      console.warn(`[canvas-grafico-migrations] aviso (${tag}):`, (err as Error).message.slice(0, 140));
    }
  }
}

export async function runCanvasGraficoMigrations(): Promise<void> {
  await exec(`
    CREATE TABLE IF NOT EXISTS canvas_graficos (
      id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      tipo            ENUM('croqui','planta_baixa','cobertura','quadra','livre') NOT NULL DEFAULT 'livre',
      titulo          VARCHAR(255) NULL,
      laudo_id        INT UNSIGNED NULL,
      proposta_id     INT UNSIGNED NULL,
      dados_svg       LONGTEXT NULL,
      dados_json      JSON NULL,
      largura_virtual FLOAT DEFAULT 2000,
      altura_virtual  FLOAT DEFAULT 2000,
      escala_grafica  VARCHAR(50) DEFAULT '1:500',
      criado_por      VARCHAR(100) NULL,
      criado_em       DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_canvas_laudo (laudo_id),
      INDEX idx_canvas_proposta (proposta_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'CREATE canvas_graficos');

  await exec(`
    CREATE TABLE IF NOT EXISTS canvas_elementos (
      id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      canvas_id       INT UNSIGNED NOT NULL,
      tipo_elemento   ENUM('linha','poligono','texto','seta','cota','norte','circulo','retangulo','imagem') NOT NULL,
      dados_elemento  JSON NOT NULL,
      camada          VARCHAR(50) DEFAULT 'padrao',
      ordem           INT DEFAULT 0,
      criado_em       DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_elem_canvas (canvas_id),
      CONSTRAINT fk_elem_canvas FOREIGN KEY (canvas_id) REFERENCES canvas_graficos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'CREATE canvas_elementos');

  await exec(`
    CREATE TABLE IF NOT EXISTS pranchas_tecnicas (
      id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      canvas_id            INT UNSIGNED NOT NULL,
      titulo_obra          VARCHAR(255) NULL,
      proprietario         VARCHAR(255) NULL,
      endereco             TEXT NULL,
      municipio            VARCHAR(100) NULL,
      tipo_obra            VARCHAR(100) NULL,
      escala               VARCHAR(50) NULL,
      data_prancha         DATE NULL,
      responsavel_tecnico  VARCHAR(100) DEFAULT 'Jose Romario Pinto Bezerra',
      cft_crea             VARCHAR(100) DEFAULT 'CFT/MA no 01209185369',
      numero_prancha       VARCHAR(20) NULL,
      revisao              VARCHAR(10) DEFAULT 'R00',
      legenda_json         JSON NULL,
      svg_final            LONGTEXT NULL,
      criado_em            DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_prancha_canvas (canvas_id),
      CONSTRAINT fk_prancha_canvas FOREIGN KEY (canvas_id) REFERENCES canvas_graficos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'CREATE pranchas_tecnicas');
}
