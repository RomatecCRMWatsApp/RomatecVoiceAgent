// v1.99.5: motor de calculo de Desmembramento e Remembramento.
//
// Base normativa:
//   - Lei 6.766/1979 (Parcelamento do Solo Urbano) — desmembramento urbano
//   - Lei 4.504/1964 (Estatuto da Terra) — desmembramento rural
//   - Lei 6.015/1973 (Registros Publicos) — averbacao em matricula
//   - Codigo Civil arts. 1.297/1.298 — divisas e confrontantes
//
// Desmembramento: 1 matricula -> N lotes resultantes
//   Exige aprovacao da Prefeitura (zoneamento, lotes minimos, infraestrutura)
//   Cada lote vira nova matricula
//
// Remembramento: N matriculas -> 1 unica
//   Simplificado, geralmente nao exige aprovacao Prefeitura
//   Memorial unificado, cancela matriculas origem e abre uma so
//
// Honorarios (regra confirmada CEO):
//   Projeto      = 0.5 ou 1.0 SM (escolha do cliente — pacote basico vs completo)
//   Assessoria   = 1 SM (universal)
//
// Taxas de terceiros:
//   ART CREA-MA = R$ 93,40
//   Emolumentos cartorio (TJMA — averbacao por matricula afetada)
//   Aprovacao Prefeitura — so desmembramento, valor null = a confirmar

import type {
  InputDesmembramento,
  ResultadoCalculo,
  CustosCalculados,
  FontesConsulta,
  ItemCusto,
  DocumentoChecklist,
  CondicaoPagamento,
  BaseCalculo,
} from './types';
import { calcularEmolumentos } from '../tjma';
import { getParams, salarioMinimo, anotacaoTecnica } from './params';

// ── Pacote de servicos por subtipo (Secao 1) ────────────────────────────────
const ESCOPO_DESMEMBRAMENTO = [
  'Levantamento topografico do imovel matriz',
  'Projeto urbanistico do desmembramento (memorial + planta de cada lote resultante)',
  'Memoriais descritivos individualizados (um por lote)',
  'Coordenadas de cada vertice da poligonal de cada lote',
  'Submissao do projeto a Prefeitura para aprovacao (zoneamento, infraestrutura, lotes minimos)',
  'Acompanhamento da analise municipal ate o despacho aprovatorio',
  'Protocolo no cartorio competente para cancelamento da matricula matriz e abertura das novas matriculas',
  'Acompanhamento ate emissao das novas matriculas individualizadas',
];

const ESCOPO_REMEMBRAMENTO = [
  'Levantamento topografico das matriculas a serem unificadas',
  'Memorial descritivo unificado (poligonal resultante)',
  'Planta georreferenciada da nova area unificada',
  'Verificacao de divisas e confrontantes da area resultante',
  'Protocolo em cartorio para cancelamento das matriculas origem',
  'Abertura da nova matricula unica unificada',
  'Acompanhamento ate registro final',
];

export async function calcularDesmembramento(
  input: InputDesmembramento,
): Promise<ResultadoCalculo> {
  const params = getParams();
  const sm = salarioMinimo();
  const hp = params.honorarios_projeto;
  const isDesm = input.tipo === 'desmembramento';

  // v1.99.16: normalização opcional a partir de imoveis[] (modo detalhado do Remembramento)
  if (input.imoveis && input.imoveis.length > 0) {
    if (input.imoveis.length < 2) {
      throw new Error('Lista de imóveis exige pelo menos 2 entradas (remembramento une 2 ou mais matrículas)');
    }
    for (const i of input.imoveis) {
      if (!Number.isFinite(i.area_m2) || i.area_m2 <= 0) throw new Error(`Imóvel #${i.ordem}: área deve ser > 0`);
      if (!i.endereco?.trim()) throw new Error(`Imóvel #${i.ordem}: endereço obrigatório`);
      if (!i.matricula?.trim()) throw new Error(`Imóvel #${i.ordem}: matrícula obrigatória`);
      // v3.22.0: livro e folha — opcionais NO TIPO, mas se vierem strings explicitamente,
      // não podem ser vazias. UI sempre envia preenchido.
      if (i.livro !== undefined && !i.livro.trim()) {
        throw new Error(`Imóvel #${i.ordem}: livro não pode ser vazio`);
      }
      if (i.folha !== undefined && !i.folha.trim()) {
        throw new Error(`Imóvel #${i.ordem}: folha não pode ser vazia`);
      }
      // v3.22.0: CNS (se vier) deve seguir formato CNJ XX.XXX-X
      if (i.cri_cns && !/^\d{2}\.\d{3}-\d$/.test(i.cri_cns)) {
        throw new Error(`Imóvel #${i.ordem}: cri_cns deve seguir formato XX.XXX-X`);
      }
    }
    const areaSoma = input.imoveis.reduce((s, i) => s + Number(i.area_m2 || 0), 0);
    if (!input.area_total_m2 || input.area_total_m2 <= 0) {
      input.area_total_m2 = areaSoma;
    }
    if (!isDesm && (!input.numero_lotes_origem || input.numero_lotes_origem < 2)) {
      input.numero_lotes_origem = input.imoveis.length;
    }
  }

  // v3.22.0: validação status_documentacao (regra dos 30 dias para certidão de inteiro teor).
  // Quando o objeto é fornecido, CND e BCI viram obrigatórios e a certidão precisa estar
  // dentro do prazo de 30 dias desde a data de emissão.
  if (input.status_documentacao) {
    const sd = input.status_documentacao;
    if (!sd.cnd_iptu_anexada) {
      throw new Error('CND de IPTU é obrigatória (anexar antes de submeter)');
    }
    if (!sd.bci_anexado) {
      throw new Error('BCI do imóvel é obrigatório (anexar antes de submeter)');
    }
    if (!sd.certidao_inteiro_teor_data) {
      throw new Error('Data de emissão da certidão de inteiro teor é obrigatória');
    }
    // Strict ISO check (Date pode aceitar variações silenciosas tipo 2026-02-30 → mar 02)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sd.certidao_inteiro_teor_data)) {
      throw new Error('certidao_inteiro_teor_data inválida (use ISO YYYY-MM-DD)');
    }
    // UTC midnight para não depender do timezone do servidor (data-only no contrato)
    const emissao = new Date(sd.certidao_inteiro_teor_data + 'T00:00:00Z');
    if (Number.isNaN(emissao.getTime())) {
      throw new Error('certidao_inteiro_teor_data inválida (use ISO YYYY-MM-DD)');
    }
    const diffDias = (Date.now() - emissao.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDias > 30) {
      throw new Error(`Certidão de inteiro teor vencida (${Math.floor(diffDias)} dias desde a emissão; validade máxima: 30 dias)`);
    }
    // Tolerância de 1 dia para skew de relógio entre cliente e servidor
    if (diffDias < -1) {
      throw new Error(`certidao_inteiro_teor_data não pode ser futura (tolerância de ±1 dia para skew de relógio)`);
    }
  }

  // v1.99.16: validação de peças técnicas (ART ∨ TRT obrigatório)
  if (input.pecas_tecnicas) {
    if (!input.pecas_tecnicas.art && !input.pecas_tecnicas.trt) {
      throw new Error('Peça técnica: pelo menos ART (CREA) ou TRT (CFT) deve estar marcado');
    }
  }

  // v1.99.17: validação modalidade/unidade_area (rural→ha, urbana→m2)
  if (input.modalidade) {
    const unitDerived: 'ha' | 'm2' = input.modalidade === 'rural' ? 'ha' : 'm2';
    if (input.unidade_area && input.unidade_area !== unitDerived) {
      throw new Error(`Modalidade '${input.modalidade}' exige unidade '${unitDerived}', mas recebeu '${input.unidade_area}'`);
    }
  }

  // v1.99.17: validação de frações (lista de lotes resultantes do desmembramento/desdobro)
  if (input.fracoes && input.fracoes.length > 0) {
    if (input.fracoes.length < 2) {
      throw new Error('Mínimo de 2 frações (desmembramento/desdobro divide em pelo menos 2 partes)');
    }
    for (const f of input.fracoes) {
      if (!Number.isFinite(f.area) || f.area <= 0) {
        throw new Error(`Fração ${f.numero}: área deve ser > 0`);
      }
      if (!Number.isFinite(f.valor) || f.valor <= 0) {
        throw new Error(`Fração ${f.numero}: valor deve ser > 0`);
      }
    }
    // Validação soma das áreas ≤ matriz (com tolerância: 0.01 ha ou 1 m²)
    const somaAreas = input.fracoes.reduce((s, f) => s + Number(f.area || 0), 0);
    const unidade: 'ha' | 'm2' = input.unidade_area
      ?? (input.modalidade === 'rural' ? 'ha' : 'm2');
    const tolerancia = unidade === 'ha' ? 0.01 : 1;
    if (input.area_total_m2 && input.area_total_m2 > 0 && somaAreas > input.area_total_m2 + tolerancia) {
      throw new Error(`Soma das frações (${somaAreas.toFixed(4)}) excede a área da matriz (${input.area_total_m2}) em ${unidade}`);
    }
    // Deriva numero_lotes_resultantes se não vier (modo desmembramento)
    if (isDesm && (!input.numero_lotes_resultantes || input.numero_lotes_resultantes < 2)) {
      input.numero_lotes_resultantes = input.fracoes.length;
    }
  }

  // Validacoes
  if (!Number.isFinite(input.area_total_m2) || input.area_total_m2 <= 0) {
    throw new Error('area_total_m2 deve ser > 0');
  }
  if (!Number.isFinite(input.valor_venal_total) || input.valor_venal_total < 0) {
    throw new Error('valor_venal_total invalido');
  }
  if (isDesm && (!input.numero_lotes_resultantes || input.numero_lotes_resultantes < 2)) {
    throw new Error('Desmembramento exige numero_lotes_resultantes >= 2');
  }
  if (!isDesm && (!input.numero_lotes_origem || input.numero_lotes_origem < 2)) {
    throw new Error('Remembramento exige numero_lotes_origem >= 2');
  }

  const numeroMatriculasAfetadas = isDesm
    ? (input.numero_lotes_resultantes ?? 0) + 1 // matriz + N novas
    : (input.numero_lotes_origem ?? 0) + 1;     // N origem + 1 nova

  // ── Secao 1: escopo ──────────────────────────────────────────────────────
  const secao_1_projetos = isDesm ? [...ESCOPO_DESMEMBRAMENTO] : [...ESCOPO_REMEMBRAMENTO];

  // ── Secao 2: taxas e emolumentos de terceiros ───────────────────────────
  const secao_2_taxas: ItemCusto[] = [];
  const fontes: FontesConsulta = {};
  let ordem = 1;

  // 1. Anotacao tecnica
  const at = anotacaoTecnica('art_crea');
  secao_2_taxas.push({
    ordem: ordem++,
    descricao: at.rotulo,
    valor: at.valor,
    observacao: at.fonte,
  });

  // 2. Emolumentos cartorarios — averbacao em cada matricula afetada
  // Estima por matricula afetada usando faixa proporcional ao valor venal
  try {
    const valorPorMatricula = Math.max(input.valor_venal_total / numeroMatriculasAfetadas, 30000);
    const emol = await calcularEmolumentos('averbacao_construcao', valorPorMatricula);
    const totalEmol = emol.valor * numeroMatriculasAfetadas;
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: `Emolumentos cartorarios — ${numeroMatriculasAfetadas} matricula(s) afetada(s)${isDesm ? ' (cancelamento da matriz + abertura das novas)' : ' (cancelamento das origem + abertura da unificada)'}`,
      valor: totalEmol,
      observacao: `R$ ${emol.valor.toFixed(2)} × ${numeroMatriculasAfetadas} matriculas | ${emol.base_calculo}`,
    });
    fontes.tjma = { fonte: emol.fonte, consultadoEm: emol.consultadoEm.toISOString() };
  } catch (err) {
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Emolumentos cartorarios (cancelamento e abertura de matriculas)',
      valor: 0,
      pendente: true,
      observacao: `A confirmar em cartorio. ${(err as Error).message}`,
    });
  }

  // 3. Aprovacao Prefeitura — so desmembramento e em zona urbana
  if (isDesm && input.tipo_zona === 'urbana') {
    const taxaPref = params.prefeitura_acailandia.aprovacao_desmembramento;
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Taxa de Aprovacao do Desmembramento — Prefeitura de Acailandia',
      valor: taxaPref ?? 0,
      pendente: taxaPref === null,
      observacao: taxaPref === null
        ? 'A confirmar com a Secretaria de Obras/Planejamento da Prefeitura. Costuma ser proporcional ao numero de lotes ou area total.'
        : `Conforme taxa vigente em Acailandia/MA`,
    });
  }

  // ── Secao 3: honorarios Romatec ─────────────────────────────────────────
  // v1.99.16: dois modos:
  //   'auto'   → engine paramétrica (SM × fator × num matrículas + assessoria 1 SM)
  //   'manual' → lista livre de Mapas + Assessoria Jurídica opcional (definidos pelo CEO)
  const isManual = input.modo_calculo === 'manual';

  // Valores do modo auto (sempre calculados — usados em base_calculo mesmo no manual pra referencia)
  const fatorSM = input.honorario_projeto_sm; // 0.5 ou 1.0
  const numeroLotes = isDesm ? (input.numero_lotes_resultantes ?? 0) : (input.numero_lotes_origem ?? 0);
  const honorario_projeto = sm * fatorSM * numeroLotes;
  const honorario_assessoria = sm * params.honorarios_assessoria.padrao_sm;
  const obsHonProjeto = `${fatorSM} SM × ${numeroLotes} lote(s) ${isDesm ? 'resultante(s)' : 'origem'} = R$ ${honorario_projeto.toFixed(2)} (1 SM = R$ ${sm.toFixed(2)})`;

  let secao_3_honorarios: ItemCusto[];

  if (isManual) {
    // v1.99.17: modo manual aceita mapas[] (remembramento) OU fracoes[] (desmembramento/desdobro)
    const hasMapas = input.mapas && input.mapas.length > 0;
    const hasFracoes = input.fracoes && input.fracoes.length > 0;
    if (!hasMapas && !hasFracoes) {
      throw new Error('Modo manual exige pelo menos 1 mapa (remembramento) OU 1 fração (desmembramento/desdobro)');
    }
    if (hasMapas) {
      for (const m of input.mapas!) {
        if (!Number.isFinite(m.valor) || m.valor <= 0) {
          throw new Error(`Mapa ${m.numero}: valor deve ser > 0`);
        }
      }
      secao_3_honorarios = input.mapas!.map(m => ({
        ordem: ordem++,
        descricao: m.descricao
          ? `Mapa ${String(m.numero).padStart(2, '0')} — ${m.descricao}`
          : `Mapa ${String(m.numero).padStart(2, '0')}`,
        valor: m.valor,
      }));
    } else {
      // fracoes[] — cada fração vira um ItemCusto com área incluída na descrição
      const unidade: 'ha' | 'm2' = input.unidade_area
        ?? (input.modalidade === 'rural' ? 'ha' : 'm2');
      const unidadeLabel = unidade === 'ha' ? 'ha' : 'm²';
      secao_3_honorarios = input.fracoes!.map(f => ({
        ordem: ordem++,
        descricao: `Fração ${String(f.numero).padStart(2, '0')} — ${Number(f.area).toLocaleString('pt-BR', { minimumFractionDigits: unidade === 'ha' ? 4 : 2, maximumFractionDigits: unidade === 'ha' ? 4 : 2 })} ${unidadeLabel}${f.descricao ? ' · ' + f.descricao : ''}`,
        valor: f.valor,
      }));
    }
    if (input.assessoria_juridica?.incluir) {
      const valorAss = input.assessoria_juridica.valor;
      if (!Number.isFinite(valorAss) || (valorAss as number) <= 0) {
        throw new Error('Assessoria Técnica Jurídica habilitada exige valor > 0');
      }
      secao_3_honorarios.push({
        ordem: ordem++,
        descricao: 'Assessoria Técnica Jurídica',
        valor: valorAss as number,
      });
    }
  } else {
    // Modo auto (default — preserva comportamento original)
    secao_3_honorarios = [
      {
        ordem: ordem++,
        descricao: isDesm
          ? 'Honorarios de Projeto Urbanistico de Desmembramento — levantamento topografico, projeto, memorial descritivo de cada lote, planta, ARTs e responsabilidade tecnica'
          : 'Honorarios de Projeto de Remembramento — levantamento topografico das matriculas, memorial unificado, planta resultante, ARTs e responsabilidade tecnica',
        valor: honorario_projeto,
        observacao: obsHonProjeto,
      },
      {
        ordem: ordem++,
        descricao: 'Honorarios de Assessoria e Acompanhamento — diligencias na Prefeitura (se aplicavel), protocolo em cartorio, acompanhamento ate emissao das matriculas finais',
        valor: honorario_assessoria,
        observacao: `1 salario minimo 2026 (R$ ${sm.toFixed(2)})`,
      },
    ];
  }

  // v3.23.0: modo_precificacao substitui o pacote SM quando presente.
  // Reescreve secao_3_honorarios do zero (ignora o que foi montado no isManual/auto acima).
  if (input.modo_precificacao) {
    secao_3_honorarios = [];
    let ordemHon = 1;

    if (input.modo_precificacao === 'por_imovel') {
      const valorUnit = Number(input.valor_por_imovel ?? 0);
      if (!Number.isFinite(valorUnit) || valorUnit <= 0) {
        throw new Error('valor_por_imovel deve ser > 0 quando modo_precificacao=por_imovel');
      }
      const qtd = input.imoveis?.length
        ?? input.numero_lotes_origem
        ?? input.numero_lotes_resultantes
        ?? 0;
      if (qtd < 2) {
        throw new Error('Modo por_imovel exige pelo menos 2 imóveis/lotes');
      }
      secao_3_honorarios.push({
        ordem: ordemHon++,
        descricao: `Honorários técnicos — ${qtd} imóvel(eis) × R$ ${valorUnit.toFixed(2)} por imóvel`,
        valor: valorUnit * qtd,
        observacao: 'Precificação por imóvel (modo padrão v3.23.0)',
      });
    } else if (input.modo_precificacao === 'por_lote') {
      const lista = input.valores_por_lote ?? [];
      if (lista.length === 0) {
        throw new Error('valores_por_lote vazio ou ausente quando modo_precificacao=por_lote');
      }
      for (const item of lista) {
        if (!Number.isFinite(item.valor) || item.valor <= 0) {
          throw new Error(`valores_por_lote[${item.ordem}]: valor deve ser > 0`);
        }
        secao_3_honorarios.push({
          ordem: ordemHon++,
          descricao: item.descricao
            ? `Lote ${String(item.ordem).padStart(2, '0')} — ${item.descricao}`
            : `Lote ${String(item.ordem).padStart(2, '0')}`,
          valor: item.valor,
        });
      }
    } else if (input.modo_precificacao === 'personalizado') {
      const hp = input.honorarios_personalizados;
      if (!hp || !Number.isFinite(hp.valor_total) || hp.valor_total <= 0) {
        throw new Error('honorarios_personalizados.valor_total deve ser > 0');
      }
      if (!hp.descritivo?.trim()) {
        throw new Error('honorarios_personalizados.descritivo é obrigatório');
      }
      secao_3_honorarios.push({
        ordem: ordemHon++,
        descricao: 'Honorários técnicos — pacote fechado',
        valor: hp.valor_total,
        observacao: hp.descritivo,
      });
    }
  }

  // v3.22.0: Assessoria Técnica — habilitada por toggle (substitui assessoria_juridica em remembramento v2).
  // Vira linha em secao_3_honorarios e entra automaticamente no secao_5_total via a soma existente.
  if (input.assessoria_tecnica?.habilitada) {
    const valorAT = Number(input.assessoria_tecnica.valor ?? 0);
    if (!Number.isFinite(valorAT) || valorAT < 0) {
      throw new Error('assessoria_tecnica.valor inválido');
    }
    secao_3_honorarios.push({
      ordem: ordem++,
      descricao: 'Assessoria Técnica',
      valor: valorAT,
      observacao: 'Acompanhamento técnico junto ao cartório e prefeitura (contratação opcional)',
    });
  }

  // ── Secao 4: checklist documentos ───────────────────────────────────────
  const secao_4_checklist: DocumentoChecklist[] = [
    {
      texto: isDesm
        ? 'Certidao de Inteiro Teor da Matricula MATRIZ — ATUALIZADA (max. 30 dias)'
        : `Certidoes de Inteiro Teor das ${input.numero_lotes_origem ?? 'todas as'} matriculas a unificar — ATUALIZADAS (max. 30 dias)`,
      obrigatorio: true,
    },
    {
      texto: 'IPTU em dia (todos os exercicios) — comprovantes',
      obrigatorio: true,
      imprescindivel: true, // destaque vermelho — Prefeitura recusa sem isso
    },
    { texto: 'RG/CPF de todos os proprietarios (e conjuges, se for o caso)', obrigatorio: true },
    { texto: 'Comprovante de residencia atualizado dos proprietarios', obrigatorio: true },
    { texto: 'Anuencia de confrontantes (assinaturas dos vizinhos na planta da nova divisao)', obrigatorio: true, imprescindivel: isDesm },
  ];

  if (isDesm) {
    secao_4_checklist.push(
      { texto: 'Certidao de zoneamento da Prefeitura (constando ZONA permitida pra parcelamento)', obrigatorio: true },
      { texto: 'Certidao de viabilidade urbanistica (se exigido pelo municipio)', obrigatorio: false },
    );
  }

  secao_4_checklist.push(
    { texto: 'CCIR + ITR em dia (se imovel rural)', obrigatorio: input.tipo_zona === 'rural' },
    { texto: 'CAR (Cadastro Ambiental Rural) — se imovel rural', obrigatorio: input.tipo_zona === 'rural' },
    { texto: 'Eventuais onus, hipotecas ou usufrutos averbados (declaracao)', obrigatorio: false },
  );

  // ── Secao 5: total ──────────────────────────────────────────────────────
  const total_taxas = secao_2_taxas.reduce((s, i) => s + i.valor, 0);
  const total_honorarios = secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
  const secao_5_total = total_taxas + total_honorarios;

  // ── Avisos legais ───────────────────────────────────────────────────────
  const avisos: string[] = [];

  if (isDesm) {
    avisos.push(
      'BASE LEGAL DESMEMBRAMENTO: Lei 6.766/1979 (Parcelamento do Solo Urbano) — exige aprovacao previa da Prefeitura, lotes minimos conforme zoneamento (geralmente 125m² em zona urbana de Acailandia), e infraestrutura compativel. Cada lote resultante vira matricula propria no cartorio.'
    );
    avisos.push(
      'PRAZO ESTIMADO: levantamento (5-10 dias), projeto e memoriais (5-10 dias), analise Prefeitura (30-90 dias), protocolo cartorio (15-30 dias). Total tipico: 60-150 dias.'
    );
  } else {
    avisos.push(
      'BASE LEGAL REMEMBRAMENTO: Lei 6.015/1973 (Registros Publicos) art. 234 — unificacao de matriculas contiguas pertencentes ao mesmo proprietario. Mais simples que desmembramento, geralmente sem analise municipal.'
    );
    avisos.push(
      'IMPORTANTE: as matriculas a unificar devem (1) ser CONTIGUAS, (2) pertencer ao MESMO proprietario, (3) estar livres de onus reais ou ter anuencia dos credores. Verificacao previa obrigatoria.'
    );
    avisos.push(
      'PRAZO ESTIMADO: levantamento (3-7 dias), memorial unificado (3-5 dias), protocolo cartorio (15-30 dias). Total tipico: 30-60 dias.'
    );
  }

  if (!input.iptu_em_dia) {
    avisos.push(
      'ATENCAO IPTU: o IPTU em dia e PRE-REQUISITO ABSOLUTO. Sem comprovacao de quitacao do exercicio atual e dos 5 anteriores, a Prefeitura e o cartorio recusam a operacao. Regularize antes do protocolo.'
    );
  }

  avisos.push(
    'IMPORTANTE: Os valores das taxas de Cartorio e Prefeitura sao APROXIMADOS, baseados em estimativas. Os valores definitivos podem variar conforme apuracao no momento do protocolo.'
  );

  if (input.tipo_zona === 'urbana') {
    avisos.push(
      'SENHA GOV.BR: o sistema da Receita Federal pode exigir consultas tributarias durante o tramite. A Romatec orienta o cliente a manter conta gov.br nivel prata/ouro ativa pra eventual emissao de certidoes negativas.'
    );
  }

  const itensPendentes = secao_2_taxas.filter(i => i.pendente).map(i => i.descricao);
  if (itensPendentes.length > 0) {
    avisos.push(`Itens pendentes de confirmacao: ${itensPendentes.join(', ')}.`);
    fontes.prefeitura = { itens_pendentes: itensPendentes };
  }

  // ── Condicoes de pagamento ──────────────────────────────────────────────
  // Desm: 50% Projeto + 50% Assessoria na assinatura | restante na aprovacao Prefeitura
  // Rem: 100% Projeto + 50% Assessoria na assinatura | 50% Assessoria no protocolo cartorio
  // v1.99.16: Modo manual — forma de pagamento a combinar entre as partes
  let condicoes_pagamento: CondicaoPagamento[];
  // v3.23.0: modo_precificacao=personalizado também usa "A combinar"
  if (isManual || input.modo_precificacao === 'personalizado') {
    const totalManual = secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    condicoes_pagamento = [{
      rotulo: 'A combinar entre as partes',
      descricao: 'Forma e cronograma de pagamento dos honorários a serem definidos em comum acordo entre Contratante e Contratado, registrados em recibo próprio.',
      valor: totalManual,
    }];
  } else if (isDesm) {
    condicoes_pagamento = [
      {
        rotulo: '1a parcela — na assinatura da proposta',
        descricao: '50% dos Honorarios de Projeto + 50% dos Honorarios de Assessoria',
        valor: honorario_projeto * 0.5 + honorario_assessoria * 0.5,
      },
      {
        rotulo: '2a parcela — na aprovacao do desmembramento pela Prefeitura',
        descricao: '50% restante dos Honorarios de Projeto',
        valor: honorario_projeto * 0.5,
      },
      {
        rotulo: '3a parcela — no protocolo final em cartorio',
        descricao: '50% restante dos Honorarios de Assessoria',
        valor: honorario_assessoria * 0.5,
      },
    ];
  } else {
    condicoes_pagamento = [
      {
        rotulo: '1a parcela — na assinatura da proposta',
        descricao: '100% dos Honorarios de Projeto + 50% dos Honorarios de Assessoria',
        valor: honorario_projeto + honorario_assessoria * 0.5,
      },
      {
        rotulo: '2a parcela — no protocolo em cartorio',
        descricao: '50% restante dos Honorarios de Assessoria',
        valor: honorario_assessoria * 0.5,
      },
    ];
  }

  // ── Base de calculo ─────────────────────────────────────────────────────
  // v1.99.16: em modo manual, a base de cálculo reflete a soma dos mapas/frações + assessoria
  // v1.99.17: também aceita fracoes[] como alternativa a mapas[]
  const itensManual: BaseCalculo[] = (input.fracoes ?? []).length > 0
    ? input.fracoes!.map(f => ({
        rotulo: `Fração ${String(f.numero).padStart(2, '0')}${f.descricao ? ' — ' + f.descricao : ''}`,
        formula: 'Honorário definido pelo Contratado',
        valor_resultado: f.valor,
      }))
    : (input.mapas ?? []).map(m => ({
        rotulo: `Mapa ${String(m.numero).padStart(2, '0')}${m.descricao ? ' — ' + m.descricao : ''}`,
        formula: 'Honorário definido pelo Contratado',
        valor_resultado: m.valor,
      }));
  // v3.22.0: assessoria_tecnica (Remembramento v2) aparece em base_calculo nos dois modos.
  const linhaAssessoriaTecnica: BaseCalculo[] = input.assessoria_tecnica?.habilitada
    ? [{
        rotulo: 'Assessoria Técnica',
        formula: 'Honorário definido pelo Contratado (opcional)',
        valor_resultado: Number(input.assessoria_tecnica.valor ?? 0),
      }]
    : [];

  const base_calculo: BaseCalculo[] = isManual
    ? [
        ...itensManual,
        ...(input.assessoria_juridica?.incluir && input.assessoria_juridica.valor
          ? [{
              rotulo: 'Assessoria Técnica Jurídica',
              formula: 'Honorário definido pelo Contratado',
              valor_resultado: input.assessoria_juridica.valor,
            }]
          : []),
        ...linhaAssessoriaTecnica,
        {
          rotulo: 'Total Romatec',
          formula: ((input.fracoes ?? []).length > 0 ? 'Soma das Frações' : 'Soma dos Mapas')
            + (input.assessoria_juridica?.incluir ? ' + Assessoria Jurídica' : '')
            + (input.assessoria_tecnica?.habilitada ? ' + Assessoria Técnica' : ''),
          valor_resultado: secao_3_honorarios.reduce((s, i) => s + i.valor, 0),
        },
      ]
    : [
        {
          rotulo: 'Honorarios de Projeto',
          formula: `${fatorSM} SM × ${numeroLotes} ${isDesm ? 'lote(s) resultante(s)' : 'matricula(s) origem'} × R$ ${sm.toFixed(2)}`,
          valor_resultado: honorario_projeto,
        },
        {
          rotulo: 'Honorarios de Assessoria',
          formula: `1 SM × R$ ${sm.toFixed(2)}`,
          valor_resultado: honorario_assessoria,
        },
        ...linhaAssessoriaTecnica,
        {
          rotulo: 'Total Romatec',
          formula: 'Projeto + Assessoria'
            + (input.assessoria_tecnica?.habilitada ? ' + Assessoria Técnica' : ''),
          valor_resultado: secao_3_honorarios.reduce((s, i) => s + i.valor, 0),
        },
      ];

  // v3.23.0: despesas administrativas — seção separada, NÃO soma ao secao_5_total.
  const despesasAdm = (input.despesas_administrativas?.habilitada)
    ? (() => {
        const valor = Number(input.despesas_administrativas?.valor ?? 0);
        const descritivo = (input.despesas_administrativas?.descritivo ?? '').trim();
        if (!Number.isFinite(valor) || valor < 0) {
          throw new Error('despesas_administrativas.valor inválido');
        }
        if (!descritivo) {
          throw new Error('despesas_administrativas.descritivo obrigatório quando habilitada=true');
        }
        return { valor, descritivo };
      })()
    : undefined;

  const custos: CustosCalculados = {
    secao_1_projetos,
    secao_2_taxas,
    secao_3_honorarios,
    condicoes_pagamento,
    base_calculo,
    secao_4_checklist,
    secao_5_total,
    avisos,
    ...(despesasAdm ? { despesas_administrativas: despesasAdm } : {}),
  };

  return { custos, fontes };
}
