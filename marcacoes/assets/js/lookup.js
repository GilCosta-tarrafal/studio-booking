(function () {
  'use strict';
  const { h, api, t, fmtDate, money, waLink, statusTag } = window.Studio;
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
      [t('linha.estudio'), b.studio_name], [t('linha.sala'), b.room_name],
      b.service_name && [t('linha.servico'), b.service_name], b.style && [t('linha.estilo'), b.style],
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
    if (pagamentos && ['confirmado', 'em_curso'].includes(b.status) && b.price > b.paid) {
      const pagar = h('button', { type: 'button', class: 'btn', onclick: () => pay(b.code, pagar) },
        t('botao.pagar', { valor: money(b.price - b.paid, cur) }));
      actions.prepend(pagar);
    }
    if (res.can_cancel) {
      actions.append(h('button', { type: 'button', class: 'btn btn-danger', onclick: () => cancel(b.code) }, t('botao.cancelar')));
    }
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
      window.location.assign(r.url);
    } catch (e) {
      showError(e.message);
      render(ultimo);
    }
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
      if (!ultimo) return;
      const m = $('cancel-msg');
      const cancelada = !m.hidden;
      render(ultimo);
      if (cancelada) { m.textContent = t('consultar.cancelada'); m.hidden = false; }
    });
    const code = new URLSearchParams(location.search).get('code');
    if (code) { $('code').value = code.slice(0, 12); $('phone').focus(); }
    mostrarRegresso();
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
