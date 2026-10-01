/* Painel de gestão: as diferentes páginas. */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h, fmtMin, parseHM, fmtDate, addDays, money, waLink, statusTag, STATUS, DAY_SHORT, DAY_LONG } = S;
  const { app, ui, views, api, toast, field, pageHead, labelCells, studioFilter, openBooking, openBlock, bookingItem } = A;
  const cur = () => app.settings.currency;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ============================================================ Painel
  const fig = (label, value, small) => h('div', {}, h('dt', {}, label), h('dd', { class: small ? 'small' : '' }, value));

  views.painel = {
    title: 'Painel',
    async render(box) {
      const d = await api('/api/admin/dashboard' + (ui.studio ? '?studio_id=' + ui.studio : ''));
      box.append(pageHead('Painel', studioFilter(A.refresh),
        h('button', { class: 'btn', type: 'button', onclick: () => openBooking({ onSaved: A.refresh }) }, 'Nova marcação')));
      box.append(h('div', { class: 'dash' },
        h('div', {},
          h('section', { class: 'panel', 'aria-labelledby': 'h-pend' },
            h('h2', { id: 'h-pend' }, 'Pedidos por confirmar'),
            d.pending.length
              ? h('ul', { class: 'bk-list' }, d.pending.map((b) => bookingItem(b, A.refresh)))
              : h('p', { class: 'empty' }, 'Não há pedidos à espera.')),
          h('section', { class: 'panel', 'aria-labelledby': 'h-today' },
            h('h2', { id: 'h-today' }, 'Hoje, ' + fmtDate(d.today)),
            d.todayList.length
              ? h('ul', { class: 'bk-list' }, d.todayList.map((b) => bookingItem(b, A.refresh)))
              : h('p', { class: 'empty' }, 'Nenhuma sessão marcada para hoje.'))),
        h('aside', { class: 'panel', 'aria-labelledby': 'h-sum' },
          h('h2', { id: 'h-sum' }, 'Resumo'),
          h('dl', { class: 'figures' },
            fig('Pedidos por confirmar', d.counts.pending),
            fig('Sessões hoje', d.counts.today),
            fig('Próximos 7 dias', d.counts.next7),
            fig('Recebido este mês', money(d.money.received_month, cur()), true),
            fig('Por receber', money(d.money.outstanding, cur()), true)))));
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

      let timer = null;
      const search = h('input', { type: 'search', placeholder: 'Nome, telefone, projeto ou código', 'aria-label': 'Pesquisar', value: ui.q });
      search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { ui.q = search.value.trim(); load(); }, 300); });

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
          listBox.replaceChildren(
            h('div', { class: 'table-wrap' }, labelCells(h('table', { class: 'data' },
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
                  h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => openBooking({ booking: b, onSaved: onChange }) }, 'Abrir')))))))),
            bookings.length >= 500 ? h('p', { class: 'hint' }, 'A mostrar as primeiras 500 marcações. Use a pesquisa para refinar.') : null);
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
      const search = h('input', { type: 'search', placeholder: 'Pesquisar cliente', 'aria-label': 'Pesquisar cliente' });
      search.addEventListener('input', () => draw(search.value.trim()));
      box.append(pageHead('Clientes', search));
      box.append(h('p', { class: 'hint', style: { marginBottom: '12px' } }, 'Construída a partir do histórico de marcações. Clique no telefone para abrir o WhatsApp.'));
      table = h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, [['Cliente', ''], ['Telefone', ''], ['Sessões', 'num'], ['Total pago', 'num'], ['Última sessão', '']].map(([t, c]) => h('th', { scope: 'col', class: c }, t)))),
        body);
      box.append(h('div', { class: 'table-wrap' }, table));
      draw('');
    },
  };

  // ============================================================ Estúdios e salas
  const DEFAULT_HOURS = [null, ...Array(5).fill({ open: '09:00', close: '21:00' }), { open: '10:00', close: '20:00' }];
  const ORDER = [1, 2, 3, 4, 5, 6, 0];

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
        lat: f.lat.value, lon: f.lon.value, description: f.description.value, active: f.active.checked, hours };
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
    const save = async () => {
      const body = { studio_id: studioId, name: name.value, hourly_rate: rate.value, description: desc.value, active: active.checked };
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
        !isNew && h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: remove }, 'Eliminar')));
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
    const save = async () => {
      const body = { name: name.value, description: desc.value, remote_ok: remoteOk.checked, active: active.checked };
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
        !isNew && h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: remove }, 'Eliminar')));
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
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    const submit = async (e) => {
      e.preventDefault();
      err.hidden = true;
      const body = {};
      for (const [k, el] of Object.entries(f)) body[k] = el.type === 'checkbox' ? el.checked : el.value;
      try {
        const r = await api('/api/admin/settings', { method: 'PUT', body });
        app.settings = r.settings;
        const brand = document.querySelector('.side .brand .brand-name');
        if (brand) brand.textContent = r.settings.business_name;
        toast('Definições guardadas.');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    };
    return h('form', { class: 'panel', onsubmit: submit },
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
      err,
      isOwner && h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'submit' }, 'Guardar definições')));
  }

  function userRow(u, meId) {
    const isNew = !u;
    const name = h('input', { type: 'text', maxlength: 80, value: u ? u.name : '' });
    const email = isNew ? h('input', { type: 'email', maxlength: 120, autocomplete: 'off' }) : h('input', { type: 'email', value: u.email, readonly: true });
    const role = h('select', { value: u ? u.role : 'staff' }, h('option', { value: 'staff' }, 'Equipa'), h('option', { value: 'owner' }, 'Proprietário'));
    const pass = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, placeholder: isNew ? 'Mínimo 8 caracteres' : 'Deixe vazio para manter' });
    const active = h('input', { type: 'checkbox', checked: u ? !!u.active : true });
    const save = async () => {
      try {
        if (isNew) await api('/api/admin/users', { method: 'POST', body: { name: name.value, email: email.value, password: pass.value, role: role.value } });
        else await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: { name: name.value, role: role.value, active: active.checked, password: pass.value || undefined } });
        toast(isNew ? 'Utilizador criado.' : 'Utilizador guardado.');
        A.refresh();
      } catch (ex) { toast(ex.message, true); }
    };
    const remove = async () => {
      if (!window.confirm(`Eliminar o utilizador ${u.name}?`)) return;
      try { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); toast('Utilizador eliminado.'); A.refresh(); }
      catch (ex) { toast(ex.message, true); }
    };
    return h('div', { class: 'row-form user' },
      field(isNew ? 'Novo utilizador' : 'Nome', name), field('Email', email), field('Perfil', role),
      field(isNew ? 'Palavra-passe' : 'Nova palavra-passe', pass),
      !isNew && h('label', { class: 'check' }, active, 'Ativo'),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: save }, isNew ? 'Adicionar' : 'Guardar'),
        !isNew && u.id !== meId && h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: remove }, 'Eliminar')));
  }

  function passwordPanel() {
    const cur1 = h('input', { type: 'password', autocomplete: 'current-password' });
    const n1 = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8 });
    const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    return h('form', {
      class: 'panel',
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
      if (isOwner) {
        const { users } = await api('/api/admin/users');
        box.append(h('section', { class: 'panel' },
          h('h2', {}, 'Equipa'),
          h('p', { class: 'hint' }, 'A equipa vê e gere marcações, clientes e estúdios. Só o proprietário altera definições e utilizadores.'),
          users.map((u) => userRow(u, app.user.id)),
          userRow(null, app.user.id)));
      }
      box.append(passwordPanel());
    },
  };

  A.boot();
})();
