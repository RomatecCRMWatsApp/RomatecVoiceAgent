// v3.43.0: adicional de campo (insal/peric) e' OBRIGATORIO em demarcacao_rural.
// Trabalho em mata rural SEMPRE expoe a riscos biologicos (Anexo 14 NR-15).
// O adicional nao e' discricionario — e' exigencia legal (CLT art. 192).
//
// Antes (v3.42.0 e anterior): se o user nao selecionasse cenario no wizard,
// o adicional nao aparecia no PDF. Resultado: propostas saem sem o box
// juridico, expondo Romatec a passivos trabalhistas.
//
// Agora (v3.43.0): helper `aplicarAdicionalObrigatorioDemarcacao()` FORCE
// default mata_densa_animais + insalubridade Grau Medio (20%) quando o
// caller nao envia adicional ativo. Para urbana continua opcional.

import { describe, it, expect } from 'vitest';
import { aplicarAdicionalObrigatorioDemarcacao } from '../services/pdf/adicionalObrigatorio';

describe('v3.43.0 — aplicarAdicionalObrigatorioDemarcacao()', () => {
  it('1. demarcacao_rural sem adicional -> FORCA default mata_densa_animais + insal medio', () => {
    const r = aplicarAdicionalObrigatorioDemarcacao('demarcacao_rural', null);
    expect(r).not.toBeNull();
    expect(r!.ativo).toBe(true);
    expect(r!.cenario).toBe('mata_densa_animais');
    expect(r!.tipo).toBe('insalubridade');
    expect(r!.grau).toBe('medio');
  });

  it('2. demarcacao_rural com adicional inativo -> FORCA default', () => {
    const r = aplicarAdicionalObrigatorioDemarcacao('demarcacao_rural', { ativo: false });
    expect(r).not.toBeNull();
    expect(r!.ativo).toBe(true);
    expect(r!.cenario).toBe('mata_densa_animais');
    expect(r!.grau).toBe('medio');
  });

  it('3. demarcacao_rural com adicional incompleto (so ativo=true) -> FORCA default', () => {
    const r = aplicarAdicionalObrigatorioDemarcacao('demarcacao_rural', { ativo: true });
    expect(r).not.toBeNull();
    expect(r!.cenario).toBe('mata_densa_animais');
  });

  it('4. demarcacao_rural com adicional completo (user escolheu) -> RESPEITA o que veio', () => {
    const r = aplicarAdicionalObrigatorioDemarcacao('demarcacao_rural', {
      ativo: true,
      cenario: 'rodovia_faixa_dominio',
      tipo: 'periculosidade',
      grau: 'unico',
    });
    expect(r).not.toBeNull();
    expect(r!.cenario).toBe('rodovia_faixa_dominio');
    expect(r!.tipo).toBe('periculosidade');
    expect(r!.grau).toBe('unico');
  });

  it('5. demarcacao_rural com adicional + observacao -> preserva campos extras', () => {
    const r = aplicarAdicionalObrigatorioDemarcacao('demarcacao_rural', {
      ativo: true,
      cenario: 'mata_densa_animais',
      tipo: 'insalubridade',
      grau: 'medio',
      observacao_adicional: 'Area com abelhas africanizadas confirmada por morador',
      bloco_enquadramento_tecnico_editado: 'Texto custom do enquadramento',
    });
    expect(r!.observacao_adicional).toBe('Area com abelhas africanizadas confirmada por morador');
    expect(r!.bloco_enquadramento_tecnico_editado).toBe('Texto custom do enquadramento');
  });

  it('6. demarcacao_urbana sem adicional -> NAO forca (continua opcional)', () => {
    const r = aplicarAdicionalObrigatorioDemarcacao('demarcacao_urbana', null);
    expect(r).toBeNull();
  });

  it('7. demarcacao_urbana com adicional ativo -> respeita o user', () => {
    const r = aplicarAdicionalObrigatorioDemarcacao('demarcacao_urbana', {
      ativo: true,
      cenario: 'eletricidade_alta_tensao',
      tipo: 'periculosidade',
      grau: 'unico',
    });
    expect(r).not.toBeNull();
    expect(r!.cenario).toBe('eletricidade_alta_tensao');
  });

  it('8. demarcacao_urbana com adicional incompleto -> aplica fallback minimo', () => {
    const r = aplicarAdicionalObrigatorioDemarcacao('demarcacao_urbana', { ativo: true });
    expect(r).not.toBeNull();
    expect(r!.cenario).toBe('mata_densa_animais'); // fallback
    expect(r!.grau).toBe('minimo'); // urbana defaulta minimo
  });

  it('9. Outros subtipos (georref, averbacao) -> NAO forca', () => {
    const r1 = aplicarAdicionalObrigatorioDemarcacao('georreferenciamento_rural', null);
    expect(r1).toBeNull();
    const r2 = aplicarAdicionalObrigatorioDemarcacao('averbacao_residencial', null);
    expect(r2).toBeNull();
  });

  it('10. undefined input -> demarcacao_rural ainda forca', () => {
    const r = aplicarAdicionalObrigatorioDemarcacao('demarcacao_rural', undefined);
    expect(r).not.toBeNull();
    expect(r!.cenario).toBe('mata_densa_animais');
  });
});

// Smoke test do flow: o helper esta sendo chamado nos 3 lugares chave?
import fs from 'node:fs';
import path from 'node:path';

const PROPOSTAS_CONS_TS = fs.readFileSync(
  path.join(process.cwd(), 'src', 'integrations', 'propostasConsultoria.ts'),
  'utf-8',
);

describe('v3.43.0 — helper aplicado nos 3 caminhos (create + preview + edit)', () => {
  it('11. calcularConsultoria (criar) chama aplicarAdicionalObrigatorioDemarcacao', () => {
    // Procura no contexto de criarPropostaConsultoria
    const m = PROPOSTAS_CONS_TS.match(/calcularConsultoria[\s\S]{0,4000}?aplicarAdicionalObrigatorioDemarcacao\(subtipo, input\.adicional_campo\)/);
    expect(m).not.toBeNull();
  });

  it('12. previewCustoConsultoria chama aplicarAdicionalObrigatorioDemarcacao', () => {
    const m = PROPOSTAS_CONS_TS.match(/previewCustoConsultoria[\s\S]{0,4000}?aplicarAdicionalObrigatorioDemarcacao\(subtipo, input\.adicional_campo\)/);
    expect(m).not.toBeNull();
  });

  it('13. atualizarPropostaConsultoria chama aplicarAdicionalObrigatorioDemarcacao com adicionalSnap', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/aplicarAdicionalObrigatorioDemarcacao\(subtipo, adicionalSnap\)/);
  });

  it('14. Snapshot regenerado quando edit forca default (cria adicional_campo no custos)', () => {
    // No edit, se adicionalSnap NAO existia mas o force-default ativou, regenera o snapshot
    expect(PROPOSTAS_CONS_TS).toMatch(/else if \(adicionalEfetivo\?\.ativo\)[\s\S]{0,1500}?calcularAdicionalCampo/);
  });
});
