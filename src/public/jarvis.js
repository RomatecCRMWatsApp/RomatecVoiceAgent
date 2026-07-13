/* ZAYRA Jarvis — assistente por voz do painel Romatec.
 *
 * Porta o ESPÍRITO do jarvis.py (github.com/hectorg2211/jarvis) pro navegador:
 *  - Detecção de PALMA DUPLA via Web Audio API (mesmo algoritmo RMS + noise floor
 *    adaptativo + janela de tempo entre palmas + cooldown do script original).
 *  - PALAVRA DE ATIVAÇÃO ("Zayra"/"Jarvis") via SpeechRecognition (pt-BR).
 *  - BOTÃO flutuante / atalho de teclado (Ctrl+Shift+J) como terceira via.
 *  - SAUDAÇÃO e respostas faladas via SpeechSynthesis do navegador (grátis).
 *  - COMANDOS DE VOZ que disparam ações reais do ZAYRA (navegar/buscar/criar).
 *
 * Autocontido: injeta seu próprio CSS/DOM, expõe window.ZayraJarvis. Degrada com
 * elegância quando o navegador não tem mic/reconhecimento/síntese.
 *
 * v3.94.0
 */
(function () {
  'use strict';
  if (window.ZayraJarvis) return;

  // ── Config (espelha as constantes do jarvis.py; persiste em localStorage) ──
  var LS_KEY = 'zayra_jarvis_cfg_v1';
  var DEFAULTS = {
    enabled: true,
    clapEnabled: true,        // ativação por palma dupla
    wakeWordEnabled: true,    // ativação por palavra "Zayra"
    wakeWords: ['zayra', 'jarvis'],
    welcomePhrase: 'Bem-vindo, José. ZAYRA à sua disposição.',
    greetOnLoad: false,       // falar a saudação assim que o painel abre
    // Detecção de palma (porta direta do jarvis.py) ─ tudo em segundos/ratio.
    spikeRatio: 7.0,          // SPIKE_RATIO — pico = X× o piso de ruído
    minRms: 0.012,            // MIN_RMS — porta absoluta de volume
    cooldownS: 0.45,          // COOLDOWN_S — anti-repetição
    minGapS: 0.05,            // MIN_DOUBLE_GAP_S
    maxGapS: 0.35,            // MAX_DOUBLE_GAP_S
    retriggerRatio: 0.55,     // RETRIGGER_RATIO — re-arma após o pico
    noiseAlpha: 0.992,        // NOISE_FLOOR_ALPHA — adaptação lenta do piso
    // Voz
    ttsLang: 'pt-BR',
    ttsRate: 1.0,
    ttsPitch: 1.0,
    ttsVoiceName: '',         // vazio = melhor voz pt-BR disponível
  };
  var cfg = loadCfg();
  function loadCfg() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return Object.assign({}, DEFAULTS, raw ? JSON.parse(raw) : {});
    } catch (_) { return Object.assign({}, DEFAULTS); }
  }
  function saveCfg() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (_) {}
  }

  // ── Estado ─────────────────────────────────────────────────────────────────
  var state = {
    audioCtx: null,
    analyser: null,
    micStream: null,
    clapRunning: false,
    noiseFloor: 0.0,
    lastSpikeAt: 0,
    firstClapAt: 0,
    armed: true,
    lastTriggerAt: 0,
    recog: null,            // reconhecimento contínuo (wake word)
    recogCmd: null,         // reconhecimento pontual (comando)
    listeningCmd: false,
    greeted: false,
    supported: {
      audio: !!(window.AudioContext || window.webkitAudioContext) && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      recog: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      tts: !!window.speechSynthesis,
    },
  };

  // ── Utilidades ───────────────────────────────────────────────────────────
  function now() { return (window.performance && performance.now ? performance.now() : Date.now()) / 1000; }
  function norm(s) {
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
      .replace(/\s+/g, ' ').trim();
  }

  // ── TTS (voz do navegador) ─────────────────────────────────────────────────
  var voicesCache = [];
  function refreshVoices() {
    if (!state.supported.tts) return;
    voicesCache = window.speechSynthesis.getVoices() || [];
  }
  if (state.supported.tts) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }
  function pickVoice() {
    if (!voicesCache.length) refreshVoices();
    if (cfg.ttsVoiceName) {
      var byName = voicesCache.find(function (v) { return v.name === cfg.ttsVoiceName; });
      if (byName) return byName;
    }
    // preferência: pt-BR > pt > qualquer
    return voicesCache.find(function (v) { return /pt[-_]br/i.test(v.lang); })
      || voicesCache.find(function (v) { return /^pt/i.test(v.lang); })
      || voicesCache[0] || null;
  }
  function firstName() {
    var n = window.USUARIO_ATUAL || (window.state && window.state.userNome) || '';
    n = (n || '').toString().trim();
    return n ? n.split(/\s+/)[0] : '';
  }
  // Saudação: personaliza com o 1º nome do usuário logado quando a frase ainda é
  // a padrão; se o usuário customizou a frase no painel, respeita a dele.
  function greetText() {
    var fn = firstName();
    if (fn && cfg.welcomePhrase === DEFAULTS.welcomePhrase) {
      return 'Bem-vindo, ' + fn + '. ZAYRA à sua disposição.';
    }
    return cfg.welcomePhrase;
  }
  function speak(text, opts) {
    opts = opts || {};
    if (!state.supported.tts || !text) { return; }
    try {
      if (opts.flush) window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      var v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = cfg.ttsLang; }
      u.rate = cfg.ttsRate; u.pitch = cfg.ttsPitch;
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  // ── Detecção de PALMA DUPLA (Web Audio API) ────────────────────────────────
  async function startClap() {
    if (!cfg.enabled || !cfg.clapEnabled || !state.supported.audio || state.clapRunning) return;
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      var src = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      state.audioCtx = ctx; state.analyser = analyser; state.micStream = stream;
      state.clapRunning = true; state.noiseFloor = 0.0; state.armed = true;
      setMicUi(true);
      var buf = new Float32Array(analyser.fftSize);
      loop();
      function loop() {
        if (!state.clapRunning) return;
        analyser.getFloatTimeDomainData(buf);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) { sum += buf[i] * buf[i]; }
        var rms = Math.sqrt(sum / buf.length);
        detectClap(rms);
        requestAnimationFrame(loop);
      }
    } catch (err) {
      log('Mic negado/indisponível: ' + (err && err.message ? err.message : err));
      setMicUi(false);
    }
  }
  function stopClap() {
    state.clapRunning = false;
    try { if (state.micStream) state.micStream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
    try { if (state.audioCtx) state.audioCtx.close(); } catch (_) {}
    state.micStream = null; state.audioCtx = null; state.analyser = null;
    setMicUi(false);
  }
  // Núcleo do algoritmo — mesma lógica do jarvis.py (piso adaptativo + pico +
  // janela de tempo entre palmas + cooldown + re-arme).
  function detectClap(rms) {
    var t = now();
    // adapta o piso de ruído só quando NÃO é pico (suavização exponencial)
    var threshold = Math.max(state.noiseFloor * cfg.spikeRatio, cfg.minRms);
    if (rms < threshold) {
      state.noiseFloor = cfg.noiseAlpha * state.noiseFloor + (1 - cfg.noiseAlpha) * rms;
      if (rms < threshold * cfg.retriggerRatio) state.armed = true; // re-arma
      return;
    }
    if (!state.armed) return;              // ainda no mesmo estouro
    if (t - state.lastTriggerAt < cfg.cooldownS) return;
    state.armed = false;
    // temos um PICO (palma). É a 1ª ou fecha uma dupla?
    var gap = t - state.firstClapAt;
    if (state.firstClapAt && gap >= cfg.minGapS && gap <= cfg.maxGapS) {
      state.firstClapAt = 0;
      state.lastTriggerAt = t;
      onActivation('palma');
    } else {
      state.firstClapAt = t;              // arma a 1ª palma
    }
    state.lastSpikeAt = t;
  }

  // ── Reconhecimento de voz (wake word contínuo + comando pontual) ───────────
  function RecogCtor() { return window.SpeechRecognition || window.webkitSpeechRecognition; }
  function startWakeWord() {
    if (!cfg.enabled || !cfg.wakeWordEnabled || !state.supported.recog) return;
    if (state.recog) { try { state.recog.stop(); } catch (_) {} }
    var R = RecogCtor();
    var r = new R();
    r.lang = cfg.ttsLang; r.continuous = true; r.interimResults = false;
    r.onresult = function (ev) {
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var txt = norm(ev.results[i][0].transcript);
        var hit = cfg.wakeWords.some(function (w) { return txt.indexOf(norm(w)) !== -1; });
        if (hit && !state.listeningCmd) { onActivation('voz'); }
      }
    };
    r.onerror = function () {};
    r.onend = function () { // reinicia (fica sempre escutando a wake word)
      if (cfg.enabled && cfg.wakeWordEnabled && !state.listeningCmd) {
        try { r.start(); } catch (_) {}
      }
    };
    state.recog = r;
    try { r.start(); } catch (_) {}
  }
  function stopWakeWord() {
    if (state.recog) { try { state.recog.onend = null; state.recog.stop(); } catch (_) {} state.recog = null; }
  }
  // Escuta UM comando após a ativação.
  function listenCommand() {
    if (!state.supported.recog) {
      // sem reconhecimento: ativa mas só faz a saudação/atalhos
      return;
    }
    state.listeningCmd = true;
    setMicUi(true, 'ouvindo…');
    var R = RecogCtor();
    var r = new R();
    r.lang = cfg.ttsLang; r.continuous = false; r.interimResults = true;
    var finalTxt = '';
    r.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        if (res.isFinal) finalTxt += res[0].transcript;
        else interim += res[0].transcript;
      }
      setTranscript(interim || finalTxt);
    };
    r.onerror = function () {};
    r.onend = function () {
      state.listeningCmd = false;
      state.recogCmd = null;
      if (finalTxt.trim()) routeCommand(finalTxt.trim());
      else { setMicUi(true, ''); speak('Não entendi. Repete o comando.'); }
      startWakeWord(); // volta a escutar a wake word
    };
    state.recogCmd = r;
    stopWakeWord(); // evita duas sessões de reconhecimento simultâneas
    try { r.start(); } catch (_) { state.listeningCmd = false; startWakeWord(); }
  }

  // ── Ativação ────────────────────────────────────────────────────────────────
  function onActivation(via) {
    beep();
    flashOrb();
    if (!state.greeted) {
      state.greeted = true;
      speak(greetText(), { flush: true });
    }
    log('Ativado por ' + via);
    listenCommand();
  }

  // ── Roteador de COMANDOS ────────────────────────────────────────────────────
  // Tabela populada por registerDefaultCommands() (abaixo) + extensões da página
  // via window.ZayraJarvis.register(...). Cada item: {intents:[...], run, say}.
  var COMMANDS = [];
  function register(cmd) { if (cmd && typeof cmd.run === 'function') COMMANDS.push(cmd); }
  function matchScore(intents, txt) {
    var best = 0;
    for (var i = 0; i < intents.length; i++) {
      var kw = norm(intents[i]);
      if (!kw) continue;
      if (txt.indexOf(kw) !== -1) best = Math.max(best, kw.length); // + específico vence
    }
    return best;
  }
  function routeCommand(raw) {
    var txt = norm(raw);
    setTranscript(raw);
    log('Comando: "' + raw + '"');
    var winner = null, winScore = 0;
    for (var i = 0; i < COMMANDS.length; i++) {
      var sc = matchScore(COMMANDS[i].intents, txt);
      if (sc > winScore) { winScore = sc; winner = COMMANDS[i]; }
    }
    if (!winner) {
      speak('Não encontrei esse comando. Tente: abrir propostas, buscar cliente, ou nova obra.');
      setMicUi(true, '');
      return;
    }
    try {
      var say = winner.run(txt, raw);
      if (winner.say) speak(typeof winner.say === 'function' ? winner.say(txt, raw) : winner.say);
      else if (typeof say === 'string' && say) speak(say);
    } catch (err) {
      log('Erro ao executar comando: ' + (err && err.message ? err.message : err));
      speak('Deu um erro ao executar. Confere no painel.');
    }
    setMicUi(true, '');
  }
  // Extrai o "alvo" depois de uma palavra-gatilho (ex.: "buscar cliente joão" → "joão").
  function extractAfter(txt, triggers) {
    for (var i = 0; i < triggers.length; i++) {
      var idx = txt.indexOf(norm(triggers[i]));
      if (idx !== -1) return txt.slice(idx + norm(triggers[i]).length).trim();
    }
    return '';
  }

  // ── UI (orbe flutuante + painel de config) ──────────────────────────────────
  var ui = {};
  function buildUi() {
    var style = document.createElement('style');
    style.textContent = [
      '#zj-orb{position:fixed;right:18px;bottom:18px;z-index:99999;width:58px;height:58px;border-radius:50%;',
      'display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid rgba(0,255,136,.5);',
      'background:radial-gradient(circle at 30% 30%,#0f1410,#05080600);box-shadow:0 0 0 0 rgba(0,255,136,.5);',
      'transition:box-shadow .2s,transform .1s;color:#00ff88;font-size:24px;user-select:none;}',
      '#zj-orb:hover{transform:scale(1.06);} #zj-orb.zj-live{box-shadow:0 0 0 4px rgba(0,255,136,.14),0 0 18px rgba(0,255,136,.5);}',
      '#zj-orb.zj-flash{animation:zjpulse .5s ease;}',
      '@keyframes zjpulse{0%{box-shadow:0 0 0 0 rgba(0,255,136,.6);}100%{box-shadow:0 0 0 22px rgba(0,255,136,0);}}',
      '#zj-orb .zj-dot{position:absolute;top:6px;right:6px;width:9px;height:9px;border-radius:50%;background:#555;}',
      '#zj-orb.zj-live .zj-dot{background:#00ff88;box-shadow:0 0 6px #00ff88;}',
      '#zj-cap{position:fixed;right:86px;bottom:30px;z-index:99999;max-width:min(60vw,420px);background:#0f1410;',
      'border:1px solid rgba(0,255,136,.3);border-radius:12px;padding:10px 14px;color:#e0f2e6;font:13px/1.4 system-ui,sans-serif;',
      'box-shadow:0 8px 30px rgba(0,0,0,.5);opacity:0;transform:translateY(6px);transition:.18s;pointer-events:none;}',
      '#zj-cap.zj-show{opacity:1;transform:none;} #zj-cap .zj-status{color:#7a9988;font-size:11px;text-transform:uppercase;letter-spacing:1px;}',
      '#zj-panel{position:fixed;right:18px;bottom:86px;z-index:99999;width:300px;background:#0f1410;border:1px solid rgba(0,255,136,.3);',
      'border-radius:14px;padding:16px;color:#e0f2e6;font:13px/1.5 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6);display:none;}',
      '#zj-panel.zj-open{display:block;} #zj-panel h4{margin:0 0 10px;color:#00ff88;font-size:14px;}',
      '#zj-panel label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0;color:#cfe;}',
      '#zj-panel input[type=text],#zj-panel input[type=number]{background:#05080a;border:1px solid rgba(0,255,136,.25);color:#e0f2e6;border-radius:7px;padding:5px 8px;width:150px;}',
      '#zj-panel .zj-row{display:flex;gap:8px;margin-top:10px;} #zj-panel button{flex:1;background:#00ff88;color:#04120b;border:0;border-radius:8px;padding:8px;font-weight:700;cursor:pointer;}',
      '#zj-panel button.zj-ghost{background:transparent;color:#7a9988;border:1px solid rgba(0,255,136,.25);}',
      '#zj-panel .zj-hint{color:#7a9988;font-size:11px;margin-top:8px;}',
      '#zj-panel .zj-log{margin-top:8px;max-height:70px;overflow:auto;font:11px/1.35 ui-monospace,monospace;color:#7a9988;border-top:1px solid rgba(0,255,136,.12);padding-top:6px;}'
    ].join('');
    document.head.appendChild(style);

    var orb = document.createElement('div');
    orb.id = 'zj-orb'; orb.title = 'ZAYRA Jarvis — clique pra ativar · dê palma dupla · diga "Zayra" · Ctrl+Shift+J';
    orb.innerHTML = '<span class="zj-ico">🎙️</span><span class="zj-dot"></span>';
    orb.addEventListener('click', function () { onActivation('botão'); });
    orb.addEventListener('contextmenu', function (e) { e.preventDefault(); togglePanel(); });
    document.body.appendChild(orb);

    var cap = document.createElement('div');
    cap.id = 'zj-cap'; cap.innerHTML = '<div class="zj-status">ZAYRA</div><div class="zj-txt"></div>';
    document.body.appendChild(cap);

    var panel = document.createElement('div');
    panel.id = 'zj-panel';
    panel.innerHTML =
      '<h4>ZAYRA Jarvis</h4>' +
      '<label>Ativo <input type="checkbox" data-cfg="enabled"></label>' +
      '<label>Palma dupla <input type="checkbox" data-cfg="clapEnabled"></label>' +
      '<label>Palavra "Zayra" <input type="checkbox" data-cfg="wakeWordEnabled"></label>' +
      '<label>Sensibilidade palma <input type="number" step="0.5" min="2" max="20" data-cfg="spikeRatio" style="width:70px"></label>' +
      '<label>Saudação <input type="text" data-cfg="welcomePhrase"></label>' +
      '<div class="zj-row"><button id="zj-save">Salvar</button><button class="zj-ghost" id="zj-test">Testar voz</button></div>' +
      '<div class="zj-hint">Ativação: clique no orbe, palma dupla, diga "Zayra", ou Ctrl+Shift+J. Botão direito no orbe abre isto.</div>' +
      '<div class="zj-log" id="zj-log"></div>';
    document.body.appendChild(panel);
    ui.orb = orb; ui.cap = cap; ui.panel = panel;
    ui.capTxt = cap.querySelector('.zj-txt'); ui.log = panel.querySelector('#zj-log');

    // liga inputs → cfg
    panel.querySelectorAll('[data-cfg]').forEach(function (el) {
      var key = el.getAttribute('data-cfg');
      if (el.type === 'checkbox') el.checked = !!cfg[key];
      else el.value = cfg[key];
    });
    panel.querySelector('#zj-save').addEventListener('click', function () {
      panel.querySelectorAll('[data-cfg]').forEach(function (el) {
        var key = el.getAttribute('data-cfg');
        if (el.type === 'checkbox') cfg[key] = el.checked;
        else if (el.type === 'number') cfg[key] = parseFloat(el.value) || DEFAULTS[key];
        else cfg[key] = el.value;
      });
      saveCfg(); applyEnable(); speak('Configurações salvas.'); togglePanel();
    });
    panel.querySelector('#zj-test').addEventListener('click', function () { speak(cfg.welcomePhrase, { flush: true }); });
  }
  function togglePanel() { if (ui.panel) ui.panel.classList.toggle('zj-open'); }
  function setMicUi(live, statusTxt) {
    if (!ui.orb) return;
    ui.orb.classList.toggle('zj-live', !!live);
    if (statusTxt != null) { showCap(statusTxt); }
  }
  function flashOrb() { if (!ui.orb) return; ui.orb.classList.remove('zj-flash'); void ui.orb.offsetWidth; ui.orb.classList.add('zj-flash'); }
  function showCap(txt) {
    if (!ui.cap) return;
    ui.cap.querySelector('.zj-status').textContent = state.listeningCmd ? 'OUVINDO' : 'ZAYRA';
    ui.capTxt.textContent = txt || '';
    ui.cap.classList.add('zj-show');
    clearTimeout(showCap._t);
    if (!txt && !state.listeningCmd) showCap._t = setTimeout(function () { ui.cap.classList.remove('zj-show'); }, 2500);
  }
  function setTranscript(txt) { showCap(txt); }
  function log(msg) {
    if (ui.log) { var d = document.createElement('div'); d.textContent = msg; ui.log.prepend(d); }
    try { console.debug('[ZayraJarvis]', msg); } catch (_) {}
  }

  // sinal sonoro curto (earcon) sem depender de arquivo
  function beep() {
    if (!state.supported.audio) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var c = new Ctx(); var o = c.createOscillator(); var g = c.createGain();
      o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(c.destination);
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, c.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.18);
      o.start(); o.stop(c.currentTime + 0.2);
      o.onended = function () { try { c.close(); } catch (_) {} };
    } catch (_) {}
  }

  // ── Liga/desliga conforme cfg ───────────────────────────────────────────────
  function applyEnable() {
    if (!cfg.enabled) { stopClap(); stopWakeWord(); setMicUi(false); return; }
    if (cfg.clapEnabled) startClap(); else stopClap();
    if (cfg.wakeWordEnabled) startWakeWord(); else stopWakeWord();
    setMicUi(cfg.clapEnabled || cfg.wakeWordEnabled, '');
  }

  // ── API pública ─────────────────────────────────────────────────────────────
  window.ZayraJarvis = {
    version: '3.94.0',
    cfg: cfg,
    register: register,
    speak: speak,
    activate: function () { onActivation('api'); },
    route: routeCommand,
    extractAfter: extractAfter,
    start: applyEnable,
    stop: function () { stopClap(); stopWakeWord(); },
    _state: state,
  };

  // ── Boot ────────────────────────────────────────────────────────────────────
  function boot() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', boot); return; }
    buildUi();
    // atalho de teclado
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'J' || e.key === 'j')) {
        e.preventDefault(); onActivation('atalho');
      }
    });
    // Mic só arranca após 1º gesto do usuário (política de autoplay/permite prompt limpo).
    var kicked = false;
    function kick() {
      if (kicked) return; kicked = true;
      applyEnable();
      if (cfg.greetOnLoad && !state.greeted) { state.greeted = true; speak(cfg.welcomePhrase); }
      document.removeEventListener('click', kick); document.removeEventListener('keydown', kick);
    }
    document.addEventListener('click', kick, { once: false });
    document.addEventListener('keydown', kick, { once: false });
    if (typeof registerDefaultCommands === 'function') registerDefaultCommands();
    log('Jarvis pronto. Suporte: mic=' + state.supported.audio + ' voz=' + state.supported.recog + ' tts=' + state.supported.tts);
  }

  // ── Catálogo de comandos ZAYRA (funções reais do painel obras.html) ─────────
  // Navegação = mutar window.state.currentTab + window.render(); criação = abrir a
  // aba e clicar o toggle, ou chamar abrirModal*; nome = window.USUARIO_ATUAL.
  function goTab(key) {
    if (!window.state || typeof window.render !== 'function') return false;
    window.state.currentTab = key;
    try { window.render(); } catch (_) {}
    if (typeof window.atualizarLiveFeed === 'function') { try { window.atualizarLiveFeed(); } catch (_) {} }
    return true;
  }
  // Clica um seletor assim que ele existir (a view pode renderizar async).
  function clickWhenReady(selector, tries) {
    tries = tries == null ? 12 : tries;
    var el = document.querySelector(selector);
    if (el) { try { el.click(); } catch (_) {} return; }
    if (tries <= 0) return;
    setTimeout(function () { clickWhenReady(selector, tries - 1); }, 130);
  }
  // Preenche a caixa de busca visível da view atual e dispara o filtro.
  function fillSearch(termo, selector) {
    var el = selector ? document.querySelector(selector) : null;
    if (!el) {
      var cands = Array.prototype.slice.call(document.querySelectorAll(
        'input[type=search], input[id*="busca" i], input[id*="search" i], input[id="laudo-q"], input[placeholder*="buscar" i], input[placeholder*="pesquis" i]'));
      el = cands.find(function (i) { return i.offsetParent !== null; }) || null;
    }
    if (!el) return false;
    el.value = termo;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    try { el.focus(); } catch (_) {}
    return true;
  }
  var TABS = [
    { key: 'dashboard', intents: ['painel', 'dashboard', 'tela inicial', 'inicio', 'home', 'principal'] },
    { key: 'obras', intents: ['obras', 'minhas obras', 'lista de obras', 'obra'] },
    { key: 'despesas', intents: ['despesas extras', 'despesas', 'gastos', 'despesa'] },
    { key: 'materiais', intents: ['materiais', 'estoque', 'material'] },
    { key: 'financeiro', intents: ['financeiro', 'financas', 'caixa'] },
    { key: 'recibos', intents: ['recibos', 'recibo'] },
    { key: 'notas', intents: ['notas fiscais', 'nota fiscal', 'notas'] },
    { key: 'equipe', intents: ['equipe', 'time', 'colaboradores', 'funcionarios', 'pessoal'] },
    { key: 'marcar', intents: ['marcar dias', 'marcar presenca', 'ponto', 'presenca', 'marcar'] },
    { key: 'folha', intents: ['folha mensal', 'folha de pagamento', 'folha'] },
    { key: 'vto', intents: ['vistorias', 'vistoria', 'vto'] },
    { key: 'laudos', intents: ['laudos', 'laudo', 'demarcacao'] },
    { key: 'loteamentos', intents: ['loteamentos', 'loteamento'] },
    { key: 'galeria', intents: ['galeria', 'fotos', 'imagens'] },
    { key: 'proposta', intents: ['propostas', 'proposta'] },
    { key: 'diligencias', intents: ['diligencias', 'diligencia'] },
    { key: 'calculos', intents: ['calculos', 'calculadora', 'calculo'] },
    { key: 'memoriais', intents: ['memoriais', 'quantitativos', 'memorial'] },
    { key: 'config', intents: ['configuracoes', 'configuracao', 'ajustes', 'config'] },
  ];
  var TAB_LABEL = {
    dashboard: 'painel', obras: 'obras', despesas: 'despesas', materiais: 'materiais',
    financeiro: 'financeiro', recibos: 'recibos', notas: 'notas fiscais', equipe: 'equipe',
    marcar: 'marcar dias', folha: 'folha mensal', vto: 'vistorias', laudos: 'laudos',
    loteamentos: 'loteamentos', galeria: 'galeria', proposta: 'propostas',
    diligencias: 'diligências', calculos: 'cálculos', memoriais: 'memoriais', config: 'configurações',
  };

  function registerDefaultCommands() {
    // 1) Navegação (abrir <aba>). Prefixos comuns ajudam, mas o nome puro já casa.
    TABS.forEach(function (t) {
      var ints = [];
      t.intents.forEach(function (w) {
        ints.push(w, 'abrir ' + w, 'abre ' + w, 'ir para ' + w, 'vai para ' + w, 'mostrar ' + w, 'ver ' + w);
      });
      register({
        intents: ints,
        run: function () { goTab(t.key); },
        say: function () { return 'Abrindo ' + (TAB_LABEL[t.key] || t.key) + '.'; },
      });
    });

    // 2) Criação ("novo/nova ..."). Mais específico que a navegação → vence no score.
    register({ intents: ['nova obra', 'criar obra', 'cadastrar obra', 'adicionar obra'],
      run: function () { goTab('obras'); clickWhenReady('#toggleNovaObra'); }, say: 'Abrindo nova obra.' });
    register({ intents: ['novo membro', 'novo funcionario', 'nova pessoa', 'cadastrar membro', 'adicionar membro'],
      run: function () { goTab('equipe'); clickWhenReady('#toggleNovoMembro'); }, say: 'Novo membro na equipe.' });
    register({ intents: ['novo material', 'cadastrar material', 'adicionar material'],
      run: function () { goTab('materiais'); clickWhenReady('#toggleNovoMat'); }, say: 'Novo material.' });
    register({ intents: ['nova despesa', 'lancar despesa', 'adicionar despesa', 'nova despesa extra'],
      run: function () { goTab('despesas'); clickWhenReady('[data-nova-desp]'); }, say: 'Nova despesa.' });
    register({ intents: ['novo laudo', 'criar laudo', 'laudo novo'],
      run: function () { goTab('laudos'); setTimeout(function () {
        if (window.state) window.state.laudosView = 'novo';
        if (typeof window.renderLaudos === 'function') { try { window.renderLaudos(); } catch (_) {} }
        else clickWhenReady('#btn-laudo-novo');
      }, 120); }, say: 'Novo laudo de demarcação.' });
    register({ intents: ['nova proposta', 'criar proposta', 'proposta nova'],
      run: function () { goTab('proposta'); setTimeout(function () {
        if (window.state) window.state.maoObraView = 'novo';
        if (typeof window.renderPropostasLista === 'function') { try { window.renderPropostasLista(); } catch (_) {} }
      }, 120); }, say: 'Nova proposta.' });
    register({ intents: ['novo cliente', 'cadastrar cliente', 'adicionar cliente'],
      run: function () { if (typeof window.abrirModalNovoCliente === 'function') window.abrirModalNovoCliente(); }, say: 'Novo cliente.' });
    register({ intents: ['nova nota', 'nova nota fiscal', 'lancar nota'],
      run: function () { goTab('notas'); if (typeof window.abrirModalNF === 'function') { try { window.abrirModalNF({}); } catch (_) {} } }, say: 'Notas fiscais.' });
    // Vale precisa escolher o membro → leva pra equipe e orienta.
    register({ intents: ['passar vale', 'novo vale', 'adiantamento', 'dar vale'],
      run: function () { goTab('equipe'); }, say: 'Abri a equipe. Escolha o colaborador pra passar o vale.' });
    register({ intents: ['novo pagamento', 'mao de obra avulsa', 'pagar avulso'],
      run: function () { window.location.href = '/mao-obra-avulsa.html'; }, say: 'Abrindo mão de obra avulsa.' });
    register({ intents: ['nova entrega', 'entrega de obra', 'entregar obra'],
      run: function () { window.location.href = '/entrega-obra.html'; }, say: 'Abrindo entrega de obra.' });

    // 3) Busca. "buscar cliente X" abre o gerenciador; "buscar laudo X" filtra;
    //    "buscar X" genérico preenche a caixa de busca da view atual.
    register({ intents: ['buscar cliente', 'procurar cliente', 'localizar cliente'],
      run: function (txt) {
        var alvo = extractAfter(txt, ['buscar cliente', 'procurar cliente', 'localizar cliente']);
        if (typeof window.abrirCadastroClienteModal === 'function') { try { window.abrirCadastroClienteModal('__gerenciar__'); } catch (_) {} }
        setTimeout(function () { if (alvo) fillSearch(alvo); }, 400);
        return alvo ? 'Buscando cliente ' + alvo + '.' : 'Gerenciando clientes.';
      } });
    register({ intents: ['buscar laudo', 'procurar laudo', 'localizar laudo'],
      run: function (txt) {
        var alvo = extractAfter(txt, ['buscar laudo', 'procurar laudo', 'localizar laudo']);
        goTab('laudos'); setTimeout(function () { if (alvo) fillSearch(alvo, '#laudo-q'); }, 200);
        return alvo ? 'Buscando laudo ' + alvo + '.' : 'Abrindo laudos.';
      } });
    register({ intents: ['buscar', 'procurar', 'pesquisar', 'localizar'],
      run: function (txt) {
        var alvo = extractAfter(txt, ['buscar', 'procurar', 'pesquisar', 'localizar']);
        var ok = alvo ? fillSearch(alvo) : false;
        return ok ? 'Buscando ' + alvo + '.' : 'Diga, por exemplo, buscar cliente, ou abra uma aba com busca primeiro.';
      } });

    // 4) Utilidades.
    register({ intents: ['que horas sao', 'que hora e', 'horas'],
      run: function () { var d = new Date(); return 'Agora são ' + d.getHours() + ' e ' + String(d.getMinutes()).padStart(2, '0') + '.'; } });
    register({ intents: ['quem sou eu', 'meu nome', 'como eu me chamo'],
      run: function () { var n = firstName(); return n ? 'Você é ' + n + '.' : 'Não sei seu nome ainda.'; } });
    register({ intents: ['obrigado', 'valeu', 'obrigada'], run: function () { return 'Disponha.'; } });
    register({ intents: ['voltar', 'inicio', 'pagina inicial', 'tela principal'],
      run: function () { goTab('dashboard'); }, say: 'Voltando ao painel.' });
    register({ intents: ['parar', 'silencio', 'cala', 'pausa', 'desligar assistente'],
      run: function () { try { window.speechSynthesis.cancel(); } catch (_) {} return 'Ok.'; } });
    register({ intents: ['ajuda', 'o que voce faz', 'comandos', 'o que voce pode fazer'],
      run: function () { return 'Eu abro abas, busco registros e crio novos itens. Diga: abrir propostas, nova obra, buscar cliente, folha mensal, ou nova entrega.'; } });
    register({ intents: ['recarregar', 'atualizar pagina', 'atualiza'],
      run: function () { setTimeout(function () { location.reload(); }, 600); return 'Atualizando.'; } });
  }

  boot();
})();
