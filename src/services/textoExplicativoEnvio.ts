// Envio do texto explicativo via Z-API + dedup 60s + audit log.
// Reusa sendReply() do módulo integrations/whatsapp (não chama axios direto:
// sendReply já trata normalização de telefone, headers Z-API e logging
// no zayra_whatsapp_log).
//
// Dedup window de 60s aplicada por (numero_destino, tipo_servico):
// se o ultimo envio bem-sucedido pra esse par foi < 60s, ignora e
// registra status='duplicado' no audit log (sem chamar Z-API).

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { sendReply } from '../integrations/whatsapp';
import {
  gerarTextoExplicativo,
  type DadosTexto,
  type TipoServico,
} from './textoExplicativoService';

export type ModoEnvio = 'avulso' | 'com_proposta';

export interface EnvioInput {
  dados: DadosTexto;
  numeroDestino: string;
  modoEnvio: ModoEnvio;
  clienteId?: number;
  propostaId?: number;
}

export interface EnvioOk {
  ok: true;
  messageId?: string;
}
export interface EnvioBloqueado {
  ok: false;
  motivo: 'duplicado_60s';
}
export type EnvioResultado = EnvioOk | EnvioBloqueado;

const DEDUP_WINDOW_SECONDS = 60;

// Limitação conhecida: dedup é SELECT-então-INSERT, não atômico. Duas chamadas
// concorrentes em < ~50ms podem ambas passar pelo SELECT antes de qualquer
// INSERT, resultando em envio duplicado. Cenário plausível: double-click no
// botão de envio. Mitigação atual: dedup de 60s cobre os casos > 50ms; para
// quase-simultâneas, confia no debounce do front (no botão) ou no rate-limit
// natural da Z-API. Se virar problema, evoluir para INSERT...SELECT WHERE
// NOT EXISTS, ou unique constraint em (numero_destino, tipo_servico, bucket_60s).
async function dedupRecente(
  numeroDestino: string,
  tipoServico: TipoServico,
): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM textos_explicativos_envios
       WHERE numero_destino = ?
         AND tipo_servico = ?
         AND status = 'enviado'
         AND enviado_em > (NOW() - INTERVAL ? SECOND)
       LIMIT 1`,
    [numeroDestino, tipoServico, DEDUP_WINDOW_SECONDS],
  );
  return rows.length > 0;
}

async function gravarLog(params: {
  tipoServico: TipoServico;
  clienteId?: number;
  propostaId?: number;
  numeroDestino: string;
  modoEnvio: ModoEnvio;
  texto: string;
  zapiMessageId?: string;
  status: 'enviado' | 'erro' | 'duplicado';
  erroDetalhe?: string;
}): Promise<void> {
  await pool.execute(
    `INSERT INTO textos_explicativos_envios
       (tipo_servico, cliente_id, proposta_id, numero_destino, modo_envio,
        texto_enviado, zapi_message_id, status, erro_detalhe)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.tipoServico,
      params.clienteId ?? null,
      params.propostaId ?? null,
      params.numeroDestino,
      params.modoEnvio,
      params.texto,
      params.zapiMessageId ?? null,
      params.status,
      params.erroDetalhe ?? null,
    ],
  );
}

export async function enviarTextoExplicativo(
  input: EnvioInput,
): Promise<EnvioResultado> {
  const { dados, numeroDestino, modoEnvio, clienteId, propostaId } = input;

  // 1. dedup
  if (await dedupRecente(numeroDestino, dados.tipoServico)) {
    await gravarLog({
      tipoServico: dados.tipoServico,
      clienteId,
      propostaId,
      numeroDestino,
      modoEnvio,
      texto: '',
      status: 'duplicado',
    });
    return { ok: false, motivo: 'duplicado_60s' };
  }

  // 2. render
  const texto = await gerarTextoExplicativo(dados);

  // 3. envia + log
  try {
    const resp = await sendReply(numeroDestino, texto);
    await gravarLog({
      tipoServico: dados.tipoServico,
      clienteId,
      propostaId,
      numeroDestino,
      modoEnvio,
      texto,
      zapiMessageId: resp.messageId,
      status: 'enviado',
    });
    return { ok: true, messageId: resp.messageId };
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    try {
      await gravarLog({
        tipoServico: dados.tipoServico,
        clienteId,
        propostaId,
        numeroDestino,
        modoEnvio,
        texto,
        status: 'erro',
        erroDetalhe: detalhe,
      });
    } catch (logErr) {
      console.warn('[textoExplicativoEnvio] falha ao gravar log de erro (ignorado):', (logErr as Error).message);
    }
    throw err;
  }
}
