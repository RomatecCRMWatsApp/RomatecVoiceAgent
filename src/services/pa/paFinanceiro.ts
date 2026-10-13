// v3.142.0 — Financeiro do módulo PA: lançamento de pagamento (manual ou por link
// InfinitePay), rateio entre lançamentos, conferência do pagador e cobrança.
import { PaErro } from './erros';
import { pool, rows, one, exec, transacao, num, isoDateTime, hojeBrasil, agoraBrasilSql, registrarEvento, type Db } from './paDb';
import { buscarProjeto, mapLancamento, type Projeto } from './paRepo';
import { cpfParcialConfere, dataHoraBrParaSql, soDigitos } from './validadores';
import { centavos, ratearAutomatico, statusAposRecebimento, type Rateio, type StatusLancamento } from './regrasFinanceiras';
import { parseRecibo, destinoEhRomatec, type ReciboInfinitePay } from './infinitepay';
import { gerarPixCopiaECola } from './pixBrCode';
import { urlBoletoRomatec } from './paBoletoPdf';
import { configAsaas } from './asaas';

export const FORMAS = ['PIX', 'ESPECIE', 'CARTAO_DEBITO', 'CARTAO_CREDITO', 'BOLETO', 'MISTO'] as const;
export type Forma = (typeof FORMAS)[number];

export interface NovoPagamento {
  forma: Forma;
  valor: number;
  pago_em: string;
  id_transacao: string | null;
  pagador_nome: string | null;
  pagador_cpf_parcial: string | null;
  pagador_instituicao: string | null;
  vinculo_pagador: string | null;
  url_recibo: string | null;
  comprovante_doc_id: number | null;
  obs: string | null;
  associado_id: number | null;
  rateio: Rateio[] | null;
}

function s(v: unknown, max: number): string | null {
  const t = v == null ? '' : String(v).trim();
  return t ? t.slice(0, max) : null;
}

/** Normaliza o body da rota. Datas aceitam ISO, 'aaaa-mm-dd hh:mm' ou dd/mm/aaaa. */
export function lerNovoPagamento(body: Record<string, unknown>): NovoPagamento {
  const forma = String(body.forma ?? 'PIX').toUpperCase() as Forma;
  if (!FORMAS.includes(forma)) throw new PaErro('CAMPO_INVALIDO', 'forma de pagamento inválida', 400);
  const valor = centavos(Number(String(body.valor ?? '').replace(',', '.')));
  let pagoEm: string | null = null;
  if (body.pago_em) {
    const raw = String(body.pago_em);
    pagoEm = /^\d{4}-\d{2}-\d{2}/.test(raw) ? `${raw.slice(0, 10)} ${(raw.slice(11, 19) || '00:00:00').padEnd(8, ':00').slice(0, 8)}` : dataHoraBrParaSql(raw);
    if (!pagoEm) throw new PaErro('CAMPO_INVALIDO', 'pago_em inválido', 400);
  }
  let rateio: Rateio[] | null = null;
  if (Array.isArray(body.rateio) && body.rateio.length) {
    rateio = body.rateio.map((r) => {
      const o = r as Record<string, unknown>;
      const id = Number(o.lancamento_id);
      const v = centavos(Number(String(o.valor ?? '').replace(',', '.')));
      if (!Number.isInteger(id) || id <= 0 || !(v > 0)) throw new PaErro('RATEIO_INVALIDO', 'Rateio precisa de lancamento_id e valor > 0', 400);
      return { lancamento_id: id, valor: v };
    });
    const ids = new Set(rateio.map((r) => r.lancamento_id));
    if (ids.size !== rateio.length) throw new PaErro('RATEIO_INVALIDO', 'Lançamento repetido no rateio', 400);
  }
  const aid = body.associado_id == null || body.associado_id === '' ? null : Number(body.associado_id);
  return {
    forma, valor: Number.isFinite(valor) ? valor : 0, pago_em: pagoEm ?? '',
    id_transacao: s(body.id_transacao, 100)?.replace(/\s+/g, ' ') ?? null,
    pagador_nome: s(body.pagador_nome, 160), pagador_cpf_parcial: s(body.pagador_cpf_parcial, 20),
    pagador_instituicao: s(body.pagador_instituicao, 120), vinculo_pagador: s(body.vinculo_pagador, 80),
    url_recibo: s(body.url_recibo, 400),
    comprovante_doc_id: body.comprovante_doc_id ? Number(body.comprovante_doc_id) || null : null,
    obs: s(body.obs, 5000), associado_id: aid != null && Number.isInteger(aid) ? aid : null, rateio,
  };
}

/** Preenche o pagamento com os dados do recibo (o que o operador digitou prevalece). */
export function aplicarRecibo(p: NovoPagamento, r: ReciboInfinitePay): NovoPagamento {
  return {
    ...p,
    forma: 'PIX',
    valor: p.valor > 0 ? p.valor : r.valor,
    pago_em: p.pago_em || r.pago_em || agoraBrasilSql(),
    id_transacao: p.id_transacao ?? r.id_transacao,
    pagador_nome: p.pagador_nome ?? r.origem.nome,
    pagador_cpf_parcial: p.pagador_cpf_parcial ?? r.origem.cpf,
    pagador_instituicao: p.pagador_instituicao ?? r.origem.instituicao,
  };
}

/** Lançamentos em aberto de um associado, na ordem de quitação (entrada → boletos). */
async function abertosDoAssociado(db: Db, aid: number) {
  const ls = await rows(db, `
    SELECT * FROM pa_lancamentos WHERE associado_id = ? AND status NOT IN ('PAGO','CANCELADO')
    ORDER BY FIELD(tipo,'SINAL','AVISTA','BOLETO','AJUSTE'), parcela FOR UPDATE`, [aid]);
  return ls.map((l) => mapLancamento(l)).filter((l) => l.saldo > 0);
}

/** Pré-visualização do link InfinitePay: campos lidos + associados candidatos. */
export async function previewRecibo(projetoId: number, url: string) {
  const projeto = await buscarProjeto(projetoId);
  const recibo = await parseRecibo(url);
  const centro = soDigitos(recibo.origem.cpf);
  const candidatos = centro.length === 6
    ? await rows(pool, `
        SELECT a.id, a.numero, a.nome, l.numero AS lote FROM pa_associados a JOIN pa_lotes l ON l.id = a.lote_id
        WHERE a.projeto_id = ? AND a.ativo = 1 AND SUBSTRING(REPLACE(REPLACE(a.cpf, '.', ''), '-', ''), 4, 6) = ?`, [projetoId, centro])
    : [];
  const ja = recibo.id_transacao ? await one(pool, 'SELECT id FROM pa_pagamentos WHERE id_transacao = ?', [recibo.id_transacao]) : null;
  return {
    recibo,
    destino_ok: destinoEhRomatec(recibo, projeto.pix_chave),
    ja_lancado: ja ? num(ja.id) : null,
    candidatos: candidatos.map((c) => ({ id: num(c.id), numero: String(c.numero), nome: String(c.nome), lote: String(c.lote) })),
  };
}

export async function lancarPagamento(projetoId: number, entrada: NovoPagamento, usuario: string | null) {
  let p = entrada;
  let recibo: ReciboInfinitePay | null = null;
  const projeto = await buscarProjeto(projetoId);
  if (p.url_recibo) {
    recibo = await parseRecibo(p.url_recibo);
    if (!destinoEhRomatec(recibo, projeto.pix_chave)) {
      throw new PaErro('DESTINO_INVALIDO', `O recibo não é para a ROMATEC (destino: ${recibo.destino.nome ?? recibo.destino.chave ?? 'desconhecido'})`, 422);
    }
    p = aplicarRecibo(p, recibo);
  }
  if (!(p.valor > 0)) throw new PaErro('CAMPO_INVALIDO', 'Valor do pagamento é obrigatório', 400);
  if (!p.pago_em) p = { ...p, pago_em: agoraBrasilSql() };
  if (p.forma === 'PIX' && !p.id_transacao) {
    throw new PaErro('ID_TRANSACAO_OBRIGATORIO', 'Pix precisa do ID da transação (E2E) para evitar baixa em duplicidade', 400);
  }

  const resultado = await transacao(async (c) => {
    if (p.id_transacao) {
      const dup = await one(c, 'SELECT id, valor, pago_em FROM pa_pagamentos WHERE id_transacao = ? FOR UPDATE', [p.id_transacao]);
      if (dup) {
        throw new PaErro('TRANSACAO_DUPLICADA', `ID ${p.id_transacao} já lançado (pagamento #${dup.id}). Para dividir um Pix entre lotes, use o rateio no MESMO lançamento.`, 409, { pagamento_id: num(dup.id) });
      }
    }

    let rateio = p.rateio;
    if (!rateio) {
      if (!p.associado_id) throw new PaErro('RATEIO_INVALIDO', 'Informe o associado ou o rateio por lançamento', 400);
      const abertos = await abertosDoAssociado(c, p.associado_id);
      if (!abertos.length) throw new PaErro('SEM_SALDO', 'Associado não tem lançamentos em aberto', 409);
      rateio = ratearAutomatico(p.valor, abertos.map((l) => ({ id: l.id, saldo: l.saldo })));
    }

    const ids = rateio.map((r) => r.lancamento_id);
    const lancs = await rows(c, `
      SELECT l.*, a.projeto_id, a.cpf, a.nome, a.numero AS associado_numero, a.conjuge_cpf, lt.numero AS lote
      FROM pa_lancamentos l JOIN pa_associados a ON a.id = l.associado_id JOIN pa_lotes lt ON lt.id = a.lote_id
      WHERE l.id IN (${ids.map(() => '?').join(',')}) FOR UPDATE`, ids);
    if (lancs.length !== ids.length) throw new PaErro('RATEIO_INVALIDO', 'Lançamento do rateio não encontrado', 404);
    const porId = new Map(lancs.map((l) => [num(l.id), l]));
    let soma = 0;
    for (const r of rateio) {
      const l = porId.get(r.lancamento_id)!;
      if (num(l.projeto_id) !== projetoId) throw new PaErro('RATEIO_INVALIDO', `Lançamento #${r.lancamento_id} é de outro projeto`, 400);
      const ml = mapLancamento(l);
      if (ml.status === 'CANCELADO') throw new PaErro('RATEIO_INVALIDO', `Lançamento #${r.lancamento_id} está cancelado`, 409);
      if (r.valor > ml.saldo + 0.009) {
        throw new PaErro('RATEIO_ACIMA_DO_SALDO', `Lote ${l.lote} ${ml.tipo}${ml.parcela || ''}: saldo R$ ${ml.saldo.toFixed(2)}, rateio R$ ${r.valor.toFixed(2)}`, 422);
      }
      soma = centavos(soma + r.valor);
    }
    if (soma > p.valor + 0.009) throw new PaErro('RATEIO_ACIMA_DO_VALOR', `Rateio (R$ ${soma.toFixed(2)}) maior que o pagamento (R$ ${p.valor.toFixed(2)})`, 422);
    if (!(soma > 0)) throw new PaErro('RATEIO_INVALIDO', 'Nada a ratear', 400);

    // Regra §5.2 — comprovante x pagador: CPF parcial ≠ associado (e ≠ cônjuge) exige vínculo.
    const associadosDoRateio = [...new Map(lancs.map((l) => [num(l.associado_id), l])).values()];
    let pagadorTerceiro = false;
    if (p.pagador_cpf_parcial) {
      for (const a of associadosDoRateio) {
        const confere = cpfParcialConfere(a.cpf, p.pagador_cpf_parcial);
        const confereConj = a.conjuge_cpf ? cpfParcialConfere(a.conjuge_cpf, p.pagador_cpf_parcial) : false;
        if (confere === false && !confereConj) pagadorTerceiro = true;
      }
    }
    if (pagadorTerceiro && !p.vinculo_pagador) {
      throw new PaErro('VINCULO_OBRIGATORIO', 'O CPF do comprovante não é do associado: informe o vínculo do pagador (pai, mãe, cônjuge, associado de outro lote…)', 422, {
        pagador: p.pagador_nome, cpf_parcial: p.pagador_cpf_parcial,
      });
    }

    const obsExtra = soma < p.valor - 0.009 ? `Valor não alocado: R$ ${(p.valor - soma).toFixed(2)}` : null;
    const ins = await exec(c, `
      INSERT INTO pa_pagamentos (projeto_id, forma, valor, pago_em, id_transacao, pagador_nome, pagador_cpf_parcial,
        pagador_instituicao, vinculo_pagador, url_recibo, comprovante_doc_id, obs, criado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      projetoId, p.forma, p.valor, p.pago_em, p.id_transacao, p.pagador_nome, p.pagador_cpf_parcial,
      p.pagador_instituicao, p.vinculo_pagador, p.url_recibo, p.comprovante_doc_id,
      [p.obs, obsExtra].filter(Boolean).join(' | ') || null, usuario,
    ]);
    const atualizados: Array<{ lancamento_id: number; status: StatusLancamento; saldo: number }> = [];
    for (const r of rateio) {
      const l = porId.get(r.lancamento_id)!;
      const recebido = centavos(num(l.valor_recebido) + r.valor);
      const status = statusAposRecebimento(num(l.valor), recebido, l.status as StatusLancamento);
      await exec(c, 'INSERT INTO pa_pagamento_rateio (pagamento_id, lancamento_id, valor) VALUES (?, ?, ?)', [ins.insertId, r.lancamento_id, r.valor]);
      await exec(c, 'UPDATE pa_lancamentos SET valor_recebido = ?, status = ? WHERE id = ?', [recebido, status, r.lancamento_id]);
      atualizados.push({ lancamento_id: r.lancamento_id, status, saldo: centavos(Math.max(0, num(l.valor) - recebido)) });
    }
    for (const a of associadosDoRateio) {
      await registrarEvento(c, {
        projeto_id: projetoId, associado_id: num(a.associado_id), usuario, tipo: 'PAGAMENTO_LANCADO',
        dados: {
          pagamento_id: ins.insertId, forma: p.forma, valor: p.valor, id_transacao: p.id_transacao,
          origem: recibo ? 'INFINITEPAY' : 'MANUAL', terceiro: pagadorTerceiro, vinculo: p.vinculo_pagador,
          rateio: rateio.filter((r) => num(porId.get(r.lancamento_id)!.associado_id) === num(a.associado_id)),
        },
      });
    }
    return { pagamento_id: ins.insertId, rateio, atualizados, pagador_terceiro: pagadorTerceiro };
  });

  return { ...resultado, recibo, pagamento: await buscarPagamento(resultado.pagamento_id) };
}

export async function buscarPagamento(id: number) {
  const p = await one(pool, 'SELECT * FROM pa_pagamentos WHERE id = ?', [id]);
  if (!p) throw new PaErro('PAGAMENTO_NAO_ENCONTRADO', 'Pagamento não encontrado', 404);
  const rateio = await rows(pool, `
    SELECT r.lancamento_id, r.valor, l.tipo, l.parcela, a.id AS associado_id, a.numero, a.nome, lt.numero AS lote
    FROM pa_pagamento_rateio r JOIN pa_lancamentos l ON l.id = r.lancamento_id
    JOIN pa_associados a ON a.id = l.associado_id JOIN pa_lotes lt ON lt.id = a.lote_id
    WHERE r.pagamento_id = ? ORDER BY lt.numero`, [id]);
  return {
    id: num(p.id), projeto_id: num(p.projeto_id), forma: String(p.forma), valor: num(p.valor), pago_em: isoDateTime(p.pago_em),
    id_transacao: p.id_transacao ?? null, pagador_nome: p.pagador_nome ?? null, pagador_cpf_parcial: p.pagador_cpf_parcial ?? null,
    pagador_instituicao: p.pagador_instituicao ?? null, vinculo_pagador: p.vinculo_pagador ?? null, url_recibo: p.url_recibo ?? null,
    comprovante_doc_id: p.comprovante_doc_id == null ? null : num(p.comprovante_doc_id), obs: p.obs ?? null, criado_por: p.criado_por ?? null,
    criado_em: isoDateTime(p.criado_em),
    rateio: rateio.map((r) => ({
      lancamento_id: num(r.lancamento_id), valor: num(r.valor), tipo: String(r.tipo), parcela: num(r.parcela),
      associado_id: num(r.associado_id), associado_numero: String(r.numero), associado_nome: String(r.nome), lote: String(r.lote),
    })),
  };
}

export async function listarPagamentos(projetoId: number, limite = 500) {
  await buscarProjeto(projetoId);
  const ps = await rows(pool, `
    SELECT p.*, GROUP_CONCAT(DISTINCT lt.numero ORDER BY lt.numero SEPARATOR ', ') AS lotes,
      GROUP_CONCAT(DISTINCT a.nome ORDER BY lt.numero SEPARATOR ' / ') AS associados
    FROM pa_pagamentos p
    LEFT JOIN pa_pagamento_rateio r ON r.pagamento_id = p.id
    LEFT JOIN pa_lancamentos l ON l.id = r.lancamento_id
    LEFT JOIN pa_associados a ON a.id = l.associado_id
    LEFT JOIN pa_lotes lt ON lt.id = a.lote_id
    WHERE p.projeto_id = ? GROUP BY p.id ORDER BY p.pago_em DESC, p.id DESC LIMIT ?`, [projetoId, Math.min(Math.max(1, limite), 2000)]);
  return ps.map((p) => ({
    id: num(p.id), forma: String(p.forma), valor: num(p.valor), pago_em: isoDateTime(p.pago_em), id_transacao: p.id_transacao ?? null,
    pagador_nome: p.pagador_nome ?? null, pagador_cpf_parcial: p.pagador_cpf_parcial ?? null, vinculo_pagador: p.vinculo_pagador ?? null,
    url_recibo: p.url_recibo ?? null, obs: p.obs ?? null, lotes: p.lotes ?? '', associados: p.associados ?? '',
  }));
}

// ─── Cobrança ─────────────────────────────────────────────────────────────
function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function dataBr(iso: string | null): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';
}

export function mensagemCobranca(
  projeto: Pick<Projeto, 'nome' | 'pix_chave'>,
  nome: string, lote: string,
  itens: Array<{ rotulo: string; saldo: number; vencimento: string | null; boleto?: BoletoNaCobranca | null }>,
  total: number, pix: string | null,
): string {
  const primeiro = nome.split(/\s+/)[0];
  const nomeFmt = primeiro.charAt(0) + primeiro.slice(1).toLowerCase();
  // v3.143.0: item com boleto Asaas leva link + linha digitável + Pix DA COBRANÇA
  // (esse Pix dá baixa automática; a chave fixa do projeto não).
  const linhas = itens.flatMap((i) => {
    const out = [`• ${i.rotulo}: *${brl(i.saldo)}* (venc. ${dataBr(i.vencimento)})`];
    const link = i.boleto?.url_romatec || i.boleto?.url_boleto;
    if (link) out.push(`  Boleto: ${link}`);
    if (i.boleto?.linha_digitavel) out.push(`  Linha digitável: ${i.boleto.linha_digitavel}`);
    if (i.boleto?.pix_copia_cola) out.push(`  Pix copia e cola:\n${i.boleto.pix_copia_cola}`);
    return out;
  });
  const todosComBoleto = itens.length > 0 && itens.every((i) => i.boleto);
  return [
    `Olá, ${nomeFmt}! Aqui é a Zayra, assistente virtual da Romatec Consultoria Total. 🌱`,
    `Sobre o *Lote ${lote}* do ${projeto.nome}:`,
    ...linhas,
    `Total em aberto: *${brl(total)}*`,
    !todosComBoleto && projeto.pix_chave ? `Chave Pix: *${projeto.pix_chave}*` : '',
    !todosComBoleto && pix ? `Pix copia e cola:\n${pix}` : '',
    todosComBoleto
      ? 'Pagando pelo boleto ou pelo Pix acima, a baixa é automática. Obrigada!'
      : 'Depois de pagar, é só mandar o comprovante (ou o link do recibo) aqui mesmo. Obrigada!',
  ].filter(Boolean).join('\n');
}

export interface BoletoNaCobranca {
  id: number; status: string; url_boleto: string | null; url_romatec: string | null; linha_digitavel: string | null; pix_copia_cola: string | null; enviado_em: string | null;
}

const ROTULO: Record<string, string> = { SINAL: 'Sinal', AVISTA: 'Pagamento à vista', BOLETO: 'Parcela', AJUSTE: 'Ajuste' };

/** Pendências com vencimento até `ate` (sinal sem vencimento entra sempre). */
export async function cobranca(projetoId: number, ateIso: string | null) {
  const projeto = await buscarProjeto(projetoId);
  const hoje = hojeBrasil();
  const ate = ateIso && /^\d{4}-\d{2}-\d{2}$/.test(ateIso) ? ateIso : hoje;
  const ls = await rows(pool, `
    SELECT l.*, a.id AS aid, a.numero AS anum, a.nome, a.telefone, a.telefone_e164, lt.numero AS lote
    FROM pa_lancamentos l JOIN pa_associados a ON a.id = l.associado_id AND a.ativo = 1 JOIN pa_lotes lt ON lt.id = a.lote_id
    WHERE a.projeto_id = ? AND l.status NOT IN ('PAGO','CANCELADO') AND (l.vencimento IS NULL OR l.vencimento <= ?)
    ORDER BY CAST(lt.numero AS UNSIGNED), FIELD(l.tipo,'SINAL','AVISTA','BOLETO','AJUSTE'), l.parcela`, [projetoId, ate]);
  const grupos = new Map<number, {
    associado_id: number; numero: string; nome: string; lote: string; telefone: string | null; telefone_e164: string | null;
    itens: Array<{ lancamento_id: number; tipo: string; parcela: number; rotulo: string; valor: number; recebido: number; saldo: number; vencimento: string | null; status: StatusLancamento; boleto: BoletoNaCobranca | null }>;
    total: number;
  }>();
  for (const r of ls) {
    const l = mapLancamento(r, hoje);
    if (l.saldo <= 0) continue;
    const aid = num(r.aid);
    if (!grupos.has(aid)) {
      grupos.set(aid, {
        associado_id: aid, numero: String(r.anum), nome: String(r.nome), lote: String(r.lote),
        telefone: (r.telefone as string) ?? null, telefone_e164: (r.telefone_e164 as string) ?? null, itens: [], total: 0,
      });
    }
    const g = grupos.get(aid)!;
    g.itens.push({
      lancamento_id: l.id, tipo: l.tipo, parcela: l.parcela,
      rotulo: `${ROTULO[l.tipo] ?? l.tipo}${l.tipo === 'BOLETO' ? ` ${l.parcela}` : ''}${l.status === 'PARCIAL' ? ' (saldo)' : ''}`,
      valor: l.valor, recebido: l.valor_recebido, saldo: l.saldo, vencimento: l.vencimento, status: l.status_efetivo, boleto: null,
    });
    g.total = centavos(g.total + l.saldo);
  }
  // v3.143.0: boleto ativo (Asaas) de cada item + status do WhatsApp do associado.
  const idsLanc = [...grupos.values()].flatMap((g) => g.itens.map((i) => i.lancamento_id));
  const boletos = idsLanc.length ? await rows(pool, `
    SELECT id, lancamento_id, status, url_boleto, linha_digitavel, pix_copia_cola, enviado_em, token_publico FROM pa_boletos
    WHERE lancamento_id IN (${idsLanc.map(() => '?').join(',')}) AND status IN ('PENDENTE','VENCIDO') AND ambiente = ?`, [...idsLanc, configAsaas()?.ambiente ?? 'sandbox']) : [];
  const bolPorLanc = new Map<number, BoletoNaCobranca>(boletos.map((b) => [num(b.lancamento_id), {
    id: num(b.id), status: String(b.status), url_boleto: (b.url_boleto as string) ?? null,
    url_romatec: urlBoletoRomatec((b.token_publico as string) ?? null),
    linha_digitavel: (b.linha_digitavel as string) ?? null, pix_copia_cola: (b.pix_copia_cola as string) ?? null,
    enviado_em: isoDateTime(b.enviado_em),
  }]));
  for (const g of grupos.values()) for (const i of g.itens) i.boleto = bolPorLanc.get(i.lancamento_id) ?? null;
  const aids = [...grupos.keys()];
  const waRows = aids.length ? await rows(pool, `SELECT id, whatsapp_status FROM pa_associados WHERE id IN (${aids.map(() => '?').join(',')})`, aids) : [];
  const waPorAssoc = new Map(waRows.map((a) => [num(a.id), String(a.whatsapp_status ?? 'NAO_VERIFICADO')]));

  const lista = [...grupos.values()].map((g) => {
    let pix: string | null = null;
    try {
      pix = projeto.pix_chave && projeto.pix_favorecido && projeto.pix_cidade
        ? gerarPixCopiaECola({ chave: projeto.pix_chave, favorecido: projeto.pix_favorecido, cidade: projeto.pix_cidade, valor: g.total })
        : null;
    } catch { pix = null; }
    const msg = mensagemCobranca(projeto, g.nome, g.lote, g.itens, g.total, pix);
    return {
      ...g, pix_copia_e_cola: pix, mensagem: msg, whatsapp_status: waPorAssoc.get(g.associado_id) ?? 'NAO_VERIFICADO',
      whatsapp_url: g.telefone_e164 ? `https://wa.me/${g.telefone_e164.replace('+', '')}?text=${encodeURIComponent(msg)}` : null,
    };
  });
  return {
    projeto: { id: projeto.id, codigo: projeto.codigo, nome: projeto.nome, pix_chave: projeto.pix_chave },
    ate, gerado_em: hoje,
    total: centavos(lista.reduce((s, g) => s + g.total, 0)),
    associados: lista.length,
    lista,
  };
}
