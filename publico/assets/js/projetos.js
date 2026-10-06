(function () {
  'use strict';
  // ---------------------------------------------------------------------------
  // Secção "Participa": projetos colaborativos e convocatórias (uma campanha
  // para novos talentos, um álbum coletivo…). Os dados vêm de
  // /api/integracoes/projetos; quem tem interesse deixa o contacto, que volta
  // ao painel do estúdio. A secção fica escondida se não houver projetos.
  // ---------------------------------------------------------------------------
  const { h, api, t, icone } = window.Studio;

  let projetos = [];

  const TIPO_CHAVE = { talentos: 'projetos.tipo.talentos', album: 'projetos.tipo.album', outro: 'projetos.tipo.outro' };
  const dataLonga = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString(window.Studio.I18N.locale, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  // ---------------------------------------------------------- Janela de interesse
  function abrirInteresse(p) {
    const nome = h('input', { type: 'text', maxlength: 80, required: true, autocomplete: 'name' });
    const contacto = h('input', { type: 'tel', maxlength: 40, autocomplete: 'tel' });
    const email = h('input', { type: 'email', maxlength: 120, autocomplete: 'email' });
    const link = h('input', { type: 'url', maxlength: 1000, placeholder: 'https://…' });
    const mensagem = h('textarea', { maxlength: 1000, rows: 3 });
    const err = h('p', { class: 'proj-erro', role: 'alert', hidden: true });

    const campo = (rotulo, control, opcional) => h('label', { class: 'proj-campo' },
      h('span', {}, rotulo, opcional && h('span', { class: 'proj-opc' }, ' ' + t('campo.opcional'))), control);

    const enviar = h('button', { class: 'btn btn-amber', type: 'submit' }, t('projetos.form.enviar'));
    const form = h('form', { class: 'proj-form' },
      campo(t('projetos.form.nome'), nome),
      campo(t('projetos.form.contacto'), contacto, true),
      campo(t('projetos.form.email'), email, true),
      campo(t('projetos.form.link'), link, true),
      campo(t('projetos.form.mensagem'), mensagem, true),
      err,
      h('div', { class: 'proj-form-foot' },
        h('button', { class: 'btn btn-outline', type: 'button', 'data-fechar': '' }, t('projetos.form.fechar')),
        enviar));

    const corpo = h('div', { class: 'proj-dlg-in' },
      h('div', { class: 'proj-dlg-head' },
        h('span', { class: 'proj-etiqueta' }, t(TIPO_CHAVE[p.tipo] || 'projetos.tipo.outro')),
        h('h3', {}, p.titulo)),
      p.resumo && h('p', { class: 'proj-dlg-sub' }, p.resumo),
      form);
    const dlg = h('dialog', { class: 'proj-dlg' }, corpo);

    const fechar = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) fechar(); });
    dlg.addEventListener('close', () => dlg.remove());
    corpo.querySelector('[data-fechar]').addEventListener('click', fechar);

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
        corpo.replaceChildren(h('div', { class: 'proj-feito' },
          icone('play', 30),
          h('h3', {}, t('projetos.form.obrigado')),
          h('p', {}, t('projetos.form.obrigadoTexto')),
          h('button', { class: 'btn btn-amber', type: 'button', onclick: fechar }, t('projetos.form.fechar'))));
      } catch (ex) {
        falha(ex.message);
        enviar.disabled = false;
        enviar.textContent = t('projetos.form.enviar');
      }
    });
    function falha(m) { err.textContent = m; err.hidden = false; }

    document.body.append(dlg);
    dlg.showModal();
    nome.focus();
  }

  // ---------------------------------------------------------- Cartões
  function cartao(p) {
    const capa = p.capa
      ? h('img', { class: 'proj-capa', src: p.capa, alt: '', loading: 'lazy', decoding: 'async' })
      : h('span', { class: 'proj-capa proj-capa-vazia', 'aria-hidden': 'true' }, icone('disco', 40));
    const acao = p.aberto
      ? h('button', { class: 'btn btn-amber btn-sm', type: 'button', onclick: () => abrirInteresse(p) }, t('projetos.participar'))
      : h('span', { class: 'proj-encerrado' }, t('projetos.encerradas'));
    return h('li', { class: 'proj-card surge' },
      capa,
      h('div', { class: 'proj-corpo' },
        h('span', { class: 'proj-etiqueta' }, t(TIPO_CHAVE[p.tipo] || 'projetos.tipo.outro')),
        h('h3', {}, p.titulo),
        p.resumo && h('p', { class: 'proj-resumo' }, p.resumo),
        p.descricao && h('p', { class: 'proj-desc' }, p.descricao),
        p.prazo && h('p', { class: 'proj-prazo' }, t('projetos.prazo', { data: dataLonga(p.prazo) })),
        h('div', { class: 'proj-acao' }, acao)));
  }

  function desenhar() {
    const seccao = document.getElementById('projetos');
    const lista = document.getElementById('projetos-lista');
    if (!seccao || !lista) return;
    if (!projetos.length) { seccao.hidden = true; return; }
    lista.replaceChildren(...projetos.map(cartao));
    seccao.hidden = false;
    for (const el of lista.querySelectorAll('.surge')) el.classList.add('visivel');
  }

  async function main() {
    try {
      const r = await api('/api/integracoes/projetos');
      projetos = Array.isArray(r.projetos) ? r.projetos : [];
    } catch (_) { projetos = []; }
    desenhar();
    // Mudar de língua só troca os rótulos; os dados já estão em memória.
    document.addEventListener('lingua', desenhar);
  }
  main();
})();
