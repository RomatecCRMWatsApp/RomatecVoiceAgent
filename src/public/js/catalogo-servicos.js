// catalogo-servicos.js — v1.84.0
// Catálogo técnico-legal de serviços do escritório Romatec.
// 9 categorias × subgrupos × serviços. Cada serviço tem texto técnico
// pronto pra ser auto-preenchido na descrição do recibo.
//
// Carregado via <script> simples no obras.html (não-module, expõe window.CATALOGO_SERVICOS).

(function () {
  const HELPER_TAIL = '\n\nDetalhes específicos deste atendimento: ';

  window.CATALOGO_SERVICOS = [
    // ─────────────────────────────────────────────────────────────────
    // CATEGORIA 1 — Serviços Técnicos de Campo (sigla: CAMP)
    // ─────────────────────────────────────────────────────────────────
    {
      id: 'campo',
      sigla: 'CAMP',
      nome: 'Serviços Técnicos de Campo',
      subgrupos: [
        {
          nome: 'Georreferenciamento',
          servicos: [
            {
              id: 'geo-rural-sigef',
              nome: 'Georreferenciamento de Imóvel Rural (SIGEF/INCRA)',
              descricao:
`Serviço de Georreferenciamento de Imóvel Rural certificado junto ao INCRA via plataforma SIGEF.

Definição: levantamento topográfico georreferenciado ao Sistema Geodésico Brasileiro (SGB), com determinação das coordenadas dos vértices definidores dos limites do imóvel, dentro da precisão posicional fixada pelo INCRA.

Base legal/normativa: Lei nº 10.267/2001; Decreto nº 4.449/2002; Norma Técnica para Georreferenciamento de Imóveis Rurais (NTGIR) – 3ª Edição/INCRA; NBR 13133/1994.

Finalidade: obrigatório para qualquer ato registral de transferência, desmembramento, remembramento, retificação ou regularização de imóvel rural.

Órgão competente: INCRA (certificação SIGEF) e Cartório de Registro de Imóveis (averbação/registro).` + HELPER_TAIL,
            },
            {
              id: 'geo-urbano',
              nome: 'Georreferenciamento de Imóvel Urbano',
              descricao:
`Serviço de Georreferenciamento de Imóvel Urbano com amarração ao Sistema Geodésico Brasileiro.

Definição: levantamento com determinação de coordenadas geodésicas dos vértices do imóvel urbano, com elaboração de memorial descritivo e planta georreferenciada.

Base legal/normativa: Lei nº 6.015/1973; NBR 13133/1994; NBR 14166/2022.

Finalidade: regularização cadastral, retificação de área, usucapião urbana, REURB.

Órgão competente: Cartório de Registro de Imóveis e Prefeitura Municipal.` + HELPER_TAIL,
            },
            {
              id: 'geo-gleba',
              nome: 'Georreferenciamento de Gleba / Fazenda',
              descricao:
`Serviço de Georreferenciamento de Gleba ou Fazenda — grandes áreas rurais.

Definição: levantamento georreferenciado de poligonal fechada de imóveis rurais de grande extensão, ao Sistema Geodésico Brasileiro.

Base legal/normativa: Lei nº 10.267/2001; NTGIR/INCRA; Lei nº 13.465/2017.

Finalidade: certificação SIGEF, processo de titulação de terras públicas, destaque de gleba.

Órgão competente: INCRA, ITERMA (terras estaduais MA), SPU.` + HELPER_TAIL,
            },
            {
              id: 'geo-retificacao',
              nome: 'Retificação de Georreferenciamento',
              descricao:
`Serviço de Retificação de Georreferenciamento já certificado.

Definição: correção técnica de georreferenciamento previamente certificado, em razão de erro material, divergência ou sobreposição com matrículas vizinhas.

Base legal/normativa: Lei nº 6.015/1973 (arts. 212/213); Lei nº 10.267/2001; NTGIR/INCRA.

Finalidade: sanar inconsistências cadastrais e registrais.

Órgão competente: INCRA e Cartório de Registro de Imóveis.` + HELPER_TAIL,
            },
            {
              id: 'geo-ratificacao-memorial',
              nome: 'Ratificação de Memorial Descritivo',
              descricao:
`Serviço de Ratificação de Memorial Descritivo.

Definição: conferência, atualização e revalidação técnica de memorial descritivo já existente, mantendo coordenadas e descrição da poligonal.

Base legal/normativa: NBR 13133/1994; NTGIR/INCRA.

Finalidade: atualização documental para averbação, transferência ou financiamento.

Órgão competente: Cartório de Registro de Imóveis.` + HELPER_TAIL,
            },
          ],
        },
        {
          nome: 'Demarcação e Locação',
          servicos: [
            { id: 'demarc-urbano', nome: 'Demarcação de Imóvel Urbano',
              descricao: `Serviço de Demarcação de Imóvel Urbano.\n\nDefinição: identificação física dos limites do imóvel em campo, com implantação de marcos visuais sobre os vértices da poligonal.\n\nBase legal/normativa: Código Civil arts. 1.297/1.298; NBR 13133/1994.\n\nFinalidade: solução de conflito de divisas e materialização da posse.` + HELPER_TAIL },
            { id: 'demarc-rural', nome: 'Demarcação de Imóvel Rural',
              descricao: `Serviço de Demarcação de Imóvel Rural.\n\nDefinição: implantação de marcos físicos georreferenciados nas divisas do imóvel rural, conforme memorial descritivo certificado no SIGEF.\n\nBase legal/normativa: Lei nº 10.267/2001; Código Civil arts. 1.297/1.298; NTGIR/INCRA.\n\nFinalidade: materialização das divisas para evitar invasão e sobreposição.` + HELPER_TAIL },
            { id: 'locacao-obra', nome: 'Locação de Obra (gabarito/marcação)',
              descricao: `Serviço de Locação de Obra.\n\nDefinição: transposição do projeto arquitetônico/estrutural para o terreno, mediante marcação de gabarito, eixos e níveis das fundações.\n\nBase legal/normativa: NBR 13133/1994; NBR 6122/2019.\n\nFinalidade: garantir a correta implantação da edificação conforme projeto aprovado.` + HELPER_TAIL },
            { id: 'locacao-divisas', nome: 'Locação de Divisas',
              descricao: `Serviço de Locação de Divisas.\n\nDefinição: marcação física em campo das divisas do imóvel a partir de memorial descritivo, com implantação de piquetes ou marcos.\n\nBase legal/normativa: NBR 13133/1994; Código Civil.\n\nFinalidade: identificação visual das divisas para fins de cercamento, contestação ou mediação.` + HELPER_TAIL },
            { id: 'piqueteamento', nome: 'Piqueteamento / Marcação de Vértices',
              descricao: `Serviço de Piqueteamento de Vértices.\n\nDefinição: implantação de piquetes de madeira ou metal nos vértices da poligonal levantada, sem necessidade de marco fixo permanente.\n\nBase legal/normativa: NBR 13133/1994.\n\nFinalidade: orientação preliminar de cerca, projeto ou obra.` + HELPER_TAIL },
            { id: 'marcos-topograficos', nome: 'Implantação de Marcos Topográficos',
              descricao: `Serviço de Implantação de Marcos Topográficos.\n\nDefinição: cravação de marcos físicos permanentes (concreto, ferro ou natural) com identificação numérica e amarração ao SGB.\n\nBase legal/normativa: NTGIR/INCRA; NBR 13133/1994.\n\nFinalidade: materialização permanente dos vértices da poligonal certificada.` + HELPER_TAIL },
          ],
        },
        {
          nome: 'Levantamentos Topográficos',
          servicos: [
            { id: 'topo-planimetrico', nome: 'Levantamento Planimétrico',
              descricao: `Serviço de Levantamento Planimétrico.\n\nDefinição: levantamento topográfico bidimensional (X,Y) das feições, divisas e benfeitorias do imóvel.\n\nBase legal/normativa: NBR 13133/1994.\n\nFinalidade: subsídio a projetos, parcelamento, regularização e demarcação.` + HELPER_TAIL },
            { id: 'topo-planialtimetrico', nome: 'Levantamento Planialtimétrico',
              descricao: `Serviço de Levantamento Planialtimétrico.\n\nDefinição: levantamento topográfico tridimensional (X,Y,Z) com curvas de nível e perfis longitudinais/transversais.\n\nBase legal/normativa: NBR 13133/1994.\n\nFinalidade: projeto de terraplenagem, drenagem, edificação, açude.` + HELPER_TAIL },
            { id: 'topo-cadastral', nome: 'Levantamento Cadastral',
              descricao: `Serviço de Levantamento Cadastral.\n\nDefinição: levantamento detalhado com identificação de lotes, edificações, benfeitorias e infraestrutura urbana.\n\nBase legal/normativa: NBR 14166/2022; NBR 13133/1994.\n\nFinalidade: cadastro técnico municipal, regularização fundiária, projeto urbano.` + HELPER_TAIL },
            { id: 'topo-reurb', nome: 'Levantamento para Regularização Fundiária',
              descricao: `Serviço de Levantamento Topográfico para Regularização Fundiária (REURB).\n\nDefinição: levantamento das unidades imobiliárias, vias, áreas públicas e privadas em núcleo urbano informal.\n\nBase legal/normativa: Lei nº 13.465/2017; Decreto nº 9.310/2018; NBR 13133/1994.\n\nFinalidade: subsídio técnico para REURB-S ou REURB-E ou usucapião extrajudicial.` + HELPER_TAIL },
          ],
        },
      ],
    },

    // ─────────────────────────────────────────────────────────────────
    // CATEGORIA 2 — Desenho / Mapas (sigla: MAPA)
    // ─────────────────────────────────────────────────────────────────
    {
      id: 'mapa', sigla: 'MAPA', nome: 'Desenho / Mapas',
      subgrupos: [{ nome: 'Peças gráficas', servicos: [
        { id: 'planta-topografica', nome: 'Elaboração de Mapa / Planta Topográfica',
          descricao: `Serviço de Elaboração de Planta Topográfica.\n\nDefinição: peça gráfica oficial em escala apropriada, contendo poligonal, confrontações, áreas, coordenadas e legenda técnica.\n\nBase legal/normativa: NBR 13133/1994; NBR 8196/1999.\n\nFinalidade: peça técnica anexa a memorial, processo registral, projeto ou licenciamento.` + HELPER_TAIL },
        { id: 'memorial-descritivo', nome: 'Memorial Descritivo',
          descricao: `Serviço de Elaboração de Memorial Descritivo.\n\nDefinição: descrição textual técnica da poligonal do imóvel — vértices, azimutes, distâncias, confrontações e área.\n\nBase legal/normativa: Lei nº 10.267/2001; NTGIR/INCRA; NBR 13133/1994.\n\nFinalidade: peça obrigatória para registro, retificação ou averbação cartorária.` + HELPER_TAIL },
        { id: 'planta-situacao', nome: 'Planta de Situação e Localização',
          descricao: `Serviço de Elaboração de Planta de Situação e Localização.\n\nDefinição: representação gráfica da posição do imóvel/edificação em relação às vias, ao norte e às divisas.\n\nBase legal/normativa: Legislação municipal de obras; NBR 6492/1994.\n\nFinalidade: anexo a projeto arquitetônico, alvará de construção, licenciamento.` + HELPER_TAIL },
        { id: 'croqui-localizacao', nome: 'Croqui de Localização',
          descricao: `Serviço de Elaboração de Croqui de Localização.\n\nDefinição: desenho esquemático de localização do imóvel sem rigor cartográfico, com pontos de referência.\n\nBase legal/normativa: Prática técnica e exigências cartoriais.\n\nFinalidade: anexo a processos administrativos simples, registro, escritura.` + HELPER_TAIL },
        { id: 'mapa-ambiental', nome: 'Mapa para Processo de Licenciamento Ambiental',
          descricao: `Serviço de Elaboração de Mapa Temático Ambiental.\n\nDefinição: peça gráfica georreferenciada com Áreas de Preservação Permanente (APP), Reserva Legal (RL), hidrografia, vegetação e uso do solo.\n\nBase legal/normativa: Lei nº 12.651/2012 (Código Florestal); Resoluções CONAMA aplicáveis.\n\nFinalidade: subsídio a CAR, licenciamento ambiental e processo de regularização ambiental.` + HELPER_TAIL },
      ]}],
    },

    // ─────────────────────────────────────────────────────────────────
    // CATEGORIA 3 — Parcelamento de Solo (sigla: PARC)
    // ─────────────────────────────────────────────────────────────────
    {
      id: 'parcelamento', sigla: 'PARC', nome: 'Parcelamento de Solo',
      subgrupos: [{ nome: 'Modalidades', servicos: [
        { id: 'desmembramento', nome: 'Desmembramento',
          descricao: `Serviço de Projeto de Desmembramento.\n\nDefinição: subdivisão de gleba em lotes destinados a edificação SEM abertura de novas vias, logradouros ou prolongamento, modificação ou ampliação dos já existentes.\n\nBase legal/normativa: Lei nº 6.766/1979 (art. 2º, §2º); legislação municipal.\n\nFinalidade: aprovação municipal e averbação cartorária do parcelamento.` + HELPER_TAIL },
        { id: 'desdobro', nome: 'Desdobro',
          descricao: `Serviço de Projeto de Desdobro.\n\nDefinição: subdivisão de lote urbano já registrado em duas ou mais unidades menores, dentro dos parâmetros mínimos da legislação municipal.\n\nBase legal/normativa: Lei nº 6.766/1979; lei municipal de uso e ocupação do solo.\n\nFinalidade: aprovação municipal e averbação cartorária.` + HELPER_TAIL },
        { id: 'remembramento', nome: 'Remembramento / Unificação',
          descricao: `Serviço de Projeto de Remembramento.\n\nDefinição: unificação de dois ou mais lotes contíguos em uma única matrícula.\n\nBase legal/normativa: Lei nº 6.766/1979 (art. 3º); Lei nº 6.015/1973 (art. 234).\n\nFinalidade: simplificação cadastral, viabilização de projeto único, averbação cartorária.` + HELPER_TAIL },
        { id: 'fracionamento-rural', nome: 'Fracionamento de área rural',
          descricao: `Serviço de Fracionamento de Área Rural.\n\nDefinição: divisão de imóvel rural respeitando a Fração Mínima de Parcelamento (FMP) do município, conforme tabela do INCRA.\n\nBase legal/normativa: Lei nº 5.868/1972 (art. 8º); Lei nº 4.504/1964 (Estatuto da Terra); INs do INCRA.\n\nFinalidade: legalização de partilha, venda parcial, sucessão.` + HELPER_TAIL },
        { id: 'loteamento', nome: 'Loteamento (projeto completo)',
          descricao: `Serviço de Projeto de Loteamento.\n\nDefinição: subdivisão de gleba em lotes com abertura de vias, logradouros, áreas verdes, áreas institucionais e infraestrutura urbana.\n\nBase legal/normativa: Lei nº 6.766/1979; legislação municipal específica.\n\nFinalidade: aprovação municipal e registro do loteamento no Cartório de RI.` + HELPER_TAIL },
        { id: 'retificacao-area', nome: 'Retificação de Área',
          descricao: `Serviço de Retificação de Área.\n\nDefinição: correção da área, descrição ou confrontações constantes na matrícula do imóvel quando há divergência com a realidade física.\n\nBase legal/normativa: Lei nº 6.015/1973 (arts. 212/213, redação Lei nº 10.931/2004).\n\nFinalidade: regularização da matrícula para venda, transferência ou financiamento.` + HELPER_TAIL },
      ]}],
    },

    // ─────────────────────────────────────────────────────────────────
    // CATEGORIA 4 — Assessoria e Regularização Imobiliária (sigla: IMOB)
    // ─────────────────────────────────────────────────────────────────
    {
      id: 'imobiliaria', sigla: 'IMOB', nome: 'Assessoria e Regularização Imobiliária',
      subgrupos: [{ nome: 'Atos cartorários e regularização', servicos: [
        { id: 'imob-transferencia', nome: 'Assessoria em Transferência de Imóvel',
          descricao: `Serviço de Assessoria em Transferência de Imóvel.\n\nDefinição: acompanhamento técnico e documental de processo de transmissão de propriedade (compra e venda, doação, herança).\n\nBase legal/normativa: Lei nº 6.015/1973; Código Civil (arts. 1.245/1.247).\n\nFinalidade: garantir a correta lavratura da escritura e o registro da transferência.` + HELPER_TAIL },
        { id: 'imob-averbacao', nome: 'Assessoria em Averbação (construção, demolição, área)',
          descricao: `Serviço de Assessoria em Averbação Cartorária.\n\nDefinição: registro à margem da matrícula de fato superveniente — construção, demolição, retificação de área, mudança de estado civil.\n\nBase legal/normativa: Lei nº 6.015/1973 (art. 167, II).\n\nFinalidade: atualização da matrícula com a realidade física e jurídica do imóvel.` + HELPER_TAIL },
        { id: 'imob-matricula', nome: 'Assessoria em Abertura de Matrícula',
          descricao: `Serviço de Assessoria em Abertura de Matrícula.\n\nDefinição: organização documental e técnica para a primeira matrícula do imóvel quando ainda não há registro individualizado.\n\nBase legal/normativa: Lei nº 6.015/1973; Lei nº 13.465/2017.\n\nFinalidade: individualização registral do imóvel.` + HELPER_TAIL },
        { id: 'imob-usucapiao', nome: 'Assessoria em Usucapião (peça técnica)',
          descricao: `Serviço de Elaboração de Peça Técnica para Usucapião.\n\nDefinição: elaboração de planta, memorial e parecer técnico para processo de usucapião extrajudicial ou judicial.\n\nBase legal/normativa: CPC art. 216-A (extrajudicial); Lei nº 6.015/1973; Código Civil (arts. 1.238/1.244).\n\nFinalidade: subsídio técnico ao processo de aquisição originária da propriedade.` + HELPER_TAIL },
        { id: 'imob-reurb', nome: 'Assessoria em Regularização Fundiária (REURB-S / REURB-E)',
          descricao: `Serviço de Assessoria em Regularização Fundiária Urbana.\n\nDefinição: acompanhamento técnico do processo de REURB de Interesse Social (REURB-S) ou Específico (REURB-E).\n\nBase legal/normativa: Lei nº 13.465/2017; Decreto nº 9.310/2018.\n\nFinalidade: titulação dos ocupantes de núcleo urbano informal.` + HELPER_TAIL },
        { id: 'imob-inventario', nome: 'Assessoria em Inventário (parte técnica imobiliária)',
          descricao: `Serviço de Assessoria Técnica em Inventário.\n\nDefinição: avaliação dos bens imóveis do espólio, planta de partilha e laudos para divisão entre herdeiros.\n\nBase legal/normativa: Código Civil; CPC; NBR 14653.\n\nFinalidade: subsídio à partilha amigável ou judicial.` + HELPER_TAIL },
        { id: 'imob-acomp-cartorio', nome: 'Acompanhamento de Processo Cartorário',
          descricao: `Serviço de Acompanhamento de Processo Cartorário.\n\nDefinição: protocolo, acompanhamento e cumprimento de exigências em Cartório de Registro de Imóveis ou Tabelionato.\n\nBase legal/normativa: Lei nº 6.015/1973; Lei nº 8.935/1994.\n\nFinalidade: agilizar e dar correção técnica ao processo registral.` + HELPER_TAIL },
        { id: 'imob-acomp-orgaos', nome: 'Acompanhamento de Processo no INCRA / ITERMA / Prefeitura',
          descricao: `Serviço de Acompanhamento de Processo Administrativo.\n\nDefinição: protocolo, acompanhamento e cumprimento de exigências em órgãos públicos (INCRA, ITERMA, SEMA, Prefeitura).\n\nBase legal/normativa: Lei nº 10.267/2001; legislação estadual MA; Lei Orgânica Municipal.\n\nFinalidade: viabilizar processo administrativo de certificação, titulação ou licenciamento.` + HELPER_TAIL },
        // v3.49.0: 3 serviços de atualização cadastral/fiscal/ambiental do imóvel rural.
        // Casam com o módulo de anexos de recibo (CCIR/ITR/CAR exigem documentos complementares).
        { id: 'imob-ccir', nome: 'Assessoria em Atualização de CCIR (INCRA)',
          descricao:
`Assessoria técnica especializada para atualização do Certificado de Cadastro de Imóvel Rural (CCIR) junto ao Instituto Nacional de Colonização e Reforma Agrária — INCRA, conforme exigido pelo art. 22 da Lei nº 4.947/1966, art. 96 do Estatuto da Terra (Lei nº 4.504/1964) e Norma de Execução INCRA nº 95/2010.

Compreende: levantamento da situação cadastral atual no SNCR (Sistema Nacional de Cadastro Rural); atualização de dados do imóvel, do detentor e da estrutura fundiária; emissão do CCIR quitado para o exercício vigente; orientação quanto à obrigatoriedade de apresentação em atos de transferência, desmembramento, hipoteca e arrendamento, nos termos do art. 22, §1º, da Lei nº 4.947/1966.

Base legal/normativa: Lei nº 4.947/1966 · Lei nº 4.504/1964 (Estatuto da Terra) · IN INCRA nº 95/2010 · Decreto nº 72.106/1973.

Finalidade: regularização cadastral do imóvel rural perante o INCRA, habilitação para atos de registro e transferência cartorária.` + HELPER_TAIL },
        { id: 'imob-itr-nirf', nome: 'Assessoria em Atualização de ITR / NIRF (Receita Federal)',
          descricao:
`Assessoria técnica para atualização do Número do Imóvel na Receita Federal (NIRF) e regularização da declaração do Imposto sobre a Propriedade Territorial Rural (ITR) junto à Secretaria Especial da Receita Federal do Brasil, conforme Lei nº 9.393/1996, Decreto nº 4.382/2002 e Instrução Normativa RFB nº 1.877/2019.

Compreende: verificação da situação do NIRF no sistema CAFIR; atualização de dados cadastrais do imóvel e do declarante; orientação e apoio na elaboração/retificação da DITR (Declaração do ITR); análise da Área Tributável, Área de Preservação Permanente (APP), Reserva Legal e demais isenções previstas em lei; emissão de certidão de regularidade fiscal perante a RFB quando aplicável.

Base legal/normativa: Lei nº 9.393/1996 · Decreto nº 4.382/2002 · IN RFB nº 1.877/2019 · Lei nº 12.651/2012 (Código Florestal — isenções de APP/RL).

Finalidade: regularização fiscal do imóvel rural, habilitação para financiamentos rurais, registros e atos notariais.` + HELPER_TAIL },
        { id: 'imob-car-sicar', nome: 'Assessoria em Atualização de CAR — SICAR/AMBIS',
          descricao:
`Assessoria técnica especializada para inscrição, atualização ou retificação no Cadastro Ambiental Rural (CAR) junto ao SICAR (Sistema Nacional de Cadastro Ambiental Rural) e, quando aplicável, integração com o sistema AMBIS do Estado do Maranhão, conforme Lei nº 12.651/2012 (Código Florestal), Decreto nº 7.830/2012 e IN MMA nº 2/2014.

Compreende: análise georreferenciada do imóvel rural; delimitação e inserção digital das áreas de Reserva Legal (RL), Áreas de Preservação Permanente (APP), Uso Restrito, Servidão Ambiental e Área Consolidada; upload de shapefile ou polígono via plataforma SICAR/AMBIS; acompanhamento da análise pelo órgão ambiental competente (SEMA/MA ou IBAMA); emissão do recibo de inscrição e número de protocolo CAR.

Base legal/normativa: Lei nº 12.651/2012 (Código Florestal) · Decreto nº 7.830/2012 · IN MMA nº 2/2014 · Resolução CONAMA nº 369/2006 · Legislação estadual MA (SEMA).

Finalidade: regularização ambiental do imóvel rural, cumprimento de exigência para financiamento (Pronaf, ABC+), averbação de RL e habilitação para Programas de Regularização Ambiental (PRA).` + HELPER_TAIL },
      ]}],
    },

    // ─────────────────────────────────────────────────────────────────
    // CATEGORIA 5 — Documentação Técnica (sigla: DOC)
    // ─────────────────────────────────────────────────────────────────
    {
      id: 'documentacao', sigla: 'DOC', nome: 'Documentação Técnica',
      subgrupos: [{ nome: 'Responsabilidade técnica e laudos', servicos: [
        { id: 'art', nome: 'ART — Anotação de Responsabilidade Técnica',
          descricao: `Serviço de Emissão de ART (Anotação de Responsabilidade Técnica).\n\nDefinição: documento que vincula o profissional ao serviço técnico executado ou à obra, registrando a responsabilidade junto ao CREA.\n\nBase legal/normativa: Lei nº 6.496/1977; Resolução CONFEA nº 1.025/2009; nº 1.137/2023.\n\nÓrgão competente: CREA (Conselho Regional de Engenharia e Agronomia).` + HELPER_TAIL },
        { id: 'rrt', nome: 'RRT — Registro de Responsabilidade Técnica',
          descricao: `Serviço de Emissão de RRT (Registro de Responsabilidade Técnica).\n\nDefinição: equivalente da ART para Arquitetos e Urbanistas, registrando a responsabilidade técnica junto ao CAU.\n\nBase legal/normativa: Lei nº 12.378/2010; Resolução CAU/BR nº 91/2014.\n\nÓrgão competente: CAU (Conselho de Arquitetura e Urbanismo).` + HELPER_TAIL },
        { id: 'trt', nome: 'TRT — Termo de Responsabilidade Técnica',
          descricao: `Serviço de Emissão de TRT (Termo de Responsabilidade Técnica).\n\nDefinição: documento equivalente à ART para Técnicos Industriais, registrando responsabilidade junto ao CFT.\n\nBase legal/normativa: Lei nº 13.639/2018; Resolução CFT nº 17/2019.\n\nÓrgão competente: CFT (Conselho Federal dos Técnicos Industriais).` + HELPER_TAIL },
        { id: 'laudo-avaliacao', nome: 'Laudo Técnico de Avaliação Imobiliária',
          descricao: `Serviço de Elaboração de Laudo Técnico de Avaliação Imobiliária.\n\nDefinição: documento técnico que estima o valor de mercado do imóvel mediante metodologia normatizada.\n\nBase legal/normativa: NBR 14653 (todas as partes).\n\nFinalidade: garantia de financiamento, partilha, processo judicial, dispute fiscal.` + HELPER_TAIL },
        { id: 'parecer-tecnico', nome: 'Parecer Técnico',
          descricao: `Serviço de Elaboração de Parecer Técnico.\n\nDefinição: manifestação técnica fundamentada de profissional habilitado sobre matéria específica.\n\nBase legal/normativa: Normas do CONFEA/CREA; NBRs aplicáveis ao tema.\n\nFinalidade: subsídio a processo judicial, administrativo ou contratual.` + HELPER_TAIL },
        { id: 'vistoria-tecnica', nome: 'Vistoria Técnica',
          descricao: `Serviço de Vistoria Técnica.\n\nDefinição: inspeção em campo de imóvel ou obra, com registro fotográfico e descrição do estado de conservação.\n\nBase legal/normativa: NBR 13752/1996; NBR 16747/2020.\n\nFinalidade: laudo cautelar, conferência de obra, recebimento de imóvel.` + HELPER_TAIL },
        { id: 'relatorio-tecnico', nome: 'Relatório Técnico',
          descricao: `Serviço de Elaboração de Relatório Técnico.\n\nDefinição: documento descritivo e analítico de levantamento, vistoria, ensaio ou estudo técnico.\n\nBase legal/normativa: Normas técnicas aplicáveis ao tema do relatório.\n\nFinalidade: prestação de contas técnica ao contratante ou órgão público.` + HELPER_TAIL },
        { id: 'memorial-avulso', nome: 'Memorial Descritivo (avulso)',
          descricao: `Serviço de Elaboração de Memorial Descritivo Avulso.\n\nDefinição: descrição textual técnica de obra, projeto ou imóvel, fora do contexto de georreferenciamento.\n\nBase legal/normativa: NBR 13133/1994; NTGIR/INCRA; NBR 6492/1994.\n\nFinalidade: anexo a projeto, contrato, processo administrativo.` + HELPER_TAIL },
        { id: 'act', nome: 'Atestado de Capacidade Técnica (ACT)',
          descricao: `Serviço de Emissão de ACT (Atestado de Capacidade Técnica).\n\nDefinição: documento que comprova a execução de serviço técnico anteriormente realizado pelo profissional ou empresa.\n\nBase legal/normativa: Lei nº 8.666/1993; Lei nº 14.133/2021; normas do CONFEA.\n\nFinalidade: habilitação em licitações públicas e concorrências.` + HELPER_TAIL },
      ]}],
    },

    // ─────────────────────────────────────────────────────────────────
    // CATEGORIA 6 — Assessoria Ambiental (sigla: AMB)
    // ─────────────────────────────────────────────────────────────────
    {
      id: 'ambiental', sigla: 'AMB', nome: 'Assessoria Ambiental',
      subgrupos: [
        { nome: 'Licenciamento', servicos: [
          { id: 'amb-lp', nome: 'Licença Prévia (LP)',
            descricao: `Serviço de Obtenção de Licença Prévia (LP).\n\nDefinição: licença que atesta a viabilidade ambiental do empreendimento na fase de planejamento, com requisitos a serem atendidos nas próximas fases.\n\nBase legal/normativa: Resolução CONAMA nº 237/1997; LC nº 140/2011.\n\nÓrgão competente: SEMA/SEMAS estadual ou municipal, conforme competência.` + HELPER_TAIL },
          { id: 'amb-li', nome: 'Licença de Instalação (LI)',
            descricao: `Serviço de Obtenção de Licença de Instalação (LI).\n\nDefinição: autoriza a instalação do empreendimento conforme planos, programas e projetos aprovados.\n\nBase legal/normativa: Resolução CONAMA nº 237/1997.\n\nÓrgão competente: SEMA/SEMAS conforme competência.` + HELPER_TAIL },
          { id: 'amb-lo', nome: 'Licença de Operação (LO)',
            descricao: `Serviço de Obtenção de Licença de Operação (LO).\n\nDefinição: autoriza o início das atividades após verificação do efetivo cumprimento das condicionantes da LP e LI.\n\nBase legal/normativa: Resolução CONAMA nº 237/1997.\n\nÓrgão competente: SEMA/SEMAS conforme competência.` + HELPER_TAIL },
          { id: 'amb-lau', nome: 'Licença Ambiental Única (LAU)',
            descricao: `Serviço de Obtenção de Licença Ambiental Única (LAU).\n\nDefinição: licença que reúne em ato único as fases de LP, LI e LO, para atividades de menor impacto.\n\nBase legal/normativa: Legislação estadual; LC nº 140/2011.\n\nÓrgão competente: órgão ambiental estadual.` + HELPER_TAIL },
          { id: 'amb-las', nome: 'Licença Ambiental Simplificada (LAS)',
            descricao: `Serviço de Obtenção de Licença Ambiental Simplificada (LAS).\n\nDefinição: licença para atividades de baixo impacto e potencial poluidor reduzido.\n\nBase legal/normativa: Legislação estadual e municipal.\n\nÓrgão competente: SEMA estadual ou Secretaria Municipal de Meio Ambiente.` + HELPER_TAIL },
          { id: 'amb-lac', nome: 'Licença por Adesão e Compromisso (LAC)',
            descricao: `Serviço de Obtenção de Licença por Adesão e Compromisso (LAC).\n\nDefinição: licença concedida mediante adesão a critérios e condicionantes pré-fixados pelo órgão ambiental.\n\nBase legal/normativa: Legislação estadual.\n\nÓrgão competente: órgão ambiental estadual.` + HELPER_TAIL },
          { id: 'amb-renovacao', nome: 'Renovação de Licença Ambiental',
            descricao: `Serviço de Renovação de Licença Ambiental.\n\nDefinição: solicitação de manutenção de licença vigente, com 120 dias de antecedência do vencimento.\n\nBase legal/normativa: Resolução CONAMA nº 237/1997 (art. 18).\n\nÓrgão competente: SEMA estadual ou municipal.` + HELPER_TAIL },
          { id: 'amb-aut-especifica', nome: 'Autorização Ambiental para Atividade Específica',
            descricao: `Serviço de Obtenção de Autorização Ambiental Específica.\n\nDefinição: autorização para atividade pontual de baixo potencial impactante (ex.: limpeza de pasto, construção rural simples).\n\nBase legal/normativa: Lei nº 12.651/2012; legislação estadual.\n\nÓrgão competente: SEMA estadual.` + HELPER_TAIL },
        ]},
        { nome: 'Outorga e Recursos Hídricos', servicos: [
          { id: 'amb-outorga', nome: 'Outorga de Uso de Água (superficial/subterrânea)',
            descricao: `Serviço de Obtenção de Outorga de Uso de Água.\n\nDefinição: ato administrativo que autoriza o uso de recursos hídricos por pessoa física ou jurídica.\n\nBase legal/normativa: Lei nº 9.433/1997; Resolução CNRH nº 16/2001.\n\nÓrgão competente: ANA (rios federais) ou órgão estadual (rios estaduais).` + HELPER_TAIL },
          { id: 'amb-cadastro-insignificante', nome: 'Cadastro de Uso Insignificante',
            descricao: `Serviço de Cadastro de Uso Insignificante de Água.\n\nDefinição: cadastro simplificado para captações de pequena vazão dispensadas de outorga.\n\nBase legal/normativa: Lei nº 9.433/1997; regulamentação ANA / órgão estadual.\n\nÓrgão competente: ANA ou órgão estadual.` + HELPER_TAIL },
          { id: 'amb-renov-outorga', nome: 'Renovação de Outorga',
            descricao: `Serviço de Renovação de Outorga de Uso de Água.\n\nDefinição: prorrogação do direito de uso de recursos hídricos antes do vencimento da outorga atual.\n\nBase legal/normativa: Lei nº 9.433/1997.\n\nÓrgão competente: ANA ou órgão estadual.` + HELPER_TAIL },
          { id: 'amb-poco-tubular', nome: 'Projeto de Poço Tubular / Cacimba',
            descricao: `Serviço de Projeto de Poço Tubular ou Cacimba.\n\nDefinição: projeto técnico de captação de água subterrânea com dimensionamento, locação e memorial.\n\nBase legal/normativa: NBR 12244/2006; Lei nº 9.433/1997.\n\nÓrgão competente: SEMA estadual (outorga) e ANM (mineração de água, quando aplicável).` + HELPER_TAIL },
        ]},
        { nome: 'Cadastros e Regularizações', servicos: [
          { id: 'amb-car', nome: 'CAR — Cadastro Ambiental Rural',
            descricao: `Serviço de Inscrição/Atualização no CAR.\n\nDefinição: registro eletrônico obrigatório de imóvel rural com identificação de APP, RL e remanescentes de vegetação nativa.\n\nBase legal/normativa: Lei nº 12.651/2012 (arts. 29/30); Decreto nº 7.830/2012; IN MMA nº 2/2014.\n\nÓrgão competente: SFB/MMA (sistema SICAR).` + HELPER_TAIL },
          { id: 'amb-pra', nome: 'PRA — Programa de Regularização Ambiental',
            descricao: `Serviço de Adesão ao PRA.\n\nDefinição: adesão e elaboração de Plano de Recuperação Ambiental para imóveis com passivo ambiental anterior a 22/07/2008.\n\nBase legal/normativa: Lei nº 12.651/2012 (arts. 59/60).\n\nÓrgão competente: SEMA estadual.` + HELPER_TAIL },
          { id: 'amb-ctf', nome: 'CTF/IBAMA',
            descricao: `Serviço de Inscrição/Atualização no CTF/IBAMA.\n\nDefinição: cadastro técnico federal de atividades potencialmente poluidoras.\n\nBase legal/normativa: Lei nº 6.938/1981 (art. 17); IN IBAMA nº 6/2013.\n\nÓrgão competente: IBAMA.` + HELPER_TAIL },
          { id: 'amb-sema', nome: 'Inscrição/Atualização SEMA / SEMAS / IBAMA',
            descricao: `Serviço de Inscrição em Cadastro Ambiental.\n\nDefinição: inscrição inicial ou atualização em sistema de cadastro de atividades poluidoras estadual e federal.\n\nBase legal/normativa: Legislação ambiental estadual e federal.\n\nÓrgão competente: SEMA/SEMAS estadual e IBAMA.` + HELPER_TAIL },
        ]},
        { nome: 'Autorizações Específicas', servicos: [
          { id: 'amb-asv', nome: 'ASV — Autorização de Supressão de Vegetação',
            descricao: `Serviço de Obtenção de ASV.\n\nDefinição: autorização para remoção de vegetação nativa para uso alternativo do solo.\n\nBase legal/normativa: Lei nº 12.651/2012 (arts. 26+); Lei nº 11.428/2006 (Mata Atlântica).\n\nÓrgão competente: SEMA estadual.` + HELPER_TAIL },
          { id: 'amb-queima', nome: 'Autorização para Queima Controlada',
            descricao: `Serviço de Obtenção de Autorização para Queima Controlada.\n\nDefinição: autorização para uso do fogo em práticas agrícolas e florestais.\n\nBase legal/normativa: Decreto nº 2.661/1998.\n\nÓrgão competente: SEMA estadual ou IBAMA.` + HELPER_TAIL },
          { id: 'amb-app', nome: 'Autorização de Intervenção em APP',
            descricao: `Serviço de Obtenção de Autorização de Intervenção em APP.\n\nDefinição: autorização excepcional de intervenção em Área de Preservação Permanente em casos de utilidade pública, interesse social ou baixo impacto.\n\nBase legal/normativa: Lei nº 12.651/2012 (arts. 8º/9º); Resolução CONAMA nº 369/2006.\n\nÓrgão competente: SEMA estadual.` + HELPER_TAIL },
          { id: 'amb-manejo', nome: 'Autorização para Manejo Florestal Sustentável',
            descricao: `Serviço de Obtenção de Autorização de Manejo Florestal.\n\nDefinição: autorização para exploração sustentável de florestas nativas com base em Plano de Manejo.\n\nBase legal/normativa: Lei nº 12.651/2012 (arts. 31/32); IN MMA aplicável.\n\nÓrgão competente: SEMA estadual ou IBAMA.` + HELPER_TAIL },
          { id: 'amb-dof', nome: 'DOF — Documento de Origem Florestal',
            descricao: `Serviço de Emissão de DOF.\n\nDefinição: documento que acompanha o transporte e armazenamento de produto/subproduto florestal nativo.\n\nBase legal/normativa: Lei nº 12.651/2012 (art. 35); IN IBAMA nº 21/2014.\n\nÓrgão competente: IBAMA.` + HELPER_TAIL },
        ]},
        { nome: 'Estudos e Projetos Ambientais', servicos: [
          { id: 'amb-ras', nome: 'RAS — Relatório Ambiental Simplificado',
            descricao: `Serviço de Elaboração de RAS.\n\nDefinição: estudo simplificado de impactos ambientais para empreendimentos de pequeno porte.\n\nBase legal/normativa: Resolução CONAMA nº 279/2001; legislação estadual.\n\nFinalidade: subsídio a licenciamento simplificado.` + HELPER_TAIL },
          { id: 'amb-pca', nome: 'PCA — Plano de Controle Ambiental',
            descricao: `Serviço de Elaboração de PCA.\n\nDefinição: plano de controle dos impactos ambientais de atividades minerárias e similares.\n\nBase legal/normativa: Resoluções CONAMA nº 9/1990 e nº 10/1990; legislação estadual.\n\nFinalidade: subsídio à LO de mineração.` + HELPER_TAIL },
          { id: 'amb-prad', nome: 'PRAD — Plano de Recuperação de Áreas Degradadas',
            descricao: `Serviço de Elaboração de PRAD.\n\nDefinição: plano técnico para recuperação ambiental de área degradada por atividade humana.\n\nBase legal/normativa: Lei nº 12.651/2012; Decreto nº 97.632/1989; IN IBAMA nº 4/2011.\n\nFinalidade: cumprimento de TAC, condicionante de licença ou termo de compromisso.` + HELPER_TAIL },
          { id: 'amb-eia-rima', nome: 'EIA/RIMA',
            descricao: `Serviço de Elaboração de EIA/RIMA.\n\nDefinição: Estudo de Impacto Ambiental e Relatório de Impacto Ambiental para empreendimentos de significativo impacto.\n\nBase legal/normativa: Resolução CONAMA nº 1/1986; Resolução CONAMA nº 237/1997.\n\nFinalidade: licenciamento ambiental de atividades de grande porte.` + HELPER_TAIL },
          { id: 'amb-pgrs', nome: 'PGRS — Plano de Gestão de Resíduos Sólidos',
            descricao: `Serviço de Elaboração de PGRS.\n\nDefinição: plano de gestão da geração, segregação, transporte e destinação dos resíduos sólidos.\n\nBase legal/normativa: Lei nº 12.305/2010; Decreto nº 10.936/2022.\n\nFinalidade: cumprimento de obrigação legal de geradores de resíduos.` + HELPER_TAIL },
          { id: 'amb-inv-florestal', nome: 'Inventário Florestal',
            descricao: `Serviço de Elaboração de Inventário Florestal.\n\nDefinição: levantamento quali-quantitativo das espécies vegetais existentes em determinada área.\n\nBase legal/normativa: Lei nº 12.651/2012; normas IBAMA/órgãos estaduais.\n\nFinalidade: subsídio a ASV, manejo florestal, PRAD.` + HELPER_TAIL },
        ]},
        { nome: 'Acompanhamento e Conformidade', servicos: [
          { id: 'amb-condicionantes', nome: 'Acompanhamento de Condicionantes',
            descricao: `Serviço de Acompanhamento de Condicionantes Ambientais.\n\nDefinição: gestão e relatório de cumprimento das condicionantes impostas em licença ambiental.\n\nBase legal/normativa: Resolução CONAMA nº 237/1997.\n\nFinalidade: manutenção da regularidade ambiental do empreendimento.` + HELPER_TAIL },
          { id: 'amb-relatorio-monit', nome: 'Relatório de Monitoramento Ambiental',
            descricao: `Serviço de Elaboração de Relatório de Monitoramento Ambiental.\n\nDefinição: relatório periódico exigido em licença ambiental, com dados de qualidade de água, ar, ruído e biota.\n\nBase legal/normativa: Termos da licença; Resolução CONAMA nº 237/1997.\n\nFinalidade: comprovar conformidade ambiental do empreendimento.` + HELPER_TAIL },
          { id: 'amb-auto-infracao', nome: 'Assessoria em Auto de Infração Ambiental',
            descricao: `Serviço de Assessoria em Auto de Infração Ambiental.\n\nDefinição: análise técnica e elaboração de defesa administrativa em auto de infração ambiental.\n\nBase legal/normativa: Lei nº 9.605/1998; Decreto nº 6.514/2008.\n\nFinalidade: contestação ou redução de penalidade.` + HELPER_TAIL },
          { id: 'amb-defesa-admin', nome: 'Assessoria em Defesa Administrativa Ambiental',
            descricao: `Serviço de Assessoria em Defesa Administrativa.\n\nDefinição: elaboração de defesa, recurso e impugnação em processo administrativo ambiental.\n\nBase legal/normativa: Decreto nº 6.514/2008; legislação processual estadual.\n\nFinalidade: garantia do contraditório e ampla defesa em processo ambiental.` + HELPER_TAIL },
          { id: 'amb-passivo', nome: 'Regularização de Passivo Ambiental',
            descricao: `Serviço de Regularização de Passivo Ambiental.\n\nDefinição: levantamento e plano de recuperação para passivos ambientais identificados no imóvel.\n\nBase legal/normativa: Lei nº 12.651/2012; Lei nº 9.605/1998; PRA.\n\nFinalidade: regularização ambiental e segurança jurídica do imóvel.` + HELPER_TAIL },
        ]},
      ],
    },

    // ─────────────────────────────────────────────────────────────────
    // CATEGORIA 7 — Assessoria em Contratos (sigla: CONT)
    // ─────────────────────────────────────────────────────────────────
    {
      id: 'contratos', sigla: 'CONT', nome: 'Assessoria em Contratos',
      subgrupos: [
        { nome: 'Contratos Imobiliários', servicos: [
          { id: 'cont-cv', nome: 'Compra e Venda (urbano e rural)',
            descricao: `Serviço de Elaboração de Contrato de Compra e Venda.\n\nDefinição: instrumento que formaliza a transmissão onerosa de propriedade.\n\nBase legal/normativa: Código Civil (arts. 481/532); Lei nº 6.015/1973.\n\nFinalidade: lavratura de escritura e registro da transferência.` + HELPER_TAIL },
          { id: 'cont-promessa-cv', nome: 'Promessa de Compra e Venda',
            descricao: `Serviço de Elaboração de Promessa de Compra e Venda.\n\nDefinição: contrato preliminar com obrigação de fazer escritura definitiva.\n\nBase legal/normativa: Código Civil (arts. 462/466); DL nº 58/1937; Lei nº 6.766/1979.\n\nFinalidade: parcelar pagamento ou aguardar liberação de financiamento mantendo o vínculo contratual.` + HELPER_TAIL },
          { id: 'cont-permuta', nome: 'Permuta',
            descricao: `Serviço de Elaboração de Contrato de Permuta.\n\nDefinição: troca de bens entre as partes, podendo ou não haver torna em dinheiro.\n\nBase legal/normativa: Código Civil (art. 533).\n\nFinalidade: viabilizar negócios sem desembolso integral em moeda.` + HELPER_TAIL },
          { id: 'cont-cessao-poss', nome: 'Cessão de Direitos Possessórios',
            descricao: `Serviço de Elaboração de Cessão de Direitos Possessórios.\n\nDefinição: transferência de direitos possessórios sobre imóvel sem registro em matrícula.\n\nBase legal/normativa: Código Civil; doutrina e jurisprudência.\n\nFinalidade: formalizar transferência de posse antes da titulação.` + HELPER_TAIL },
          { id: 'cont-cessao-her', nome: 'Cessão de Direitos Hereditários',
            descricao: `Serviço de Elaboração de Cessão de Direitos Hereditários.\n\nDefinição: transferência onerosa ou gratuita de quinhão hereditário.\n\nBase legal/normativa: Código Civil (arts. 1.793/1.795).\n\nFinalidade: regularizar partilha entre herdeiros.` + HELPER_TAIL },
          { id: 'cont-doacao', nome: 'Doação (com ou sem reserva de usufruto)',
            descricao: `Serviço de Elaboração de Contrato de Doação.\n\nDefinição: liberalidade de transferir bens, podendo o doador reservar para si o usufruto.\n\nBase legal/normativa: Código Civil (arts. 538/564).\n\nFinalidade: planejamento sucessório, transmissão patrimonial em vida.` + HELPER_TAIL },
          { id: 'cont-dacao', nome: 'Dação em Pagamento',
            descricao: `Serviço de Elaboração de Dação em Pagamento.\n\nDefinição: extinção de obrigação mediante entrega de bem diverso do originalmente devido.\n\nBase legal/normativa: Código Civil (arts. 356/359).\n\nFinalidade: quitação de dívida via transferência de imóvel ou outro bem.` + HELPER_TAIL },
        ]},
        { nome: 'Contratos Rurais', servicos: [
          { id: 'cont-arrend', nome: 'Arrendamento Rural',
            descricao: `Serviço de Elaboração de Contrato de Arrendamento Rural.\n\nDefinição: cessão de uso de imóvel rural mediante remuneração fixa.\n\nBase legal/normativa: Lei nº 4.504/1964 (Estatuto da Terra); Decreto nº 59.566/1966.\n\nFinalidade: exploração econômica de imóvel rural por terceiro.` + HELPER_TAIL },
          { id: 'cont-parceria', nome: 'Parceria Rural (agrícola, pecuária, agroindustrial)',
            descricao: `Serviço de Elaboração de Contrato de Parceria Rural.\n\nDefinição: cessão de uso com partilha de riscos e resultados (frutos, produtos, lucros).\n\nBase legal/normativa: Lei nº 4.504/1964; Decreto nº 59.566/1966.\n\nFinalidade: exploração rural conjunta com partilha de produção.` + HELPER_TAIL },
          { id: 'cont-comodato', nome: 'Comodato Rural',
            descricao: `Serviço de Elaboração de Comodato Rural.\n\nDefinição: empréstimo gratuito de bem infungível (imóvel) por prazo determinado.\n\nBase legal/normativa: Código Civil (arts. 579/585).\n\nFinalidade: cessão temporária e gratuita do uso de imóvel rural.` + HELPER_TAIL },
          { id: 'cont-pastagem', nome: 'Contrato de Pastagem',
            descricao: `Serviço de Elaboração de Contrato de Pastagem.\n\nDefinição: cessão de uso de pasto para alimentação de gado de terceiro mediante remuneração.\n\nBase legal/normativa: Código Civil; legislação agrária aplicável.\n\nFinalidade: hospedagem temporária de animais em propriedade rural.` + HELPER_TAIL },
          { id: 'cont-florestal', nome: 'Exploração Florestal / Madeireira',
            descricao: `Serviço de Elaboração de Contrato de Exploração Florestal.\n\nDefinição: cessão de direito de explorar produtos florestais (madeira, frutos, resina).\n\nBase legal/normativa: Código Civil; Lei nº 12.651/2012.\n\nFinalidade: exploração econômica sustentável de florestas plantadas ou nativas (com licença).` + HELPER_TAIL },
          { id: 'cont-servidao-pas', nome: 'Servidão de Passagem',
            descricao: `Serviço de Elaboração de Servidão de Passagem.\n\nDefinição: direito real de passagem sobre imóvel alheio, registrado em matrícula.\n\nBase legal/normativa: Código Civil (arts. 1.378/1.389).\n\nFinalidade: garantir acesso a imóvel encravado ou serviço (água, energia).` + HELPER_TAIL },
          { id: 'cont-servidao-adm', nome: 'Servidão Administrativa (linhão, gasoduto, etc.)',
            descricao: `Serviço de Elaboração/Acompanhamento de Servidão Administrativa.\n\nDefinição: ônus real instituído por ente público ou concessionária sobre imóvel particular.\n\nBase legal/normativa: Decreto-Lei nº 3.365/1941; legislação setorial.\n\nFinalidade: passagem de redes de transmissão, gasodutos, oleodutos.` + HELPER_TAIL },
        ]},
        { nome: 'Contratos de Locação', servicos: [
          { id: 'cont-loc-resid', nome: 'Locação Residencial',
            descricao: `Serviço de Elaboração de Contrato de Locação Residencial.\n\nDefinição: cessão temporária de imóvel para fins de moradia mediante aluguel.\n\nBase legal/normativa: Lei nº 8.245/1991.\n\nFinalidade: regulamentação de locação para moradia.` + HELPER_TAIL },
          { id: 'cont-loc-comer', nome: 'Locação Comercial',
            descricao: `Serviço de Elaboração de Contrato de Locação Comercial.\n\nDefinição: cessão temporária de imóvel para atividade empresarial.\n\nBase legal/normativa: Lei nº 8.245/1991 (locação não residencial).\n\nFinalidade: locação de ponto comercial com regras específicas (renovatória, fundo de comércio).` + HELPER_TAIL },
          { id: 'cont-temporada', nome: 'Locação por Temporada',
            descricao: `Serviço de Elaboração de Locação por Temporada.\n\nDefinição: locação para fins de turismo, recreação ou eventos por até 90 dias.\n\nBase legal/normativa: Lei nº 8.245/1991 (arts. 48/50).\n\nFinalidade: aluguel de curto prazo com regras próprias.` + HELPER_TAIL },
          { id: 'cont-sublocacao', nome: 'Sublocação',
            descricao: `Serviço de Elaboração de Sublocação.\n\nDefinição: locação de imóvel já alugado, mediante autorização do locador original.\n\nBase legal/normativa: Lei nº 8.245/1991 (arts. 14/16).\n\nFinalidade: ceder uso parcial ou total a terceiro mantendo o contrato principal.` + HELPER_TAIL },
          { id: 'cont-rescisao-loc', nome: 'Termo de Rescisão de Locação',
            descricao: `Serviço de Elaboração de Termo de Rescisão de Locação.\n\nDefinição: instrumento que formaliza o término antecipado do contrato de locação.\n\nBase legal/normativa: Lei nº 8.245/1991.\n\nFinalidade: encerramento amigável da relação locatícia.` + HELPER_TAIL },
          { id: 'cont-vistoria-loc', nome: 'Termo de Vistoria de Imóvel',
            descricao: `Serviço de Elaboração de Termo de Vistoria de Imóvel.\n\nDefinição: descrição minuciosa do estado do imóvel na entrada/saída do locatário.\n\nBase legal/normativa: Lei nº 8.245/1991; NBR 13752/1996.\n\nFinalidade: prova do estado de conservação para fins de devolução do depósito caução.` + HELPER_TAIL },
        ]},
        { nome: 'Contratos de Garantia', servicos: [
          { id: 'cont-hipoteca', nome: 'Hipoteca',
            descricao: `Serviço de Elaboração de Contrato de Hipoteca.\n\nDefinição: garantia real sobre imóvel para assegurar cumprimento de obrigação.\n\nBase legal/normativa: Código Civil (arts. 1.473/1.505); Lei nº 6.015/1973.\n\nFinalidade: garantia em financiamento imobiliário ou empréstimo.` + HELPER_TAIL },
          { id: 'cont-alienacao-fid', nome: 'Alienação Fiduciária',
            descricao: `Serviço de Elaboração de Alienação Fiduciária.\n\nDefinição: garantia em que o devedor transfere a propriedade resolúvel do imóvel ao credor.\n\nBase legal/normativa: Lei nº 9.514/1997.\n\nFinalidade: garantia preferencial em financiamento imobiliário (mais ágil que hipoteca).` + HELPER_TAIL },
          { id: 'cont-penhor-rural', nome: 'Penhor Rural',
            descricao: `Serviço de Elaboração de Penhor Rural.\n\nDefinição: garantia real sobre bens móveis rurais (gado, safra, máquinas).\n\nBase legal/normativa: Código Civil (arts. 1.438/1.446); Lei nº 492/1937.\n\nFinalidade: garantia em crédito rural.` + HELPER_TAIL },
          { id: 'cont-caucao', nome: 'Termo de Caução',
            descricao: `Serviço de Elaboração de Termo de Caução.\n\nDefinição: garantia em dinheiro, bem ou título para assegurar obrigação.\n\nBase legal/normativa: Código Civil (arts. 826/838).\n\nFinalidade: garantia em locação, contrato de prestação de serviço, fiança.` + HELPER_TAIL },
        ]},
        { nome: 'Procurações e Instrumentos Particulares', servicos: [
          { id: 'cont-procuracao-pub', nome: 'Procuração Pública',
            descricao: `Serviço de Elaboração de Procuração Pública.\n\nDefinição: outorga de poderes lavrada em Tabelionato.\n\nBase legal/normativa: Código Civil (arts. 653/692); Lei nº 8.935/1994.\n\nFinalidade: representação para atos exigentes de forma pública (escritura, abertura de empresa).` + HELPER_TAIL },
          { id: 'cont-procuracao-part', nome: 'Procuração Particular com poderes específicos',
            descricao: `Serviço de Elaboração de Procuração Particular.\n\nDefinição: outorga de poderes em instrumento particular para atos não exigentes de forma pública.\n\nBase legal/normativa: Código Civil (arts. 653/692).\n\nFinalidade: representação em cartórios, órgãos públicos, banco.` + HELPER_TAIL },
          { id: 'cont-substabelecimento', nome: 'Substabelecimento de Procuração',
            descricao: `Serviço de Elaboração de Substabelecimento.\n\nDefinição: transferência de poderes recebidos via procuração a terceiro.\n\nBase legal/normativa: Código Civil (art. 655).\n\nFinalidade: delegação ou compartilhamento de mandato.` + HELPER_TAIL },
          { id: 'cont-revogacao-proc', nome: 'Revogação de Procuração',
            descricao: `Serviço de Elaboração de Revogação de Procuração.\n\nDefinição: ato unilateral que extingue a procuração outorgada.\n\nBase legal/normativa: Código Civil (arts. 682/686).\n\nFinalidade: cessação dos poderes anteriormente conferidos.` + HELPER_TAIL },
          { id: 'cont-anuencia', nome: 'Declaração de Anuência',
            descricao: `Serviço de Elaboração de Declaração de Anuência.\n\nDefinição: manifestação formal de concordância com ato jurídico de terceiro.\n\nBase legal/normativa: Código Civil; exigência cartorial.\n\nFinalidade: subsídio a usucapião, retificação, REURB, partilha.` + HELPER_TAIL },
          { id: 'cont-confrontantes', nome: 'Declaração de Confrontantes',
            descricao: `Serviço de Elaboração de Declaração de Confrontantes.\n\nDefinição: manifestação de confrontante reconhecendo a divisa do imóvel vizinho.\n\nBase legal/normativa: NTGIR/INCRA; Lei nº 10.267/2001.\n\nFinalidade: subsídio a georreferenciamento, retificação, usucapião.` + HELPER_TAIL },
          { id: 'cont-posse', nome: 'Declaração de Posse Mansa e Pacífica',
            descricao: `Serviço de Elaboração de Declaração de Posse.\n\nDefinição: manifestação que atesta posse contínua, mansa, pacífica e sem oposição sobre imóvel.\n\nBase legal/normativa: Código Civil; Lei nº 13.465/2017.\n\nFinalidade: subsídio a usucapião, REURB ou regularização fundiária.` + HELPER_TAIL },
        ]},
        { nome: 'Contratos de Prestação de Serviços Técnicos', servicos: [
          { id: 'cont-eng', nome: 'Prestação de Serviços de Engenharia / Agrimensura',
            descricao: `Serviço de Elaboração de Contrato de Prestação de Serviços Técnicos.\n\nDefinição: contrato de execução de obra ou serviço técnico de engenharia/agrimensura.\n\nBase legal/normativa: Código Civil (arts. 593/609); Lei nº 5.194/1966.\n\nFinalidade: formalização da relação contratual técnica.` + HELPER_TAIL },
          { id: 'cont-georref', nome: 'Prestação de Serviços de Georreferenciamento',
            descricao: `Serviço de Elaboração de Contrato de Georreferenciamento.\n\nDefinição: contrato específico para execução de georreferenciamento certificado SIGEF.\n\nBase legal/normativa: Código Civil; Lei nº 10.267/2001; NTGIR/INCRA.\n\nFinalidade: regulamentação dos honorários, prazos e responsabilidades.` + HELPER_TAIL },
          { id: 'cont-asses-imob', nome: 'Assessoria Técnica Imobiliária',
            descricao: `Serviço de Elaboração de Contrato de Assessoria Imobiliária.\n\nDefinição: contrato de consultoria técnica em matéria imobiliária.\n\nBase legal/normativa: Código Civil; normas do CRECI quando aplicável.\n\nFinalidade: regulamentação de prestação de serviços de assessoria.` + HELPER_TAIL },
          { id: 'cont-asses-amb', nome: 'Assessoria Ambiental',
            descricao: `Serviço de Elaboração de Contrato de Assessoria Ambiental.\n\nDefinição: contrato de consultoria técnica em licenciamento e regularização ambiental.\n\nBase legal/normativa: Código Civil; legislação ambiental aplicável.\n\nFinalidade: regulamentação dos honorários e escopo do serviço ambiental.` + HELPER_TAIL },
          { id: 'cont-honorarios', nome: 'Termo de Honorários',
            descricao: `Serviço de Elaboração de Termo de Honorários.\n\nDefinição: instrumento que detalha valor, prazo e forma de pagamento de serviço técnico.\n\nBase legal/normativa: Código Civil; tabela de honorários do CREA/CAU/CFT.\n\nFinalidade: documentar honorários ajustados.` + HELPER_TAIL },
        ]},
        { nome: 'Distratos e Aditivos', servicos: [
          { id: 'cont-distrato', nome: 'Distrato Contratual',
            descricao: `Serviço de Elaboração de Distrato Contratual.\n\nDefinição: instrumento que formaliza o desfazimento amigável de contrato vigente.\n\nBase legal/normativa: Código Civil (arts. 472/473).\n\nFinalidade: encerramento contratual sem litígio.` + HELPER_TAIL },
          { id: 'cont-aditivo', nome: 'Termo Aditivo',
            descricao: `Serviço de Elaboração de Termo Aditivo.\n\nDefinição: instrumento que altera, acrescenta ou suprime cláusulas de contrato vigente.\n\nBase legal/normativa: Código Civil; cláusulas contratuais.\n\nFinalidade: ajuste contratual sem necessidade de novo contrato.` + HELPER_TAIL },
          { id: 'cont-quitacao', nome: 'Termo de Quitação',
            descricao: `Serviço de Elaboração de Termo de Quitação.\n\nDefinição: declaração formal de pagamento e extinção de obrigação.\n\nBase legal/normativa: Código Civil (arts. 319/326).\n\nFinalidade: prova de quitação para fins jurídicos e cartoriais.` + HELPER_TAIL },
          { id: 'cont-acordo-extra', nome: 'Acordo Extrajudicial',
            descricao: `Serviço de Elaboração de Acordo Extrajudicial.\n\nDefinição: instrumento de composição de litígio sem processo judicial.\n\nBase legal/normativa: Código Civil; CPC art. 784, IV.\n\nFinalidade: solução negociada com força de título executivo extrajudicial.` + HELPER_TAIL },
        ]},
      ],
    },

    // ─────────────────────────────────────────────────────────────────
    // CATEGORIA 8 — Engenharia / Projetos (sigla: ENG)
    // ─────────────────────────────────────────────────────────────────
    {
      id: 'engenharia', sigla: 'ENG', nome: 'Engenharia / Projetos',
      subgrupos: [
        { nome: 'Projetos Arquitetônicos e Urbanísticos', servicos: [
          { id: 'eng-arq', nome: 'Projeto Arquitetônico',
            descricao: `Serviço de Elaboração de Projeto Arquitetônico.\n\nDefinição: peças gráficas e memoriais para construção, ampliação ou reforma de edificação.\n\nBase legal/normativa: NBR 6492/1994; legislação municipal de obras; Lei nº 12.378/2010.\n\nFinalidade: aprovação de alvará de construção.` + HELPER_TAIL },
          { id: 'eng-reforma', nome: 'Projeto de Reforma e Ampliação',
            descricao: `Serviço de Projeto de Reforma e Ampliação.\n\nDefinição: projeto de modificação de edificação existente sem comprometer a estrutura ou com ampliação de área.\n\nBase legal/normativa: NBR 16280/2015; legislação municipal.\n\nFinalidade: regulamentar reforma e obtenção de alvará específico.` + HELPER_TAIL },
          { id: 'eng-regul', nome: 'Projeto de Regularização (obra existente)',
            descricao: `Serviço de Projeto de Regularização de Obra.\n\nDefinição: levantamento e projeto de obra já executada sem licença, com vistas à regularização municipal.\n\nBase legal/normativa: Legislação municipal; Lei nº 13.465/2017 quando aplicável.\n\nFinalidade: obter habite-se de obra construída irregularmente.` + HELPER_TAIL },
          { id: 'eng-loteamento', nome: 'Projeto de Loteamento',
            descricao: `Serviço de Projeto de Loteamento.\n\nDefinição: subdivisão de gleba com abertura de vias, áreas verdes, áreas institucionais e infraestrutura.\n\nBase legal/normativa: Lei nº 6.766/1979; legislação municipal.\n\nFinalidade: aprovação e registro do loteamento.` + HELPER_TAIL },
          { id: 'eng-condominio', nome: 'Projeto de Condomínio (horizontal e vertical)',
            descricao: `Serviço de Projeto de Condomínio.\n\nDefinição: projeto de empreendimento em regime condominial, horizontal ou vertical.\n\nBase legal/normativa: Lei nº 4.591/1964; Código Civil (arts. 1.331/1.358-A).\n\nFinalidade: aprovação municipal e registro da incorporação.` + HELPER_TAIL },
          { id: 'eng-urbanizacao', nome: 'Projeto de Urbanização',
            descricao: `Serviço de Projeto de Urbanização.\n\nDefinição: projeto de implantação ou requalificação de áreas urbanas.\n\nBase legal/normativa: Lei nº 6.766/1979; Lei nº 10.257/2001 (Estatuto da Cidade).\n\nFinalidade: planejamento e ordenamento urbano.` + HELPER_TAIL },
          { id: 'eng-paisagistico', nome: 'Projeto Paisagístico',
            descricao: `Serviço de Projeto Paisagístico.\n\nDefinição: projeto de áreas verdes, jardins e arborização.\n\nBase legal/normativa: NBR 6492/1994; normas municipais.\n\nFinalidade: composição estética e funcional das áreas externas.` + HELPER_TAIL },
          { id: 'eng-viabilidade', nome: 'Estudo de Viabilidade Técnica',
            descricao: `Serviço de Estudo de Viabilidade Técnica.\n\nDefinição: análise técnica preliminar da viabilidade de implantação de empreendimento.\n\nBase legal/normativa: NBR 12721/2006 (quando aplicável a incorporação).\n\nFinalidade: subsídio à decisão de investimento.` + HELPER_TAIL },
        ]},
        { nome: 'Projetos Estruturais', servicos: [
          { id: 'eng-concreto', nome: 'Concreto Armado',
            descricao: `Serviço de Projeto Estrutural em Concreto Armado.\n\nBase legal/normativa: NBR 6118/2014.\n\nFinalidade: dimensionamento e detalhamento de estrutura em concreto.` + HELPER_TAIL },
          { id: 'eng-metalica', nome: 'Estrutura Metálica',
            descricao: `Serviço de Projeto Estrutural Metálico.\n\nBase legal/normativa: NBR 8800/2008.\n\nFinalidade: dimensionamento e detalhamento de estrutura metálica.` + HELPER_TAIL },
          { id: 'eng-madeira', nome: 'Estrutura em Madeira',
            descricao: `Serviço de Projeto Estrutural em Madeira.\n\nBase legal/normativa: NBR 7190/2022.\n\nFinalidade: dimensionamento e detalhamento de estrutura em madeira.` + HELPER_TAIL },
          { id: 'eng-fundacoes', nome: 'Fundações',
            descricao: `Serviço de Projeto de Fundações.\n\nBase legal/normativa: NBR 6122/2019.\n\nFinalidade: dimensionamento de fundações superficiais ou profundas conforme sondagem.` + HELPER_TAIL },
          { id: 'eng-contencao', nome: 'Contenção (arrimo, talude)',
            descricao: `Serviço de Projeto de Contenção.\n\nDefinição: projeto de muros de arrimo, taludes e estabilização de encostas.\n\nBase legal/normativa: NBR 11682/2009; NBR 6122/2019.\n\nFinalidade: estabilização geotécnica.` + HELPER_TAIL },
          { id: 'eng-calculo', nome: 'Cálculo Estrutural / Memória de Cálculo',
            descricao: `Serviço de Cálculo Estrutural e Memória de Cálculo.\n\nDefinição: dimensionamento, verificação e elaboração de memória técnica.\n\nBase legal/normativa: NBRs aplicáveis ao material e ao tipo de estrutura.\n\nFinalidade: comprovar a segurança estrutural junto a aprovações.` + HELPER_TAIL },
        ]},
        { nome: 'Projetos Complementares (Instalações)', servicos: [
          { id: 'eng-hidro', nome: 'Hidrossanitário',
            descricao: `Serviço de Projeto Hidrossanitário.\n\nBase legal/normativa: NBR 5626/2020 (água fria); NBR 8160/1999 (esgoto); NBR 10844/1989 (águas pluviais).\n\nFinalidade: dimensionamento de instalações hidráulicas e sanitárias.` + HELPER_TAIL },
          { id: 'eng-reservatorio', nome: 'Reservatório / Caixa d\'água',
            descricao: `Serviço de Projeto de Reservatório.\n\nBase legal/normativa: NBR 5626/2020; NBR 6118/2014.\n\nFinalidade: dimensionamento de reservatório elevado, enterrado ou apoiado.` + HELPER_TAIL },
          { id: 'eng-eletrico-bt', nome: 'Elétrico de Baixa Tensão',
            descricao: `Serviço de Projeto Elétrico de Baixa Tensão.\n\nBase legal/normativa: NBR 5410/2004.\n\nFinalidade: dimensionamento de instalações elétricas residenciais e comerciais.` + HELPER_TAIL },
          { id: 'eng-eletrico-mt', nome: 'Elétrico de Média Tensão',
            descricao: `Serviço de Projeto Elétrico de Média Tensão.\n\nBase legal/normativa: NBR 14039/2021; normas da concessionária.\n\nFinalidade: subestação, alimentadores e proteção em MT.` + HELPER_TAIL },
          { id: 'eng-spda', nome: 'SPDA (Para-raios)',
            descricao: `Serviço de Projeto de SPDA.\n\nBase legal/normativa: NBR 5419/2015.\n\nFinalidade: proteção contra descargas atmosféricas.` + HELPER_TAIL },
          { id: 'eng-cabeamento', nome: 'Cabeamento Estruturado / Lógica',
            descricao: `Serviço de Projeto de Cabeamento Estruturado.\n\nBase legal/normativa: NBR 14565/2019.\n\nFinalidade: rede de dados e telefonia em edificações.` + HELPER_TAIL },
          { id: 'eng-avac', nome: 'Climatização (AVAC)',
            descricao: `Serviço de Projeto de Climatização (AVAC).\n\nBase legal/normativa: NBR 16401/2008; NBR 7256/2005.\n\nFinalidade: dimensionamento de sistema de ar condicionado e ventilação.` + HELPER_TAIL },
          { id: 'eng-gas', nome: 'Gás (GLP / GN)',
            descricao: `Serviço de Projeto de Gás Combustível.\n\nBase legal/normativa: NBR 13523/2019; NBR 15526/2016.\n\nFinalidade: instalações de GLP/GN em edificações.` + HELPER_TAIL },
          { id: 'eng-ppci', nome: 'Prevenção e Combate a Incêndio (PPCI)',
            descricao: `Serviço de Projeto de PPCI.\n\nBase legal/normativa: NBR 9077/2001 e demais; legislação do Corpo de Bombeiros estadual.\n\nFinalidade: aprovação no Corpo de Bombeiros e obtenção de AVCB.` + HELPER_TAIL },
        ]},
        { nome: 'Projetos Rurais e Agropecuários', servicos: [
          { id: 'eng-curral', nome: 'Curral / Instalações Pecuárias',
            descricao: `Serviço de Projeto de Curral e Instalações Pecuárias.\n\nBase legal/normativa: Normas zootécnicas; legislação sanitária do MAPA.\n\nFinalidade: instalações para manejo bovino, suíno, ovino.` + HELPER_TAIL },
          { id: 'eng-galpao', nome: 'Galpão Rural / Armazém',
            descricao: `Serviço de Projeto de Galpão Rural.\n\nBase legal/normativa: NBR 6118/2014; NBR 8800/2008.\n\nFinalidade: armazenamento de grãos, máquinas, insumos.` + HELPER_TAIL },
          { id: 'eng-aviario', nome: 'Aviário / Suinocultura',
            descricao: `Serviço de Projeto de Aviário ou Suinocultura.\n\nBase legal/normativa: Normas do MAPA; legislação ambiental (licença).\n\nFinalidade: instalações de avicultura/suinocultura licenciadas.` + HELPER_TAIL },
          { id: 'eng-acude', nome: 'Açude / Barragem de Pequeno Porte',
            descricao: `Serviço de Projeto de Açude/Barragem.\n\nBase legal/normativa: Lei nº 12.334/2010 (Política de Segurança de Barragens); NBR 13028/2017.\n\nFinalidade: armazenamento de água para consumo, irrigação ou pecuária.` + HELPER_TAIL },
          { id: 'eng-irrigacao', nome: 'Irrigação',
            descricao: `Serviço de Projeto de Irrigação.\n\nBase legal/normativa: Lei nº 9.433/1997 (outorga); NBR 12266/1992.\n\nFinalidade: dimensionamento de sistema de irrigação por gotejamento, aspersão ou pivô.` + HELPER_TAIL },
          { id: 'eng-drenagem-rural', nome: 'Drenagem Rural',
            descricao: `Serviço de Projeto de Drenagem Rural.\n\nBase legal/normativa: NBR 13133/1994; manuais EMBRAPA.\n\nFinalidade: drenagem de áreas alagadas e proteção de estradas rurais.` + HELPER_TAIL },
          { id: 'eng-estrada-vic', nome: 'Estrada Vicinal / Acesso Rural',
            descricao: `Serviço de Projeto de Estrada Vicinal.\n\nBase legal/normativa: DNIT; legislação municipal.\n\nFinalidade: acesso veicular a propriedades rurais.` + HELPER_TAIL },
          { id: 'eng-abast-rural', nome: 'Sistema de Abastecimento de Água Rural',
            descricao: `Serviço de Projeto de Abastecimento Rural.\n\nBase legal/normativa: NBR 12211/1992; NBR 12244/2006.\n\nFinalidade: captação, tratamento e distribuição de água em meio rural.` + HELPER_TAIL },
          { id: 'eng-credito-rural', nome: 'Projeto Técnico para Crédito Rural (PRONAF, FNO etc.)',
            descricao: `Serviço de Elaboração de Projeto Técnico de Crédito Rural.\n\nBase legal/normativa: Manual de Crédito Rural (BACEN); normas do agente financeiro.\n\nFinalidade: subsídio à liberação de crédito (PRONAF, FNO, BNDES).` + HELPER_TAIL },
        ]},
        { nome: 'Projetos de Infraestrutura', servicos: [
          { id: 'eng-terraplenagem', nome: 'Terraplenagem',
            descricao: `Serviço de Projeto de Terraplenagem.\n\nBase legal/normativa: NBR 13133/1994; DNIT.\n\nFinalidade: regularização de terreno para obra ou loteamento.` + HELPER_TAIL },
          { id: 'eng-vias', nome: 'Geométrico de Vias',
            descricao: `Serviço de Projeto Geométrico de Vias.\n\nBase legal/normativa: DNIT; legislação municipal.\n\nFinalidade: traçado e dimensionamento de vias urbanas/rurais.` + HELPER_TAIL },
          { id: 'eng-pavimentacao', nome: 'Pavimentação',
            descricao: `Serviço de Projeto de Pavimentação.\n\nBase legal/normativa: NBR 12948/1993; DNIT.\n\nFinalidade: dimensionamento de pavimento asfáltico, intertravado ou poliédrico.` + HELPER_TAIL },
          { id: 'eng-drenagem-urb', nome: 'Drenagem Urbana',
            descricao: `Serviço de Projeto de Drenagem Urbana.\n\nBase legal/normativa: NBR 10844/1989; manuais técnicos.\n\nFinalidade: galerias pluviais, sarjetas, bocas de lobo.` + HELPER_TAIL },
          { id: 'eng-sinalizacao', nome: 'Sinalização Viária',
            descricao: `Serviço de Projeto de Sinalização Viária.\n\nBase legal/normativa: CTB (Lei nº 9.503/1997); manuais CONTRAN.\n\nFinalidade: sinalização horizontal, vertical e semafórica.` + HELPER_TAIL },
        ]},
        { nome: 'Orçamento e Planejamento de Obra', servicos: [
          { id: 'eng-orcamento', nome: 'Orçamento Detalhado / Planilha Orçamentária',
            descricao: `Serviço de Elaboração de Orçamento Detalhado.\n\nBase legal/normativa: NBR 12721/2006; SINAPI/SICRO.\n\nFinalidade: estimativa de custo de obra com composições e BDI.` + HELPER_TAIL },
          { id: 'eng-bdi', nome: 'Composição de Custos (BDI)',
            descricao: `Serviço de Composição de BDI.\n\nDefinição: detalhamento da Bonificação e Despesas Indiretas.\n\nBase legal/normativa: Acórdão TCU nº 2.622/2013.\n\nFinalidade: justificativa técnica de BDI em licitações.` + HELPER_TAIL },
          { id: 'eng-cronograma', nome: 'Cronograma Físico-Financeiro',
            descricao: `Serviço de Elaboração de Cronograma Físico-Financeiro.\n\nDefinição: planejamento de execução e desembolso ao longo da obra.\n\nBase legal/normativa: Boas práticas de gestão de obras.\n\nFinalidade: subsídio a contrato e acompanhamento de obra.` + HELPER_TAIL },
          { id: 'eng-memorial-obra', nome: 'Memorial Descritivo de Obra',
            descricao: `Serviço de Elaboração de Memorial Descritivo de Obra.\n\nBase legal/normativa: NBR 12722/1992.\n\nFinalidade: descrição técnica da obra para licitação ou contratação.` + HELPER_TAIL },
          { id: 'eng-caderno', nome: 'Caderno de Especificações Técnicas',
            descricao: `Serviço de Elaboração de Caderno de Especificações.\n\nBase legal/normativa: NBR 12722/1992.\n\nFinalidade: especificação detalhada de materiais e serviços.` + HELPER_TAIL },
        ]},
        { nome: 'Acompanhamento e Execução', servicos: [
          { id: 'eng-gerenc', nome: 'Gerenciamento de Obra',
            descricao: `Serviço de Gerenciamento de Obra.\n\nBase legal/normativa: Lei nº 5.194/1966; normas CONFEA.\n\nFinalidade: gestão técnica e administrativa de obra.` + HELPER_TAIL },
          { id: 'eng-fiscal', nome: 'Fiscalização de Obra',
            descricao: `Serviço de Fiscalização de Obra.\n\nBase legal/normativa: Lei nº 5.194/1966.\n\nFinalidade: verificação técnica de execução conforme projeto.` + HELPER_TAIL },
          { id: 'eng-direcao', nome: 'Direção Técnica de Obra',
            descricao: `Serviço de Direção Técnica de Obra.\n\nBase legal/normativa: Lei nº 5.194/1966; Resolução CONFEA nº 218/1973.\n\nFinalidade: responsabilidade técnica pela execução.` + HELPER_TAIL },
          { id: 'eng-diario', nome: 'Diário de Obra',
            descricao: `Serviço de Manutenção de Diário de Obra.\n\nBase legal/normativa: Boas práticas; exigência contratual.\n\nFinalidade: registro diário de avanço, eventos e ocorrências.` + HELPER_TAIL },
          { id: 'eng-medicao', nome: 'Medição de Obra',
            descricao: `Serviço de Medição de Obra.\n\nBase legal/normativa: Boas práticas de gestão contratual.\n\nFinalidade: aferição de avanço físico para liberação de pagamento.` + HELPER_TAIL },
          { id: 'eng-conclusao', nome: 'Laudo de Conclusão de Obra (Habite-se)',
            descricao: `Serviço de Elaboração de Laudo de Conclusão.\n\nBase legal/normativa: Legislação municipal; NBRs construtivas.\n\nFinalidade: obtenção do habite-se municipal.` + HELPER_TAIL },
          { id: 'eng-asbuilt', nome: '"As Built"',
            descricao: `Serviço de Elaboração de "As Built".\n\nDefinição: registro técnico do que foi efetivamente executado, com eventuais alterações em relação ao projeto original.\n\nBase legal/normativa: NBR 14645/2005; NBR 13133/1994.\n\nFinalidade: documentação final da obra para entrega e arquivo técnico.` + HELPER_TAIL },
        ]},
      ],
    },

    // ─────────────────────────────────────────────────────────────────
    // CATEGORIA 9 — Laudos e Perícias (sigla: LAUD)
    // ─────────────────────────────────────────────────────────────────
    {
      id: 'laudos', sigla: 'LAUD', nome: 'Laudos e Perícias',
      subgrupos: [
        { nome: 'Avaliação Imobiliária (NBR 14653)', servicos: [
          { id: 'laud-ptam', nome: 'PTAM — Parecer Técnico de Avaliação Mercadológica',
            descricao: `Serviço de Elaboração de PTAM.\n\nDefinição: avaliação simplificada de imóvel para fins comerciais.\n\nBase legal/normativa: NBR 14653-1; prática de mercado.\n\nFinalidade: estimativa de valor de mercado para venda, garantia ou estudo prévio.` + HELPER_TAIL },
          { id: 'laud-vti', nome: 'VTI — Vistoria Técnica de Imóvel',
            descricao: `Serviço de Elaboração de VTI.\n\nDefinição: vistoria descritiva do estado de conservação e características do imóvel.\n\nBase legal/normativa: NBR 13752/1996; NBR 14653-1.\n\nFinalidade: subsídio a avaliação ou laudo cautelar.` + HELPER_TAIL },
          { id: 'laud-aval-urb', nome: 'Avaliação de Imóvel Urbano',
            descricao: `Serviço de Avaliação de Imóvel Urbano.\n\nBase legal/normativa: NBR 14653-2/2011.\n\nFinalidade: determinação do valor de mercado de imóvel urbano com metodologia normatizada.` + HELPER_TAIL },
          { id: 'laud-aval-rur', nome: 'Avaliação de Imóvel Rural',
            descricao: `Serviço de Avaliação de Imóvel Rural.\n\nBase legal/normativa: NBR 14653-3/2019.\n\nFinalidade: determinação do valor de mercado de imóvel rural (terra nua, benfeitorias, plantios).` + HELPER_TAIL },
          { id: 'laud-aval-empr', nome: 'Avaliação de Empreendimentos',
            descricao: `Serviço de Avaliação de Empreendimentos.\n\nBase legal/normativa: NBR 14653-4/2002.\n\nFinalidade: avaliação de empreendimentos imobiliários, agroindustriais, etc.` + HELPER_TAIL },
          { id: 'laud-aval-maq', nome: 'Avaliação de Máquinas e Equipamentos',
            descricao: `Serviço de Avaliação de Máquinas e Equipamentos.\n\nBase legal/normativa: NBR 14653-5/2006.\n\nFinalidade: avaliação patrimonial de bens móveis.` + HELPER_TAIL },
          { id: 'laud-aval-amb', nome: 'Avaliação de Recursos Naturais e Ambientais',
            descricao: `Serviço de Avaliação Ambiental.\n\nBase legal/normativa: NBR 14653-6/2008.\n\nFinalidade: avaliação de recursos ambientais e passivos.` + HELPER_TAIL },
          { id: 'laud-jud', nome: 'Avaliação para Fins Judiciais',
            descricao: `Serviço de Avaliação Judicial.\n\nBase legal/normativa: NBR 14653; CPC.\n\nFinalidade: subsídio a processo judicial (partilha, desapropriação, execução).` + HELPER_TAIL },
          { id: 'laud-bancaria', nome: 'Avaliação para Garantia Bancária / Financiamento',
            descricao: `Serviço de Avaliação para Garantia Bancária.\n\nBase legal/normativa: NBR 14653-2; normas do agente financeiro.\n\nFinalidade: liberação de financiamento ou refinanciamento imobiliário.` + HELPER_TAIL },
          { id: 'laud-desapr', nome: 'Avaliação para Desapropriação',
            descricao: `Serviço de Avaliação para Desapropriação.\n\nBase legal/normativa: NBR 14653-2; DL nº 3.365/1941.\n\nFinalidade: indenização justa em processo desapropriatório.` + HELPER_TAIL },
          { id: 'laud-contabil', nome: 'Avaliação para Fins Contábeis / Tributários',
            descricao: `Serviço de Avaliação Contábil/Tributária.\n\nBase legal/normativa: NBR 14653; normas contábeis (CPC 27, 28).\n\nFinalidade: lastro patrimonial em demonstrações contábeis e dispute fiscal.` + HELPER_TAIL },
        ]},
        { nome: 'Laudos de Construção', servicos: [
          { id: 'laud-vist-pred', nome: 'Vistoria Predial',
            descricao: `Serviço de Vistoria Predial.\n\nBase legal/normativa: NBR 13752/1996; NBR 16747/2020.\n\nFinalidade: avaliação do estado físico de edificação.` + HELPER_TAIL },
          { id: 'laud-patologia', nome: 'Patologia das Construções',
            descricao: `Serviço de Laudo de Patologia das Construções.\n\nBase legal/normativa: NBR 13752/1996; bibliografia técnica.\n\nFinalidade: identificar causas e propor solução de manifestações patológicas.` + HELPER_TAIL },
          { id: 'laud-insp-pred', nome: 'Inspeção Predial (NBR 16747)',
            descricao: `Serviço de Inspeção Predial.\n\nBase legal/normativa: NBR 16747/2020.\n\nFinalidade: avaliação sistemática das condições de uso e manutenção da edificação.` + HELPER_TAIL },
          { id: 'laud-cautelar', nome: 'Vistoria Cautelar de Vizinhança',
            descricao: `Serviço de Vistoria Cautelar de Vizinhança.\n\nBase legal/normativa: NBR 13752/1996.\n\nFinalidade: prova do estado pré-existente de imóveis vizinhos antes do início de obra.` + HELPER_TAIL },
          { id: 'laud-conclusao-obra', nome: 'Conclusão de Obra',
            descricao: `Serviço de Laudo de Conclusão de Obra.\n\nBase legal/normativa: Legislação municipal; NBRs construtivas.\n\nFinalidade: subsídio ao habite-se municipal.` + HELPER_TAIL },
          { id: 'laud-conformidade', nome: 'Conformidade Técnica',
            descricao: `Serviço de Laudo de Conformidade Técnica.\n\nBase legal/normativa: NBRs aplicáveis.\n\nFinalidade: atestar conformidade de execução com normas técnicas.` + HELPER_TAIL },
          { id: 'laud-estabilidade', nome: 'Estabilidade Estrutural',
            descricao: `Serviço de Laudo de Estabilidade Estrutural.\n\nBase legal/normativa: NBR 6118/2014; NBR 8800/2008; NBR 7190/2022.\n\nFinalidade: aferir segurança estrutural de edificação existente.` + HELPER_TAIL },
        ]},
        { nome: 'Laudos Trabalhistas e de Segurança', servicos: [
          { id: 'laud-insalub', nome: 'Insalubridade (NR-15)',
            descricao: `Serviço de Laudo de Insalubridade.\n\nBase legal/normativa: NR-15/MTE.\n\nFinalidade: caracterização de atividade insalubre e percentual de adicional.` + HELPER_TAIL },
          { id: 'laud-pericul', nome: 'Periculosidade (NR-16)',
            descricao: `Serviço de Laudo de Periculosidade.\n\nBase legal/normativa: NR-16/MTE.\n\nFinalidade: caracterização de atividade perigosa e adicional de 30%.` + HELPER_TAIL },
          { id: 'laud-ltcat', nome: 'LTCAT — Condições Ambientais do Trabalho',
            descricao: `Serviço de LTCAT.\n\nBase legal/normativa: Lei nº 8.213/1991; IN INSS nº 128/2022.\n\nFinalidade: subsídio à aposentadoria especial.` + HELPER_TAIL },
          { id: 'laud-ppra', nome: 'PPRA / PGR',
            descricao: `Serviço de Elaboração de PPRA/PGR.\n\nBase legal/normativa: NR-1 (atualizada); NR-9.\n\nFinalidade: programa de gerenciamento de riscos ocupacionais.` + HELPER_TAIL },
          { id: 'laud-ergon', nome: 'Laudo Ergonômico (NR-17)',
            descricao: `Serviço de Laudo Ergonômico.\n\nBase legal/normativa: NR-17/MTE.\n\nFinalidade: análise ergonômica do trabalho.` + HELPER_TAIL },
        ]},
        { nome: 'Perícias Judiciais e Extrajudiciais', servicos: [
          { id: 'laud-per-jud-eng', nome: 'Perícia Judicial em Engenharia',
            descricao: `Serviço de Perícia Judicial em Engenharia.\n\nBase legal/normativa: CPC arts. 156/158 e 464/480; NBR 13752/1996.\n\nFinalidade: produção de prova pericial em ação judicial.` + HELPER_TAIL },
          { id: 'laud-per-jud-aval', nome: 'Perícia Judicial em Avaliação de Imóveis',
            descricao: `Serviço de Perícia Judicial em Avaliação.\n\nBase legal/normativa: CPC; NBR 14653.\n\nFinalidade: prova pericial de valor de imóvel em juízo.` + HELPER_TAIL },
          { id: 'laud-per-jud-amb', nome: 'Perícia Judicial Ambiental',
            descricao: `Serviço de Perícia Judicial Ambiental.\n\nBase legal/normativa: CPC; legislação ambiental aplicável.\n\nFinalidade: prova pericial em ação ambiental.` + HELPER_TAIL },
          { id: 'laud-asst-tec', nome: 'Assistência Técnica (Parecer de Assistente Técnico)',
            descricao: `Serviço de Assistência Técnica.\n\nBase legal/normativa: CPC art. 466.\n\nFinalidade: parecer técnico de assistente da parte em perícia judicial.` + HELPER_TAIL },
          { id: 'laud-arbitral', nome: 'Perícia Extrajudicial / Arbitral',
            descricao: `Serviço de Perícia Extrajudicial.\n\nBase legal/normativa: Lei nº 9.307/1996 (Arbitragem).\n\nFinalidade: solução de conflito por via arbitral.` + HELPER_TAIL },
          { id: 'laud-quesitos', nome: 'Quesitos Suplementares e Esclarecimentos Periciais',
            descricao: `Serviço de Resposta a Quesitos Suplementares.\n\nBase legal/normativa: CPC art. 477.\n\nFinalidade: complementar laudo pericial mediante esclarecimentos.` + HELPER_TAIL },
        ]},
        { nome: 'Outros Laudos', servicos: [
          { id: 'laud-constatacao', nome: 'Laudo de Constatação',
            descricao: `Serviço de Laudo de Constatação.\n\nBase legal/normativa: NBR 13752/1996.\n\nFinalidade: registrar fato técnico em determinado momento.` + HELPER_TAIL },
          { id: 'laud-danos', nome: 'Laudo de Avaliação de Danos',
            descricao: `Serviço de Laudo de Avaliação de Danos.\n\nBase legal/normativa: NBR 13752/1996; NBR 14653.\n\nFinalidade: quantificar danos materiais para indenização.` + HELPER_TAIL },
          { id: 'laud-confront', nome: 'Laudo de Verificação de Confrontações',
            descricao: `Serviço de Laudo de Verificação de Confrontações.\n\nBase legal/normativa: NBR 13133/1994; NTGIR/INCRA.\n\nFinalidade: aferir divisas e confrontações reais do imóvel.` + HELPER_TAIL },
          { id: 'laud-cadastral', nome: 'Laudo de Levantamento Cadastral',
            descricao: `Serviço de Laudo Cadastral.\n\nBase legal/normativa: NBR 14166/2022; NBR 13133/1994.\n\nFinalidade: registro técnico de cadastro multifinalitário.` + HELPER_TAIL },
        ]},
      ],
    },
  ];

  // Helper: encontrar serviço por id
  window.CATALOGO_SERVICOS_POR_ID = {};
  for (const cat of window.CATALOGO_SERVICOS) {
    for (const sg of cat.subgrupos) {
      for (const sv of sg.servicos) {
        window.CATALOGO_SERVICOS_POR_ID[sv.id] = {
          ...sv,
          categoria_id: cat.id,
          categoria_sigla: cat.sigla,
          categoria_nome: cat.nome,
          subgrupo: sg.nome,
        };
      }
    }
  }
})();
