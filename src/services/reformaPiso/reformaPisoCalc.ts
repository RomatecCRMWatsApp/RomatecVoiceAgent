// src/services/reformaPiso/reformaPisoCalc.ts
// v3.67.0: Motor de cálculo puro (sem I/O) — 100% testável via Vitest.

import {
  Ambiente,
  AmbienteCalculado,
  ConfigCalculo,
  CONFIG_PADRAO,
  ItemInsumo,
  ResultadoCalculo,
} from './reformaPisoTypes';

const arred = (n: number, casas = 2): number => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Mescla config recebida com o padrão (deep nos campos de peça). */
export function mesclarConfig(parcial?: Partial<ConfigCalculo>): ConfigCalculo {
  if (!parcial) return { ...CONFIG_PADRAO, peca: { ...CONFIG_PADRAO.peca } };
  return {
    ...CONFIG_PADRAO,
    ...parcial,
    peca: { ...CONFIG_PADRAO.peca, ...(parcial.peca ?? {}) },
  };
}

/**
 * Consumo de rejunte (kg/m²) — fórmula consagrada de fabricante,
 * coerente com a ABNT NBR 14992:
 *   C = ((A + B) / (A * B)) * J * E * d
 * A,B = lados da peça (mm); J = junta (mm); E = espessura da placa (mm);
 * d = densidade aparente do rejunte (kg/dm³).
 */
export function consumoRejunteKgM2(
  ladoAmm: number,
  ladoBmm: number,
  juntaMm: number,
  espessuraMm: number,
  densidade: number,
): number {
  if (ladoAmm <= 0 || ladoBmm <= 0) {
    throw new Error('Dimensões da peça devem ser positivas.');
  }
  return ((ladoAmm + ladoBmm) / (ladoAmm * ladoBmm)) * juntaMm * espessuraMm * densidade;
}

export function calcular(
  ambientes: Ambiente[],
  cfgParcial?: Partial<ConfigCalculo>,
  comRemocao = false,
): ResultadoCalculo {
  if (!Array.isArray(ambientes) || ambientes.length === 0) {
    throw new Error('Informe ao menos um ambiente.');
  }
  const cfg = mesclarConfig(cfgParcial);
  // v3.70.0: piso sobre piso (sem remoção) exige AC-III + dupla colagem (consumo maior);
  // com remoção assenta sobre contrapiso absorvente → AC-II no consumo padrão.
  const semRemocao = !comRemocao;

  // 1) Áreas
  const ambientesCalc: AmbienteCalculado[] = ambientes.map((a) => {
    if (a.comprimentoM <= 0 || a.larguraM <= 0) {
      throw new Error(`Ambiente "${a.descricao}" com dimensão inválida.`);
    }
    return { ...a, areaM2: arred(a.comprimentoM * a.larguraM, 4) };
  });
  const areaTotalM2 = arred(ambientesCalc.reduce((s, a) => s + a.areaM2, 0), 4);
  const areaComPerdaM2 = arred(areaTotalM2 * (1 + cfg.perdaPisoPct / 100), 4);

  // 2) Quantitativos de material
  const { peca } = cfg;

  // Piso (caixas) — dimensionado sobre a área COM perda
  const caixas = Math.ceil(areaComPerdaM2 / peca.m2PorCaixa);
  const pisoM2Comprado = arred(caixas * peca.m2PorCaixa, 4);

  // Argamassa colante (AC) — classe e consumo dependem de haver remoção do piso.
  const argamassaKgM2Aplic = semRemocao ? cfg.argamassaKgM2SemRemocao : cfg.argamassaKgM2;
  const argamassaClasse = semRemocao ? 'AC-III' : 'AC-II';
  const argamassaObs = semRemocao
    ? `Piso sobre piso: ${argamassaClasse} + dupla colagem, consumo ${argamassaKgM2Aplic} kg/m² — NBR 14081 (saco ${cfg.argamassaSacoKg} kg)`
    : `${argamassaClasse}, consumo ${argamassaKgM2Aplic} kg/m² — NBR 14081 (saco ${cfg.argamassaSacoKg} kg)`;
  const argamassaKg = arred(areaTotalM2 * argamassaKgM2Aplic, 2);
  const sacosArgamassa = Math.ceil(argamassaKg / cfg.argamassaSacoKg);

  // Disco de corte diamantado — porcelanato desgasta o disco.
  const discosCorte = Math.max(1, Math.ceil(areaTotalM2 / cfg.discoCorteRendimentoM2));

  // Rejunte
  const rejunteKgM2 = consumoRejunteKgM2(
    peca.ladoAmm, peca.ladoBmm, peca.juntaMm, peca.espessuraMm, cfg.rejunteDensidade,
  );
  const rejunteKg = arred(areaTotalM2 * rejunteKgM2, 2);
  const embalagensRejunte = Math.ceil(rejunteKg / cfg.rejunteEmbalagemKg);

  // Peças, espaçadores e sistema nivelador ("travadores")
  const areaPecaM2 = (peca.ladoAmm / 1000) * (peca.ladoBmm / 1000);
  const pecasTotal = Math.ceil(areaTotalM2 / areaPecaM2);
  const espacadores = Math.ceil(pecasTotal * cfg.espacadoresPorPeca);
  const pacotesEspacador = Math.ceil(espacadores / cfg.espacadorPacote);

  const clipsNivelador = Math.ceil(areaTotalM2 * cfg.niveladorClipsM2);
  const pacotesClips = Math.ceil(clipsNivelador / cfg.niveladorClipsPacote);
  const pacotesCunhas = Math.max(1, Math.ceil(clipsNivelador / cfg.niveladorCunhasPacote));

  const novoItem = (
    item: string, unidade: string, quantidade: number, precoUnit: number, obs?: string,
  ): ItemInsumo => ({
    item, unidade, quantidade, precoUnit,
    total: arred(quantidade * precoUnit, 2), obs,
  });

  const insumos: ItemInsumo[] = [
    novoItem('Piso (porcelanato/cerâmica)', 'm²', pisoM2Comprado, cfg.precoPisoM2,
      `${caixas} cx de ${peca.m2PorCaixa} m² — perda ${cfg.perdaPisoPct}% (NBR 13753)`),
    novoItem(`Argamassa colante ${argamassaClasse}`, 'saco', sacosArgamassa, cfg.precoArgamassaSaco, argamassaObs),
    novoItem('Disco de corte diamantado', 'un', discosCorte, cfg.precoDiscoCorte,
      `1 disco p/ ~${cfg.discoCorteRendimentoM2} m² (porcelanato)`),
    novoItem('Rejunte', 'emb.', embalagensRejunte, cfg.precoRejunteEmbalagem,
      `Consumo ${arred(rejunteKgM2, 3)} kg/m² — NBR 14992 (junta ${peca.juntaMm} mm)`),
    novoItem('Espaçadores (cruzeta)', 'pacote', pacotesEspacador, cfg.precoEspacadorPacote,
      `${espacadores} un. p/ ${pecasTotal} peças`),
    novoItem('Nivelador — clips', 'pacote', pacotesClips, cfg.precoNiveladorClipsPacote,
      `${clipsNivelador} clips (${cfg.niveladorClipsM2}/m²)`),
    novoItem('Nivelador — cunhas (reutilizável)', 'pacote', pacotesCunhas, cfg.precoNiveladorCunhasPacote),
  ];

  const valorMateriais = arred(insumos.reduce((s, i) => s + i.total, 0), 2);

  // 3) Mão de obra (sobre área real)
  const valorMaoObra = arred(areaTotalM2 * cfg.maoObraM2, 2);

  // 4) Subtotal + BDI
  const subtotal = arred(valorMateriais + valorMaoObra, 2);
  const valorBdi = arred(subtotal * (cfg.bdiPct / 100), 2);
  const valorFinal = arred(subtotal + valorBdi, 2);
  const valorM2Final = areaTotalM2 > 0 ? arred(valorFinal / areaTotalM2, 2) : 0;

  // 5) Prazo
  const assentamento = Math.ceil(areaTotalM2 / cfg.produtividadeM2DiaEquipe);
  const prazoDiasUteis = assentamento + cfg.diasRejuntamento + cfg.diasCuraLiberacao;

  return {
    ambientes: ambientesCalc,
    areaTotalM2,
    areaComPerdaM2,
    insumos,
    valorMateriais,
    maoObraM2: cfg.maoObraM2,
    valorMaoObra,
    subtotal,
    bdiPct: cfg.bdiPct,
    valorBdi,
    valorFinal,
    valorM2Final,
    prazoDiasUteis,
    prazoDetalhe: {
      assentamento,
      rejuntamento: cfg.diasRejuntamento,
      curaLiberacao: cfg.diasCuraLiberacao,
    },
  };
}
