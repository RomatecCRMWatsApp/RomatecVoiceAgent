// v1.73.0 — Triggers automáticos de recibo.
//
// Quando um evento de negócio acontece (parcela paga, proposta aceita, etc),
// o sistema cria recibo automaticamente — se o tenant ligar essa config.
//
// Filosofia:
//   - SEMPRE async/non-blocking. Falha do trigger NÃO falha a operação principal.
//   - Idempotente. Mesma parcela paga 2× só gera 1 recibo (resource_id único).
//   - Configurável por tenant via tenant_settings.auto_recibo_em JSON.
//
// Eventos suportados (atual):
//   parcela_paga      → tipo='parcela', destinatário = cliente da obra
//
// Próximos:
//   proposta_aceita   → tipo='proposta', destinatário = cliente
//   etapa_concluida   → tipo='etapa', destinatário = cliente
//   despesa_criada    → tipo='despesa', destinatário = quem reembolsa

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { criarRecibo, enviarReciboWhatsApp, listarRecibos } from '../integrations/recibos';

export type EventoTrigger =
  | 'parcela_paga'
  | 'proposta_aceita'
  | 'etapa_concluida'
  | 'despesa_criada'
  | 'vistoria_entregue';

export interface TriggerConfig {
  enabled: boolean;
  auto_enviar?: boolean;     // se true, dispara WhatsApp imediato
  validade_dias?: number;    // default 7
}

const DEFAULT_CONFIG: Record<EventoTrigger, TriggerConfig> = {
  parcela_paga:     { enabled: false, auto_enviar: false, validade_dias: 7 },
  proposta_aceita:  { enabled: false, auto_enviar: false, validade_dias: 7 },
  etapa_concluida:  { enabled: false, auto_enviar: false, validade_dias: 7 },
  despesa_criada:   { enabled: false, auto_enviar: false, validade_dias: 30 },
  vistoria_entregue:{ enabled: false, auto_enviar: false, validade_dias: 7 },
};

interface TenantConfigRow extends RowDataPacket {
  auto_recibo_em: string | null | Record<string, unknown>;
}

/** Lê configuração de triggers do tenant. Default: tudo desligado. */
export async function getTriggerConfig(
  tenant_id: number,
  evento: EventoTrigger
): Promise<TriggerConfig> {
  try {
    const [rows] = await pool.execute<TenantConfigRow[]>(
      `SELECT auto_recibo_em FROM tenant_settings WHERE tenant_id = ? LIMIT 1`,
      [tenant_id]
    );
    if (!rows.length || !rows[0].auto_recibo_em) return { ...DEFAULT_CONFIG[evento] };
    const raw = rows[0].auto_recibo_em;
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...DEFAULT_CONFIG[evento], ...(cfg[evento] || {}) };
  } catch (err) {
    console.warn(`[triggers] erro lendo config ${evento}:`, (err as Error).message);
    return { ...DEFAULT_CONFIG[evento] };
  }
}

/** Atualiza/seta config de um trigger específico (merge). */
export async function setTriggerConfig(
  tenant_id: number,
  evento: EventoTrigger,
  cfg: Partial<TriggerConfig>
): Promise<void> {
  const [rows] = await pool.execute<TenantConfigRow[]>(
    `SELECT auto_recibo_em FROM tenant_settings WHERE tenant_id = ? LIMIT 1`, [tenant_id]
  );
  const atual = rows.length && rows[0].auto_recibo_em
    ? (typeof rows[0].auto_recibo_em === 'string'
        ? JSON.parse(rows[0].auto_recibo_em)
        : rows[0].auto_recibo_em)
    : {};
  atual[evento] = { ...DEFAULT_CONFIG[evento], ...(atual[evento] || {}), ...cfg };
  await pool.execute(
    `UPDATE tenant_settings SET auto_recibo_em = ? WHERE tenant_id = ?`,
    [JSON.stringify(atual), tenant_id]
  );
}

/** Lê todos triggers de uma vez (pra UI). */
export async function getTodosTriggers(tenant_id: number): Promise<Record<EventoTrigger, TriggerConfig>> {
  const result = {} as Record<EventoTrigger, TriggerConfig>;
  for (const evento of Object.keys(DEFAULT_CONFIG) as EventoTrigger[]) {
    result[evento] = await getTriggerConfig(tenant_id, evento);
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────
// Trigger: parcela paga
// ────────────────────────────────────────────────────────────────────────

interface ParcelaTriggerRow extends RowDataPacket {
  id: number; numero: number; valor: string; vencimento: Date;
  obra_id: number; obra_nome: string;
  cliente: string | null; cliente_telefone: string | null;
}

/**
 * Disparar quando parcela.pago = 1.
 * Idempotente: se já existe recibo pra essa parcela, ignora.
 *
 * NÃO LANÇA — falha aqui não bloqueia o UPDATE da parcela.
 */
export async function gerarReciboParcelaPaga(parcela_id: number, tenant_id = 1): Promise<void> {
  try {
    const cfg = await getTriggerConfig(tenant_id, 'parcela_paga');
    if (!cfg.enabled) {
      return; // trigger desligado pra esse tenant
    }

    // Idempotência: já existe recibo pra essa parcela?
    const existentes = await listarRecibos({
      tenant_id, tipo: 'parcela',
      resource_type: 'romatec_obra_parcelas',
      resource_id: String(parcela_id),
    });
    if (existentes.length > 0) {
      console.log(`[trigger:parcela_paga] parcela #${parcela_id} ja tem recibo — ignorando`);
      return;
    }

    // Busca dados da parcela + obra + cliente
    const [rows] = await pool.execute<ParcelaTriggerRow[]>(
      `SELECT p.id, p.numero, p.valor, p.vencimento,
              p.obra_id, o.nome AS obra_nome,
              o.cliente, o.cliente_telefone
         FROM romatec_obra_parcelas p
         JOIN romatec_obras o ON o.id = p.obra_id
        WHERE p.id = ?`,
      [parcela_id]
    );
    if (!rows.length) {
      console.warn(`[trigger:parcela_paga] parcela #${parcela_id} nao encontrada`);
      return;
    }
    const p = rows[0];
    if (!p.cliente_telefone || p.cliente_telefone.replace(/\D/g, '').length < 10) {
      console.warn(`[trigger:parcela_paga] obra ${p.obra_nome} sem telefone — ignorando`);
      return;
    }

    const novo = await criarRecibo({
      tenant_id,
      tipo: 'parcela',
      resource_type: 'romatec_obra_parcelas',
      resource_id: String(parcela_id),
      destinatario_nome: p.cliente || 'Cliente',
      destinatario_phone: p.cliente_telefone,
      valor: Number(p.valor),
      forma_pagamento: 'pix',
      descricao_servico: `Parcela ${p.numero} da obra ${p.obra_nome}`,
      expira_em_dias: cfg.validade_dias ?? 7,
    });
    console.log(`[trigger:parcela_paga] recibo ${novo.numero} criado pra parcela #${parcela_id}`);

    if (cfg.auto_enviar) {
      try {
        await enviarReciboWhatsApp({ id: novo.id });
        console.log(`[trigger:parcela_paga] enviado WhatsApp pra ${p.cliente_telefone}`);
      } catch (err) {
        console.warn(`[trigger:parcela_paga] falha auto-enviar:`, (err as Error).message);
      }
    }
  } catch (err) {
    // Falha do trigger NUNCA propaga — apenas loga
    console.error(`[trigger:parcela_paga] FALHA pra parcela #${parcela_id}:`, (err as Error).message);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Trigger: etapa concluida
// ────────────────────────────────────────────────────────────────────────

interface EtapaTriggerRow extends RowDataPacket {
  id: number; nome: string; ordem: number;
  obra_id: number; obra_nome: string;
  cliente: string | null; cliente_telefone: string | null;
}

/**
 * Disparar quando etapa.status = 'concluido'.
 * Cliente recebe recibo de aceite — confirmacao libera proxima etapa.
 *
 * Idempotente: 1 recibo por etapa. Nao lanca.
 */
export async function gerarReciboEtapaConcluida(etapa_id: number, tenant_id = 1): Promise<void> {
  try {
    const cfg = await getTriggerConfig(tenant_id, 'etapa_concluida');
    if (!cfg.enabled) return;

    const existentes = await listarRecibos({
      tenant_id, tipo: 'etapa',
      resource_type: 'romatec_obra_etapas',
      resource_id: String(etapa_id),
    });
    if (existentes.length > 0) {
      console.log(`[trigger:etapa_concluida] etapa #${etapa_id} ja tem recibo — ignorando`);
      return;
    }

    const [rows] = await pool.execute<EtapaTriggerRow[]>(
      `SELECT e.id, e.nome, e.ordem,
              e.obra_id, o.nome AS obra_nome,
              o.cliente, o.cliente_telefone
         FROM romatec_obra_etapas e
         JOIN romatec_obras o ON o.id = e.obra_id
        WHERE e.id = ?`,
      [etapa_id]
    );
    if (!rows.length) {
      console.warn(`[trigger:etapa_concluida] etapa #${etapa_id} nao encontrada`);
      return;
    }
    const e = rows[0];
    if (!e.cliente_telefone || e.cliente_telefone.replace(/\D/g, '').length < 10) {
      console.warn(`[trigger:etapa_concluida] obra ${e.obra_nome} sem telefone — ignorando`);
      return;
    }

    const novo = await criarRecibo({
      tenant_id,
      tipo: 'etapa',
      resource_type: 'romatec_obra_etapas',
      resource_id: String(etapa_id),
      destinatario_nome: e.cliente || 'Cliente',
      destinatario_phone: e.cliente_telefone,
      descricao_servico: `Etapa "${e.nome}" da obra ${e.obra_nome}`,
      expira_em_dias: cfg.validade_dias ?? 7,
    });
    console.log(`[trigger:etapa_concluida] recibo ${novo.numero} criado pra etapa #${etapa_id}`);

    if (cfg.auto_enviar) {
      try {
        await enviarReciboWhatsApp({ id: novo.id });
        console.log(`[trigger:etapa_concluida] WhatsApp enviado pra ${e.cliente_telefone}`);
      } catch (err) {
        console.warn(`[trigger:etapa_concluida] falha auto-enviar:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error(`[trigger:etapa_concluida] FALHA pra etapa #${etapa_id}:`, (err as Error).message);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Trigger: proposta aceita
// ────────────────────────────────────────────────────────────────────────

import type { Recibo } from '../integrations/recibos';

interface PropostaRow extends RowDataPacket {
  id: number; numero: string; status: string;
  valor_total: string;
  cliente_id: number; cliente_nome: string;
}

/**
 * Disparar quando recibo tipo='proposta' for confirmado.
 * - Atualiza propostas.status = 'aceita'
 * - Notifica CEO via Telegram com resumo
 *
 * recibo.resource_type pode ser 'propostas' ou 'propostas_consultoria'
 */
export async function processarPropostaAceita(recibo: Recibo): Promise<void> {
  try {
    const cfg = await getTriggerConfig(recibo.tenant_id, 'proposta_aceita');
    if (!cfg.enabled) return;

    const proposta_id = Number(recibo.resource_id);
    if (!proposta_id) return;
    const isConsultoria = recibo.resource_type === 'propostas_consultoria';
    const tabela = isConsultoria ? 'propostas_consultoria' : 'propostas';

    // 1) Atualiza status
    try {
      await pool.execute(
        `UPDATE ${tabela} SET status = 'aceita' WHERE id = ? AND status IN ('enviada','rascunho')`,
        [proposta_id]
      );
      console.log(`[trigger:proposta_aceita] ${tabela} #${proposta_id} -> status='aceita'`);
    } catch (err) {
      console.warn(`[trigger:proposta_aceita] falha update status:`, (err as Error).message);
    }

    // 2) Busca dados pra notificacao
    let nomeProposta = '';
    let valor = 0;
    try {
      const [rows] = await pool.execute<PropostaRow[]>(
        `SELECT p.numero, p.valor_total, p.cliente_id,
                c.nome AS cliente_nome
           FROM ${tabela} p
           LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
          WHERE p.id = ?`,
        [proposta_id]
      );
      if (rows.length) {
        nomeProposta = rows[0].numero;
        valor = Number(rows[0].valor_total) || 0;
      }
    } catch { /* ignora */ }

    // 3) Notifica CEO via Telegram
    try {
      const { sendMessage } = await import('../integrations/telegram');
      const chatId = (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
        || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
      if (chatId) {
        const valorFmt = 'R$ ' + valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        const texto = [
          `🎉 *PROPOSTA ACEITA!*`,
          ``,
          `Cliente: *${recibo.destinatario_nome}*`,
          `Proposta: ${nomeProposta || '#' + proposta_id}`,
          valor > 0 ? `Valor: ${valorFmt}` : '',
          `Tipo: ${isConsultoria ? 'Consultoria' : 'Mão de Obra'}`,
          ``,
          `Confirmado em: ${recibo.respondido_em?.toLocaleString('pt-BR') || 'agora'}`,
          recibo.resposta_obs ? `Obs: _${recibo.resposta_obs}_` : '',
          ``,
          `_Hash: ${recibo.hash_validacao.slice(0, 16)}..._`,
        ].filter(Boolean).join('\n');
        await sendMessage(chatId, texto);
        console.log(`[trigger:proposta_aceita] notificacao Telegram enviada`);
      }
    } catch (err) {
      console.warn(`[trigger:proposta_aceita] falha Telegram:`, (err as Error).message);
    }
  } catch (err) {
    console.error(`[trigger:proposta_aceita] FALHA:`, (err as Error).message);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Trigger: vistoria entregue
// ────────────────────────────────────────────────────────────────────────

interface VistoriaTriggerRow extends RowDataPacket {
  id: number; titulo: string | null; data: Date | string;
  vistoriador: string | null; status_obra: string;
  obra_id: number; obra_nome: string;
  cliente: string | null;
}

/**
 * Disparar quando vistoria e enviada via WhatsApp pra cliente.
 * Cria recibo tipo='vistoria' pedindo ciencia. Idempotente — 1 recibo
 * por vistoria. Recebe telefone direto (do envio) pra nao depender da
 * obra ter cliente_telefone cadastrado.
 */
export async function gerarReciboVistoriaEntregue(
  vistoria_id: number, telefone: string, tenant_id = 1
): Promise<void> {
  try {
    const cfg = await getTriggerConfig(tenant_id, 'vistoria_entregue');
    if (!cfg.enabled) return;

    const existentes = await listarRecibos({
      tenant_id, tipo: 'vistoria',
      resource_type: 'romatec_obra_vistorias',
      resource_id: String(vistoria_id),
    });
    if (existentes.length > 0) {
      console.log(`[trigger:vistoria_entregue] vistoria #${vistoria_id} ja tem recibo — ignorando`);
      return;
    }

    const [rows] = await pool.execute<VistoriaTriggerRow[]>(
      `SELECT v.id, v.titulo, v.data, v.vistoriador, v.status_obra,
              v.obra_id, o.nome AS obra_nome, o.cliente
         FROM romatec_obra_vistorias v
         JOIN romatec_obras o ON o.id = v.obra_id
        WHERE v.id = ?`,
      [vistoria_id]
    );
    if (!rows.length) {
      console.warn(`[trigger:vistoria_entregue] vistoria #${vistoria_id} nao encontrada`);
      return;
    }
    const v = rows[0];
    const phone = telefone.replace(/\D/g, '');
    if (phone.length < 10) {
      console.warn(`[trigger:vistoria_entregue] telefone invalido: ${telefone}`);
      return;
    }

    const labelStatus = ({
      regular: 'regular', atencao: 'atenção', critica: 'crítica',
    } as Record<string, string>)[v.status_obra] || v.status_obra;
    const desc = [
      `Vistoria${v.titulo ? ` "${v.titulo}"` : ''} da obra ${v.obra_nome}`,
      v.vistoriador ? `por ${v.vistoriador}` : '',
      `(status ${labelStatus})`,
    ].filter(Boolean).join(' ');

    const novo = await criarRecibo({
      tenant_id,
      tipo: 'vistoria',
      resource_type: 'romatec_obra_vistorias',
      resource_id: String(vistoria_id),
      destinatario_nome: v.cliente || 'Cliente',
      destinatario_phone: phone,
      descricao_servico: desc,
      expira_em_dias: cfg.validade_dias ?? 7,
    });
    console.log(`[trigger:vistoria_entregue] recibo ${novo.numero} criado pra vistoria #${vistoria_id}`);

    if (cfg.auto_enviar) {
      try {
        await enviarReciboWhatsApp({ id: novo.id });
        console.log(`[trigger:vistoria_entregue] WhatsApp enviado pra ${phone}`);
      } catch (err) {
        console.warn(`[trigger:vistoria_entregue] falha auto-enviar:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error(`[trigger:vistoria_entregue] FALHA pra vistoria #${vistoria_id}:`, (err as Error).message);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Trigger: despesa criada (NOTIFICACAO ao inves de recibo)
// ────────────────────────────────────────────────────────────────────────
//
// Despesa interna nao tem destinatario externo claro (gasto da empresa).
// Por isso esse trigger NAO cria recibo — manda notificacao Telegram pro
// CEO em tempo real cada vez que uma despesa e lancada (transparencia
// + controle de gasto).

interface DespesaTriggerRow extends RowDataPacket {
  id: number; loja: string; categoria: string;
  forma_pagamento: string; valor_total: string;
  destinatario: string | null; data: Date | string;
  obra_id: number; obra_nome: string;
  observacoes: string | null;
}

export async function notificarDespesaCriada(despesa_id: number, tenant_id = 1): Promise<void> {
  try {
    const cfg = await getTriggerConfig(tenant_id, 'despesa_criada');
    if (!cfg.enabled) return;

    const [rows] = await pool.execute<DespesaTriggerRow[]>(
      `SELECT d.id, d.loja, d.categoria, d.forma_pagamento, d.valor_total,
              d.destinatario, d.data, d.observacoes,
              d.obra_id, o.nome AS obra_nome
         FROM despesas_extras d
         LEFT JOIN romatec_obras o ON o.id = d.obra_id
        WHERE d.id = ? AND d.deleted_at IS NULL`,
      [despesa_id]
    );
    if (!rows.length) return;
    const d = rows[0];

    const { sendMessage } = await import('../integrations/telegram');
    const chatId = (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
      || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
    if (!chatId) return;

    const valorFmt = 'R$ ' + Number(d.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const labelCat = ({
      ferramenta: '🔨 Ferramenta', aluguel: '🏠 Aluguel',
      material: '🧱 Material', outros: '📦 Outros',
    } as Record<string, string>)[d.categoria] || d.categoria;
    const labelForma = ({
      pix: 'PIX', dinheiro: 'Dinheiro',
      cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', boleto: 'Boleto',
    } as Record<string, string>)[d.forma_pagamento] || d.forma_pagamento;

    const linhas: string[] = [
      `💸 *Nova despesa lançada*`,
      ``,
      `Loja: *${d.loja}*`,
      `Valor: *${valorFmt}*`,
      `Categoria: ${labelCat}`,
      `Forma: ${labelForma}`,
    ];
    if (d.destinatario) linhas.push(`Destinatário: ${d.destinatario}`);
    if (d.obra_nome) linhas.push(`Obra: ${d.obra_nome}`);
    if (d.observacoes) linhas.push('', `Obs: _${String(d.observacoes).slice(0, 200)}_`);
    linhas.push('', `_Despesa #${d.id} · via Romatec Gestão de Obras_`);

    await sendMessage(chatId, linhas.join('\n'));
    console.log(`[trigger:despesa_criada] notificacao Telegram enviada — despesa #${despesa_id}`);
  } catch (err) {
    console.error(`[trigger:despesa_criada] FALHA pra despesa #${despesa_id}:`, (err as Error).message);
  }
}
