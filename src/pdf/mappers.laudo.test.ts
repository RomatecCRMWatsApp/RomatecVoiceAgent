// v3.x — Testes do mapper laudoToLaudoDados (puro, sem I/O).
import { describe, it, expect } from 'vitest';
import { laudoToLaudoDados } from './mappers';
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
  cpf_cnpj: '000.000.000-00',
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
    altitude: null, descricao_marco: 'Marco de concreto', azimute_manual: null, tempo_rastreio_seg: null,
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
});
