// v3.116.0: o tool que finalmente liga o modulo esportivo a ZAYRA.
//
// Tres coisas precisam continuar verdadeiras, e nenhuma delas e obvia olhando o
// codigo depois de alguns meses:
//
// 1. CABER NO TETO. Os providers (OpenAI/Anthropic) cortam em 128 tools. O
//    projeto ja passou disso uma vez (132) e a saida foi desabilitar tools. Se
//    alguem reativar um grupo sem conferir, o agente inteiro quebra — nao so a
//    feature nova.
// 2. SER RESTRITA AO CEO. A secao 0 da spec e explicita: colaborador nao deve ter
//    acesso nem saber que existe.
// 3. NAO GANHAR TELA. A spec pede aptidao de chat/voz, sem menu nem rota.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const toolsTs = readFileSync(join(SRC, 'agent', 'tools.ts'), 'utf8');
const serverTs = readFileSync(join(SRC, 'server.ts'), 'utf8');

const NOME = 'consultar_probabilidades_esportivas';

/** Reproduz o filtro real: definidas menos DISABLED_TOOLS. */
function contarTools() {
  const ini = toolsTs.indexOf('DISABLED_TOOLS = new Set');
  const bloco = toolsTs.slice(ini, toolsTs.indexOf(']);', ini));
  const desabilitadas = new Set((bloco.match(/'[a-z_0-9]+'/gi) || []).map((x) => x.slice(1, -1)));
  const definidas = (toolsTs.match(/^\s*name: '[a-zA-Z_0-9]+'/gm) || []).map((x) => x.split("'")[1]);
  return { definidas, desabilitadas, ativas: definidas.filter((t) => !desabilitadas.has(t)) };
}

describe('tool esportiva — teto de 128 dos providers', () => {
  it('1. o total de tools ativas cabe no limite', () => {
    const { ativas } = contarTools();
    expect(ativas.length, `${ativas.length} tools ativas — o limite dos providers e 128`)
      .toBeLessThanOrEqual(128);
  });

  it('2. sobra folga pra proxima feature (nao ficamos colados no teto)', () => {
    const { ativas } = contarTools();
    expect(128 - ativas.length).toBeGreaterThanOrEqual(5);
  });

  it('3. a tool esportiva esta ATIVA (senao a ZAYRA nao a enxerga)', () => {
    expect(contarTools().ativas).toContain(NOME);
  });

  it('4. as desabilitadas continuam definidas — codigo preservado, so fora do cardapio', () => {
    const { definidas } = contarTools();
    for (const t of ['drive_listar', 'crm_criar_lead', 'status_railway']) {
      expect(definidas, `${t} sumiu da definicao; deveria estar so desabilitada`).toContain(t);
    }
  });
});

describe('tool esportiva — restrita ao CEO (secao 0 da spec)', () => {
  it('5. esta em ADMIN_ONLY_TOOLS', () => {
    const ini = toolsTs.indexOf('ADMIN_ONLY_TOOLS = new Set');
    const bloco = toolsTs.slice(ini, toolsTs.indexOf(']);', ini));
    expect(bloco).toContain(NOME);
  });

  it('6. o gate de ADMIN_ONLY_TOOLS continua sendo aplicado no executeTool', () => {
    // Se alguem remover essa checagem, a tool vira publica sem nenhum aviso.
    expect(toolsTs).toMatch(/ADMIN_ONLY_TOOLS\.has\(name\)/);
    expect(toolsTs).toMatch(/caller\.role !== 'admin'/);
  });
});

describe('tool esportiva — sem tela, conforme a spec', () => {
  it('7. o modulo esportivo tem no maximo a rota de diagnostico', () => {
    const rotas = serverTs.split('\n').filter((l) => /^app\.(get|post|put|delete)\('\/api\/esportes/.test(l.trim()));
    expect(rotas.length, `rotas de esportes:\n${rotas.join('\n')}`).toBe(1);
    expect(rotas[0]).toContain('/api/esportes/diagnostico');
  });

  it('8. nenhuma aba/menu de esportes no front da gestao de obras', () => {
    const obras = readFileSync(join(SRC, 'public', 'obras.html'), 'utf8');
    expect(obras).not.toMatch(/data-tab="esportes"/);
    expect(obras).not.toMatch(/view-esportes/);
  });
});

describe('tool esportiva — contrato da resposta', () => {
  it('9. o handler existe e chama o orquestrador sob demanda', () => {
    expect(toolsTs).toContain(`case '${NOME}'`);
    expect(toolsTs).toContain('consultaEsportiva');
  });

  it('10. a descricao avisa que sao estimativas, nao garantia', () => {
    const i = toolsTs.indexOf(`name: '${NOME}'`);
    const trecho = toolsTs.slice(i, i + 1200);
    expect(trecho).toMatch(/estimativas estatisticas|nunca garantia/i);
  });
});
