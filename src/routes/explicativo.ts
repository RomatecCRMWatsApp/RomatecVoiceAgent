// Endpoints do módulo de texto explicativo. Independentes do fluxo principal
// de Proposta — montados em /api/explicativo no server.ts.
//
//   POST /api/explicativo/preview                  → renderiza sem enviar
//   POST /api/explicativo/enviar-avulso            → envio standalone
//   POST /api/explicativo/enviar-com-proposta/:id  → envio integrado (lê
//                                                    proposta + cliente do DB)
//   GET  /api/explicativo/templates                → lista templates
//   PUT  /api/explicativo/templates/:tipo          → atualiza template

import { Router, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import {
  gerarTextoExplicativo,
  type DadosTexto,
  type TipoServico,
  type TipoImovel,
} from '../services/textoExplicativoService';
import { enviarTextoExplicativo } from '../services/textoExplicativoEnvio';

const router = Router();
const TIPOS_VALIDOS: TipoServico[] = ['remembramento', 'desmembramento'];

function isTipoValido(s: unknown): s is TipoServico {
  return typeof s === 'string' && TIPOS_VALIDOS.includes(s as TipoServico);
}

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<DadosTexto>;
    if (!isTipoValido(body.tipoServico)) {
      return res.status(400).json({ erro: 'tipoServico inválido' });
    }
    const texto = await gerarTextoExplicativo({
      tipoServico: body.tipoServico,
      clienteNome: body.clienteNome ?? '',
      quantidadeImoveis: body.quantidadeImoveis,
      areaTotal: body.areaTotal,
      unidadeArea: body.unidadeArea,
      quantidadeFracoes: body.quantidadeFracoes,
      municipio: body.municipio,
      uf: body.uf,
      tipoImovel: body.tipoImovel,
    });
    return res.json({ texto });
  } catch (err) {
    return res
      .status(400)
      .json({ erro: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/enviar-avulso', async (req: Request, res: Response) => {
  try {
    const { dados, numeroDestino, clienteId, propostaId } = req.body as {
      dados?: Partial<DadosTexto>;
      numeroDestino?: string;
      clienteId?: number;
      propostaId?: number;
    };
    if (!dados || !isTipoValido(dados.tipoServico)) {
      return res.status(400).json({ erro: 'dados.tipoServico inválido' });
    }
    if (!numeroDestino || !/\d{10,13}/.test(numeroDestino)) {
      return res.status(400).json({ erro: 'numeroDestino inválido' });
    }
    const result = await enviarTextoExplicativo({
      dados: { ...(dados as DadosTexto), tipoServico: dados.tipoServico },
      numeroDestino,
      modoEnvio: 'avulso',
      clienteId,
      propostaId,
    });
    return res.json(result);
  } catch (err) {
    return res
      .status(500)
      .json({ erro: err instanceof Error ? err.message : String(err) });
  }
});

interface PropostaJoinRow extends RowDataPacket {
  id: number;
  cliente_id: number;
  cliente_nome: string | null;
  telefone: string | null;
  subtipo_consultoria: string | null;
  dados_imovel: string | null;
  enviar_explicativo_junto: number;
}

router.post(
  '/enviar-com-proposta/:propostaId',
  async (req: Request, res: Response) => {
    try {
      const propostaId = Number(req.params.propostaId);
      if (!propostaId) {
        return res.status(400).json({ erro: 'propostaId inválido' });
      }

      const [rows] = await pool.query<PropostaJoinRow[]>(
        `SELECT p.id, p.cliente_id, c.nome AS cliente_nome, c.telefone,
                p.subtipo_consultoria, p.dados_imovel, p.enviar_explicativo_junto
           FROM propostas p
           JOIN propostas_clientes c ON c.id = p.cliente_id
          WHERE p.id = ?
          LIMIT 1`,
        [propostaId],
      );
      if (!rows.length) {
        return res.status(404).json({ erro: 'Proposta não encontrada' });
      }
      const p = rows[0];
      if (!p.enviar_explicativo_junto) {
        return res.json({ ok: true, pulou: true, motivo: 'toggle_desligado' });
      }
      if (!isTipoValido(p.subtipo_consultoria)) {
        return res.status(400).json({
          erro: `Subtipo de proposta não suportado: ${p.subtipo_consultoria}`,
        });
      }
      if (!p.telefone) {
        return res.status(400).json({ erro: 'Cliente sem telefone cadastrado' });
      }

      const dadosImovel: Record<string, unknown> = p.dados_imovel
        ? JSON.parse(p.dados_imovel)
        : {};
      const tipoZona = dadosImovel.tipo_zona as string | undefined;
      const tipoImovel: TipoImovel | undefined =
        tipoZona === 'urbana' || tipoZona === 'urbano'
          ? 'urbano'
          : tipoZona === 'rural'
            ? 'rural'
            : undefined;

      const imoveis = Array.isArray(dadosImovel.imoveis)
        ? (dadosImovel.imoveis as unknown[])
        : [];
      const quantidadeImoveis =
        imoveis.length ||
        (typeof dadosImovel.numero_lotes_origem === 'number'
          ? dadosImovel.numero_lotes_origem
          : undefined);
      const areaTotal =
        typeof dadosImovel.area_total_m2 === 'number'
          ? dadosImovel.area_total_m2
          : undefined;
      const quantidadeFracoes =
        typeof dadosImovel.numero_lotes_destino === 'number'
          ? dadosImovel.numero_lotes_destino
          : typeof dadosImovel.quantidade_fracoes === 'number'
            ? dadosImovel.quantidade_fracoes
            : undefined;
      const municipio =
        typeof dadosImovel.municipio === 'string'
          ? dadosImovel.municipio
          : undefined;
      const uf = typeof dadosImovel.uf === 'string' ? dadosImovel.uf : undefined;

      const result = await enviarTextoExplicativo({
        dados: {
          tipoServico: p.subtipo_consultoria,
          clienteNome: p.cliente_nome ?? '',
          quantidadeImoveis,
          areaTotal,
          unidadeArea: 'm²',
          quantidadeFracoes,
          municipio,
          uf,
          tipoImovel,
        },
        numeroDestino: p.telefone,
        modoEnvio: 'com_proposta',
        clienteId: p.cliente_id,
        propostaId: p.id,
      });
      return res.json(result);
    } catch (err) {
      return res
        .status(500)
        .json({ erro: err instanceof Error ? err.message : String(err) });
    }
  },
);

interface TemplateListRow extends RowDataPacket {
  id: number;
  tipo_servico: string;
  titulo: string;
  template_texto: string;
  ativo: number;
  atualizado_em: Date;
}

router.get('/templates', async (_req: Request, res: Response) => {
  const [rows] = await pool.query<TemplateListRow[]>(
    'SELECT id, tipo_servico, titulo, template_texto, ativo, atualizado_em FROM textos_explicativos ORDER BY tipo_servico',
  );
  return res.json({
    items: rows.map((r) => ({
      id: r.id,
      tipo_servico: r.tipo_servico,
      titulo: r.titulo,
      template_texto: r.template_texto,
      ativo: !!r.ativo,
      atualizado_em: r.atualizado_em,
    })),
  });
});

router.put('/templates/:tipo', async (req: Request, res: Response) => {
  const tipo = req.params.tipo;
  if (!isTipoValido(tipo)) {
    return res.status(400).json({ erro: 'tipo inválido' });
  }
  const { template_texto, titulo, ativo } = req.body as {
    template_texto?: string;
    titulo?: string;
    ativo?: boolean;
  };
  if (!template_texto || !template_texto.trim()) {
    return res.status(400).json({ erro: 'template_texto obrigatório' });
  }
  await pool.execute(
    `UPDATE textos_explicativos
        SET template_texto = ?,
            titulo = COALESCE(?, titulo),
            ativo = COALESCE(?, ativo)
      WHERE tipo_servico = ?`,
    [
      template_texto,
      titulo ?? null,
      typeof ativo === 'boolean' ? (ativo ? 1 : 0) : null,
      tipo,
    ],
  );
  return res.json({ ok: true });
});

export default router;
