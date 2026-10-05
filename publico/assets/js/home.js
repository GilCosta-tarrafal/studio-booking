(function () {
  'use strict';
  const { h, api, t, tr, trTexto, fmtDate, renderStrip, icone, fundoServico, renderRodape } = window.Studio;

  // Guardado para poder voltar a desenhar quando a língua muda, sem ter de ir
  // outra vez ao servidor buscar os mesmos dados.
  const ultimo = { quadro: null, cfg: null };

  function renderBoard(d) {
    const box = document.getElementById('board');
    ultimo.quadro = d;
    document.getElementById('board-date').textContent = fmtDate(d.date);
    box.replaceChildren();
    if (!d.rows.length) {
      box.append(h('p', { class: 'board-empty' }, t('quadro.vazio')));
      return;
    }
    for (const r of d.rows) {
      const strip = r.closed
        ? renderStrip({ open: 540, close: 1260, closed: true })
        : renderStrip({ open: r.open, close: r.close, busy: r.busy, now: d.now });
      box.append(h('a', { class: 'board-row', href: `/marcar?room=${r.room_id}&date=${d.date}` },
        h('div', { class: 'board-row-head' },
          h('strong', {}, tr(r, 'studio_name')),
          h('span', {}, r.closed ? t('quadro.fechadaHoje', { sala: tr(r, 'room_name') }) : tr(r, 'room_name'))),
        strip));
    }
  }

  function renderServices(cfg) {
    if (!cfg.services.length) return;
    document.getElementById('servicos').hidden = false;
    const ul = document.getElementById('services');
    ul.replaceChildren(...cfg.services.map((s) => h('li', { class: 'surge' },
      fundoServico(s.name, 64),
      h('strong', {}, tr(s, 'name')),
      h('span', { class: 'modo ' + (s.remote_ok ? 'remoto' : 'presencial') },
        t(s.remote_ok ? 'servicos.distancia' : 'servicos.presencial')),
      tr(s, 'description') && h('span', {}, tr(s, 'description')))));
  }

  const movimentoOk = typeof window.matchMedia !== 'function'
    || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Faz os elementos surgirem quando entram no ecrã, um a seguir ao outro.
  // Sem IntersectionObserver (ou com movimento reduzido) aparecem logo.
  function surgirAoDescer(elementos, aoMostrar) {
    const mostrar = (el) => { el.classList.add('visivel'); if (aoMostrar) aoMostrar(el); };
    if (!movimentoOk || !window.IntersectionObserver) { elementos.forEach(mostrar); return; }
    const observador = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        mostrar(e.target);
        observador.unobserve(e.target);
      }
    }, { threshold: 0.2, rootMargin: '0px 0px -40px 0px' });
    elementos.forEach((el, i) => {
      el.style.transitionDelay = Math.min(i * 90, 450) + 'ms';
      observador.observe(el);
    });
  }

  // Sobe de zero até ao número certo, travando no fim.
  function contarAte(el, alvo) {
    const escrever = (n) => { el.textContent = n.toLocaleString(window.Studio.I18N.locale); };
    // Reservar a largura do número final: sem isto a palavra "streams" saltava
    // para a direita a cada dígito ganho durante a contagem. Mede-se a largura
    // real em vez de a estimar em "ch", porque os separadores de milhar são
    // mais estreitos do que os algarismos e sobrava folga.
    escrever(alvo);
    el.style.minWidth = el.offsetWidth + 'px';
    if (!movimentoOk) { escrever(alvo); return; }
    const duracao = 2800;
    let inicio = 0;
    const passo = (agora) => {
      if (!inicio) inicio = agora;
      const p = Math.min(1, (agora - inicio) / duracao);
      escrever(Math.round(alvo * (1 - Math.pow(1 - p, 2))));
      if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  // ---------------------------------------------------------- Novidades
  // Slide de lançamentos (dados em /js/novidades.js). Um lançamento com data
  // futura mostra contagem decrescente e muda sozinho quando o dia chega.
  const DIA = 864e5;
  let carrossel = null;   // preenchido quando o slide arranca (ver renderNovidades)
  const quando = (n) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(n.data || '') ? n.data + 'T00:00' : n.data);
  const dataLonga = (d) => d.toLocaleDateString(window.Studio.I18N.locale, { day: 'numeric', month: 'long', year: 'numeric' });

  function contagem(alvo) {
    const falta = Math.max(0, alvo - Date.now());
    const partes = [
      [Math.floor(falta / DIA), t('contagem.dias')],
      [Math.floor((falta % DIA) / 36e5), t('contagem.horas')],
      [Math.floor((falta % 36e5) / 6e4), t('contagem.min')],
      [Math.floor((falta % 6e4) / 1e3), t('contagem.seg')],
    ];
    return partes.map(([n, r]) => h('span', { class: 'promo-bloco' },
      h('b', {}, String(n).padStart(2, '0')), h('small', {}, r)));
  }

  function slideNovidade(n, i, total) {
    const d = n.data ? quando(n) : null;
    const valida = d && !isNaN(d);
    const futuro = valida && d > Date.now();
    const recente = valida && !futuro && Date.now() - d < 60 * DIA;
    const etiqueta = t(futuro ? 'novidades.breve' : recente ? 'novidades.novo' : 'novidades.lancamento');

    const relogio = futuro ? h('div', { class: 'promo-contagem', 'data-alvo': d.getTime() }, contagem(d.getTime())) : null;
    const linhaData = valida && h('p', { class: 'promo-data' },
      t(futuro ? 'novidades.saiA' : 'novidades.desde', { data: dataLonga(d) }));
    // Sem "botao" escrito, o rótulo segue o sítio para onde o link vai —
    // não faz sentido "Ouvir no Spotify" num link do Instagram.
    const sitio = /instagram\.com/.test(n.link || '') ? 'instagram'
      : /youtu(\.be|be\.com)/.test(n.link || '') ? 'youtube' : 'spotify';
    const rotulo = { instagram: t('novidades.instagram'), youtube: t('novidades.youtube'),
      spotify: t(futuro ? 'novidades.guardar' : 'novidades.ouvir') }[sitio];
    const botao = n.link && h('a', { class: 'btn btn-amber', href: n.link, target: '_blank', rel: 'noopener' },
      trTexto(n.botao) || rotulo);

    return h('li', { class: 'promo-slide', 'aria-roledescription': 'slide', 'aria-label': t('novidades.slide', { i: i + 1, n: total }) },
      h('img', { class: 'promo-fundo', src: n.capa, alt: '', 'aria-hidden': 'true' }),
      h('div', { class: 'promo-miolo' },
        h('img', {
          class: 'promo-capa' + (n.formato === 'video' ? ' video' : ''), src: n.capa,
          alt: t(n.formato === 'video' ? 'novidades.altVideo' : 'novidades.altCapa', { titulo: n.titulo }), loading: i ? 'lazy' : 'eager',
        }),
        h('div', { class: 'promo-texto' },
          h('span', { class: 'promo-etiqueta' + (futuro ? ' em-breve' : '') }, etiqueta),
          h('h3', {}, n.titulo),
          n.artista && h('p', { class: 'promo-artista' }, n.artista),
          trTexto(n.texto) && h('p', { class: 'promo-desc' }, trTexto(n.texto)),
          linhaData, relogio, botao)));
  }

  function renderNovidades() {
    const seccao = document.getElementById('novidades');
    const pista = document.getElementById('novidades-pista');
    const dados = (Array.isArray(window.NOVIDADES) ? window.NOVIDADES : []).filter((n) => n && n.titulo && n.capa);
    if (!seccao || !pista || !dados.length) return;

    // Numa segunda passagem (a língua mudou) só se redesenham os slides: os
    // relógios e o temporizador já estão a correr e duplicá-los punha o
    // carrossel a saltar duas vezes por vez.
    if (carrossel) { carrossel.desenhar(); carrossel.repor(); return; }

    const desenhar = () => pista.replaceChildren(...dados.map((n, i) => slideNovidade(n, i, dados.length)));
    desenhar();
    seccao.hidden = false;

    let atual = 0;
    const total = dados.length;
    function irPara(i) {
      atual = (i + total) % total;
      pista.style.transform = 'translateX(' + (-100 * atual) + '%)';
      [...pista.children].forEach((s, k) => { s.inert = k !== atual; s.setAttribute('aria-hidden', String(k !== atual)); });
    }
    carrossel = { desenhar, repor: () => irPara(atual) };

    // Relógios: um tique por segundo; ao chegar a zero, o slide passa a "disponível".
    if (pista.querySelector('.promo-contagem')) {
      const tique = setInterval(() => {
        const relogios = pista.querySelectorAll('.promo-contagem');
        if (!relogios.length) { clearInterval(tique); return; }
        for (const r of relogios) {
          const alvo = Number(r.dataset.alvo);
          if (alvo <= Date.now()) { desenhar(); irPara(atual); return; }
          r.replaceChildren(...contagem(alvo));
        }
      }, 1000);
    }

    // Com mais de uma novidade, passam sozinhas. Sem setas nem pontos, esta é a
    // forma de as ver todas — por isso corre mesmo com "menos movimento": aí a
    // troca é instantânea (o CSS tira a transição), em vez de deslizar.
    if (total < 2) return;
    irPara(0);

    // Pára com o rato ou o foco em cima (dá tempo de ler e de carregar no
    // botão) e com o separador escondido.
    const zona = seccao.querySelector('.promo');
    let temporizador = 0, porCima = false;
    const podeCorrer = () => !porCima && !document.hidden;
    function reiniciar() {
      clearInterval(temporizador);
      if (podeCorrer()) temporizador = setInterval(() => irPara(atual + 1), 5000);
    }
    zona.addEventListener('mouseenter', () => { porCima = true; reiniciar(); });
    zona.addEventListener('mouseleave', () => { porCima = false; reiniciar(); });
    zona.addEventListener('focusin', () => { porCima = true; reiniciar(); });
    zona.addEventListener('focusout', () => { porCima = false; reiniciar(); });
    document.addEventListener('visibilitychange', reiniciar);

    // Deslizar o dedo muda de novidade
    let inicioX = null;
    pista.addEventListener('pointerdown', (e) => { inicioX = e.clientX; });
    pista.addEventListener('pointerup', (e) => {
      if (inicioX === null) return;
      const dx = e.clientX - inicioX; inicioX = null;
      if (Math.abs(dx) > 50) { irPara(atual + (dx < 0 ? 1 : -1)); reiniciar(); }
    });

    reiniciar();
  }

  // Carrossel dos singles. A lista vem de /js/singles.js; sem ela a secção
  // fica escondida e o degradê da página fecha o buraco (ver site.css).
  function renderDestaques(animar = true) {
    const lista = document.getElementById('destaques-lista');
    const seccao = document.getElementById('destaques');
    const dados = Array.isArray(window.SINGLES) ? window.SINGLES.filter((s) => s && s.capa) : [];
    if (!lista || !seccao || !dados.length) return;

    lista.replaceChildren(...dados.map((s) => {
      // A capa fica limpa: o nome vai por baixo, como nas aplicações de música.
      const capa = h('span', { class: 'single-capa' },
        h('img', { src: s.capa, alt: s.titulo ? t('novidades.altCapa', { titulo: s.titulo }) : '', loading: 'lazy', decoding: 'async' }));
      const streams = Number(s.streams) > 0
        ? h('span', { class: 'single-streams', title: t('singles.reproducoesTitulo') },
          '+', h('b', { 'data-alvo': s.streams }, '0'),
          icone('play', 15),
          h('span', { class: 'sr-only' }, t('singles.reproducoes')))
        : null;
      const texto = h('span', { class: 'single-texto' },
        h('strong', {}, s.titulo || ''),
        trTexto(s.descricao) && h('span', {}, trTexto(s.descricao)),
        streams);
      const miolo = s.link
        ? h('a', { href: s.link, target: '_blank', rel: 'noopener' }, capa, texto)
        : h('div', {}, capa, texto);
      return h('li', { class: 'single surge' }, miolo);
    }));
    seccao.hidden = false;

    // Numa segunda passagem (a língua mudou) os cartões já foram vistos: se
    // voltassem a entrar de baixo, a página parecia estar a carregar de novo.
    if (!animar) {
      for (const el of seccao.querySelectorAll('.surge')) el.classList.add('visivel');
      for (const n of lista.querySelectorAll('.single-streams b')) {
        n.textContent = Number(n.dataset.alvo).toLocaleString(window.Studio.I18N.locale);
      }
      return;
    }

    // A contagem arranca quando o cartão aparece, não ao carregar a página:
    // de outro modo passava despercebida a quem chega a meio da página.
    surgirAoDescer([...lista.querySelectorAll('.single')], (cartao) => {
      const n = cartao.querySelector('.single-streams b');
      if (n) contarAte(n, Number(n.dataset.alvo));
    });
    surgirAoDescer([...seccao.querySelectorAll('.destaques-topo > *')]);

  }

  // ---------------------------------------------------------- Da plataforma
  // Os lançamentos que chegam das plataformas (ver /integracoes) juntam-se aos
  // que estão escritos à mão em novidades.js e singles.js. Uma música que esteja
  // nos dois sítios aparece uma vez só: o número do cartão é o MAIOR entre o
  // escrito à mão (p.ex. streams do Spotify) e o da plataforma (p.ex. views do
  // YouTube) — sobe sozinho sem nunca descer abaixo do manual; o subtítulo
  // escrito à mão mantém-se.
  const chave = (x) => (x.link ? x.link.replace(/\/intl-[a-z]+\//, '/').replace(/[?#].*$/, '').replace(/\/$/, '')
    : (x.titulo + '|' + (x.artista || x.descricao || '')).toLowerCase());

  function juntar(daPlataforma, aMao) {
    const porChave = new Map();
    for (const x of aMao || []) if (x) porChave.set(chave(x), x);
    for (const x of daPlataforma || []) {
      const k = chave(x);
      const base = porChave.get(k);
      const sem = Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      const junto = { ...(base || {}), ...sem };
      if (base) {
        // O número sobe, nunca desce: fica o maior dos dois.
        const aMaoN = Number(base.streams), daPlat = Number(sem.streams);
        if (Number.isFinite(aMaoN) && Number.isFinite(daPlat)) junto.streams = Math.max(aMaoN, daPlat);
        // O subtítulo curado à mão fica; a plataforma só atualiza o número.
        if (base.descricao) junto.descricao = base.descricao;
      }
      porChave.set(k, junto);
    }
    return [...porChave.values()];
  }

  async function juntarLancamentos() {
    let r;
    try { r = await api('/api/integracoes/lancamentos'); } catch (_) { return; }
    if (r.novidades && r.novidades.length) {
      window.NOVIDADES = juntar(r.novidades, window.NOVIDADES)
        .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
    }
    if (r.sucessos && r.sucessos.length) {
      window.SINGLES = juntar(r.sucessos, window.SINGLES)
        .sort((a, b) => (Number(b.streams) || 0) - (Number(a.streams) || 0));
    }
  }

  async function loadBoard() {
    try { renderBoard(await api('/api/public/today')); }
    catch (e) { document.getElementById('board').replaceChildren(h('p', { class: 'board-empty' }, e.message)); }
  }

  // Mudar de língua manda desenhar outra vez o que foi feito em JavaScript.
  // Os dados já estão em memória, por isso não se repete nenhum pedido.
  function aoMudarLingua() {
    renderNovidades();
    renderDestaques(false);
    if (ultimo.cfg) {
      renderServices(ultimo.cfg);
      renderRodape(ultimo.cfg);
      for (const el of document.querySelectorAll('#servicos .surge')) el.classList.add('visivel');
    }
    if (ultimo.quadro) renderBoard(ultimo.quadro);
  }

  async function main() {
    document.addEventListener('lingua', aoMudarLingua);
    // Novidades e singles vêm de ficheiros estáticos mais o que a plataforma da
    // gravadora mandou. Se o servidor falhar, ficam os estáticos.
    await juntarLancamentos();
    renderNovidades();
    renderDestaques();
    try {
      const cfg = await api('/api/public/config');
      ultimo.cfg = cfg;
      renderServices(cfg); renderRodape(cfg);
      surgirAoDescer([...document.querySelectorAll('#servicos .surge')]);
    } catch (e) {
      // Sem configuração ficam os serviços escondidos e os contactos por omissão;
      // o quadro "Hoje" tem o seu próprio aviso de erro.
      console.error('Não foi possível carregar a configuração:', e);
    }
    await loadBoard();
    setInterval(loadBoard, 60000);
  }
  main();
})();
