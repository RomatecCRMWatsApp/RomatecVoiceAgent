// v3.49.6: Motor + Orquestrador do Memorial Arquitetonico (SINAPI + NBR 13532/15575/9050).
// Modulo Memoriais & Quantitativos. Diferente das outras disciplinas, o arquitetonico
// nao possui motor previo — o calculo de acabamentos/quantitativos esta aqui, autocontido.
// Standalone — sem deps de mysql/pdfkit.

export type PadraoAcabamento = 'popular' | 'normal' | 'alto';
export type TipoCobertura = 'laje_telha' | 'laje_impermeabilizada' | 'telha_fibrocimento' | 'telha_ceramica_madeira';

export interface DadosObraArq {
  titulo: string; endereco: string; municipio: string; uf: string;
  proprietario: string; cpfCnpj: string; areaM2: number; areaLoteM2?: number;
  nPavimentos: number; prancha: string; trtNumero?: string;
}

export interface DadosUsoArq {
  tipoUso: 'residencial' | 'comercial';
  padraoAcabamento: PadraoAcabamento;
  nQuartos: number;
  nBanheiros: number;
  areaMolhadaM2: number;       // banheiros + cozinha + area de servico (paredes azulejadas)
  peDireitoM: number;
  tipoCobertura: TipoCobertura;
  acessibilidade: boolean;     // rota acessivel NBR 9050
}

export interface MaterialItem { descricao: string; unidade: string; qtd: number; }

export interface ResultadoArquitetonico {
  dadosObra: DadosObraArq;
  dadosUso: DadosUsoArq;
  saida: {
    areas: {
      construida_m2: number;
      parede_interna_m2: number;        // area de parede a revestir/pintar (ambas faces internas)
      area_molhada_revest_m2: number;   // azulejo
      forro_m2: number;
      cobertura_m2: number;
      pintura_total_m2: number;
    };
    esquadrias: { portas_internas: number; portas_externas: number; janelas: number };
    acabamentos: { piso: string; parede: string; forro: string; cobertura: string };
    loucas_metais: { bacias: number; lavatorios: number; pias: number; chuveiros: number };
  };
  materiais: {
    pisos: MaterialItem[];
    paredes_revestimento: MaterialItem[];
    forro_pintura: MaterialItem[];
    esquadrias: MaterialItem[];
    cobertura: MaterialItem[];
    loucas_metais: MaterialItem[];
  };
  totais: { areaPisoM2: number; areaPinturaM2: number; nEsquadrias: number };
  statusNormativo: {
    peDireitoMinimoOK: boolean;        // >= 2,50 m
    ventilacaoIluminacaoOK: boolean;   // janelas >= 1/8 da area (codigo de obras / NBR 15575)
    acessibilidadePrevista: boolean;   // NBR 9050
    coberturaDefinida: boolean;
  };
  alertas: string[];
}

const PADRAO_LABEL: Record<PadraoAcabamento, string> = { popular: 'Popular', normal: 'Normal/Medio', alto: 'Alto padrao' };
export function labelPadrao(p: PadraoAcabamento): string { return PADRAO_LABEL[p] ?? p; }

const COBERTURA_LABEL: Record<TipoCobertura, string> = {
  laje_telha: 'Laje + telha ceramica sobre estrutura de madeira',
  laje_impermeabilizada: 'Laje impermeabilizada (cobertura plana)',
  telha_fibrocimento: 'Telha de fibrocimento sobre estrutura',
  telha_ceramica_madeira: 'Telha ceramica sobre madeiramento',
};
export function labelCobertura(t: TipoCobertura): string { return COBERTURA_LABEL[t] ?? t; }

// Acabamentos sugeridos por padrao
const ACABAMENTOS: Record<PadraoAcabamento, { piso: string; parede: string; forro: string }> = {
  popular: { piso: 'Piso ceramico PEI-4 45x45 cm', parede: 'Reboco + massa unica + pintura latex PVA', forro: 'Laje revestida / forro PVC' },
  normal: { piso: 'Porcelanato 60x60 cm acetinado', parede: 'Reboco + massa corrida + pintura acrilica', forro: 'Forro de gesso liso com sancas' },
  alto: { piso: 'Porcelanato polido 80x80 cm / porcelanato amadeirado', parede: 'Massa corrida PVA dupla + pintura acrilica premium', forro: 'Forro de gesso acartonado com iluminacao embutida' },
};
// Coeficientes de perda por padrao (SINAPI tipico)
const PERDA: Record<PadraoAcabamento, number> = { popular: 1.10, normal: 1.12, alto: 1.15 };

function ceilPos(n: number): number { return Math.max(0, Math.ceil(n)); }
function r2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

export interface EntradaResumoArq { dadosObra: DadosObraArq; dadosUso: DadosUsoArq; }

export function calcularResumoArquitetonico(entrada: EntradaResumoArq): ResultadoArquitetonico {
  const { dadosObra, dadosUso } = entrada;
  const area = dadosObra.areaM2 > 0 ? dadosObra.areaM2 : 1;
  const pd = dadosUso.peDireitoM && dadosUso.peDireitoM > 0 ? dadosUso.peDireitoM : 2.7;
  const padrao = dadosUso.padraoAcabamento;
  const perda = PERDA[padrao];

  // Areas
  const paredeInterna = r2(area * 2.6 * 2 * 0.85);     // ~2,6 m2 parede/m2 piso, 2 faces, abatendo vaos
  const areaMolhada = dadosUso.areaMolhadaM2 && dadosUso.areaMolhadaM2 > 0 ? dadosUso.areaMolhadaM2 : Math.max(8, dadosUso.nBanheiros * 6 + 6);
  const azulejoM2 = r2(areaMolhada * pd * 0.9);
  const forro = r2(area);
  const inclFator = dadosUso.tipoCobertura === 'laje_impermeabilizada' ? 1.05 : 1.20;
  const cobertura = r2(area / Math.max(1, dadosObra.nPavimentos) * inclFator);
  const pinturaTotal = r2(paredeInterna - azulejoM2 + forro);

  // Esquadrias
  const portasInternas = dadosUso.nQuartos + dadosUso.nBanheiros + 2;   // quartos + banheiros + cozinha/servico
  const portasExternas = 2;
  const janelas = ceilPos(area / 14) + dadosUso.nQuartos;

  // Loucas e metais
  const bacias = dadosUso.nBanheiros;
  const lavatorios = dadosUso.nBanheiros;
  const pias = 1;
  const chuveiros = dadosUso.nBanheiros;

  const ac = ACABAMENTOS[padrao];

  const materiais: ResultadoArquitetonico['materiais'] = {
    pisos: [
      { descricao: `${ac.piso}`, unidade: 'm2', qtd: r2(area * perda) },
      { descricao: 'Contrapiso / regularizacao de base', unidade: 'm2', qtd: r2(area) },
      { descricao: 'Rodape (ceramico/poliestireno)', unidade: 'm', qtd: ceilPos(Math.sqrt(area) * 4 * 0.8) },
      { descricao: 'Argamassa colante AC-II / rejunte', unidade: 'sc', qtd: ceilPos(area / 5) },
    ],
    paredes_revestimento: [
      { descricao: 'Chapisco + reboco/emboco interno', unidade: 'm2', qtd: r2(paredeInterna * perda) },
      { descricao: `Revestimento ceramico (azulejo) area molhada`, unidade: 'm2', qtd: r2(azulejoM2 * perda) },
      { descricao: 'Massa corrida / massa unica', unidade: 'm2', qtd: r2((paredeInterna - azulejoM2) * perda) },
    ],
    forro_pintura: [
      { descricao: ac.forro, unidade: 'm2', qtd: r2(forro * perda) },
      { descricao: `${ac.parede} (paredes)`, unidade: 'm2', qtd: r2((paredeInterna - azulejoM2) * perda) },
      { descricao: 'Pintura de teto/forro', unidade: 'm2', qtd: r2(forro * perda) },
      { descricao: 'Selador acrilico / fundo preparador', unidade: 'L', qtd: ceilPos(pinturaTotal / 8) },
    ],
    esquadrias: [
      { descricao: 'Porta interna semi-oca 0,80x2,10 m (folha+batente+ferragens)', unidade: 'un', qtd: portasInternas },
      { descricao: 'Porta externa de seguranca / social 0,90x2,10 m', unidade: 'un', qtd: portasExternas },
      { descricao: 'Janela de aluminio/PVC com vidro', unidade: 'un', qtd: janelas },
      { descricao: 'Fechadura / dobradicas (kit por porta)', unidade: 'cj', qtd: portasInternas + portasExternas },
    ],
    cobertura: [
      { descricao: labelCobertura(dadosUso.tipoCobertura), unidade: 'm2', qtd: r2(cobertura * perda) },
      ...(dadosUso.tipoCobertura === 'laje_impermeabilizada'
        ? [{ descricao: 'Manta/membrana de impermeabilizacao', unidade: 'm2', qtd: r2(cobertura * 1.1) }]
        : [{ descricao: 'Madeiramento / estrutura de telhado', unidade: 'm2', qtd: r2(cobertura) }]),
      { descricao: 'Calha / rufo / cumeeira', unidade: 'm', qtd: ceilPos(Math.sqrt(area) * 3) },
    ],
    loucas_metais: [
      { descricao: 'Bacia sanitaria com caixa acoplada', unidade: 'un', qtd: bacias },
      { descricao: 'Lavatorio / cuba com torneira', unidade: 'un', qtd: lavatorios },
      { descricao: 'Pia de cozinha em inox com bancada', unidade: 'un', qtd: pias },
      { descricao: 'Chuveiro / ducha + registros', unidade: 'cj', qtd: chuveiros },
      { descricao: 'Acessorios (papeleira, saboneteira, barras)', unidade: 'cj', qtd: dadosUso.nBanheiros + (dadosUso.acessibilidade ? 1 : 0) },
    ],
  };

  const areaPiso = r2(area * perda);
  const peOK = pd >= 2.5;
  const janelaAreaEstim = janelas * 1.5;       // ~1,5 m2 por janela
  const ventOK = janelaAreaEstim >= area / 8;  // criterio 1/8 (codigo de obras)
  const alertas: string[] = [];
  if (!peOK) alertas.push(`Pe-direito de ${pd} m abaixo do minimo de 2,50 m usual em codigos de obras municipais.`);
  if (!ventOK) alertas.push('Area de janelas pode estar abaixo de 1/8 da area de piso — revisar iluminacao/ventilacao natural (NBR 15575 / codigo de obras).');
  if (dadosUso.acessibilidade === false && dadosUso.tipoUso === 'comercial') alertas.push('Uso comercial sem rota acessivel marcada — verificar exigencia de acessibilidade (NBR 9050).');

  return {
    dadosObra, dadosUso: { ...dadosUso, peDireitoM: pd, areaMolhadaM2: areaMolhada },
    saida: {
      areas: { construida_m2: r2(area), parede_interna_m2: paredeInterna, area_molhada_revest_m2: azulejoM2, forro_m2: forro, cobertura_m2: cobertura, pintura_total_m2: pinturaTotal },
      esquadrias: { portas_internas: portasInternas, portas_externas: portasExternas, janelas },
      acabamentos: { piso: ac.piso, parede: ac.parede, forro: ac.forro, cobertura: labelCobertura(dadosUso.tipoCobertura) },
      loucas_metais: { bacias, lavatorios, pias, chuveiros },
    },
    materiais,
    totais: { areaPisoM2: areaPiso, areaPinturaM2: pinturaTotal, nEsquadrias: portasInternas + portasExternas + janelas },
    statusNormativo: {
      peDireitoMinimoOK: peOK,
      ventilacaoIluminacaoOK: ventOK,
      acessibilidadePrevista: !!dadosUso.acessibilidade,
      coberturaDefinida: !!dadosUso.tipoCobertura,
    },
    alertas,
  };
}
