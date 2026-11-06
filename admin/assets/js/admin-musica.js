/* Painel de gestão: Música — lançamentos escritos à mão (singles, sucessos,
   novidades que saíram do estúdio). Entram no site pela mesma porta dos
   lançamentos sincronizados. */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h } = S;
  const { app, api, toast, field, campoImagem, pageHead, openModal } = A;

  const numero = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-PT'));
  const ehGestor = () => !app.user.studio_id;

  // Janela para criar ou editar uma música. `l` vazio = nova.
  function editar(l, aoGuardar) {
    const novo = !l;
    l = l || {};
    const f = {
      // Não é obrigatório aqui: só com o link, o título vem de lá.
      titulo: h('input', { type: 'text', maxlength: 160, value: l.titulo || '' }),
      artista: h('input', { type: 'text', maxlength: 200, value: l.artista || '' }),
      data: h('input', { type: 'date', value: (l.data || '').slice(0, 10) }),
      link: h('input', { type: 'url', maxlength: 1000, placeholder: 'https://open.spotify.com/…', value: l.link || '' }),
      capa_origem: h('input', { type: 'url', maxlength: 1000, placeholder: 'https://…/capa.jpg', value: l.capa_origem || '' }),
      formato: h('select', { value: l.formato || '' },
        h('option', { value: '' }, 'Capa quadrada'),
        h('option', { value: 'video' }, 'Imagem de vídeo')),
      plays: h('input', { type: 'number', min: 0, step: 1, value: l.plays === null || l.plays === undefined ? '' : l.plays }),
      texto: h('textarea', { maxlength: 400 }, l.texto || ''),
      visivel: h('input', { type: 'checkbox', checked: l.visivel === undefined ? true : !!l.visivel }),
    };
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });

    // Colar o link (Spotify, YouTube…) preenche o resto: título, artista, data
    // de lançamento, capa e formato. Só se preenche o que está vazio ou o que
    // veio de um link anterior; o que foi escrito à mão fica.
    const lido = h('p', { class: 'hint link-lido', 'aria-live': 'polite' });
    const lerBtn = h('button', { class: 'btn btn-outline btn-sm', type: 'button' }, 'Ler do link');
    const doLink = new Set();
    let ultimoLido = '';
    const pôr = (campo, valor) => {
      if (!valor || (f[campo].value && !doLink.has(campo))) return false;
      f[campo].value = valor;
      doLink.add(campo);
      f[campo].dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    for (const k of ['titulo', 'artista', 'data']) f[k].addEventListener('input', (e) => { if (e.isTrusted) doLink.delete(k); });
    async function lerLink(forcar) {
      const url = f.link.value.trim();
      if (!/^https?:\/\/\S+$/i.test(url) || (!forcar && url === ultimoLido)) return;
      ultimoLido = url;
      lerBtn.disabled = true;
      lido.className = 'hint link-lido';
      lido.textContent = 'A ler o link…';
      try {
        const r = await api('/api/admin/integracoes/musica/ler-link', { method: 'POST', body: { link: url } });
        if (f.link.value.trim() !== url) return;   // entretanto mudou
        const feitos = [];
        if (pôr('titulo', r.titulo)) feitos.push('título');
        if (pôr('artista', r.artista)) feitos.push('artista');
        if (pôr('data', r.data)) feitos.push(r.data_do_link ? 'data de lançamento' : 'data (hoje: o link não a tem)');
        if (r.capa && (!f.capa_origem.value || doLink.has('capa_origem'))) {
          f.capa_origem.value = r.capa; doLink.add('capa_origem');
          f.capa_origem.dispatchEvent(new Event('input', { bubbles: true }));
          feitos.push('capa');
        }
        if (r.formato !== undefined && (doLink.has('formato') || !l.id)) { f.formato.value = r.formato || ''; doLink.add('formato'); }
        lido.className = 'hint link-lido ok';
        lido.textContent = `Lido do ${r.plataforma}` + (feitos.length ? ': ' + feitos.join(', ') + '.' : ' (os campos já estavam preenchidos).')
          + (r.aviso ? ' A capa não veio: ' + r.aviso : '');
      } catch (ex) {
        lido.className = 'hint link-lido mau';
        lido.textContent = ex.message;
      } finally { lerBtn.disabled = false; }
    }
    lerBtn.addEventListener('click', () => lerLink(true));
    f.link.addEventListener('change', () => lerLink(false));
    f.link.addEventListener('paste', () => setTimeout(() => lerLink(false), 0));

    openModal((close) => {
      const guardar = h('button', { class: 'btn', type: 'submit' }, 'Guardar');
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          err.hidden = true;
          guardar.disabled = true;
          if (!f.titulo.value.trim() && !/^https?:\/\/\S+$/i.test(f.link.value.trim())) {
            err.textContent = 'Cole o link da música, ou escreva o título.'; err.hidden = false; guardar.disabled = false; return;
          }
          const body = {
            titulo: f.titulo.value, artista: f.artista.value, data: f.data.value,
            link: f.link.value, capa_origem: f.capa_origem.value, formato: f.formato.value,
            plays: f.plays.value, texto: f.texto.value, visivel: f.visivel.checked,
          };
          try {
            const r = novo
              ? await api('/api/admin/integracoes/musica', { method: 'POST', body })
              : await api(`/api/admin/integracoes/musica/${l.id}`, { method: 'PUT', body });
            close();
            toast(novo ? 'Música adicionada.' : 'Música guardada.');
            if (r.aviso) toast('A capa não pôde ser carregada: ' + r.aviso, true);
            if (aoGuardar) aoGuardar();
          } catch (ex) { err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
          finally { guardar.disabled = false; }
        },
      },
      h('div', { class: 'field link-musica' },
        h('label', { for: 'musica-link' }, 'Link da música (Spotify, YouTube, Apple Music, SoundCloud…)'),
        h('div', { class: 'img-linha' }, Object.assign(f.link, { id: 'musica-link' }), lerBtn),
        lido,
        h('p', { class: 'hint' }, 'Cole o link: o título, o artista, a data de lançamento e a capa vêm de lá. Basta isso para a novidade; os campos abaixo podem ser corrigidos à mão.')),
      h('div', { class: 'grid-2' }, field('Título', f.titulo), field('Artista', f.artista)),
      h('div', { class: 'grid-2' },
        field('Data de lançamento', f.data, { hint: 'Enquanto recente, aparece nas novidades. Vazio: não entra nas novidades.' }),
        field('Reproduções', f.plays, { hint: 'Passando o limite definido em Integrações, entra em "Saíram deste estúdio".' })),
      campoImagem('Imagem da capa', f.capa_origem),
      h('div', { class: 'grid-2' }, field('Formato da imagem', f.formato)),
      field('Texto (opcional)', f.texto, { hint: 'Uma linha curta mostrada no slide de novidades.' }),
      h('label', { class: 'check' }, f.visivel, 'Mostrar no site'),
      err,
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Fechar'),
        guardar));
      return h('div', { class: 'modal-in' },
        h('div', { class: 'modal-head' }, h('h2', {}, novo ? 'Nova música' : 'Editar música')),
        h('p', { class: 'modal-sub' }, 'Entra no site como os lançamentos da plataforma: novidade enquanto recente, sucesso ao passar o limite de reproduções.'),
        form);
    });
  }

  async function apagar(l, aoGuardar) {
    if (!window.confirm(`Eliminar "${l.titulo}" de vez?`)) return;
    try { await api(`/api/admin/integracoes/musica/${l.id}`, { method: 'DELETE' }); toast('Música eliminada.'); if (aoGuardar) aoGuardar(); }
    catch (ex) { toast(ex.message, true); }
  }

  function linha(l, recarregar) {
    const gestor = ehGestor();
    return h('tr', {},
      h('td', {}, l.capa
        ? h('img', { src: l.capa, alt: '', width: 40, height: 40, style: { borderRadius: '4px', objectFit: 'cover' } })
        : '—'),
      h('td', {}, h('strong', {}, l.link ? h('a', { href: l.link, target: '_blank', rel: 'noopener' }, l.titulo) : l.titulo),
        l.artista && h('span', { class: 'sub' }, l.artista)),
      h('td', {}, l.data ? S.fmtDateFull(l.data.slice(0, 10)) : '—'),
      h('td', { class: 'num' }, numero(l.plays)),
      h('td', {}, l.visivel ? 'No site' : h('span', { class: 'tag off' }, 'Escondido')),
      h('td', {}, gestor && h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => editar(l, recarregar) }, 'Editar'),
        h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: () => apagar(l, recarregar) }, 'Eliminar'))));
  }

  A.views.musica = {
    title: 'Música',
    async render(box) {
      const recarregar = () => A.refresh();
      const gestor = ehGestor();
      const novo = gestor && h('button', { class: 'btn btn-sm', type: 'button', onclick: () => editar(null, recarregar) }, 'Adicionar música');
      box.append(pageHead('Música', novo));
      box.append(h('p', { class: 'hint', style: { marginBottom: '12px' } },
        'Músicas que saíram deste estúdio, escritas à mão. Juntam-se às que chegam da plataforma (ver Integrações) e aparecem no site nas novidades e em "Saíram deste estúdio".'));

      const { lancamentos } = await api('/api/admin/integracoes/musica');
      if (!lancamentos.length) {
        box.append(h('section', { class: 'panel' }, h('p', { class: 'hint' },
          gestor ? 'Ainda não há músicas à mão. Use "Adicionar música" para criar a primeira.' : 'Ainda não há músicas à mão.')));
        return;
      }
      box.append(h('section', { class: 'panel' },
        h('div', { class: 'table-wrap' }, A.labelCells(h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, [['Capa', ''], ['Título', ''], ['Saiu a', ''], ['Reproduções', 'num'], ['No site', ''], ['', '']]
            .map(([t, c]) => h('th', { scope: 'col', class: c }, t)))),
          h('tbody', {}, lancamentos.map((l) => linha(l, recarregar))))))));
    },
  };
})();
