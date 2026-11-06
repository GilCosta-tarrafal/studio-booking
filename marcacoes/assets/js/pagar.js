/* Página /pagar?code=…: pagar uma marcação que o estúdio já aceitou, ou uma
   compra da loja do site (artigos à venda em "Participa"; resumo.tipo ===
   'encomenda'). O fluxo é o mesmo; muda só o que se descreve.
   Quatro ecrãs: a carteira de cartões (com "Adicionar cartão"), a janela do
   cartão novo, o resumo com os serviços, o IVA e o total ("Pagar agora") e,
   pago, o recibo em forma de talão com "Baixar PDF".
   Com o Stripe ligado, as caixas do cartão são do Stripe (o número vai do
   browser direto para lá); na demonstração só se aceitam cartões de teste. */
(function () {
  'use strict';
  const S = window.Studio;
  const { h, t, api, money } = S;
  const app = document.getElementById('pg-app');
  const code = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase();
  const est = { modo: 'off', publicavel: '', resumo: null, cartoes: [], sel: null, stripe: null, destaque: false, opcao: 'sinal' };

  const cur = () => est.resumo.moeda;
  const valor = (n) => money(n, cur());
  const dia = (iso) => iso.split('-').reverse().join('/');
  const compra = () => est.resumo && est.resumo.tipo === 'encomenda';
  // Numa marcação com sinal por pagar, o cliente escolhe: só o sinal (o resto
  // paga no estúdio) ou tudo agora.
  const comEscolha = () => !compra() && est.resumo.sinal > 0 && est.resumo.sinal < est.resumo.total;
  const aPagar = () => (comEscolha() && est.opcao === 'sinal' ? est.resumo.sinal : est.resumo.total);
  const MARCAS = { visa: 'VISA', mastercard: 'mastercard', amex: 'AMEX', discover: 'DISCOVER', diners: 'DINERS', jcb: 'JCB', unionpay: 'UnionPay' };
  // Cartões de teste aceites na demonstração (os mesmos do Stripe em teste).
  const TESTE = { '4242424242424242': 'visa', '5555555555554444': 'mastercard', '4000056655665556': 'visa' };

  function marca(m, grande) {
    if (m === 'mastercard') return h('span', { class: 'pg-mc' + (grande ? ' grande' : ''), 'aria-label': 'Mastercard' }, h('i'), h('i'));
    return h('span', { class: 'pg-marca' + (grande ? ' grande' : '') }, MARCAS[m] || String(m || '').toUpperCase());
  }
  const validade = (c) => (c.mes ? String(c.mes).padStart(2, '0') + '/' + String(c.ano || '').slice(-2) : '');

  function ecra(...filhos) { app.replaceChildren(...filhos); window.scrollTo({ top: app.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' }); }
  function aviso(msg, comConsulta) {
    ecra(h('div', { class: 'pg-cartao-vazio pg-aviso' },
      h('p', {}, msg),
      comConsulta && !compra() && h('a', { class: 'btn btn-outline', href: '/consultar?code=' + encodeURIComponent(code) }, t('pg.verMarcacao'))));
  }

  // ---------------------------------------------------------- Arranque
  async function iniciar() {
    if (!code) return aviso(t('pg.semCodigo'));
    try {
      const cfg = await api('/api/pagamento/config');
      est.modo = cfg.modo; est.publicavel = cfg.publicavel;
      const r = await api('/api/pagamento/marcacao', { method: 'POST', body: { code } });
      est.resumo = r.resumo; est.cartoes = r.cartoes; est.sel = r.cartoes.length ? r.cartoes[0].id : null;
    } catch (e) {
      if (e.status === 401) {
        return ecra(h('div', { class: 'pg-cartao-vazio pg-aviso' }, h('p', {}, t('pg.entrar')),
          h('a', { class: 'btn', href: '/conta?next=' + encodeURIComponent('/pagar?code=' + code) }, t('conta.entrar'))));
      }
      return aviso(e.message, true);
    }
    if (!est.resumo.pode_pagar) return aviso(est.resumo.total <= 0 ? t('pg.nadaPagar') : t('pg.naoPagavel'), true);
    if (est.modo === 'off') return aviso(t('pg.indisponivel'), true);
    carteira();
  }

  // ---------------------------------------------------------- 1. Carteira
  function carteira() {
    const r = est.resumo;
    const frente = est.cartoes.find((c) => c.id === est.sel);
    const atras = est.cartoes.filter((c) => c.id !== est.sel).slice(0, 3);
    const cores = ['verde', 'laranja', 'azul'];
    const adicionar = h('button', { class: 'pg-add', type: 'button', onclick: janelaCartao }, h('span', { class: 'pg-add-i', 'aria-hidden': 'true' }, '+'), t('pg.adicionar'));

    const pilha = h('div', { class: 'pg-pilha' },
      atras.map((c, i) => h('button', {
        class: 'pg-cc pg-cc-tira ' + cores[i % cores.length], type: 'button', 'aria-label': `${MARCAS[c.marca] || c.marca} •••• ${c.ultimos}`,
        onclick: () => { est.sel = c.id; carteira(); },
      }, marca(c.marca), h('span', { class: 'pg-cc-num' }, '•••• •••• ' + c.ultimos))),
      frente
        ? h('div', { class: 'pg-cc pg-cc-frente' },
          h('div', { class: 'pg-cc-topo' }, marca(frente.marca, true), h('span', { class: 'pg-cc-num' }, '•••• •••• ' + frente.ultimos)),
          h('div', { class: 'pg-cc-meio' },
            h('div', {}, h('small', {}, t('pg.totalPagar')), h('strong', {}, valor(aPagar()))),
            h('div', { class: 'pg-cc-val' }, h('small', {}, t('pg.validade')), h('span', {}, validade(frente)))),
          h('div', { class: 'pg-cc-pe' }, h('div', {}, h('small', {}, t('pg.titular')), h('span', {}, frente.titular || '—'))))
        : h('div', { class: 'pg-cc pg-cc-frente pg-cc-nada' },
          h('small', {}, t('pg.totalPagar')), h('strong', {}, valor(aPagar())), h('p', {}, t('pg.semCartoes'))),
      adicionar);

    const remover = frente && h('button', {
      class: 'pg-link', type: 'button',
      onclick: async () => {
        if (!window.confirm(t('pg.removerConfirmar'))) return;
        const res = await api('/api/pagamento/cartoes/' + frente.id, { method: 'DELETE' });
        est.cartoes = res.cartoes; est.sel = est.cartoes.length ? est.cartoes[0].id : null; carteira();
      },
    }, t('pg.remover'));

    const seguinte = h('button', { class: 'btn btn-lg pg-seguinte' + (est.destaque ? ' pulsar' : ''), type: 'button', disabled: !frente, onclick: resumoEcra }, t('pg.seguinte'));
    est.destaque = false;
    ecra(
      est.modo === 'demo' && h('p', { class: 'notice info pg-demo' }, t('pg.demo')),
      h('section', { class: 'pg-painel' },
        h('header', { class: 'pg-cab' }, h('h2', {}, t('pg.cartoes')),
          h('span', { class: 'pg-ref' }, compra() ? `${r.code} · ${r.quantidade} × ${r.artigo}` : `${r.code} · ${r.studio} · ${dia(r.date)}`)),
        pilha,
        remover),
      seguinte);
  }

  // ---------------------------------------------------------- 2. Cartão novo
  function carregarStripe() {
    if (est.stripe) return Promise.resolve(est.stripe);
    return new Promise((ok, falha) => {
      const sc = document.createElement('script');
      sc.src = 'https://js.stripe.com/v3/';
      sc.onload = () => { est.stripe = window.Stripe(est.publicavel); ok(est.stripe); };
      sc.onerror = () => falha(new Error(t('pg.indisponivel')));
      document.head.append(sc);
    });
  }

  function janelaCartao() {
    const veu = h('div', { class: 'pg-veu' });
    const err = h('p', { class: 'notice error', role: 'alert', hidden: true });
    const btn = h('button', { class: 'btn btn-lg pg-sheet-btn', type: 'submit', disabled: true }, t('pg.adicionar'));
    const titular = h('input', { type: 'text', maxlength: 80, autocomplete: 'cc-name', id: 'pg-titular', placeholder: t('pg.nomeTitular') });
    const campo = (id, rot, el) => h('div', { class: 'pg-campo' }, h('label', { for: id }, rot), el);
    let corpo, completo, guardar;

    if (est.modo === 'stripe') {
      const caixas = { numero: h('div', { class: 'pg-input', id: 'pg-num' }), validade: h('div', { class: 'pg-input', id: 'pg-val' }), cvv: h('div', { class: 'pg-input', id: 'pg-cvv' }) };
      const feito = { numero: false, validade: false, cvv: false };
      let numEl = null;
      completo = () => feito.numero && feito.validade && feito.cvv;
      carregarStripe().then((stripe) => {
        const cor = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#111';
        const estilo = { base: { fontSize: '16px', color: cor, fontFamily: 'Instrument Sans, system-ui, sans-serif', '::placeholder': { color: '#9AA0A6' } } };
        const el = stripe.elements();
        const montar = (tipo, caixa, chave) => {
          const e = el.create(tipo, { style: estilo, placeholder: { cardNumber: '0000 0000 0000 0000', cardExpiry: 'MM/AA', cardCvc: '000' }[tipo] });
          e.mount(caixa);
          e.on('change', (ev) => { feito[chave] = ev.complete; err.hidden = !ev.error; if (ev.error) err.textContent = ev.error.message; btn.disabled = !completo(); });
          return e;
        };
        numEl = montar('cardNumber', caixas.numero, 'numero');
        montar('cardExpiry', caixas.validade, 'validade');
        montar('cardCvc', caixas.cvv, 'cvv');
      }).catch((e) => { err.textContent = e.message; err.hidden = false; });
      guardar = async () => {
        const { client_secret } = await api('/api/pagamento/cartoes/setup', { method: 'POST' });
        const { error, setupIntent } = await est.stripe.confirmCardSetup(client_secret, { payment_method: { card: numEl, billing_details: { name: titular.value || undefined } } });
        if (error) throw new Error(error.message);
        return api('/api/pagamento/cartoes', { method: 'POST', body: { payment_method: setupIntent.payment_method } });
      };
      corpo = [campo('pg-num', t('pg.numero'), caixas.numero),
        h('div', { class: 'pg-duas' }, campo('pg-val', t('pg.validade'), caixas.validade), campo('pg-cvv', t('pg.cvv'), caixas.cvv))];
    } else {
      // Demonstração: as caixas são nossas, mas só servem cartões de teste e
      // ao servidor só vai a marca, os 4 últimos dígitos e a validade.
      const num = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', id: 'pg-num', placeholder: '0000 0000 0000 0000', maxlength: 19 });
      const val = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', id: 'pg-val', placeholder: 'MM/AA', maxlength: 5 });
      const cvv = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', id: 'pg-cvv', placeholder: '000', maxlength: 4 });
      const digitos = () => num.value.replace(/\D/g, '');
      const mesAno = () => { const m = /^(\d{2})\/(\d{2})$/.exec(val.value); return m && +m[1] >= 1 && +m[1] <= 12 ? [+m[1], 2000 + +m[2]] : null; };
      completo = () => digitos().length === 16 && !!mesAno() && /^\d{3,4}$/.test(cvv.value);
      num.addEventListener('input', () => { num.value = digitos().slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 '); btn.disabled = !completo(); });
      val.addEventListener('input', () => { const d = val.value.replace(/\D/g, '').slice(0, 4); val.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; btn.disabled = !completo(); });
      cvv.addEventListener('input', () => { cvv.value = cvv.value.replace(/\D/g, '').slice(0, 4); btn.disabled = !completo(); });
      guardar = async () => {
        const n = digitos();
        if (!TESTE[n]) throw new Error(t('pg.soTeste'));
        const [mes, ano] = mesAno();
        return api('/api/pagamento/cartoes', { method: 'POST', body: { marca: TESTE[n], ultimos: n.slice(-4), mes, ano, titular: titular.value } });
      };
      corpo = [h('p', { class: 'hint pg-teste' }, t('pg.soTeste')), campo('pg-num', t('pg.numero'), h('div', { class: 'pg-input' }, num)),
        h('div', { class: 'pg-duas' }, campo('pg-val', t('pg.validade'), h('div', { class: 'pg-input' }, val)), campo('pg-cvv', t('pg.cvv'), h('div', { class: 'pg-input' }, cvv)))];
    }

    const fechar = () => { veu.classList.add('saindo'); setTimeout(() => veu.remove(), 200); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('keydown', esc);
    veu.addEventListener('mousedown', (e) => { if (e.target === veu) fechar(); });
    const form = h('form', {
      class: 'pg-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pg-sheet-t',
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        if (!completo()) { err.textContent = t('pg.cartaoInvalido'); err.hidden = false; return; }
        btn.disabled = true;
        try {
          const res = await guardar();
          est.cartoes = res.cartoes; est.sel = est.cartoes.length ? est.cartoes[0].id : null; est.destaque = true;
          fechar(); carteira();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
      },
    },
    h('span', { class: 'pg-alca', 'aria-hidden': 'true' }),
    h('h2', { id: 'pg-sheet-t' }, t('pg.adicionar')),
    h('p', { class: 'hint' }, t('pg.adicionarLead')),
    ...corpo,
    campo('pg-titular', t('pg.nomeTitular'), h('div', { class: 'pg-input' }, titular)),
    err, btn);
    veu.append(form);
    document.body.append(veu);
    setTimeout(() => { const p = form.querySelector('input'); if (p) p.focus(); }, 50);
  }

  // ---------------------------------------------------------- 3. Resumo
  function resumoEcra() {
    const r = est.resumo;
    const pct = r.itens[0].valor ? Math.round((r.ja_pago / r.itens[0].valor) * 100) : 0;
    const linha = (k, v, cls) => h('div', { class: 'pg-linha' + (cls ? ' ' + cls : '') }, h('span', {}, k), h('strong', {}, v));
    const pagar = h('button', { class: 'btn btn-lg pg-pagar', type: 'button', onclick: () => pagarAgora(pagar) }, t('pg.pagar'));
    const err = h('p', { class: 'notice error', role: 'alert', hidden: true, id: 'pg-err' });

    const metodos = h('div', { class: 'pg-metodos', role: 'radiogroup', 'aria-label': t('pg.metodo') },
      est.cartoes.map((c) => h('label', { class: 'pg-metodo' + (c.id === est.sel ? ' sel' : '') },
        h('span', { class: 'pg-metodo-marca' }, marca(c.marca)),
        h('span', { class: 'pg-metodo-txt' }, h('strong', {}, (MARCAS[c.marca] || c.marca).replace(/^mastercard$/, 'Mastercard')), h('small', {}, '•••• ' + c.ultimos)),
        h('input', { type: 'radio', name: 'pg-cartao', value: c.id, checked: c.id === est.sel, onchange: () => { est.sel = c.id; resumoEcra(); } }))));

    const opcao = (k, titulo, sub, v) => h('label', { class: 'pg-metodo' + (est.opcao === k ? ' sel' : '') },
      h('span', { class: 'pg-metodo-txt' }, h('strong', {}, titulo), h('small', {}, sub)),
      h('strong', { class: 'pg-opcao-valor' }, valor(v)),
      h('input', { type: 'radio', name: 'pg-opcao', value: k, checked: est.opcao === k, onchange: () => { est.opcao = k; resumoEcra(); } }));
    const escolha = comEscolha() && [
      h('h2', { class: 'pg-sub' }, t('pg.comoPagar')),
      h('div', { class: 'pg-metodos', role: 'radiogroup', 'aria-label': t('pg.comoPagar') },
        opcao('sinal', t('pg.opSinal', { pct: r.sinal_pct }), t('pg.opSinalSub', { resto: valor(r.total - r.sinal) }), r.sinal),
        opcao('total', t('pg.opTotal'), t('pg.opTotalSub'), r.total))];

    ecra(
      h('button', { class: 'pg-link pg-voltar', type: 'button', onclick: carteira }, '← ' + t('pg.voltar')),
      compra()
        // Compra: as unidades ficam reservadas enquanto se paga.
        ? h('section', { class: 'pg-painel pg-estado' },
          h('div', { class: 'pg-estado-cab' }, h('span', { class: 'pg-visto', 'aria-hidden': 'true' }, '✓'),
            h('div', {}, h('strong', {}, t('pg.reservado')), h('small', {}, t('pg.reservadoSub', { min: r.reserva_min })))))
        : h('section', { class: 'pg-painel pg-estado' },
          h('div', { class: 'pg-estado-cab' }, h('span', { class: 'pg-visto', 'aria-hidden': 'true' }, '✓'),
            h('div', {}, h('strong', {}, t('pg.aceite')), h('small', {}, t('pg.aceiteSub')))),
          h('div', { class: 'pg-barra', role: 'img', 'aria-label': `${pct}%` }, h('span', { style: { width: Math.max(pct, 3) + '%' } })),
          h('div', { class: 'pg-barra-leg' }, h('small', {}, `${t('pg.jaPago')} ${valor(r.ja_pago)}`), h('small', {}, `${t('pg.total')} ${valor(r.itens[0].valor)}`))),
      h('section', { class: 'pg-painel' },
        compra()
          ? [linha(t('pg.codigo'), r.code), linha(t('pg.artigo'), r.artigo), linha(t('pg.quantidade'), `${r.quantidade} × ${valor(r.preco_unit)}`)]
          : [linha(t('pg.codigo'), r.code), linha(t('pg.estudio'), r.studio), linha(t('pg.data'), dia(r.date)),
            linha(t('pg.sala'), r.room), linha(t('pg.horario'), `${r.start}–${r.end}`)],
        h('hr'),
        r.itens.map((i) => h('div', { class: 'pg-linha pg-item' }, h('span', {}, i.descricao, h('small', {}, i.detalhe)), h('strong', {}, valor(i.valor)))),
        r.ja_pago > 0 && linha(t('pg.jaPago'), '− ' + valor(r.ja_pago), 'suave'),
        r.taxa != null && linha(t('pg.subtotal', { imposto: r.imposto_nome }), valor(r.base), 'suave'),
        r.taxa != null && linha(t('pg.imposto', { imposto: r.imposto_nome, taxa: String(r.taxa).replace('.', ',') }), valor(r.imposto), 'suave'),
        h('hr'),
        linha(t('pg.total'), valor(r.total), 'total')),
      escolha,
      h('h2', { class: 'pg-sub' }, t('pg.metodo')),
      metodos,
      err,
      h('div', { class: 'pg-rodape' }, h('div', {}, h('small', {}, t('pg.totalPagar')), h('strong', {}, valor(aPagar()))), pagar));
  }

  async function pagarAgora(btn) {
    const err = document.getElementById('pg-err');
    err.hidden = true;
    btn.disabled = true; btn.textContent = t('pg.aPagar');
    try {
      let r = await api('/api/pagamento/pagar', { method: 'POST', body: { code, cartao_id: est.sel, opcao: comEscolha() ? est.opcao : 'total' } });
      if (r.estado === 'acao') {
        // O banco pede uma confirmação extra (3D Secure): trata-a o Stripe.
        const stripe = await carregarStripe();
        const { error } = await stripe.handleNextAction({ clientSecret: r.client_secret });
        if (error) throw new Error(error.message);
        r = await api('/api/pagamento/confirmar', { method: 'POST', body: { code, intent: r.intent } });
      }
      recibo(r.recibo);
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
      btn.disabled = false; btn.textContent = t('pg.pagar');
    }
  }

  // ---------------------------------------------------------- 4. Recibo (talão)
  function codigoBarras(txt) {
    let x = 0;
    for (const ch of txt) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
    const barras = [];
    for (let i = 0; i < 64; i++) { x = (x * 1103515245 + 12345) >>> 0; barras.push(h('i', { style: { width: (1 + (x % 3)) + 'px', marginRight: (1 + ((x >> 8) % 2)) + 'px' } })); }
    return h('div', { class: 'tl-barras', 'aria-hidden': 'true' }, barras);
  }

  function recibo(r) {
    const e = r.empresa, m = r.marcacao, c = r.compra;
    const quando = new Date(r.pago_em).toLocaleString(S.I18N.locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const linha = (k, v, forte) => h('div', { class: 'tl-linha' + (forte ? ' forte' : '') }, h('span', {}, k), h('span', {}, v));
    ecra(
      h('div', { class: 'pg-pago' }, h('span', { class: 'pg-visto grande', 'aria-hidden': 'true' }, '✓'),
        h('div', {}, h('strong', {}, t('pg.pago')), h('small', {}, t('pg.pagoSub')))),
      h('article', { class: 'tl', 'aria-label': t('pg.rTitulo') },
        h('img', { class: 'tl-logo', src: '/img/logo.png', alt: e.nome, width: 46, height: 46 }),
        h('h2', { class: 'tl-nome' }, e.nome.toUpperCase()),
        e.frase && h('p', { class: 'tl-frase' }, e.frase),
        h('p', { class: 'tl-empresa' }, [e.legal !== e.nome && e.legal, e.nif && 'NIF ' + e.nif, e.telefone && 'Tel ' + e.telefone, e.email, e.morada].filter(Boolean).join(' · ')),
        h('p', { class: 'tl-titulo' }, t('pg.rTitulo').toUpperCase()),
        h('hr'),
        linha(t('pg.rRecibo').toUpperCase(), r.numero), linha(t('pg.data').toUpperCase(), quando.toUpperCase()),
        c
          ? [linha(t('pg.rCompra').toUpperCase(), c.code), linha(t('pg.rCliente').toUpperCase(), c.cliente),
            h('hr'),
            linha(c.artigo, valor(r.valor)), linha(t('pg.quantidade'), `${c.quantidade} × ${valor(c.preco_unit)}`)]
          : [linha(t('pg.estudio').toUpperCase(), m.studio), linha(t('pg.sala').toUpperCase(), m.room),
            linha(t('pg.codigo').toUpperCase(), m.code), linha(t('pg.rSessao').toUpperCase(), `${dia(m.date)} ${m.start}-${m.end}`),
            linha(t('pg.rCliente').toUpperCase(), m.cliente),
            h('hr'),
            linha(m.servico, valor(r.valor)), linha(t('pg.rDuracao'), `${m.minutos / 60} h`)],
        r.taxa != null && linha(t('pg.rBase'), valor(r.base)),
        r.taxa != null && linha(`${r.imposto_nome} ${String(r.taxa).replace('.', ',')}%`, valor(r.imposto)),
        h('hr'),
        h('div', { class: 'tl-total' }, h('span', {}, t('pg.total').toUpperCase()),
          h('span', { class: 'tl-carimbo', 'aria-hidden': 'true' }, h('b', {}, t('pg.rCarimbo')), h('small', {}, new Date(r.pago_em).toLocaleDateString(S.I18N.locale, { day: '2-digit', month: '2-digit', year: 'numeric' }))),
          h('strong', {}, valor(r.valor))),
        linha(t('pg.rPagoCom').toUpperCase(), r.cartao.ultimos ? `${(MARCAS[r.cartao.marca] || r.cartao.marca).toUpperCase()} •••• ${r.cartao.ultimos}` : '—'),
        linha(t('pg.rEstado').toUpperCase(), t('pg.rAprovado').toUpperCase(), true),
        r.demo && h('p', { class: 'tl-demo' }, t('pg.rDemo')),
        codigoBarras(r.numero),
        h('p', { class: 'tl-num' }, r.numero.split('').join(' ')),
        h('p', { class: 'tl-obrigado' }, t('pg.obrigado', { nome: e.nome }))),
      h('div', { class: 'pg-acoes' },
        h('a', { class: 'btn btn-lg', href: `/api/pagamento/recibo/${r.id}/pdf`, download: `recibo-pagamento-${r.numero}.pdf` }, t('pg.baixar')),
        c ? h('a', { class: 'btn btn-outline btn-lg', href: '/#projetos' }, t('pg.voltarLoja'))
          : h('a', { class: 'btn btn-outline btn-lg', href: '/consultar?code=' + encodeURIComponent(m.code) }, t('pg.verMarcacao'))));
  }

  iniciar();
})();
