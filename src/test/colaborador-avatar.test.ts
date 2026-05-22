// v3.24.4: tests dos helpers de avatar (puros) + smoke da UI/PDFs.

import { describe, it, expect } from 'vitest';
import {
  gerarIniciais, corDeFundoPorNome, montarBlocoAvatarHtml,
} from '../services/colaborador-avatar-helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('gerarIniciais', () => {
  it('"Cicero da Silva Oliveira" -> "CO" (primeiro + ultimo)', () => {
    expect(gerarIniciais('Cicero da Silva Oliveira')).toBe('CO');
  });
  it('"Madonna" -> "MA" (single nome — primeiras 2 letras)', () => {
    expect(gerarIniciais('Madonna')).toBe('MA');
  });
  it('"Ana Maria" -> "AM"', () => {
    expect(gerarIniciais('Ana Maria')).toBe('AM');
  });
  it('"Leonardo da Silva Oliveira" -> "LO"', () => {
    expect(gerarIniciais('Leonardo da Silva Oliveira')).toBe('LO');
  });
  it('handle string vazia / null / undefined', () => {
    expect(gerarIniciais('')).toBe('?');
    expect(gerarIniciais(null as unknown as string)).toBe('?');
    expect(gerarIniciais(undefined as unknown as string)).toBe('?');
  });
  it('trim de espaços', () => {
    expect(gerarIniciais('  Joao  Silva  ')).toBe('JS');
  });
  it('sempre uppercase', () => {
    expect(gerarIniciais('joao silva')).toBe('JS');
    expect(gerarIniciais('joao SILVA')).toBe('JS');
  });
});

describe('corDeFundoPorNome (determinismo)', () => {
  it('mesmo nome → mesma cor (10 vezes)', () => {
    const cores = new Set<string>();
    for (let i = 0; i < 10; i++) cores.add(corDeFundoPorNome('Leonardo da Silva'));
    expect(cores.size).toBe(1);
  });
  it('nomes diferentes geram cores diferentes', () => {
    const c1 = corDeFundoPorNome('Leonardo');
    const c2 = corDeFundoPorNome('Cicero');
    expect(c1).not.toBe(c2);
  });
  it('formato HSL valido', () => {
    expect(corDeFundoPorNome('Ana')).toMatch(/^hsl\(\d+,\s*\d+%,\s*\d+%\)$/);
  });
  it('hue dentro de 0-359', () => {
    for (const nome of ['Leo', 'Ana', 'Cicero', 'Madonna', 'Maria do Carmo']) {
      const m = corDeFundoPorNome(nome).match(/hsl\((\d+),/);
      const hue = Number(m![1]);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});

describe('montarBlocoAvatarHtml', () => {
  it('com fotoBase64 renderiza <img>', () => {
    const h = montarBlocoAvatarHtml({
      nome: 'Leonardo',
      fotoBase64: 'data:image/webp;base64,XXXX',
    });
    expect(h).toContain('<img');
    expect(h).toContain('data:image/webp;base64,XXXX');
    expect(h).toContain('border-radius:32px'); // default size=64, half=32
  });
  it('sem fotoBase64 renderiza div com iniciais + cor', () => {
    const h = montarBlocoAvatarHtml({ nome: 'Cicero da Silva Oliveira' });
    expect(h).not.toContain('<img');
    expect(h).toContain('>CO<');
    expect(h).toMatch(/background:hsl\(\d+/);
  });
  it('size custom propaga pras dimensoes', () => {
    const h = montarBlocoAvatarHtml({ nome: 'X', size: 80 });
    expect(h).toContain('width:80px');
    expect(h).toContain('height:80px');
  });
  it('escapa caracteres especiais no alt', () => {
    const h = montarBlocoAvatarHtml({
      nome: '<script>x</script>',
      fotoBase64: 'data:image/webp;base64,XXX',
    });
    expect(h).toContain('&lt;script&gt;');
    expect(h).not.toContain('<script>x</script>');
  });
});

describe('Smoke — UI obras.html avatar integrado', () => {
  const REPO_ROOT = join(__dirname, '..', '..');
  const obrasHtml = readFileSync(
    join(REPO_ROOT, 'src', 'public', 'obras.html'), 'utf8',
  );

  it('funcao avatarHtml definida inline', () => {
    expect(obrasHtml).toMatch(/function avatarHtml\(membro,\s*size\)/);
  });
  it('funcoes auxiliares gerarIniciais + corDeFundoPorNome inline', () => {
    expect(obrasHtml).toMatch(/function gerarIniciais\(nome\)/);
    expect(obrasHtml).toMatch(/function corDeFundoPorNome\(nome\)/);
  });
  it('card do home (resumo da obra) usa avatarHtml(p, 40)', () => {
    // Linha 2010 area: state.equipe.map(p => ...). Confere que tem avatarHtml(p, 40)
    expect(obrasHtml).toMatch(/state\.equipe\.map\(p =>[\s\S]+?avatarHtml\(p,\s*40\)/);
  });
  it('card de Equipe (renderEquipe) usa avatarHtml(p, 56)', () => {
    expect(obrasHtml).toMatch(/renderEquipe[\s\S]+?avatarHtml\(p,\s*56\)/);
  });
  it('avatarHtml usa /api/equipe/${id}/foto', () => {
    expect(obrasHtml).toMatch(/\/api\/equipe\/\$\{id\}\/foto\?_=\$\{cacheBuster\}/);
  });
  it('onerror esconde img pra mostrar fallback de iniciais', () => {
    expect(obrasHtml).toMatch(/onerror="this\.style\.display='none'"/);
  });
});

describe('Smoke — PDFs com fallback de iniciais', () => {
  const REPO_ROOT = join(__dirname, '..', '..');
  const folhaPdf = readFileSync(
    join(REPO_ROOT, 'src', 'services', 'folhaFechamentoPdf.ts'), 'utf8',
  );
  const reciboPdf = readFileSync(
    join(REPO_ROOT, 'src', 'services', 'reciboPdf.ts'), 'utf8',
  );

  it('folhaFechamentoPdf — fallback chama gerarIniciais + corDeFundoPorNome', () => {
    // Aceita require dinamico ou import nomeado — projeto e' commonjs
    expect(folhaPdf).toMatch(/colaborador-avatar-helpers/);
    expect(folhaPdf).toMatch(/gerarIniciais/);
    expect(folhaPdf).toMatch(/corDeFundoPorNome/);
  });
  it('reciboPdf — fallback iniciais em recibo de funcionario sem foto', () => {
    expect(reciboPdf).toMatch(/colaborador-avatar-helpers/);
    expect(reciboPdf).toMatch(/ehReciboColaborador/);
    expect(reciboPdf).toMatch(/gerarIniciais/);
  });
});
