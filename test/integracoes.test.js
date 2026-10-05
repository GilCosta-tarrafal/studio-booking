'use strict';
// Testes das integrações (Stripe e plataforma da gravadora), de ponta a ponta.
// O Stripe e a plataforma são servidores de mentira aqui dentro: a suite corre
// sem internet, sem contas e sem cobrar nada a ninguém.
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-int-'));
process.env.NODE_ENV = 'test';
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.ADMIN_EMAIL = 'dono@teste.cv';
process.env.ADMIN_PASSWORD = 'palavra-passe-teste';
process.env.STRIPE_SECRET_KEY = 'sk_test_123';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_teste';
process.env.GRAVADORA_WEBHOOK_SECRET = 'segredo-gravadora';
process.env.GRAVADORA_TOKEN = 'token-feed';
process.env.SITE_URL = 'https://estudio.exemplo';
// A chave do YouTube só se liga mais à frente (sem ela, a integração fica
// desligada e não há sincronização automática no arranque a estragar a conta).
// A lista de músicas é uma à parte, só para o teste (ver YOUTUBE_MUSICAS_FILE).
const musicasFile = path.join(tmp, 'youtube-musicas.js');
fs.writeFileSync(musicasFile, `module.exports = [
  { id: 'yt-berdiana', titulo: 'Berdiana', artista: 'Alex Aks, Marcia Cruz', youtube: 'https://youtu.be/BERDIANA111', link: 'https://open.spotify.com/intl-pt/track/3VP13toJkdl4BesVltNGm1', data: '2026' },
  { id: 'yt-so-youtube', titulo: 'Só no YouTube', artista: 'Djelox', youtube: 'SOYOUTUBE11', data: '2024' },
  { id: 'yt-privado', titulo: 'Privado', youtube: 'https://www.youtube.com/watch?v=PRIVADO1234', data: '2024' },
];`);
process.env.YOUTUBE_MUSICAS_FILE = musicasFile;

// PNG de 1×1, para as capas.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const pedidosStripe = [];
let feed = [];
let feedAutorizacao = null;
// Views que o "YouTube" de mentira devolve. O vídeo privado não está aqui, por
// isso não vem na resposta — como um vídeo mesmo privado ou apagado.
const VIEWS = { BERDIANA111: 967000, SOYOUTUBE11: 250000 };
const youtubePedidos = [];
const fora = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => { corpo += c; });
  req.on('end', () => {
    if (req.url === '/v1/checkout/sessions' && req.method === 'POST') {
      const campos = Object.fromEntries(new URLSearchParams(corpo));
      pedidosStripe.push({ campos, auth: req.headers.authorization });
      const id = 'cs_test_' + pedidosStripe.length;
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ id, url: 'https://checkout.stripe.com/c/pay/' + id }));
    } else if (req.url === '/feed') {
      feedAutorizacao = req.headers.authorization;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ lancamentos: feed }));
    } else if (req.url.startsWith('/youtube/v3/videos')) {
      const q = new URLSearchParams(req.url.split('?')[1] || '');
      youtubePedidos.push({ key: q.get('key'), ids: q.get('id') });
      const items = (q.get('id') || '').split(',').filter((id) => VIEWS[id] !== undefined)
        .map((id) => ({ id, statistics: { viewCount: String(VIEWS[id]) } }));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ items }));
    } else if (req.url.startsWith('/capa')) {
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG);
    } else if (req.url === '/texto') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>não é imagem</p>');
    } else {
      res.writeHead(404).end();
    }
  });
});
fora.listen(0);
const FORA = 'http://127.0.0.1:' + fora.address().port;
process.env.STRIPE_API_URL = FORA;
process.env.GRAVADORA_FEED_URL = FORA + '/feed';
process.env.YOUTUBE_API_URL = FORA + '/youtube/v3';

const { start } = require('../backend/server');
const U = require('../backend/lib/util');
const { cabecalho } = require('../integracoes/lib/assinatura');
const { db } = require('../backend/lib/db');

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

// Webhook como o fornecedor o manda: corpo em bruto e assinatura no cabeçalho.
async function webhook(fornecedor, evento, { segredo, nomeCabecalho, t } = {}) {
  const corpo = JSON.stringify(evento);
  const res = await fetch(`${base}/integracoes/webhooks/${fornecedor}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [nomeCabecalho]: cabecalho(segredo, corpo, t) },
    body: corpo,
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* sem corpo */ }
  return { status: res.status, json };
}
const stripeWebhook = (ev, o = {}) => webhook('stripe', ev, { segredo: 'whsec_teste', nomeCabecalho: 'Stripe-Signature', ...o });
const gravadoraWebhook = (ev, o = {}) => webhook('gravadora', ev, { segredo: 'segredo-gravadora', nomeCabecalho: 'X-Gravadora-Assinatura', ...o });

const esperar = async (cond, msg, ms = 3000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 25)); }
  ok(false, 'tempo esgotado: ' + msg);
  return false;
};

function futureWeekday(offset = 3) {
  let d = U.addDays(U.nowLocal().date, offset);
  while ([0, 6].includes(U.weekday(d))) d = U.addDays(d, 1);
  return d;
}

(async () => {
  server = start(0);
  await new Promise((r) => server.on('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const login = await call('POST', '/api/auth/login', { body: { email: 'dono@teste.cv', password: 'palavra-passe-teste' } });
  const cookie = login.res.headers.get('set-cookie').split(';')[0];

  // ------------------------------------------------------------ Stripe
  console.log('\nPagamentos (Stripe)');
  // Moeda das definições é "CVE": código ISO, serve tal e qual.
  let r = await call('GET', '/api/integracoes/estado');
  ok(r.status === 200 && r.json.pagamentos === true, 'com chave e moeda ISO, o site sabe que há pagamento online');

  const cfg = (await call('GET', '/api/public/config')).json;
  const room = cfg.studios[0].rooms[0].id;
  r = await call('POST', '/api/public/bookings', {
    body: { room_id: room, date: futureWeekday(), start: '10:00', duration_minutes: 120, name: 'Ana Silva', phone: '991 23 45', email: 'ana@exemplo.cv' },
  });
  const code = r.json.booking.code;
  ok(r.json.booking.price === 5000, 'marcação de 5000 criada');

  r = await call('POST', '/api/integracoes/pagamentos/checkout', { body: { code, phone: '000 00 00' } });
  ok(r.status === 404, 'telefone errado: não abre pagamento de marcação alheia');
  r = await call('POST', '/api/integracoes/pagamentos/checkout', { body: { code, phone: '9912345' } });
  ok(r.status === 400 && /confirmar/.test(r.json.error), 'pedido por confirmar ainda não se paga');
  ok(pedidosStripe.length === 0, 'e o Stripe nem chega a ser chamado');

  const id = db.prepare('SELECT id FROM bookings WHERE code=?').get(code).id;
  await call('PATCH', `/api/admin/bookings/${id}/status`, { cookie, body: { status: 'confirmado' } });
  db.prepare('UPDATE bookings SET paid=1000 WHERE id=?').run(id);

  r = await call('POST', '/api/integracoes/pagamentos/checkout', { body: { code, phone: '9912345' } });
  ok(r.status === 200 && r.json.url === 'https://checkout.stripe.com/c/pay/cs_test_1', 'confirmada: devolve o endereço do Checkout');
  ok(r.json.valor === 4000, 'cobra só o que falta (5000 − 1000 já pagos)');
  const enviado = pedidosStripe[0].campos;
  ok(pedidosStripe[0].auth === 'Bearer sk_test_123', 'fala com o Stripe com a chave secreta');
  ok(enviado['line_items[0][price_data][currency]'] === 'cve', 'moeda: cve');
  ok(enviado['line_items[0][price_data][unit_amount]'] === '400000', 'valor em centavos: 4000 CVE = 400000');
  ok(enviado['metadata[booking_code]'] === code && enviado.client_reference_id === code, 'o código da marcação vai com o pagamento');
  ok(enviado.success_url === `https://estudio.exemplo/consultar?code=${code}&pago=1`, 'regresso para a consulta, no endereço público');
  ok(enviado.customer_email === 'ana@exemplo.cv', 'email do cliente preenchido no Checkout');

  let b = db.prepare('SELECT paid FROM bookings WHERE id=?').get(id);
  ok(b.paid === 1000, 'abrir o pagamento não mexe no "Já pago"');

  // Webhooks
  const sessao = { id: 'cs_test_1', object: 'checkout.session', payment_status: 'paid', amount_total: 400000, currency: 'cve', client_reference_id: code, metadata: { booking_code: code } };
  const evento = { id: 'evt_1', type: 'checkout.session.completed', data: { object: sessao } };
  r = await stripeWebhook(evento, { segredo: 'outro-segredo' });
  ok(r.status === 400, 'assinatura errada: recusado');
  r = await stripeWebhook(evento, { t: Math.floor(Date.now() / 1000) - 3600 });
  ok(r.status === 400, 'assinatura certa mas de há uma hora: recusado (repetição)');
  b = db.prepare('SELECT paid FROM bookings WHERE id=?').get(id);
  ok(b.paid === 1000, 'nada mudou com os pedidos recusados');

  r = await stripeWebhook(evento);
  ok(r.status === 200, 'webhook assinado aceite');
  b = db.prepare('SELECT paid FROM bookings WHERE id=?').get(id);
  ok(b.paid === 5000, '"Já pago" passa a 5000');
  r = await stripeWebhook(evento);
  b = db.prepare('SELECT paid FROM bookings WHERE id=?').get(id);
  ok(r.status === 200 && b.paid === 5000, 'o mesmo evento outra vez não soma duas vezes');
  r = await stripeWebhook({ ...evento, id: 'evt_2' });
  b = db.prepare('SELECT paid FROM bookings WHERE id=?').get(id);
  ok(b.paid === 5000, 'outro evento da mesma sessão também não');

  r = await call('POST', '/api/integracoes/pagamentos/checkout', { body: { code, phone: '9912345' } });
  ok(r.status === 400 && /nenhum valor/.test(r.json.error), 'tudo pago: não há mais nada a cobrar');

  r = await call('GET', '/api/admin/integracoes', { cookie });
  ok(r.json.pagamentos[0].estado === 'pago' && r.json.pagamentos[0].valor === 4000, 'o pagamento aparece no painel como pago');

  r = await stripeWebhook({ id: 'evt_3', type: 'customer.created', data: { object: {} } });
  ok(r.status === 200, 'eventos que não interessam são aceites e ignorados');

  // ------------------------------------------------------------ Gravadora
  console.log('\nPlataforma da gravadora');
  const hoje = U.nowLocal().date;
  r = await gravadoraWebhook({
    id: 'g1', tipo: 'lancamento.publicado',
    dados: { id: 'faixa-1', titulo: 'Nova Faixa', artistas: ['Djelox', 'Brou As'], capa: FORA + '/capa-1.png', link: 'https://open.spotify.com/track/abc', data: hoje, plays: 1200 },
  });
  ok(r.status === 200 && r.json.resultado.lancamentos === 1, 'lançamento publicado entra');
  r = await gravadoraWebhook({ id: 'g1b', tipo: 'lancamento.publicado', dados: { id: 'x', titulo: 'Y' } }, { segredo: 'errado' });
  ok(r.status === 400, 'sem a assinatura certa, recusado');
  r = await gravadoraWebhook({ id: 'g1c', tipo: 'lancamento.publicado', dados: { id: 'sem-titulo' } });
  ok(r.status === 400, 'lançamento sem título: recusado com 400 (a plataforma não insiste)');

  await esperar(() => (db.prepare("SELECT capa FROM int_lancamentos WHERE externo_id='faixa-1'").get().capa || '').startsWith('/capas-integracao/'), 'capa descarregada');
  let l = db.prepare("SELECT * FROM int_lancamentos WHERE externo_id='faixa-1'").get();
  ok(l.artista === 'Djelox, Brou As', 'vários artistas ficam numa linha');
  const capaRes = await fetch(base + l.capa);
  ok(capaRes.status === 200 && capaRes.headers.get('content-type') === 'image/png', 'a capa é servida pelo próprio site');

  r = await call('GET', '/api/integracoes/lancamentos');
  ok(r.json.novidades.length === 1 && r.json.novidades[0].titulo === 'Nova Faixa', 'aparece nas novidades do site');
  ok(r.json.sucessos.length === 0, 'com 1200 reproduções ainda não é sucesso');

  r = await gravadoraWebhook({ id: 'g2', tipo: 'lancamento.plays', dados: { plays: [{ id: 'faixa-1', plays: 250000 }] } });
  ok(r.status === 200 && r.json.resultado.atualizados === 1, 'reproduções atualizadas');
  r = await call('GET', '/api/integracoes/lancamentos');
  ok(r.json.sucessos.length === 1 && r.json.sucessos[0].streams === 250000, 'passou das 100 000: entra em "Saíram deste estúdio"');
  ok(r.json.sucessos[0].descricao === `Djelox, Brou As · ${hoje.slice(0, 4)}`, 'com artistas e ano, como os singles escritos à mão');
  l = db.prepare("SELECT * FROM int_lancamentos WHERE externo_id='faixa-1'").get();
  ok(l.link === 'https://open.spotify.com/track/abc' && l.capa, 'um aviso só de reproduções não apaga o resto');

  r = await call('PUT', '/api/admin/integracoes/definicoes', { cookie, body: { sucesso_plays: 500000 } });
  ok(r.status === 200 && r.json.definicoes.sucesso_plays === 500000, 'o limite de sucesso muda no painel');
  r = await call('GET', '/api/integracoes/lancamentos');
  ok(r.json.sucessos.length === 0, 'com o limite a 500 000, deixa de ser sucesso');
  r = await call('PUT', '/api/admin/integracoes/definicoes', { cookie, body: { sucesso_plays: -3 } });
  ok(r.status === 400, 'limite inválido recusado');
  await call('PUT', '/api/admin/integracoes/definicoes', { cookie, body: { sucesso_plays: 100000 } });

  const lid = l.id;
  r = await call('PATCH', `/api/admin/integracoes/lancamentos/${lid}`, { cookie, body: { visivel: false } });
  r = await call('GET', '/api/integracoes/lancamentos');
  ok(r.json.novidades.length === 0 && r.json.sucessos.length === 0, 'escondido no painel, desaparece do site');
  await call('PATCH', `/api/admin/integracoes/lancamentos/${lid}`, { cookie, body: { visivel: true } });

  r = await gravadoraWebhook({ id: 'g3', tipo: 'lancamento.removido', dados: { id: 'faixa-1' } });
  r = await call('GET', '/api/integracoes/lancamentos');
  ok(r.json.novidades.length === 0, 'retirado pela plataforma, sai do site');

  // Feed
  feed = [
    { id: 'faixa-1', titulo: 'Nova Faixa', artista: 'Djelox', data: hoje, plays: 300000 },
    { id: 'antiga', titulo: 'Clássico', artista: 'Brou As', data: '2023-05-01', plays: 3700000, capa: FORA + '/texto' },
    { id: 'breve', titulo: 'Ainda Não Saiu', artista: 'Daski FNG', data: U.addDays(hoje, 10) },
    { titulo: 'Sem id' },
  ];
  r = await call('POST', '/api/admin/integracoes/gravadora/sincronizar', { cookie });
  ok(r.status === 200 && r.json.guardados === 3 && r.json.erros.length === 1, 'feed: 3 guardados, 1 com erro (sem id) e os outros seguem');
  ok(feedAutorizacao === 'Bearer token-feed', 'o feed é pedido com o token');
  r = await call('GET', '/api/integracoes/lancamentos');
  ok(r.json.novidades.map((n) => n.titulo).join('|') === 'Ainda Não Saiu|Nova Faixa', 'novidades: a que vem a caminho e a de hoje; a de 2023 não');
  ok(r.json.sucessos.map((n) => n.titulo).join('|') === 'Clássico|Nova Faixa', 'sucessos, do mais ouvido para o menos');
  ok(r.json.sucessos[0].capa === '/img/logo.png', 'capa que não é imagem fica de fora (e entra o logótipo)');

  r = await call('GET', '/api/admin/integracoes');
  ok(r.status === 401, 'painel das integrações exige sessão');
  r = await call('GET', '/api/admin/integracoes', { cookie });
  ok(r.json.fornecedores.length === 3 && r.json.lancamentos.length === 3, 'o painel vê os fornecedores e os lançamentos');

  // ------------------------------------------------------------ YouTube
  console.log('\nYouTube (views)');
  const yt = r.json.fornecedores.find((f) => f.id === 'youtube');
  ok(yt && yt.ativo === false, 'sem chave, o YouTube aparece desligado no painel');
  r = await call('POST', '/api/admin/integracoes/youtube/sincronizar', { cookie });
  ok(r.status === 400 && /YOUTUBE_API_KEY/.test(r.json.error), 'sincronizar sem chave: recusado com explicação');

  process.env.YOUTUBE_API_KEY = 'chave-yt-teste';
  r = await call('POST', '/api/admin/integracoes/youtube/sincronizar', { cookie });
  ok(r.status === 200 && r.json.guardados === 2 && r.json.erros.length === 1, 'com chave: duas views guardadas; o vídeo privado fica com erro e não trava as outras');
  ok(youtubePedidos.length >= 1 && youtubePedidos.at(-1).key === 'chave-yt-teste', 'o YouTube é chamado com a chave');

  r = await call('GET', '/api/integracoes/lancamentos');
  let porTitulo = Object.fromEntries(r.json.sucessos.map((s) => [s.titulo, s]));
  ok(porTitulo['Berdiana'] && porTitulo['Berdiana'].streams === 967000, 'as views do YouTube entram como número do cartão');
  ok(porTitulo['Berdiana'].link === 'https://open.spotify.com/intl-pt/track/3VP13toJkdl4BesVltNGm1', 'com o link do Spotify, para casar com o single escrito à mão');
  ok(porTitulo['Só no YouTube'] && porTitulo['Só no YouTube'].streams === 250000, 'uma música só do YouTube também aparece');

  VIEWS.BERDIANA111 = 1050000;
  r = await call('POST', '/api/admin/integracoes/youtube/sincronizar', { cookie });
  r = await call('GET', '/api/integracoes/lancamentos');
  porTitulo = Object.fromEntries(r.json.sucessos.map((s) => [s.titulo, s]));
  ok(porTitulo['Berdiana'].streams === 1050000, 'na sincronização seguinte, o número acompanha as views novas');

  r = await fetch(base + '/integracoes/webhooks/nao-existe', { method: 'POST', body: '{}' });
  ok(r.status === 404, 'webhook de integração desconhecida: 404');

  console.log(`\n${passed} certos, ${failed} falhados`);
  server.close();
  fora.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
