// v3.97.0 — Inventário de Materiais por Obra: parser de NFe XML (determinístico),
// wire-up (migration + rotas + UI) e regras críticas na fonte (FOR UPDATE, coluna
// gerada de saldo, base64 sem disco).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseNfeXml, formatarCnpjNfe } from '../services/inventario/nfeXmlParser';

const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

const XML_NFE_EXEMPLO = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
 <NFe><infNFe Id="NFe21260712345678000199550010000045671000045670" versao="4.00">
  <ide><cUF>21</cUF><nNF>4567</nNF><dhEmi>2026-07-10T09:15:00-03:00</dhEmi></ide>
  <emit><CNPJ>12345678000199</CNPJ><xNome>COMERCIAL MATERIAIS ACAILANDIA LTDA</xNome></emit>
  <det nItem="1"><prod>
    <cProd>0101</cProd><xProd>CIMENTO CP II-Z-32 50KG</xProd>
    <NCM>25232910</NCM><CFOP>5102</CFOP>
    <uCom>SC</uCom><qCom>40.0000</qCom><vUnCom>34.9000</vUnCom><vProd>1396.00</vProd>
  </prod></det>
  <det nItem="2"><prod>
    <cProd>0230</cProd><xProd><![CDATA[CABO FLEX 2,5MM VERMELHO]]></xProd>
    <uCom>M</uCom><qCom>150.0000</qCom><vUnCom>2.1500</vUnCom><vProd>322.50</vProd>
  </prod></det>
  <total><ICMSTot><vProd>1718.50</vProd><vNF>1718.50</vNF></ICMSTot></total>
 </infNFe></NFe>
</nfeProc>`;

describe('parseNfeXml — parser determinístico (v3.97.0)', () => {
  it('extrai cabeçalho e itens de uma NFe 4.0 real', () => {
    const nfe = parseNfeXml(XML_NFE_EXEMPLO);
    expect(nfe).not.toBeNull();
    expect(nfe!.numero_nota).toBe('4567');
    expect(nfe!.chave_acesso).toBe('21260712345678000199550010000045671000045670');
    expect(nfe!.fornecedor_nome).toBe('COMERCIAL MATERIAIS ACAILANDIA LTDA');
    expect(nfe!.fornecedor_cnpj).toBe('12.345.678/0001-99');
    expect(nfe!.data_emissao).toBe('2026-07-10');
    expect(nfe!.valor_total).toBe(1718.5);
    expect(nfe!.itens).toHaveLength(2);
    const [cimento, cabo] = nfe!.itens;
    expect(cimento).toMatchObject({ codigo: '0101', unidade: 'SC', quantidade: 40, valor_unitario: 34.9, valor_total: 1396 });
    expect(cimento.descricao).toBe('CIMENTO CP II-Z-32 50KG');
    // CDATA tratado
    expect(cabo.descricao).toBe('CABO FLEX 2,5MM VERMELHO');
    expect(cabo.unidade).toBe('M');
    expect(cabo.quantidade).toBe(150);
  });

  it('conteúdo que não é NFe → null (upload cai em erro claro)', () => {
    expect(parseNfeXml('<html>nada a ver</html>')).toBeNull();
    expect(parseNfeXml('')).toBeNull();
    // NFe sem itens
    expect(parseNfeXml('<NFe><infNFe Id="NFe123"><ide><nNF>1</nNF></ide></infNFe></NFe>')).toBeNull();
  });

  it('formatarCnpjNfe mascara 14 dígitos', () => {
    expect(formatarCnpjNfe('17261987000109')).toBe('17.261.987/0001-09');
    expect(formatarCnpjNfe('123')).toBe('123'); // não-CNPJ passa intacto
  });
});

describe('Wire-up do módulo (fonte) — v3.97.0', () => {
  const MIG = read('database', 'migrations-inventario-obra.ts');
  const REPO = read('services', 'inventario', 'inventarioObraRepo.ts');
  const ROUTER = read('routes', 'inventarioObra.ts');
  const SERVER = read('server.ts');
  const OBRAS = read('public', 'obras.html');
  const PAGE = read('public', 'inventario-obra.html');
  const PDF = read('services', 'inventario', 'inventarioObraPdf.ts');

  it('migration cria as 5 tabelas com saldo GERADO e arquivos em base64 (sem disco)', () => {
    ['obra_inventario_etapas', 'obra_inventario_notas', 'obra_inventario_itens',
     'obra_inventario_utilizacoes', 'obra_inventario_fotos'].forEach((t) => {
      expect(MIG).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    });
    expect(MIG).toMatch(/quantidade_saldo DECIMAL\(12,3\) GENERATED ALWAYS AS \(quantidade_comprada - quantidade_utilizada\) STORED/);
    expect(MIG).toMatch(/arquivo_b64 LONGTEXT/);
    expect(MIG).toMatch(/data_base64 LONGTEXT/);
    expect(MIG).not.toMatch(/arquivo_original_path/); // spec de path em disco foi descartada
    expect(MIG).toMatch(/colaborador_id VARCHAR\(64\)/);
  });

  it('utilização roda em transação com FOR UPDATE (saldo nunca negativo)', () => {
    expect(REPO).toMatch(/FOR UPDATE/);
    expect(REPO).toMatch(/beginTransaction/);
    expect(REPO).toMatch(/class SaldoInsuficienteError/);
    expect(REPO).toMatch(/Saldo insuficiente/);
  });

  it('router cobre upload (XML determinístico + IA), utilização 422 e fotos', () => {
    expect(ROUTER).toMatch(/parseNfeXml/);
    expect(ROUTER).toMatch(/extrairNotaFiscal/);
    expect(ROUTER).toMatch(/revisao_manual/);
    expect(ROUTER).toMatch(/SaldoInsuficienteError \? 422/);
    expect(ROUTER).toMatch(/upload\.array\('fotos'/);
    expect(ROUTER).toMatch(/aplicarOverlayFoto/);
    expect(ROUTER).toMatch(/enviar-whatsapp/);
  });

  it('server registra rota e migration no boot', () => {
    expect(SERVER).toMatch(/app\.use\('\/api\/gestao-obra\/inventario', inventarioObraRouter\)/);
    expect(SERVER).toMatch(/migrations-inventario-obra/);
  });

  it('card da obra ganha o botão 📦 Inventário e a página dedicada existe', () => {
    expect(OBRAS).toMatch(/inventario-obra\.html\?obra=\$\{o\.id\}/);
    expect(PAGE).toMatch(/Inventário de Materiais/);
    expect(PAGE).toMatch(/notas\/upload/);
    expect(PAGE).toMatch(/utilizacao/);
    expect(PAGE).toMatch(/tipo_foto/);
    expect(PAGE).toMatch(/relatorio\/enviar-whatsapp/);
  });

  it('relatório PDF tem tabela comprado×utilizado×saldo, fotos e assinatura técnica', () => {
    expect(PDF).toMatch(/Comprado<\/th><th>Utilizado<\/th><th>Saldo/);
    expect(PDF).toMatch(/Relatório Fotográfico/);
    expect(PDF).toMatch(/José Romário Pinto Bezerra/);
    expect(PDF).toMatch(/CFT\/MA 01209185369/);
    expect(PDF).toMatch(/estado do inventário no momento da emissão/);
  });
});
