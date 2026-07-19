// v3.107.1: a Gestao de Obras nao pode carregar o jarvis.js.
//
// Por que isto e um teste e nao so uma linha removida:
//
// O orbe 🎙️ do Jarvis nao esperava o usuario tocar nele. No primeiro clique em
// QUALQUER lugar da pagina (jarvis.js, funcao `kick`) ele ligava dois canais de
// escuta permanente, com os defaults todos true:
//   1. getUserMedia + AudioContext num loop de requestAnimationFrame infinito
//      (detector de palma dupla);
//   2. SpeechRecognition com continuous=true e onend que reinicia sozinho
//      (wake word "Zayra") — no Chrome isso TRANSMITE o audio para servidores
//      do Google.
// Nao havia beforeunload nem visibilitychange desligando nada. Na pratica, todo
// celular de campo com a tela de obras aberta ficava com o microfone ligado.
//
// Esconder o botao com CSS NAO resolveria: a captura acontece independente do
// orbe estar visivel. Por isso a correcao e nao carregar o script, e por isso
// este teste existe — se alguem reintroduzir a tag, o build acusa.
//
// A tela do ZAYRA Chat (index.html) nao e afetada: ela nunca carregou jarvis.js
// e tem microfone proprio, que so grava sob clique e encerra as tracks no fim.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PUBLIC_DIR = join(__dirname, '..', 'public');

/** Remove comentarios HTML pra nao contar a tag deixada comentada de proposito. */
function semComentariosHtml(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

describe('jarvis — sem escuta em background na Gestao de Obras', () => {
  it('1. obras.html NAO carrega /jarvis.js (fora de comentario)', () => {
    const html = semComentariosHtml(readFileSync(join(PUBLIC_DIR, 'obras.html'), 'utf8'));
    expect(html).not.toMatch(/<script[^>]+src=["']\/?jarvis\.js/i);
  });

  it('2. nenhuma pagina de src/public carrega o jarvis.js', () => {
    const paginas = ['obras.html', 'index.html', 'inventario-obra.html'];
    for (const p of paginas) {
      let html: string;
      try { html = readFileSync(join(PUBLIC_DIR, p), 'utf8'); } catch { continue; }
      expect(semComentariosHtml(html), `${p} nao deve carregar jarvis.js`)
        .not.toMatch(/<script[^>]+src=["']\/?jarvis\.js/i);
    }
  });

  it('3. o jarvis.js segue no repo — desativado, nao apagado (reversivel)', () => {
    const js = readFileSync(join(PUBLIC_DIR, 'jarvis.js'), 'utf8');
    expect(js.length).toBeGreaterThan(0);
  });

  it('4. o microfone do ZAYRA Chat continua existindo (nao foi removido junto)', () => {
    const html = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
    expect(html).toMatch(/id=["']micBtn["']/);
  });
});
