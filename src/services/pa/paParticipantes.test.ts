// v3.150.0 — Participantes do lote e controle do grupo do WhatsApp.
import { describe, it, expect, vi } from 'vitest';
vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(), one: vi.fn(), exec: vi.fn(), num: Number, isoDate: (v: unknown) => v ?? null, isoDateTime: (v: unknown) => v ?? null, registrarEvento: vi.fn() }));
vi.mock('./paRepo', () => ({ buscarProjeto: vi.fn() }));
import { cruzarGrupo, lerParticipante, type Participante } from './paParticipantes';

const part = (o: Partial<Participante>): Participante => ({ id: 1, associado_id: 1, nome: 'JOSÉ', vinculo: 'CÔNJUGE', cpf: null, rg: null, nascimento: null, telefone: null, telefone_e164: null, email: null, responsavel_campo: true, grupo_whatsapp_manual: null, obs: null, criado_em: null, ...o });

describe('grupo do WhatsApp', () => {
  const lotes = [
    { associado_id: 1, lote: '01', numero: 'P1', nome: 'MARIA', telefone_e164: '+5599911110000', manual: null, participantes: [part({ id: 10, telefone_e164: '+5599922220000' })] },
    { associado_id: 2, lote: '02', numero: 'P2', nome: 'ANA', telefone_e164: '+5599933330000', manual: null, participantes: [] },
    { associado_id: 3, lote: '03', numero: 'P3', nome: 'RITA', telefone_e164: null, manual: 'SIM' as const, participantes: [] },
  ];
  it('lote conta como no grupo se o titular OU o participante estiver; casa com e sem o 9º dígito', () => {
    // esposo no grupo com número sem o 9; titular fora
    const r = cruzarGrupo(lotes, ['559922220000', '5599933330000', '5511999990000']);
    expect(r.lotes[0].algum_no_grupo).toBe(true);
    expect(r.lotes[0].pessoas.map((p) => p.no_grupo)).toEqual([false, true]);
    expect(r.lotes[1].algum_no_grupo).toBe(true);
    expect(r.lotes[2].pessoas[0]).toMatchObject({ no_grupo: true, origem: 'MANUAL' });
    expect(r.desconhecidos).toEqual(['5511999990000']);
  });
  it('marcação manual "não está" vence a leitura do grupo', () => {
    const r = cruzarGrupo([{ ...lotes[1], manual: 'NAO' }], ['5599933330000']);
    expect(r.lotes[0].pessoas[0]).toMatchObject({ no_grupo: false, origem: 'MANUAL' });
    expect(r.desconhecidos).toEqual([]);
  });
});

describe('participante do lote', () => {
  it('normaliza nome, telefone e vínculo; CPF inválido barra', () => {
    const { dados } = lerParticipante({ nome: 'joão da silva', vinculo: 'cônjuge', telefone: '(99) 98111-2222', responsavel_campo: true });
    expect(dados).toMatchObject({ nome: 'JOÃO DA SILVA', vinculo: 'CÔNJUGE', telefone_e164: '+5599981112222', responsavel_campo: 1 });
    expect(() => lerParticipante({ nome: 'x', cpf: '111.111.111-11' })).toThrow(/CPF/);
    expect(() => lerParticipante({ nome: ' ' })).toThrow(/obrigatório/);
    expect(lerParticipante({ nome: 'x', nascimento: '05/03/1990' }).dados.nascimento).toBe('1990-03-05');
  });
});
