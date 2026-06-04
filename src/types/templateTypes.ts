// v1.99.16 — Tipos e enum dos templates de exportacao PDF (Proposta / Recibo / Laudo).
//
// Tres opcoes de layout, selecionaveis via query param `?template=`:
//   - PADRAO  : pipeline pdfkit atual (intocado) — fallback default
//   - PRIME_I : dark premium (verde/dourado sobre fundo escuro), via puppeteer
//   - PRIME_II: clean editorial (verde/dourado sobre fundo claro), via puppeteer
//
// Os geradores Prime sao modulos PARALELOS (src/pdf/*). Nada aqui altera a
// logica existente de geracao do template Padrao.

export enum TemplateId {
  PADRAO = 'padrao', // template atual (nao mexer)
  PRIME_I = 'prime1', // dark premium verde/dourado
  PRIME_II = 'prime2', // clean editorial verde/dourado
}

export interface TemplateOption {
  id: TemplateId;
  label: string;
  descricao: string;
}

export const TEMPLATE_OPTIONS: TemplateOption[] = [
  { id: TemplateId.PADRAO, label: 'Padrao', descricao: 'Modelo tradicional Romatec' },
  { id: TemplateId.PRIME_I, label: 'Prime I', descricao: 'Dark Premium — verde e dourado' },
  { id: TemplateId.PRIME_II, label: 'Prime II', descricao: 'Clean Editorial — minimalista' },
];

/**
 * Converte um valor arbitrario (query string, body, etc.) num TemplateId valido.
 * Qualquer valor desconhecido cai em PADRAO — garante compat retro 100%.
 */
export function parseTemplateId(value: unknown): TemplateId {
  const v = String(value ?? '').trim().toLowerCase();
  switch (v) {
    case TemplateId.PRIME_I:
      return TemplateId.PRIME_I;
    case TemplateId.PRIME_II:
      return TemplateId.PRIME_II;
    default:
      return TemplateId.PADRAO;
  }
}

/** True quando o template e' um dos novos Prime (renderizado via puppeteer). */
export function isTemplatePrime(id: TemplateId): boolean {
  return id === TemplateId.PRIME_I || id === TemplateId.PRIME_II;
}

// ── Interfaces de dados compartilhadas pelos geradores Prime ────────────────

export interface PropostaServicoItem {
  descricao: string;
  /** null = "incluso" / "—" */
  valor: number | null;
}

export interface PropostaParcela {
  /** ex: "P1 – 40%" */
  label: string;
  descricao: string;
}

export interface PropostaEtapa {
  numero: string;
  titulo: string;
  texto: string;
  prazo?: string;
}

export interface PropostaPrazo {
  valor: string;
  unidade: string;
  descricao: string;
}

export interface PropostaTecnico {
  nome: string;
  cargo: string;
  credenciais: string[];
  empresa: string;
  municipio: string;
}

export interface PropostaDados {
  numero: string; // ex: "PROP-2025-0014"
  dataEmissao: string; // ex: "02 de junho de 2025"
  validade: string; // ex: "30 dias"
  tipoServico: string; // ex: "Georreferenciamento de Imovel Rural"
  cliente: {
    nome: string;
    cpfCnpj: string;
    endereco?: string;
  };
  imovel?: {
    nome?: string;
    municipio?: string;
    uf?: string;
    areaHa?: string;
    matricula?: string;
  };
  servicos: PropostaServicoItem[];
  valorTotal: number;
  valorTotalExtenso: string;
  parcelas: PropostaParcela[];
  etapas: PropostaEtapa[];
  prazos: PropostaPrazo[];
  drlIncluida: boolean; // se true, exibe bloco DRL warning
  observacoes?: string;
  tecnico: PropostaTecnico;
}

export interface ReciboParcela {
  label: string;
  valor: number;
  dataPagamento?: string;
}

export interface ReciboTecnico {
  nome: string;
  cargo: string;
  credenciais: string[];
}

export interface ReciboDados {
  numero: string; // ex: "REC-2025-0042"
  dataEmissao: string;
  hashValidacao: string; // SHA-256
  urlVerificacao: string; // /v/:hash
  status: string; // enum do sistema
  /** true quando status indica recibo confirmado/pago → exibe selo CONFIRMADO */
  confirmado: boolean;
  cliente: {
    nome: string;
    cpfCnpj: string;
  };
  servico: string;
  valorTotal: number;
  valorTotalExtenso: string;
  parcelas?: ReciboParcela[];
  /** base64 (sem prefixo data:) da imagem de assinatura, se disponivel */
  assinaturaDigital?: string;
  tecnico: ReciboTecnico;
  observacoes?: string;
}

// ── Laudos de Demarcacao (Prime I / Prime II) ───────────────────────────────

export interface LaudoVertice {
  ordem: number;
  rotulo: string;
  tipoMarco?: string;
  utmE: string;
  utmN: string;
  lat?: string;
  long?: string;
}

export interface LaudoLado {
  lado: string;
  azimute: string;
  distancia: string;
}

export interface LaudoTecnico {
  nome: string;
  cargo: string;
  credenciais: string[];
  empresa: string;
  municipio: string;
}

export interface LaudoDados {
  numero: string;
  dataEmissao: string;
  tipoImovel: string; // 'RURAL' | 'URBANO'
  finalidade: string;
  contratante: {
    nome: string;
    cpfCnpj: string;
    telefone?: string;
    email?: string;
  };
  imovel: {
    denominacao?: string;
    matricula?: string;
    municipio?: string;
    uf?: string;
    localizacao?: string;
  };
  vertices: LaudoVertice[];
  lados: LaudoLado[];
  area: {
    m2: string;
    ha?: string;
    alqueires?: string;
    perimetro?: string;
  };
  /** SVG inline do croqui (preferencial) */
  croquiSvg?: string;
  /** fallback: data-uri de imagem do croqui */
  croquiImgBase64?: string;
  art?: string;
  trt?: string;
  /** base64 puro da assinatura, se houver */
  assinaturaDigitalBase64?: string;
  hashValidacao: string;
  urlVerificacao: string;
  tecnico: LaudoTecnico;
}
