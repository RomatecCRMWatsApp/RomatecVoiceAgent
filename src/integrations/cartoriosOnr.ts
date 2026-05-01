// v1.53.0 — Cartórios de Registro de Imóveis (CRI) por município.
//
// Não existe consulta GRATUITA pública de matrícula no Brasil. O ONR
// (registradores.org.br) cobra por consulta. Mas o que dá pra fazer grátis e
// é genuinamente útil: indicar QUAL cartório é competente em determinada
// cidade/região (1ª/2ª Zona, endereço, telefone), e montar a URL pré-preenchida
// pra o Chefe abrir o portal e pagar a consulta com 1 clique.
//
// Tabela curada pra municípios da operação Romatec (sudoeste do MA + SLZ
// metropolitana). Pra adicionar mais cidades é só editar CARTORIOS abaixo.

export interface Cartorio {
  zona:        string;            // ex: "Única" / "1ª Zona" / "2ª Zona"
  nome_oficial: string;            // ex: "Cartório de Registro de Imóveis de Açailândia"
  oficial?:    string;            // tabelião responsável
  endereco?:   string;
  bairro?:     string;
  cep?:        string;
  telefone?:   string;
  email?:      string;
  site?:       string;
  abrange?:    string;            // descrição textual da abrangência territorial
  observacoes?: string;
}

interface MunicipioCartorios {
  municipio: string;
  uf:        string;
  cartorios: Cartorio[];
}

// Slug → dados. Manter chave normalizada (slugify do "municipio-uf").
const CARTORIOS: Record<string, MunicipioCartorios> = {
  'acailandia-ma': {
    municipio: 'Açailândia', uf: 'MA',
    cartorios: [{
      zona: 'Única',
      nome_oficial: 'Cartório de Registro de Imóveis de Açailândia',
      endereco: 'Av. Coronel José Pio, Centro',
      cep:      '65930-000',
      telefone: '(99) 3538-XXXX',
      abrange:  'Município de Açailândia/MA inteiro (sede + distritos: Pequiá, Vila Bom Jesus, Piquiá de Baixo, etc).',
      observacoes: 'Para certidão integral atualizada vá ao balcão ou solicite via ONR (pago).',
    }],
  },
  'imperatriz-ma': {
    municipio: 'Imperatriz', uf: 'MA',
    cartorios: [
      {
        zona: '1ª Zona',
        nome_oficial: '1º Ofício de Registro de Imóveis de Imperatriz',
        endereco: 'Rua Tamandaré, Centro',
        cep:      '65900-000',
        abrange:  'Bairros centrais e zonas norte/oeste — confirmar com endereço específico.',
      },
      {
        zona: '2ª Zona',
        nome_oficial: '2º Ofício de Registro de Imóveis de Imperatriz',
        endereco: 'Rua Pernambuco, Centro',
        cep:      '65900-000',
        abrange:  'Bairros leste/sul + área rural — confirmar com endereço específico.',
        observacoes: 'Se não tiver certeza qual zona, ligue antes — o atendente confirma pelo endereço/matrícula.',
      },
    ],
  },
  'sao-luis-ma': {
    municipio: 'São Luís', uf: 'MA',
    cartorios: [
      { zona: '1ª Zona', nome_oficial: '1º Ofício de Registro de Imóveis de São Luís', endereco: 'Centro Histórico' },
      { zona: '2ª Zona', nome_oficial: '2º Ofício de Registro de Imóveis de São Luís', endereco: 'Centro Histórico' },
      { zona: '3ª Zona', nome_oficial: '3º Ofício de Registro de Imóveis de São Luís', endereco: 'Calhau / Renascença' },
      { zona: '4ª Zona', nome_oficial: '4º Ofício de Registro de Imóveis de São Luís', endereco: 'Cohama / Vinhais' },
      { zona: '5ª Zona', nome_oficial: '5º Ofício de Registro de Imóveis de São Luís', endereco: 'Anil / Cohatrac' },
      { zona: '6ª Zona', nome_oficial: '6º Ofício de Registro de Imóveis de São Luís', endereco: 'Maracanã / Cidade Operária' },
      { zona: '7ª Zona', nome_oficial: '7º Ofício de Registro de Imóveis de São Luís', endereco: 'Tirirical / Distrito Industrial' },
    ],
  },
  'caxias-ma': {
    municipio: 'Caxias', uf: 'MA',
    cartorios: [{ zona: 'Única', nome_oficial: 'Cartório de Registro de Imóveis de Caxias' }],
  },
  'codo-ma': {
    municipio: 'Codó', uf: 'MA',
    cartorios: [{ zona: 'Única', nome_oficial: 'Cartório de Registro de Imóveis de Codó' }],
  },
  'timon-ma': {
    municipio: 'Timon', uf: 'MA',
    cartorios: [{ zona: 'Única', nome_oficial: 'Cartório de Registro de Imóveis de Timon' }],
  },
  'bacabal-ma': {
    municipio: 'Bacabal', uf: 'MA',
    cartorios: [{ zona: 'Única', nome_oficial: 'Cartório de Registro de Imóveis de Bacabal' }],
  },
  'santa-ines-ma': {
    municipio: 'Santa Inês', uf: 'MA',
    cartorios: [{ zona: 'Única', nome_oficial: 'Cartório de Registro de Imóveis de Santa Inês' }],
  },
  'pinheiro-ma': {
    municipio: 'Pinheiro', uf: 'MA',
    cartorios: [{ zona: 'Única', nome_oficial: 'Cartório de Registro de Imóveis de Pinheiro' }],
  },
  'cidelandia-ma': {
    municipio: 'Cidelândia', uf: 'MA',
    cartorios: [{
      zona: 'Única',
      nome_oficial: 'Cartório de Registro de Imóveis de Cidelândia',
      observacoes: 'Comarca pequena — pode estar anexada à Açailândia (confirmar).',
    }],
  },
  'sao-pedro-da-agua-branca-ma': {
    municipio: 'São Pedro da Água Branca', uf: 'MA',
    cartorios: [{
      zona: 'Única',
      nome_oficial: 'Cartório de Registro de Imóveis de São Pedro da Água Branca',
      observacoes: 'Comarca anexada à Açailândia — confirmar se atende localmente ou se matrículas vão pra Açailândia.',
    }],
  },
  'vila-nova-dos-martirios-ma': {
    municipio: 'Vila Nova dos Martírios', uf: 'MA',
    cartorios: [{
      zona: 'Única',
      nome_oficial: 'Cartório de Registro de Imóveis de Vila Nova dos Martírios',
      observacoes: 'Comarca pequena — pode atender via Açailândia.',
    }],
  },
  'itinga-do-maranhao-ma': {
    municipio: 'Itinga do Maranhão', uf: 'MA',
    cartorios: [{
      zona: 'Única',
      nome_oficial: 'Cartório de Registro de Imóveis de Itinga do Maranhão',
    }],
  },
  'buritirama-ma': {
    municipio: 'Buritirama', uf: 'MA',
    cartorios: [{
      zona: 'Única',
      nome_oficial: 'Cartório de Registro de Imóveis de Buritirama',
      observacoes: 'Comarca anexada — confirmar com TJ-MA qual cartório atende efetivamente.',
    }],
  },
};

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface BuscaCartorioInput {
  municipio: string;
  uf?:       string;
}

export interface BuscaCartorioOutput {
  encontrado:    boolean;
  municipio:     string;
  uf:            string;
  total_zonas:   number;
  cartorios:     Cartorio[];
  observacao_geral?: string;
  proximos_passos: string[];
}

export function buscarCartorio(input: BuscaCartorioInput): BuscaCartorioOutput {
  if (!input.municipio?.trim()) throw new Error('municipio é obrigatório.');

  const uf   = input.uf ?? 'MA';
  const slug = slugify(`${input.municipio}-${uf}`);
  const dados = CARTORIOS[slug];

  if (!dados) {
    return {
      encontrado: false,
      municipio:  input.municipio,
      uf,
      total_zonas: 0,
      cartorios:   [],
      observacao_geral:
        `Município "${input.municipio}/${uf}" não está no cadastro local da ZAYRA. ` +
        `Pra descobrir o cartório competente: (1) ligue na Prefeitura do município, ` +
        `(2) consulte o site do TJ-${uf} → Comarcas, ou ` +
        `(3) acesse registradores.org.br/buscar-cartorio.`,
      proximos_passos: [
        `Buscar cartório no portal: https://www.registradores.org.br/buscar-cartorio?cidade=${encodeURIComponent(input.municipio)}&uf=${uf}`,
        `Consultar comarcas TJ-${uf}: https://www.tj${uf.toLowerCase()}.jus.br`,
      ],
    };
  }

  const tem_zonas = dados.cartorios.length > 1;
  const proximos: string[] = [];
  if (tem_zonas) {
    proximos.push(
      `Existem ${dados.cartorios.length} zonas — pra saber qual atende um endereço específico, ligue na zona mais próxima do bairro ou consulte com o número da matrícula.`,
    );
  }
  proximos.push(
    `Pra solicitar certidão de matrícula online (PAGO): https://www.registradores.org.br`,
    `Pra ir presencialmente, leve: número da matrícula + RG + CPF.`,
  );

  return {
    encontrado:  true,
    municipio:   dados.municipio,
    uf:          dados.uf,
    total_zonas: dados.cartorios.length,
    cartorios:   dados.cartorios,
    proximos_passos: proximos,
  };
}

// ── URL pré-preenchida ONR ──────────────────────────────────────────────────
// O portal ONR (Centro de Serviços Eletrônicos Compartilhados — CSEC) tem URL
// padronizada de busca. Não dá pra automatizar a CONSULTA (paga + 2FA), mas
// dá pra abrir já com cidade/UF preenchidos pra economizar cliques.

export interface MontarUrlOnrInput {
  municipio:   string;
  uf?:         string;
  matricula?:  string; // número, opcional — só pra exibir contexto
}

export interface MontarUrlOnrOutput {
  url_busca_cartorio:  string;
  url_pedido_certidao: string;
  url_acompanhamento:  string;
  observacao:          string;
  custos_aproximados:  Array<{ tipo: string; valor_estimado: string }>;
}

export function montarUrlConsultaOnr(input: MontarUrlOnrInput): MontarUrlOnrOutput {
  if (!input.municipio?.trim()) throw new Error('municipio é obrigatório.');
  const uf = input.uf ?? 'MA';
  const cidade = encodeURIComponent(input.municipio);

  return {
    url_busca_cartorio:  `https://www.registradores.org.br/buscar-cartorio?cidade=${cidade}&uf=${uf}`,
    url_pedido_certidao: `https://www.registradores.org.br/csec/pedido?cidade=${cidade}&uf=${uf}`,
    url_acompanhamento:  `https://www.registradores.org.br/csec/acompanhamento`,
    observacao:
      `Pra consultar a matrícula online é PRECISO ter conta no ONR (Operador Nacional do Registro) ` +
      `com saldo. Custos aproximados abaixo. Alternativa: ir presencialmente ao cartório (R$ 50–150 ` +
      `pra certidão integral, sai na hora).` + (input.matricula ? ` Matrícula informada: ${input.matricula}.` : ''),
    custos_aproximados: [
      { tipo: 'Visualização simples (informações básicas)', valor_estimado: 'R$ 5–15' },
      { tipo: 'Certidão integral atualizada (com cadeia dominial)', valor_estimado: 'R$ 50–150' },
      { tipo: 'Certidão de ônus reais (penhoras/hipotecas)', valor_estimado: 'R$ 30–80' },
      { tipo: 'Certidão digital com selo CRA', valor_estimado: 'R$ 80–200' },
    ],
  };
}

export function listarMunicipiosComCartorio(): Array<{ municipio: string; uf: string; total_zonas: number }> {
  return Object.values(CARTORIOS).map(d => ({
    municipio: d.municipio,
    uf:        d.uf,
    total_zonas: d.cartorios.length,
  }));
}
