// Módulo independente: textos explicativos de serviço (remembramento/desmembramento).
// Roda em separado de runMigrations() principal (mesma pauta de
// migrations-laudos / migrations-loteamentos). Cria 2 tabelas + adiciona
// 1 coluna em `propostas` (idempotente) e popula 2 templates seed.

import type { RowDataPacket } from 'mysql2';
import pool from './connection';

const CREATE_TEXTOS_EXPLICATIVOS = `
  CREATE TABLE IF NOT EXISTS textos_explicativos (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    tipo_servico    ENUM('remembramento','desmembramento') NOT NULL UNIQUE,
    titulo          VARCHAR(200) NOT NULL,
    template_texto  MEDIUMTEXT NOT NULL,
    ativo           TINYINT(1) NOT NULL DEFAULT 1,
    atualizado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

const CREATE_TEXTOS_EXPLICATIVOS_ENVIOS = `
  CREATE TABLE IF NOT EXISTS textos_explicativos_envios (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    tipo_servico    ENUM('remembramento','desmembramento') NOT NULL,
    cliente_id      INT NULL,
    proposta_id     INT NULL,
    numero_destino  VARCHAR(20) NOT NULL,
    modo_envio      ENUM('avulso','com_proposta') NOT NULL,
    texto_enviado   MEDIUMTEXT NOT NULL,
    zapi_message_id VARCHAR(100) NULL,
    status          ENUM('enviado','erro','duplicado') NOT NULL,
    erro_detalhe    TEXT NULL,
    enviado_em      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dedup (numero_destino, tipo_servico, enviado_em),
    INDEX idx_proposta_envio (proposta_id, modo_envio)
  )
`;

// Pequena helper pra detectar coluna existente — same pattern do
// migrations.ts:1278-1294 (try/catch em ALTER + ignorar Duplicate column).
async function alterIgnoringDuplicate(sql: string): Promise<void> {
  try {
    await pool.execute(sql);
  } catch (err) {
    if (/Duplicate column|already exists/i.test((err as Error).message)) {
      return; // expected on re-runs — ignore
    }
    throw err;
  }
}

export interface SeedTemplate {
  tipo_servico: 'remembramento' | 'desmembramento';
  titulo: string;
  template_texto: string;
}

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    tipo_servico: 'remembramento',
    titulo: 'Texto Explicativo — Remembramento',
    template_texto: `Olá, {{cliente_nome}}! Tudo bem?

Sou *José Romário Pinto Bezerra*, Técnico em Agrimensura responsável pela *Romatec Consultoria Total* (CFT/MA nº 01209185369 | INCRA FQNS | CRECI/MA 4.705 | CNAI 031161).

Conforme conversamos, segue abaixo o detalhamento completo do serviço de *Remembramento* dos seus {{quantidade_imoveis}} imóveis localizados em {{municipio}}/{{uf}}.

━━━━━━━━━━━━━━━━━━━━
📋 *O QUE É O REMEMBRAMENTO?*

Remembramento é o procedimento técnico-jurídico que *unifica duas ou mais matrículas* de imóveis contíguos (vizinhos) em uma *única matrícula*, com a área total consolidada.

É o caminho oficial para quem possui vários lotes vizinhos e deseja transformá-los em *uma única propriedade registrada*, simplificando a administração, valorização e futuras transações do bem.

Base legal aplicável: {{base_legal}}.

━━━━━━━━━━━━━━━━━━━━
🔧 *COMO O SERVIÇO É EXECUTADO*

O processo de remembramento dos seus {{quantidade_imoveis}} imóveis seguirá as seguintes etapas:

*1️⃣ Levantamento Topográfico em Campo*
Realização de medição com equipamentos de precisão (estação total / GNSS-RTK) para confirmar os limites reais, áreas e perímetros de cada um dos {{quantidade_imoveis}} imóveis envolvidos.

*2️⃣ Elaboração do Mapa Topográfico*
Produção de planta técnica georreferenciada apresentando *todos os lotes individualmente* — com suas confrontações, áreas e perímetros — e, ao final, a *configuração resultante* da área única já remembrada.

*3️⃣ Memorial Descritivo*
Documento técnico que descreve, em texto formal, todos os limites, ângulos, distâncias e confrontantes da área final remembrada. É a "certidão técnica" que acompanhará a nova matrícula.

*4️⃣ Anotação de Responsabilidade Técnica (ART/TRT)*
Documento obrigatório emitido por profissional habilitado — no seu caso, por mim, Técnico em Agrimensura registrado no CFT/MA sob o nº 01209185369 — que garante a *validade jurídica* das peças técnicas perante os órgãos competentes.

*5️⃣ Requerimento à Superintendência de Habitação e Regularização Fundiária*
Elaboração do requerimento padrão e *protocolo na Prefeitura de {{municipio}}*, acompanhado de toda a documentação técnica e dos IPTUs regularizados.

*6️⃣ Diligências e Acompanhamento*
Acompanho pessoalmente o processo na Superintendência, atendendo às exigências, vistorias e análises técnicas necessárias até a *expedição do ofício de aprovação* municipal.

*7️⃣ Requerimento ao Cartório de Registro de Imóveis*
Com o ofício municipal em mãos, elaboro o requerimento padrão do Cartório e protocolo o acervo completo no *Cartório de Registro de Imóveis competente*.

*8️⃣ Finalização — Matrícula Única*
O Cartório procede com a análise documental e realiza o *remembramento das {{quantidade_imoveis}} matrículas em uma matrícula única*, com a área total definida e devidamente registrada em seu nome.

━━━━━━━━━━━━━━━━━━━━
📑 *DOCUMENTOS NECESSÁRIOS DO CLIENTE*

- RG e CPF (cônjuge, quando aplicável)
- Certidão de casamento (se casado)
- Comprovante de endereço atualizado
- Matrículas atualizadas dos imóveis (≤ 30 dias)
- IPTUs em dia (todos os imóveis envolvidos)
- Certidão negativa de débitos municipais

━━━━━━━━━━━━━━━━━━━━
✅ *RESULTADO FINAL*

Ao concluir, você terá *uma única matrícula* com a área total remembrada, devidamente registrada no Cartório de Registro de Imóveis de {{municipio}}/{{uf}}, em seu nome, pronta para uso, venda, financiamento ou qualquer ato de disposição.

━━━━━━━━━━━━━━━━━━━━

Fico à disposição para esclarecer qualquer dúvida sobre o processo.

*José Romário Pinto Bezerra*
Romatec Consultoria Total
📍 Açailândia/MA
📲 (contato)`,
  },
  {
    tipo_servico: 'desmembramento',
    titulo: 'Texto Explicativo — Desmembramento / Desdobro',
    template_texto: `Olá, {{cliente_nome}}! Tudo bem?

Sou *José Romário Pinto Bezerra*, Técnico em Agrimensura responsável pela *Romatec Consultoria Total* (CFT/MA nº 01209185369 | INCRA FQNS | CRECI/MA 4.705 | CNAI 031161).

Conforme conversamos, segue o detalhamento completo do serviço de *Desmembramento/Desdobro* da sua área de {{area_total}} {{unidade_area}} localizada em {{municipio}}/{{uf}}, a ser subdividida em *{{quantidade_fracoes}} parcelas*.

━━━━━━━━━━━━━━━━━━━━
📋 *O QUE É O DESMEMBRAMENTO?*

Desmembramento (ou Desdobro, conforme o caso) é o procedimento técnico-jurídico que *subdivide uma matrícula única* em *duas ou mais matrículas independentes*, cada uma correspondente a uma fração específica da área original.

É o caminho oficial para quem possui um imóvel maior e deseja:
✔ Vender uma parte separadamente
✔ Dividir entre herdeiros
✔ Regularizar ocupações já existentes
✔ Criar lotes para edificação independente

Base legal aplicável: {{base_legal}}.

━━━━━━━━━━━━━━━━━━━━
🔧 *COMO O SERVIÇO É EXECUTADO*

O processo de desmembramento da sua área seguirá as seguintes etapas:

*1️⃣ Levantamento Topográfico e Demarcação em Campo*
Realização de medição com equipamentos de precisão (estação total / GNSS-RTK) para confirmar os limites reais da área original, sua área total e perímetro. Em seguida, executo a *demarcação física* das frações a serem criadas.

*2️⃣ Elaboração do Mapa Topográfico*
Produção de planta técnica georreferenciada apresentando:
• A *área total original* da matrícula
• A *subdivisão proposta* em {{quantidade_fracoes}} frações
• Áreas, perímetros e confrontações de cada nova parcela
• Sistema viário (quando aplicável)

*3️⃣ Memorial Descritivo de Cada Fração*
Documento técnico individual descrevendo, em texto formal, os limites, ângulos, distâncias e confrontantes de *cada uma das {{quantidade_fracoes}} novas frações* — base técnica das futuras matrículas independentes.

*4️⃣ Anotação de Responsabilidade Técnica (ART/TRT)*
Documento obrigatório emitido por profissional habilitado — no seu caso, por mim, Técnico em Agrimensura registrado no CFT/MA sob o nº 01209185369 — que garante a *validade jurídica* das peças técnicas perante os órgãos competentes.

*5️⃣ Requerimento à Superintendência de Habitação e Regularização Fundiária*
Elaboração do requerimento padrão e *protocolo na Prefeitura de {{municipio}}*, acompanhado de toda a documentação técnica, IPTUs regularizados e taxas de parcelamento do solo conforme legislação municipal.

*6️⃣ Diligências e Acompanhamento*
Acompanho pessoalmente o processo na Superintendência, atendendo às vistorias, análises técnicas e exigências do órgão até a *expedição do ofício de aprovação* municipal.

*7️⃣ Requerimento ao Cartório de Registro de Imóveis*
Com o ofício municipal em mãos, elaboro o requerimento padrão do Cartório e protocolo o acervo completo no *Cartório de Registro de Imóveis competente*.

*8️⃣ Finalização — Matrículas Independentes*
O Cartório procede com a análise documental e realiza o *desmembramento da matrícula original em {{quantidade_fracoes}} matrículas independentes*, cada uma com sua área, perímetro e descrição próprias, devidamente registradas em seu nome.

━━━━━━━━━━━━━━━━━━━━
📑 *DOCUMENTOS NECESSÁRIOS DO CLIENTE*

- RG e CPF (cônjuge, quando aplicável)
- Certidão de casamento (se casado)
- Comprovante de endereço atualizado
- Matrícula atualizada do imóvel (≤ 30 dias)
- IPTU em dia (área matriz)
- Certidão negativa de débitos municipais

━━━━━━━━━━━━━━━━━━━━
✅ *RESULTADO FINAL*

Ao concluir, você terá *{{quantidade_fracoes}} matrículas independentes*, cada uma referente a uma fração específica da área original, devidamente registradas no Cartório de Registro de Imóveis de {{municipio}}/{{uf}}, em seu nome — prontas para venda individual, partilha, financiamento ou qualquer ato de disposição.

━━━━━━━━━━━━━━━━━━━━

Fico à disposição para esclarecer qualquer dúvida sobre o processo.

*José Romário Pinto Bezerra*
Romatec Consultoria Total
📍 Açailândia/MA
📲 (contato)`,
  },
];

export async function runMigrationsExplicativo(): Promise<void> {
  await pool.execute(CREATE_TEXTOS_EXPLICATIVOS);
  await pool.execute(CREATE_TEXTOS_EXPLICATIVOS_ENVIOS);

  // Toggle por proposta — adiciona apenas se ainda não existir.
  await alterIgnoringDuplicate(
    `ALTER TABLE propostas
       ADD COLUMN enviar_explicativo_junto TINYINT(1) NOT NULL DEFAULT 1
       AFTER fontes_consulta`,
  );

  // Seed idempotente: SELECT pra checar existência antes de INSERT.
  // UNIQUE em tipo_servico garante 1 por tipo no banco.
  for (const seed of SEED_TEMPLATES) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM textos_explicativos WHERE tipo_servico = ? LIMIT 1',
      [seed.tipo_servico],
    );
    if (!rows.length) {
      await pool.execute(
        'INSERT INTO textos_explicativos (tipo_servico, titulo, template_texto, ativo) VALUES (?, ?, ?, 1)',
        [seed.tipo_servico, seed.titulo, seed.template_texto],
      );
    }
  }
}
