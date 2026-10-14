// v3.147.3 — Resposta automática curta: associado/estranho não conversa com a ZAYRA.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rowsMock = vi.fn();
vi.mock('./paDb', () => ({ pool: {}, rows: (...a: unknown[]) => rowsMock(...a), num: Number }));

import { decidirAutoResposta, variantesTelefone, mesmoTelefone, mensagemAssociado, _limparResfriamento } from './paAutoResposta';

const SILVANA = { id: 14, nome: 'SILVANA SOUSA', lote: '14', projeto: 'Projeto de Assentamento Salete Moreno' };
const CEO = '5599991811246';

describe('auto-resposta do WhatsApp do sistema', () => {
  beforeEach(() => { _limparResfriamento(); rowsMock.mockReset(); });

  it('casa número com e sem o 9º dígito', () => {
    expect(variantesTelefone('+55 55 99667-3942')).toEqual(['5555996673942', '555596673942']);
    expect(mesmoTelefone('555596673942', '(55) 99667-3942')).toBe(true);
    expect(mesmoTelefone('5599991811246', '5555996673942')).toBe(false);
  });

  it('CEO continua falando com a ZAYRA completa', async () => {
    expect(await decidirAutoResposta('5599991811246', Date.now(), CEO)).toEqual({ acao: 'ZAYRA' });
    expect(rowsMock).not.toHaveBeenCalled();
  });

  it('associado recebe resposta curta com o nome, o lote e o contato do CEO — e só uma vez', async () => {
    rowsMock.mockResolvedValue([SILVANA]);
    const t0 = Date.UTC(2026, 9, 14, 15, 34);
    const d = await decidirAutoResposta('555596673942', t0, CEO);
    expect(d.acao).toBe('RESPONDER');
    if (d.acao !== 'RESPONDER') return;
    expect(d.tipo).toBe('ASSOCIADO');
    expect(d.texto).toMatch(/^Boa tarde, Silvana!/);
    expect(d.texto).toContain('Lote 14');
    expect(d.texto).toContain('99181-1246');
    expect(d.texto).not.toMatch(/Chefe/);
    expect((await decidirAutoResposta('5555996673942', t0 + 60_000, CEO)).acao).toBe('SILENCIO');
    expect((await decidirAutoResposta('5555996673942', t0 + 7 * 3600_000, CEO)).acao).toBe('RESPONDER');
  });

  it('número desconhecido recebe a versão genérica (sem conversa)', async () => {
    rowsMock.mockResolvedValue([]);
    const d = await decidirAutoResposta('5511912345678', Date.now(), CEO);
    expect(d.acao === 'RESPONDER' && d.tipo).toBe('GENERICA');
  });

  it('sem CEO configurado, só associado é interceptado (não tranca o CEO)', async () => {
    rowsMock.mockResolvedValue([]);
    expect(await decidirAutoResposta('5511912345678', Date.now(), '')).toEqual({ acao: 'ZAYRA' });
    rowsMock.mockResolvedValue([SILVANA]);
    expect((await decidirAutoResposta('555596673942', Date.now(), '')).acao).toBe('RESPONDER');
  });

  it('saudação segue o horário de Brasília', () => {
    expect(mensagemAssociado(SILVANA, new Date(Date.UTC(2026, 9, 14, 11, 0)))).toMatch(/^Bom dia/);
    expect(mensagemAssociado(SILVANA, new Date(Date.UTC(2026, 9, 14, 23, 0)))).toMatch(/^Boa noite/);
  });
});
