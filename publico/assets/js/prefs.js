'use strict';
// ---------------------------------------------------------------------------
// Os dois botões do cabeçalho: língua e tema.
//
// A página já chega do servidor na língua e no tema certos (ver backend/lib/
// prefs.js); este ficheiro só trata do que acontece depois de a pessoa clicar.
// O tema muda no instante, sem recarregar. A língua também: o texto escrito no
// HTML é trocado a partir do dicionário, e as partes desenhadas em JavaScript
// (o quadro "Hoje", o formulário, o resumo) voltam a ser desenhadas quando
// ouvem o evento 'lingua'.
//
// Tem de correr antes de common.js: é aqui que window.I18N fica de pé.
// ---------------------------------------------------------------------------
(function () {
  const D = window.DICIONARIO;
  const raiz = document.documentElement;
  const ANO = 'max-age=31536000';

  let lingua = D.codigos.includes(raiz.lang) ? raiz.lang : 'pt';

  function guardar(nome, valor) {
    document.cookie = nome + '=' + encodeURIComponent(valor) + '; path=/; ' + ANO + '; samesite=lax';
  }

  // ---- Tradução ----------------------------------------------------------
  const t = (chave, valores) => D.t(lingua, chave, valores);

  window.I18N = {
    t,
    get lingua() { return lingua; },
    get locale() { return D.lingua(lingua).locale; },
    // Lista separada por vírgulas no dicionário (dias da semana, por exemplo).
    lista: (chave) => t(chave).split(','),
  };

  // Traduz o que está escrito no HTML. data-i18n troca o texto; data-i18n-attr
  // troca atributos ("placeholder:campo.nomeDica aria-label:aria.sala").
  // Uma chave sem tradução deixa ficar o que lá está, em vez de escrever o
  // nome da chave na página.
  function traduzir(raizDom) {
    for (const el of raizDom.querySelectorAll('[data-i18n]')) {
      const valor = D.talvez(lingua, el.dataset.i18n);
      if (valor !== null) el.textContent = valor;
    }
    for (const el of raizDom.querySelectorAll('[data-i18n-attr]')) {
      for (const par of el.dataset.i18nAttr.split(/\s+/)) {
        const [attr, chave] = par.split(':');
        if (!attr || !chave) continue;
        const valor = D.talvez(lingua, chave);
        if (valor !== null) el.setAttribute(attr, valor);
      }
    }
    // O título e a descrição são compostos: nome do estúdio + texto traduzido.
    for (const el of document.querySelectorAll('[data-i18n-tpl]')) {
      const alvo = el.tagName === 'META' ? 'content' : null;
      const texto = el.dataset.i18nTpl.replace(/\{(\S+?)\}/g, (_, c) => t(c));
      if (alvo) el.setAttribute(alvo, texto);
      else el.textContent = texto;
    }
  }

  function mudarLingua(nova) {
    if (nova === lingua || !D.codigos.includes(nova)) return;
    lingua = nova;
    guardar('lingua', nova);
    raiz.lang = nova;
    traduzir(document);
    marcarEscolhas();
    // Quem desenha em JavaScript volta a desenhar com a língua nova.
    document.dispatchEvent(new CustomEvent('lingua', { detail: { lingua: nova } }));
  }

  function mudarTema(novo) {
    raiz.dataset.tema = novo;
    guardar('tema', novo);
    marcarEscolhas();
  }

  // ---- Estado visível dos dois botões ------------------------------------
  function marcarEscolhas() {
    const tema = raiz.dataset.tema === 'claro' ? 'claro' : 'escuro';
    const escolhas = { lingua, tema };
    for (const menu of document.querySelectorAll('.pref-menu')) {
      const caixa = menu.closest('.pref');
      const botao = caixa.querySelector('.pref-btn');
      let atual = null;
      for (const item of menu.querySelectorAll('[data-lingua], [data-tema]')) {
        const chave = item.dataset.lingua !== undefined ? 'lingua' : 'tema';
        const ativa = item.dataset[chave] === escolhas[chave];
        item.setAttribute('aria-checked', String(ativa));
        if (ativa) atual = item;
      }
      if (!atual) continue;
      const nome = atual.querySelector('.pref-nome').textContent;
      const cod = atual.querySelector('.pref-cod');
      botao.querySelector('.pref-val').textContent = cod ? cod.textContent : nome;
      const rotulo = menu.getAttribute('aria-label');
      botao.setAttribute('aria-label', rotulo + ': ' + nome);
      // O botão do tema mostra o desenho do tema que está a ser usado.
      const desenho = atual.querySelector('svg:not(.pref-visto)');
      const atualNoBotao = botao.querySelector('.pref-ico');
      if (desenho && atualNoBotao) {
        const copia = desenho.cloneNode(true);
        copia.setAttribute('class', 'pref-ico');
        atualNoBotao.replaceWith(copia);
      }
    }
  }

  // Quando a língua muda, os nomes dos temas ("Claro"/"Escuro") mudam com ela.
  // Os nomes das línguas não: cada uma diz-se sempre na sua ("English" é
  // "English" em qualquer página).
  // O seletor tem de ficar preso à lista: o próprio <html> leva data-tema, e
  // sem isto era ele o primeiro a ser apanhado.
  function retraduzirMenus() {
    for (const item of document.querySelectorAll('.pref-menu [data-tema]')) {
      item.querySelector('.pref-nome').textContent = t('prefs.tema.' + item.dataset.tema);
    }
    for (const menu of document.querySelectorAll('.pref-menu')) {
      const eLingua = !!menu.querySelector('[data-lingua]');
      menu.setAttribute('aria-label', t(eLingua ? 'prefs.lingua' : 'prefs.tema'));
    }
  }

  // ---- Abrir e fechar ----------------------------------------------------
  function fecharTodos(menos) {
    for (const menu of document.querySelectorAll('.pref-menu')) {
      if (menu === menos) continue;
      menu.hidden = true;
      menu.closest('.pref').querySelector('.pref-btn').setAttribute('aria-expanded', 'false');
    }
  }

  function ligar() {
    const caixas = document.querySelectorAll('.prefs .pref');
    if (!caixas.length) return;

    for (const caixa of caixas) {
      const botao = caixa.querySelector('.pref-btn');
      const menu = caixa.querySelector('.pref-menu');
      const itens = [...menu.querySelectorAll('button')];

      botao.addEventListener('click', () => {
        const abrir = menu.hidden;
        fecharTodos(menu);
        menu.hidden = !abrir;
        botao.setAttribute('aria-expanded', String(abrir));
        if (abrir) (itens.find((i) => i.getAttribute('aria-checked') === 'true') || itens[0]).focus();
      });

      for (const [i, item] of itens.entries()) {
        item.addEventListener('click', () => {
          if (item.dataset.lingua !== undefined) { mudarLingua(item.dataset.lingua); retraduzirMenus(); marcarEscolhas(); }
          else mudarTema(item.dataset.tema);
          menu.hidden = true;
          botao.setAttribute('aria-expanded', 'false');
          botao.focus();
        });
        // Setas percorrem a lista; Esc volta ao botão sem mudar nada.
        item.addEventListener('keydown', (e) => {
          const salto = { ArrowDown: 1, ArrowUp: -1 }[e.key];
          if (salto) { e.preventDefault(); itens[(i + salto + itens.length) % itens.length].focus(); }
          else if (e.key === 'Escape') { e.preventDefault(); menu.hidden = true; botao.setAttribute('aria-expanded', 'false'); botao.focus(); }
        });
      }
    }

    document.addEventListener('click', (e) => { if (!e.target.closest('.pref')) fecharTodos(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharTodos(); });
    // Sair da lista com o teclado fecha-a, como acontece num menu nativo.
    document.addEventListener('focusin', (e) => { if (!e.target.closest('.pref')) fecharTodos(); });
    marcarEscolhas();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar);
  else ligar();
})();
