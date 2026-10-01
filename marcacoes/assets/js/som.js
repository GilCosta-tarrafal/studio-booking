'use strict';
// ---------------------------------------------------------------------------
// O trecho que toca ao escolher um estilo de música, no formulário.
//
// Há dois caminhos, por esta ordem:
//
//  1. O trecho do estúdio. Se o estilo estiver em window.SONS (ver
//     /js/sons.js), toca-se esse ficheiro — a gravação de quem percebe do
//     assunto, que é sempre melhor do que qualquer imitação.
//
//  2. Um ritmo sintetizado aqui mesmo, com a Web Audio API. Não é música: é
//     a batida e o baixo do género, desenhados com osciladores e ruído, para
//     dar o andamento e o feitio. Serve enquanto não houver gravações, e faz
//     o formulário funcionar sem ficheiro nenhum.
//
// Nada toca sozinho: só ao carregar numa etiqueta. E há um botão para
// silenciar, que fica guardado no aparelho.
// ---------------------------------------------------------------------------
(function () {
  const DURACAO = 5;           // segundos, como pedido
  const VOLUME = 0.55;         // com folga para o limitador travar os picos
  const CHAVE_SILENCIO = 'som-estilos';

  // ---- Ritmos, um por estilo -----------------------------------------------
  // Cada compasso tem 16 passos (semicolcheias). 'x' é toque, '.' é silêncio.
  //   bombo/tarola/chimbau/agogo : padrões de percussão
  //   rufos    : passos onde o chimbau se parte em três (o "rufo" do trap)
  //   baixo    : [passo, nota MIDI, duração em passos, nota de onde desliza]
  //   acordes  : [passo, [notas MIDI], duração em passos]
  //   balanco  : atrasa as semicolcheias ímpares (o swing do boom bap)
  const RITMOS = {
    'drill': {
      bpm: 142,
      bombo:   'x.......x..x....',
      tarola:  '........x.......',
      chimbau: 'x.x.xx.x.x.xx.x.',
      rufos: [6, 14],
      // O 808 a escorregar de nota para nota é a assinatura do drill.
      baixo: [[0, 33, 5, 28], [8, 31, 4, 36], [12, 29, 3]],
    },
    'trap': {
      bpm: 140,
      bombo:   'x.....x...x.....',
      tarola:  '........x.......',
      chimbau: 'xxxxxxxxxxxxxxxx',
      rufos: [10, 11],
      baixo: [[0, 33, 6], [8, 36, 4], [12, 31, 3]],
    },
    'boom-bap': {
      bpm: 92, balanco: 0.2,
      bombo:   'x.....x..x......',
      tarola:  '....x.......x...',
      chimbau: 'x.x.x.x.x.x.x.x.',
      baixo: [[0, 38, 3], [6, 41, 2], [10, 36, 4]],
    },
    'rap-hip-hop': {
      bpm: 95, balanco: 0.14,
      bombo:   'x......x..x.....',
      tarola:  '....x.......x...',
      chimbau: 'x.x.x.x.x.x.x.x.',
      baixo: [[0, 36, 4], [8, 40, 3], [12, 38, 3]],
    },
    'afrobeats': {
      bpm: 106,
      bombo:   'x..x....x..x....',
      tarola:  '....x.......x...',
      agogo:   '..x..x.x..x..x.x',
      baixo: [[0, 38, 3], [3, 45, 2], [8, 41, 3], [11, 38, 2]],
      acordes: [[0, [62, 65, 69], 7], [8, [60, 64, 67], 7]],
    },
    'kizomba': {
      bpm: 90,
      bombo:   'x.....x.x.......',
      tarola:  '............x...',
      chimbau: '..x...x...x...x.',
      baixo: [[0, 36, 5], [6, 36, 2], [8, 43, 4]],
      acordes: [[0, [60, 63, 67], 7], [8, [58, 62, 65], 7]],
    },
    'zouk': {
      bpm: 100,
      bombo:   'x.......x.......',
      tarola:  '....x.......x...',
      chimbau: '..x...x...x...x.',
      baixo: [[0, 38, 4], [8, 45, 3], [12, 43, 3]],
      acordes: [[2, [62, 66, 69], 3], [10, [60, 64, 67], 3]],
    },
    'funana': {
      // Depressa e sem parar, como o ferrinho manda.
      bpm: 152,
      bombo:   'x...x...x...x...',
      agogo:   'xxxxxxxxxxxxxxxx',
      tarola:  '..x...x...x...x.',
      baixo: [[0, 38, 2], [2, 45, 2], [4, 43, 2], [6, 45, 2], [8, 38, 2], [10, 45, 2], [12, 41, 2], [14, 43, 2]],
    },
    'coladeira': {
      bpm: 124,
      bombo:   'x.....x.x.......',
      tarola:  '....x.......x...',
      agogo:   '..x.x..x..x.x..x',
      baixo: [[0, 40, 3], [6, 45, 2], [8, 43, 3], [12, 40, 3]],
      acordes: [[2, [64, 67, 71], 3], [10, [62, 65, 69], 3]],
    },
    'morna': {
      bpm: 74,
      bombo:   'x.......x.......',
      chimbau: '....x.......x...',
      baixo: [[0, 36, 7], [8, 43, 7]],
      acordes: [[0, [60, 63, 67, 70], 7], [8, [58, 62, 65, 67], 7]],
    },
    'batuque': {
      // Palmas e tambor grave, que é o corpo do batuque.
      bpm: 118,
      bombo:   'x..x..x...x..x..',
      palmas:  '..x..x..x..x..x.',
      agogo:   'x.x.x.x.x.x.x.x.',
      baixo: [[0, 36, 4], [6, 36, 2], [10, 38, 3]],
    },
    'r-b': {
      bpm: 76, balanco: 0.1,
      bombo:   'x.......x...x...',
      tarola:  '........x.......',
      chimbau: 'x.x.x.x.x.x.x.x.',
      baixo: [[0, 36, 5], [8, 41, 4]],
      acordes: [[0, [60, 64, 67, 71], 7], [8, [57, 60, 64, 67], 7]],
    },
    'reggae-dancehall': {
      bpm: 142,
      // One drop: o bombo entra ao terceiro tempo, não ao primeiro.
      bombo:   '........x.......',
      tarola:  '........x.......',
      chimbau: '..x...x...x...x.',
      baixo: [[0, 33, 3], [5, 36, 2], [8, 33, 3], [13, 31, 2]],
      // O "skank" fora do tempo é o que faz soar a reggae.
      acordes: [[4, [60, 63, 67], 1], [12, [60, 63, 67], 1]],
    },
    'gospel': {
      bpm: 78,
      bombo:   'x.......x.......',
      tarola:  '....x.......x...',
      chimbau: 'x.x.x.x.x.x.x.x.',
      baixo: [[0, 36, 7], [8, 43, 7]],
      acordes: [[0, [60, 64, 67, 71], 7], [8, [62, 65, 69, 72], 7]],
    },
    'pop': {
      bpm: 118,
      bombo:   'x...x...x...x...',
      tarola:  '....x.......x...',
      chimbau: '..x...x...x...x.',
      baixo: [[0, 41, 4], [4, 38, 4], [8, 36, 4], [12, 43, 4]],
      acordes: [[0, [65, 69, 72], 3], [4, [62, 65, 69], 3], [8, [60, 64, 67], 3], [12, [67, 71, 74], 3]],
    },
    // Para um estilo que o estúdio acrescente e que não tenha ritmo próprio.
    '_padrao': {
      bpm: 100,
      bombo:   'x...x...x...x...',
      tarola:  '....x.......x...',
      chimbau: 'x.x.x.x.x.x.x.x.',
      baixo: [[0, 38, 4], [8, 36, 4]],
    },
  };

  // ---- Máquina de som ------------------------------------------------------
  let ctx = null, mestre = null, ruido = null;
  let aTocar = null;   // { estilo, parar() }
  const ouvintes = new Set();

  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  function ficha(nome) {
    return String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // O contexto só nasce ao primeiro clique: os browsers não deixam fazer som
  // sem um gesto de quem está a ver, e ainda bem.
  function contexto() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      mestre = ctx.createGain();
      mestre.gain.value = VOLUME;
      // Quando o bombo, o baixo e os acordes caem no mesmo tempo, as ondas
      // somam-se e passam do limite — que em som digital é estalido, não
      // volume. O compressor à saída trava esses picos.
      const limitador = ctx.createDynamicsCompressor();
      limitador.threshold.value = -8;
      limitador.knee.value = 6;
      limitador.ratio.value = 12;
      limitador.attack.value = 0.002;
      limitador.release.value = 0.12;
      mestre.connect(limitador).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function bufferRuido() {
    if (!ruido) {
      ruido = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = ruido.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ruido;
  }

  function envelope(g, t, ataque, queda, pico) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(pico, 0.0002), t + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ataque + queda);
  }

  function percussaoRuido(t, { corte, tipo = 'highpass', queda, vol }) {
    const n = ctx.createBufferSource();
    n.buffer = bufferRuido();
    const f = ctx.createBiquadFilter();
    f.type = tipo;
    f.frequency.value = corte;
    const g = ctx.createGain();
    envelope(g, t, 0.001, queda, vol);
    n.connect(f).connect(g).connect(mestre);
    n.start(t);
    n.stop(t + queda + 0.08);
  }

  const bombo = (t, vol = 1) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    o.frequency.setValueAtTime(135, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    envelope(g, t, 0.003, 0.34, 0.95 * vol);
    o.connect(g).connect(mestre);
    o.start(t); o.stop(t + 0.45);
  };

  const tarola = (t) => {
    percussaoRuido(t, { corte: 1500, queda: 0.15, vol: 0.34 });
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    const g = ctx.createGain();
    envelope(g, t, 0.001, 0.09, 0.26);
    o.connect(g).connect(mestre);
    o.start(t); o.stop(t + 0.16);
  };

  const palmas = (t) => {
    for (const atraso of [0, 0.012, 0.026]) {
      percussaoRuido(t + atraso, { corte: 1100, tipo: 'bandpass', queda: 0.1, vol: 0.2 });
    }
  };

  const chimbau = (t, vol = 1) => percussaoRuido(t, { corte: 7500, queda: 0.035, vol: 0.14 * vol });
  const agogo = (t) => percussaoRuido(t, { corte: 4200, tipo: 'bandpass', queda: 0.045, vol: 0.12 });

  function baixo(t, nota, dur, deslizaDe) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    o.frequency.setValueAtTime(hz(deslizaDe === undefined ? nota : deslizaDe), t);
    if (deslizaDe !== undefined) o.frequency.exponentialRampToValueAtTime(hz(nota), t + Math.min(0.22, dur * 0.6));
    envelope(g, t, 0.006, dur, 0.55);
    o.connect(g).connect(mestre);
    o.start(t); o.stop(t + dur + 0.1);
  }

  function acorde(t, notas, dur) {
    for (const nota of notas) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz(nota);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2000;
      const g = ctx.createGain();
      envelope(g, t, 0.02, dur, 0.13);
      o.connect(f).connect(g).connect(mestre);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }

  // Monta os compassos precisos para encher os 5 segundos.
  function sintetizar(estilo) {
    const r = RITMOS[ficha(estilo)] || RITMOS._padrao;
    const passo = 60 / r.bpm / 4;
    const compasso = passo * 16;
    const compassos = Math.max(1, Math.round(DURACAO / compasso));
    const inicio = ctx.currentTime + 0.06;
    const balanco = (i) => (r.balanco && i % 2 ? passo * r.balanco : 0);

    for (let c = 0; c < compassos; c++) {
      const base = inicio + c * compasso;
      for (let i = 0; i < 16; i++) {
        const t = base + i * passo + balanco(i);
        if (r.bombo && r.bombo[i] === 'x') bombo(t);
        if (r.tarola && r.tarola[i] === 'x') tarola(t);
        if (r.palmas && r.palmas[i] === 'x') palmas(t);
        if (r.agogo && r.agogo[i] === 'x') agogo(t);
        if (r.chimbau && r.chimbau[i] === 'x') {
          // Rufo: a semicolcheia parte-se em três.
          if (r.rufos && r.rufos.includes(i)) {
            for (let k = 0; k < 3; k++) chimbau(t + (k * passo) / 3, 0.8);
          } else chimbau(t);
        }
      }
      for (const [i, nota, comp, de] of r.baixo || []) baixo(base + i * passo, nota, comp * passo, de);
      for (const [i, notas, comp] of r.acordes || []) acorde(base + i * passo, notas, comp * passo);
    }
    return compassos * compasso;
  }

  // ---- Silêncio ------------------------------------------------------------
  let silenciado = false;
  try { silenciado = window.localStorage.getItem(CHAVE_SILENCIO) === 'off'; } catch (_) { /* sem armazenamento */ }

  function silencio(novo) {
    if (novo !== undefined) {
      silenciado = !!novo;
      try { window.localStorage.setItem(CHAVE_SILENCIO, silenciado ? 'off' : 'on'); } catch (_) { /* paciência */ }
      if (silenciado) parar();
      avisar();
    }
    return silenciado;
  }

  function avisar() {
    for (const f of ouvintes) f(aTocar ? aTocar.estilo : null, silenciado);
  }

  function parar() {
    if (!aTocar) return;
    const p = aTocar;
    aTocar = null;
    p.parar();
    avisar();
  }

  // ---- Tocar ---------------------------------------------------------------
  // Carregar numa etiqueta toca-a sempre, mesmo que já estivesse escolhida —
  // quem carrega quer ouvir. O guarda dos 200 ms é para o caso de o browser
  // dar o clique e a mudança de escolha como dois avisos seguidos: nesse caso
  // não se recomeça o trecho duas vezes.
  let ultimoArranque = 0;

  function tocar(estilo) {
    const agora = Date.now();
    if (aTocar && aTocar.estilo === estilo && agora - ultimoArranque < 200) return;
    parar();
    if (silenciado || !estilo) return;
    if (!contexto()) return;
    ultimoArranque = agora;

    // O trecho do estúdio, se existir, ganha sempre ao sintetizado.
    const sons = window.SONS || {};
    const url = sons[estilo] || sons[ficha(estilo)];
    if (url) {
      const audio = new Audio(url);
      audio.volume = 0.9;
      let fim = 0;
      const acabar = () => { clearTimeout(fim); audio.pause(); };
      audio.addEventListener('error', () => { if (aTocar && aTocar.estilo === estilo) { parar(); } });
      audio.play().then(() => { fim = setTimeout(() => parar(), DURACAO * 1000); }).catch(() => parar());
      aTocar = { estilo, parar: acabar };
      avisar();
      return;
    }

    const segundos = sintetizar(estilo);
    const fim = setTimeout(() => parar(), segundos * 1000);
    // Cortar a meio é baixar o volume geral e voltar a subi-lo: os toques já
    // estão agendados e não se cancelam um a um.
    const acabar = () => {
      clearTimeout(fim);
      const agora = ctx.currentTime;
      mestre.gain.cancelScheduledValues(agora);
      mestre.gain.setValueAtTime(mestre.gain.value, agora);
      mestre.gain.exponentialRampToValueAtTime(0.0001, agora + 0.06);
      setTimeout(() => { if (!aTocar) mestre.gain.setValueAtTime(VOLUME, ctx.currentTime); }, 120);
    };
    aTocar = { estilo, parar: acabar };
    avisar();
  }

  window.Studio.som = {
    tocar, parar, silencio,
    aTocar: () => (aTocar ? aTocar.estilo : null),
    aoMudar: (f) => { ouvintes.add(f); return () => ouvintes.delete(f); },
    temRitmo: (estilo) => !!RITMOS[ficha(estilo)],
  };
})();
