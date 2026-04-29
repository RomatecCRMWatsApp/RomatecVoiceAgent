// Geração de contrato Romatec — Fase 2 (v1.34).
//
// Pipeline:
//   1) Recebe input (tipo de contrato + dados do CEO: cliente, imóvel, valores)
//   2) Busca modelo de contrato indexado (Fase 1) com filtro por tipo
//   3) Carrega texto completo do modelo + cláusulas
//   4) Claude orquestra mescla: usa o modelo como base, substitui dados,
//      preserva cláusulas legais essenciais, ajusta de acordo com input
//   5) Gera DOCX renderizado com formatação profissional (docx library)
//   6) Salva no banco (contratos_gerados) e retorna Buffer

import Anthropic from '@anthropic-ai/sdk';
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from 'docx';
import { supabase } from './supabase';

const CLAUDE_MODEL = process.env.CLAUDE_FALLBACK_MODEL || 'claude-sonnet-4-5';
const _claude = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

export interface PartiContratante {
  nome:       string;
  cpf_cnpj?:  string;
  rg?:        string;
  endereco?:  string;
  estado_civil?: string;
  profissao?: string;
  telefone?:  string;
  email?:     string;
}

export interface DadosImovel {
  endereco:     string;
  cidade?:      string;
  uf?:          string;
  cep?:         string;
  area_m2?:     number;
  matricula?:   string;
  cartorio?:    string;
  tipo?:        string;  // residencial/comercial/terreno/rural
  descricao?:   string;
}

export interface CondicoesContrato {
  valor_total:    number;
  forma_pagamento?: string;
  parcelas?:      number;
  valor_entrada?: number;
  data_entrega?:  string;
  prazo_meses?:   number;
  juros_aa_pct?:  number;
  observacoes?:   string;
}

export interface GerarContratoInput {
  tipo:           'compra_venda' | 'locacao' | 'permuta' | 'comodato' | 'corretagem' | 'outro';
  vendedor?:      PartiContratante;   // ou Locador
  comprador?:     PartiContratante;   // ou Locatario
  imovel?:        DadosImovel;
  condicoes?:     CondicoesContrato;
  contrato_modelo_id?: string;        // se quiser forçar um modelo específico
  observacoes_ceo?:  string;          // instruções extras pro Claude
  cidade_foro?:   string;             // default: Açailândia/MA
}

export interface GerarContratoResult {
  contrato_gerado_id: string;
  titulo:             string;
  texto:              string;
  docx_base64:        string;
  modelo_usado:       string;
  total_clausulas:    number;
}

// Busca o melhor modelo indexado pra esse tipo (mais recente)
async function buscarModelo(tipo: string, modeloId?: string): Promise<{
  id: string; titulo: string; tipo: string; texto_completo: string;
} | null> {
  const sb = supabase();
  let q = sb.from('contratos_indexados')
    .select('id, titulo, tipo, texto_completo')
    .order('criado_em', { ascending: false })
    .limit(1);
  if (modeloId) q = q.eq('id', modeloId);
  else q = q.eq('tipo', tipo);
  const r = await q.maybeSingle();
  if (r.error) throw new Error(`Busca modelo: ${r.error.message}`);
  return r.data as { id: string; titulo: string; tipo: string; texto_completo: string } | null;
}

function formatBR(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function valorPorExtenso(valor: number): string {
  // Implementação simplificada — pra produção use lib extenso ou similar
  const inteiro = Math.floor(valor);
  return `${formatBR(valor)} (R$ ${inteiro.toLocaleString('pt-BR')} reais)`;
}

// Monta prompt pro Claude personalizar o modelo com os dados
function montarPromptGeracao(modelo: { titulo: string; texto_completo: string }, input: GerarContratoInput): string {
  const v: Partial<PartiContratante> = input.vendedor  || {};
  const c: Partial<PartiContratante> = input.comprador || {};
  const i: Partial<DadosImovel>      = input.imovel    || {};
  const cond: CondicoesContrato      = input.condicoes || { valor_total: 0 };
  const dataHoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  return `Você é um redator de contratos imobiliários da Romatec Consultoria Imobiliária (Açailândia-MA).

TAREFA: Gere o TEXTO COMPLETO do contrato abaixo usando o MODELO de referência e os DADOS REAIS do CEO.

═══ MODELO DE REFERÊNCIA ═══
Título: ${modelo.titulo}
Texto:
${modelo.texto_completo.slice(0, 8000)}

═══ DADOS PRA PREENCHER ═══
TIPO: ${input.tipo}
DATA: ${dataHoje}
FORO: ${input.cidade_foro || 'Açailândia, Maranhão'}

VENDEDOR/LOCADOR:
- Nome: ${v.nome || '[NÃO INFORMADO]'}
- CPF/CNPJ: ${v.cpf_cnpj || '[NÃO INFORMADO]'}
- RG: ${v.rg || '-'}
- Estado civil: ${v.estado_civil || '-'}
- Profissão: ${v.profissao || '-'}
- Endereço: ${v.endereco || '-'}
- Contato: ${v.telefone || '-'} ${v.email ? '/ ' + v.email : ''}

COMPRADOR/LOCATÁRIO:
- Nome: ${c.nome || '[NÃO INFORMADO]'}
- CPF/CNPJ: ${c.cpf_cnpj || '[NÃO INFORMADO]'}
- RG: ${c.rg || '-'}
- Estado civil: ${c.estado_civil || '-'}
- Profissão: ${c.profissao || '-'}
- Endereço: ${c.endereco || '-'}
- Contato: ${c.telefone || '-'} ${c.email ? '/ ' + c.email : ''}

IMÓVEL:
- Endereço: ${i.endereco || '-'}
- Cidade/UF: ${i.cidade || '-'} / ${i.uf || '-'}
- CEP: ${i.cep || '-'}
- Área: ${i.area_m2 ? i.area_m2 + ' m²' : '-'}
- Matrícula: ${i.matricula || '-'}
- Cartório: ${i.cartorio || '-'}
- Tipo: ${i.tipo || '-'}
- Descrição adicional: ${i.descricao || '-'}

CONDIÇÕES:
- Valor total: R$ ${formatBR(cond.valor_total)} (${valorPorExtenso(cond.valor_total)})
- Forma de pagamento: ${cond.forma_pagamento || '-'}
- Parcelas: ${cond.parcelas ? `${cond.parcelas}x` : '-'}
- Entrada: ${cond.valor_entrada ? `R$ ${formatBR(cond.valor_entrada)}` : '-'}
- Data entrega/início: ${cond.data_entrega || '-'}
- Prazo (meses): ${cond.prazo_meses || '-'}
- Juros (a.a.): ${cond.juros_aa_pct ? cond.juros_aa_pct + '%' : '-'}
- Observações: ${cond.observacoes || '-'}

INSTRUÇÕES EXTRAS DO CEO:
${input.observacoes_ceo || '(nenhuma)'}

═══ REGRAS DE GERAÇÃO ═══
1. PRESERVE a estrutura jurídica do modelo (cláusulas, ordem, fundamentação legal)
2. SUBSTITUA todos os campos genéricos pelos dados reais acima
3. Use linguagem jurídica correta brasileira (Código Civil, Lei do Inquilinato 8.245/91 etc)
4. NUNCA invente dados — se um campo crítico estiver "[NÃO INFORMADO]", deixe a lacuna marcada como **___________** pro CEO preencher manualmente
5. Inclua SEMPRE: identificação completa das partes, descrição precisa do imóvel, valor por extenso, foro de eleição, cláusula de assinatura
6. Termine com linhas de assinatura: ${input.cidade_foro || 'Açailândia/MA'}, ${dataHoje}
7. Retorne APENAS o texto do contrato pronto, sem comentários, sem markdown, sem cabeçalho explicativo

GERE O CONTRATO COMPLETO AGORA:`;
}

// Renderiza texto plain em DOCX formatado
function gerarDocx(titulo: string, texto: string): Promise<Buffer> {
  const linhas = texto.split('\n').filter(l => l !== undefined);
  const paragraphs: Paragraph[] = [];

  // Título centralizado e em negrito
  paragraphs.push(new Paragraph({
    text: titulo.toUpperCase(),
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }));

  for (const linha of linhas) {
    const trim = linha.trim();
    if (!trim) {
      paragraphs.push(new Paragraph({ children: [new TextRun('')], spacing: { after: 100 } }));
      continue;
    }
    // Detecta cláusulas/seções (ex: "CLÁUSULA PRIMEIRA - DO OBJETO")
    const isHeading = /^(CL[ÁA]USULA|CAP[ÍI]TULO|SE[ÇC][ÃA]O|T[ÍI]TULO)\s/i.test(trim) || /^[A-ZÁÉÍÓÚÂÊÔÃ\s\d-]{5,80}$/.test(trim);
    const isSignature = /assinatura|por extenso|\b___+\b/i.test(trim);

    if (isHeading) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: trim, bold: true, size: 22 })],
        alignment: AlignmentType.LEFT,
        spacing: { before: 200, after: 100 },
      }));
    } else if (isSignature) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: trim, size: 22 })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 100, after: 100 },
      }));
    } else {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: trim, size: 22 })],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 120 },
      }));
    }
  }

  const doc = new Document({
    creator: 'ZAYRA — Romatec Consultoria Imobiliária',
    title:   titulo,
    description: 'Contrato gerado automaticamente pela ZAYRA',
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children:   paragraphs,
    }],
  });

  return Packer.toBuffer(doc);
}

export async function gerarContrato(input: GerarContratoInput): Promise<GerarContratoResult> {
  if (!_claude) throw new Error('ANTHROPIC_API_KEY não configurada — necessário pra geração');
  if (!input.tipo) throw new Error('tipo de contrato obrigatório (compra_venda, locacao, permuta, comodato, corretagem, outro)');

  // 1) Busca modelo
  const modelo = await buscarModelo(input.tipo, input.contrato_modelo_id);
  if (!modelo) {
    throw new Error(`Nenhum modelo de contrato indexado pra tipo "${input.tipo}". Indexe um modelo primeiro via memoria_contratos_listar / contracts:ingest.`);
  }
  console.log(`[gerarContrato] modelo: "${modelo.titulo}" (${modelo.id.slice(0, 8)}, tipo=${modelo.tipo})`);

  // 2) Claude personaliza
  const prompt = montarPromptGeracao(modelo, input);
  const r = await _claude.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 8000,
    messages:   [{ role: 'user', content: prompt }],
  });
  const textBlock = r.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
  const textoContrato = (textBlock?.text || '').trim();
  if (textoContrato.length < 200) throw new Error('Claude retornou contrato muito curto/vazio');

  console.log(`[gerarContrato] Claude gerou ${textoContrato.length} chars (in=${r.usage.input_tokens} out=${r.usage.output_tokens})`);

  // 3) Título do contrato
  const tituloMap: Record<string, string> = {
    compra_venda: 'Contrato de Compra e Venda de Imóvel',
    locacao:      'Contrato de Locação de Imóvel',
    permuta:      'Contrato de Permuta de Imóvel',
    comodato:     'Contrato de Comodato',
    corretagem:   'Contrato de Corretagem Imobiliária',
    outro:        modelo.titulo,
  };
  const titulo = tituloMap[input.tipo] || modelo.titulo;

  // 4) DOCX
  const docxBuffer = await gerarDocx(titulo, textoContrato);
  console.log(`[gerarContrato] DOCX gerado ${docxBuffer.length} bytes`);

  // 5) Salva no banco (histórico)
  const sb = supabase();
  const ins = await sb.from('contratos_gerados').insert({
    tipo:                 input.tipo,
    titulo,
    contrato_modelo_id:   modelo.id,
    cliente_nome:         input.comprador?.nome || input.vendedor?.nome || 'sem cliente',
    valor_total:          input.condicoes?.valor_total || 0,
    texto:                textoContrato,
    metadata:             input as unknown as Record<string, unknown>,
  }).select('id').single();

  // Se a tabela não existir ainda, ignora silenciosamente (apenas avisa)
  let contratoGeradoId = '';
  if (ins.error) {
    console.warn(`[gerarContrato] não salvou no banco (provavel falta da tabela contratos_gerados): ${ins.error.message}`);
  } else {
    contratoGeradoId = (ins.data as { id: string }).id;
  }

  return {
    contrato_gerado_id: contratoGeradoId,
    titulo,
    texto:              textoContrato,
    docx_base64:        docxBuffer.toString('base64'),
    modelo_usado:       modelo.titulo,
    total_clausulas:    (textoContrato.match(/CL[ÁA]USULA/gi) || []).length,
  };
}

export async function listarContratosGerados(input: { limite?: number } = {}) {
  const sb = supabase();
  const r = await sb
    .from('contratos_gerados')
    .select('id, titulo, tipo, cliente_nome, valor_total, criado_em')
    .order('criado_em', { ascending: false })
    .limit(input.limite || 50);
  if (r.error) {
    if (/does not exist|não existe/i.test(r.error.message)) {
      return [];
    }
    throw new Error(r.error.message);
  }
  return r.data;
}
