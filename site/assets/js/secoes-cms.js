'use strict';
// ---------------------------------------------------------------------------
// Secções novas da página inicial, criadas no painel (CMS do site › Secções
// visíveis). Os dados vêm em window.CMS_SECOES, de /js/cms.js: título, texto e
// botão nas três línguas, a imagem, o link e a secção depois da qual entram
// ('topo' = antes de todas). Sem tradução numa língua, fica o português.
// Voltam a ser desenhadas quando se troca de língua no cabeçalho.
// ---------------------------------------------------------------------------
(function () {
  const lista = Array.isArray(window.CMS_SECOES) ? window.CMS_SECOES : [];
  const main = document.getElementById('conteudo');
  if (!lista.length || !main) return;

  const ANCORAS = {
    novidades: '#novidades', destaques: '#destaques', projetos: '#projetos',
    faixa: '.faixa-foto', servicos: '#servicos', como: '#como',
  };
  const lingua = () => (window.I18N && window.I18N.lingua) || document.documentElement.lang || 'pt';
  const tr = (o) => (o && (o[lingua()] || o.pt)) || '';
  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt) e.textContent = txt;
    return e;
  };

  function secao(s) {
    const sec = el('section', 'section secao-cms');
    sec.id = 'secao-' + s.id;
    const box = el('div', 'container secao-cms-grelha' + (s.imagem ? ' com-imagem' : ''));
    const txt = el('div', 'secao-cms-texto');
    const titulo = tr(s.titulo);
    if (titulo) txt.append(el('h2', '', titulo));
    // Uma linha em branco separa parágrafos.
    for (const par of tr(s.texto).split(/\n{2,}/).filter(Boolean)) txt.append(el('p', '', par));
    const rotulo = tr(s.botao);
    if (rotulo && s.link) {
      const a = el('a', 'btn btn-amber', rotulo);
      a.href = s.link;
      if (/^https?:/i.test(s.link)) { a.target = '_blank'; a.rel = 'noopener'; }
      txt.append(a);
    }
    box.append(txt);
    if (s.imagem) {
      const img = el('img');
      img.src = s.imagem; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      box.append(img);
    }
    sec.append(box);
    return sec;
  }

  function desenhar() {
    for (const velha of main.querySelectorAll('.secao-cms')) velha.remove();
    // Várias depois da mesma secção ficam pela ordem do painel.
    const ultima = {};
    for (const s of lista) {
      const nova = secao(s);
      const antes = ultima[s.depois] || (ANCORAS[s.depois] && main.querySelector(ANCORAS[s.depois]));
      if (antes) antes.after(nova);
      else if (s.depois === 'topo' && ultima.topo === undefined) main.prepend(nova);
      else main.append(nova);
      ultima[s.depois] = nova;
    }
  }

  desenhar();
  document.addEventListener('lingua', desenhar);
})();
