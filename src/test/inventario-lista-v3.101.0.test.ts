// v3.101.0 — Aba Inventário lista os inventários criados (abrir/editar,
// relatório e envio WhatsApp direto da tela inicial do painel).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

describe('Lista de inventários na aba (v3.101.0)', () => {
  it('repo agrega numero + obra + KPIs (mais recente primeiro)', () => {
    const REPO = read('services', 'inventario', 'inventarioObraRepo.ts');
    expect(REPO).toMatch(/export async function listarInventarios/);
    expect(REPO).toMatch(/FROM obra_inventario_cabecalho c/);
    expect(REPO).toMatch(/LEFT JOIN romatec_obras o ON o\.id = c\.obra_id/);
    expect(REPO).toMatch(/ORDER BY c\.id DESC/);
    expect(REPO).toMatch(/notas_count/);
  });

  it('rota GET /lista registrada ANTES das rotas paramétricas', () => {
    const ROUTER = read('routes', 'inventarioObra.ts');
    const iLista = ROUTER.indexOf("router.get('/lista'");
    const iParam = ROUTER.indexOf("router.post('/:obraId/etapas'");
    expect(iLista).toBeGreaterThan(-1);
    expect(iParam).toBeGreaterThan(-1);
    expect(iLista).toBeLessThan(iParam);
    // v3.102.0: passou a receber o filtro opcional da obra ativa
    expect(ROUTER).toMatch(/repo\.listarInventarios\(obraId\)/);
  });

  it('aba Inventário renderiza a lista com Abrir / Relatório / Enviar', () => {
    const OBRAS = read('public', 'obras.html');
    expect(OBRAS).toMatch(/Inventários criados/);
    expect(OBRAS).toMatch(/async function montarListaInventarios/);
    expect(OBRAS).toMatch(/\/api\/gestao-obra\/inventario\/lista/);
    expect(OBRAS).toMatch(/data-inv-rel/);   // 📄 Relatório
    expect(OBRAS).toMatch(/data-inv-zap/);   // 📲 Enviar WhatsApp
    expect(OBRAS).toMatch(/✏️ Abrir/);
    // renderInventarioTab chama a lista
    expect(OBRAS).toMatch(/attachSel\(\);\s*\n\s*montarListaInventarios\(\);/);
  });
});
