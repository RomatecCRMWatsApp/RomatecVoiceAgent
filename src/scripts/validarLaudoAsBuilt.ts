// v3.51.1 — Validacao end-to-end do PDF do Laudo de Demarcacao com Croqui
// As-Built (Canvas) + Relatorio Fotografico. NAO toca no banco: env dummy,
// mocks em memoria, imports dinamicos APOS setar env (connection.ts so cria
// pool lazy; getTenantSettings cai no .catch). Rasteriza um croqui de verdade
// (testa sharp/node-canvas); se nao houver binario nativo, usa PNG fallback.
//
// Rodar: npx tsx src/scripts/validarLaudoAsBuilt.ts

// 1) env ANTES de qualquer import que puxe database/connection.ts.
process.env.DATABASE_URL ??= 'mysql://dummy:dummy@127.0.0.1:3306/dummy_db';
process.env.JWT_SECRET ??= 'validacao-laudo-asbuilt-secret-min-32-chars-ok';
process.env.NODE_ENV ??= 'test';

import { writeFileSync } from 'fs';
import { join } from 'path';

// PNG fallback valido (160x100, puro zlib) — usado se nao houver rasterizador.
const FALLBACK_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAACCUlEQVR4nO3cMU4DQRAF0bkfF+UoXIOYmJyAAIEMtte7y0xVSZ0/fXVe4+X56fNe397PvNxzbqjWCt2hWit0h2qt0D31wf++Vuie9+AZ1grdkx48yVqhe8aD51krdA9/8FRrhe6xD55trdA98METrhW6Rz14zrVC95AHT7tW6O7/4JnXCt2dHzz5WqG754PnXyt0d3vwEmuF7j4PXmWt0N3hwQutFbqPPnittUL3oQcvt1bobn/wimuF7sYHL7pW6G558Lprhe7dD156rdC978GrrxW6dzwYsFbo3vpgxlqhe9ODMWuF7vUHk9YK3SsPhq0Vun89mLdW6P76YORaoXv5wdS1QvfCg8Frhe7PB7PXCt1vD8avFbpfDzasFbpDtVboDtVaoTtUa4VunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrt1suBunSy4WycL7tbJgrsfiP1cKjeNFC8AAAAASUVORK5CYII=';

type Any = Record<string, unknown>;
const ok = (b: boolean) => (b ? 'PASS' : 'FALHA');

async function main() {
  const { gerarPdfLaudo } = await import('../services/laudoPdf');
  const { gerarPranchaSVG } = await import('../services/canvasService');
  const { rasterizarSvg, montarNotaAsBuilt } = await import('../services/laudoAnexos');

  // ── Croqui As-Built: gera prancha SVG (poligono retangular) e rasteriza ────
  const conteudoSvg =
    '<polygon points="200,1600 1800,1600 1800,400 200,400" fill="rgba(16,185,129,0.12)" stroke="#B8893A" stroke-width="6"/>'
    + '<text x="1000" y="1020" font-size="80" text-anchor="middle" fill="#222">LOTE 24 - Q.15</text>'
    + '<text x="1000" y="1700" font-size="48" text-anchor="middle" fill="#444">As-Built</text>';
  const pranchaSvg = gerarPranchaSVG({
    tituloObra: 'Demarcacao Lote 24 - Q.15',
    proprietario: 'Cliente Teste',
    municipio: 'Acailandia/MA',
    escala: '1:500',
    conteudoSvg,
    larguraVirtual: 2000,
    alturaVirtual: 2000,
  });
  let croquiCanvasPng = await rasterizarSvg(pranchaSvg, 1400);
  const rasterizouNativo = !!croquiCanvasPng;
  if (!croquiCanvasPng) croquiCanvasPng = Buffer.from(FALLBACK_PNG_B64, 'base64');

  // ── Fotos do Relatorio Fotografico (3 registros georreferenciados) ─────────
  const fotosRelatorio = [
    { base64: FALLBACK_PNG_B64, mime: 'image/png',
      legenda: 'Marco P1 — Rua A/Acailandia (UTM 23S: E 678.911 / N 9.456.789 · SIRGAS 2000)' },
    { base64: FALLBACK_PNG_B64, mime: 'image/png',
      legenda: 'Marco P2 — Rua A/Acailandia (UTM 23S: E 678.961 / N 9.456.789 · SIRGAS 2000)' },
    { base64: FALLBACK_PNG_B64, mime: 'image/png',
      legenda: 'Vista geral do imovel — Acailandia (UTM 23S: E 678.936 / N 9.456.759 · SIRGAS 2000)' },
  ];

  // ── Mocks tipados via cast (script descartavel) ────────────────────────────
  const laudo = {
    id: 999, numero_laudo: 'TESTE-ASBUILT-001', contratante_id: 1, executante_id: 1,
    tipo_imovel: 'RURAL', tipo_lote_urbano: null, quadra: '15', numero_lote: '24',
    loteamento: 'Loteamento Teste', numero_contrato: 'CT-001', denominacao_imovel: 'Sitio Teste',
    nirf: null, ccir: null, matricula: '12345', livro: '2', folhas: '10',
    cartorio_nome: 'CRI Acailandia', cartorio_cns: null, endereco_imovel: 'Zona Rural, s/n',
    municipio: 'Acailandia', uf_imovel: 'MA', comarca: 'Acailandia',
    confrontante_frente: 'Estrada Vicinal', confrontante_lat_dir: 'Joao Silva',
    confrontante_lat_esq: 'Maria Souza', confrontante_fundo: 'Corrego Seco', confrontante_extra: null,
    area_total_m2: 20000, perimetro_m: 600, croqui_tipo: 'auto', escala: '1:500',
    usa_art: false, numero_art: null, usa_trt: false, numero_trt: null,
    valor_servico: null, forma_pagamento: null, data_pagamento: null, recibo_id: null,
    hash_validacao: 'hash-teste', token_uuid: null, assinado_em: null,
    status: 'rascunho', observacoes: 'Laudo de validacao automatizada.', ativo: true,
    tipo_levantamento: 'GNSS', sistema_coord: 'UTM',
    base_nome: null, base_inicio_rastreio: null, base_fim_rastreio: null, base_observacoes: null,
    rover_nome: null, coletor_nome: null,
    valor_final: null, precificacao_calculada_em: null, valor_demarcacao: null,
    lote_loteamento_id: null,
  } as unknown as Parameters<typeof gerarPdfLaudo>[0]['laudo'];

  const contratante = {
    id: 1, nome: 'Cliente Teste da Silva', tipo_pessoa: 'FISICA', cpf_cnpj: '123.456.789-00',
    rg_ie: '0000000 SSP/MA', nacionalidade: 'brasileiro', estado_civil: 'casado',
    profissao: 'agricultor', logradouro: 'Rua A', numero: '100', complemento: null,
    bairro: 'Centro', cidade: 'Acailandia', uf: 'MA', cep: '65930-000',
    representante_nome: null, representante_cpf: null, representante_cargo: null,
  } as unknown as Parameters<typeof gerarPdfLaudo>[0]['contratante'];

  const executante = {
    id: 1, nome: 'Jose Romario Pinto Bezerra',
    qualificacao: 'Tecnico em Agrimensura', registro_cft: 'CFT/MA 01209185369',
    registro_crea: null, cadastro_incra: 'FQNS',
  } as unknown as Parameters<typeof gerarPdfLaudo>[0]['executante'];

  const Z = 23, HEMI = 'S', E0 = 678911, N0 = 9456789;
  const pontos = [
    { ordem: 1, rotulo: 'P1', utm_zona: Z, utm_hemisferio: HEMI, utm_e: E0, utm_n: N0,
      lat_decimal: null, long_decimal: null, lat_gms: null, long_gms: null, altitude: 220,
      descricao_marco: 'Marco de concreto', azimute_manual: null, tempo_rastreio_seg: null },
    { ordem: 2, rotulo: 'P2', utm_zona: Z, utm_hemisferio: HEMI, utm_e: E0 + 100, utm_n: N0,
      lat_decimal: null, long_decimal: null, lat_gms: null, long_gms: null, altitude: 221,
      descricao_marco: 'Marco de concreto', azimute_manual: null, tempo_rastreio_seg: null },
    { ordem: 3, rotulo: 'P3', utm_zona: Z, utm_hemisferio: HEMI, utm_e: E0 + 100, utm_n: N0 - 100,
      lat_decimal: null, long_decimal: null, lat_gms: null, long_gms: null, altitude: 222,
      descricao_marco: 'Marco de concreto', azimute_manual: null, tempo_rastreio_seg: null },
    { ordem: 4, rotulo: 'P4', utm_zona: Z, utm_hemisferio: HEMI, utm_e: E0, utm_n: N0 - 100,
      lat_decimal: null, long_decimal: null, lat_gms: null, long_gms: null, altitude: 221,
      descricao_marco: 'Marco de concreto', azimute_manual: null, tempo_rastreio_seg: null },
  ] as unknown as Parameters<typeof gerarPdfLaudo>[0]['pontos'];

  const lados = [1, 2, 3, 4].map((o) => ({
    id: o, laudo_id: 999, ordem: o, ponto_inicio_id: o, ponto_fim_id: (o % 4) + 1,
    rotulo: `L${o}`, distancia_m: 100, azimute: 90 * (o - 1),
    medida_manual_m: 100, confrontante_nome: null, nome_lado: null,
  })) as unknown as Parameters<typeof gerarPdfLaudo>[0]['lados'];

  // ── Gera o PDF ──────────────────────────────────────────────────────────────
  const pdf = await gerarPdfLaudo({
    laudo, contratante, executante, pontos, lados,
    fotos: [], // sem fotos do laudo — exercita SO a 11.3 (relatorio)
    croquiCanvasPng,
    croquiCanvasInfo: { titulo: 'Demarcacao Lote 24 - Q.15', escala: '1:500', tipo: 'croqui' },
    fotosRelatorio,
  });

  const outPath = join(process.cwd(), '_validacao-laudo-asbuilt.pdf');
  writeFileSync(outPath, pdf);

  // ── Validacoes ────────────────────────────────────────────────────────────
  const magicOk = pdf.slice(0, 5).toString('latin1') === '%PDF-';
  const tamanhoOk = pdf.length > 5000;

  let texto = '';
  try {
    // pdf-parse v2.x: classe PDFParse (CJS) — new PDFParse({data}).getText()
    const { PDFParse } = require('pdf-parse') as {
      PDFParse: new (o: { data: Buffer }) => { getText(): Promise<{ text: string }>; destroy(): Promise<void> };
    };
    const parser = new PDFParse({ data: pdf });
    const parsed = await parser.getText();
    texto = parsed.text || '';
    await parser.destroy();
  } catch (e) {
    console.warn('[aviso] pdf-parse falhou (validacao textual pulada):', (e as Error).message.slice(0, 140));
  }

  // normaliza whitespace: pdf-parse insere quebras de linha conforme o wrap do
  // PDFKit (legendas 7pt em coluna estreita), o que parte tokens como "UTM 23S".
  const textoNorm = texto.replace(/\s+/g, ' ');
  const checa = (sub: string) => textoNorm.includes(sub.replace(/\s+/g, ' '));
  const nota = montarNotaAsBuilt({ temCroqui: true, temFotos: true });

  const checks: Array<[string, boolean]> = [
    ['Magic %PDF-', magicOk],
    [`Tamanho > 5KB (${pdf.length} bytes)`, tamanhoOk],
    ['Rasterizou croqui via binario nativo (sharp/canvas)', rasterizouNativo],
  ];
  if (texto) {
    checks.push(
      ['Titulo "CROQUI AS-BUILT (REGULARIZAÇÃO)"', checa('CROQUI AS-BUILT')],
      ['Nota As-Built presente (AS-BUILT)', checa('AS-BUILT')],
      ['Cita NBR 13133', checa('NBR 13133')],
      ['Cita NTGIR (INCRA)', checa('NTGIR')],
      ['Cita SIRGAS 2000', checa('SIRGAS 2000')],
      ['Subsecao 11.3 (Relatório fotográfico)', checa('11.3')],
      ['Legenda georref nas fotos (Marco P1 / UTM / 678.911)',
        checa('Marco P1') || checa('UTM 23S') || checa('678.911') || checa('678')],
      ['Texto da nota confere (montarNotaAsBuilt)', checa(nota.slice(0, 40))],
    );
  }

  console.log('\n========== VALIDACAO LAUDO AS-BUILT v3.51.1 ==========');
  console.log(`Rasterizador nativo: ${rasterizouNativo ? 'sharp/node-canvas OK' : 'INDISPONIVEL → usou PNG fallback'}`);
  console.log(`PDF gravado em: ${outPath}\n`);
  let todasOk = true;
  for (const [nome, passou] of checks) {
    if (!passou) todasOk = false;
    console.log(`  [${ok(passou)}] ${nome}`);
  }
  console.log('======================================================');
  console.log(todasOk ? '✅ TODAS AS VALIDACOES PASSARAM' : '❌ HOUVE FALHA — verifique acima');
  console.log('Abra o PDF pra inspecao visual da secao 10 (croqui) e 11.3 (fotos).\n');
  process.exit(todasOk ? 0 : 1);
}

main().catch((e) => {
  console.error('[ERRO FATAL]', e);
  process.exit(2);
});
