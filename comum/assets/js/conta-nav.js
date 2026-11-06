/* Conta no cabeçalho do site. Sem sessão, o ícone aponta para /conta e diz
   "Entrar". Com sessão, fica o chip do perfil, como no painel (iniciais num
   círculo, nome e "Cliente") e, ao clicar, abre um menu com quem está, "As
   minhas marcações", "Alterar palavra-passe" e "Sair". É independente do
   resto: se o pedido falhar, fica o estado de "Entrar", que é o seguro. */
(function () {
  'use strict';
  const link = document.getElementById('conta-link');
  if (!link || !window.Studio) return;
  const { h, t, api } = Studio;

  const ICO = {
    marcacoes: ['M5 5h14v15H5z', 'M5 9.5h14', 'M9 3v4M15 3v4'],
    senha: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
    moeda: ['M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2z', 'M14.6 9.2c-.4-1-1.4-1.6-2.6-1.6-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.2 0-2.2-.6-2.6-1.6', 'M12 6v1.6M12 16.4V18'],
    sair: ['M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4', 'M9 16l-4-4 4-4', 'M5 12h11'],
  };
  function ico(nome) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 17, height: 17, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    for (const d of ICO[nome]) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); svg.append(p); }
    return svg;
  }

  api('/api/conta/me').then((d) => {
    if (!d || !d.client) return;
    const c = d.client;
    const partes = (c.name || '').trim().split(/\s+/);
    const iniciais = partes.map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '·';
    link.replaceChildren(
      h('span', { class: 'conta-avatar', 'aria-hidden': 'true' }, iniciais),
      h('span', { class: 'conta-txt' }, h('strong', {}, partes[0] || ''), h('span', { 'data-i18n': 'conta.papel' }, t('conta.papel'))),
      h('span', { class: 'conta-caret', 'aria-hidden': 'true' }, '▾'));
    link.classList.add('conta-chip');
    link.setAttribute('aria-label', t('conta.minhaConta'));

    // O ícone passa a abrir um menu em vez de navegar.
    link.setAttribute('role', 'button');
    link.setAttribute('aria-haspopup', 'true');
    link.setAttribute('aria-expanded', 'false');
    link.removeAttribute('href');

    async function sair() {
      try { await api('/api/conta/logout', { method: 'POST' }); } catch (_) { /* segue */ }
      location.reload();
    }

    const menu = h('div', { class: 'conta-menu', role: 'menu', hidden: true },
      h('div', { class: 'conta-menu-who' }, h('strong', {}, c.name), (c.email || c.phone) && h('span', {}, c.email || c.phone)),
      h('a', { class: 'conta-menu-item', role: 'menuitem', href: '/consultar' }, ico('marcacoes'), h('span', { 'data-i18n': 'conta.minhasMarcacoes' }, t('conta.minhasMarcacoes'))),
      h('a', { class: 'conta-menu-item', role: 'menuitem', href: '/conta#moeda' }, ico('moeda'), h('span', { 'data-i18n': 'conta.moedaTitulo' }, t('conta.moedaTitulo'))),
      h('a', { class: 'conta-menu-item', role: 'menuitem', href: '/conta#senha' }, ico('senha'), h('span', { 'data-i18n': 'conta.alterarSenha' }, t('conta.alterarSenha'))),
      h('button', { class: 'conta-menu-item danger', role: 'menuitem', type: 'button', onclick: sair }, ico('sair'), h('span', { 'data-i18n': 'conta.sair' }, t('conta.sair'))),
    );

    const wrap = h('div', { class: 'conta-nav' });
    link.parentNode.insertBefore(wrap, link);
    wrap.append(link, menu);

    function abrir(v) {
      menu.hidden = !v;
      link.setAttribute('aria-expanded', String(v));
    }
    link.addEventListener('click', (e) => { e.preventDefault(); abrir(menu.hidden); });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) abrir(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrir(false); });
  }).catch(() => { /* sem sessão: fica "Entrar" */ });
})();
