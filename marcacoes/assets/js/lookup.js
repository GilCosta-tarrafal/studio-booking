(function () {
  'use strict';
  const { h, api, t, tr, fmtDate, money, waLink, statusTag } = window.Studio;
  const $ = (id) => document.getElementById(id);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  let biz = null;
  let cur = '';
  let ultimo = null;      // guardado para redesenhar quando a língua muda
  let ultimoCfg = null;   // a configuração, para o rodapé
  let pagamentos = false; // o pagamento online está ligado (ver /integracoes)
  // De volta da página de pagamento: ?pago=1 (pagou) ou ?pago=0 (desistiu).
  const regresso = new URLSearchParams(location.search).get('pago');

  function showError(msg) { const b = $('lookup-error'); b.textContent = msg; b.hidden = false; }

  function render(res) {
    const b = res.booking;
    ultimo = res;
    $('result').hidden = false;
    const dl = $('result-details');
    dl.replaceChildren();
    const rows = [
      [t('linha.estado'), statusTag(b.status)], [t('linha.nome'), b.client_name],
      [t('linha.estudio'), tr(b, 'studio_name')], [t('linha.sala'), tr(b, 'room_name')],
      b.service_name && [t('linha.servico'), tr(b, 'service_name')], b.style && [t('linha.estilo'), b.style],
      b.title && [t('linha.projeto'), b.title],
      [t('linha.dia'), cap(fmtDate(b.date))], [t('linha.hora'), t('linha.horas', { de: b.start, ate: b.end })],
      b.price > 0 && [t('linha.valor'), money(b.price, cur)],
      b.paid > 0 && [t('linha.pago'), money(b.paid, cur)],
    ].filter(Boolean);
    for (const [k, v] of rows) dl.append(h('dt', {}, k), h('dd', {}, v));

    const actions = $('result-actions');
    actions.replaceChildren();
    const wa = biz && waLink(biz, biz.whatsapp || biz.phone,
      t('wa.consulta', { codigo: b.code, data: fmtDate(b.date), hora: b.start }));
    if (wa) actions.append(h('a', { class: 'btn btn-outline', href: wa, rel: 'noopener' }, t('botao.falarEstudio')));
    // O valor em falta paga-se no Stripe; o "Já pago" só muda quando o Stripe
    // nos confirma o pagamento, nunca por o cliente voltar para aqui.
    // Aceite pelo estúdio e à espera do pagamento: vai para a página de
    // pagamento do site (cartões, resumo e recibo).
    if (b.status === 'aguarda_pagamento' && b.price > b.paid) {
      actions.prepend(h('a', { class: 'btn', href: '/pagar?code=' + encodeURIComponent(b.code) }, t('botao.pagar', { valor: money(b.price - b.paid, cur) })));
    } else if (pagamentos && ['confirmado', 'em_curso'].includes(b.status) && b.price > b.paid) {
      const pagar = h('button', { type: 'button', class: 'btn', onclick: () => pay(b.code, pagar) },
        t('botao.pagar', { valor: money(b.price - b.paid, cur) }));
      actions.prepend(pagar);
    }
    actions.append(h('button', { type: 'button', class: 'btn btn-outline', onclick: (e) => baixarRecibo(b.code, e.currentTarget) }, t('botao.recibo')));
    if (res.can_cancel) {
      actions.append(h('button', { type: 'button', class: 'btn btn-danger', onclick: () => cancel(b.code) }, t('botao.cancelar')));
    }
  }

  // O recibo é um PDF pedido com o código e o telefone (POST), por isso não
  // pode ser um link simples: vem como ficheiro e descarrega-se daqui.
  async function baixarRecibo(code, botao) {
    $('lookup-error').hidden = true;
    botao.disabled = true;
    try {
      const r = await fetch('/api/public/recibo', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'studio' },
        body: JSON.stringify({ code, phone: $('phone').value }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || t('api.erro'));
      const url = URL.createObjectURL(await r.blob());
      const a = h('a', { href: url, download: 'recibo-' + code + '.pdf' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { showError(e.message); }
    finally { botao.disabled = false; }
  }

  async function cancel(code) {
    if (!window.confirm(t('consultar.confirmarCancelar'))) return;
    try {
      const res = await api('/api/public/cancel', { method: 'POST', body: { code, phone: $('phone').value } });
      render(res);
      const m = $('cancel-msg');
      m.textContent = t('consultar.cancelada');
      m.hidden = false;
    } catch (e) {
      showError(e.message);
    }
  }

  async function pay(code, botao) {
    $('lookup-error').hidden = true;
    botao.disabled = true;
    botao.textContent = t('pagar.aAbrir');
    try {
      const r = await api('/api/integracoes/pagamentos/checkout', { method: 'POST', body: { code, phone: $('phone').value } });
      // Vamos sair para o Stripe: o ecrã de carregamento cobre a espera até lá.
      if (window.Studio.carregar) window.Studio.carregar.mostrar();
      window.location.assign(r.url);
    } catch (e) {
      showError(e.message);
      render(ultimo);
    }
  }

  // Cliente com sessão iniciada: mostra as marcações da conta. Carregar numa
  // preenche o código e o telefone da conta e consulta — sem ter de guardar o
  // código. Sem sessão, fica só o formulário de sempre.
  let minhas = null;
  function pintarMinhas() {
    if (!minhas || !minhas.lista.length) return;
    $('suas').hidden = false;
    $('suas-lista').replaceChildren(...minhas.lista.map((b) => h('button', {
      type: 'button', class: 'sua-marcacao', onclick: () => abrirMinha(b.code),
    },
      h('strong', {}, b.code),
      h('span', {}, cap(fmtDate(b.date, 'short')) + ' · ' + b.start + ' · ' + tr(b, 'studio_name')),
      statusTag(b.status))));
  }
  function abrirMinha(code) {
    $('code').value = code;
    $('phone').value = minhas.phone;
    $('lookup-form').requestSubmit();
  }
  async function carregarMinhas() {
    try {
      const [me, r] = await Promise.all([api('/api/conta/me'), api('/api/public/my-bookings')]);
      minhas = { phone: me.client.phone, lista: r.bookings };
    } catch (_) { return; } // sem sessão de cliente
    pintarMinhas();
    // Vindo da conta (?code=...): se a marcação é desta conta, abre-a logo.
    const pedido = $('code').value.trim().toUpperCase();
    if (pedido && minhas.lista.some((b) => b.code === pedido)) abrirMinha(pedido);
  }

  function mostrarRegresso() {
    if (regresso !== '1' && regresso !== '0') return;
    const m = $('pagar-msg');
    m.textContent = t(regresso === '1' ? 'pagar.recebido' : 'pagar.cancelado');
    m.className = 'notice ' + (regresso === '1' ? 'info' : 'warn');
    m.hidden = false;
  }

  async function submit(e) {
    e.preventDefault();
    $('lookup-error').hidden = true;
    $('cancel-msg').hidden = true;
    $('result').hidden = true;
    const code = $('code').value.trim();
    const phone = $('phone').value.trim();
    if (!code) return showError(t('erro.codigo'));
    if (phone.replace(/\D/g, '').length < 6) return showError(t('erro.telefoneConsulta'));
    const btn = $('lookup-btn');
    btn.disabled = true;
    try {
      render(await api('/api/public/lookup', { method: 'POST', body: { code, phone } }));
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function init() {
    $('lookup-form').addEventListener('submit', submit); // antes de qualquer espera
    // A mensagem de cancelamento, se estiver à vista, também tem de mudar.
    document.addEventListener('lingua', () => {
      window.Studio.renderRodape(ultimoCfg);
      mostrarRegresso();
      pintarMinhas();
      if (!ultimo) return;
      const m = $('cancel-msg');
      const cancelada = !m.hidden;
      render(ultimo);
      if (cancelada) { m.textContent = t('consultar.cancelada'); m.hidden = false; }
    });
    const code = new URLSearchParams(location.search).get('code');
    if (code) { $('code').value = code.slice(0, 12); $('phone').focus(); }
    mostrarRegresso();
    carregarMinhas();
    try {
      pagamentos = (await api('/api/integracoes/estado')).pagamentos;
      if (ultimo) render(ultimo);
    } catch (_) { /* sem integrações, fica sem o botão */ }
    try {
      const cfg = await api('/api/public/config');
      biz = cfg.business; cur = biz.currency; ultimoCfg = cfg;
      window.Studio.renderRodape(cfg);
    } catch (_) { /* opcional */ }
  }
  init();
})();
