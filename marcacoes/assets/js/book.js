(function () {
  'use strict';
  const { h, api, t, tr, fmtMin, fmtDate, fmtDuration, money, waLink, statusTag, icone, fundoServico, som } = window.Studio;
  const $ = (id) => document.getElementById(id);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const state = { cfg: null, client: null, studio: null, room: null, date: '', avail: null, cellMap: new Map(), start: null, duration: 0, seq: 0, feito: null, passo: 1 };
  const PASSOS = 3;

  const rules = () => state.cfg.rules;
  const minDur = () => Math.ceil(rules().min_minutes / rules().slot_minutes) * rules().slot_minutes;
  const maxAllowed = () => Math.floor(rules().max_minutes / rules().slot_minutes) * rules().slot_minutes;

  // Minutos livres seguidos a partir de um início.
  function runFrom(start) {
    const slot = rules().slot_minutes;
    let n = 0, t = start;
    while (state.cellMap.get(t) && state.cellMap.get(t).free) { n += slot; t += slot; }
    return n;
  }
  const maxDur = (start) => Math.min(runFrom(start), maxAllowed());

  // ---------------------------------------------------------- Passos
  // Os dois passos vivem na mesma página; muda-se qual está à vista. Assim
  // ninguém perde o que já preencheu ao recuar, e não há uma segunda ida ao
  // servidor só para mudar de ecrã.
  function contarPasso() {
    $('passo-conta').textContent = t('passo.conta', { n: state.passo, total: PASSOS });
  }

  function irParaPasso(n) {
    const vinhaDoOutro = state.passo !== n;
    state.passo = n;
    for (const i of [1, 2, 3]) $('passo-' + i).hidden = i !== n;
    contarPasso();
    if (n === 2 && vinhaDoOutro) som.parar();
    if (n === 3) renderSelection();   // o resumo do pedido é o que se mostra aqui
    // O foco acompanha o passo: sem isto, quem usa teclado ou leitor de ecrã
    // continuava no fim da página anterior, que já não existe. Sem
    // preventScroll, dar o foco punha a página a descer outra vez até ao
    // painel, desfazendo o salto ao topo.
    $('passo-' + n).focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // O que falta escolher no passo 2. Devolve a mensagem e onde pôr o foco, ou
  // null se estiver tudo. Fica aqui em vez de dentro do botão porque o envio
  // também o consulta: assim um erro de escolha aparece sempre no passo onde
  // se escolhe, e nunca a apontar para um campo que está escondido.
  function faltaNoPasso2() {
    if (!state.studio) return [t('erro.escolhaEstudio'), () => document.querySelector('input[name=studio]')];
    if (!state.room) return [t('erro.escolhaSala'), () => document.querySelector('input[name=room]')];
    if (state.start === null) return [t('erro.escolhaHora'), () => $('cells').querySelector('.cell:not([disabled])') || $('date')];
    return null;
  }

  function seguinteDoPasso2() {
    const erro = $('passo2-error');
    erro.hidden = true;
    const falta = faltaNoPasso2();
    if (!falta) { irParaPasso(3); return; }
    erro.textContent = falta[0];
    erro.hidden = false;
    const alvo = falta[1]();
    if (alvo) alvo.focus();
  }

  // ---------------------------------------------------------- Estúdio e sala
  function renderStudios() {
    const box = $('studios');
    box.replaceChildren(...state.cfg.studios.map((s) => h('label', { class: 'choice choice-estudio' },
      h('input', { type: 'radio', name: 'studio', value: s.id, checked: state.studio && state.studio.id === s.id, onchange: () => selectStudio(s) }),
      h('span', { class: 'choice-body' },
        h('span', { class: 'choice-texto' },
          h('strong', {}, tr(s, 'name')),
          h('span', {}, [tr(s, 'city'), s.address].filter(Boolean).join(', ') || t('marcar.estudioSemMorada')))))));
  }

  function renderRooms() {
    const box = $('rooms');
    box.replaceChildren();
    if (!state.studio) {
      box.append(h('p', { class: 'hint' }, t('marcar.escolhaEstudio')));
      return;
    }
    const cur = state.cfg.business.currency;
    box.append(...state.studio.rooms.map((r) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'room', value: r.id, checked: state.room && state.room.id === r.id, onchange: () => selectRoom(r) }),
      h('span', { class: 'choice-body' },
        h('strong', {}, tr(r, 'name')),
        h('span', {}, [r.hourly_rate > 0 ? t('marcar.porHora', { valor: money(r.hourly_rate, cur) }) : '', tr(r, 'description')].filter(Boolean).join('. ') || t('marcar.salaSemDescricao'))))));
  }

  // Lista de serviços. Ao voltar a desenhá-la (mudança de língua) mantém-se o
  // que estava escolhido, para ninguém perder o que já tinha indicado.
  function renderServicos() {
    const escolhido = document.querySelector('input[name=service]:checked');
    const atual = escolhido ? escolhido.value : '';
    // O desenho ao fundo diz num relance o que é cada serviço — um microfone
    // na gravação, a mesa na mistura. Sai do nome do serviço (ver common.js).
    const opcao = (value, nome, desc, desenho) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'service', value, checked: value === atual, onchange: servicoMudou }),
      h('span', { class: 'choice-body' },
        desenho, h('strong', {}, nome), desc && h('span', {}, desc)));
    const semDesenho = icone('duvida', 78);
    semDesenho.setAttribute('class', 'fundo-servico');
    $('service').replaceChildren(opcao('', t('servico.naoSei.t'), t('servico.naoSei.d'), semDesenho),
      ...state.cfg.services.map((s) => opcao(String(s.id), tr(s, 'name'), tr(s, 'description'), fundoServico(s.name))));
  }

  // Etiquetas do estilo de música. A lista vem de /js/estilos.js; a última,
  // "Outro", abre uma caixa para quem não se revir em nenhuma. Como a lista é
  // redesenhada ao mudar de língua, guarda-se o que estava escolhido.
  let ligadoAoSom = false;
  const ESTILOS = () => (Array.isArray(window.ESTILOS) ? window.ESTILOS.filter((e) => typeof e === 'string' && e.trim()) : []);

  function renderEstilos() {
    const lista = ESTILOS();
    $('style-field').hidden = !lista.length;
    if (!lista.length) return;
    if (!ligadoAoSom) {
      $('style-som').addEventListener('click', () => som.silencio(!som.silencio()));
      som.aoMudar(marcarSom);
      ligadoAoSom = true;
    }
    const posto = document.querySelector('input[name=style]:checked');
    const atual = posto ? posto.value : '';
    const etiqueta = (value, texto) => h('label', { class: 'etiqueta' },
      // "click" além de "change": carregar numa etiqueta já escolhida não muda
      // nada, logo não há "change" — mas quem carregou quer ouvir na mesma.
      h('input', {
        type: 'radio', name: 'style', value, checked: value === atual,
        onchange: () => estiloMudou(true), onclick: () => estiloMudou(true),
      }),
      h('span', {}, texto));
    $('style').replaceChildren(
      ...lista.map((e) => etiqueta(e, e)),
      etiqueta('__outro', t('estilo.outro')));
    estiloMudou();
    marcarSom(som.aTocar(), som.silencio());
  }

  const estiloOutro = () => {
    const posto = document.querySelector('input[name=style]:checked');
    return !!posto && posto.value === '__outro';
  };

  function estiloMudou(tocar) {
    const caixa = $('style-other');
    const abrir = estiloOutro();
    caixa.hidden = !abrir;
    if (!abrir) caixa.value = '';
    // Escolher um estilo toca-o; "Outro" não tem som, que não se sabe qual é.
    const posto = document.querySelector('input[name=style]:checked');
    if (tocar && posto && !abrir) som.tocar(posto.value);
    if (abrir) som.parar();
  }

  // A etiqueta que está a tocar mostra-o, e o botão do som diz em que pé está.
  function marcarSom(aTocar, silenciado) {
    for (const item of $('style').querySelectorAll('.etiqueta')) {
      item.classList.toggle('a-tocar', !silenciado && item.querySelector('input').value === aTocar);
    }
    const b = $('style-som');
    if (!b) return;
    b.setAttribute('aria-pressed', String(!silenciado));
    b.setAttribute('aria-label', t(silenciado ? 'som.desligado' : 'som.ligado'));
    b.title = b.getAttribute('aria-label');
  }

  // O que vai para o servidor: a etiqueta escolhida, ou o que foi escrito em
  // "Outro". Vazio quando não se escolheu nada — o campo é opcional.
  function estiloEscolhido() {
    const posto = document.querySelector('input[name=style]:checked');
    if (!posto) return '';
    return posto.value === '__outro' ? $('style-other').value.trim() : posto.value;
  }

  function selectStudio(s) {
    state.studio = s;
    state.room = s.rooms.length === 1 ? s.rooms[0] : null;
    renderRooms();
    resetSelection();
    loadAvailability();
  }

  function selectRoom(r) {
    state.room = r;
    resetSelection();
    loadAvailability();
  }

  function resetSelection() {
    state.start = null;
    renderSelection();
  }

  // ---------------------------------------------------------- Disponibilidade
  async function loadAvailability() {
    const seq = ++state.seq;
    state.avail = null;
    state.cellMap = new Map();
    state.start = null;
    $('cells').replaceChildren();
    renderSelection();
    const min = state.cfg.today;
    const max = window.Studio.addDays(min, rules().max_advance_days);
    if (!state.room || !state.date || state.date < min || state.date > max) {
      renderCells(state.date && (state.date < min || state.date > max) ? 'range' : 'pick');
      return;
    }
    $('cells').setAttribute('aria-busy', 'true');
    try {
      const a = await api(`/api/public/availability?room_id=${state.room.id}&date=${state.date}`);
      if (seq !== state.seq) return; // chegou uma resposta mais antiga
      state.avail = a;
      state.cellMap = new Map(a.cells.map((c) => [c.start, c]));
      renderCells();
    } catch (e) {
      if (seq !== state.seq) return;
      renderCells('error', e.message);
    } finally {
      $('cells').removeAttribute('aria-busy');
    }
  }

  function renderCells(mode, msg) {
    const box = $('cells');
    const note = $('slot-note');
    box.replaceChildren();
    const a = state.avail;
    if (!a) {
      note.textContent = mode === 'range' ? t('marcar.fora', { n: rules().max_advance_days })
        : mode === 'error' ? msg
          : !state.studio ? t('marcar.notaEstudioSala')
            : !state.room ? t('marcar.notaSala') : t('marcar.notaDia');
      renderSelection();
      return;
    }
    if (a.closed) {
      const porque = { past: 'marcar.diaPassado', too_far: 'marcar.diaLonge', closed: 'marcar.diaFechado' };
      note.textContent = t(porque[a.reason] || 'marcar.diaIndisponivel');
      renderSelection();
      return;
    }
    const free = a.cells.filter((c) => c.free && runFrom(c.start) >= minDur());
    note.textContent = t(free.length ? 'marcar.aberto' : 'marcar.abertoSemHoras',
      { abre: fmtMin(a.open), fecha: fmtMin(a.close) });
    for (const c of a.cells) {
      const usable = c.free && runFrom(c.start) >= minDur();
      box.append(h('button', {
        type: 'button', class: 'cell', 'data-start': c.start, disabled: !usable,
        title: usable ? '' : t(c.reason === 'soon' ? 'bloco.semAntecedencia' : c.free ? 'bloco.semTempo' : 'bloco.ocupado'),
        'aria-pressed': 'false',
        onclick: () => pickStart(c.start),
      }, fmtMin(c.start)));
    }
    renderSelection();
  }

  function pickStart(s) {
    state.start = s;
    const d = state.duration || minDur();
    state.duration = Math.min(Math.max(d, minDur()), maxDur(s));
    renderSelection();
  }

  // ---------------------------------------------------------- Seleção e resumo
  function renderSelection() {
    const slot = rules().slot_minutes;
    const has = state.start !== null && state.avail && !state.avail.closed;
    for (const btn of $('cells').querySelectorAll('.cell')) {
      const s = +btn.dataset.start;
      const isStart = has && s === state.start;
      const inRange = has && s > state.start && s < state.start + state.duration;
      btn.classList.toggle('is-start', isStart);
      btn.classList.toggle('in-range', inRange);
      btn.setAttribute('aria-pressed', isStart ? 'true' : 'false');
    }
    $('duration').hidden = !has;
    if (has) {
      $('dur-out').textContent = fmtDuration(state.duration);
      $('dur-minus').disabled = state.duration - slot < minDur();
      $('dur-plus').disabled = state.duration + slot > maxDur(state.start);
    }
    renderSummary(has);
  }

  function priceEstimate() {
    return Math.round((state.room.hourly_rate * state.duration) / 60);
  }

  function renderSummary(has) {
    const box = $('summary');
    box.replaceChildren();
    if (!has) {
      box.append(h('p', { class: 'hint' }, t('resumo.escolha')));
      return;
    }
    const end = state.start + state.duration;
    const price = priceEstimate();
    box.append(
      h('p', { class: 'when' }, cap(t('resumo.quando', {
        dia: fmtDate(state.date), de: fmtMin(state.start), ate: fmtMin(end), duracao: fmtDuration(state.duration),
      }))),
      h('p', { class: 'where' }, `${tr(state.studio, 'name')}, ${tr(state.room, 'name')}`),
      h('p', { class: aDistancia() ? 'modo remoto' : 'modo' },
        t(aDistancia() ? 'resumo.distancia' : 'resumo.presencial')),
      price > 0 && h('p', { class: 'cost' }, t('resumo.valor', { valor: money(price, state.cfg.business.currency) })));
  }

  // Só os serviços marcados para isso podem ser feitos sem o cliente vir.
  function servicoEscolhido() {
    const op = document.querySelector('input[name=service]:checked');
    const id = op ? op.value : '';
    return id ? state.cfg.services.find((s) => String(s.id) === String(id)) : null;
  }

  function aDistancia() {
    const sv = servicoEscolhido();
    if (!sv || !sv.remote_ok) return false;
    const op = document.querySelector('input[name=presence]:checked');
    return !!op && op.value === 'distancia';
  }

  function servicoMudou() {
    const sv = servicoEscolhido();
    const campo = $('presence-field');
    const permite = !!(sv && sv.remote_ok);
    campo.hidden = !permite;
    if (!permite) {
      const presencial = document.querySelector('input[name=presence][value=presencial]');
      if (presencial) presencial.checked = true;
    } else {
      $('presence-remote-hint').textContent = t('presenca.dica', { servico: tr(sv, 'name').toLowerCase() });
    }
    renderSelection();
  }

  // ---------------------------------------------------------- Envio
  function showError(msg, focusEl) {
    const box = $('form-error');
    box.textContent = msg;
    box.hidden = false;
    if (focusEl) focusEl.focus();
    else box.scrollIntoView({ block: 'center' });
  }

  // Marcar exige conta. Com sessão, os dados de contacto vêm da conta (campos
  // preenchidos e bloqueados); sem ela, o passo dos dados dá lugar a um convite
  // a entrar ou criar conta, com o regresso já apontado para esta página.
  function aplicarConta() {
    const c = state.client;
    $('conta-gate').hidden = !!c;
    $('conta-nota').hidden = !c;
    $('dados-fieldset').hidden = !c;
    $('passo3-acoes').hidden = !c;
    if (c) {
      $('name').value = c.name;
      $('phone').value = c.phone;
      $('email').value = c.email || '';
      $('name').readOnly = $('phone').readOnly = $('email').readOnly = true;
      $('conta-nota').textContent = t('conta.marcarComo', { nome: c.name });
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!state.cfg) return;
    if (!state.client) { location.assign('/conta?next=/marcar'); return; }
    $('form-error').hidden = true;
    // Não devia acontecer (o passo 2 não deixa passar sem isto), mas se
    // acontecer, o erro aparece onde se resolve.
    const falta = faltaNoPasso2();
    if (falta) { irParaPasso(2); seguinteDoPasso2(); return; }
    const name = $('name').value.trim();
    const phone = $('phone').value.trim();
    const email = $('email').value.trim();
    const pd = phone.replace(/\D/g, '');
    if (name.length < 2) return showError(t('erro.nome'), $('name'));
    if (pd.length < 7 || pd.length > 15) return showError(t('erro.telefone'), $('phone'));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showError(t('erro.email'), $('email'));

    const btn = $('submit');
    btn.disabled = true;
    btn.textContent = t('botao.aEnviar');
    try {
      const r = await api('/api/public/bookings', {
        method: 'POST',
        body: {
          room_id: state.room.id, date: state.date, start: fmtMin(state.start), duration_minutes: state.duration,
          service_id: (servicoEscolhido() || {}).id || null, remote: aDistancia(), style: estiloEscolhido(), name, phone, email,
          notes: $('notes').value, website: $('website').value,
        },
      });
      showDone(r.booking);
    } catch (err) {
      showError(err.message);
      if (err.status === 409) loadAvailability();
    } finally {
      btn.disabled = false;
      btn.textContent = t('botao.enviar');
    }
  }

  function showDone(b, primeiraVez = true) {
    const biz = state.cfg.business;
    const confirmed = b.status === 'confirmado';
    state.feito = b;
    $('book-wrap').hidden = true;
    $('done').hidden = false;
    const titulo = t(confirmed ? 'feito.confirmada' : 'feito.enviado');
    document.title = titulo + ' | ' + biz.name;
    $('done-title').textContent = titulo;
    $('done-text').textContent = t(confirmed ? 'feito.textoConfirmada' : 'feito.textoEnviado');
    $('done-code').textContent = b.code;

    const dl = $('done-details');
    dl.replaceChildren();
    const rows = [
      [t('linha.estudio'), tr(b, 'studio_name')], [t('linha.sala'), tr(b, 'room_name')], [t('linha.dia'), cap(fmtDate(b.date))],
      [t('linha.hora'), t('linha.horas', { de: b.start, ate: b.end })],
      b.style && [t('linha.estilo'), b.style],
      [t('linha.sessao'), t(b.remote ? 'linha.distancia' : 'linha.presencial')],
      b.price > 0 && [t('linha.valorEstimado'), money(b.price, biz.currency)],
      [t('linha.estado'), statusTag(b.status)],
    ].filter(Boolean);
    for (const [k, v] of rows) dl.append(h('dt', {}, k), h('dd', {}, v));

    const actions = $('done-actions');
    actions.replaceChildren();
    const text = t('wa.pedido', {
      codigo: b.code, data: fmtDate(b.date), de: b.start, ate: b.end, estudio: tr(b, 'studio_name'), sala: tr(b, 'room_name'),
    }) + (b.remote ? t('wa.distancia') : '');
    const wa = waLink(biz, biz.whatsapp || biz.phone, text);
    if (wa) actions.append(h('a', { class: 'btn btn-amber', href: wa, rel: 'noopener' }, t('botao.waEstudio')));
    const copy = h('button', { type: 'button', class: 'btn btn-outline', onclick: async () => {
      try { await navigator.clipboard.writeText(b.code); copy.textContent = t('botao.codigoCopiado'); } catch (_) { copy.textContent = t('botao.copiarManual'); }
    } }, t('botao.copiarCodigo'));
    actions.append(copy,
      h('a', { class: 'btn btn-outline', href: '/consultar?code=' + encodeURIComponent(b.code) }, t('consultar.titulo')),
      h('a', { class: 'btn btn-quiet', href: '/marcar' }, t('botao.outraMarcacao')));
    if (!primeiraVez) return;   // trocar de língua não volta a saltar para o topo
    window.scrollTo(0, 0);
    $('done-title').focus();
  }

  // A língua mudou: o que está escrito no HTML já foi traduzido (ver prefs.js);
  // aqui volta-se a desenhar o que é feito em JavaScript, sem perder nada do
  // que a pessoa já preencheu nem repetir pedidos ao servidor.
  function aoMudarLingua() {
    if (!state.cfg) return;
    if (state.feito) { showDone(state.feito, false); return; }
    window.Studio.renderRodape(state.cfg);
    aplicarConta();
    contarPasso();
    renderStudios();
    renderRooms();
    if (state.cfg.services.length) renderServicos();
    renderEstilos();
    renderCells(state.avail ? undefined : 'pick');
    servicoMudou();
    $('terms').textContent = tr(state.cfg.business, 'terms') || '';
  }

  // ---------------------------------------------------------- Arranque
  async function init() {
    $('book-form').addEventListener('submit', submit); // antes de qualquer espera, para nunca haver envio nativo
    document.addEventListener('lingua', aoMudarLingua);
    $('btn-seguinte').addEventListener('click', () => irParaPasso(2));
    $('btn-voltar-2').addEventListener('click', () => irParaPasso(1));
    $('btn-seguinte-2').addEventListener('click', seguinteDoPasso2);
    $('btn-voltar').addEventListener('click', () => irParaPasso(2));
    try {
      state.cfg = await api('/api/public/config');
    } catch (e) {
      $('load-error').textContent = e.message;
      $('load-error').hidden = false;
      $('book-form').hidden = true;
      return;
    }
    const cfg = state.cfg;
    window.Studio.renderRodape(cfg);
    try { state.client = (await api('/api/conta/me')).client; } catch (_) { state.client = null; }
    aplicarConta();
    if (!cfg.studios.length) {
      $('load-error').textContent = t('marcar.semEstudios');
      $('load-error').hidden = false;
      $('book-form').hidden = true;
      return;
    }

    const q = new URLSearchParams(location.search);
    const roomQ = +q.get('room'), studioQ = +q.get('studio');
    for (const s of cfg.studios) {
      const r = s.rooms.find((x) => x.id === roomQ);
      if (r) { state.studio = s; state.room = r; }
    }
    if (!state.studio) state.studio = cfg.studios.find((s) => s.id === studioQ) || (cfg.studios.length === 1 ? cfg.studios[0] : null);
    if (state.studio && !state.room && state.studio.rooms.length === 1) state.room = state.studio.rooms[0];

    const dateInput = $('date');
    dateInput.min = cfg.today;
    dateInput.max = window.Studio.addDays(cfg.today, cfg.rules.max_advance_days);
    const dq = q.get('date');
    state.date = dq && /^\d{4}-\d{2}-\d{2}$/.test(dq) && dq >= cfg.today && dq <= dateInput.max ? dq : cfg.today;
    dateInput.value = state.date;

    renderEstilos();
    if (cfg.services.length) {
      $('service-field').hidden = false;
      renderServicos();
      for (const r of document.querySelectorAll('input[name=presence]')) r.addEventListener('change', renderSelection);
      servicoMudou();
    }
    $('terms').textContent = tr(cfg.business, 'terms') || '';

    contarPasso();
    renderStudios();
    renderRooms();
    renderSelection();

    const setDate = (d) => { state.date = d; dateInput.value = d; loadAvailability(); };
    dateInput.addEventListener('change', () => { state.date = dateInput.value; loadAvailability(); });
    $('btn-today').addEventListener('click', () => setDate(cfg.today));
    $('btn-tomorrow').addEventListener('click', () => setDate(window.Studio.addDays(cfg.today, 1)));
    $('dur-minus').addEventListener('click', () => { state.duration -= rules().slot_minutes; renderSelection(); });
    $('dur-plus').addEventListener('click', () => { state.duration += rules().slot_minutes; renderSelection(); });

    loadAvailability();
  }
  init();
})();
