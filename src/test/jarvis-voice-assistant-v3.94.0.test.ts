// v3.94.0 — ZAYRA Jarvis: assistente por voz no painel (porta o espírito do
// jarvis.py de github.com/hectorg2211/jarvis pro navegador). Feature de front
// puro (Web Audio + SpeechRecognition + SpeechSynthesis), então o teste protege
// a presença dos pilares na fonte + a injeção no obras.html + sintaxe válida.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const pub = (f: string) => readFileSync(join(process.cwd(), 'src', 'public', f), 'utf8');
const JARVIS = pub('jarvis.js');
const OBRAS = pub('obras.html');

describe('ZAYRA Jarvis — assistente por voz (v3.94.0)', () => {
  it('jarvis.js tem sintaxe JS válida', () => {
    expect(() => execFileSync(process.execPath, ['--check', join(process.cwd(), 'src', 'public', 'jarvis.js')]))
      .not.toThrow();
  });

  it('expõe a API global window.ZayraJarvis', () => {
    expect(JARVIS).toMatch(/window\.ZayraJarvis\s*=\s*\{/);
    expect(JARVIS).toMatch(/register:\s*register/);
    expect(JARVIS).toMatch(/speak:\s*speak/);
  });

  it('detecção de palma dupla porta o algoritmo do jarvis.py (RMS + piso adaptativo)', () => {
    expect(JARVIS).toMatch(/getUserMedia/);
    expect(JARVIS).toMatch(/createAnalyser|AnalyserNode|getFloatTimeDomainData/);
    expect(JARVIS).toMatch(/noiseFloor/);
    expect(JARVIS).toMatch(/spikeRatio/);
    expect(JARVIS).toMatch(/minGapS[\s\S]{0,200}maxGapS|maxGapS/);
    expect(JARVIS).toMatch(/function detectClap/);
  });

  it('ativação por palavra "Zayra" via SpeechRecognition', () => {
    expect(JARVIS).toMatch(/SpeechRecognition|webkitSpeechRecognition/);
    expect(JARVIS).toMatch(/wakeWords/);
    expect(JARVIS).toMatch(/'zayra'|"zayra"/i);
  });

  it('TTS pela voz do navegador (SpeechSynthesis) com preferência pt-BR', () => {
    expect(JARVIS).toMatch(/speechSynthesis/);
    expect(JARVIS).toMatch(/SpeechSynthesisUtterance/);
    expect(JARVIS).toMatch(/pt[-_]br/i);
  });

  it('saudação personaliza com o usuário logado (window.USUARIO_ATUAL)', () => {
    expect(JARVIS).toMatch(/USUARIO_ATUAL/);
    expect(JARVIS).toMatch(/function greetText/);
  });

  it('roteador de comandos liga na navegação real (state.currentTab + render)', () => {
    expect(JARVIS).toMatch(/function goTab/);
    expect(JARVIS).toMatch(/window\.state\.currentTab\s*=/);
    expect(JARVIS).toMatch(/window\.render\(\)/);
    // cobre navegar + criar + buscar
    expect(JARVIS).toMatch(/nova obra/);
    expect(JARVIS).toMatch(/abrirModalNovoCliente/);
    expect(JARVIS).toMatch(/buscar cliente/);
  });

  it('mapeia as abas principais do painel', () => {
    ['dashboard', 'obras', 'proposta', 'folha', 'laudos', 'financeiro', 'galeria'].forEach((k) => {
      expect(JARVIS).toMatch(new RegExp(`key:\\s*'${k}'`));
    });
  });

  it('obras.html injeta o jarvis.js no fim do body', () => {
    expect(OBRAS).toMatch(/<script src="\/jarvis\.js"[^>]*><\/script>/);
    // carrega depois do diligencias.js (garante window.state/render prontos)
    const iDil = OBRAS.indexOf('/js/diligencias.js');
    const iJar = OBRAS.indexOf('/jarvis.js');
    expect(iDil).toBeGreaterThan(0);
    expect(iJar).toBeGreaterThan(iDil);
  });
});
