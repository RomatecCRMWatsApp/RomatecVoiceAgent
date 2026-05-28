// v3.29.0: aditivo de campo (insalubridade/periculosidade) — config + seed
// + vinculo polimorfico com propostas. Tudo idempotente, executado no boot.
//
// 4 templates seedados:
//   - insalubridade grau minimo (10%)
//   - insalubridade grau medio  (20%)
//   - insalubridade grau maximo (40%)
//   - periculosidade unico      (30%)
//
// Base legal: CLT art. 192-193 + NR-15 + NR-16 (Portaria MTE 3.214/78).

import pool from './connection';

const SEED_TEMPLATES: Array<{
  tipo: 'insalubridade' | 'periculosidade';
  grau: 'minimo' | 'medio' | 'maximo' | 'unico';
  percentual: number;
  descricao: string;
  fundamentacao: string;
  texto: string;
}> = [
  {
    tipo: 'insalubridade', grau: 'minimo', percentual: 10.0,
    descricao: 'Adicional de Insalubridade (grau minimo — 10%)',
    fundamentacao: 'CLT art. 192 c/c NR-15 (Anexos 7, 11 e 14) — Portaria MTE 3.214/78',
    texto: `## Sobre o Adicional de Insalubridade

O presente orcamento inclui **Adicional de Insalubridade em grau minimo (10%)**, em conformidade com o **art. 192 da Consolidacao das Leis do Trabalho (CLT)** e a **Norma Regulamentadora no 15 (NR-15)** do Ministerio do Trabalho e Emprego.

A atividade de levantamento topografico/agrimensura em campo expoe o profissional tecnico a agentes insalubres caracterizados, dentre eles:

- **Agentes biologicos** (NR-15 Anexo 14) — exposicao a mosquitos vetores de dengue, zika, chikungunya, malaria, carrapatos transmissores de doenca de Lyme e febre maculosa, abelhas africanizadas, animais peconhentos (serpentes, escorpioes e aranhas);
- **Calor excessivo** (NR-15 Anexo 3) — exposicao prolongada a temperaturas superiores aos limites de tolerancia (IBUTG > 30°C em regioes de clima tropical seco);
- **Radiacao nao ionizante** (NR-15 Anexo 7) — exposicao direta e prolongada a radiacao solar ultravioleta durante a jornada de campo.

O adicional e direito trabalhista irrenunciavel e compoe o custo legitimo do servico tecnico prestado em campo, sendo aqui repassado de forma transparente ao contratante. **Nao constitui lucro adicional, mas tao somente o ressarcimento do encargo trabalhista incidente sobre a remuneracao do profissional exposto.**`,
  },
  {
    tipo: 'insalubridade', grau: 'medio', percentual: 20.0,
    descricao: 'Adicional de Insalubridade (grau medio — 20%)',
    fundamentacao: 'CLT art. 192 c/c NR-15 (Anexos 7, 11, 12 e 14) — Portaria MTE 3.214/78',
    texto: `## Sobre o Adicional de Insalubridade

O presente orcamento inclui **Adicional de Insalubridade em grau medio (20%)**, em conformidade com o **art. 192 da Consolidacao das Leis do Trabalho (CLT)** e a **Norma Regulamentadora no 15 (NR-15)** do Ministerio do Trabalho e Emprego.

A atividade prevista — levantamento topografico/demarcacao em area rural com vegetacao densa, mata fechada ou cerrado nativo — caracteriza exposicao a agentes insalubres de **grau medio**, dentre eles:

- **Agentes biologicos** (NR-15 Anexo 14) — exposicao intensificada a animais peconhentos em mata nativa (jararacas, cascaveis, surucucus, escorpioes amarelos), vetores de doencas tropicais (Aedes aegypti, Anopheles, carrapato-estrela), e abelhas africanizadas;
- **Poeiras minerais** (NR-15 Anexo 12) — em areas de solo exposto, vias nao pavimentadas ou em periodos de seca;
- **Radiacao nao ionizante** (NR-15 Anexo 7) — exposicao direta e prolongada a radiacao solar ultravioleta tipo A e B;
- **Calor excessivo** (NR-15 Anexo 3) — exposicao a IBUTG > 30°C em jornada integral, sem possibilidade de abrigo.

O adicional e direito trabalhista irrenunciavel (CLT art. 193 §3o) e compoe o custo legitimo do servico tecnico de campo. **Nao constitui margem comercial, mas o ressarcimento do encargo trabalhista incidente sobre a remuneracao do profissional exposto** — repassado de forma transparente ao contratante, em atendimento ao principio da boa-fe contratual.`,
  },
  {
    tipo: 'insalubridade', grau: 'maximo', percentual: 40.0,
    descricao: 'Adicional de Insalubridade (grau maximo — 40%)',
    fundamentacao: 'CLT art. 192 c/c NR-15 (Anexos 13 e 14) — Portaria MTE 3.214/78',
    texto: `## Sobre o Adicional de Insalubridade

O presente orcamento inclui **Adicional de Insalubridade em grau maximo (40%)**, em conformidade com o **art. 192 da Consolidacao das Leis do Trabalho (CLT)** e a **Norma Regulamentadora no 15 (NR-15)** do Ministerio do Trabalho e Emprego.

A atividade prevista caracteriza exposicao a agentes insalubres em **grau maximo**, dentre os quais:

- **Agentes biologicos criticos** (NR-15 Anexo 14) — atividade em areas com risco epidemiologico elevado (febre amarela, malaria endemica, leishmaniose), contato direto com efluentes nao tratados, areas alagadas com risco de leptospirose;
- **Agentes quimicos** (NR-15 Anexo 13) — contato com produtos quimicos agricolas residuais em areas recentemente tratadas;
- **Calor excessivo** critico — exposicao em areas sem cobertura vegetal, com IBUTG severo.

O adicional e direito trabalhista irrenunciavel e compoe o custo legitimo do servico, sendo aqui repassado de forma transparente ao contratante.`,
  },
  {
    tipo: 'periculosidade', grau: 'unico', percentual: 30.0,
    descricao: 'Adicional de Periculosidade (30%)',
    fundamentacao: 'CLT art. 193 c/c NR-16 — Portaria MTE 3.214/78',
    texto: `## Sobre o Adicional de Periculosidade

O presente orcamento inclui **Adicional de Periculosidade (30%)**, em conformidade com o **art. 193 da Consolidacao das Leis do Trabalho (CLT)** e a **Norma Regulamentadora no 16 (NR-16)** do Ministerio do Trabalho e Emprego.

A atividade prevista — levantamento topografico/demarcacao em **proximidade de redes eletricas energizadas, linhas de transmissao, subestacoes, faixas de dominio de rodovias federais/estaduais com trafego intenso, ou em pontes/viadutos** — caracteriza atividade perigosa nos termos do **art. 193, incisos I e II da CLT**, expondo o profissional a:

- **Risco de eletrocussao** (NR-16 Anexo 4) — proximidade de redes de alta tensao, equipamentos energizados, sistemas eletricos de potencia;
- **Atropelamento em rodovias** — atividade em faixa de dominio com trafego nao interrompido;
- **Queda em altura** — pontes, viadutos, edificacoes elevadas, taludes verticais.

A periculosidade e incompativel com o adicional de insalubridade, devendo o trabalhador optar pelo mais benefico (CLT art. 193 §2o). Nesta proposta foi adotada a periculosidade, por ser o adicional aplicavel ao tipo de exposicao preponderante no local de execucao.

O adicional e direito trabalhista irrenunciavel e compoe o custo legitimo do servico, sendo aqui repassado de forma transparente ao contratante.`,
  },
];

export async function runMigrationsAditivoCampo(): Promise<void> {
  // 1) Tabela de config
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS aditivo_campo_config (
        id INT PRIMARY KEY AUTO_INCREMENT,
        tipo ENUM('insalubridade','periculosidade') NOT NULL,
        grau ENUM('minimo','medio','maximo','unico') NOT NULL,
        percentual DECIMAL(5,2) NOT NULL,
        aplicar_sobre ENUM('diaria_tecnico','diaria_equipamento','ambas','salario_minimo','salario_base')
          NOT NULL DEFAULT 'ambas',
        descricao_curta VARCHAR(160) NOT NULL,
        fundamentacao_legal TEXT NOT NULL,
        texto_explicativo_md MEDIUMTEXT NOT NULL,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_tipo_grau (tipo, grau)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (err) {
    console.error('[aditivo-campo-migrations] FALHA tabela config:', (err as Error).message);
    return;
  }

  // 2) Seed dos 4 templates (INSERT IGNORE — idempotente via UNIQUE tipo+grau)
  for (const t of SEED_TEMPLATES) {
    try {
      await pool.execute(
        `INSERT IGNORE INTO aditivo_campo_config
          (tipo, grau, percentual, aplicar_sobre, descricao_curta, fundamentacao_legal, texto_explicativo_md, ativo)
         VALUES (?, ?, ?, 'ambas', ?, ?, ?, 1)`,
        [t.tipo, t.grau, t.percentual, t.descricao, t.fundamentacao, t.texto],
      );
    } catch (err) {
      console.error(`[aditivo-campo-migrations] FALHA seed ${t.tipo}/${t.grau}:`, (err as Error).message);
    }
  }
  console.log('[aditivo-campo-migrations] OK: aditivo_campo_config + 4 templates');

  // 3) Tabela polimorfica de vinculo
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS propostas_aditivos_campo (
        id INT PRIMARY KEY AUTO_INCREMENT,
        proposta_tipo VARCHAR(40) NOT NULL,
        proposta_id INT NOT NULL,
        aditivo_config_id INT NOT NULL,
        tipo ENUM('insalubridade','periculosidade') NOT NULL,
        grau ENUM('minimo','medio','maximo','unico') NOT NULL,
        percentual_aplicado DECIMAL(5,2) NOT NULL,
        base_calculo_descricao VARCHAR(255) NOT NULL,
        base_calculo_valor DECIMAL(12,2) NOT NULL,
        valor_aditivo DECIMAL(12,2) NOT NULL,
        texto_pdf_md MEDIUMTEXT NOT NULL,
        observacao_tecnica TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_proposta (proposta_tipo, proposta_id),
        INDEX idx_aditivo_config (aditivo_config_id),
        UNIQUE KEY uq_proposta (proposta_tipo, proposta_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[aditivo-campo-migrations] OK: propostas_aditivos_campo');
  } catch (err) {
    console.error('[aditivo-campo-migrations] FALHA tabela vinculo:', (err as Error).message);
  }
}
