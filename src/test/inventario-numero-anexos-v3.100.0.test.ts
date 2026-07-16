// v3.100.0 — Ajustes do Inventário pedidos pelo José:
//  (1) número automático INV-AAAA-NNNN por obra (cabeçalho criado na 1ª abertura);
//  (2) notas fiscais ANEXADAS ao relatório, enumeradas em ordem (Anexo 1, 2, …).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { formatarNumeroInventario } from '../services/inventario/inventarioObraRepo';

const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

describe('Número automático do inventário (v3.100.0)', () => {
  it('formatarNumeroInventario gera INV-AAAA-NNNN', () => {
    expect(formatarNumeroInventario(1, 2026)).toBe('INV-2026-0001');
    expect(formatarNumeroInventario(42, 2026)).toBe('INV-2026-0042');
    expect(formatarNumeroInventario(12345, 2027)).toBe('INV-2027-12345');
  });

  it('migration cria o cabeçalho 1-por-obra (UNIQUE obra_id)', () => {
    const MIG = read('database', 'migrations-inventario-obra.ts');
    expect(MIG).toContain('CREATE TABLE IF NOT EXISTS obra_inventario_cabecalho');
    expect(MIG).toMatch(/UNIQUE KEY uq_inv_cab_obra \(obra_id\)/);
  });

  it('repo cria o cabeçalho na 1ª abertura e trata corrida (ER_DUP_ENTRY)', () => {
    const REPO = read('services', 'inventario', 'inventarioObraRepo.ts');
    expect(REPO).toMatch(/export async function obterOuCriarCabecalho/);
    expect(REPO).toMatch(/ER_DUP_ENTRY/);
    // dadosRelatorio expõe numero + notas pros anexos
    expect(REPO).toMatch(/numero_inventario: string/);
    expect(REPO).toMatch(/export async function listarNotasComArquivo/);
    expect(REPO).toMatch(/ORDER BY id'; \/\/ ordem de inserção = ordem dos anexos/);
  });

  it('rota /resumo devolve o número e a página exibe no cabeçalho', () => {
    const ROUTER = read('routes', 'inventarioObra.ts');
    expect(ROUTER).toMatch(/obterOuCriarCabecalho\(obraId, donoDe\(req\)\)/);
    expect(ROUTER).toMatch(/numero: cabecalho\.numero/);
    const PAGE = read('public', 'inventario-obra.html');
    expect(PAGE).toMatch(/S\.numero = r\[0\]\.numero/);
  });
});

describe('Notas fiscais anexadas ao relatório (v3.100.0)', () => {
  const PDF = read('services', 'inventario', 'inventarioObraPdf.ts');
  const ROUTER = read('routes', 'inventarioObra.ts');

  it('PDF tem índice "Anexos — Notas Fiscais" + merge enumerado com separadora', () => {
    expect(PDF).toMatch(/Anexos — Notas Fiscais/);
    expect(PDF).toMatch(/export async function gerarInventarioPdfComAnexos/);
    expect(PDF).toMatch(/ANEXO \$\{ix \+ 1\}/);
    expect(PDF).toMatch(/NOTA FISCAL N° /);
    // PDF mescla páginas; imagem vira página A4; XML só separadora (sem forma visual)
    expect(PDF).toMatch(/pdf_danfe/);
    expect(PDF).toMatch(/embedPng|embedJpg/);
    expect(PDF).toMatch(/xml_nfe/);
    // cabeçalho do relatório traz o número do inventário
    expect(PDF).toMatch(/INVENTÁRIO \$\{esc\(dados\.numero_inventario/);
  });

  it('rotas de relatório (ver + WhatsApp) usam a versão com anexos e o número no nome do arquivo', () => {
    const usos = ROUTER.match(/gerarInventarioPdfComAnexos/g) || [];
    expect(usos.length).toBeGreaterThanOrEqual(2);
    expect(ROUTER).toMatch(/Inventario_\$\{dados\.numero_inventario/);
  });
});
