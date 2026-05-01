// v1.52.0 — Consulta processos judiciais via API Pública do DataJud (CNJ).
//
// Fonte oficial: https://datajud-wiki.cnj.jus.br/api-publica/
// A chave pública é DIVULGADA pelo CNJ — não é segredo, é aberta a qualquer um.
// Cada tribunal tem seu próprio índice Elasticsearch (api_publica_<tribunal>).
//
// Limitações:
// - Atualização: dados do dia D ficam disponíveis em D+1 (CNJ consolida 1×/dia)
// - Sem texto integral: retorna metadados (classe, partes, movimentos), não o PDF
// - Pra ver inteiro teor → precisa logar no e-SAJ/PJe do tribunal específico
//
// Casos de uso típicos da Romatec:
// - "tem ação de despejo no número X?"
// - "achei matrícula com penhora — vê esse processo"
// - "como tá o processo de adjudicação compulsória que entrei?"

import axios from 'axios';

const DATAJUD_BASE = 'https://api-publica.datajud.cnj.jus.br';
// Chave pública oficial do CNJ — copy-paste do wiki público (datajud-wiki.cnj.jus.br)
const DATAJUD_PUBLIC_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6QU1lY0FtZ09SZi1fZGZ3WkN1VHRwQQ==';

// Mapeamento sigla → índice ES. Lista completa em datajud-wiki.cnj.jus.br
// (>90 tribunais cobertos — TJ estaduais, TRT, TRF, STJ, TST, TSE).
const TRIBUNAIS: Record<string, { sigla: string; nome: string; indice: string }> = {
  // Tribunais de Justiça estaduais
  'tjma': { sigla: 'TJMA', nome: 'TJ Maranhão',   indice: 'api_publica_tjma' },
  'tjce': { sigla: 'TJCE', nome: 'TJ Ceará',      indice: 'api_publica_tjce' },
  'tjpi': { sigla: 'TJPI', nome: 'TJ Piauí',      indice: 'api_publica_tjpi' },
  'tjpa': { sigla: 'TJPA', nome: 'TJ Pará',       indice: 'api_publica_tjpa' },
  'tjto': { sigla: 'TJTO', nome: 'TJ Tocantins',  indice: 'api_publica_tjto' },
  'tjsp': { sigla: 'TJSP', nome: 'TJ São Paulo',  indice: 'api_publica_tjsp' },
  'tjrj': { sigla: 'TJRJ', nome: 'TJ Rio',        indice: 'api_publica_tjrj' },
  'tjmg': { sigla: 'TJMG', nome: 'TJ Minas',      indice: 'api_publica_tjmg' },
  'tjba': { sigla: 'TJBA', nome: 'TJ Bahia',      indice: 'api_publica_tjba' },
  'tjpe': { sigla: 'TJPE', nome: 'TJ Pernambuco', indice: 'api_publica_tjpe' },
  // Federais (regionais)
  'trf1': { sigla: 'TRF1', nome: 'TRF 1ª Região (DF/GO/MA/MT/MG/PA/RO/RR/AC/AM/AP/BA/PI/TO)', indice: 'api_publica_trf1' },
  'trf2': { sigla: 'TRF2', nome: 'TRF 2ª Região (RJ/ES)', indice: 'api_publica_trf2' },
  'trf3': { sigla: 'TRF3', nome: 'TRF 3ª Região (SP/MS)', indice: 'api_publica_trf3' },
  'trf4': { sigla: 'TRF4', nome: 'TRF 4ª Região (RS/SC/PR)', indice: 'api_publica_trf4' },
  'trf5': { sigla: 'TRF5', nome: 'TRF 5ª Região (NE)', indice: 'api_publica_trf5' },
  // Trabalho regional MA = TRT 16
  'trt16': { sigla: 'TRT16', nome: 'TRT 16ª Região (MA)', indice: 'api_publica_trt16' },
  // Superiores
  'stj':   { sigla: 'STJ',   nome: 'Superior Tribunal de Justiça', indice: 'api_publica_stj' },
  'tst':   { sigla: 'TST',   nome: 'Tribunal Superior do Trabalho', indice: 'api_publica_tst' },
};

export interface ProcessoConsulta {
  numero_cnj:       string;     // "0000123-45.2024.8.10.0028"
  tribunal:         string;     // sigla (ex: "TJMA")
  classe:           string;     // ex: "Procedimento Comum Cível"
  classe_codigo?:   number;
  assuntos:         string[];   // ex: ["Adjudicação Compulsória", "Compromisso"]
  data_ajuizamento: string;     // ISO
  orgao_julgador:   string;     // ex: "1ª Vara Cível de Açailândia"
  grau:             string;     // "G1" / "G2" / "GS"
  formato:          string;     // "Eletrônico" / "Físico"
  sistema?:         string;     // "PJe" / "eproc" / "esaj"
  data_atualizacao?: string;
  total_movimentos: number;
  movimentos:       Array<{ nome: string; data: string; codigo?: number }>;
  link_oficial?:    string;     // se conseguimos montar
}

// CNJ format: NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos numéricos no total).
// Aceita com ou sem máscara — função normaliza pra com máscara antes de chamar API.
export function normalizarNumeroCnj(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 20) {
    throw new Error(`Número CNJ inválido: deve ter 20 dígitos (recebido: ${digits.length}). Formato: NNNNNNN-DD.AAAA.J.TR.OOOO.`);
  }
  // NNNNNNN-DD.AAAA.J.TR.OOOO
  return `${digits.slice(0,7)}-${digits.slice(7,9)}.${digits.slice(9,13)}.${digits.slice(13,14)}.${digits.slice(14,16)}.${digits.slice(16,20)}`;
}

export async function consultarProcesso(input: {
  numero_cnj: string;
  tribunal:   string; // sigla, ex: "tjma"
}): Promise<ProcessoConsulta> {
  if (!input.numero_cnj?.trim()) throw new Error('numero_cnj obrigatório.');
  if (!input.tribunal?.trim())   throw new Error('tribunal obrigatório (ex: "tjma").');

  const sigla = input.tribunal.toLowerCase().trim();
  const trib = TRIBUNAIS[sigla];
  if (!trib) {
    const cobertos = Object.keys(TRIBUNAIS).join(', ');
    throw new Error(`Tribunal "${input.tribunal}" não suportado. Use: ${cobertos}.`);
  }

  const numeroFormatado = normalizarNumeroCnj(input.numero_cnj);
  const numeroSomenteDigitos = numeroFormatado.replace(/\D/g, '');

  let resp;
  try {
    resp = await axios.post(
      `${DATAJUD_BASE}/${trib.indice}/_search`,
      {
        query: { match: { numeroProcesso: numeroSomenteDigitos } },
        size: 1,
      },
      {
        headers: {
          'Authorization': `APIKey ${DATAJUD_PUBLIC_KEY}`,
          'Content-Type':  'application/json',
        },
        timeout: 15000,
      },
    );
  } catch (err) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    const detail = JSON.stringify(e.response?.data ?? e.message ?? err);
    throw new Error(`DataJud falhou (${e.response?.status ?? '?'}): ${detail.slice(0, 300)}`);
  }

  const hits = resp.data?.hits?.hits;
  if (!Array.isArray(hits) || hits.length === 0) {
    throw new Error(`Processo ${numeroFormatado} NÃO encontrado no ${trib.sigla}. Possíveis causas: número incorreto, processo de outro tribunal, ou ainda não consolidado pelo CNJ (atualização D+1).`);
  }

  const src = hits[0]._source;
  const movimentos = Array.isArray(src.movimentos)
    ? src.movimentos.map((m: { nome?: string; dataHora?: string; codigo?: number }) => ({
        nome:   m.nome ?? '',
        data:   m.dataHora ?? '',
        codigo: m.codigo,
      }))
        .sort((a: { data: string }, b: { data: string }) => b.data.localeCompare(a.data))
        .slice(0, 30)
    : [];

  const assuntos = Array.isArray(src.assuntos)
    ? src.assuntos.map((a: { nome?: string }) => a.nome).filter(Boolean)
    : [];

  return {
    numero_cnj:       numeroFormatado,
    tribunal:         trib.sigla,
    classe:           src.classe?.nome ?? '?',
    classe_codigo:    src.classe?.codigo,
    assuntos,
    data_ajuizamento: src.dataAjuizamento ?? '',
    orgao_julgador:   src.orgaoJulgador?.nome ?? '?',
    grau:             src.grau ?? '?',
    formato:          src.formato?.nome ?? '?',
    sistema:          src.sistema?.nome,
    data_atualizacao: src.dataHoraUltimaAtualizacao,
    total_movimentos: movimentos.length,
    movimentos,
  };
}

export function listarTribunaisDataJud(): Array<{ sigla: string; nome: string }> {
  return Object.values(TRIBUNAIS).map(t => ({ sigla: t.sigla, nome: t.nome }));
}
