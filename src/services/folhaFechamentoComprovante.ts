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

  return {
    ok: true,
    item_id: itemId,
    fechamento_id: Number(it.fechamento_id),
    funcionario_nome: String(it.funcionario_nome),
    extraido,
    marcado_pago: marcouPago,
    whatsapp_enviado: whatsappOk,
    whatsapp_erro: whatsappErro,
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
