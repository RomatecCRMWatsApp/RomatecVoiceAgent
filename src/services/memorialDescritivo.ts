// v2.10.0 — Gerador de Memorial Descritivo padrão técnico.
// Substitui a função interna gerarMemorialNTGIR de laudoPdf.ts (mais simples).
// Esta versão é mais completa: cabeçalho com info do imóvel + descrição
// vértice-a-vértice com confrontante por lado + resumo final com área/perímetro.
//
// Reutilizada por:
//   - PDF do laudo (laudoPdf.ts)
//   - Endpoint REST (server.ts) → painel lateral no client

import { azimuteParaDMS } from './geometria';
import type { Laudo, PontoLaudo, LadoLaudo } from '../integrations/laudos';
import type { Contratante } from '../integrations/contratantes';

function fmtNum(n: number, decimais = 3): string {
  // Formato BR: ponto como milhar, vírgula como decimal.
  // Ex: 9449891.6805 → "9.449.891,681"
  const fixo = n.toFixed(decimais);
  const [int, dec] = fixo.split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec ? `${intFmt},${dec}` : intFmt;
}

function fmtArea(m2: number): string {
  if (m2 >= 10000) {
    const ha = m2 / 10000;
    return `${fmtNum(m2, 2)} m² (${fmtNum(ha, 4)} ha)`;
  }
  return `${fmtNum(m2, 2)} m²`;
}

export interface MemorialInput {
  laudo: Laudo;
  pontos: PontoLaudo[];
  lados: LadoLaudo[];
  contratante?: Contratante | null;
}

export interface MemorialOutput {
  /** Cabeçalho (proprietário, imóvel, município, área, perímetro, CRS) */
  cabecalho: string;
  /** Texto narrativo da poligonal (parágrafo) */
  descricao: string;
  /** Resumo final (área e perímetro) */
  resumo: string;
  /** Texto completo concatenado (cabeçalho + descrição + resumo) */
  texto: string;
}

/**
 * Gera memorial descritivo no formato padrão técnico brasileiro.
 *
 * Estrutura:
 *   ===== MEMORIAL DESCRITIVO =====
 *   Proprietário: ...
 *   Imóvel: ...
 *   Município/UF: .../... — Comarca: ...
 *   Área: NNN m² (N,NNNN ha)
 *   Perímetro: NNN,NN m
 *   Sistema Geodésico: SIRGAS 2000 — Projeção: UTM Zona 23 Sul
 *
 *   DESCRIÇÃO DA POLIGONAL:
 *   Inicia-se a descrição deste perímetro no vértice P1, definido pelas
 *   coordenadas N=9.449.891,681 e E=225.372,375; deste segue com azimute de
 *   124°05'41" e distância de 191,57 m, confrontando com [conf] neste trecho,
 *   até atingir o vértice P2, definido pelas coordenadas N=...; ... [repete]
 *   ...; deste segue com azimute de XX°XX'XX" e distância de XX,XX m,
 *   confrontando com [conf] neste trecho, fechando o perímetro no vértice P1
 *   (ponto inicial), totalizando uma área de NNN m² (N,NNNN hectares).
 */
export function gerarMemorialDescritivo(input: MemorialInput): MemorialOutput {
  const { laudo, pontos, lados, contratante } = input;

  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  const linhasCab: string[] = ['MEMORIAL DESCRITIVO', ''];
  if (contratante?.nome) {
    linhasCab.push(`Proprietário: ${contratante.nome}`);
  }
  // Identificação do imóvel
  const partesImovel: string[] = [];
  if (laudo.tipo_imovel === 'URBANO') {
    if (laudo.loteamento) partesImovel.push(`Loteamento ${laudo.loteamento}`);
    if (laudo.quadra) partesImovel.push(`Quadra ${laudo.quadra}`);
    if (laudo.numero_lote) partesImovel.push(`Lote ${laudo.numero_lote}`);
  } else {
    if (laudo.denominacao_imovel) partesImovel.push(laudo.denominacao_imovel);
    if (laudo.nirf) partesImovel.push(`NIRF ${laudo.nirf}`);
    if (laudo.ccir) partesImovel.push(`CCIR ${laudo.ccir}`);
  }
  if (partesImovel.length) linhasCab.push(`Imóvel: ${partesImovel.join(' · ')}`);
  if (laudo.endereco_imovel) linhasCab.push(`Endereço: ${laudo.endereco_imovel}`);
  if (laudo.municipio || laudo.uf_imovel) {
    const munUf = `${laudo.municipio || '—'}/${laudo.uf_imovel || '—'}`;
    const comarca = laudo.comarca || laudo.municipio || '—';
    linhasCab.push(`Município/UF: ${munUf} — Comarca: ${comarca}`);
  }
  // Dados registrais (cartório) se preenchidos
  const partesReg: string[] = [];
  if (laudo.matricula) partesReg.push(`Matrícula ${laudo.matricula}`);
  if (laudo.livro) partesReg.push(`Livro ${laudo.livro}`);
  if (laudo.folhas) partesReg.push(`Fls. ${laudo.folhas}`);
  if (partesReg.length) linhasCab.push(`Registro: ${partesReg.join(' · ')}`);
  if (laudo.cartorio_nome) {
    linhasCab.push(`Cartório: ${laudo.cartorio_nome}${laudo.cartorio_cns ? ` (CNS ${laudo.cartorio_cns})` : ''}`);
  }
  // Métricas
  if (laudo.area_total_m2 != null) linhasCab.push(`Área: ${fmtArea(laudo.area_total_m2)}`);
  if (laudo.perimetro_m != null) linhasCab.push(`Perímetro: ${fmtNum(laudo.perimetro_m, 2)} m`);
  // CRS
  const utmZona = pontos.find(p => p.utm_zona)?.utm_zona;
  const utmHem = pontos.find(p => p.utm_hemisferio)?.utm_hemisferio;
  if (utmZona && utmHem) {
    const hemTexto = utmHem === 'S' ? 'Sul' : 'Norte';
    linhasCab.push(`Sistema Geodésico de Referência: SIRGAS 2000 — Projeção: UTM Zona ${utmZona} ${hemTexto}`);
  }

  const cabecalho = linhasCab.join('\n');

  // ── Descrição narrativa ────────────────────────────────────────────────────
  let descricao = '';
  if (pontos.length < 3 || lados.length === 0) {
    descricao =
      'DESCRIÇÃO DA POLIGONAL:\n\n' +
      '(Memorial descritivo não disponível — adicione pelo menos 3 vértices e' +
      ' calcule os lados para gerar a descrição automática.)';
  } else {
    const pontosOrd = [...pontos].sort((a, b) => a.ordem - b.ordem);
    const ladosOrd = [...lados].sort((a, b) => a.ordem - b.ordem);
    const pontosById = new Map(pontosOrd.map(p => [p.id, p]));
    const v0 = pontosOrd[0];

    const coordTxt = (p: PontoLaudo): string => {
      if (p.utm_n != null && p.utm_e != null) {
        return `coordenadas N=${fmtNum(p.utm_n)} m e E=${fmtNum(p.utm_e)} m`;
      }
      if (p.lat_decimal != null && p.long_decimal != null) {
        return `coordenadas geográficas Lat=${p.lat_decimal.toFixed(6)} Lng=${p.long_decimal.toFixed(6)}`;
      }
      return 'coordenadas (sem dados)';
    };

    let txt = `DESCRIÇÃO DA POLIGONAL:\n\nInicia-se a descrição deste perímetro no vértice ${v0.rotulo || 'P1'}, definido pelas ${coordTxt(v0)}; `;

    for (let i = 0; i < ladosOrd.length; i++) {
      const lado = ladosOrd[i];
      const verticeFim = pontosById.get(lado.ponto_fim_id);
      if (!verticeFim) continue;
      const az = lado.azimute != null ? azimuteParaDMS(lado.azimute) : '—';
      const distNum = lado.medida_manual_m != null ? lado.medida_manual_m : lado.distancia_m;
      const dist = distNum != null ? `${fmtNum(distNum, 2)} m` : '— m';
      const conf = lado.confrontante_nome
        ? `confrontando com ${lado.confrontante_nome} neste trecho, `
        : '';

      const ehUltimo = i === ladosOrd.length - 1;
      if (ehUltimo) {
        txt += `deste segue com azimute de ${az} e distância de ${dist}, ${conf}fechando o perímetro no vértice ${v0.rotulo || 'P1'} (ponto inicial), totalizando uma área de ${laudo.area_total_m2 != null ? fmtArea(laudo.area_total_m2) : '— m²'}.`;
      } else {
        txt += `deste segue com azimute de ${az} e distância de ${dist}, ${conf}até atingir o vértice ${verticeFim.rotulo || `P${i + 2}`}, definido pelas ${coordTxt(verticeFim)}; `;
      }
    }
    descricao = txt;
  }

  // ── Resumo ──────────────────────────────────────────────────────────────────
  const linhasResumo: string[] = [];
  if (laudo.area_total_m2 != null && laudo.perimetro_m != null) {
    linhasResumo.push(
      `Totalizando área de ${fmtArea(laudo.area_total_m2)} e perímetro de ${fmtNum(laudo.perimetro_m, 2)} m, conforme calculado a partir dos vértices acima descritos.`
    );
  }
  const resumo = linhasResumo.join('\n');

  return {
    cabecalho,
    descricao,
    resumo,
    texto: [cabecalho, '', descricao, resumo].filter(Boolean).join('\n\n'),
  };
}
