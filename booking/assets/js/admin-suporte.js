/* Painel de gestão: botão de auriculares (canto inferior direito). Ao carregar
   abre dois botões — "Assistente IA", para perguntar algo à IA, e "Chat —
   Agentes", para falar em tempo real com o administrador e com os agentes dos
   outros estúdios. Vale para todos os perfis. O chat recebe as mensagens por
   Server-Sent Events (/api/admin/chat/stream); ver backend/routes/chat.js e
   backend/routes/assistente.js. */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h } = S;
  const { app, api, toast } = A;

  const SVG = 'http://www.w3.org/2000/svg';
  const ICO = {
    headset: ['M4 14v-2a8 8 0 0 1 16 0v2', 'M4 14h3v6H5a1 1 0 0 1-1-1z', 'M20 14h-3v6h2a1 1 0 0 0 1-1z', 'M17 20a4 4 0 0 1-4 2h-1'],
    robot: ['M5 9h14v10H5z', 'M12 5v4', 'M12 4h.01', 'M9 13h.01', 'M15 13h.01', 'M9.5 16.5h5', 'M3 13v2', 'M21 13v2'],
    chat: ['M4 5h16v11H9l-5 4z'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    back: ['M15 5l-7 7 7 7'],
    send: ['M4 12l16-8-6 16-2-7z', 'M12 13l8-9'],
    users: ['M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 4.5a3.5 3.5 0 0 1 0 6.5', 'M18 14a6 6 0 0 1 3.5 6'],
  };
  function ico(nome, tam = 22) {
    const svg = document.createElementNS(SVG, 'svg');
    for (const [k, v] of Object.entries({
      viewBox: '0 0 24 24', width: tam, height: tam, fill: 'none', stroke: 'currentColor',
      'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
    })) svg.setAttribute(k, v);
    for (const d of ICO[nome] || []) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const diaHora = (iso) => {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString() ? hora(iso)
      : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' }) + ' ' + hora(iso);
  };
  const iniciais = (nome) => String(nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const papel = (c) => (c.role === 'owner' ? 'Administrador' : c.role === 'agent' ? 'Agente · ' + c.studio_name : 'Equipa');

  // Estado do widget. `fonte` é a ligação em tempo real; `aberto` diz que
  // painel está à vista ('ia', 'chat' ou null).
  const st = {
    raiz: null, fonte: null, aberto: null, menu: false,
    ia: [], // histórico do assistente nesta sessão: [{ role, content }]
    lista: null, online: new Set(), conversa: null, mensagens: [],
  };

  // ============================================================ Estrutura
  function iniciar() {
    parar();
    const badge = h('span', { class: 'sup-badge', hidden: true });
    const fab = h('button', { class: 'sup-fab', type: 'button', 'aria-label': 'Ajuda e conversas', 'aria-expanded': 'false', title: 'Ajuda e conversas' },
      ico('headset', 26), badge);
    const opcoes = h('div', { class: 'sup-opcoes', hidden: true },
      opcao('Assistente IA', 'robot', () => abrir('ia')),
      opcao('Chat — Agentes', 'chat', () => abrir('chat')));
    const painel = h('section', { class: 'sup-painel', hidden: true, 'aria-live': 'polite' });
    fab.onclick = () => (st.aberto ? fechar() : alternarMenu());
    st.raiz = h('div', { class: 'sup' }, painel, opcoes, fab);
    st.badge = badge; st.fab = fab; st.opcoes = opcoes; st.painel = painel;
    document.body.appendChild(st.raiz);
    document.addEventListener('keydown', onKey);
    ligar();
    carregarLista().catch(() => { /* tenta quando abrir */ });
  }

  function parar() {
    if (st.fonte) st.fonte.close();
    if (st.raiz) st.raiz.remove();
    document.removeEventListener('keydown', onKey);
    Object.assign(st, { raiz: null, fonte: null, aberto: null, menu: false, ia: [], lista: null, online: new Set(), conversa: null, mensagens: [] });
  }

  function opcao(texto, icone, acao) {
    return h('div', { class: 'sup-opcao' },
      h('button', { class: 'sup-opcao-txt', type: 'button', onclick: acao, tabindex: '-1' }, texto),
      h('button', { class: 'sup-mini', type: 'button', onclick: acao, 'aria-label': texto }, ico(icone, 22)));
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (st.aberto) fechar(); else if (st.menu) alternarMenu(false);
  }

  function alternarMenu(forcar) {
    st.menu = forcar === undefined ? !st.menu : forcar;
    st.opcoes.hidden = !st.menu;
    st.fab.classList.toggle('on', st.menu);
    st.fab.setAttribute('aria-expanded', String(st.menu));
    st.fab.replaceChildren(ico(st.menu ? 'close' : 'headset', 26), st.badge);
    if (st.menu) st.opcoes.querySelector('.sup-mini').focus();
  }

  function abrir(qual) {
    alternarMenu(false);
    st.aberto = qual;
    st.painel.hidden = false;
    st.fab.classList.add('on');
    st.fab.replaceChildren(ico('close', 26), st.badge);
    st.fab.setAttribute('aria-label', 'Fechar');
    if (qual === 'ia') pintarIA(); else pintarChat();
  }

  function fechar() {
    st.aberto = null;
    st.conversa = null;
    st.painel.hidden = true;
    st.painel.replaceChildren();
    st.fab.classList.remove('on');
    st.fab.replaceChildren(ico('headset', 26), st.badge);
    st.fab.setAttribute('aria-label', 'Ajuda e conversas');
  }

  function cabecalho(titulo, sub, voltar) {
    return h('header', { class: 'sup-head' },
      voltar && h('button', { class: 'sup-icobtn', type: 'button', onclick: voltar, 'aria-label': 'Voltar' }, ico('back', 20)),
      h('div', { class: 'sup-head-txt' }, h('strong', {}, titulo), sub && h('span', {}, sub)),
      h('button', { class: 'sup-icobtn', type: 'button', onclick: fechar, 'aria-label': 'Fechar' }, ico('close', 20)));
  }

  // Caixa de escrever: Enter envia, Shift+Enter muda de linha.
  function caixaEnvio(placeholder, enviar) {
    const txt = h('textarea', { rows: 1, maxlength: 2000, placeholder, 'aria-label': placeholder });
    const btn = h('button', { class: 'sup-enviar', type: 'submit', 'aria-label': 'Enviar' }, ico('send', 20));
    const form = h('form', { class: 'sup-form' }, txt, btn);
    const ajustar = () => { txt.style.height = 'auto'; txt.style.height = Math.min(txt.scrollHeight, 120) + 'px'; };
    txt.addEventListener('input', ajustar);
    txt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const v = txt.value.trim();
      if (!v || btn.disabled) return;
      btn.disabled = true;
      try { if (await enviar(v) !== false) { txt.value = ''; ajustar(); } } finally { btn.disabled = false; txt.focus(); }
    };
    setTimeout(() => txt.focus(), 0);
    return form;
  }

  const rolarFim = (el) => { el.scrollTop = el.scrollHeight; };

  // ============================================================ Assistente IA
  function pintarIA() {
    const corpo = h('div', { class: 'sup-corpo' });
    const desenhar = () => {
      corpo.replaceChildren();
      if (!st.ia.length) {
        corpo.append(h('div', { class: 'sup-vazio' },
          h('p', {}, 'Olá, ' + app.user.name.split(' ')[0] + '! Pergunte o que precisar sobre o painel ou sobre a agenda'
            + (app.user.studio_id ? ' do seu estúdio.' : ' dos estúdios.')),
          h('div', { class: 'sup-sugestoes' },
            ['O que tenho marcado hoje?', 'Há pedidos por confirmar?', 'Como bloqueio um horário?'].map((q) =>
              h('button', { class: 'sup-chip', type: 'button', onclick: () => perguntar(q) }, q)))));
      }
      for (const m of st.ia) {
        corpo.append(h('div', { class: 'sup-msg ' + (m.role === 'user' ? 'eu' : 'ia') + (m.erro ? ' erro' : '') },
          h('div', { class: 'sup-bolha' }, m.content)));
      }
      if (st.iaPensa) corpo.append(h('div', { class: 'sup-msg ia' }, h('div', { class: 'sup-bolha sup-pensa' }, h('i'), h('i'), h('i'))));
      rolarFim(corpo);
    };
    async function perguntar(q) {
      if (st.iaPensa) return false;
      st.ia.push({ role: 'user', content: q });
      st.iaPensa = true;
      desenhar();
      try {
        const historico = st.ia.filter((m) => !m.erro).map(({ role, content }) => ({ role, content }));
        const r = await api('/api/admin/assistente', { method: 'POST', body: { messages: historico } });
        st.ia.push({ role: 'assistant', content: r.reply });
      } catch (ex) {
        st.ia.push({ role: 'assistant', content: ex.message, erro: true });
      } finally {
        st.iaPensa = false;
        if (st.aberto === 'ia') desenhar();
      }
      return true;
    }
    st.painel.replaceChildren(
      cabecalho('Assistente IA', 'Responde com os dados que pode ver', null),
      corpo,
      caixaEnvio('Escreva a sua pergunta…', perguntar));
    desenhar();
  }

  // ============================================================ Chat da equipa
  function ligar() {
    if (!window.EventSource) return;
    const fonte = new EventSource('/api/admin/chat/stream');
    st.fonte = fonte;
    fonte.addEventListener('presenca', (e) => {
      st.online = new Set(JSON.parse(e.data).online);
      if (st.lista) for (const c of st.lista.contacts) c.online = st.online.has(c.id);
      if (st.aberto === 'chat' && !st.conversa) pintarChat();
      if (st.conversa && st.pintarCabecalhoConversa) st.pintarCabecalhoConversa();
    });
    fonte.addEventListener('mensagem', (e) => receber(JSON.parse(e.data)));
  }

  async function carregarLista() {
    st.lista = await api('/api/admin/chat');
    for (const c of st.lista.contacts) if (st.online.size) c.online = st.online.has(c.id);
    pintarBadge();
    return st.lista;
  }

  function totalPorLer() {
    if (!st.lista) return 0;
    return st.lista.geral.unread + st.lista.contacts.reduce((n, c) => n + c.unread, 0);
  }
  function pintarBadge() {
    const n = totalPorLer();
    st.badge.hidden = !n;
    st.badge.textContent = n > 99 ? '99+' : String(n);
  }

  function conversaDe(channel) {
    if (!st.lista) return null;
    return channel === 'geral' ? st.lista.geral : st.lista.contacts.find((c) => c.channel === channel);
  }

  function receber(msg) {
    const c = conversaDe(msg.channel);
    const minha = msg.user_id === app.user.id;
    if (!c) { carregarLista().catch(() => {}); return; }
    c.last = msg;
    if (st.aberto === 'chat' && st.conversa === msg.channel) {
      if (!st.mensagens.some((m) => m.id === msg.id)) { st.mensagens.push(msg); st.pintarMensagens(); }
      if (!minha) api(`/api/admin/chat/${encodeURIComponent(msg.channel)}/read`, { method: 'POST' }).catch(() => {});
    } else if (!minha) {
      c.unread += 1;
      toast(`${msg.user_name}: ${msg.body.length > 70 ? msg.body.slice(0, 70) + '…' : msg.body}`);
    }
    pintarBadge();
    if (st.aberto === 'chat' && !st.conversa) pintarChat();
  }

  async function pintarChat() {
    st.conversa = null;
    st.pintarCabecalhoConversa = null;
    const corpo = h('div', { class: 'sup-corpo sup-lista' });
    st.painel.replaceChildren(cabecalho('Chat — Agentes', 'Administrador e agentes dos estúdios', null), corpo);
    if (!st.lista) {
      corpo.append(h('p', { class: 'sup-vazio' }, 'A carregar…'));
      try { await carregarLista(); } catch (ex) { corpo.replaceChildren(h('p', { class: 'sup-vazio' }, ex.message)); return; }
      if (st.aberto !== 'chat' || st.conversa) return;
    }
    const linha = (c, titulo, sub, avatar, online) => h('button', { class: 'sup-contacto', type: 'button', onclick: () => abrirConversa(c.channel) },
      h('span', { class: 'sup-avatar' + (online ? ' online' : '') }, avatar),
      h('span', { class: 'sup-contacto-txt' },
        h('strong', {}, titulo),
        h('span', {}, c.last ? (c.last.user_id === app.user.id ? 'Você: ' : (c.channel === 'geral' ? c.last.user_name.split(' ')[0] + ': ' : '')) + c.last.body : sub)),
      h('span', { class: 'sup-contacto-meta' },
        c.last && h('time', {}, diaHora(c.last.created_at)),
        c.unread ? h('span', { class: 'sup-n' }, c.unread) : null));
    corpo.replaceChildren(
      linha(st.lista.geral, 'Geral', 'Toda a equipa', ico('users', 20), false),
      h('p', { class: 'sup-sec' }, 'Pessoas'),
      st.lista.contacts.length
        ? st.lista.contacts.map((c) => linha(c, c.name, papel(c) + (c.online ? ' · ligado' : ''), iniciais(c.name), c.online))
        : h('p', { class: 'sup-vazio' }, 'Ainda não há mais ninguém na equipa.'));
  }

  async function abrirConversa(channel) {
    const c = conversaDe(channel);
    if (!c) return;
    st.conversa = channel;
    st.mensagens = [];
    const corpo = h('div', { class: 'sup-corpo sup-conversa' });
    const titulo = channel === 'geral' ? 'Geral' : c.name;
    const head = h('div');
    st.pintarCabecalhoConversa = () => {
      const sub = channel === 'geral' ? 'Toda a equipa' : papel(c) + (st.online.has(c.id) ? ' · ligado agora' : ' · desligado');
      head.replaceChildren(cabecalho(titulo, sub, () => pintarChat()));
    };
    st.pintarCabecalhoConversa();
    st.pintarMensagens = () => {
      corpo.replaceChildren();
      if (!st.mensagens.length) corpo.append(h('p', { class: 'sup-vazio' }, 'Ainda não há mensagens. Diga olá!'));
      let dia = '';
      for (const m of st.mensagens) {
        const d = new Date(m.created_at).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
        if (d !== dia) { dia = d; corpo.append(h('p', { class: 'sup-dia' }, d)); }
        const minha = m.user_id === app.user.id;
        corpo.append(h('div', { class: 'sup-msg ' + (minha ? 'eu' : 'outro') },
          !minha && channel === 'geral' && h('span', { class: 'sup-autor' }, m.user_name),
          h('div', { class: 'sup-bolha' }, m.body, h('time', {}, hora(m.created_at)))));
      }
      rolarFim(corpo);
    };
    const enviar = async (texto) => {
      try {
        const r = await api(`/api/admin/chat/${encodeURIComponent(channel)}/messages`, { method: 'POST', body: { body: texto } });
        // Normalmente já chegou pela ligação em tempo real; se não, mostra-se aqui.
        if (st.conversa === channel && !st.mensagens.some((m) => m.id === r.message.id)) { st.mensagens.push(r.message); st.pintarMensagens(); }
        return true;
      } catch (ex) { toast(ex.message, true); return false; }
    };
    st.painel.replaceChildren(head, corpo, caixaEnvio('Escreva uma mensagem…', enviar));
    corpo.append(h('p', { class: 'sup-vazio' }, 'A carregar…'));
    try {
      const r = await api(`/api/admin/chat/${encodeURIComponent(channel)}/messages`);
      if (st.conversa !== channel) return;
      st.mensagens = r.messages;
      st.pintarMensagens();
      await api(`/api/admin/chat/${encodeURIComponent(channel)}/read`, { method: 'POST' });
      c.unread = 0;
      pintarBadge();
    } catch (ex) { corpo.replaceChildren(h('p', { class: 'sup-vazio' }, ex.message)); }
  }

  window.AdminSuporte = { iniciar, parar };
})();
