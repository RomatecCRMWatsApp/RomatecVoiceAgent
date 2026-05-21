// v1.66.0: leitor unico de config/pricing-params.json. Cache em memoria
// (re-le sob demanda em prod nao precisa restart pra recarregar arquivo).
import fs from 'fs';
import path from 'path';

interface PricingParams {
  salario_minimo_2026: number;
  cub_ma: {
    base_r8n: number;
    multiplicadores_padrao: { popular: number; normal: number; alto: number };
    ultima_atualizacao: string;
    fonte: string;
  };
  art_crea_ma_2026: { faixa_1: number; faixa_2: number; faixa_3: number; fonte: string };
  anotacao_tecnica_2026?: {
    art_crea: { rotulo: string; conselho: string; valor: number; fonte: string };
    rrt_cau:  { rotulo: string; conselho: string; valor: number; fonte: string };
    trt_cft:  { rotulo: string; conselho: string; valor: number; fonte: string };
  };
  honorarios_projeto: {
    averbacao_residencial_por_m2: number;
    averbacao_comercial_por_m2: number;
    desmembramento_meio_sm: number;
    desmembramento_sm_completo: number;
    remembramento_meio_sm: number;
    remembramento_sm_completo: number;
    retificacao_area_sm_default: number;
    ptam_lote_urbano_sm: number;
    ptam_sitio_proximo_sm: number;
    ptam_rural_medio_sm: number;
    ptam_fazenda_grande_sm: number;
    geo_rural_por_hectare: number;
    geo_rural_por_vertice: number;
    geo_rural_diaria_campo: number;
    geo_rural_por_km_deslocamento: number;
    geo_rural_minimo_sm: number;
    geo_rural_complexidade_simples: number;
    geo_rural_complexidade_media: number;
    geo_rural_complexidade_alta: number;
  };
  honorarios_assessoria: { padrao_sm: number; descricao: string };
  sero_inss: {
    aliquota_inss: number;
    aliquota_sistema_s: number;
    fonte: string;
    percentual_mao_obra: {
      residencial_alvenaria_sem_premoldado: number;
      residencial_alvenaria_com_premoldado: number;
      residencial_madeira: number;
      comercial_medio: number;
    };
    aviso_pdf: string;
  };
  prefeitura_acailandia: {
    habite_se: number | null;
    alvara_construcao: number | null;
    aprovacao_desmembramento: number | null;
    AVISO: string;
  };
  tjma_emolumentos_2026: { fonte: string; limite_maximo_total: number };
  // v3.23.5: servicos adicionais opcionais de Georreferenciamento Rural.
  opcionais_georref?: {
    ccir:        { rotulo: string; valor_unitario: number };
    car:         { rotulo: string; valor_unitario: number };
    itr:         { rotulo: string; valor_unitario: number; unidade?: string };
    anuencia:    { rotulo: string; valor_unitario: number; unidade?: string };
    retificacao: { rotulo: string; valor: 'sob_orcamento' };
  };
  _meta?: { ultima_atualizacao: string; atualizado_por: string; versao: string };
}

let cache: PricingParams | null = null;
let cacheMtime = 0;

function paramsPath(): string {
  // Em dev: src/services/pricing/params.ts -> ../../../config/...
  // Em prod (dist): dist/services/pricing/params.js -> ../../../config/...
  return path.join(__dirname, '..', '..', '..', 'config', 'pricing-params.json');
}

export function getParams(): PricingParams {
  const fp = paramsPath();
  try {
    const stat = fs.statSync(fp);
    if (cache && stat.mtimeMs === cacheMtime) return cache;
    const raw = fs.readFileSync(fp, 'utf-8');
    cache = JSON.parse(raw) as PricingParams;
    cacheMtime = stat.mtimeMs;
    return cache;
  } catch (err) {
    if (cache) return cache; // fallback se arquivo sumir
    throw new Error(`pricing-params.json nao encontrado em ${fp}: ${(err as Error).message}`);
  }
}

export function salarioMinimo(): number {
  return getParams().salario_minimo_2026;
}

export function cubPorPadrao(padrao: 'popular' | 'normal' | 'alto'): number {
  const p = getParams().cub_ma;
  return p.base_r8n * p.multiplicadores_padrao[padrao];
}

export function artCreaFaixa1(): number {
  return getParams().art_crea_ma_2026.faixa_1;
}

export type AnotacaoTecnicaTipo = 'art_crea' | 'rrt_cau' | 'trt_cft';

export function anotacaoTecnica(tipo: AnotacaoTecnicaTipo): { rotulo: string; conselho: string; valor: number; fonte: string } {
  const params = getParams();
  const at = params.anotacao_tecnica_2026;
  if (at && at[tipo]) return at[tipo];
  // Fallback retrocompat: usa ART CREA
  return {
    rotulo: 'ART CREA-MA (Anotacao de Responsabilidade Tecnica)',
    conselho: 'CREA-MA',
    valor: params.art_crea_ma_2026.faixa_1,
    fonte: params.art_crea_ma_2026.fonte,
  };
}
