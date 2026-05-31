// v3.51.0 — testes do canvasService (gerarPranchaSVG / escapeSvg). Puro, sem DB.
import { describe, it, expect } from 'vitest';
import { gerarPranchaSVG, escapeSvg, PRANCHA_W, PRANCHA_H } from '../services/canvasService';

describe('escapeSvg', () => {
  it('escapa caracteres especiais', () => {
    expect(escapeSvg('a & b')).toBe('a &amp; b');
    expect(escapeSvg('<tag>')).toBe('&lt;tag&gt;');
    expect(escapeSvg('aspas "x" \'y\'')).toBe('aspas &quot;x&quot; &#39;y&#39;');
  });
  it('null/undefined viram string vazia', () => {
    expect(escapeSvg(null)).toBe('');
    expect(escapeSvg(undefined)).toBe('');
  });
});

describe('gerarPranchaSVG', () => {
  it('retorna SVG A3 valido (1587x1123)', () => {
    const svg = gerarPranchaSVG({ tituloObra: 'Casa Teste', proprietario: 'Joao' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).toContain(`width="${PRANCHA_W}"`);
    expect(svg).toContain(`height="${PRANCHA_H}"`);
    expect(PRANCHA_W).toBe(1587);
    expect(PRANCHA_H).toBe(1123);
  });

  it('inclui carimbo com dados e responsavel tecnico padrao', () => {
    const svg = gerarPranchaSVG({ tituloObra: 'Obra X', proprietario: 'Maria' });
    expect(svg).toContain('ROMATEC');
    expect(svg).toContain('Obra X');
    expect(svg).toContain('Maria');
    expect(svg).toContain('Jose Romario Pinto Bezerra');
    expect(svg).toContain('CFT/MA no 01209185369');
    expect(svg).toContain('Romatec Consultoria Total - Acailandia/MA');
  });

  it('escapa caracteres especiais nos campos da obra', () => {
    const svg = gerarPranchaSVG({ tituloObra: 'Casa <A&B>', proprietario: 'Joao "Z"' });
    expect(svg).toContain('Casa &lt;A&amp;B&gt;');
    expect(svg).toContain('Joao &quot;Z&quot;');
    expect(svg).not.toContain('Casa <A&B>');
  });

  it('aplica valores padrao Romatec quando faltam dados', () => {
    const svg = gerarPranchaSVG({});
    expect(svg).toContain('Acailandia/MA');
    expect(svg).toContain('1:500');
    expect(svg).toContain('R00');
    expect(svg).toContain('Obra sem titulo');
  });

  it('embute o conteudo SVG do canvas', () => {
    const svg = gerarPranchaSVG({ tituloObra: 'X', conteudoSvg: '<line id="MARCADOR" x1="0" y1="0" x2="10" y2="10"/>' });
    expect(svg).toContain('MARCADOR');
  });

  it('usa escala/prancha/revisao customizados', () => {
    const svg = gerarPranchaSVG({ tituloObra: 'X', escala: '1:250', numeroPrancha: 'PR-099', revisao: 'R02' });
    expect(svg).toContain('1:250');
    expect(svg).toContain('PR-099');
    expect(svg).toContain('R02');
  });
});
