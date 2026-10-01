'use strict';
// Testes de ponta a ponta da API. Usa uma base de dados temporária.
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-'));
process.env.NODE_ENV = 'test';
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.ADMIN_EMAIL = 'dono@teste.cv';
process.env.ADMIN_PASSWORD = 'palavra-passe-teste';

// Serviço de mapas de mentira, no lugar do OpenStreetMap: assim a suite corre
// sem internet e sem incomodar um serviço que é comunitário.
const http = require('http');
const mapas = http.createServer((req, res) => {
  const q = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('q') || '');
  if (/rebentar/i.test(q)) { res.writeHead(500).end('nao'); return; }
  const achado = /assomada/i.test(q) ? [{ lat: '15.1000', lon: '-23.6833', display_name: 'Assomada, Santa Catarina, Cabo Verde' }]
    : /paris/i.test(q) ? [{ lat: '48.8566', lon: '2.3522', display_name: 'Paris, France' }] : [];
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(achado));
});
mapas.listen(0);
process.env.GEOCODER_URL = 'http://127.0.0.1:' + mapas.address().port + '/search';

const { start } = require('../backend/server');
const U = require('../backend/lib/util');

let server, base, passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✓', msg); } else { failed++; console.log('  ✗ FALHOU:', msg); } };

async function call(method, url, { body, cookie, headers = {} } = {}) {
  const h = { 'X-Requested-With': 'studio', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const res = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch (_) { /* sem corpo */ }
  return { status: res.status, json, res };
}
const login = async (email, password) => {
  const r = await call('POST', '/api/auth/login', { body: { email, password } });
  const c = r.res.headers.get('set-cookie');
  return { r, cookie: c ? c.split(';')[0] : null };
};

// Próximo dia útil (seg–sex) daqui a pelo menos 3 dias.
function futureWeekday(offset = 3) {
  let d = U.addDays(U.nowLocal().date, offset);
  while ([0, 6].includes(U.weekday(d))) d = U.addDays(d, 1);
  return d;
}

(async () => {
  server = start(0);
  await new Promise((r) => server.on('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const day = futureWeekday();

  console.log('\nPúblico');
  let r = await call('GET', '/api/public/config');
  ok(r.status === 200 && r.json.studios.length === 2, 'config devolve os 2 estúdios de exemplo');
  const room1 = r.json.studios[0].rooms[0].id;
  const room2 = r.json.studios[1].rooms[0].id;
  ok(r.json.studios[0].rooms[0].hourly_rate === 2500, 'preço por hora está na config');

  r = await call('GET', `/api/public/availability?room_id=${room1}&date=${day}`);
  ok(r.status === 200 && r.json.cells.length === 12 && r.json.cells.every((c) => c.free), 'dia útil: 12 blocos livres (09–21h)');
  r = await call('GET', `/api/public/availability?room_id=${room1}&date=${U.addDays(U.nowLocal().date, -1)}`);
  ok(r.json.closed && r.json.reason === 'past', 'datas passadas aparecem fechadas');
  r = await call('GET', `/api/public/availability?room_id=${room1}&date=${U.addDays(U.nowLocal().date, 400)}`);
  ok(r.json.closed && r.json.reason === 'too_far', 'datas demasiado longe aparecem fechadas');

  const payload = (o = {}) => ({ room_id: room1, date: day, start: '10:00', duration_minutes: 120, name: 'Ana Silva', phone: '991 23 45', title: 'Single novo', ...o });
  r = await call('POST', '/api/public/bookings', { body: payload() });
  ok(r.status === 201 && r.json.booking.status === 'pedido' && /^[A-Z2-9]{6}$/.test(r.json.booking.code), 'cria pedido (estado "pedido", código de 6 letras)');
  ok(r.json.booking.price === 5000, 'preço = 2500 × 2 h');
  const code = r.json.booking.code;

  r = await call('POST', '/api/public/bookings', { body: payload() });
  ok(r.status === 409, 'mesmo horário → 409');
  r = await call('POST', '/api/public/bookings', { body: payload({ start: '11:00', duration_minutes: 120 }) });
  ok(r.status === 409, 'sobreposição parcial (11–13h) → 409');
  r = await call('POST', '/api/public/bookings', { body: payload({ start: '09:00', duration_minutes: 120 }) });
  ok(r.status === 409, 'sobreposição parcial (09–11h) → 409');
  r = await call('POST', '/api/public/bookings', { body: payload({ start: '12:00', duration_minutes: 60, name: 'Bruno', phone: '5551234' }) });
  ok(r.status === 201, 'horário adjacente (12–13h) é permitido');
  r = await call('POST', '/api/public/bookings', { body: payload({ room_id: room2 }) });
  ok(r.status === 201, 'mesma hora noutro estúdio é permitida');

  r = await call('POST', '/api/public/bookings', { body: payload({ start: '20:00', duration_minutes: 120 }) });
  ok(r.status === 400, 'fora do horário (20–22h) → 400');
  r = await call('POST', '/api/public/bookings', { body: payload({ start: '14:00', duration_minutes: 30 }) });
  ok(r.status === 400, 'duração fora do bloco → 400');
  r = await call('POST', '/api/public/bookings', { body: payload({ start: '14:00', duration_minutes: 60 * 9 }) });
  ok(r.status === 400, 'duração acima do máximo → 400');
  r = await call('POST', '/api/public/bookings', { body: payload({ start: '14:00', phone: '12' }) });
  ok(r.status === 400, 'telefone inválido → 400');
  r = await call('POST', '/api/public/bookings', { body: payload({ start: '14:00', name: '' }) });
  ok(r.status === 400, 'nome vazio → 400');
  r = await call('POST', '/api/public/bookings', { body: payload({ date: U.addDays(U.nowLocal().date, -2) }) });
  ok(r.status === 400, 'data passada → 400');
  const sunday = (() => { let d = U.addDays(U.nowLocal().date, 3); while (U.weekday(d) !== 0) d = U.addDays(d, 1); return d; })();
  r = await call('POST', '/api/public/bookings', { body: payload({ date: sunday, start: '10:00' }) });
  ok(r.status === 400, 'domingo (fechado) → 400');
  r = await call('POST', '/api/public/bookings', { body: payload({ date: U.nowLocal().date, start: '00:00', duration_minutes: 60 }) });
  ok(r.status >= 400, 'antecedência mínima respeitada (hoje, à meia-noite)');
  r = await call('POST', '/api/public/bookings', { body: { ...payload({ start: '15:00' }), website: 'http://spam' } });
  ok(r.status === 200 && r.json.booking.code === 'XXXXXX', 'campo isco: resposta falsa');
  r = await call('GET', `/api/public/availability?room_id=${room1}&date=${day}`);
  ok(!r.json.cells.find((c) => c.start === 900 && !c.free), 'o campo isco não gravou nada (15h livre)');
  ok(r.json.cells.filter((c) => !c.free).length === 3, 'disponibilidade mostra 3 blocos ocupados (10, 11, 12h)');

  r = await fetch(base + '/api/public/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload({ start: '16:00' })) });
  ok(r.status === 403, 'sem cabeçalho anti-CSRF → 403');

  console.log('\nConsulta e cancelamento pelo cliente');
  r = await call('POST', '/api/public/lookup', { body: { code, phone: '9912345' } });
  ok(r.status === 200 && r.json.booking.client_name === 'Ana Silva' && r.json.can_cancel, 'código + telefone (parcial) encontram a marcação');
  r = await call('POST', '/api/public/lookup', { body: { code, phone: '0000000' } });
  ok(r.status === 404, 'telefone errado → 404');
  r = await call('POST', '/api/public/lookup', { body: { code: code.toLowerCase(), phone: '+238 991 23 45' } });
  ok(r.status === 200, 'código em minúsculas e telefone com indicativo funcionam');

  console.log('\nAdministração');
  r = await call('GET', '/api/admin/dashboard');
  ok(r.status === 401, 'painel sem sessão → 401');
  let a = await login('dono@teste.cv', 'errada');
  ok(a.r.status === 401, 'login com palavra-passe errada → 401');
  a = await login('dono@teste.cv', 'palavra-passe-teste');
  ok(a.r.status === 200 && a.cookie, 'login correto devolve cookie de sessão');
  const cookie = a.cookie;
  ok(/HttpOnly/i.test(a.r.res.headers.get('set-cookie')), 'cookie é HttpOnly');

  r = await call('GET', '/api/admin/dashboard', { cookie });
  ok(r.status === 200 && r.json.counts.pending === 3, 'painel: 3 pedidos por confirmar');

  r = await call('GET', `/api/admin/bookings?status=pedido&studio_id=1`, { cookie });
  ok(r.json.bookings.length === 2, 'filtro por estúdio devolve 2');
  const bId = r.json.bookings.find((b) => b.code === code).id;

  r = await call('PATCH', `/api/admin/bookings/${bId}/status`, { cookie, body: { status: 'confirmado' } });
  ok(r.status === 200 && r.json.booking.status === 'confirmado', 'confirmar pedido');

  const manual = { room_id: room1, date: day, start: '11:00', end: '12:30', client_name: 'Cliente ao balcão', client_phone: '', status: 'confirmado' };
  r = await call('POST', '/api/admin/bookings', { cookie, body: manual });
  ok(r.status === 409, 'marcação manual sobreposta → 409');
  r = await call('POST', '/api/admin/bookings', { cookie, body: { ...manual, start: '13:00', end: '14:30', paid: 1000 } });
  ok(r.status === 201 && r.json.booking.source === 'admin' && r.json.booking.price === 3750, 'marcação manual em 15 min (13:00–14:30, preço 3750)');
  const manualId = r.json.booking.id;

  r = await call('PUT', `/api/admin/bookings/${manualId}`, { cookie, body: { ...manual, start: '13:00', end: '15:00', price: 4000, paid: 2000, status: 'em_curso' } });
  ok(r.status === 200 && r.json.booking.end === '15:00' && r.json.booking.paid === 2000, 'editar marcação (reagendar e pagamento)');
  r = await call('PUT', `/api/admin/bookings/${manualId}`, { cookie, body: { ...manual, start: '10:30', end: '11:30' } });
  ok(r.status === 409, 'reagendar para cima de outra → 409');

  r = await call('PATCH', `/api/admin/bookings/${manualId}/status`, { cookie, body: { status: 'cancelado' } });
  ok(r.status === 200, 'cancelar marcação');
  r = await call('POST', '/api/admin/bookings', { cookie, body: { ...manual, start: '13:00', end: '15:00' } });
  ok(r.status === 201, 'horário de marcação cancelada volta a ficar livre');

  r = await call('POST', '/api/admin/blocks', { cookie, body: { room_id: room1, date: day, start: '16:00', end: '18:00', reason: 'Manutenção' } });
  ok(r.status === 201, 'bloquear horário');
  const blockId = r.json.id;
  r = await call('POST', '/api/public/bookings', { body: payload({ start: '17:00', duration_minutes: 60 }) });
  ok(r.status === 409, 'cliente não consegue marcar em horário bloqueado');
  r = await call('POST', '/api/admin/bookings', { cookie, body: { ...manual, start: '17:00', end: '17:30' } });
  ok(r.status === 409 && /bloqueada/.test(r.json.error), 'admin também é avisado do bloqueio');
  r = await call('POST', '/api/admin/blocks', { cookie, body: { room_id: room1, date: day, start: '10:00', end: '11:00' } });
  ok(r.status === 409, 'não se bloqueia por cima de uma marcação');
  r = await call('GET', `/api/admin/calendar?date=${day}`, { cookie });
  ok(r.status === 200 && r.json.studios.length === 2 && r.json.bookings.length >= 3 && r.json.blocks.length === 1, 'calendário devolve estúdios, marcações e bloqueios');
  r = await call('DELETE', `/api/admin/blocks/${blockId}`, { cookie });
  ok(r.status === 200, 'remover bloqueio');

  r = await call('POST', '/api/public/cancel', { body: { code, phone: '9912345' } });
  ok(r.status === 200 && r.json.booking.status === 'cancelado', 'cliente cancela a própria marcação');
  r = await call('POST', '/api/public/cancel', { body: { code, phone: '9912345' } });
  ok(r.status === 400, 'não se cancela duas vezes');

  console.log('\nEstúdios, salas, serviços');
  r = await call('GET', '/api/admin/studios', { cookie });
  ok(r.json.studios.length === 2 && r.json.studios[0].hours.length === 7, 'lista estúdios com horários');
  r = await call('DELETE', '/api/admin/studios/1', { cookie });
  ok(r.status === 409, 'não elimina estúdio com marcações');
  const hours = r.json ? null : null;
  r = await call('POST', '/api/admin/studios', { cookie, body: { name: 'Estúdio Novo', hours: [null, { open: '08:00', close: '18:00' }, null, null, null, null, null] } });
  ok(r.status === 201, 'criar estúdio');
  const newStudio = r.json.id;
  r = await call('POST', '/api/admin/studios', { cookie, body: { name: 'X', hours: [null, { open: '18:00', close: '08:00' }, null, null, null, null, null] } });
  ok(r.status === 400, 'horário com fecho antes da abertura → 400');
  r = await call('POST', '/api/admin/rooms', { cookie, body: { studio_id: newStudio, name: 'Sala A', hourly_rate: 1800 } });
  ok(r.status === 201, 'criar sala');
  const newRoom = r.json.id;
  r = await call('GET', '/api/public/config');
  ok(r.json.studios.length === 3, 'novo estúdio aparece no site público');
  r = await call('PUT', `/api/admin/studios/${newStudio}`, { cookie, body: { name: 'Estúdio Novo', active: false, hours: [null, { open: '08:00', close: '18:00' }, null, null, null, null, null] } });
  r = await call('GET', '/api/public/config');
  ok(r.json.studios.length === 2, 'estúdio desativado desaparece do site público');
  r = await call('DELETE', `/api/admin/rooms/${newRoom}`, { cookie });
  ok(r.status === 200, 'elimina sala sem marcações');
  r = await call('DELETE', `/api/admin/studios/${newStudio}`, { cookie });
  ok(r.status === 200, 'elimina estúdio sem marcações');
  r = await call('POST', '/api/admin/services', { cookie, body: { name: 'Locução' } });
  ok(r.status === 201, 'criar serviço');

  console.log('\nClientes, definições e utilizadores');
  r = await call('GET', '/api/admin/clients', { cookie });
  ok(r.status === 200 && r.json.clients.length >= 2, 'lista de clientes agrupada');
  r = await call('PUT', '/api/admin/settings', { cookie, body: { business_name: 'Estúdio Teste', tagline: 'Olá', slot_minutes: 30, min_minutes: 60, max_minutes: 240, lead_hours: 2, max_advance_days: 60, auto_confirm: true, currency: 'CVE', country_code: '238', phone: '', whatsapp: '', email: '', terms: '' } });
  ok(r.status === 200 && r.json.settings.slot_minutes === 30 && r.json.settings.auto_confirm === true, 'guardar definições');
  r = await call('GET', `/api/public/availability?room_id=${room1}&date=${day}`);
  ok(r.json.cells.length === 24, 'blocos de 30 min: 24 células');
  r = await call('POST', '/api/public/bookings', { body: payload({ room_id: room2, start: '13:30', duration_minutes: 90, phone: '7778889' }) });
  ok(r.status === 201 && r.json.booking.status === 'confirmado', 'confirmação automática ativa: nasce "confirmado"');
  r = await call('PUT', '/api/admin/settings', { cookie, body: { business_name: 'X', slot_minutes: 45, min_minutes: 60, max_minutes: 240, lead_hours: 2, max_advance_days: 60 } });
  ok(r.status === 400, 'bloco de 45 min rejeitado');

  r = await call('POST', '/api/admin/users', { cookie, body: { name: 'Técnico', email: 'tecnico@teste.cv', password: 'curta' } });
  ok(r.status === 400, 'palavra-passe curta rejeitada');
  r = await call('POST', '/api/admin/users', { cookie, body: { name: 'Técnico', email: 'tecnico@teste.cv', password: 'tecnico-1234', role: 'staff' } });
  ok(r.status === 201, 'criar utilizador da equipa');
  const staff = await login('tecnico@teste.cv', 'tecnico-1234');
  ok(staff.r.status === 200, 'a equipa consegue entrar');
  r = await call('GET', '/api/admin/dashboard', { cookie: staff.cookie });
  ok(r.status === 200, 'equipa vê o painel');
  r = await call('PUT', '/api/admin/settings', { cookie: staff.cookie, body: {} });
  ok(r.status === 403, 'equipa não altera definições (403)');
  r = await call('GET', '/api/admin/users', { cookie: staff.cookie });
  ok(r.status === 403, 'equipa não vê utilizadores (403)');
  r = await call('PUT', '/api/admin/users/1', { cookie, body: { name: 'Administrador', role: 'staff', active: true } });
  ok(r.status === 400, 'não se remove o único proprietário');
  r = await call('DELETE', '/api/admin/users/1', { cookie });
  ok(r.status === 400, 'não se elimina a própria conta');

  r = await call('POST', '/api/auth/password', { cookie, body: { current: 'errada', next: 'nova-palavra-1' } });
  ok(r.status === 400, 'mudar palavra-passe exige a atual');
  r = await call('POST', '/api/auth/password', { cookie, body: { current: 'palavra-passe-teste', next: 'nova-palavra-1' } });
  ok(r.status === 200, 'mudar palavra-passe');
  a = await login('dono@teste.cv', 'nova-palavra-1');
  ok(a.r.status === 200, 'entra com a nova palavra-passe');
  r = await call('POST', '/api/auth/logout', { cookie: a.cookie });
  r = await call('GET', '/api/auth/me', { cookie: a.cookie });
  ok(r.status === 401, 'depois de sair, a sessão deixa de valer');

  console.log('\nLimites de pedidos');
  process.env.NODE_ENV = 'production';
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await call('POST', '/api/auth/login', { body: { email: 'x@y.cv', password: 'z' } })).status;
  ok(last === 429, 'demasiadas tentativas de login → 429');
  process.env.NODE_ENV = 'test';

  console.log('\nPresencial ou à distância');
  // Dia só deste bloco: criar marcações no dia principal mexia nas contagens acima.
  const diaRemoto = futureWeekday(10);
  const pedidoRemoto = (o = {}) => ({ room_id: room1, date: diaRemoto, start: '10:00', duration_minutes: 60, name: 'Rui Tavares', phone: '9918877', ...o });
  const cfgSv = (await call('GET', '/api/public/config')).json.services;
  const presencial = cfgSv.find((s) => s.name === 'Gravação');
  const aDistancia = cfgSv.find((s) => s.name === 'Masterização');
  ok(presencial && !presencial.remote_ok, 'gravação vem marcada como presencial');
  ok(aDistancia && !!aDistancia.remote_ok, 'masterização pode ser à distância');

  r = await call('POST', '/api/public/bookings', { body: pedidoRemoto({ service_id: aDistancia.id, remote: true }) });
  ok(r.status === 201 && r.json.booking.remote === true, 'masterização à distância é aceite e fica marcada');
  r = await call('POST', '/api/public/bookings', { body: pedidoRemoto({ start: '11:00', service_id: presencial.id, remote: true }) });
  ok(r.status === 400 && /estúdio/i.test(r.json.error), 'gravação à distância é recusada, com o motivo');
  r = await call('POST', '/api/public/bookings', { body: pedidoRemoto({ start: '12:00', remote: true }) });
  ok(r.status === 400, 'à distância sem serviço escolhido → 400');
  r = await call('POST', '/api/public/bookings', { body: pedidoRemoto({ start: '13:00', service_id: presencial.id }) });
  ok(r.status === 201 && r.json.booking.remote === false, 'sem pedir distância, a sessão fica presencial');

  // O estilo segue a marcação de ponta a ponta: do site para a base de dados
  // e de volta na consulta. É opcional e é texto livre (por causa do "Outro"),
  // por isso o servidor limita-se a limpá-lo e a cortá-lo.
  // Onde fica cada estúdio, para o globo do formulário saber para onde rodar.
  console.log('\nCoordenadas dos estúdios');
  const cfgEst = (await call('GET', '/api/public/config')).json.studios;
  const paris = cfgEst.find((x) => /Paris/.test(x.city));
  const assomada = cfgEst.find((x) => /Assomada/.test(x.city));
  ok(paris && Math.abs(paris.lat - 48.8566) < 0.01 && Math.abs(paris.lon - 2.3522) < 0.01, 'o primeiro estúdio fica em Paris');
  ok(assomada && Math.abs(assomada.lat - 15.1) < 0.01 && Math.abs(assomada.lon + 23.6833) < 0.01, 'o segundo em Assomada, Cabo Verde');

  // A palavra-passe do dono já foi mudada acima, por isso entra-se com a nova.
  const ckDono = (await login('dono@teste.cv', 'nova-palavra-1')).cookie;
  const est = (await call('GET', '/api/admin/studios', { cookie: ckDono })).json.studios[0];
  const guardarEst = (o) => call('PUT', `/api/admin/studios/${est.id}`, { cookie: ckDono, body: { ...est, ...o } });
  const latAgora = async () => (await call('GET', '/api/public/config')).json.studios[0].lat;
  r = await guardarEst({ lat: 38.7223, lon: -9.1393 });
  ok(r.status === 200 && Math.abs(await latAgora() - 38.7223) < 0.01, 'o painel guarda coordenadas novas e o site vê-as');
  await guardarEst({ lat: '', lon: '' });
  ok(await latAgora() === null, 'apagar as coordenadas deixa-as a vazio (o globo fica parado)');
  r = await guardarEst({ lat: 999, lon: 'abc' });
  ok(r.status === 200 && await latAgora() === null, 'coordenadas impossíveis ficam a vazio, sem recusar o estúdio');
  await guardarEst({ lat: paris.lat, lon: paris.lon });

  // Procurar coordenadas pelo nome do sítio, contra o servidor de mentira.
  console.log('\nProcurar coordenadas');
  r = await call('POST', '/api/admin/geocode', { cookie: ckDono, body: { q: 'ab' } });
  ok(r.status === 400, 'procura demasiado curta → 400');
  r = await call('POST', '/api/admin/geocode', { body: { q: 'Assomada' } });
  ok(r.status === 401, 'a procura é só para quem tem sessão no painel');
  r = await call('POST', '/api/admin/geocode', { cookie: ckDono, body: { q: 'Assomada, Cabo Verde' } });
  ok(r.status === 200 && Math.abs(r.json.lat - 15.1) < 0.01 && Math.abs(r.json.lon + 23.68) < 0.01,
    'encontra Assomada: ' + (r.json && r.json.nome));
  r = await call('POST', '/api/admin/geocode', { cookie: ckDono, body: { q: 'sitio-que-nao-existe' } });
  ok(r.status === 404 && /encontrámos/.test(r.json.error), 'sítio desconhecido → 404 com explicação');
  r = await call('POST', '/api/admin/geocode', { cookie: ckDono, body: { q: 'rebentar' } });
  ok(r.status === 502 && /serviço de mapas/.test(r.json.error), 'serviço em baixo → 502, sem deitar o painel abaixo');

  console.log('\nEstilo de música');
  const diaEstilo = futureWeekday(17);
  const comEstilo = (o = {}) => ({ room_id: room1, date: diaEstilo, start: '09:00', duration_minutes: 60, name: 'Zé Beats', phone: '9998887', ...o });

  r = await call('POST', '/api/public/bookings', { body: comEstilo({ style: 'Drill' }) });
  ok(r.status === 201 && r.json.booking.style === 'Drill', 'o estilo é guardado com a marcação');
  const codEstilo = r.json.booking.code;
  r = await call('POST', '/api/public/lookup', { body: { code: codEstilo, phone: '9998887' } });
  ok(r.json.booking.style === 'Drill', 'e volta na consulta');

  r = await call('POST', '/api/public/bookings', { body: comEstilo({ start: '10:00', style: '  Amapiano  ' }) });
  ok(r.json.booking.style === 'Amapiano', 'um estilo escrito à mão é aceite, sem espaços a mais');
  r = await call('POST', '/api/public/bookings', { body: comEstilo({ start: '11:00' }) });
  ok(r.json.booking.style === '', 'sem estilo indicado fica vazio — o campo é opcional');
  r = await call('POST', '/api/public/bookings', { body: comEstilo({ start: '12:00', style: 'x'.repeat(200) }) });
  ok(r.json.booking.style.length === 60, 'um estilo demasiado longo é cortado, não recusado');

  console.log('\nPáginas');
  for (const p of ['/', '/marcar', '/consultar', '/admin']) {
    const res = await fetch(base + p);
    const html = await res.text();
    ok(res.status === 200 && !html.includes('{{'), `página ${p} carrega e não tem marcadores por substituir`);
  }
  let res = await fetch(base + '/css/base.css'); ok(res.status === 200, 'CSS estático servido');
  res = await fetch(base + '/js/common.js'); ok(res.status === 200, 'JS estático servido');
  res = await fetch(base + '/inexistente'); ok(res.status === 404, '404 para páginas inexistentes');

  console.log('\nLínguas');
  const pagina = (url, lingua) => fetch(base + url, { headers: lingua ? { Cookie: 'lingua=' + lingua } : {} }).then((r) => r.text());
  let html = await pagina('/');
  ok(/<html lang="pt"/.test(html) && html.includes('Tempo de estúdio, marcado em minutos.'), 'sem cookie, a página sai em português');
  ok(html.includes('data-tema="escuro"'), 'sem cookie, o tema é o escuro');
  html = await pagina('/', 'en');
  ok(/<html lang="en"/.test(html) && html.includes('Studio time, booked in minutes.'), 'cookie lingua=en traduz a página inicial');
  ok(html.includes('>Book a session<') && !html.includes('Marcar sessão'), 'nada fica por traduzir no cabeçalho');
  html = await pagina('/marcar', 'fr');
  ok(/<html lang="fr"/.test(html) && html.includes('Réserver une séance'), 'cookie lingua=fr traduz a página de marcar');
  ok(html.includes('placeholder="Combien de personnes viennent'), 'os placeholders também são traduzidos');
  html = await pagina('/', 'xx');
  ok(/<html lang="pt"/.test(html), 'língua desconhecida no cookie volta ao português');
  res = await fetch(base + '/');
  ok((res.headers.get('vary') || '').toLowerCase().includes('cookie'), 'resposta marcada com Vary: Cookie');
  // O painel é interno: fica em português seja qual for a escolha no site.
  html = await pagina('/admin', 'fr');
  ok(/<html lang="pt"/.test(html) && html.includes('A carregar'), 'o painel não segue a língua do site');

  // As mensagens da API saem na língua de quem pergunta.
  const erro = (lingua) => fetch(base + '/api/public/availability?room_id=1&date=mau', { headers: { Cookie: 'lingua=' + lingua } })
    .then((r) => r.json()).then((j) => j.error);
  ok(await erro('pt') === 'Data inválida.', 'erro da API em português');
  ok(await erro('en') === 'Invalid date.', 'erro da API em inglês');
  ok(await erro('fr') === 'Date invalide.', 'erro da API em francês');
  res = await fetch(base + '/inexistente', { headers: { Cookie: 'lingua=fr' } });
  ok((await res.text()).includes('Page introuvable'), 'página 404 traduzida');

  // O texto português está escrito nos próprios ficheiros e é ele que a página
  // em português mostra (o servidor nem lhe toca). Se o dicionário disser outra
  // coisa, as três línguas deixam de dizer o mesmo sem ninguém dar por isso.
  const D = require('../publico/assets/js/dicionario.js');
  const VISTAS = ['publico', 'marcacoes'].map((p) => path.join(__dirname, '..', p, 'views'));
  const TAGS = 'a|b|button|div|h1|h2|h3|h4|label|legend|li|option|output|p|small|span|strong|title';
  const reTexto = new RegExp(`<(${TAGS})\\b[^>]*\\bdata-i18n="([^"]+)"[^>]*>([^<]*)</\\1>`, 'gi');
  const reAttr = /<[a-z][a-z0-9]*\b[^>]*\bdata-i18n-attr="([^"]+)"[^>]*>/gi;
  const desencontros = [];
  const semChave = [];
  for (const [pasta, f] of VISTAS.flatMap((v) => fs.readdirSync(v).map((f) => [v, f]))) {
    const fonte = fs.readFileSync(path.join(pasta, f), 'utf8');
    for (const [, , chave, texto] of fonte.matchAll(reTexto)) {
      const pt = D.TEXTOS.pt[chave];
      if (pt === undefined) semChave.push(`${f}: ${chave}`);
      else if (pt !== texto) desencontros.push(`${f}: ${chave} — HTML "${texto}" ≠ dicionário "${pt}"`);
    }
    for (const [tag, spec] of fonte.matchAll(reAttr)) {
      for (const par of spec.trim().split(/\s+/)) {
        const i = par.indexOf(':');
        if (i <= 0) continue;
        const chave = par.slice(i + 1);
        const pt = D.TEXTOS.pt[chave];
        if (pt === undefined) { semChave.push(`${f}: ${chave}`); continue; }
        const posto = new RegExp(`\\s${par.slice(0, i)}="([^"]*)"`).exec(tag);
        // O atributo tem de estar escrito no ficheiro: em português o servidor
        // não traduz, e o que não estiver lá nunca chega a ser acrescentado.
        if (!posto) { desencontros.push(`${f}: falta o atributo ${par.slice(0, i)} (de ${chave}) no HTML`); continue; }
        // Escapes à parte: no HTML as aspas e o & vêm codificados.
        const limpo = posto[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        if (limpo !== pt) desencontros.push(`${f}: ${par.slice(0, i)} de ${chave} — "${limpo}" ≠ "${pt}"`);
      }
    }
  }
  ok(semChave.length === 0, 'todas as chaves usadas nas páginas existem no dicionário' + (semChave.length ? ': ' + semChave.join('; ') : ''));
  ok(desencontros.length === 0, 'o texto português das páginas bate certo com o dicionário' + (desencontros.length ? ': ' + desencontros.slice(0, 3).join('; ') : ''));

  // Uma chave que falte (dicionário por recarregar, tradução ainda por fazer)
  // não pode apagar o original: o nome da chave nunca vai parar à página.
  const guardado = { ...D.TEXTOS.pt, ...{} };
  const arrumar = { pt: D.TEXTOS.pt['botao.seguinte'], en: D.TEXTOS.en['botao.seguinte'], fr: D.TEXTOS.fr['botao.seguinte'] };
  for (const l of ['pt', 'en', 'fr']) delete D.TEXTOS[l]['botao.seguinte'];
  for (const [lingua, esperado] of [['pt', 'Seguinte'], ['en', 'Seguinte'], ['fr', 'Seguinte']]) {
    const h = await pagina('/marcar', lingua);
    const b = /<button[^>]*id="btn-seguinte"[^>]*>([^<]*)<\/button>/.exec(h);
    ok(b && b[1] === esperado, `chave em falta (${lingua}): fica o original "${b && b[1]}", não o nome da chave`);
  }
  for (const l of ['pt', 'en', 'fr']) D.TEXTOS[l]['botao.seguinte'] = arrumar[l];
  ok(D.TEXTOS.pt['botao.seguinte'] === guardado['botao.seguinte'], 'dicionário reposto depois do teste');
  res = await fetch(base + '/api/public/bookings', { method: 'POST', headers: { 'X-Requested-With': 'studio', 'Content-Type': 'application/json' }, body: '{mau json' });
  ok(res.status === 400, 'JSON inválido → 400 (não 500)');

  console.log(`\n${passed} certos, ${failed} falhados`);
  server.close();
  mapas.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
