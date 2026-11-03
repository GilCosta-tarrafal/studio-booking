/* Campos de data sempre em dia/mês/ano.
   O <input type="date"> mostra a data no formato da língua do browser (num
   Windows em inglês dos EUA, mês/dia/ano) e não há atributo que o mude. Por
   isso cada campo de data ganha, por cima, uma caixa de texto "dd/mm/aaaa" e
   um calendário próprio (segunda a domingo, na língua do site/painel).

   O campo original fica lá, escondido, e continua a ser a fonte do valor
   (sempre "aaaa-mm-dd"): quem o lê, escreve ou ouve os eventos input/change
   não precisa de mudar nada. Aplica-se sozinho a todos os campos de data,
   incluindo os que aparecem depois (janelas, vistas do painel). */
(function () {
  'use strict';
  const S = window.Studio;
  const t = (k) => S.t(k);
  const locale = () => (S.I18N && S.I18N.locale) || 'pt-PT';
  const pad = (n) => String(n).padStart(2, '0');
  const NATIVO = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const TEM_POPOVER = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

  // "2026-11-12" <-> "12/11/2026"
  const paraTexto = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  };
  function paraIso(txt) {
    const m = /^\s*(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})\s*$/.exec(txt || '');
    if (!m) return null;
    const ano = m[3].length === 2 ? '20' + m[3] : m[3];
    const iso = `${ano}-${pad(m[2])}-${pad(m[1])}`;
    const d = new Date(iso + 'T12:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
  }
  const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // Enquanto se escreve, as barras aparecem sozinhas: 12112026 -> 12/11/2026.
  function mascara(v) {
    const dig = v.replace(/\D/g, '').slice(0, 8);
    return [dig.slice(0, 2), dig.slice(2, 4), dig.slice(4)].filter(Boolean).join('/');
  }

  const ICO = (d) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICO_CAL = ICO('<path d="M5 5h14v15H5z"/><path d="M5 10h14"/><path d="M9 3v4"/><path d="M15 3v4"/>');
  const ICO_ESQ = ICO('<path d="M15 6l-6 6 6 6"/>');
  const ICO_DIR = ICO('<path d="M9 6l6 6-6 6"/>');

  function el(tag, attrs = {}, html) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
    if (html) e.innerHTML = html;      // só ícones fixos deste ficheiro, nunca dados
    return e;
  }

  function melhorar(inp) {
    if (inp.dataset.dataPt) return;
    inp.dataset.dataPt = '1';

    const caixa = el('div', { class: 'data-pt' });
    const txt = el('input', {
      type: 'text', class: 'data-pt-txt', inputmode: 'numeric', autocomplete: 'off', maxlength: 10,
      placeholder: t('data.formato'), 'aria-label': inp.getAttribute('aria-label') || null,
    });
    const btn = el('button', { type: 'button', class: 'data-pt-btn', 'aria-label': t('data.calendario'), 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, ICO_CAL);
    const pop = el('div', { class: 'data-pt-pop', role: 'dialog', 'aria-label': t('data.calendario'), hidden: !TEM_POPOVER || null });
    if (TEM_POPOVER) pop.setAttribute('popover', 'auto');

    inp.parentNode.insertBefore(caixa, inp);
    caixa.append(txt, btn, inp, pop);
    inp.classList.add('data-pt-iso');
    inp.tabIndex = -1;
    inp.setAttribute('aria-hidden', 'true');
    // A etiqueta (<label for>) aponta para o campo escondido: passa o foco à caixa.
    inp.addEventListener('focus', () => txt.focus());
    if (!txt.getAttribute('aria-label') && inp.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(inp.id)}"]`);
      if (lab) txt.setAttribute('aria-label', lab.textContent.trim());
    }

    const pintar = () => { if (document.activeElement !== txt || !txt.value) txt.value = paraTexto(NATIVO.get.call(inp)); };
    // Quem escrever no campo original (inp.value = '...') vê a caixa atualizada.
    Object.defineProperty(inp, 'value', {
      configurable: true,
      get() { return NATIVO.get.call(inp); },
      set(v) { NATIVO.set.call(inp, v); txt.value = paraTexto(NATIVO.get.call(inp)); },
    });
    const sincronizar = () => {
      txt.disabled = inp.disabled; btn.disabled = inp.disabled;
      // A validação é feita no campo original; a caixa só o anuncia.
      if (inp.required) txt.setAttribute('aria-required', 'true'); else txt.removeAttribute('aria-required');
    };
    new MutationObserver(sincronizar).observe(inp, { attributes: true, attributeFilter: ['disabled', 'required'] });
    sincronizar();
    txt.value = paraTexto(NATIVO.get.call(inp));

    const dentro = (iso) => (!inp.min || iso >= inp.min) && (!inp.max || iso <= inp.max);
    function escolher(iso) {
      if (iso === NATIVO.get.call(inp)) { txt.value = paraTexto(iso); return; }
      NATIVO.set.call(inp, iso);
      txt.value = paraTexto(iso);
      txt.classList.remove('invalido');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ---- Escrever à mão ----
    txt.addEventListener('input', () => {
      const pos = txt.selectionStart === txt.value.length;
      txt.value = mascara(txt.value);
      if (pos) txt.setSelectionRange(txt.value.length, txt.value.length);
      txt.classList.remove('invalido');
    });
    function confirmar() {
      const v = txt.value.trim();
      if (!v) { if (!inp.required) escolher(''); else pintar(); return; }
      const iso = paraIso(v);
      if (iso && dentro(iso)) escolher(iso);
      else { txt.classList.add('invalido'); setTimeout(() => { txt.value = paraTexto(NATIVO.get.call(inp)); }, 900); }
    }
    txt.addEventListener('change', confirmar);
    txt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
      if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); abrir(); }
    });

    // ---- Calendário ----
    let mes = '';      // "aaaa-mm" que está à vista
    let foco = '';     // dia com o foco do teclado
    function desenhar() {
      const [a, m] = mes.split('-').map(Number);
      const primeiro = new Date(Date.UTC(a, m - 1, 1));
      const titulo = cap(primeiro.toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }));
      const desloc = (primeiro.getUTCDay() + 6) % 7;      // segunda = 0
      const inicio = somaDias(`${a}-${pad(m)}-01`, -desloc);
      const sel = NATIVO.get.call(inp), hoje = hojeIso();
      const semana = [];
      for (let i = 0; i < 7; i++) {
        semana.push(new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' }).replace('.', '').slice(0, 3));
      }
      pop.replaceChildren();
      const topo = el('div', { class: 'data-pt-topo' });
      const ant = el('button', { type: 'button', class: 'data-pt-nav', 'aria-label': t('data.anterior') }, ICO_ESQ);
      const seg = el('button', { type: 'button', class: 'data-pt-nav', 'aria-label': t('data.seguinte') }, ICO_DIR);
      const tit = el('strong', { class: 'data-pt-tit', 'aria-live': 'polite' });
      tit.textContent = titulo;
      ant.onclick = () => mudarMes(-1);
      seg.onclick = () => mudarMes(1);
      topo.append(ant, tit, seg);

      const grelha = el('div', { class: 'data-pt-grelha', role: 'grid' });
      for (const s of semana) { const c = el('span', { class: 'data-pt-sem' }); c.textContent = cap(s); grelha.append(c); }
      for (let i = 0; i < 42; i++) {
        const iso = somaDias(inicio, i);
        const b = el('button', {
          type: 'button', class: 'data-pt-dia', 'data-iso': iso, tabindex: iso === foco ? 0 : -1,
          'aria-label': new Date(iso + 'T12:00:00Z').toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
          'aria-pressed': String(iso === sel), disabled: !dentro(iso),
        });
        b.textContent = String(Number(iso.slice(8)));
        if (iso.slice(0, 7) !== mes) b.classList.add('fora');
        if (iso === hoje) b.classList.add('hoje');
        if (iso === sel) b.classList.add('sel');
        b.onclick = () => { escolher(iso); fechar(); txt.focus(); };
        grelha.append(b);
      }
      grelha.addEventListener('keydown', teclas);

      const rodape = el('div', { class: 'data-pt-rodape' });
      if (dentro(hoje)) {
        const bh = el('button', { type: 'button', class: 'data-pt-acao' });
        bh.textContent = t('botao.hoje');
        bh.onclick = () => { escolher(hoje); fechar(); txt.focus(); };
        rodape.append(bh);
      }
      if (!inp.required) {
        const bl = el('button', { type: 'button', class: 'data-pt-acao' });
        bl.textContent = t('data.limpar');
        bl.onclick = () => { escolher(''); fechar(); txt.focus(); };
        rodape.append(bl);
      }
      pop.append(topo, grelha, rodape.childNodes.length ? rodape : '');
    }
    function mudarMes(n) {
      const [a, m] = mes.split('-').map(Number);
      const d = new Date(Date.UTC(a, m - 1 + n, 1));
      mes = d.toISOString().slice(0, 7);
      foco = mes + '-01';
      desenhar();
    }
    function teclas(e) {
      const passos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, PageUp: -30, PageDown: 30 };
      if (!(e.key in passos)) return;
      e.preventDefault();
      foco = somaDias(foco || NATIVO.get.call(inp) || hojeIso(), passos[e.key]);
      if (foco.slice(0, 7) !== mes) { mes = foco.slice(0, 7); desenhar(); }
      else pop.querySelectorAll('.data-pt-dia').forEach((b) => { b.tabIndex = b.dataset.iso === foco ? 0 : -1; });
      const alvo = pop.querySelector(`.data-pt-dia[data-iso="${foco}"]`);
      if (alvo) alvo.focus();
    }

    // Fica por cima de tudo (até das janelas do painel) e encostado à caixa.
    function posicionar() {
      const r = caixa.getBoundingClientRect();
      const alto = pop.offsetHeight || 330, largo = pop.offsetWidth || 290;
      const cimaFalta = r.bottom + 6 + alto > window.innerHeight && r.top - 6 - alto > 0;
      pop.style.top = (cimaFalta ? r.top - 6 - alto : r.bottom + 6) + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - largo - 8)) + 'px';
    }
    const aberto = () => (TEM_POPOVER ? pop.matches(':popover-open') : !pop.hidden);
    function abrir() {
      if (inp.disabled) return;
      const v = NATIVO.get.call(inp) || (inp.min && hojeIso() < inp.min ? inp.min : hojeIso());
      mes = v.slice(0, 7);
      foco = v;
      desenhar();
      if (TEM_POPOVER) pop.showPopover(); else { pop.hidden = false; document.addEventListener('mousedown', foraFallback); }
      btn.setAttribute('aria-expanded', 'true');
      posicionar();
      window.addEventListener('scroll', posicionar, true);
      window.addEventListener('resize', posicionar);
      const alvo = pop.querySelector('.data-pt-dia[tabindex="0"]');
      if (alvo) alvo.focus();
    }
    function fechar() {
      if (TEM_POPOVER) { if (aberto()) pop.hidePopover(); } else { pop.hidden = true; document.removeEventListener('mousedown', foraFallback); }
      aoFechar();
    }
    function aoFechar() {
      btn.setAttribute('aria-expanded', 'false');
      window.removeEventListener('scroll', posicionar, true);
      window.removeEventListener('resize', posicionar);
    }
    function foraFallback(e) { if (!caixa.contains(e.target)) fechar(); }
    if (TEM_POPOVER) pop.addEventListener('toggle', (e) => { if (e.newState === 'closed') aoFechar(); });
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); fechar(); txt.focus(); } });
    btn.addEventListener('click', () => (aberto() ? fechar() : abrir()));
  }

  function varrer(raiz) {
    if (!raiz || raiz.nodeType !== 1) return;
    if (raiz.matches('input[type=date]')) melhorar(raiz);
    raiz.querySelectorAll('input[type=date]').forEach(melhorar);
  }
  function arrancar() {
    varrer(document.body);
    new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) varrer(n); })
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) arrancar(); else document.addEventListener('DOMContentLoaded', arrancar);

  S.datas = { paraTexto, paraIso };
})();
