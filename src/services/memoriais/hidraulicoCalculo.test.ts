// v3.49.2: testes do motor NBR 5626 (modulo Memoriais & Quantitativos).
// Regra de reservatorio adotada (RT): V = 2 x consumo, multiplo de 250 L.

import { describe, it, expect } from 'vitest';
import {
  calcularConsumoDiario,
  dimensionarReservatorio,
  calcularSomaPesos,
  detalharPesos,
  calcularVazaoProjeto,
  calcularVelocidade,
  validarVelocidade,
  dimensionarTrecho,
  perdaCargaFWH,
  calcularPressaoDinamica,
  calcularPressaoEstatica,
  validarPressao,
  calcularAquisicaoTubos,
  calcularInsumos,
  calcularResumo,
  PESOS_RELATIVOS,
  DIAMETROS_INTERNOS_MM,
  type DadosUso,
  type EntradaResumo,
} from './hidraulicoCalculo';

const usoNayara: DadosUso = {
  tipoUso: 'residencial',
  nUsuarios: 4,
  perCapita: 150,
  complementares: { lavagemRoupa: 120, limpezaExterna: 80 },
  reservaTecnicaPercent: 10,
  cotaFundoM: 4.0,
};

describe('calcularConsumoDiario', () => {
  it('residencial 4 moradores padrao NBR -> 880 L/dia', () => {
    expect(calcularConsumoDiario(usoNayara)).toBe(880);
  });
  it('sem complementares e sem reserva -> apenas moradores', () => {
    expect(
      calcularConsumoDiario({
        tipoUso: 'residencial', nUsuarios: 3, perCapita: 150,
        complementares: { lavagemRoupa: 0, limpezaExterna: 0 },
        reservaTecnicaPercent: 0,
      }),
    ).toBe(450);
  });
  it('per capita comercial alterado entra no calculo', () => {
    expect(
      calcularConsumoDiario({
        tipoUso: 'comercial', nUsuarios: 10, perCapita: 50,
        complementares: { lavagemRoupa: 0, limpezaExterna: 0 },
        reservaTecnicaPercent: 0,
      }),
    ).toBe(500);
  });
  it('nUsuarios < 1 -> throw', () => {
    expect(() => calcularConsumoDiario({ ...usoNayara, nUsuarios: 0 })).toThrow(/nUsuarios/);
  });
  it('perCapita <= 0 -> throw', () => {
    expect(() => calcularConsumoDiario({ ...usoNayara, perCapita: 0 })).toThrow(/perCapita/);
  });
});

describe('dimensionarReservatorio (regra 2x, mult. 250 L)', () => {
  it('880 L/dia -> 2000 L (2x = 1760 -> ceil 250)', () => {
    expect(dimensionarReservatorio(880)).toBe(2000);
  });
  it('500 L/dia -> 1000 L', () => {
    expect(dimensionarReservatorio(500)).toBe(1000);
  });
  it('625 L/dia -> 1250 L', () => {
    expect(dimensionarReservatorio(625)).toBe(1250);
  });
  it('consumo <= 0 -> throw', () => {
    expect(() => dimensionarReservatorio(0)).toThrow(/consumoDiario/);
  });
});

describe('calcularSomaPesos / detalharPesos (Anexo A NBR 5626:2020)', () => {
  it('projeto residencial Nayara Brito -> SP = 4,50', () => {
    const aparelhos = [
      { tipo: 'bacia_caixa_acoplada', qtd: 2 },
      { tipo: 'lavatorio', qtd: 2 },
      { tipo: 'chuveiro', qtd: 1 },
      { tipo: 'ducha_higienica', qtd: 1 },
      { tipo: 'pia_cozinha', qtd: 1 },
      { tipo: 'tanque', qtd: 1 },
      { tipo: 'maquina_lavar', qtd: 1 },
      { tipo: 'torneira_geral', qtd: 1 },
    ];
    expect(calcularSomaPesos(aparelhos)).toBeCloseTo(4.5, 2);
  });
  it('tipo desconhecido cai no fallback 0,30', () => {
    expect(calcularSomaPesos([{ tipo: 'inexistente_xyz', qtd: 2 }])).toBeCloseTo(0.6, 2);
  });
  it('detalharPesos exclui quantidade 0', () => {
    const d = detalharPesos([
      { tipo: 'tanque', qtd: 0 },
      { tipo: 'chuveiro', qtd: 2 },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].peso_total).toBeCloseTo(0.8, 2);
  });
  it('peso da ducha higienica e 0,10', () => {
    expect(PESOS_RELATIVOS.ducha_higienica).toBe(0.1);
  });
});

describe('calcularVazaoProjeto (Q = 0,3 x raiz(SP))', () => {
  it('SP = 4,50 -> Q = 0,6364 L/s', () => {
    expect(calcularVazaoProjeto(4.5)).toBeCloseTo(0.6364, 3);
  });
  it('SP = 1,00 -> Q = 0,3000 L/s', () => {
    expect(calcularVazaoProjeto(1.0)).toBeCloseTo(0.3, 3);
  });
  it('SP = 0 -> Q = 0', () => {
    expect(calcularVazaoProjeto(0)).toBe(0);
  });
  it('SP negativo -> throw', () => {
    expect(() => calcularVazaoProjeto(-1)).toThrow(/somaPesos/);
  });
});

describe('calcularVelocidade / validarVelocidade (NBR 5626 item 5.3.2)', () => {
  it('DN 50 (dInt 44), Q=0,636 -> v ~ 0,42 m/s', () => {
    expect(calcularVelocidade(0.636, 44.0)).toBeCloseTo(0.42, 1);
  });
  it('DN 20 (dInt 17), Q=0,30 -> v ~ 1,32 m/s', () => {
    expect(calcularVelocidade(0.3, 17.0)).toBeCloseTo(1.32, 1);
  });
  it('dInt <= 0 -> throw', () => {
    expect(() => calcularVelocidade(0.3, 0)).toThrow(/dInt/);
  });
  it('1,32 m/s -> OK', () => expect(validarVelocidade(1.32)).toBe('OK'));
  it('2,80 m/s -> ALERTA', () => expect(validarVelocidade(2.8)).toBe('ALERTA'));
  it('3,50 m/s -> REPROVADO', () => expect(validarVelocidade(3.5)).toBe('REPROVADO'));
});

describe('dimensionarTrecho', () => {
  it('SP=0 -> menor DN, v=0, OK', () => {
    const t = dimensionarTrecho('teste', 0);
    expect(t.dn_mm).toBe(20);
    expect(t.velocidade_ms).toBe(0);
    expect(t.status).toBe('OK');
  });
  it('SP=4,5 -> escolhe DN com v <= 3,0 m/s', () => {
    const t = dimensionarTrecho('barrilete', 4.5);
    expect(t.velocidade_ms).toBeLessThanOrEqual(3.0);
    expect(t.status).not.toBe('REPROVADO');
  });
  it('SP gigante -> REPROVADO no maior DN', () => {
    const t = dimensionarTrecho('absurdo', 10000);
    expect(t.dn_mm).toBe(50);
    expect(t.status).toBe('REPROVADO');
  });
});

describe('perdaCargaFWH / pressoes (NBR 5626 item 5.2)', () => {
  it('FWH retorna perda positiva', () => {
    const hf = perdaCargaFWH(0.3, 17.0, 8.0);
    expect(hf).toBeGreaterThan(0);
  });
  it('FWH dInt invalido -> throw', () => {
    expect(() => perdaCargaFWH(0.3, 0, 8)).toThrow(/dInt/);
  });
  it('Pd: dh=3,20 hf=0,55 -> ~26,0 kPa', () => {
    expect(calcularPressaoDinamica(3.2, 0.55)).toBeCloseTo(25.9, 0);
  });
  it('Pe: 4,0 m -> 39,24 kPa', () => {
    expect(calcularPressaoEstatica(4.0)).toBeCloseTo(39.24, 1);
  });
  it('26,0 kPa >= 10 -> OK', () => expect(validarPressao(26.0, 10)).toBe('OK'));
  it('8,0 kPa < 10 -> REPROVADO', () => expect(validarPressao(8.0, 10)).toBe('REPROVADO'));
});

describe('calcularAquisicaoTubos (barras de 6m, 10% perda)', () => {
  it('DN 20 com 27,17m -> 5 barras, 30m', () => {
    const r = calcularAquisicaoTubos([{ dn_mm: 20, comprimento_m: 27.17 }]);
    expect(r[0].barras_6m).toBe(5);
    expect(r[0].total_adquirir_m).toBe(30);
  });
  it('DN 32 com 4,48m -> 1 barra, 6m', () => {
    const r = calcularAquisicaoTubos([{ dn_mm: 32, comprimento_m: 4.48 }]);
    expect(r[0].barras_6m).toBe(1);
    expect(r[0].total_adquirir_m).toBe(6);
  });
  it('todo total e multiplo de 6 e cobre o comprimento + 10%', () => {
    const tubos = [
      { dn_mm: 20, comprimento_m: 27.17 },
      { dn_mm: 25, comprimento_m: 17.82 },
      { dn_mm: 32, comprimento_m: 4.48 },
      { dn_mm: 50, comprimento_m: 17.92 },
    ];
    calcularAquisicaoTubos(tubos).forEach((l) => {
      expect(l.total_adquirir_m % 6).toBe(0);
      expect(l.total_adquirir_m).toBeGreaterThanOrEqual(l.qtd_com_perda_m);
    });
  });
});

describe('calcularInsumos', () => {
  it('proporcional, sempre >= 1', () => {
    const ins = calcularInsumos({ totalConexoes: 46, totalTubos_m: 67.39, totalRegistros: 9 });
    expect(ins.find((i) => i.descricao.includes('Adesivo'))!.qtd).toBe(2);
    expect(ins.every((i) => i.qtd >= 1)).toBe(true);
  });
});

describe('calcularResumo (Passo 5 — cenario Nayara Brito)', () => {
  const entrada: EntradaResumo = {
    dadosObra: {
      titulo: 'Residencia Unifamiliar Terrea',
      endereco: 'Rua Local 18, Qd 43, Lt 17',
      municipio: 'Acailandia', uf: 'MA',
      proprietario: 'Nayara Brito Silva',
      cpfCnpj: '614.363.953-13',
      areaM2: 78.69, nPavimentos: 1, prancha: 'PH-03',
    },
    dadosUso: usoNayara,
    tubulacoes: [
      { dn_mm: 20, comprimento_m: 27.17 },
      { dn_mm: 25, comprimento_m: 17.82 },
      { dn_mm: 32, comprimento_m: 4.48 },
      { dn_mm: 50, comprimento_m: 17.92 },
    ],
    conexoes: [{ descricao: 'Joelho 90 soldavel', dn_mm: 25, qtd: 46 }],
  };

  it('consumo 880, reservatorio 2000', () => {
    const r = calcularResumo(entrada);
    expect(r.consumoDiario).toBe(880);
    expect(r.volumeReservatorio).toBe(2000);
  });
  it('SP=4,50 e vazao ~0,636 L/s', () => {
    const r = calcularResumo(entrada);
    expect(r.somaPesos).toBeCloseTo(4.5, 2);
    expect(r.vazaoTotal_ls).toBeCloseTo(0.636, 2);
  });
  it('todos os status normativos OK', () => {
    const r = calcularResumo(entrada);
    expect(r.statusNormativo.pressaoDinamicaOK).toBe(true);
    expect(r.statusNormativo.pressaoEstaticaOK).toBe(true);
    expect(r.statusNormativo.velocidadeOK).toBe(true);
    expect(r.statusNormativo.reservatorioOK).toBe(true);
    expect(r.statusNormativo.registrosOK).toBe(true);
  });
  it('totais agregados coerentes', () => {
    const r = calcularResumo(entrada);
    expect(r.totalTubos_m).toBeCloseTo(67.39, 2);
    expect(r.totalConexoes).toBe(46);
    expect(r.totalRegistros).toBeGreaterThan(0);
    expect(r.totalAparelhos).toBeGreaterThan(0);
    expect(r.totalInsumos).toBeGreaterThan(0);
    expect(r.aquisicaoTubos).toHaveLength(4);
  });
  it('usa aparelhos informados quando presentes', () => {
    const r = calcularResumo({
      ...entrada,
      aparelhos: [{ tipo: 'chuveiro', qtd: 1 }],
    });
    expect(r.somaPesos).toBeCloseTo(0.4, 2);
  });
  it('DIAMETROS_INTERNOS_MM cobre DN 20..50', () => {
    expect(DIAMETROS_INTERNOS_MM[20]).toBe(17.0);
    expect(DIAMETROS_INTERNOS_MM[50]).toBe(44.0);
  });
});

describe('calcularResumo — ramos adicionais (cobertura)', () => {
  const base = {
    dadosObra: {
      titulo: 'X', endereco: 'Y', municipio: 'Acailandia', uf: 'MA',
      proprietario: 'Z', cpfCnpj: '000', areaM2: 80, nPavimentos: 1, prancha: 'PH-03',
    },
    dadosUso: usoNayara,
    tubulacoes: [{ dn_mm: 20, comprimento_m: 27.17 }],
  };
  it('usa registros e conexoes informados quando presentes', () => {
    const r = calcularResumo({
      ...base,
      conexoes: [{ qtd: 10 }, { qtd: 5 }],
      registros: [{ descricao: 'Registro X', dn_mm: 25, qtd: 3 }],
    });
    expect(r.totalConexoes).toBe(15);
    expect(r.totalRegistros).toBe(3);
  });
  it('sem conexoes -> totalConexoes 0 e vazao_m3h derivada de vazao_ls', () => {
    const r = calcularResumo(base);
    expect(r.totalConexoes).toBe(0);
    expect(r.vazaoTotal_m3h).toBeCloseTo(r.vazaoTotal_ls * 3.6, 3);
  });
  it('cota baixa gera alerta de pressao REPROVADA', () => {
    const r = calcularResumo({ ...base, dadosUso: { ...usoNayara, cotaFundoM: 1.7 } });
    expect(r.statusNormativo.pressaoDinamicaOK).toBe(false);
    expect(r.alertas.some((a) => /Pressao/.test(a))).toBe(true);
  });
});
