'use strict';
// Simulador de movimento ondulatório: soma de ondas sinusoidais que viajam
// em sentidos e velocidades diferentes. O que se vê é a sobreposição delas.
(() => {
  const canvas = document.getElementById('wave');
  if (!canvas || typeof canvas.getContext !== 'function') return;
  // Sem caixa desenhada não há nada a fazer, e pedir o contexto num ambiente
  // sem renderização (jsdom, por exemplo) só daria erro.
  if (!canvas.getBoundingClientRect().width) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // amplitude (fração da altura), comprimento de onda (px) e velocidade (px/s)
  const ONDAS = [
    { amp: .42, lambda: 290, vel: 52 },
    { amp: .23, lambda: 133, vel: -38 },
    { amp: .12, lambda: 61, vel: 84 },
  ];

  let largura = 0, altura = 0, dpr = 1;

  function medir() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    largura = r.width; altura = r.height;
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  // Deslocamento do meio, no ponto x e no instante t (segundos)
  const deslocamento = (x, t, meia) => {
    let y = 0;
    for (const o of ONDAS) y += o.amp * meia * Math.sin((2 * Math.PI * (x - o.vel * t)) / o.lambda);
    return y;
  };

  function desenhar(t) {
    const meia = altura / 2;
    ctx.clearRect(0, 0, largura, altura);

    const prata = ctx.createLinearGradient(0, 0, 0, altura);
    prata.addColorStop(0, 'rgba(250, 250, 250, .95)');
    prata.addColorStop(.5, 'rgba(190, 190, 190, .95)');
    prata.addColorStop(1, 'rgba(120, 120, 120, .95)');

    // Onda de trás, mais lenta e apagada, para dar profundidade
    ctx.beginPath();
    for (let x = 0; x <= largura; x += 2) ctx.lineTo(x, meia + deslocamento(x, t * .6, meia * .55));
    ctx.strokeStyle = 'rgba(255, 255, 255, .16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Onda da frente: área preenchida até ao meio, mais o traço por cima
    ctx.beginPath();
    ctx.moveTo(0, meia);
    for (let x = 0; x <= largura; x += 2) ctx.lineTo(x, meia + deslocamento(x, t, meia));
    ctx.lineTo(largura, meia);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, .09)';
    ctx.fill();

    ctx.beginPath();
    for (let x = 0; x <= largura; x += 2) ctx.lineTo(x, meia + deslocamento(x, t, meia));
    ctx.strokeStyle = prata;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  const parado = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener() {} };
  let pedido = 0, inicio = 0;

  function quadro(agora) {
    if (!inicio) inicio = agora;
    desenhar((agora - inicio) / 1000);
    pedido = requestAnimationFrame(quadro);
  }
  function arrancar() {
    if (pedido || parado.matches || document.hidden) return;
    pedido = requestAnimationFrame(quadro);
  }
  function travar() {
    if (pedido) cancelAnimationFrame(pedido);
    pedido = 0;
  }

  if (!medir()) return;
  desenhar(0);                       // primeiro quadro, mesmo sem animação
  arrancar();

  // Só anima enquanto está à vista e com o separador ativo
  document.addEventListener('visibilitychange', () => (document.hidden ? travar() : arrancar()));
  parado.addEventListener('change', () => (parado.matches ? travar() : arrancar()));
  if (window.IntersectionObserver) {
    new IntersectionObserver((es) => (es[0].isIntersecting ? arrancar() : travar()), { threshold: 0 }).observe(canvas);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(() => { if (medir() && !pedido) desenhar(0); }).observe(canvas);
  }
})();
