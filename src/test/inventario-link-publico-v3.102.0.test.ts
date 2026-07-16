// v3.102.0 — Inventário: link PÚBLICO sempre atualizado (/v/inventario/:hash,
// corrige o 401 no celular), lista filtrada pela obra ativa, excluir inventário
// e link enviado no WhatsApp pela ZAYRA.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

describe('Link público do inventário (v3.102.0)', () => {
  it('migration adiciona hash_publico (unique) no cabeçalho', () => {
    const MIG = read('database', 'migrations-inventario-obra.ts');
    expect(MIG).toMatch(/ADD COLUMN hash_publico VARCHAR\(64\)/);
    expect(MIG).toMatch(/UNIQUE KEY uq_inv_hash \(hash_publico\)/);
  });

  it('repo: hash gerado na criação + backfill; busca por hash valida 64 hex', () => {
    const REPO = read('services', 'inventario', 'inventarioObraRepo.ts');
    expect(REPO).toMatch(/randomBytes\(32\)\.toString\('hex'\)/);
    expect(REPO).toMatch(/export async function buscarCabecalhoPorHash/);
    expect(REPO).toMatch(/\^\[a-f0-9\]\{64\}\$/);
  });

  it('rota pública /v/inventario/:hash registrada FORA da auth, PDF na hora (no-store)', () => {
    const PUB = read('routes', 'inventarioPublico.ts');
    expect(PUB).toMatch(/buscarCabecalhoPorHash/);
    expect(PUB).toMatch(/gerarInventarioPdfComAnexos/);
    expect(PUB).toMatch(/no-store/);
    expect(PUB).not.toMatch(/requireAuth/); // é público de propósito (hash é a chave)
    const SERVER = read('server.ts');
    expect(SERVER).toMatch(/app\.use\('\/v\/inventario', inventarioPublicoRouter\)/);
  });

  it('envio WhatsApp inclui o link sempre-atualizado', () => {
    const ROUTER = read('routes', 'inventarioObra.ts');
    expect(ROUTER).toMatch(/\/v\/inventario\/\$\{cab\.hash_publico\}/);
    expect(ROUTER).toMatch(/SEMPRE ATUALIZADO/);
  });
});

describe('Lista filtrada + excluir (v3.102.0)', () => {
  const ROUTER = read('routes', 'inventarioObra.ts');
  const OBRAS = read('public', 'obras.html');

  it('GET /lista aceita ?obra_id e DELETE /:obraId exclui o inventário inteiro', () => {
    expect(ROUTER).toMatch(/listarInventarios\(obraId\)/);
    expect(ROUTER).toMatch(/router\.delete\('\/:obraId'/);
    const REPO = read('services', 'inventario', 'inventarioObraRepo.ts');
    expect(REPO).toMatch(/export async function excluirInventario/);
    ['obra_inventario_itens', 'obra_inventario_notas', 'obra_inventario_etapas', 'obra_inventario_cabecalho']
      .forEach((t) => expect(REPO).toMatch(new RegExp(`DELETE FROM ${t} WHERE obra_id`)));
  });

  it('aba filtra pela obra ativa e tem Excluir (confirmação dupla) + Link + Relatório público', () => {
    expect(OBRAS).toMatch(/\/api\/gestao-obra\/inventario\/lista' \+ filtro/);
    expect(OBRAS).toMatch(/state\.currentObra \? \('\?obra_id='/);
    expect(OBRAS).toMatch(/data-inv-del/);
    expect(OBRAS).toMatch(/digite: EXCLUIR/);
    expect(OBRAS).toMatch(/data-inv-link/);
    expect(OBRAS).toMatch(/'\/v\/inventario\/' \+ b\.dataset\.invRel/);
  });

  it('página do inventário: Ver PDF usa o link público (funciona no celular) + copiar link', () => {
    const PAGE = read('public', 'inventario-obra.html');
    expect(PAGE).toMatch(/S\.hash = \(r\[0\]\.cabecalho && r\[0\]\.cabecalho\.hash_publico\)/);
    expect(PAGE).toMatch(/'\/v\/inventario\/' \+ S\.hash \+ q\(\)/);
    expect(PAGE).toMatch(/Copiar link do cliente/);
  });
});
