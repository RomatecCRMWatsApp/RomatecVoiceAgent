// v3.126.0 — Prontuário do Escritório (Multi-Serviços).
//
// Cobre o que a spec do módulo trata como contrato:
//   1. geração automática das etapas por categoria/sub-tipo (os 5 roteiros);
//   2. checklist de documentos por etapa;
//   3. regras de atualização de status de etapa e de documento;
//   4. progresso do prontuário;
//   5. wire-up na fonte (migration, repo transacional, rotas, tela, aba).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CATEGORIAS,
  etapasDoTemplate,
  listarCategorias,
  obterCategoria,
  obterSubTipo,
  rotuloServico,
  calcularProgresso,
  normalizarAtualizacaoEtapa,
  formatarNumeroProntuario,
  ehStatusEtapa,
  ehStatusDocumento,
  type StatusEtapa,
} from '../services/prontuario/prontuarioTemplates';

const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');
const nomes = (categoria: string, sub?: string) => etapasDoTemplate(categoria, sub).map((e) => e.nome);

describe('Templates de etapas por categoria (v3.126.0)', () => {
  it('CAT 1 — Projetos: 9 etapas, na ordem do roteiro, para os dois sub-tipos', () => {
    const esperado = [
      'Contratação & Briefing',
      'Estudo Preliminar / Anteprojeto',
      'Projeto Arquitetônico',
      'Projeto Elétrico',
      'Projeto Hidráulico',
      'Projeto Sanitário',
      'Compatibilização & Aprovativo Municipal',
      'Emissão de ART/RRT',
      'Conclusão & Entrega do Pacote Executivo',
    ];
    expect(nomes('projetos', 'arquitetonico_completo')).toEqual(esperado);
    // Sub-tipo sem roteiro próprio herda o da categoria.
    expect(nomes('projetos', 'complementares')).toEqual(esperado);
    expect(nomes('projetos')).toEqual(esperado);
  });

  it('CAT 2 — Topografia & Regularização Urbana: 9 etapas para os 5 sub-tipos', () => {
    const subs = ['desmembramento', 'remembramento', 'retificacao_area', 'usucapiao_urbana', 'reurb'];
    for (const s of subs) {
      const etapas = etapasDoTemplate('topografia_urbana', s);
      expect(etapas, `sub-tipo ${s}`).toHaveLength(9);
      expect(etapas[0].nome).toBe('Levantamento Topográfico de Campo');
      expect(etapas[2].nome).toBe('Memorial Descritivo');
      expect(etapas[7].nome).toBe('Protocolo e Acompanhamento no Cartório (RI)');
      expect(etapas[8].nome).toBe('Emissão da Matrícula/Certidão & Entrega Final');
    }
  });

  it('CAT 3 — Agrimensura Rural: 9 etapas com SIGEF/INCRA e dossiê final', () => {
    const etapas = etapasDoTemplate('agrimensura_rural', 'geosimples');
    expect(etapas).toHaveLength(9);
    expect(etapas[0].nome).toBe('Levantamento de Campo GNSS/RTK & Rastreio');
    expect(etapas[1].nome).toContain('SIRGAS 2000');
    expect(etapas[5].nome).toBe('Certificação e Envio ao SIGEF/INCRA');
    expect(etapas[6].nome).toBe('Protocolo no Cartório (CRI)');
    expect(etapas[8].nome).toBe('Entrega do Dossiê do Imóvel Rural');
    // Todos os sub-tipos rurais compartilham o roteiro.
    for (const s of ['desmembramento_rural', 'remembramento_rural', 'retificacao_rural']) {
      expect(etapasDoTemplate('agrimensura_rural', s)).toHaveLength(9);
    }
  });

  it('CAT 4 — Assessoria Registral: cada sub-tipo tem roteiro PRÓPRIO (6 e 5 etapas)', () => {
    const registro = nomes('assessoria_registral', 'registro_transferencia');
    expect(registro).toEqual([
      'Análise da Documentação',
      'Emissão de Certidões Negativas e Matrícula Atualizada',
      'Cálculo e Encaminhamento de Impostos (ITBI/ITCMD)',
      'Agendamento e Coleta de Assinaturas da Escritura Pública',
      'Protocolo de Registro no Cartório',
      'Retirada da Matrícula Registrada & Entrega',
    ]);
    const contratos = nomes('assessoria_registral', 'contratos');
    expect(contratos).toEqual([
      'Coleta de Dados das Partes e Objeto',
      'Minuta para Revisão',
      'Redação Final e Ajustes',
      'Coleta de Assinaturas (física/digital) e Reconhecimento de Firma',
      'Entrega das Vias Assinadas',
    ]);
    // O roteiro do sub-tipo VENCE o da categoria.
    expect(registro).not.toEqual(contratos);
  });

  it('CAT 5 — Avaliações: 7 etapas, da vistoria à assinatura do RT', () => {
    const etapas = etapasDoTemplate('avaliacoes', 'laudo_avaliacao');
    expect(etapas).toHaveLength(7);
    expect(etapas[0].nome).toBe('Vistoria Presencial & Relatório Fotográfico');
    expect(etapas[3].nome).toBe('Tratamento Estatístico e Cálculo do Valor');
    expect(etapas[5].nome).toBe('Emissão da ART/RRT');
    expect(etapas[6].nome).toBe('Assinatura do RT & Entrega');
    expect(etapasDoTemplate('avaliacoes', 'parecer_mercadologico')).toHaveLength(7);
  });

  it('ordem é 1..N contígua em TODO template do catálogo', () => {
    for (const cat of CATEGORIAS) {
      for (const sub of cat.subTipos) {
        const etapas = etapasDoTemplate(cat.chave, sub.chave);
        expect(etapas.length, `${cat.chave}/${sub.chave}`).toBeGreaterThan(0);
        expect(etapas.map((e) => e.ordem)).toEqual(etapas.map((_, i) => i + 1));
        expect(etapas.every((e) => e.nome.trim().length > 0)).toBe(true);
      }
    }
  });

  it('categoria ou sub-tipo desconhecido → [] (a rota transforma em 400)', () => {
    expect(etapasDoTemplate('nao_existe')).toEqual([]);
    expect(etapasDoTemplate('nao_existe', 'seja_o_que_for')).toEqual([]);
    // Sub-tipo inexistente numa categoria válida cai no roteiro da categoria.
    expect(etapasDoTemplate('avaliacoes', 'inventado')).toHaveLength(7);
    expect(obterCategoria('nao_existe')).toBeNull();
    expect(obterSubTipo('avaliacoes', 'inventado')).toBeNull();
  });
});

describe('Checklist de documentos por etapa (v3.126.0)', () => {
  it('Avaliação: "Coleta da Documentação Obrigatória" traz os 4 documentos da spec', () => {
    const etapa = etapasDoTemplate('avaliacoes', 'laudo_avaliacao')[1];
    expect(etapa.nome).toBe('Coleta da Documentação Obrigatória');
    const docs = (etapa.checklist_documentos ?? []).map((d) => d.doc);
    expect(docs).toHaveLength(4);
    expect(docs.join(' | ')).toContain('Certidão de Matrícula');
    expect(docs.join(' | ')).toContain('CND de IPTU');
    expect(docs.join(' | ')).toContain('Extrato BCI');
    expect(docs.join(' | ')).toContain('RG/CPF');
  });

  it('Rural: "Atualização do CCIR/ITR/CAR" vira checklist de 3 documentos', () => {
    const etapa = etapasDoTemplate('agrimensura_rural', 'geosimples')[7];
    expect(etapa.nome).toBe('Atualização do CCIR/ITR/CAR');
    expect((etapa.checklist_documentos ?? []).map((d) => d.doc)).toEqual([
      'CCIR atualizado', 'ITR do exercício', 'CAR (Cadastro Ambiental Rural)',
    ]);
  });

  it('etapa sem checklist não carrega a chave (front decide se renderiza o bloco)', () => {
    const etapas = etapasDoTemplate('projetos', 'arquitetonico_completo');
    expect(etapas.every((e) => e.checklist_documentos === undefined)).toBe(true);
  });

  it('template devolve CÓPIA dos documentos — mexer no retorno não corrompe o catálogo', () => {
    const a = etapasDoTemplate('avaliacoes', 'laudo_avaliacao')[1];
    a.checklist_documentos![0].doc = 'ADULTERADO';
    const b = etapasDoTemplate('avaliacoes', 'laudo_avaliacao')[1];
    expect(b.checklist_documentos![0].doc).toBe('Certidão de Matrícula Atualizada');
  });
});

describe('Catálogo exposto para a tela (v3.126.0)', () => {
  it('listarCategorias devolve as 5 categorias com sub-tipos e total de etapas', () => {
    const cats = listarCategorias();
    expect(cats.map((c) => c.chave)).toEqual([
      'projetos', 'topografia_urbana', 'agrimensura_rural', 'assessoria_registral', 'avaliacoes',
    ]);
    const registral = cats.find((c) => c.chave === 'assessoria_registral')!;
    expect(registral.subTipos.find((s) => s.chave === 'registro_transferencia')!.total_etapas).toBe(6);
    expect(registral.subTipos.find((s) => s.chave === 'contratos')!.total_etapas).toBe(5);
    expect(cats.find((c) => c.chave === 'avaliacoes')!.subTipos[0].total_etapas).toBe(7);
  });

  it('rotuloServico monta o nome legível do serviço contratado', () => {
    expect(rotuloServico('avaliacoes', 'laudo_avaliacao'))
      .toBe('Avaliações Imobiliárias — Laudo de Avaliação Mercadológica');
    expect(rotuloServico('projetos')).toBe('Projetos de Arquitetura & Engenharia');
    expect(rotuloServico('nao_existe')).toBe('nao_existe');
  });

  it('chaves são ASCII estáveis (viram valor de coluna no MySQL)', () => {
    for (const c of CATEGORIAS) {
      expect(c.chave).toMatch(/^[a-z0-9_]+$/);
      for (const s of c.subTipos) expect(s.chave).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe('Progresso do prontuário (v3.126.0)', () => {
  const et = (...s: StatusEtapa[]) => s.map((status) => ({ status }));

  it('percentual conta só etapas concluídas', () => {
    expect(calcularProgresso(et('concluido', 'concluido', 'pendente', 'pendente')))
      .toEqual({ total: 4, concluidas: 2, em_andamento: 0, pendentes: 2, percentual: 50 });
  });

  it('etapa em andamento não vale meio ponto, mas sai da conta de pendentes', () => {
    expect(calcularProgresso(et('concluido', 'em_andamento', 'pendente')))
      .toEqual({ total: 3, concluidas: 1, em_andamento: 1, pendentes: 1, percentual: 33 });
  });

  it('tudo concluído = 100%; prontuário sem etapas = 0% (sem divisão por zero)', () => {
    expect(calcularProgresso(et('concluido', 'concluido')).percentual).toBe(100);
    expect(calcularProgresso([])).toEqual({ total: 0, concluidas: 0, em_andamento: 0, pendentes: 0, percentual: 0 });
  });

  it('roteiro de 9 etapas com 1 concluída arredonda para 11%', () => {
    expect(calcularProgresso(et('concluido', ...Array(8).fill('pendente') as StatusEtapa[])).percentual).toBe(11);
  });
});

describe('Atualização de status de etapa (v3.126.0)', () => {
  const HOJE = '2026-07-23';

  it('concluir sem informar data carimba hoje', () => {
    expect(normalizarAtualizacaoEtapa({ status: 'concluido' }, HOJE))
      .toEqual({ status: 'concluido', data_conclusao: HOJE });
  });

  it('concluir informando data respeita a data informada (lançamento retroativo)', () => {
    expect(normalizarAtualizacaoEtapa({ status: 'concluido', data_conclusao: '2026-07-20' }, HOJE))
      .toEqual({ status: 'concluido', data_conclusao: '2026-07-20' });
    // Data com hora junto (ISO completo) é truncada para YYYY-MM-DD.
    expect(normalizarAtualizacaoEtapa({ status: 'concluido', data_conclusao: '2026-07-20T14:00:00Z' }, HOJE).data_conclusao)
      .toBe('2026-07-20');
  });

  it('data inválida ao concluir cai no fallback de hoje (não grava lixo)', () => {
    expect(normalizarAtualizacaoEtapa({ status: 'concluido', data_conclusao: 'ontem' }, HOJE).data_conclusao).toBe(HOJE);
  });

  it('reabrir etapa limpa a data de conclusão', () => {
    expect(normalizarAtualizacaoEtapa({ status: 'pendente' }, HOJE))
      .toEqual({ status: 'pendente', data_conclusao: null });
    expect(normalizarAtualizacaoEtapa({ status: 'em_andamento' }, HOJE))
      .toEqual({ status: 'em_andamento', data_conclusao: null });
  });

  it('campo ausente = não mexe (undefined nunca vira null no UPDATE)', () => {
    expect(normalizarAtualizacaoEtapa({ responsavel: 'Romário' }, HOJE)).toEqual({ responsavel: 'Romário' });
    expect(normalizarAtualizacaoEtapa({}, HOJE)).toEqual({});
  });

  it('responsável/observações vazios viram null; responsável é truncado em 255', () => {
    expect(normalizarAtualizacaoEtapa({ responsavel: '   ' }, HOJE)).toEqual({ responsavel: null });
    expect(normalizarAtualizacaoEtapa({ observacoes: '' }, HOJE)).toEqual({ observacoes: null });
    const r = normalizarAtualizacaoEtapa({ responsavel: 'x'.repeat(400) }, HOJE).responsavel!;
    expect(r).toHaveLength(255);
  });

  it('status inválido explode com mensagem acionável (a rota devolve 400)', () => {
    expect(() => normalizarAtualizacaoEtapa({ status: 'feito' }, HOJE)).toThrow(/Status inválido/);
    expect(() => normalizarAtualizacaoEtapa({ status: 42 }, HOJE)).toThrow(/Status inválido/);
  });

  it('ajuste de data sem mexer no status é permitido (correção de lançamento)', () => {
    expect(normalizarAtualizacaoEtapa({ data_conclusao: '2026-01-05' }, HOJE))
      .toEqual({ data_conclusao: '2026-01-05' });
  });

  it('guardas de tipo de status', () => {
    expect(ehStatusEtapa('concluido')).toBe(true);
    expect(ehStatusEtapa('ok')).toBe(false);
    expect(ehStatusDocumento('ok')).toBe(true);
    expect(ehStatusDocumento('pendente')).toBe(true);
    expect(ehStatusDocumento('concluido')).toBe(false);
  });
});

describe('Número do prontuário (v3.126.0)', () => {
  it('formata PRN-AAAA-NNN com 3 dígitos', () => {
    expect(formatarNumeroProntuario(15, 2026)).toBe('PRN-2026-015');
    expect(formatarNumeroProntuario(1, 2026)).toBe('PRN-2026-001');
  });
  it('id acima de 999 não é truncado (padStart só completa)', () => {
    expect(formatarNumeroProntuario(1234, 2027)).toBe('PRN-2027-1234');
  });
});

describe('Wire-up do módulo na fonte (v3.126.0)', () => {
  const MIG = read('database', 'migrations-prontuario.ts');
  const REPO = read('services', 'prontuario', 'prontuarioRepo.ts');
  const ROUTER = read('routes', 'prontuario.ts');
  const SERVER = read('server.ts');
  const OBRAS = read('public', 'obras.html');
  const PAGE = read('public', 'prontuario.html');

  it('migration cria as 3 tabelas, é idempotente e cascateia etapas/documentos', () => {
    ['prontuarios', 'prontuario_etapas', 'prontuario_etapa_documentos'].forEach((t) => {
      expect(MIG).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    });
    expect(MIG).toMatch(/ER_TABLE_EXISTS_ERROR/);
    expect(MIG).toMatch(/REFERENCES prontuarios\(id\) ON DELETE CASCADE/);
    expect(MIG).toMatch(/REFERENCES prontuario_etapas\(id\) ON DELETE CASCADE/);
    expect(MIG).toMatch(/UNIQUE KEY uq_prontuario_numero/);
    // obra_id fica SEM FK cross-módulo (convenção do repo).
    expect(MIG).not.toMatch(/REFERENCES romatec_obras/);
  });

  it('criação do prontuário roda em transação (cabeçalho + etapas ou nada)', () => {
    expect(REPO).toMatch(/beginTransaction/);
    expect(REPO).toMatch(/commit\(\)/);
    expect(REPO).toMatch(/rollback\(\)/);
    expect(REPO).toMatch(/conn\.release\(\)/);
    expect(REPO).toMatch(/etapasDoTemplate/);
    expect(REPO).toMatch(/formatarNumeroProntuario/);
    expect(REPO).toMatch(/class TemplateDesconhecidoError/);
  });

  it('rotas cobrem CRUD, etapa e checklist — com /templates antes de /:id', () => {
    expect(ROUTER).toMatch(/router\.get\('\/templates'/);
    expect(ROUTER).toMatch(/router\.get\('\/',/);
    expect(ROUTER).toMatch(/router\.post\('\/',/);
    expect(ROUTER).toMatch(/router\.get\('\/:id'/);
    expect(ROUTER).toMatch(/router\.put\('\/:id'/);
    expect(ROUTER).toMatch(/router\.delete\('\/:id'/);
    expect(ROUTER).toMatch(/router\.put\('\/etapas\/:etapaId'/);
    expect(ROUTER).toMatch(/router\.post\('\/etapas\/:etapaId\/documentos'/);
    expect(ROUTER).toMatch(/router\.put\('\/documentos\/:docId'/);
    // Ordem: rotas específicas antes da curinga /:id, senão "templates" vira id.
    expect(ROUTER.indexOf("router.get('/templates'")).toBeLessThan(ROUTER.indexOf("router.get('/:id'"));
    expect(ROUTER.indexOf("router.put('/etapas/:etapaId'")).toBeLessThan(ROUTER.indexOf("router.put('/:id'"));
    expect(ROUTER.indexOf("router.put('/documentos/:docId'")).toBeLessThan(ROUTER.indexOf("router.put('/:id'"));
  });

  it('toda rota exige autenticação e trata erro (nada de 500 mudo)', () => {
    const handlers = ROUTER.match(/router\.(get|post|put|delete)\(/g) ?? [];
    expect(handlers.length).toBeGreaterThanOrEqual(9);
    expect((ROUTER.match(/requireAuth/g) ?? []).length).toBeGreaterThanOrEqual(handlers.length);
    expect((ROUTER.match(/catch \(err\)/g) ?? []).length).toBeGreaterThanOrEqual(handlers.length);
    // Template inexistente = erro do usuário (400), não falha do servidor.
    expect(ROUTER).toMatch(/TemplateDesconhecidoError.*\n?.*status\(400\)/);
  });

  it('server.ts monta /api/prontuarios e roda a migration no boot', () => {
    expect(SERVER).toMatch(/import prontuarioRouter from '\.\/routes\/prontuario'/);
    expect(SERVER).toMatch(/app\.use\('\/api\/prontuarios', prontuarioRouter\)/);
    expect(SERVER).toMatch(/migrations-prontuario/);
    expect(SERVER).toMatch(/runProntuarioMigrations/);
  });

  it('aba própria "Prontuário" na Gestão de Obras, com view e roteador', () => {
    expect(OBRAS).toContain('data-tab="prontuario"');
    expect(OBRAS).toContain('id="view-prontuario"');
    expect(OBRAS).toMatch(/prontuario: async \(\) => \{ renderProntuarioTab\(\); \}/);
    expect(OBRAS).toMatch(/function renderProntuarioTab\(\)/);
    expect(OBRAS).toMatch(/prontuario\.html\?novo=1/);
    // A aba NÃO depende de obra ativa: ao contrário de Inventário/Diário, o
    // corpo de renderProntuarioTab não monta o seletor de obra nem exige
    // state.currentObra — o prontuário é do cliente, não da obra.
    const corpo = OBRAS.slice(
      OBRAS.indexOf('function renderProntuarioTab()'),
      OBRAS.indexOf('async function montarListaProntuarios()'),
    );
    expect(corpo.length).toBeGreaterThan(100);
    expect(corpo).not.toMatch(/obraSelector\(\)|attachSel\(\)|state\.currentObra/);
  });

  it('tela única: cabeçalho + timeline + checklist + concluir, tudo na mesma página', () => {
    expect(PAGE).toMatch(/\/api\/prontuarios/);
    expect(PAGE).toMatch(/class="tl"/);                  // timeline das etapas
    expect(PAGE).toMatch(/class="bar"/);                 // barra de progresso (%)
    expect(PAGE).toMatch(/Concluir etapa/);
    expect(PAGE).toMatch(/checklist_documentos/);
    expect(PAGE).toMatch(/data-doc=/);                   // marcar documento ok/pendente
    expect(PAGE).toMatch(/etapas\/'\+b\.getAttribute\('data-etapa'\)/);
    // 401 no fetch devolve pro login (padrão do projeto).
    expect(PAGE).toMatch(/location\.href='\/login\?next='/);
    expect(PAGE).toMatch(/credentials = 'include'/);
  });

  it('não encosta no motor do agente (teto de 128 tools intacto)', () => {
    for (const src of [REPO, ROUTER, MIG, PAGE]) {
      expect(src).not.toMatch(/agent\/tools|agent\/think|aiCascade/);
    }
  });
});
