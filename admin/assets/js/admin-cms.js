/* Painel de gestão: CMS do site — o que se muda no site sem mexer no código.
   À esquerda, os grupos: Textos (o topo, as secções, "Como funciona", o menu,
   o rodapé...), Página inicial (fotografias e secções visíveis) e Conteúdo
   (atalhos para o que já se gere noutras secções do painel). À direita, o
   grupo aberto. Os dados vivem na API (ver api/lib/cms.js). */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h } = S;
  const { app, views, api, toast, campoImagem } = A;

  // O que já se gere noutras secções e também aparece no site.
  const ATALHOS = [
    ['musica', 'Música', 'Novidades e singles em destaque na página inicial.'],
    ['projetos', 'Projetos', 'A secção "Participa", com as campanhas abertas.'],
    ['servicos', 'Serviços', 'A lista de serviços e o que se escolhe ao marcar.'],
    ['estudios', 'Estúdios', 'Estúdios, salas, preços e horários (também no rodapé).'],
    ['configuracoes?sec=geral', 'Definições do negócio', 'Nome, frase de apresentação, contactos e redes sociais.'],
  ];

  let uid = 0;
  const id = () => 'cms' + ++uid;

  function verSite() {
    return h('a', { class: 'btn btn-outline', href: app.siteUrl, target: '_blank', rel: 'noopener' }, 'Ver o site');
  }

  function cartao(titulo, desc, ...corpo) {
    return h('section', { class: 'cf-card', 'aria-labelledby': 'cms-h' },
      h('header', { class: 'cf-card-head' }, h('div', {}, h('h2', { id: 'cms-h' }, titulo), desc && h('p', { class: 'hint' }, desc))),
      ...corpo);
  }

  // Guarda e mostra o resultado; `corpo` é só a parte que muda.
  async function guardar(corpo, msg) {
    try {
      await api('/api/admin/cms', { method: 'PUT', body: corpo });
      toast(msg);
      A.refresh();
    } catch (ex) { toast(ex.message, true); }
  }

  function rodapeForm(...extra) {
    return h('div', { class: 'cms-foot' }, ...extra, verSite(), h('button', { class: 'btn', type: 'submit' }, 'Guardar'));
  }

  // ---------------------------------------------------------- Textos
  // Cada campo tem uma caixa por língua. Vazia, o site mostra o texto de origem
  // (que aparece a cinzento dentro da caixa).
  // Devolve os elementos, o texto que vale em cada caixa (o escrito ou, vazia,
  // o de origem) e todos os textos com estes campos lidos das caixas.
  // `aoEscrever(cod)` é chamado a cada tecla e ao entrar numa caixa, com a
  // língua dela (a pré-visualização das fotografias segue-a).
  function camposTexto(d, campos, { aoEscrever } = {}) {
    const caixas = {};
    const els = campos.map((c) => {
      const atual = d.cms.textos[c.chave] || {};
      caixas[c.chave] = {};
      const linhas = d.linguas.map((l) => {
        const attrs = { id: id(), maxlength: d.max_texto, placeholder: c.origem[l.cod], lang: l.cod };
        const caixa = c.longo ? h('textarea', { ...attrs, rows: 2 }, atual[l.cod] || '') : h('input', { ...attrs, type: 'text', value: atual[l.cod] || '' });
        if (aoEscrever) for (const ev of ['input', 'focus']) caixa.addEventListener(ev, () => aoEscrever(l.cod));
        caixas[c.chave][l.cod] = caixa;
        return h('div', { class: 'cms-lingua' }, h('label', { for: attrs.id, title: l.nome }, l.cod.toUpperCase()), caixa);
      });
      const repor = h('button', {
        class: 'btn btn-outline btn-sm', type: 'button', title: 'Voltar ao texto de origem em todas as línguas',
        onclick: () => { for (const cx of Object.values(caixas[c.chave])) cx.value = ''; if (aoEscrever) aoEscrever(null); },
      }, 'Repor');
      return h('div', { class: 'cms-campo' },
        h('div', { class: 'cms-campo-top' }, h('strong', {}, c.rotulo), h('code', { class: 'cf-code' }, c.chave), repor),
        c.dica && h('p', { class: 'hint' }, c.dica),
        ...linhas);
    });
    const origem = Object.fromEntries(campos.map((c) => [c.chave, c.origem]));
    return {
      els,
      valor: (chave, cod) => caixas[chave][cod].value.trim() || origem[chave][cod],
      // Os outros campos seguem como estão; só estes são lidos das caixas.
      textos() {
        const out = { ...d.cms.textos };
        for (const [chave, porLingua] of Object.entries(caixas)) {
          out[chave] = Object.fromEntries(Object.entries(porLingua).map(([cod, cx]) => [cod, cx.value]));
        }
        return out;
      },
    };
  }

  function grupoTextos(d, grupo) {
    const t = camposTexto(d, grupo.campos);
    const form = h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        guardar({ textos: t.textos() }, 'Textos guardados. O site já os mostra.');
      },
    }, ...t.els, rodapeForm());
    return cartao(grupo.titulo, grupo.desc + ' Deixe uma caixa vazia para manter o texto de origem (a cinzento).', form);
  }

  // ---------------------------------------------------------- Página inicial
  // Pré-visualização de uma fotografia como fica no site: o topo leva o mesmo
  // véu escuro e o título por cima; a faixa, o mesmo corte (mais larga do que
  // alta, centrada um pouco acima do meio). Muda logo ao escolher a imagem,
  // antes de guardar. Só se mostra o que está no próprio painel: um link de
  // fora só aparece depois de guardado (é aí que é copiado para o site).
  const LOCAL = /^\/[\w\-./]+(\?v=\w+)?$/;

  function previa(tipo, { guardada, origem }) {
    const etiqueta = h('span', { class: 'cms-pv-tag' });
    const titulo = h('span', {}, 'Como fica no site');
    const aviso = h('p', { class: 'cms-pv-aviso', hidden: true }, 'A pré-visualização aparece depois de guardar: a imagem do link é copiada para o site nessa altura.');
    const txt = { titulo: h('strong'), texto: h('span'), info: h('small'), botao: h('em') };
    const quadro = tipo === 'topo'
      ? h('div', { class: 'cms-pv cms-pv-topo', role: 'img', 'aria-label': 'Pré-visualização do topo da página' },
        h('div', { class: 'cms-pv-veu' }),
        h('div', { class: 'cms-pv-txt' }, txt.titulo, txt.texto, txt.info, txt.botao))
      : h('div', { class: 'cms-pv cms-pv-faixa' }, h('img', { alt: 'Pré-visualização da faixa' }));
    const el = h('div', { class: 'cms-pv-caixa' }, h('div', { class: 'cms-pv-head' }, titulo, etiqueta), quadro, aviso);
    // O texto por cima da fotografia, na língua que se está a escrever.
    el.texto = (a) => {
      for (const k of Object.keys(txt)) txt[k].textContent = a[k];
      titulo.textContent = 'Como fica no site · ' + a.lingua.toUpperCase();
    };
    el.mostrar = (v) => {
      const src = v || origem;
      const ver = LOCAL.test(src);
      quadro.hidden = !ver; aviso.hidden = ver;
      if (ver && tipo === 'topo') quadro.style.backgroundImage = `url("${src}")`;
      if (ver && tipo !== 'topo') quadro.querySelector('img').src = src;
      const igual = v === (guardada || '');
      etiqueta.className = 'cms-pv-tag' + (igual ? '' : ' nova');
      etiqueta.textContent = igual ? (v ? 'No site agora' : 'Fotografia de origem · no site agora')
        : (v ? 'Nova · carregue em Guardar para a pôr no site' : 'Volta à de origem · carregue em Guardar');
    };
    return el;
  }

  function imagens(d) {
    const slides = d.cms.imagens.slides.map((v) => h('input', { value: v || '' }));
    const faixa = h('input', { value: d.cms.imagens.faixa || '' });
    const vazio = 'Um link ou uma imagem do seu computador (JPG, PNG ou WebP, até 5 MB). Vazio: fica a fotografia de origem do site.';
    // O texto por cima das fotografias (os campos do grupo "Topo da página
    // inicial"): edita-se aqui também, e as pré-visualizações seguem-no.
    const topo = d.grupos.find((g) => g.key === 'topo');
    const previas = [];
    let lingua = 'pt';
    // A frase de apresentação vem das Definições do negócio (com as traduções de lá).
    const tagline = (cod) => {
      const tr = app.settings.traducoes && app.settings.traducoes[cod];
      return (tr && tr.tagline) || app.settings.tagline || '';
    };
    const pintarTexto = (cod) => {
      if (cod) lingua = cod;
      const a = {
        lingua,
        titulo: t.valor('inicio.h1', lingua),
        texto: [tagline(lingua), t.valor('inicio.lead', lingua)].filter(Boolean).join('. '),
        info: t.valor('inicio.marcarInfo', lingua),
        botao: t.valor('nav.marcar', lingua),
      };
      for (const pv of previas) pv.texto(a);
    };
    const t = camposTexto(d, topo.campos, { aoEscrever: pintarTexto });
    // Um campo de imagem com a sua pré-visualização por baixo.
    function campo(rotulo, input, tipo, guardada, origem) {
      const pv = previa(tipo, { guardada, origem });
      if (tipo === 'topo') previas.push(pv);
      const el = campoImagem(rotulo, input, { hint: vazio, aoMudar: (v) => pv.mostrar(v) });
      el.append(pv);
      pv.mostrar(input.value.trim());
      return el;
    }
    const camposSlides = slides.map((i, n) => campo(`Fotografia ${n + 1}`, i, 'topo', d.cms.imagens.slides[n], d.imagens_origem.slides[n]));
    pintarTexto();
    const form = h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        guardar({ textos: t.textos(), imagens: { slides: slides.map((i) => i.value.trim()), faixa: faixa.value.trim() } }, 'Fotografias e texto guardados.');
      },
    },
    h('h3', { class: 'cms-sub' }, 'Texto por cima das fotografias'),
    h('p', { class: 'hint' }, 'Escreva e veja nas pré-visualizações abaixo, na língua da caixa em que está. Vazia, fica o texto de origem (a cinzento). A frase de apresentação ("', tagline('pt'), '") muda-se em ',
      h('a', { href: '#/configuracoes?sec=geral' }, 'Definições do negócio'), '.'),
    h('div', { class: 'cms-bloco' }, ...t.els),
    h('h3', { class: 'cms-sub' }, 'Topo da página'),
    h('p', { class: 'hint' }, 'As fotografias passam umas a seguir às outras por trás do título, de 7 em 7 segundos. Prefira imagens largas (1920 × 1080).'),
    ...camposSlides,
    h('h3', { class: 'cms-sub' }, 'Faixa a meio da página'),
    campo('Fotografia da faixa', faixa, 'faixa', d.cms.imagens.faixa, d.imagens_origem.faixa),
    rodapeForm());
    return cartao('Fotografias', 'As imagens grandes da página inicial e o texto que aparece por cima delas.', form);
  }

  // ---------------------------------------------------------- Secções novas
  // Uma caixa por língua para um campo de uma secção nova (título, texto, botão).
  function trio(d, rotulo, valores, { longo, max, aoEscrever, dica } = {}) {
    const caixas = {};
    const linhas = d.linguas.map((l) => {
      const attrs = { id: id(), maxlength: max, lang: l.cod, placeholder: l.cod === 'pt' ? '' : 'Vazio: fica o português' };
      const cx = longo ? h('textarea', { ...attrs, rows: 4 }, (valores || {})[l.cod] || '') : h('input', { ...attrs, type: 'text', value: (valores || {})[l.cod] || '' });
      if (aoEscrever) for (const ev of ['input', 'focus']) cx.addEventListener(ev, () => aoEscrever(l.cod));
      caixas[l.cod] = cx;
      return h('div', { class: 'cms-lingua' }, h('label', { for: attrs.id, title: l.nome }, l.cod.toUpperCase()), cx);
    });
    return {
      el: h('div', { class: 'cms-campo' }, h('div', { class: 'cms-campo-top' }, h('strong', {}, rotulo)), dica && h('p', { class: 'hint' }, dica), ...linhas),
      ler: () => Object.fromEntries(Object.entries(caixas).map(([cod, cx]) => [cod, cx.value])),
      em: (cod) => caixas[cod].value.trim() || caixas.pt.value.trim(),
    };
  }

  // Janela para criar ou editar uma secção nova, com a pré-visualização de
  // como fica no site. `aoGuardar(secao)` grava a lista toda.
  function editarExtra(d, s, aoGuardar) {
    const nova = !s;
    s = s || { titulo: {}, texto: {}, botao: {}, link: '', imagem: '', depois: 'como', visivel: true };
    let lingua = 'pt';
    const pv = { titulo: h('strong'), texto: h('div', { class: 'cms-pv-sec-p' }), botao: h('em'), img: h('img', { alt: '' }), caixa: null };
    const pintar = (cod) => {
      if (cod) lingua = cod;
      pv.titulo.textContent = titulo.em(lingua) || 'Título da secção';
      pv.texto.replaceChildren(...(texto.em(lingua) || '').split(/\n{2,}/).filter(Boolean).map((p) => h('p', {}, p)));
      const rot = botao.em(lingua);
      pv.botao.textContent = rot;
      pv.botao.hidden = !rot || !link.value.trim();
      const src = imagem.value.trim();
      const ver = LOCAL.test(src);
      pv.img.hidden = !ver;
      if (ver) pv.img.src = src;
      pv.grelha.classList.toggle('com-imagem', ver);
      pv.lingua.textContent = 'Como fica no site · ' + lingua.toUpperCase() + (src && !ver ? ' (a imagem do link aparece depois de guardar)' : '');
    };
    const titulo = trio(d, 'Título', s.titulo, { max: d.campos_extra.titulo, aoEscrever: pintar });
    const texto = trio(d, 'Texto', s.texto, { longo: true, max: d.campos_extra.texto, aoEscrever: pintar, dica: 'Uma linha em branco separa parágrafos.' });
    const botao = trio(d, 'Texto do botão', s.botao, { max: d.campos_extra.botao, aoEscrever: pintar, dica: 'Vazio, a secção não tem botão.' });
    const link = h('input', { type: 'text', maxlength: 500, value: s.link || '', placeholder: '/marcar, #servicos ou https://…', oninput: () => pintar() });
    const imagem = h('input', { value: s.imagem || '' });
    const depois = h('select', { value: s.depois }, d.posicoes.map((p) => h('option', { value: p.key }, p.rotulo)));
    const visivel = h('input', { type: 'checkbox', checked: s.visivel !== false });
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    pv.lingua = h('span');
    pv.grelha = h('div', { class: 'cms-pv-sec-grelha' }, h('div', { class: 'cms-pv-sec-txt' }, pv.titulo, pv.texto, pv.botao), pv.img);
    const campoImg = campoImagem('Imagem (opcional)', imagem, { hint: 'Aparece ao lado do texto. JPG, PNG ou WebP, até 5 MB, do computador ou por link.', aoMudar: () => pintar() });

    A.openModal((close) => h('div', { class: 'modal-in' },
      h('div', { class: 'modal-head' }, h('h2', {}, nova ? 'Nova secção' : 'Editar secção')),
      h('p', { class: 'modal-sub' }, 'Uma secção da página inicial com título, texto, imagem e botão. Escreva em português; o inglês e o francês são opcionais.'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault(); err.hidden = true;
          const pronta = { ...s, titulo: titulo.ler(), texto: texto.ler(), botao: botao.ler(), link: link.value.trim(), imagem: imagem.value.trim(), depois: depois.value, visivel: visivel.checked };
          try { await aoGuardar(pronta); close(); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        },
      },
      h('div', { class: 'cms-pv-caixa' }, h('div', { class: 'cms-pv-head' }, pv.lingua), h('div', { class: 'cms-pv cms-pv-sec' }, pv.grelha)),
      titulo.el, texto.el, botao.el,
      A.field('Link do botão', link, { hint: 'Uma página do site (/marcar), uma secção (#servicos) ou um endereço de fora (abre noutro separador).' }),
      campoImg,
      A.field('Onde aparece', depois),
      h('label', { class: 'check' }, visivel, 'Visível no site'),
      err,
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Cancelar'),
        h('button', { class: 'btn', type: 'submit' }, nova ? 'Adicionar secção' : 'Guardar')))));
    pintar();
    titulo.el.querySelector('input').focus();
  }

  function secoes(d) {
    const caixas = d.secoes.map((s) => {
      const cx = h('input', { type: 'checkbox', checked: d.cms.secoes[s.key] !== false });
      return { key: s.key, cx, el: h('label', { class: 'check cms-secao' }, cx, h('span', {}, h('strong', {}, s.rotulo), h('span', { class: 'hint' }, s.desc))) };
    });
    const extras = d.cms.extras.map((e) => ({ ...e }));
    const rotuloPos = (k) => (d.posicoes.find((p) => p.key === k) || {}).rotulo || '';
    const ligadas = extras.map((e) => h('input', { type: 'checkbox', checked: e.visivel !== false, 'aria-label': 'Visível no site' }));
    // Grava tudo: as secções de origem como estão marcadas e a lista das novas.
    async function gravar(lista, msg) {
      await api('/api/admin/cms', { method: 'PUT', body: { secoes: Object.fromEntries(caixas.map((c) => [c.key, c.cx.checked])), extras: lista } });
      toast(msg); A.refresh();
    }
    // As novas com o "visível" que está marcado agora (ainda por guardar).
    const comVisiveis = () => extras.map((e, i) => ({ ...e, visivel: ligadas[i].checked }));
    const adicionar = () => editarExtra(d, null, (s) => gravar([...comVisiveis(), s], 'Secção adicionada.'));
    const cheio = extras.length >= d.max_extras;

    const itens = extras.map((e, i) => h('li', { class: 'cf-item' + (e.visivel === false ? ' off' : '') },
      ligadas[i],
      h('div', { class: 'cf-item-txt' },
        h('div', { class: 'cf-item-top' }, h('strong', {}, e.titulo.pt || (e.texto.pt || '').slice(0, 60)), h('span', { class: 'cf-pill ok' }, 'Nova')),
        h('p', {}, rotuloPos(e.depois) + (e.imagem ? ' · com imagem' : '') + (e.botao.pt && e.link ? ' · com botão' : ''))),
      h('div', { class: 'cf-acts' },
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => editarExtra(d, comVisiveis()[i], (s) => gravar(comVisiveis().map((x, j) => (j === i ? s : x)), 'Secção guardada.')) }, 'Editar'),
        h('button', {
          class: 'btn btn-outline btn-sm cms-apagar', type: 'button',
          onclick: async () => {
            if (!window.confirm(`Apagar a secção "${e.titulo.pt || 'sem título'}"?`)) return;
            try { await gravar(comVisiveis().filter((_, j) => j !== i), 'Secção apagada.'); } catch (ex) { toast(ex.message, true); }
          },
        }, 'Apagar'))));

    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try { await gravar(comVisiveis(), 'Secções guardadas.'); } catch (ex) { toast(ex.message, true); }
      },
    },
    ...caixas.map((c) => c.el),
    h('h3', { class: 'cms-sub cms-extras-h' }, 'Secções novas'),
    itens.length ? h('ul', { class: 'cf-list-items' }, itens)
      : h('p', { class: 'empty' }, 'Ainda não há secções novas. Use "Adicionar secção" para pôr na página um texto, uma imagem e um botão à sua escolha.'),
    rodapeForm());

    return h('section', { class: 'cf-card', 'aria-labelledby': 'cms-h' },
      h('header', { class: 'cf-card-head' },
        h('div', {}, h('h2', { id: 'cms-h' }, 'Secções visíveis'),
          h('p', { class: 'hint' }, 'Desligue uma secção para a tirar da página inicial, ou acrescente secções novas. As secções sem conteúdo (sem músicas, projetos ou serviços) já ficam escondidas sozinhas.')),
        h('button', { class: 'cf-add', type: 'button', onclick: adicionar, disabled: cheio, title: cheio ? `No máximo ${d.max_extras} secções novas` : null }, '+ Adicionar secção')),
      form);
  }

  function conteudo() {
    return cartao('Conteúdo do site', 'Estas partes do site gerem-se nas suas próprias secções do painel.',
      h('ul', { class: 'cf-list-items' }, ATALHOS.map(([k, t, desc]) => h('li', { class: 'cf-item' },
        h('div', { class: 'cf-item-txt' }, h('div', { class: 'cf-item-top' }, h('strong', {}, t)), h('p', {}, desc)),
        h('a', { class: 'btn btn-outline btn-sm', href: '#/' + k }, 'Abrir')))));
  }

  // ---------------------------------------------------------- Vista
  views.cms = {
    title: 'CMS do site',
    async render(box, params) {
      const d = await api('/api/admin/cms');
      const grupos = [
        ['Textos', d.grupos.map((g) => [g.key, g.titulo])],
        ['Página inicial', [['imagens', 'Fotografias'], ['secoes', 'Secções visíveis']]],
        ['Conteúdo', [['conteudo', 'Música, serviços e mais']]],
      ];
      const todas = grupos.flatMap(([, l]) => l.map(([k]) => k));
      const sec = todas.includes(params.get('sec')) ? params.get('sec') : todas[0];

      const nav = h('nav', { class: 'cf-nav', 'aria-label': 'Partes do site' }, grupos.map(([g, lista]) => h('div', { class: 'cf-group' },
        h('p', { class: 'cf-group-t' }, g),
        h('div', { class: 'cf-links' }, lista.map(([k, label]) => h('a', { class: 'cf-link', href: '#/cms?sec=' + k, 'aria-current': k === sec ? 'page' : null }, label))))));

      const grupo = d.grupos.find((g) => g.key === sec);
      const painel = grupo ? grupoTextos(d, grupo)
        : sec === 'imagens' ? imagens(d)
          : sec === 'secoes' ? secoes(d)
            : conteudo();

      box.append(
        h('div', { class: 'page-head' },
          h('div', {}, h('h1', {}, 'CMS do site'), h('p', { class: 'hint' }, 'Textos, fotografias e secções do site público, em português, inglês e francês.')),
          h('div', { class: 'tools' }, verSite())),
        h('div', { class: 'cf-layout' }, nav, h('div', { class: 'cf-main' }, painel)));
    },
  };
})();
