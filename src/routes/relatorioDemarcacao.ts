// src/routes/relatorioDemarcacao.ts
// Rotas REST + envio via Z-API

import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import { RelatorioDemarcacaoService } from '../services/relatorioDemarcacao';
import { gerarRelatorioDemarcacaoPdf } from '../services/relatorioDemarcacaoPdf';

const PDF_DIR = process.env.PDF_DIR || path.join(process.cwd(), 'storage', 'relatorios');
const BASE_URL = process.env.BASE_URL || 'https://romatec-voice-agent.up.railway.app';
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN;

export function relatorioDemarcacaoRouter(pool: Pool): Router {
  const router = Router();
  const service = new RelatorioDemarcacaoService(pool);

  // ===== LISTAR A FATURAR =====
  router.get('/a-faturar', async (req, res) => {
    try {
      const lista = await service.listarAFaturar({
        loteadorId: req.query.loteadorId ? Number(req.query.loteadorId) : undefined,
        loteamento: req.query.loteamento as string | undefined,
        dataInicio: req.query.dataInicio as string | undefined,
        dataFim: req.query.dataFim as string | undefined,
        busca: req.query.busca as string | undefined,
      });
      res.json(lista);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== LISTAR JÁ FATURADAS =====
  router.get('/ja-faturadas', async (req, res) => {
    try {
      const lista = await service.listarJaFaturadas({
        loteadorId: req.query.loteadorId ? Number(req.query.loteadorId) : undefined,
        loteamento: req.query.loteamento as string | undefined,
        dataInicio: req.query.dataInicio as string | undefined,
        dataFim: req.query.dataFim as string | undefined,
        busca: req.query.busca as string | undefined,
      });
      res.json(lista);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== PREVIEW DE SELEÇÃO =====
  router.post('/preview', async (req, res) => {
    try {
      const { laudoIds } = req.body ?? {};
      if (!Array.isArray(laudoIds)) return res.status(400).json({ error: 'laudoIds obrigatório' });
      const preview = await service.previewSelecao(laudoIds.map(Number));
      res.json(preview);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ===== CRIAR RELATÓRIO + PDF =====
  router.post('/criar', async (req, res) => {
    try {
      const body = req.body ?? {};
      if (!Array.isArray(body.laudoIds) || body.laudoIds.length === 0) {
        return res.status(400).json({ error: 'Selecione ao menos um laudo' });
      }
      if (!body.loteadorNome) return res.status(400).json({ error: 'loteadorNome obrigatório' });

      const r = await service.criarRelatorio({
        laudoIds: body.laudoIds.map(Number),
        loteadorId: body.loteadorId ? Number(body.loteadorId) : undefined,
        loteadorNome: String(body.loteadorNome),
        loteadorDocumento: body.loteadorDocumento,
        loteadorWhatsapp: body.loteadorWhatsapp,
        loteamento: body.loteamento,
        dataVencimento: body.dataVencimento,
        observacoes: body.observacoes,
        emitidoPor: body.emitidoPor || 'José Romário',
      });

      // Gera PDF
      const det = await service.obterDetalhe(r.relatorioId) as any;
      const pdfPath = path.join(PDF_DIR, `${r.numero}.pdf`);
      await gerarRelatorioDemarcacaoPdf({
        numero: det.numero,
        data_emissao: det.data_emissao,
        data_vencimento: det.data_vencimento,
        periodo_inicio: det.periodo_inicio,
        periodo_fim: det.periodo_fim,
        loteador_nome: det.loteador_nome,
        loteador_documento: det.loteador_documento,
        loteamento: det.loteamento,
        qtd_itens: det.qtd_itens,
        area_total_m2: Number(det.area_total_m2),
        valor_total: Number(det.valor_total),
        pagamento_pix: det.pagamento_pix,
        pagamento_banco: det.pagamento_banco,
        pagamento_agencia: det.pagamento_agencia,
        pagamento_conta: det.pagamento_conta,
        pagamento_titular: det.pagamento_titular,
        pagamento_documento: det.pagamento_documento,
        observacoes: det.observacoes,
        hash_validacao: det.hash_validacao,
        baseUrlValidacao: BASE_URL,
        itens: det.itens.map((i: any) => ({
          laudo_numero: i.laudo_numero,
          tipo_imovel: i.tipo_imovel,
          imovel_descricao: i.imovel_descricao,
          contrato: i.contrato,
          quadra: i.quadra,
          lote: i.lote,
          data_demarcacao: i.data_demarcacao,
          area_m2: Number(i.area_m2),
          valor: Number(i.valor),
        })),
      }, pdfPath);

      await pool.execute(
        `UPDATE relatorios_demarcacao SET pdf_path = ? WHERE id = ?`,
        [pdfPath, r.relatorioId]
      );

      res.json({ ...r, pdfPath, pdfUrl: `/api/relatorios-demarcacao/${r.relatorioId}/pdf` });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ===== DOWNLOAD DO PDF =====
  router.get('/:id/pdf', async (req, res) => {
    try {
      const det = await service.obterDetalhe(Number(req.params.id)) as any;
      if (!det) return res.status(404).json({ error: 'Não encontrado' });
      if (!det.pdf_path || !fs.existsSync(det.pdf_path)) {
        return res.status(404).json({ error: 'PDF não disponível' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${det.numero}.pdf"`);
      fs.createReadStream(det.pdf_path).pipe(res);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== PREVIEW DO ENVIO (texto + telefone) =====
  // v3.15.7: UI mostra preview editavel antes de mandar via WhatsApp
  router.get('/:id/enviar-preview', async (req, res) => {
    try {
      const r = await service.previewEnvio(Number(req.params.id));
      res.json(r);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ===== ENVIAR VIA Z-API =====
  router.post('/:id/enviar', async (req, res) => {
    try {
      const det = await service.obterDetalhe(Number(req.params.id)) as any;
      if (!det) return res.status(404).json({ error: 'Não encontrado' });
      if (!det.pdf_path || !fs.existsSync(det.pdf_path)) {
        return res.status(400).json({ error: 'PDF não gerado' });
      }

      const numero = (req.body?.telefone || det.loteador_whatsapp || '').replace(/\D/g, '');
      if (!numero) return res.status(400).json({ error: 'Telefone do loteador não informado' });

      if (!ZAPI_INSTANCE || !ZAPI_TOKEN) {
        return res.status(500).json({ error: 'Z-API não configurada' });
      }

      // v3.15.7: aceita texto editado vindo do modal de preview, com fallback
      // pro texto rico (lista de servicos, dados bancarios, agradecimento)
      const { montarTextoEnvio } = await import('../services/relatorioDemarcacao');
      const msg = (typeof req.body?.texto === 'string' && req.body.texto.trim())
        ? req.body.texto
        : montarTextoEnvio(det);

      await axios.post(
        `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
        { phone: numero, message: msg },
        { headers: { 'Client-Token': ZAPI_CLIENT_TOKEN || '' } }
      );

      // 2) PDF
      const pdfBuffer = fs.readFileSync(det.pdf_path);
      const pdfBase64 = pdfBuffer.toString('base64');
      await axios.post(
        `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-document/pdf`,
        {
          phone: numero,
          document: `data:application/pdf;base64,${pdfBase64}`,
          fileName: `${det.numero}.pdf`,
          caption: `Relatório ${det.numero}`,
        },
        { headers: { 'Client-Token': ZAPI_CLIENT_TOKEN || '' } }
      );

      await pool.execute(
        `UPDATE relatorios_demarcacao SET status = 'enviado', enviado_em = NOW() WHERE id = ?`,
        [det.id]
      );

      res.json({ ok: true, telefone: numero });
    } catch (err: any) {
      res.status(500).json({ error: err.response?.data || err.message });
    }
  });

  // ===== DETALHE =====
  router.get('/:id', async (req, res) => {
    try {
      const det = await service.obterDetalhe(Number(req.params.id));
      if (!det) return res.status(404).json({ error: 'Não encontrado' });
      res.json(det);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== LISTA DE LOTEADORES (pra autocomplete no form) =====
  // v3.15.13: GET /api/relatorios-demarcacao/loteadores
  router.get('/loteadores/lista', async (_req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT id, nome, documento, whatsapp, telefone, email, loteamento_padrao
           FROM loteadores
          WHERE ativo = 1
          ORDER BY nome ASC`
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ===== EDITAR METADADOS DO RELATORIO =====
  // v3.15.12: edita loteador, vencimento, observacoes — nao mexe nos itens
  router.put('/:id', async (req, res) => {
    try {
      await service.editar(Number(req.params.id), req.body || {});
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ===== MARCAR PAGO =====
  router.post('/:id/pagar', async (req, res) => {
    try {
      await service.marcarPago(Number(req.params.id), req.body?.usuario || 'José Romário');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ===== CANCELAR =====
  router.post('/:id/cancelar', async (req, res) => {
    try {
      const motivo = req.body?.motivo || 'Sem motivo informado';
      await service.cancelar(Number(req.params.id), motivo);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
