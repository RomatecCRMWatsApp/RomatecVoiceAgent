// v3.142.0 — Planejamento PURO da carga inicial (seed-pa-salete-moreno.json →
// linhas das tabelas pa_*). Nada de banco aqui: o seedRun só persiste o plano,
// e os testes conferem o plano (KPIs, rateio 63/64, enum de status) sem MySQL.
import {
  cpfValido, formatarCpf, normalizarTelefone, dataBrParaIso, dataHoraBrParaSql, soDigitos,
} from './validadores';
import { centavos, type StatusLancamento, type TipoLancamento } from './regrasFinanceiras';

// ─── Formato do JSON do pacote ────────────────────────────────────────────
export interface SeedJson {
  projeto: {
    codigo: string; nome: string; municipio: string; uf: string;
    zona?: string; movimento?: string;
    associacao?: { nome?: string | null; cnpj?: string | null; cnpj_status?: string | null; presidente?: string | null };
    valor_lote: number; sinal_padrao: number; boleto_padrao: number; prazo_sinal?: string | null;
    pix?: { chave?: string; favorecido?: string; cidade?: string; psp?: string };
    responsavel_tecnico?: { nome?: string; cft?: string; incra?: string; empresa?: string; cnpj?: string };
    layout?: Record<string, unknown>;
  };
  lotes: Array<{
    numero: string; tipo: string; largura_m?: number; profundidade_m?: number; area_m2?: number;
    croqui_xy_m?: number[][]; status_medicao?: string;
  }>;
  associados: Array<{
    numero: string; lote: string; nome: string; cpf: string; rg?: string | null; nascimento?: string | null;
    estado_civil?: string | null; conjuge?: string | null; telefone?: string | null; email?: string | null;
    denominacao_terra?: string | null; endereco?: string | null; dia_vencimento?: string | number | null;
    pendencias?: string | null; acervo_pasta?: string | null; contrato_assinado?: boolean;
  }>;
  pagamentos: Array<{
    lote: string; tipo: string; valor: number; status: string; forma?: string; descricao?: string;
    pagador_terceiro?: string | null; data?: string | null; id_transacao?: string | null;
    valor_recebido?: number; vencimento?: string | null;
  }>;
  documentos: Array<{ lote: string; tipo: string; arquivo: string }>;
}

// ─── Plano ────────────────────────────────────────────────────────────────
export interface PlanoProjeto {
  codigo: string; nome: string; municipio: string; uf: string;
  associacao_nome: string | null; associacao_cnpj: string | null;
  associacao_cnpj_status: 'EM_HOMOLOGACAO' | 'ATIVO'; presidente_nome: string | null;
  valor_lote: number; sinal_padrao: number; boleto_padrao: number; prazo_sinal: string | null;
  pix_chave: string | null; pix_favorecido: string | null; pix_cidade: string | null;
  rt_nome: string | null; rt_registro: string | null; layout_json: Record<string, unknown>;
}
export interface PlanoLote {
  numero: string; tipo: 'ASSOCIADO' | 'INSTITUCIONAL' | 'VAGO';
  largura_m: number | null; profundidade_m: number | null; area_projeto_m2: number | null;
  perimetro_m: number | null; croqui_xy: number[][] | null;
  status_medicao: 'PENDENTE' | 'AGENDADA' | 'MEDIDO' | 'PROCESSADO';
}
export interface PlanoAssociado {
  numero: string; lote: string; nome: string; cpf: string; rg: string | null; nascimento: string | null;
  estado_civil: string | null; conjuge_nome: string | null; conjuge_cpf: string | null;
  telefone: string | null; telefone_e164: string | null; email: string | null;
  denominacao_terra: string | null; endereco: string | null; dia_vencimento: number | null;
  contrato_status: 'GERADO' | 'ENVIADO' | 'ASSINADO'; pendencias: string | null; acervo_pasta: string | null;
}
export interface PlanoLancamento {
  lote: string; tipo: TipoLancamento; parcela: number; valor: number; vencimento: string | null;
  status: StatusLancamento; descricao: string | null;
}
export interface PlanoPagamento {
  seed_chave: string; id_transacao: string | null;
  forma: 'PIX' | 'ESPECIE' | 'CARTAO_DEBITO' | 'CARTAO_CREDITO' | 'BOLETO' | 'MISTO';
  valor: number; pago_em: string; pagador_nome: string | null; vinculo_pagador: string | null; obs: string | null;
  rateio: Array<{ lote: string; tipo: TipoLancamento; parcela: number; valor: number }>;
}
export interface PlanoDocumento {
  lote: string; tipo: string; caminho: string; arquivo_rel: string; nome_original: string; mime: string;
}
export interface PlanoSeed {
  projeto: PlanoProjeto;
  lotes: PlanoLote[];
  associados: PlanoAssociado[];
  lancamentos: PlanoLancamento[];
  pagamentos: PlanoPagamento[];
  documentos: PlanoDocumento[];
  avisos: string[];
  erros: string[];
}

const TIPOS_DOC = new Set([
  'FOTO_3X4', 'DOC_IDENTIFICACAO', 'CERTIDAO', 'DOC_CONJUGE', 'COMPROVANTE_SINAL', 'PROCESSO_FICHA_CONTRATO',
  'PROCESSO_ASSINADO', 'CARTEIRINHA', 'MAPA_LOTE', 'MEMORIAL', 'TRT', 'RELATORIO', 'ORIGINAL', 'OUTRO',
]);

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain',
};
export function mimePorNome(nome: string): string {
  const ext = (nome.split('.').pop() || '').toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

export function perimetro(xy: number[][] | null | undefined): number | null {
  if (!Array.isArray(xy) || xy.length < 3) return null;
  let p = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return centavos(p);
}

/** "RONE CLEY SOARES REIS – CPF 011.968.993-62" → { nome, cpf }. */
export function parseConjuge(v: string | null | undefined): { nome: string | null; cpf: string | null } {
  const s = String(v ?? '').trim();
  if (!s) return { nome: null, cpf: null };
  const m = s.match(/^(.*?)[\s–—\-,]*CPF[:\s]*([\d.\-\s]{11,14})/i);
  if (m) {
    const d = soDigitos(m[2]);
    return { nome: m[1].trim() || null, cpf: d.length === 11 ? formatarCpf(d) : null };
  }
  return { nome: s, cpf: null };
}

/** "Rosa Maria dos Santos (genitora" → { nome: 'Rosa Maria dos Santos', vinculo: 'genitora' }. */
export function parsePagadorTerceiro(v: string | null | undefined): { nome: string | null; vinculo: string | null } {
  const s = String(v ?? '').trim();
  if (!s) return { nome: null, vinculo: null };
  const m = s.match(/^(.*?)\s*\(\s*([^)]*)\)?\s*$/);
  if (m) return { nome: m[1].trim() || null, vinculo: m[2].trim() || null };
  return { nome: s, vinculo: null };
}

const STATUS_SEED: Record<string, StatusLancamento> = {
  'PAGO': 'PAGO', 'A PAGAR': 'A_PAGAR', 'PARCIAL': 'PARCIAL', 'A VENCER': 'A_VENCER',
  'VENCIDO': 'VENCIDO', 'CANCELADO': 'CANCELADO',
};

export function formaPorTexto(f: string | null | undefined): PlanoPagamento['forma'] {
  const s = String(f ?? '').toLowerCase();
  if (/misto|\+/.test(s)) return 'MISTO';
  if (/esp[ée]cie|dinheiro/.test(s)) return 'ESPECIE';
  if (/d[ée]bito/.test(s)) return 'CARTAO_DEBITO';
  if (/cr[ée]dito|cart[ãa]o/.test(s)) return 'CARTAO_CREDITO';
  if (/boleto/.test(s)) return 'BOLETO';
  return 'PIX';
}

/** Id real de transação (E2E/AUT/NSU) ou null para "Não se aplica – espécie". */
export function normalizarIdTransacao(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim();
  if (!s || /n[ãa]o se aplica/i.test(s)) return null;
  return s.replace(/^pix\s+/i, '').slice(0, 100);
}

function txt(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  return s && !/^a informar$/i.test(s) ? s : null;
}

export function planejarSeed(seed: SeedJson): PlanoSeed {
  const avisos: string[] = [];
  const erros: string[] = [];
  const p = seed.projeto;
  if (!p?.codigo) throw new Error('seed sem projeto.codigo');

  const rt = p.responsavel_tecnico || {};
  const projeto: PlanoProjeto = {
    codigo: p.codigo, nome: p.nome, municipio: p.municipio, uf: p.uf,
    associacao_nome: txt(p.associacao?.nome), associacao_cnpj: txt(p.associacao?.cnpj),
    associacao_cnpj_status: p.associacao?.cnpj_status === 'ATIVO' ? 'ATIVO' : 'EM_HOMOLOGACAO',
    presidente_nome: txt(p.associacao?.presidente),
    valor_lote: centavos(p.valor_lote), sinal_padrao: centavos(p.sinal_padrao), boleto_padrao: centavos(p.boleto_padrao),
    prazo_sinal: p.prazo_sinal ? String(p.prazo_sinal).slice(0, 10) : null,
    pix_chave: txt(p.pix?.chave), pix_favorecido: txt(p.pix?.favorecido)?.slice(0, 25) ?? null,
    pix_cidade: txt(p.pix?.cidade)?.slice(0, 15) ?? null,
    rt_nome: txt(rt.nome),
    rt_registro: [rt.cft ? `CFT ${rt.cft}` : '', rt.incra ? `INCRA ${rt.incra}` : ''].filter(Boolean).join(' · ') || null,
    layout_json: {
      ...(p.layout || {}), zona: p.zona ?? null, movimento: p.movimento ?? null,
      pix_psp: p.pix?.psp ?? null, responsavel_tecnico: rt,
    },
  };

  // Lotes
  const lotes: PlanoLote[] = [];
  const numerosLote = new Set<string>();
  for (const l of seed.lotes || []) {
    const numero = String(l.numero).padStart(2, '0');
    if (numerosLote.has(numero)) { erros.push(`lote ${numero} repetido no seed`); continue; }
    numerosLote.add(numero);
    const tipo = (['ASSOCIADO', 'INSTITUCIONAL', 'VAGO'].includes(l.tipo) ? l.tipo : 'VAGO') as PlanoLote['tipo'];
    const st = (['PENDENTE', 'AGENDADA', 'MEDIDO', 'PROCESSADO'].includes(String(l.status_medicao)) ? l.status_medicao : 'PENDENTE') as PlanoLote['status_medicao'];
    lotes.push({
      numero, tipo, largura_m: l.largura_m ?? null, profundidade_m: l.profundidade_m ?? null,
      area_projeto_m2: l.area_m2 ?? null, perimetro_m: perimetro(l.croqui_xy_m),
      croqui_xy: Array.isArray(l.croqui_xy_m) ? l.croqui_xy_m : null, status_medicao: st,
    });
  }

  // Associados
  const associados: PlanoAssociado[] = [];
  const porLote = new Map<string, PlanoAssociado>();
  const cpfs = new Set<string>();
  const telefones = new Map<string, string>();
  for (const a of seed.associados || []) {
    const lote = String(a.lote).padStart(2, '0');
    const rotulo = `${a.numero} (lote ${lote})`;
    if (!numerosLote.has(lote)) { erros.push(`${rotulo}: lote não existe`); continue; }
    if (porLote.has(lote)) { erros.push(`${rotulo}: lote já tem associado (${porLote.get(lote)!.numero})`); continue; }
    if (!cpfValido(a.cpf)) { erros.push(`${rotulo}: CPF ${a.cpf} inválido (dígito verificador)`); continue; }
    const cpf = formatarCpf(a.cpf);
    if (cpfs.has(cpf)) { erros.push(`${rotulo}: CPF ${cpf} duplicado no projeto`); continue; }
    cpfs.add(cpf);

    const tel = normalizarTelefone(a.telefone);
    tel.avisos.forEach((w) => avisos.push(`${rotulo}: ${w}`));
    if (tel.e164) {
      if (telefones.has(tel.e164)) avisos.push(`${rotulo}: telefone igual ao de ${telefones.get(tel.e164)}`);
      else telefones.set(tel.e164, a.numero);
    }
    const conj = parseConjuge(a.conjuge);
    if (conj.cpf && !cpfValido(conj.cpf)) avisos.push(`${rotulo}: CPF do cônjuge ${conj.cpf} inválido`);
    if (a.nascimento && !dataBrParaIso(a.nascimento) && txt(a.nascimento)) avisos.push(`${rotulo}: nascimento "${a.nascimento}" não reconhecido`);
    const dia = Number(a.dia_vencimento);

    const pa: PlanoAssociado = {
      numero: a.numero, lote, nome: a.nome.trim(), cpf, rg: txt(a.rg), nascimento: dataBrParaIso(a.nascimento),
      estado_civil: txt(a.estado_civil)?.slice(0, 60) ?? null, conjuge_nome: conj.nome, conjuge_cpf: conj.cpf,
      telefone: txt(a.telefone)?.slice(0, 60) ?? null, telefone_e164: tel.e164, email: txt(a.email),
      denominacao_terra: txt(a.denominacao_terra), endereco: txt(a.endereco)?.slice(0, 255) ?? null,
      dia_vencimento: Number.isInteger(dia) && dia >= 1 && dia <= 31 ? dia : null,
      contrato_status: a.contrato_assinado ? 'ASSINADO' : 'GERADO', pendencias: txt(a.pendencias),
      acervo_pasta: txt(a.acervo_pasta),
    };
    associados.push(pa);
    porLote.set(lote, pa);
  }

  // Lançamentos + pagamentos (agrupados por id de transação → rateio)
  const lancamentos: PlanoLancamento[] = [];
  const pagMap = new Map<string, PlanoPagamento>();
  const chavesLanc = new Set<string>();
  for (const pg of seed.pagamentos || []) {
    const lote = String(pg.lote).padStart(2, '0');
    const assoc = porLote.get(lote);
    if (!assoc) { erros.push(`pagamento ${pg.tipo} do lote ${lote}: sem associado válido`); continue; }
    const status = STATUS_SEED[String(pg.status).toUpperCase()];
    if (!status) { erros.push(`pagamento ${pg.tipo} do lote ${lote}: status "${pg.status}" desconhecido`); continue; }

    let tipo: TipoLancamento;
    let parcela = 0;
    const mb = String(pg.tipo).match(/^BOLETO_?(\d+)$/i);
    if (mb) { tipo = 'BOLETO'; parcela = Number(mb[1]); }
    else if (/^SINAL$/i.test(pg.tipo)) tipo = centavos(pg.valor) >= projeto.valor_lote ? 'AVISTA' : 'SINAL';
    else if (/^(AVISTA|AJUSTE)$/i.test(pg.tipo)) tipo = pg.tipo.toUpperCase() as TipoLancamento;
    else { erros.push(`pagamento do lote ${lote}: tipo "${pg.tipo}" desconhecido`); continue; }

    const chave = `${lote}|${tipo}|${parcela}`;
    if (chavesLanc.has(chave)) { erros.push(`lançamento ${tipo} ${parcela} do lote ${lote} repetido`); continue; }
    chavesLanc.add(chave);

    const vencimento = tipo === 'BOLETO' ? dataBrParaIso(pg.vencimento) : projeto.prazo_sinal;
    lancamentos.push({
      lote, tipo, parcela, valor: centavos(pg.valor), vencimento, status,
      descricao: txt(pg.descricao)?.slice(0, 255) ?? null,
    });

    const recebido = centavos(pg.valor_recebido ?? 0);
    if ((status === 'PAGO' || status === 'PARCIAL') && recebido > 0) {
      const idTx = normalizarIdTransacao(pg.id_transacao);
      const seedChave = idTx ? `tx:${idTx}`.slice(0, 80) : `seed:${projeto.codigo}:${assoc.numero}:${tipo}:${parcela}`.slice(0, 80);
      const pagadorTerc = parsePagadorTerceiro(pg.pagador_terceiro);
      const pagoEm = dataHoraBrParaSql(pg.data) ?? dataHoraBrParaSql(pg.descricao);
      if (!pagoEm) avisos.push(`pagamento ${tipo} do lote ${lote}: sem data — usado o prazo do sinal`);
      const existente = pagMap.get(seedChave);
      if (existente) {
        existente.valor = centavos(existente.valor + recebido);
        existente.rateio.push({ lote, tipo, parcela, valor: recebido });
        if (!existente.pagador_nome && pagadorTerc.nome) existente.pagador_nome = pagadorTerc.nome;
        existente.obs = [existente.obs, `lote ${lote}: ${pg.descricao ?? ''}`.trim()].filter(Boolean).join(' | ').slice(0, 2000);
        if (existente.rateio.length === 2) avisos.push(`Pix único ${idTx} rateado entre lotes ${existente.rateio.map((r) => r.lote).join(' e ')}`);
      } else {
        pagMap.set(seedChave, {
          seed_chave: seedChave, id_transacao: idTx, forma: formaPorTexto(pg.forma), valor: recebido,
          pago_em: pagoEm ?? `${projeto.prazo_sinal ?? new Date().toISOString().slice(0, 10)} 00:00:00`,
          pagador_nome: pagadorTerc.nome ?? assoc.nome,
          vinculo_pagador: pagadorTerc.nome ? (pagadorTerc.vinculo ?? 'terceiro (vínculo não informado na importação)') : null,
          obs: [`lote ${lote}: ${pg.descricao ?? ''}`.trim(), pg.id_transacao && !idTx ? pg.id_transacao : null].filter(Boolean).join(' | '),
          rateio: [{ lote, tipo, parcela, valor: recebido }],
        });
      }
    }
  }

  // Documentos
  const documentos: PlanoDocumento[] = [];
  for (const d of seed.documentos || []) {
    const lote = String(d.lote).padStart(2, '0');
    if (!numerosLote.has(lote)) { erros.push(`documento ${d.arquivo}: lote ${lote} não existe`); continue; }
    const tipo = TIPOS_DOC.has(d.tipo) ? d.tipo : 'OUTRO';
    const rel = String(d.arquivo).replace(/\\/g, '/').replace(/^\/+/, '');
    if (rel.includes('..')) { erros.push(`documento ${d.arquivo}: caminho inválido`); continue; }
    const nome = rel.split('/').pop() || rel;
    documentos.push({ lote, tipo, caminho: `${projeto.codigo}/${rel}`.slice(0, 400), arquivo_rel: rel, nome_original: nome, mime: mimePorNome(nome) });
  }

  return { projeto, lotes, associados, lancamentos, pagamentos: [...pagMap.values()], documentos, avisos, erros };
}
