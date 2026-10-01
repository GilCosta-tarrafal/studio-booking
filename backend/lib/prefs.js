'use strict';
// ---------------------------------------------------------------------------
// Preferências de quem visita: língua e tema. Ambas ficam num cookie simples
// (sem sessão, sem base de dados) e são lidas aqui para que a página já saia
// do servidor na língua e no tema certos — sem o texto trocar à frente dos
// olhos nem o ecrã dar um flash branco antes de o JavaScript correr.
//
// Os dois botões do cabeçalho são escritos aqui, num sítio só, e entram nas
// páginas pelo marcador {{PREFS}}. O comportamento (abrir, escolher, gravar o
// cookie) está em publico/assets/js/prefs.js.
// ---------------------------------------------------------------------------

const D = require('../../publico/assets/js/dicionario.js');

const TEMAS = ['escuro', 'claro'];
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // um ano

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Sem depender do cookie-parser: só precisamos de dois valores curtos.
function cookie(req, nome) {
  const bruto = req.headers.cookie;
  if (!bruto) return '';
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) {
      try { return decodeURIComponent(parte.slice(i + 1).trim()); } catch (_) { return ''; }
    }
  }
  return '';
}

// O português é o que está por omissão: é a língua do estúdio. Não se adivinha
// pelo Accept-Language de propósito — quem quer outra escolhe-a no cabeçalho, e
// assim o mesmo endereço mostra sempre o mesmo a quem não escolheu nada.
function lerLingua(req) {
  const c = cookie(req, 'lingua');
  return D.codigos.includes(c) ? c : 'pt';
}

function lerTema(req) {
  const c = cookie(req, 'tema');
  return TEMAS.includes(c) ? c : 'escuro';
}

// Guarda a língua na requisição e deixa à mão um t() já preso a ela, para as
// rotas responderem com mensagens na língua de quem perguntou.
function middleware(req, _res, next) {
  req.lingua = lerLingua(req);
  req.t = (chave, valores) => D.t(req.lingua, chave, valores);
  next();
}

// ---- Desenhos dos botões -------------------------------------------------
// Traço fino, herdam a cor do texto à volta, como os restantes ícones do site.
const svg = (caminhos, classe) =>
  `<svg class="${classe}" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"`
  + ` stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
  + caminhos.map((d) => `<path d="${d}"/>`).join('') + '</svg>';

const GLOBO = svg([
  'M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2z',
  'M3.6 9.6h16.8M3.6 14.4h16.8',
  'M12 3.4c2.2 2.3 3.3 5.1 3.3 8.6s-1.1 6.3-3.3 8.6c-2.2-2.3-3.3-5.1-3.3-8.6S9.8 5.7 12 3.4z',
], 'pref-ico');

const SOL = svg([
  'M12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6z',
  'M12 2.6v2.1M12 19.3v2.1M4.4 12H2.3M21.7 12h-2.1M6.6 6.6 5.1 5.1M18.9 18.9l-1.5-1.5M6.6 17.4l-1.5 1.5M18.9 5.1l-1.5 1.5',
], 'pref-ico');

const LUA = svg(['M20 14.4A8.4 8.4 0 0 1 9.6 4a8.6 8.6 0 1 0 10.4 10.4z'], 'pref-ico');

const SETA = svg(['m6.5 9.5 5.5 5 5.5-5'], 'pref-chev');
const VISTO = svg(['m5 12.6 4.4 4.4L19 7.4'], 'pref-visto');

// ---- Os dois botões do cabeçalho ----------------------------------------
// "marca" é o que vai à esquerda de cada linha da lista: as línguas levam a
// sigla (PT, EN, FR), os temas levam o desenho do sol ou da lua. "curto" é o
// que fica escrito no botão fechado.
function menu(id, rotulo, atributo, icone, valor, opcoes) {
  const itens = opcoes.map((o) => {
    const ativa = o.valor === valor;
    return `<li role="none"><button type="button" role="menuitemradio" aria-checked="${ativa}"`
      + ` data-${atributo}="${esc(o.valor)}"${o.lang ? ` lang="${esc(o.lang)}"` : ''}>`
      + (o.marca || '') + `<span class="pref-nome">${esc(o.nome)}</span>${VISTO}</button></li>`;
  }).join('');

  const atual = opcoes.find((o) => o.valor === valor) || opcoes[0];
  return `<div class="pref">`
    + `<button type="button" class="pref-btn" id="${id}-btn" aria-haspopup="true" aria-expanded="false"`
    + ` aria-controls="${id}-menu" aria-label="${esc(rotulo)}: ${esc(atual.nome)}">`
    + icone + `<span class="pref-val">${esc(atual.curto || atual.nome)}</span>` + SETA + `</button>`
    + `<ul class="pref-menu" id="${id}-menu" role="menu" aria-label="${esc(rotulo)}" hidden>${itens}</ul>`
    + `</div>`;
}

function html(lingua, tema) {
  const t = (chave) => D.t(lingua, chave);
  const linguas = D.LINGUAS.map((l) => ({
    valor: l.cod, curto: l.curto, nome: l.nome, lang: l.cod,
    marca: `<span class="pref-cod">${esc(l.curto)}</span>`,
  }));
  const temas = [
    { valor: 'claro', nome: t('prefs.tema.claro'), marca: SOL },
    { valor: 'escuro', nome: t('prefs.tema.escuro'), marca: LUA },
  ];
  return '<div class="prefs">'
    + menu('pref-lingua', t('prefs.lingua'), 'lingua', GLOBO, lingua, linguas)
    + menu('pref-tema', t('prefs.tema'), 'tema', tema === 'claro' ? SOL : LUA, tema, temas)
    + '</div>';
}

module.exports = { TEMAS, COOKIE_MAX_AGE, cookie, lerLingua, lerTema, middleware, html, esc };
