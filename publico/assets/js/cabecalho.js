'use strict';
// ---------------------------------------------------------------------------
// O cabeçalho fica preso ao topo durante toda a página.
//
// Por estar fora do fluxo, o conteúdo por baixo tem de saber a altura dele —
// que muda com a largura do ecrã, porque os links passam para outra linha.
// Mede-se aqui e deixa-se numa variável do CSS. O CSS traz um valor de reserva,
// para a página não ficar escondida por trás da barra a quem tenha o
// JavaScript desligado.
// ---------------------------------------------------------------------------
(function () {
  const cabecalho = document.querySelector('.cabecalho');
  if (!cabecalho) return;
  const raiz = document.documentElement;

  function medir() {
    const altura = Math.round(cabecalho.offsetHeight);
    // Uma medição a zero (a barra ainda por desenhar, ou escondida) não vale:
    // apagaria o valor de reserva do CSS e o conteúdo subia para trás da barra.
    if (altura > 0) raiz.style.setProperty('--altura-cabecalho', altura + 'px');
  }
  medir();
  // O tipo de letra chega depois do HTML e muda a altura da barra; e ao trocar
  // de língua um texto mais comprido pode fazê-la passar para duas linhas.
  if (window.ResizeObserver) new ResizeObserver(medir).observe(cabecalho);
  else window.addEventListener('resize', medir);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(medir);
  document.addEventListener('lingua', medir);

  // Só depois de a página começar a descer é que a barra ganha sombra: no topo
  // ficaria um risco a dividir o cabeçalho da fotografia sem razão nenhuma.
  let posto = null;
  function marcar() {
    const desceu = window.scrollY > 12;
    if (desceu === posto) return;
    posto = desceu;
    raiz.classList.toggle('rolou', desceu);
  }
  marcar();
  window.addEventListener('scroll', marcar, { passive: true });
})();
