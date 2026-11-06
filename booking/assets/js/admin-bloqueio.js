/* Painel de gestão: bloqueio por inatividade. Sem mexer no rato, no teclado ou
   no ecrã durante o tempo definido no servidor (15 minutos por omissão), o
   painel cobre-se e pede a palavra-passe da conta para continuar. O servidor
   também bloqueia a sessão (responde 423 a tudo do painel) — esconder este
   ecrã não chega para ver os dados. Ver lib/auth.js e routes/auth.js.

   Vários separadores partilham a mesma atividade (localStorage): mexer num
   conta para todos, e bloquear ou desbloquear num repete-se nos outros. */
(function () {
  'use strict';
  const S = window.Studio;
  const { h } = S;

  const CHAVE_ATIVIDADE = 'painel.atividade';
  const CHAVE_ESTADO = 'painel.bloqueio';   // "bloqueado:<ms>" ou "livre:<ms>"
  const EVENTOS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

  const st = { ativo: false, limite: 15 * 60 * 1000, bloqueado: false, ecra: null, timer: null, ultimoAviso: 0, ultimaGravacao: 0, aoLibertar: null };

  const ler = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* modo privado */ } };
  const ultimaAtividade = () => Number(ler(CHAVE_ATIVIDADE)) || 0;

  // ---------------------------------------------------------- Atividade
  function atividade() {
    if (!st.ativo || st.bloqueado) return;
    const agora = Date.now();
    if (agora - st.ultimaGravacao > 5000) { st.ultimaGravacao = agora; gravar(CHAVE_ATIVIDADE, String(agora)); }
    // Avisa o servidor no máximo uma vez por minuto.
    if (agora - st.ultimoAviso > 60000) {
      st.ultimoAviso = agora;
      S.api('/api/auth/ativo', { method: 'POST' }).catch((e) => { if (e.status === 423) mostrar(); });
    }
  }

  function verificar() {
    if (!st.ativo || st.bloqueado) return;
    if (Date.now() - ultimaAtividade() >= st.limite) bloquear();
  }

  async function bloquear() {
    mostrar();
    gravar(CHAVE_ESTADO, 'bloqueado:' + Date.now());
    try { await S.api('/api/auth/bloquear', { method: 'POST' }); } catch (_) { /* o servidor bloqueia sozinho */ }
  }

  // ---------------------------------------------------------- Ecrã
  function mostrar() {
    if (st.bloqueado) return;
    st.bloqueado = true;
    const app = window.Admin && window.Admin.app;
    const user = (app && app.user) || {};
    const nome = user.name || '';
    const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
    const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Palavra-passe' });
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Desbloquear');
    const form = h('form', {
      class: 'bloq-form',
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        btn.disabled = true;
        try {
          await S.api('/api/auth/desbloquear', { method: 'POST', body: { password: pass.value } });
          gravar(CHAVE_ESTADO, 'livre:' + Date.now());
          libertar();
        } catch (ex) {
          if (ex.status === 401) { location.reload(); return; }   // demasiados erros: sessão terminada
          err.textContent = ex.message; err.hidden = false;
          pass.select();
        } finally { btn.disabled = false; }
      },
    }, S.campoSenha(pass), err, btn);
    const sair = async () => {
      try { await S.api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* segue */ }
      gravar(CHAVE_ESTADO, 'livre:' + Date.now());
      location.reload();
    };
    const minutos = Math.round(st.limite / 60000);
    st.ecra = h('div', { class: 'bloq', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bloq-titulo' },
      h('div', { class: 'bloq-card' },
        h('span', { class: 'bloq-avatar', 'aria-hidden': 'true' }, iniciais),
        h('h2', { id: 'bloq-titulo' }, 'Painel bloqueado'),
        h('p', { class: 'bloq-quem' }, nome, user.email && h('span', {}, user.email)),
        h('p', { class: 'hint' }, `Esteve ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} sem mexer. Para continuar, escreva a sua palavra-passe.`),
        form,
        h('button', { class: 'link-btn bloq-sair', type: 'button', onclick: sair }, 'Não é você? Terminar sessão')));
    document.body.appendChild(st.ecra);
    const root = document.getElementById('root');
    if (root) root.inert = true;
    document.body.classList.add('bloqueado');
    if (window.AdminSuporte) window.AdminSuporte.parar();   // fecha o chat e o assistente
    setTimeout(() => pass.focus(), 0);
  }

  // Tira o ecrã (desbloqueado aqui ou noutro separador).
  function libertar() {
    if (!st.bloqueado) return;
    st.bloqueado = false;
    if (st.ecra) st.ecra.remove();
    st.ecra = null;
    const root = document.getElementById('root');
    if (root) root.inert = false;
    document.body.classList.remove('bloqueado');
    const agora = Date.now();
    st.ultimoAviso = agora; st.ultimaGravacao = agora;
    gravar(CHAVE_ATIVIDADE, String(agora));
    if (st.aoLibertar) { const f = st.aoLibertar; st.aoLibertar = null; f(); return; }
    // O que estava à vista pode ter falhado enquanto esteve bloqueado: volta a carregar.
    if (window.AdminSuporte) window.AdminSuporte.iniciar();
    if (window.Admin && window.Admin.refresh) window.Admin.refresh();
  }

  // Outro separador bloqueou ou desbloqueou.
  window.addEventListener('storage', (e) => {
    if (e.key !== CHAVE_ESTADO || !e.newValue) return;
    if (e.newValue.startsWith('bloqueado:')) { if (st.ativo) mostrar(); }
    else if (e.newValue.startsWith('livre:')) libertar();
  });

  // ---------------------------------------------------------- Ciclo de vida
  // Depois de o painel arrancar (boot). `limite` vem do servidor (bloqueio_ms).
  function iniciar(limite) {
    parar();
    st.ativo = true;
    if (limite) st.limite = limite;
    const agora = Date.now();
    st.ultimoAviso = agora; st.ultimaGravacao = agora;
    gravar(CHAVE_ATIVIDADE, String(agora));
    for (const ev of EVENTOS) document.addEventListener(ev, atividade, { passive: true, capture: true });
    // Ao voltar a um separador escondido (ou de o computador acordar), verifica já.
    document.addEventListener('visibilitychange', verificar);
    st.timer = setInterval(verificar, 10000);
  }

  function parar() {
    st.ativo = false;
    for (const ev of EVENTOS) document.removeEventListener(ev, atividade, { capture: true });
    document.removeEventListener('visibilitychange', verificar);
    if (st.timer) clearInterval(st.timer);
    st.timer = null;
    if (st.ecra) st.ecra.remove();
    st.ecra = null;
    st.bloqueado = false;
    st.aoLibertar = null;
    const root = document.getElementById('root');
    if (root) root.inert = false;
    document.body.classList.remove('bloqueado');
  }

  // A sessão já chegou bloqueada (ex.: voltou ao painel no dia seguinte):
  // pede a palavra-passe e só então o painel arranca. Devolve uma promessa.
  function pedir(user, limite) {
    if (limite) st.limite = limite;
    if (window.Admin && window.Admin.app && !window.Admin.app.user) window.Admin.app.user = user;
    return new Promise((resolve) => { st.aoLibertar = resolve; mostrar(); });
  }

  window.AdminBloqueio = { iniciar, parar, pedir, mostrar };
})();
