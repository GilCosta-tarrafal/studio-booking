/* Conta no cabeçalho do site. Sem sessão, o ícone aponta para /conta e diz
   "Entrar". Com sessão, mostra o primeiro nome e, ao clicar, abre um menu com
   "As minhas marcações", "Alterar palavra-passe" e "Sair". É independente do
   resto: se o pedido falhar, fica o estado de "Entrar", que é o seguro. */
(function () {
  'use strict';
  const link = document.getElementById('conta-link');
  if (!link || !window.Studio) return;
  const { h, t, api } = Studio;
  const nome = link.querySelector('.conta-nome');

  api('/api/conta/me').then((d) => {
    if (!d || !d.client) return;
    if (nome) nome.textContent = d.client.name.split(/\s+/)[0];
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
      h('a', { class: 'conta-menu-item', role: 'menuitem', href: '/consultar' }, t('conta.minhasMarcacoes')),
      h('a', { class: 'conta-menu-item', role: 'menuitem', href: '/conta#senha' }, t('conta.alterarSenha')),
      h('button', { class: 'conta-menu-item', role: 'menuitem', type: 'button', onclick: sair }, t('conta.sair')),
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
