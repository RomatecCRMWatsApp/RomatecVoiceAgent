// v3.27.0: motor de calculo de Demarcacao de Lotes (Urbana e Rural).
// v3.38.0: alinha a PROP-2026-0028-R1 (gold standard aprovado pelo CEO em 2026-05-28).
//   - Adicional de campo (insal/peric) incide APENAS sobre tecnicos_campo,
//     integrado a base ANTES da complexidade e da assessoria (CLT 192-193/NR-15/16).
//   - Laudo Tecnico de Demarcacao promovido a item DIRETO em honorarios
//     (fora da complexidade/assessoria/desconto). Default 1 SM.
//   - Locacao de Kit GNSS NOVO item direto (diaria editavel × qtd_diarias).
//   - Suporte a 2 parcelas (50/50 — sinal + entrega final) alem do 3x (40/30/30).
//   - Alinhamento de cerca: valor unitario default reduzido para R$ 0,42/m
//     (config) — auto-fill = perimetro_m no frontend.
//
// Espelha 1:1 o padrao da v3.23.5 (Georref Rural PROP-2026-0011-R1):
//   - TRT/CFT em linha propria (R$ 93,40 tabela CFT 2026)
//   - Tecnicos de campo: diarias * SM * fator_diaria_tecnico (CFT-MA Res. 12/2025)
//   - Marcos discriminados por tipo (valor congelado por linha)
//   - Deslocamento por km
//   - Area * valor unitario (m2 urbano OU hectare rural)
//   - Multiplicador de complexidade (simples 1.0 / media 1.3 / alta 1.6)
//   - Assessoria 5% sobre subtotal apos complexidade
//   - Desconto sobre (subtotal + assessoria)
//   - Minimo garantido 2 SM (sobre core, antes dos extras diretos)
//   - Opcionais NAO somam (secao informativa propria)
//
// Modulo standalone (zero deps de mysql/pdfkit/voyageai) — testavel sem arrastar
// integracoes. So importa round2 de georreferenciamento.ts (sem alterar logica
// daquele modulo, que esta na lista de PROIBIDO MODIFICAR).
//
// Base normativa:
//   - Lei 10.267/2001 (CNIR)
//   - NTGIR 3a Edicao (INCRA) — codificacao de marcos com credencial do tecnico
//   - Lei 6.766/79 (parcelamento de solo urbano) + Lei 5.868/72 (CNIR rural)
//   - Tabela CFT 2026 — Tec. em Agrimensura CFT/MA no 01209185369
//   - CLT (Decreto-Lei 5.452/43) art. 192 e 193 + NR-15/NR-16 do MTE

import type {
  InputDemarcacaoLotes,
  DemarcacaoLotesOutput,
  MaterialMarco,
  OpcionaisDemarcacao,
} from './types';
import { round2 } from './georreferenciamento';
import { getParams, salarioMinimo, anotacaoTecnica } from './params';
import { contarNuvemPontos } from '../geometria';

const COMPLEX_KEYS: Array<'simples' | 'media' | 'alta'> = ['simples', 'media', 'alta'];

export interface CalcularDemarcacaoLotesOpts {
  // Permite injetar SM customizado nos testes; default: lerSalarioMinimoVigenteRuntime()
  salarioMinimoOverride?: number;
}

export function calcularDemarcacaoLotes(
  input: InputDemarcacaoLotes,
  opts: CalcularDemarcacaoLotesOpts = {},
): DemarcacaoLotesOutput {
  const params = getParams();
  const cfg = params.demarcacao_lotes_2026;
  if (!cfg) throw new Error('Bloco demarcacao_lotes_2026 ausente em pricing-params.json');

  const SM = opts.salarioMinimoOverride ?? salarioMinimo();
  if (!Number.isFinite(SM) || SM <= 0) {
    throw new Error(`Salario minimo invalido: ${SM}`);
  }

  // ── Validacoes ─────────────────────────────────────────────────────────
  if (input.subtipo !== 'demarcacao_urbana' && input.subtipo !== 'demarcacao_rural') {
    throw new Error(`subtipo invalido: ${input.subtipo} (esperado: demarcacao_urbana | demarcacao_rural)`);
  }

  if (input.subtipo === 'demarcacao_urbana') {
    if (!Number.isFinite(input.area_m2 as number) || (input.area_m2 as number) <= 0) {
      throw new Error('subtipo=demarcacao_urbana exige area_m2 > 0');
    }
    if (input.area_hectares != null) {
      throw new Error('subtipo=demarcacao_urbana nao deve informar area_hectares');
    }
  } else {
    if (!Number.isFinite(input.area_hectares as number) || (input.area_hectares as number) <= 0) {
      throw new Error('subtipo=demarcacao_rural exige area_hectares > 0');
    }
    if (input.area_m2 != null) {
      throw new Error('subtipo=demarcacao_rural nao deve informar area_m2');
    }
  }

  if (!Number.isFinite(input.num_vertices) || input.num_vertices < 3) {
    throw new Error('num_vertices deve ser >= 3 (poligonal minima)');
  }

  if (!COMPLEX_KEYS.includes(input.complexidade)) {
    throw new Error(`complexidade invalida: ${input.complexidade} (esperado: simples | media | alta)`);
  }

  const desconto_pct = Number(input.desconto_pct ?? 0);
  if (!Number.isFinite(desconto_pct) || desconto_pct < 0 || desconto_pct > cfg.desconto_max_pct) {
    throw new Error(`desconto_pct invalido: ${desconto_pct} (esperado [0, ${cfg.desconto_max_pct}])`);
  }

  if (!Number.isFinite(input.diarias_equipe) || input.diarias_equipe < 1) {
    throw new Error('diarias_equipe deve ser >= 1');
  }
  if (!Number.isFinite(input.km_deslocamento) || input.km_deslocamento < 0) {
    throw new Error('km_deslocamento deve ser >= 0');
  }

  const marcos = Array.isArray(input.marcos) ? input.marcos : [];
  const somaMarcos = marcos.reduce((s, m) => s + (Number(m.quantidade) || 0), 0);

  if (input.servico_piqueteamento === true) {
    if (somaMarcos !== input.num_vertices) {
      throw new Error(
        `servico_piqueteamento=true exige Σ marcos.quantidade (${somaMarcos}) === num_vertices (${input.num_vertices})`,
      );
    }
  }
  // servico_piqueteamento=false: marcos pode estar vazio OU ter qualquer soma (sem restricao).

  // ── 1. TRT/CFT (tabela 2026) ──────────────────────────────────────────
  const at = anotacaoTecnica('trt_cft');
  const trt_cft = round2(at.valor);

  // ── 2. Tecnicos de campo ─────────────────────────────────────────────
  const tecnicos_campo = round2(input.diarias_equipe * SM * cfg.fator_diaria_tecnico);

  // ── 2-bis. Adicional de campo (insal/peric) — v3.38.0 ────────────────
  // Incide APENAS sobre tecnicos_campo, integrado a base ANTES da complexidade.
  // CLT art. 192 (insal 10/20/40) e 193 (peric 30) — valor obrigatorio.
  const adicional_pct = Number(input.adicional_campo_pct ?? 0);
  if (!Number.isFinite(adicional_pct) || adicional_pct < 0 || adicional_pct > 40) {
    throw new Error(`adicional_campo_pct invalido: ${adicional_pct} (esperado [0, 40])`);
  }
  const adicional_valor = round2((tecnicos_campo * adicional_pct) / 100);
  const adicional_campo = {
    aplicavel: adicional_pct > 0,
    pct: adicional_pct,
    valor: adicional_valor,
  };

  // ── 3. Marcos discriminados ──────────────────────────────────────────
  const marcosOrdem: MaterialMarco[] = ['concreto', 'tubo_galvanizado', 'madeira'];
  const marcos_discriminados: { tipo: MaterialMarco; qtd: number; subtotal: number }[] = [];
  let marcos_subtotal = 0;
  for (const tipo of marcosOrdem) {
    const itensTipo = marcos.filter((m) => m.tipo === tipo);
    const qtd = itensTipo.reduce((s, m) => s + (Number(m.quantidade) || 0), 0);
    const subtotal = round2(
      itensTipo.reduce(
        (s, m) => s + (Number(m.quantidade) || 0) * (Number(m.valor_unitario_congelado) || 0),
        0,
      ),
    );
    if (qtd > 0) {
      marcos_discriminados.push({ tipo, qtd, subtotal });
      marcos_subtotal = round2(marcos_subtotal + subtotal);
    }
  }

  // ── 4. Deslocamento ──────────────────────────────────────────────────
  const valor_km = cfg.valor_km_deslocamento;
  const deslocamento = round2(input.km_deslocamento * valor_km);

  // ── 5. Area * valor unitario ─────────────────────────────────────────
  let area_servico = 0;
  if (input.subtipo === 'demarcacao_urbana') {
    const vUnit = input.valor_unitario_area ?? cfg.valor_m2_urbano_default;
    area_servico = round2((input.area_m2 as number) * vUnit);
  } else {
    const vUnit = input.valor_unitario_area ?? cfg.valor_hectare_rural_default;
    area_servico = round2((input.area_hectares as number) * vUnit);
  }

  // ── 6. Subtotal bruto (com adicional integrado na base) ──────────────
  const subtotal_bruto = round2(trt_cft + tecnicos_campo + adicional_valor + marcos_subtotal + deslocamento + area_servico);

  // ── 7. Complexidade ──────────────────────────────────────────────────
  const complexidade_multiplicador = cfg.complexidade_multiplicadores[input.complexidade];
  const subtotal_apos_complexidade = round2(subtotal_bruto * complexidade_multiplicador);

  // ── 8. Assessoria ────────────────────────────────────────────────────
  const assessoria = round2(subtotal_apos_complexidade * cfg.assessoria_pct);

  // ── 9. Desconto ──────────────────────────────────────────────────────
  const base_desconto = round2(subtotal_apos_complexidade + assessoria);
  const desconto_valor = round2((base_desconto * desconto_pct) / 100);

  // ── 10. Core Romatec (sujeito a minimo garantido) ────────────────────
  let core = round2(base_desconto - desconto_valor);
  const minimo = round2(cfg.minimo_garantido_sm * SM);
  const aplicouMinimo = core < minimo;
  if (aplicouMinimo) {
    core = minimo;
  }

  // ── 11. Itens diretos (fora da complexidade/assessoria/desconto) ─────
  // v3.38.0 — laudo tecnico + locacao kit GNSS.
  // Retrocompat: se opcionais.laudo_tecnico.contratado=true (propostas antigas)
  // E input.laudo_tecnico_direto NAO foi passado, migra automaticamente.
  const opcionaisRaw = input.opcionais ?? {};
  const laudoDireto = (() => {
    const direto = input.laudo_tecnico_direto;
    const optLegacy = opcionaisRaw.laudo_tecnico;
    if (direto?.contratado) {
      const mult = direto.valor_unitario_sm_multiplicador
        ?? cfg.laudo_tecnico_direto?.valor_unitario_sm_multiplicador
        ?? 1.0;
      return { contratado: true, valor: round2(mult * SM) };
    }
    if (optLegacy?.contratado) {
      const mult = optLegacy.valor_unitario_sm_multiplicador
        ?? cfg.laudo_tecnico_direto?.valor_unitario_sm_multiplicador
        ?? 1.0;
      return { contratado: true, valor: round2(mult * SM) };
    }
    return { contratado: false, valor: 0 };
  })();

  // v3.40.0: Kit GNSS e' ITEM FIXO dos honorarios (nao opcional) — gold standard
  // PROP-2026-0028-R1. Default qtd=1 (1 diaria), diaria R$ 250,00. User pode
  // explicitamente passar qtd=0 pra desativar (edge case — projeto sem campo).
  const kitGnss = (() => {
    const kit = input.locacao_kit_gnss;
    const cfgKit = cfg.locacao_kit_gnss;
    const diariaDefault = cfgKit?.valor_unitario_diaria_default ?? 250.00;
    const descritivo = cfgKit?.descritivo ?? '';
    // qtd default = 1 (v3.40.0); antes era 0
    const qtd = Number(kit?.qtd_diarias ?? 1);
    if (!Number.isFinite(qtd) || qtd < 0) {
      throw new Error(`locacao_kit_gnss.qtd_diarias invalido: ${qtd} (esperado >= 0)`);
    }
    const diaria = Number(kit?.diaria ?? diariaDefault);
    if (!Number.isFinite(diaria) || diaria < 0) {
      throw new Error(`locacao_kit_gnss.diaria invalido: ${diaria} (esperado >= 0)`);
    }
    const contratado = qtd > 0;
    return {
      contratado,
      qtd_diarias: qtd,
      diaria: round2(diaria),
      valor: contratado ? round2(qtd * diaria) : 0,
      descritivo,
    };
  })();

  // v3.63.5: Alinhamento de cerca virou ITEM DIRETO (soma no total), não mais
  // opcional que não soma. Quando contratado: metros × R$/m entra nos honorarios.
  const alinhamentoCerca = (() => {
    const it = opcionaisRaw.alinhamento_cerca;
    const contratado = !!it?.contratado;
    const metros = Number(it?.metros ?? 0);
    const vUnit = Number(it?.valor_unitario ?? cfg.opcionais.alinhamento_cerca.valor_unitario);
    return {
      contratado,
      metros: contratado ? metros : 0,
      valor_unitario: vUnit,
      valor: contratado ? round2(metros * vUnit) : 0,
    };
  })();

  // v3.95.0: Levantamento Planialtimetrico — ITEM DIRETO (soma no total, fora de
  // complexidade/assessoria/desconto, igual ao alinhamento de cerca). Pontos =
  // ceil(perimetro/espacamento) + (malha interna: ceil(area/espacamento² × 0,7)).
  // Piso tecnico de mobilizacao quando o subtotal fica antieconomico.
  const planialtimetrico = (() => {
    const it = input.planialtimetrico;
    const cfgPl = cfg.planialtimetrico;
    const vazio = {
      contratado: false, espacamento_m: 0, pontos_perimetro: 0, pontos_interno: 0,
      total_pontos: 0, valor_ponto: 0, subtotal: 0, minimo_aplicado: false, valor: 0,
      fonte_contagem: 'nenhuma' as const, entrega_dxf: false, entrega_kml: false, entrega_perfis: false,
    };
    if (!it?.contratado || !cfgPl) return vazio;

    const espMin = Number(cfgPl.espacamento_min_m ?? 5);
    const espMax = Number(cfgPl.espacamento_max_m ?? 100);
    let esp = Number(it.espacamento_m ?? cfgPl.espacamento_default_m ?? 20);
    if (!Number.isFinite(esp) || esp < espMin) esp = espMin;
    if (esp > espMax) esp = espMax;

    // Contagem de pontos: A) motor de geometria sobre a poligonal (exato p/ forma
    // real do lote), com fallback B) area/perimetro quando nao ha croqui.
    const num = (v: unknown): number => {
      if (typeof v === 'number') return v;
      if (v == null) return NaN;
      return Number(String(v).trim().replace(',', '.'));
    };
    const pontosEN = (Array.isArray(input.pontos) ? input.pontos : [])
      .map((p) => ({ e: num(p.e ?? p.utmE ?? p.utm_e), n: num(p.n ?? p.utmN ?? p.utm_n) }))
      .filter((p) => Number.isFinite(p.e) && Number.isFinite(p.n));

    let pontosPerimetro = 0;
    let pontosInterno = 0;
    let fonteContagem: 'poligono' | 'aproximacao' | 'nenhuma' = 'nenhuma';

    const nuvem = pontosEN.length >= 3 ? contarNuvemPontos(pontosEN, esp) : null;
    if (nuvem) {
      pontosPerimetro = nuvem.perimetro;
      pontosInterno = nuvem.interno;
      fonteContagem = 'poligono';
    } else {
      // Fallback: deriva dos outputs de geometria ja calculados (area + perimetro).
      const perim = Number(input.perimetro_m ?? 0);
      const areaM2 = input.subtipo === 'demarcacao_urbana'
        ? Number(input.area_m2 ?? 0)
        : Number(input.area_hectares ?? 0) * 10000; // ha → m²
      pontosPerimetro = perim > 0 ? Math.ceil(perim / esp) : 0;
      pontosInterno = areaM2 > 0
        ? Math.ceil((areaM2 / (esp * esp)) * Number(cfgPl.fator_malha_interna ?? 0.7))
        : 0;
      if (pontosPerimetro > 0 || pontosInterno > 0) fonteContagem = 'aproximacao';
    }
    const totalPontos = pontosPerimetro + pontosInterno;

    const valorPontoDefault = input.subtipo === 'demarcacao_urbana'
      ? cfgPl.valor_ponto_urbano : cfgPl.valor_ponto_rural;
    const valorPonto = Number(it.valor_ponto ?? valorPontoDefault);

    const subtotal = round2(totalPontos * valorPonto);
    const piso = Number(cfgPl.minimo_tecnico ?? 0);
    const minimoAplicado = totalPontos > 0 && subtotal < piso;
    const valor = totalPontos > 0 ? round2(Math.max(subtotal, piso)) : 0;

    return {
      contratado: true,
      espacamento_m: esp,
      pontos_perimetro: pontosPerimetro,
      pontos_interno: pontosInterno,
      total_pontos: totalPontos,
      valor_ponto: round2(valorPonto),
      subtotal,
      minimo_aplicado: minimoAplicado,
      valor,
      fonte_contagem: totalPontos > 0 ? fonteContagem : 'nenhuma',
      entrega_dxf: it.entrega_dxf !== false,
      entrega_kml: it.entrega_kml !== false,
      entrega_perfis: it.entrega_perfis !== false,
    };
  })();

  // ── 12. Total = core + extras diretos ────────────────────────────────
  const extrasDiretos = round2(laudoDireto.valor + kitGnss.valor + alinhamentoCerca.valor + planialtimetrico.valor);
  const total = round2(core + extrasDiretos);

  // Guard de fechamento
  const guardSubBruto = round2(trt_cft + tecnicos_campo + adicional_valor + marcos_subtotal + deslocamento + area_servico);
  const guardApos = round2(guardSubBruto * complexidade_multiplicador);
  const guardComAssess = round2(guardApos + assessoria);
  const guardCore = aplicouMinimo ? minimo : round2(guardComAssess - desconto_valor);
  const guardTotal = round2(guardCore + extrasDiretos);
  if (round2(total) !== round2(guardTotal)) {
    throw new Error(`Guard fechamento: esperado ${guardTotal}, obtido ${total}`);
  }

  // ── Opcionais (4 linhas — laudo foi promovido a direto) ──────────────
  // v3.40.0: passa perimetro_m pra gerar a regra de calculo do alinhamento.
  const linhasOpcionais = montarLinhasOpcionais(opcionaisRaw, cfg.opcionais, Number(input.perimetro_m ?? 0));
  const subtotalOpcionais = round2(
    linhasOpcionais
      .filter((l) => l.contratado && typeof l.valor === 'number')
      .reduce((s, l) => s + (l.valor as number), 0),
  );

  // ── Parcelas (3x default ou 2x se input.num_parcelas === 2) ──────────
  const numParcelas = input.num_parcelas === 2 ? 2 : 3;
  const parcelasCfg = numParcelas === 2
    ? (cfg.parcelas_2x ?? [
        { numero: 1, rotulo: 'Assinatura do contrato (sinal)', percentual: 50 },
        { numero: 2, rotulo: 'Entrega final + TRT/CFT',        percentual: 50 },
      ])
    : cfg.parcelas;
  const parcelasOut: { numero: 1 | 2 | 3; rotulo: string; valor: number; percentual: number }[] = parcelasCfg.map(
    (p, i, arr) => {
      const numero = (i + 1) as 1 | 2 | 3;
      // Ultima parcela absorve o residuo de arredondamento pra fechar com total.
      let valor: number;
      if (i === arr.length - 1) {
        const somaAnteriores = arr.slice(0, -1).reduce((s, x) => s + round2((total * x.percentual) / 100), 0);
        valor = round2(total - somaAnteriores);
      } else {
        valor = round2((total * p.percentual) / 100);
      }
      return { numero, rotulo: p.rotulo, valor, percentual: p.percentual };
    },
  );

  // Guard parcelas
  const somaParcelas = round2(parcelasOut.reduce((s, p) => s + p.valor, 0));
  if (Math.abs(somaParcelas - total) > 0.01) {
    throw new Error(`Erro fechamento parcelas: soma=${somaParcelas} total=${total}`);
  }

  return {
    honorarios_romatec: {
      trt_cft,
      tecnicos_campo,
      adicional_campo,
      marcos_discriminados,
      marcos_subtotal,
      deslocamento,
      area_servico,
      complexidade_multiplicador,
      subtotal_apos_complexidade,
      assessoria,
      desconto_valor,
      laudo_tecnico_direto: laudoDireto,
      locacao_kit_gnss: kitGnss,
      alinhamento_cerca: alinhamentoCerca,
      planialtimetrico,
      total,
    },
    secao_opcionais_demarcacao: {
      linhas: linhasOpcionais,
      subtotal: subtotalOpcionais,
    },
    parcelas: parcelasOut,
    validade_dias: Number(input.validade_dias) > 0 ? Number(input.validade_dias) : cfg.validade_dias_default,
    salario_minimo_usado: SM,
  };
}

function montarLinhasOpcionais(
  opcionais: OpcionaisDemarcacao,
  cfgOpc: NonNullable<ReturnType<typeof getParams>['demarcacao_lotes_2026']>['opcionais'],
  _perimetroM: number,
): { rotulo: string; valor: number | 'sob_orcamento'; contratado: boolean; detalhe?: string; metros?: number; valor_unitario?: number }[] {
  // v3.38.0: 4 linhas SEMPRE renderizadas (laudo_tecnico foi promovido a item direto).
  // v3.40.0: linhas ganham campo `detalhe` opcional — regra de calculo visivel no PDF.
  // v3.42.0: linhas ganham metros/valor_unitario opcionais — PDF recomputa se valor=0.
  const linhas: { rotulo: string; valor: number | 'sob_orcamento'; contratado: boolean; detalhe?: string; metros?: number; valor_unitario?: number }[] = [];

  // v3.63.5: Alinhamento de cerca SAIU dos opcionais — agora é item DIRETO que
  // soma no total (ver honorarios_romatec.alinhamento_cerca). Não listar aqui.
  // 2. Croqui assinado
  {
    const it = opcionais.croqui_assinado;
    const contratado = !!it?.contratado;
    const vUnit = Number(it?.valor_unitario ?? cfgOpc.croqui_assinado.valor_unitario);
    linhas.push({
      rotulo: cfgOpc.croqui_assinado.rotulo,
      contratado,
      valor: contratado ? round2(vUnit) : 0,
    });
  }
  // 3. Acompanhamento de obra
  {
    const it = opcionais.acompanhamento_obra;
    const contratado = !!it?.contratado;
    const diarias = Number(it?.diarias ?? 0);
    const vUnit = Number(it?.valor_unitario ?? cfgOpc.acompanhamento_obra.valor_unitario);
    linhas.push({
      rotulo: cfgOpc.acompanhamento_obra.rotulo,
      contratado,
      valor: contratado ? round2(diarias * vUnit) : 0,
    });
  }
  // 4. Consultoria juridica (literal 'sob_orcamento' — NUNCA numero)
  {
    const it = opcionais.consultoria_juridica;
    const contratado = !!it?.contratado;
    linhas.push({
      rotulo: cfgOpc.consultoria_juridica.rotulo,
      contratado,
      valor: 'sob_orcamento',
    });
  }

  return linhas;
}
