/* Painel de gestão: Dashboard — o dinheiro e as sessões de cada mês em
   gráficos. Cartões com o mês escolhido comparado com o anterior, o fluxo
   financeiro (barras, linha ou área) em 3 meses, 6 meses ou um ano, a
   faturação por serviço e, por baixo, a agenda (pedidos, hoje, 7 dias).
   Clicar num mês escolhe-o: os cartões e o donut passam a ser desse mês. */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h, money } = S;
  const { app, ui, views, api, pageHead, studioFilter, openBooking } = A;
  const cur = () => app.settings.currency;
  const locale = () => (window.I18N && window.I18N.locale) || 'pt-PT';
  const NS = 'http://www.w3.org/2000/svg';

  // Escolhas da pessoa (tipo de gráfico e período) ficam guardadas no navegador.
  const guardado = (() => { try { return JSON.parse(localStorage.getItem('admin-dashboard') || '{}'); } catch (_) { return {}; } })();
  const est = {
    modo: ['barras', 'linha', 'area'].includes(guardado.modo) ? guardado.modo : 'barras',
    meses: [3, 6, 12].includes(guardado.meses) ? guardado.meses : 12,
    sel: null,          // mês escolhido ('2026-11'); null = o mês atual
  };
  const guardar = () => { try { localStorage.setItem('admin-dashboard', JSON.stringify({ modo: est.modo, meses: est.meses })); } catch (_) { /* privado */ } };

  // Duas séries, cores da paleta do painel (slots 1 e 3, validados juntos).
  const SERIES = [
    { k: 'billed', label: 'Faturado', cls: 'c1' },
    { k: 'received', label: 'Recebido', cls: 'c3' },
  ];

  // ---------------------------------------------------------- Formatação
  const mesCurto = (m) => new Date(m + '-15T12:00:00Z').toLocaleDateString(locale(), { month: 'short', timeZone: 'UTC' }).replace('.', '');
  const mesLongo = (m) => {
    const s = new Date(m + '-15T12:00:00Z').toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const compacto = (v) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const pct = (v) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(v) + '%';

  function svg(tag, attrs = {}, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
    for (const k of kids) if (k) el.append(k);
    return el;
  }

  // Topo de escala "redondo" (1, 2, 2,5 ou 5 × 10ⁿ) e os traços da grelha.
  function escala(max) {
    if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
    const bruto = max / 4;
    const p = 10 ** Math.floor(Math.log10(bruto));
    const passo = [1, 2, 2.5, 5, 10].map((f) => f * p).find((s) => s >= bruto);
    return { top: passo * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * passo) };
  }

  // ---------------------------------------------------------- Cartões (KPI)
  function variacao(atual, anterior) {
    if (!anterior && !atual) return h('span', { class: 'dv-delta flat' }, '—');
    if (!anterior) return h('span', { class: 'dv-delta up' }, '▲ novo');
    const v = ((atual - anterior) / anterior) * 100;
    if (Math.abs(v) < 0.05) return h('span', { class: 'dv-delta flat' }, '= 0%');
    return h('span', { class: 'dv-delta ' + (v > 0 ? 'up' : 'down') }, (v > 0 ? '▲ ' : '▼ ') + pct(Math.abs(v)));
  }

  function cartao(label, cls, valor, delta, sub) {
    return h('div', { class: 'dv-card dv-kpi' },
      h('span', { class: 'dv-kpi-l' }, cls && h('span', { class: 'dv-dot ' + cls }), label),
      h('strong', { class: 'dv-kpi-v' }, valor),
      h('span', { class: 'dv-kpi-s' }, delta, h('span', {}, sub)));
  }

  // ---------------------------------------------------------- Fluxo financeiro
  // Desenha o gráfico no `box` (largura medida).
  function fluxo(box, dados, { modo, selIdx, animar, aoEscolher }) {
    const W = Math.max(box.clientWidth || 0, 320), H = 290;
    const pad = { t: 18, r: 10, b: 30, l: 50 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const n = dados.length;
    const gw = iw / n;
    const max = Math.max(0, ...dados.flatMap((d) => SERIES.map((s) => d[s.k])));
    const { top, ticks } = escala(max);
    const y = (v) => pad.t + ih - (v / top) * ih;
    const xc = (i) => pad.l + gw * i + gw / 2;

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'dv-svg' + (animar ? ' anim' : ''), role: 'img', 'aria-label': 'Fluxo financeiro: faturado e recebido por mês' });
    const defs = svg('defs');
    const realce = svg('linearGradient', { id: 'dv-realce', x1: 0, y1: 0, x2: 0, y2: 1 },
      svg('stop', { offset: '0%', class: 'dv-band-a' }), svg('stop', { offset: '100%', class: 'dv-band-b' }));
    defs.append(realce);
    SERIES.forEach((s, i) => defs.append(svg('linearGradient', { id: 'dv-area-' + i, x1: 0, y1: 0, x2: 0, y2: 1 },
      svg('stop', { offset: '0%', class: 'dv-area-a ' + s.cls }), svg('stop', { offset: '100%', class: 'dv-area-b ' + s.cls }))));
    root.append(defs);

    // Grelha e eixo dos valores (recessivos).
    for (const t of ticks) {
      root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: 'dv-gl' + (t === 0 ? ' base' : '') }));
      const lbl = svg('text', { x: pad.l - 10, y: y(t), class: 'dv-axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
      lbl.textContent = compacto(t);
      root.append(lbl);
    }

    // Faixa do mês escolhido, por trás das marcas.
    if (selIdx >= 0) {
      root.append(svg('rect', { x: pad.l + gw * selIdx + gw * 0.12, y: pad.t - 8, width: gw * 0.76, height: ih + 8, rx: 10, fill: 'url(#dv-realce)', class: 'dv-band' }));
    }

    const marcas = svg('g', { class: 'dv-marks' });
    if (modo === 'barras') {
      const bw = Math.min(18, Math.max(4, gw * 0.26));
      dados.forEach((d, i) => {
        SERIES.forEach((s, j) => {
          const v = d[s.k];
          const x = xc(i) + (j === 0 ? -bw - 1 : 1);      // 2px de folga entre as duas barras
          const hgt = Math.max(0, y(0) - y(v));
          if (hgt <= 0) return;
          const r = Math.min(4, bw / 2, hgt);
          const y0 = y(0), y1 = y(v);
          marcas.append(svg('path', {
            class: 'dv-bar ' + s.cls,
            d: `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + bw - r}Q${x + bw},${y1} ${x + bw},${y1 + r}V${y0}Z`,
          }));
        });
      });
    } else {
      SERIES.forEach((s, j) => {
        const pts = dados.map((d, i) => [xc(i), y(d[s.k])]);
        const linha = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
        if (modo === 'area') {
          marcas.append(svg('path', { class: 'dv-area', d: `${linha}L${pts[n - 1][0]},${y(0)}L${pts[0][0]},${y(0)}Z`, fill: `url(#dv-area-${j})` }));
        }
        marcas.append(svg('path', { class: 'dv-line ' + s.cls, d: linha, pathLength: 1 }));
        pts.forEach((p, i) => {
          if (i === selIdx || n <= 6) marcas.append(svg('circle', { class: 'dv-pt ' + s.cls + (i === selIdx ? ' sel' : ''), cx: p[0], cy: p[1], r: i === selIdx ? 5.5 : 4 }));
        });
      });
    }
    root.append(marcas);

    // Meses no eixo de baixo; o escolhido em destaque.
    dados.forEach((d, i) => {
      const t = svg('text', { x: xc(i), y: H - 9, class: 'dv-axis dv-month' + (i === selIdx ? ' sel' : ''), 'text-anchor': 'middle' });
      t.textContent = mesCurto(d.month);
      root.append(t);
    });

    // Camada de interação: uma coluna invisível por mês (alvo maior do que a
    // marca). Passar mostra a dica com as duas séries; clicar escolhe o mês.
    const cross = svg('line', { class: 'dv-cross', y1: pad.t - 8, y2: pad.t + ih, x1: 0, x2: 0, visibility: 'hidden' });
    root.append(cross);
    const dica = h('div', { class: 'dv-tip', role: 'status', hidden: true });
    dados.forEach((d, i) => {
      const alvo = svg('rect', { x: pad.l + gw * i, y: pad.t - 10, width: gw, height: ih + pad.b + 10, class: 'dv-hit', tabindex: 0, role: 'button', 'aria-label': `${mesLongo(d.month)}: faturado ${money(d.billed, cur())}, recebido ${money(d.received, cur())}` });
      const mostrar = () => {
        if (modo !== 'barras') { cross.setAttribute('x1', xc(i)); cross.setAttribute('x2', xc(i)); cross.setAttribute('visibility', 'visible'); }
        dica.replaceChildren(
          h('span', { class: 'dv-tip-t' }, mesLongo(d.month)),
          ...SERIES.map((s) => h('span', { class: 'dv-tip-r' }, h('span', { class: 'dv-dot ' + s.cls }), h('strong', {}, money(d[s.k], cur())), h('span', {}, s.label))),
          h('span', { class: 'dv-tip-r muted' }, h('strong', {}, String(d.sessions)), h('span', {}, d.sessions === 1 ? 'sessão' : 'sessões')));
        dica.hidden = false;
        const esq = xc(i) > W * 0.62;
        dica.style.left = esq ? '' : Math.min(xc(i) + 14, W - 10) + 'px';
        dica.style.right = esq ? (W - xc(i) + 14) + 'px' : '';
        dica.style.top = '12px';
      };
      const esconder = () => { dica.hidden = true; cross.setAttribute('visibility', 'hidden'); };
      alvo.addEventListener('pointerenter', mostrar);
      alvo.addEventListener('focus', mostrar);
      alvo.addEventListener('pointerleave', esconder);
      alvo.addEventListener('blur', esconder);
      alvo.addEventListener('click', () => aoEscolher(i));
      alvo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aoEscolher(i); } });
      root.append(alvo);
    });

    const vazio = max <= 0 && h('p', { class: 'dv-empty' }, 'Ainda sem faturação neste período. Os valores aparecem aqui à medida que houver marcações.');
    box.replaceChildren(root, dica, vazio || '');
  }

  // ---------------------------------------------------------- Por serviço (donut)
  // A cor segue o serviço (ordem fixa pela faturação do ano), não a posição
  // no mês: escolher outro mês não troca as cores. Mais de 5 → "Outros".
  function coresServicos(meses) {
    const tot = new Map();
    for (const m of meses) for (const s of m.services) tot.set(s.id, (tot.get(s.id) || 0) + s.billed + s.sessions / 1000);
    const ordem = [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const cor = new Map(ordem.slice(0, 5).map((id, i) => [id, 'c' + (i + 1)]));
    return (id) => cor.get(id) || 'outros';
  }

  function donut(mes, corDe) {
    const grupos = new Map();
    for (const s of mes.services) {
      const cls = corDe(s.id);
      const k = cls === 'outros' ? 'outros' : s.id;
      const g = grupos.get(k) || { label: cls === 'outros' ? 'Outros' : s.name, cls, value: 0 };
      g.value += s.billed;
      grupos.set(k, g);
    }
    const segs = [...grupos.values()].filter((g) => g.value > 0).sort((a, b) => (a.cls === 'outros') - (b.cls === 'outros') || b.value - a.value);
    const total = segs.reduce((s, g) => s + g.value, 0);
    const size = 190, thick = 22, r = (size - thick) / 2, c = size / 2, C = 2 * Math.PI * r;
    const anel = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'dv-donut-svg anim', role: 'img', 'aria-label': 'Faturação por serviço em ' + mesLongo(mes.month) },
      svg('circle', { cx: c, cy: c, r, class: 'dv-donut-bg', 'stroke-width': thick }));
    let off = 0;
    for (const g of segs) {
      const len = (g.value / total) * C;
      const dash = Math.max(len - (segs.length > 1 ? 3 : 0), 0.01);    // folga entre segmentos
      const arco = svg('circle', {
        cx: c, cy: c, r, class: 'dv-seg ' + g.cls, 'stroke-width': thick,
        'stroke-dasharray': `${dash.toFixed(2)} ${(C - dash).toFixed(2)}`, 'stroke-dashoffset': (-off).toFixed(2),
        transform: `rotate(-90 ${c} ${c})`,
      });
      const tt = svg('title'); tt.textContent = `${g.label}: ${money(g.value, cur())}`; arco.append(tt);
      anel.append(arco);
      off += len;
    }
    const centro = h('div', { class: 'dv-donut-c' },
      h('strong', {}, total ? money(total, cur()) : '—'),
      h('span', {}, total ? 'faturado em ' + mesCurto(mes.month) : 'sem faturação'));
    const leg = segs.length
      ? h('ul', { class: 'dv-leg' }, segs.map((g) => h('li', {},
        h('span', { class: 'dv-dot ' + g.cls }), h('span', { class: 'dv-leg-l' }, g.label), h('strong', {}, money(g.value, cur())))))
      : h('p', { class: 'dv-empty' }, 'Nenhuma sessão faturada em ' + mesLongo(mes.month) + '.');
    return h('div', { class: 'dv-donut' }, h('div', { class: 'dv-donut-ring' }, anel, centro), leg);
  }

  // ---------------------------------------------------------- Controlos
  function segmentado(rotulo, opcoes, atual, aoMudar) {
    return h('div', { class: 'dv-seg', role: 'group', 'aria-label': rotulo },
      opcoes.map(([v, label, icone]) => h('button', {
        type: 'button', 'aria-pressed': String(v === atual), onclick: () => aoMudar(v),
      }, icone && h('span', { class: 'dv-seg-i', 'aria-hidden': 'true' }, icone), label)));
  }

  // ---------------------------------------------------------- Vista
  views.dashboard = {
    title: 'Dashboard',
    async render(box) {
      const qs = ui.studio ? '?studio_id=' + ui.studio : '';
      const [d, f] = await Promise.all([api('/api/admin/dashboard' + qs), api('/api/admin/dashboard/fluxo' + qs)]);
      const todos = f.months;                       // 13 meses, o último é o atual
      const corDe = coresServicos(todos);
      if (!est.sel || !todos.some((m) => m.month === est.sel)) est.sel = f.current;

      const zonaCartoes = h('div', { class: 'dv-kpis' });
      const chipMes = h('span', { class: 'dv-chip' });
      const grafBox = h('div', { class: 'dv-chart' });
      const donutBox = h('div', {});
      const tituloDonut = h('h2', {}, 'Faturação por serviço');
      const tabela = h('tbody');
      const controlos = h('div', { class: 'dv-controls' });

      const visiveis = () => todos.slice(-est.meses);

      function desenhar(animar) {
        const vis = visiveis();
        const selIdx = vis.findIndex((m) => m.month === est.sel);
        const iTodos = todos.findIndex((m) => m.month === est.sel);
        const m = todos[iTodos], ant = todos[iTodos - 1];
        // O mês atual ainda vai a meio: avisa-se, para a queda não assustar.
        const vs = m.month === f.current ? 'vs. mês anterior (mês em curso)' : 'vs. mês anterior';
        zonaCartoes.replaceChildren(
          cartao('Faturado', 'c1', money(m.billed, cur()), variacao(m.billed, ant && ant.billed), vs),
          cartao('Recebido', 'c3', money(m.received, cur()), variacao(m.received, ant && ant.received), vs),
          cartao('Sessões', null, String(m.sessions), variacao(m.sessions, ant && ant.sessions), 'Horas de estúdio: ' + Math.round(m.minutes / 60)),
          cartao('Por receber', null, money(d.money.outstanding, cur()), null, 'total em aberto, de todos os meses'));
        chipMes.textContent = mesLongo(est.sel);
        fluxo(grafBox, vis, { modo: est.modo, selIdx, animar, aoEscolher: (i) => { est.sel = vis[i].month; desenhar(false); } });
        donutBox.replaceChildren(donut(m, corDe));
        tabela.replaceChildren(...vis.map((x) => h('tr', { class: x.month === est.sel ? 'sel' : '' },
          h('td', {}, mesLongo(x.month)), h('td', {}, money(x.billed, cur())), h('td', {}, money(x.received, cur())), h('td', {}, String(x.sessions)))));
        controlos.replaceChildren(
          segmentado('Tipo de gráfico', [['barras', 'Barras', '▮▮'], ['linha', 'Linha', '⟋'], ['area', 'Área', '◭']], est.modo, (v) => { est.modo = v; guardar(); desenhar(true); }),
          segmentado('Período', [[3, '3 meses'], [6, '6 meses'], [12, 'Ano']], est.meses, (v) => {
            est.meses = v; guardar();
            if (!visiveis().some((x) => x.month === est.sel)) est.sel = f.current;
            desenhar(true);
          }));
      }

      box.append(
        pageHead('Dashboard', studioFilter(A.refresh),
          h('button', { class: 'btn', type: 'button', onclick: () => openBooking({ onSaved: A.refresh }) }, 'Nova marcação')),
        h('div', { class: 'dv' },
          controlos,
          zonaCartoes,
          h('div', { class: 'dv-grid' },
            h('section', { class: 'dv-card dv-flow', 'aria-labelledby': 'dv-h-fluxo' },
              h('header', { class: 'dv-card-head' },
                h('h2', { id: 'dv-h-fluxo' }, 'Fluxo financeiro'),
                h('div', { class: 'dv-legend' }, SERIES.map((s) => h('span', {}, h('span', { class: 'dv-dot ' + s.cls }), s.label))),
                chipMes),
              grafBox,
              h('details', { class: 'dv-table' },
                h('summary', {}, 'Ver os números em tabela'),
                h('div', { class: 'table-wrap' }, h('table', {},
                  h('thead', {}, h('tr', {}, h('th', {}, 'Mês'), h('th', {}, 'Faturado'), h('th', {}, 'Recebido'), h('th', {}, 'Sessões'))),
                  tabela)))),
            h('section', { class: 'dv-card dv-side', 'aria-label': 'Faturação por serviço' }, tituloDonut, donutBox)),
          h('h2', { class: 'dv-sub' }, 'Agenda'),
          h('div', { class: 'kpis dv-agenda' },
            h('a', { class: 'kpi', href: '#/marcacoes' }, h('span', { class: 'kpi-l' }, 'Pedidos por confirmar'), h('strong', { class: 'kpi-v' }, String(d.counts.pending))),
            h('a', { class: 'kpi', href: '#/painel' }, h('span', { class: 'kpi-l' }, 'Sessões hoje'), h('strong', { class: 'kpi-v' }, String(d.counts.today))),
            h('a', { class: 'kpi', href: '#/calendario' }, h('span', { class: 'kpi-l' }, 'Próximos 7 dias'), h('strong', { class: 'kpi-v' }, String(d.counts.next7))))));

      desenhar(true);
      // O gráfico mede a largura que tem: volta a desenhar quando a janela muda.
      if ('ResizeObserver' in window) {
        let ultima = 0, primeira = true;
        const ro = new ResizeObserver(() => {
          if (!grafBox.isConnected) return ro.disconnect();
          if (Math.abs(grafBox.clientWidth - ultima) < 8) return;
          ultima = grafBox.clientWidth;
          desenhar(primeira);   // a primeira medida é quando a página aparece: anima
          primeira = false;
        });
        ro.observe(grafBox);
      }
    },
  };
})();
