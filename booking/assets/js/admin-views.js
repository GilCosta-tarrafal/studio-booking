/* Painel de gestão: as diferentes páginas. */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h, fmtMin, parseHM, fmtDate, addDays, money, waLink, statusTag, STATUS, DAY_SHORT, DAY_LONG } = S;
  const { app, ui, views, api, toast, field, pageHead, labelCells, studioFilter, openModal, openBooking, openBlock, bookingItem } = A;
  const cur = () => app.settings.currency;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // Cartão de indicador (número em destaque com rótulo), usado no Dashboard e
  // nos Relatórios.
  const kpiCard = (label, valor) => h('div', { class: 'kpi' },
    h('span', { class: 'kpi-l' }, label), h('strong', { class: 'kpi-v' }, valor));

  // Pequeno ícone SVG (herda a cor e o tamanho do texto à volta).
  function svgIcon(inner, size = 20) {
    const span = h('span', { class: 'ico', 'aria-hidden': 'true' });
    span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    return span;
  }

  // Pesquisa compacta: só um botão com lupa. Ao clicar, abre a caixa de texto
  // (e volta a fechar quando fica vazia). Poupa a largura toda da barra, que
  // antes empurrava os botões para fora do ecrã.
  function searchField({ placeholder, value = '', debounce = 0, onSearch }) {
    const input = h('input', { type: 'search', placeholder, 'aria-label': placeholder, value, hidden: !value });
    const btn = h('button', {
      type: 'button', class: 'btn btn-outline btn-icon search-btn',
      'aria-label': placeholder, title: placeholder, 'aria-expanded': value ? 'true' : 'false',
    }, svgIcon('<circle cx="11" cy="11" r="7"/><line x1="16.65" y1="16.65" x2="21" y2="21"/>'));
    const abrir = (sim) => { input.hidden = !sim; btn.setAttribute('aria-expanded', sim ? 'true' : 'false'); if (sim) input.focus(); };
    btn.onclick = () => abrir(input.hidden);
    let timer = null;
    input.addEventListener('input', () => {
      if (!debounce) return onSearch(input.value.trim());
      clearTimeout(timer); timer = setTimeout(() => onSearch(input.value.trim()), debounce);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; onSearch(''); abrir(false); btn.focus(); } });
    input.addEventListener('blur', () => { if (!input.value.trim()) abrir(false); });
    return h('div', { class: 'search' }, btn, input);
  }

  // ============================================================ Painel e Dashboard

  // Painel: o trabalho do dia — pedidos por confirmar e as sessões de hoje.
  // (O resumo de números mudou-se para a secção Dashboard.)
  views.painel = {
    title: 'Painel',
    async render(box) {
      const d = await api('/api/admin/dashboard' + (ui.studio ? '?studio_id=' + ui.studio : ''));
      box.append(pageHead('Painel', studioFilter(A.refresh),
        h('button', { class: 'btn', type: 'button', onclick: () => openBooking({ onSaved: A.refresh }) }, 'Nova marcação')));
      box.append(
        h('section', { class: 'panel', 'aria-labelledby': 'h-pend' },
          h('h2', { id: 'h-pend' }, 'Pedidos por confirmar'),
          d.pending.length
            ? h('ul', { class: 'bk-list' }, d.pending.map((b) => bookingItem(b, A.refresh)))
            : h('p', { class: 'empty' }, 'Não há pedidos à espera.')),
        h('section', { class: 'panel', 'aria-labelledby': 'h-today' },
          h('h2', { id: 'h-today' }, 'Hoje, ' + fmtDate(d.today)),
          d.todayList.length
            ? h('ul', { class: 'bk-list' }, d.todayList.map((b) => bookingItem(b, A.refresh)))
            : h('p', { class: 'empty' }, 'Nenhuma sessão marcada para hoje.')));
    },
  };

  // Gráfico circular (donut) em SVG: um anel com um segmento por categoria, um
  // número no centro e uma legenda com os valores (a legenda e os rótulos são a
  // "codificação secundária" — a identidade nunca depende só da cor).
  function donutChart(titulo, segmentos, centro) {
    const total = segmentos.reduce((s, x) => s + x.value, 0);
    const size = 150, thick = 20, r = (size - thick) / 2, cx = size / 2, C = 2 * Math.PI * r;
    const esc = (v) => String(v).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    let off = 0, arcs = '';
    for (const s of segmentos) {
      if (!s.value) continue;
      const len = (s.value / total) * C;
      const dash = Math.max(len - 2, 0.01); // 2px de folga entre segmentos
      arcs += `<circle class="donut-seg ${s.cls}" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${thick}"`
        + ` stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"`
        + ` transform="rotate(-90 ${cx} ${cx})"><title>${esc(s.label)}: ${esc(s.vLabel)}</title></circle>`;
      off += len;
    }
    const svg = `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(titulo)}">`
      + `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${thick}"/>${arcs}`
      + `<text x="${cx}" y="${cx - 3}" text-anchor="middle" dominant-baseline="central" class="donut-num">${esc(centro.num)}</text>`
      + `<text x="${cx}" y="${cx + 16}" text-anchor="middle" dominant-baseline="central" class="donut-sub">${esc(centro.sub)}</text></svg>`;
    const graf = h('div', { class: 'donut' });
    graf.innerHTML = svg;
    const leg = h('ul', { class: 'donut-leg' }, segmentos.map((s) => h('li', {},
      h('span', { class: 'donut-dot ' + s.cls }),
      h('span', { class: 'donut-leg-l' }, s.label),
      h('span', { class: 'donut-leg-v' }, s.vLabel))));
    return h('section', { class: 'panel donut-card' }, h('h3', {}, titulo), h('div', { class: 'donut-wrap' }, graf, leg));
  }

  // Dashboard: os números de resumo em cartões e, por baixo, o resumo de tudo em
  // gráficos circulares (estado das marcações, receita e serviços).
  views.dashboard = {
    title: 'Dashboard',
    async render(box) {
      const qs = ui.studio ? '?studio_id=' + ui.studio : '';
      const [d, rep] = await Promise.all([api('/api/admin/dashboard' + qs), api('/api/admin/reports' + qs)]);
      box.append(pageHead('Dashboard', studioFilter(A.refresh),
        h('button', { class: 'btn', type: 'button', onclick: () => openBooking({ onSaved: A.refresh }) }, 'Nova marcação')));
      box.append(h('div', { class: 'kpis' },
        kpiCard('Pedidos por confirmar', String(d.counts.pending)),
        kpiCard('Sessões hoje', String(d.counts.today)),
        kpiCard('Próximos 7 dias', String(d.counts.next7)),
        kpiCard('Recebido este mês', money(d.money.received_month, cur())),
        kpiCard('Por receber', money(d.money.outstanding, cur()))));

      const t = rep.totals;
      if (!t.sessions) {
        box.append(h('div', { class: 'panel' }, h('p', { class: 'empty' }, 'Ainda não há marcações para resumir em gráficos.')));
        return;
      }
      const estado = rep.byStatus.map((s) => ({ label: STATUS[s.status] || s.status, value: s.sessions, vLabel: String(s.sessions), cls: 's-' + s.status }));
      const soma = t.received + t.outstanding;
      const receita = [
        { label: 'Recebido', value: t.received, vLabel: money(t.received, cur()), cls: 'rec' },
        { label: 'Por receber', value: t.outstanding, vLabel: money(t.outstanding, cur()), cls: 'owe' },
      ];
      const servico = rep.byService.map((s, i) => ({ label: s.name, value: s.sessions, vLabel: String(s.sessions), cls: 'c' + (i % 6 + 1) }));

      box.append(h('div', { class: 'donuts' },
        donutChart('Marcações por estado', estado, { num: String(t.sessions), sub: 'marcações' }),
        donutChart('Receita', receita, { num: soma ? Math.round(t.received / soma * 100) + '%' : '—', sub: 'recebido' }),
        donutChart('Marcações por serviço', servico, { num: String(t.sessions), sub: 'sessões' })));
    },
  };

  // ============================================================ Calendário
  const HOUR = 56;

  views.calendario = {
    title: 'Calendário',
    async render(box, params) {
      if (params.get('date')) ui.calDate = params.get('date');
      const date = ui.calDate || app.today;
      ui.calDate = date;
      const [data, today] = await Promise.all([
        api(`/api/admin/calendar?date=${date}` + (ui.studio ? '&studio_id=' + ui.studio : '')),
        date === app.today ? api('/api/public/today') : Promise.resolve(null),
      ]);
      const go = (d) => { ui.calDate = d; A.refresh(); };
      const dateInput = h('input', { type: 'date', value: date, 'aria-label': 'Dia' });
      dateInput.addEventListener('change', () => { if (dateInput.value) go(dateInput.value); });

      box.append(pageHead('Calendário',
        h('div', { class: 'tools' },
          h('button', { class: 'btn btn-outline', type: 'button', 'aria-label': 'Dia anterior', onclick: () => go(addDays(date, -1)) }, '←'),
          dateInput,
          h('button', { class: 'btn btn-outline', type: 'button', 'aria-label': 'Dia seguinte', onclick: () => go(addDays(date, 1)) }, '→'),
          h('button', { class: 'btn btn-outline', type: 'button', onclick: () => go(app.today) }, 'Hoje')),
        studioFilter(A.refresh),
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => openBlock({ onSaved: A.refresh }) }, 'Bloquear horário'),
        h('button', { class: 'btn', type: 'button', onclick: () => openBooking({ preset: { date }, onSaved: A.refresh }) }, 'Nova marcação')));
      box.append(h('p', { class: 'hint', style: { marginBottom: '12px' } }, cap(fmtDate(date))));

      const rooms = data.studios.flatMap((st) => st.rooms.map((r) => ({ ...r, st })));
      if (!rooms.length) {
        box.append(h('div', { class: 'panel' }, h('p', { class: 'empty' }, 'Ainda não há estúdios ativos com salas. Crie-os em Estúdios.')));
        return;
      }

      // Intervalo de horas visível: horário dos estúdios nesse dia, alargado por marcações fora de horas.
      let lo = Infinity, hi = -Infinity;
      for (const st of data.studios) if (st.open !== null) { lo = Math.min(lo, st.open); hi = Math.max(hi, st.close); }
      for (const b of data.bookings) { lo = Math.min(lo, b.start_min); hi = Math.max(hi, b.end_min); }
      for (const k of data.blocks) { lo = Math.min(lo, k.start_min); hi = Math.max(hi, k.end_min); }
      if (!Number.isFinite(lo)) { lo = 8 * 60; hi = 20 * 60; }
      const startM = Math.max(0, Math.floor(lo / 60) * 60);
      const endM = Math.min(1440, Math.ceil(hi / 60) * 60);
      const height = ((endM - startM) / 60) * HOUR;
      const y = (m) => ((m - startM) / 60) * HOUR;

      const times = h('div', { class: 'cal-times', style: { height: height + 'px' } });
      for (let m = startM; m <= endM; m += 60) {
        if (m > startM) times.append(h('span', { class: 'cal-time', style: { top: y(m) + 'px' } }, fmtMin(m)));
      }

      const grid = h('div', { class: 'cal', style: { '--cols': rooms.length, '--hour': HOUR + 'px' } });
      grid.append(h('div', { class: 'cal-corner cal-h1' }));
      for (const st of data.studios) {
        grid.append(h('div', { class: 'cal-studio cal-h1', style: { gridColumn: 'span ' + st.rooms.length }, title: st.name },
          st.name + (st.open === null ? ' (fechado)' : '')));
      }
      grid.append(h('div', { class: 'cal-corner cal-h2' }));
      for (const r of rooms) grid.append(h('div', { class: 'cal-room cal-h2', title: r.name }, r.name));
      grid.append(times);

      for (const r of rooms) {
        const col = h('div', { class: 'cal-col', style: { height: height + 'px' } });
        const shade = (from, to) => {
          if (to > from) col.append(h('div', { class: 'cal-closed', style: { top: y(from) + 'px', height: y(to) - y(from) + 'px' } }));
        };
        if (r.st.open === null) shade(startM, endM);
        else { shade(startM, Math.min(r.st.open, endM)); shade(Math.max(r.st.close, startM), endM); }

        for (const k of data.blocks.filter((x) => x.room_id === r.id)) {
          col.append(h('button', {
            class: 'cal-block', type: 'button', style: { top: y(k.start_min) + 'px', height: Math.max(y(k.end_min) - y(k.start_min) - 2, 20) + 'px' },
            title: 'Clique para remover o bloqueio',
            onclick: async () => {
              if (!window.confirm(`Remover o bloqueio das ${k.start} às ${k.end}?`)) return;
              try { await api(`/api/admin/blocks/${k.id}`, { method: 'DELETE' }); toast('Bloqueio removido.'); A.refresh(); } catch (e) { toast(e.message, true); }
            },
          }, h('strong', {}, `${k.start}–${k.end}`), h('span', {}, k.reason || 'Bloqueado')));
        }
        for (const b of data.bookings.filter((x) => x.room_id === r.id)) {
          col.append(h('button', {
            class: 'cal-ev', type: 'button', 'data-s': b.status,
            style: { top: y(b.start_min) + 'px', height: Math.max(y(b.end_min) - y(b.start_min) - 2, 22) + 'px' },
            title: `${b.client_name}, ${b.start} às ${b.end}`,
            onclick: () => openBooking({ booking: b, onSaved: A.refresh }),
          }, h('strong', {}, `${b.start}–${b.end}`), h('span', {}, b.client_name), h('span', {}, b.title || b.service_name || '')));
        }
        if (today && today.now >= startM && today.now <= endM) col.append(h('div', { class: 'cal-now', style: { top: y(today.now) + 'px' } }));

        col.addEventListener('click', (e) => {
          if (e.target.closest('.cal-ev, .cal-block')) return;
          const rect = col.getBoundingClientRect();
          const min = startM + Math.floor(((e.clientY - rect.top) / HOUR) * 2) * 30;
          openBooking({ preset: { room_id: r.id, date, start: fmtMin(min), end: fmtMin(Math.min(min + 60, 1440 - 1)) }, onSaved: A.refresh });
        });
        grid.append(col);
      }

      box.append(h('div', { class: 'cal-scroll' }, grid));
      box.append(h('p', { class: 'cal-legend' },
        h('span', {}, 'Clique num horário livre para criar uma marcação, ou numa marcação para a abrir.'),
        h('span', {}, 'Zona riscada: fora do horário do estúdio.')));
    },
  };

  // ============================================================ Marcações
  const TABS = { pending: 'Por confirmar', upcoming: 'Próximas', past: 'Passadas', all: 'Todas' };

  function payCell(b) {
    if (!b.price && !b.paid) return h('td', { class: 'num' }, '—');
    const owed = b.price - b.paid;
    const note = b.status === 'cancelado' ? '' : owed <= 0 ? 'Pago' : b.paid > 0 ? 'Falta ' + money(owed, cur()) : 'Por pagar';
    return h('td', { class: 'num' }, money(b.price, cur()), note && h('span', { class: 'sub' }, note));
  }

  views.marcacoes = {
    title: 'Marcações',
    async render(box) {
      const listBox = h('div');
      const tabs = h('div', { class: 'tabs', role: 'tablist' });
      const drawTabs = () => tabs.replaceChildren(...Object.entries(TABS).map(([k, label]) => h('button', {
        class: 'tab', type: 'button', role: 'tab', 'aria-selected': ui.tab === k ? 'true' : 'false',
        onclick: () => { ui.tab = k; drawTabs(); load(); },
      }, label, k === 'pending' && app.pending ? ` (${app.pending})` : '')));

      const search = searchField({
        placeholder: 'Nome, telefone, projeto ou código', value: ui.q, debounce: 300,
        onSearch: (v) => { ui.q = v; load(); },
      });

      const onChange = async () => { await load(); await A.refreshPending(); drawTabs(); };

      async function load() {
        const qs = new URLSearchParams();
        if (ui.tab === 'pending') qs.set('status', 'pedido');
        if (ui.tab === 'upcoming') { qs.set('from', app.today); qs.set('status', 'pedido,confirmado,em_curso,concluido'); }
        if (ui.tab === 'past') { qs.set('to', addDays(app.today, -1)); qs.set('order', 'desc'); }
        if (ui.tab === 'all') qs.set('order', 'desc');
        if (ui.studio) qs.set('studio_id', ui.studio);
        if (ui.q) qs.set('q', ui.q);
        try {
          const { bookings } = await api('/api/admin/bookings?' + qs);
          if (!bookings.length) {
            listBox.replaceChildren(h('div', { class: 'panel' }, h('p', { class: 'empty' }, ui.q ? 'Nenhuma marcação corresponde à pesquisa.' : 'Sem marcações para mostrar.')));
            return;
          }
          const tableWrap = h('div', { class: 'table-wrap' }, labelCells(h('table', { class: 'data' },
            h('thead', {}, h('tr', {}, ['Data e hora', 'Estúdio e sala', 'Cliente', 'Trabalho', 'Estado', 'Valor', ''].map((t) => h('th', { scope: 'col', class: t === 'Valor' ? 'num' : '' }, t)))),
            h('tbody', {}, bookings.map((b) => h('tr', {},
              h('td', {}, h('strong', {}, `${b.start}–${b.end}`), h('span', { class: 'sub' }, fmtDate(b.date, 'short'))),
              h('td', {}, b.studio_name, h('span', { class: 'sub' }, b.room_name)),
              h('td', {}, b.client_name, b.client_phone && h('span', { class: 'sub' }, b.client_phone)),
              h('td', {}, b.title || '—',
                [b.service_name, b.style].filter(Boolean).length
                  && h('span', { class: 'sub' }, [b.service_name, b.style].filter(Boolean).join(' · ')),
                !!b.remote && h('span', { class: 'modo remoto' }, 'À distância')),
              h('td', {}, statusTag(b.status)),
              payCell(b),
              h('td', { class: 'acts' },
                b.status === 'pedido' && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => A.api(`/api/admin/bookings/${b.id}/status`, { method: 'PATCH', body: { status: 'confirmado' } }).then(() => { toast('Pedido confirmado.'); onChange(); }).catch((e) => toast(e.message, true)) }, 'Confirmar'),
                h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => openBooking({ booking: b, onSaved: onChange }) }, 'Abrir'))))))));
          // Nota só quando se atinge o limite; antes passava-se null, que o
          // replaceChildren transformava no texto "null" por baixo da tabela.
          const nodes = [tableWrap];
          if (bookings.length >= 500) nodes.push(h('p', { class: 'hint' }, 'A mostrar as primeiras 500 marcações. Use a pesquisa para refinar.'));
          listBox.replaceChildren(...nodes);
        } catch (e) {
          listBox.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, e.message));
        }
      }

      box.append(pageHead('Marcações', search, studioFilter(load),
        h('button', { class: 'btn', type: 'button', onclick: () => openBooking({ onSaved: onChange }) }, 'Nova marcação')));
      drawTabs();
      box.append(tabs, listBox);
      await load();
    },
  };

  // ============================================================ Clientes
  views.clientes = {
    title: 'Clientes',
    async render(box) {
      const { clients } = await api('/api/admin/clients');
      const body = h('tbody');
      let table = null;
      const draw = (q) => {
        const term = q.toLowerCase();
        const rows = clients.filter((c) => !term || `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(term));
        body.replaceChildren(...(rows.length ? rows.map((c) => {
          const wa = waLink(app.settings, c.phone);
          return h('tr', {},
            h('td', {}, h('strong', {}, c.name), c.email && h('span', { class: 'sub' }, c.email)),
            h('td', {}, c.phone ? (wa ? h('a', { href: wa, target: '_blank', rel: 'noopener' }, c.phone) : c.phone) : '—'),
            h('td', { class: 'num' }, c.sessions),
            h('td', { class: 'num' }, money(c.paid, cur())),
            h('td', {}, c.last ? S.fmtDateFull(c.last) : '—'));
        }) : [h('tr', {}, h('td', { colspan: 5 }, 'Nenhum cliente encontrado.'))]));
        if (table) labelCells(table);
      };
      const search = searchField({ placeholder: 'Pesquisar cliente', onSearch: (v) => draw(v) });
      box.append(pageHead('Clientes', search));
      box.append(h('p', { class: 'hint', style: { marginBottom: '12px' } }, 'Construída a partir do histórico de marcações. Clique no telefone para abrir o WhatsApp.'));
      table = h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, [['Cliente', ''], ['Telefone', ''], ['Sessões', 'num'], ['Total pago', 'num'], ['Última sessão', '']].map(([t, c]) => h('th', { scope: 'col', class: c }, t)))),
        body);
      box.append(h('div', { class: 'table-wrap' }, table));
      draw('');
    },
  };

  // ============================================================ Relatórios
  views.relatorios = {
    title: 'Relatórios',
    async render(box) {
      const hoje = app.today;
      const pad = (n) => String(n).padStart(2, '0');
      const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
      const Y = +hoje.slice(0, 4), M = +hoje.slice(5, 7);
      const esteMes = fmt(Y, M, 1);
      const lp = new Date(Y, M - 1, 0); // último dia do mês anterior
      const mesPassadoIni = fmt(lp.getFullYear(), lp.getMonth() + 1, 1);
      const mesPassadoFim = fmt(lp.getFullYear(), lp.getMonth() + 1, lp.getDate());
      const esteAno = fmt(Y, 1, 1);

      const fDe = h('input', { type: 'date', value: esteMes, 'aria-label': 'De' });
      const fAte = h('input', { type: 'date', value: hoje, 'aria-label': 'Até' });
      const fEstado = h('select', { 'aria-label': 'Estado' },
        h('option', { value: '' }, 'Todos os estados'),
        Object.entries(STATUS).map(([k, v]) => h('option', { value: k }, v)));
      const fServico = h('select', { 'aria-label': 'Serviço' },
        h('option', { value: '' }, 'Todos os serviços'),
        app.services.map((s) => h('option', { value: s.id }, s.name)));
      const fModo = h('select', { 'aria-label': 'Modo' },
        h('option', { value: '' }, 'Presencial e à distância'),
        h('option', { value: '0' }, 'Só presencial'),
        h('option', { value: '1' }, 'Só à distância'));

      const resultados = h('div');
      let dados = null;

      const horas = (min) => { const v = min / 60; return (Number.isInteger(v) ? v : v.toFixed(1)) + ' h'; };
      const kpi = (label, valor) => h('div', { class: 'kpi' }, h('span', { class: 'kpi-l' }, label), h('strong', { class: 'kpi-v' }, valor));
      const mesLabel = (m) => m.slice(5) + '/' + m.slice(0, 4);

      function tabela(titulo, colLabel, linhas, rotulo) {
        if (!linhas.length) return null;
        const corpo = h('tbody', {}, linhas.map((r) => h('tr', {},
          h('td', {}, rotulo(r)),
          h('td', { class: 'num' }, String(r.sessions)),
          h('td', { class: 'num' }, money(r.billed, cur())),
          h('td', { class: 'num' }, money(r.received, cur())))));
        const t = labelCells(h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, [colLabel, 'Sessões', 'Faturado', 'Recebido'].map((x, i) =>
            h('th', { scope: 'col', class: i ? 'num' : '' }, x)))),
          corpo));
        return h('section', { class: 'panel' }, h('h2', {}, titulo), h('div', { class: 'table-wrap' }, t));
      }

      // Monta a query dos filtros atuais (igual à de load), para o CSV e o PDF.
      function querystring() {
        const qs = new URLSearchParams();
        if (fDe.value) qs.set('from', fDe.value);
        if (fAte.value) qs.set('to', fAte.value);
        if (fEstado.value) qs.set('status', fEstado.value);
        if (fServico.value) qs.set('service_id', fServico.value);
        if (fModo.value) qs.set('remote', fModo.value);
        if (ui.studio) qs.set('studio_id', ui.studio);
        return qs.toString();
      }

      // Descarrega o PDF diretamente (o servidor devolve-o como anexo), sem
      // passar pela janela de impressão.
      function baixarPDF() {
        const a = h('a', { href: '/api/admin/reports.pdf?' + querystring() });
        document.body.append(a); a.click(); a.remove();
      }

      function exportarCSV() {
        if (!dados || !dados.rows.length) return;
        const cabec = ['Código', 'Data', 'Início', 'Fim', 'Estúdio', 'Sala', 'Cliente', 'Telefone', 'Serviço', 'Trabalho', 'Estado', 'Preço', 'Pago'];
        const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const linhas = [cabec.map(esc).join(',')];
        for (const b of dados.rows) {
          linhas.push([b.code, b.date, b.start, b.end, b.studio_name, b.room_name, b.client_name,
            b.client_phone, b.service_name || '', b.title || '', STATUS[b.status] || b.status, b.price, b.paid].map(esc).join(','));
        }
        const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: `relatorio-${fDe.value || 'inicio'}_a_${fAte.value || 'hoje'}.csv` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }

      function draw() {
        const t = dados.totals;
        if (!t.sessions) {
          resultados.replaceChildren(h('div', { class: 'panel' }, h('p', { class: 'empty' }, 'Sem marcações no período e filtros escolhidos.')));
          return;
        }
        const canc = dados.byStatus.find((s) => s.status === 'cancelado');
        const perdido = canc ? canc.billed : 0;

        const financas = h('section', { class: 'rep-sec' },
          h('h2', { class: 'rep-h' }, 'Finanças'),
          h('div', { class: 'kpis' },
            kpi('Faturado', money(t.billed, cur())),
            kpi('Recebido', money(t.received, cur())),
            kpi('Por receber', money(t.outstanding, cur())),
            kpi('Perdido em cancelamentos', money(perdido, cur()))));

        const fluxo = h('section', { class: 'rep-sec' },
          h('h2', { class: 'rep-h' }, 'Fluxo de marcações'),
          h('div', { class: 'kpis' },
            kpi('Sessões', String(t.sessions)),
            kpi('Horas reservadas', horas(t.minutes)),
            kpi('Clientes', String(t.clients))));

        const botoes = h('div', { class: 'rep-export' },
          h('button', { class: 'btn', type: 'button', onclick: baixarPDF }, 'Baixar PDF'),
          h('button', { class: 'btn btn-outline', type: 'button', onclick: exportarCSV }, 'Exportar CSV'),
          dados.limited && h('span', { class: 'hint' }, 'A exportação e o PDF incluem as primeiras 500 marcações.'));

        // filter(Boolean): replaceChildren é nativo e, ao contrário do h(), não
        // ignora valores falsos — sem isto, um `&&` falso escrevia "false".
        resultados.replaceChildren(...[
          financas,
          fluxo,
          tabela('Por estado', 'Estado', dados.byStatus, (r) => STATUS[r.status] || r.status),
          dados.byStudio.length > 1 && tabela('Por estúdio', 'Estúdio', dados.byStudio, (r) => r.name),
          tabela('Por serviço', 'Serviço', dados.byService, (r) => r.name),
          dados.byMonth.length > 1 && tabela('Por mês', 'Mês', dados.byMonth, (r) => mesLabel(r.month)),
          botoes,
        ].filter(Boolean));
      }

      async function load() {
        const qs = new URLSearchParams();
        if (fDe.value) qs.set('from', fDe.value);
        if (fAte.value) qs.set('to', fAte.value);
        if (fEstado.value) qs.set('status', fEstado.value);
        if (fServico.value) qs.set('service_id', fServico.value);
        if (fModo.value) qs.set('remote', fModo.value);
        if (ui.studio) qs.set('studio_id', ui.studio);
        resultados.replaceChildren(h('p', { class: 'boot' }, 'A calcular…'));
        try {
          dados = await api('/api/admin/reports?' + qs);
          draw();
        } catch (e) {
          resultados.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, e.message));
        }
      }

      const preset = (de, ate) => () => { fDe.value = de; fAte.value = ate; load(); };
      for (const el of [fDe, fAte, fEstado, fServico, fModo]) el.addEventListener('change', load);

      box.append(pageHead('Relatórios', studioFilter(load)));
      box.append(h('section', { class: 'panel rep-filtros' },
        field('De', fDe), field('Até', fAte), field('Estado', fEstado),
        field('Serviço', fServico), field('Modo', fModo),
        h('div', { class: 'rep-presets' },
          h('span', { class: 'rep-presets-l' }, 'Atalhos:'),
          h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: preset(esteMes, hoje) }, 'Este mês'),
          h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: preset(mesPassadoIni, mesPassadoFim) }, 'Mês passado'),
          h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: preset(esteAno, hoje) }, 'Este ano'),
          h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: preset('', '') }, 'Tudo'))));
      box.append(resultados);
      await load();
    },
  };

  // ============================================================ Estúdios e salas
  const DEFAULT_HOURS = [null, ...Array(5).fill({ open: '09:00', close: '21:00' }), { open: '10:00', close: '20:00' }];
  const ORDER = [1, 2, 3, 4, 5, 6, 0];

  // ============================================================ Traduções
  // O site fala português, inglês e francês. O que se escreve aqui em
  // português (nome de um serviço, descrição de uma sala...) pode levar a sua
  // versão nas outras línguas; um campo vazio mostra o português no site.
  // campos: [['name', 'Nome', 80], ['description', 'Descrição', 300, true]]
  // (o quarto valor pede uma caixa de várias linhas).
  const LINGUAS_TRADUCAO = window.DICIONARIO.LINGUAS.filter((l) => l.cod !== 'pt');

  function blocoTraducoes(campos, atual, { disabled = false } = {}) {
    let dados = atual || {};
    if (typeof dados === 'string') { try { dados = JSON.parse(dados) || {}; } catch (_) { dados = {}; } }
    const caixas = {};
    const contaPreenchidas = () => LINGUAS_TRADUCAO.filter((l) =>
      campos.some(([k]) => caixas[l.cod][k].value.trim())).length;
    const estado = h('span', { class: 'meta' });
    const atualizaEstado = () => {
      const n = contaPreenchidas();
      estado.textContent = n ? `${n} de ${LINGUAS_TRADUCAO.length} línguas` : 'por traduzir: o site mostra o português';
    };
    const blocos = LINGUAS_TRADUCAO.map((l) => {
      caixas[l.cod] = {};
      const linha = campos.map(([k, rotulo, max, area]) => {
        const valor = (dados[l.cod] && dados[l.cod][k]) || '';
        const el = area
          ? h('textarea', { maxlength: max, rows: 2, lang: l.cod, disabled, oninput: atualizaEstado }, valor)
          : h('input', { type: 'text', maxlength: max, value: valor, lang: l.cod, disabled, oninput: atualizaEstado });
        caixas[l.cod][k] = el;
        return field(rotulo, el);
      });
      return h('fieldset', { class: 'traducao-lingua' }, h('legend', {}, l.nome), linha);
    });
    atualizaEstado();
    return {
      el: h('details', { class: 'traducoes' }, h('summary', {}, 'Traduções ', estado), blocos),
      valor() {
        const out = {};
        for (const l of LINGUAS_TRADUCAO) {
          out[l.cod] = {};
          for (const [k] of campos) out[l.cod][k] = caixas[l.cod][k].value;
        }
        return out;
      },
    };
  }

  async function afterChange(msg) {
    toast(msg);
    await A.reloadRefs();
    A.refresh();
  }

  function studioForm(s) {
    const isNew = !s;
    const st = s || { name: '', city: '', address: '', phone: '', description: '', lat: null, lon: null, active: 1, hours: DEFAULT_HOURS };
    const f = {
      name: h('input', { type: 'text', maxlength: 80, required: true, value: st.name }),
      city: h('input', { type: 'text', maxlength: 60, value: st.city }),
      address: h('input', { type: 'text', maxlength: 160, value: st.address }),
      // Onde fica, para o globo do formulário de marcação rodar até lá.
      lat: h('input', { type: 'number', step: 'any', min: -90, max: 90, value: st.lat == null ? '' : st.lat, placeholder: 'Ex.: 48.8566' }),
      lon: h('input', { type: 'number', step: 'any', min: -180, max: 180, value: st.lon == null ? '' : st.lon, placeholder: 'Ex.: 2.3522' }),
      phone: h('input', { type: 'tel', maxlength: 30, value: st.phone }),
      description: h('textarea', { maxlength: 400 }, st.description),
      active: h('input', { type: 'checkbox', checked: !!st.active }),
    };
    const traducoes = blocoTraducoes([['name', 'Nome do estúdio', 80], ['city', 'Cidade ou ilha', 60], ['description', 'Descrição', 400, true]], st.traducoes);
    const rows = ORDER.map((i) => {
      const d = st.hours[i];
      const on = h('input', { type: 'checkbox', checked: !!d, 'aria-label': 'Aberto ' + DAY_LONG[i] });
      const open = h('input', { type: 'time', value: d ? d.open : '09:00', 'aria-label': 'Abre ' + DAY_LONG[i] });
      const close = h('input', { type: 'time', value: d ? d.close : '21:00', 'aria-label': 'Fecha ' + DAY_LONG[i] });
      const sync = () => { open.disabled = close.disabled = !on.checked; };
      on.addEventListener('change', sync);
      sync();
      return { i, on, open, close,
        tr: h('tr', {}, h('td', {}, DAY_SHORT[i]), h('td', {}, h('label', { class: 'check' }, on, 'Aberto')), h('td', {}, open), h('td', {}, 'às'), h('td', {}, close)) };
    });
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });

    const submit = async (e) => {
      e.preventDefault();
      err.hidden = true;
      const hours = Array(7).fill(null);
      for (const r of rows) hours[r.i] = r.on.checked ? { open: r.open.value, close: r.close.value } : null;
      const body = { name: f.name.value, city: f.city.value, address: f.address.value, phone: f.phone.value,
        lat: f.lat.value, lon: f.lon.value, description: f.description.value, active: f.active.checked, hours,
        traducoes: traducoes.valor() };
      try {
        if (isNew) await api('/api/admin/studios', { method: 'POST', body });
        else await api(`/api/admin/studios/${s.id}`, { method: 'PUT', body });
        await afterChange('Estúdio guardado.');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    };
    const remove = async () => {
      if (!window.confirm(`Eliminar o estúdio "${s.name}" e as suas salas?`)) return;
      try { await api(`/api/admin/studios/${s.id}`, { method: 'DELETE' }); await afterChange('Estúdio eliminado.'); }
      catch (ex) { toast(ex.message, true); }
    };

    return h('form', { onsubmit: submit },
      h('div', { class: 'grid-2' }, field('Nome do estúdio', f.name), field('Cidade ou ilha', f.city)),
      h('div', { class: 'grid-2' }, field('Morada', f.address), field('Telefone do estúdio', f.phone)),
      localizacao(f),
      field('Descrição', f.description),
      traducoes.el,
      h('h3', {}, 'Horário de funcionamento'),
      h('table', { class: 'hours-table' }, h('tbody', {}, rows.map((r) => r.tr))),
      h('label', { class: 'check' }, f.active, 'Visível no site e aberto a marcações'),
      err,
      h('div', { class: 'modal-foot' },
        !isNew && h('div', { class: 'spacer' }, h('button', { class: 'btn btn-danger', type: 'button', onclick: remove }, 'Eliminar estúdio')),
        h('button', { class: 'btn', type: 'submit' }, isNew ? 'Criar estúdio' : 'Guardar estúdio')));
  }

  // Onde fica o estúdio, para o globo do site rodar até lá. Uma caixa só, que
  // serve para as duas maneiras: colar o link do Google Maps (as coordenadas
  // vêm lá dentro, sem falar com ninguém) ou escrever a morada e carregar em
  // "Procurar", que pergunta ao OpenStreetMap.
  function localizacao(f) {
    const caixa = h('input', {
      type: 'text', maxlength: 300, class: 'loc-busca',
      placeholder: 'Cole o link do Google Maps, ou escreva a morada e carregue em Procurar',
      'aria-label': 'Link do Google Maps ou morada a procurar',
    });
    const nota = h('p', { class: 'hint loc-nota' });
    const botao = h('button', { class: 'btn btn-outline', type: 'button' }, 'Procurar');
    const aqui = h('button', {
      class: 'btn btn-outline', type: 'button',
      title: 'Usar a localização deste aparelho (tem de estar no estúdio)',
    }, 'Estou aqui');

    const pôr = (lat, lon, onde) => {
      f.lat.value = lat.toFixed(6).replace(/\.?0+$/, '');
      f.lon.value = lon.toFixed(6).replace(/\.?0+$/, '');
      nota.className = 'hint loc-nota ok';
      nota.textContent = onde ? `Encontrado: ${onde}` : `Coordenadas lidas do link: ${f.lat.value}, ${f.lon.value}`;
    };
    const falhou = (msg) => { nota.className = 'hint loc-nota mau'; nota.textContent = msg; };

    // Colar um link chega: as coordenadas aparecem sem carregar em nada.
    caixa.addEventListener('input', () => {
      const t = caixa.value.trim();
      if (!t) { nota.textContent = ''; return; }
      const c = window.Coords.ler(t);
      if (c) { pôr(c.lat, c.lon); return; }
      if (window.Coords.eLinkCurto(t)) {
        falhou('Os links curtos não trazem as coordenadas. Abra o link e copie o endereço completo da barra do browser.');
        return;
      }
      nota.className = 'hint loc-nota';
      nota.textContent = '';
    });

    botao.addEventListener('click', async () => {
      const t = caixa.value.trim() || [f.address.value, f.city.value].filter(Boolean).join(', ');
      const c = window.Coords.ler(t);
      if (c) { pôr(c.lat, c.lon); return; }
      if (t.length < 3) { falhou('Escreva a morada ou a cidade a procurar.'); return; }
      botao.disabled = true;
      nota.className = 'hint loc-nota';
      nota.textContent = 'A procurar…';
      try {
        const achado = await api('/api/admin/geocode', { method: 'POST', body: { q: t } });
        pôr(achado.lat, achado.lon, achado.nome);
      } catch (ex) { falhou(ex.message); } finally { botao.disabled = false; }
    });

    // O aparelho sabe onde está: estando no estúdio, é a maneira mais certa de
    // acertar no sítio. Pede autorização — daí ser um botão, e não algo que
    // aconteça sozinho.
    aqui.addEventListener('click', () => {
      if (!navigator.geolocation) { falhou('Este browser não sabe dizer onde está.'); return; }
      if (!window.isSecureContext) {
        falhou('O browser só dá a localização em ligações seguras (https:// ou localhost). Cole o link do Google Maps, ou abra o painel em localhost.');
        return;
      }
      aqui.disabled = true;
      nota.className = 'hint loc-nota';
      nota.textContent = 'A perguntar ao aparelho…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          aqui.disabled = false;
          const { latitude, longitude, accuracy } = pos.coords;
          pôr(latitude, longitude);
          const metros = Math.round(accuracy);
          nota.className = 'hint loc-nota ok';
          nota.textContent = `Localização deste aparelho: ${f.lat.value}, ${f.lon.value}`
            + (metros ? ` (com cerca de ${metros} m de margem)` : '');
        },
        (erro) => {
          aqui.disabled = false;
          falhou(erro.code === erro.PERMISSION_DENIED
            ? 'Não deu autorização para ler a localização. Pode escrevê-la à mão ou colar o link do Google Maps.'
            : 'Não foi possível ler a localização deste aparelho. Tente ao ar livre, ou escreva-a à mão.');
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    });

    return h('div', { class: 'loc' },
      h('span', { class: 'label' }, 'Onde fica'),
      h('div', { class: 'loc-linha' }, caixa, botao, aqui),
      nota,
      h('div', { class: 'grid-2' }, field('Latitude', f.lat), field('Longitude', f.lon)));
  }

  function roomRow(r, studioId) {
    const isNew = !r;
    const name = h('input', { type: 'text', maxlength: 80, value: r ? r.name : '' });
    const rate = h('input', { type: 'number', min: 0, step: 100, value: r ? r.hourly_rate : 0 });
    const desc = h('input', { type: 'text', maxlength: 300, value: r ? r.description : '' });
    const active = h('input', { type: 'checkbox', checked: r ? !!r.active : true });
    const traducoes = blocoTraducoes([['name', 'Sala', 80], ['description', 'Descrição', 300]], r && r.traducoes);
    const save = async () => {
      const body = { studio_id: studioId, name: name.value, hourly_rate: rate.value, description: desc.value, active: active.checked,
        traducoes: traducoes.valor() };
      try {
        if (isNew) await api('/api/admin/rooms', { method: 'POST', body });
        else await api(`/api/admin/rooms/${r.id}`, { method: 'PUT', body });
        await afterChange(isNew ? 'Sala adicionada.' : 'Sala guardada.');
      } catch (ex) { toast(ex.message, true); }
    };
    const remove = async () => {
      if (!window.confirm(`Eliminar a sala "${r.name}"?`)) return;
      try { await api(`/api/admin/rooms/${r.id}`, { method: 'DELETE' }); await afterChange('Sala eliminada.'); }
      catch (ex) { toast(ex.message, true); }
    };
    return h('div', { class: 'row-form' },
      field(isNew ? 'Nova sala' : 'Sala', name), field('Preço por hora', rate), field('Descrição', desc),
      h('label', { class: 'check' }, active, 'Ativa'),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: save }, isNew ? 'Adicionar' : 'Guardar'),
        !isNew && h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: remove }, 'Eliminar')),
      traducoes.el);
  }

  views.estudios = {
    title: 'Estúdios',
    async render(box) {
      await A.reloadRefs();
      const newPanel = h('details', { class: 'studio-panel', open: true, hidden: true },
        h('summary', {}, 'Novo estúdio'), h('div', { class: 'studio-body' }, studioForm(null)));
      box.append(pageHead('Estúdios e salas', h('button', {
        class: 'btn', type: 'button',
        onclick: () => { newPanel.hidden = false; newPanel.open = true; newPanel.scrollIntoView({ block: 'start' }); newPanel.querySelector('input').focus(); },
      }, 'Novo estúdio')));
      box.append(newPanel);
      if (!app.studios.length) box.append(h('div', { class: 'panel' }, h('p', { class: 'empty' }, 'Ainda não há estúdios. Crie o primeiro com o botão acima.')));
      app.studios.forEach((s, idx) => {
        box.append(h('details', { class: 'studio-panel', open: idx === 0 },
          h('summary', {}, s.name,
            !s.active && h('span', { class: 'tag', 'data-s': 'cancelado' }, 'Oculto no site'),
            h('span', { class: 'meta' }, `${s.rooms.length} ${s.rooms.length === 1 ? 'sala' : 'salas'}`)),
          h('div', { class: 'studio-body' },
            studioForm(s),
            h('h3', {}, 'Salas'),
            s.rooms.map((r) => roomRow(r, s.id)),
            roomRow(null, s.id))));
      });
    },
  };

  // ============================================================ Serviços
  function serviceRow(sv) {
    const isNew = !sv;
    const name = h('input', { type: 'text', maxlength: 80, value: sv ? sv.name : '' });
    const desc = h('input', { type: 'text', maxlength: 300, value: sv ? sv.description : '' });
    const active = h('input', { type: 'checkbox', checked: sv ? !!sv.active : true });
    const remoteOk = h('input', { type: 'checkbox', checked: sv ? !!sv.remote_ok : false });
    const traducoes = blocoTraducoes([['name', 'Serviço', 80], ['description', 'Descrição', 300]], sv && sv.traducoes);
    const save = async () => {
      const body = { name: name.value, description: desc.value, remote_ok: remoteOk.checked, active: active.checked,
        traducoes: traducoes.valor() };
      try {
        if (isNew) await api('/api/admin/services', { method: 'POST', body });
        else await api(`/api/admin/services/${sv.id}`, { method: 'PUT', body });
        await afterChange(isNew ? 'Serviço adicionado.' : 'Serviço guardado.');
      } catch (ex) { toast(ex.message, true); }
    };
    const remove = async () => {
      if (!window.confirm(`Eliminar o serviço "${sv.name}"? As marcações antigas ficam sem serviço associado.`)) return;
      try { await api(`/api/admin/services/${sv.id}`, { method: 'DELETE' }); await afterChange('Serviço eliminado.'); }
      catch (ex) { toast(ex.message, true); }
    };
    return h('div', { class: 'row-form service' },
      field(isNew ? 'Novo serviço' : 'Serviço', name), field('Descrição', desc),
      h('label', { class: 'check', title: 'O cliente não precisa de vir ao estúdio para este trabalho.' }, remoteOk, 'Pode ser à distância'),
      h('label', { class: 'check' }, active, 'Visível'),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: save }, isNew ? 'Adicionar' : 'Guardar'),
        !isNew && h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: remove }, 'Eliminar')),
      traducoes.el);
  }

  views.servicos = {
    title: 'Serviços',
    async render(box) {
      await A.reloadRefs();
      box.append(pageHead('Serviços'));
      box.append(h('div', { class: 'panel' },
        h('p', { class: 'hint' }, 'Aparecem no site e no formulário de marcação, para o cliente indicar o que precisa (gravação, mistura, masterização…). Marque "pode ser à distância" no que não obriga o cliente a vir ao estúdio, como a mistura ou a masterização.'),
        app.services.map((sv) => serviceRow(sv)),
        serviceRow(null)));
    },
  };

  // ============================================================ Definições
  function settingsPanel(s, isOwner) {
    const dis = !isOwner;
    const f = {
      business_name: h('input', { type: 'text', maxlength: 80, value: s.business_name, disabled: dis, required: true }),
      tagline: h('input', { type: 'text', maxlength: 160, value: s.tagline, disabled: dis }),
      phone: h('input', { type: 'tel', maxlength: 30, value: s.phone, disabled: dis }),
      whatsapp: h('input', { type: 'tel', maxlength: 30, value: s.whatsapp, disabled: dis }),
      email: h('input', { type: 'email', maxlength: 120, value: s.email, disabled: dis }),
      instagram: h('input', { type: 'url', maxlength: 200, placeholder: 'https://instagram.com/...', value: s.instagram, disabled: dis }),
      spotify: h('input', { type: 'url', maxlength: 200, placeholder: 'https://open.spotify.com/...', value: s.spotify, disabled: dis }),
      youtube: h('input', { type: 'url', maxlength: 200, placeholder: 'https://youtube.com/@...', value: s.youtube, disabled: dis }),
      currency: h('input', { type: 'text', maxlength: 8, value: s.currency, disabled: dis }),
      country_code: h('input', { type: 'text', inputmode: 'numeric', maxlength: 4, value: s.country_code, disabled: dis }),
      slot_minutes: h('select', { value: s.slot_minutes, disabled: dis }, [15, 30, 60, 90, 120].map((n) => h('option', { value: n }, n + ' minutos'))),
      min_minutes: h('input', { type: 'number', min: 15, step: 15, value: s.min_minutes, disabled: dis }),
      max_minutes: h('input', { type: 'number', min: 15, step: 15, value: s.max_minutes, disabled: dis }),
      lead_hours: h('input', { type: 'number', min: 0, value: s.lead_hours, disabled: dis }),
      max_advance_days: h('input', { type: 'number', min: 1, value: s.max_advance_days, disabled: dis }),
      auto_confirm: h('input', { type: 'checkbox', checked: !!s.auto_confirm, disabled: dis }),
      terms: h('textarea', { maxlength: 500, disabled: dis }, s.terms),
    };
    const traducoes = blocoTraducoes([['tagline', 'Frase de apresentação', 160], ['terms', 'Texto mostrado antes de enviar o pedido', 500, true]],
      s.traducoes, { disabled: dis });
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    const submit = async (e) => {
      e.preventDefault();
      err.hidden = true;
      const body = { traducoes: traducoes.valor() };
      for (const [k, el] of Object.entries(f)) body[k] = el.type === 'checkbox' ? el.checked : el.value;
      try {
        const r = await api('/api/admin/settings', { method: 'PUT', body });
        app.settings = r.settings;
        // A marca do menu é só o emblema (sem texto); o nome vive no rótulo
        // acessível e no alt da imagem, e é isso que se atualiza ao guardar.
        const brand = document.querySelector('.side .brand');
        if (brand) {
          brand.setAttribute('aria-label', r.settings.business_name);
          const img = brand.querySelector('.brand-mark');
          if (img) img.alt = r.settings.business_name;
        }
        toast('Definições guardadas.');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    };
    return h('form', { class: 'panel panel-stack', onsubmit: submit },
      h('h2', {}, 'Negócio e contactos'),
      !isOwner && h('p', { class: 'notice info' }, 'Só o proprietário pode alterar as definições.'),
      h('div', { class: 'grid-2' }, field('Nome do negócio', f.business_name), field('Frase de apresentação', f.tagline)),
      h('div', { class: 'grid-3' }, field('Telefone', f.phone), field('WhatsApp', f.whatsapp), field('Email', f.email)),
      h('div', { class: 'grid-3' },
        field('Instagram', f.instagram, { hint: 'Endereço completo do perfil. Fica um ícone no rodapé do site.' }),
        field('Spotify', f.spotify, { hint: 'Perfil de artista ou playlist do estúdio.' }),
        field('YouTube', f.youtube, { hint: 'Canal do estúdio.' })),
      h('div', { class: 'grid-2' },
        field('Moeda', f.currency, { hint: 'Texto mostrado a seguir aos preços, por exemplo CVE ou €.' }),
        field('Indicativo do país', f.country_code, { hint: 'Acrescentado a números locais nos links de WhatsApp.' })),
      h('h3', {}, 'Regras de marcação'),
      h('div', { class: 'grid-3' },
        field('Bloco de tempo', f.slot_minutes, { hint: 'As horas de início seguem este intervalo.' }),
        field('Duração mínima (min)', f.min_minutes),
        field('Duração máxima (min)', f.max_minutes)),
      h('div', { class: 'grid-2' },
        field('Antecedência mínima (horas)', f.lead_hours, { hint: 'Quanto tempo antes do início o cliente ainda pode marcar.' }),
        field('Marcar até (dias)', f.max_advance_days, { hint: 'Com quantos dias de avanço se aceitam marcações.' })),
      h('label', { class: 'check' }, f.auto_confirm, 'Confirmar automaticamente os pedidos feitos no site'),
      h('p', { class: 'hint' }, 'Desligado: os pedidos ficam "por confirmar" até os aceitar no painel. O horário fica reservado em ambos os casos.'),
      field('Texto mostrado antes de enviar o pedido', f.terms, { hint: 'Por exemplo, política de cancelamento ou de sinal.' }),
      traducoes.el,
      err,
      isOwner && h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'submit' }, 'Guardar definições')));
  }

  function userRow(u, meId) {
    const isNew = !u;
    const name = h('input', { type: 'text', maxlength: 80, value: u ? u.name : '' });
    const email = isNew ? h('input', { type: 'email', maxlength: 120, autocomplete: 'off' }) : h('input', { type: 'email', value: u.email, readonly: true });
    const role = h('select', { value: u ? u.role : 'staff' },
      h('option', { value: 'staff' }, 'Equipa'),
      h('option', { value: 'agent' }, 'Agente de estúdio'),
      h('option', { value: 'owner' }, 'Proprietário'));
    // Um agente pertence a um estúdio. O seletor só aparece nesse perfil.
    const studio = h('select', {},
      h('option', { value: '' }, 'Escolher estúdio…'),
      app.studios.map((s) => h('option', { value: s.id }, s.name)));
    if (u && u.studio_id) studio.value = String(u.studio_id);
    const studioField = field('Estúdio do agente', studio);
    const syncStudio = () => { studioField.hidden = role.value !== 'agent'; };
    role.addEventListener('change', syncStudio);
    syncStudio();
    const pass = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, placeholder: isNew ? 'Mínimo 8 caracteres' : 'Deixe vazio para manter' });
    const active = h('input', { type: 'checkbox', checked: u ? !!u.active : true });
    const save = async () => {
      const common = { name: name.value, role: role.value, studio_id: role.value === 'agent' ? studio.value : null };
      try {
        if (isNew) await api('/api/admin/users', { method: 'POST', body: { ...common, email: email.value, password: pass.value } });
        else await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: { ...common, active: active.checked, password: pass.value || undefined } });
        toast(isNew ? 'Utilizador criado.' : 'Utilizador guardado.');
        A.refresh();
      } catch (ex) { toast(ex.message, true); }
    };
    const remove = async () => {
      if (!window.confirm(`Eliminar o utilizador ${u.name}?`)) return;
      try { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); toast('Utilizador eliminado.'); A.refresh(); }
      catch (ex) { toast(ex.message, true); }
    };
    return h('div', { class: 'user-card' + (isNew ? ' is-new' : '') },
      isNew
        ? h('h3', { class: 'user-card-title' }, 'Novo utilizador')
        : h('div', { class: 'user-card-id' },
          h('strong', {}, u.name),
          h('span', { class: 'tag' }, u.role === 'owner' ? 'Proprietário' : u.studio_id ? 'Agente' : 'Equipa'),
          !u.active && h('span', { class: 'tag off' }, 'Inativo')),
      h('div', { class: 'grid-2' }, field('Nome', name), field('Email', email)),
      h('div', { class: 'grid-2' }, field('Perfil', role), studioField),
      h('div', { class: 'user-card-foot' },
        field(isNew ? 'Palavra-passe' : 'Nova palavra-passe', pass),
        !isNew && h('label', { class: 'check' }, active, 'Ativo'),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: save }, isNew ? 'Adicionar' : 'Guardar'),
          !isNew && u.id !== meId && h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: remove }, 'Eliminar'))));
  }

  function passwordPanel() {
    const cur1 = h('input', { type: 'password', autocomplete: 'current-password' });
    const n1 = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
    const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    return h('form', {
      class: 'panel panel-stack',
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        if (n1.value !== n2.value) { err.textContent = 'As palavras-passe novas não coincidem.'; err.hidden = false; return; }
        try {
          await api('/api/auth/password', { method: 'POST', body: { current: cur1.value, next: n1.value } });
          cur1.value = n1.value = n2.value = '';
          toast('Palavra-passe alterada.');
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      },
    },
    h('h2', {}, 'A minha palavra-passe'),
    h('div', { class: 'grid-3' }, field('Atual', cur1), field('Nova', n1), field('Repetir a nova', n2)),
    err,
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'submit' }, 'Alterar palavra-passe')));
  }

  views.definicoes = {
    title: 'Definições',
    async render(box) {
      const isOwner = app.user.role === 'owner';
      const { settings } = await api('/api/admin/settings');
      app.settings = settings;
      box.append(pageHead('Definições'));
      box.append(settingsPanel(settings, isOwner));
      box.append(passwordPanel());
    },
  };

  // ============================================================ Utilizadores (só proprietário)
  // A gestão das contas de equipa: criar, editar e remover proprietário, equipa
  // e agentes. (O que estes perfis podem fazer vê-se em "Gestão de acesso".)
  views.utilizadores = {
    title: 'Utilizadores',
    async render(box) {
      const { users } = await api('/api/admin/users');
      box.append(pageHead('Utilizadores'));
      box.append(h('section', { class: 'panel' },
        h('h2', {}, 'Contas de acesso'),
        h('p', { class: 'hint' }, 'O proprietário vê e faz tudo. A equipa gere marcações, clientes e estúdios. '
          + 'Um agente de estúdio só vê e gere o seu estúdio — para quem trabalha num dos estúdios espalhados pelo mundo.'),
        users.map((u) => userRow(u, app.user.id)),
        userRow(null, app.user.id)));
    },
  };

  // ============================================================ Gestão de acesso — RBAC (só proprietário)
  // Gestão do controlo de acesso: criar perfis (roles), permissões e atribuir
  // perfis a utilizadores. Os dados vêm de /api/admin/rbac. (A aplicação dos
  // acessos no painel continua a usar o modelo proprietário/gestor/agente.)
  function rbacBadge(texto, extra) { return h('span', { class: 'rbac-badge' + (extra ? ' ' + extra : '') }, texto); }

  async function rbacApagar(url, pergunta, depois) {
    if (!window.confirm(pergunta)) return;
    try { await api(url, { method: 'DELETE' }); toast('Removido.'); depois(); }
    catch (e) { toast(e.message, true); }
  }

  views.acesso = {
    title: 'Gestão de acesso',
    async render(box) {
      let data = await api('/api/admin/rbac');
      const users = (await api('/api/admin/users')).users;

      let aba = 'roles';
      const novo = h('button', { class: 'btn btn-sm', type: 'button' });
      const corpo = h('div', { class: 'rbac-body' });
      const tabs = h('div', { class: 'tabs', role: 'tablist' });

      async function recarregar() { data = await api('/api/admin/rbac'); desenhar(); }

      function desenhar() {
        const defs = [
          ['roles', 'Roles (' + data.roles.length + ')'],
          ['permissoes', 'Permissões (' + data.permissions.length + ')'],
          ['atribuicoes', 'Atribuições (' + data.assignments.length + ')'],
        ];
        tabs.replaceChildren(...defs.map(([k, label]) => h('button', {
          class: 'tab', type: 'button', role: 'tab', 'aria-selected': aba === k ? 'true' : 'false',
          onclick: () => { aba = k; desenhar(); },
        }, label)));
        novo.textContent = aba === 'roles' ? 'Novo Role' : aba === 'permissoes' ? 'Nova Permissão' : 'Atribuir Role';
        novo.onclick = aba === 'roles' ? modalRole : aba === 'permissoes' ? modalPermissao : modalAtribuir;
        if (aba === 'roles') corpo.replaceChildren(...data.roles.map(roleCard));
        else if (aba === 'permissoes') corpo.replaceChildren(permCard(data.permissions));
        else corpo.replaceChildren(assignTable(data.assignments));
      }

      // ---- cartões e listas ----
      function roleCard(r) {
        return h('section', { class: 'rbac-card' },
          h('div', { class: 'rbac-card-head' },
            h('h3', {}, r.name),
            rbacBadge(r.code, 'slug'),
            r.is_system ? rbacBadge('Sistema', 'sistema') : null,
            r.is_system ? null : h('button', {
              class: 'btn btn-outline btn-sm rbac-card-del', type: 'button',
              onclick: () => rbacApagar('/api/admin/rbac/roles/' + r.id, 'Eliminar o perfil "' + r.name + '"?', recarregar),
            }, 'Eliminar')),
          r.description ? h('p', { class: 'rbac-desc' }, r.description) : null,
          h('p', { class: 'rbac-meta' },
            h('span', {}, 'Prioridade: ' + r.priority),
            h('span', {}, 'Categoria: ' + (r.category || '—')),
            h('span', {}, 'Permissões: ' + r.permCount)));
      }

      function permCard(perms) {
        const porRecurso = {};
        for (const p of perms) (porRecurso[p.resource] = porRecurso[p.resource] || []).push(p);
        return h('div', { class: 'rbac-body' }, Object.entries(porRecurso).map(([recurso, itens]) => h('section', { class: 'rbac-card' },
          h('h3', {}, recurso),
          h('ul', { class: 'rbac-perms' }, itens.map((p) => h('li', {},
            h('span', { class: 'rbac-perm-nome' }, p.label),
            h('code', { class: 'rbac-perm-slug' }, p.code),
            h('button', {
              class: 'btn btn-outline btn-sm rbac-perm-del', type: 'button', 'aria-label': 'Eliminar ' + p.code,
              onclick: () => rbacApagar('/api/admin/rbac/permissions/' + p.id, 'Eliminar a permissão "' + p.label + '"?', recarregar),
            }, '×')))))));
      }

      function assignTable(asgs) {
        if (!asgs.length) return h('div', { class: 'panel' }, h('p', { class: 'empty' }, 'Sem atribuições. Use "Atribuir Role".'));
        return h('div', { class: 'table-wrap' }, labelCells(h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Utilizador'), h('th', {}, 'Perfil'), h('th', {}, 'Expira'), h('th', {}, ''))),
          h('tbody', {}, asgs.map((a) => h('tr', {},
            h('td', {}, a.user_name),
            h('td', {}, rbacBadge(a.role_name)),
            h('td', {}, a.expires_at || '—'),
            h('td', { class: 'num' }, h('button', {
              class: 'btn btn-outline btn-sm', type: 'button',
              onclick: () => rbacApagar('/api/admin/rbac/assignments/' + a.id, 'Remover esta atribuição?', recarregar),
            }, 'Remover'))))))));
      }

      // ---- modais ----
      function modalPermissao() {
        openModal((close) => {
          const label = h('input', { type: 'text', required: true, placeholder: 'ex.: Reservas – Criar' });
          const resource = h('input', { type: 'text', required: true, placeholder: 'ex.: bookings' });
          const action = h('input', { type: 'text', required: true, placeholder: 'ex.: create' });
          const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
          return h('div', { class: 'modal-in' },
            h('div', { class: 'modal-head' }, h('h2', {}, 'Nova permissão')),
            h('form', { onsubmit: async (e) => {
              e.preventDefault(); err.hidden = true;
              try { await api('/api/admin/rbac/permissions', { method: 'POST', body: { label: label.value, resource: resource.value, action: action.value } }); close(); toast('Permissão criada.'); recarregar(); }
              catch (ex) { err.textContent = ex.message; err.hidden = false; }
            } },
            field('Label', label),
            h('div', { class: 'grid-2' }, field('Recurso', resource), field('Ação', action)),
            err,
            h('div', { class: 'modal-foot' },
              h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Cancelar'),
              h('button', { class: 'btn', type: 'submit' }, 'Criar'))));
        });
      }

      function modalRole() {
        openModal((close) => {
          const name = h('input', { type: 'text', required: true, placeholder: 'ex.: Administrador' });
          const code = h('input', { type: 'text', placeholder: 'ex.: admin' });
          const desc = h('input', { type: 'text', placeholder: 'ex.: Acesso total ao sistema' });
          const prio = h('input', { type: 'number', value: '0' });
          const cat = h('input', { type: 'text', placeholder: 'ex.: system' });
          const sys = h('select', {}, h('option', { value: '0' }, 'Não sistema'), h('option', { value: '1' }, 'Sistema'));
          const checks = data.permissions.map((p) => {
            const cb = h('input', { type: 'checkbox', value: p.id });
            return { cb, el: h('label', { class: 'rbac-check' }, cb, h('span', { class: 'rbac-check-l' }, p.code), h('span', { class: 'rbac-check-r' }, p.resource)) };
          });
          const conta = h('span', {}, '0');
          const atualizar = () => { conta.textContent = String(checks.filter((c) => c.cb.checked).length); };
          checks.forEach((c) => c.cb.addEventListener('change', atualizar));
          const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
          return h('div', { class: 'modal-in rbac-modal' },
            h('div', { class: 'modal-head' }, h('h2', {}, 'Novo Role')),
            h('form', { onsubmit: async (e) => {
              e.preventDefault(); err.hidden = true;
              const permissions = checks.filter((c) => c.cb.checked).map((c) => +c.cb.value);
              try { await api('/api/admin/rbac/roles', { method: 'POST', body: { name: name.value, code: code.value, description: desc.value, priority: +prio.value || 0, category: cat.value, is_system: sys.value === '1', permissions } }); close(); toast('Perfil criado.'); recarregar(); }
              catch (ex) { err.textContent = ex.message; err.hidden = false; }
            } },
            h('div', { class: 'grid-2' }, field('Nome', name), field('Código', code)),
            field('Descrição', desc),
            h('div', { class: 'grid-3' }, field('Prioridade', prio), field('Categoria', cat), field('Sistema', sys)),
            h('div', { class: 'field' },
              h('label', {}, 'Permissões (', conta, ' selecionadas)'),
              h('div', { class: 'rbac-check-list' }, checks.map((c) => c.el)),
              h('p', { class: 'rbac-check-acoes' },
                h('button', { type: 'button', class: 'link-acao', onclick: () => { checks.forEach((c) => { c.cb.checked = true; }); atualizar(); } }, 'Selecionar todas'),
                ' · ',
                h('button', { type: 'button', class: 'link-acao', onclick: () => { checks.forEach((c) => { c.cb.checked = false; }); atualizar(); } }, 'Limpar'))),
            err,
            h('div', { class: 'modal-foot' },
              h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Cancelar'),
              h('button', { class: 'btn', type: 'submit' }, 'Criar Role'))));
        });
      }

      function modalAtribuir() {
        openModal((close) => {
          const userSel = h('select', { required: true }, h('option', { value: '' }, 'Selecionar…'), users.map((u) => h('option', { value: u.id }, u.name + ' (' + u.email + ')')));
          const escolhidos = new Set();
          const chips = data.roles.map((r) => {
            const chip = h('button', { type: 'button', class: 'rbac-chip', 'aria-pressed': 'false' }, r.name);
            chip.addEventListener('click', () => {
              if (escolhidos.has(r.id)) { escolhidos.delete(r.id); chip.classList.remove('on'); chip.setAttribute('aria-pressed', 'false'); }
              else { escolhidos.add(r.id); chip.classList.add('on'); chip.setAttribute('aria-pressed', 'true'); }
            });
            return chip;
          });
          const expira = h('input', { type: 'date' });
          const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
          return h('div', { class: 'modal-in' },
            h('div', { class: 'modal-head' }, h('h2', {}, 'Atribuir Role')),
            h('form', { onsubmit: async (e) => {
              e.preventDefault(); err.hidden = true;
              try { await api('/api/admin/rbac/assignments', { method: 'POST', body: { user_id: +userSel.value, role_ids: [...escolhidos], expires_at: expira.value || null } }); close(); toast('Perfil atribuído.'); recarregar(); }
              catch (ex) { err.textContent = ex.message; err.hidden = false; }
            } },
            field('Utilizador', userSel),
            h('div', { class: 'field' }, h('label', {}, 'Roles a atribuir'), h('div', { class: 'rbac-chips' }, chips)),
            field('Data de expiração (opcional)', expira, { hint: 'Deixe em branco para atribuição permanente.' }),
            err,
            h('div', { class: 'modal-foot' },
              h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Cancelar'),
              h('button', { class: 'btn', type: 'submit' }, 'Atribuir'))));
        });
      }

      box.append(pageHead('Controlo de Acesso (RBAC)', novo));
      box.append(h('p', { class: 'hint rbac-sub' }, 'Funções, permissões e atribuições a utilizadores.'));
      box.append(tabs, corpo);
      desenhar();
    },
  };

  A.boot();
})();
