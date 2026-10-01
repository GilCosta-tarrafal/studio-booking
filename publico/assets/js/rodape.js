'use strict';
// ---------------------------------------------------------------------------
// O rodapé do site: contactos, redes e horário.
//
// Vive num ficheiro à parte porque as três páginas públicas o usam. Não vai
// buscar a configuração ao servidor — recebe-a de quem já a pediu (a página
// inicial, o formulário de marcação, a consulta), para não haver dois pedidos
// iguais na mesma página.
//
// Chama-se Studio.renderRodape(cfg), e outra vez quando a língua muda.
// ---------------------------------------------------------------------------
(function () {
  const S = window.Studio;
  const { h, t, telLink, waLink, hoursSummary, icone } = S;

  // Cada contacto leva o seu ícone, como no rodapé de referência.
  function linhaContacto(nome, texto, href) {
    const corpo = href ? h('a', { href, rel: 'noopener' }, texto) : h('span', {}, texto);
    return h('li', {}, icone(nome, 18), corpo);
  }

  // Só entram endereços http(s): o campo é livre e vai parar a um href.
  function endereco(v) {
    try { const u = new URL(String(v || '').trim()); return /^https?:$/.test(u.protocol) ? u.href : null; }
    catch (_) { return null; }
  }

  function renderSocial(b) {
    const ul = document.getElementById('social');
    if (!ul) return;
    const redes = [['instagram', 'Instagram'], ['spotify', 'Spotify'], ['youtube', 'YouTube']];
    const items = [];
    for (const [k, nome] of redes) {
      const url = endereco(b[k]);
      // Os botões aparecem sempre. Sem endereço ficam apagados e não clicáveis,
      // em vez de prometerem uma página que não existe.
      items.push(h('li', {}, url
        ? h('a', { href: url, target: '_blank', rel: 'noopener', 'data-rede': k, 'aria-label': nome, title: nome }, icone(k, 22))
        : h('span', { class: 'por-definir', title: t('rede.porDefinir', { rede: nome }), 'aria-label': t('rede.porDefinirAria', { rede: nome }) }, icone(k, 22))));
    }
    ul.replaceChildren(...items);
    ul.hidden = false;
  }

  // Horário: um só, válido para a casa toda. Se um dia os estúdios passarem a
  // abrir a horas diferentes, cada um volta a mostrar o seu — mais vale
  // repetir do que anunciar horas erradas.
  function renderHorario(cfg) {
    const box = document.getElementById('footer-hours');
    if (!box || !cfg.studios.length) return;
    const resumos = cfg.studios.map((s) => hoursSummary(s.hours));
    const assinatura = (r) => r.map((g) => g.days + g.hours).join('|');
    const todosIguais = resumos.every((r) => assinatura(r) === assinatura(resumos[0]));

    const lista = (grupos) => h('ul', { class: 'horario-list' },
      grupos.map((g) => h('li', {},
        h('span', { class: 'd' }, g.days),
        h('span', { class: g.closed ? 'closed' : '' }, g.closed ? t('rodape.encerrado') : g.hours))));

    box.replaceChildren(...(todosIguais
      ? [h('div', { class: 'horario' }, lista(resumos[0]))]
      : cfg.studios.map((s, i) => h('div', { class: 'horario' },
        h('p', { class: 'horario-estudio' }, s.name),
        lista(resumos[i])))));
  }

  function renderRodape(cfg) {
    if (!cfg || !document.getElementById('contacts')) return;
    const b = cfg.business;
    const items = [];
    const morada = cfg.studios.map((s) => [s.city, s.address].filter(Boolean).join(', ')).filter(Boolean)[0];
    if (morada) items.push(linhaContacto('local', morada, null));
    const tel = telLink(b.phone);
    if (tel) items.push(linhaContacto('telefone', b.phone, tel));
    // Mesmo quando é o número do telefone, vale a linha própria: ligar e
    // mandar mensagem são coisas diferentes para quem marca.
    const wa = waLink(b, b.whatsapp);
    if (wa) items.push(linhaContacto('whatsapp', b.whatsapp, wa));
    if (b.email && /^[^\s@]+@[^\s@]+$/.test(b.email)) items.push(linhaContacto('email', b.email, 'mailto:' + b.email));
    for (const s of cfg.studios) {
      const t2 = telLink(s.phone);
      if (t2 && s.phone !== b.phone) items.push(linhaContacto('telefone', `${s.name}: ${s.phone}`, t2));
    }
    if (items.length) document.getElementById('contacts').replaceChildren(...items);
    renderSocial(b);
    renderHorario(cfg);
  }

  S.renderRodape = renderRodape;
})();
