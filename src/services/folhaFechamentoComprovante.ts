// v3.11.0 — Fluxo de comprovante de pagamento de item de folha.
//   1) Salva arquivo + extrai dados (Claude Vision)
//   2) Marca status_pagamento = paga
//   3) Envia comprovante via WhatsApp pro colaborador (se ele tiver telefone)

import type { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import { extrairComprovantePagamento, type ComprovanteExtraido } from './comprovantePagamentoOcr';

export interface UploadComprovanteResult {
  ok: true;
  item_id: number;
  fechamento_id: number;
  funcionario_nome: string;
  extraido: ComprovanteExtraido;
  marcado_pago: boolean;
  whatsapp_enviado: boolean;
  whatsapp_erro?: string;
  // v3.12.0: recibo Romatec de autenticacao
  recibo_autenticacao?: { id: number; numero: string; link: string; enviado: boolean };
  recibo_erro?: string;
}

export async function processarComprovantePagamento(
  itemId: number,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
  enviarWhatsApp = true,
): Promise<UploadComprovanteResult> {
  // 1. Valida item
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT fi.id, fi.fechamento_id, fi.funcionario_id, fi.funcionario_nome,
            fi.status_pagamento, fi.valor_liquido,
            e.telefone
       FROM folha_fechamento_itens fi
       LEFT JOIN romatec_obra_equipe e ON e.id = fi.funcionario_id
      WHERE fi.id = ?
      LIMIT 1`,
    [itemId]
  );
  if (rows.length === 0) throw new Error('Item nao encontrado.');
  const it = rows[0];
  if (it.status_pagamento === 'cancelada') throw new Error('Item esta cancelado.');

  // 2. Tenta OCR (em paralelo com o salvamento do arquivo)
  let extraido: ComprovanteExtraido = {};
  let ocrErro: string | undefined;
  try {
    extraido = await extrairComprovantePagamento(fileBuffer.toString('base64'), mimeType);
    if (extraido.erro) {
      ocrErro = extraido.erro;
    }
  } catch (err) {
    ocrErro = (err as Error).message;
    extraido = { erro: ocrErro };
  }

  // 3. Salva arquivo + extraido + marca pago (mesma transacao)
  const conn = await pool.getConnection();
  let marcouPago = false;
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE folha_fechamento_itens
          SET comprovante_arquivo = ?,
              comprovante_mime = ?,
              comprovante_filename = ?,
              comprovante_extraido = ?,
              comprovante_uploaded_em = NOW()
        WHERE id = ?`,
      [fileBuffer, mimeType, fileName.slice(0, 200), JSON.stringify(extraido), itemId]
    );

    // Se ainda nao pago, marca agora
    if (it.status_pagamento !== 'paga') {
      // Tenta inferir forma de pagamento do extraido
      const tipo = extraido.tipo;
      const formaPagamento =
        tipo === 'pix' ? 'pix' :
        tipo === 'ted' || tipo === 'doc' || tipo === 'transferencia' ? 'transferencia' :
        tipo === 'boleto' ? 'outro' :
        'outro';

      await conn.execute(
        `UPDATE folha_fechamento_itens
            SET status_pagamento = 'paga',
                data_pagamento = NOW(),
                forma_pagamento = ?
          WHERE id = ?`,
        [formaPagamento, itemId]
      );

      await conn.execute(
        `INSERT INTO folha_pagamentos_log
           (fechamento_item_id, acao, valor, forma_pagamento, usuario, observacao)
         VALUES (?, 'marcou_pago', ?, ?, ?, ?)`,
        [itemId, it.valor_liquido, formaPagamento, 'Sistema (upload comprovante)',
         `Comprovante anexado: ${fileName}${extraido.id_transacao ? ' · ID ' + extraido.id_transacao : ''}`]
      );

      // Reavalia status do fechamento
      const [agg] = await conn.query<RowDataPacket[]>(
        `SELECT
            SUM(status_pagamento = 'paga')   AS pagas,
            SUM(status_pagamento = 'aberta') AS abertas,
            COUNT(*) AS total
           FROM folha_fechamento_itens
          WHERE fechamento_id = ?`,
        [it.fechamento_id]
      );
      const pagas = Number(agg[0].pagas);
      const abertas = Number(agg[0].abertas);
      const total = Number(agg[0].total);
      let novoStatus: 'aberta' | 'parcialmente_paga' | 'quitada' = 'aberta';
      if (pagas === total) novoStatus = 'quitada';
      else if (pagas > 0 && abertas > 0) novoStatus = 'parcialmente_paga';
      await conn.execute(
        `UPDATE folha_fechamentos SET status = ? WHERE id = ?`,
        [novoStatus, it.fechamento_id]
      );

      marcouPago = true;
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  // 4. WhatsApp (best-effort, nao quebra o upload)
  let whatsappOk = false;
  let whatsappErro: string | undefined;
  if (enviarWhatsApp && it.telefone) {
    try {
      const { sendDocument } = await import('../integrations/whatsapp');
      const cleanPhone = String(it.telefone).replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        throw new Error('Telefone invalido: ' + it.telefone);
      }
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      await sendDocument(cleanPhone, fileBuffer.toString('base64'), safeName);
      await pool.execute(
        `UPDATE folha_fechamento_itens SET comprovante_enviado_whatsapp = NOW() WHERE id = ?`,
        [itemId]
      );
      whatsappOk = true;
    } catch (err) {
      whatsappErro = (err as Error).message;
      console.warn('[comprovante:whatsapp]', whatsappErro);
    }
  } else if (enviarWhatsApp && !it.telefone) {
    whatsappErro = 'Colaborador sem telefone cadastrado.';
  }

  // 5. Cria recibo Romatec de autenticacao (paridade com recibos quinzenais).
  //    Colaborador recebe link unico onde confirma o recebimento — gera prova
  //    de recebimento alem do comprovante bancario.
  let reciboInfo: UploadComprovanteResult['recibo_autenticacao'];
  let reciboErro: string | undefined;
  try {
    const { criarRecibo, enviarReciboWhatsApp } = await import('../integrations/recibos');
    const valor = Number(it.valor_liquido);
    const recibo = await criarRecibo({
      tipo: 'funcionario',
      resource_type: 'folha_fechamento_item',
      resource_id: String(itemId),
      destinatario_nome: String(it.funcionario_nome),
      destinatario_phone: it.telefone || '',
      valor,
      forma_pagamento: extraido?.tipo === 'pix' ? 'pix' : extraido?.tipo === 'ted' || extraido?.tipo === 'doc' ? 'transferencia' : undefined,
      descricao_servico: `Pagamento de folha referente ao fechamento #${it.fechamento_id}` +
        (extraido?.id_transacao ? ` · ID transação: ${extraido.id_transacao}` : ''),
      expira_em_dias: 30,
    });
    // Tenta enviar via WhatsApp (best-effort)
    let reciboEnviado = false;
    try {
      if (it.telefone) {
        await enviarReciboWhatsApp({ id: recibo.id, enviar_pdf: false });
        reciboEnviado = true;
      }
    } catch (errEnv) {
      console.warn('[comprovante:recibo:envio]', (errEnv as Error).message);
    }
    const baseUrl = (process.env.APP_URL || '').replace(/\/$/, '') || '';
    reciboInfo = {
      id: recibo.id,
      numero: recibo.numero,
      link: baseUrl ? `${baseUrl}/r/${recibo.token}` : `/r/${recibo.token}`,
      enviado: reciboEnviado,
    };
  } catch (err) {
    reciboErro = (err as Error).message;
    console.warn('[comprovante:recibo]', reciboErro);
  }

  return {
    ok: true,
    item_id: itemId,
    fechamento_id: Number(it.fechamento_id),
    funcionario_nome: String(it.funcionario_nome),
    extraido,
    marcado_pago: marcouPago,
    whatsapp_enviado: whatsappOk,
    whatsapp_erro: whatsappErro,
    recibo_autenticacao: reciboInfo,
    recibo_erro: reciboErro,
  };
}

export async function getComprovanteItem(itemId: number): Promise<{
  arquivo: Buffer;
  mime: string;
  filename: string;
} | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT comprovante_arquivo, comprovante_mime, comprovante_filename
       FROM folha_fechamento_itens
      WHERE id = ?
      LIMIT 1`,
    [itemId]
  );
  if (rows.length === 0 || !rows[0].comprovante_arquivo) return null;
  return {
    arquivo: rows[0].comprovante_arquivo as Buffer,
    mime: rows[0].comprovante_mime as string,
    filename: (rows[0].comprovante_filename as string) || `comprovante-${itemId}`,
  };
}

// v3.15.17: Reenvio manual de comprovante + recibo Romatec pra UM item.
// Cobre o caso 'WhatsApp falhou' no upload original (ZAPI offline, telefone
// invalido) e o caso 'preciso mandar de novo'. Idempotente — pode chamar N vezes.
export interface ReenviarItemResult {
  ok: true;
  item_id: number;
  funcionario_nome: string;
  comprovante_enviado: boolean;
  comprovante_erro?: string;
  recibo_enviado: boolean;
  recibo_numero?: string;
  recibo_erro?: string;
}

export async function reenviarComprovanteRecibo(itemId: number): Promise<ReenviarItemResult> {
  // 1) Item + telefone do colaborador
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT fi.id, fi.funcionario_nome,
            fi.comprovante_arquivo, fi.comprovante_mime, fi.comprovante_filename,
            e.telefone
       FROM folha_fechamento_itens fi
       LEFT JOIN romatec_obra_equipe e ON e.id = fi.funcionario_id
      WHERE fi.id = ?
      LIMIT 1`,
    [itemId]
  );
  if (rows.length === 0) throw new Error('Item nao encontrado.');
  const it = rows[0];
  const telefone = String(it.telefone || '').replace(/\D/g, '');
  if (!telefone || telefone.length < 10) {
    throw new Error('Colaborador sem telefone valido cadastrado.');
  }

  const out: ReenviarItemResult = {
    ok: true,
    item_id: itemId,
    funcionario_nome: String(it.funcionario_nome),
    comprovante_enviado: false,
    recibo_enviado: false,
  };

  // 2) Comprovante via WhatsApp (se existir blob salvo)
  if (it.comprovante_arquivo) {
    try {
      const { sendDocument } = await import('../integrations/whatsapp');
      const buf = it.comprovante_arquivo as Buffer;
      const filename = String(it.comprovante_filename || `comprovante-${itemId}`)
        .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      await sendDocument(telefone, buf.toString('base64'), filename);
      await pool.execute(
        `UPDATE folha_fechamento_itens SET comprovante_enviado_whatsapp = NOW() WHERE id = ?`,
        [itemId]
      );
      out.comprovante_enviado = true;
    } catch (err) {
      out.comprovante_erro = (err as Error).message;
    }
  } else {
    out.comprovante_erro = 'Nenhum comprovante anexado a este item.';
  }

  // 3) Recibo Romatec vinculado ao item
  const [rec] = await pool.query<RowDataPacket[]>(
    `SELECT id, numero FROM recibos
      WHERE resource_type = 'folha_fechamento_item' AND resource_id = ?
      ORDER BY id DESC LIMIT 1`,
    [String(itemId)]
  );
  if (rec.length === 0) {
    out.recibo_erro = 'Item sem recibo Romatec vinculado.';
  } else {
    try {
      const { enviarReciboWhatsApp } = await import('../integrations/recibos');
      const r = await enviarReciboWhatsApp({ id: Number(rec[0].id), enviar_pdf: false, forcar: true });
      out.recibo_enviado = true;
      out.recibo_numero = r.numero;
    } catch (err) {
      out.recibo_erro = (err as Error).message;
    }
  }
  return out;
}

// v3.15.17: Acao em lote — reenvia todos os itens pagos de um fechamento.
// Continua mesmo se um item falhar; retorna agregado.
export interface EnviarTudoResult {
  ok: true;
  fechamento_id: number;
  total: number;
  comprovantes_enviados: number;
  recibos_enviados: number;
  falhas: Array<{ item_id: number; funcionario_nome: string; motivo: string }>;
  itens: ReenviarItemResult[];
}

export async function enviarTudoFechamento(fechamentoId: number): Promise<EnviarTudoResult> {
  const [itens] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM folha_fechamento_itens
      WHERE fechamento_id = ? AND status_pagamento = 'paga'
      ORDER BY funcionario_nome`,
    [fechamentoId]
  );
  if (itens.length === 0) throw new Error('Fechamento nao tem itens pagos.');

  const out: EnviarTudoResult = {
    ok: true,
    fechamento_id: fechamentoId,
    total: itens.length,
    comprovantes_enviados: 0,
    recibos_enviados: 0,
    falhas: [],
    itens: [],
  };
  for (const row of itens) {
    const itemId = Number(row.id);
    try {
      const r = await reenviarComprovanteRecibo(itemId);
      out.itens.push(r);
      if (r.comprovante_enviado) out.comprovantes_enviados++;
      if (r.recibo_enviado) out.recibos_enviados++;
      if (!r.comprovante_enviado && r.comprovante_erro) {
        out.falhas.push({ item_id: itemId, funcionario_nome: r.funcionario_nome, motivo: `Comprovante: ${r.comprovante_erro}` });
      }
      if (!r.recibo_enviado && r.recibo_erro) {
        out.falhas.push({ item_id: itemId, funcionario_nome: r.funcionario_nome, motivo: `Recibo: ${r.recibo_erro}` });
      }
    } catch (err) {
      out.falhas.push({ item_id: itemId, funcionario_nome: `Item #${itemId}`, motivo: (err as Error).message });
    }
  }
  return out;
}
