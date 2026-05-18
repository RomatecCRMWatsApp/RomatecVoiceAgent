import { describe, it, expect } from 'vitest';
import {
  validarRinexParaSubmissao,
  classificarPapelRinex,
  classificarPapelRetornoIbge,
} from './processamentoService';

describe('classificarPapelRinex', () => {
  it('.26o => rinex_obs', () => expect(classificarPapelRinex('M01.26o')).toBe('rinex_obs'));
  it('.26n => rinex_nav_gps', () => expect(classificarPapelRinex('M01.26n')).toBe('rinex_nav_gps'));
  it('.26g => rinex_nav_glo', () => expect(classificarPapelRinex('M01.26g')).toBe('rinex_nav_glo'));
  it('.26l => rinex_nav_gal', () => expect(classificarPapelRinex('M01.26l')).toBe('rinex_nav_gal'));
  it('.rnx => rinex_rnx3', () => expect(classificarPapelRinex('SSSS00BRA_R_20261381430_01H_30S_MO.rnx')).toBe('rinex_rnx3'));
  it('desconhecido => outro', () => expect(classificarPapelRinex('xyz.bin')).toBe('outro'));
});

describe('classificarPapelRetornoIbge', () => {
  it('.txt => ibge_txt', () => expect(classificarPapelRetornoIbge('relatorio.txt')).toBe('ibge_txt'));
  it('.pdf => ibge_pdf', () => expect(classificarPapelRetornoIbge('relatorio.pdf')).toBe('ibge_pdf'));
  it('.kml => ibge_kml', () => expect(classificarPapelRetornoIbge('ponto.kml')).toBe('ibge_kml'));
  it('.pos => ibge_pos', () => expect(classificarPapelRetornoIbge('solucao.pos')).toBe('ibge_pos'));
});

describe('validarRinexParaSubmissao', () => {
  it('aceita 1h de rastreio com GPS+GLO', () => {
    const r = validarRinexParaSubmissao({
      durationSeconds: 3600, systems: ['GPS', 'GLO'], antennaHeightM: 1.58,
    });
    expect(r.ok).toBe(true);
    expect(r.bloqueia).toBe(false);
  });

  it('bloqueia se duracao < 5min', () => {
    const r = validarRinexParaSubmissao({
      durationSeconds: 200, systems: ['GPS'], antennaHeightM: 1.5,
    });
    expect(r.ok).toBe(false);
    expect(r.bloqueia).toBe(true);
    expect(r.mensagens.join(' ')).toMatch(/duracao/i);
  });

  it('warning se duracao entre 5min e 20min', () => {
    const r = validarRinexParaSubmissao({
      durationSeconds: 600, systems: ['GPS'], antennaHeightM: 1.5,
    });
    expect(r.ok).toBe(true);
    expect(r.bloqueia).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('warning se altura antena suspeita (> 5m)', () => {
    const r = validarRinexParaSubmissao({
      durationSeconds: 3600, systems: ['GPS'], antennaHeightM: 9.0,
    });
    expect(r.warnings.some(w => /antena/i.test(w))).toBe(true);
  });

  it('warning se faltar arquivo de navegacao GPS', () => {
    const r = validarRinexParaSubmissao({
      durationSeconds: 3600, systems: ['GPS'], antennaHeightM: 1.5,
      papeisCarregados: ['rinex_obs'],
    });
    expect(r.warnings.some(w => /navegacao/i.test(w))).toBe(true);
  });
});
