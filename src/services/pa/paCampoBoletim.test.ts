import { describe, it, expect } from 'vitest';
import { montarBoletim, textoBoletim, temaMapa, type LoteBoletim } from './paCampoBoletim';

const pag = (pagas: number, parcelas = 6) => ({ parcelas, pagas, pct: Math.round((pagas / parcelas) * 1000) / 10, quitado: pagas >= parcelas, marcos_lancados: true, marcos_pago: false });
const lote = (lote: string, o: Partial<LoteBoletim> = {}): LoteBoletim => ({
  lote, area_ha: 30, marcados: 0, exigidos: ['a', 'b', 'c', 'd'], prioridade: null, faixa: 'P0', fechado: null,
  associado: { nome: `ASSOCIADO ${lote}`, lote_vila: lote, denominacao: null }, pagamento: pag(0), ...o,
});

describe('v3.172.0 — boletim de campo', () => {
  const lotes = [
    lote('01', { fechado: { concluido_em: '2026-11-11 15:00:00', usuario_nome: 'Equipe' }, marcados: 4, faixa: 'QUITADO', pagamento: pag(6) }),
    lote('02', { fechado: { concluido_em: '2026-11-12 10:00:00', usuario_nome: 'Equipe' }, marcados: 4, faixa: 'P50', pagamento: pag(3) }),
    lote('03', { fechado: { concluido_em: '2026-11-12 16:00:00', usuario_nome: 'Equipe' }, marcados: 4, faixa: 'P50', pagamento: pag(3) }),
    lote('04', { prioridade: 1, faixa: 'QUITADO', pagamento: pag(6), marcados: 2 }),
    lote('05', { prioridade: 2, faixa: 'P75', pagamento: pag(5) }),
    lote('06', { prioridade: 3, faixa: 'SEM', pagamento: null, associado: null }),
  ];
  const producao = [
    { dia: '2026-11-11', usuario: 'Equipe', pontos: 6, lotes: 1, horas: 7 },
    { dia: '2026-11-12', usuario: 'Equipe', pontos: 9, lotes: 2, horas: 8 },
    { dia: '2026-11-12', usuario: 'Ajudante', pontos: 1, lotes: 0, horas: 1 },
  ];
  const b = montarBoletim({ lotes, producao, totais: { a_implantar: 24, marcados: 16, lotes: 6, fechados: 3 } }, '2026-11-12');

  it('evolução por dia com acumulado, ritmo e previsão', () => {
    expect(b.dias.map((d) => [d.dia, d.marcos, d.lotes, d.acum_lotes, d.pct])).toEqual([
      ['2026-11-11', 6, ['01'], 1, 16.7],
      ['2026-11-12', 10, ['02', '03'], 3, 50],
    ]);
    expect(b.dias[1].equipe).toEqual(['Ajudante', 'Equipe']);
    expect(b.medidos).toBe(3);
    expect(b.mediaLotes).toBe(1.5);
    expect(b.previsaoDias).toBe(2);
    expect(b.diaHoje?.lotes).toEqual(['02', '03']);
    expect(b.emAndamento).toEqual(['04']);
  });

  it('quitados primeiro na ordem de medição', () => {
    expect(b.quitados).toEqual({ total: 2, medidos: ['01'], aMedir: ['04'] });
    expect(b.aMedir.map((l) => l.lote)).toEqual(['04', '05', '06']);
    expect(b.faixas.find((f) => f.id === 'QUITADO')).toMatchObject({ aMedir: 1, medidos: 1 });
  });

  it('texto para o grupo: medidos do dia com o associado OK, sem fila/pagamento nem R$', () => {
    const t = textoBoletim(b, 'PA Salete Moreno');
    expect(t).toContain('*BOLETIM DE CAMPO — PA SALETE MORENO*');
    expect(t).toContain('12/11/2026 (quinta-feira)');
    expect(t).toContain('*Lotes medidos:* 3 de 6 (50%)');
    expect(t).toContain('*Hoje:* 2 lotes medidos (LT-02, LT-03) · 10 marcos cravados');
    expect(t).toContain('✅ *MEDIDOS HOJE — associados com o lote OK:*');
    expect(t).toContain('• LT-02 — ASSOCIADO 02 ✅');
    expect(t).toContain('• LT-03 — ASSOCIADO 03 ✅');
    expect(t).not.toMatch(/R\$|quitad|fila|ORDEM/i);
  });

  it('mapa do grupo: todo branco, só os medidos em destaque com o associado OK', () => {
    const tm = temaMapa(b, lotes);
    expect(tm['01']).toMatchObject({ cor: '#2E9D4F', rotulo: 'LT-01 ✓', sub: 'ASSOCIADO 01 — OK', destaque: true });
    expect(tm['02']).toMatchObject({ cor: '#F2C94C', rotulo: 'LT-02 ✓' }); // medido hoje
    expect(tm['05']).toMatchObject({ cor: '#FFFFFF', rotulo: 'LT-05' });
    expect(tm['05'].sub).toBeUndefined();
    expect(tm['04'].cor).toBe('#FFFFFF'); // em andamento ainda não destaca
  });
});
