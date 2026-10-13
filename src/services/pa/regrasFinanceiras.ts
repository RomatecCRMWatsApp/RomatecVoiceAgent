// v3.142.0 — Regras financeiras do módulo PA (regras-e-conferencias.md §Pagamentos
// e spec §5.4/§5.5). Funções puras — o repositório só persiste o resultado.

export type TipoLancamento = 'SINAL' | 'BOLETO' | 'AVISTA' | 'AJUSTE';
export type StatusLancamento = 'A_PAGAR' | 'PARCIAL' | 'PAGO' | 'A_VENCER' | 'VENCIDO' | 'CANCELADO';

export interface ParcelaPlanejada {
  tipo: TipoLancamento;
  parcela: number;
  valor: number;
  vencimento: string | null; // aaaa-mm-dd
}

export interface ProjetoValores {
  valor_lote: number;
  sinal_padrao: number;
  boleto_padrao: number;
  prazo_sinal: string | null;
}

export const ENTRADA_PARCELA_UNICA = 500;

export function centavos(v: number): number {
  return Math.round(Number(v) * 100) / 100;
}

/** Soma `meses` a uma data ISO fixando o dia (clamp no fim do mês: 31 → 30/28). */
export function vencimentoMensal(baseIso: string, meses: number, dia: number): string {
  const [a, m] = baseIso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(Math.max(1, dia), ultimo));
  return alvo.toISOString().slice(0, 10);
}

/**
 * Plano de pagamento a partir do sinal efetivamente combinado:
 *   sinal ≥ valor do lote  → à vista (1 lançamento AVISTA);
 *   sinal = padrão         → 2 boletos do valor padrão do projeto;
 *   sinal ≥ R$ 500         → 1 boleto com o saldo  (500→1×500; 650→1×350);
 *   senão                  → 2 parcelas iguais     (350→2×325; 400→2×300).
 * Boletos vencem no `diaVencimento` dos 2 meses seguintes à data-base.
 */
export function planoPagamento(
  proj: ProjetoValores,
  sinal: number,
  diaVencimento: number | null,
  dataBaseIso: string,
): ParcelaPlanejada[] {
  const valorLote = centavos(proj.valor_lote);
  const s = centavos(sinal);
  if (!(s > 0)) throw new Error('Sinal deve ser maior que zero');
  if (s >= valorLote) return [{ tipo: 'AVISTA', parcela: 0, valor: valorLote, vencimento: proj.prazo_sinal }];

  const dia = diaVencimento && diaVencimento >= 1 && diaVencimento <= 31 ? diaVencimento : 10;
  const plano: ParcelaPlanejada[] = [{ tipo: 'SINAL', parcela: 0, valor: s, vencimento: proj.prazo_sinal }];
  const saldo = centavos(valorLote - s);

  let parcelas: number[];
  if (s === centavos(proj.sinal_padrao) && centavos(proj.boleto_padrao * 2) === saldo) {
    parcelas = [centavos(proj.boleto_padrao), centavos(proj.boleto_padrao)];
  } else if (s >= ENTRADA_PARCELA_UNICA) {
    parcelas = [saldo];
  } else {
    const p1 = Math.floor((saldo / 2) * 100) / 100;
    parcelas = [p1, centavos(saldo - p1)];
  }
  parcelas.forEach((v, i) =>
    plano.push({ tipo: 'BOLETO', parcela: i + 1, valor: v, vencimento: vencimentoMensal(dataBaseIso, i + 1, dia) }),
  );
  return plano;
}

export interface LancamentoValores {
  tipo: TipoLancamento;
  valor: number;
  valor_recebido: number;
  status: StatusLancamento;
  vencimento: string | null;
}

export function saldoLancamento(l: Pick<LancamentoValores, 'valor' | 'valor_recebido' | 'status'>): number {
  if (l.status === 'CANCELADO') return 0;
  return Math.max(0, centavos(Number(l.valor) - Number(l.valor_recebido || 0)));
}

/** Status após receber um valor (PAGO quando quita, PARCIAL quando sobra saldo). */
export function statusAposRecebimento(valor: number, recebido: number, statusAtual: StatusLancamento): StatusLancamento {
  if (statusAtual === 'CANCELADO') return 'CANCELADO';
  if (centavos(recebido) >= centavos(valor) - 0.009) return 'PAGO';
  if (recebido > 0) return 'PARCIAL';
  return statusAtual;
}

/**
 * Status "de exibição": o banco guarda A_VENCER/A_PAGAR; o vencido é calculado na
 * leitura (nada de job pra virar status). Pago/parcial/cancelado não mudam.
 */
export function statusEfetivo(l: LancamentoValores, hojeIso: string): StatusLancamento {
  if (l.status === 'PAGO' || l.status === 'CANCELADO' || l.status === 'PARCIAL') return l.status;
  if (l.vencimento && l.vencimento < hojeIso) return 'VENCIDO';
  return l.status;
}

export interface Rateio {
  lancamento_id: number;
  valor: number;
}

/**
 * Distribui `valor` nos lançamentos em aberto, na ordem recebida (sinal antes dos
 * boletos). Usado quando o operador não informa o rateio explicitamente.
 */
export function ratearAutomatico(
  valor: number,
  abertos: Array<{ id: number; saldo: number }>,
): Rateio[] {
  let resta = centavos(valor);
  const out: Rateio[] = [];
  for (const l of abertos) {
    if (resta <= 0) break;
    const v = centavos(Math.min(resta, l.saldo));
    if (v > 0) {
      out.push({ lancamento_id: l.id, valor: v });
      resta = centavos(resta - v);
    }
  }
  return out;
}
