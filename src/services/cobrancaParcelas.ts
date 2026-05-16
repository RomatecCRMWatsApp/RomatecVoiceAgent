// v3.12.0 — Cobranca automatica de parcelas de pagamento de obra.
//
// Envia WhatsApp ao cliente da obra avisando do vencimento, atualiza
// status_cobranca da parcela, marca msg_id. Suporta:
//   - cobranca manual (botao "Cobrar agora" na UI)
//   - cobranca automatica (ticker diario que pega parcelas vencendo hoje/atrasadas)

import type { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import { sendReply as sendWhatsAppText } from '../integrations/whatsapp';
import { broadcastParcelaEvent } from '../agent/proactive';

interface ParcelaRow extends RowDataPacket {
  id: number;
  obra_id: number;
  numero: number;
  valor: string | number;
  vencimento: Date | string;
  pago: number;
  status_cobranca: 'pendente' | 'msg_enviada' | 'vencido_msg_enviada' | 'cliente_respondeu' | 'pago';
  obra_nome: string;
  cliente_nome: string | null;
  cliente_telefone: string | null;
}

function fmtMoedaBR(v: string | number): string {
  return Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function fmtDataBR(d: Date | string): string {
  const s = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [y, m, dd] = s.split('-');
  return `${dd}/${m}/${y}`;
}

function diasAtraso(vencimento: Date | string): number {
  const venc = new Date(typeof vencimento === 'string' ? vencimento : vencimento.toISOString());
  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);
  venc.setUTCHours(0, 0, 0, 0);
  return Math.floor((hoje.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24));
}

/** Monta texto formal de cobrança baseado no estado da parcela */
function montarTextoCobranca(p: ParcelaRow): string {
  const atraso = diasAtraso(p.vencimento);
  const vencido = atraso > 0;
  const nomeCliente = p.cliente_nome || 'Prezado(a) Cliente';
  const valor = `R$ ${fmtMoedaBR(p.valor)}`;
  const vencimento = fmtDataBR(p.vencimento);
  const obra = p.obra_nome;
  const parcela = `${p.numero}ª parcela`;

  if (!vencido) {
    return [
      `Prezado(a) ${nomeCliente},`,
      ``,
      `Lembramos que a *${parcela}* referente à obra *"${obra}"* vence em *${vencimento}*, no valor de *${valor}*.`,
      ``,
      `Para evitar atrasos e manter o cronograma da obra em dia, solicitamos a gentileza de efetuar o pagamento até a data prevista.`,
      ``,
      `Caso já tenha realizado o pagamento, por favor desconsidere esta mensagem ou nos envie o comprovante para conferência.`,
      ``,
      `Em caso de dúvidas, estamos à disposição.`,
      ``,
      `Atenciosamente,`,
      `*Romatec Consultoria Imobiliária — Engenharia e Agrimensura*`,
    ].join('\n');
  }

  // Vencida
  return [
    `Prezado(a) ${nomeCliente},`,
    ``,
    `Identificamos que a *${parcela}* referente à obra *"${obra}"*, no valor de *${valor}*, encontra-se *VENCIDA há ${atraso} dia(s)* (vencimento em ${vencimento}).`,
    ``,
    `Solicitamos a regularização do débito o quanto antes para que possamos manter a continuidade dos serviços contratados.`,
    ``,
    `Caso o pagamento já tenha sido efetuado, gentileza encaminhar o comprovante para baixarmos em nosso sistema. Caso contrário, ficamos à disposição para alinhar prazo de quitação.`,
    ``,
    `Aguardamos seu retorno.`,
    ``,
    `Atenciosamente,`,
    `*Romatec Consultoria Imobiliária — Engenharia e Agrimensura*`,
  ].join('\n');
}

async function buscarParcela(id: number): Promise<ParcelaRow | null> {
  const [rows] = await pool.query<ParcelaRow[]>(
    `SELECT p.*, o.nome AS obra_nome, o.cliente AS cliente_nome, o.cliente_telefone AS cliente_telefone
       FROM romatec_obra_parcelas p
       JOIN romatec_obras o ON o.id = p.obra_id
      WHERE p.id = ?
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

/** Preview da cobranca — devolve texto + telefone pra UI confirmar antes do envio. */
export async function previewCobrancaParcela(parcelaId: number): Promise<{
  parcela_id: number;
  cliente_nome: string | null;
  telefone: string;
  texto: string;
  vencido: boolean;
  dias_atraso: number;
  obra_nome: string;
  parcela_numero: number;
  valor: number;
  vencimento: string;
}> {
  const p = await buscarParcela(parcelaId);
  if (!p) throw new Error('Parcela nao encontrada.');
  if (p.pago) throw new Error('Parcela ja esta paga — nao precisa de cobranca.');
  const tel = String(p.cliente_telefone || '').replace(/\D/g, '');
  const atraso = diasAtraso(p.vencimento);
  return {
    parcela_id: parcelaId,
    cliente_nome: p.cliente_nome,
    telefone: tel,
    texto: montarTextoCobranca(p),
    vencido: atraso > 0,
    dias_atraso: atraso,
    obra_nome: p.obra_nome,
    parcela_numero: p.numero,
    valor: Number(p.valor),
    vencimento: typeof p.vencimento === 'string' ? p.vencimento.slice(0,10) : p.vencimento.toISOString().slice(0,10),
  };
}

/** Envia cobranca manual ou automatica pra UMA parcela. */
export async function enviarCobrancaParcela(
  parcelaId: number,
  overrides?: { texto?: string; telefone?: string }
): Promise<{
  ok: true;
  parcela_id: number;
  vencido: boolean;
  status_novo: string;
  enviado_para: string;
  message_id?: string;
}> {
  const p = await buscarParcela(parcelaId);
  if (!p) throw new Error('Parcela nao encontrada.');
  if (p.pago) throw new Error('Parcela ja esta paga — nao precisa de cobranca.');

  const telFonte = overrides?.telefone || p.cliente_telefone || '';
  if (!telFonte) throw new Error('Telefone nao informado e obra sem telefone do cliente.');

  const tel = String(telFonte).replace(/\D/g, '');
  if (tel.length < 10) throw new Error('Telefone invalido: ' + telFonte);

  const texto = (overrides?.texto && overrides.texto.trim()) || montarTextoCobranca(p);
  const r = await sendWhatsAppText(tel, texto);

  const vencido = diasAtraso(p.vencimento) > 0;
  const novoStatus = vencido ? 'vencido_msg_enviada' : 'msg_enviada';
  await pool.execute(
    `UPDATE romatec_obra_parcelas
        SET status_cobranca = ?,
            cobranca_enviada_em = NOW(),
            cobranca_msg_id = ?
      WHERE id = ?`,
    [novoStatus, r.messageId || null, parcelaId]
  );

  try {
    broadcastParcelaEvent({
      kind: 'cobrado',
      obra_id: String(p.obra_id),
      parcela_id: String(parcelaId),
      status_cobranca: novoStatus,
      ts: new Date().toISOString(),
    });
  } catch { /* nao bloqueia */ }

  return {
    ok: true,
    parcela_id: parcelaId,
    vencido,
    status_novo: novoStatus,
    enviado_para: tel,
    message_id: r.messageId,
  };
}

/**
 * Ticker: pega TODAS as parcelas onde:
 *   - pago = 0
 *   - status_cobranca IN ('pendente','msg_enviada','vencido_msg_enviada')
 *   - vencimento = hoje OU vencimento < hoje (atrasada e ainda nao "cliente_respondeu")
 *   - cobranca_enviada_em IS NULL OU foi ha mais de 3 dias (reenvio em atraso)
 */
export async function checkAndSendCobrancasDoDia(): Promise<{
  enviadas: number;
  falhas: Array<{ parcela_id: number; erro: string }>;
}> {
  const [rows] = await pool.query<ParcelaRow[]>(
    `SELECT p.*, o.nome AS obra_nome, o.cliente AS cliente_nome, o.cliente_telefone AS cliente_telefone
       FROM romatec_obra_parcelas p
       JOIN romatec_obras o ON o.id = p.obra_id
      WHERE p.pago = 0
        AND p.status_cobranca IN ('pendente','msg_enviada','vencido_msg_enviada')
        AND (
              p.vencimento <= CURDATE()
              OR DATEDIFF(p.vencimento, CURDATE()) BETWEEN 0 AND 0
            )
        AND (
              p.cobranca_enviada_em IS NULL
              OR p.cobranca_enviada_em < DATE_SUB(NOW(), INTERVAL 3 DAY)
            )
      ORDER BY p.vencimento ASC`
  );

  let enviadas = 0;
  const falhas: Array<{ parcela_id: number; erro: string }> = [];
  for (const p of rows) {
    try {
      await enviarCobrancaParcela(p.id);
      enviadas++;
      // pausa 1.5s entre disparos pra Z-API nao travar
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (err) {
      falhas.push({ parcela_id: p.id, erro: (err as Error).message });
    }
  }
  console.log(`[cobranca-parcelas] ticker: ${enviadas} enviadas, ${falhas.length} falhas (de ${rows.length} candidatas)`);
  return { enviadas, falhas };
}

/**
 * Quando o cliente responde via WhatsApp, identifica a parcela vencida
 * mais recente desse telefone, marca status='cliente_respondeu', encaminha
 * a mensagem pro CEO via Telegram. Chamado pelo webhook de WhatsApp.
 *
 * Retorna handled=true se conseguiu rotear (a parcela existia).
 */
export async function processarRespostaClienteParcela(input: {
  phone: string;
  text: string;
  messageId?: string;
}): Promise<{ handled: boolean; parcela_id?: number; cliente_nome?: string; obra_nome?: string }> {
  const tel = input.phone.replace(/\D/g, '');
  if (tel.length < 10) return { handled: false };

  // Busca a parcela vencida mais recente (status msg_enviada/vencido_msg_enviada)
  // do cliente desse telefone.
  const [rows] = await pool.query<ParcelaRow[]>(
    `SELECT p.*, o.nome AS obra_nome, o.cliente AS cliente_nome, o.cliente_telefone AS cliente_telefone
       FROM romatec_obra_parcelas p
       JOIN romatec_obras o ON o.id = p.obra_id
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(o.cliente_telefone, ' ', ''), '+', ''), '-', ''), '(', '') LIKE CONCAT('%', RIGHT(?, 11), '%')
        AND p.pago = 0
        AND p.status_cobranca IN ('msg_enviada','vencido_msg_enviada','cliente_respondeu')
      ORDER BY p.vencimento ASC
      LIMIT 1`,
    [tel]
  );
  if (rows.length === 0) return { handled: false };

  const p = rows[0];

  // Atualiza status_cobranca e grava resposta
  await pool.execute(
    `UPDATE romatec_obra_parcelas
        SET status_cobranca = 'cliente_respondeu',
            cliente_resposta_em = NOW(),
            cliente_resposta_texto = ?
      WHERE id = ?`,
    [input.text.slice(0, 2000), p.id]
  );

  try {
    broadcastParcelaEvent({
      kind: 'respondeu',
      obra_id: String(p.obra_id),
      parcela_id: String(p.id),
      status_cobranca: 'cliente_respondeu',
      ts: new Date().toISOString(),
    });
  } catch { /* nao bloqueia */ }

  // Encaminha pro CEO via Telegram
  try {
    const { sendMessage: sendTelegram } = await import('../integrations/telegram');
    const ceoChat = (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
      || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
    if (ceoChat) {
      const msg = `💬 *Cliente respondeu cobrança*\n\n` +
        `Obra: *${p.obra_nome}*\n` +
        `Cliente: ${p.cliente_nome || '—'} (${tel})\n` +
        `Parcela #${p.numero}: R$ ${fmtMoedaBR(p.valor)} venc. ${fmtDataBR(p.vencimento)}\n\n` +
        `Mensagem do cliente:\n_"${input.text.slice(0, 500)}"_`;
      await sendTelegram(ceoChat, msg);
    }
  } catch (err) {
    console.warn('[cobranca:resposta-cliente] falha ao notificar CEO:', (err as Error).message);
  }

  return {
    handled: true,
    parcela_id: p.id,
    cliente_nome: p.cliente_nome ?? undefined,
    obra_nome: p.obra_nome,
  };
}

/** Ticker — roda 1x/dia as 9h BRT (12h UTC) */
export function iniciarTickerCobrancaParcelas(): void {
  const checagem = async () => {
    try {
      await checkAndSendCobrancasDoDia();
    } catch (err) {
      console.error('[cobranca-parcelas-ticker]', err);
    }
  };
  // Primeiro check ao startup (com pequeno delay), depois 1x a cada 6h
  // (idempotente — so envia se vencimento <= hoje e nao reenvia em menos de 3 dias)
  setTimeout(() => { void checagem(); }, 60_000); // 1 min apos start
  setInterval(() => { void checagem(); }, 6 * 60 * 60 * 1000); // 6h
  console.log('[cobranca-parcelas] ticker iniciado (1x ao start + a cada 6h)');
}
