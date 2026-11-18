/* Painel de gestão: pílula "Mensagens" (canto inferior direito), com o número
   por ler e as fotografias de quem escreveu. Ao carregar abre logo o chat da
   equipa, para falar em tempo real com o administrador e com os agentes dos
   outros estúdios. Vale para todos os perfis. O chat recebe as mensagens por
   Server-Sent Events (/api/admin/chat/stream); ver api/routes/chat.js. */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h } = S;
  const { app, api, toast } = A;

  const SVG = 'http://www.w3.org/2000/svg';
  const ICO = {
    chat: ['M4 5h16v11H9l-5 4z'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    back: ['M15 5l-7 7 7 7'],
    send: ['M4 12l16-8-6 16-2-7z', 'M12 13l8-9'],
    camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    clip: ['M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3l7.5-7.5'],
    doc: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 12h6', 'M9 16h6'],
    musica: ['M9 18V5l11-2v13', 'M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3z', 'M20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z'],
    baixar: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
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
  const papel = (c) => (c.role === 'owner' ? 'Administrador' : c.role === 'agent' ? 'Agente · ' + c.studio_name : 'Equipa');

  // Estado do widget. `fonte` é a ligação em tempo real; `aberto` diz se o
  // chat está à vista ('chat' ou null).
  const st = {
    raiz: null, fonte: null, aberto: null,
    lista: null, online: new Set(), conversa: null, mensagens: [],
  };

  // ============================================================ Estrutura
  function iniciar() {
    parar();
    const badge = h('span', { class: 'sup-badge', hidden: true });
    const fab = h('button', { class: 'sup-fab', type: 'button', 'aria-expanded': 'false', title: 'Mensagens' });
    const painel = h('section', { class: 'sup-painel', hidden: true, 'aria-live': 'polite' });
    fab.onclick = () => (st.aberto ? fechar() : abrir());
    st.raiz = h('div', { class: 'sup' }, painel, fab);
    st.badge = badge; st.fab = fab; st.painel = painel;
    pintarFab();
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
    Object.assign(st, { raiz: null, fonte: null, aberto: null, lista: null, online: new Set(), conversa: null, mensagens: [] });
  }

  function onKey(e) {
    if (e.key === 'Escape' && st.aberto) fechar();
  }

  function abrir() {
    st.aberto = 'chat';
    st.painel.hidden = false;
    st.fab.classList.add('on');
    st.fab.setAttribute('aria-expanded', 'true');
    pintarFab();
    pintarChat();
  }

  function fechar() {
    if (st.pararGravacao) st.pararGravacao(true);
    st.aberto = null;
    st.conversa = null;
    st.painel.hidden = true;
    st.painel.replaceChildren();
    st.fab.classList.remove('on');
    st.fab.setAttribute('aria-expanded', 'false');
    pintarFab();
    st.fab.focus();   // o foco volta ao botão que abriu o chat
  }

  // O botão é uma pílula "Mensagens": o ícone com o número por ler e, à
  // direita, as fotografias de quem mandou mensagem (as mais recentes à frente,
  // até três). Com o chat aberto esconde-se: fecha-se pelo ✕ do cabeçalho.
  function pintarFab() {
    const n = totalPorLer();
    st.badge.hidden = !n;
    st.badge.textContent = n > 99 ? '99+' : String(n);
    st.fab.hidden = !!st.aberto;
    const quando = (c) => String((c.last || {}).created_at || '');
    const quem = !st.lista ? []
      : st.lista.contacts.filter((c) => c.unread).sort((a, b) => quando(b).localeCompare(quando(a))).slice(0, 3);
    // (replaceChildren escreveria um null como o texto "null": só o que existe.)
    st.fab.replaceChildren(...[
      h('span', { class: 'sup-fab-ico' }, ico('chat', 24), st.badge),
      h('span', { class: 'sup-fab-txt' }, 'Mensagens'),
      quem.length && h('span', { class: 'sup-fab-avs', 'aria-hidden': 'true' }, quem.map((c) => A.avatar(c, 'sup-fab-av'))),
    ].filter(Boolean));
    st.fab.setAttribute('aria-label', n ? `Mensagens: ${n} por ler, de ${quem.map((c) => c.name).join(', ')}` : 'Mensagens');
  }

  function cabecalho(titulo, sub, voltar) {
    return h('header', { class: 'sup-head' },
      voltar && h('button', { class: 'sup-icobtn', type: 'button', onclick: voltar, 'aria-label': 'Voltar' }, ico('back', 20)),
      h('div', { class: 'sup-head-txt' }, h('strong', {}, titulo), sub && h('span', {}, sub)),
      h('button', { class: 'sup-icobtn', type: 'button', onclick: fechar, 'aria-label': 'Fechar' }, ico('close', 20)));
  }

  const rolarFim = (el) => { el.scrollTop = el.scrollHeight; };

  // ============================================================ Chat da equipa
  // Conversas a dois: ao abrir aparece a lista das pessoas da equipa; cada
  // mensagem vai só para a pessoa escolhida. Além de texto, fotografias e
  // mensagens de voz (gravadas aqui, com o microfone), documentos e ficheiros
  // de áudio (pelo clipe).
  const MAX_ANEXO = 20 * 1024 * 1024;
  const ACEITA_FICHEIRO = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv,.zip,audio/*,.mp3,.wav,.m4a,.ogg,.flac';
  const tamanho = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  // Quanto dura um ficheiro de áudio (lido pelo browser); 0 se não souber.
  const duracaoDe = (f) => new Promise((ok) => {
    const a = new Audio();
    const fim = (s) => { URL.revokeObjectURL(a.src); ok(Number.isFinite(s) ? s : 0); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => fim(a.duration);
    a.onerror = () => fim(0);
    setTimeout(() => fim(0), 4000);
    a.src = URL.createObjectURL(f);
  });
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
    : m.tipo === 'voz' ? '🎤 Mensagem de voz' + (m.duracao ? ` (${mmss(m.duracao)})` : '')
      : m.tipo === 'documento' ? '📄 ' + m.nome
        : m.tipo === 'audio' ? '🎵 ' + m.nome : m.body);

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
  const pintarBadge = () => pintarFab();

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
      A.avatar(c, 'sup-avatar' + (c.online ? ' online' : '')),
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
    corpo.replaceChildren(...(st.lista.contacts.length > 5 ? [busca, lista] : [lista]));
  }

  // Envia um ficheiro (fotografia, gravação, documento ou áudio) para a
  // conversa. `nome`: o nome original de um ficheiro escolhido no computador.
  async function enviarAnexo(channel, blob, duracao, nome) {
    if (blob.size > MAX_ANEXO) throw new Error('O ficheiro tem mais de 20 MB.');
    const q = new URLSearchParams();
    if (duracao) q.set('duracao', Math.round(duracao));
    if (nome) q.set('nome', nome);
    const res = await fetch(`/api/admin/chat/${encodeURIComponent(channel)}/anexo` + (q.toString() ? '?' + q : ''), {
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
      if (m.tipo === 'audio') {
        return h('div', { class: 'sup-audio' },
          h('span', { class: 'sup-audio-nome', title: m.nome }, ico('musica', 16), h('span', {}, m.nome)),
          leitorVoz({ url: m.url, duracao: m.duracao }));
      }
      if (m.tipo === 'documento') {
        // O PDF abre num separador; os outros descarregam-se com o nome original.
        const pdf = m.mime === 'application/pdf';
        return h('a', { class: 'sup-doc', href: m.url, target: '_blank', rel: 'noopener', download: pdf ? null : m.nome, title: pdf ? 'Abrir' : 'Descarregar' },
          h('span', { class: 'sup-doc-ico' }, ico('doc', 22)),
          h('span', { class: 'sup-doc-txt' }, h('strong', {}, m.nome), h('small', {}, (m.nome.split('.').pop() || '').toUpperCase() + (m.tamanho ? ' · ' + tamanho(m.tamanho) : ''))),
          h('span', { class: 'sup-doc-baixar', 'aria-hidden': 'true' }, ico('baixar', 18)));
      }
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

    // ---- Caixa de envio: texto, documento ou áudio, fotografia e voz
    const txt = h('textarea', { rows: 1, maxlength: 2000, placeholder: 'Escreva uma mensagem…', 'aria-label': 'Mensagem' });
    const ficheiro = h('input', { type: 'file', accept: ACEITA_FICHEIRO, hidden: true });
    const foto = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true });
    const btnFicheiro = h('button', { class: 'sup-icobtn sup-anexar', type: 'button', title: 'Anexar documento ou áudio', 'aria-label': 'Anexar documento ou áudio', onclick: () => ficheiro.click() }, ico('clip', 20));
    const btnFoto = h('button', { class: 'sup-icobtn sup-anexar', type: 'button', title: 'Enviar fotografia', 'aria-label': 'Enviar fotografia', onclick: () => foto.click() }, ico('camera', 20));
    const btnVoz = h('button', { class: 'sup-icobtn sup-anexar', type: 'button', title: 'Gravar mensagem de voz', 'aria-label': 'Gravar mensagem de voz' }, ico('mic', 20));
    const btnEnviar = h('button', { class: 'sup-enviar', type: 'submit', 'aria-label': 'Enviar' }, ico('send', 20));
    const form = h('form', { class: 'sup-form' }, btnFicheiro, btnFoto, btnVoz, txt, btnEnviar, ficheiro, foto);
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
      if (f.size > MAX_ANEXO) { toast('A fotografia tem mais de 20 MB.', true); return; }
      btnFoto.disabled = true;
      try { juntar(await enviarAnexo(channel, f)); } catch (ex) { toast(ex.message, true); } finally { btnFoto.disabled = false; }
    });
    // Documento ou ficheiro de áudio: vai com o nome original (e, no áudio, a duração).
    ficheiro.addEventListener('change', async () => {
      const f = ficheiro.files[0];
      ficheiro.value = '';
      if (!f) return;
      if (f.size > MAX_ANEXO) { toast(`${f.name} tem mais de 20 MB.`, true); return; }
      btnFicheiro.disabled = true;
      toast(`A enviar ${f.name}…`);
      try {
        const duracao = /^audio\//.test(f.type) ? await duracaoDe(f) : 0;
        juntar(await enviarAnexo(channel, f, duracao, f.name));
      } catch (ex) { toast(ex.message, true); } finally { btnFicheiro.disabled = false; }
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
