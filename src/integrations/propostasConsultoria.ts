// v1.66.0: Proposta de Consultoria (averbacao, georref, desm, retif, ptam).
// Reaproveita: numeracao gerarNumeroProposta() compartilhada em propostas.ts,
// tabela MySQL `propostas` (mesmas colunas + dados_imovel/custos_calculados/
// fontes_consulta JSON), envio WhatsApp Z-API e Telegram. PDF tem template
// proprio com 5 secoes (este arquivo) — visual herdado da Mao de Obra
// (header, cores, footer).
//
// Fase 1: implementa apenas averbacao_residencial e averbacao_comercial.
// Demais subtipos vem na Fase 3.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import crypto from 'crypto';
import pool from '../database/connection';
import PDFDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import path from 'path';
import fs from 'fs';
import { sendDocument as sendWhatsAppDocument } from './whatsapp';
import { sendDocument as sendTelegramDocument } from './telegram';
import { getTenantSettings } from '../services/tenantSettings';
import { formatBRL } from '../util/format';
import { calcularConsultoria } from '../services/pricing';
// v1.99.17: helpers compartilhados de QR + hash footer no PDF
import { renderQRValidacao, renderHashFooter } from '../services/reciboPdfShared';
// v1.99.11: assinatura digital reutiliza tipos do reciboPdf
import type { SignatureVisualMeta } from '../services/reciboPdf';
import type {
  SubtipoConsultoria, CustosCalculados, FontesConsulta, InputAverbacao, ItemCusto,
  InputGeorreferenciamento, InputDesmembramento, InputRetificacao, InputAvaliacaoPTAM,
  FinalidadeGeorref,
  InputDemarcacaoLotes, DemarcacaoLotesOutput, MaterialMarco, FinalidadeDemarcacao,
} from '../services/pricing/types';
// v3.23.5: aviso DRL extraido pra modulo standalone (testavel sem arrastar
// voyageai/mysql/pdfkit). Importamos aqui apenas pra reuso no renderAvisoDRL.
import { montarAvisoDRL } from './avisoDRL';

const LOGO_RELATORIO = '/romatec-logo-removebg-preview.png';

// ── Numeracao compartilhada (delega a propostas.ts) ────────────────────────
// v3.23.5: numero sempre nasce com sufixo -R1.
//   Format: PROP-AAAA-NNNN-R1  (revisao inicial)
//   Apos PUT em proposta status=ENVIADA -> R2, R3, ... (ver atualizarPropostaConsultoria)
//   Sequencial unico por ano, independente da revisao (NNNN nao reinicia entre R1->R2).
async function gerarNumeroProposta(): Promise<string> {
  const ano = new Date().getFullYear();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT numero FROM propostas
      WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`,
    [`PROP-${ano}-%`]
  );
  let seq = 1;
  if (rows.length > 0) {
    // Captura o NNNN — funciona pra PROP-AAAA-NNNN e PROP-AAAA-NNNN-R{N}
    const m = String(rows[0].numero).match(/PROP-\d{4}-(\d+)/);
    if (m) seq = Number(m[1]) + 1;
  }
  return `PROP-${ano}-${String(seq).padStart(4, '0')}-R1`;
}

// v3.23.5: helpers de manipulacao do sufixo -R{N}.
function parseRevisao(numero: string): { base: string; revisao: number } {
  const m = numero.match(/^(PROP-\d{4}-\d+)-R(\d+)$/);
  if (m) return { base: m[1], revisao: Number(m[2]) };
  // Numero legado sem sufixo: trata como R1
  const legacy = numero.match(/^(PROP-\d{4}-\d+)$/);
  if (legacy) return { base: legacy[1], revisao: 1 };
  return { base: numero, revisao: 1 };
}

function bumpRevisao(numero: string): string {
  const { base, revisao } = parseRevisao(numero);
  return `${base}-R${revisao + 1}`;
}

// ── Tipos de input/output ──────────────────────────────────────────────────
export interface CriarPropostaConsultoriaInput {
  subtipo: SubtipoConsultoria;
  cliente_id: string;
  endereco_imovel?: string;
  data_proposta?: string;
  validade_dias?: number;
  observacoes?: string;
  criada_por?: string;
  gestor_cargo?: string;
  gestor_nome?: string;
  gestor_telefone?: string;
  dados_imovel: Record<string, unknown>;
  // v1.66.8: override opcional dos custos (UI permite editar valores no preview)
  custos_override?: CustosCalculados;
  // v1.66.9: anexos enviados junto na criacao (Planta/Mapa em PDF/PNG/JPEG)
  anexos?: Array<{ filename: string; mimetype: string; conteudo_b64: string }>;
  // v3.33.0 (= v3.27.1 do prompt): adicional REFACTORED com wizard de cenario.
  // Substitui aditivo_campo v3.29.0 (mantido por compat retro).
  adicional_campo?: {
    ativo: boolean;
    cenario?: 'mata_densa_animais' | 'rodovia_faixa_dominio' | 'eletricidade_alta_tensao' | 'pedreira_explosivos' | 'produtos_quimicos';
    tipo?: 'insalubridade' | 'periculosidade';
    grau?: 'minimo' | 'medio' | 'maximo' | 'unico';
    bloco_enquadramento_tecnico_editado?: string;
    bloco_justificativa_cliente_editado?: string;
    observacao_adicional?: string;
  };
  // v3.29.0: aditivo de campo (insalubridade/periculosidade) — opcional.
  // Quando habilitado, o calculator e' chamado apos a criacao e o snapshot
  // vai pra propostas_aditivos_campo. O valor entra na composicao no PDF.
  aditivo_campo?: {
    habilitado: boolean;
    tipo: 'insalubridade' | 'periculosidade';
    grau: 'minimo' | 'medio' | 'maximo' | 'unico';
    observacao_tecnica?: string;
    // Base de calculo opcional — se nao fornecida, o caller monta a partir
    // do custos_calculados (50/50 default entre tecnico e equipamento).
    base_calculo?: {
      diarias_tecnico_valor: number;
      diarias_equipamento_valor: number;
    };
  };
}

export interface PropostaConsultoriaRow extends RowDataPacket {
  id: number;
  numero: string;
  tipo: 'mao_de_obra' | 'consultoria';
  subtipo_consultoria: string | null;
  cliente_id: number;
  endereco_obra: string | null;
  data_proposta: Date;
  validade_dias: number;
  valor_total: string;
  observacoes: string | null;
  status: string;
  dados_imovel: string | null;
  custos_calculados: string | null;
  fontes_consulta: string | null;
  gestor_cargo: string | null;
  gestor_nome: string | null;
  gestor_telefone: string | null;
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function criarPropostaConsultoria(input: CriarPropostaConsultoriaInput) {
  // v3.30.0 HOTFIX: validacao com mensagem PT-BR amigavel + accept de
  // string numerica ("123" -> 123). Cobre Hipotese A (camelCase) + Hipotese B
  // (autocomplete sem ID) + Hipotese D (Zod permitindo null). Defesa em
  // profundidade — frontend ainda deve marcar <select required>.
  const cliId = Number(input.cliente_id);
  if (!Number.isFinite(cliId) || cliId <= 0) {
    throw new Error('Selecione um cliente para a proposta');
  }
  if (!input.subtipo) throw new Error('subtipo obrigatorio');

  const subtipo = input.subtipo;
  let resultado;
  if (subtipo === 'averbacao_residencial' || subtipo === 'averbacao_comercial') {
    resultado = await calcularConsultoria({
      subtipo,
      dados: input.dados_imovel as unknown as InputAverbacao,
    });
  } else if (subtipo === 'georreferenciamento_rural') {
    // v1.99.4: Geo Rural ativo
    resultado = await calcularConsultoria({
      subtipo,
      dados: input.dados_imovel as unknown as InputGeorreferenciamento,
    });
  } else if (subtipo === 'desmembramento' || subtipo === 'remembramento') {
    // v1.99.5: Desmembramento + Remembramento ativos
    resultado = await calcularConsultoria({
      subtipo,
      dados: input.dados_imovel as unknown as InputDesmembramento,
    });
  } else if (subtipo === 'retificacao_area') {
    // v1.99.6: Retificacao ativa
    resultado = await calcularConsultoria({
      subtipo,
      dados: input.dados_imovel as unknown as InputRetificacao,
    });
  } else if (subtipo === 'avaliacao_ptam') {
    // v1.99.6: PTAM ativo
    resultado = await calcularConsultoria({
      subtipo,
      dados: input.dados_imovel as unknown as InputAvaliacaoPTAM,
    });
  } else if (subtipo === 'projeto_executivo') {
    // v3.24.5: Projeto Executivo ativo (arquitetonico + complementares)
    const m = await import('../services/pricing/projetoExecutivo');
    resultado = await m.calcularProjetoExecutivo(
      input.dados_imovel as unknown as Parameters<typeof m.calcularProjetoExecutivo>[0],
    );
  } else if (subtipo === 'demarcacao_urbana' || subtipo === 'demarcacao_rural') {
    // v3.27.0: Demarcacao de Lotes (Urbana e Rural)
    const m = await import('../services/pricing/demarcacaoLotes');
    const out = m.calcularDemarcacaoLotes(input.dados_imovel as unknown as InputDemarcacaoLotes);
    resultado = {
      custos: adaptarDemarcacaoParaCustosCalculados(out),
      fontes: {} as FontesConsulta,
    };
  } else {
    throw new Error(`Subtipo ${subtipo} desconhecido.`);
  }

  // v1.66.8: aplica override se a UI editou valores no preview.
  // v1.66.17: guarda valor_original pra mostrar Desconto/Acrescimo no PDF.
  // v3.23.8 BUG-FIX: o front (preview de Georref) NAO envia condicoes_pagamento /
  // honorarios_romatec / opcionais / base_calculo no override — so manda
  // secao_2_taxas e secao_3_honorarios editados. O spread `...ov` SUBSTITUIA o
  // resultado calculado, apagando esses campos. Resultado no PDF: parcelas 1 e 2
  // saiam R$ 0,00 (cp.valor lia undefined → formatBRL(undefined) → "R$ 0,00").
  // Agora: fallback explicito pra cada campo derivado, preservando o que o engine
  // ja calculou se o override nao trouxe.
  if (input.custos_override) {
    const ov = input.custos_override;
    const calculado = resultado.custos;
    const origTaxas = calculado.secao_2_taxas;
    const origHon   = calculado.secao_3_honorarios;
    const taxasComOriginal = (ov.secao_2_taxas || []).map(i => {
      const orig = origTaxas.find(o => o.ordem === i.ordem);
      return { ...i, valor_original: orig?.valor };
    });
    const honComOriginal = (ov.secao_3_honorarios || []).map(i => {
      const orig = origHon.find(o => o.ordem === i.ordem);
      return { ...i, valor_original: orig?.valor };
    });
    // v3.23.8: o totalRomatec deve refletir SO os honorarios (nao a soma com taxas
    // que e' o legado pra averbacao). Pra georref, secao_5_total = total Romatec.
    // Para nao quebrar outros subtipos, mantemos o legado e por cima derivamos
    // honorarios_romatec do honComOriginal quando aplicavel.
    const totHon = honComOriginal.reduce((s, i) => s + Number(i.valor || 0), 0);
    const totTaxas = taxasComOriginal.reduce((s, i) => s + Number(i.valor || 0), 0);
    const tot = taxasComOriginal.length > 0 ? totHon + totTaxas : totHon;

    // Derivar condicoes_pagamento e honorarios_romatec a partir do honComOriginal
    // SOMENTE pra Georreferenciamento Rural (que tem secao_3_honorarios em
    // ordem fixa: TRT + Tecnicos + Assessoria). Outros subtipos preservam o que
    // o engine calculou (fallback ?? calculado).
    let condicoesPagamentoFinal = ov.condicoes_pagamento ?? calculado.condicoes_pagamento;
    let honorariosRomatecFinal = ov.honorarios_romatec ?? calculado.honorarios_romatec;
    if (subtipo === 'georreferenciamento_rural' && honComOriginal.length === 3) {
      // Reconhecer linhas pelo conteudo da descricao (mais robusto que ordem,
      // que muda entre engines).
      const trtLinha = honComOriginal.find(i =>
        /trt|tec\.?\s*responsabilidade|cft/i.test(i.descricao)
      );
      const tecLinha = honComOriginal.find(i =>
        /honorarios\s+tecnicos|levantamento\s+topografico|memorial/i.test(i.descricao)
      );
      const assessLinha = honComOriginal.find(i =>
        /assessoria/i.test(i.descricao)
      );
      if (trtLinha && tecLinha && assessLinha) {
        const trt = Number(trtLinha.valor) || 0;
        const tec = Number(tecLinha.valor) || 0;
        const ass = Number(assessLinha.valor) || 0;
        const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
        const p1 = round2(trt + tec * 0.5 + ass * 0.5);
        const p2 = round2(tec * 0.5);
        const p3 = round2(ass * 0.5);
        condicoesPagamentoFinal = [
          { rotulo: '1a parcela — na assinatura',
            descricao: 'TRT integral + 50% Honorarios Tecnicos + 50% Honorarios de Assessoria',
            valor: p1 },
          { rotulo: '2a parcela — entrega do memorial e submissao SIGEF',
            descricao: '50% restante dos Honorarios Tecnicos',
            valor: p2 },
          { rotulo: '3a parcela — certificacao final INCRA',
            descricao: '50% restante dos Honorarios de Assessoria',
            valor: p3 },
        ];
        honorariosRomatecFinal = { trt, tecnicos: tec, assessoria: ass, total: round2(trt + tec + ass) };
      }
    }

    resultado = {
      custos: {
        ...ov,
        secao_2_taxas: taxasComOriginal,
        secao_3_honorarios: honComOriginal,
        secao_5_total: tot,
        // Fallback defensivo: nao deixar campos derivados sumirem
        condicoes_pagamento: condicoesPagamentoFinal,
        honorarios_romatec: honorariosRomatecFinal,
        secao_opcionais_georref: ov.secao_opcionais_georref ?? calculado.secao_opcionais_georref,
        base_calculo: ov.base_calculo ?? calculado.base_calculo,
        avisos: ov.avisos ?? calculado.avisos,
        secao_1_projetos: ov.secao_1_projetos ?? calculado.secao_1_projetos,
        secao_4_checklist: ov.secao_4_checklist ?? calculado.secao_4_checklist,
      },
      fontes: { ...resultado.fontes, override_aplicado: true } as typeof resultado.fontes,
    };
  }

  const numero = await gerarNumeroProposta();
  const data = input.data_proposta && /^\d{4}-\d{2}-\d{2}$/.test(input.data_proposta)
    ? input.data_proposta
    : new Date().toISOString().slice(0, 10);

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO propostas
       (numero, tipo, subtipo_consultoria, cliente_id, endereco_obra,
        data_proposta, validade_dias, valor_total, observacoes, criada_por,
        gestor_cargo, gestor_nome, gestor_telefone,
        dados_imovel, custos_calculados, fontes_consulta)
     VALUES (?, 'consultoria', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      numero, subtipo, cliId,
      input.endereco_imovel ?? null,
      data,
      Number(input.validade_dias) || 15,
      resultado.custos.secao_5_total,
      input.observacoes ?? null,
      input.criada_por ?? null,
      input.gestor_cargo ?? null,
      input.gestor_nome ?? null,
      input.gestor_telefone ?? null,
      JSON.stringify(input.dados_imovel),
      // v3.24.6: pra projeto_executivo o resultado tem campo extra
      // `projeto_executivo` com a estrutura nova (honorarios + despesas +
      // forma_pagamento). Inclui no custos_calculados pra renderer ler.
      JSON.stringify({
        ...resultado.custos,
        ...((resultado as unknown as { projeto_executivo?: unknown }).projeto_executivo
          ? { projeto_executivo: (resultado as unknown as { projeto_executivo?: unknown }).projeto_executivo }
          : {}),
      }),
      JSON.stringify(resultado.fontes),
    ]
  );

  // v1.66.9: persiste anexos enviados junto (se houver)
  let anexosCriados = 0;
  if (input.anexos && input.anexos.length > 0) {
    for (const anexo of input.anexos) {
      try {
        await criarAnexoProposta({
          proposta_id: String(r.insertId),
          filename: anexo.filename,
          mimetype: anexo.mimetype,
          conteudo_b64: anexo.conteudo_b64,
        });
        anexosCriados++;
      } catch (err) {
        console.warn(`[anexos] Falha ao salvar ${anexo.filename}: ${(err as Error).message}`);
      }
    }
  }

  // v1.99.17: gera hash SHA-256 de validação pública imediatamente após o INSERT
  let hashValidacao: string | null = null;
  try {
    hashValidacao = await gerarOuBuscarHashProposta(r.insertId);
  } catch (err) {
    console.warn(`[propostas-consultoria] falha gerar hash da #${r.insertId}: ${(err as Error).message}`);
  }

  // v3.33.0 (= v3.27.1 do prompt): adicional REFACTORED com wizard de cenario.
  // Se o caller envia `adicional_campo` (novo), usa o engine v3.33.0; senao,
  // cai no fallback aditivo_campo v3.29.0 (compat retro).
  if (input.adicional_campo?.ativo && input.adicional_campo.cenario) {
    try {
      const mod = await import('../services/pricing/adicionalCampo');
      const r2 = mod.calcularAdicionalCampo({
        ativo: true,
        cenario: input.adicional_campo.cenario,
        tipo: input.adicional_campo.tipo,
        grau: input.adicional_campo.grau,
        bloco_enquadramento_tecnico_editado: input.adicional_campo.bloco_enquadramento_tecnico_editado,
        bloco_justificativa_cliente_editado: input.adicional_campo.bloco_justificativa_cliente_editado,
        observacao_adicional: input.adicional_campo.observacao_adicional,
      });
      // Calcula o valor monetario: percentual sobre o secao_5_total ANTES de
      // qualquer adicional/desconto extra (snapshot do subtotal de campo).
      const subtotalBase = round2Lib(resultado.custos.secao_5_total);
      const valorAdicional = round2Lib(subtotalBase * r2.percentual / 100);
      const novoTotal = round2Lib(subtotalBase + valorAdicional);
      const custosAtualizados = {
        ...resultado.custos,
        secao_5_total: novoTotal,
      };
      (custosAtualizados as unknown as { adicional_campo: typeof r2 & { valor_aplicado: number; subtotal_base: number } }).adicional_campo = {
        ...r2,
        valor_aplicado: valorAdicional,
        subtotal_base: subtotalBase,
      };
      await pool.execute(
        `UPDATE propostas SET custos_calculados = ?, valor_total = ? WHERE id = ?`,
        [JSON.stringify(custosAtualizados), novoTotal, r.insertId],
      );
      resultado.custos = custosAtualizados;
    } catch (err) {
      console.warn(`[adicional-campo v3.33.0] proposta ${r.insertId} FALHOU: ${(err as Error).message}`);
    }
  }

  // v3.29.0 LEGACY: aplica aditivo de campo (insalubridade/periculosidade) se solicitado.
  // Mantido por compat retro com clientes em transito. Quando adicional_campo (novo)
  // estiver presente, o caller NAO deve enviar aditivo_campo (legado) — defesa em
  // profundidade: se enviar ambos, novo tem precedencia (acima).
  let aditivoSnapshot: AditivoSnapshotComputado | null = null;
  if (input.aditivo_campo?.habilitado && !input.adicional_campo?.ativo) {
    try {
      aditivoSnapshot = await aplicarAditivoCampo({
        proposta_id: r.insertId,
        subtipo,
        custos: resultado.custos,
        input: input.aditivo_campo,
      });
      if (aditivoSnapshot) {
        // Persiste novo total + aditivo em custos_calculados.aditivo_campo
        const custosAtualizados = {
          ...resultado.custos,
          secao_5_total: round2Lib(resultado.custos.secao_5_total + aditivoSnapshot.valor_aditivo),
        };
        (custosAtualizados as unknown as { aditivo_campo: AditivoSnapshotComputado }).aditivo_campo = aditivoSnapshot;
        await pool.execute(
          `UPDATE propostas SET custos_calculados = ?, valor_total = ? WHERE id = ?`,
          [JSON.stringify(custosAtualizados), custosAtualizados.secao_5_total, r.insertId],
        );
        resultado.custos = custosAtualizados;
      }
    } catch (err) {
      console.warn(`[aditivo-campo] proposta ${r.insertId} FALHOU: ${(err as Error).message}`);
    }
  }

  return {
    ok: true as const,
    insertId: r.insertId,
    numero,
    subtipo,
    valor_total: resultado.custos.secao_5_total,
    custos_calculados: resultado.custos,
    fontes_consulta: resultado.fontes,
    anexos_criados: anexosCriados,
    hash_validacao: hashValidacao,
    aditivo_campo: aditivoSnapshot,
    message: `Proposta de Consultoria ${numero} (${subtipo}) criada. Valor R$ ${resultado.custos.secao_5_total.toFixed(2)}.${anexosCriados > 0 ? ` ${anexosCriados} anexo(s) salvos.` : ''}${aditivoSnapshot ? ` Aditivo: +R$ ${aditivoSnapshot.valor_aditivo.toFixed(2)}.` : ''}`,
  };
}

// v3.29.0: aditivo de campo — calcula, persiste snapshot, retorna objeto pronto
// pro PDF. Caller atualiza secao_5_total na coluna custos_calculados.
interface AditivoSnapshotComputado {
  config_id: number;
  tipo: 'insalubridade' | 'periculosidade';
  grau: 'minimo' | 'medio' | 'maximo' | 'unico';
  percentual: number;
  base_calculo_descricao: string;
  base_calculo_valor: number;
  valor_aditivo: number;
  descricao_curta: string;
  fundamentacao_legal: string;
  texto_pdf_md: string;
  observacao_tecnica?: string;
}

async function aplicarAditivoCampo(args: {
  proposta_id: number;
  subtipo: SubtipoConsultoria;
  custos: CustosCalculados;
  input: NonNullable<CriarPropostaConsultoriaInput['aditivo_campo']>;
}): Promise<AditivoSnapshotComputado | null> {
  const fc = await import('../services/aditivoCampoCalculator');
  const repoMod = await import('../repositories/aditivoCampoRepo');

  // Base de calculo: se o caller forneceu, usa; senao, deriva do custos
  // (procura linha tipo "tecnicos" no secao_3_honorarios).
  let dtec = args.input.base_calculo?.diarias_tecnico_valor ?? 0;
  let deq = args.input.base_calculo?.diarias_equipamento_valor ?? 0;
  if (dtec === 0 && deq === 0) {
    const linhasHon = args.custos.secao_3_honorarios || [];
    const linhaTec = linhasHon.find((h) =>
      /tecnico|tecnicos\s+de\s+campo|campo|levantamento|honorarios\s+tecnicos/i.test(h.descricao),
    );
    if (linhaTec) {
      dtec = Number(linhaTec.valor) || 0;
    }
    // Sem linha de equipamento explicita; assume 0 (ou usar 50/50 split — opcao do caller)
  }
  if (dtec === 0 && deq === 0) {
    console.warn(`[aditivo-campo] proposta ${args.proposta_id}: base de calculo zerada, pulando`);
    return null;
  }

  const r = await fc.calcularAditivoCampo({
    tipo: args.input.tipo,
    grau: args.input.grau,
    base_calculo: { diarias_tecnico_valor: dtec, diarias_equipamento_valor: deq },
    observacao_tecnica: args.input.observacao_tecnica,
  }, repoMod.aditivoCampoConfigRepo);

  await repoMod.propostasAditivosCampoRepo.upsert({
    proposta_tipo: args.subtipo,
    proposta_id: args.proposta_id,
    aditivo_config_id: r.config_id,
    tipo: r.tipo,
    grau: r.grau,
    percentual_aplicado: r.percentual,
    base_calculo_descricao: r.base_calculo_descricao,
    base_calculo_valor: r.base_calculo_valor,
    valor_aditivo: r.valor_aditivo,
    texto_pdf_md: r.texto_pdf_md,
    observacao_tecnica: args.input.observacao_tecnica?.trim() || null,
  });

  return {
    config_id: r.config_id,
    tipo: r.tipo,
    grau: r.grau,
    percentual: r.percentual,
    base_calculo_descricao: r.base_calculo_descricao,
    base_calculo_valor: r.base_calculo_valor,
    valor_aditivo: r.valor_aditivo,
    descricao_curta: r.descricao_curta,
    fundamentacao_legal: r.fundamentacao_legal,
    texto_pdf_md: r.texto_pdf_md,
    observacao_tecnica: args.input.observacao_tecnica?.trim() || undefined,
  };
}

export async function previewCustoConsultoria(input: {
  subtipo: SubtipoConsultoria;
  dados_imovel: Record<string, unknown>;
}) {
  const { subtipo, dados_imovel } = input;
  if (subtipo === 'averbacao_residencial' || subtipo === 'averbacao_comercial') {
    const resultado = await calcularConsultoria({
      subtipo,
      dados: dados_imovel as unknown as InputAverbacao,
    });
    return {
      ok: true as const,
      subtipo,
      valor_total: resultado.custos.secao_5_total,
      custos: resultado.custos,
      fontes: resultado.fontes,
    };
  }
  // v1.99.4: Geo Rural ativo
  if (subtipo === 'georreferenciamento_rural') {
    const resultado = await calcularConsultoria({
      subtipo,
      dados: dados_imovel as unknown as InputGeorreferenciamento,
    });
    return {
      ok: true as const,
      subtipo,
      valor_total: resultado.custos.secao_5_total,
      custos: resultado.custos,
      fontes: resultado.fontes,
    };
  }
  // v1.99.5: Desm + Rem ativos
  if (subtipo === 'desmembramento' || subtipo === 'remembramento') {
    const resultado = await calcularConsultoria({
      subtipo,
      dados: dados_imovel as unknown as InputDesmembramento,
    });
    return {
      ok: true as const,
      subtipo,
      valor_total: resultado.custos.secao_5_total,
      custos: resultado.custos,
      fontes: resultado.fontes,
    };
  }
  // v1.99.6: Retificacao ativa
  if (subtipo === 'retificacao_area') {
    const resultado = await calcularConsultoria({
      subtipo,
      dados: dados_imovel as unknown as InputRetificacao,
    });
    return {
      ok: true as const,
      subtipo,
      valor_total: resultado.custos.secao_5_total,
      custos: resultado.custos,
      fontes: resultado.fontes,
    };
  }
  // v1.99.6: PTAM ativo
  if (subtipo === 'avaliacao_ptam') {
    const resultado = await calcularConsultoria({
      subtipo,
      dados: dados_imovel as unknown as InputAvaliacaoPTAM,
    });
    return {
      ok: true as const,
      subtipo,
      valor_total: resultado.custos.secao_5_total,
      custos: resultado.custos,
      fontes: resultado.fontes,
    };
  }
  // v3.24.5: Projeto Executivo
  if (subtipo === 'projeto_executivo') {
    const m = await import('../services/pricing/projetoExecutivo');
    const resultado = await m.calcularProjetoExecutivo(
      dados_imovel as unknown as Parameters<typeof m.calcularProjetoExecutivo>[0],
    );
    return {
      ok: true as const,
      subtipo,
      valor_total: resultado.custos.secao_5_total,
      custos: resultado.custos,
      fontes: resultado.fontes,
      // Extra (so projeto_executivo): expone area/m2/ART-TRT/totais
      projeto_executivo: resultado.projeto_executivo,
    };
  }
  // v3.27.0: Demarcacao de Lotes (Urbana e Rural)
  if (subtipo === 'demarcacao_urbana' || subtipo === 'demarcacao_rural') {
    const m = await import('../services/pricing/demarcacaoLotes');
    const out = m.calcularDemarcacaoLotes(dados_imovel as unknown as InputDemarcacaoLotes);
    const custos = adaptarDemarcacaoParaCustosCalculados(out);
    return {
      ok: true as const,
      subtipo,
      valor_total: custos.secao_5_total,
      custos,
      fontes: {} as FontesConsulta,
    };
  }
  throw new Error(`Subtipo ${subtipo} desconhecido.`);
}

export async function buscarPropostaConsultoria(id: string) {
  const idNum = Number(id);
  if (!idNum) throw new Error('id invalido');
  const [rows] = await pool.execute<PropostaConsultoriaRow[]>(
    `SELECT p.*, c.nome AS cliente_nome, c.cpf_cnpj AS cliente_cpf_cnpj,
            c.telefone AS cliente_telefone, c.email AS cliente_email,
            c.endereco AS cliente_endereco, c.cidade AS cliente_cidade,
            c.estado AS cliente_estado
       FROM propostas p
       LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
      WHERE p.id = ? AND p.deleted_at IS NULL`,
    [idNum]
  );
  if (rows.length === 0) throw new Error('Proposta nao encontrada');
  const row = rows[0] as PropostaConsultoriaRow & {
    cliente_nome?: string; cliente_cpf_cnpj?: string;
    cliente_telefone?: string; cliente_email?: string;
    cliente_endereco?: string; cliente_cidade?: string; cliente_estado?: string;
  };
  return {
    id: String(row.id),
    numero: row.numero,
    tipo: row.tipo,
    subtipo: row.subtipo_consultoria,
    cliente: {
      id: row.cliente_id,
      nome: row.cliente_nome,
      cpf_cnpj: row.cliente_cpf_cnpj,
      telefone: row.cliente_telefone,
      email: row.cliente_email,
      endereco: row.cliente_endereco,
      cidade: row.cliente_cidade,
      estado: row.cliente_estado,
    },
    endereco_imovel: row.endereco_obra,
    data_proposta: row.data_proposta,
    validade_dias: row.validade_dias,
    valor_total: Number(row.valor_total),
    status: row.status,
    observacoes: row.observacoes,
    gestor_cargo: row.gestor_cargo,
    gestor_nome: row.gestor_nome,
    gestor_telefone: row.gestor_telefone,
    dados_imovel: parseJsonCol(row.dados_imovel),
    custos_calculados: parseJsonCol<CustosCalculados>(row.custos_calculados),
    fontes_consulta: parseJsonCol<FontesConsulta>(row.fontes_consulta),
  };
}

// MySQL2 retorna colunas tipo JSON ja parseadas em alguns ambientes,
// e como string em outros. Esta funcao trata os dois casos.
function parseJsonCol<T = unknown>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as T;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return null;
}

// v3.27.0: adapter para encaixar DemarcacaoLotesOutput no shape CustosCalculados
// (que e' o que vai pra coluna custos_calculados do DB e pro PDF generico).
function adaptarDemarcacaoParaCustosCalculados(out: DemarcacaoLotesOutput): CustosCalculados {
  // Linhas de honorarios "viraveis" no PDF generico — mas o render real do
  // Demarcacao usa honorarios_romatec_demarcacao diretamente.
  const secao_3_honorarios: ItemCusto[] = [
    { ordem: 1, descricao: 'TRT/CFT — Termo de Responsabilidade Tecnica', valor: out.honorarios_romatec.trt_cft },
    { ordem: 2, descricao: 'Tecnicos de campo + Marcos + Deslocamento + Area (com complexidade e assessoria)',
      valor: round2Lib(out.honorarios_romatec.total - out.honorarios_romatec.trt_cft + out.honorarios_romatec.desconto_valor) },
  ];
  if (out.honorarios_romatec.desconto_valor > 0) {
    secao_3_honorarios.push({ ordem: 3, descricao: 'Desconto aplicado', valor: -out.honorarios_romatec.desconto_valor });
  }
  const custos: CustosCalculados = {
    secao_1_projetos: [], // o render dedicado usa lista fixa ESCOPO_DEMARCACAO
    secao_2_taxas: [],
    secao_3_honorarios,
    condicoes_pagamento: out.parcelas.map((p) => ({
      rotulo: `${p.numero}a parcela — ${p.rotulo}`,
      descricao: `${p.percentual}% do total`,
      valor: p.valor,
    })),
    secao_4_checklist: [],
    secao_5_total: out.honorarios_romatec.total,
    avisos: [],
    honorarios_romatec: {
      trt: out.honorarios_romatec.trt_cft,
      tecnicos: round2Lib(
        out.honorarios_romatec.tecnicos_campo +
        out.honorarios_romatec.marcos_subtotal +
        out.honorarios_romatec.deslocamento +
        out.honorarios_romatec.area_servico,
      ),
      assessoria: out.honorarios_romatec.assessoria,
      total: out.honorarios_romatec.total,
    },
  };
  // Campos extras (acessados via cast no renderDemarcacaoLotesBody)
  (custos as unknown as { honorarios_romatec_demarcacao: DemarcacaoLotesOutput['honorarios_romatec'] }).honorarios_romatec_demarcacao = out.honorarios_romatec;
  (custos as unknown as { secao_opcionais_demarcacao: DemarcacaoLotesOutput['secao_opcionais_demarcacao'] }).secao_opcionais_demarcacao = out.secao_opcionais_demarcacao;
  if (out.codigos_mintados) {
    (custos as unknown as { codigos_mintados: NonNullable<DemarcacaoLotesOutput['codigos_mintados']> }).codigos_mintados = out.codigos_mintados;
  }
  return custos;
}

function round2Lib(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── PDF de 5 secoes ────────────────────────────────────────────────────────

const SUBTIPO_LABEL: Record<string, string> = {
  averbacao_residencial: 'AVERBACAO RESIDENCIAL',
  averbacao_comercial: 'AVERBACAO COMERCIAL',
  georreferenciamento_rural: 'GEORREFERENCIAMENTO RURAL',
  desmembramento: 'DESMEMBRAMENTO',
  remembramento: 'REMEMBRAMENTO',
  retificacao_area: 'RETIFICACAO DE AREA',
  avaliacao_ptam: 'AVALIACAO DE IMOVEIS (PTAM)',
  demarcacao_urbana: 'DEMARCACAO DE LOTE URBANO',
  demarcacao_rural: 'DEMARCACAO DE IMOVEL RURAL',
};

// v3.23.5: render do corpo do PDF de Georreferenciamento Rural conforme modelo
// aprovado PROP-2026-0011-R1. Renderiza:
//   - Identificacao do Imovel (extensao do bloco Cliente que ja foi renderizado pelo caller)
//   - BOX DOURADO de FINALIDADE
//   - 1. ESCOPO (8 itens)
//   - 2. HONORARIOS ROMATEC (tabela 3 linhas: TRT + Tec + Assess) + BOX VERDE TOTAL
//   - 3. CONDICOES DE PAGAMENTO (tabela 3 parcelas)
//   - 4. CUSTOS DE TERCEIROS (box creme + tabela secao_2_taxas)
//   - 5. SERVICOS ADICIONAIS OPCIONAIS (tabela 5 linhas sempre)
//   - 6. DOCUMENTOS A SEREM FORNECIDOS PELO CLIENTE (checklist)
//   - 7. AVISOS E CONDICOES TECNICAS
// O caller continua com Data/Validade, Responsavel Tecnico, Signature, QR, Footer.
// v3.23.7: exportada pra ser testavel diretamente via smoke test (pdf-parse).
// v3.24.5: helper de render do corpo da Proposta de Projeto Executivo.
// Layout: Identificacao da Obra + Objeto + Etapa Preliminar (box taxa R$750)
// + Projetos a Entregar (listagem) + Orcamento (tabela com SUBTOTAL/Desconto/
// VALOR TOTAL) + Condicoes + Documentos do Cliente + Avisos (CNO, ART/TRT).
export function renderProjetoExecutivoBody(
  doc: PDFKit.PDFDocument,
  p: Awaited<ReturnType<typeof buscarPropostaConsultoria>>,
  dadosImovel: Record<string, unknown>,
  custos: CustosCalculados,
  corHex: string,
): void {
  const COL_X_INI = 48;
  const COL_X_FIM = 547;
  const COL_W = COL_X_FIM - COL_X_INI;

  const COR_DOURADO_BG = '#fef3c7';
  const COR_DOURADO_BORDA = '#d97706';
  const COR_CREME_BG = '#fef9c3';
  const COR_CREME_BORDA = '#ca8a04';
  const COR_VERDE_BG = '#dcfce7';
  const COR_VERDE_BORDA = '#16a34a';

  const di = dadosImovel as Record<string, unknown>;
  const enderecoObra = (di.endereco_obra as string) || (di.endereco as string) || '—';
  const cidadeObra = (di.cidade_obra as string) || 'Acailandia';
  const ufObra = (di.uf_obra as string) || 'MA';
  const tipoEdif = ((di.tipo_edificacao as string) || 'residencial').toUpperCase();
  const area = Number(di.area_construir) || 0;
  // v3.24.8: area do terreno + taxa de ocupacao (opcional)
  const areaTerreno = Number(di.area_terreno) || 0;
  const taxaOcup = (di.taxa_ocupacao_percentual != null && areaTerreno > 0)
    ? Number(di.taxa_ocupacao_percentual)
    : (areaTerreno > 0 ? Math.round((area / areaTerreno) * 10000) / 100 : 0);
  const valorM2 = Number(di.valor_m2) || 25;
  const taxaEsboco = Number(di.taxa_esboco) || 750;
  const projetosLista = Array.isArray(di.projetos_selecionados)
    ? (di.projetos_selecionados as Array<{ codigo: string; nome: string; selecionado: boolean; detalhamento_entrega: string }>).filter(x => x.selecionado)
    : [];
  // v3.24.8: Programa de Necessidades — comodos selecionados
  const programaNecessidades = Array.isArray(di.programa_necessidades)
    ? (di.programa_necessidades as Array<{ codigo: string; nome: string; nome_plural: string; categoria: string; ordem_pdf: number; quantidade: number; observacao?: string | null }>)
    : [];

  // ── 1. OBJETO ─────────────────────────────────────────────────────────
  // v3.24.8: texto inclui terreno + taxa de ocupacao + referencia ao programa
  // quando esses dados estao disponiveis.
  const partesObj: string[] = [];
  partesObj.push(`area total a construir de ${area.toFixed(2)} m²`);
  if (areaTerreno > 0) {
    partesObj.push(`implantada em terreno de ${areaTerreno.toFixed(2)} m² (taxa de ocupacao de ${taxaOcup.toFixed(2)}%)`);
  }
  const partePrograma = programaNecessidades.length > 0
    ? ', contemplando o PROGRAMA DE NECESSIDADES descrito a seguir,'
    : ',';
  doc.fontSize(12).fillColor(corHex).font('Helvetica-Bold')
     .text('1. Objeto', COL_X_INI, doc.y, { width: COL_W });
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#222').font('Helvetica')
     .text(
       `A presente proposta tem por objeto a prestacao de servicos tecnicos especializados para a CONFECCAO DOS PROJETOS EXECUTIVOS DE ARQUITETURA E COMPLEMENTARES da edificacao abaixo identificada, com ${partesObj.join(', ')}${partePrograma} a serem desenvolvidos em conformidade com as Normas Brasileiras (ABNT), legislacao municipal de ${cidadeObra}/${ufObra} e Codigo de Obras vigente, sob responsabilidade tecnica do profissional habilitado.`,
       COL_X_INI, doc.y, { width: COL_W, align: 'justify' },
     );
  doc.moveDown(0.6);

  // ── 2. IMOVEL ─────────────────────────────────────────────────────────
  // v3.24.8: adiciona Area do Terreno e Taxa de Ocupacao quando informadas
  doc.fontSize(12).fillColor(corHex).font('Helvetica-Bold').text('2. Imovel / Obra');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#222').font('Helvetica');
  doc.text(`Endereco: ${enderecoObra}`, COL_X_INI, doc.y, { width: COL_W, continued: false });
  doc.text(`Cidade/UF: ${cidadeObra}/${ufObra}`, COL_X_INI, doc.y, { width: COL_W });
  doc.text(`Tipo de edificacao: ${tipoEdif}`, COL_X_INI, doc.y, { width: COL_W });
  if (areaTerreno > 0) {
    doc.text(`Area do terreno: ${areaTerreno.toFixed(2)} m²`, COL_X_INI, doc.y, { width: COL_W });
  }
  doc.text(`Area a construir: ${area.toFixed(2)} m²`, COL_X_INI, doc.y, { width: COL_W });
  if (areaTerreno > 0) {
    doc.text(`Taxa de ocupacao: ${taxaOcup.toFixed(2)}%`, COL_X_INI, doc.y, { width: COL_W });
    if (taxaOcup > 70) {
      doc.fontSize(8.5).fillColor('#92400e').font('Helvetica-Oblique')
         .text(
           '* A taxa de ocupacao informada devera ser validada conforme o Plano Diretor do Municipio de ' +
           `${cidadeObra}/${ufObra} e a Lei de Uso e Ocupacao do Solo vigente antes da aprovacao do projeto.`,
           COL_X_INI, doc.y, { width: COL_W, align: 'justify' },
         );
      doc.fillColor('#222').font('Helvetica').fontSize(10);
    }
  }
  doc.moveDown(0.6);

  // v3.24.8: Programa de Necessidades — listagem de comodos agrupados por categoria
  if (programaNecessidades.length > 0) {
    if (doc.y > 620) doc.addPage();
    doc.x = COL_X_INI;
    doc.fontSize(12).fillColor(corHex).font('Helvetica-Bold').text('3. Programa de Necessidades');
    doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#222').font('Helvetica')
       .text('O presente projeto contempla o programa de necessidades abaixo discriminado, composto pelos seguintes comodos:',
         COL_X_INI, doc.y, { width: COL_W, align: 'justify' });
    doc.moveDown(0.3);

    // Agrupa por categoria, mantem ordem_pdf interno
    const CAT_LABEL: Record<string, string> = {
      social: 'Area Social', intimo: 'Area Intima', servico: 'Area de Servico',
      externo: 'Area Externa', comercial: 'Area Comercial', tecnico: 'Areas Tecnicas',
    };
    const CAT_ORDER = ['social', 'intimo', 'servico', 'externo', 'comercial', 'tecnico'];
    const grupos: Record<string, typeof programaNecessidades> = {};
    for (const item of [...programaNecessidades].sort((a, b) => a.ordem_pdf - b.ordem_pdf)) {
      (grupos[item.categoria] ??= []).push(item);
    }
    for (const cat of CAT_ORDER) {
      const items = grupos[cat];
      if (!items || items.length === 0) continue;
      if (doc.y > 720) doc.addPage();
      doc.x = COL_X_INI;
      doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold')
         .text(CAT_LABEL[cat], COL_X_INI, doc.y, { width: COL_W });
      doc.font('Helvetica').fillColor('#222');
      for (const it of items) {
        const nome = it.quantidade > 1 ? it.nome_plural : it.nome;
        const linha = `  • ${String(it.quantidade).padStart(2, '0')} × ${nome}` +
                      (it.observacao ? ` — ${it.observacao}` : '');
        doc.x = COL_X_INI;
        doc.fontSize(9.5).fillColor('#222')
           .text(linha, COL_X_INI + 8, doc.y, { width: COL_W - 16, continued: false });
      }
      doc.moveDown(0.2);
    }
    const totalTipos = programaNecessidades.length;
    const totalComodos = programaNecessidades.reduce((s, p) => s + p.quantidade, 0);
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('#666').font('Helvetica-Oblique')
       .text(`Total: ${totalTipos} tipo(s) de comodo, ${totalComodos} ambiente(s) projetado(s).`,
         COL_X_INI, doc.y, { width: COL_W, align: 'right' });
    doc.moveDown(0.4);
  }

  // ── 3. ETAPA PRELIMINAR (box amarelo da TAXA DE R$ 750) ───────────────
  // v3.24.15 FIX: bloco e' atomico — calcula altura real ANTES de decidir
  // se cabe. Antes usava `if (doc.y > 600) addPage()`, limite estatico que
  // nao considerava a altura do texto (~280px) — o box cortava entre paginas
  // quando o conteudo anterior empurrava doc.y pra entre 514 e 600.
  const textoTaxa =
    `ETAPA PRELIMINAR — HORA TECNICA DE ANTEPROJETO E CROQUI\n\n` +
    `Valor: R$ ${taxaEsboco.toFixed(2).replace('.', ',')} (informativo, NAO incluido no VALOR TOTAL)\n\n` +
    `A etapa preliminar consiste no desenvolvimento do ESBOCO ARQUITETONICO (anteprojeto) e do CROQUI DE ESTUDO, atividade tecnica que precede e fundamenta toda a documentacao executiva subsequente. Compreende:\n\n` +
    `  a) Analise tecnica do terreno e levantamento das condicionantes legais (Plano Diretor, Lei de Uso e Ocupacao do Solo, recuos obrigatorios, taxa de ocupacao e coeficiente de aproveitamento);\n` +
    `  b) Reunioes de briefing com o CONTRATANTE para captacao do programa de necessidades e setorizacao funcional dos ambientes;\n` +
    `  c) Elaboracao do partido arquitetonico e estudos volumetricos preliminares;\n` +
    `  d) Confeccao do CROQUI ARQUITETONICO em planta baixa, com layout, areas aproximadas e implantacao no lote, observando insolacao e ventilacao;\n` +
    `  e) Apresentacao e ajustes do anteprojeto ate a aprovacao do CONTRATANTE para deflagrar a fase executiva.\n\n` +
    `CONDICAO ESPECIAL DE COBRANCA\n` +
    `► Caso o CONTRATANTE, apos a entrega e aprovacao do esboco, PROSSIGA com a contratacao integral dos projetos executivos descritos nesta proposta, o valor de R$ ${taxaEsboco.toFixed(2).replace('.', ',')} NAO SERA COBRADO, sendo absorvido pelo valor global do contrato.\n` +
    `► Caso o CONTRATANTE OPTE POR NAO PROSSEGUIR com a fase executiva apos a entrega do anteprojeto, fica acordado o pagamento da Hora Tecnica de R$ ${taxaEsboco.toFixed(2).replace('.', ',')}, que remunera exclusivamente o tempo tecnico empregado na elaboracao do croqui e estudos preliminares.\n\n` +
    `Este valor NAO esta incluido no VALOR TOTAL desta proposta (Secao 5), sendo mencionado apenas para clareza contratual.`;
  // Mede altura real com fontSize 9 (mesmo que vai renderizar)
  doc.fontSize(9).font('Helvetica');
  const textoH = doc.heightOfString(textoTaxa, { width: COL_W - 24 });
  const boxH = textoH + 20;
  // Verifica se cabe na pagina atual: limiteY = page.height - margins.bottom - 8 buffer
  const limiteY = doc.page.height - doc.page.margins.bottom - 8;
  if (doc.y + boxH > limiteY) doc.addPage();
  const boxY = doc.y;
  doc.rect(COL_X_INI, boxY, COL_W, boxH).fillAndStroke(COR_DOURADO_BG, COR_DOURADO_BORDA);
  doc.fontSize(9).fillColor('#713f12').font('Helvetica')
     .text(textoTaxa, COL_X_INI + 12, boxY + 10, { width: COL_W - 24, align: 'justify' });
  doc.y = boxY + boxH + 8;
  doc.x = COL_X_INI;

  // ── 4. PROJETOS A ENTREGAR ────────────────────────────────────────────
  if (doc.y > 600) doc.addPage();
  doc.x = COL_X_INI;
  doc.fontSize(12).fillColor(corHex).font('Helvetica-Bold')
     .text('4. Projetos a Entregar', COL_X_INI, doc.y, { width: COL_W });
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);
  projetosLista.forEach((proj, idx) => {
    doc.x = COL_X_INI;
    if (doc.y > 720) doc.addPage();
    doc.fontSize(10).fillColor('#111').font('Helvetica-Bold')
       .text(`4.${idx + 1} ${proj.nome}`, COL_X_INI, doc.y, { width: COL_W });
    doc.fontSize(9).fillColor('#444').font('Helvetica')
       .text(`Conteudo da prancha: ${proj.detalhamento_entrega}`, COL_X_INI + 8, doc.y, {
         width: COL_W - 16, align: 'justify',
       });
    doc.moveDown(0.3);
  });
  doc.moveDown(0.4);

  // ── 5. ORCAMENTO — REESTRUTURADO em v3.24.6 ─────────────────────────
  // DUAS TABELAS DISTINTAS:
  //   🅰 HONORARIOS TECNICOS (Romatec)        → parcelas 50/50
  //   🅱 DESPESAS ADMINISTRATIVAS (a parte)   → fora das parcelas
  // Bloco RESUMO no fim somando os 2 + INVESTIMENTO TOTAL DA OBRA.
  if (doc.y > 600) doc.addPage();
  doc.x = COL_X_INI;

  // Le os campos consolidados do projeto_executivo gravados em custos
  const pe = (di.projeto_executivo as Record<string, unknown> | undefined) ||
             (custos as unknown as { projeto_executivo?: Record<string, unknown> }).projeto_executivo;
  let honorarios = pe?.honorarios as { valor_projetos: number; responsabilidade_tipo: string; responsabilidade_valor: number; subtotal_honorarios: number; desconto_honorarios: number; total_honorarios: number; parcela_inicial: number; parcela_final: number; } | undefined;
  let despesas = pe?.despesas_administrativas as { diligencia_secretaria: { incluir: boolean; valor: number }; taxa_alvara_municipio: { incluir: boolean; valor: number }; placa_obra: { incluir: boolean; valor: number }; subtotal_despesas: number; } | undefined;
  let formaPag = pe?.forma_pagamento as { texto_renderizado: string; tag: string; } | undefined;

  // v3.24.14 FIX: propostas criadas antes do spread `projeto_executivo` no
  // custos_calculados ficam com `pe` undefined ou com honorarios sem valores
  // somados. Resultado: SUBTOTAL/TOTAL aparecem R$ 0,00. Reconstroi a estrutura
  // a partir do secao_3_honorarios + secao_2_taxas que SEMPRE existem.
  const subHonCalc = (custos.secao_3_honorarios || []).reduce((s, h) => s + (Number(h.valor) || 0), 0);
  const subDespCalc = (custos.secao_2_taxas || []).reduce((s, t) => s + (Number(t.valor) || 0), 0);
  const totalHonCalc = Math.round((subHonCalc + Number.EPSILON) * 100) / 100;
  const parcInicial = Math.round((totalHonCalc * 0.5 + Number.EPSILON) * 100) / 100;
  const parcFinal = Math.round((totalHonCalc - parcInicial + Number.EPSILON) * 100) / 100;

  if (!honorarios || !honorarios.subtotal_honorarios) {
    honorarios = {
      valor_projetos: (custos.secao_3_honorarios?.[0]?.valor) || 0,
      responsabilidade_tipo: /ART/i.test(custos.secao_3_honorarios?.[1]?.descricao || '') ? 'ART' : 'TRT',
      responsabilidade_valor: (custos.secao_3_honorarios?.[1]?.valor) || 0,
      subtotal_honorarios: totalHonCalc,
      desconto_honorarios: 0,
      total_honorarios: totalHonCalc,
      parcela_inicial: parcInicial,
      parcela_final: parcFinal,
    };
  }
  if (!despesas) {
    // Reconstroi a partir de secao_2_taxas. Identifica por keyword da descricao.
    const taxas = custos.secao_2_taxas || [];
    const findT = (re: RegExp) => taxas.find(t => re.test(t.descricao));
    const dilig = findT(/diligencia/i);
    const alvara = findT(/alvara/i);
    const placa = findT(/placa/i);
    despesas = {
      diligencia_secretaria: { incluir: !!dilig, valor: Number(dilig?.valor) || 0 },
      taxa_alvara_municipio: { incluir: !!alvara, valor: Number(alvara?.valor) || 0 },
      placa_obra: { incluir: !!placa, valor: Number(placa?.valor) || 0 },
      subtotal_despesas: subDespCalc,
    };
  }
  if (!formaPag) {
    // Default: 50% sinal + 50% entrega (formato sinal_mais_1)
    const fmtBR = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formaPag = {
      tag: 'sinal_mais_1',
      texto_renderizado:
        `Pagamento em 2 (duas) parcelas: R$ ${fmtBR(parcInicial)} como SINAL no inicio ` +
        `(assinatura do contrato / aprovacao do anteprojeto) e R$ ${fmtBR(parcFinal)} ` +
        `na ENTREGA FINAL dos projetos executivos em PDF via WhatsApp e e-mail.`,
    };
  }

  const colDesc = COL_X_INI + 8;
  const colValor = COL_X_FIM - 90;

  // ─── 🅰 TABELA HONORARIOS TECNICOS ──────────────────────────────────
  doc.fontSize(12).fillColor(corHex).font('Helvetica-Bold').text('5. Honorarios Tecnicos');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);

  doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold');
  const hHeaderY = doc.y;
  doc.text('Descricao', colDesc, hHeaderY, { width: colValor - colDesc - 8 });
  doc.text('Valor', colValor, hHeaderY, { width: 80, align: 'right' });
  doc.moveDown(0.5);
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ddd').lineWidth(0.5).stroke();
  doc.moveDown(0.2);

  // Linhas de honorarios (secao_3_honorarios = projetos + ART/TRT)
  custos.secao_3_honorarios.forEach((h) => {
    const y0 = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor('#222')
       .text(h.descricao, colDesc, y0, { width: colValor - colDesc - 8 });
    doc.font('Helvetica-Bold').fillColor(corHex)
       .text(formatBRL(h.valor), colValor, y0, { width: 80, align: 'right' });
    doc.moveDown(0.15);
  });
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#888').lineWidth(0.6).stroke();
  doc.moveDown(0.2);

  // SUBTOTAL HONORARIOS
  const subHonY = doc.y;
  doc.fontSize(10).fillColor('#111').font('Helvetica-Bold')
     .text('SUBTOTAL HONORARIOS', colDesc, subHonY, { width: colValor - colDesc - 8 });
  doc.text(formatBRL(honorarios?.subtotal_honorarios ?? 0), colValor, subHonY, { width: 80, align: 'right' });
  doc.moveDown(0.2);

  if ((honorarios?.desconto_honorarios ?? 0) > 0) {
    const dY = doc.y;
    doc.fontSize(9.5).fillColor('#444').font('Helvetica')
       .text('Desconto', colDesc, dY, { width: colValor - colDesc - 8 });
    doc.text('- ' + formatBRL(honorarios!.desconto_honorarios), colValor, dY, { width: 80, align: 'right' });
    doc.moveDown(0.2);
  }

  // TOTAL HONORARIOS (box verde)
  const totalHonBoxY = doc.y + 4;
  const totalHonBoxH = 26;
  doc.rect(COL_X_INI, totalHonBoxY, COL_W, totalHonBoxH).fillAndStroke(COR_VERDE_BG, COR_VERDE_BORDA);
  doc.fontSize(11).fillColor('#14532d').font('Helvetica-Bold')
     .text('TOTAL HONORARIOS', colDesc, totalHonBoxY + 8, { width: colValor - colDesc - 8 });
  doc.text(formatBRL(honorarios?.total_honorarios ?? 0), colValor, totalHonBoxY + 8, { width: 80, align: 'right' });
  doc.y = totalHonBoxY + totalHonBoxH + 6;

  // PARCELAMENTO HONORARIOS — usa forma_pagamento.texto_renderizado quando tag != personalizada
  if (honorarios) {
    if (doc.y > 700) doc.addPage();
    doc.x = COL_X_INI;
    doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold')
       .text('► PARCELAMENTO DOS HONORARIOS', COL_X_INI, doc.y, { width: COL_W });
    doc.moveDown(0.2);
    doc.fontSize(9.5).fillColor('#222').font('Helvetica')
       .text(formaPag?.texto_renderizado || 'A combinar entre as partes.', COL_X_INI + 8, doc.y, {
         width: COL_W - 16, align: 'justify', continued: false,
       });
    doc.moveDown(0.6);
  }

  // ─── 🅱 TABELA DESPESAS ADMINISTRATIVAS (so se houver) ──────────────
  const temDespesas = !!(despesas && despesas.subtotal_despesas > 0);
  if (temDespesas && despesas) {
    if (doc.y > 600) doc.addPage();
    doc.x = COL_X_INI;
    doc.fontSize(12).fillColor(corHex).font('Helvetica-Bold').text('6. Despesas Administrativas (pagas a parte)');
    doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.3);

    doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold');
    const dHeaderY = doc.y;
    doc.text('Descricao', colDesc, dHeaderY, { width: colValor - colDesc - 8 });
    doc.text('Valor', colValor, dHeaderY, { width: 80, align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ddd').lineWidth(0.5).stroke();
    doc.moveDown(0.2);

    // Linhas de despesas — secao_2_taxas (so as marcadas)
    custos.secao_2_taxas.forEach((t) => {
      const y0 = doc.y;
      doc.font('Helvetica').fontSize(9.5).fillColor('#222')
         .text(t.descricao, colDesc, y0, { width: colValor - colDesc - 8 });
      doc.font('Helvetica-Bold').fillColor(corHex)
         .text(formatBRL(t.valor), colValor, y0, { width: 80, align: 'right' });
      doc.moveDown(0.15);
    });
    doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#888').lineWidth(0.6).stroke();
    doc.moveDown(0.2);

    // SUBTOTAL DESPESAS
    const totalDespY = doc.y;
    doc.fontSize(10).fillColor('#111').font('Helvetica-Bold')
       .text('TOTAL DESPESAS ADMINISTRATIVAS', colDesc, totalDespY, { width: colValor - colDesc - 8 });
    doc.text(formatBRL(despesas.subtotal_despesas), colValor, totalDespY, { width: 80, align: 'right' });
    doc.moveDown(0.4);

    // Nota de rodape
    doc.fontSize(8.5).fillColor('#666').font('Helvetica-Oblique')
       .text(
         'Os valores das Despesas Administrativas NAO compoem os Honorarios Tecnicos e NAO estao sujeitos ao parcelamento descrito acima. Sao pagos pelo CONTRATANTE diretamente aos orgaos competentes ou reembolsados a CONTRATADA mediante apresentacao dos comprovantes.',
         COL_X_INI, doc.y, { width: COL_W, align: 'justify' },
       );
    doc.moveDown(0.6);
  }

  // ─── BLOCO RESUMO FINAL (INVESTIMENTO TOTAL DA OBRA) ────────────────
  if (doc.y > 680) doc.addPage();
  doc.x = COL_X_INI;
  const resumoBoxY = doc.y + 4;
  const resumoBoxH = temDespesas ? 78 : 38;
  doc.rect(COL_X_INI, resumoBoxY, COL_W, resumoBoxH).fillAndStroke('#1e3a8a', '#3b82f6');
  let resY = resumoBoxY + 8;
  if (temDespesas) {
    doc.fontSize(10).fillColor('#dbeafe').font('Helvetica')
       .text('TOTAL HONORARIOS TECNICOS:', COL_X_INI + 8, resY, { width: COL_W - 100 });
    doc.fillColor('#fff').font('Helvetica-Bold')
       .text(formatBRL(honorarios?.total_honorarios ?? 0), COL_X_FIM - 100, resY, { width: 90, align: 'right' });
    resY += 14;
    doc.fontSize(10).fillColor('#dbeafe').font('Helvetica')
       .text('TOTAL DESPESAS ADMINISTRATIVAS:', COL_X_INI + 8, resY, { width: COL_W - 100 });
    doc.fillColor('#fff').font('Helvetica-Bold')
       .text(formatBRL(despesas?.subtotal_despesas ?? 0), COL_X_FIM - 100, resY, { width: 90, align: 'right' });
    resY += 14;
    doc.moveTo(COL_X_INI + 8, resY).lineTo(COL_X_FIM - 8, resY).strokeColor('#60a5fa').lineWidth(0.7).stroke();
    resY += 4;
  }
  doc.fontSize(12).fillColor('#fff').font('Helvetica-Bold')
     .text('INVESTIMENTO TOTAL DA OBRA:', COL_X_INI + 8, resY, { width: COL_W - 110 });
  doc.fontSize(13).fillColor('#fbbf24')
     .text(formatBRL(custos.secao_5_total), COL_X_FIM - 110, resY, { width: 100, align: 'right' });
  doc.y = resumoBoxY + resumoBoxH + 6;

  doc.fontSize(8.5).fillColor('#666').font('Helvetica-Oblique')
     .text(
       `* A Hora Tecnica de Anteprojeto (R$ ${taxaEsboco.toFixed(2).replace('.', ',')}) descrita na Secao 3 NAO esta incluida neste total e somente sera cobrada na hipotese descrita naquela secao.`,
       COL_X_INI, doc.y, { width: COL_W, align: 'justify' },
     );
  doc.moveDown(0.6);

  // ── 7. DOCUMENTOS DO CLIENTE ──────────────────────────────────────────
  if (doc.y > 660) doc.addPage();
  doc.x = COL_X_INI;
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold')
     .text('7. Documentos a Serem Fornecidos pelo Cliente', COL_X_INI, doc.y, { width: COL_W });
  doc.font('Helvetica');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#111');
  custos.secao_4_checklist.forEach((d) => {
    doc.x = COL_X_INI;
    if (d.imprescindivel) {
      doc.fillColor('#dc2626').font('Helvetica-Bold')
         .text(`☐ [IMPRESCINDIVEL] ${d.texto}`, COL_X_INI + 8, doc.y, {
           width: COL_W - 16, continued: false,
         });
      doc.font('Helvetica').fillColor('#111');
    } else {
      doc.text(`☐ ${d.texto}${d.obrigatorio ? '' : '  (opcional)'}`, COL_X_INI + 8, doc.y, {
        width: COL_W - 16, continued: false,
      });
    }
  });
  doc.moveDown(0.5);

  // ── 8. AVISOS E CONDICOES TECNICAS ────────────────────────────────────
  if (custos.avisos && custos.avisos.length > 0) {
    if (doc.y > 660) doc.addPage();
    doc.x = COL_X_INI;
    doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold')
       .text('8. Avisos e Condicoes Tecnicas', COL_X_INI, doc.y, { width: COL_W });
    doc.font('Helvetica');
    doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(8.5).fillColor('#444');
    custos.avisos.forEach((a) => {
      doc.x = COL_X_INI;
      doc.text(`• ${a}`, COL_X_INI + 8, doc.y, {
        width: COL_W - 16, align: 'justify', continued: false,
      });
      doc.moveDown(0.15);
    });
    doc.fillColor('#111');
    doc.moveDown(0.3);
  }

  // ── 9. FORO E VALIDADE ────────────────────────────────────────────────
  if (doc.y > 660) doc.addPage();
  doc.x = COL_X_INI;
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('9. Foro e Validade');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.3);
  doc.fontSize(9.5).fillColor('#222').font('Helvetica')
     .text(
       `Fica eleito o Foro da Comarca de ${cidadeObra}/${ufObra} para dirimir quaisquer questoes oriundas desta proposta, com renuncia expressa a qualquer outro, por mais privilegiado que seja. Esta proposta tem validade de ${p.validade_dias || 30} (${(p.validade_dias || 30) === 1 ? 'um' : (p.validade_dias || 30).toString()}) dia(s) a contar da data de emissao.`,
       COL_X_INI, doc.y, { width: COL_W, align: 'justify' },
     );
  doc.moveDown(0.6);
  // Suprime aviso unused vars
  void COR_CREME_BG; void COR_CREME_BORDA;
}

export function renderGeorrefRuralBody(
  doc: PDFKit.PDFDocument,
  p: Awaited<ReturnType<typeof buscarPropostaConsultoria>>,
  dadosImovel: Record<string, unknown>,
  custos: CustosCalculados,
  corHex: string,
): void {
  const COL_X_INI = 48;
  const COL_X_FIM = 547;
  const COL_W = COL_X_FIM - COL_X_INI;

  // Constants visuais
  const COR_DOURADO_BG = '#fef3c7';     // amber-100
  const COR_DOURADO_BORDA = '#d97706';  // amber-600
  const COR_VERDE_BG = '#dcfce7';       // green-100
  const COR_VERDE_BORDA = '#16a34a';    // green-600
  const COR_CREME_BG = '#fef9c3';       // yellow-50
  const COR_CREME_BORDA = '#ca8a04';    // yellow-600

  // ── 1. IDENTIFICACAO — Imovel + Dados ─────────────────────────────────
  // (Cliente ja foi renderizado pelo caller; aqui completa com imovel)
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('1. Identificacao do Imovel');
  doc.font('Helvetica');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#111');

  const matricula = (dadosImovel.matricula as string | undefined) || '—';
  const cri = (dadosImovel.cri as string | undefined) || `CRI de ${dadosImovel.municipio || '—'}/${dadosImovel.estado || ''}`;
  const municipio = (dadosImovel.municipio as string | undefined) || '—';
  const estado = (dadosImovel.estado as string | undefined) || '';
  const area = Number(dadosImovel.area_hectares ?? 0);
  const vertices = Number(dadosImovel.numero_vertices ?? 0);
  const perimetro = dadosImovel.perimetro_m ? Number(dadosImovel.perimetro_m) : null;

  doc.text(`Municipio/UF:  ${municipio}${estado ? '/' + estado : ''}`);
  doc.text(`Matricula:  ${matricula}`);
  doc.text(`Cartorio:  ${cri}`);
  const areaFmt = area > 0
    ? area.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + ' ha'
    : '—';
  const perimFmt = perimetro ? perimetro.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m' : null;
  doc.text(`Area:  ${areaFmt}    ·    Vertices:  ${vertices}${perimFmt ? '    ·    Perimetro:  ' + perimFmt : ''}`);
  doc.moveDown(0.6);

  // ── BOX DOURADO de FINALIDADE ─────────────────────────────────────────
  const finalidade = (dadosImovel.finalidade as string | undefined) || 'CERTIFICACAO';
  const finalidadeTextos: Record<string, string> = {
    CERTIFICACAO:    'Georreferenciamento para fins de CERTIFICACAO no SIGEF/INCRA e averbacao do memorial certificado na matricula vigente.',
    DESMEMBRAMENTO:  'Georreferenciamento para fins de DESMEMBRAMENTO — certificacao no SIGEF/INCRA, encerramento da matricula atual e abertura de nova matricula para a area desmembrada.',
    REMEMBRAMENTO:   'Georreferenciamento para fins de REMEMBRAMENTO — certificacao no SIGEF/INCRA e unificacao de matriculas confrontantes em matricula unica.',
    RETIFICACAO:     'Georreferenciamento para fins de RETIFICACAO DE AREA — certificacao no SIGEF/INCRA e averbacao da nova area na matricula.',
  };
  const finalidadeTexto = finalidadeTextos[finalidade] || finalidadeTextos.CERTIFICACAO;

  const boxAlturaFinal = doc.heightOfString(finalidadeTexto, { width: COL_W - 28 }) + 28;
  const boxY1 = doc.y;
  doc.rect(COL_X_INI, boxY1, COL_W, boxAlturaFinal).fillAndStroke(COR_DOURADO_BG, COR_DOURADO_BORDA);
  doc.fontSize(8.5).fillColor(COR_DOURADO_BORDA).font('Helvetica-Bold')
     .text('FINALIDADE', COL_X_INI + 12, boxY1 + 8, { width: COL_W - 24 });
  doc.fontSize(9.5).fillColor('#111').font('Helvetica')
     .text(finalidadeTexto, COL_X_INI + 12, boxY1 + 22, { width: COL_W - 24, align: 'justify' });
  doc.y = boxY1 + boxAlturaFinal + 8;
  doc.x = COL_X_INI;

  // ── 2. ESCOPO DO SERVICO ──────────────────────────────────────────────
  if (doc.y > 700) doc.addPage();
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('2. Escopo do Servico');
  doc.font('Helvetica');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#111');
  custos.secao_1_projetos.forEach((item, i) => {
    doc.text(`${i + 1}. ${item}`, { indent: 8, width: COL_W - 8 });
  });
  doc.moveDown(0.5);

  // ── 3. HONORARIOS — ROMATEC CONSULTORIA TOTAL ─────────────────────────
  if (doc.y > 640) doc.addPage();
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('3. Honorarios — Romatec Consultoria Total');
  doc.font('Helvetica');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);

  // Tabela de honorarios — secao_3_honorarios (3 linhas: TRT + Tec + Assess)
  custos.secao_3_honorarios.forEach((h, i) => {
    const itemY0 = doc.y;
    doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold')
       .text(`${i + 1}. ${h.descricao}`, COL_X_INI + 8, itemY0, { width: COL_W - 100 });
    const itemY1 = doc.y;
    // Valor a direita, alinhado ao topo
    doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold')
       .text(formatBRL(h.valor), COL_X_FIM - 80, itemY0, { width: 80, align: 'right' });
    doc.y = itemY1;
    if (h.observacao) {
      doc.font('Helvetica').fontSize(8).fillColor('#555')
         .text(h.observacao, COL_X_INI + 16, doc.y, { width: COL_W - 24, align: 'justify' });
    }
    doc.font('Helvetica').fillColor('#111');
    doc.moveDown(0.3);
  });
  doc.moveDown(0.2);

  // BOX VERDE — VALOR TOTAL DA PROPOSTA (Romatec)
  const totalRomatec = custos.honorarios_romatec?.total ?? custos.secao_5_total;
  if (doc.y > 700) doc.addPage();
  const txtTotalLabel = 'VALOR TOTAL DA PROPOSTA (Romatec):';
  const txtTotalNota = 'Soma de TRT + Honorarios Tecnicos + Honorarios de Assessoria. Custos de cartorio e SIGEF (Secao 4) sao pagos diretamente pelo cliente e NAO estao inclusos.';
  const boxYT = doc.y;
  const boxAlturaT = doc.heightOfString(txtTotalNota, { width: COL_W - 24 }) + 38;
  doc.rect(COL_X_INI, boxYT, COL_W, boxAlturaT).fillAndStroke(COR_VERDE_BG, COR_VERDE_BORDA);
  doc.fontSize(10).fillColor(COR_VERDE_BORDA).font('Helvetica-Bold')
     .text(txtTotalLabel, COL_X_INI + 12, boxYT + 8, { width: COL_W - 120 });
  doc.fontSize(14).fillColor('#065f46').font('Helvetica-Bold')
     .text(formatBRL(totalRomatec), COL_X_FIM - 130, boxYT + 8, { width: 118, align: 'right' });
  doc.fontSize(8).fillColor('#166534').font('Helvetica')
     .text(txtTotalNota, COL_X_INI + 12, boxYT + 26, { width: COL_W - 24, align: 'justify' });
  doc.y = boxYT + boxAlturaT + 10;
  doc.x = COL_X_INI;

  // ── 4. CONDICOES DE PAGAMENTO ─────────────────────────────────────────
  if (custos.condicoes_pagamento && custos.condicoes_pagamento.length > 0) {
    if (doc.y > 680) doc.addPage();
    doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('4. Condicoes de Pagamento');
    doc.font('Helvetica');
    doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    custos.condicoes_pagamento.forEach((cp) => {
      const y0 = doc.y;
      doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold')
         .text(cp.rotulo, COL_X_INI + 8, y0, { width: COL_W - 100 });
      doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold')
         .text(formatBRL(cp.valor), COL_X_FIM - 80, y0, { width: 80, align: 'right' });
      doc.font('Helvetica').fontSize(8.5).fillColor('#444')
         .text(cp.descricao, COL_X_INI + 16, doc.y, { width: COL_W - 24 });
      doc.font('Helvetica').fillColor('#111');
      doc.moveDown(0.2);
    });
    doc.moveDown(0.3);
  }

  // ── 5. CUSTOS DE TERCEIROS (INFORMATIVO — A CARGO DO CLIENTE) ────────
  if (doc.y > 660) doc.addPage();
  const txtCustosTerceirosAviso = 'Os valores abaixo NAO estao inclusos no total da proposta — sao taxas oficiais pagas diretamente pelo cliente nos respectivos orgaos. Valores aproximados, sujeitos a alteracao conforme tabelas vigentes no momento do pagamento.';
  const boxYCT = doc.y;
  const boxAlturaCT = doc.heightOfString(txtCustosTerceirosAviso, { width: COL_W - 24 }) + 26;
  doc.rect(COL_X_INI, boxYCT, COL_W, boxAlturaCT).fillAndStroke(COR_CREME_BG, COR_CREME_BORDA);
  doc.fontSize(10).fillColor(COR_CREME_BORDA).font('Helvetica-Bold')
     .text('5. CUSTOS DE TERCEIROS (INFORMATIVO — A CARGO DO CLIENTE)', COL_X_INI + 12, boxYCT + 6, { width: COL_W - 24 });
  doc.fontSize(8).fillColor('#713f12').font('Helvetica')
     .text(txtCustosTerceirosAviso, COL_X_INI + 12, boxYCT + 20, { width: COL_W - 24, align: 'justify' });
  doc.y = boxYCT + boxAlturaCT + 6;
  doc.x = COL_X_INI;

  // Tabela secao_2_taxas (terceiros)
  custos.secao_2_taxas.forEach((t) => {
    const y0 = doc.y;
    doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold')
       .text(t.descricao, COL_X_INI + 8, y0, { width: COL_W - 100 });
    const valorTxt = t.pendente ? 'A apurar' : (t.valor === 0 ? 'Gratuito' : formatBRL(t.valor));
    doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold')
       .text(valorTxt, COL_X_FIM - 90, y0, { width: 90, align: 'right' });
    if (t.observacao) {
      doc.font('Helvetica').fontSize(8).fillColor('#666')
         .text(t.observacao, COL_X_INI + 16, doc.y, { width: COL_W - 24 });
    }
    doc.font('Helvetica').fillColor('#111');
    doc.moveDown(0.2);
  });
  doc.moveDown(0.4);

  // ── 6. SERVICOS ADICIONAIS OPCIONAIS ──────────────────────────────────
  const opc = custos.secao_opcionais_georref;
  if (opc) {
    if (doc.y > 660) doc.addPage();
    doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('6. Servicos Adicionais Opcionais');
    doc.font('Helvetica');
    doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(8).fillColor('#666').font('Helvetica-Oblique')
       .text('NAO somam ao total da proposta. Marcados se contratados; valor congelado no momento do envio.', { indent: 8, width: COL_W - 8 });
    doc.font('Helvetica').fillColor('#111');
    doc.moveDown(0.2);

    opc.itens.forEach((it) => {
      const y0 = doc.y;
      const check = it.contratado ? '☑' : '☐';
      doc.fontSize(9.5).fillColor('#111').font(it.contratado ? 'Helvetica-Bold' : 'Helvetica')
         .text(`${check} ${it.rotulo}`, COL_X_INI + 8, y0, { width: COL_W - 100 });
      let valorTxt: string;
      if (it.subtotal === 'sob_orcamento') {
        valorTxt = 'Sob orcamento';
      } else if (it.subtotal === 0) {
        valorTxt = it.quantidade != null && it.contratado === false
          ? `R$ ${typeof it.valor_unitario === 'number' ? it.valor_unitario.toFixed(2) : '—'}/un.`
          : '—';
      } else {
        valorTxt = formatBRL(it.subtotal as number);
      }
      doc.fontSize(9.5).fillColor(it.contratado ? corHex : '#666').font(it.contratado ? 'Helvetica-Bold' : 'Helvetica')
         .text(valorTxt, COL_X_FIM - 100, y0, { width: 100, align: 'right' });
      doc.font('Helvetica').fillColor('#111');
      doc.moveDown(0.1);
    });

    if (opc.subtotal > 0) {
      doc.moveDown(0.2);
      doc.fontSize(9.5).fillColor('#666').font('Helvetica-Bold')
         .text(`Subtotal opcionais contratados: ${formatBRL(opc.subtotal)}  (cobrado a parte)`, { indent: 8, align: 'right', width: COL_W - 16 });
      doc.font('Helvetica');
    }
    doc.moveDown(0.4);
  }

  // ── 7. DOCUMENTOS A SEREM FORNECIDOS PELO CLIENTE ─────────────────────
  // v3.23.8 BUG-FIX: reset explicito de doc.x antes da seccao. Antes a tabela de
  // honorarios renderizava valores com `text(..., COL_X_FIM - 80, ...)` deixando
  // doc.x desalinhado; o forEach abaixo usava {indent: 8} relativo a esse x
  // deslocado, reduzindo a largura efetiva pra ~150px (cortando texto a direita).
  // Agora cada text() passa x/y absolutos + width: COL_W - 16 explicito.
  if (doc.y > 660) doc.addPage();
  doc.x = COL_X_INI;
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold')
     .text('7. Documentos a Serem Fornecidos pelo Cliente', COL_X_INI, doc.y, { width: COL_W });
  doc.font('Helvetica');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#111');
  custos.secao_4_checklist.forEach((d) => {
    doc.x = COL_X_INI; // reset por iteracao — text() com align nao deixa lixo
    if (d.imprescindivel) {
      doc.fillColor('#dc2626').font('Helvetica-Bold')
         .text(`☐ [IMPRESCINDIVEL] ${d.texto}`, COL_X_INI + 8, doc.y, {
           width: COL_W - 16, continued: false,
         });
      doc.font('Helvetica').fillColor('#111');
    } else {
      doc.text(`☐ ${d.texto}${d.obrigatorio ? '' : '  (opcional)'}`, COL_X_INI + 8, doc.y, {
        width: COL_W - 16, continued: false,
      });
    }
  });
  doc.moveDown(0.5);

  // ── 8. AVISOS E CONDICOES TECNICAS ────────────────────────────────────
  if (custos.avisos && custos.avisos.length > 0) {
    if (doc.y > 660) doc.addPage();
    doc.x = COL_X_INI;
    doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold')
       .text('8. Avisos e Condicoes Tecnicas', COL_X_INI, doc.y, { width: COL_W });
    doc.font('Helvetica');
    doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(8.5).fillColor('#444');
    custos.avisos.forEach((a) => {
      doc.x = COL_X_INI;
      doc.text(`• ${a}`, COL_X_INI + 8, doc.y, {
        width: COL_W - 16, align: 'justify', continued: false,
      });
      doc.moveDown(0.15);
    });
    doc.fillColor('#111');
    doc.moveDown(0.3);
  }

  // v3.23.5: Aviso DRL obrigatorio em TODA proposta de Georref Rural, qualquer
  // finalidade. Regulamentar — texto fixo gerado pelo backend, NAO editavel.
  // Texto base para CERTIFICACAO; reforco adicional pra RETIFICACAO; paragrafo
  // extra pra DESMEMBRAMENTO/REMEMBRAMENTO.
  const finalidadeDRL = (dadosImovel.finalidade as FinalidadeGeorref | undefined) || 'CERTIFICACAO';
  renderAvisoDRL(doc, finalidadeDRL, COL_X_INI, COL_W);
}

// v3.23.5: render do box vermelho de aviso DRL no final da Secao 8.
// NAO pode partir entre paginas — se nao couber inteiro, addPage antes.
function renderAvisoDRL(
  doc: PDFKit.PDFDocument,
  finalidade:
    | 'CERTIFICACAO' | 'DESMEMBRAMENTO' | 'REMEMBRAMENTO' | 'RETIFICACAO'
    | 'demarcacao_inicial' | 'redemarcacao' | 'subdivisao_lote' | 'piqueteamento_apenas',
  colXIni: number,
  colW: number,
): void {
  const COR_BORDA = '#c0392b';
  const COR_FUNDO = '#fdecea';
  const COR_TITULO = '#922b21';
  const PADDING = 12;
  const LINE_GAP_PARAGRAFO = 0.4;

  const bloco = montarAvisoDRL(finalidade);

  // Pre-calcula altura: usa doc.heightOfString em fragmentos concatenados pra
  // ter uma estimativa. PDFKit nao permite measure de texto com fontes/cores
  // misturadas, entao concatenamos o plain text com font padrao.
  doc.fontSize(10).font('Helvetica-Bold');
  const alturaTitulo = doc.heightOfString(bloco.titulo, { width: colW - 2 * PADDING });
  doc.fontSize(8.5).font('Helvetica');
  let alturaConteudo = 0;
  for (const p of bloco.paragrafos) {
    const plain = p.fragmentos.map((f) => f.text).join('');
    alturaConteudo += doc.heightOfString(plain, { width: colW - 2 * PADDING });
    alturaConteudo += 6; // line gap
  }
  // Margem interna: PADDING top + titulo + 8px gap + conteudo + PADDING bottom
  const alturaTotal = PADDING + alturaTitulo + 8 + alturaConteudo + PADDING;

  // Quebra de pagina se nao couber inteiro (regra: o aviso nao pode ser cortado)
  // Considera margem inferior segura de 60px (footer + QR podem ocupar)
  if (doc.y + alturaTotal + 8 > doc.page.height - 100) {
    doc.addPage();
  }

  const startY = doc.y + 6;
  doc.save()
     .roundedRect(colXIni, startY, colW, alturaTotal, 4)
     .lineWidth(1.5)
     .fillAndStroke(COR_FUNDO, COR_BORDA);
  doc.restore();

  // Conteudo
  doc.x = colXIni + PADDING;
  doc.y = startY + PADDING;

  // Titulo
  doc.fontSize(10).fillColor(COR_TITULO).font('Helvetica-Bold');
  doc.text(`! ${bloco.titulo}`, { width: colW - 2 * PADDING, align: 'left', lineBreak: true });
  doc.moveDown(0.4);

  // Paragrafos com formatacao inline (continued: true alternando fonte/cor)
  doc.fontSize(8.5);
  for (const p of bloco.paragrafos) {
    doc.x = colXIni + PADDING;
    const last = p.fragmentos.length - 1;
    p.fragmentos.forEach((frag, i) => {
      doc.font(frag.bold ? 'Helvetica-Bold' : 'Helvetica')
         .fillColor(frag.destaque ? COR_TITULO : '#000000');
      doc.text(frag.text, {
        continued: i < last,
        width: colW - 2 * PADDING,
        align: 'left',
      });
    });
    doc.moveDown(LINE_GAP_PARAGRAFO);
  }

  // Reset apos o box
  doc.y = startY + alturaTotal + 10;
  doc.x = colXIni;
  doc.font('Helvetica').fillColor('#111');
}

// v3.33.0: snapshot v2 do adicional (3 blocos congelados + norma vigente).
// Gravado em custos_calculados.adicional_campo na criacao da proposta.
interface AdicionalCampoSnapshotPdf {
  ativo: boolean;
  percentual: number;
  cenario: string;
  tipo: 'insalubridade' | 'periculosidade';
  grau: 'minimo' | 'medio' | 'maximo' | 'unico';
  bloco_fundamento_legal: string;
  bloco_enquadramento_tecnico: string;
  bloco_justificativa_cliente: string;
  observacao_adicional?: string;
  norma_vigente_congelada: {
    fonte: string;
    versao_referencia: string;
    data_snapshot: string;
  };
}

// v3.33.0 (= v3.27.1 do prompt): render do bloco de adicional REFACTORED.
// Box dourado p/ Insalubridade, vermelho p/ Periculosidade. 3 blocos
// juridicos congelados + observacao opcional + selo da norma vigente
// (proteção forense).
function renderAdicionalCampoBody(
  doc: PDFKit.PDFDocument,
  snap: AdicionalCampoSnapshotPdf,
  colX: number,
  colW: number,
): void {
  const isPeric = snap.tipo === 'periculosidade';
  const COR_BORDA = isPeric ? '#922b21' : '#B45309';     // red-800 / amber-700
  const COR_BG = isPeric ? '#FEE2E2' : '#FEF3C7';         // red-100 / amber-100
  const COR_TITULO = isPeric ? '#7f1d1d' : '#92400E';     // red-900 / amber-900
  const PADDING = 12;
  const colXIni = colX;

  // Pre-calcula altura — 3 blocos + cabecalho + rodape
  doc.fontSize(9);
  const altBloco1 = doc.heightOfString(snap.bloco_fundamento_legal, { width: colW - 2 * PADDING - 16 });
  const altBloco2 = doc.heightOfString(snap.bloco_enquadramento_tecnico, { width: colW - 2 * PADDING - 16 });
  const altBloco3 = doc.heightOfString(snap.bloco_justificativa_cliente, { width: colW - 2 * PADDING - 16 });
  const altObs = snap.observacao_adicional ? doc.heightOfString(snap.observacao_adicional, { width: colW - 2 * PADDING - 16 }) + 14 : 0;
  const altTotal = PADDING + 26 /* cabecalho */ + 24 /* linha cenario */
    + 22 + altBloco1 /* bloco 1 */
    + 22 + altBloco2 /* bloco 2 */
    + 22 + altBloco3 /* bloco 3 */
    + altObs + 18 /* rodape norma */ + PADDING;

  if (doc.y + altTotal + 12 > doc.page.height - doc.page.margins.bottom - 80) {
    doc.addPage();
  }

  const startY = doc.y;
  doc.save()
    .roundedRect(colXIni, startY, colW, altTotal, 6)
    .lineWidth(1.3)
    .fillAndStroke(COR_BG, COR_BORDA);
  doc.restore();

  doc.x = colXIni + PADDING;
  doc.y = startY + PADDING;

  // Cabecalho
  doc.fontSize(11).fillColor(COR_TITULO).font('Helvetica-Bold');
  const titulo = isPeric
    ? '⚠ ADICIONAL DE PERICULOSIDADE'
    : '⚠ ADICIONAL DE INSALUBRIDADE';
  doc.text(`${titulo}  ·  +${snap.percentual.toFixed(0)}%`, { width: colW - 2 * PADDING });
  doc.moveDown(0.3);

  // Linha de cenario + grau
  doc.fontSize(9.5).fillColor('#111').font('Helvetica');
  const grauTexto = snap.grau === 'unico' ? '' : `, Grau ${snap.grau.charAt(0).toUpperCase() + snap.grau.slice(1)}`;
  doc.text(`Cenário: ${snap.cenario.replace(/_/g, ' ')}${grauTexto}`, { width: colW - 2 * PADDING });
  doc.moveDown(0.4);

  // Bloco 1 — Fundamento Legal (locked)
  doc.fontSize(9.5).fillColor(COR_TITULO).font('Helvetica-Bold')
    .text('📜 FUNDAMENTO LEGAL', { width: colW - 2 * PADDING });
  doc.fontSize(8.5).fillColor('#111').font('Helvetica')
    .text(snap.bloco_fundamento_legal, colX + PADDING + 8, doc.y, {
      width: colW - 2 * PADDING - 8, align: 'justify',
    });
  doc.moveDown(0.4);

  // Bloco 2 — Enquadramento Tecnico
  doc.fontSize(9.5).fillColor(COR_TITULO).font('Helvetica-Bold')
    .text('🔍 ENQUADRAMENTO TÉCNICO', colX + PADDING, doc.y, { width: colW - 2 * PADDING });
  doc.fontSize(8.5).fillColor('#111').font('Helvetica')
    .text(snap.bloco_enquadramento_tecnico, colX + PADDING + 8, doc.y, {
      width: colW - 2 * PADDING - 8, align: 'justify',
    });
  doc.moveDown(0.4);

  // Bloco 3 — Justificativa ao Cliente
  doc.fontSize(9.5).fillColor(COR_TITULO).font('Helvetica-Bold')
    .text('💬 JUSTIFICATIVA AO CLIENTE', colX + PADDING, doc.y, { width: colW - 2 * PADDING });
  doc.fontSize(8.5).fillColor('#111').font('Helvetica')
    .text(snap.bloco_justificativa_cliente, colX + PADDING + 8, doc.y, {
      width: colW - 2 * PADDING - 8, align: 'justify',
    });
  doc.moveDown(0.3);

  // Observacao adicional (opcional)
  if (snap.observacao_adicional) {
    doc.fontSize(8.5).fillColor('#555').font('Helvetica-Oblique')
      .text(`Observação técnica: ${snap.observacao_adicional}`, colX + PADDING, doc.y, {
        width: colW - 2 * PADDING, align: 'justify',
      });
    doc.moveDown(0.2);
  }

  // Selo da norma (rodape)
  doc.fontSize(7.5).fillColor('#6B7280').font('Helvetica-Oblique')
    .text(`Norma vigente: ${snap.norma_vigente_congelada.versao_referencia} · Snapshot: ${snap.norma_vigente_congelada.data_snapshot}`,
      colX + PADDING, doc.y, { width: colW - 2 * PADDING });

  doc.font('Helvetica').fillColor('#111');
  doc.y = startY + altTotal + 12;
  doc.x = colXIni;
}

// v3.29.0: bloco amber com aviso de aditivo de campo (insalubridade/periculosidade).
// Renderizado no fim do body, ANTES do QR + hash, em todos os subtipos.
// Markdown parser minimalista (sem dep externa): parser linha-a-linha cobrindo
// `## titulo`, `**negrito**`, `- bullet` e paragrafos.
function renderAditivoCampoBody(
  doc: PDFKit.PDFDocument,
  snap: AditivoSnapshotComputado,
  colX: number,
  colW: number,
): void {
  const COR_AMBER_BORDA = '#B45309';     // amber-700
  const COR_AMBER_BG = '#FEF3C7';        // amber-100
  const COR_AMBER_TITULO = '#92400E';    // amber-900
  const PADDING = 12;

  // Pre-render: calcula altura aproximada (linhas + paragrafos)
  // Como o markdown e' arbitrario, estima por chars/linha + bullets.
  const linhas = snap.texto_pdf_md.split('\n');
  doc.fontSize(9).font('Helvetica');
  let alturaEstimada = 60; // titulo + padding + rodape legal
  for (const ln of linhas) {
    if (!ln.trim()) { alturaEstimada += 4; continue; }
    const limpo = ln
      .replace(/^##\s+/, '')
      .replace(/^[-*]\s+/, '• ')
      .replace(/\*\*(.+?)\*\*/g, '$1');
    alturaEstimada += doc.heightOfString(limpo, { width: colW - 2 * PADDING }) + 2;
  }

  if (doc.y + alturaEstimada + 16 > doc.page.height - doc.page.margins.bottom - 80) {
    doc.addPage();
  }

  const startY = doc.y;
  // Box amber
  doc.save()
     .roundedRect(colX, startY, colW, alturaEstimada, 6)
     .lineWidth(1.2)
     .fillAndStroke(COR_AMBER_BG, COR_AMBER_BORDA);
  doc.restore();

  doc.x = colX + PADDING;
  doc.y = startY + PADDING;

  // Titulo
  doc.fontSize(11).fillColor(COR_AMBER_TITULO).font('Helvetica-Bold');
  doc.text(`⚠ ${snap.descricao_curta.toUpperCase()}`, { width: colW - 2 * PADDING, lineBreak: true });
  doc.moveDown(0.3);

  // Linha do valor
  doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold');
  doc.text(
    `Valor aplicado: R$ ${snap.valor_aditivo.toFixed(2)}  ·  ${snap.percentual.toFixed(0)}% sobre R$ ${snap.base_calculo_valor.toFixed(2)}  (${snap.base_calculo_descricao})`,
    { width: colW - 2 * PADDING },
  );
  doc.moveDown(0.4);

  // Render markdown linha a linha
  doc.fontSize(8.5).fillColor('#111').font('Helvetica');
  for (const ln of linhas) {
    if (!ln.trim()) { doc.moveDown(0.25); continue; }
    let texto = ln;
    let estilo: 'titulo' | 'bullet' | 'paragrafo' = 'paragrafo';
    if (/^##\s+/.test(texto)) {
      texto = texto.replace(/^##\s+/, '');
      estilo = 'titulo';
    } else if (/^[-*]\s+/.test(texto)) {
      texto = '  • ' + texto.replace(/^[-*]\s+/, '');
      estilo = 'bullet';
    }

    if (estilo === 'titulo') {
      // ja temos titulo principal — usa subtitulo
      doc.fontSize(9.5).fillColor(COR_AMBER_TITULO).font('Helvetica-Bold');
      const plain = texto.replace(/\*\*(.+?)\*\*/g, '$1');
      doc.text(plain, { width: colW - 2 * PADDING });
      doc.fontSize(8.5).fillColor('#111').font('Helvetica');
      doc.moveDown(0.2);
      continue;
    }

    // Tokenize bold inline: split por `**...**`
    const tokens = texto.split(/(\*\*[^*]+\*\*)/);
    doc.x = colX + PADDING;
    const segmentos = tokens.filter((t) => t.length > 0);
    segmentos.forEach((seg, i) => {
      const isLast = i === segmentos.length - 1;
      const bold = /^\*\*[^*]+\*\*$/.test(seg);
      const limpo = bold ? seg.slice(2, -2) : seg;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(limpo, {
        continued: !isLast,
        width: colW - 2 * PADDING,
      });
    });
    doc.font('Helvetica');
    doc.moveDown(0.15);
  }

  // Rodape legal
  doc.moveDown(0.3);
  doc.fontSize(7.5).fillColor('#6B7280').font('Helvetica-Oblique');
  doc.text(`Fundamentação legal: ${snap.fundamentacao_legal}`, {
    width: colW - 2 * PADDING, align: 'left',
  });

  doc.font('Helvetica').fillColor('#111');
  doc.y = startY + alturaEstimada + 12;
  doc.x = colX;
}

// v3.27.0: render do corpo do PDF de Demarcacao de Lotes (Urbana e Rural).
// Espelha o layout aprovado da v3.23.5 (Georref Rural), com 2 secoes extras:
//   - 4-bis: Marcos Discriminados (tabela tipo x qtd x valor unit x subtotal)
//   - 4-ter: Identificacao dos Marcos FQNS (codigos vitalicios INCRA)
// Total: 11 secoes. Invocada SO para subtipo ∈ {demarcacao_urbana, demarcacao_rural}.
const FINALIDADE_DEMARCACAO_TEXTOS: Record<FinalidadeDemarcacao, string> = {
  demarcacao_inicial: 'Levantamento topografico de campo para implantacao fisica dos vertices definidos em projeto e materializacao da poligonal do imovel no terreno.',
  redemarcacao: 'Repiqueteamento de vertices perdidos/deteriorados, restabelecendo a poligonal original conforme matricula e levantamento anterior.',
  subdivisao_lote: 'Demarcacao fisica das fracoes resultantes de desmembramento/remembramento aprovado, com implantacao de marcos nas novas divisas.',
  piqueteamento_apenas: 'Implantacao de marcos fisicos em vertices previamente calculados em escritorio (sem novo levantamento de campo).',
};

const ESCOPO_DEMARCACAO = [
  'Levantamento topografico georreferenciado com GNSS RTK / Estacao Total nas divisas existentes',
  'Implantacao fisica dos marcos nas vertices da poligonal conforme NTGIR/INCRA',
  'Codificacao dos marcos com credencial INCRA do tecnico responsavel (rastreabilidade vitalicia)',
  'Croqui ilustrativo da poligonal com identificacao dos marcos',
  'Memorial Descritivo da demarcacao com coordenadas WGS84/SIRGAS2000',
  'TRT/CFT — Termo de Responsabilidade Tecnica (CFT/MA)',
  'Acompanhamento tecnico durante a instalacao dos marcos em campo',
  'Orientacao ao proprietario sobre coleta de DRLs e averbacao em cartorio',
];

const MATERIAL_LABEL: Record<MaterialMarco, string> = {
  concreto: 'Marco de Concreto Padrao INCRA',
  tubo_galvanizado: 'Marco em Tubo Galvanizado',
  madeira: 'Marco de Madeira de Lei (Piquete)',
};

function docsImprescindiveisDemarcacao(
  subtipo: 'demarcacao_urbana' | 'demarcacao_rural',
  finalidade: FinalidadeDemarcacao,
): { texto: string; imprescindivel: boolean }[] {
  const baseImpresc = [
    { texto: 'RG/CPF do proprietario', imprescindivel: true },
    { texto: 'Comprovante de residencia do proprietario', imprescindivel: false },
  ];
  if (finalidade === 'redemarcacao') {
    return [
      { texto: 'Levantamento topografico anterior OU matricula com descritivo de divisas', imprescindivel: true },
      ...baseImpresc,
    ];
  }
  if (finalidade === 'piqueteamento_apenas') {
    return [
      { texto: 'Coordenadas dos vertices em arquivo .csv ou .kml (georreferenciado)', imprescindivel: true },
      { texto: 'Matricula atual', imprescindivel: true },
      ...baseImpresc,
    ];
  }
  if (subtipo === 'demarcacao_urbana') {
    if (finalidade === 'subdivisao_lote') {
      return [
        { texto: 'Escritura ou matricula atual', imprescindivel: true },
        { texto: 'Memorial do desmembramento aprovado', imprescindivel: true },
        { texto: 'Planta carimbada pela Prefeitura', imprescindivel: true },
        ...baseImpresc,
      ];
    }
    // demarcacao_inicial urbana
    return [
      { texto: 'Escritura ou matricula atual', imprescindivel: true },
      { texto: 'IPTU em dia (ultimo exercicio)', imprescindivel: true },
      { texto: 'Projeto aprovado pela Prefeitura (quando houver)', imprescindivel: false },
      ...baseImpresc,
    ];
  }
  // demarcacao_rural
  if (finalidade === 'subdivisao_lote') {
    return [
      { texto: 'Matricula atual', imprescindivel: true },
      { texto: 'Georreferenciamento de origem certificado pelo INCRA', imprescindivel: true },
      { texto: 'Memorial das fracoes resultantes', imprescindivel: true },
      ...baseImpresc,
    ];
  }
  return [
    { texto: 'Matricula atual', imprescindivel: true },
    { texto: 'CCIR vigente (INCRA)', imprescindivel: true },
    { texto: 'ITR pago — ultimo exercicio', imprescindivel: false },
    ...baseImpresc,
  ];
}

function renderDemarcacaoLotesBody(
  doc: PDFKit.PDFDocument,
  p: Awaited<ReturnType<typeof buscarPropostaConsultoria>>,
  dadosImovel: Record<string, unknown>,
  custos: CustosCalculados,
  corHex: string,
): void {
  const COL_X_INI = 48;
  const COL_X_FIM = 547;
  const COL_W = COL_X_FIM - COL_X_INI;

  const COR_DOURADO_BG = '#fef3c7';
  const COR_DOURADO_BORDA = '#d97706';
  const COR_VERDE_BG = '#dcfce7';
  const COR_VERDE_BORDA = '#16a34a';
  const COR_CREME_BG = '#fef9c3';
  const COR_CREME_BORDA = '#ca8a04';

  const subtipo = p.subtipo as 'demarcacao_urbana' | 'demarcacao_rural';
  const isUrbana = subtipo === 'demarcacao_urbana';

  // Input persistido em dados_imovel
  const di = dadosImovel as Partial<InputDemarcacaoLotes>;
  const finalidade = (di.finalidade || 'demarcacao_inicial') as FinalidadeDemarcacao;
  const codigos = (custos as unknown as { codigos_mintados?: DemarcacaoLotesOutput['codigos_mintados'] }).codigos_mintados;
  const hr = (custos as unknown as { honorarios_romatec_demarcacao?: DemarcacaoLotesOutput['honorarios_romatec'] }).honorarios_romatec_demarcacao;

  // ── 1. IDENTIFICACAO DO IMOVEL ────────────────────────────────────────
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('1. Identificacao do Imovel');
  doc.font('Helvetica');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#111');

  const municipio = di.municipio || '-';
  const uf = di.uf || '';
  const matricula = di.matricula || '-';
  const cri = di.cri || `CRI de ${municipio}/${uf}`;
  const perimetro = Number(di.perimetro_m || 0);
  const vertices = Number(di.num_vertices || 0);

  doc.text(`Municipio/UF:  ${municipio}${uf ? '/' + uf : ''}`);
  doc.text(`Matricula:  ${matricula}    ·    Cartorio:  ${cri}`);
  if (isUrbana) {
    const lot = di.loteamento_nome ? `Loteamento ${di.loteamento_nome}` : '';
    const qd = di.quadra ? `Quadra ${di.quadra}` : '';
    const lt = di.lote ? `Lote ${di.lote}` : '';
    const linha = [lot, qd, lt].filter(Boolean).join('    ·    ');
    if (linha) doc.text(linha);
    if (di.area_m2) {
      doc.text(`Area:  ${Number(di.area_m2).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} m²    ·    Vertices:  ${vertices}${perimetro > 0 ? '    ·    Perimetro:  ' + perimetro.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m' : ''}`);
    }
  } else {
    if (di.denominacao_imovel) doc.text(`Denominacao:  ${di.denominacao_imovel}${di.ccir ? '    ·    CCIR:  ' + di.ccir : ''}`);
    if (di.area_hectares) {
      doc.text(`Area:  ${Number(di.area_hectares).toLocaleString('pt-BR', { minimumFractionDigits: 4 })} ha    ·    Vertices:  ${vertices}${perimetro > 0 ? '    ·    Perimetro:  ' + perimetro.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' m' : ''}`);
    }
  }
  doc.moveDown(0.6);

  // ── 2. BOX DOURADO — FINALIDADE ───────────────────────────────────────
  const textoFinal = FINALIDADE_DEMARCACAO_TEXTOS[finalidade];
  const boxAltFin = doc.heightOfString(textoFinal, { width: COL_W - 28 }) + 28;
  const boxYFin = doc.y;
  doc.rect(COL_X_INI, boxYFin, COL_W, boxAltFin).fillAndStroke(COR_DOURADO_BG, COR_DOURADO_BORDA);
  doc.fontSize(8.5).fillColor(COR_DOURADO_BORDA).font('Helvetica-Bold')
    .text('FINALIDADE', COL_X_INI + 12, boxYFin + 8, { width: COL_W - 24 });
  doc.fontSize(9.5).fillColor('#111').font('Helvetica')
    .text(textoFinal, COL_X_INI + 12, boxYFin + 22, { width: COL_W - 24, align: 'justify' });
  doc.y = boxYFin + boxAltFin + 8;
  doc.x = COL_X_INI;

  // ── 3. ESCOPO DO SERVICO ──────────────────────────────────────────────
  if (doc.y > 700) doc.addPage();
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('3. Escopo do Servico');
  doc.font('Helvetica');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#111');
  ESCOPO_DEMARCACAO.forEach((item, i) => {
    doc.text(`${i + 1}. ${item}`, { indent: 8, width: COL_W - 8 });
  });
  doc.moveDown(0.5);

  // ── 4. HONORARIOS ROMATEC ─────────────────────────────────────────────
  if (doc.y > 640) doc.addPage();
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('4. Honorarios — Romatec Consultoria Total');
  doc.font('Helvetica');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);

  const linhasHon: Array<{ label: string; valor: number; obs?: string }> = hr
    ? [
        { label: 'TRT/CFT — Termo de Responsabilidade Tecnica (CFT/MA)', valor: hr.trt_cft, obs: 'Tec. em Agrimensura CFT/MA n. 01209185369' },
        { label: 'Tecnicos de campo', valor: hr.tecnicos_campo, obs: `${di.diarias_equipe || 0} diaria(s) x SM x fator CFT-MA 0,42 (Res. 12/2025)` },
        { label: `Area do servico (${isUrbana ? 'm²' : 'hectare'})`, valor: hr.area_servico, obs: isUrbana ? `${di.area_m2 || 0} m² x valor unitario` : `${di.area_hectares || 0} ha x valor unitario` },
        { label: 'Deslocamento', valor: hr.deslocamento, obs: `${di.km_deslocamento || 0} km x R$ 3,50/km` },
        { label: `Multiplicador de complexidade (${di.complexidade || 'media'})`, valor: hr.subtotal_apos_complexidade - (hr.trt_cft + hr.tecnicos_campo + hr.marcos_subtotal + hr.deslocamento + hr.area_servico), obs: `x ${hr.complexidade_multiplicador}` },
        { label: 'Assessoria (5%)', valor: hr.assessoria },
      ]
    : (custos.secao_3_honorarios || []).map((h) => ({ label: h.descricao, valor: Number(h.valor), obs: h.observacao }));

  linhasHon.forEach((h) => {
    const itemY0 = doc.y;
    doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold')
      .text(h.label, COL_X_INI + 8, itemY0, { width: COL_W - 100 });
    const itemY1 = doc.y;
    doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold')
      .text(formatBRL(h.valor), COL_X_FIM - 80, itemY0, { width: 80, align: 'right' });
    doc.y = itemY1;
    if (h.obs) {
      doc.font('Helvetica').fontSize(8).fillColor('#555')
        .text(h.obs, COL_X_INI + 16, doc.y, { width: COL_W - 24 });
    }
    doc.font('Helvetica').fillColor('#111');
    doc.moveDown(0.3);
  });

  if (hr && hr.desconto_valor > 0) {
    doc.fontSize(9.5).fillColor('#dc2626').font('Helvetica-Bold')
      .text(`Desconto aplicado: -${formatBRL(hr.desconto_valor)}`, { align: 'right', width: COL_W - 16 });
    doc.font('Helvetica').fillColor('#111');
  }
  doc.moveDown(0.2);

  // ── 4-bis. MARCOS DISCRIMINADOS ──────────────────────────────────────
  if (hr && hr.marcos_discriminados.length > 0) {
    if (doc.y > 650) doc.addPage();
    doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('4.2 Marcos Discriminados');
    doc.font('Helvetica');
    doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);

    hr.marcos_discriminados.forEach((md) => {
      const y0 = doc.y;
      const vu = md.qtd > 0 ? md.subtotal / md.qtd : 0;
      doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold')
        .text(`${MATERIAL_LABEL[md.tipo]}  ·  ${md.qtd} un × ${formatBRL(vu)}`, COL_X_INI + 8, y0, { width: COL_W - 100 });
      doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold')
        .text(formatBRL(md.subtotal), COL_X_FIM - 80, y0, { width: 80, align: 'right' });
      doc.font('Helvetica').fillColor('#111');
      doc.moveDown(0.2);
    });
    doc.moveDown(0.1);
    doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold')
      .text(`Total dos marcos: ${formatBRL(hr.marcos_subtotal)}`, { align: 'right', width: COL_W - 16 });
    doc.font('Helvetica').fillColor('#111');
    doc.moveDown(0.4);
  }

  // ── 4-ter. IDENTIFICACAO DOS MARCOS (FQNS) ───────────────────────────
  if (doc.y > 600) doc.addPage();
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('4.3 Identificacao dos Marcos (Codificacao INCRA)');
  doc.font('Helvetica');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);

  if (codigos) {
    doc.fontSize(9).fillColor('#111')
      .text('Os marcos a serem implantados em campo recebem codificacao INCRA padrao do tecnico responsavel, conforme NTGIR 3a Edicao:', { width: COL_W - 8, indent: 8, align: 'justify' });
    doc.moveDown(0.3);
    const linhasFQNS: Array<[string, string[]]> = [
      [`▸ Vertices da poligonal (${codigos.vertices.length}):`, codigos.vertices],
      [`▸ Marcos de concreto (${codigos.marcos_por_tipo.concreto.length}):`, codigos.marcos_por_tipo.concreto],
      [`▸ Marcos de tubo galvanizado (${codigos.marcos_por_tipo.tubo_galvanizado.length}):`, codigos.marcos_por_tipo.tubo_galvanizado],
      [`▸ Piquetes de madeira (${codigos.marcos_por_tipo.madeira.length}):`, codigos.marcos_por_tipo.madeira],
    ];
    for (const [label, lista] of linhasFQNS) {
      doc.fontSize(8.5).fillColor('#444').font('Helvetica-Bold').text(label, { indent: 8, width: COL_W - 16 });
      doc.font('Helvetica').fillColor('#111');
      if (lista.length === 0) {
        doc.text('  —', { indent: 16, width: COL_W - 24 });
      } else if (lista.length <= 6) {
        doc.text('  ' + lista.join(', '), { indent: 16, width: COL_W - 24 });
      } else {
        doc.text(`  ${lista[0]} a ${lista[lista.length - 1]}`, { indent: 16, width: COL_W - 24 });
      }
      doc.moveDown(0.1);
    }
    doc.moveDown(0.2);
    doc.fontSize(8).fillColor('#555').font('Helvetica-Oblique')
      .text('Cada marco e gravado/etiquetado fisicamente com seu codigo unico para rastreabilidade e responsabilidade tecnica perante INCRA/MPF.', { width: COL_W - 8, indent: 8, align: 'justify' });
    doc.font('Helvetica').fillColor('#111');
  } else {
    doc.fontSize(9).fillColor('#555').font('Helvetica-Oblique')
      .text('Os codigos definitivos dos marcos (formato FQNS-V-XXX, FQNS-M-XXXX-CC, etc.) serao atribuidos quando esta proposta for enviada ao cliente. Em rascunho, os codigos ainda nao foram reservados nos contadores INCRA do tecnico responsavel.', { width: COL_W - 8, indent: 8, align: 'justify' });
    doc.font('Helvetica').fillColor('#111');
  }
  doc.moveDown(0.5);

  // ── 5. BOX VERDE — VALOR TOTAL ────────────────────────────────────────
  const totalRomatec = hr?.total ?? custos.honorarios_romatec?.total ?? custos.secao_5_total;
  if (doc.y > 700) doc.addPage();
  const txtTotalNota = 'Soma de TRT/CFT + Tecnicos de campo + Marcos + Deslocamento + Area, com complexidade e assessoria. Eventuais custos de cartorio para averbacao da demarcacao NAO estao inclusos.';
  const boxYT = doc.y;
  const boxAlturaT = doc.heightOfString(txtTotalNota, { width: COL_W - 24 }) + 38;
  doc.rect(COL_X_INI, boxYT, COL_W, boxAlturaT).fillAndStroke(COR_VERDE_BG, COR_VERDE_BORDA);
  doc.fontSize(10).fillColor(COR_VERDE_BORDA).font('Helvetica-Bold')
    .text('VALOR TOTAL DA PROPOSTA (Romatec):', COL_X_INI + 12, boxYT + 8, { width: COL_W - 120 });
  doc.fontSize(14).fillColor('#065f46').font('Helvetica-Bold')
    .text(formatBRL(totalRomatec), COL_X_FIM - 130, boxYT + 8, { width: 118, align: 'right' });
  doc.fontSize(8).fillColor('#166534').font('Helvetica')
    .text(txtTotalNota, COL_X_INI + 12, boxYT + 26, { width: COL_W - 24, align: 'justify' });
  doc.y = boxYT + boxAlturaT + 10;
  doc.x = COL_X_INI;

  // ── 6. CONDICOES DE PAGAMENTO ─────────────────────────────────────────
  if (custos.condicoes_pagamento && custos.condicoes_pagamento.length > 0) {
    if (doc.y > 680) doc.addPage();
    doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('6. Condicoes de Pagamento');
    doc.font('Helvetica');
    doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    custos.condicoes_pagamento.forEach((cp) => {
      const y0 = doc.y;
      doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold')
        .text(cp.rotulo, COL_X_INI + 8, y0, { width: COL_W - 100 });
      doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold')
        .text(formatBRL(cp.valor), COL_X_FIM - 80, y0, { width: 80, align: 'right' });
      doc.font('Helvetica').fontSize(8.5).fillColor('#444')
        .text(cp.descricao, COL_X_INI + 16, doc.y, { width: COL_W - 24 });
      doc.font('Helvetica').fillColor('#111');
      doc.moveDown(0.2);
    });
    doc.moveDown(0.3);
  }

  // ── 7. CUSTOS DE TERCEIROS — SO renderiza se houver linhas ────────────
  if (custos.secao_2_taxas && custos.secao_2_taxas.length > 0) {
    if (doc.y > 660) doc.addPage();
    const txtAv = isUrbana
      ? 'Emolumentos do CRI competente para averbacao da demarcacao. Pagos diretamente pelo cliente no cartorio.'
      : 'Eventuais custos de SIGEF/INCRA, CCIR ou cartorio quando aplicaveis. Pagos diretamente pelo cliente.';
    const boxYCT = doc.y;
    const boxAlturaCT = doc.heightOfString(txtAv, { width: COL_W - 24 }) + 26;
    doc.rect(COL_X_INI, boxYCT, COL_W, boxAlturaCT).fillAndStroke(COR_CREME_BG, COR_CREME_BORDA);
    doc.fontSize(10).fillColor(COR_CREME_BORDA).font('Helvetica-Bold')
      .text('7. CUSTOS DE TERCEIROS (INFORMATIVO — A CARGO DO CLIENTE)', COL_X_INI + 12, boxYCT + 6, { width: COL_W - 24 });
    doc.fontSize(8).fillColor('#713f12').font('Helvetica')
      .text(txtAv, COL_X_INI + 12, boxYCT + 20, { width: COL_W - 24, align: 'justify' });
    doc.y = boxYCT + boxAlturaCT + 6;
    doc.x = COL_X_INI;

    custos.secao_2_taxas.forEach((t) => {
      const y0 = doc.y;
      doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold')
        .text(t.descricao, COL_X_INI + 8, y0, { width: COL_W - 100 });
      const valorTxt = t.pendente ? 'A apurar' : (t.valor === 0 ? 'Gratuito' : formatBRL(t.valor));
      doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold')
        .text(valorTxt, COL_X_FIM - 90, y0, { width: 90, align: 'right' });
      if (t.observacao) {
        doc.font('Helvetica').fontSize(8).fillColor('#666')
          .text(t.observacao, COL_X_INI + 16, doc.y, { width: COL_W - 24 });
      }
      doc.font('Helvetica').fillColor('#111');
      doc.moveDown(0.2);
    });
    doc.moveDown(0.4);
  }

  // ── 8. SERVICOS ADICIONAIS OPCIONAIS ──────────────────────────────────
  const opcSec = (custos as unknown as { secao_opcionais_demarcacao?: DemarcacaoLotesOutput['secao_opcionais_demarcacao'] }).secao_opcionais_demarcacao;
  if (opcSec && opcSec.linhas.length > 0) {
    if (doc.y > 660) doc.addPage();
    doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('8. Servicos Adicionais Opcionais');
    doc.font('Helvetica');
    doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(8).fillColor('#666').font('Helvetica-Oblique')
      .text('NAO somam ao total da proposta. Marcados se contratados.', { indent: 8, width: COL_W - 8 });
    doc.font('Helvetica').fillColor('#111');
    doc.moveDown(0.2);
    opcSec.linhas.forEach((l) => {
      const y0 = doc.y;
      const check = l.contratado ? '☑' : '☐';
      doc.fontSize(9.5).fillColor('#111').font(l.contratado ? 'Helvetica-Bold' : 'Helvetica')
        .text(`${check} ${l.rotulo}`, COL_X_INI + 8, y0, { width: COL_W - 100 });
      const valorTxt = l.valor === 'sob_orcamento' ? 'Sob orcamento' : (l.contratado ? formatBRL(l.valor as number) : '—');
      doc.fontSize(9.5).fillColor(l.contratado ? corHex : '#666').font(l.contratado ? 'Helvetica-Bold' : 'Helvetica')
        .text(valorTxt, COL_X_FIM - 100, y0, { width: 100, align: 'right' });
      doc.font('Helvetica').fillColor('#111');
      doc.moveDown(0.1);
    });
    if (opcSec.subtotal > 0) {
      doc.moveDown(0.2);
      doc.fontSize(9.5).fillColor('#666').font('Helvetica-Bold')
        .text(`Subtotal opcionais contratados: ${formatBRL(opcSec.subtotal)}  (cobrado a parte)`, { indent: 8, align: 'right', width: COL_W - 16 });
      doc.font('Helvetica');
    }
    doc.moveDown(0.4);
  }

  // ── 9. DOCUMENTOS A SEREM FORNECIDOS ─────────────────────────────────
  if (doc.y > 660) doc.addPage();
  doc.x = COL_X_INI;
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold')
    .text('9. Documentos a Serem Fornecidos pelo Cliente', COL_X_INI, doc.y, { width: COL_W });
  doc.font('Helvetica');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#111');
  const docsList = docsImprescindiveisDemarcacao(subtipo, finalidade);
  docsList.forEach((d) => {
    doc.x = COL_X_INI;
    if (d.imprescindivel) {
      doc.fillColor('#dc2626').font('Helvetica-Bold')
        .text(`☐ [IMPRESCINDIVEL] ${d.texto}`, COL_X_INI + 8, doc.y, { width: COL_W - 16, continued: false });
      doc.font('Helvetica').fillColor('#111');
    } else {
      doc.text(`☐ ${d.texto}`, COL_X_INI + 8, doc.y, { width: COL_W - 16, continued: false });
    }
  });
  doc.moveDown(0.5);

  // ── 10. AVISOS ────────────────────────────────────────────────────────
  if (doc.y > 660) doc.addPage();
  doc.x = COL_X_INI;
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold')
    .text('10. Avisos e Condicoes Tecnicas', COL_X_INI, doc.y, { width: COL_W });
  doc.font('Helvetica');
  doc.moveTo(COL_X_INI, doc.y).lineTo(COL_X_FIM, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(8.5).fillColor('#444');
  const avisosDem = [
    'A demarcacao consiste na materializacao fisica das divisas. O servico nao constitui regularizacao fundiaria isolada — para averbacao no cartorio sao necessarios os documentos imprescindiveis acima.',
    'O cliente deve coletar Declaracoes de Respeito de Limite (DRLs) com firma reconhecida em cartorio (ver box vermelho abaixo).',
    'Os codigos INCRA dos marcos sao vitalicios e atrelados ao tecnico responsavel. Apos atribuidos no envio da proposta, nao podem ser realocados a outra obra.',
  ];
  avisosDem.forEach((a) => {
    doc.x = COL_X_INI;
    doc.text(`• ${a}`, COL_X_INI + 8, doc.y, { width: COL_W - 16, align: 'justify', continued: false });
    doc.moveDown(0.15);
  });
  doc.fillColor('#111');
  doc.moveDown(0.3);

  // ── 10-bis. BOX VERMELHO — AVISO DRL ──────────────────────────────────
  renderAvisoDRL(doc, finalidade, COL_X_INI, COL_W);
}

export async function gerarPdfPropostaConsultoria(
  id: string,
  signatureMeta?: SignatureVisualMeta,
): Promise<Buffer> {
  const p = await buscarPropostaConsultoria(id);
  if (p.tipo !== 'consultoria') throw new Error('Proposta nao e de consultoria');
  const custos = p.custos_calculados;
  if (!custos) throw new Error('Custos nao calculados');

  const t = await getTenantSettings(1).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliaria';
  const logoFile = path.join(__dirname, '..', 'public', LOGO_RELATORIO.replace(/^\//, ''));
  const corHex = t?.primary_color || '#10b981';
  const corVermelho = '#dc2626';

  // v1.99.17: subtipo + modalidade distinguem Desmembramento Rural (Lei 5.868/72)
  // vs Desdobro Urbano (Lei 6.766/79) dentro do mesmo subtipo 'desmembramento'.
  const dadosImovel = (p.dados_imovel as Record<string, unknown> | null) ?? {};
  const modalidade = dadosImovel.modalidade as 'rural' | 'urbana' | undefined;
  const isDesdobro = p.subtipo === 'desmembramento' && modalidade === 'urbana';
  const isDesmRural = p.subtipo === 'desmembramento' && modalidade === 'rural';
  let subtipoLabel = SUBTIPO_LABEL[p.subtipo || ''] || (p.subtipo || '').toUpperCase();
  if (isDesdobro) subtipoLabel = 'DESDOBRO DE LOTE URBANO';
  else if (isDesmRural) subtipoLabel = 'DESMEMBRAMENTO DE IMÓVEL RURAL';
  const isDesmRem = p.subtipo === 'desmembramento' || p.subtipo === 'remembramento';

  // v3.23.7: bufferPages habilitado pra emitir footer global em TODAS as paginas
  // via doc.bufferedPageRange() no fim. Antes o footer era um text() avulso em
  // y=800 que criava uma pagina solta no final ("pagina 5 com 1 linha so").
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
    Title: `Proposta Consultoria ${p.numero}`,
    Author: brand,
    Subject: `Proposta de Consultoria — ${subtipoLabel} para ${p.cliente?.nome || ''}`,
  }});
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // Header
  if (fs.existsSync(logoFile)) {
    try { doc.image(logoFile, { fit: [120, 60], align: 'center' }); }
    catch { /* opcional */ }
  } else {
    doc.fontSize(16).fillColor(corHex).text(brand, { align: 'center' });
  }
  doc.moveDown(0.5);
  doc.strokeColor(corHex).lineWidth(2).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.8);

  doc.fontSize(15).fillColor('#111').text(`PROPOSTA DE CONSULTORIA — ${subtipoLabel}`, { align: 'center', characterSpacing: 0.5 });
  doc.fontSize(10).fillColor('#444').text(`No ${p.numero}  ·  ${String(p.status).toUpperCase()}`, { align: 'center' });
  doc.moveDown(0.8);

  // Cliente
  doc.fontSize(11).fillColor(corHex).text('Cliente');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#111');
  doc.text(`Nome: ${p.cliente?.nome || '-'}`);
  if (p.cliente?.cpf_cnpj || p.cliente?.telefone) {
    doc.text(`${p.cliente?.cpf_cnpj || ''}${p.cliente?.telefone ? '  ·  ' + p.cliente.telefone : ''}`);
  }
  if (p.cliente?.email)    doc.text(`E-mail: ${p.cliente.email}`);
  if (p.endereco_imovel)   doc.text(`Imovel: ${p.endereco_imovel}`);
  doc.moveDown(0.6);

  // v3.23.5: Georreferenciamento Rural — layout aprovado PROP-2026-0011-R1.
  // Renderiza um caminho proprio (Imovel/Dados, FINALIDADE box, ESCOPO, HONORARIOS
  // Romatec + BOX TOTAL verde, CONDICOES, CUSTOS TERCEIROS, OPCIONAIS, DOCS, AVISOS)
  // e PULA o resto do body (que e' generico pra outros subtipos). A signature/QR/footer
  // do final da funcao continua valendo pros dois caminhos.
  if (p.subtipo === 'georreferenciamento_rural') {
    renderGeorrefRuralBody(doc, p, dadosImovel, custos, corHex);
  } else if (p.subtipo === 'projeto_executivo') {
    // v3.24.5: Projeto Executivo — layout dedicado.
    renderProjetoExecutivoBody(doc, p, dadosImovel, custos, corHex);
  } else if (p.subtipo === 'demarcacao_urbana' || p.subtipo === 'demarcacao_rural') {
    // v3.27.0: Demarcacao de Lotes (Urbana/Rural) — layout dedicado com
    // 11 secoes (10 do Georref + Marcos Discriminados + Identificacao FQNS).
    renderDemarcacaoLotesBody(doc, p, dadosImovel, custos, corHex);
  } else {

  // v1.99.16: Remembramento detalhado — tabela de imóveis + área total destacada
  const dadosImv = dadosImovel; // alias para preservar bloco existente
  const imoveisDetalhados = Array.isArray(dadosImv.imoveis)
    ? (dadosImv.imoveis as Array<{
        ordem: number; area_m2: number; endereco: string; matricula: string;
        // v3.22.0: campos novos do Remembramento v2
        livro?: string; folha?: string;
        cri?: string;               // legado: free text
        cri_cns?: string;           // v3.22.0: CNS do cartório (chave natural)
        cri_denominacao?: string;   // v3.22.0: nome do cartório capturado pelo autocomplete
      }>)
    : null;

  // v3.22.0: Seção "Status da Documentação" (Remembramento v2)
  // Renderiza somente quando status_documentacao é fornecido no JSON e o subtipo é remembramento.
  const statusDoc = (dadosImv as any).status_documentacao as
    | { cnd_iptu_anexada?: boolean; bci_anexado?: boolean; certidao_inteiro_teor_data?: string }
    | undefined;
  if (statusDoc && p.subtipo === 'remembramento') {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text('Status da Documentação');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9.5).fillColor('#111');
    const fmtCheck = (b: boolean | undefined) => (b ? '☑' : '☐');
    doc.text(`${fmtCheck(dadosImv.iptu_em_dia as boolean | undefined)} IPTU em dia`);
    doc.text(`${fmtCheck(statusDoc.cnd_iptu_anexada)} CND de IPTU anexada`);
    doc.text(`${fmtCheck(statusDoc.bci_anexado)} BCI do imóvel anexado`);
    if (statusDoc.certidao_inteiro_teor_data) {
      const dt = new Date(statusDoc.certidao_inteiro_teor_data + 'T00:00:00Z');
      if (isNaN(dt.getTime())) {
        // Guard contra dados ruins no DB — exibe a string crua sem fazer math NaN
        doc.text(`☑ Certidão de inteiro teor (emitida em ${statusDoc.certidao_inteiro_teor_data})`);
      } else {
        const diff = Math.floor((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24));
        const dtFmt = dt.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
        const sufixo = diff < 30
          ? `(válida — ${30 - diff} dia(s) restante(s))`
          : diff === 30
            ? `(válida — último dia)`
            : `(VENCIDA — ${diff - 30} dia(s) atrasada)`;
        doc.text(`☑ Certidão de inteiro teor (emitida em ${dtFmt}) ${sufixo}`);
      }
    } else {
      doc.text(`☐ Certidão de inteiro teor não informada`);
    }
    doc.moveDown(0.6);
  }

  if (imoveisDetalhados && imoveisDetalhados.length >= 2 && p.subtipo === 'remembramento') {
    if (doc.y > 680) doc.addPage();
    doc.fontSize(11).fillColor(corHex).text('Imóveis a Remembrar');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);

    // Header da tabela
    // v3.22.0: layout com 7 colunas — #, Área, Endereço, Matrícula, Livro, Folha, CRI
    const colsImv = { ord: 48, area: 75, end: 135, mat: 320, livro: 380, folha: 415, cri: 455 };
    const wImv = { ord: 25, area: 55, end: 180, mat: 55, livro: 32, folha: 35, cri: 90 };
    doc.fontSize(8.5).fillColor('#444').font('Helvetica-Bold');
    const hY = doc.y;
    doc.text('#',         colsImv.ord,   hY, { width: wImv.ord });
    doc.text('Área (m²)', colsImv.area,  hY, { width: wImv.area, align: 'right' });
    doc.text('Endereço',  colsImv.end,   hY, { width: wImv.end });
    doc.text('Matrícula', colsImv.mat,   hY, { width: wImv.mat });
    doc.text('Livro',     colsImv.livro, hY, { width: wImv.livro });
    doc.text('Folha',     colsImv.folha, hY, { width: wImv.folha });
    doc.text('CRI',       colsImv.cri,   hY, { width: wImv.cri });
    doc.font('Helvetica');
    let cY = doc.y + 4;
    doc.moveTo(48, cY).lineTo(547, cY).strokeColor('#888').lineWidth(0.5).stroke();
    cY += 4;

    doc.fontSize(8.5).fillColor('#111');
    for (const iv of imoveisDetalhados) {
      // v3.22.0: cri_denominacao (capturado pelo autocomplete) tem precedência sobre cri (legado)
      const criTexto = iv.cri_denominacao || iv.cri || '-';
      const hEnd = doc.heightOfString(iv.endereco || '-', { width: wImv.end });
      const hCri = doc.heightOfString(criTexto, { width: wImv.cri });
      const lineH = Math.max(hEnd, hCri, 12);
      if (cY + lineH > 760) { doc.addPage(); cY = 60; }
      doc.text(String(iv.ordem),           colsImv.ord,   cY, { width: wImv.ord });
      doc.text(Number(iv.area_m2).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), colsImv.area, cY, { width: wImv.area, align: 'right' });
      doc.text(iv.endereco || '-',         colsImv.end,   cY, { width: wImv.end });
      doc.text(iv.matricula || '-',        colsImv.mat,   cY, { width: wImv.mat });
      doc.text(iv.livro || '-',            colsImv.livro, cY, { width: wImv.livro });
      doc.text(iv.folha || '-',            colsImv.folha, cY, { width: wImv.folha });
      doc.text(criTexto,                   colsImv.cri,   cY, { width: wImv.cri });
      cY += lineH + 4;
    }
    doc.x = 48;
    doc.y = cY;
    doc.moveDown(0.3);

    // Destaque "Área Total Remembrada"
    const areaTotal = imoveisDetalhados.reduce((s, i) => s + Number(i.area_m2 || 0), 0);
    const hectares = areaTotal / 10000;
    const boxY = doc.y;
    doc.rect(48, boxY, 499, 26).fillAndStroke('#ecfdf5', '#10b981');
    doc.fontSize(10).fillColor('#065f46').font('Helvetica-Bold')
       .text(
         `Área Total Remembrada: ${areaTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} m²${areaTotal >= 10000 ? `  ·  ${hectares.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ha` : ''}`,
         52, boxY + 7, { width: 491, align: 'center' }
       );
    doc.font('Helvetica').fillColor('#111');
    doc.y = boxY + 30;
    doc.moveDown(0.4);
  }

  // v1.99.17: Imóvel matriz (Desmembramento/Desdobro) — bloco identificando a matrícula que será fracionada
  const matriz = dadosImovel.matriz as { matricula?: string; cri?: string; endereco?: string; denominacao?: string; municipio?: string } | undefined;
  if (matriz && p.subtipo === 'desmembramento') {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(11).fillColor(corHex).text(isDesmRural ? 'Imóvel Matriz (a desmembrar)' : 'Lote Matriz (a desdobrar)');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(9.5).fillColor('#111');
    if (matriz.matricula) doc.text(`Matrícula nº: ${matriz.matricula}${matriz.cri ? '  ·  ' + matriz.cri : ''}`, { indent: 8 });
    if (matriz.endereco)  doc.text(`Endereço: ${matriz.endereco}`, { indent: 8 });
    if (isDesmRural && matriz.denominacao) doc.text(`Denominação: ${matriz.denominacao}`, { indent: 8 });
    const unidadeArea = (dadosImovel.unidade_area as 'ha' | 'm2' | undefined) ?? (isDesmRural ? 'ha' : 'm2');
    const unidadeLabel = unidadeArea === 'ha' ? 'ha' : 'm²';
    const areaMatriz = Number(dadosImovel.area_total_m2 ?? 0);
    if (areaMatriz > 0) {
      doc.text(`Área total: ${areaMatriz.toLocaleString('pt-BR', { minimumFractionDigits: unidadeArea === 'ha' ? 4 : 2, maximumFractionDigits: unidadeArea === 'ha' ? 4 : 2 })} ${unidadeLabel}`, { indent: 8 });
    }
    doc.moveDown(0.5);
  }

  // v1.99.17: Frações resultantes (Desmembramento/Desdobro) — tabela detalhada
  const fracoes = Array.isArray(dadosImovel.fracoes)
    ? (dadosImovel.fracoes as Array<{ numero: number; area: number; valor: number; descricao?: string }>)
    : null;
  if (fracoes && fracoes.length >= 2 && p.subtipo === 'desmembramento') {
    if (doc.y > 680) doc.addPage();
    doc.fontSize(11).fillColor(corHex).text(isDesmRural ? 'Glebas Resultantes' : 'Lotes Resultantes');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);

    const unidadeArea = (dadosImovel.unidade_area as 'ha' | 'm2' | undefined) ?? (isDesmRural ? 'ha' : 'm2');
    const unidadeLabel = unidadeArea === 'ha' ? 'ha' : 'm²';
    const colsFr = { num: 48, area: 75, desc: 165, val: 470 };
    const wFr = { num: 25, area: 80, desc: 295, val: 80 };
    doc.fontSize(8.5).fillColor('#444').font('Helvetica-Bold');
    const hY = doc.y;
    doc.text('#', colsFr.num, hY, { width: wFr.num });
    doc.text(`Área (${unidadeLabel})`, colsFr.area, hY, { width: wFr.area, align: 'right' });
    doc.text('Descrição', colsFr.desc, hY, { width: wFr.desc });
    doc.text('Valor (R$)', colsFr.val, hY, { width: wFr.val, align: 'right' });
    doc.font('Helvetica');
    let cY = doc.y + 4;
    doc.moveTo(48, cY).lineTo(547, cY).strokeColor('#888').lineWidth(0.5).stroke();
    cY += 4;

    doc.fontSize(8.5).fillColor('#111');
    const fracDigits = unidadeArea === 'ha' ? 4 : 2;
    for (const fr of fracoes) {
      const descTxt = fr.descricao || '-';
      const hDesc = doc.heightOfString(descTxt, { width: wFr.desc });
      const lineH = Math.max(hDesc, 12);
      if (cY + lineH > 760) { doc.addPage(); cY = 60; }
      doc.text(String(fr.numero).padStart(2, '0'), colsFr.num, cY, { width: wFr.num });
      doc.text(
        Number(fr.area).toLocaleString('pt-BR', { minimumFractionDigits: fracDigits, maximumFractionDigits: fracDigits }),
        colsFr.area, cY, { width: wFr.area, align: 'right' }
      );
      doc.text(descTxt, colsFr.desc, cY, { width: wFr.desc });
      doc.text(formatBRL(Number(fr.valor)), colsFr.val, cY, { width: wFr.val, align: 'right' });
      cY += lineH + 4;
    }
    doc.x = 48;
    doc.y = cY;
    doc.moveDown(0.3);

    // Resumo: soma das áreas + resíduo
    const somaAreas = fracoes.reduce((s, f) => s + Number(f.area || 0), 0);
    const somaValores = fracoes.reduce((s, f) => s + Number(f.valor || 0), 0);
    const areaMatriz = Number(dadosImovel.area_total_m2 ?? 0);
    const residuo = areaMatriz - somaAreas;
    doc.fontSize(9).fillColor('#444');
    doc.text(`Soma das frações: ${somaAreas.toLocaleString('pt-BR', { minimumFractionDigits: fracDigits, maximumFractionDigits: fracDigits })} ${unidadeLabel}`, { indent: 8 });
    if (areaMatriz > 0 && Math.abs(residuo) > (unidadeArea === 'ha' ? 0.01 : 1)) {
      doc.fillColor(residuo > 0 ? '#1e3a8a' : corVermelho);
      doc.text(
        `${residuo > 0 ? 'Área remanescente da matriz' : 'EXCEDE a matriz em'}: ${Math.abs(residuo).toLocaleString('pt-BR', { minimumFractionDigits: fracDigits, maximumFractionDigits: fracDigits })} ${unidadeLabel}`,
        { indent: 8 }
      );
    }
    doc.fillColor('#111').font('Helvetica-Bold')
       .text(`Subtotal das frações: ${formatBRL(somaValores)}`, { indent: 8 });
    doc.font('Helvetica');
    doc.moveDown(0.5);
  }

  // v1.99.16/17: Peças técnicas marcadas — Mapa/Memorial/ART/TRT/Requerimentos (Remembramento + Desmembramento/Desdobro)
  const pecas = (dadosImovel.pecas_tecnicas as { mapa?: boolean; memorial?: boolean; art?: boolean; trt?: boolean; requerimentos?: boolean } | undefined);
  if (pecas && (p.subtipo === 'remembramento' || p.subtipo === 'desmembramento')) {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(11).fillColor(corHex).text('Peça Técnica a Ser Entregue');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(9.5).fillColor('#111');
    const memorialLabel = (fracoes && fracoes.length >= 2)
      ? 'Memorial Descritivo (um por fração)'
      : 'Memorial Descritivo';
    if (pecas.mapa)          doc.text('☑ Mapa / Planta', { indent: 8 });
    if (pecas.memorial)      doc.text(`☑ ${memorialLabel}`, { indent: 8 });
    if (pecas.art)           doc.text('☑ ART — Anotação de Responsabilidade Técnica (CREA)', { indent: 8 });
    if (pecas.trt)           doc.text('☑ TRT — Termo de Responsabilidade Técnica (CFT)', { indent: 8 });
    if (pecas.requerimentos) {
      const reqExtra = isDesmRural ? ' / INCRA' : '';
      doc.text(`☑ Requerimentos administrativos (Município${reqExtra}/Cartório)`, { indent: 8 });
    }
    doc.moveDown(0.5);
  }

  // v1.99.17: Texto do Objeto (base legal dinâmica) — exibido antes da Seção 1 quando desm/desdobro
  if (p.subtipo === 'desmembramento' && modalidade) {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(11).fillColor(corHex).text('Objeto');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('#111');
    const unidadeArea = (dadosImovel.unidade_area as 'ha' | 'm2' | undefined) ?? (isDesmRural ? 'ha' : 'm2');
    const unidadeLabel = unidadeArea === 'ha' ? 'ha' : 'm²';
    const areaMatriz = Number(dadosImovel.area_total_m2 ?? 0);
    const fracoesCount = fracoes?.length ?? 0;
    const denominacao = (matriz?.denominacao || '').trim();
    const matricula = matriz?.matricula || '—';
    const cri = matriz?.cri || 'Cartório de Registro de Imóveis competente';
    const endereco = matriz?.endereco || '—';
    const municipio = (matriz?.municipio || '').trim() || 'Açailândia/MA';

    const areaFmt = areaMatriz > 0
      ? `${areaMatriz.toLocaleString('pt-BR', { minimumFractionDigits: unidadeArea === 'ha' ? 4 : 2, maximumFractionDigits: unidadeArea === 'ha' ? 4 : 2 })} ${unidadeLabel}`
      : `[área a definir] ${unidadeLabel}`;

    const txtObj = isDesmRural
      ? `Prestação de serviços técnicos de agrimensura e engenharia para fins de desmembramento do imóvel rural${denominacao ? ' denominado ' + denominacao : ''}, matrícula nº ${matricula} do ${cri}, com área total de ${areaFmt}, em ${fracoesCount || 'N'} gleba(s), em conformidade com a Lei nº 5.868/1972, Lei nº 6.015/1973, Instrução Normativa do INCRA aplicável e NBR 13133, incluindo levantamento topográfico georreferenciado quando exigido, peças técnicas e requerimentos administrativos para registro junto ao Cartório de Registro de Imóveis competente e ao INCRA.`
      : `Prestação de serviços técnicos de agrimensura e engenharia para fins de desdobro do lote urbano matrícula nº ${matricula} do ${cri}, situado à ${endereco}, com área total de ${areaFmt}, em ${fracoesCount || 'N'} lote(s), em conformidade com a Lei nº 6.766/1979, legislação municipal de parcelamento do solo vigente no município de ${municipio} e NBR 13133, incluindo levantamento topográfico, peças técnicas e requerimentos administrativos junto à Prefeitura Municipal e ao Cartório de Registro de Imóveis competente.`;

    doc.text(txtObj, { width: 499, align: 'justify' });
    doc.moveDown(0.5);
  }

  // ── Secao 1: Projetos ───────────────────────────────────────────────────
  doc.fontSize(11).fillColor(corHex).text('1. Documentos de Projeto a Serem Confeccionados');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5).fillColor('#111');
  custos.secao_1_projetos.forEach((p1, i) => {
    doc.text(`${i + 1}. ${p1}`, { indent: 8 });
  });
  doc.moveDown(0.5);

  // ── Secao 2: Taxas e Emolumentos de Terceiros ──────────────────────────
  doc.fontSize(11).fillColor(corHex).text('2. Taxas e Emolumentos de Terceiros');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.15);
  // v1.66.5: aviso destacado de aproximacao Receita/Cartorio
  const avisoY = doc.y;
  doc.rect(48, avisoY, 499, 26).fillAndStroke('#fff7ed', '#fb923c');
  doc.fontSize(8).fillColor('#9a3412').font('Helvetica-Bold')
     .text('ATENCAO: Os valores de Cartorio e Receita Federal sao APROXIMADOS (tabelas oficiais TJMA Res. 143/2025 e IN RFB 2021/2021). Valores definitivos podem variar conforme apuracao real no cartorio e portal SERO/e-CAC no momento do pagamento.',
       52, avisoY + 4, { width: 491 });
  doc.font('Helvetica').fillColor('#111');
  doc.y = avisoY + 30;
  desenharTabelaCustos(doc, custos.secao_2_taxas, corHex);
  doc.moveDown(0.5);

  // ── Secao 3: Honorarios Romatec ────────────────────────────────────────
  doc.fontSize(11).fillColor(corHex).text('3. Honorarios Tecnicos Romatec');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  desenharTabelaCustos(doc, custos.secao_3_honorarios, corHex);
  doc.moveDown(0.4);

  // v1.66.11: Condicoes de Pagamento (logo abaixo dos Honorarios)
  // v3.24.16 FIX: defesa em profundidade — se todas as parcelas tem valor 0
  // (proposta antiga salva antes do fix do atualizarPropostaConsultoria),
  // RECALCULA proporcionalmente baseado no totalSecao3 dividido pelas N
  // parcelas existentes mantendo as descricoes. Caso atipico tratado: somente
  // entra se todas zeradas; se 1+ tem valor, mantem como esta.
  if (custos.condicoes_pagamento && custos.condicoes_pagamento.length > 0) {
    if (doc.y > 700) doc.addPage();
    const cps = custos.condicoes_pagamento;
    const totalCp = cps.reduce((s, cp) => s + (Number(cp.valor) || 0), 0);
    if (totalCp === 0) {
      // Todas zeradas — reconstroi a partir de secao_3_honorarios (totalRomatec)
      const totalRom = (custos.secao_3_honorarios || []).reduce((s, h) => s + (Number(h.valor) || 0), 0);
      if (totalRom > 0 && cps.length > 0) {
        const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
        if (cps.length === 1) {
          cps[0] = { ...cps[0], valor: round2(totalRom) };
        } else if (cps.length === 2) {
          const v1 = round2(totalRom * 0.5);
          cps[0] = { ...cps[0], valor: v1 };
          cps[1] = { ...cps[1], valor: round2(totalRom - v1) };
        } else {
          // N parcelas iguais (com ajuste de centavo na ultima)
          const v = round2(totalRom / cps.length);
          let restante = totalRom;
          for (let i = 0; i < cps.length - 1; i++) {
            cps[i] = { ...cps[i], valor: v };
            restante = round2(restante - v);
          }
          cps[cps.length - 1] = { ...cps[cps.length - 1], valor: round2(restante) };
        }
      }
    }
    doc.fontSize(10.5).fillColor(corHex).text('Condicoes de Pagamento dos Honorarios');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    cps.forEach((cp, i) => {
      doc.fontSize(9.5).fillColor('#111').font('Helvetica-Bold').text(`${i + 1}. ${cp.rotulo}`, { indent: 8 });
      doc.font('Helvetica').fontSize(8.5).fillColor('#444').text(cp.descricao, { indent: 16, width: 480 });
      doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold').text(`Valor: ${formatBRL(cp.valor)}`, { indent: 16 });
      doc.font('Helvetica');
      doc.moveDown(0.15);
    });
    doc.moveDown(0.4);
  }

  // v1.66.11: Base de Calculo da Receita Federal (transparencia ao cliente)
  if (custos.base_calculo && custos.base_calculo.length > 0) {
    if (doc.y > 680) doc.addPage();
    doc.fontSize(10.5).fillColor(corHex).text('Base de Calculo — Receita Federal (INSS/SERO)');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    custos.base_calculo.forEach((bc) => {
      const isTotal = bc.rotulo.startsWith('TOTAL');
      doc.fontSize(9).fillColor(isTotal ? corHex : '#111')
         .font(isTotal ? 'Helvetica-Bold' : 'Helvetica-Bold')
         .text(`${bc.rotulo}:  ${formatBRL(bc.valor_resultado)}`, { indent: 8 });
      doc.font('Helvetica').fontSize(8).fillColor('#666')
         .text(bc.formula, { indent: 16, width: 480 });
      doc.moveDown(0.1);
    });
    doc.fontSize(8).fillColor('#666').font('Helvetica-Oblique')
       .text('Fonte: IN RFB 2021/2021 — afericao indireta. Valor definitivo apenas via portal e-CAC.', { indent: 8 });
    doc.font('Helvetica');
    doc.moveDown(0.4);
  }

  // v3.23.0: III — Despesas Administrativas (estimativa) — só renderiza se presente em custos.
  // Restrito a remembramento/desmembramento (averbação/georref/etc não populam este campo).
  const despesasAdm = custos.despesas_administrativas;
  if (despesasAdm && (p.subtipo === 'remembramento' || p.subtipo === 'desmembramento')) {
    if (doc.y > 680) doc.addPage();
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0a3d62');
    doc.text('III — Despesas Administrativas (estimativa)');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor('#222');
    doc.text(despesasAdm.descritivo, { align: 'justify' });
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#222');
    doc.text(`Estimativa: ${formatBRL(despesasAdm.valor)}`);
    doc.moveDown(0.1);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666');
    doc.text('Esta estimativa NÃO compõe os honorários técnicos. Os valores definitivos correrão por conta do contratante conforme apuração junto à Superintendência de Habitação e Regularização Fundiária.', { align: 'justify' });
    doc.font('Helvetica').fillColor('#111');
    doc.moveDown(0.4);
  }

  // ── Secao 4: Checklist de Documentos do Cliente ────────────────────────
  if (doc.y > 680) doc.addPage();
  doc.fontSize(11).fillColor(corHex).text('4. Documentos que o Cliente Deve Fornecer');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(9.5);
  custos.secao_4_checklist.forEach(d => {
    const isImp = d.imprescindivel && isDesmRem;
    if (isImp) {
      doc.fillColor(corVermelho).font('Helvetica-Bold')
         .text(`☐ [IMPRESCINDIVEL] ${d.texto}`, { indent: 8 });
      doc.font('Helvetica');
    } else {
      doc.fillColor('#111').text(`☐ ${d.texto}${d.obrigatorio ? '' : '  (opcional)'}`, { indent: 8 });
    }
  });
  doc.moveDown(0.5);

  // ── Secao 5: Total ─────────────────────────────────────────────────────
  if (doc.y > 720) doc.addPage();
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor(corHex).lineWidth(1).stroke();
  doc.moveDown(0.4);
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#111')
     .text(`5. VALOR TOTAL DA PROPOSTA: ${formatBRL(custos.secao_5_total)}`, 48, doc.y, { width: 499, align: 'right' });
  doc.font('Helvetica');
  doc.moveDown(0.4);
  doc.fontSize(8.5).fillColor('#666')
     .text(`Soma das Secoes 2 (Taxas) + 3 (Honorarios). Secoes 1 e 4 sao informativas.`, { align: 'right' });
  doc.moveDown(0.6);

  // Avisos
  if (custos.avisos && custos.avisos.length > 0) {
    doc.fontSize(9).fillColor('#444').font('Helvetica-Oblique').text('Avisos:');
    custos.avisos.forEach(a => doc.fontSize(8).text(`• ${a}`, { indent: 8 }));
    doc.font('Helvetica');
    doc.moveDown(0.4);
  }

  // v3.23.0: V — Assessoria Técnica e Diligências — escopo completo OU aviso "NÃO CONTRATADO".
  // Restrito a remembramento/desmembramento (averbação/georref/etc não usam este toggle).
  const assTec = (dadosImovel as { assessoria_tecnica?: { habilitada: boolean; valor?: number } }).assessoria_tecnica;
  if (p.subtipo === 'remembramento' || p.subtipo === 'desmembramento') {
    if (doc.y > 600) doc.addPage();
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0a3d62');
    doc.text('V — Assessoria Técnica e Diligências');
    doc.moveDown(0.2);

    if (assTec?.habilitada) {
      doc.font('Helvetica').fontSize(9).fillColor('#222');
      const tipoTexto = p.subtipo === 'remembramento' ? 'remembramento' : 'desmembramento';
      doc.text(`A assessoria técnica e operacional consiste no acompanhamento técnico-administrativo do processo de ${tipoTexto} até o registro definitivo no Cartório de Registro de Imóveis competente, compreendendo:`, { align: 'justify' });
      doc.moveDown(0.3);

      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#222');
      doc.text('1. PEÇAS TÉCNICAS');
      doc.font('Helvetica').fontSize(9).fillColor('#333');
      doc.text('   • Elaboração de Mapa Mural / Planta de Situação;');
      doc.text('   • Memorial Descritivo das áreas;');
      doc.text('   • Anotação de Responsabilidade Técnica (ART/CREA) ou Termo de Responsabilidade Técnica (TRT/CFT), conforme habilitação aplicável;');
      doc.text('   • Visita técnica de campo quando necessária à confirmação dos limites.');
      doc.moveDown(0.2);

      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#222');
      doc.text('2. RECOLHIMENTO DE ASSINATURAS');
      doc.font('Helvetica').fontSize(9).fillColor('#333');
      doc.text('   • Coleta das assinaturas das partes envolvidas (proprietários e/ou procuradores) nas ART/TRT, mapas, memoriais e requerimentos administrativos.');
      doc.moveDown(0.2);

      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#222');
      doc.text('3. DILIGÊNCIAS NA SUPERINTENDÊNCIA DE HABITAÇÃO E REGULARIZAÇÃO FUNDIÁRIA');
      doc.font('Helvetica').fontSize(9).fillColor('#333');
      doc.text('   • Protocolo do processo completo junto ao órgão municipal competente;');
      doc.text('   • Acompanhamento da análise técnica e vistorias designadas;');
      doc.text('   • Verificação da regularidade fiscal dos imóveis (IPTUs em dia / certidão negativa);');
      doc.text('   • Recolhimento das taxas de parcelamento do solo conforme legislação municipal;');
      doc.text('   • Acompanhamento até a expedição do ofício de aprovação.');
      doc.moveDown(0.2);

      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#222');
      doc.text('4. DILIGÊNCIAS NO CARTÓRIO DE REGISTRO DE IMÓVEIS');
      doc.font('Helvetica').fontSize(9).fillColor('#333');
      doc.text('   • Protocolo do acervo aprovado junto ao Cartório competente;');
      doc.text('   • Acompanhamento da análise documental cartorária;');
      doc.text(`   • Acompanhamento até a averbação e expedição das novas matrículas (${p.subtipo === 'remembramento' ? 'matrícula única' : 'matrículas das frações'}).`);
      doc.moveDown(0.2);

      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#222');
      doc.text('5. CUSTAS E EMOLUMENTOS');
      doc.font('Helvetica').fontSize(9).fillColor('#333');
      doc.text('   Os custos de emolumentos cartorários (TJMA), taxas de parcelamento municipal e eventuais regularizações fiscais (IPTU) NÃO estão incluídos nos honorários técnicos e correrão por conta do contratante.', { align: 'justify' });
    } else {
      // v3.23.0: Assessoria NÃO contratada — aviso explícito
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#b91c1c');
      doc.text('⚠ SERVIÇO NÃO CONTRATADO');
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(9).fillColor('#222');
      doc.text('A presente proposta contempla exclusivamente a elaboração das peças técnicas descritas no item anterior. As diligências administrativas (Superintendência de Habitação e Regularização Fundiária e Cartório de Registro de Imóveis), recolhimento de assinaturas e demais providências correrão por conta do contratante ou de procurador por ele constituído.', { align: 'justify' });
    }
    doc.font('Helvetica').fillColor('#111');
    doc.moveDown(0.4);
  }

  } // v3.23.5: fim do "else (nao e' georref)" — o body generico acaba aqui

  doc.fontSize(9).fillColor('#444')
     .text(`Data: ${formatDataBR(p.data_proposta)}    ·    Validade: ${p.validade_dias} dias`, { width: 499 });
  doc.moveDown(0.4);

  // Responsavel tecnico
  if (p.gestor_nome || p.gestor_cargo || p.gestor_telefone) {
    doc.fontSize(10).fillColor(corHex).text('Responsavel Tecnico');
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
    doc.moveDown(0.2);
    doc.fontSize(9.5).fillColor('#111');
    const partes: string[] = [];
    if (p.gestor_cargo) partes.push(p.gestor_cargo);
    if (p.gestor_nome)  partes.push(p.gestor_nome);
    doc.text(partes.join(' — ') || '-');
    if (p.gestor_telefone) doc.text(`Tel: ${p.gestor_telefone}`);
    doc.moveDown(0.4);
  }

  // v1.99.11: BLOCO VISUAL DE ASSINATURA DIGITAL (antes do footer)
  if (signatureMeta) {
    doc.moveDown(0.8);
    let cy = doc.y;
    if (cy > 720) cy = 720; // garante caber acima do footer (800)

    const fmtDataAssin = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const fmtData = (iso: string) => {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    };
    const validadeFmt = signatureMeta.validade_ate ? fmtData(signatureMeta.validade_ate) : '—';
    const docFmt = (() => {
      const d = signatureMeta.signer_doc || '';
      if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
      return d || '—';
    })();
    const cnLimpo = signatureMeta.signer_cn.replace(/:\d+$/, '');
    const dataAssinFmt = fmtDataAssin(signatureMeta.data_assinatura);

    const boxX = 130;
    const boxW = 335;
    doc.save()
       .lineWidth(0.8)
       .strokeColor(corHex)
       .roundedRect(boxX, cy, boxW, 56, 4)
       .stroke()
       .restore();

    doc.fontSize(8).fillColor(corHex).font('Helvetica-Bold')
       .text('ASSINADO DIGITALMENTE — ICP-Brasil (PAdES)', boxX, cy + 5, {
         width: boxW, align: 'center', lineBreak: false,
       });
    doc.fontSize(8).fillColor('#222').font('Helvetica-Bold')
       .text(cnLimpo, boxX + 6, cy + 19, { width: boxW - 12, align: 'center', lineBreak: false });
    doc.fontSize(7).fillColor('#444').font('Helvetica')
       .text(`${docFmt} · Assinado em ${dataAssinFmt}`, boxX + 6, cy + 31, {
         width: boxW - 12, align: 'center', lineBreak: false,
       });
    doc.fontSize(6.5).fillColor('#666').font('Helvetica')
       .text(`Cert: ${signatureMeta.issuer_cn || '—'} · Válido até ${validadeFmt} · Validar em validar.iti.gov.br`,
             boxX + 6, cy + 42, { width: boxW - 12, align: 'center', lineBreak: false });
  }

  // v3.33.0 (= v3.27.1 do prompt): adicional de campo REFACTORED — bloco
  // dourado (Insalubridade) ou vermelho (Periculosidade) com 3 blocos
  // jurídicos (Fundamento Legal, Enquadramento Tecnico, Justificativa
  // Cliente) + snapshot da norma vigente. Renderizado entre seção 8 (Avisos)
  // e 9 (Documentos) — mas como o body genérico não tem essa numeração
  // estrita, aparece antes do QR/hash.
  //
  // Fallback v3.29.0: se houver `aditivo_campo` (snapshot antigo) mas não
  // `adicional_campo` (snapshot novo), usa o renderer legado.
  try {
    const novoSnap = (custos as unknown as { adicional_campo?: AdicionalCampoSnapshotPdf }).adicional_campo;
    if (novoSnap && novoSnap.ativo) {
      renderAdicionalCampoBody(doc, novoSnap, 48, 499);
    } else {
      const legadoSnap = (custos as unknown as { aditivo_campo?: AditivoSnapshotComputado }).aditivo_campo;
      if (legadoSnap) renderAditivoCampoBody(doc, legadoSnap, 48, 499);
    }
  } catch (err) {
    console.warn(`[propostas-consultoria-pdf] falha adicional: ${(err as Error).message}`);
  }

  // v3.23.7: QR Code + hash de autenticidade renderizados RELATIVO a doc.y, garantindo
  // que cabem inteiros na pagina atual (~120px). Se nao couber, addPage primeiro.
  // Antes eram coords fixas y=720 e o footer em y=800 — se o conteudo passava de 720,
  // o QR sobrepunha conteudo OU caia numa "pagina 4 quase vazia" + footer em "pagina 5".
  try {
    const hashValidacao = await gerarOuBuscarHashProposta(Number(p.id));
    const baseUrl = getValidacaoBaseUrl();
    const ALTURA_QR_BLOCO = 100; // QR (80) + label embaixo + margem inferior
    const espacoRestante = doc.page.height - doc.page.margins.bottom - 50 /* footer reservado */ - doc.y;
    if (espacoRestante < ALTURA_QR_BLOCO) {
      doc.addPage();
    }
    const qrY = doc.y;
    const validUrl = await renderQRValidacao(doc, hashValidacao, baseUrl, 460, qrY, {
      size: 80,
      corHex,
      comLabel: true,
    });
    renderHashFooter(doc, hashValidacao, validUrl, 48, qrY + 10, 380);
  } catch (err) {
    console.warn(`[propostas-consultoria-pdf] falha QR/hash: ${(err as Error).message}`);
  }

  // v3.23.7: Footer global emitido em TODAS as paginas via bufferedPageRange.
  // Substitui o text() avulso em y=800 que causava paginas redundantes.
  //
  // v3.23.8 BUG-FIX: dentro do loop, ZERA margins.bottom temporariamente. O motivo:
  // o footer e' renderizado em y=812 (page.height - 30), que esta DEPOIS da
  // margin.bottom default (842 - 48 = 794). Mesmo com lineBreak:false, o text()
  // seta doc.y=812 — e na proxima operacao PDFKit detecta `doc.y > margem inferior`
  // e DISPARA auto-pagebreak. Resultado em v3.23.7: cada text() do footer criava
  // pagina extra (3 paginas viraram 9). Zerando margins.bottom durante o loop o
  // auto-pagebreak nao dispara.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const origBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    try {
      const pageNum = i - range.start + 1;
      const footerY = doc.page.height - 30;
      const footerW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc.fontSize(7).fillColor('#777').font('Helvetica-Oblique')
         .text(
           `${brand} — Acailandia/MA · Proposta ${p.numero} · Emitida ${formatDataBR(p.data_proposta)} · Validade ${p.validade_dias} dia${p.validade_dias === 1 ? '' : 's'}`,
           doc.page.margins.left,
           footerY,
           { width: footerW - 80, align: 'left', lineBreak: false },
         );
      doc.text(
        `Pagina ${pageNum} de ${range.count}`,
        doc.page.margins.left,
        footerY,
        { width: footerW, align: 'right', lineBreak: false },
      );
    } finally {
      doc.page.margins.bottom = origBottom;
    }
  }
  doc.font('Helvetica').fillColor('#111');

  doc.end();
  await new Promise<void>(resolve => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

function desenharTabelaCustos(doc: PDFKit.PDFDocument, items: CustosCalculados['secao_2_taxas'], corHex: string) {
  const colX = { idx: 48, desc: 72, sub: 470 };
  const colW = { idx: 22, desc: 396, sub: 80 };

  // Header
  doc.fontSize(8.5).fillColor('#444').font('Helvetica-Bold');
  doc.text('#', colX.idx, doc.y, { width: colW.idx });
  const hY = doc.y;
  doc.text('Descricao', colX.desc, hY, { width: colW.desc, continued: false });
  doc.text('Subtotal', colX.sub, hY, { width: colW.sub, align: 'right' });
  doc.font('Helvetica');
  let cursorY = doc.y + 4;
  doc.moveTo(48, cursorY).lineTo(547, cursorY).strokeColor('#888').lineWidth(0.5).stroke();
  cursorY += 4;

  doc.fontSize(8.5).fillColor('#111');
  for (const it of items) {
    // v1.66.17: aviso de Desconto/Acrescimo se valor_original presente e diferente
    let avisoDesconto = '';
    let corAviso = '#dc2626';
    if (typeof it.valor_original === 'number' && it.valor_original > 0 && it.valor !== it.valor_original) {
      const diff = it.valor - it.valor_original;
      const pct = (Math.abs(diff) / it.valor_original) * 100;
      if (diff < 0) {
        avisoDesconto = `\n   ⚠ Desconto concedido: ${formatBRL(Math.abs(diff))} (-${pct.toFixed(1)}%)`;
        corAviso = '#dc2626';
      } else {
        avisoDesconto = `\n   ⬆ Acrescimo: ${formatBRL(diff)} (+${pct.toFixed(1)}%)`;
        corAviso = '#fb923c';
      }
    } else if ((!it.valor_original || it.valor_original === 0) && it.valor > 0 && it.pendente === false && (it as { _eraOriginalmenteZero?: boolean })._eraOriginalmenteZero) {
      // (caso especifico — nao usa, mas reservado)
    }

    const descTxtBase = it.descricao + (it.observacao ? `\n   ${it.observacao}` : '');
    const descTxt = descTxtBase + avisoDesconto;
    const hDesc = doc.heightOfString(descTxt, { width: colW.desc });
    const lineHeight = Math.max(hDesc, 12);
    if (cursorY + lineHeight > 760) {
      doc.addPage();
      cursorY = 60;
    }
    doc.fillColor('#111').text(String(it.ordem), colX.idx, cursorY, { width: colW.idx });
    // Imprime descricao + observacao em preto, depois aviso em vermelho/laranja
    if (avisoDesconto) {
      const altBase = doc.heightOfString(descTxtBase, { width: colW.desc });
      doc.fillColor('#111').text(descTxtBase, colX.desc, cursorY, { width: colW.desc });
      doc.fillColor(corAviso).font('Helvetica-Bold')
         .text(avisoDesconto.trim(), colX.desc, cursorY + altBase, { width: colW.desc });
      doc.font('Helvetica');
    } else {
      doc.text(descTxt, colX.desc, cursorY, { width: colW.desc });
    }
    const valorStr = it.pendente ? 'A confirmar' : formatBRL(it.valor);
    doc.fillColor(it.pendente ? '#b45309' : '#111')
       .text(valorStr, colX.sub, cursorY, { width: colW.sub, align: 'right' });
    doc.fillColor('#111');
    cursorY += lineHeight + 4;
  }
  doc.x = 48;
  doc.y = cursorY;
}

function formatDataBR(d: Date | string): string {
  if (!d) return '-';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

// ── Envio ──────────────────────────────────────────────────────────────────

// v3.23.7 a v3.23.9: helper sleep + ANEXO_THROTTLE_MS pra loop de envio
// individual de anexos. v3.23.10 reverteu pra PDF unificado — helper nao usado
// mais aqui, mantido caso outras integracoes futuras precisem.
// const ANEXO_THROTTLE_MS = 1500;
// function sleep(ms: number): Promise<void> {
//   return new Promise((r) => setTimeout(r, ms));
// }

// v3.27.0: garante que a proposta de Demarcacao tenha codigos FQNS mintados
// (idempotente — so minta uma vez por proposta; anti-replay via dados_imovel.codigos_mintados).
// Invocado pelos senders WhatsApp/Telegram antes da transicao RASCUNHO->ENVIADA.
export async function garantirCodigosMintadosDemarcacao(propostaId: number): Promise<void> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT subtipo_consultoria, status, dados_imovel, custos_calculados
       FROM propostas WHERE id = ? AND deleted_at IS NULL`,
    [propostaId],
  );
  if (!rows.length) return;
  const subtipo = String(rows[0].subtipo_consultoria || '');
  if (subtipo !== 'demarcacao_urbana' && subtipo !== 'demarcacao_rural') return;
  if (String(rows[0].status || '').toUpperCase() !== 'RASCUNHO') return; // so minta na primeira transicao

  const dadosImovel = parseJsonCol<Record<string, unknown> & { num_vertices?: number; marcos?: Array<{ tipo: string; quantidade: number }>; codigos_mintados?: unknown }>(rows[0].dados_imovel) || {};
  if (dadosImovel.codigos_mintados) return; // ja mintado — anti-replay

  // Localiza o tecnico responsavel: primeiro admin com prefixo configurado
  const [userRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM users
      WHERE credencial_incra_prefixo IS NOT NULL AND credencial_incra_prefixo <> ''
      ORDER BY (role = 'admin') DESC, id ASC
      LIMIT 1`,
  );
  if (!userRows.length) {
    console.warn(`[mint-fqns] proposta ${propostaId}: nenhum usuario com credencial INCRA — pulando mint`);
    return;
  }
  const userId = Number(userRows[0].id);

  const numVertices = Number(dadosImovel.num_vertices || 0);
  const marcos = Array.isArray(dadosImovel.marcos)
    ? (dadosImovel.marcos as Array<{ tipo: 'concreto' | 'tubo_galvanizado' | 'madeira'; quantidade: number; valor_unitario_congelado?: number }>)
        .map((m) => ({ tipo: m.tipo, quantidade: Number(m.quantidade) || 0, valor_unitario_congelado: Number(m.valor_unitario_congelado) || 0 }))
    : [];

  const conn = await pool.getConnection();
  try {
    const m = await import('../services/pricing/mintCodigosDemarcacao');
    const codigos = await m.mintarCodigosDemarcacao(conn, userId, {
      num_vertices: numVertices,
      marcos,
    });
    // Persiste em dados_imovel + custos_calculados.codigos_mintados
    const dadosAtual = { ...dadosImovel, codigos_mintados: codigos };
    const custosAtual = parseJsonCol<CustosCalculados>(rows[0].custos_calculados) || ({} as CustosCalculados);
    (custosAtual as unknown as { codigos_mintados: typeof codigos }).codigos_mintados = codigos;
    await pool.execute(
      `UPDATE propostas SET dados_imovel = ?, custos_calculados = ? WHERE id = ?`,
      [JSON.stringify(dadosAtual), JSON.stringify(custosAtual), propostaId],
    );
    console.log(`[mint-fqns] proposta ${propostaId}: ${codigos.vertices.length} V + ${codigos.marcos_por_tipo.concreto.length}/${codigos.marcos_por_tipo.tubo_galvanizado.length}/${codigos.marcos_por_tipo.madeira.length} marcos`);
  } catch (err) {
    console.error(`[mint-fqns] proposta ${propostaId} FALHOU:`, (err as Error).message);
    // nao re-throw — envio continua, mint pode ser feito manualmente depois
  } finally {
    conn.release();
  }
}

export async function enviarPropostaConsultoriaWhatsApp(input: { id: string; telefone?: string }) {
  const idNum = Number(input.id);
  if (!idNum) throw new Error('id obrigatorio');
  const p = await buscarPropostaConsultoria(input.id);
  const tel = (input.telefone?.trim()) || p.cliente?.telefone || '';
  if (!tel) throw new Error('Telefone obrigatorio (informe ou cadastre no cliente).');

  // v3.27.0: minta os codigos FQNS antes de gerar o PDF (so demarcacao + RASCUNHO).
  // Idempotente — chamadas repetidas nao re-mintam.
  await garantirCodigosMintadosDemarcacao(idNum);

  // v3.23.10: PDF UNIFICADO (proposta + anexos no mesmo arquivo). Antes:
  // - v3.23.7-9: enviava proposta separado + cada anexo em mensagem propria
  //   com throttle. UX boa pra download seletivo mas o cliente acabou pedindo
  //   pra voltar pra 1 unico arquivo (mais facil de armazenar/encaminhar).
  // - Agora: PDF merged via gerarPdfPropostaConsultoriaComAnexos.
  const pdfBuf = await gerarPdfPropostaConsultoriaComAnexos(input.id);
  const fileName = `Proposta_${p.numero}_${(p.cliente?.nome || 'cliente').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.pdf`;
  const r = await sendWhatsAppDocument(tel, pdfBuf.toString('base64'), fileName);

  await pool.execute(
    `UPDATE propostas
        SET enviada_whatsapp = 1,
            enviada_em = CURRENT_TIMESTAMP,
            status = IF(status = 'rascunho', 'enviada', status)
      WHERE id = ?`,
    [idNum]
  );

  return {
    ok: true as const,
    message: `Proposta ${p.numero} enviada via WhatsApp para ${r.phone} (msgId ${r.messageId || '?'}, ${(pdfBuf.length / 1024).toFixed(0)} KB).`,
    messageId: r.messageId,
    phone: r.phone,
  };
}

export async function enviarPropostaConsultoriaTelegram(input: { id: string; chatId?: string }) {
  const idNum = Number(input.id);
  // v3.27.0: mint antes do envio (idempotente — so demarcacao + RASCUNHO).
  if (idNum) await garantirCodigosMintadosDemarcacao(idNum);
  if (!idNum) throw new Error('id obrigatorio');
  const p = await buscarPropostaConsultoria(input.id);

  const chatId = input.chatId
    || (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
    || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  if (!chatId) throw new Error('chatId Telegram obrigatorio (defina TELEGRAM_LEAD_CHAT_ID ou TELEGRAM_AUTHORIZED_USER_IDS, ou passe explicit).');

  // v1.66.14: log + try/catch detalhado pra diagnosticar falhas no 2o envio
  // v3.23.10: revertido pra PDF UNIFICADO (proposta + anexos no mesmo arquivo).
  // CEO pediu — cliente prefere 1 arquivo unico. Telegram aceita ate 50MB; guard mantido.
  console.log(`[telegram-consultoria] iniciando envio proposta=${p.numero} chat=${chatId}`);
  let pdfBuf: Buffer;
  try {
    pdfBuf = await gerarPdfPropostaConsultoriaComAnexos(input.id);
    console.log(`[telegram-consultoria] PDF gerado: ${(pdfBuf.length / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('[telegram-consultoria] erro ao gerar PDF:', (err as Error).message);
    throw new Error(`Falha ao gerar PDF: ${(err as Error).message}`);
  }

  if (pdfBuf.length > 50 * 1024 * 1024) {
    throw new Error(`PDF tem ${(pdfBuf.length / 1024 / 1024).toFixed(1)} MB e o Telegram aceita ate 50 MB. Reduza o tamanho dos anexos da proposta.`);
  }

  const fileName = `Proposta_${p.numero}_${(p.cliente?.nome || 'cliente').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}.pdf`;
  try {
    await sendTelegramDocument(chatId, pdfBuf, fileName, `Proposta ${p.numero} — ${SUBTIPO_LABEL[p.subtipo || ''] || p.subtipo}`);
    console.log(`[telegram-consultoria] envio OK proposta=${p.numero}`);
  } catch (err) {
    const e = err as Error & { response?: { data?: { description?: string; error_code?: number } } };
    const desc = e.response?.data?.description || e.message || 'erro desconhecido';
    const code = e.response?.data?.error_code;
    console.error(`[telegram-consultoria] envio FALHOU proposta=${p.numero} code=${code} desc=${desc}`);
    throw new Error(`Telegram rejeitou: ${desc}${code ? ` (code ${code})` : ''}`);
  }

  await pool.execute(
    `UPDATE propostas
        SET status = IF(status = 'rascunho', 'enviada', status)
      WHERE id = ?`,
    [idNum]
  );

  return {
    ok: true as const,
    message: `Proposta ${p.numero} enviada via Telegram (chat ${chatId}, ${(pdfBuf.length / 1024).toFixed(0)} KB).`,
  };
}

// v1.66.13: atualiza Proposta de Consultoria existente (mesmos dados que
// criar — recalcula custos via engine OU usa custos_override se vier).
// v3.23.5: quando status === 'ENVIADA', incrementa a revisao no numero (R1->R2->...)
// e loga em custos_calculados.historico_revisoes. Cliente_id e criado_em nao mudam.
export async function atualizarPropostaConsultoria(input: {
  id: string;
  endereco_imovel?: string;
  observacoes?: string;
  gestor_cargo?: string;
  gestor_nome?: string;
  gestor_telefone?: string;
  dados_imovel?: Record<string, unknown>;
  custos_override?: CustosCalculados;
  motivo_revisao?: string;            // opcional: vai pro historico_revisoes
  autor_revisao?: string;             // opcional: idem
}) {
  const id = Number(input.id);
  if (!id) throw new Error('id obrigatorio');

  // Busca proposta atual (precisa do subtipo + dados_imovel pra recalcular se nao vier override)
  const atual = await buscarPropostaConsultoria(input.id);
  if (atual.tipo !== 'consultoria') throw new Error('Proposta nao e de consultoria');

  // Determina dados_imovel a usar (novo ou existente)
  const dadosFinal = (input.dados_imovel as InputAverbacao | undefined) ?? (atual.dados_imovel as InputAverbacao);

  // Recalcula via engine se nao vier override
  let custosFinal: CustosCalculados;
  if (input.custos_override) {
    // v1.66.17: pra mostrar Desconto/Acrescimo no PDF, recalcula via engine
    // pra ter os valores originais e anota em valor_original de cada item.
    const subtipo = atual.subtipo as SubtipoConsultoria;
    let origTaxas: ItemCusto[] = [];
    let origHon: ItemCusto[] = [];
    if (subtipo === 'averbacao_residencial' || subtipo === 'averbacao_comercial') {
      try {
        const r = await calcularConsultoria({ subtipo, dados: dadosFinal });
        origTaxas = r.custos.secao_2_taxas;
        origHon   = r.custos.secao_3_honorarios;
      } catch { /* se falhar, segue sem valores originais */ }
    }
    const ov = input.custos_override;
    const taxasComOriginal = (ov.secao_2_taxas || []).map(i => {
      const orig = origTaxas.find((o: ItemCusto) => o.ordem === i.ordem);
      return { ...i, valor_original: orig?.valor };
    });
    const honComOriginal = (ov.secao_3_honorarios || []).map(i => {
      const orig = origHon.find((o: ItemCusto) => o.ordem === i.ordem);
      return { ...i, valor_original: orig?.valor };
    });
    const tot = taxasComOriginal.reduce((s, i) => s + Number(i.valor || 0), 0)
              + honComOriginal.reduce((s, i) => s + Number(i.valor || 0), 0);
    // v3.24.16 FIX: preservar TODOS os campos derivados do custos atual quando
    // o override (ov) nao trouxer. CEO mostrou PROP-23 (remembramento) com
    // parcelas "Valor: R$ 0,00" — bug identico ao da v3.23.8 mas no PUT em vez
    // do POST. O front nao envia condicoes_pagamento / honorarios_romatec /
    // base_calculo no override, e o spread `...ov` apagava esses campos do
    // custos_calculados salvo. Render do PDF entao lia cp.valor=undefined
    // -> formatBRL(undefined) = "R$ 0,00".
    const atualCalc = atual.custos_calculados as CustosCalculados | null;
    custosFinal = {
      ...ov,
      secao_2_taxas: taxasComOriginal,
      secao_3_honorarios: honComOriginal,
      secao_5_total: tot,
      // Preserva campos derivados (todos com ?? fallback pra atualCalc)
      condicoes_pagamento: ov.condicoes_pagamento ?? atualCalc?.condicoes_pagamento,
      honorarios_romatec: ov.honorarios_romatec ?? atualCalc?.honorarios_romatec,
      base_calculo: ov.base_calculo ?? atualCalc?.base_calculo,
      avisos: ov.avisos ?? atualCalc?.avisos ?? [],
      secao_1_projetos: ov.secao_1_projetos ?? atualCalc?.secao_1_projetos ?? [],
      secao_4_checklist: ov.secao_4_checklist ?? atualCalc?.secao_4_checklist ?? [],
      secao_opcionais_georref: ov.secao_opcionais_georref ?? atualCalc?.secao_opcionais_georref,
      despesas_administrativas: ov.despesas_administrativas ?? atualCalc?.despesas_administrativas,
      historico_revisoes: ov.historico_revisoes ?? atualCalc?.historico_revisoes,
    };
    // v3.24.14: preserva projeto_executivo do custos atual se override nao trouxe
    if (subtipo === 'projeto_executivo' && !(ov as unknown as { projeto_executivo?: unknown }).projeto_executivo) {
      const atualPE = (atualCalc as unknown as { projeto_executivo?: unknown })?.projeto_executivo;
      if (atualPE) {
        (custosFinal as unknown as { projeto_executivo: unknown }).projeto_executivo = atualPE;
      }
    }
  } else {
    const subtipo = atual.subtipo as SubtipoConsultoria;
    // v3.24.14: subtipos com engine especifica — recalcula via calcularConsultoria.
    // Antes so averbacao era suportada e outros subtipos lancavam Error. Agora
    // projeto_executivo (que tem engine retornando { custos, projeto_executivo })
    // re-deriva o objeto completo + ja inclui projeto_executivo no spread.
    if (subtipo === 'projeto_executivo') {
      const m = await import('../services/pricing/projetoExecutivo');
      const r = await m.calcularProjetoExecutivo(
        dadosFinal as unknown as Parameters<typeof m.calcularProjetoExecutivo>[0],
      );
      custosFinal = r.custos;
      // Inclui projeto_executivo no objeto persistido (mesmo padrao do criar)
      (custosFinal as unknown as { projeto_executivo: unknown }).projeto_executivo = r.projeto_executivo;
    } else if (subtipo === 'averbacao_residencial' || subtipo === 'averbacao_comercial') {
      const r = await calcularConsultoria({ subtipo, dados: dadosFinal });
      custosFinal = r.custos;
    } else if (subtipo === 'demarcacao_urbana' || subtipo === 'demarcacao_rural') {
      // v3.27.0: Demarcacao de Lotes
      const m = await import('../services/pricing/demarcacaoLotes');
      const out = m.calcularDemarcacaoLotes(dadosFinal as unknown as InputDemarcacaoLotes);
      custosFinal = adaptarDemarcacaoParaCustosCalculados(out);
    } else {
      throw new Error(`Subtipo ${subtipo} nao suportado para edicao nesta fase.`);
    }
  }

  // v3.23.5: se proposta ja foi ENVIADA, edicao gera revisao (R1 -> R2 -> ...).
  // Mantemos R1 quando ainda esta em RASCUNHO (edicao livre).
  let novoNumero = atual.numero;
  let revisaoIncrementada = false;
  if (String(atual.status || '').toUpperCase() === 'ENVIADA') {
    novoNumero = bumpRevisao(atual.numero);
    revisaoIncrementada = true;
    const { revisao } = parseRevisao(novoNumero);
    const historico = Array.isArray(custosFinal.historico_revisoes)
      ? [...custosFinal.historico_revisoes]
      : [];
    historico.push({
      revisao,
      timestamp: new Date().toISOString(),
      autor: input.autor_revisao,
      motivo: input.motivo_revisao,
    });
    custosFinal = { ...custosFinal, historico_revisoes: historico };
  }

  await pool.execute(
    `UPDATE propostas SET
       numero = ?,
       endereco_obra = COALESCE(?, endereco_obra),
       observacoes = COALESCE(?, observacoes),
       gestor_cargo = COALESCE(?, gestor_cargo),
       gestor_nome = COALESCE(?, gestor_nome),
       gestor_telefone = COALESCE(?, gestor_telefone),
       dados_imovel = ?,
       custos_calculados = ?,
       valor_total = ?,
       atualizado_em = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL`,
    [
      novoNumero,
      input.endereco_imovel ?? null,
      input.observacoes ?? null,
      input.gestor_cargo ?? null,
      input.gestor_nome ?? null,
      input.gestor_telefone ?? null,
      JSON.stringify(dadosFinal),
      JSON.stringify(custosFinal),
      custosFinal.secao_5_total,
      id,
    ]
  );

  return {
    ok: true as const,
    id: input.id,
    numero: novoNumero,
    revisao_incrementada: revisaoIncrementada,
    valor_total: custosFinal.secao_5_total,
    message: revisaoIncrementada
      ? `Proposta ${atual.numero} atualizada -> ${novoNumero} (revisao). Novo total: R$ ${custosFinal.secao_5_total.toFixed(2)}.`
      : `Proposta ${atual.numero} atualizada. Novo total: R$ ${custosFinal.secao_5_total.toFixed(2)}.`,
  };
}

// ── Anexos da Proposta (v1.66.9) ───────────────────────────────────────────

const ANEXO_MIMES_VALIDOS = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
const ANEXO_TAMANHO_MAX_BYTES = 15 * 1024 * 1024; // 15MB por arquivo

export async function criarAnexoProposta(input: {
  proposta_id: string;
  filename: string;
  mimetype: string;
  conteudo_b64: string;
}) {
  const propId = Number(input.proposta_id);
  if (!propId) throw new Error('proposta_id obrigatorio');
  if (!input.filename) throw new Error('filename obrigatorio');
  if (!ANEXO_MIMES_VALIDOS.includes(input.mimetype)) {
    throw new Error(`Mimetype nao suportado: ${input.mimetype}. Aceito: PDF, PNG, JPEG.`);
  }
  const tamanho = Math.floor((input.conteudo_b64.length * 3) / 4);
  if (tamanho > ANEXO_TAMANHO_MAX_BYTES) {
    throw new Error(`Arquivo excede limite de 15MB (atual: ${(tamanho / 1024 / 1024).toFixed(1)}MB).`);
  }

  const [maxRow] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(ordem), 0) AS ord FROM proposta_anexos WHERE proposta_id = ?`,
    [propId]
  );
  const proxOrdem = Number(maxRow[0]?.ord || 0) + 1;

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO proposta_anexos (proposta_id, filename, mimetype, tamanho_bytes, conteudo_b64, ordem)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [propId, input.filename, input.mimetype, tamanho, input.conteudo_b64, proxOrdem]
  );
  return {
    ok: true as const,
    insertId: r.insertId,
    filename: input.filename,
    tamanho_bytes: tamanho,
    ordem: proxOrdem,
    message: `Anexo "${input.filename}" enviado (${(tamanho / 1024).toFixed(1)} KB).`,
  };
}

export async function listarAnexosProposta(input: { proposta_id: string }) {
  const propId = Number(input.proposta_id);
  if (!propId) throw new Error('proposta_id obrigatorio');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, filename, mimetype, tamanho_bytes, ordem, criado_em
       FROM proposta_anexos WHERE proposta_id = ? ORDER BY ordem`,
    [propId]
  );
  return {
    total: rows.length,
    items: rows.map(r => ({
      id: String(r.id),
      filename: r.filename,
      mimetype: r.mimetype,
      tamanho_bytes: Number(r.tamanho_bytes),
      ordem: Number(r.ordem),
      criado_em: r.criado_em,
    })),
  };
}

export async function removerAnexoProposta(input: { id: string }) {
  const id = Number(input.id);
  if (!id) throw new Error('id invalido');
  const [r] = await pool.execute<ResultSetHeader>(
    `DELETE FROM proposta_anexos WHERE id = ?`, [id]
  );
  return { ok: true as const, affected: r.affectedRows, message: 'Anexo removido.' };
}

async function carregarAnexosProposta(propId: number): Promise<Array<{ filename: string; mimetype: string; buffer: Buffer }>> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT filename, mimetype, conteudo_b64 FROM proposta_anexos
      WHERE proposta_id = ? ORDER BY ordem`,
    [propId]
  );
  return rows.map(r => ({
    filename: String(r.filename),
    mimetype: String(r.mimetype),
    buffer: Buffer.from(String(r.conteudo_b64), 'base64'),
  }));
}

// v1.66.9: gera PDF da proposta com anexos mergeados ao final.
// Imagens (PNG/JPG) viram pagina propria do PDF. PDFs anexos sao mergeados
// pagina por pagina. Usa pdf-lib pra concatenacao real.
// v3.24.12: aceita signatureMeta pra propagar pro PDF principal antes do merge.
// Necessario porque assinarProposta gerava PDF sem anexos. CEO reportou que os
// anexos somem no PDF assinado.
export async function gerarPdfPropostaConsultoriaComAnexos(
  id: string,
  signatureMeta?: SignatureVisualMeta,
): Promise<Buffer> {
  const propostaPdf = await gerarPdfPropostaConsultoria(id, signatureMeta);
  const anexos = await carregarAnexosProposta(Number(id));
  if (anexos.length === 0) return propostaPdf;

  const merged = await PDFLibDocument.create();
  // Importa proposta principal
  const principalDoc = await PDFLibDocument.load(propostaPdf);
  const principalPages = await merged.copyPages(principalDoc, principalDoc.getPageIndices());
  principalPages.forEach(p => merged.addPage(p));

  for (const anexo of anexos) {
    try {
      if (anexo.mimetype === 'application/pdf') {
        const anexoDoc = await PDFLibDocument.load(anexo.buffer);
        const anexoPages = await merged.copyPages(anexoDoc, anexoDoc.getPageIndices());
        anexoPages.forEach(p => merged.addPage(p));
      } else if (anexo.mimetype === 'image/png' || anexo.mimetype === 'image/jpeg' || anexo.mimetype === 'image/jpg') {
        const img = anexo.mimetype === 'image/png'
          ? await merged.embedPng(anexo.buffer)
          : await merged.embedJpg(anexo.buffer);
        // Pagina A4 com imagem ajustada mantendo aspecto
        const A4_W = 595.28, A4_H = 841.89;
        const margem = 30;
        const maxW = A4_W - 2 * margem, maxH = A4_H - 2 * margem - 30;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        const page = merged.addPage([A4_W, A4_H]);
        page.drawImage(img, {
          x: (A4_W - w) / 2,
          y: (A4_H - h) / 2 - 15,
          width: w,
          height: h,
        });
        page.drawText(`Anexo: ${anexo.filename}`, {
          x: margem, y: 20, size: 9,
        });
      }
    } catch (err) {
      console.warn(`[anexos] Falha ao mergear ${anexo.filename}: ${(err as Error).message}`);
    }
  }
  const out = await merged.save();
  return Buffer.from(out);
}

// Lista filtrada por tipo (mao_de_obra ou consultoria)
export async function listarPropostasPorTipo(input: { tipo?: 'mao_de_obra' | 'consultoria'; limite?: number } = {}) {
  const limit = Math.min(Math.max(Number(input.limite) || 100, 1), 500);
  const params: (string | number)[] = [];
  // v1.66.15: tambem retorna contagem + lista resumida de anexos por proposta
  let sql = `SELECT p.id, p.numero, p.tipo, p.subtipo_consultoria, p.cliente_id,
                    c.nome AS cliente_nome, p.endereco_obra, p.data_proposta,
                    p.validade_dias, p.valor_total, p.status, p.enviada_whatsapp,
                    p.criado_em, p.assinado_em,
                    (SELECT COUNT(*) FROM proposta_anexos a WHERE a.proposta_id = p.id) AS qtd_anexos
               FROM propostas p
               LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
              WHERE p.deleted_at IS NULL`;
  if (input.tipo) {
    sql += ' AND p.tipo = ?';
    params.push(input.tipo);
  }
  sql += ` ORDER BY p.id DESC LIMIT ${limit}`;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
  // Anexos por proposta (uma query so pra todos os ids — mais eficiente que N queries)
  const ids = rows.map(r => Number(r.id)).filter(Boolean);
  let anexosPorPropId: Record<number, Array<{ id: number; filename: string; mimetype: string; tamanho_bytes: number }>> = {};
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const [arows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, proposta_id, filename, mimetype, tamanho_bytes
         FROM proposta_anexos WHERE proposta_id IN (${placeholders}) ORDER BY ordem`,
      ids
    );
    for (const ar of arows) {
      const pid = Number(ar.proposta_id);
      if (!anexosPorPropId[pid]) anexosPorPropId[pid] = [];
      anexosPorPropId[pid].push({
        id: Number(ar.id),
        filename: String(ar.filename),
        mimetype: String(ar.mimetype),
        tamanho_bytes: Number(ar.tamanho_bytes),
      });
    }
  }

  return {
    total: rows.length,
    items: rows.map(r => ({
      id: String(r.id),
      numero: r.numero,
      tipo: r.tipo,
      subtipo: r.subtipo_consultoria,
      cliente_id: String(r.cliente_id),
      cliente_nome: r.cliente_nome,
      endereco_obra: r.endereco_obra,
      data_proposta: r.data_proposta,
      validade_dias: r.validade_dias,
      valor_total: Number(r.valor_total),
      status: r.status,
      enviada_whatsapp: !!r.enviada_whatsapp,
      criado_em: r.criado_em,
      qtd_anexos: Number(r.qtd_anexos || 0),
      anexos: anexosPorPropId[Number(r.id)] || [],
      assinado_em: r.assinado_em
        ? (r.assinado_em instanceof Date ? r.assinado_em.toISOString() : String(r.assinado_em))
        : null,
    })),
  };
}

// ─── v1.99.11: Assinatura digital ICP-Brasil de Propostas ──────────────────

import { getCertForSigning } from '../services/signingCertificates';
import { signPdfBuffer } from '../services/pdfSigner';

export interface AssinarPropostaResult {
  proposta_id: number;
  numero: string;
  assinado_em: string;
  cert: {
    id: number;
    label: string;
    subject_cn: string | null;
    subject_doc: string | null;
    issuer_cn: string | null;
    validade_ate: string | null;
  };
  pdf_size_bytes: number;
}

/**
 * Assina proposta com certificado digital ICP-Brasil.
 * v3.23.9: aceita parametro perfil ('pj'|'pf'). Default 'pj' por retrocompat com
 * chamadas existentes (rota /api/.../assinar sem body). O comentario antigo
 * "PF nao faz sentido pra propostas empresariais" estava errado — Tec. em
 * Agrimensura assina como PF mesmo em proposta da Romatec (responsabilidade
 * tecnica e' do profissional, nao da PJ).
 */
export async function assinarProposta(
  propostaId: number | string,
  perfil: 'pj' | 'pf' = 'pj',
): Promise<AssinarPropostaResult> {
  if (perfil !== 'pj' && perfil !== 'pf') {
    throw new Error(`perfil invalido: ${perfil} (esperado: 'pj' ou 'pf')`);
  }
  const certData = await getCertForSigning(perfil);
  if (!certData) {
    const tipo = perfil === 'pj' ? 'e-CNPJ' : 'e-CPF';
    throw new Error(
      `Nenhum certificado digital ${perfil.toUpperCase()} cadastrado. Cadastre o ${tipo} ICP-Brasil A1 em /obras admin antes de assinar propostas com perfil ${perfil}.`
    );
  }
  if (certData.meta.expirado) {
    console.warn(`[proposta-assinatura] cert ${certData.meta.id} VENCIDO em ${certData.meta.validade_ate}`);
  }

  const agora = new Date();
  const signatureMeta: SignatureVisualMeta = {
    signer_cn: certData.meta.subject_cn ?? `Proposta ${propostaId}`,
    signer_doc: certData.meta.subject_doc,
    issuer_cn: certData.meta.issuer_cn,
    validade_ate: certData.meta.validade_ate,
    data_assinatura: agora,
    thumbprint: certData.meta.thumbprint,
  };

  const proposta = await buscarPropostaConsultoria(String(propostaId));
  if (proposta.tipo !== 'consultoria') {
    throw new Error('Apenas propostas de consultoria sao suportadas neste momento');
  }

  // Gera PDF JA com bloco visual + assina.
  // v3.24.12 FIX: usa ComAnexos pra incluir croqui/imagens no PDF assinado.
  // Antes usava gerarPdfPropostaConsultoria (sem anexos) — assinatura ficava
  // so na proposta principal, anexos sumiam do PDF final salvo no banco.
  const pdfBuffer = await gerarPdfPropostaConsultoriaComAnexos(String(propostaId), signatureMeta);

  const signMeta = {
    name: certData.meta.subject_cn ?? `Proposta ${proposta.numero}`,
    reason: `Proposta de Consultoria ${proposta.numero}`,
    location: 'Acailandia/MA',
    contactInfo: certData.meta.subject_doc ?? '',
  };

  const pdfAssinado = await signPdfBuffer(pdfBuffer, certData.pfx, certData.senha, signMeta);

  const meta = {
    perfil,                            // v3.23.9: vem do parametro (pj ou pf)
    cert_id: certData.meta.id,
    cert_label: certData.meta.label,
    subject_cn: certData.meta.subject_cn,
    subject_doc: certData.meta.subject_doc,
    issuer_cn: certData.meta.issuer_cn,
    thumbprint: certData.meta.thumbprint,
    validade_ate: certData.meta.validade_ate,
    assinado_em: agora.toISOString(),
    sign_reason: signMeta.reason,
  };

  await pool.execute<ResultSetHeader>(
    `UPDATE propostas
     SET pdf_assinado = ?, assinado_em = ?, assinado_por_cert_id = ?, assinatura_meta = ?
     WHERE id = ?`,
    [pdfAssinado, agora, certData.meta.id, JSON.stringify(meta), Number(propostaId)]
  );

  return {
    proposta_id: Number(propostaId),
    numero: proposta.numero,
    assinado_em: agora.toISOString(),
    cert: {
      id: certData.meta.id,
      label: certData.meta.label,
      subject_cn: certData.meta.subject_cn,
      subject_doc: certData.meta.subject_doc,
      issuer_cn: certData.meta.issuer_cn,
      validade_ate: certData.meta.validade_ate,
    },
    pdf_size_bytes: pdfAssinado.length,
  };
}

interface PropostaAssinadaRow extends RowDataPacket {
  id: number;
  pdf_assinado: Buffer | null;
  assinado_em: Date | string | null;
  assinatura_meta: string | Record<string, unknown> | null;
}

export async function getPropostaPdfAssinado(propostaId: number | string): Promise<{
  pdf: Buffer;
  assinado_em: string;
  meta: Record<string, unknown>;
} | null> {
  const [rows] = await pool.execute<PropostaAssinadaRow[]>(
    `SELECT id, pdf_assinado, assinado_em, assinatura_meta
     FROM propostas WHERE id = ? LIMIT 1`,
    [Number(propostaId)]
  );
  if (!rows.length || !rows[0].pdf_assinado) return null;
  const r = rows[0];
  const meta = typeof r.assinatura_meta === 'string'
    ? JSON.parse(r.assinatura_meta)
    : (r.assinatura_meta ?? {});
  const assinadoEm = r.assinado_em
    ? (r.assinado_em instanceof Date ? r.assinado_em.toISOString() : String(r.assinado_em))
    : '';
  return { pdf: r.pdf_assinado as Buffer, assinado_em: assinadoEm, meta };
}

// ─── v1.99.17: Hash de validação pública /v/:hash ──────────────────────────

interface PropostaHashRow extends RowDataPacket {
  id: number;
  numero: string;
  hash_validacao: string | null;
  valor_total: string;
  criado_em: Date | string | null;
  cliente_id: number;
}

/**
 * Gera hash SHA-256 determinístico (a partir de campos imutáveis) para uma proposta
 * e grava em `propostas.hash_validacao`. Idempotente: se já houver hash, retorna o existente.
 */
export async function gerarOuBuscarHashProposta(propostaId: number | string): Promise<string> {
  const id = Number(propostaId);
  if (!id) throw new Error('proposta_id invalido');

  const [rows] = await pool.execute<PropostaHashRow[]>(
    `SELECT id, numero, hash_validacao, valor_total, criado_em, cliente_id
       FROM propostas WHERE id = ? LIMIT 1`,
    [id]
  );
  if (rows.length === 0) throw new Error('Proposta nao encontrada');
  const r = rows[0];
  if (r.hash_validacao) return String(r.hash_validacao);

  const criadoIso = r.criado_em
    ? (r.criado_em instanceof Date ? r.criado_em.toISOString() : String(r.criado_em))
    : '';
  const payload = `${r.numero}|${r.cliente_id}|${r.valor_total}|${criadoIso}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex');

  await pool.execute(
    `UPDATE propostas SET hash_validacao = ? WHERE id = ? AND hash_validacao IS NULL`,
    [hash, id]
  );
  return hash;
}

/**
 * Busca proposta pelo hash de validação pública. Retorna shape enxuto
 * (sem PDF assinado, sem custos completos) para a página /v/:hash.
 */
export async function buscarPropostaPorHash(hash: string): Promise<{
  id: string;
  numero: string;
  tipo: string;
  subtipo: string | null;
  cliente_nome: string | null;
  endereco_imovel: string | null;
  data_proposta: string | null;
  valor_total: number;
  status: string;
  assinado_em: string | null;
} | null> {
  if (!hash || typeof hash !== 'string' || hash.length < 16) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.id, p.numero, p.tipo, p.subtipo_consultoria, p.endereco_obra,
            p.data_proposta, p.valor_total, p.status, p.assinado_em,
            c.nome AS cliente_nome
       FROM propostas p
       LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
      WHERE p.hash_validacao = ? AND p.deleted_at IS NULL
      LIMIT 1`,
    [hash]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: String(r.id),
    numero: String(r.numero),
    tipo: String(r.tipo),
    subtipo: r.subtipo_consultoria ? String(r.subtipo_consultoria) : null,
    cliente_nome: r.cliente_nome ? String(r.cliente_nome) : null,
    endereco_imovel: r.endereco_obra ? String(r.endereco_obra) : null,
    data_proposta: r.data_proposta
      ? (r.data_proposta instanceof Date ? r.data_proposta.toISOString().slice(0, 10) : String(r.data_proposta))
      : null,
    valor_total: Number(r.valor_total),
    status: String(r.status),
    assinado_em: r.assinado_em
      ? (r.assinado_em instanceof Date ? r.assinado_em.toISOString() : String(r.assinado_em))
      : null,
  };
}

/** Retorna a base URL pública usada para QR de validação ({BASE_URL}/v/:hash). */
function getValidacaoBaseUrl(): string {
  return (
    process.env.BASE_URL
    || process.env.PUBLIC_BASE_URL
    || process.env.APP_URL
    || 'http://localhost:3000'
  ).replace(/\/+$/, '');
}

export { getValidacaoBaseUrl };

