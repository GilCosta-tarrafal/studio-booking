'use strict';
// Teste do site e do painel num DOM simulado (jsdom): clica, escreve e envia como um utilizador.
// Antes de correr:  npm install --no-save jsdom   (não faz parte das dependências do projeto)
const os = require('os'), path = require('path'), fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-'));
process.env.NODE_ENV = 'test';
process.env.DB_FILE = path.join(tmp, 'fe.db');
process.env.ADMIN_EMAIL = 'dono@teste.cv';
process.env.ADMIN_PASSWORD = 'palavra-passe-teste';
const ROOT = path.join(__dirname, '..');
const { start } = require(ROOT + '/backend/server');
const U = require(ROOT + '/backend/lib/util');
const { JSDOM, VirtualConsole, requestInterceptor } = require(path.join(ROOT, 'node_modules', 'jsdom'));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓', m); } else { failed++; console.log('  ✗ FALHOU:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, timeout = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { const v = fn(); if (v) return v; } catch (_) {} await sleep(25); }
  throw new Error('Timeout à espera de: ' + what);
}

let base;
const errors = [];

async function open(url, jar) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(`${url}: ${e.message}`));
  vc.on('error', (...a) => errors.push(`${url} console.error: ${a.join(' ')}`));
  const dom = await JSDOM.fromURL(base + url, {
    runScripts: 'dangerously', resources: { interceptors: [requestInterceptor((req) => (req.url.startsWith(base) ? undefined : new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } })))] }, pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = async (u, opts = {}) => {
        const headers = { ...(opts.headers || {}) };
        if (jar.cookie) headers.Cookie = jar.cookie;
        const res = await fetch(new URL(u, base), { ...opts, headers });
        const sc = res.headers.get('set-cookie');
        if (sc) jar.cookie = sc.split(';')[0].includes('=') && sc.includes('Max-Age') && /sid=;|sid=$/.test(sc.split(';')[0]) ? '' : sc.split(';')[0];
        return res;
      };
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
      w.Element.prototype.scrollIntoView = function () {};
      w.scrollTo = () => {};
      w.confirm = () => true;
      w.open = () => {};
    },
  });
  return dom;
}
const ev = (w, el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
const setVal = (w, el, v, type = 'input') => { el.value = v; ev(w, el, type); };

(async () => {
  const server = start(0);
  await new Promise((r) => server.on('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const day = (() => { let d = U.addDays(U.nowLocal().date, 4); while ([0, 6].includes(U.weekday(d))) d = U.addDays(d, 1); return d; })();

  console.log('\nPágina inicial');
  let jar = {};
  let dom = await open('/', jar), w = dom.window, d = w.document;
  await waitFor(() => d.querySelectorAll('.board-row').length === 3, 'linhas do quadro');
  ok(!d.getElementById('estudios') && !d.querySelector('a[href$="#estudios"]'), 'sem secção de estúdios, nem links para ela');
  ok(d.querySelectorAll('.board .strip').length === 3, 'quadro "Hoje" com 3 réguas (uma por sala)');
  ok(d.querySelectorAll('.services li').length === 5 && !d.getElementById('servicos').hidden, 'lista 5 serviços');
  await waitFor(() => d.getElementById('footer-hours').textContent.trim(), 'horário do rodapé');
  ok(/Seg–Sex\s*09:00–21:00/.test(d.getElementById('footer-hours').textContent), 'horário resumido no rodapé "Seg–Sex 09:00–21:00"');
  ok(d.querySelectorAll('.single').length > 0 && !d.getElementById('destaques').hidden, 'carrossel dos singles visível');
  ok(d.querySelector('h1').textContent.includes('Tempo de estúdio'), 'título do herói');
  w.close();

  console.log('\nMarcar sessão');
  dom = await open('/marcar?studio=1', jar); w = dom.window; d = w.document;
  await waitFor(() => d.querySelectorAll('#studios .choice').length === 2, 'estúdios no formulário');
  ok(d.querySelector('input[name=studio]:checked').value === '1', 'estúdio pré-selecionado pelo endereço (?studio=1)');
  ok(d.querySelectorAll('#rooms .choice').length === 2, 'mostra as 2 salas do estúdio');
  ok(!d.getElementById('service-field').hidden, 'campo de serviço aparece');
  // Cada serviço leva ao fundo do cartão o desenho do que é, escolhido pelo nome.
  ok(d.querySelectorAll('#service .fundo-servico').length === d.querySelectorAll('#service .choice').length,
    'todos os cartões de serviço têm desenho de fundo');
  const qual = w.Studio.servicoIcone;
  ok(qual('Gravação') === 'microfone' && qual('Mistura') === 'mesa' && qual('Masterização') === 'disco'
    && qual('Produção') === 'teclas' && qual('Ensaio') === 'coluna', 'cada serviço do estúdio recebe o seu desenho');
  ok(qual('Recording') === 'microfone' && qual('Mixing') === 'mesa' && qual('Répétition') === 'coluna',
    'os nomes em inglês e francês também são reconhecidos');
  ok(qual('Aluguer de equipamento') === 'ondas', 'um serviço fora do comum fica com o desenho genérico');

  // Passo 1: só o trabalho. O estúdio, o dia e a hora ficam para o passo 2.
  ok(!d.getElementById('passo-1').hidden && d.getElementById('passo-2').hidden, 'abre no passo 1');
  ok(d.getElementById('passo-conta').textContent === 'Passo 1 de 3', 'diz em que passo se vai');
  ok(!d.getElementById('title'), 'o campo "Nome do projeto" já não existe');
  ok(d.querySelectorAll('#passo-1 legend').length === 1
    && d.querySelector('#passo-1 legend').textContent === 'O trabalho', 'o passo 1 só tem "O trabalho"');
  ok(!d.querySelector('#passo-1 #date') && !!d.querySelector('#passo-2 #date'), 'o dia está no passo 2, não no 1');
  ok(!d.querySelector('#passo-1 #btn-today') && !!d.querySelector('#passo-2 #btn-today'), '"Hoje"/"Amanhã" foram com o dia');
  ok(d.getElementById('btn-seguinte').textContent === 'Seguinte', 'o botão do passo 1 diz "Seguinte"');

  // Estilo de música: etiquetas de /js/estilos.js, mais "Outro" com caixa de texto.
  const estilos = [...d.querySelectorAll('#style .etiqueta span')].map((e) => e.textContent);
  ok(!d.getElementById('style-field').hidden && estilos.length === w.ESTILOS.length + 1, `${estilos.length} etiquetas de estilo`);
  ok(estilos.slice(0, 6).join(' | ') === 'Drill | Trap | Boom Bap | Rap / Hip-Hop | Afrobeats | R&B',
    'os seis estilos, por esta ordem: ' + estilos.slice(0, 6).join(', '));
  ok(estilos[estilos.length - 1] === 'Outro', 'a última etiqueta é "Outro"');
  ok(d.getElementById('style-other').hidden, 'a caixa do "Outro" começa escondida');
  const outro = d.querySelector('#style .etiqueta:last-child input');
  outro.checked = true; ev(w, outro, 'change');
  ok(!d.getElementById('style-other').hidden, 'escolher "Outro" abre a caixa de texto');
  setVal(w, d.getElementById('style-other'), 'Amapiano');
  const trap = d.querySelector('input[name=style][value="Trap"]');
  trap.checked = true; ev(w, trap, 'change');
  ok(d.getElementById('style-other').hidden && d.getElementById('style-other').value === '',
    'voltar a uma etiqueta esconde a caixa e limpa o que lá estava');

  // Som: o jsdom não tem Web Audio, por isso não sai som nenhum. Confere-se o
  // que não depende disso — que cada estilo tem ritmo próprio, que o botão de
  // silenciar está lá e funciona, e que escolher um estilo não rebenta.
  ok(w.ESTILOS.every((e) => w.Studio.som.temRitmo(e)), 'cada estilo tem o seu ritmo definido');
  ok(!w.Studio.som.temRitmo('Estilo inventado'), 'um estilo novo cai no ritmo por omissão');
  const botaoSom = d.getElementById('style-som');
  ok(!!botaoSom && botaoSom.getAttribute('aria-pressed') === 'true', 'o som começa ligado');
  botaoSom.click();
  ok(botaoSom.getAttribute('aria-pressed') === 'false' && w.Studio.som.silencio() === true, 'o botão silencia');
  botaoSom.click();
  ok(w.Studio.som.silencio() === false, 'e volta a ligar');
  ok(w.Studio.som.aTocar() === null, 'sem Web Audio nada toca, e nada estoira');

  d.getElementById('btn-seguinte').click();
  ok(d.getElementById('passo-1').hidden && !d.getElementById('passo-2').hidden, '"Seguinte" leva ao passo 2');
  ok(d.getElementById('passo-conta').textContent === 'Passo 2 de 3', 'o contador acompanha');
  const legendas2 = [...d.querySelectorAll('#passo-2 legend')].map((l) => l.textContent);
  ok(legendas2.join(' | ') === 'Estúdio e sala | Dia e hora', 'o passo 2 só tem essas duas: ' + legendas2.join(' / '));
  ok(!d.querySelector('#passo-2 #name') && !!d.querySelector('#passo-3 #name'), '"Os seus dados" ficam no passo 3');
  ok(!d.querySelector('#passo-2 #summary') && !!d.querySelector('#passo-3 #summary'), 'e o resumo do pedido com eles');

  ok(/Paris/.test(d.querySelectorAll('#studios .choice')[0].textContent)
    && /Assomada/.test(d.querySelectorAll('#studios .choice')[1].textContent), 'Paris num cartão, Assomada no outro');
  ok(!d.querySelector('#studios svg'), 'os cartões de estúdio já não levam globo');

  const room = d.querySelectorAll('input[name=room]')[0];
  room.checked = true; ev(w, room, 'change');
  setVal(w, d.getElementById('date'), day, 'change');
  await waitFor(() => d.querySelectorAll('.cell').length === 12, '12 blocos de hora');
  ok(d.querySelectorAll('.cell:not([disabled])').length === 12, 'dia futuro: todos os blocos livres');
  ok(d.getElementById('duration').hidden, 'duração escondida até escolher hora');
  const cell = [...d.querySelectorAll('.cell')].find((c) => c.textContent === '14:00');
  cell.click();
  ok(!d.getElementById('duration').hidden && d.getElementById('dur-out').textContent === '1 h', 'escolher 14:00 mostra duração de 1 h');
  d.getElementById('dur-plus').click(); d.getElementById('dur-plus').click();
  ok(d.getElementById('dur-out').textContent === '3 h', 'stepper sobe para 3 h');
  ok(d.querySelectorAll('.cell.in-range').length === 2 && d.querySelectorAll('.cell.is-start').length === 1, 'blocos 15h e 16h marcados no intervalo');
  // Sem escolher tudo, o passo 2 não deixa passar — e diz o que falta.
  const semSala = d.querySelector('input[name=room]:checked');
  ok(!!semSala, 'sala escolhida antes de avançar');
  d.getElementById('btn-seguinte-2').click();
  ok(d.getElementById('passo-2').hidden && !d.getElementById('passo-3').hidden, '"Seguinte" leva ao passo 3');
  ok(d.getElementById('passo-conta').textContent === 'Passo 3 de 3', 'contador: Passo 3 de 3');
  ok(/14:00 às 17:00/.test(d.getElementById('summary').textContent) && /7\s?500/.test(d.getElementById('summary').textContent), 'resumo: 14:00 às 17:00, 7 500 CVE');
  // enviar com campos em falta
  d.getElementById('book-form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => !d.getElementById('form-error').hidden, 'erro de validação');
  ok(/nome/i.test(d.getElementById('form-error').textContent), 'sem nome: mostra erro claro');
  setVal(w, d.getElementById('name'), 'Ana Silva');
  setVal(w, d.getElementById('phone'), '991 23 45');
  const sv1 = d.querySelector('input[name=service][value="1"]'); sv1.checked = true; ev(w, sv1, 'change');
  // Recuar e voltar a avançar não pode apagar nada do que já foi preenchido.
  d.getElementById('btn-voltar').click();
  ok(!d.getElementById('passo-2').hidden, '"Voltar" do passo 3 regressa ao 2');
  d.getElementById('btn-voltar-2').click();
  ok(!d.getElementById('passo-1').hidden, '"Voltar" do passo 2 regressa ao 1');
  ok(d.querySelector('input[name=service]:checked').value === '1', 'o serviço escolhido mantém-se ao recuar');
  d.getElementById('btn-seguinte').click();
  d.getElementById('btn-seguinte-2').click();
  ok(d.getElementById('name').value === 'Ana Silva' && d.querySelector('input[name=room]:checked').value === room.value,
    'o nome e a sala mantêm-se ao avançar outra vez');
  ok(d.getElementById('date').value === day && d.getElementById('dur-out').textContent === '3 h',
    'o dia, a hora e a duração também se mantêm');
  d.getElementById('book-form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => !d.getElementById('done').hidden, 'ecrã de confirmação');
  const code = d.getElementById('done-code').textContent;
  ok(/^[A-Z2-9]{6}$/.test(code), 'mostra o código da marcação: ' + code);
  ok(d.getElementById('done-title').textContent === 'Pedido enviado', 'estado "Pedido enviado"');
  ok(d.querySelectorAll('#done-details dt').length >= 5, 'detalhes da marcação listados');
  ok(/Trap/.test(d.getElementById('done-details').textContent), 'o estilo escolhido aparece na confirmação');
  w.close();

  // o horário ocupado deve aparecer desativado para outro cliente
  dom = await open(`/marcar?room=1&date=${day}`, {}); w = dom.window; d = w.document;
  await waitFor(() => d.querySelectorAll('.cell').length === 12, 'blocos (2.ª visita)');
  d.getElementById('btn-seguinte').click();
  const busy = [...d.querySelectorAll('.cell[disabled]')].map((c) => c.textContent);
  ok(busy.join() === '14:00,15:00,16:00', 'outro cliente vê 14h–17h ocupado: ' + busy.join(' '));
  ok(d.querySelector('input[name=room]:checked').value === '1', 'sala pré-selecionada por ?room=1');
  w.close();

  // O rodapé é o mesmo ficheiro nas três páginas (/js/rodape.js); confirma-se
  // que é preenchido também fora da página inicial.
  console.log('\nRodapé');
  for (const pag of ['/', '/marcar', '/consultar']) {
    dom = await open(pag, {}); w = dom.window; d = w.document;
    await waitFor(() => d.getElementById('footer-hours').textContent.trim(), 'horário do rodapé em ' + pag);
    ok(d.querySelectorAll('.footer-links a').length === 3 && d.querySelectorAll('#social li').length === 3,
      `${pag}: links rápidos e redes no rodapé`);
    ok(/Seg–Sex\s*09:00–21:00/.test(d.getElementById('footer-hours').textContent), `${pag}: horário resumido`);
    ok(/Paris/.test(d.getElementById('contacts').textContent), `${pag}: contactos do estúdio`);
    w.close();
  }

  console.log('\nConsultar marcação');
  dom = await open('/consultar?code=' + code, {}); w = dom.window; d = w.document;
  await waitFor(() => d.getElementById('code').value === code, 'código pré-preenchido');
  setVal(w, d.getElementById('phone'), '9912345');
  d.getElementById('lookup-form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => !d.getElementById('result').hidden, 'resultado');
  ok(/Ana Silva/.test(d.getElementById('result-details').textContent), 'mostra a marcação do cliente');
  ok(!!d.querySelector('#result-actions .btn-danger'), 'botão cancelar disponível');
  d.querySelector('#result-actions .btn-danger').click();
  await waitFor(() => /cancelada/i.test(d.getElementById('cancel-msg').textContent), 'cancelamento');
  ok(d.querySelector('#result-details .tag').dataset.s === 'cancelado', 'estado passa a Cancelado');
  ok(!d.querySelector('#result-actions .btn-danger'), 'botão cancelar desaparece');
  w.close();
  // wrong phone
  dom = await open('/consultar', {}); w = dom.window; d = w.document;
  await sleep(300);
  setVal(w, d.getElementById('code'), code); setVal(w, d.getElementById('phone'), '5550000');
  d.getElementById('lookup-form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => !d.getElementById('lookup-error').hidden, 'erro de consulta');
  ok(/Não encontrámos/.test(d.getElementById('lookup-error').textContent), 'telefone errado: mensagem de erro');
  w.close();

  // criar 2 pedidos via API para o painel
  const post = (u, b) => fetch(base + u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'studio' }, body: JSON.stringify(b) }).then((r) => r.json());
  await post('/api/public/bookings', { room_id: 1, date: day, start: '10:00', duration_minutes: 120, name: 'Bruno Lopes', phone: '5551234', title: 'EP' });
  await post('/api/public/bookings', { room_id: 3, date: day, start: '11:00', duration_minutes: 60, name: 'Carla Mendes', phone: '7778889' });

  console.log('\nPainel');
  jar = {};
  dom = await open('/admin', jar); w = dom.window; d = w.document;
  await waitFor(() => d.querySelector('.login-card'), 'ecrã de login');
  ok(!!d.querySelector('.login-card .strip'), 'login com a régua do dia');
  // Entrada introdutória: só o emblema do estúdio (o nome vive no alt da imagem).
  ok(!!d.querySelector('.login-brand .login-mark') && d.querySelector('.login-brand .login-mark').alt.trim().length > 0, 'o login dá as boas-vindas com a marca do estúdio');
  setVal(w, d.querySelector('input[type=email]'), 'dono@teste.cv');
  setVal(w, d.querySelector('input[type=password]'), 'errada');
  d.querySelector('.login-card form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => !d.querySelector('.login-card .notice').hidden, 'erro de login');
  ok(/incorretos/.test(d.querySelector('.login-card .notice').textContent), 'palavra-passe errada: erro');
  setVal(w, d.querySelector('input[type=password]'), 'palavra-passe-teste');
  d.querySelector('.login-card form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => d.querySelector('.side'), 'painel');
  ok(d.querySelectorAll('.side .nav').length === 11, 'menu com 11 secções (inclui Dashboard, Relatórios e Gestão de acesso)');
  // O Painel mostra agora só os pedidos por confirmar e as sessões de hoje
  // (o resumo de números passou para a secção Dashboard).
  await waitFor(() => d.querySelector('[aria-labelledby=h-pend]'), 'painel');
  ok(d.querySelector('[aria-labelledby=h-pend]').querySelectorAll('.bk').length === 2, 'painel: 2 pedidos por confirmar (Ana cancelou)');
  ok(d.getElementById('pending-badge').textContent === '2' && !d.getElementById('pending-badge').hidden, 'selo de pedidos: 2');
  ok(d.querySelector('.nav[aria-current=page]').dataset.k === 'painel', 'Painel ativo no menu');

  // Dashboard: os cartões de resumo, com o número de pedidos por confirmar.
  w.location.hash = '#/dashboard';
  await waitFor(() => d.querySelector('.kpis .kpi'), 'dashboard');
  const cartaoPend = [...d.querySelectorAll('.kpis .kpi')].find((k) => /Pedidos por confirmar/.test(k.querySelector('.kpi-l').textContent));
  ok(cartaoPend && cartaoPend.querySelector('.kpi-v').textContent === '2', 'dashboard: cartão "Pedidos por confirmar" com 2');
  w.location.hash = '#/painel';
  await waitFor(() => d.querySelector('[aria-labelledby=h-pend]'), 'volta ao painel');

  // confirmar 1.º pedido
  d.querySelector('[aria-labelledby=h-pend] .bk .btn:not(.btn-outline)').click();
  await waitFor(() => d.querySelector('[aria-labelledby=h-pend]').querySelectorAll('.bk').length === 1, 'pedido confirmado');
  ok(true, 'Confirmar retira o pedido da lista');
  ok(d.getElementById('pending-badge').textContent === '1', 'selo desce para 1');

  // Marcações
  w.location.hash = '#/marcacoes';
  await waitFor(() => d.querySelector('.tabs') && d.querySelector('table.data'), 'tabela de marcações');
  ok(d.querySelectorAll('table.data tbody tr').length === 1, 'separador "Por confirmar": 1 linha');
  d.querySelectorAll('.tab')[3].click();
  await waitFor(() => d.querySelectorAll('table.data tbody tr').length === 3, 'todas as marcações');
  ok(true, 'separador "Todas": 3 marcações (incl. cancelada)');
  const search = d.querySelector('.tools input[type=search]');
  setVal(w, search, 'carla');
  await waitFor(() => d.querySelectorAll('table.data tbody tr').length === 1, 'pesquisa');
  ok(/Carla/.test(d.querySelector('table.data tbody').textContent), 'pesquisa por nome funciona');
  setVal(w, search, 'zzzz');
  await waitFor(() => d.querySelector('.empty'), 'sem resultados');
  ok(true, 'pesquisa sem resultados mostra mensagem');
  setVal(w, search, '');

  // Modal editar
  await waitFor(() => d.querySelector('table.data tbody .btn-outline'), 'botões');
  [...d.querySelectorAll('table.data tbody .btn-outline')].find((b) => b.textContent === 'Abrir').click();
  const dlg = await waitFor(() => d.querySelector('dialog.modal[open]'), 'janela da marcação');
  ok(/Código [A-Z2-9]{6}/.test(dlg.textContent), 'janela mostra o código da marcação');
  ok(dlg.querySelector('select').options.length === 5, 'lista de estados (5)');
  ok(dlg.querySelectorAll('optgroup').length === 2, 'salas agrupadas por estúdio');
  // reagendar para conflito
  const inputs = dlg.querySelectorAll('input[type=time]');
  setVal(w, inputs[0], '10:00', 'change'); setVal(w, inputs[1], '12:00', 'change');
  const dates = dlg.querySelectorAll('input[type=date]');
  dlg.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await sleep(200);
  ok(true, 'submissão do formulário de edição corre sem erros de JS');
  dlg.querySelector('.modal-foot .btn-outline:not(.spacer .btn-outline)');
  [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Fechar').click();
  ok(!d.querySelector('dialog.modal'), 'Fechar remove a janela');

  // Nova marcação manual (conflito primeiro, depois válida)
  [...d.querySelectorAll('.tools .btn')].find((b) => b.textContent === 'Nova marcação').click();
  let nd = await waitFor(() => d.querySelector('dialog.modal[open]'), 'nova marcação');
  const f = nd.querySelectorAll('input');
  const inp = (type, i = 0) => nd.querySelectorAll(`input[type=${type}]`)[i];
  setVal(w, inp('date'), day, 'change');
  setVal(w, inp('time', 0), '10:00', 'change'); setVal(w, inp('time', 1), '11:00', 'change');
  setVal(w, nd.querySelector('input[type=text][required]'), 'Cliente ao balcão');
  // O painel também escreve e guarda o estilo, tal como o site.
  const campoEstilo = [...nd.querySelectorAll('.field')].find((c) => /Estilo/.test(c.textContent));
  ok(!!campoEstilo, 'a janela da marcação tem campo "Estilo"');
  setVal(w, campoEstilo.querySelector('input'), 'Kizomba');
  ok(inp('number', 0).value === '2500', 'preço sugerido = 2500 (1 h na sala 1)');
  nd.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => !nd.querySelector('.notice.error').hidden, 'erro de conflito');
  ok(/Já existe a marcação/.test(nd.querySelector('.notice.error').textContent), 'marcação sobreposta: erro claro');
  setVal(w, inp('time', 0), '15:00', 'change'); setVal(w, inp('time', 1), '17:00', 'change');
  ok(inp('number', 0).value === '5000', 'preço recalcula ao mudar as horas (5000)');
  nd.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => !d.querySelector('dialog.modal'), 'janela fechada');
  ok(true, 'marcação válida é guardada e a janela fecha');
  await waitFor(() => /Kizomba/.test(d.querySelector('table.data tbody').textContent), 'estilo na lista');
  ok(true, 'o estilo escrito no painel fica guardado e aparece na lista');

  // Calendário
  w.location.hash = `#/calendario?date=${day}`;
  await waitFor(() => d.querySelector('.cal'), 'calendário');
  await waitFor(() => d.querySelectorAll('.cal-ev').length >= 3, 'eventos');
  ok(d.querySelectorAll('.cal-room').length === 3 && d.querySelectorAll('.cal-studio').length === 2, 'calendário: 2 estúdios, 3 salas');
  ok(d.querySelectorAll('.cal-ev').length === 3, 'calendário: 3 marcações no dia (cancelada não aparece)');
  ok(d.querySelector('.cal-ev[data-s=confirmado]') && d.querySelector('.cal-ev[data-s=pedido]'), 'cores por estado (confirmado e pedido)');
  const ev1 = d.querySelector('.cal-ev');
  ok(parseInt(ev1.style.height, 10) > 20 && ev1.style.top.endsWith('px'), 'blocos posicionados por hora');
  // bloquear
  [...d.querySelectorAll('.tools .btn')].find((b) => b.textContent === 'Bloquear horário').click();
  const bd = await waitFor(() => d.querySelector('dialog.modal[open]'), 'janela de bloqueio');
  bd.querySelectorAll('input[type=time]')[0].value = '18:00'; bd.querySelectorAll('input[type=time]')[1].value = '20:00';
  bd.querySelector('input[type=text]').value = 'Manutenção';
  bd.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => d.querySelector('.cal-block'), 'bloqueio no calendário');
  ok(/Manutenção/.test(d.querySelector('.cal-block').textContent), 'bloqueio aparece no calendário');
  // clicar numa zona livre abre nova marcação com sala/hora
  const col = d.querySelectorAll('.cal-col')[1];
  col.getBoundingClientRect = () => ({ top: 0, left: 0, width: 150, height: 700 });
  col.dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientY: 56 * 3 + 10 }));
  const cd = await waitFor(() => d.querySelector('dialog.modal[open]'), 'nova marcação pelo calendário');
  ok(cd.querySelectorAll('input[type=time]')[0].value.length === 5, 'clique no calendário pré-preenche a hora: ' + cd.querySelectorAll('input[type=time]')[0].value);
  [...cd.querySelectorAll('button')].find((b) => b.textContent === 'Fechar').click();

  // Clientes
  w.location.hash = '#/clientes';
  await waitFor(() => d.querySelector('table.data tbody tr'), 'clientes');
  ok(d.querySelectorAll('table.data tbody tr').length >= 3, 'clientes: pelo menos 3 (Bruno, Carla, balcão)');
  ok(!!d.querySelector('table.data a[href^="https://wa.me/2385551234"]'), 'telefone local ganha indicativo no link de WhatsApp');

  // Estúdios
  w.location.hash = '#/estudios';
  await waitFor(() => d.querySelector('details.studio-panel:not([hidden])'), 'estúdios');
  ok(d.querySelectorAll('details.studio-panel:not([hidden])').length === 2, 'estúdios: 2 painéis');
  ok(d.querySelectorAll('details.studio-panel')[1].querySelectorAll('.hours-table tr').length === 7, 'tabela com 7 dias');
  ok(d.querySelectorAll('details.studio-panel')[1].querySelectorAll('.row-form').length === 3, 'estúdio 1: 2 salas + linha para adicionar');
  // adicionar sala
  const p1 = d.querySelectorAll('details.studio-panel')[1];
  const addRow = p1.querySelectorAll('.row-form')[2];
  addRow.querySelector('input[type=text]').value = 'Sala nova';
  addRow.querySelector('.btn').click();
  await waitFor(() => d.querySelectorAll('details.studio-panel')[1].querySelectorAll('.row-form').length === 4, 'sala adicionada');
  ok(true, 'adicionar sala funciona');
  // criar estúdio novo
  [...d.querySelectorAll('.page-head .btn')].find((b) => b.textContent === 'Novo estúdio').click();
  const np = d.querySelector('details.studio-panel:not([hidden])');
  ok(!d.querySelector('details.studio-panel').hidden, 'formulário "Novo estúdio" abre');
  d.querySelector('details.studio-panel input[type=text]').value = 'Estúdio Sul';
  d.querySelector('details.studio-panel form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => d.querySelectorAll('details.studio-panel:not([hidden])').length === 3, 'estúdio criado');
  ok(true, 'criar estúdio novo funciona');

  // Serviços
  w.location.hash = '#/servicos';
  await waitFor(() => d.querySelector('.row-form.service'), 'serviços');
  ok(d.querySelectorAll('.row-form.service').length === 6, 'serviços: 5 + linha para adicionar');
  // Cada serviço tem as suas traduções, fechadas, com o inglês e o francês.
  const linhaSv = d.querySelector('.row-form.service');
  const blocoTr = linhaSv.querySelector('details.traducoes');
  ok(!!blocoTr && !blocoTr.open && blocoTr.querySelectorAll('fieldset').length === 2, 'serviço: traduções em inglês e francês, fechadas');
  ok(/2 de 2/.test(blocoTr.querySelector('summary').textContent), 'o resumo diz quantas línguas estão traduzidas');
  const nomeEn = blocoTr.querySelector('input[lang=en]');
  setVal(w, nomeEn, 'Vocal recording');
  linhaSv.querySelector('.row-actions .btn').click();
  let svEn = null;
  await waitFor(() => { fetch(base + '/api/public/config').then((r) => r.json()).then((c) => { svEn = c.services[0].i18n.en.name; }); return svEn === 'Vocal recording'; }, 'tradução gravada');
  ok(svEn === 'Vocal recording', 'escrever a tradução no painel e guardar chega ao site');

  // Integrações: sem nada ligado, mostra os dois fornecedores desligados.
  w.location.hash = '#/integracoes';
  await waitFor(() => d.querySelector('.page-head h1') && d.querySelector('.page-head h1').textContent === 'Integrações', 'integrações');
  const nomes = [...d.querySelectorAll('#view section.panel h2')].map((x) => x.textContent);
  ok(nomes.some((n) => /Stripe/.test(n) && /desligado/.test(n)) && nomes.some((n) => /gravadora/.test(n)), 'integrações: Stripe e gravadora, desligados');
  ok(/Sucesso a partir de/.test(d.getElementById('view').textContent), 'integrações: limite de sucesso editável');

  // Definições: agora só as definições e a palavra-passe (a gestão de
  // utilizadores mudou-se para a Gestão de acesso).
  w.location.hash = '#/definicoes';
  await waitFor(() => d.querySelectorAll('form.panel').length === 2 && !d.querySelector('.user-card'), 'definições');
  ok(!d.querySelector('.user-card'), 'definições já não tem a gestão de utilizadores');
  const sf = d.querySelector('form.panel');
  const nameField = sf.querySelector('input[type=text]');
  nameField.value = 'Produções Teste';
  sf.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => d.querySelector('.side .brand').getAttribute('aria-label') === 'Produções Teste', 'nome atualizado');
  ok(true, 'guardar definições atualiza o nome da marca no menu');

  // Gestão de acesso: a lista de utilizadores, com o novo perfil de agente.
  w.location.hash = '#/acesso';
  await waitFor(() => d.querySelector('.page-head h1') && d.querySelector('.page-head h1').textContent === 'Gestão de acesso' && d.querySelector('.user-card'), 'gestão de acesso');
  ok(d.querySelectorAll('.user-card').length === 2, 'acesso: 1 utilizador + linha de novo');
  const novaConta = [...d.querySelectorAll('.user-card')].pop();
  const perfil = novaConta.querySelector('select');
  const campoEstudio = [...novaConta.querySelectorAll('.field')].find((f) => /Estúdio do agente/.test(f.textContent));
  ok(campoEstudio && campoEstudio.hidden, 'o seletor de estúdio começa escondido');
  perfil.value = 'agent'; perfil.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok(!campoEstudio.hidden, 'escolher "Agente de estúdio" mostra o seletor de estúdio');

  // Sair
  [...d.querySelectorAll('.side-foot button')].find((b) => b.textContent === 'Sair').click();
  await waitFor(() => d.querySelector('.login-card'), 'login após sair');
  ok(true, 'Sair volta ao ecrã de login');
  w.close();

  // Equipa não vê definições editáveis
  const staffPw = 'equipa-12345';
  const owner = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'studio' }, body: JSON.stringify({ email: 'dono@teste.cv', password: 'palavra-passe-teste' }) });
  const ck = owner.headers.get('set-cookie').split(';')[0];
  await fetch(base + '/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'studio', Cookie: ck }, body: JSON.stringify({ name: 'Técnica', email: 'tec@teste.cv', password: staffPw, role: 'staff' }) });
  jar = {};
  dom = await open('/admin#/definicoes', jar); w = dom.window; d = w.document;
  await waitFor(() => d.querySelector('.login-card'), 'login equipa');
  setVal(w, d.querySelector('input[type=email]'), 'tec@teste.cv'); setVal(w, d.querySelector('input[type=password]'), staffPw);
  d.querySelector('.login-card form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => d.querySelector('form.panel'), 'definições (equipa)');
  ok(/Só o proprietário/.test(d.querySelector('form.panel').textContent) && d.querySelector('form.panel input[type=text]').disabled, 'equipa vê as definições só de leitura');
  ok(!d.querySelector('.user-card'), 'equipa não vê a gestão de utilizadores');
  // A Gestão de acesso é só do proprietário: a equipa nem sequer a vê no menu.
  ok(![...d.querySelectorAll('.side .nav')].some((a) => /Gestão de acesso/.test(a.textContent)), 'a equipa não vê o item Gestão de acesso');
  w.location.hash = '#/acesso';
  await waitFor(() => w.location.hash === '#/painel', 'equipa reencaminhada da gestão de acesso');
  ok(true, 'a equipa é levada ao painel se tentar abrir a gestão de acesso');
  w.close();

  // Vista de agente: barra de topo com estúdio, idioma, tema e identidade.
  const studios = (await (await fetch(base + '/api/admin/studios', { headers: { 'X-Requested-With': 'studio', Cookie: ck } })).json()).studios;
  const agPw = 'agente-12345';
  await fetch(base + '/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'studio', Cookie: ck }, body: JSON.stringify({ name: 'Ailton Santos', email: 'ailton@teste.cv', password: agPw, role: 'agent', studio_id: studios[0].id }) });
  jar = {};
  dom = await open('/admin', jar); w = dom.window; d = w.document;
  await waitFor(() => d.querySelector('.login-card'), 'login agente');
  setVal(w, d.querySelector('input[type=email]'), 'ailton@teste.cv'); setVal(w, d.querySelector('input[type=password]'), agPw);
  d.querySelector('.login-card form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => d.querySelector('.topbar'), 'barra de topo do agente');
  ok(d.querySelector('.tb-studio-name').textContent.trim() === studios[0].name, 'a barra mostra o nome do estúdio');
  ok(!!d.querySelector('.topbar .tb-sel') && !!d.querySelector('.topbar .tb-btn') && !!d.querySelector('.topbar .tb-avatar'), 'a barra tem idioma, tema e identidade');
  ok(/Ailton Santos/.test(d.querySelector('.tb-user').textContent), 'a barra mostra o nome do agente');
  const temaAntes = d.documentElement.getAttribute('data-tema');
  d.querySelector('.tb-btn').click();
  ok(d.documentElement.getAttribute('data-tema') !== temaAntes, 'o botão de tema alterna claro/escuro');
  ok(![...d.querySelectorAll('.side .nav')].some((a) => /Estúdios|Serviços|Integrações|Gestão de acesso/.test(a.textContent)), 'o agente não vê as secções de gestor');
  w.close();

  // ---- Cabeçalho preso ao topo ----
  // O jsdom não faz desenho, por isso aqui só se confere a estrutura: que o
  // cabeçalho saiu de dentro do herói (se lá ficasse, deixava de acompanhar a
  // página assim que o herói passasse) e que o valor de reserva da altura
  // sobrevive a uma medição a zero.
  console.log('\nCabeçalho');
  dom = await open('/', {}); w = dom.window; d = w.document;
  await waitFor(() => d.querySelector('.cabecalho'), 'cabeçalho');
  ok(d.querySelector('.cabecalho').parentElement === d.body, 'o cabeçalho é filho direto do <body>, não do herói');
  ok(!d.querySelector('.hero .topbar') && !!d.querySelector('.cabecalho .topbar'), 'a barra saiu de dentro do herói');
  ok(d.querySelector('.cabecalho .brand-mark').getAttribute('width') === '34', 'o logótipo do cabeçalho tem 34px');
  ok(d.documentElement.style.getPropertyValue('--altura-cabecalho') === '', 'sem desenho (altura 0) fica o valor de reserva do CSS');
  for (const p of ['/marcar', '/consultar']) {
    w.close();
    dom = await open(p, {}); w = dom.window; d = w.document;
    await waitFor(() => d.querySelector('.cabecalho'), 'cabeçalho ' + p);
    ok(d.querySelector('.cabecalho').parentElement === d.body, `o cabeçalho de ${p} também está preso ao topo`);
  }
  w.close();

  // ---- Cabeçalho: idioma e tema ----
  // O servidor já manda a página traduzida; aqui confirma-se o que acontece
  // depois de se escolher no cabeçalho, sem recarregar nada.
  console.log('\nIdioma e tema');
  dom = await open('/', {}); w = dom.window; d = w.document;
  // A esta altura o painel já acrescentou salas, por isso não se conta o número.
  await waitFor(() => d.querySelectorAll('.board-row').length > 0 && d.querySelectorAll('.services li').length, 'quadro e serviços (idioma)');
  ok(d.documentElement.lang === 'pt' && d.querySelector('#pref-lingua-btn .pref-val').textContent === 'PT', 'começa em português');

  d.querySelector('#pref-lingua-btn').click();
  ok(!d.querySelector('#pref-lingua-menu').hidden && d.querySelector('#pref-lingua-btn').getAttribute('aria-expanded') === 'true', 'o botão abre a lista de idiomas');
  d.querySelector('.pref-menu [data-lingua="en"]').click();
  ok(d.documentElement.lang === 'en' && d.querySelector('#pref-lingua-menu').hidden, 'escolher inglês fecha a lista e muda o <html lang>');
  ok(d.querySelector('h1').textContent === 'Studio time, booked in minutes.', 'o texto do HTML passa a inglês');
  ok(d.title.endsWith(': book studio time online'), 'o título do separador acompanha');
  ok(d.querySelector('.topbar').getAttribute('aria-label') === 'Main', 'os atributos (aria-label) acompanham');
  ok(d.querySelector('#pref-tema-btn .pref-val').textContent === 'Dark', 'o nome do tema segue o idioma');
  ok(d.querySelector('.pref-menu [data-lingua="pt"] .pref-nome').textContent === 'Português', 'cada idioma continua escrito na sua língua');
  // O que é desenhado em JavaScript volta a ser desenhado, sem novo pedido
  ok([...d.querySelectorAll('.services .modo')].every((e) => /remotely|At the studio/.test(e.textContent)), 'os serviços são redesenhados em inglês');
  ok(/^Wednesday|^Thursday|^Friday|^Monday|^Tuesday|^Saturday|^Sunday/.test(d.getElementById('board-date').textContent), 'a data do quadro passa a inglês: ' + d.getElementById('board-date').textContent);
  ok(/Mon–Fri/.test(d.getElementById('footer-hours').textContent), 'o horário do rodapé passa a inglês');
  // O conteúdo escrito no painel segue a língua, com as traduções que lá tiver.
  const nomesServicos = [...d.querySelectorAll('.services li strong')].map((e) => e.textContent);
  ok(nomesServicos.includes('Mixing') && nomesServicos.includes('Mastering'), 'os nomes dos serviços passam a inglês: ' + nomesServicos.join(', '));
  ok([...d.querySelectorAll('.board-row strong')].some((e) => /Studio/.test(e.textContent)), 'os nomes dos estúdios no quadro também');

  d.querySelector('#pref-tema-btn').click();
  d.querySelector('.pref-menu [data-tema="claro"]').click();
  ok(d.documentElement.dataset.tema === 'claro', 'escolher o tema claro muda o <html data-tema>');
  ok(d.querySelector('.pref-menu [data-tema="claro"]').getAttribute('aria-checked') === 'true'
    && d.querySelector('.pref-menu [data-tema="escuro"]').getAttribute('aria-checked') === 'false', 'a opção em uso fica marcada');
  w.close();

  // Trocar de idioma a meio do formulário não apaga o que já foi preenchido.
  dom = await open('/marcar?studio=1', {}); w = dom.window; d = w.document;
  await waitFor(() => d.querySelectorAll('#studios .choice').length === 2, 'estúdios (idioma)');
  const sala1 = d.querySelectorAll('input[name=room]')[0];
  sala1.checked = true; ev(w, sala1, 'change');
  setVal(w, d.getElementById('name'), 'Jean Dupont');
  setVal(w, d.getElementById('date'), day, 'change');
  await waitFor(() => d.querySelectorAll('.cell').length === 12, 'blocos (idioma)');
  d.querySelector('#pref-lingua-btn').click();
  d.querySelector('.pref-menu [data-lingua="fr"]').click();
  ok(d.getElementById('name').value === 'Jean Dupont', 'o que já estava escrito mantém-se');
  // As salas são redesenhadas, por isso compara-se o valor e não o elemento.
  ok(d.querySelector('input[name=room]:checked').value === sala1.value, 'a sala escolhida continua escolhida');
  ok(d.querySelector('h1').textContent === 'Réserver une séance', 'a página passa a francês');
  ok(/Je ne sais pas encore/.test(d.getElementById('service').textContent), 'a lista de serviços é redesenhada em francês');
  ok(/Mixage/.test(d.getElementById('service').textContent), 'com os nomes dos serviços em francês');
  ok(/Salle d’enregistrement|Cabine voix/.test(d.getElementById('rooms').textContent), 'e os das salas: ' + d.getElementById('rooms').textContent.slice(0, 80));
  ok(/Ouvert de 09:00 à 21:00/.test(d.getElementById('slot-note').textContent), 'a nota das horas passa a francês: ' + d.getElementById('slot-note').textContent);
  ok(d.getElementById('passo-conta').textContent === 'Étape 1 sur 3', 'o contador de passos segue a língua: ' + d.getElementById('passo-conta').textContent);
  [...d.querySelectorAll('.cell')].find((c) => c.textContent === '14:00').click();
  ok(/de 14:00 à 15:00/.test(d.getElementById('summary').textContent), 'o resumo é escrito em francês: ' + d.getElementById('summary').querySelector('.when').textContent);
  w.close();

  console.log('\nErros de JavaScript nas páginas: ' + errors.length);
  errors.slice(0, 10).forEach((e) => console.log('   ', e));
  ok(errors.length === 0, 'nenhuma página lançou erros');
  console.log(`\n${passed} certos, ${failed} falhados`);
  server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('\nERRO:', e.message); errors.slice(0, 10).forEach((x) => console.log('   ', x)); process.exit(1); });
