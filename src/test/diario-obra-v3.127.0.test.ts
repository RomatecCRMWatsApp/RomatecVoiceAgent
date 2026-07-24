// v3.127.0 — Finalização do Diário de Obra: ditado ponta-a-ponta e caneta/canvas.
//
// O módulo subiu na v3.125.0 sem nenhum teste. Aqui trancamos os defeitos que
// só apareciam em tablet/iPad e que a tela não tinha como demonstrar sozinha:
//   1. formato do áudio ditado (o mimeType chegava e era descartado);
//   2. entrada de caneta no canvas (pointer × touch, palma, cancelamento, DPR);
//   3. ditado e anotação em entrada JÁ EXISTENTE (só existiam ao criar).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extensaoDeMime } from '../agent/transcribe';

const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');
const HTML = read('public', 'diario-obra.html');
const TRANSCRIBE = read('agent', 'transcribe.ts');
const ROUTER = read('routes', 'diarioObra.ts');

// Extrai a tabela de mime do front e a executa de verdade, pra o teste medir
// comportamento e não texto — e pra flagrar se front e back divergirem.
function extDeMimeDoFront(): (m: string) => string {
  const trecho = HTML.match(/var MIME_EXT = \[[\s\S]*?return 'webm';\s*\}/);
  if (!trecho) throw new Error('bloco extDeMime não encontrado em diario-obra.html');
  return new Function(`${trecho[0]}; return extDeMime;`)() as (m: string) => string;
}

describe('Formato do áudio ditado — servidor (v3.127.0)', () => {
  it('cada formato de gravador vira a extensão que o Whisper entende', () => {
    // Chrome/Android
    expect(extensaoDeMime('audio/webm')).toBe('webm');
    // Safari/iPad — a causa real do ditado falhar no tablet
    expect(extensaoDeMime('audio/mp4')).toBe('mp4');
    expect(extensaoDeMime('audio/x-m4a')).toBe('m4a');
    // WhatsApp / Telegram
    expect(extensaoDeMime('audio/ogg')).toBe('ogg');
    expect(extensaoDeMime('audio/mpeg')).toBe('mp3');
    expect(extensaoDeMime('audio/wav')).toBe('wav');
    expect(extensaoDeMime('audio/flac')).toBe('flac');
  });

  it('tolera parâmetros de codec e caixa alta (WhatsApp manda "codecs=opus")', () => {
    expect(extensaoDeMime('audio/ogg; codecs=opus')).toBe('ogg');
    expect(extensaoDeMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extensaoDeMime('AUDIO/MP4')).toBe('mp4');
    expect(extensaoDeMime('  audio/mp4  ')).toBe('mp4');
  });

  it('mime ausente ou desconhecido cai em webm (comportamento anterior)', () => {
    expect(extensaoDeMime(undefined)).toBe('webm');
    expect(extensaoDeMime(null)).toBe('webm');
    expect(extensaoDeMime('')).toBe('webm');
    expect(extensaoDeMime('application/octet-stream')).toBe('webm');
  });

  it('toda extensão gerada está na lista aceita pela API de transcrição', () => {
    const aceitas = ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm'];
    const mimes = [
      'audio/webm', 'video/webm', 'audio/ogg', 'audio/oga', 'audio/opus', 'application/ogg',
      'audio/mp4', 'video/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/mpeg',
      'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/flac', 'audio/x-flac',
      'lixo/desconhecido',
    ];
    for (const m of mimes) expect(aceitas, `mime ${m}`).toContain(extensaoDeMime(m));
  });

  it('o arquivo temporário usa a extensão derivada — não mais ".webm" fixo', () => {
    expect(TRANSCRIBE).toMatch(/const ext\s+= extensaoDeMime\(mimeType\)/);
    expect(TRANSCRIBE).toMatch(/\$\{crypto\.randomBytes\(8\)\.toString\('hex'\)\}\.\$\{ext\}/);
    // O parâmetro deixou de ser descartado (era `_mimeType`).
    expect(TRANSCRIBE).toMatch(/transcribeAudio\(audioBuffer: Buffer, mimeType = 'audio\/webm'\)/);
    expect(TRANSCRIBE).not.toMatch(/_mimeType/);
  });
});

describe('Formato do áudio ditado — navegador (v3.127.0)', () => {
  const extFront = extDeMimeDoFront();

  it('a tela nomeia o upload conforme o que o MediaRecorder gravou', () => {
    expect(HTML).toMatch(/fd\.append\('audio', blob, 'ditado\.'\+extDeMime\(blob\.type\)\)/);
    // O nome fixo antigo teria rotulado o mp4 do iPad como webm.
    expect(HTML).not.toMatch(/'ditado\.webm'/);
  });

  it('front e servidor concordam sobre a extensão de cada formato', () => {
    for (const m of ['audio/webm', 'audio/mp4', 'audio/ogg; codecs=opus', 'audio/x-m4a',
                     'audio/mpeg', 'audio/wav', 'video/mp4', 'formato/inventado', '']) {
      expect(extFront(m), `divergência no mime ${m}`).toBe(extensaoDeMime(m));
    }
  });

  it('usa o mimeType real do gravador, não um chute', () => {
    expect(HTML).toMatch(/var tipo = mr\.mimeType \|\| \(REC\.chunks\[0\] && REC\.chunks\[0\]\.type\) \|\| 'audio\/webm'/);
  });

  it('checa MediaRecorder antes de gravar (iOS antigo tem getUserMedia sem ele)', () => {
    expect(HTML).toMatch(/typeof window\.MediaRecorder === 'undefined'/);
    expect(HTML).toMatch(/Gravação não suportada neste navegador/);
    // A mensagem antiga acusava microfone e mandava o usuário pro lugar errado.
    expect(HTML).not.toMatch(/Microfone não disponível neste dispositivo/);
  });

  it('gravação tem teto de duração e não sobe áudio vazio', () => {
    expect(HTML).toMatch(/LIMITE_GRAVACAO_MS = 5\*60\*1000/);
    expect(HTML).toMatch(/REC\.timer = setTimeout/);
    expect(HTML).toMatch(/if\(!blob\.size\)\{ toast\('Nada foi gravado/);
  });

  it('parar a gravação libera microfone e timer (sem mic aberto em segundo plano)', () => {
    expect(HTML).toMatch(/stream\.getTracks\(\)\.forEach\(function\(t\)\{ t\.stop\(\); \}\)/);
    expect(HTML).toMatch(/if\(REC\.timer\)\{ clearTimeout\(REC\.timer\); REC\.timer=null; \}/);
    // Fechar o modal pelo fundo também encerra a gravação.
    expect(HTML).toMatch(/if\(e\.target===this\)\{ pararVoz\(\); fecharModal\(\); \}/);
  });

  it('ditar de novo acrescenta ao texto, não substitui', () => {
    expect(HTML).toMatch(/var novo = \(ta\.value \? ta\.value\.replace\(\/\\s\*\$\/,''\)\+' ' : ''\) \+ texto;/);
  });

  it('transcrição continua isolada da ZAYRA (só devolve texto)', () => {
    expect(ROUTER).toMatch(/router\.post\('\/transcrever'/);
    expect(ROUTER).toMatch(/transcribeAudio\(f\.buffer, f\.mimetype\)/);
    expect(ROUTER).not.toMatch(/\bthink\b|agent\/think|speak\(/);
  });
});

describe('Caneta e canvas em tablet (v3.127.0)', () => {
  // Recorta só o corpo do pad, pra as asserções não casarem com outro trecho.
  const PAD = HTML.slice(HTML.indexOf('function abrirDesenho('), HTML.indexOf('function rotuloCampo('));

  it('Pointer Events e touch NÃO ficam ligados ao mesmo tempo', () => {
    // O toque em tablet moderno dispara os dois; antes start/move rodavam 2x.
    expect(PAD).toMatch(/if\(window\.PointerEvent\)\{/);
    const ramoPointer = PAD.slice(PAD.indexOf('if(window.PointerEvent){'), PAD.indexOf('} else {'));
    const ramoFallback = PAD.slice(PAD.indexOf('} else {'), PAD.indexOf("document.querySelectorAll('.swatch')"));
    expect(ramoPointer).toMatch(/pointerdown/);
    expect(ramoPointer).not.toMatch(/touchstart|mousedown/);
    expect(ramoFallback).toMatch(/touchstart/);
    expect(ramoFallback).not.toMatch(/pointerdown/);
  });

  it('trata pointercancel — palma/gesto do sistema não deixa traço fantasma', () => {
    expect(PAD).toMatch(/addEventListener\('pointercancel',end\)/);
    expect(PAD).toMatch(/addEventListener\('touchcancel',end\)/);
    // end() zera o último ponto; sem isso o próximo toque risca a tela inteira.
    expect(PAD).toMatch(/function end\(\)\{\s*\n?\s*PAD\.drawing=false; PAD\.last=null;/);
  });

  it('captura o ponteiro no canvas em vez de pendurar listener no window', () => {
    expect(PAD).toMatch(/cv\.setPointerCapture\(ev\.pointerId\)/);
    expect(PAD).toMatch(/cv\.releasePointerCapture\(PAD\.ptr\)/);
    // O listener global vazava um handler por abertura do pad.
    expect(PAD).not.toMatch(/window\.addEventListener\('pointerup'/);
  });

  it('rejeita toque de palma depois que a caneta encostou', () => {
    expect(PAD).toMatch(/if\(ev\.pointerType==='pen'\)\{ PAD\.caneta=true; return false; \}/);
    expect(PAD).toMatch(/return PAD\.caneta && ev\.pointerType==='touch';/);
    expect(PAD).toMatch(/if\(ignorar\(ev\)\) return;/);
  });

  it('resolução acompanha o devicePixelRatio (traço nítido em tela retina)', () => {
    expect(PAD).toMatch(/var dpr = Math\.min\(window\.devicePixelRatio \|\| 1, 3\)/);
    expect(PAD).toMatch(/cv\.width\s+= Math\.round\(larguraCss\*dpr\)/);
    expect(PAD).toMatch(/ctx\.scale\(dpr, dpr\)/);
    expect(PAD).toMatch(/cv\.style\.height = alturaCss\+'px'/);
  });

  it('não anexa anotação em branco', () => {
    expect(PAD).toMatch(/if\(!PAD\.sujo\)\{ toast\('Escreva ou desenhe algo antes de anexar\.'\); return; \}/);
    expect(PAD).toMatch(/PAD\.sujo=true/);      // marca ao começar o traço
    expect(PAD).toMatch(/PAD\.sujo=false/);     // e desmarca no "Limpar"
  });

  it('toque curto (ponto isolado) também marca o papel', () => {
    expect(PAD).toMatch(/risco\(PAD\.last, \{x:PAD\.last\.x\+0\.01, y:PAD\.last\.y\}\)/);
  });

  it('a anotação é salva no store do chamador e avisa quem abriu o pad', () => {
    expect(PAD).toMatch(/store\.desenhos\.push\(\{ base64:url, campo_referencia:campoRef/);
    expect(PAD).toMatch(/if\(aoVoltar\) aoVoltar\(\)/);
    expect(HTML).toMatch(/canvas#pad\{[^}]*touch-action:none/);
  });
});

describe('Ditado e anotação em entrada JÁ EXISTENTE (v3.127.0)', () => {
  const EDICAO = HTML.slice(HTML.indexOf('function abrirEdicao('), HTML.indexOf('// ---- router ----'));

  it('a edição usa os mesmos campos multimodo da entrada nova', () => {
    expect(EDICAO).toMatch(/CAMPOS\.map\(function\(c\)\{ return fieldHtml\(c, store\.textos\[c\.key\]\); \}\)/);
    expect(EDICAO).toMatch(/ligarCampos\(box, store, pintar\)/);
    // Antes eram três textareas soltas, sem botão de ditar nem de desenhar.
    expect(EDICAO).not.toMatch(/id="eObs"|id="ePend"|id="eSol"/);
  });

  it('anotações novas sobem por POST /:id/anexos (rota que já existia)', () => {
    expect(EDICAO).toMatch(/fetch\(API\+'\/'\+d\.id\+'\/anexos'/);
    expect(EDICAO).toMatch(/fd\.append\('desenhos_json'/);
    // Só chama a rota se houver desenho novo.
    expect(EDICAO).toMatch(/if\(!store\.desenhos\.length\) return null;/);
    expect(ROUTER).toMatch(/router\.post\('\/:id\/anexos'/);
  });

  it('o pad de desenho reabre a edição ao fechar (mesmo modal)', () => {
    // O pad ocupa o modal da edição; sem repintar, a edição sumia da tela.
    expect(EDICAO).toMatch(/function pintar\(\)/);
    expect(EDICAO).toMatch(/ligarCampos\(box, store, pintar\)/);
    expect(HTML).toMatch(/document\.getElementById\('padCancel'\)\.onclick=function\(\)\{ fecharModal\(\); if\(aoVoltar\) aoVoltar\(\); \}/);
  });

  it('sair da edição encerra gravação em curso', () => {
    expect(EDICAO).toMatch(/document\.getElementById\('eCancel'\)\.onclick=function\(\)\{ pararVoz\(\); fecharModal\(\); \}/);
    expect(EDICAO).toMatch(/function salvar\(\)\{\s*\n?\s*pararVoz\(\);/);
  });

  it('o texto digitado é preservado ao abrir o pad de desenho', () => {
    // A textarea é destruída quando o pad toma o modal — o valor vai pro store.
    expect(HTML).toMatch(/store\.textos\[key\] = ta\.value;\s*\n\s*abrirDesenho\(key, store, aoVoltar\)/);
  });
});

describe('Módulo segue sem tocar no motor do agente (v3.127.0)', () => {
  it('nem a tela nem a rota do diário importam tools/think/aiCascade', () => {
    expect(ROUTER).not.toMatch(/agent\/tools|agent\/think|aiCascade/);
    expect(HTML).not.toMatch(/aiCascade/);
  });
});
