// v3.24.5: tests da engine de Projeto Executivo.
// v3.24.6: REFATORADO pra nova estrutura (Honorarios + Despesas Admin separadas
// + Forma de Pagamento por TAG).
//
// Cobre:
// 1. round2 HALF_UP
// 2. Honorarios = area × R$/m² + ART/TRT
// 3. ART/TRT auto por area (toggle em 80m²)
// 4. Override manual respeita escolha
// 5. Despesas Admin (diligencia/alvara/placa) — fora dos honorarios
// 6. Parcelas 50/50 sempre fechando o total_honorarios
// 7. Taxa esboco fora do total_geral
// 8. Forma de pagamento por TAG (5 tags + custom)
// 9. Compat retro v3.24.5 (alvara_incluir/placa_incluir/desconto)
// 10. Defaults estaveis

import { describe, it, expect } from 'vitest';
import {
  calcularProjetoExecutivo,
  renderizarFormaPagamento,
  round2,
  DEFAULTS_PROJETO_EXECUTIVO,
  PROJETOS_DEFAULT_PROJETO_EXECUTIVO,
} from '../services/pricing/projetoExecutivo';
import type { InputProjetoExecutivo } from '../services/pricing/types';

function inputBase(over: Partial<InputProjetoExecutivo> = {}): InputProjetoExecutivo {
  return {
    endereco_obra: 'Rua Teste, 123',
    cidade_obra: 'Acailandia',
    uf_obra: 'MA',
    tipo_edificacao: 'residencial',
    area_construir: 100,
    valor_m2: 25,
    diligencia_secretaria: { incluir: false, valor: 0 },
    taxa_alvara_municipio: { incluir: false, valor: 0 },
    placa_obra: { incluir: false, valor: 0 },
    forma_pagamento_tag: 'sinal_mais_1',
    ...over,
    // override de retrocompat — campos legacy nao precisam mais
    alvara_incluir: false,
    alvara_valor: 0,
    placa_incluir: false,
    placa_valor: 0,
  };
}

describe('1. round2 (HALF_UP)', () => {
  it('arredonda 2.005 -> 2.01', () => {
    expect(round2(2.005)).toBe(2.01);
  });
  it('mantem 100 inteiro', () => {
    expect(round2(100)).toBe(100);
  });
});

describe('2. Honorarios = area × R$/m² + ART/TRT', () => {
  it('100m² × R$ 25 = R$ 2.500 (valor_projetos)', async () => {
    const r = await calcularProjetoExecutivo(inputBase());
    expect(r.projeto_executivo.honorarios.valor_projetos).toBe(2500);
  });

  it('subtotal_honorarios = projetos + ART (area 100m² > 80 = ART)', async () => {
    const r = await calcularProjetoExecutivo(inputBase());
    // 2500 + 233.94 ART = 2733.94
    expect(r.projeto_executivo.honorarios.subtotal_honorarios).toBe(2733.94);
  });

  it('rejeita area_construir <= 0', async () => {
    await expect(calcularProjetoExecutivo(inputBase({ area_construir: 0 }))).rejects.toThrow();
  });

  it('rejeita valor_m2 <= 0', async () => {
    await expect(calcularProjetoExecutivo(inputBase({ valor_m2: 0 }))).rejects.toThrow();
  });
});

describe('3. ART/TRT auto por area (toggle em 80m²)', () => {
  it('area 79m² -> TRT auto', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 79 }));
    expect(r.projeto_executivo.honorarios.responsabilidade_tipo).toBe('TRT');
    expect(r.projeto_executivo.honorarios.responsabilidade_auto).toBe(true);
    expect(r.projeto_executivo.honorarios.responsabilidade_valor).toBe(DEFAULTS_PROJETO_EXECUTIVO.TRT_VALOR);
  });

  it('area 80m² (limite) -> TRT', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 80 }));
    expect(r.projeto_executivo.honorarios.responsabilidade_tipo).toBe('TRT');
  });

  it('area 80.01m² -> ART', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 80.01 }));
    expect(r.projeto_executivo.honorarios.responsabilidade_tipo).toBe('ART');
  });

  it('area 200m² -> ART (R$ 233,94 default)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 200 }));
    expect(r.projeto_executivo.honorarios.responsabilidade_tipo).toBe('ART');
    expect(r.projeto_executivo.honorarios.responsabilidade_valor).toBe(233.94);
  });
});

describe('4. Override manual respeita escolha', () => {
  it('responsabilidade_auto=false + ART na area 50m² mantem ART', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 50,
      responsabilidade_auto: false,
      responsabilidade_tipo: 'ART',
    }));
    expect(r.projeto_executivo.honorarios.responsabilidade_tipo).toBe('ART');
    expect(r.projeto_executivo.honorarios.responsabilidade_auto).toBe(false);
  });

  it('responsabilidade_valor override usa valor informado', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ responsabilidade_valor: 150 }));
    expect(r.projeto_executivo.honorarios.responsabilidade_valor).toBe(150);
  });
});

describe('5. Despesas Administrativas — fora dos honorarios', () => {
  it('despesas NAO entram em total_honorarios', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 60, // TRT
      diligencia_secretaria: { incluir: true, valor: 700 },
      taxa_alvara_municipio: { incluir: true, valor: 450 },
      placa_obra: { incluir: true, valor: 280 },
    }));
    // Honorarios = projetos 1500 + TRT 68.17 = 1568.17
    expect(r.projeto_executivo.honorarios.total_honorarios).toBe(1568.17);
    // Despesas = 700 + 450 + 280 = 1430
    expect(r.projeto_executivo.despesas_administrativas.subtotal_despesas).toBe(1430);
    // Total geral = honorarios + despesas
    expect(r.projeto_executivo.resumo.total_geral).toBe(2998.17);
  });

  it('despesa desmarcada zera valor (mesmo se valor preenchido)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      diligencia_secretaria: { incluir: false, valor: 999 },
    }));
    expect(r.projeto_executivo.despesas_administrativas.diligencia_secretaria.valor).toBe(0);
    expect(r.projeto_executivo.despesas_administrativas.subtotal_despesas).toBe(0);
  });

  it('todas despesas incluidas somam corretamente', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      diligencia_secretaria: { incluir: true, valor: 800 },
      taxa_alvara_municipio: { incluir: true, valor: 500 },
      placa_obra: { incluir: true, valor: 350 },
    }));
    expect(r.projeto_executivo.despesas_administrativas.subtotal_despesas).toBe(1650);
  });
});

describe('6. Parcelas 50/50 sempre fechando total_honorarios', () => {
  it('parcela_inicial + parcela_final = total_honorarios (caso comum)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 100 }));
    const h = r.projeto_executivo.honorarios;
    expect(round2(h.parcela_inicial + h.parcela_final)).toBe(h.total_honorarios);
  });

  it('parcelas fecham mesmo com valor impar (centavos)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 73.5, valor_m2: 25.50,
    }));
    const h = r.projeto_executivo.honorarios;
    expect(round2(h.parcela_inicial + h.parcela_final)).toBe(h.total_honorarios);
  });

  it('desconto subtrai do total_honorarios', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 100,
      desconto_honorarios: 200,
    }));
    const h = r.projeto_executivo.honorarios;
    // Subtotal 2733.94 - desconto 200 = 2533.94
    expect(h.desconto_honorarios).toBe(200);
    expect(h.total_honorarios).toBe(2533.94);
  });

  it('compat: campo "desconto" antigo (v3.24.5) mapeia pra desconto_honorarios', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ desconto: 100 }));
    expect(r.projeto_executivo.honorarios.desconto_honorarios).toBe(100);
  });
});

describe('7. Taxa esboco INFORMATIVA — fora do total_geral', () => {
  it('taxa esboco 750 nao soma em total_geral', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 50 }));
    // Honorarios so: TRT (1250+68.17 = 1318.17), sem despesas
    expect(r.projeto_executivo.resumo.total_geral).toBe(1318.17);
    expect(r.projeto_executivo.taxa_esboco.valor).toBe(750);
    expect(r.projeto_executivo.taxa_esboco.cobranca_condicional).toBe(true);
  });

  it('taxa customizada respeita input', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ taxa_esboco: 1200 }));
    expect(r.projeto_executivo.taxa_esboco.valor).toBe(1200);
  });
});

describe('8. Forma de Pagamento por TAG', () => {
  it('default tag = sinal_mais_1 (50/50)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 100 }));
    expect(r.projeto_executivo.forma_pagamento.tag).toBe('sinal_mais_1');
    expect(r.projeto_executivo.forma_pagamento.texto_renderizado).toMatch(/SINAL/i);
    expect(r.projeto_executivo.forma_pagamento.texto_renderizado).toMatch(/ENTREGA/i);
  });

  it('tag integral gera texto "a vista"', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ forma_pagamento_tag: 'integral' }));
    expect(r.projeto_executivo.forma_pagamento.texto_renderizado).toMatch(/a vista/i);
  });

  it('tag personalizada usa custom', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      forma_pagamento_tag: 'personalizada',
      forma_pagamento_custom: '3x sem juros via PIX nos dias 5, 15 e 25.',
    }));
    expect(r.projeto_executivo.forma_pagamento.texto_renderizado).toContain('PIX');
  });

  it('tag duas_vezes gera 2 parcelas iguais', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ forma_pagamento_tag: 'duas_vezes' }));
    expect(r.projeto_executivo.forma_pagamento.texto_renderizado).toMatch(/2 \(duas\) parcelas/);
  });

  it('tag sinal_mais_2 gera 3 parcelas', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ forma_pagamento_tag: 'sinal_mais_2' }));
    expect(r.projeto_executivo.forma_pagamento.texto_renderizado).toMatch(/3 \(tres\) parcelas/);
  });

  it('renderizarFormaPagamento exportado standalone funciona', () => {
    const r = renderizarFormaPagamento('sinal_mais_1', 1000);
    expect(r.texto_renderizado).toMatch(/R\$ 500,00/);
  });
});

describe('9. Compat retro v3.24.5 (alvara_incluir/placa_incluir/desconto)', () => {
  it('alvara_incluir/alvara_valor legados mapeiam pra taxa_alvara_municipio', async () => {
    const r = await calcularProjetoExecutivo({
      ...inputBase(),
      alvara_incluir: true,
      alvara_valor: 600,
      taxa_alvara_municipio: undefined, // forca usar legacy
    });
    expect(r.projeto_executivo.despesas_administrativas.taxa_alvara_municipio.incluir).toBe(true);
    expect(r.projeto_executivo.despesas_administrativas.taxa_alvara_municipio.valor).toBe(600);
  });

  it('forma nova prevalece sobre legacy quando ambos presentes', async () => {
    const r = await calcularProjetoExecutivo({
      ...inputBase(),
      taxa_alvara_municipio: { incluir: true, valor: 700 },
      alvara_incluir: true,
      alvara_valor: 999, // ignorado
    });
    expect(r.projeto_executivo.despesas_administrativas.taxa_alvara_municipio.valor).toBe(700);
  });
});

describe('10. Defaults estaveis + Projetos', () => {
  it('valores default conhecidos', () => {
    expect(DEFAULTS_PROJETO_EXECUTIVO.VALOR_M2).toBe(25.00);
    expect(DEFAULTS_PROJETO_EXECUTIVO.TAXA_ESBOCO).toBe(750.00);
    expect(DEFAULTS_PROJETO_EXECUTIVO.ART_VALOR).toBe(233.94);
    expect(DEFAULTS_PROJETO_EXECUTIVO.TRT_VALOR).toBe(68.17);
    expect(DEFAULTS_PROJETO_EXECUTIVO.AREA_LIMITE_TRT).toBe(80.00);
  });

  it('PROJETOS_DEFAULT tem 7 itens com NBRs', () => {
    expect(PROJETOS_DEFAULT_PROJETO_EXECUTIVO).toHaveLength(7);
    expect(PROJETOS_DEFAULT_PROJETO_EXECUTIVO.find(p => p.codigo === 'arquitetonico')?.detalhamento_entrega).toMatch(/NBR 13531/);
  });

  it('projetos default selecionados = 6 (PCI vem desmarcado)', async () => {
    const r = await calcularProjetoExecutivo(inputBase());
    const selecionados = r.projeto_executivo.projetos_selecionados.filter(p => p.selecionado);
    expect(selecionados).toHaveLength(6);
  });
});

describe('11. CustosCalculados (compat com renderers genericos)', () => {
  it('secao_3_honorarios sempre tem 2 linhas (projetos + ART/TRT)', async () => {
    const r = await calcularProjetoExecutivo(inputBase());
    expect(r.custos.secao_3_honorarios).toHaveLength(2);
  });

  it('secao_2_taxas SO tem despesas que foram marcadas', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      diligencia_secretaria: { incluir: true, valor: 500 },
    }));
    expect(r.custos.secao_2_taxas).toHaveLength(1);
    expect(r.custos.secao_2_taxas[0].descricao).toMatch(/Diligencia/);
  });

  it('secao_5_total = total_geral (honorarios + despesas, sem taxa esboco)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      diligencia_secretaria: { incluir: true, valor: 500 },
    }));
    expect(r.custos.secao_5_total).toBe(r.projeto_executivo.resumo.total_geral);
  });

  it('aviso da taxa esboco aparece em avisos', async () => {
    const r = await calcularProjetoExecutivo(inputBase());
    expect(r.custos.avisos.some(a => /R\$ 750,00.*NAO esta incluida/.test(a))).toBe(true);
  });
});
