// v3.49.6: PDF-A — Memorial Descritivo Arquitetonico (NBR 13532/15575/9050 + SINAPI).
import type { ResultadoArquitetonico } from './arquitetonicoCalculo';
import { labelPadrao } from './arquitetonicoCalculo';
import {
  createDoc, sectionTitle, subTitle, paragrafo, bullets, tabela,
  assinaturaRomatec, dataPorExtenso, dataCurta, sanitizarNome, fmt,
  MARGIN, CONTENT_W, COR_VERDE, COR_AZUL, COR_SUAVE, COR_TEXTO,
} from './hidraulicoPdfShared';

const NORMAS = [
  'ABNT NBR 13532:1995 - Elaboracao de projetos de edificacoes - Arquitetura',
  'ABNT NBR 15575:2013 - Edificacoes habitacionais - Desempenho',
  'ABNT NBR 9050:2020 - Acessibilidade a edificacoes, mobiliario e espacos',
  'ABNT NBR 9077:2001 - Saidas de emergencia em edificios',
  'Codigo de Obras e Posturas do municipio de Acailandia/MA',
  'Tabela SINAPI/CAIXA - Composicoes de servicos e insumos de referencia',
];
const CRITERIOS_EXECUCAO = [
  'Locacao da obra conforme projeto e alinhamento aprovado pela prefeitura.',
  'Impermeabilizacao de areas molhadas e baldrames antes do revestimento.',
  'Caimento minimo de 0,5% em pisos de areas molhadas e varandas.',
  'Esquadrias com vedacao e contramarco; vidros conforme NBR 7199.',
  'Acabamentos assentados com argamassa e juntas conforme fabricante.',
];

export interface MemorialPdfResult { buffer: Buffer; filename: string; }

export async function gerarPdfMemorialArquitetonico(r: ResultadoArquitetonico, opts?: { data?: Date }): Promise<MemorialPdfResult> {
  const data = opts?.data ?? new Date();
  const o = r.dadosObra; const u = r.dadosUso; const s = r.saida;
  const meta = {
    tipoDocCurto: 'Memorial Arquitetonico',
    docNome: 'Memorial Descritivo - Projeto Arquitetonico',
    obra: o.titulo, proprietario: o.proprietario, data: dataCurta(data), prancha: o.prancha,
  };
  const h = createDoc(meta);
  const { doc } = h;

  // CAPA
  doc.y = 150;
  doc.fontSize(18).fillColor(COR_VERDE).font('Helvetica-Bold').text('MEMORIAL DESCRITIVO', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(COR_AZUL).font('Helvetica-Bold').text('PROJETO ARQUITETONICO E ACABAMENTOS', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.fontSize(9).fillColor(COR_SUAVE).font('Helvetica').text('Conforme ABNT NBR 13532, NBR 15575 e NBR 9050', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.2);
  doc.fontSize(9.5).fillColor(COR_TEXTO).font('Helvetica-Bold').text(`REVISAO 01 - Compatibilizada com a Prancha ${o.prancha}`, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.5);
  tabela(h, [{ label: 'CAMPO', width: 160 }, { label: 'DESCRICAO', width: CONTENT_W - 160 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Endereco', `${o.endereco} - ${o.municipio}/${o.uf}`] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['Area construida', `${fmt(o.areaM2)} m2`] },
    { celulas: ['Padrao de acabamento', labelPadrao(u.padraoAcabamento)] },
    { celulas: ['Programa', `${u.nQuartos} quarto(s), ${u.nBanheiros} banheiro(s)`] },
    { celulas: ['Data de emissao', dataCurta(data)] },
    { celulas: ['Prancha vinculada', o.prancha] },
  ]);

  // 1. IDENTIFICACAO
  doc.addPage();
  sectionTitle(h, '1. Identificacao da obra e do responsavel tecnico');
  tabela(h, [{ label: 'CAMPO', width: 170 }, { label: 'DESCRICAO', width: CONTENT_W - 170 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Uso', u.tipoUso === 'residencial' ? 'Residencial unifamiliar' : 'Comercial'] },
    { celulas: ['Endereco', `${o.endereco} - ${o.municipio}/${o.uf}`] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['CPF/CNPJ', o.cpfCnpj] },
    { celulas: ['Area construida', `${fmt(o.areaM2)} m2`] },
    { celulas: ['No de pavimentos', String(o.nPavimentos)] },
    { celulas: ['Pe-direito', `${fmt(u.peDireitoM)} m`] },
    { celulas: ['Registro Responsavel Tecnico', 'CFT/MA 01209185369 - CNAI 031161 - CRECI/MA 4.705'] },
    { celulas: ['Prancha vinculada', o.prancha] },
  ]);

  // 2. OBJETO
  sectionTitle(h, '2. Objeto');
  paragrafo(h, `Este memorial descreve o partido arquitetonico, o programa de necessidades e a especificacao de acabamentos da edificacao ${u.tipoUso === 'residencial' ? 'residencial' : 'comercial'} situada a ${o.endereco}, ${o.municipio}/${o.uf}, de propriedade de ${o.proprietario}, com area construida de ${fmt(o.areaM2)} m2 e padrao de acabamento ${labelPadrao(u.padraoAcabamento).toLowerCase()}. As especificacoes seguem as ABNT NBR 13532 (projeto), NBR 15575 (desempenho) e NBR 9050 (acessibilidade), com quantitativos referenciados na tabela SINAPI.`);

  // 3. NORMAS
  sectionTitle(h, '3. Normas e referencias tecnicas aplicaveis');
  bullets(h, NORMAS);

  // 4. PROGRAMA E AREAS
  sectionTitle(h, '4. Programa de necessidades e areas');
  tabela(h, [{ label: 'AMBIENTE/AREA', width: 280 }, { label: 'VALOR', width: CONTENT_W - 280, align: 'right' }], [
    { celulas: ['Area construida total', `${fmt(s.areas.construida_m2)} m2`], negrito: true },
    { celulas: ['Quartos / dormitorios', String(u.nQuartos)] },
    { celulas: ['Banheiros', String(u.nBanheiros)] },
    { celulas: ['Area de parede interna (revestir/pintar)', `${fmt(s.areas.parede_interna_m2)} m2`] },
    { celulas: ['Area molhada revestida (azulejo)', `${fmt(s.areas.area_molhada_revest_m2)} m2`] },
    { celulas: ['Area de forro/teto', `${fmt(s.areas.forro_m2)} m2`] },
    { celulas: ['Area de cobertura', `${fmt(s.areas.cobertura_m2)} m2`] },
  ]);

  // 5. ACABAMENTOS
  sectionTitle(h, '5. Especificacao de acabamentos');
  tabela(h, [{ label: 'ELEMENTO', width: 150 }, { label: 'ESPECIFICACAO', width: CONTENT_W - 150 }], [
    { celulas: ['Pisos', s.acabamentos.piso] },
    { celulas: ['Paredes', s.acabamentos.parede] },
    { celulas: ['Forro/teto', s.acabamentos.forro] },
    { celulas: ['Areas molhadas', 'Revestimento ceramico ate o teto nas areas molhadas, com soleira e pingadeira'] },
    { celulas: ['Cobertura', s.acabamentos.cobertura] },
  ]);

  // 6. ESQUADRIAS
  sectionTitle(h, '6. Esquadrias');
  tabela(h, [{ label: 'TIPO', width: 280 }, { label: 'QTD', width: CONTENT_W - 280, align: 'right' }], [
    { celulas: ['Portas internas (0,80x2,10 m)', String(s.esquadrias.portas_internas)] },
    { celulas: ['Portas externas (0,90x2,10 m)', String(s.esquadrias.portas_externas)] },
    { celulas: ['Janelas (aluminio/PVC com vidro)', String(s.esquadrias.janelas)] },
  ]);

  // 7. ACESSIBILIDADE E DESEMPENHO
  sectionTitle(h, '7. Acessibilidade e desempenho');
  tabela(h, [{ label: 'CRITERIO', width: 280 }, { label: 'SITUACAO', width: CONTENT_W - 280 }], [
    { celulas: ['Pe-direito minimo (2,50 m)', r.statusNormativo.peDireitoMinimoOK ? 'Atendido' : 'Verificar'] },
    { celulas: ['Iluminacao/ventilacao natural (1/8)', r.statusNormativo.ventilacaoIluminacaoOK ? 'Atendido' : 'Verificar'] },
    { celulas: ['Rota acessivel (NBR 9050)', r.statusNormativo.acessibilidadePrevista ? 'Prevista' : 'Nao prevista'] },
    { celulas: ['Desempenho (NBR 15575)', 'Materiais e sistemas atendem nivel minimo (M)'] },
  ]);

  // 8. MATERIAIS
  sectionTitle(h, '8. Especificacao de materiais');
  paragrafo(h, 'A relacao quantitativa de pisos, revestimentos de parede, forro/pintura, esquadrias, cobertura e loucas/metais consta no documento complementar "Lista de Materiais (Quantitativo Executivo) - Arquitetonico", emitido em conjunto e vinculado a mesma prancha, com base na tabela SINAPI.');

  // 9. EXECUCAO
  sectionTitle(h, '9. Criterios de execucao');
  bullets(h, CRITERIOS_EXECUCAO);

  // 10. CONCLUSAO
  sectionTitle(h, '10. Conclusao');
  paragrafo(h, `O projeto arquitetonico contempla ${u.nQuartos} quarto(s) e ${u.nBanheiros} banheiro(s) em ${fmt(o.areaM2)} m2, padrao ${labelPadrao(u.padraoAcabamento).toLowerCase()}, com ${s.esquadrias.portas_internas + s.esquadrias.portas_externas} portas e ${s.esquadrias.janelas} janelas, cobertura em ${s.acabamentos.cobertura.toLowerCase()}. ${r.statusNormativo.peDireitoMinimoOK && r.statusNormativo.ventilacaoIluminacaoOK ? 'Os requisitos de pe-direito, iluminacao e ventilacao naturais foram atendidos.' : 'Ha ressalvas de conforto/normativas conforme secao 7.'} Conclui-se que o projeto encontra-se apto a execucao conforme a normalizacao vigente.`);
  if (r.alertas.length > 0) { subTitle(h, 'Ressalvas'); bullets(h, r.alertas); }

  // 11. RESPONSABILIDADE TECNICA
  sectionTitle(h, '11. Responsabilidade tecnica');
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Memorial_Arquitetonico_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}
