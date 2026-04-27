// APIs públicas gratuitas pra ZAYRA dar respostas técnicas com base real —
// avaliação imobiliária, georreferenciamento, projetos, registro/loteamento.
// v1.24.0

import axios from 'axios';

/* ── ViaCEP ─────────────────────────────────────────────────────────── */
export async function viaCepBuscar(cep: string) {
  const clean = String(cep).replace(/\D/g, '');
  if (clean.length !== 8) throw new Error('CEP inválido (precisa de 8 dígitos).');
  const { data } = await axios.get(`https://viacep.com.br/ws/${clean}/json/`, { timeout: 8000 });
  if (data.erro) throw new Error('CEP não encontrado.');
  return data;
}

/* ── Banco Central — séries SGS (IPCA, INCC, IGP-M, Selic, CUB) ─────── */
const BCB_CODIGOS: Record<string, number> = {
  ipca:  433,
  incc:  192,
  igpm:  189,
  selic: 4189,
  cub:   21340,
};

export async function bcbIndice(indice: string, meses = 12) {
  const codigo = BCB_CODIGOS[indice.toLowerCase()];
  if (!codigo) {
    throw new Error(`Índice '${indice}' não suportado. Use: ${Object.keys(BCB_CODIGOS).join(', ')}`);
  }
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados/ultimos/${meses}?formato=json`;
  const { data } = await axios.get(url, { timeout: 10000 });
  return data;
}

/* ── IBGE — municípios ──────────────────────────────────────────────── */
let _municipiosCache: any[] | null = null;
export async function ibgeMunicipio(nome: string) {
  if (!_municipiosCache) {
    const { data } = await axios.get(
      'https://servicodados.ibge.gov.br/api/v1/localidades/municipios',
      { timeout: 15000 },
    );
    _municipiosCache = data;
  }
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return _municipiosCache!.filter(m => norm(m.nome).includes(norm(nome))).slice(0, 10);
}

/* ── OpenStreetMap Nominatim (geocodificação) ───────────────────────── */
export async function geocodificar(endereco: string) {
  const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { q: endereco, format: 'json', limit: 1, countrycodes: 'br' },
    headers: { 'User-Agent': 'ZAYRA-Romatec/1.24 (romateccrm@gmail.com)' },
    timeout: 10000,
  });
  return data[0] || null;
}

/* ── Norma técnica via DuckDuckGo Instant Answer ────────────────────── */
export async function normaBuscar(termo: string) {
  const { data } = await axios.get('https://api.duckduckgo.com/', {
    params: {
      q:              `${termo} norma técnica brasileira ABNT`,
      format:         'json',
      no_html:        1,
      skip_disambig:  1,
    },
    timeout: 10000,
  });
  return {
    resumo:       data.AbstractText || null,
    fonte:        data.AbstractURL  || null,
    relacionados: (data.RelatedTopics || [])
      .slice(0, 5)
      .map((t: any) => ({ texto: t.Text, url: t.FirstURL }))
      .filter((t: any) => t.texto),
  };
}

/* ── SIGEF / INCRA (link público) ───────────────────────────────────── */
export function sigefConsultaUrl(codigoCertificado?: string) {
  if (codigoCertificado) {
    return `https://sigef.incra.gov.br/geo/parcela/detalhe/${codigoCertificado}/`;
  }
  return 'https://sigef.incra.gov.br/';
}

/* ── CAR / SICAR (link público) ─────────────────────────────────────── */
export function sicarConsultaUrl() {
  return 'https://consultapublica.car.gov.br/publico/imoveis/index';
}
