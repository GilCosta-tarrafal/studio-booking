/* Painel de gestão: Integrações (pagamentos online, plataforma da gravadora). */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h, money } = S;
  const { app, views, api, toast, field, pageHead } = A;

  const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const numero = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-PT'));
  const ESTADO_PAG = { aberto: 'À espera', pago: 'Pago', expirado: 'Não concluído' };

  function cartaoFornecedor(f, aoSincronizar) {
    return h('section', { class: 'panel' },
      h('h2', {}, f.nome, ' ', h('span', { class: 'modo ' + (f.ativo ? 'remoto' : 'presencial') }, f.ativo ? 'ligado' : 'desligado')),
      h('table', { class: 'hours-table' }, h('tbody', {},
        f.detalhes.map(([k, v]) => h('tr', {}, h('td', { style: { width: '16em' } }, k), h('td', {}, v))))),
      f.sincronizavel && h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => aoSincronizar(f.id) }, 'Sincronizar agora')));
  }

  function painelDefinicoes(def, isOwner) {
    const f = {
      sucesso_plays: h('input', { type: 'number', min: 1, step: 1, value: def.sucesso_plays, disabled: !isOwner }),
      novidade_dias: h('input', { type: 'number', min: 1, max: 3650, value: def.novidade_dias, disabled: !isOwner }),
      max_novidades: h('input', { type: 'number', min: 1, max: 30, value: def.max_novidades, disabled: !isOwner }),
    };
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    const submit = async (e) => {
      e.preventDefault();
      err.hidden = true;
      try {
        await api('/api/admin/integracoes/definicoes', { method: 'PUT', body: Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])) });
        toast('Definições guardadas.');
        A.refresh();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    };
    return h('form', { class: 'panel', onsubmit: submit },
      h('h2', {}, 'Lançamentos no site'),
      !isOwner && h('p', { class: 'notice info' }, 'Só o proprietário pode alterar estas definições.'),
      h('div', { class: 'grid-3' },
        field('Sucesso a partir de (reproduções)', f.sucesso_plays, { hint: 'Passando daqui, o lançamento entra em "Saíram deste estúdio".' }),
        field('Novidade durante (dias)', f.novidade_dias, { hint: 'Quanto tempo depois de sair continua no carrossel de novidades.' }),
        field('Máximo de novidades', f.max_novidades, { hint: 'Os lançamentos escritos à mão em novidades.js somam-se a estes.' })),
      err,
      isOwner && h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'submit' }, 'Guardar')));
  }

  function tabelaLancamentos(lista, def) {
    if (!lista.length) {
      return h('section', { class: 'panel' }, h('h2', {}, 'Lançamentos recebidos'),
        h('p', { class: 'hint' }, 'Ainda não chegou nenhum lançamento da plataforma. Quando chegarem, aparecem aqui e no site.'));
    }
    const limite = new Date(Date.now() - def.novidade_dias * 864e5).toISOString().slice(0, 10);
    const linha = (l) => {
      const visivel = h('input', { type: 'checkbox', checked: !!l.visivel, 'aria-label': 'Mostrar no site' });
      visivel.addEventListener('change', async () => {
        try {
          await api(`/api/admin/integracoes/lancamentos/${l.id}`, { method: 'PATCH', body: { visivel: visivel.checked } });
          toast(visivel.checked ? 'Volta a aparecer no site.' : 'Escondido do site.');
        } catch (ex) { visivel.checked = !visivel.checked; toast(ex.message, true); }
      });
      const marcas = [
        l.removido ? 'retirado pela plataforma' : null,
        l.plays !== null && l.plays >= def.sucesso_plays ? 'sucesso' : null,
        l.data && l.data.slice(0, 10) >= limite ? 'novidade' : null,
      ].filter(Boolean);
      return h('tr', {},
        h('td', {}, l.capa ? h('img', { src: l.capa, alt: '', width: 40, height: 40, style: { borderRadius: '4px', objectFit: 'cover' } }) : '—'),
        h('td', {}, h('strong', {}, l.link ? h('a', { href: l.link, target: '_blank', rel: 'noopener' }, l.titulo) : l.titulo),
          l.artista && h('span', { class: 'sub' }, l.artista)),
        h('td', {}, l.data ? S.fmtDateFull(l.data.slice(0, 10)) : '—'),
        h('td', { class: 'num' }, numero(l.plays)),
        h('td', {}, marcas.join(', ') || '—'),
        h('td', {}, h('label', { class: 'check' }, visivel, 'No site')));
    };
    return h('section', { class: 'panel' },
      h('h2', {}, 'Lançamentos recebidos'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, [['Capa', ''], ['Título', ''], ['Saiu a', ''], ['Reproduções', 'num'], ['No site como', ''], ['', '']]
          .map(([t, c]) => h('th', { scope: 'col', class: c }, t)))),
        h('tbody', {}, lista.map(linha)))));
  }

  function tabelaPagamentos(lista) {
    if (!lista.length) return null;
    const cur = app.settings.currency;
    return h('section', { class: 'panel' },
      h('h2', {}, 'Pagamentos online'),
      h('p', { class: 'hint' }, 'Os pagos já estão somados ao "Já pago" da marcação. Reembolsos fazem-se no painel do Stripe; depois acerte o valor na marcação.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, [['Marcação', ''], ['Cliente', ''], ['Valor', 'num'], ['Estado', ''], ['Atualizado', '']]
          .map(([t, c]) => h('th', { scope: 'col', class: c }, t)))),
        h('tbody', {}, lista.map((p) => h('tr', {},
          h('td', {}, p.booking_code || '—'),
          h('td', {}, p.client_name || '—'),
          h('td', { class: 'num' }, money(p.valor, cur)),
          h('td', {}, ESTADO_PAG[p.estado] || p.estado),
          h('td', {}, quando(p.atualizado_em))))))));
  }

  views.integracoes = {
    title: 'Integrações',
    async render(box) {
      const d = await api('/api/admin/integracoes');
      const sincronizar = async (id) => {
        try {
          const r = await api(`/api/admin/integracoes/${id}/sincronizar`, { method: 'POST' });
          toast(`${r.guardados} lançamentos atualizados.` + (r.erros.length ? ` ${r.erros.length} com erros.` : ''), r.erros.length > 0);
          A.refresh();
        } catch (ex) { toast(ex.message, true); }
      };
      box.append(pageHead('Integrações'));
      box.append(h('p', { class: 'hint', style: { marginBottom: '12px' } },
        'Serviços de fora ligados ao site. Ligam-se com variáveis de ambiente no servidor (ver integracoes/README.md); aqui vê-se o estado de cada um.'));
      for (const f of d.fornecedores) box.append(cartaoFornecedor(f, sincronizar));
      box.append(painelDefinicoes(d.definicoes, app.user.role === 'owner'));
      box.append(tabelaLancamentos(d.lancamentos, d.definicoes));
      const pags = tabelaPagamentos(d.pagamentos);
      if (pags) box.append(pags);
    },
  };
})();
