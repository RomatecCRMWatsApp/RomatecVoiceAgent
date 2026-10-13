// v3.144.0 — PDF do boleto com layout Romatec a partir de um boleto Asaas já
// emitido (pa_boletos). Monta os dados do banco (lote, mapa, parcelas) e chama
// o gerador de layout (boletoRomatec.ts).
import { randomBytes } from 'node:crypto';
import { PaErro } from './erros';
import { pool, rows, one, exec, num, isoDate, hojeBrasil } from './paDb';
import { buscarProjeto, buscarAssociado, mapLancamento } from './paRepo';
import { desenhoDoProjeto } from './layoutDesenho';
import { configAsaas, numeroConta } from './asaas';
import { pdfBoletoRomatec, type DadosBoletoRomatec, type ModeloBoleto } from './boletoRomatec';

export function baseUrlPublica(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || 'https://romatecvoiceagent-production.up.railway.app').replace(/\/$/, '');
}
export function urlBoletoRomatec(token: string | null): string | null {
  return token ? `${baseUrlPublica()}/pa/boleto/${token}` : null;
}
export function novoToken(): string {
  return randomBytes(18).toString('base64url');
}

/** Garante token público (boletos emitidos antes da v3.144.0 não tinham). */
export async function garantirToken(boletoId: number): Promise<string> {
  const b = await one(pool, 'SELECT token_publico FROM pa_boletos WHERE id = ?', [boletoId]);
  if (!b) throw new PaErro('BOLETO_NAO_ENCONTRADO', 'Boleto não encontrado', 404);
  if (b.token_publico) return String(b.token_publico);
  const t = novoToken();
  await exec(pool, 'UPDATE pa_boletos SET token_publico = ? WHERE id = ? AND token_publico IS NULL', [t, boletoId]);
  const r = await one(pool, 'SELECT token_publico FROM pa_boletos WHERE id = ?', [boletoId]);
  return String(r?.token_publico ?? t);
}

// Agência/conta do Asaas muda raramente: cache de 6 h.
let contaCache: { valor: string; ate: number } | null = null;
async function agenciaCodigo(): Promise<string> {
  if (contaCache && contaCache.ate > Date.now()) return contaCache.valor;
  const cfg = configAsaas();
  let valor = process.env.ASAAS_AGENCIA_CODIGO || '—';
  if (cfg) {
    try {
      const c = await numeroConta(cfg);
      if (c.agency && c.account) valor = `${c.agency} / ${c.account}${c.accountDigit ? '-' + c.accountDigit : ''}`;
    } catch (e) {
      console.warn('[pa-boleto-pdf] agência/conta Asaas:', (e as Error).message);
    }
  }
  contaCache = { valor, ate: Date.now() + 6 * 3600_000 };
  return valor;
}

const ROTULO: Record<string, string> = { SINAL: 'Sinal', AVISTA: 'Pagamento à vista', AJUSTE: 'Ajuste' };

export async function dadosBoletoRomatec(boletoId: number): Promise<DadosBoletoRomatec> {
  const b = await one(pool, 'SELECT * FROM pa_boletos WHERE id = ?', [boletoId]);
  if (!b) throw new PaErro('BOLETO_NAO_ENCONTRADO', 'Boleto não encontrado', 404);
  if (!b.linha_digitavel) throw new PaErro('BOLETO_SEM_LINHA', 'Boleto sem linha digitável (o Asaas não devolveu na emissão) — use o PDF do Asaas', 409);
  const a = await buscarAssociado(num(b.associado_id));
  const projeto = await buscarProjeto(a.projeto_id);
  const lote = await one(pool, 'SELECT * FROM pa_lotes WHERE id = ?', [a.lote_id]);
  const lancs = (await rows(pool, `SELECT * FROM pa_lancamentos WHERE associado_id = ? AND status <> 'CANCELADO' ORDER BY FIELD(tipo,'SINAL','AVISTA','BOLETO','AJUSTE'), parcela`, [a.id])).map((l) => mapLancamento(l));
  const totBoletos = lancs.filter((l) => l.tipo === 'BOLETO').length;
  const rot = (l: { tipo: string; parcela: number }) => (l.tipo === 'BOLETO' ? `Parcela ${l.parcela}/${totBoletos}` : ROTULO[l.tipo] ?? l.tipo);
  const lancAtual = lancs.find((l) => l.id === num(b.lancamento_id));
  const lotesMapa = await rows(pool, 'SELECT numero, tipo, croqui_xy FROM pa_lotes WHERE projeto_id = ?', [projeto.id]);
  const lj = (projeto.layout_json ?? {}) as { responsavel_tecnico?: { empresa?: string; cnpj?: string; nome?: string; cft?: string; incra?: string } };
  const rt = lj.responsavel_tecnico ?? {};
  const multa = Math.round(num(b.valor) * projeto.boleto_multa_pct) / 100;
  const cep = (projeto.cep_padrao || '').replace(/^(\d{5})(\d{3})$/, '$1-$2');
  return {
    banco: { codigo: '461', nome: 'Asaas IP' },
    beneficiario: {
      nome: rt.empresa || 'Romatec Consultoria Total', documento: rt.cnpj || '17.261.987/0001-09',
      endereco: `${projeto.municipio}/${projeto.uf}`, agencia_codigo: await agenciaCodigo(),
    },
    pagador: {
      nome: a.nome, cpf: a.cpf,
      endereco: `${projeto.nome}, Lote ${a.lote}, S/N${a.denominacao_terra ? ' – ' + a.denominacao_terra : ''} – Zona Rural – ${projeto.municipio}/${projeto.uf}${cep ? ' – CEP ' + cep : ''}`,
    },
    projeto: { nome: projeto.nome, municipio: projeto.municipio, uf: projeto.uf },
    lote: {
      numero: String(lote?.numero ?? a.lote), area_m2: lote?.area_projeto_m2 == null ? null : num(lote.area_projeto_m2),
      largura_m: lote?.largura_m == null ? null : num(lote.largura_m), profundidade_m: lote?.profundidade_m == null ? null : num(lote.profundidade_m),
      terra: a.denominacao_terra, associado_numero: a.numero, xy: (lote?.croqui_xy as number[][] | null) ?? null,
    },
    parcela: {
      rotulo: lancAtual ? rot(lancAtual) : 'Parcela', valor: num(b.valor), vencimento: isoDate(b.vencimento) ?? hojeBrasil(),
      multa_valor: multa, juros_mes_pct: projeto.boleto_juros_mes_pct,
    },
    descricao: `${projeto.nome} – Lote ${a.lote} – ${lancAtual ? rot(lancAtual) : 'Parcela'} – ${a.numero}`,
    linha_digitavel: String(b.linha_digitavel),
    nosso_numero: String(b.nosso_numero ?? b.externo_id),
    numero_documento: String(b.externo_id).replace(/^pay_/, ''),
    data_documento: isoDate(b.criado_em) ?? hojeBrasil(),
    pix_copia_cola: (b.pix_copia_cola as string) ?? null,
    url_fatura: (b.url_fatura as string) ?? null,
    responsavel_tecnico: {
      nome: rt.nome || projeto.rt_nome || 'José Romário Pinto Bezerra',
      registro: ['Técnico em Agrimensura', rt.cft ? `CFT ${rt.cft}` : '', rt.incra ? `INCRA ${rt.incra}` : ''].filter(Boolean).join(' · ') || (projeto.rt_registro ?? ''),
    },
    parcelas: lancs.map((l) => ({ rotulo: rot(l), valor: l.valor, vencimento: l.vencimento, status: l.status === 'PAGO' ? 'PAGO' : l.status_efetivo })),
    mapa: {
      lotes: lotesMapa.filter((l) => Array.isArray(l.croqui_xy)).map((l) => ({ numero: String(l.numero), xy: l.croqui_xy as number[][], institucional: l.tipo === 'INSTITUCIONAL' })),
      desenho: desenhoDoProjeto(projeto.codigo, projeto.layout_json),
    },
    ambiente_teste: configAsaas()?.ambiente !== 'producao',
  };
}

export async function gerarPdfBoleto(boletoId: number, modelo: ModeloBoleto): Promise<{ pdf: Buffer; nome: string }> {
  const d = await dadosBoletoRomatec(boletoId);
  const pdf = await pdfBoletoRomatec(d, modelo);
  const nome = `BOLETO-${d.lote.associado_numero}-${d.parcela.rotulo.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`;
  return { pdf, nome };
}

export async function boletoPorToken(token: string): Promise<number> {
  if (!/^[A-Za-z0-9_-]{16,48}$/.test(token)) throw new PaErro('BOLETO_NAO_ENCONTRADO', 'Boleto não encontrado', 404);
  const b = await one(pool, "SELECT id, status FROM pa_boletos WHERE token_publico = ?", [token]);
  if (!b) throw new PaErro('BOLETO_NAO_ENCONTRADO', 'Boleto não encontrado', 404);
  if (b.status === 'CANCELADO') throw new PaErro('BOLETO_CANCELADO', 'Este boleto foi cancelado. Peça um novo à Romatec.', 410);
  return num(b.id);
}
