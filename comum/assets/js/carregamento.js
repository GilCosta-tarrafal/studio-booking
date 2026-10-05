'use strict';
// ---------------------------------------------------------------------------
// Ecrã de carregamento com o logótipo da Suavita.
//
// Aparece enquanto a plataforma está à espera:
//   - ao abrir ou recarregar a página (uma breve "simulação" e esvanece);
//   - ao mudar de página (o clique num link interno mostra-o logo, e a página
//     seguinte já nasce com ele até estar pronta — a troca não pisca a branco).
//
// Fica em comum/ porque todas as áreas o usam. Não depende de mais nada; expõe
// window.Studio.carregar = { mostrar, esconder } para outras esperas (por
// exemplo, antes de ir para a página de pagamento).
//
// A marca inline em cada página (#carregar) nasce com o atributo "hidden" e
// traz o nome do negócio. Sem JavaScript fica escondida (ninguém fica preso
// atrás dela); com JavaScript, é mostrada ao abrir. Nada de <style> inline:
// a política de segurança do site não o deixa.
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  var MIN_MS = 900;     // tempo mínimo visível ao abrir, para a simulação não piscar
  var MAX_MS = 10000;   // trava de segurança: nunca ficar preso mais do que isto
  var semMovimento = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var inicio = Date.now();
  var trava = null;

  function el() { return document.getElementById('carregar'); }

  // Cria o ecrã se a página não o trouxer escrito, para funcionar em qualquer
  // página mesmo sem a marca inline.
  function garantir() {
    var e = el();
    if (e) return e;
    e = document.createElement('div');
    e.id = 'carregar';
    e.className = 'carregar';
    e.setAttribute('role', 'status');
    e.setAttribute('aria-label', 'A carregar');
    e.innerHTML = '<div class="carregar-cartao">'
      + '<span class="carregar-logo"><img src="/img/logo.png" alt="" width="52" height="52">'
      + '<span class="carregar-anel" aria-hidden="true"></span></span>'
      + '<span class="carregar-marca"></span></div>';
    (document.body || document.documentElement).appendChild(e);
    return e;
  }

  function mostrar() {
    var e = garantir();
    clearTimeout(trava);
    e.classList.remove('sai');
    e.hidden = false;
    trava = setTimeout(esconder, MAX_MS);
  }

  function esconder() {
    var e = el();
    if (!e || e.hidden) return;
    clearTimeout(trava);
    var fim = function () { e.hidden = true; e.classList.remove('sai'); e.removeEventListener('transitionend', fim); };
    if (semMovimento) { fim(); return; }
    e.classList.add('sai');
    e.addEventListener('transitionend', fim);
    setTimeout(fim, 600);   // caso o transitionend não chegue (ecrã escondido, etc.)
  }

  // Ao abrir: mostra já o ecrã e esconde-o quando a página fica pronta, mas
  // nunca antes do tempo mínimo — assim a simulação vê-se mesmo quando a página
  // carrega num instante.
  function esconderAoPronto() {
    setTimeout(esconder, semMovimento ? 0 : Math.max(0, MIN_MS - (Date.now() - inicio)));
  }
  mostrar();
  if (document.readyState === 'complete') esconderAoPronto();
  else window.addEventListener('load', esconderAoPronto);

  // Mudar de página: mostrar na saída. Só links internos, abertos no próprio
  // separador, que levam mesmo a outro endereço.
  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var a = ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;
    var url;
    try { url = new URL(a.href, location.href); } catch (_) { return; }
    if (url.origin !== location.origin) return;                            // sítio de fora
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;     // tel:, mailto:...
    if (url.pathname === location.pathname && url.search === location.search) return;  // mesma página (só muda a âncora)
    mostrar();
  });

  // Voltar pela cache do browser (bfcache): a página reaparece pronta, por isso
  // o ecrã tem de sair.
  window.addEventListener('pageshow', function (e) { if (e.persisted) esconder(); });

  window.Studio = window.Studio || {};
  window.Studio.carregar = { mostrar: mostrar, esconder: esconder };
})();
