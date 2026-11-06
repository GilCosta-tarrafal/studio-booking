/* Painel de gestão: botão de auriculares (canto inferior direito). Ao carregar
   abre dois botões — "Assistente IA", para perguntar algo à IA, e "Chat —
   Agentes", para falar em tempo real com o administrador e com os agentes dos
   outros estúdios. Vale para todos os perfis. O chat recebe as mensagens por
   Server-Sent Events (/api/admin/chat/stream); ver api/routes/chat.js e
   api/routes/assistente.js. */
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
    camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    mic: ['M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
    trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
    play: ['M8 5v14l11-7z'],
    pause: ['M8 5v14', 'M16 5v14'],
    stop: ['M7 7h10v10H7z'],
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
    if (st.pararGravacao) st.pararGravacao(true);   // solta o microfone
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
    if (st.pararGravacao) st.pararGravacao(true);
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
  // Conversas a dois: ao abrir aparece a lista das pessoas da equipa; cada
  // mensagem vai só para a pessoa escolhida. Além de texto, fotografias e
  // mensagens de voz (gravadas aqui, com o microfone).
  const MAX_ANEXO = 8 * 1024 * 1024;
  const MAX_VOZ_S = 5 * 60;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // Leitor das mensagens de voz (em vez do <audio> do browser). O ficheiro vem
  // inteiro por fetch, com a sessão, e toca a partir de uma cópia local: não
  // depende de pedidos parciais nem do que o browser guardou em cache. Serve
  // também para ouvir uma gravação antes de a enviar (blob). As gravações do
  // browser às vezes não dizem quanto duram: aí usa-se a duração guardada.
  function leitorVoz({ url, blob, duracao }) {
    const audio = new Audio();
    let pronto = blob ? Promise.resolve(audio.src = URL.createObjectURL(blob)) : null;
    const carregar = () => pronto || (pronto = fetch(url, { credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
      .then((b) => { audio.src = URL.createObjectURL(b); })
      .catch((e) => { pronto = null; throw e; }));
    const total = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duracao || 0);
    const btn = h('button', { class: 'sup-voz-play', type: 'button', 'aria-label': 'Ouvir' }, ico('play', 18));
    const barra = h('input', { class: 'sup-voz-barra', type: 'range', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'Posição na mensagem de voz' });
    const tempo = h('span', { class: 'sup-voz-tempo' }, mmss(duracao || 0));
    const pintar = () => {
      const t = total();
      barra.value = t ? Math.min(1000, Math.round((audio.currentTime / t) * 1000)) : 0;
      tempo.textContent = mmss(audio.paused && !audio.currentTime ? t : audio.currentTime);
    };
    audio.addEventListener('play', () => { btn.replaceChildren(ico('pause', 18)); btn.setAttribute('aria-label', 'Pausa'); });
    audio.addEventListener('pause', () => { btn.replaceChildren(ico('play', 18)); btn.setAttribute('aria-label', 'Ouvir'); });
    audio.addEventListener('timeupdate', pintar);
    audio.addEventListener('loadedmetadata', pintar);
    audio.addEventListener('ended', () => { audio.currentTime = 0; pintar(); });
    btn.addEventListener('click', async () => {
      if (!audio.paused) { audio.pause(); return; }
      // Só uma mensagem a tocar de cada vez.
      for (const outro of document.querySelectorAll('.sup-voz')) if (outro !== caixa && outro.pausar) outro.pausar();
      btn.disabled = true;
      try { await carregar(); await audio.play(); } catch (_) {
        toast('Não foi possível tocar a mensagem de voz. Verifique o som do computador e tente outra vez.', true);
      } finally { btn.disabled = false; }
    });
    barra.addEventListener('input', async () => {
      try { await carregar(); } catch (_) { return; }
      const t = total();
      if (t) audio.currentTime = (barra.value / 1000) * t;
    });
    const caixa = h('div', { class: 'sup-voz' }, btn, barra, tempo);
    caixa.pausar = () => audio.pause();
    return caixa;
  }
  // O que aparece na lista e nos avisos em vez do conteúdo.
  const previa = (m) => (m.tipo === 'imagem' ? '📷 Fotografia'
    : m.tipo === 'voz' ? '🎤 Mensagem de voz' + (m.duracao ? ` (${mmss(m.duracao)})` : '') : m.body);

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
    return st.lista.contacts.reduce((n, c) => n + c.unread, 0);
  }
  function pintarBadge() {
    const n = totalPorLer();
    st.badge.hidden = !n;
    st.badge.textContent = n > 99 ? '99+' : String(n);
  }

  const conversaDe = (channel) => (st.lista ? st.lista.contacts.find((c) => c.channel === channel) : null);

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
      const p = previa(msg);
      toast(`${msg.user_name}: ${p.length > 70 ? p.slice(0, 70) + '…' : p}`);
    }
    pintarBadge();
    if (st.aberto === 'chat' && !st.conversa) pintarChat();
  }

  // Lista das pessoas (com pesquisa): carregar numa abre a conversa com ela.
  async function pintarChat() {
    st.conversa = null;
    st.pintarCabecalhoConversa = null;
    const corpo = h('div', { class: 'sup-corpo sup-lista' });
    const busca = h('input', { type: 'search', class: 'sup-busca', placeholder: 'Procurar pessoa ou estúdio…', 'aria-label': 'Procurar pessoa', value: st.busca || '' });
    const lista = h('div', { class: 'sup-pessoas' });
    st.painel.replaceChildren(cabecalho('Chat — Agentes', 'Escolha com quem quer falar', null), corpo);
    if (!st.lista) {
      corpo.append(h('p', { class: 'sup-vazio' }, 'A carregar…'));
      try { await carregarLista(); } catch (ex) { corpo.replaceChildren(h('p', { class: 'sup-vazio' }, ex.message)); return; }
      if (st.aberto !== 'chat' || st.conversa) return;
    }
    const linha = (c) => h('button', { class: 'sup-contacto', type: 'button', onclick: () => abrirConversa(c.channel) },
      h('span', { class: 'sup-avatar' + (c.online ? ' online' : '') }, iniciais(c.name)),
      h('span', { class: 'sup-contacto-txt' },
        h('strong', {}, c.name),
        h('span', {}, c.last ? (c.last.user_id === app.user.id ? 'Você: ' : '') + previa(c.last) : papel(c) + (c.online ? ' · ligado' : ''))),
      h('span', { class: 'sup-contacto-meta' },
        c.last && h('time', {}, diaHora(c.last.created_at)),
        c.unread ? h('span', { class: 'sup-n' }, c.unread) : null));
    // Primeiro quem tem mensagens por ler, depois as conversas mais recentes.
    const ordenadas = st.lista.contacts.slice().sort((a, b) => (b.unread - a.unread)
      || String((b.last || {}).created_at || '').localeCompare(String((a.last || {}).created_at || '')));
    const filtrar = () => {
      st.busca = busca.value;
      const q = busca.value.trim().toLowerCase();
      const vis = ordenadas.filter((c) => !q || (c.name + ' ' + c.studio_name + ' ' + papel(c)).toLowerCase().includes(q));
      lista.replaceChildren(...(vis.length ? vis.map(linha)
        : [h('p', { class: 'sup-vazio' }, st.lista.contacts.length ? 'Ninguém com esse nome.' : 'Ainda não há mais ninguém na equipa.')]));
    };
    busca.addEventListener('input', filtrar);
    filtrar();
    corpo.replaceChildren(st.lista.contacts.length > 5 ? busca : null, lista);
  }

  // Envia um ficheiro (fotografia ou gravação) para a conversa.
  async function enviarAnexo(channel, blob, duracao) {
    if (blob.size > MAX_ANEXO) throw new Error('O ficheiro tem mais de 8 MB.');
    const res = await fetch(`/api/admin/chat/${encodeURIComponent(channel)}/anexo` + (duracao ? `?duracao=${Math.round(duracao)}` : ''), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-Requested-With': 'studio' }, body: blob,
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Não foi possível enviar.');
    return d.message;
  }

  async function abrirConversa(channel) {
    const c = conversaDe(channel);
    if (!c) return;
    st.conversa = channel;
    st.mensagens = [];
    const corpo = h('div', { class: 'sup-corpo sup-conversa' });
    const head = h('div');
    st.pintarCabecalhoConversa = () => {
      head.replaceChildren(cabecalho(c.name, papel(c) + (st.online.has(c.id) ? ' · ligado agora' : ' · desligado'), () => { pararGravacao(true); pintarChat(); }));
    };
    st.pintarCabecalhoConversa();
    const conteudo = (m) => {
      if (m.tipo === 'imagem') {
        return h('a', { href: m.url, target: '_blank', rel: 'noopener', title: 'Abrir a fotografia' },
          h('img', { class: 'sup-foto', src: m.url, alt: 'Fotografia', loading: 'lazy', onload: () => { if (st.colado) rolarFim(corpo); } }));
      }
      if (m.tipo === 'voz') return leitorVoz({ url: m.url, duracao: m.duracao });
      return m.body;
    };
    st.pintarMensagens = () => {
      corpo.replaceChildren();
      if (!st.mensagens.length) corpo.append(h('p', { class: 'sup-vazio' }, `Ainda não há mensagens com ${c.name.split(' ')[0]}. Diga olá!`));
      let dia = '';
      for (const m of st.mensagens) {
        const d = new Date(m.created_at).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
        if (d !== dia) { dia = d; corpo.append(h('p', { class: 'sup-dia' }, d)); }
        const minha = m.user_id === app.user.id;
        corpo.append(h('div', { class: 'sup-msg ' + (minha ? 'eu' : 'outro') + (m.tipo && m.tipo !== 'texto' ? ' anexo' : '') },
          h('div', { class: 'sup-bolha' }, conteudo(m), h('time', {}, hora(m.created_at)))));
      }
      st.colado = true;
      rolarFim(corpo);
    };
    const juntar = (msg) => {
      // Normalmente já chegou pela ligação em tempo real; se não, mostra-se aqui.
      if (st.conversa === channel && !st.mensagens.some((m) => m.id === msg.id)) { st.mensagens.push(msg); st.pintarMensagens(); }
    };

    // ---- Caixa de envio: texto, fotografia e voz
    const txt = h('textarea', { rows: 1, maxlength: 2000, placeholder: 'Escreva uma mensagem…', 'aria-label': 'Mensagem' });
    const foto = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
    const btnFoto = h('button', { class: 'sup-icobtn sup-anexar', type: 'button', title: 'Enviar fotografia', 'aria-label': 'Enviar fotografia', onclick: () => foto.click() }, ico('camera', 20));
    const btnVoz = h('button', { class: 'sup-icobtn sup-anexar', type: 'button', title: 'Gravar mensagem de voz', 'aria-label': 'Gravar mensagem de voz' }, ico('mic', 20));
    const btnEnviar = h('button', { class: 'sup-enviar', type: 'submit', 'aria-label': 'Enviar' }, ico('send', 20));
    const form = h('form', { class: 'sup-form' }, btnFoto, btnVoz, txt, btnEnviar, foto);
    const ajustar = () => { txt.style.height = 'auto'; txt.style.height = Math.min(txt.scrollHeight, 120) + 'px'; };
    txt.addEventListener('input', ajustar);
    txt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const v = txt.value.trim();
      if (!v || btnEnviar.disabled) return;
      btnEnviar.disabled = true;
      try {
        const r = await api(`/api/admin/chat/${encodeURIComponent(channel)}/messages`, { method: 'POST', body: { body: v } });
        juntar(r.message);
        txt.value = ''; ajustar();
      } catch (ex) { toast(ex.message, true); } finally { btnEnviar.disabled = false; txt.focus(); }
    };
    foto.addEventListener('change', async () => {
      const f = foto.files[0];
      foto.value = '';
      if (!f) return;
      if (f.size > MAX_ANEXO) { toast('A fotografia tem mais de 8 MB.', true); return; }
      btnFoto.disabled = true;
      try { juntar(await enviarAnexo(channel, f)); } catch (ex) { toast(ex.message, true); } finally { btnFoto.disabled = false; }
    });

    // Gravação de voz: o microfone só funciona em https:// ou em localhost.
    const barraVoz = h('div', { class: 'sup-gravar', hidden: true });
    let gravacao = null;
    // descartar: apaga; ouvir: pára e mostra a gravação para ouvir antes de enviar.
    function pararGravacao(descartar, ouvir) {
      if (!gravacao) return;
      gravacao.descartar = descartar;
      gravacao.ouvir = !!ouvir;
      clearInterval(gravacao.relogio);
      if (gravacao.rec.state !== 'inactive') gravacao.rec.stop();
      gravacao.stream.getTracks().forEach((t) => t.stop());
    }
    st.pararGravacao = pararGravacao;
    btnVoz.addEventListener('click', async () => {
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        toast(window.isSecureContext ? 'Este browser não grava áudio.' : 'Para gravar voz, abra o painel em https:// ou em localhost (o browser só dá o microfone em ligações seguras).', true);
        return;
      }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (_) {
        toast('Não deu autorização para usar o microfone.', true); return;
      }
      const rec = new MediaRecorder(stream);
      const partes = [];
      const inicio = Date.now();
      const tempo = h('strong', {}, '0:00');
      gravacao = { rec, stream, descartar: false };
      rec.ondataavailable = (e) => { if (e.data && e.data.size) partes.push(e.data); };
      rec.onstop = async () => {
        const g = gravacao;
        gravacao = null;
        const fechar = () => { barraVoz.hidden = true; form.hidden = false; };
        if (!g || g.descartar || !partes.length) { fechar(); return; }
        const blob = new Blob(partes, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
        const duracao = (Date.now() - inicio) / 1000;
        const enviar = async (botao) => {
          if (botao) botao.disabled = true;
          try { juntar(await enviarAnexo(channel, blob, duracao)); fechar(); } catch (ex) { toast(ex.message, true); if (botao) botao.disabled = false; }
        };
        if (!g.ouvir) { fechar(); enviar(); return; }
        // Ouvir antes de enviar: o leitor com a gravação, apagar ou enviar.
        const enviarBtn = h('button', { class: 'sup-enviar', type: 'button', title: 'Enviar', 'aria-label': 'Enviar a gravação', onclick: () => enviar(enviarBtn) }, ico('send', 20));
        barraVoz.replaceChildren(
          h('button', { class: 'sup-icobtn', type: 'button', title: 'Apagar', 'aria-label': 'Apagar a gravação', onclick: fechar }, ico('trash', 20)),
          leitorVoz({ blob, duracao }),
          enviarBtn);
      };
      gravacao.relogio = setInterval(() => {
        const s = (Date.now() - inicio) / 1000;
        tempo.textContent = mmss(s);
        if (s >= MAX_VOZ_S) pararGravacao(false);   // no máximo 5 minutos
      }, 250);
      barraVoz.replaceChildren(
        h('span', { class: 'sup-rec', 'aria-hidden': 'true' }),
        h('span', { class: 'sup-gravar-txt' }, 'A gravar… ', tempo),
        h('button', { class: 'sup-icobtn', type: 'button', title: 'Cancelar', 'aria-label': 'Cancelar a gravação', onclick: () => pararGravacao(true) }, ico('trash', 20)),
        h('button', { class: 'sup-icobtn', type: 'button', title: 'Parar e ouvir', 'aria-label': 'Parar e ouvir a gravação antes de enviar', onclick: () => pararGravacao(false, true) }, ico('stop', 20)),
        h('button', { class: 'sup-enviar', type: 'button', title: 'Enviar', 'aria-label': 'Parar e enviar a gravação', onclick: () => pararGravacao(false) }, ico('send', 20)));
      form.hidden = true; barraVoz.hidden = false;
      rec.start();
    });

    st.painel.replaceChildren(head, corpo, form, barraVoz);
    setTimeout(() => txt.focus(), 0);
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
