// v3.x — Testes do mapper laudoToLaudoDados (puro, sem I/O).
import { describe, it, expect } from 'vitest';
import { laudoToLaudoDados, formatarCpfCnpj } from './mappers';
import type { Laudo, PontoLaudo, LadoLaudo } from '../integrations/laudos';
import type { Contratante } from '../integrations/contratantes';
import type { Executante } from '../integrations/executantes';

const laudoMock = {
  id: 42,
  numero_laudo: 'LAUDO-2025-0042',
  contratante_id: 1,
  executante_id: 1,
  tipo_imovel: 'RURAL',
  denominacao_imovel: 'Fazenda Teste',
  matricula: 'M-1234',
  municipio: 'Acailandia',
  uf_imovel: 'MA',
  endereco_imovel: 'Zona Rural',
  area_total_m2: 10000,
  perimetro_m: 341.421,
  usa_art: true,
  numero_art: 'ART-12345',
  usa_trt: true,
  numero_trt: 'TRT-67890',
  hash_validacao: 'abc123hash',
  assinado_em: null,
  created_at: '2025-06-02',
} as unknown as Laudo;

const contratanteMock = {
  id: 1,
  nome: 'Cliente Teste Silva',
  cpf_cnpj: '00051631377',
  rg_ie: '1234567 SSP/MA',
  estado_civil: 'Viúvo(a)',
  nacionalidade: 'brasileiro(a)',
  telefone: '99999-0000',
  email: 'cliente@example.com',
} as unknown as Contratante;

const executanteMock = {
  id: 1,
  nome: 'Jose Romario Pinto Bezerra',
  qualificacao: 'Tecnico em Agrimensura',
  registro_cft: '01209185369',
  registro_crea: null,
  cadastro_incra: 'FQNS',
} as unknown as Executante;

const pontosMock: PontoLaudo[] = [
  {
    id: 11, laudo_id: 42, ordem: 1, rotulo: 'P1',
    utm_zona: 23, utm_hemisferio: 'S', utm_e: 200000, utm_n: 9500000,
    lat_decimal: -4.5, long_decimal: -47.5, lat_gms: '04°30\'00"S', long_gms: '47°30\'00"W',
    altitude: 245.3, descricao_marco: 'Marco de concreto', azimute_manual: null, tempo_rastreio_seg: null,
  },
  {
    id: 12, laudo_id: 42, ordem: 2, rotulo: 'P2',
    utm_zona: 23, utm_hemisferio: 'S', utm_e: 200100, utm_n: 9500000,
    lat_decimal: -4.5, long_decimal: -47.4991, lat_gms: '04°30\'00"S', long_gms: '47°29\'56"W',
    altitude: null, descricao_marco: 'Marco de concreto', azimute_manual: null, tempo_rastreio_seg: null,
  },
];

const ladosMock: LadoLaudo[] = [
  {
    id: 21, laudo_id: 42, ordem: 1, ponto_inicio_id: 11, ponto_fim_id: 12,
    rotulo: 'P1-P2', distancia_m: 100, azimute: 90,
    medida_manual_m: null, confrontante_nome: null, nome_lado: null,
  },
];

const BASE = 'https://romatec.example';

describe('laudoToLaudoDados', () => {
  it('mapeia tipoImovel', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.tipoImovel).toBe('RURAL');
  });
  it('mapeia o numero de vertices', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.vertices.length).toBe(2);
    expect(d.vertices[0].rotulo).toBe('P1');
  });
  it('formata area.m2 em pt-BR', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.area.m2).toContain('10.000,00');
    expect(d.area.m2).toContain('m²');
  });
  it('calcula ha e alqueires para imovel RURAL', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.area.ha).toContain('1,0000 ha');
    expect(d.area.alqueires).toContain('alq');
  });
  it('urlVerificacao contem o hash', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.urlVerificacao).toBe('https://romatec.example/v/laudo/abc123hash');
    expect(d.hashValidacao).toBe('abc123hash');
  });
  it('tecnico.credenciais inclui CFT', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.tecnico.credenciais.some((c) => c.includes('CFT'))).toBe(true);
  });
  it('mapeia art/trt quando habilitados', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.art).toBe('ART-12345');
    expect(d.trt).toBe('TRT-67890');
  });
  it('omite art/trt quando desabilitados', () => {
    const semRt = { ...laudoMock, usa_art: false, usa_trt: false } as Laudo;
    const d = laudoToLaudoDados(semRt, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.art).toBeUndefined();
    expect(d.trt).toBeUndefined();
  });
  it('usa fallback Romatec quando executante null', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, null, pontosMock, ladosMock, BASE);
    expect(d.tecnico.nome).toContain('José Romário');
    expect(d.tecnico.credenciais.some((c) => c.includes('CFT'))).toBe(true);
  });
  it('usa finalidade padrao', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.finalidade).toContain('regularização fundiária');
  });
  it('formata CPF do contratante com mascara', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.contratante.cpfCnpj).toBe('000.516.313-77');
  });
  it('mapeia rg/estadoCivil/nacionalidade do contratante', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.contratante.rg).toBe('1234567 SSP/MA');
    expect(d.contratante.estadoCivil).toBe('Viúvo(a)');
    expect(d.contratante.nacionalidade).toBe('brasileiro(a)');
  });
  it('preenche alt do vertice quando ha altitude', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.vertices[0].alt).toContain('245,300');
    expect(d.vertices[0].alt).toContain('m');
    expect(d.vertices[1].alt).toBe('—');
  });
  it('converte azimute do lado para DMS', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.lados[0].azimute).toMatch(/\d+°\d+'\d+"/);
  });
  it('preenche metodologia com 6 etapas e equipamentos', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.metodologia.length).toBe(6);
    expect(d.equipamentos.base).toBeTruthy();
    expect(d.equipamentos.rover).toBeTruthy();
    expect(d.equipamentos.coletor).toBeTruthy();
    expect(d.equipamentos.software).toContain('Topcon');
  });
  it('preenche objeto da demarcacao', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.objeto).toContain('Constitui objeto');
    expect(d.objeto).toContain('Fazenda Teste');
  });
  it('memorialTexto/pagamento/fotos vazios sem opts', () => {
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE);
    expect(d.memorialTexto).toBe('');
    expect(d.pagamento).toBeUndefined();
    expect(d.fotos).toEqual([]);
  });
  it('preenche memorialTexto/pagamento/fotos a partir de opts', () => {
    const pagamento = {
      titular: 'ROMATEC',
      pix: 'romateccrm@gmail.com',
      brCode: '00020126BR.GOV.BCB.PIX6304ABCD',
      qrDataUrl: 'data:image/png;base64,QR',
    };
    const fotos = [{ dataUri: 'data:image/jpeg;base64,FOTO', legenda: 'Vértice P1' }];
    const d = laudoToLaudoDados(laudoMock, contratanteMock, executanteMock, pontosMock, ladosMock, BASE, {
      memorialTexto: 'Inicia-se a descrição deste perímetro no vértice P1.',
      pagamento,
      fotos,
    });
    expect(d.memorialTexto).toContain('Inicia-se');
    expect(d.pagamento?.brCode).toBe('00020126BR.GOV.BCB.PIX6304ABCD');
    expect(d.fotos.length).toBe(1);
    expect(d.fotos[0].legenda).toBe('Vértice P1');
  });
});

describe('formatarCpfCnpj', () => {
  it('formata 11 digitos como CPF', () => {
    expect(formatarCpfCnpj('00051631377')).toBe('000.516.313-77');
  });
  it('formata 14 digitos como CNPJ', () => {
    expect(formatarCpfCnpj('12345678000190')).toBe('12.345.678/0001-90');
  });
  it('aceita valor ja com mascara (limpa e reformata CPF)', () => {
    expect(formatarCpfCnpj('000.516.313-77')).toBe('000.516.313-77');
  });
  it('retorna original quando nao tem 11/14 digitos', () => {
    expect(formatarCpfCnpj('123')).toBe('123');
    expect(formatarCpfCnpj('—')).toBe('—');
  });
});
