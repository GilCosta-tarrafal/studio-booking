/* Painel de gestão: Configurações — tudo o que se ajusta sem mexer no código,
   num só sítio. À esquerda, os grupos: Geral (definições do negócio),
   Catálogos (géneros musicais, tipos de projeto, tipos de cliente, métodos de
   pagamento, estados de marcação) e Integrações. À direita, a secção aberta. */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h } = S;
  const { app, views, api, toast, field, openModal } = A;

  const NS = 'http://www.w3.org/2000/svg';
  const ICO = {
    lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
    pencil: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
    trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
    eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'],
    eyeOff: ['M3 3l18 18', 'M10.6 5.1A10.6 10.6 0 0 1 12 5c6 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4', 'M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
    plus: ['M12 5v14', 'M5 12h14'],
  };
  function ico(nome, tam = 16) {
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: tam, height: tam, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    for (const d of ICO[nome]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
    return svg;
  }

  // Depois de mudar um catálogo, o formulário da marcação também tem de ver a lista nova.
  async function recarregar() { await A.reloadRefs(); A.refresh(); }

  // ---------------------------------------------------------- Janela: item
  function editar(cat, it) {
    const novo = !it;
    it = it || { nome: '', codigo: '', descricao: '', ativo: true, sistema: false };
    const nome = h('input', { type: 'text', maxlength: 80, required: !it.sistema, value: it.nome, disabled: it.sistema });
    const codigo = h('input', { type: 'text', maxlength: 40, value: it.codigo, placeholder: 'Gerado a partir do nome', readonly: !novo, class: 'cf-code-in' });
    const descricao = h('textarea', { maxlength: 300 }, it.descricao || '');
    const ativo = h('input', { type: 'checkbox', checked: it.ativo });
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    openModal((close) => h('div', { class: 'modal-in' },
      h('div', { class: 'modal-head' }, h('h2', {}, novo ? 'Novo item' : 'Editar item')),
      h('p', { class: 'modal-sub' }, cat.titulo + (it.sistema ? ' · item do sistema: só a descrição pode mudar.' : '')),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault(); err.hidden = true;
          const body = { nome: nome.value, codigo: codigo.value, descricao: descricao.value, ativo: ativo.checked };
          try {
            if (novo) await api(`/api/admin/catalogos/${cat.key}`, { method: 'POST', body });
            else await api(`/api/admin/catalogos/${cat.key}/${it.id}`, { method: 'PUT', body });
            close(); toast(novo ? 'Item adicionado.' : 'Item guardado.'); recarregar();
          } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        },
      },
      h('div', { class: 'grid-2' },
        field('Nome', nome),
        field('Código', codigo, { hint: novo ? 'Fica guardado nas marcações; depois não muda.' : 'O código não muda depois de criado.' })),
      field('Descrição', descricao),
      !it.sistema && h('label', { class: 'check' }, ativo, 'Ativo (aparece nas listas de escolha)'),
      err,
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Cancelar'),
        h('button', { class: 'btn', type: 'submit' }, 'Guardar')))));
    (it.sistema ? descricao : nome).focus();
  }

  // ---------------------------------------------------------- Lista de um catálogo
  function catalogoView(cat) {
    const botao = (cls, icone, rotulo, onclick, disabled) => h('button', {
      class: 'cf-act ' + cls, type: 'button', 'aria-label': rotulo, title: rotulo, onclick, disabled: !!disabled,
    }, ico(icone));

    async function alternar(it) {
      try {
        await api(`/api/admin/catalogos/${cat.key}/${it.id}`, { method: 'PUT', body: { nome: it.nome, descricao: it.descricao, ativo: !it.ativo } });
        toast(it.ativo ? 'Item desativado.' : 'Item ativado.'); recarregar();
      } catch (ex) { toast(ex.message, true); }
    }
    async function apagar(it) {
      if (!window.confirm(`Apagar "${it.nome}"?`)) return;
      try {
        await api(`/api/admin/catalogos/${cat.key}/${it.id}`, { method: 'DELETE' });
        toast('Item apagado.'); recarregar();
      } catch (ex) { toast(ex.message, true); }
    }

    const linhas = cat.itens.map((it) => h('li', { class: 'cf-item' + (it.ativo ? '' : ' off') },
      h('div', { class: 'cf-item-txt' },
        h('div', { class: 'cf-item-top' },
          h('strong', {}, it.nome),
          h('code', { class: 'cf-code' }, it.codigo),
          h('span', { class: 'cf-pill ' + (it.ativo ? 'ok' : 'off') }, it.ativo ? 'Ativo' : 'Inativo')),
        it.descricao && h('p', {}, it.descricao)),
      h('div', { class: 'cf-acts' },
        it.sistema
          ? h('span', { class: 'cf-act lock', title: 'Item do sistema: não pode ser apagado nem desativado', 'aria-label': 'Item do sistema' }, ico('lock'))
          : botao('toggle', it.ativo ? 'eye' : 'eyeOff', it.ativo ? 'Desativar' : 'Ativar', () => alternar(it)),
        botao('edit', 'pencil', 'Editar', () => editar(cat, it)),
        !it.sistema && botao('del', 'trash', 'Apagar', () => apagar(it)))));

    return h('section', { class: 'cf-card', 'aria-labelledby': 'cf-h' },
      h('header', { class: 'cf-card-head' },
        h('div', {}, h('h2', { id: 'cf-h' }, cat.titulo), h('p', { class: 'hint' }, cat.desc)),
        !cat.sistema && h('button', { class: 'cf-add', type: 'button', onclick: () => editar(cat, null) }, ico('plus'), 'Adicionar novo')),
      linhas.length ? h('ul', { class: 'cf-list-items' }, linhas) : h('p', { class: 'empty' }, 'Ainda não há itens. Use "Adicionar novo".'));
  }

  // ---------------------------------------------------------- Vista
  views.configuracoes = {
    title: 'Configurações',
    async render(box, params) {
      const { catalogos } = await api('/api/admin/catalogos');
      app.catalogos = Object.fromEntries(catalogos.map((c) => [c.key, c.itens]));
      const grupos = [
        ['Geral', [['geral', 'Definições do negócio']]],
        ['Catálogos', catalogos.map((c) => [c.key, c.titulo])],
        ['Integrações', [['integracoes', 'Integrações']]],
      ];
      const todas = grupos.flatMap(([, l]) => l.map(([k]) => k));
      const sec = todas.includes(params.get('sec')) ? params.get('sec') : 'geral';

      const nav = h('nav', { class: 'cf-nav', 'aria-label': 'Secções de configuração' }, grupos.map(([g, lista]) => h('div', { class: 'cf-group' },
        h('p', { class: 'cf-group-t' }, g),
        h('div', { class: 'cf-links' }, lista.map(([k, label]) => h('a', { class: 'cf-link', href: '#/configuracoes?sec=' + k, 'aria-current': k === sec ? 'page' : null }, label))))));

      // As secções Geral e Integrações reaproveitam as vistas que já existiam;
      // o título delas passa a subtítulo (o da página é "Configurações").
      const conteudo = h('div', { class: 'cf-main' });
      const cat = catalogos.find((c) => c.key === sec);
      if (cat) conteudo.append(catalogoView(cat));
      else {
        await views[sec === 'geral' ? 'definicoes' : 'integracoes'].render(conteudo, params);
        const h1 = conteudo.querySelector('.page-head h1');
        if (h1) h1.replaceWith(h('h2', { class: 'cf-sub-h' }, h1.textContent));
      }

      box.append(
        h('div', { class: 'page-head' }, h('div', {},
          h('h1', {}, 'Configurações'),
          h('p', { class: 'hint' }, 'Listas, definições e integrações do estúdio, num só sítio.'))),
        h('div', { class: 'cf-layout' }, nav, conteudo));
    },
  };
})();
