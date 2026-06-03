// v3.54.0 — Mensagens do módulo Diligências (puro: templates + helpers).
// Sem date-fns (não está no projeto) — formatação pt-BR manual.
// O envio (Z-API) e o log em diligencias_mensagens ficam em integrations/diligencias.ts.
import type { DiligenciaFinalidade } from '../types/diligencia';

export const FINALIDADE_LABEL: Record<DiligenciaFinalidade, string> = {
  avaliacao:           'Avaliação de Imóvel',
  georreferenciamento: 'Georreferenciamento',
  desmembramento:      'Desmembramento',
  remembramento:       'Remembramento',
  averbacao:           'Averbação',
  vistoria:            'Vistoria Técnica',
  demarcacao:          'Demarcação de Lotes',
};

const ROMATEC_FONE = '(99) 9 9181-1246';

/** Date|string → "dd/MM/aaaa às HH:mm" (pt-BR). */
export function fmtDataHora(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} às ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

/** Remove tudo que não é dígito (+, espaços, traços, parênteses). */
export function normalizarTelefone(tel: string): string {
  return String(tel ?? '').replace(/\D+/g, '');
}

/** true quando o telefone normalizado tem entre 10 e 13 dígitos. */
export function telefoneValido(tel: string): boolean {
  const n = normalizarTelefone(tel).length;
  return n >= 10 && n <= 13;
}

export type RespostaCliente = 'sim' | 'remarcar' | 'nao';

/**
 * Classifica a resposta do cliente. Ignora acentos/caixa/pontuação.
 * SIM/confirmo → 'sim'; REMARCAR/remarcar/outro horario → 'remarcar';
 * NAO/cancelar → 'nao'; senão null.
 */
export function classificarResposta(texto: string): RespostaCliente | null {
  const t = String(texto ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acentos
    .toLowerCase().trim();
  if (!t) return null;
  if (/\b(sim|confirmo|confirmado|confirmar|ok|pode\s+vir|positivo)\b/.test(t)) return 'sim';
  if (/\b(remarcar|remarca|reagendar|outro\s+horario|outra\s+data|mudar)\b/.test(t)) return 'remarcar';
  if (/\b(nao|cancelar|cancela|cancelado|negativo)\b/.test(t)) return 'nao';
  return null;
}

export interface TemplateVars {
  nomeCliente: string;
  numProposta: string;
  finalidade: DiligenciaFinalidade;
  enderecoImovel: string | null;
  dataHora: Date | string;
}

/** Modelo A — confirmação inicial (WhatsApp markdown). */
export function montarMensagemConfirmacao(v: TemplateVars): string {
  const endereco = (v.enderecoImovel && v.enderecoImovel.trim())
    ? v.enderecoImovel.trim()
    : 'endereço constante na proposta';
  return [
    `Olá, *${v.nomeCliente}*! 👋`,
    ``,
    `Sou da *Romatec Consultoria Total* e entramos em contato referente à`,
    `*Proposta nº ${v.numProposta}* — ${FINALIDADE_LABEL[v.finalidade]} do imóvel`,
    `localizado em ${endereco}.`,
    ``,
    `📅 *Data sugerida:* ${fmtDataHora(v.dataHora)}`,
    ``,
    `Você confirma essa data para receber nossa equipe no imóvel?`,
    ``,
    `✅ *Responda SIM* para confirmar`,
    `🕐 *Responda REMARCAR* para sugerir outro horário`,
    `❌ *Responda NÃO* para cancelar`,
    ``,
    `_Romatec Consultoria Total — ${ROMATEC_FONE}_`,
  ].join('\n');
}

/** Modelo — lembrete D-1. */
export function montarMensagemLembrete(v: TemplateVars): string {
  return [
    `⏰ *Lembrete Romatec* — Sua visita técnica é *amanhã, ${fmtDataHora(v.dataHora)}*.`,
    ``,
    `📍 Finalidade: ${FINALIDADE_LABEL[v.finalidade]}`,
    `📋 Proposta nº ${v.numProposta}`,
    ``,
    `Dúvidas? ${ROMATEC_FONE}`,
  ].join('\n');
}
