/* Painel de gestão: O Meu Perfil — dados pessoais, conta e acessos, segurança
   (palavra-passe) e a atividade da própria conta. Abre-se pelo chip do nome na
   barra de topo; vale para todos os perfis (administrador, responsável, agente). */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h } = S;
  const { app, api, toast, field } = A;

  // Ícones a traço, no mesmo estilo dos do resto do painel.
  const SVG = 'http://www.w3.org/2000/svg';
  const ICO = {
    user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
    shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
    key: ['M14.5 4a5.5 5.5 0 1 1-4.9 8L4 17.6V20h3v-2h2v-2h2l1.5-1.5A5.5 5.5 0 0 1 14.5 4z', 'M16 8h.01'],
    lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
    activity: ['M3 12h4l3-8 4 16 3-8h4'],
    logout: ['M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4', 'M9 16l-4-4 4-4', 'M5 12h11'],
    login: ['M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4', 'M15 16l4-4-4-4', 'M19 12H9'],
    mail: ['M4 6h16v12H4z', 'M4 7l8 6 8-6'],
    phone: ['M7.6 3.8h2.6l1.2 3.2-1.8 1.3a11.4 11.4 0 0 0 5.1 5.1l1.3-1.8 3.2 1.2v2.6a1.8 1.8 0 0 1-2 1.8A15.6 15.6 0 0 1 5.8 5.8a1.8 1.8 0 0 1 1.8-2z'],
    calendar: ['M5 5h14v15H5z', 'M5 10h14', 'M9 3v4', 'M15 3v4'],
    clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
    building: ['M5 21V4h10v17', 'M15 9h4v12', 'M8 8h4', 'M8 12h4', 'M8 16h4', 'M3 21h18'],
    status: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
    id: ['M3 6h18v12H3z', 'M7 10h4', 'M7 14h7', 'M16 10h1'],
    copy: ['M9 9h11v11H9z', 'M5 15V4h11'],
    pencil: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
    alert: ['M12 3l9 16H3z', 'M12 10v4', 'M12 17h.01'],
    refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
    eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'],
  };
  function ico(nome, tam = 18) {
    const svg = document.createElementNS(SVG, 'svg');
    for (const [k, v] of Object.entries({
      viewBox: '0 0 24 24', width: tam, height: tam, fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
    })) svg.setAttribute(k, v);
    for (const d of ICO[nome] || []) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  // ---------------------------------------------------------- Formatação
  const locale = () => (window.I18N && window.I18N.locale) || 'pt-PT';
  function relativo(iso) {
    if (!iso) return '—';
    const seg = (Date.parse(iso) - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
    const passos = [[60, 'second'], [3600, 'minute', 60], [86400, 'hour', 3600], [2592000, 'day', 86400], [31536000, 'month', 2592000], [Infinity, 'year', 31536000]];
    if (Math.abs(seg) < 45) return rtf.format(0, 'second');
    for (const [lim, un, div] of passos) {
      if (Math.abs(seg) < lim) return rtf.format(Math.round(seg / (div || 1)), un);
    }
    return '—';
  }
  const data = (iso) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
  const dataHora = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const ip = (s) => String(s || '').replace(/^::ffff:/, '');
  const iniciais = (nome) => (nome || '').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '·';

  // Mete o campo de um field() dentro de uma caixa com ícone/botão, sem perder
  // a ligação da etiqueta (o id fica no próprio input).
  function caixa(f, input, cls, antes, depois) {
    const wrap = h('div', { class: 'pf-input' + (cls ? ' ' + cls : '') });
    f.replaceChild(wrap, input);
    wrap.append(...[antes, input, depois].filter(Boolean));
    return f;
  }

  // ---------------------------------------------------------- Blocos
  function secao(id, icone, titulo, sub, ...corpo) {
    return h('section', { class: 'pf-sec', id: 'pf-' + id, 'aria-labelledby': 'pf-h-' + id },
      h('header', { class: 'pf-sec-head' },
        h('span', { class: 'pf-sec-ico' }, ico(icone, 20)),
        h('div', {}, h('h2', { id: 'pf-h-' + id }, titulo), h('p', {}, sub))),
      h('div', { class: 'pf-sec-body' }, ...corpo));
  }

  function anel(pct) {
    const r = 22, c = 2 * Math.PI * r;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 56 56'); svg.setAttribute('width', 56); svg.setAttribute('height', 56); svg.setAttribute('aria-hidden', 'true');
    for (const [cls, dash] of [['pf-ring-bg', c], ['pf-ring-fg', (c * pct) / 100]]) {
      const ci = document.createElementNS(SVG, 'circle');
      for (const [k, v] of Object.entries({ cx: 28, cy: 28, r, class: cls, 'stroke-dasharray': `${dash} ${c}` })) ci.setAttribute(k, v);
      svg.append(ci);
    }
    return h('div', { class: 'pf-ring', title: 'Nome, email, telefone e uma palavra-passe escolhida por si' },
      h('div', { class: 'pf-ring-svg' }, svg, h('strong', {}, pct + '%')),
      h('span', {}, 'Perfil', h('br'), 'completo'));
  }

  function hero(p) {
    const tiles = [
      ['calendar', 'Membro desde', data(p.created_at), null],
      ['clock', 'Último acesso', relativo(p.last_seen_at), null],
      ['login', 'Último login', relativo(p.last_login_at), p.last_login_ip ? ip(p.last_login_ip) : null],
      ['activity', 'Ações (30 dias)', String(p.stats.changes), null],
    ];
    return h('div', { class: 'pf-hero' },
      h('div', { class: 'pf-banner', 'aria-hidden': 'true' }),
      h('div', { class: 'pf-id' },
        h('div', { class: 'pf-avatar' }, iniciais(p.name), p.active && h('span', { class: 'pf-online', title: 'Ativo' })),
        h('div', { class: 'pf-id-txt' },
          h('div', { class: 'pf-name' }, h('strong', {}, p.name), h('span', { class: 'pf-pill ' + (p.active ? 'ok' : 'off') }, p.active ? 'Ativo' : 'Inativo')),
          h('div', { class: 'pf-meta' },
            h('span', {}, ico('mail', 16), p.email),
            h('span', { class: 'pf-role' }, ico('shield', 16), p.role_label))),
        anel(p.completeness)),
      h('div', { class: 'pf-tiles' }, tiles.map(([i, k, v, extra]) => h('div', { class: 'pf-tile' },
        h('span', { class: 'pf-tile-k' }, ico(i, 15), k),
        h('strong', {}, v),
        extra && h('code', {}, extra)))));
  }

  // ---------------------------------------------------------- Dados pessoais
  function dadosPessoais(p, aoGuardar) {
    const nome = h('input', { type: 'text', maxlength: 80, required: true, value: p.name, autocomplete: 'name' });
    const tel = h('input', { type: 'tel', maxlength: 30, value: p.phone || '', placeholder: 'ex.: +238 991 23 45', autocomplete: 'tel' });
    const email = h('input', { type: 'email', maxlength: 120, required: true, value: p.email, autocomplete: 'email' });
    const senha = h('input', { type: 'password', autocomplete: 'current-password' });
    const senhaWrap = field('Palavra-passe atual', senha, { hint: 'Necessária para mudar o email, que é também o login.' });
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    const guardar = h('button', { class: 'btn', type: 'submit', disabled: true }, 'Guardar alterações');
    const descartar = h('button', { class: 'btn btn-outline', type: 'button', disabled: true }, 'Descartar');

    const mudouEmail = () => email.value.trim().toLowerCase() !== p.email.toLowerCase();
    const sujo = () => nome.value.trim() !== p.name || tel.value.trim() !== (p.phone || '') || mudouEmail();
    const sync = () => {
      senhaWrap.hidden = !mudouEmail();
      guardar.disabled = descartar.disabled = !sujo();
    };
    for (const el of [nome, tel, email]) el.addEventListener('input', sync);
    descartar.onclick = () => { nome.value = p.name; tel.value = p.phone || ''; email.value = p.email; senha.value = ''; err.hidden = true; sync(); };
    sync();

    const fNome = field('Nome completo *', nome);
    const fTel = caixa(field('Telefone', tel), tel, '', ico('phone', 17));
    const fEmail = caixa(field('Email *', email, { hint: 'O email é também o login.' }), email, '', ico('mail', 17));

    return h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true; guardar.disabled = true;
        try {
          const r = await api('/api/auth/profile', { method: 'PUT', body: { name: nome.value, phone: tel.value, email: email.value, password: senha.value } });
          toast('Dados pessoais guardados.');
          aoGuardar(r.profile);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; guardar.disabled = false; }
      },
    },
    h('div', { class: 'grid-2' }, fNome, fTel),
    fEmail, senhaWrap, err,
    h('div', { class: 'pf-actions' }, descartar, guardar));
  }

  // ---------------------------------------------------------- Conta e acessos
  function contaAcessos(p) {
    const copiar = h('button', { class: 'pf-copy', type: 'button', 'aria-label': 'Copiar ID do utilizador', title: 'Copiar' }, ico('copy', 15));
    copiar.onclick = async () => {
      try { await navigator.clipboard.writeText(String(p.id)); toast('ID copiado.'); } catch (_) { toast('Não foi possível copiar.', true); }
    };
    const linha = (i, k, v) => h('div', { class: 'pf-row' }, h('span', { class: 'pf-row-k' }, ico(i, 16), k), h('div', { class: 'pf-row-v' }, v));
    const acesso = p.full_access ? 'Acesso total (administrador)'
      : p.studio_id ? 'Acesso ao estúdio ' + (p.studio_name || '')
        : 'Acesso de equipa (todos os estúdios)';
    return h('div', {},
      h('p', { class: 'hint pf-note' }, p.full_access
        ? 'Como proprietário, gere estes dados de todas as contas em Utilizadores.'
        : 'Geridos pelo proprietário. Peça-lhe para os alterar.'),
      h('div', { class: 'pf-rows' },
        linha('shield', 'Função', p.role_label),
        linha('status', 'Estado', h('span', { class: 'pf-pill ' + (p.active ? 'ok' : 'off') }, p.active ? 'Ativo' : 'Inativo')),
        linha('building', 'Estúdio', p.studio_name || 'Todos os estúdios'),
        linha('calendar', 'Criado', dataHora(p.created_at)),
        linha('id', 'ID do utilizador', h('span', { class: 'pf-id-val' }, h('code', {}, String(p.id)), copiar))),
      h('h3', { class: 'pf-sub' }, 'Permissões'),
      h('span', { class: 'pf-perm' }, ico('shield', 15), acesso));
  }

  // ---------------------------------------------------------- Segurança
  const REGRAS = [
    ['Pelo menos 8 caracteres', (s) => s.length >= 8],
    ['Uma letra maiúscula', (s) => /[A-ZÀ-Ý]/.test(s)],
    ['Uma letra minúscula', (s) => /[a-zß-ÿ]/.test(s)],
    ['Um número', (s) => /\d/.test(s)],
    ['Um símbolo', (s) => /[^A-Za-z0-9À-ÿ\s]/.test(s)],
  ];

  function senhaCampo(auto) {
    const inp = h('input', { type: 'password', autocomplete: auto, required: true });
    const olho = h('button', { class: 'pf-eye', type: 'button', 'aria-label': 'Mostrar palavra-passe', 'aria-pressed': 'false' }, ico('eye', 18));
    olho.onclick = () => {
      const ver = inp.type === 'password';
      inp.type = ver ? 'text' : 'password';
      olho.setAttribute('aria-pressed', String(ver));
    };
    return { inp, olho };
  }

  function seguranca(p, aoGuardar) {
    const atual = senhaCampo('current-password');
    const nova = senhaCampo('new-password');
    const conf = senhaCampo('new-password');
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    const btn = h('button', { class: 'btn', type: 'submit', disabled: true }, ico('lock', 16), 'Alterar palavra-passe');
    const barras = [0, 1, 2, 3].map(() => h('span'));
    const forca = h('div', { class: 'pf-strength', 'aria-hidden': 'true' }, barras);
    const itens = REGRAS.map(([txt]) => h('li', {}, txt));
    const naoCoincide = h('p', { class: 'pf-mismatch', hidden: true }, 'A confirmação não coincide.');

    const sync = () => {
      const s = nova.inp.value;
      const ok = REGRAS.map(([, f]) => f(s));
      ok.forEach((v, i) => itens[i].classList.toggle('ok', v));
      const n = ok.filter(Boolean).length;
      const cheias = !s ? 0 : n >= 5 ? 4 : n >= 4 ? 3 : n >= 3 ? 2 : 1;
      forca.dataset.n = cheias;
      barras.forEach((b, i) => b.classList.toggle('on', i < cheias));
      naoCoincide.hidden = !conf.inp.value || conf.inp.value === s;
      btn.disabled = !atual.inp.value || s.length < 8 || s !== conf.inp.value;
    };
    for (const c of [atual, nova, conf]) c.inp.addEventListener('input', sync);

    const campo = (label, c, extra) => {
      const f = caixa(field(label, c.inp), c.inp, 'pf-input-end', null, c.olho);
      if (extra) f.append(...extra);
      return f;
    };

    return h('form', {
      class: 'pf-sec-form',
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true; btn.disabled = true;
        try {
          await api('/api/auth/password', { method: 'POST', body: { current: atual.inp.value, next: nova.inp.value } });
          toast('Palavra-passe alterada.');
          aoGuardar();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
      },
    },
    h('p', { class: 'hint pf-note' }, p.password_changed_at
      ? 'Última alteração: ' + relativo(p.password_changed_at) + '.'
      : 'Ainda usa a palavra-passe que lhe foi dada. Escolha uma sua.'),
    campo('Palavra-passe atual', atual),
    campo('Nova palavra-passe', nova, [forca, h('ul', { class: 'pf-rules' }, itens)]),
    campo('Confirmar nova palavra-passe', conf, [naoCoincide]),
    err,
    h('div', { class: 'pf-actions start' }, btn));
  }

  // ---------------------------------------------------------- Atividade
  const TIPO = { login: ['login', 'ok'], logout: ['logout', 'neutro'], change: ['pencil', 'warn'], error: ['alert', 'erro'] };
  const FILTROS = [['', 'Tudo'], ['sessoes', 'Sessões'], ['alteracoes', 'Alterações'], ['erros', 'Erros']];

  function atividade(p) {
    let filtro = '';
    const lista = h('ol', { class: 'pf-timeline' });
    const chips = FILTROS.map(([k, label]) => {
      const b = h('button', { class: 'pf-chip', type: 'button', 'aria-pressed': String(k === filtro) }, label);
      b.onclick = () => { filtro = k; chips.forEach((c, i) => c.setAttribute('aria-pressed', String(FILTROS[i][0] === k))); carregar(); };
      return b;
    });
    const atualizar = h('button', { class: 'pf-refresh', type: 'button' }, ico('refresh', 15), 'Atualizar');
    atualizar.onclick = () => carregar();

    async function carregar() {
      lista.replaceChildren(h('li', { class: 'pf-empty' }, 'A carregar…'));
      try {
        const r = await api('/api/auth/activity?limite=60' + (filtro ? '&filtro=' + filtro : ''));
        if (!r.items.length) return lista.replaceChildren(h('li', { class: 'pf-empty' }, 'Sem atividade registada.'));
        lista.replaceChildren(...r.items.map((a) => {
          const [i, cor] = TIPO[a.kind] || TIPO.change;
          return h('li', { class: 'pf-ev' },
            h('span', { class: 'pf-ev-ico ' + cor }, ico(i, 16)),
            h('div', { class: 'pf-ev-txt' },
              h('strong', {}, a.action),
              h('span', { class: 'pf-ev-meta', title: dataHora(a.created_at) },
                h('span', {}, relativo(a.created_at)),
                a.detail && h('code', {}, a.detail),
                a.status && h('code', { class: a.status >= 400 ? 'bad' : '' }, String(a.status)),
                a.ip && h('code', {}, ip(a.ip)))));
        }));
      } catch (ex) { lista.replaceChildren(h('li', { class: 'pf-empty' }, ex.message)); }
    }
    carregar();

    return h('div', {},
      h('div', { class: 'pf-stats' },
        h('div', { class: 'pf-stat' }, h('strong', { class: 'ok' }, String(p.stats.logins)), h('span', {}, 'Logins (30 dias)')),
        h('div', { class: 'pf-stat' }, h('strong', { class: 'info' }, String(p.stats.changes)), h('span', {}, 'Ações (30 dias)')),
        h('div', { class: 'pf-stat' }, h('strong', { class: 'erro' }, String(p.stats.errors)), h('span', {}, 'Erros (30 dias)'))),
      h('div', { class: 'pf-filter' }, h('div', { class: 'pf-chips', role: 'group', 'aria-label': 'Filtrar atividade' }, chips), atualizar),
      lista);
  }

  // ---------------------------------------------------------- Vista
  const SECOES = [['dados', 'user', 'Dados pessoais'], ['conta', 'shield', 'Conta e acessos'], ['seguranca', 'key', 'Segurança'], ['atividade', 'activity', 'Atividade']];

  A.views.perfil = {
    title: 'O Meu Perfil',
    async render(el, params) {
      const { profile: p } = await api('/api/auth/profile');

      // Depois de guardar: o nome e o email mudam também na barra de topo.
      const aoGuardarDados = (novo) => {
        Object.assign(app.user, { name: novo.name, email: novo.email });
        A.renderTopBar();
        A.refresh();
      };
      const aoMudarSenha = () => A.refresh();

      const links = SECOES.map(([id, i, label]) => h('a', { class: 'pf-nav-a', href: '#/perfil?sec=' + id, 'data-sec': id }, ico(i, 18), label));
      const marcar = (id) => links.forEach((a) => (a.dataset.sec === id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
      for (const a of links) {
        a.onclick = (e) => {
          e.preventDefault();
          marcar(a.dataset.sec);
          document.getElementById('pf-' + a.dataset.sec).scrollIntoView({ behavior: 'smooth', block: 'start' });
          history.replaceState(null, '', a.getAttribute('href'));
        };
      }

      const secoes = [
        secao('dados', 'user', 'Dados pessoais', 'Nome e contactos usados no painel e nas notificações.', dadosPessoais(p, aoGuardarDados)),
        secao('conta', 'shield', 'Conta e acessos', 'O seu papel, estado e o que pode fazer no painel.', contaAcessos(p)),
        secao('seguranca', 'key', 'Segurança', 'Use uma palavra-passe forte que não utilize noutros sítios.', seguranca(p, aoMudarSenha)),
        secao('atividade', 'activity', 'Atividade', 'Logins, saídas e alterações feitas com esta conta.', atividade(p)),
      ];

      el.append(
        h('div', { class: 'page-head pf-head' }, h('div', {},
          h('h1', {}, 'O Meu Perfil'),
          h('p', { class: 'hint' }, 'Gira os seus dados pessoais, segurança e atividade da conta.'))),
        hero(p),
        h('div', { class: 'pf-layout' },
          h('nav', { class: 'pf-nav', 'aria-label': 'Secções do perfil' }, links),
          h('div', { class: 'pf-main' }, secoes)));

      // Realça na coluna da esquerda a secção que está à vista.
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((ents) => {
          const vis = ents.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          if (vis) marcar(vis.target.id.slice(3));
        }, { rootMargin: '-90px 0px -55% 0px' });
        secoes.forEach((s) => io.observe(s));
        window.addEventListener('hashchange', () => io.disconnect(), { once: true });
      }

      const pedida = params.get('sec');
      marcar(SECOES.some(([id]) => id === pedida) ? pedida : 'dados');
      if (pedida) setTimeout(() => { const alvo = document.getElementById('pf-' + pedida); if (alvo) alvo.scrollIntoView({ block: 'start' }); }, 0);
    },
  };
})();
