// v3.93.0 — Assinatura ICP-Brasil (PAdES) dos templates PRIME I/II da proposta
// de consultoria. Antes só o TRADICIONAL saía assinado; Prime I/II iam sem a
// caixa ICP e sem PAdES. Espelha o que o laudo já faz (v3.65.0). Como o fluxo é
// puppeteer/HTML + pdf-lib (sem harness de DB), este teste protege a presença dos
// pontos-chave na fonte.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');
const PRIME1 = read('pdf', 'templates', 'propostaTemplatePrime1.ts');
const PRIME2 = read('pdf', 'templates', 'propostaTemplatePrime2.ts');
const MAPPERS = read('pdf', 'mappers.ts');
const TYPES = read('types', 'templateTypes.ts');
const PROP_CONS = read('integrations', 'propostasConsultoria.ts');
const SERVER = read('server.ts');

describe('Proposta Prime — assinatura ICP-Brasil (v3.93.0)', () => {
  it('PropostaDados ganha campo assinaturaIcp', () => {
    expect(TYPES).toMatch(/export interface PropostaDados[\s\S]{0,1500}?assinaturaIcp\?:/);
  });

  it('templates Prime I e II renderizam a caixa ICP (assinaturaIcpHtml)', () => {
    expect(PRIME1).toMatch(/assinaturaIcpHtml\(dados\.assinaturaIcp\)/);
    expect(PRIME2).toMatch(/assinaturaIcpHtml\(dados\.assinaturaIcp\)/);
  });

  it('mapper propostaConsultoriaToPropostaDados aceita e seta assinaturaIcp', () => {
    expect(MAPPERS).toMatch(/propostaConsultoriaToPropostaDados\([\s\S]{0,300}?opts\?: \{[\s\S]{0,120}?assinaturaIcp/);
    expect(MAPPERS).toMatch(/assinaturaIcp: opts\?\.assinaturaIcp/);
  });

  it('assinarProposta aceita template e ramifica pro Prime (gera + merge anexos)', () => {
    expect(PROP_CONS).toMatch(/export async function assinarProposta\([\s\S]{0,200}?template:\s*'tradicional'\s*\|\s*'prime1'\s*\|\s*'prime2'/);
    expect(PROP_CONS).toMatch(/if \(tpl === 'prime1' \|\| tpl === 'prime2'\)/);
    expect(PROP_CONS).toMatch(/gerarPropostaPdf\(dados, tpl === 'prime1'/);
    expect(PROP_CONS).toMatch(/mesclarAnexosProposta\(primeBuf/);
  });

  it('merge de anexos foi extraído em helper reusável (mesclarAnexosProposta)', () => {
    expect(PROP_CONS).toMatch(/export async function mesclarAnexosProposta\(propostaPdf: Buffer, id: number\)/);
  });

  it('rota /assinar lê body.template e repassa pra assinarProposta', () => {
    expect(SERVER).toMatch(/propostas-consultoria\/:id\/assinar'[\s\S]{0,1200}?body\.template/);
    expect(SERVER).toMatch(/assinarProposta\(String\(req\.params\.id\), perfil, template\)/);
  });
});
