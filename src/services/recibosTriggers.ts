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
