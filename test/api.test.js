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
  const u = new URL(req.url, 'http://x');
  // De coordenadas para país (o que o estúdio usa para propor a taxa de IVA).
  if (u.pathname === '/reverse') {
    const lat = Number(u.searchParams.get('lat')), lon = Number(u.searchParams.get('lon'));
    if (lat === 0) { res.writeHead(500).end('nao'); return; }
    const cc = lat > 14 && lat < 18 && lon < -22 ? 'cv' : lon < -6 && lat > 30 ? 'pt' : lat > 42 && lon > -5 && lon < 8 ? 'fr' : '';
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(cc ? { address: { country_code: cc } } : { error: 'Unable to geocode' }));
    return;
  }
  const q = decodeURIComponent(u.searchParams.get('q') || '');
  if (/rebentar/i.test(q)) { res.writeHead(500).end('nao'); return; }
  const achado = /assomada/i.test(q) ? [{ lat: '15.1000', lon: '-23.6833', display_name: 'Assomada, Santa Catarina, Cabo Verde' }]
    : /paris/i.test(q) ? [{ lat: '48.8566', lon: '2.3522', display_name: 'Paris, France' }] : [];
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(achado));
});
mapas.listen(0);
process.env.GEOCODER_URL = 'http://127.0.0.1:' + mapas.address().port + '/search';

const { start } = require('../backend/server');
const U = require('../backend/lib/util');
const contaAuth = require('../backend/lib/conta-auth');
const { db } = require('../backend/lib/db');

let server, base, passed = 0, failed = 0;
// Marcar passou a exigir sessão de cliente. Guarda-se aqui o cookie da conta de
// teste e, para não o repetir em cada marcação, o call() liga-o sozinho aos
// pedidos de marcação do site. Quem quiser testar sem conta passa anon: true.
let clientCookie = null;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ✓', msg); } else { failed++; console.log('  ✗ FALHOU:', msg); } };

async function call(method, url, { body, cookie, headers = {}, anon = false } = {}) {
  const h = { 'X-Requested-With': 'studio', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const autoConta = !anon && method === 'POST' && url.startsWith('/api/public/bookings') ? clientCookie : null;
  const usar = cookie || autoConta;
  if (usar) h.Cookie = usar;
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

  // Conta de cliente usada em todas as marcações do site (marcar exige login).
  // Os dados de contacto da marcação passam a vir daqui, não do formulário.
  const signup = async (body) => {
    const resp = await call('POST', '/api/conta/signup', { body });
    const c = resp.res.headers.get('set-cookie');
    return { r: resp, cookie: c ? c.split(';')[0] : null };
  };
  const conta = await signup({ name: 'Ana Silva', email: 'ana@teste.cv', phone: '991 23 45', password: 'cliente-1234' });
  ok(conta.r.status === 201 && conta.cookie, 'criar conta de cliente devolve cookie de sessão');
  clientCookie = conta.cookie;

  const payload = (o = {}) => ({ room_id: room1, date: day, start: '10:00', duration_minutes: 120, title: 'Single novo', ...o });
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
  r = await call('POST', '/api/public/bookings', { body: payload({ start: '14:00' }), anon: true });
  ok(r.status === 401, 'marcar sem conta → 401 (login obrigatório)');
  r = await call('GET', '/api/public/my-bookings', { anon: true });
  ok(r.status === 401, 'ver as minhas marcações sem conta → 401');
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

  console.log('\nContas de cliente');
  r = await call('POST', '/api/conta/signup', { body: { name: 'Outro', email: 'ana@teste.cv', phone: '9900001', password: 'cliente-1234' } });
  ok(r.status === 409, 'email já usado → 409');
  r = await call('POST', '/api/conta/signup', { body: { name: 'Outro', email: 'outro@teste.cv', phone: '9912345', password: 'cliente-1234' } });
  ok(r.status === 409, 'telefone já usado → 409');
  r = await call('POST', '/api/conta/login', { body: { identifier: 'ana@teste.cv', password: 'errada' } });
  ok(r.status === 401, 'login de cliente com senha errada → 401');
  let cl = await call('POST', '/api/conta/login', { body: { identifier: '991 23 45', password: 'cliente-1234' } });
  ok(cl.status === 200 && cl.json.client.email === 'ana@teste.cv', 'login de cliente pelo telefone funciona');
  const cc = cl.res.headers.get('set-cookie').split(';')[0];
  r = await call('GET', '/api/conta/me', { cookie: cc });
  ok(r.status === 200 && r.json.client.name === 'Ana Silva', 'me devolve a conta com sessão');
  r = await call('GET', '/api/public/my-bookings', { cookie: cc });
  ok(r.status === 200 && r.json.bookings.length >= 1, 'as minhas marcações lista as da conta');
  // Recuperação: pedir código (responde ok mesmo sem fornecedor de envio) e,
  // com o código, redefinir a palavra-passe. O código em claro vem do helper.
  r = await call('POST', '/api/conta/forgot', { body: { identifier: 'ana@teste.cv', channel: 'email' } });
  ok(r.status === 200 && r.json.ok, 'pedir código de recuperação responde ok');
  r = await call('POST', '/api/conta/forgot', { body: { identifier: 'ana@teste.cv' } });
  ok(r.status === 400, 'pedir código sem escolher canal → 400');
  const clientId = db.prepare('SELECT id FROM clients WHERE email=?').get('ana@teste.cv').id;
  r = await call('POST', '/api/conta/reset', { body: { identifier: 'ana@teste.cv', code: '000000', password: 'nova-senha-1' } });
  ok(r.status === 400, 'código errado → 400');
  const codigo = contaAuth.issueCode(clientId, 'reset', 'email');
  r = await call('POST', '/api/conta/reset', { body: { identifier: 'ana@teste.cv', code: codigo, password: 'nova-senha-1' } });
  ok(r.status === 200, 'código certo redefine a palavra-passe');
  r = await call('POST', '/api/conta/login', { body: { identifier: 'ana@teste.cv', password: 'nova-senha-1' } });
  ok(r.status === 200, 'entra com a palavra-passe nova');
  clientCookie = r.res.headers.get('set-cookie').split(';')[0];

  // Alterar a palavra-passe com sessão iniciada.
  r = await call('POST', '/api/conta/password', { cookie: clientCookie, body: { current: 'errada', next: 'outra-senha-9' } });
  ok(r.status === 400, 'alterar senha com a atual errada → 400');
  r = await call('POST', '/api/conta/password', { cookie: clientCookie, body: { current: 'nova-senha-1', next: 'curta' } });
  ok(r.status === 400, 'nova senha curta → 400');
  r = await call('POST', '/api/conta/password', { cookie: clientCookie, body: { current: 'nova-senha-1', next: 'outra-senha-9' } });
  ok(r.status === 200, 'alterar a palavra-passe com sessão');
  r = await call('POST', '/api/conta/login', { body: { identifier: 'ana@teste.cv', password: 'outra-senha-9' } });
  ok(r.status === 200, 'entra com a palavra-passe alterada');
  r = await call('POST', '/api/conta/password', { body: { current: 'x', next: 'yyyyyyyy' } });
  ok(r.status === 401, 'alterar senha sem sessão → 401');

  // Login único: uma conta da equipa entra pelo mesmo login do site e é levada
  // ao painel, com sessão de painel válida (cookie sid, não csid).
  r = await call('POST', '/api/conta/login', { body: { identifier: 'dono@teste.cv', password: 'palavra-passe-teste' } });
  ok(r.status === 200 && r.json.redirect === '/admin' && !r.json.client, 'conta de equipa entra pelo /conta e é mandada para /admin');
  const sidEquipa = r.res.headers.get('set-cookie').split(';')[0];
  r = await call('GET', '/api/auth/me', { cookie: sidEquipa });
  ok(r.status === 200 && r.json.user.email === 'dono@teste.cv', 'e fica com sessão de painel válida');
  r = await call('POST', '/api/conta/login', { body: { identifier: 'dono@teste.cv', password: 'errada' } });
  ok(r.status === 401, 'equipa com senha errada no /conta → 401');

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
  ok(r.status === 200 && r.json.booking.status === 'aguarda_pagamento' && r.json.aguarda_pagamento === true, 'aceitar um pedido do site com valor: fica "aguarda pagamento" e o cliente é avisado');

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
  ok(r.status === 201 && r.json.booking.status === 'aguarda_pagamento', 'confirmação automática ativa: com valor, nasce "aguarda pagamento" (o estúdio aceitou; falta pagar)');
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

  console.log('\nAgentes de estúdio');
  const sts = (await call('GET', '/api/admin/studios', { cookie })).json.studios;
  const st1 = sts[0], st2 = sts[1];
  const sala1 = st1.rooms[0].id, sala2 = st2.rooms[0].id;
  // Perfil agente exige estúdio válido.
  r = await call('POST', '/api/admin/users', { cookie, body: { name: 'Agente', email: 'agente@teste.cv', password: 'agente-1234', role: 'agent' } });
  ok(r.status === 400, 'agente sem estúdio → 400');
  r = await call('POST', '/api/admin/users', { cookie, body: { name: 'Agente', email: 'agente@teste.cv', password: 'agente-1234', role: 'agent', studio_id: st1.id } });
  ok(r.status === 201, 'criar agente preso ao estúdio 1');
  // O painel vê o perfil como "agent" e o estúdio.
  const lista = (await call('GET', '/api/admin/users', { cookie })).json.users;
  const noPainel = lista.find((u) => u.email === 'agente@teste.cv');
  ok(noPainel && noPainel.role === 'agent' && noPainel.studio_id === st1.id, 'a lista mostra o perfil agente e o estúdio');

  const ag = await login('agente@teste.cv', 'agente-1234');
  ok(ag.r.status === 200 && ag.r.json.user.studio_id === st1.id, 'o agente entra e a sessão traz o seu estúdio');
  const ac = ag.cookie;
  // Só vê o seu estúdio.
  r = await call('GET', '/api/admin/studios', { cookie: ac });
  ok(r.status === 200 && r.json.studios.length === 1 && r.json.studios[0].id === st1.id, 'o agente só vê o seu estúdio');
  // Marcações: só as do seu estúdio.
  r = await call('GET', '/api/admin/bookings', { cookie: ac });
  ok(r.status === 200 && r.json.bookings.every((b) => b.studio_id === st1.id), 'o agente só vê marcações do seu estúdio');
  // Não mexe na configuração geral.
  r = await call('POST', '/api/admin/studios', { cookie: ac, body: { name: 'Pirata', hours: [null, null, null, null, null, null, null] } });
  ok(r.status === 403, 'o agente não cria estúdios (403)');
  r = await call('GET', '/api/admin/users', { cookie: ac });
  ok(r.status === 403, 'o agente não vê a gestão de acesso (403)');
  // Marcar: no seu estúdio sim, noutro não.
  const marcar = (sala) => ({ cookie: ac, body: { room_id: sala, date: futureWeekday(24), start: '15:00', end: '16:00', client_name: 'Cliente', status: 'confirmado' } });
  r = await call('POST', '/api/admin/bookings', marcar(sala2));
  ok(r.status === 403, 'o agente não marca noutro estúdio (403)');
  r = await call('POST', '/api/admin/bookings', marcar(sala1));
  ok(r.status === 201, 'o agente marca no seu estúdio');
  // Uma marcação do estúdio 2 não existe para ele.
  const bk2 = (await call('GET', `/api/admin/bookings?studio_id=${st2.id}`, { cookie })).json.bookings[0];
  r = await call('GET', `/api/admin/bookings/${bk2.id}`, { cookie: ac });
  ok(r.status === 404, 'uma marcação de outro estúdio não existe para o agente (404)');

  console.log('\nControlo de acesso (RBAC)');
  r = await call('GET', '/api/admin/rbac', { cookie });
  ok(r.status === 200 && r.json.roles.length === 3 && r.json.permissions.length === 15, 'RBAC: 3 perfis e 15 permissões de origem');
  ok(r.json.assignments.some((a) => a.role_name === 'Proprietário'), 'RBAC: o proprietário já tem o perfil atribuído');
  r = await call('GET', '/api/admin/rbac', { cookie: staff.cookie });
  ok(r.status === 403, 'RBAC: a equipa não acede (só proprietário)');
  r = await call('POST', '/api/admin/rbac/permissions', { cookie, body: { label: 'Reservas – Criar', resource: 'reservas', action: 'criar' } });
  ok(r.status === 201 && r.json.code === 'reservas.criar', 'RBAC: cria permissão');
  r = await call('POST', '/api/admin/rbac/permissions', { cookie, body: { label: 'Dup', resource: 'reservas', action: 'criar' } });
  ok(r.status === 409, 'RBAC: permissão duplicada → 409');
  let rb = (await call('GET', '/api/admin/rbac', { cookie })).json;
  r = await call('POST', '/api/admin/rbac/roles', { cookie, body: { name: 'Comercial', code: 'comercial', priority: 50, category: 'comercial', permissions: [rb.permissions[0].id] } });
  ok(r.status === 201, 'RBAC: cria perfil');
  const novoRoleId = r.json.id;
  r = await call('POST', '/api/admin/rbac/roles', { cookie, body: { name: 'Outro', code: 'comercial' } });
  ok(r.status === 409, 'RBAC: código de perfil repetido → 409');
  rb = (await call('GET', '/api/admin/rbac', { cookie })).json;
  ok(rb.roles.some((x) => x.code === 'comercial' && x.permCount === 1), 'RBAC: o novo perfil aparece com 1 permissão');
  const tec = (await call('GET', '/api/admin/users', { cookie })).json.users.find((u) => u.email === 'tecnico@teste.cv');
  r = await call('POST', '/api/admin/rbac/assignments', { cookie, body: { user_id: tec.id, role_ids: [novoRoleId] } });
  ok(r.status === 201 && r.json.atribuidos === 1, 'RBAC: atribui perfil a um utilizador');
  const sistemaRole = rb.roles.find((x) => x.is_system);
  r = await call('DELETE', '/api/admin/rbac/roles/' + sistemaRole.id, { cookie });
  ok(r.status === 400, 'RBAC: não elimina perfil de sistema');
  r = await call('DELETE', '/api/admin/rbac/roles/' + novoRoleId, { cookie });
  ok(r.status === 200, 'RBAC: elimina perfil personalizado (e as suas atribuições)');

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
  r = await call('POST', '/api/public/lookup', { body: { code: codEstilo, phone: '9912345' } });
  ok(r.json.booking.style === 'Drill', 'e volta na consulta');

  r = await call('POST', '/api/public/bookings', { body: comEstilo({ start: '10:00', style: '  Amapiano  ' }) });
  ok(r.json.booking.style === 'Amapiano', 'um estilo escrito à mão é aceite, sem espaços a mais');
  r = await call('POST', '/api/public/bookings', { body: comEstilo({ start: '11:00' }) });
  ok(r.json.booking.style === '', 'sem estilo indicado fica vazio — o campo é opcional');
  r = await call('POST', '/api/public/bookings', { body: comEstilo({ start: '12:00', style: 'x'.repeat(200) }) });
  ok(r.json.booking.style.length === 60, 'um estilo demasiado longo é cortado, não recusado');

  console.log('\nPáginas');
  for (const p of ['/', '/marcar', '/consultar', '/conta', '/admin']) {
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

  // O que o dono escreve no painel (serviços, salas, estúdios, frase, termos)
  // também tem versão em inglês e francês; sem ela, fica o português.
  console.log('\nConteúdo traduzido');
  let cfgPub = (await call('GET', '/api/public/config')).json;
  const gravacao = cfgPub.services.find((s) => s.name === 'Gravação');
  ok(gravacao && gravacao.i18n.en.name === 'Recording' && gravacao.i18n.fr.name === 'Enregistrement',
    'os serviços de exemplo já vêm traduzidos');
  ok(cfgPub.studios[0].rooms[0].i18n.en && cfgPub.studios[0].i18n.fr.city, 'as salas e as cidades de exemplo também');
  // Os testes de cima já mudaram a frase e os termos: as traduções de exemplo
  // deixam de servir e não podem aparecer coladas a um texto que não é o delas.
  ok(cfgPub.business.i18n && !cfgPub.business.i18n.en, 'frase mudada sem tradução: não fica a tradução de exemplo da antiga');

  const svAntes = (await call('GET', '/api/admin/services', { cookie: ckDono })).json.services.find((s) => s.id === gravacao.id);
  r = await call('PUT', `/api/admin/services/${gravacao.id}`, { cookie: ckDono, body: {
    name: svAntes.name, description: svAntes.description, remote_ok: !!svAntes.remote_ok, active: true,
    traducoes: { en: { name: '  Studio recording ', description: '' }, fr: { name: '   ', inventado: 'x' }, de: { name: 'Aufnahme' } },
  } });
  ok(r.status === 200, 'guardar um serviço com traduções');
  let svDepois = (await call('GET', '/api/admin/services', { cookie: ckDono })).json.services.find((s) => s.id === gravacao.id);
  ok(JSON.stringify(JSON.parse(svDepois.traducoes)) === '{"en":{"name":"Studio recording"}}',
    'só ficam as línguas e os campos conhecidos, aparados e sem vazios: ' + svDepois.traducoes);
  r = await call('PUT', `/api/admin/services/${gravacao.id}`, { cookie: ckDono, body: {
    name: svAntes.name, description: svAntes.description, remote_ok: !!svAntes.remote_ok, active: true,
  } });
  svDepois = (await call('GET', '/api/admin/services', { cookie: ckDono })).json.services.find((s) => s.id === gravacao.id);
  ok(svDepois.traducoes.includes('Studio recording'), 'um pedido sem traduções não apaga as que havia');
  cfgPub = (await call('GET', '/api/public/config')).json;
  const g2 = cfgPub.services.find((s) => s.id === gravacao.id);
  ok(g2.i18n.en.name === 'Studio recording' && !g2.i18n.fr, 'o site recebe a tradução nova; o francês, vazio, cai no português');
  await call('PUT', `/api/admin/services/${gravacao.id}`, { cookie: ckDono, body: {
    name: svAntes.name, description: svAntes.description, remote_ok: !!svAntes.remote_ok, active: true, traducoes: svAntes.traducoes,
  } });

  const defs = (await call('GET', '/api/admin/settings', { cookie: ckDono })).json.settings;
  r = await call('PUT', '/api/admin/settings', { cookie: ckDono, body: { ...defs, traducoes: { en: { tagline: 'Beats and vocals' }, fr: {} } } });
  ok(r.status === 200 && r.json.settings.traducoes.en.tagline === 'Beats and vocals' && !r.json.settings.traducoes.fr,
    'as definições guardam as traduções da frase e dos termos');
  ok((await pagina('/', 'en')).includes('Beats and vocals') && (await pagina('/', 'fr')).includes(defs.tagline),
    'a página em inglês usa a frase nova; a francesa, sem tradução, mostra a portuguesa');
  await call('PUT', '/api/admin/settings', { cookie: ckDono, body: defs });

  // O texto português está escrito nos próprios ficheiros e é ele que a página
  // em português mostra (o servidor nem lhe toca). Se o dicionário disser outra
  // coisa, as três línguas deixam de dizer o mesmo sem ninguém dar por isso.
  const D = require('../comum/assets/js/dicionario.js');
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

  // Expirado: um pedido que ninguém confirmou até à hora passa a "expirado" e
  // deixa a sala livre.
  console.log('\nExpirado');
  const { expirarPedidos, findConflict } = require('../backend/lib/db');
  const ontem = U.addDays(U.nowLocal().date, -1);
  const salaX = db.prepare('SELECT id FROM rooms ORDER BY id LIMIT 1').get().id;
  const agoraIso = new Date().toISOString();
  const velho = db.prepare(`INSERT INTO bookings(code,room_id,date,start_min,end_min,client_name,status,created_at,updated_at)
                            VALUES('EXPTST',?,?,600,660,'Teste','pedido',?,?)`).run(salaX, ontem, agoraIso, agoraIso).lastInsertRowid;
  ok(!!findConflict(salaX, ontem, 600, 660), 'o pedido por confirmar ocupa a sala');
  ok(expirarPedidos() >= 1, 'o pedido de ontem expira');
  ok(db.prepare('SELECT status FROM bookings WHERE id=?').get(velho).status === 'expirado', 'fica com o estado "expirado"');
  ok(!findConflict(salaX, ontem, 600, 660), 'e a sala fica livre');
  db.prepare('DELETE FROM bookings WHERE id=?').run(velho);

  // Gravação prolongada: o projeto bloqueia a sala no período; se uma marcação
  // ativa coincidir, dá erro de conflito e não guarda nada.
  console.log('\nGravação prolongada');
  const dono = cookie;   // a sessão do dono aberta no início continua válida
  ok(!!dono, 'sessão do dono para os projetos');
  const diaG = U.addDays(U.nowLocal().date, 40);
  const marcG = db.prepare(`INSERT INTO bookings(code,room_id,date,start_min,end_min,client_name,status,created_at,updated_at)
                            VALUES('GRVTST',?,?,600,720,'Cliente Esquecido','confirmado',?,?)`).run(salaX, U.addDays(diaG, 1), agoraIso, agoraIso).lastInsertRowid;
  const corpoG = { tipo: 'gravacao', titulo: 'Álbum do Djodje', artista: 'Djodje', room_id: salaX, data_inicio: diaG, data_fim: U.addDays(diaG, 2), hora_inicio: '09:00', hora_fim: '13:00' };
  const blocosDe = (pid) => db.prepare('SELECT COUNT(*) n FROM blocks WHERE projeto_id=?').get(pid).n;
  const projetosAntes = db.prepare('SELECT COUNT(*) n FROM int_projetos').get().n;
  r = await call('POST', '/api/admin/integracoes/projetos', { cookie: dono, body: corpoG });
  ok(r.status === 409 && /Conflito de horário/.test(r.json.error) && /GRVTST/.test(r.json.error), 'marcação no período: erro de conflito com o código da marcação');
  ok(db.prepare('SELECT COUNT(*) n FROM int_projetos').get().n === projetosAntes && !db.prepare("SELECT 1 FROM blocks WHERE reason LIKE 'Gravação prolongada%'").get(), 'com conflito, nem o projeto nem os bloqueios ficam guardados');
  db.prepare("UPDATE bookings SET status='cancelado' WHERE id=?").run(marcG);
  r = await call('POST', '/api/admin/integracoes/projetos', { cookie: dono, body: corpoG });
  ok(r.status === 200 && r.json.projeto && r.json.projeto.tipo === 'gravacao', 'sem conflito, o projeto guarda-se');
  const pidG = r.json.projeto.id;
  ok(blocosDe(pidG) === 3, 'um bloqueio por dia (3 dias)');
  ok(!!findConflict(salaX, U.addDays(diaG, 1), 600, 660) && !findConflict(salaX, U.addDays(diaG, 1), 840, 900), 'a sala fica bloqueada só no horário da gravação');
  r = await call('POST', '/api/admin/bookings', { cookie: dono, body: { room_id: salaX, date: diaG, start: '10:00', end: '11:00', client_name: 'Novo', status: 'confirmado' } });
  ok(r.status === 409, 'nesse horário o estúdio não aceita marcações');
  r = await call('PUT', `/api/admin/integracoes/projetos/${pidG}`, { cookie: dono, body: { ...corpoG, data_fim: diaG, dia_inteiro: true } });
  ok(r.status === 200 && blocosDe(pidG) === 1 && db.prepare('SELECT start_min s, end_min e FROM blocks WHERE projeto_id=?').get(pidG).e === 1440, 'editar refaz os bloqueios (1 dia, o dia inteiro)');
  r = await call('GET', '/api/integracoes/projetos');
  ok(!(r.json.projetos || []).some((p) => p.id === pidG), 'a gravação prolongada não aparece no site');
  r = await call('DELETE', `/api/admin/integracoes/projetos/${pidG}`, { cookie: dono });
  ok(r.status === 200 && blocosDe(pidG) === 0, 'apagar o projeto liberta a sala');
  db.prepare('DELETE FROM bookings WHERE id=?').run(marcG);

  // Recibo em PDF: o painel e o cliente (com o código e o telefone) descarregam-no;
  // o cabeçalho leva os dados do estúdio preenchidos em Estúdios.
  console.log('\nRecibo');
  const estR = db.prepare('SELECT s.* FROM studios s JOIN rooms r ON r.studio_id=s.id WHERE r.id=?').get(salaX);
  r = await call('PUT', `/api/admin/studios/${estR.id}`, { cookie: dono, body: { ...estR, hours: JSON.parse(estR.hours), legal_name: 'Produções Teste, Lda.', nif: '987654321', email: 'Geral@Teste.cv' } });
  ok(r.status === 200, 'o estúdio guarda o nome no recibo, o NIF e o email');
  const estR2 = db.prepare('SELECT legal_name, nif, email FROM studios WHERE id=?').get(estR.id);
  ok(estR2.legal_name === 'Produções Teste, Lda.' && estR2.nif === '987654321' && estR2.email === 'geral@teste.cv', 'os dados do recibo ficam no estúdio');
  r = await call('PUT', `/api/admin/studios/${estR.id}`, { cookie: dono, body: { ...estR, hours: JSON.parse(estR.hours), email: 'nao-e-email' } });
  ok(r.status === 400, 'email do estúdio inválido: recusado');
  const marcR = db.prepare(`INSERT INTO bookings(code,room_id,date,start_min,end_min,client_name,client_phone,status,price,paid,created_at,updated_at)
                            VALUES('RECTST',?,?,600,720,'Gil Gomes','9912345','confirmado',5000,2000,?,?)`).run(salaX, U.addDays(U.nowLocal().date, 50), agoraIso, agoraIso).lastInsertRowid;
  let pdf = await fetch(base + `/api/admin/bookings/${marcR}/recibo.pdf`, { headers: { Cookie: dono } });
  let bytes = Buffer.from(await pdf.arrayBuffer());
  ok(pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf' && bytes.slice(0, 4).toString() === '%PDF', 'o painel descarrega o recibo em PDF');
  ok(/recibo-RECTST\.pdf/.test(pdf.headers.get('content-disposition') || ''), 'o ficheiro chama-se recibo-<código>.pdf');
  ok((bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length === 1, 'o recibo cabe numa página');
  pdf = await fetch(base + `/api/admin/bookings/${marcR}/recibo.pdf`);
  ok(pdf.status === 401, 'sem sessão, o painel não dá o recibo');
  r = await call('POST', '/api/public/recibo', { body: { code: 'RECTST', phone: '991 23 45' } });
  ok(r.status === 200 && r.res.headers.get('content-type') === 'application/pdf', 'o cliente descarrega o recibo com o código e o telefone');
  r = await call('POST', '/api/public/recibo', { body: { code: 'RECTST', phone: '000 00 00' } });
  ok(r.status === 404, 'com outro telefone, o recibo não sai');
  // Relatório em PDF (Folha de Marcações): A4 deitado, com a marcação na tabela.
  pdf = await fetch(base + '/api/admin/reports.pdf', { headers: { Cookie: dono } });
  bytes = Buffer.from(await pdf.arrayBuffer());
  const txtPdf = bytes.toString('latin1');
  ok(pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf' && txtPdf.startsWith('%PDF'), 'o relatório descarrega-se em PDF');
  ok(/\/MediaBox \[0 0 841\.89 595\.28\]/.test(txtPdf), 'o relatório vem em A4 deitado');
  ok(/relatorio-inicio_a_hoje\.pdf/.test(pdf.headers.get('content-disposition') || ''), 'o ficheiro do relatório tem o período no nome');
  // Faturas internas: o IVA vem da localização do estúdio; numeração seguida
  // por série do ano; uma fatura em vigor por marcação; anular não liberta o número.
  console.log('\nIVA pela localização e faturas');
  r = await call('GET', '/api/admin/fiscal?lat=15.1&lon=-23.68', { cookie: dono });
  ok(r.status === 200 && r.json.fiscal.codigo === 'cv' && r.json.fiscal.taxa === 15 && r.json.fiscal.fonte === 'mapa', 'Assomada → Cabo Verde, IVA 15% (pelo serviço de mapas)');
  r = await call('GET', '/api/admin/fiscal?lat=37.74&lon=-25.67', { cookie: dono });
  ok(r.json.fiscal.codigo === 'pt' && r.json.fiscal.regiao === 'Açores' && r.json.fiscal.taxa === 16, 'Ponta Delgada → Portugal (Açores), IVA 16%');
  r = await call('GET', '/api/admin/fiscal?lat=48.86&lon=2.35', { cookie: dono });
  ok(r.json.fiscal.codigo === 'fr' && r.json.fiscal.taxa === 20, 'Paris → França, IVA 20%');
  ok(require('../backend/lib/fiscal').aproximar(16.89, -24.98).codigo === 'cv', 'sem serviço de mapas, a tabela local reconhece Cabo Verde (São Vicente)');
  r = await call('PUT', `/api/admin/studios/${estR.id}`, { cookie: dono, body: { ...estR, ...estR2, hours: JSON.parse(estR.hours), lat: 15.1, lon: -23.68, vat_rate: '' } });
  let estF = db.prepare('SELECT country_code, tax_name, vat_rate FROM studios WHERE id=?').get(estR.id);
  ok(r.status === 200 && estF.country_code === 'cv' && estF.vat_rate === 15, 'guardar o estúdio sem taxa: fica com a do país onde está (15%)');
  r = await call('PUT', `/api/admin/studios/${estR.id}`, { cookie: dono, body: { ...estR, ...estR2, hours: JSON.parse(estR.hours), lat: 15.1, lon: -23.68, country_code: 'cv', vat_rate: '8' } });
  ok(db.prepare('SELECT vat_rate FROM studios WHERE id=?').get(estR.id).vat_rate === 8, 'a taxa proposta pode ser corrigida à mão');
  await call('PUT', `/api/admin/studios/${estR.id}`, { cookie: dono, body: { ...estR, ...estR2, hours: JSON.parse(estR.hours), lat: 15.1, lon: -23.68, country_code: 'cv', vat_rate: '15' } });

  const ano = U.nowLocal().date.slice(0, 4);
  const novaMarc = (code, status) => db.prepare(`INSERT INTO bookings(code,room_id,date,start_min,end_min,client_name,client_phone,status,price,paid,created_at,updated_at)
                                VALUES(?,?,?,600,720,'Gil Gomes','9912345',?,1150,0,?,?)`).run(code, salaX, U.addDays(U.nowLocal().date, 60), status, agoraIso, agoraIso).lastInsertRowid;
  const mF = novaMarc('FATTS1', 'confirmado'), mP = novaMarc('FATTS2', 'pedido');
  r = await call('POST', `/api/admin/bookings/${mP}/fatura`, { cookie: dono, body: {} });
  ok(r.status === 400, 'um pedido por confirmar não se fatura');
  r = await call('POST', `/api/admin/bookings/${mF}/fatura`, { cookie: dono, body: { cliente_nif: '123456789', cliente_morada: 'Assomada' } });
  const fat1 = r.json.fatura;
  ok(r.status === 201 && fat1.serie === 'FT ' + ano && fat1.numero_texto.startsWith('FT ' + ano + '/'), 'emitir: fatura da série do ano (' + (fat1 && fat1.numero_texto) + ')');
  ok(fat1.total === 1150 && fat1.base === 1000 && fat1.imposto === 150 && fat1.taxa === 15, 'o valor inclui o IVA: 1150 = 1000 + 150 (15%)');
  ok(fat1.cliente_nif === '123456789' && fat1.emitente.nif === '987654321', 'a fatura guarda o NIF do cliente e os dados do estúdio');
  r = await call('POST', `/api/admin/bookings/${mF}/fatura`, { cookie: dono, body: {} });
  ok(r.status === 409, 'só uma fatura em vigor por marcação');
  pdf = await fetch(base + `/api/admin/faturas/${fat1.id}.pdf`, { headers: { Cookie: dono } });
  bytes = Buffer.from(await pdf.arrayBuffer());
  ok(pdf.status === 200 && bytes.slice(0, 4).toString() === '%PDF' && (bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length === 1, 'a fatura descarrega-se em PDF, numa página');
  r = await call('POST', `/api/admin/faturas/${fat1.id}/anular`, { cookie: dono, body: {} });
  ok(r.status === 400, 'anular pede o motivo');
  r = await call('POST', `/api/admin/faturas/${fat1.id}/anular`, { cookie: dono, body: { motivo: 'NIF errado' } });
  ok(r.status === 200 && r.json.fatura.estado === 'anulada', 'anular a fatura');
  r = await call('POST', `/api/admin/bookings/${mF}/fatura`, { cookie: dono, body: { cliente_nif: '111222333' } });
  ok(r.status === 201 && r.json.fatura.numero === fat1.numero + 1, 'depois de anular emite-se outra, com o número seguinte (sem reaproveitar)');
  r = await call('GET', `/api/admin/bookings/${mF}/fatura`, { cookie: dono });
  ok(r.json.fatura.numero === fat1.numero + 1 && r.json.anuladas.length === 1, 'a marcação mostra a fatura em vigor e a anulada no histórico');
  db.prepare('DELETE FROM bookings WHERE id IN (?,?)').run(mF, mP);

  // Pagamento no site (/pagar), em demonstração: o estúdio aceita, o cliente
  // junta um cartão de teste, paga, e a marcação fica confirmada com recibo.
  console.log('\nPagamento no site');
  r = await call('GET', '/api/pagamento/config', { cookie: clientCookie });
  ok(r.status === 200 && r.json.modo === 'off', 'sem Stripe e sem demonstração ligada: pagamento no site desligado (nunca por falta de chaves)');
  process.env.PAGAMENTOS_DEMO = '1';
  r = await call('GET', '/api/pagamento/config', { cookie: clientCookie });
  ok(r.json.modo === 'demo', 'com PAGAMENTOS_DEMO=1: modo de demonstração');
  r = await call('GET', '/api/pagamento/config');
  ok(r.status === 401, 'a página de pagamento exige a conta do cliente');
  r = await call('POST', '/api/public/bookings', { cookie: clientCookie, body: { room_id: salaX, date: futureWeekday(12), start: '15:00', duration_minutes: 120 } });
  if (r.status !== 201) console.log('   marcação de teste:', r.status, r.json);
  const codeP = r.json.booking.code;
  const idP = db.prepare('SELECT id FROM bookings WHERE code=?').get(codeP).id;
  // As definições do teste confirmam sozinhas: o pedido nasce já aceite, a aguardar pagamento.
  ok(db.prepare('SELECT status FROM bookings WHERE id=?').get(idP).status === 'aguarda_pagamento', 'pedido aceite (confirmação automática): aguarda pagamento');
  r = await call('POST', '/api/pagamento/marcacao', { cookie: clientCookie, body: { code: codeP } });
  const res0 = r.json.resumo;
  ok(res0.pode_pagar && res0.taxa === 15 && Math.abs(res0.base + res0.imposto - res0.total) < 0.01, 'resumo com o IVA do estúdio (base + IVA = total)');
  r = await call('POST', '/api/pagamento/cartoes', { cookie: clientCookie, body: { marca: 'visa', ultimos: '1111', mes: 8, ano: 2030 } });
  ok(r.status === 400, 'na demonstração, um cartão que não é de teste é recusado');
  r = await call('POST', '/api/pagamento/cartoes', { cookie: clientCookie, body: { marca: 'visa', ultimos: '4242', mes: 8, ano: 2030, titular: 'Ana' } });
  ok(r.status === 201 && r.json.cartoes.length >= 1 && r.json.cartoes[0].ultimos === '4242', 'o cartão de teste fica na carteira (só marca e 4 dígitos)');
  ok(!db.prepare("SELECT 1 FROM pag_cartoes WHERE externo_id LIKE '%4242424242%'").get(), 'o número completo do cartão nunca é guardado');
  const cartaoP = r.json.cartoes[0].id;
  r = await call('POST', '/api/pagamento/pagar', { cookie: clientCookie, body: { code: codeP, cartao_id: cartaoP } });
  ok(r.status === 200 && r.json.estado === 'pago' && r.json.recibo.cartao.ultimos === '4242' && r.json.recibo.demo === true, 'pagar: pago, com recibo');
  const depois = db.prepare('SELECT status, paid, price FROM bookings WHERE id=?').get(idP);
  ok(depois.status === 'confirmado' && depois.paid === depois.price, 'pago tudo: a marcação fica confirmada');
  const recP = r.json.recibo;
  ok(!!recP.empresa.nome && recP.empresa.nif === '987654321', 'o recibo tem os dados da empresa e do estúdio');
  pdf = await fetch(base + `/api/pagamento/recibo/${recP.id}/pdf`, { headers: { Cookie: clientCookie } });
  bytes = Buffer.from(await pdf.arrayBuffer());
  ok(pdf.status === 200 && bytes.slice(0, 4).toString() === '%PDF', 'o recibo do pagamento descarrega-se em PDF');
  r = await call('POST', '/api/pagamento/pagar', { cookie: clientCookie, body: { code: codeP, cartao_id: cartaoP } });
  ok(r.status === 400, 'já pago: não se paga duas vezes');
  delete process.env.PAGAMENTOS_DEMO;
  db.prepare('DELETE FROM bookings WHERE id=?').run(idP);
  db.prepare('DELETE FROM bookings WHERE id=?').run(marcR);

  console.log(`\n${passed} certos, ${failed} falhados`);
  server.close();
  mapas.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
