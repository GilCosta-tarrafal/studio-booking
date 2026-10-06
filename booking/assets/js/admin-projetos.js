/* Painel de gestão: Projetos colaborativos e convocatórias (campanha de
   talentos, álbum coletivo, outras divulgações) e as inscrições que chegam do
   site. */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h, waLink } = S;
  const { app, api, toast, field, pageHead, openModal } = A;

  const TIPOS = [['talentos', 'Campanha de talentos'], ['album', 'Álbum coletivo'], ['outro', 'Outro']];
  const TIPO_NOME = Object.fromEntries(TIPOS);
  const ESTADOS = [['novo', 'Novo'], ['contactado', 'Contactado'], ['aceite', 'Aceite'], ['arquivado', 'Arquivado']];
  const ESTADO_NOME = Object.fromEntries(ESTADOS);
  const ehGestor = () => !app.user.studio_id;

  // ------------------------------------------------------------ Janela: projeto
  function editar(p, aoGuardar) {
    const novo = !p;
    p = p || {};
    const f = {
      tipo: h('select', { value: p.tipo || 'talentos' }, TIPOS.map(([v, nome]) => h('option', { value: v }, nome))),
      titulo: h('input', { type: 'text', maxlength: 140, value: p.titulo || '', required: true }),
      resumo: h('input', { type: 'text', maxlength: 200, value: p.resumo || '' }),
      descricao: h('textarea', { maxlength: 2000 }, p.descricao || ''),
      prazo: h('input', { type: 'date', value: p.prazo || '' }),
      capa_origem: h('input', { type: 'url', maxlength: 1000, placeholder: 'https://…/imagem.jpg', value: p.capa_origem || '' }),
      ordem: h('input', { type: 'number', step: 1, value: p.ordem || 0 }),
      aberto: h('input', { type: 'checkbox', checked: p.aberto === undefined ? true : !!p.aberto }),
      visivel: h('input', { type: 'checkbox', checked: p.visivel === undefined ? true : !!p.visivel }),
    };
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });

    openModal((close) => {
      const guardar = h('button', { class: 'btn', type: 'submit' }, 'Guardar');
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          guardar.disabled = true;
          const body = {
            tipo: f.tipo.value, titulo: f.titulo.value, resumo: f.resumo.value, descricao: f.descricao.value,
            prazo: f.prazo.value, capa_origem: f.capa_origem.value, ordem: f.ordem.value,
            aberto: f.aberto.checked, visivel: f.visivel.checked,
          };
          try {
            const r = novo
              ? await api('/api/admin/integracoes/projetos', { method: 'POST', body })
              : await api(`/api/admin/integracoes/projetos/${p.id}`, { method: 'PUT', body });
            close();
            toast(novo ? 'Projeto criado.' : 'Projeto guardado.');
            if (r.aviso) toast('A imagem não pôde ser carregada: ' + r.aviso, true);
            if (aoGuardar) aoGuardar();
          } catch (ex) { err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
          finally { guardar.disabled = false; }
        },
      },
      h('div', { class: 'grid-2' }, field('Tipo de projeto', f.tipo), field('Título', f.titulo)),
      field('Resumo', f.resumo, { hint: 'Uma frase curta, mostrada no cartão do site.' }),
      field('Descrição', f.descricao, { hint: 'O texto completo do convite. Ex.: campanha para jovens com talento sem condições para gravar.' }),
      h('div', { class: 'grid-2' },
        field('Prazo (opcional)', f.prazo, { hint: 'Data limite para manifestar interesse.' }),
        field('Ordem', f.ordem, { hint: 'Menor aparece primeiro no site.' })),
      field('Imagem (link)', f.capa_origem, { hint: 'Copiada para o site. Vazio: fica o logo.' }),
      h('div', { class: 'grid-2' },
        h('label', { class: 'check' }, f.aberto, 'Aceita inscrições'),
        h('label', { class: 'check' }, f.visivel, 'Mostrar no site')),
      err,
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Fechar'),
        guardar));
      return h('div', { class: 'modal-in' },
        h('div', { class: 'modal-head' }, h('h2', {}, novo ? 'Novo projeto' : 'Editar projeto')),
        h('p', { class: 'modal-sub' }, 'Aparece na secção "Participa" do site enquanto estiver visível. Com "aceita inscrições" ligado, o público pode manifestar interesse.'),
        form);
    });
  }

  async function apagar(p, aoGuardar) {
    if (!window.confirm(`Eliminar o projeto "${p.titulo}"? As inscrições recebidas também são apagadas.`)) return;
    try { await api(`/api/admin/integracoes/projetos/${p.id}`, { method: 'DELETE' }); toast('Projeto eliminado.'); if (aoGuardar) aoGuardar(); }
    catch (ex) { toast(ex.message, true); }
  }

  // ------------------------------------------------------------ Janela: inscrições
  function cartaoInscricao(i, aoMudar) {
    const estado = h('select', { value: i.estado, 'aria-label': 'Estado da inscrição' },
      ESTADOS.map(([v, nome]) => h('option', { value: v }, nome)));
    estado.addEventListener('change', async () => {
      try { await api(`/api/admin/integracoes/inscricoes/${i.id}`, { method: 'PATCH', body: { estado: estado.value } }); toast('Estado atualizado.'); }
      catch (ex) { toast(ex.message, true); estado.value = i.estado; }
    });
    const wa = waLink(app.settings, i.contacto);
    const apagar = async () => {
      if (!window.confirm(`Eliminar a inscrição de ${i.nome}?`)) return;
      try { await api(`/api/admin/integracoes/inscricoes/${i.id}`, { method: 'DELETE' }); toast('Inscrição eliminada.'); if (aoMudar) aoMudar(); }
      catch (ex) { toast(ex.message, true); }
    };
    return h('li', { class: 'insc' },
      h('div', { class: 'insc-head' },
        h('strong', {}, i.nome),
        h('span', { class: 'insc-data' }, S.fmtDateFull(i.criado_em.slice(0, 10)))),
      h('div', { class: 'insc-contactos' },
        i.contacto && (wa ? h('a', { href: wa, target: '_blank', rel: 'noopener' }, i.contacto) : h('span', {}, i.contacto)),
        i.email && h('a', { href: 'mailto:' + i.email }, i.email),
        i.link && h('a', { href: i.link, target: '_blank', rel: 'noopener' }, 'Trabalho')),
      i.mensagem && h('p', { class: 'insc-msg' }, i.mensagem),
      h('div', { class: 'insc-foot' },
        h('label', { class: 'field-inline' }, 'Estado', estado),
        h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: apagar }, 'Eliminar')));
  }

  function verInscricoes(p) {
    openModal((close) => {
      const lista = h('ul', { class: 'insc-lista' }, h('li', { class: 'hint' }, 'A carregar…'));
      const carregar = async () => {
        try {
          const { inscricoes } = await api(`/api/admin/integracoes/projetos/${p.id}/inscricoes`);
          lista.replaceChildren(...(inscricoes.length
            ? inscricoes.map((i) => cartaoInscricao(i, carregar))
            : [h('li', { class: 'hint' }, 'Ainda ninguém manifestou interesse neste projeto.')]));
        } catch (ex) { lista.replaceChildren(h('li', { class: 'notice error' }, ex.message)); }
      };
      carregar();
      return h('div', { class: 'modal-in' },
        h('div', { class: 'modal-head' }, h('h2', {}, 'Inscrições'), h('span', { class: 'tag' }, TIPO_NOME[p.tipo] || p.tipo)),
        h('p', { class: 'modal-sub' }, p.titulo),
        lista,
        h('div', { class: 'modal-foot' }, h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Fechar')));
    });
  }

  // ------------------------------------------------------------ Cartão do projeto
  function cartaoProjeto(p, recarregar) {
    const gestor = ehGestor();
    const marcas = [
      !p.visivel && h('span', { class: 'tag off' }, 'Escondido'),
      !p.aberto && h('span', { class: 'tag' }, 'Fechado'),
    ].filter(Boolean);
    return h('section', { class: 'panel projeto-card' },
      p.capa && h('img', { class: 'projeto-capa', src: p.capa, alt: '', width: 84, height: 84 }),
      h('div', { class: 'projeto-corpo' },
        h('div', { class: 'projeto-topo' },
          h('span', { class: 'tag' }, TIPO_NOME[p.tipo] || p.tipo),
          marcas),
        h('h2', {}, p.titulo),
        p.resumo && h('p', { class: 'projeto-resumo' }, p.resumo),
        h('p', { class: 'hint' },
          p.prazo ? 'Prazo: ' + S.fmtDateFull(p.prazo) + ' · ' : '',
          p.inscricoes + (p.inscricoes === 1 ? ' inscrição' : ' inscrições'),
          p.inscricoes_novas ? ' (' + p.inscricoes_novas + ' por ver)' : ''),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => verInscricoes(p) },
            'Ver inscrições', p.inscricoes_novas ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, p.inscricoes_novas) : null),
          gestor && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => editar(p, recarregar) }, 'Editar'),
          gestor && h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => apagar(p, recarregar) }, 'Eliminar'))));
  }

  A.views.projetos = {
    title: 'Projetos',
    async render(box) {
      const recarregar = () => A.refresh();
      const gestor = ehGestor();
      const novo = gestor && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => editar(null, recarregar) }, 'Novo projeto');
      box.append(pageHead('Projetos', novo));
      box.append(h('p', { class: 'hint', style: { marginBottom: '12px' } },
        'Campanhas e convocatórias colaborativas. Aparecem na secção "Participa" do site; quem tiver interesse deixa o contacto e a inscrição chega aqui.'));

      const { projetos } = await api('/api/admin/integracoes/projetos');
      if (!projetos.length) {
        box.append(h('section', { class: 'panel' }, h('p', { class: 'hint' },
          gestor ? 'Ainda não há projetos. Use "Novo projeto" para criar o primeiro (uma campanha de talentos, um álbum coletivo…).' : 'Ainda não há projetos.')));
        return;
      }
      for (const p of projetos) box.append(cartaoProjeto(p, recarregar));
    },
  };
})();
