// v3.147.0 — Extrato por associado (recebido x em aberto) e fluxo de caixa do PA.
// Entradas dos associados = pa_pagamentos (lançados à mão, InfinitePay ou baixa
// do Asaas). Saídas e entradas avulsas = pa_caixa_movimentos (lançamento manual).
import { PaErro } from './erros';
import { pool, rows, one, exec, num, isoDate, hojeBrasil, registrarEvento } from './paDb';
import { buscarProjeto, mapLancamento } from './paRepo';
import { centavos } from './regrasFinanceiras';

// ─── Extrato por associado ────────────────────────────────────────────────
export type Situacao = 'QUITADO' | 'EM_ATRASO' | 'EM_DIA' | 'SEM_PLANO';

export function situacaoAssociado(t: { contratado: number; em_aberto: number; vencido: number }): Situacao {
  if (t.contratado <= 0) return 'SEM_PLANO';
  if (t.em_aberto <= 0) return 'QUITADO';
  return t.vencido > 0 ? 'EM_ATRASO' : 'EM_DIA';
}

const ROTULO: Record<string, string> = { SINAL: 'Sinal', AVISTA: 'À vista', BOLETO: 'Parcela', AJUSTE: 'Ajuste' };

export async function extratoAssociados(projetoId: number) {
  const projeto = await buscarProjeto(projetoId);
  const hoje = hojeBrasil();
  const assoc = await rows(pool, `
    SELECT a.id, a.numero, a.nome, a.telefone, lt.numero AS lote
    FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id
    WHERE a.projeto_id = ? AND a.ativo = 1 ORDER BY CAST(lt.numero AS UNSIGNED), lt.numero`, [projetoId]);
  const lancs = await rows(pool, `
    SELECT l.* FROM pa_lancamentos l JOIN pa_associados a ON a.id = l.associado_id AND a.ativo = 1
    WHERE a.projeto_id = ? AND l.status <> 'CANCELADO'
    ORDER BY FIELD(l.tipo,'SINAL','AVISTA','BOLETO','AJUSTE'), l.parcela`, [projetoId]);
  const ultimos = await rows(pool, `
    SELECT l.associado_id, DATE_FORMAT(MAX(p.pago_em), '%Y-%m-%d') AS ultimo, COUNT(DISTINCT p.id) AS n
    FROM pa_pagamento_rateio r JOIN pa_pagamentos p ON p.id = r.pagamento_id JOIN pa_lancamentos l ON l.id = r.lancamento_id
    WHERE p.projeto_id = ? GROUP BY l.associado_id`, [projetoId]);
  const ultPor = new Map(ultimos.map((u) => [num(u.associado_id), { data: (u.ultimo as string) ?? null, n: num(u.n) }]));
  const porAssoc = new Map<number, ReturnType<typeof mapLancamento>[]>();
  for (const r of lancs) {
    const l = mapLancamento(r, hoje);
    if (!porAssoc.has(l.associado_id)) porAssoc.set(l.associado_id, []);
    porAssoc.get(l.associado_id)!.push(l);
  }

  const lista = assoc.map((a) => {
    const ls = porAssoc.get(num(a.id)) ?? [];
    let contratado = 0, recebido = 0, em_aberto = 0, vencido = 0;
    for (const l of ls) {
      contratado += l.valor; recebido += l.valor_recebido; em_aberto += l.saldo;
      if (l.status_efetivo === 'VENCIDO' || (l.status_efetivo === 'PARCIAL' && l.vencimento && l.vencimento < hoje)) vencido += l.saldo;
    }
    const t = { contratado: centavos(contratado), recebido: centavos(recebido), em_aberto: centavos(em_aberto), vencido: centavos(vencido) };
    const ult = ultPor.get(num(a.id));
    return {
      associado_id: num(a.id), numero: String(a.numero), nome: String(a.nome), lote: String(a.lote), telefone: (a.telefone as string) ?? null,
      ...t, a_vencer: centavos(t.em_aberto - t.vencido),
      pct_pago: t.contratado > 0 ? Math.round((t.recebido / t.contratado) * 1000) / 10 : 0,
      situacao: situacaoAssociado(t),
      ultimo_pagamento: ult?.data ?? null, pagamentos: ult?.n ?? 0,
      parcelas: ls.map((l) => ({
        lancamento_id: l.id, rotulo: `${ROTULO[l.tipo] ?? l.tipo}${l.tipo === 'BOLETO' ? ` ${l.parcela}` : ''}`,
        valor: l.valor, recebido: l.valor_recebido, saldo: l.saldo, vencimento: l.vencimento, status: l.status_efetivo,
      })),
    };
  });
  const soma = (k: 'contratado' | 'recebido' | 'em_aberto' | 'vencido' | 'a_vencer') => centavos(lista.reduce((s, x) => s + x[k], 0));
  const cont = (s: Situacao) => lista.filter((x) => x.situacao === s).length;
  return {
    projeto: { id: projeto.id, codigo: projeto.codigo, nome: projeto.nome },
    posicao_em: hoje,
    totais: {
      associados: lista.length, contratado: soma('contratado'), recebido: soma('recebido'), em_aberto: soma('em_aberto'),
      vencido: soma('vencido'), a_vencer: soma('a_vencer'),
      quitados: cont('QUITADO'), em_dia: cont('EM_DIA'), em_atraso: cont('EM_ATRASO'), sem_plano: cont('SEM_PLANO'),
    },
    lista,
  };
}

// ─── Fluxo de caixa ───────────────────────────────────────────────────────
export interface Movimento {
  data: string;                       // aaaa-mm-dd
  tipo: 'ENTRADA' | 'SAIDA';
  origem: 'ASSOCIADO' | 'MANUAL';
  valor: number;
}
export interface LinhaFluxo { periodo: string; entradas_associados: number; entradas_avulsas: number; saidas: number; saldo_periodo: number; saldo_acumulado: number }

/** Agrupa os movimentos por dia ou mês e calcula o saldo acumulado a partir do saldo inicial. */
export function montarFluxo(movs: Movimento[], saldoInicial: number, agrupar: 'dia' | 'mes'): LinhaFluxo[] {
  const chave = (d: string) => (agrupar === 'mes' ? d.slice(0, 7) : d.slice(0, 10));
  const mapa = new Map<string, { ea: number; em: number; s: number }>();
  for (const m of movs) {
    const k = chave(m.data);
    const g = mapa.get(k) ?? { ea: 0, em: 0, s: 0 };
    if (m.tipo === 'SAIDA') g.s += m.valor;
    else if (m.origem === 'ASSOCIADO') g.ea += m.valor;
    else g.em += m.valor;
    mapa.set(k, g);
  }
  let acum = saldoInicial;
  return [...mapa.keys()].sort().map((k) => {
    const g = mapa.get(k)!;
    const saldo = centavos(g.ea + g.em - g.s);
    acum = centavos(acum + saldo);
    return { periodo: k, entradas_associados: centavos(g.ea), entradas_avulsas: centavos(g.em), saidas: centavos(g.s), saldo_periodo: saldo, saldo_acumulado: acum };
  });
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function fluxoCaixa(projetoId: number, deIso: string | null, ateIso: string | null, agrupar: 'dia' | 'mes' = 'mes') {
  const projeto = await buscarProjeto(projetoId);
  const hoje = hojeBrasil();
  const de = deIso && DATA_RE.test(deIso) ? deIso : '2000-01-01';
  const ate = ateIso && DATA_RE.test(ateIso) ? ateIso : hoje;
  if (de > ate) throw new PaErro('CAMPO_INVALIDO', 'Data inicial depois da final', 400);

  const pags = await rows(pool, `
    SELECT p.id, DATE_FORMAT(p.pago_em, '%Y-%m-%d') AS data, DATE_FORMAT(p.pago_em, '%H:%i') AS hora, p.forma, p.valor, p.pagador_nome,
      GROUP_CONCAT(DISTINCT lt.numero ORDER BY lt.numero SEPARATOR ', ') AS lotes,
      GROUP_CONCAT(DISTINCT a.nome ORDER BY lt.numero SEPARATOR ' / ') AS associados
    FROM pa_pagamentos p
    LEFT JOIN pa_pagamento_rateio r ON r.pagamento_id = p.id
    LEFT JOIN pa_lancamentos l ON l.id = r.lancamento_id
    LEFT JOIN pa_associados a ON a.id = l.associado_id
    LEFT JOIN pa_lotes lt ON lt.id = a.lote_id
    WHERE p.projeto_id = ? AND DATE(p.pago_em) BETWEEN ? AND ? GROUP BY p.id ORDER BY p.pago_em, p.id`, [projetoId, de, ate]);
  const manuais = await rows(pool, `
    SELECT id, tipo, DATE_FORMAT(data, '%Y-%m-%d') AS data, categoria, descricao, valor, forma, favorecido, criado_por
    FROM pa_caixa_movimentos WHERE projeto_id = ? AND excluido_em IS NULL AND data BETWEEN ? AND ? ORDER BY data, id`, [projetoId, de, ate]);
  const antes = await one(pool, `
    SELECT
      (SELECT COALESCE(SUM(valor), 0) FROM pa_pagamentos WHERE projeto_id = ? AND DATE(pago_em) < ?) +
      (SELECT COALESCE(SUM(CASE WHEN tipo = 'ENTRADA' THEN valor ELSE -valor END), 0) FROM pa_caixa_movimentos WHERE projeto_id = ? AND excluido_em IS NULL AND data < ?) AS saldo`,
  [projetoId, de, projetoId, de]);
  const saldoInicial = centavos(num(antes?.saldo));

  const extrato = [
    ...pags.map((p) => ({
      id: num(p.id), fonte: 'PAGAMENTO' as const, data: String(p.data), hora: (p.hora as string) ?? null, tipo: 'ENTRADA' as const,
      categoria: 'Associados', descricao: p.lotes ? `Lote ${p.lotes} — ${p.associados ?? ''}` : (p.pagador_nome as string) ?? 'Pagamento',
      forma: String(p.forma), valor: num(p.valor),
    })),
    ...manuais.map((m) => ({
      id: num(m.id), fonte: 'MANUAL' as const, data: String(m.data), hora: null, tipo: String(m.tipo) as 'ENTRADA' | 'SAIDA',
      categoria: String(m.categoria), descricao: String(m.descricao) + (m.favorecido ? ` — ${m.favorecido}` : ''),
      forma: (m.forma as string) ?? null, valor: num(m.valor),
    })),
  ].sort((a, b) => (a.data + (a.hora ?? '')).localeCompare(b.data + (b.hora ?? '')));
  let acum = saldoInicial;
  const extratoComSaldo = extrato.map((m) => { acum = centavos(acum + (m.tipo === 'SAIDA' ? -m.valor : m.valor)); return { ...m, saldo: acum }; });

  const periodos = montarFluxo(extrato.map((m) => ({ data: m.data, tipo: m.tipo, origem: m.fonte === 'PAGAMENTO' ? 'ASSOCIADO' : 'MANUAL', valor: m.valor })), saldoInicial, agrupar);
  const somaSe = (f: (m: typeof extrato[number]) => boolean) => centavos(extrato.filter(f).reduce((s, m) => s + m.valor, 0));
  const agrupa = (lista: typeof extrato, k: (m: typeof extrato[number]) => string) => {
    const g = new Map<string, number>();
    for (const m of lista) g.set(k(m), centavos((g.get(k(m)) ?? 0) + m.valor));
    return [...g.entries()].map(([chave, total]) => ({ chave, total })).sort((a, b) => b.total - a.total);
  };

  // Previsão: o que ainda está para entrar (lançamentos em aberto) por mês de vencimento.
  const prev = await rows(pool, `
    SELECT CASE WHEN l.vencimento IS NULL OR l.vencimento < ? THEN 'ATRASADO' ELSE DATE_FORMAT(l.vencimento, '%Y-%m') END AS mes,
      SUM(l.valor - l.valor_recebido) AS saldo, COUNT(*) AS n
    FROM pa_lancamentos l JOIN pa_associados a ON a.id = l.associado_id AND a.ativo = 1
    WHERE a.projeto_id = ? AND l.status NOT IN ('PAGO','CANCELADO') AND l.valor > l.valor_recebido
    GROUP BY mes ORDER BY mes = 'ATRASADO' DESC, mes`, [hoje, projetoId]);

  const entradas = somaSe((m) => m.tipo === 'ENTRADA');
  const saidas = somaSe((m) => m.tipo === 'SAIDA');
  return {
    projeto: { id: projeto.id, codigo: projeto.codigo, nome: projeto.nome },
    de, ate, agrupar, saldo_inicial: saldoInicial,
    totais: {
      entradas, entradas_associados: somaSe((m) => m.fonte === 'PAGAMENTO'), entradas_avulsas: somaSe((m) => m.fonte === 'MANUAL' && m.tipo === 'ENTRADA'),
      saidas, resultado: centavos(entradas - saidas), saldo_final: centavos(saldoInicial + entradas - saidas),
    },
    periodos,
    por_forma: agrupa(extrato.filter((m) => m.tipo === 'ENTRADA'), (m) => m.forma ?? 'NÃO INFORMADA'),
    saidas_por_categoria: agrupa(extrato.filter((m) => m.tipo === 'SAIDA'), (m) => m.categoria),
    previsao: prev.map((r) => ({ mes: String(r.mes), saldo: centavos(num(r.saldo)), lancamentos: num(r.n) })),
    extrato: extratoComSaldo,
  };
}

// ─── Movimentos manuais ───────────────────────────────────────────────────
export const CATEGORIAS_SAIDA = ['Cartório / registro', 'Combustível / deslocamento', 'Equipe de campo', 'Material / marcos', 'Taxas bancárias / Asaas', 'Impostos', 'Repasse à associação', 'Outras despesas'];
export const CATEGORIAS_ENTRADA = ['Doação / contribuição', 'Taxa avulsa', 'Ajuste de caixa', 'Outras entradas'];

export function lerMovimento(body: Record<string, unknown>) {
  const tipo = String(body.tipo ?? 'SAIDA').toUpperCase();
  if (tipo !== 'ENTRADA' && tipo !== 'SAIDA') throw new PaErro('CAMPO_INVALIDO', 'tipo deve ser ENTRADA ou SAIDA', 400);
  const data = String(body.data ?? '').slice(0, 10);
  if (!DATA_RE.test(data)) throw new PaErro('CAMPO_INVALIDO', 'data inválida (aaaa-mm-dd)', 400);
  // Aceita número ou texto BR ("1.234,56"); texto sem vírgula é lido como decimal com ponto.
  const bruto = body.valor;
  const txtValor = String(bruto ?? '').trim();
  const valor = centavos(typeof bruto === 'number' ? bruto
    : txtValor.includes(',') ? Number(txtValor.replace(/\./g, '').replace(',', '.')) || 0 : Number(txtValor) || 0);
  if (!(valor > 0)) throw new PaErro('CAMPO_INVALIDO', 'valor deve ser maior que zero', 400);
  const txt = (v: unknown, max: number) => { const t = v == null ? '' : String(v).trim(); return t ? t.slice(0, max) : null; };
  const descricao = txt(body.descricao, 255);
  if (!descricao) throw new PaErro('CAMPO_INVALIDO', 'descrição obrigatória', 400);
  return {
    tipo: tipo as 'ENTRADA' | 'SAIDA', data, valor, descricao,
    categoria: txt(body.categoria, 60) ?? (tipo === 'SAIDA' ? 'Outras despesas' : 'Outras entradas'),
    forma: txt(body.forma, 20), favorecido: txt(body.favorecido, 160),
  };
}

export async function lancarMovimento(projetoId: number, body: Record<string, unknown>, usuario: string | null) {
  await buscarProjeto(projetoId);
  const m = lerMovimento(body);
  const r = await exec(pool, `INSERT INTO pa_caixa_movimentos (projeto_id, tipo, data, categoria, descricao, valor, forma, favorecido, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [projetoId, m.tipo, m.data, m.categoria, m.descricao, m.valor, m.forma, m.favorecido, usuario]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: `CAIXA_${m.tipo}`, dados: { id: r.insertId, ...m } });
  return { id: r.insertId, ...m };
}

export async function excluirMovimento(movId: number, usuario: string | null) {
  const m = await one(pool, 'SELECT * FROM pa_caixa_movimentos WHERE id = ? AND excluido_em IS NULL', [movId]);
  if (!m) throw new PaErro('NAO_ENCONTRADO', 'Movimento não encontrado', 404);
  await exec(pool, 'UPDATE pa_caixa_movimentos SET excluido_em = NOW(), excluido_por = ? WHERE id = ?', [usuario, movId]);
  await registrarEvento(pool, { projeto_id: num(m.projeto_id), usuario, tipo: 'CAIXA_EXCLUIDO', dados: { id: movId, tipo: m.tipo, valor: num(m.valor), data: isoDate(m.data), descricao: m.descricao } });
  return { ok: true };
}
