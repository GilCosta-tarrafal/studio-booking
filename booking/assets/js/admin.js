/* Painel de gestão: núcleo (estado, sessão, navegação, janelas de edição). */
(function () {
  'use strict';
  const S = window.Studio;
  const { h, parseHM, fmtDate, fmtDateFull, money, waLink, statusTag, STATUS } = S;

  const root = document.getElementById('root');
  const app = { user: null, today: '', settings: null, studios: [], services: [], pending: 0 };
  const ui = { studio: '', calDate: '', tab: 'pending', q: '' };
  const views = {};
  let routeSeq = 0;
  let pollTimer = null;

  const api = (url, opts = {}) => S.api(url, { ...opts, onUnauthorized: showLogin });

  // ---------------------------------------------------------- Preferências (tema e idioma)
  // Guardadas no navegador de quem usa o painel. O tema vale para todo o painel;
  // o idioma fica guardado e acompanha o link "Ver o site".
  const LINGUAS = [['pt', 'PT'], ['en', 'EN'], ['fr', 'FR']];
  const prefs = {
    tema() { try { return localStorage.getItem('admin-tema') === 'claro' ? 'claro' : 'escuro'; } catch (_) { return 'escuro'; } },
    setTema(t) {
      document.documentElement.setAttribute('data-tema', t);
      try { localStorage.setItem('admin-tema', t); } catch (_) { /* navegação privada */ }
    },
    lingua() { try { return LINGUAS.some(([c]) => c === localStorage.getItem('admin-lingua')) ? localStorage.getItem('admin-lingua') : 'pt'; } catch (_) { return 'pt'; } },
    setLingua(l) {
      try { localStorage.setItem('admin-lingua', l); } catch (_) { /* navegação privada */ }
      document.cookie = 'lingua=' + l + ';path=/;max-age=31536000;samesite=lax';
    },
  };
  // Aplica o tema guardado logo no arranque, antes de desenhar fosse o que for.
  prefs.setTema(prefs.tema());
  // E a língua: fora do português, o tradutor passa a traduzir tudo o que se desenha.
  if (window.I18N && window.I18N.arranque) window.I18N.arranque();

  // ---------------------------------------------------------- Pequenos componentes
  function toast(msg, error = false) {
    const t = h('div', { class: 'toast' + (error ? ' error' : ''), role: error ? 'alert' : 'status' }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), error ? 6500 : 3500);
  }

  let uid = 0;
  function field(label, control, opts = {}) {
    const id = 'f' + ++uid;
    control.id = id;
    return h('div', { class: 'field' + (opts.class ? ' ' + opts.class : '') },
      h('label', { for: id }, label), control, opts.hint && h('p', { class: 'hint' }, opts.hint));
  }

  function pageHead(title, ...tools) {
    return h('div', { class: 'page-head' }, h('h1', {}, title), tools.length ? h('div', { class: 'tools' }, tools) : null);
  }

  // No telemóvel as tabelas viram cartões e cada célula mostra o nome da sua
  // coluna ao lado (ver admin.css). O nome vem do cabeçalho, para não haver
  // duas listas a manter.
  function labelCells(table) {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    for (const tr of table.querySelectorAll('tbody tr')) {
      [...tr.children].forEach((td, i) => { if (heads[i] && !td.hasAttribute('colspan')) td.dataset.label = heads[i]; });
    }
    return table;
  }

  function studioFilter(onChange) {
    // Um agente está preso ao seu estúdio e o backend ignora este filtro
    // (só devolve as marcações desse estúdio). Mostrá-lo só confundia.
    if (app.user.studio_id) return null;
    const sel = h('select', { 'aria-label': 'Filtrar por estúdio', value: ui.studio },
      h('option', { value: '' }, 'Todos os estúdios'),
      app.studios.filter((s) => s.active).map((s) => h('option', { value: s.id }, s.name)));
    sel.addEventListener('change', () => { ui.studio = sel.value; onChange(); });
    return sel;
  }

  function openModal(build) {
    const dlg = h('dialog', { class: 'modal' });
    const close = () => dlg.close();
    let down = null;
    dlg.addEventListener('mousedown', (e) => { down = e.target; });
    dlg.addEventListener('click', (e) => { if (e.target === dlg && down === dlg) close(); });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.append(build(close));
    document.body.append(dlg);
    dlg.showModal();
    return dlg;
  }

  // ---------------------------------------------------------- Sessão
  function showLogin() {
    stopPolling();
    app.user = null;
    Object.assign(notif, { items: [], unread: 0, avisado: false, pintar: null });
    // O ecrã de entrada é sempre escuro (fotografia + cartão escuro); o tema
    // guardado volta a aplicar-se ao entrar (ver boot).
    document.documentElement.setAttribute('data-tema', 'escuro');
    const email = h('input', { type: 'email', autocomplete: 'username', required: true });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Entrar');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        btn.disabled = true;
        try {
          await S.api('/api/auth/login', { method: 'POST', body: { email: email.value, password: pass.value } });
          await boot();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        } finally {
          btn.disabled = false;
        }
      },
    }, field('Email', email), field('Palavra-passe', pass), err, h('p', { class: 'submit-row' }, btn));
    // Nome do estúdio em destaque: da sessão que ainda está em memória (ao sair)
    // ou, numa entrada fria, do título da página que o servidor já preencheu.
    const bizName = (app.settings && app.settings.business_name)
      || (document.title.split('|').pop() || '').trim()
      || 'Painel de gestão';
    root.replaceChildren(h('div', { class: 'login-page' }, h('div', { class: 'login-card' },
      h('div', { class: 'login-brand' },
        h('img', { class: 'login-mark', src: '/img/logo.png', alt: bizName, width: 64, height: 64 })),
      S.renderStrip({ open: 540, close: 1260, busy: [[600, 720], [780, 900], [1020, 1140]] }),
      h('h1', {}, 'Área de gestão'),
      h('p', { class: 'sub' }, 'Entre para gerir as marcações, os estúdios e a sua equipa.'),
      form)));
    email.focus();
  }

  async function logout() {
    try { await S.api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* segue para o login */ }
    showLogin();
  }

  async function reloadRefs() {
    const [st, sv, cat] = await Promise.all([api('/api/admin/studios'), api('/api/admin/services'), api('/api/admin/catalogos')]);
    app.studios = st.studios;
    app.services = sv.services;
    app.catalogos = Object.fromEntries(cat.catalogos.map((c) => [c.key, c.itens]));
  }

  // Lista de escolha a partir de um catálogo de Configurações. Mostra os itens
  // ativos e, numa marcação antiga, também o valor que já lá estiver (mesmo
  // que entretanto tenha sido desativado). `porNome` = guarda o nome (género).
  function catalogoSelect(key, atual, vazio, porNome = false) {
    const itens = (app.catalogos && app.catalogos[key]) || [];
    const val = (i) => (porNome ? i.nome : i.codigo);
    const visiveis = itens.filter((i) => i.ativo || val(i) === atual);
    const extra = atual && !visiveis.some((i) => val(i) === atual) ? [h('option', { value: atual }, atual)] : [];
    return h('select', { value: atual || '' }, h('option', { value: '' }, vazio), visiveis.map((i) => h('option', { value: val(i) }, i.nome)), extra);
  }

  function setPending(n) {
    app.pending = n;
    const b = document.getElementById('pending-badge');
    if (b) { b.textContent = n; b.hidden = !n; }
    document.title = (n ? `(${n}) ` : '') + document.title.replace(/^\(\d+\)\s/, '');
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const r = await api('/api/admin/pending-count');
        if (r.pending > app.pending) toast('Novo pedido de marcação.');
        setPending(r.pending);
        loadNotifs();
      } catch (_) { /* tenta na próxima */ }
    }, 60000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  // ---------------------------------------------------------- Estrutura e navegação
  // A terceira coluna é quem vê a secção: '' = todos; 'manager' = proprietário
  // ou equipa sem estúdio (um agente não mexe na configuração geral); 'owner' =
  // só o proprietário. Ver os guardas do backend (requireManager/requireOwner).
  const NAV = [
    ['dashboard', 'Dashboard', ''], ['painel', 'Painel', ''], ['calendario', 'Calendário', ''], ['marcacoes', 'Marcações', ''], ['clientes', 'Clientes', ''], ['relatorios', 'Relatórios', ''],
    ['estudios', 'Estúdios', 'manager'], ['servicos', 'Serviços', 'manager'],
    ['musica', 'Música', 'manager'], ['projetos', 'Projetos', 'manager'],
    ['utilizadores', 'Utilizadores', 'owner'], ['acesso', 'Gestão de acesso', 'owner'], ['configuracoes', 'Configurações', 'manager'],
  ];
  // Definições e Integrações vivem agora dentro de Configurações; os endereços
  // antigos continuam a funcionar e levam à secção certa.
  const DENTRO_CONFIG = { definicoes: 'geral', integracoes: 'integracoes' };

  function canSee(perm) {
    if (perm === 'owner') return app.user.role === 'owner';
    if (perm === 'manager') return !app.user.studio_id;   // agente está preso a um estúdio
    return true;
  }

  // Como se descreve o utilizador no rodapé do menu.
  function roleLabel() {
    if (app.user.role === 'owner') return 'proprietário';
    if (app.user.studio_id) {
      const st = app.studios.find((s) => s.id === app.user.studio_id);
      return st ? 'agente · ' + st.name : 'agente de estúdio';
    }
    return 'equipa';
  }

  // Botão de tema (claro/escuro). Vale para todo o painel; fica guardado.
  function themeControl() {
    const btn = h('button', { class: 'tb-btn tb-theme', type: 'button', 'aria-label': 'Mudar entre claro e escuro' });
    const paint = () => {
      const claro = prefs.tema() === 'claro';
      btn.replaceChildren(h('span', { class: 'tb-ico', 'aria-hidden': 'true' }, claro ? '☀' : '☾'), h('span', {}, claro ? 'Claro' : 'Escuro'));
    };
    btn.onclick = () => { prefs.setTema(prefs.tema() === 'claro' ? 'escuro' : 'claro'); paint(); };
    paint();
    return btn;
  }

  // Menu que abre por baixo de um botão da barra de topo e fecha ao clicar
  // fora, com Escape ou ao escolher uma opção.
  function popover(btn, menu) {
    const wrap = h('div', { class: 'tb-usermenu' }, btn, menu);
    const onDoc = (e) => { if (!wrap.contains(e.target)) fechar(); };
    const onKey = (e) => { if (e.key === 'Escape') { fechar(); btn.focus(); } };
    function fechar() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); }
    function abrir() { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); setTimeout(() => { document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey); }, 0); }
    btn.onclick = () => (menu.hidden ? abrir() : fechar());
    return { wrap, fechar };
  }

  // Seletor de idioma: botão com o globo e a língua atual; o menu lista as
  // línguas pelo nome na própria língua. Escolher traduz o painel na hora
  // (admin-i18n.js) e guarda a escolha, que acompanha o link "Ver o site".
  const LINGUA_MENU = [['en', 'GB', 'English'], ['pt', 'PT', 'Português'], ['fr', 'FR', 'Français']];
  const svgIco = (paths, size = 17) => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    for (const d of paths) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); svg.append(p); }
    return svg;
  };
  const GLOBO = ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'];
  function langControl() {
    const atual = prefs.lingua();
    const [, bandeira] = LINGUA_MENU.find(([c]) => c === atual);
    const btn = h('button', { class: 'tb-btn tb-lang', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': 'Idioma' },
      svgIco(GLOBO), h('span', { class: 'tb-lang-flag' }, bandeira), h('strong', {}, atual.toUpperCase()),
      svgIco(['M6 9l6 6 6-6'], 14));
    const menu = h('div', { class: 'tb-menu tb-lang-menu', role: 'menu', hidden: true },
      LINGUA_MENU.map(([c, flag, nome]) => h('button', {
        class: 'tb-menu-item' + (c === atual ? ' on' : ''), type: 'button', role: 'menuitemradio', 'aria-checked': String(c === atual), lang: c,
        onclick: () => { p.fechar(); mudarLingua(c); },
      }, h('span', { class: 'tb-lang-flag' }, flag), h('span', { class: 'tb-lang-nome' }, nome), c === atual && svgIco(['M5 12l5 5 9-10'], 16))));
    const p = popover(btn, menu);
    return p.wrap;
  }

  // ---------------------------------------------------------- Sininho (notificações)
  // Pedidos por confirmar, sessões de hoje, pagamentos em atraso e tentativas
  // falhadas de entrar na conta. O ponto vermelho conta o que está por ler;
  // abrir o sininho marca tudo como visto (no servidor, por pessoa).
  const notif = { items: [], unread: 0, avisado: false };
  const NOTIF_ICO = {
    pedido: ['M5 5h14v15H5z', 'M5 10h14', 'M9 3v4', 'M15 3v4', 'M12 13v4', 'M10 15h4'],
    hoje: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
    pagamento: ['M3 7h18v10H3z', 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M6 10h.01', 'M18 14h.01'],
    seguranca: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M12 9v4', 'M12 16h.01'],
  };
  const SINO = ['M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z', 'M10 20a2 2 0 0 0 4 0'];

  function quando(iso) {
    const seg = (Date.parse(iso) - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat((window.I18N && window.I18N.locale) || 'pt-PT', { numeric: 'auto' });
    for (const [lim, un, div] of [[60, 'second', 1], [3600, 'minute', 60], [86400, 'hour', 3600], [604800, 'day', 86400], [Infinity, 'week', 604800]]) {
      if (Math.abs(seg) < lim) return Math.abs(seg) < 45 ? rtf.format(0, 'second') : rtf.format(Math.round(seg / div), un);
    }
    return '';
  }

  function bellControl() {
    const badge = h('span', { class: 'tb-bell-n', hidden: true });
    const btn = h('button', { class: 'tb-btn tb-bell', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-label': 'Notificações' }, svgIco(SINO, 18), badge);
    const lista = h('div', { class: 'tb-notif-list' });
    const lidas = h('button', { class: 'tb-notif-all', type: 'button' }, 'Marcar como lidas');
    const menu = h('div', { class: 'tb-menu tb-notif-menu', role: 'menu', hidden: true },
      h('div', { class: 'tb-notif-head' }, h('strong', {}, 'Notificações'), lidas), lista);
    const p = popover(btn, menu);

    function pintar() {
      badge.hidden = !notif.unread;
      badge.textContent = notif.unread > 9 ? '9+' : String(notif.unread);
      btn.setAttribute('aria-label', notif.unread ? `Notificações (${notif.unread} por ler)` : 'Notificações');
      lidas.hidden = !notif.unread;
      lista.replaceChildren(...(notif.items.length
        ? notif.items.map((n) => h('a', { class: 'tb-notif' + (n.unread ? ' unread' : ''), href: n.href, role: 'menuitem', onclick: () => p.fechar() },
          h('span', { class: 'tb-notif-ico ' + n.kind }, svgIco(NOTIF_ICO[n.kind] || SINO, 16)),
          h('span', { class: 'tb-notif-txt' }, h('strong', {}, n.title), h('span', {}, n.text), h('small', {}, quando(n.at)))))
        : [h('p', { class: 'tb-notif-empty' }, 'Sem notificações. Está tudo em dia.')]));
    }
    async function marcarVistas() {
      if (!notif.unread) return;
      notif.unread = 0;
      badge.hidden = true; lidas.hidden = true;
      btn.setAttribute('aria-label', 'Notificações');
      try { await api('/api/admin/notificacoes/vistas', { method: 'POST' }); } catch (_) { /* tenta na próxima */ }
    }
    // Abre com os destaques de "por ler" ainda visíveis e marca como visto.
    btn.addEventListener('click', () => { if (!menu.hidden) marcarVistas(); });
    lidas.onclick = () => { marcarVistas(); notif.items.forEach((n) => { n.unread = false; }); pintar(); };
    pintar();
    notif.pintar = pintar;
    return p.wrap;
  }

  // Vai buscar as notificações; à entrada, avisa se houver alguma por ler.
  async function loadNotifs() {
    try {
      const r = await api('/api/admin/notificacoes');
      notif.items = r.items;
      notif.unread = r.unread;
      if (notif.pintar) notif.pintar();
      if (!notif.avisado && r.unread) toast(r.unread === 1 ? 'Tem 1 notificação por ler.' : `Tem ${r.unread} notificações por ler.`);
      notif.avisado = true;
    } catch (_) { /* o sininho fica como estava */ }
  }

  // Muda a língua do painel: o tradutor passa a traduzir (ou deixa de traduzir,
  // no português) e o painel volta a desenhar-se a partir dos textos originais.
  function mudarLingua(l) {
    if (l === prefs.lingua()) return;
    prefs.setLingua(l);
    if (window.I18N && window.I18N.definir) window.I18N.definir(l);
    renderShell();
    route();
  }

  // Janela para a pessoa trocar a sua palavra-passe (POST /api/auth/password).
  function changePasswordModal() {
    openModal((close) => {
      const current = h('input', { type: 'password', autocomplete: 'current-password', required: true });
      const next = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8 });
      const confirmar = h('input', { type: 'password', autocomplete: 'new-password', required: true });
      const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
      const falha = (m) => { err.textContent = m; err.hidden = false; };
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault(); err.hidden = true;
          if (next.value.length < 8) return falha('A nova palavra-passe deve ter pelo menos 8 caracteres.');
          if (next.value !== confirmar.value) return falha('A confirmação não coincide com a nova palavra-passe.');
          try {
            await S.api('/api/auth/password', { method: 'POST', body: { current: current.value, next: next.value } });
            toast('Palavra-passe alterada.');
            close();
          } catch (ex) { falha(ex.message); }
        },
      },
        field('Palavra-passe atual', current),
        field('Nova palavra-passe', next, { hint: 'Pelo menos 8 caracteres.' }),
        field('Confirmar nova palavra-passe', confirmar),
        err,
        h('div', { class: 'modal-foot' },
          h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Cancelar'),
          h('button', { class: 'btn', type: 'submit' }, 'Guardar')));
      return h('div', { class: 'modal-in' },
        h('div', { class: 'modal-head' }, h('h2', {}, 'Alterar palavra-passe')),
        form);
    });
  }

  // Ícones a traço do menu do chip.
  const MENU_ICO = {
    perfil: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
    senha: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
    sair: ['M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4', 'M9 16l-4-4 4-4', 'M5 12h11'],
  };
  function menuIco(nome) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 17, height: 17, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    for (const d of MENU_ICO[nome]) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); svg.append(p); }
    return svg;
  }

  // Chip com o nome: ao clicar abre um menu com o perfil, alterar palavra-passe e sair.
  function userMenu(papel) {
    const iniciais = (app.user.name || '').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '·';
    const menu = h('div', { class: 'tb-menu', role: 'menu', hidden: true },
      h('div', { class: 'tb-menu-who' }, h('strong', {}, app.user.name), h('span', {}, app.user.email)),
      h('button', { class: 'tb-menu-item', type: 'button', role: 'menuitem', onclick: () => { fechar(); location.hash = '#/perfil'; } }, menuIco('perfil'), 'O Meu Perfil'),
      h('button', { class: 'tb-menu-item', type: 'button', role: 'menuitem', onclick: () => { fechar(); changePasswordModal(); } }, menuIco('senha'), 'Alterar palavra-passe'),
      h('button', { class: 'tb-menu-item danger', type: 'button', role: 'menuitem', onclick: () => { fechar(); logout(); } }, menuIco('sair'), 'Terminar sessão'));
    const btn = h('button', { class: 'tb-user', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
      h('span', { class: 'tb-avatar' }, iniciais),
      h('span', { class: 'tb-user-txt' }, h('strong', {}, app.user.name), h('span', {}, papel)),
      h('span', { class: 'tb-caret', 'aria-hidden': 'true' }, '▾'));
    const wrap = h('div', { class: 'tb-usermenu' }, btn, menu);
    const onDoc = (e) => { if (!wrap.contains(e.target)) fechar(); };
    const onKey = (e) => { if (e.key === 'Escape') { fechar(); btn.focus(); } };
    function fechar() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); }
    function abrir() { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); setTimeout(() => { document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey); }, 0); }
    btn.onclick = () => (menu.hidden ? abrir() : fechar());
    return wrap;
  }

  // Como se descreve o utilizador no chip da barra de topo.
  function chipRole() {
    if (app.user.role === 'owner') return 'Administrador';
    if (app.user.studio_id) return 'Agente';
    return 'Responsável';
  }

  // Barra de topo do painel: identidade à esquerda, idioma, tema e quem está à
  // direita. O agente vê o nome do seu estúdio; os outros perfis (administrador,
  // responsável) veem o nome do negócio.
  function topBar() {
    const st = app.user.studio_id && app.studios.find((s) => s.id === app.user.studio_id);
    return h('header', { class: 'topbar on-dark' },
      h('div', { class: 'tb-studio' },
        h('img', { class: 'tb-studio-ico', src: '/img/logo.png', alt: '', width: 20, height: 20 }),
        h('span', { class: 'tb-studio-name' }, st ? st.name : app.settings.business_name)),
      h('div', { class: 'tb-right' },
        bellControl(),
        langControl(),
        themeControl(),
        userMenu(chipRole())));
  }

  // Rodapé do painel: fecha a coluna por baixo, a condizer com a barra de topo —
  // nome do negócio de um lado, atalho para o site e o ano do outro.
  function mainFooter() {
    const st = app.studios.find((s) => s.id === app.user.studio_id);
    return h('footer', { class: 'main-foot on-dark' },
      h('span', { class: 'main-foot-brand' },
        app.settings.business_name,
        st && h('span', { class: 'main-foot-sep' }, ' · '),
        st && h('span', { class: 'main-foot-studio' }, st.name)),
      h('span', { class: 'main-foot-meta' },
        h('a', { href: '/', target: '_blank', rel: 'noopener' }, 'Ver o site'),
        ' · © ' + new Date().getFullYear()));
  }

  function renderShell() {
    // O logo leva à área de entrada: pergunta primeiro, para não sair por engano.
    const goToLogin = (e) => {
      e.preventDefault();
      if (window.confirm('Terminar sessão e voltar ao ecrã de entrada?')) logout();
    };
    const side = h('aside', { class: 'side on-dark' },
      h('a', { class: 'brand', href: '#/painel', title: 'Terminar sessão e voltar à entrada', 'aria-label': app.settings.business_name, onclick: goToLogin },
        h('img', { class: 'brand-mark', src: '/img/logo.png', alt: app.settings.business_name, width: 48, height: 48 })),
      h('nav', { 'aria-label': 'Secções do painel' }, NAV.filter(([, , perm]) => canSee(perm)).map(([k, label]) => h('a', { class: 'nav', href: '#/' + k, 'data-k': k },
        label, k === 'marcacoes' && h('span', { class: 'badge', id: 'pending-badge', hidden: !app.pending, 'aria-label': 'pedidos por confirmar' }, app.pending)))),
      h('div', { class: 'side-foot' },
        h('p', { class: 'who' }, `${app.user.name} (${roleLabel()})`),
        h('a', { href: '/', target: '_blank', rel: 'noopener' }, 'Ver o site'),
        // A palavra-passe troca-se pelo chip da barra de topo, igual para todos.
        h('button', { type: 'button', onclick: logout }, 'Sair')));
    // Todos os perfis (agente, administrador, responsável) ganham a mesma barra
    // de topo — nome/estúdio, idioma, tema e identidade — e o rodapé a condizer.
    const viewEl = h('main', { class: 'main', id: 'view', tabindex: '-1' });
    const col = h('div', { class: 'main-col' }, topBar(), viewEl, mainFooter());
    root.replaceChildren(h('div', { class: 'app' }, side, col));
  }

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [name, qs] = raw.split('?');
    return { name: views[name] ? name : 'painel', params: new URLSearchParams(qs || '') };
  }

  async function route() {
    if (!app.user) return;
    const { name, params } = parseHash();
    if (DENTRO_CONFIG[name] && canSee('manager')) { location.hash = '#/configuracoes?sec=' + DENTRO_CONFIG[name]; return; }
    // Secção que o perfil não vê (ex.: um agente a tentar #/estudios): volta ao painel.
    const navItem = NAV.find(([k]) => k === name);
    if (navItem && !canSee(navItem[2])) { location.hash = '#/painel'; return; }
    const view = views[name];
    const seq = ++routeSeq;
    for (const a of document.querySelectorAll('.nav')) {
      if (a.dataset.k === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    // No telemóvel as secções rolam para o lado: traz a atual para dentro do ecrã.
    const nav = document.querySelector('.side nav');
    const atual = nav && nav.querySelector('[aria-current="page"]');
    if (atual && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = atual.offsetLeft - (nav.clientWidth - atual.offsetWidth) / 2;
    }
    const main = document.getElementById('view');
    if (!main) return;
    document.title = `${view.title} | ${app.settings.business_name}`;
    try {
      const frag = h('div');
      await view.render(frag, params);
      if (seq !== routeSeq) return;
      main.replaceChildren(...frag.childNodes);
      setPending(app.pending);
    } catch (e) {
      if (seq !== routeSeq) return;
      main.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, e.message));
    }
  }

  async function boot() {
    let me;
    try { me = await S.api('/api/auth/me'); } catch (_) { return showLogin(); }
    app.user = me.user;
    app.today = me.today;
    app.settings = me.settings;
    try {
      await reloadRefs();
      app.pending = (await api('/api/admin/pending-count')).pending;
    } catch (e) {
      root.replaceChildren(h('div', { class: 'notice error', role: 'alert' }, e.message));
      return;
    }
    prefs.setTema(prefs.tema());   // restaura o tema guardado (o login força escuro)
    renderShell();
    startPolling();
    route();
    loadNotifs();
  }
  window.addEventListener('hashchange', route);

  // ---------------------------------------------------------- Lista de marcações (componente)
  async function quickStatus(b, status, onChange) {
    try {
      const r = await api(`/api/admin/bookings/${b.id}/status`, { method: 'PATCH', body: { status } });
      toast(r.aguarda_pagamento ? 'Pedido aceite: o cliente foi avisado de que só falta pagar.'
        : status === 'confirmado' ? 'Pedido confirmado.' : 'Pedido recusado.');
      refreshPending();
      onChange();
    } catch (e) { toast(e.message, true); }
  }

  async function refreshPending() {
    try { setPending((await api('/api/admin/pending-count')).pending); } catch (_) { /* ignora */ }
  }

  function bookingItem(b, onChange) {
    const pending = b.status === 'pedido';
    return h('li', { class: 'bk' },
      h('div', { class: 'bk-time' }, h('strong', {}, `${b.start}–${b.end}`), h('span', {}, fmtDate(b.date, 'short'))),
      h('div', { class: 'bk-main' },
        h('strong', {}, b.client_name),
        h('span', {}, [b.title, b.service_name, b.style].filter(Boolean).join(', ') || 'Sem projeto indicado'),
        h('span', {}, `${b.studio_name}, ${b.room_name}`),
        !!b.remote && h('span', { class: 'modo remoto', title: 'O cliente não vem ao estúdio; manda os ficheiros.' }, 'À distância')),
      h('div', { class: 'bk-side' },
        statusTag(b.status),
        pending && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => quickStatus(b, 'confirmado', onChange) }, 'Confirmar'),
        pending && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { if (window.confirm('Recusar este pedido? O horário fica livre.')) quickStatus(b, 'cancelado', onChange); } }, 'Recusar'),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => openBooking({ booking: b, onSaved: onChange }) }, 'Abrir')));
  }

  // ---------------------------------------------------------- Janela: marcação
  const STATUS_MSG = {
    pedido: 'a aguardar confirmação', confirmado: 'confirmada', em_curso: 'em curso',
    concluido: 'concluída', cancelado: 'cancelada', expirado: 'expirada', aguarda_pagamento: 'aceite, à espera do pagamento',
  };

  function allRooms() {
    return app.studios.flatMap((s) => s.rooms.map((r) => ({ ...r, studio: s })));
  }

  function openBooking({ booking = null, preset = {}, onSaved } = {}) {
    const b = booking || {};
    const rooms = allRooms();
    const usable = rooms.filter((r) => (r.active && r.studio.active) || r.id === b.room_id);
    if (!usable.length) { toast('Crie primeiro um estúdio com pelo menos uma sala.', true); return; }

    const f = {
      status: h('select', { value: b.status || 'confirmado' }, Object.entries(STATUS).map(([k, v]) => h('option', { value: k }, v))),
      room: h('select', { value: b.room_id || preset.room_id || usable[0].id },
        app.studios.map((s) => {
          const opts = usable.filter((r) => r.studio_id === s.id);
          return opts.length ? h('optgroup', { label: s.name }, opts.map((r) => h('option', { value: r.id }, r.name))) : null;
        })),
      date: h('input', { type: 'date', required: true, value: b.date || preset.date || ui.calDate || app.today }),
      start: h('input', { type: 'time', step: 900, required: true, value: b.start || preset.start || '10:00' }),
      end: h('input', { type: 'time', step: 900, required: true, value: b.end || preset.end || '11:00' }),
      service: h('select', { value: b.service_id || '' }, h('option', { value: '' }, 'Sem serviço'),
        app.services.filter((s) => s.active || s.id === b.service_id).map((s) => h('option', { value: s.id }, s.name))),
      remote: h('input', { type: 'checkbox', checked: !!b.remote }),
      title: h('input', { type: 'text', maxlength: 120, value: b.title || '' }),
      style: catalogoSelect('generos', b.style || '', 'Sem género indicado', true),
      projectType: catalogoSelect('tipos_projeto', b.project_type || '', 'Não indicado'),
      clientType: catalogoSelect('tipos_cliente', b.client_type || '', 'Não indicado'),
      payMethod: catalogoSelect('metodos_pagamento', b.payment_method || '', 'Não indicado'),
      name: h('input', { type: 'text', maxlength: 80, required: true, value: b.client_name || '', autocomplete: 'off' }),
      phone: h('input', { type: 'tel', maxlength: 30, value: b.client_phone || '', autocomplete: 'off' }),
      email: h('input', { type: 'email', maxlength: 120, value: b.client_email || '', autocomplete: 'off' }),
      notes: h('textarea', { maxlength: 1000 }, b.notes || ''),
      internal: h('textarea', { maxlength: 2000 }, b.internal_notes || ''),
      price: h('input', { type: 'number', min: 0, step: 100, value: b.price === undefined ? '' : b.price }),
      paid: h('input', { type: 'number', min: 0, step: 100, value: b.paid || 0 }),
    };

    // Preço sugerido: preço/hora da sala × duração, enquanto o valor não for editado à mão.
    const calc = () => {
      const r = rooms.find((x) => x.id === +f.room.value);
      const s = parseHM(f.start.value), e = parseHM(f.end.value);
      return !r || s === null || e === null || e <= s ? 0 : Math.round((r.hourly_rate * (e - s)) / 60);
    };
    let auto = !booking || +f.price.value === calc();
    if (!booking) f.price.value = calc();
    f.price.addEventListener('input', () => { auto = false; });
    f.start.addEventListener('change', () => {
      const s = parseHM(f.start.value), e = parseHM(f.end.value);
      if (s !== null && (e === null || e <= s)) f.end.value = S.fmtMin(Math.min(s + 60, 1440 - 1));
    });
    for (const el of [f.room, f.start, f.end]) el.addEventListener('change', () => { if (auto) f.price.value = calc(); });

    // A caixa só faz sentido em serviços que dispensam a presença.
    const remoteWrap = h('label', { class: 'check' }, f.remote, 'À distância (o cliente não vem ao estúdio)');
    const syncRemote = () => {
      const sv = app.services.find((s) => String(s.id) === String(f.service.value));
      const permite = !!(sv && sv.remote_ok);
      remoteWrap.hidden = !permite;
      if (!permite) f.remote.checked = false;
    };
    f.service.addEventListener('change', syncRemote);
    syncRemote();

    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    return openModal((close) => {
      const save = h('button', { class: 'btn', type: 'submit' }, 'Guardar');
      const whats = booking && h('button', {
        class: 'btn btn-outline', type: 'button',
        onclick: () => {
          const r = rooms.find((x) => x.id === +f.room.value);
          const text = `Olá ${f.name.value}, a sua marcação ${booking.code} (${r ? r.studio.name + ', ' : ''}${fmtDate(f.date.value)}, das ${f.start.value} às ${f.end.value}) está ${STATUS_MSG[f.status.value]}.`;
          const url = waLink(app.settings, f.phone.value, text);
          if (!url) return toast('Indique o telefone do cliente.', true);
          window.open(url, '_blank', 'noopener');
        },
      }, 'Enviar por WhatsApp');
      // Recibo em PDF (no formato do estúdio: dados em Estúdios › Dados para o recibo).
      // Fatura interna: emitir, descarregar ou anular (ver faturaAcoes).
      const faturaBox = booking && h('span', { class: 'fat-acoes' });
      if (faturaBox) faturaAcoes(booking, faturaBox);
      const recibo = booking && h('a', { class: 'btn btn-outline', href: `/api/admin/bookings/${booking.id}/recibo.pdf`, download: `recibo-${booking.code}.pdf` }, 'Recibo (PDF)');
      const del = booking && h('button', {
        class: 'btn btn-danger', type: 'button',
        onclick: async () => {
          if (!window.confirm('Eliminar esta marcação de vez? Para a manter no histórico, mude o estado para "Cancelado".')) return;
          try {
            await api(`/api/admin/bookings/${booking.id}`, { method: 'DELETE' });
            close(); toast('Marcação eliminada.'); refreshPending(); if (onSaved) onSaved();
          } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        },
      }, 'Eliminar');

      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          const body = {
            status: f.status.value, room_id: +f.room.value, date: f.date.value, start: f.start.value, end: f.end.value,
            service_id: f.service.value || null, remote: f.remote.checked, title: f.title.value, style: f.style.value,
            project_type: f.projectType.value, client_type: f.clientType.value, payment_method: f.payMethod.value,
            client_name: f.name.value, client_phone: f.phone.value,
            client_email: f.email.value, notes: f.notes.value, internal_notes: f.internal.value, price: f.price.value, paid: f.paid.value || 0,
          };
          save.disabled = true;
          try {
            if (booking) await api(`/api/admin/bookings/${booking.id}`, { method: 'PUT', body });
            else await api('/api/admin/bookings', { method: 'POST', body });
            close(); toast('Marcação guardada.'); refreshPending(); if (onSaved) onSaved();
          } catch (ex) {
            err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'nearest' });
          } finally { save.disabled = false; }
        },
      },
      h('div', { class: 'grid-2' }, field('Estado', f.status), field('Sala', f.room)),
      h('div', { class: 'grid-3' }, field('Dia', f.date), field('Início', f.start), field('Fim', f.end)),
      h('div', { class: 'grid-2' }, field('Serviço', f.service), field('Projeto', f.title)),
      h('div', { class: 'grid-2' }, field('Tipo de projeto', f.projectType), field('Género musical', f.style)),
      remoteWrap,
      h('div', { class: 'grid-2' }, field('Nome do cliente', f.name), field('Telefone', f.phone)),
      h('div', { class: 'grid-2' }, field('Email', f.email), field('Tipo de cliente', f.clientType)),
      field('Mensagem do cliente', f.notes),
      field('Notas internas (o cliente não vê)', f.internal),
      h('div', { class: 'grid-2' },
        field('Valor total', f.price, { hint: 'Deixe vazio para calcular pelo preço da sala.' }),
        field('Valor já recebido', f.paid)),
      h('div', { class: 'grid-2' }, field('Método de pagamento', f.payMethod), null),
      err,
      h('div', { class: 'modal-foot' },
        h('div', { class: 'spacer' }, del, whats, recibo, faturaBox),
        h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Fechar'),
        save));

      const sub = booking
        ? `Código ${booking.code}. ${booking.source === 'site' ? 'Pedido feito no site' : 'Criada no painel'} a ${fmtDateFull(booking.created_at.slice(0, 10))}.`
        : 'Para clientes que ligam ou passam no estúdio. O sistema impede horários sobrepostos.';
      return h('div', { class: 'modal-in' },
        h('div', { class: 'modal-head' }, h('h2', {}, booking ? 'Marcação' : 'Nova marcação'), booking && statusTag(booking.status)),
        h('p', { class: 'modal-sub' }, sub), form);
    });
  }

  // ---------------------------------------------------------- Fatura (interna)
  // Uma marcação tem no máximo uma fatura em vigor. Sem ela: "Emitir fatura"
  // (pede o NIF e a morada do cliente). Com ela: o PDF e "Anular fatura" — o
  // número nunca se reaproveita; depois de anular pode emitir-se outra.
  function faturaAcoes(booking, box) {
    const desenhar = async () => {
      let r;
      try { r = await api(`/api/admin/bookings/${booking.id}/fatura`); } catch (_) { box.replaceChildren(); return; }
      if (r.fatura) {
        const f = r.fatura;
        const anular = async () => {
          const motivo = window.prompt(`Anular a fatura ${f.numero_texto}? Escreva o motivo:`);
          if (!motivo) return;
          try {
            await api(`/api/admin/faturas/${f.id}/anular`, { method: 'POST', body: { motivo } });
            toast('Fatura anulada.'); desenhar();
          } catch (ex) { toast(ex.message, true); }
        };
        box.replaceChildren(
          h('a', { class: 'btn btn-outline', href: `/api/admin/faturas/${f.id}.pdf`, download: `fatura-${f.serie.replace(' ', '')}-${f.numero}.pdf` }, `Fatura ${f.numero_texto} (PDF)`),
          h('button', { class: 'btn btn-outline', type: 'button', onclick: anular }, 'Anular fatura'));
      } else if (!['pedido', 'cancelado', 'expirado'].includes(booking.status)) {
        box.replaceChildren(h('button', { class: 'btn btn-outline', type: 'button', onclick: () => emitirFatura(booking, desenhar) }, 'Emitir fatura'));
      } else box.replaceChildren();
    };
    desenhar();
  }

  function emitirFatura(booking, depois) {
    openModal((close) => {
      const nome = h('input', { type: 'text', maxlength: 120, required: true, value: booking.client_name || '' });
      const nif = h('input', { type: 'text', maxlength: 20, inputmode: 'numeric', placeholder: 'Vazio: consumidor final' });
      const morada = h('input', { type: 'text', maxlength: 200 });
      const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
      const btn = h('button', { class: 'btn', type: 'submit' }, 'Emitir fatura');
      return h('div', { class: 'modal-in' },
        h('div', { class: 'modal-head' }, h('h2', {}, 'Emitir fatura')),
        h('p', { class: 'modal-sub' }, `Marcação ${booking.code}. A fatura fica com o número seguinte da série do ano e com a taxa de IVA do estúdio. É um documento interno, sem validade fiscal.`),
        h('form', {
          onsubmit: async (e) => {
            e.preventDefault(); err.hidden = true; btn.disabled = true;
            try {
              const r = await api(`/api/admin/bookings/${booking.id}/fatura`, { method: 'POST', body: { cliente_nome: nome.value, cliente_nif: nif.value, cliente_morada: morada.value } });
              close(); toast(`Fatura ${r.fatura.numero_texto} emitida.`); depois();
            } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
          },
        },
        h('div', { class: 'grid-2' }, field('Nome na fatura', nome), field('NIF do cliente', nif)),
        field('Morada do cliente', morada),
        err,
        h('div', { class: 'modal-foot' },
          h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Cancelar'), btn)));
    });
  }

  // ---------------------------------------------------------- Janela: bloquear horário
  function openBlock({ preset = {}, onSaved } = {}) {
    const rooms = allRooms().filter((r) => r.active && r.studio.active);
    if (!rooms.length) { toast('Ainda não há salas ativas.', true); return; }
    const room = h('select', { value: preset.room_id || rooms[0].id },
      app.studios.map((s) => {
        const opts = rooms.filter((r) => r.studio_id === s.id);
        return opts.length ? h('optgroup', { label: s.name }, opts.map((r) => h('option', { value: r.id }, r.name))) : null;
      }));
    const date = h('input', { type: 'date', required: true, value: preset.date || ui.calDate || app.today });
    const start = h('input', { type: 'time', step: 900, required: true, value: preset.start || '09:00' });
    const end = h('input', { type: 'time', step: 900, required: true, value: preset.end || '12:00' });
    const reason = h('input', { type: 'text', maxlength: 120, placeholder: 'Ex.: manutenção, sessão própria, feriado' });
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    openModal((close) => h('div', { class: 'modal-in' },
      h('div', { class: 'modal-head' }, h('h2', {}, 'Bloquear horário')),
      h('p', { class: 'modal-sub' }, 'O horário fica indisponível no site e no calendário.'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          try {
            await api('/api/admin/blocks', { method: 'POST', body: { room_id: +room.value, date: date.value, start: start.value, end: end.value, reason: reason.value } });
            close(); toast('Horário bloqueado.'); if (onSaved) onSaved();
          } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        },
      },
      field('Sala', room),
      h('div', { class: 'grid-3' }, field('Dia', date), field('Início', start), field('Fim', end)),
      field('Motivo', reason),
      err,
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Fechar'),
        h('button', { class: 'btn', type: 'submit' }, 'Bloquear')))));
  }

  // Volta a desenhar a barra de topo (ex.: depois de a pessoa mudar o nome no perfil).
  function renderTopBar() {
    const atual = document.querySelector('.topbar');
    if (atual) atual.replaceWith(topBar());
    const who = document.querySelector('.side-foot .who');
    if (who) who.textContent = `${app.user.name} (${roleLabel()})`;
  }

  window.Admin = {
    app, ui, views, api, toast, field, pageHead, labelCells, studioFilter, openModal, openBooking, openBlock,
    bookingItem, reloadRefs, refresh: route, refreshPending, boot, renderTopBar,
  };
})();
