(function () {
  'use strict';
  const { api, t, h, icone, tr, fmtDate, money, statusTag } = window.Studio;
  const $ = (id) => document.getElementById(id);

  // Põe um botão de olho dentro de um campo de palavra-passe, para a ver em
  // caso de dúvida ao escrever.
  function olho(input) {
    const wrap = h('span', { class: 'pw-wrap' });
    input.parentNode.insertBefore(wrap, input);
    const on = icone('olho', 20); on.classList.add('ic-on');
    const off = icone('olhoRiscado', 20); off.classList.add('ic-off');
    const btn = h('button', { type: 'button', class: 'pw-olho', 'aria-label': t('conta.verSenha'), 'aria-pressed': 'false' }, on, off);
    wrap.append(input, btn);
    btn.addEventListener('click', () => {
      const mostrar = input.type === 'password';
      input.type = mostrar ? 'text' : 'password';
      btn.classList.toggle('mostrar', mostrar);
      btn.setAttribute('aria-pressed', String(mostrar));
      btn.setAttribute('aria-label', mostrar ? t('conta.ocultarSenha') : t('conta.verSenha'));
      input.focus();
    });
  }

  // Para onde voltar depois de entrar/criar conta. Só caminhos do próprio site
  // (começados por uma só barra), para um link não levar a pessoa para fora.
  function destino() {
    const n = new URLSearchParams(location.search).get('next') || '/';
    return /^\/[^/]/.test(n) || n === '/' ? n : '/';
  }

  function erro(msg) {
    const e = $('erro');
    e.textContent = msg;
    e.hidden = !msg;
    if (msg) e.scrollIntoView({ block: 'nearest' });
  }

  function mostrarSessao(cliente) {
    $('formularios').hidden = true;
    $('sessao').hidden = false;
    $('sessao-ola').textContent = t('conta.jaComSessao', { nome: cliente.name });
  }

  // As marcações da conta, das mais recentes para as antigas, cada uma com a
  // referência à vista e um botão para a copiar. Assim o cliente nunca perde o
  // código: está sempre aqui enquanto tiver a conta.
  let marcacoes = null;
  let moeda = '';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  async function copiar(code, botao) {
    try {
      await navigator.clipboard.writeText(code);
    } catch (_) {
      // Sem acesso à área de transferência (http sem ser localhost): seleciona o código.
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(botao.parentNode.querySelector('.mm-codigo'));
      sel.removeAllRanges(); sel.addRange(r);
      return;
    }
    botao.textContent = t('conta.copiado');
    setTimeout(() => { botao.textContent = t('conta.copiar'); }, 1800);
  }

  function pintarMarcacoes() {
    const ul = $('lista-marcacoes');
    if (!marcacoes) return;
    ul.replaceChildren();
    if (!marcacoes.length) { ul.append(h('li', { class: 'mm-vazio' }, t('conta.semMarcacoes'))); return; }
    for (const b of marcacoes) {
      const copiarBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: (e) => copiar(b.code, e.currentTarget) }, t('conta.copiar'));
      ul.append(h('li', { class: 'mm-item' },
        h('div', { class: 'mm-ref' },
          h('span', { class: 'mm-rotulo' }, t('conta.referencia')),
          h('strong', { class: 'mm-codigo' }, b.code),
          copiarBtn),
        h('p', { class: 'mm-quando' }, cap(fmtDate(b.date)) + ' · ' + t('linha.horas', { de: b.start, ate: b.end })),
        h('p', { class: 'mm-onde' }, tr(b, 'studio_name') + ' · ' + tr(b, 'room_name')
          + (b.service_name ? ' · ' + tr(b, 'service_name') : '')),
        h('div', { class: 'mm-fim' },
          statusTag(b.status),
          b.price > 0 && h('span', { class: 'mm-valor' }, money(b.price, b.currency || moeda)),
          h('a', { class: 'mm-ver', href: '/consultar?code=' + encodeURIComponent(b.code) }, t('conta.verMarcacao')))));
    }
  }

  async function carregarMarcacoes() {
    $('marcacoes').hidden = false;
    try {
      const [r, cfg] = await Promise.all([api('/api/public/my-bookings'), api('/api/public/config').catch(() => null)]);
      if (cfg) moeda = cfg.business.currency;
      marcacoes = r.bookings;
      pintarMarcacoes();
    } catch (e) {
      $('lista-marcacoes').replaceChildren(h('li', { class: 'mm-vazio' }, e.message));
    }
  }

  // Alterna entre os painéis de entrar, criar conta e recuperar.
  function verAba(qual) {
    erro('');
    const entrar = qual === 'entrar';
    $('form-entrar').hidden = qual !== 'entrar';
    $('form-criar').hidden = qual !== 'criar';
    $('form-recuperar').hidden = qual !== 'recuperar';
    const comAbas = qual === 'entrar' || qual === 'criar';
    document.querySelector('.conta-abas').hidden = !comAbas;
    $('aba-entrar').setAttribute('aria-selected', String(entrar));
    $('aba-criar').setAttribute('aria-selected', String(qual === 'criar'));
  }

  // Corre uma ação de envio desarmando o botão e mostrando o erro, se houver.
  async function enviar(botao, fn) {
    erro('');
    botao.disabled = true;
    try {
      await fn();
    } catch (e) {
      erro(e.message || t('api.erro'));
    } finally {
      botao.disabled = false;
    }
  }

  async function init() {
    document.querySelectorAll('input[type="password"]').forEach(olho);
    try {
      const me = await api('/api/conta/me');
      mostrarSessao(me.client);
      carregarMarcacoes();
      document.addEventListener('lingua', pintarMarcacoes);
      if (location.hash === '#marcacoes') $('marcacoes').scrollIntoView();
      $('btn-sair').addEventListener('click', () => enviar($('btn-sair'), async () => {
        await api('/api/conta/logout', { method: 'POST' });
        location.reload();
      }));
      $('form-senha').addEventListener('submit', (e) => {
        e.preventDefault();
        $('senha-ok').hidden = true;
        enviar(e.submitter || $('form-senha').querySelector('button[type=submit]'), async () => {
          await api('/api/conta/password', { method: 'POST', body: {
            current: $('senha-atual').value, next: $('senha-nova').value,
          } });
          $('senha-atual').value = '';
          $('senha-nova').value = '';
          $('senha-ok').hidden = false;
        });
      });
      // Perfil › Moeda dos preços: a escolha fica na conta.
      api('/api/conta/moeda').then((m) => {
        if (!m.opcoes.length) return;   // sem taxas do dia: não há o que escolher
        const sel = $('moeda-sel');
        sel.replaceChildren(h('option', { value: '' }, t('conta.moedaSo', { moeda: `${m.base_nome} (${m.base})` })),
          ...m.opcoes.map((o) => h('option', { value: o.codigo }, `${o.nome} (${o.codigo})`)));
        sel.value = m.atual;
        $('form-moeda').hidden = false;
        if (location.hash === '#moeda') sel.focus();
      }).catch(() => { /* fica escondido */ });
      $('form-moeda').addEventListener('submit', (e) => {
        e.preventDefault();
        $('moeda-ok').hidden = true;
        enviar(e.submitter || $('form-moeda').querySelector('button[type=submit]'), async () => {
          await api('/api/conta/moeda', { method: 'PUT', body: { moeda: $('moeda-sel').value } });
          // As páginas saem do servidor com as taxas da moeda escolhida: recarrega.
          location.hash = 'moeda';
          location.reload();
        });
      });
      // Com /conta#senha, leva o foco direto ao formulário de palavra-passe.
      if (location.hash === '#senha') $('senha-atual').focus();
      return;
    } catch (_) {
      $('formularios').hidden = false;
    }

    $('aba-entrar').addEventListener('click', () => verAba('entrar'));
    $('aba-criar').addEventListener('click', () => verAba('criar'));
    $('ir-recuperar').addEventListener('click', () => verAba('recuperar'));
    $('ir-entrar').addEventListener('click', () => verAba('entrar'));

    $('form-entrar').addEventListener('submit', (e) => {
      e.preventDefault();
      enviar(e.submitter || $('form-entrar').querySelector('button[type=submit]'), async () => {
        // Uma conta de equipa recebe { redirect: '/admin' } e vai direto ao
        // painel; um cliente volta para onde estava (next), ou à página inicial.
        const r = await api('/api/conta/login', { method: 'POST', body: {
          identifier: $('entrar-id').value.trim(), password: $('entrar-pw').value,
        } });
        location.assign(r && r.redirect ? r.redirect : destino());
      });
    });

    $('form-criar').addEventListener('submit', (e) => {
      e.preventDefault();
      enviar(e.submitter || $('form-criar').querySelector('button[type=submit]'), async () => {
        await api('/api/conta/signup', { method: 'POST', body: {
          name: $('criar-nome').value.trim(), email: $('criar-email').value.trim(),
          phone: $('criar-tel').value.trim(), password: $('criar-pw').value,
        } });
        location.assign(destino());
      });
    });

    $('btn-enviar-codigo').addEventListener('click', () => {
      const id = $('rec-id').value.trim();
      if (!id) return erro(t('conta.erroCampos'));
      const canal = (document.querySelector('input[name=canal]:checked') || {}).value || 'email';
      enviar($('btn-enviar-codigo'), async () => {
        await api('/api/conta/forgot', { method: 'POST', body: { identifier: id, channel: canal } });
        $('rec-passo2').hidden = false;
        $('rec-codigo').focus();
      });
    });

    $('form-recuperar').addEventListener('submit', (e) => {
      e.preventDefault();
      enviar(e.submitter || $('form-recuperar').querySelector('button[type=submit]'), async () => {
        await api('/api/conta/reset', { method: 'POST', body: {
          identifier: $('rec-id').value.trim(), code: $('rec-codigo').value.trim(), password: $('rec-pw').value,
        } });
        location.assign(destino());
      });
    });
  }

  init();
})();
