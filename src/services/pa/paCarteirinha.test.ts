// v3.148.0 — Carteirinha: HTML a partir do cadastro (sem banco).
import { describe, it, expect, vi } from 'vitest';
vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(), one: vi.fn(), exec: vi.fn(), num: Number, isoDate: (v: unknown) => v, registrarEvento: vi.fn() }));
import { htmlCarteirinhas, lerIds, textoQr } from './paCarteirinha';

const p = { codigo: 'PA-X', nome: 'Projeto de Assentamento Teste', municipio: 'Açailândia', uf: 'MA', associacao_nome: null, presidente_nome: null } as never;
const a = (n: number, foto: string | null = null) => ({ associado_id: n, numero: `PASM-00${n}`, nome: `ASSOCIADO <TESTE> ${n}`, cpf: '000.000.000-00', lote: String(n).padStart(2, '0'), terra: null, nascimento: null, telefone: null, conjuge: null, foto });

describe('carteirinha do associado', () => {
  it('4 cartões por página, frente e verso, dados escapados', async () => {
    const html = await htmlCarteirinhas(p, [1, 2, 3, 4, 5].map((n) => a(n)), '14/10/2026');
    expect((html.match(/class="pag"/g) || []).length).toBe(2);
    expect((html.match(/class="card frente"/g) || []).length).toBe(5);
    expect((html.match(/class="card verso"/g) || []).length).toBe(5);
    expect(html).toContain('ASSOCIADO &lt;TESTE&gt; 1');
    expect(html).not.toContain('<TESTE>');
    expect(html).toContain('Emitida em 14/10/2026');
  });
  it('usa a foto do cadastro quando existe e as iniciais quando não', async () => {
    const html = await htmlCarteirinhas(p, [a(1, 'data:image/jpeg;base64,AAAA'), a(2)], '14/10/2026');
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
    expect(html).toMatch(/<div class="foto"><span>A[^<]*<\/span>/);
  });
  it('lê lista de ids e monta o texto do QR', () => {
    expect(lerIds('3, 1,3,x,0')).toEqual([3, 1]);
    expect(lerIds('')).toBeNull();
    expect(textoQr(p, a(7))).toContain('PASM-007 — Lote 07');
  });
});
