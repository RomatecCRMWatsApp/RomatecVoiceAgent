// v3.97.0 — Ponte SOBRAS da Entrega de Obra → Inventário de Materiais.
// Unidade da reconciliação (pool mockado, mesmo padrão de
// obrasEntrega-fotos-persistencia.test.ts) + wire-up na fonte.
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../database/connection', () => ({ default: { execute: vi.fn(), getConnection: vi.fn() } }));

import pool from '../database/connection';
import { sincronizarSobrasDaEntrega, vincularEntregaAObra } from '../services/inventario/sobraEntregaSync';

const p = pool as unknown as { execute: Mock };
const read = (...f: string[]) => readFileSync(join(process.cwd(), 'src', ...f), 'utf8');

const ENTREGA = { id: 9, obra_id: 3, numero: 'RE-2026-0009', colaborador_id: 'u1' };

describe('sincronizarSobrasDaEntrega — reconciliação (v3.97.0)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('entrega sem obra_id → no-op (null), nenhuma escrita', async () => {
    p.execute.mockResolvedValueOnce([[{ id: 9, obra_id: null, numero: 'RE-2026-0009', colaborador_id: 'u1' }]]);
    const r = await sincronizarSobrasDaEntrega(9);
    expect(r).toBeNull();
    expect(p.execute).toHaveBeenCalledTimes(1); // só o SELECT da entrega
  });

  it('sobra nova → INSERT com origem sobra_entrega + rastro + foto GPS copiada', async () => {
    p.execute
      .mockResolvedValueOnce([[ENTREGA]])   // entrega
      .mockResolvedValueOnce([[{             // sobras da entrega
        id: 71, material: 'Cimento CP-II 50kg', quantidade: '3.00', unidade: 'sc',
        foto_mime: 'image/jpeg', foto_base64: 'FOTOB64', observacao: 'meio saco úmido',
        latitude: '-4.9471000', longitude: '-47.4954000',
      }]])
      .mockResolvedValueOnce([[]])           // nenhum item espelhado ainda
      .mockResolvedValueOnce([{ insertId: 501 }]) // INSERT item
      .mockResolvedValueOnce([{ insertId: 88 }]); // INSERT foto (via adicionarFoto)

    const r = await sincronizarSobrasDaEntrega(9);
    expect(r).toEqual({ obra_id: 3, criados: 1, atualizados: 0, removidos: 0, mantidos_com_uso: 0 });

    const insItem = p.execute.mock.calls[3];
    const sqlItem = String(insItem[0]).replace(/\s+/g, ' ');
    expect(sqlItem).toMatch(/INSERT INTO obra_inventario_itens/i);
    expect(sqlItem).toMatch(/'sobra_entrega'/);
    const params = insItem[1] as unknown[];
    expect(params[0]).toBe(3);                       // obra_id da entrega
    expect(params[1]).toBe('Cimento CP-II 50kg');
    expect(params[2]).toBe('SC');                    // unidade normalizada
    expect(params[3]).toBe(3);                       // quantidade da sobra
    expect(params).toContain(9);                     // entrega_id (rastro)
    expect(params).toContain(71);                    // entrega_sobra_id (rastro)
    expect(String(params[4])).toContain('RE-2026-0009'); // observação cita a entrega

    const insFoto = p.execute.mock.calls[4];
    expect(String(insFoto[0])).toMatch(/INSERT INTO obra_inventario_fotos/i);
    const fParams = insFoto[1] as unknown[];
    expect(fParams).toContain('FOTOB64');            // foto reaproveitada
    expect(fParams).toContain(-4.9471);              // GPS reaproveitado
    expect(fParams).toContain(-47.4954);
  });

  it('quantidade NULL assume 1 e anota a suposição', async () => {
    p.execute
      .mockResolvedValueOnce([[ENTREGA]])
      .mockResolvedValueOnce([[{ id: 72, material: 'Restos de cabo 2,5mm', quantidade: null, unidade: null,
        foto_mime: null, foto_base64: null, observacao: null, latitude: null, longitude: null }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 502 }]);

    const r = await sincronizarSobrasDaEntrega(9);
    expect(r!.criados).toBe(1);
    const params = p.execute.mock.calls[3][1] as unknown[];
    expect(params[2]).toBe('UN');   // unidade default
    expect(params[3]).toBe(1);      // quantidade assumida
    expect(String(params[4])).toContain('quantidade não informada');
  });

  it('sobra editada → UPDATE espelha, mas nunca abaixo do já utilizado (clampa)', async () => {
    p.execute
      .mockResolvedValueOnce([[ENTREGA]])
      .mockResolvedValueOnce([[{ id: 71, material: 'Cimento CP-II 50kg', quantidade: '1.00', unidade: 'sc',
        foto_mime: null, foto_base64: null, observacao: null, latitude: null, longitude: null }]])
      .mockResolvedValueOnce([[{ id: 501, entrega_sobra_id: 71, quantidade_comprada: '3.000', quantidade_utilizada: '2.000' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE do item

    const r = await sincronizarSobrasDaEntrega(9);
    expect(r).toMatchObject({ atualizados: 1, criados: 0, removidos: 0 });
    const upd = p.execute.mock.calls[3];
    expect(String(upd[0])).toMatch(/UPDATE obra_inventario_itens/i);
    const params = upd[1] as unknown[];
    expect(params[2]).toBe(2);                 // clampado no utilizado (2), não 1
    expect(params[3]).toBe('total');           // status recalculado
    expect(String(params[4])).toContain('abaixo do já utilizado');
  });

  it('sobra removida: sem uso → DELETE do espelho; com uso → mantém e anota', async () => {
    p.execute
      .mockResolvedValueOnce([[ENTREGA]])
      .mockResolvedValueOnce([[]])             // entrega ficou sem sobras
      .mockResolvedValueOnce([[
        { id: 501, entrega_sobra_id: 71, quantidade_comprada: '3.000', quantidade_utilizada: '0.000' },
        { id: 502, entrega_sobra_id: 72, quantidade_comprada: '5.000', quantidade_utilizada: '4.000' },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // DELETE do 501
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE (anota) do 502

    const r = await sincronizarSobrasDaEntrega(9);
    expect(r).toMatchObject({ removidos: 1, mantidos_com_uso: 1 });
    expect(String(p.execute.mock.calls[3][0])).toMatch(/DELETE FROM obra_inventario_itens/i);
    const manter = p.execute.mock.calls[4];
    expect(String(manter[0])).toMatch(/UPDATE obra_inventario_itens/i);
    expect(String(manter[0])).toContain('já houve utilização');
  });

  it('vincularEntregaAObra recusa entrega de outra obra e de outro colaborador', async () => {
    p.execute.mockResolvedValueOnce([[{ obra_id: 5 }]]); // já vinculada à obra 5
    await expect(vincularEntregaAObra(9, 'u1', 3)).rejects.toThrow(/já vinculada/i);

    p.execute.mockReset();
    p.execute.mockResolvedValueOnce([[]]); // posse não confere
    await expect(vincularEntregaAObra(9, 'intruso', 3)).rejects.toThrow(/não encontrada/i);
  });
});

describe('Wire-up da ponte sobras→inventário (fonte) — v3.97.0', () => {
  const MIG = read('database', 'migrations-inventario-obra.ts');
  const ROTAS_ENTREGA = read('routes', 'obrasEntrega.ts');
  const ROTAS_INV = read('routes', 'inventarioObra.ts');
  const PAGE_INV = read('public', 'inventario-obra.html');
  const PAGE_ENTREGA = read('public', 'entrega-obra.html');

  it('migration adiciona origem sobra_entrega + rastro entrega_id/entrega_sobra_id (UNIQUE)', () => {
    expect(MIG).toMatch(/ENUM\('nota_fiscal','manual','sobra_entrega'\)/);
    expect(MIG).toMatch(/ADD COLUMN entrega_id INT UNSIGNED NULL/);
    expect(MIG).toMatch(/ADD COLUMN entrega_sobra_id INT UNSIGNED NULL/);
    expect(MIG).toMatch(/ADD UNIQUE KEY uq_inv_item_sobra \(entrega_sobra_id\)/);
  });

  it('as 4 mutações de materiais da Entrega disparam o sync (best-effort)', () => {
    const hooks = ROTAS_ENTREGA.match(/await syncInventario\(Number\(req\.params\.id\)\)/g) ?? [];
    expect(hooks.length).toBe(4); // PUT lote, POST, PUT unitário, DELETE
    expect(ROTAS_ENTREGA).toMatch(/sincronizarSobrasDaEntrega/);
    expect(ROTAS_ENTREGA).toMatch(/catch/); // falha do sync não derruba a entrega
  });

  it('router do inventário expõe listagem e importação de sobras', () => {
    expect(ROTAS_INV).toMatch(/'\/:obraId\/entregas-sobras'/);
    expect(ROTAS_INV).toMatch(/'\/:obraId\/entregas\/:entregaId\/importar-sobras'/);
    expect(ROTAS_INV).toMatch(/vincularEntregaAObra/);
  });

  it('UI: selo de origem + botão/modal de importação; texto da Entrega atualizado', () => {
    expect(PAGE_INV).toContain('sobra de entrega');
    expect(PAGE_INV).toContain('modalSobras');
    expect(PAGE_INV).toMatch(/importar-sobras/);
    expect(PAGE_ENTREGA).not.toContain('não movimenta estoque nesta fase');
    expect(PAGE_ENTREGA).toContain('Inventário de Obra'); // v3.98.0: módulo próprio
  });
});
