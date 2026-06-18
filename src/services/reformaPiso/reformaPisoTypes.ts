// src/services/reformaPiso/reformaPisoTypes.ts
// v3.67.0: Contratos de dados do módulo de Reforma — Piso Sobreposto.

export type TemaProposta = 'tradicional' | 'prime1' | 'prime2';

export interface Ambiente {
  descricao: string;
  comprimentoM: number; // metros (0 quando a área é informada direto)
  larguraM: number;     // metros (0 quando a área é informada direto)
  // v3.71.0: área informada DIRETAMENTE (m²) — para cômodos poligonais (mais de
  // 4 lados) ou quando se quer lançar só a área total. Se > 0, sobrepõe C×L.
  areaM2?: number;
}

/** Dimensão de uma peça de piso (mm) e da junta (mm). */
export interface ConfigPeca {
  ladoAmm: number;       // ex.: 600 (porcelanato 60x60)
  ladoBmm: number;       // ex.: 600
  espessuraMm: number;   // espessura da placa (p/ cálculo de rejunte)
  juntaMm: number;       // largura da junta de assentamento
  m2PorCaixa: number;    // rendimento da caixa (m²)
}

/** Parâmetros técnicos de consumo — todos ajustáveis no payload. */
export interface ConfigCalculo {
  peca: ConfigPeca;

  perdaPisoPct: number;          // % de perda por recorte (NBR 13753) — default 10
  argamassaKgM2: number;         // consumo de AC por m² (NBR 14081) — depende do dente
  argamassaSacoKg: number;       // peso do saco (kg)
  rejunteDensidade: number;      // densidade aparente do rejunte (kg/dm³) — NBR 14992
  rejunteEmbalagemKg: number;    // peso da embalagem de rejunte (kg)
  espacadoresPorPeca: number;    // cruzetas por peça (regra de bolso)
  espacadorPacote: number;       // unidades por pacote
  niveladorClipsM2: number;      // clips do sistema nivelador por m² ("travadores")
  niveladorClipsPacote: number;  // unidades por pacote
  niveladorCunhasPacote: number; // cunhas (reutilizáveis) por pacote

  // v3.70.0: piso sobre piso (sem remoção) usa AC-III + dupla colagem (consumo maior);
  // com remoção (assenta sobre contrapiso) usa AC-II com o consumo padrão (argamassaKgM2).
  argamassaKgM2SemRemocao: number;
  // v3.70.0: disco de corte diamantado — porcelanato desgasta o disco; rendimento em m²/disco.
  discoCorteRendimentoM2: number;

  produtividadeM2DiaEquipe: number; // m²/dia por equipe (assentamento)
  diasRejuntamento: number;         // dias dedicados ao rejunte
  diasCuraLiberacao: number;        // dias de cura/liberação ao tráfego

  bdiPct: number;                   // BDI aplicado sobre o subtotal

  // Preços de referência (R$) — ajustar por orçamento de compra
  precoPisoM2: number;
  precoArgamassaSaco: number;
  precoRejunteEmbalagem: number;
  precoEspacadorPacote: number;
  precoNiveladorClipsPacote: number;
  precoNiveladorCunhasPacote: number;
  precoDiscoCorte: number;          // R$ por disco de corte diamantado
  maoObraM2: number;                // R$/m² de mão de obra
}

export interface DadosProposta {
  contratanteNome: string;
  contratanteDoc?: string;
  contratanteFone?: string;
  obraEndereco?: string;
  cidade?: string;
  uf?: string;
  comRemocao?: boolean;     // piso sobreposto => false
  validadeDias?: number;
  tema?: TemaProposta;
  ambientes: Ambiente[];
  config?: Partial<ConfigCalculo>;
}

// ---- Resultado do cálculo ----------------------------------------------

export interface AmbienteCalculado extends Ambiente {
  areaM2: number;
}

export interface ItemInsumo {
  item: string;
  unidade: string;
  quantidade: number;
  precoUnit: number;
  total: number;
  obs?: string;
}

export interface ResultadoCalculo {
  ambientes: AmbienteCalculado[];
  areaTotalM2: number;
  areaComPerdaM2: number;
  insumos: ItemInsumo[];
  valorMateriais: number;
  maoObraM2: number;
  valorMaoObra: number;
  subtotal: number;
  bdiPct: number;
  valorBdi: number;
  valorFinal: number;
  valorM2Final: number;
  prazoDiasUteis: number;
  prazoDetalhe: { assentamento: number; rejuntamento: number; curaLiberacao: number };
}

/**
 * Configuração padrão — porcelanato 60x60, simples colagem, junta 3 mm.
 * Valores de consumo conforme literatura técnica das normas citadas;
 * preços são de referência (Maranhão/2026) e devem ser ajustados por orçamento.
 */
export const CONFIG_PADRAO: ConfigCalculo = {
  peca: { ladoAmm: 600, ladoBmm: 600, espessuraMm: 9, juntaMm: 3, m2PorCaixa: 1.44 },

  perdaPisoPct: 10,
  argamassaKgM2: 5,            // com remoção: AC-II, desempenadeira dente 8mm, simples colagem
  argamassaKgM2SemRemocao: 8,  // piso sobre piso: AC-III + dupla colagem (consumo maior)
  discoCorteRendimentoM2: 30,  // ~30 m²/disco (porcelanato)
  argamassaSacoKg: 20,
  rejunteDensidade: 1.6,   // kg/dm³ (NBR 14992)
  rejunteEmbalagemKg: 1,
  espacadoresPorPeca: 1,
  espacadorPacote: 100,
  niveladorClipsM2: 10,
  niveladorClipsPacote: 100,
  niveladorCunhasPacote: 100,

  produtividadeM2DiaEquipe: 12,
  diasRejuntamento: 1,
  diasCuraLiberacao: 2,

  bdiPct: 20,

  precoPisoM2: 45.0,
  precoArgamassaSaco: 32.0,
  precoRejunteEmbalagem: 18.0,
  precoEspacadorPacote: 8.0,
  precoNiveladorClipsPacote: 25.0,
  precoNiveladorCunhasPacote: 30.0,
  precoDiscoCorte: 15.0,
  maoObraM2: 40.0,
};
