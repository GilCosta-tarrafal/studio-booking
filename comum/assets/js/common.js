/* Funções partilhadas pelo site e pelo painel. Sem dependências. */
(function () {
  'use strict';

  // O site tem três línguas (ver /js/prefs.js); o painel corre sempre em
  // português e não carrega esse ficheiro, daí este substituto mínimo.
  const I18N = window.I18N || {
    t: (chave) => window.DICIONARIO.t('pt', chave),
    lingua: 'pt', locale: 'pt-PT',
    lista: (chave) => window.DICIONARIO.t('pt', chave).split(','),
  };
  const t = I18N.t;

  // O texto escrito no painel (nome de um serviço, descrição de uma sala...)
  // na língua ativa. As traduções vêm do servidor no campo "i18n" de cada
  // objeto; sem tradução, fica o português, que é o original.
  function tr(obj, campo) {
    const l = obj && obj.i18n && obj.i18n[I18N.lingua];
    return (l && l[campo]) || (obj ? obj[campo] : '');
  }

  // Texto dos ficheiros de conteúdo (novidades, singles): ou só uma frase, que
  // vale para todas as línguas, ou { pt: '...', en: '...', fr: '...' }.
  function trTexto(v) {
    if (!v || typeof v !== 'object') return v || '';
    return v[I18N.lingua] || v.pt || Object.values(v)[0] || '';
  }

  const ESTADOS = ['pedido', 'confirmado', 'em_curso', 'concluido', 'cancelado'];
  const estados = () => Object.fromEntries(ESTADOS.map((k) => [k, t('estado.' + k)]));

  // ---- Construção segura de DOM (nunca usa innerHTML com dados) ----
  function append(el, kids) {
    for (const k of kids) {
      if (k === null || k === undefined || k === false) continue;
      if (Array.isArray(k)) append(el, k);
      else if (k instanceof Node) el.appendChild(k);
      else el.appendChild(document.createTextNode(String(k)));
    }
  }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    const late = {};
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'selected') late[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    append(el, kids);
    for (const [k, v] of Object.entries(late)) el[k] = v; // depois das opções, para <select>
    return el;
  }

  // Ícones em SVG. Desenhados a traço, herdam a cor do texto à volta.
  const SVG = 'http://www.w3.org/2000/svg';
  const CAIXA = 'M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5z';
  const TELEFONE = 'M7.6 3.8h2.6l1.2 3.2-1.8 1.3a11.4 11.4 0 0 0 5.1 5.1l1.3-1.8 3.2 1.2v2.6a1.8 1.8 0 0 1-2 1.8A15.6 15.6 0 0 1 5.8 5.8a1.8 1.8 0 0 1 1.8-2z';
  const ICONES = {
    instagram: [CAIXA, 'M12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6z', 'M17.2 6.9h.01'],
    whatsapp: [
      'M12 3.9a8.1 8.1 0 0 1 0 16.2 8 8 0 0 1-4.1-1.1L4 20.1l1.2-3.8A8.1 8.1 0 0 1 12 3.9z',
      { d: TELEFONE, transform: 'translate(12 12) scale(.5) translate(-12 -12)' },
    ],
    spotify: [
      'M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8z',
      'M7.4 9.4a12 12 0 0 1 9.3 1',
      'M8.1 12.3a9.5 9.5 0 0 1 7.5.9',
      'M8.8 15a7 7 0 0 1 5.7.7',
    ],
    youtube: [
      'M4.6 6.4h14.8a2.6 2.6 0 0 1 2.6 2.6v6a2.6 2.6 0 0 1-2.6 2.6H4.6A2.6 2.6 0 0 1 2 15V9a2.6 2.6 0 0 1 2.6-2.6z',
      'M10.4 9.5l4.7 2.5-4.7 2.5z',
    ],
    play: [
      'M12 3.8a8.2 8.2 0 1 1 0 16.4 8.2 8.2 0 0 1 0-16.4z',
      'M10.4 9.1l4.9 2.9-4.9 2.9z',
    ],
    telefone: [TELEFONE],
    email: ['M3.6 6.4h16.8v11.2H3.6z', 'M4 7l8 5.6L20 7'],
    local: ['M12 20.8s6.6-5.4 6.6-10.4a6.6 6.6 0 1 0-13.2 0c0 5 6.6 10.4 6.6 10.4z', 'M12 8.3a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6z'],

    // Os que assinalam cada serviço, ao fundo do cartão (ver servicoIcone).
    microfone: [
      'M12 3.4a2.9 2.9 0 0 1 2.9 2.9v5.2a2.9 2.9 0 0 1-5.8 0V6.3A2.9 2.9 0 0 1 12 3.4z',
      'M6.6 11a5.4 5.4 0 0 0 10.8 0',
      'M12 16.4v4.2',
      'M9.2 20.6h5.6',
    ],
    mesa: [
      'M6 3.6v16.8', 'M12 3.6v16.8', 'M18 3.6v16.8',
      'M4.4 7.4h3.2v2.6H4.4z', 'M10.4 13.4h3.2v2.6h-3.2z', 'M16.4 5.6h3.2v2.6h-3.2z',
    ],
    disco: [
      'M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2z',
      'M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z',
      'M12 11.7h.01',
    ],
    teclas: [
      'M3.6 5.8h16.8v12.4H3.6z',
      'M8.4 5.8v7.8', 'M12 5.8v7.8', 'M15.6 5.8v7.8',
    ],
    coluna: [
      'M5.6 3.4h12.8a1.8 1.8 0 0 1 1.8 1.8v13.6a1.8 1.8 0 0 1-1.8 1.8H5.6a1.8 1.8 0 0 1-1.8-1.8V5.2a1.8 1.8 0 0 1 1.8-1.8z',
      'M12 10.6a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2z',
      'M8 6.9h.01', 'M16 6.9h.01',
    ],
    tesoura: [
      'M6.6 4.2l10.8 13.2', 'M17.4 4.2L6.6 17.4',
      'M5.6 17.4a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z',
      'M18.4 17.4a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z',
    ],
    ondas: ['M3.6 10.2v3.6', 'M7.8 7.2v9.6', 'M12 4.2v15.6', 'M16.2 8.4v7.2', 'M20.4 10.8v2.4'],
    duvida: [
      'M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2z',
      'M9.6 9.4a2.4 2.4 0 0 1 4.8.4c0 1.6-2.4 1.9-2.4 3.6',
      'M12 16.6h.01',
    ],
    // Ver / ocultar a palavra-passe.
    olho: [
      'M2.8 12S6 6.2 12 6.2 21.2 12 21.2 12 18 17.8 12 17.8 2.8 12 2.8 12z',
      'M12 9.3a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4z',
    ],
    olhoRiscado: [
      'M4.8 5.4A12.7 12.7 0 0 0 2.8 12S6 17.8 12 17.8a9.8 9.8 0 0 0 4-.8',
      'M9.6 6.5A9.6 9.6 0 0 1 12 6.2C18 6.2 21.2 12 21.2 12a13 13 0 0 1-2.9 3.3',
      'M9.9 9.9a2.7 2.7 0 0 0 3.8 3.8',
      'M4 4l16 16',
    ],
  };
  // O Instagram identifica-se pelo degradê, que o CSS não consegue pôr num
  // traço — tem de vir dentro do SVG. As restantes redes herdam a cor do CSS.
  const DEGRADES = {
    instagram: [['0%', '#FDCB52'], ['28%', '#F2683C'], ['62%', '#E1306C'], ['100%', '#7C3AED']],
  };
  let contaIcones = 0;

  function icone(nome, tamanho = 20) {
    const svg = document.createElementNS(SVG, 'svg');
    for (const [k, v] of Object.entries({
      viewBox: '0 0 24 24', width: tamanho, height: tamanho, fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
    })) svg.setAttribute(k, v);
    const degrade = DEGRADES[nome];
    if (degrade) {
      const gid = 'deg-' + nome + '-' + (++contaIcones);
      const defs = document.createElementNS(SVG, 'defs');
      const lg = document.createElementNS(SVG, 'linearGradient');
      lg.setAttribute('id', gid);
      for (const [k, v] of Object.entries({ x1: '8%', y1: '92%', x2: '92%', y2: '8%' })) lg.setAttribute(k, v);
      for (const [pos, cor] of degrade) {
        const stop = document.createElementNS(SVG, 'stop');
        stop.setAttribute('offset', pos);
        stop.setAttribute('stop-color', cor);
        lg.appendChild(stop);
      }
      defs.appendChild(lg);
      svg.appendChild(defs);
      svg.setAttribute('stroke', 'url(#' + gid + ')');
    }

    for (const parte of ICONES[nome] || []) {
      const p = document.createElementNS(SVG, 'path');
      if (typeof parte === 'string') p.setAttribute('d', parte);
      else {
        p.setAttribute('d', parte.d);
        p.setAttribute('transform', parte.transform);
        // sem isto, reduzir o desenho afinava também a espessura do traço
        p.setAttribute('vector-effect', 'non-scaling-stroke');
      }
      svg.appendChild(p);
    }
    return svg;
  }

  // O desenho que assinala cada serviço sai do nome que o estúdio lhe deu:
  // assim não é preciso escolher nada no painel, e um serviço novo já nasce
  // com o seu. A lista é percorrida por ordem — "Gravação de instrumentos" é
  // uma gravação, não um instrumental —, e o que não encaixe em nada fica com
  // as barras de som, que servem para qualquer trabalho de áudio.
  const DESENHOS_SERVICO = [
    [/grava|record|enregistr|voz|vocal|voice|locu|podcast|canto/, 'microfone'],
    [/mistur|mixag|mixing|\bmix/, 'mesa'],
    [/master/, 'disco'],
    [/produ|beat|arranj|compos|instrument|maquet/, 'teclas'],
    [/ensaio|ensai|rehears|repetit|repet|banda|\bband/, 'coluna'],
    [/edic|edit|montag|corte|mont/, 'tesoura'],
  ];

  // Sem acentos e em minúsculas, para "Masterização" e "Masterizacao" darem no mesmo.
  function servicoIcone(nome) {
    const limpo = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const achado = DESENHOS_SERVICO.find(([re]) => re.test(limpo));
    return achado ? achado[1] : 'ondas';
  }

  // O desenho em marca de água, para o fundo do cartão de um serviço.
  function fundoServico(nome, tamanho = 78) {
    const svg = icone(servicoIcone(nome), tamanho);
    svg.setAttribute('class', 'fundo-servico');
    return svg;
  }

  // ---- Pedidos à API ----
  async function api(url, { method = 'GET', body, onUnauthorized } = {}) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'studio' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (_) {
      throw new Error(t('api.semLigacao'));
    }
    let data = {};
    try { data = await res.json(); } catch (_) { /* sem corpo */ }
    if (!res.ok) {
      if (res.status === 401 && onUnauthorized) onUnauthorized();
      const err = new Error(data.error || t('api.erro'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---- Formatação ----
  const pad = (n) => String(n).padStart(2, '0');
  const fmtMin = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  const parseHM = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    return m ? +m[1] * 60 + +m[2] : null;
  };

  function dateObj(iso) { return new Date(iso + 'T00:00:00Z'); }

  function fmtDate(iso, style = 'long') {
    const d = dateObj(iso);
    const opts = style === 'short'
      ? { weekday: 'short', day: 'numeric', month: 'short' }
      : { weekday: 'long', day: 'numeric', month: 'long' };
    return new Intl.DateTimeFormat(I18N.locale, { ...opts, timeZone: 'UTC' }).format(d);
  }

  function fmtDateFull(iso) {
    return new Intl.DateTimeFormat(I18N.locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(dateObj(iso));
  }

  function addDays(iso, n) {
    const d = dateObj(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function fmtDuration(min) {
    const hh = Math.floor(min / 60), mm = min % 60;
    if (!hh) return t('duracao.min', { m: mm });
    return mm ? t('duracao.hm', { h: hh, m: pad(mm) }) : t('duracao.h', { h: hh });
  }

  function money(n, cur) {
    return new Intl.NumberFormat(I18N.locale, { maximumFractionDigits: 0 }).format(n || 0) + (cur ? '\u00A0' + cur : '');
  }

  // Link do WhatsApp; acrescenta o indicativo do país a números locais.
  function waLink(biz, phone, text) {
    let d = String(phone || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('00')) d = d.slice(2);
    else if (d.length <= 8 && biz && biz.country_code) d = biz.country_code + d;
    return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
  }

  function telLink(phone) {
    const d = String(phone || '').replace(/[^\d+]/g, '');
    return d ? 'tel:' + d : null;
  }

  const statusTag = (s) => h('span', { class: 'tag', 'data-s': s }, ESTADOS.includes(s) ? t('estado.' + s) : s);

  // ---- Régua do dia: livre / ocupado numa faixa horizontal ----
  function renderStrip({ open, close, busy = [], now = null, closed = false }) {
    const span = close - open;
    const pct = (m) => (((m - open) / span) * 100).toFixed(3) + '%';
    const track = h('div', { class: 'strip-track' + (closed ? ' is-closed' : '') });
    for (let m = Math.ceil(open / 60) * 60; m < close; m += 60) {
      if (m > open) track.append(h('span', { class: 'strip-tick', style: { '--l': pct(m) } }));
    }
    for (const [s, e] of busy) {
      const a = Math.max(s, open), b = Math.min(e, close);
      if (b > a) track.append(h('span', { class: 'strip-seg busy', style: { '--l': pct(a), '--w': (((b - a) / span) * 100).toFixed(3) + '%' } }));
    }
    if (now !== null && now >= open && now <= close) track.append(h('span', { class: 'strip-now', style: { '--l': pct(now) } }));

    const step = span / 60 > 12 ? 120 : 60;
    const scale = h('div', { class: 'strip-scale', 'aria-hidden': 'true' });
    const marks = [];
    for (let m = Math.ceil(open / 60) * 60; m <= close; m += step) marks.push(m);
    // Numa régua estreita só cabe uma etiqueta sim, outra não ("menor" fica
    // escondida no CSS). A primeira e a última ficam sempre; se a última cair
    // numa posição ímpar, esconde-se a anterior para não ficarem coladas.
    const n = marks.length - 1;
    marks.forEach((m, i) => {
      const menor = i > 0 && i < n && (i % 2 === 1 || (n % 2 === 1 && i === n - 1));
      const cls = [m === open ? 'first' : m === close ? 'last' : '', menor ? 'menor' : ''].join(' ').trim();
      scale.append(h('span', { class: cls, style: { '--l': pct(m) } }, Math.floor(m / 60) + 'h'));
    });
    const label = closed ? t('regua.fechado')
      : busy.length ? t('regua.ocupado', { lista: busy.map(([s, e]) => t('regua.intervalo', { de: fmtMin(s), ate: fmtMin(e) })).join('; ') })
        : t('regua.livre');
    return h('div', { class: 'strip', role: 'img', 'aria-label': label }, track, scale);
  }

  // "Seg–Sex 09:00–21:00", "Sáb 10:00–20:00", "Dom fechado"
  // "fechado" é uma marca interna, só para agrupar dias iguais; quem desenha
  // troca-a pela palavra traduzida (ver o campo "closed").
  function hoursSummary(hours) {
    const curtos = I18N.lista('dias.curtos');
    const order = [1, 2, 3, 4, 5, 6, 0];
    const sig = (d) => (d ? d.open + '–' + d.close : 'fechado');
    const groups = [];
    for (const i of order) {
      const s = sig(hours[i]);
      const last = groups[groups.length - 1];
      if (last && last.sig === s) last.days.push(i);
      else groups.push({ sig: s, days: [i] });
    }
    return groups.map((g) => {
      const first = curtos[g.days[0]], lastD = curtos[g.days[g.days.length - 1]];
      return { days: g.days.length > 1 ? `${first}–${lastD}` : first, hours: g.sig, closed: g.sig === 'fechado' };
    });
  }

  // STATUS, DAY_SHORT e DAY_LONG são lidos uma vez por quem os usa; por isso
  // são propriedades calculadas, que devolvem já os textos da língua ativa.
  window.Studio = {
    t, tr, trTexto, I18N, h, api, fmtMin, parseHM, fmtDate, fmtDateFull, fmtDuration,
    addDays, money, waLink, telLink, statusTag, renderStrip, hoursSummary, icone,
    servicoIcone, fundoServico,
    get STATUS() { return estados(); },
    get DAY_SHORT() { return I18N.lista('dias.curtos'); },
    get DAY_LONG() { return I18N.lista('dias.longos'); },
  };
})();
