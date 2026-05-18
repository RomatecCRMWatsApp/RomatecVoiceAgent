// Orquestracao de processamento GNSS: classificacoes de papel por extensao,
// validacoes pre-submissao IBGE, helpers reusados pelas rotas. As funcoes
// pesadas (parse RINEX, parse retorno IBGE, conversao UTM) ficam nos modulos
// dedicados — aqui ha apenas a logica de alto nivel.

import type { GnssArquivoPapel } from '../../integrations/gnss';
import { parseRinexHeader } from './rinexHeaderParser';
import { parseIbgeResultTxt } from './ibgeResultParser';
import { parseKmlPoint } from './kmlParser';
import { parseIbgePos } from './posParser';
import { latLonToUtm, utmToLatLon, isWithinBrazil, zonaUtmDe } from './coordTransform';

const DURACAO_MINIMA_S = 300;     // < 5 min: bloqueia
const DURACAO_RECOMENDADA_S = 1200; // < 20 min: warning forte

export function classificarPapelRinex(nome: string): GnssArquivoPapel {
  const n = nome.toLowerCase();
  if (n.endsWith('.rnx')) return 'rinex_rnx3';
  const m = n.match(/\.(\d{2})([ongl])$/);
  if (!m) return 'outro';
  switch (m[2]) {
    case 'o': return 'rinex_obs';
    case 'n': return 'rinex_nav_gps';
    case 'g': return 'rinex_nav_glo';
    case 'l': return 'rinex_nav_gal';
    default: return 'outro';
  }
}

export function classificarPapelRetornoIbge(nome: string): GnssArquivoPapel | null {
  const n = nome.toLowerCase();
  if (n.endsWith('.txt')) return 'ibge_txt';
  if (n.endsWith('.pdf')) return 'ibge_pdf';
  if (n.endsWith('.kml')) return 'ibge_kml';
  if (n.endsWith('.pos')) return 'ibge_pos';
  return null;
}

export interface ValidacaoRinex {
  ok: boolean;
  bloqueia: boolean;
  warnings: string[];
  mensagens: string[];
}

export function validarRinexParaSubmissao(opts: {
  durationSeconds: number | null;
  systems: string[];
  antennaHeightM: number | null;
  papeisCarregados?: GnssArquivoPapel[];
}): ValidacaoRinex {
  const warnings: string[] = [];
  const mensagens: string[] = [];
  let bloqueia = false;

  if (opts.durationSeconds == null) {
    mensagens.push('Nao foi possivel calcular a duracao do rastreio (TIME OF FIRST/LAST OBS ausentes).');
    bloqueia = true;
  } else if (opts.durationSeconds < DURACAO_MINIMA_S) {
    mensagens.push(`Duracao do rastreio (${opts.durationSeconds}s) abaixo do minimo absoluto (${DURACAO_MINIMA_S}s).`);
    bloqueia = true;
  } else if (opts.durationSeconds < DURACAO_RECOMENDADA_S) {
    warnings.push(`Duracao do rastreio (${Math.round(opts.durationSeconds/60)}min) abaixo do recomendado (20min). PPP pode ficar instavel.`);
  }

  if (opts.antennaHeightM == null) {
    warnings.push('Altura da antena ausente no cabecalho — preencha manualmente.');
  } else if (opts.antennaHeightM < 0 || opts.antennaHeightM > 5) {
    warnings.push(`Altura da antena (${opts.antennaHeightM}m) suspeita — confira.`);
  }

  if (opts.papeisCarregados && !opts.papeisCarregados.includes('rinex_nav_gps') &&
      !opts.papeisCarregados.includes('rinex_rnx3')) {
    warnings.push('Faltando arquivo de navegacao GPS (.YYn) — IBGE-PPP funciona sem, mas com ele a solucao melhora.');
  }

  return { ok: !bloqueia, bloqueia, warnings, mensagens };
}

export { parseRinexHeader, parseIbgeResultTxt, parseKmlPoint, parseIbgePos };
export { latLonToUtm, utmToLatLon, isWithinBrazil, zonaUtmDe };
