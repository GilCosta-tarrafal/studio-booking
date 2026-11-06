(function () {
  'use strict';
  // ---------------------------------------------------------------------------
  // Secção "Participa": projetos colaborativos e convocatórias (uma campanha
  // para novos talentos, um álbum coletivo…). Os dados vêm de
  // /api/integracoes/projetos; quem tem interesse deixa o contacto, que volta
  // ao painel do estúdio. A secção fica escondida se não houver projetos.
  // ---------------------------------------------------------------------------
  const { h, api, t, icone, money } = window.Studio;

  let projetos = [];
  let moeda = '';
  const preco = (n) => money(n, moeda);
  const restam = (n) => (n === 1 ? t('projetos.disponivel1') : t('projetos.disponiveis', { n }));

  // Slide das imagens de um projeto: com mais de uma, troca de 15 em 15
  // segundos, com transição suave (em ecrãs com "reduzir movimento", troca sem
  // animação). Os pontos por baixo deixam escolher uma; escolher recomeça a
  // contagem. Os relógios guardam-se para se pararem ao redesenhar.
  const SLIDE_MS = 15000;
  let relogios = [];
  function slide(capas, titulo, guardar = relogios) {
    const imgs = capas.map((src, i) => h('img', {
      class: 'proj-capa proj-slide-img' + (i === 0 ? ' ativa' : ''), src, alt: '',
      loading: i === 0 ? 'lazy' : 'eager', decoding: 'async', 'aria-hidden': i === 0 ? null : 'true',
    }));
    let atual = 0;
    let relogio = null;
    const pontos = capas.map((_, i) => h('button', {
      type: 'button', class: 'proj-ponto' + (i === 0 ? ' ativo' : ''),
      'aria-label': `${titulo}: imagem ${i + 1} de ${capas.length}`, 'aria-current': i === 0 ? 'true' : null,
      onclick: () => { ir(i); recomecar(); },
    }));
    function ir(i) {
      imgs[atual].classList.remove('ativa'); imgs[atual].setAttribute('aria-hidden', 'true');
      pontos[atual].classList.remove('ativo'); pontos[atual].removeAttribute('aria-current');
      atual = i;
      imgs[atual].classList.add('ativa'); imgs[atual].removeAttribute('aria-hidden');
      pontos[atual].classList.add('ativo'); pontos[atual].setAttribute('aria-current', 'true');
    }
    function recomecar() {
      clearInterval(relogio);
      relogio = setInterval(() => { if (!document.hidden) ir((atual + 1) % imgs.length); }, SLIDE_MS);
      guardar.push(relogio);
    }
    recomecar();
    return h('div', { class: 'proj-slide' }, ...imgs, h('div', { class: 'proj-pontos' }, ...pontos));
  }

  const TIPO_CHAVE = { talentos: 'projetos.tipo.talentos', album: 'projetos.tipo.album', publicidade: 'projetos.tipo.publicidade', vendas: 'projetos.tipo.vendas', outro: 'projetos.tipo.outro' };
  // Tipo criado em Configurações (o nome vem do painel, tal como foi escrito); os do sistema vêm traduzidos.
  const rotuloTipo = (p) => p.tipo_nome || t(TIPO_CHAVE[p.tipo] || 'projetos.tipo.outro');
  const dataLonga = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString(window.Studio.I18N.locale, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // ---------------------------------------------------------- Janela do projeto
  // Abre ao carregar no cartão: as imagens (em slide, se houver várias), a
  // descrição toda e o prazo. Num projeto aberto há o botão "Tenho interesse",
  // que troca para o formulário; enviado, fica a mensagem de que o pedido vai
  // ser analisado. Uma publicidade é só um anúncio: não tem botão nenhum.
  const recebeInteresse = (p) => p.tipo !== 'publicidade' && p.aberto;
  const capasDe = (p) => (Array.isArray(p.capas) && p.capas.length ? p.capas : (p.capa ? [p.capa] : []));

  function abrirProjeto(p, { formulario = false } = {}) {
    const meus = [];   // relógios do slide desta janela (param ao fechar)
    const corpo = h('div', { class: 'proj-dlg-in' });
    // Como o h(): ignora o que for falso (null, false, '') e aceita listas.
    const pôr = (...filhos) => corpo.replaceChildren(...filhos.flat(Infinity).filter((k) => k || k === 0));
    const dlg = h('dialog', { class: 'proj-dlg proj-dlg-largo', 'aria-label': p.titulo }, corpo);
    const fechar = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) fechar(); });
    dlg.addEventListener('close', () => { for (const r of meus) clearInterval(r); dlg.remove(); });

    const cabeca = () => h('div', { class: 'proj-dlg-head' },
      h('span', { class: 'proj-etiqueta' }, rotuloTipo(p)),
      h('h3', {}, p.titulo));
    const botaoFechar = (cls = 'btn btn-outline') => h('button', { class: cls, type: 'button', onclick: fechar }, t('projetos.form.fechar'));

    function verDetalhe() {
      const capas = capasDe(p);
      const imagem = capas.length > 1 ? slide(capas, p.titulo, meus)
        : capas.length ? h('img', { class: 'proj-capa', src: capas[0], alt: '' }) : null;
      pôr(
        imagem && h('div', { class: 'proj-dlg-img' }, imagem),
        cabeca(),
        p.resumo && h('p', { class: 'proj-dlg-sub' }, p.resumo),
        p.descricao && h('p', { class: 'proj-dlg-desc' }, p.descricao),
        p.prazo && h('p', { class: 'proj-prazo' }, t('projetos.prazo', { data: dataLonga(p.prazo) })),
        p.tipo === 'vendas' ? blocoCompra()
          : [p.tipo !== 'publicidade' && !p.aberto && h('p', { class: 'proj-encerrado' }, t('projetos.encerradas')),
            h('div', { class: 'proj-form-foot' },
              botaoFechar(),
              recebeInteresse(p) && h('button', { class: 'btn btn-amber', type: 'button', onclick: verFormulario }, t('projetos.tenhoInteresse')))]);
    }

    // Artigo à venda: escolher a quantidade (até às unidades disponíveis), ver
    // o total e comprar. Cria a encomenda e segue para a página de pagamento,
    // a mesma das marcações. Sem conta, pede para entrar e volta aqui.
    function blocoCompra() {
      const max = Math.max(1, Math.min(p.disponivel || 1, 99));
      const qtd = h('input', { type: 'number', min: 1, max, step: 1, value: 1, inputmode: 'numeric', 'aria-label': t('projetos.quantidade') });
      const total = h('strong', { class: 'proj-total' }, preco(p.preco));
      const err = h('p', { class: 'proj-erro', role: 'alert', hidden: true });
      const ler = () => Math.min(max, Math.max(1, Math.round(Number(qtd.value) || 1)));
      const pintar = () => { total.textContent = preco(p.preco * ler()); menos.disabled = ler() <= 1; mais.disabled = ler() >= max; };
      const mudar = (d) => { qtd.value = String(Math.min(max, Math.max(1, ler() + d))); pintar(); };
      const menos = h('button', { class: 'btn btn-outline btn-sm proj-qtd-btn', type: 'button', 'aria-label': '−1', onclick: () => mudar(-1) }, '−');
      const mais = h('button', { class: 'btn btn-outline btn-sm proj-qtd-btn', type: 'button', 'aria-label': '+1', onclick: () => mudar(1) }, '+');
      qtd.addEventListener('input', pintar);
      qtd.addEventListener('change', () => { qtd.value = String(ler()); pintar(); });
      const comprar = h('button', { class: 'btn btn-amber', type: 'button' }, t('projetos.comprar'));
      comprar.addEventListener('click', async () => {
        err.hidden = true;
        comprar.disabled = true;
        comprar.textContent = t('projetos.aComprar');
        try {
          const r = await api('/api/integracoes/encomendas', { method: 'POST', body: { projeto_id: p.id, quantidade: ler() } });
          location.assign(r.pagar);
        } catch (ex) {
          if (ex.status === 401) {
            err.replaceChildren(t('projetos.entrarComprar'), ' ',
              h('a', { href: '/conta?next=' + encodeURIComponent('/#projetos') }, t('conta.entrar')));
          } else err.textContent = ex.message;
          err.hidden = false;
          comprar.disabled = false;
          comprar.textContent = t('projetos.comprar');
        }
      });
      pintar();
      return [
        h('div', { class: 'proj-compra' },
          h('div', { class: 'proj-preco-linha' }, h('span', { class: 'proj-preco' }, preco(p.preco)), h('span', { class: 'proj-restam' }, restam(p.disponivel))),
          h('div', { class: 'proj-qtd' },
            h('span', {}, t('projetos.quantidade')),
            h('div', { class: 'proj-qtd-ctl' }, menos, qtd, mais)),
          h('div', { class: 'proj-preco-linha' }, h('span', {}, t('projetos.total')), total)),
        err,
        h('div', { class: 'proj-form-foot' }, botaoFechar(), comprar),
      ];
    }

    function verFormulario() {
      const nome = h('input', { type: 'text', maxlength: 80, required: true, autocomplete: 'name' });
      const contacto = h('input', { type: 'tel', maxlength: 40, autocomplete: 'tel' });
      const email = h('input', { type: 'email', maxlength: 120, autocomplete: 'email' });
      const link = h('input', { type: 'url', maxlength: 1000, placeholder: 'https://…' });
      const mensagem = h('textarea', { maxlength: 1000, rows: 3 });
      const err = h('p', { class: 'proj-erro', role: 'alert', hidden: true });
      const falha = (m) => { err.textContent = m; err.hidden = false; };
      const campo = (rotulo, control, opcional) => h('label', { class: 'proj-campo' },
        h('span', {}, rotulo, opcional && h('span', { class: 'proj-opc' }, ' ' + t('campo.opcional'))), control);
      const enviar = h('button', { class: 'btn btn-amber', type: 'submit' }, t('projetos.form.enviar'));
      const voltar = h('button', { class: 'btn btn-outline', type: 'button', onclick: verDetalhe }, t('projetos.voltar'));
      const form = h('form', { class: 'proj-form' },
        campo(t('projetos.form.nome'), nome),
        campo(t('projetos.form.contacto'), contacto, true),
        campo(t('projetos.form.email'), email, true),
        campo(t('projetos.form.link'), link, true),
        campo(t('projetos.form.mensagem'), mensagem, true),
        err,
        h('div', { class: 'proj-form-foot' }, voltar, enviar));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.hidden = true;
        if (!nome.value.trim()) return falha(t('projetos.form.erroNome'));
        if (!contacto.value.trim() && !email.value.trim()) return falha(t('projetos.form.erroContacto'));
        enviar.disabled = true;
        enviar.textContent = t('projetos.form.aEnviar');
        try {
          await api(`/api/integracoes/projetos/${p.id}/interesse`, {
            method: 'POST',
            body: { nome: nome.value, contacto: contacto.value, email: email.value, link: link.value, mensagem: mensagem.value },
          });
          for (const r of meus) clearInterval(r);
          pôr(h('div', { class: 'proj-feito', role: 'status' },
            icone('play', 30),
            h('h3', {}, t('projetos.form.obrigado')),
            h('p', {}, t('projetos.form.obrigadoTexto')),
            botaoFechar('btn btn-amber')));
        } catch (ex) {
          falha(ex.message);
          enviar.disabled = false;
          enviar.textContent = t('projetos.form.enviar');
        }
      });
      pôr(cabeca(), p.resumo && h('p', { class: 'proj-dlg-sub' }, p.resumo), form);
      nome.focus();
    }

    document.body.append(dlg);
    dlg.showModal();
    if (formulario && recebeInteresse(p)) verFormulario(); else verDetalhe();
  }

  // ---------------------------------------------------------- Cartões
  // O cartão inteiro abre a janela do projeto (também com Enter ou Espaço). O
  // botão "Manifestar interesse" vai direto ao formulário; a publicidade não o tem.
  function cartao(p) {
    const capas = capasDe(p);
    const capa = capas.length > 1 ? slide(capas, p.titulo)
      : capas.length ? h('img', { class: 'proj-capa', src: capas[0], alt: '', loading: 'lazy', decoding: 'async' })
        : h('span', { class: 'proj-capa proj-capa-vazia', 'aria-hidden': 'true' }, icone('disco', 40));
    const acao = p.tipo === 'publicidade' ? null
      : p.tipo === 'vendas'
        ? h('button', { class: 'btn btn-amber btn-sm', type: 'button', onclick: (e) => { e.stopPropagation(); abrirProjeto(p); } }, t('projetos.comprar'))
        : p.aberto
        ? h('button', { class: 'btn btn-amber btn-sm', type: 'button', onclick: (e) => { e.stopPropagation(); abrirProjeto(p, { formulario: true }); } }, t('projetos.participar'))
        : h('span', { class: 'proj-encerrado' }, t('projetos.encerradas'));
    const li = h('li', {
      class: 'proj-card proj-card-abre surge', tabindex: '0', role: 'button',
      'aria-label': t('projetos.abrir', { titulo: p.titulo }),
    },
      capa,
      h('div', { class: 'proj-corpo' },
        h('span', { class: 'proj-etiqueta' }, rotuloTipo(p)),
        h('h3', {}, p.titulo),
        p.resumo && h('p', { class: 'proj-resumo' }, p.resumo),
        p.descricao && h('p', { class: 'proj-desc proj-desc-curta' }, p.descricao),
        p.tipo === 'vendas' && h('p', { class: 'proj-preco-linha' }, h('span', { class: 'proj-preco' }, preco(p.preco)), h('span', { class: 'proj-restam' }, restam(p.disponivel))),
        p.prazo && h('p', { class: 'proj-prazo' }, t('projetos.prazo', { data: dataLonga(p.prazo) })),
        acao && h('div', { class: 'proj-acao' }, acao)));
    // Os pontos do slide escolhem a imagem; não abrem a janela.
    li.addEventListener('click', (e) => { if (!e.target.closest('.proj-ponto')) abrirProjeto(p); });
    li.addEventListener('keydown', (e) => {
      if (e.target !== li || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      abrirProjeto(p);
    });
    return li;
  }

  function desenhar() {
    const seccao = document.getElementById('projetos');
    const lista = document.getElementById('projetos-lista');
    if (!seccao || !lista) return;
    for (const r of relogios) clearInterval(r);
    relogios = [];
    if (!projetos.length) { seccao.hidden = true; return; }
    lista.replaceChildren(...projetos.map(cartao));
    seccao.hidden = false;
    for (const el of lista.querySelectorAll('.surge')) el.classList.add('visivel');
  }

  async function main() {
    try {
      const r = await api('/api/integracoes/projetos');
      projetos = Array.isArray(r.projetos) ? r.projetos : [];
      moeda = r.moeda || '';
    } catch (_) { projetos = []; }
    desenhar();
    // Mudar de língua só troca os rótulos; os dados já estão em memória.
    document.addEventListener('lingua', desenhar);
  }
  main();
})();
