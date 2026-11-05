/* Painel de gestão: Integrações (pagamentos online, plataforma da gravadora). */
(function () {
  'use strict';
  const S = window.Studio;
  const A = window.Admin;
  const { h, money } = S;
  const { app, views, api, toast, field, pageHead, openModal } = A;

  const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const numero = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-PT'));
  // Nomes dos estados de pagamento: os do catálogo (Configurações › Estados de
  // pagamento); estes ficam de reserva.
  const ESTADO_PAG = { aberto: 'Pendente', pago: 'Pago', reembolsado: 'Reembolsado', expirado: 'Falhou' };
  const nomeEstadoPag = (codigo) => {
    const it = ((app.catalogos && app.catalogos.estados_pagamento) || []).find((i) => i.codigo === codigo);
    return it ? it.nome : ESTADO_PAG[codigo] || codigo;
  };
  const COR_PAG = { pago: 'confirmado', aberto: 'aguarda_pagamento', reembolsado: 'cancelado', expirado: 'expirado' };

  function cartaoFornecedor(f, aoSincronizar) {
    return h('section', { class: 'panel' },
      h('h2', {}, f.nome, ' ', h('span', { class: 'modo ' + (f.ativo ? 'remoto' : 'presencial') }, f.ativo ? 'ligado' : 'desligado')),
      h('table', { class: 'kv-table' }, h('tbody', {},
        f.detalhes.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v))))),
      f.conversor && conversor(),
      f.sincronizavel && h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => aoSincronizar(f.id) }, f.id === 'cambio' ? 'Atualizar agora' : 'Sincronizar agora')));
  }

  // Conversor de moedas (cartão "Taxas de câmbio"), com as taxas do dia.
  function conversor() {
    const base = (app.settings.currency || 'EUR').toUpperCase();
    const valor = h('input', { type: 'number', min: 0, step: 'any', value: 100, 'aria-label': 'Valor' });
    const de = h('input', { type: 'text', maxlength: 3, value: 'EUR', class: 'cf-code-in', 'aria-label': 'De (moeda)' });
    const para = h('input', { type: 'text', maxlength: 3, value: base === 'EUR' ? 'USD' : base, class: 'cf-code-in', 'aria-label': 'Para (moeda)' });
    const saida = h('p', { class: 'cambio-res', 'aria-live': 'polite' });
    const fmt = (n) => Number(n).toLocaleString('pt-PT', { maximumFractionDigits: 4 });
    let seq = 0;
    const calcular = async () => {
      const n = ++seq;
      const q = new URLSearchParams({ valor: valor.value || 0, de: de.value.trim(), para: para.value.trim() });
      try {
        const r = await api('/api/integracoes/cambio?' + q);
        if (n !== seq) return;
        saida.textContent = `${fmt(r.valor)} ${r.de} = ${fmt(r.convertido)} ${r.para}  (1 ${r.de} = ${fmt(r.taxa)} ${r.para})`;
        saida.classList.remove('erro');
      } catch (ex) { if (n === seq) { saida.textContent = ex.message; saida.classList.add('erro'); } }
    };
    for (const el of [valor, de, para]) el.addEventListener('input', calcular);
    const trocar = h('button', { class: 'btn btn-outline btn-sm', type: 'button', title: 'Trocar as moedas',
      onclick: () => { [de.value, para.value] = [para.value, de.value]; calcular(); } }, '⇄');
    calcular();
    return h('div', { class: 'cambio' },
      h('h3', {}, 'Converter'),
      h('div', { class: 'cambio-linha' }, valor, de, trocar, para),
      saida,
      h('p', { class: 'hint' }, h('a', { href: 'https://www.exchangerate-api.com', target: '_blank', rel: 'noopener' }, 'Rates By Exchange Rate API')));
  }

  function painelDefinicoes(def, isOwner) {
    const f = {
      sucesso_plays: h('input', { type: 'number', min: 1, step: 1, value: def.sucesso_plays, disabled: !isOwner }),
      max_novidades: h('input', { type: 'number', min: 1, max: 5, value: def.max_novidades, disabled: !isOwner }),
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
      h('div', { class: 'grid-2' },
        field('Sucesso a partir de (reproduções)', f.sucesso_plays, { hint: 'Passando daqui, o lançamento entra em "Saíram deste estúdio".' }),
        field('Slides de novidades (máx. 5)', f.max_novidades, { hint: 'Ficam sempre os mais recentes pela data de lançamento: entra um novo, sai o mais antigo.' })),
      err,
      isOwner && h('div', { class: 'modal-foot' }, h('button', { class: 'btn', type: 'submit' }, 'Guardar')));
  }

  function tabelaLancamentos(lista, def) {
    if (!lista.length) {
      return h('section', { class: 'panel' }, h('h2', {}, 'Lançamentos recebidos'),
        h('p', { class: 'hint' }, 'Ainda não chegou nenhum lançamento da plataforma. Quando chegarem, aparecem aqui e no site.'));
    }
    // Os que estão agora no slide: os max_novidades mais recentes (como no servidor).
    const noSlide = new Set(lista.filter((l) => l.visivel && !l.removido && l.data)
      .sort((a, b) => (b.data === a.data ? b.id - a.id : b.data.localeCompare(a.data)))
      .slice(0, def.max_novidades).map((l) => l.id));
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
        noSlide.has(l.id) ? 'novidade (no slide)' : null,
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

  // Janela de reembolso: o valor, o motivo e o que fazer à marcação (cancelar)
  // ou à compra (devolver as unidades ao stock).
  function reembolsar(p) {
    const cur = app.settings.currency;
    const compra = p.tipo === 'compra';
    const motivo = h('textarea', { maxlength: 300, rows: 3, placeholder: 'Ex.: o cliente desistiu; sessão cancelada pelo estúdio…' });
    const cancelaveis = ['pedido', 'aguarda_pagamento', 'confirmado', 'em_curso'];
    const extra = compra
      ? h('input', { type: 'checkbox', checked: true })
      : h('input', { type: 'checkbox', checked: cancelaveis.includes(p.booking_status), disabled: !cancelaveis.includes(p.booking_status) });
    const err = h('div', { class: 'notice error', role: 'alert', hidden: true });
    openModal((close) => {
      const confirmar = h('button', { class: 'btn btn-danger', type: 'submit' }, 'Reembolsar ' + money(p.valor, cur));
      return h('div', { class: 'modal-in' },
        h('div', { class: 'modal-head' }, h('h2', {}, 'Reembolsar pagamento')),
        h('p', { class: 'modal-sub' }, compra ? `Compra ${p.booking_code} · ${p.quantidade} × ${p.artigo} · ${p.client_name || ''}` : `Marcação ${p.booking_code} · ${p.client_name || ''}`),
        h('form', {
          onsubmit: async (e) => {
            e.preventDefault();
            err.hidden = true;
            confirmar.disabled = true;
            try {
              const r = await api(`/api/admin/integracoes/pagamentos/${p.id}/reembolsar`, {
                method: 'POST', body: { motivo: motivo.value, cancelar: !compra && extra.checked, devolver_stock: compra && extra.checked },
              });
              close();
              toast('Reembolso feito' + (r.stripe ? ': o valor volta ao cartão do cliente.' : '.') + (r.cancelada ? ' A marcação foi cancelada.' : '') + (r.stock_devolvido ? ' As unidades voltaram ao stock.' : ''));
              A.refresh();
            } catch (ex) { err.textContent = ex.message; err.hidden = false; confirmar.disabled = false; }
          },
        },
        h('p', { class: 'notice info' }, p.fornecedor === 'stripe'
          ? `O Stripe devolve ${money(p.valor, cur)} ao cartão do cliente (pode demorar alguns dias a aparecer). Não se pode desfazer.`
          : 'Pagamento de demonstração: não houve dinheiro, por isso só fica marcado como reembolsado.'),
        field('Motivo (opcional)', motivo, { hint: 'Fica registado e vai no email ao cliente.' }),
        compra
          ? h('label', { class: 'check' }, extra, `Devolver as ${p.quantidade} unidades ao stock (voltam a estar à venda)`)
          : h('label', { class: 'check' }, extra, cancelaveis.includes(p.booking_status) ? 'Cancelar a marcação (o horário fica livre)' : 'A marcação já não se pode cancelar (já terminou ou foi cancelada)'),
        h('p', { class: 'hint' }, compra ? 'A compra fica como reembolsada.' : 'O valor sai do "Já pago" da marcação.', ' O cliente recebe um email a avisar.'),
        err,
        h('div', { class: 'modal-foot' },
          h('button', { class: 'btn btn-outline', type: 'button', onclick: close }, 'Cancelar'),
          confirmar)));
    });
  }

  function tabelaPagamentos(lista) {
    if (!lista.length) return null;
    const cur = app.settings.currency;
    const gestor = !app.user.studio_id;
    return h('section', { class: 'panel' },
      h('h2', {}, 'Pagamentos online'),
      h('p', { class: 'hint' }, 'Marcações e compras da loja pagas no site. Os pagos já contam no "Já pago" da marcação (ou na compra). "Reembolsar" devolve o dinheiro ao cliente.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, [['Referência', ''], ['Cliente', ''], ['Valor', 'num'], ['Estado', ''], ['Atualizado', ''], ['', '']]
          .map(([t, c]) => h('th', { scope: 'col', class: c }, t)))),
        h('tbody', {}, lista.map((p) => h('tr', {},
          h('td', {}, p.booking_code || '—', h('span', { class: 'sub' }, p.tipo === 'compra' ? `Compra · ${p.quantidade} × ${p.artigo}` : 'Marcação')),
          h('td', {}, p.client_name || '—'),
          h('td', { class: 'num' }, money(p.valor, cur)),
          h('td', {}, h('span', { class: 'tag', 'data-s': COR_PAG[p.estado] || '' }, nomeEstadoPag(p.estado)),
            p.estado === 'reembolsado' && p.reembolso_motivo ? h('span', { class: 'sub' }, p.reembolso_motivo) : null),
          h('td', {}, quando(p.estado === 'reembolsado' && p.reembolsado_em ? p.reembolsado_em : p.atualizado_em)),
          h('td', {}, gestor && p.estado === 'pago' && ['stripe', 'demo'].includes(p.fornecedor)
            ? h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => reembolsar(p) }, 'Reembolsar') : null)))))));
  }

  views.integracoes = {
    title: 'Integrações',
    async render(box) {
      const d = await api('/api/admin/integracoes');
      const sincronizar = async (id) => {
        try {
          const r = await api(`/api/admin/integracoes/${id}/sincronizar`, { method: 'POST' });
          toast(r.mensagem || `${r.guardados} lançamentos atualizados.` + (r.erros.length ? ` ${r.erros.length} com erros.` : ''), r.erros.length > 0);
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
